/**
 * Bash Tool Implementation
 *
 * LLM-facing bash execution tool with VFS integration
 *
 * @see bash.md - Bash-native agent execution patterns
 */

import { tool } from 'ai';
import { z } from 'zod';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import { createLogger } from '@/lib/utils/logger';
import {
  BashExecutionEvent,
  BashExecutionResult,
  BashFailureContext,
  createBashExecutionEvent,
  createBashFailureContext,
} from './bash-event-schema';
import { executeWithHealing, isCommandSafe } from './self-healing';

const logger = createLogger('Bash:Tool');

// ============================================================================
// Configuration
// ============================================================================

export interface BashToolConfig {
  /** Enable VFS persistence */
  persistToVFS: boolean;
  /** Enable self-healing */
  enableSelfHealing: boolean;
  /** Max retry attempts */
  maxRetries: number;
  /** Working directory */
  workingDir: string;
  /** Default timeout in ms */
  defaultTimeout: number;
}

const DEFAULT_CONFIG: BashToolConfig = {
  persistToVFS: true,
  enableSelfHealing: process.env.BASH_SELF_HEALING_ENABLED === 'true',
  maxRetries: 3,
  workingDir: process.env.BASH_WORKING_DIR || '/workspace',
  defaultTimeout: 30000,
};

// ============================================================================
// Bash Execution Implementation
// ============================================================================

/**
 * Execute bash command directly using child_process
 */
export async function executeBashCommand(
  command: string,
  options: {
    workingDir?: string;
    env?: Record<string, string>;
    timeout?: number;
    stdin?: string;
  } = {}
): Promise<BashExecutionResult> {
  const startTime = Date.now();
  const workingDir = options.workingDir || DEFAULT_CONFIG.workingDir;

  logger.debug('Executing bash command', {
    command,
    workingDir,
    timeout: options.timeout,
  });

  try {
    const { spawn } = await import('child_process');

    // SECURITY: Use minimal safe environment instead of spreading process.env
    // This prevents exposing server secrets (API keys, DB credentials, etc.) to LLM commands
    const safeEnv: Record<string, string> = {
      // Essential path for finding commands
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      // Basic system vars
      HOME: process.env.HOME || '/tmp',
      USER: process.env.USER || 'nobody',
      SHELL: '/bin/bash',
      // Locale settings for consistent output
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
      // Allow user-provided env to override defaults
      ...options.env,
    };

    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: workingDir,
        env: safeEnv,
        timeout: options.timeout || DEFAULT_CONFIG.defaultTimeout,
        shell: false, // Explicitly use bash from spawn
      });

      let stdout = '';
      let stderr = '';

      // Handle stdin if provided
      if (options.stdin) {
        proc.stdin?.write(options.stdin);
        proc.stdin?.end();
      }

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (exitCode) => {
        const duration = Date.now() - startTime;

        const result: BashExecutionResult = {
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode: exitCode ?? -1, // Preserve null (signal kills) as -1, not 0
          duration,
          command,
          workingDir,
        };

        logger.debug('Command completed', {
          exitCode,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        resolve(result);
      });

      proc.on('error', (err) => {
        const duration = Date.now() - startTime;

        const error = new Error(`Command failed: ${err.message}`);
        Object.assign(error, {
          success: false,
          stdout: '',
          stderr: err.message,
          exitCode: -1,
          duration,
          command,
          workingDir,
        } as BashExecutionResult & { success: false; exitCode: -1 });

        reject(error);
      });

      proc.on('timeout', () => {
        proc.kill('SIGKILL');
      });
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    logger.error('Bash execution failed', {
      command,
      error: error.message,
    });

    return {
      success: false,
      stdout: '',
      stderr: error.message,
      exitCode: -1,
      duration,
      command,
      workingDir,
    };
  }
}

/**
 * Persist command output to VFS
 */
async function persistToVFS(
  agentId: string,
  command: string,
  result: BashExecutionResult
): Promise<string | null> {
  if (!DEFAULT_CONFIG.persistToVFS) {
    return null;
  }

  try {
    // Generate output path
    const timestamp = Date.now();
    const safeCommand = command.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const outputPath = `/workspace/bash-outputs/${safeCommand}-${timestamp}.log`;

    // Create output content
    const output = [
      `# Command: ${command}`,
      `# Executed: ${new Date().toISOString()}`,
      `# Exit Code: ${result.exitCode}`,
      `# Duration: ${result.duration}ms`,
      '',
      '## STDOUT',
      '```',
      result.stdout,
      '```',
      '',
      '## STDERR',
      '```',
      result.stderr,
      '```',
    ].join('\n');

    // Write to VFS
    await virtualFilesystem.writeFile(agentId, outputPath, output);

    logger.info('Persisted bash output to VFS', { outputPath });

    return outputPath;
  } catch (error: any) {
    logger.warn('Failed to persist to VFS', error.message);
    return null;
  }
}

/**
 * Get VFS file snapshot for working directory
 */
async function getVFSSnapshot(
  agentId: string,
  workingDir: string
): Promise<string[]> {
  try {
    const listing = await virtualFilesystem.listDirectory(agentId, workingDir);
    return listing.nodes.map(node => node.path);
  } catch (error: any) {
    logger.warn('Failed to get VFS snapshot', error.message);
    return [];
  }
}

// ============================================================================
// LLM Tool Export
// ============================================================================

/**
 * Create bash tool for LLM
 */
export function createBashTool(config: Partial<BashToolConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    bash_execute: tool({
      description: 'Execute bash commands in sandboxed environment. Supports pipes, redirects, and complex pipelines. Output is persisted to VFS.',
      inputSchema: z.object({
        command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern > output.txt")'),
        workingDir: z.string().optional().describe('Working directory (default: /workspace)'),
        persist: z.boolean().optional().default(true).describe('Persist output to VFS'),
        selfHeal: z.boolean().optional().default(cfg.enableSelfHealing).describe('Enable self-healing on failure'),
        timeout: z.number().optional().default(cfg.defaultTimeout).describe('Timeout in milliseconds'),
      }),
      execute: async ({ command, workingDir, persist, selfHeal, timeout }, ctx) => {
        const agentId = (ctx as any).threadId || 'default';
        const wd = workingDir || cfg.workingDir;

        logger.info('Bash execution requested', {
          command,
          workingDir: wd,
          agentId,
          selfHeal,
        });

        if (!isCommandSafe(command)) {
          throw new Error(`Command blocked by safety filter: ${command.slice(0, 100)}`);
        }

        let result: BashExecutionResult;

        try {
          // Execute with or without self-healing
          if (selfHeal && cfg.enableSelfHealing) {
            result = await executeWithHealing(command, {
              workingDir: wd,
              maxRetries: cfg.maxRetries,
              timeout,
            });
          } else {
            result = await executeBashCommand(command, {
              workingDir: wd,
              timeout,
            });
          }

          // Persist to VFS if requested
          if (persist) {
            const outputPath = await persistToVFS(agentId, command, result);
            if (outputPath) {
              result.outputPath = outputPath;
            }
          }

          return {
            success: result.success,
            output: result.stdout,
            error: result.stderr,
            exitCode: result.exitCode,
            duration: result.duration,
            outputPath: result.outputPath,
          };
        } catch (error: any) {
          logger.error('Bash execution failed', {
            command,
            error: error.message,
          });

          return {
            success: false,
            output: '',
            error: error.message || 'Unknown error',
            exitCode: -1,
            duration: 0,
          };
        }
      },
    }),
  };
}

// ============================================================================
// Event System Integration
// ============================================================================

/**
 * Execute bash via event system (for durable execution)
 */
export async function executeBashViaEvent(
  event: BashExecutionEvent
): Promise<BashExecutionResult> {
  logger.info('Executing bash via event system', {
    command: event.command,
    agentId: event.agentId,
  });

  let result: BashExecutionResult;

  try {
    if (event.selfHeal) {
      result = await executeWithHealing(event.command, {
        workingDir: event.workingDir,
        maxRetries: event.maxRetries,
        timeout: event.timeout,
        env: event.env,
      });
    } else {
      result = await executeBashCommand(event.command, {
        workingDir: event.workingDir,
        timeout: event.timeout,
        env: event.env,
      });
    }

    // Persist to VFS if requested
    if (event.persist) {
      const outputPath = await persistToVFS(event.agentId, event.command, result);
      if (outputPath) {
        result.outputPath = outputPath;
      }
    }

    return result;
  } catch (error: any) {
    logger.error('Event-based bash execution failed', {
      command: event.command,
      error: error.message,
    });

    return {
      success: false,
      stdout: '',
      stderr: error.message,
      exitCode: -1,
      duration: 0,
      command: event.command,
      workingDir: event.workingDir || DEFAULT_CONFIG.workingDir,
    };
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract output files from command
 */
export function extractOutputFiles(command: string): string[] {
  const files: string[] = [];
  
  // Match > filename patterns
  const redirectMatches = command.match(/>+\s*([^\s|&;]+)/g);
  if (redirectMatches) {
    for (const match of redirectMatches) {
      const fileMatch = match.match(/>+\s*(.+)/);
      if (fileMatch && fileMatch[1]) {
        files.push(fileMatch[1].trim());
      }
    }
  }

  return files;
}


