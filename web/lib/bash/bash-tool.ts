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
  /** Optional: Callback for streaming output to terminal */
  onTerminalOutput?: (text: string) => void;
  /** Optional: Get filesystem state for routing decisions */
  getFilesystemState?: () => Record<string, { content?: string; isDirectory?: boolean }>;
}

const DEFAULT_CONFIG: BashToolConfig = {
  persistToVFS: true,
  enableSelfHealing: process.env.BASH_SELF_HEALING_ENABLED === 'true',
  maxRetries: 3,
  workingDir: process.env.BASH_WORKING_DIR || '/workspace',
  defaultTimeout: 30000,
};

// ============================================================================
// Direct Command Detection (skip self-healing for trivial commands)
// From terminal/command_executor.js — saves ~2x latency on simple ops
// ============================================================================

/**
 * Direct commands that don't need AI self-healing.
 * These are common, reliable, well-understood commands that rarely fail.
 * Skipping self-healing saves a retry round-trip for trivial operations.
 */
const DIRECT_COMMANDS = new Set([
  // Navigation
  'ls', 'pwd', 'cd', 'dirs', 'popd', 'pushd',
  // File operations (read-only)
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'stat', 'file', 'tree',
  // Search
  'find', 'grep', 'egrep', 'fgrep', 'locate', 'which', 'whereis', 'type',
  // System info
  'whoami', 'id', 'uname', 'hostname', 'date', 'time', 'uptime', 'env', 'printenv',
  // Process
  'ps', 'top', 'htop', 'jobs', 'bg', 'fg', 'kill', 'killall', 'pgrep',
  // Disk/memory
  'df', 'du', 'free', 'vmstat', 'iostat',
  // Network
  'ping', 'netstat', 'ss', 'ifconfig', 'ip', 'curl', 'wget', 'dig', 'nslookup', 'traceroute',
  // Archive
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz',
  // Permissions (read-only)
  'lsattr', 'getfacl',
  // Version/info
  'node', 'npm', 'pnpm', 'yarn', 'pip', 'python', 'python3', 'git', 'docker',
  // Utility
  'echo', 'printf', 'seq', 'yes', 'basename', 'dirname', 'realpath', 'readlink',
  // Editors (we intercept these — see handleTextEditorCommand)
  'vim', 'nano', 'vi', 'emacs', 'code',
]);

/**
 * Check if a command is a direct (simple, reliable) command that doesn't need self-healing.
 */
export function isDirectCommand(command: string): boolean {
  const base = command.trim().split(/\s+/)[0]?.toLowerCase() || '';
  // Direct commands: no pipes, redirects, or chaining
  if (base && !command.includes('|') && !command.includes('>') && !command.includes('&&') && !command.includes(';')) {
    return DIRECT_COMMANDS.has(base) || base.startsWith('./') || base.includes('/');
  }
  return false;
}

/**
 * Intercept text editor commands (vim/nano/emacs/code) and translate them
 * to VFS file operations instead of trying to spawn an interactive terminal editor
 * (which would hang the PTY with no user input channel).
 */
export async function handleTextEditorCommand(
  command: string,
  workingDir: string
): Promise<BashExecutionResult | null> {
  const match = command.match(/^(vim|vi|nano|emacs|code)\s+(?:-\w+\s+)*([^\s]+)/);
  if (!match) return null;

  const editor = match[1];
  const filePath = match[2];

  // Can't create a file from just `vim file.js` with no content — return helpful message
  return {
    success: false,
    stdout: '',
    stderr: `Interactive editor '${editor}' cannot run in terminal mode. Use write_file tool or 'echo "content" > ${filePath}' instead.`,
    exitCode: 1,
    duration: 0,
    command,
    workingDir,
    intercepted: true,
    editor,
    filePath,
  } as any;
}

// ============================================================================
// Hook System (from ai_terminal_integration.js)
// Allows preExecution/postExecution/onError lifecycle hooks
// ============================================================================

export interface BashHookContext {
  command: string;
  workingDir: string;
  userId?: string;
  sessionId?: string;
  [key: string]: any;
}

export interface BashHookResult {
  output?: string;
  error?: string;
  skipExecution?: boolean;
  [key: string]: any;
}

type BashHookHandler = (ctx: BashHookContext) => Promise<BashHookResult | void> | BashHookResult | void;

const hooks = {
  preExecution: [] as BashHookHandler[],
  postExecution: [] as BashHookHandler[],
  onError: [] as BashHookHandler[],
};

/**
 * Register a lifecycle hook for bash execution.
 * @param type - 'preExecution', 'postExecution', or 'onError'
 * @param handler - Hook callback function
 */
export function registerBashHook(type: keyof typeof hooks, handler: BashHookHandler): void {
  hooks[type].push(handler);
}

/**
 * Clear all hooks (for testing).
 */
export function clearBashHooks(): void {
  hooks.preExecution.length = 0;
  hooks.postExecution.length = 0;
  hooks.onError.length = 0;
}

async function triggerHooks(type: keyof typeof hooks, ctx: BashHookContext): Promise<BashHookResult | null> {
  for (const handler of hooks[type]) {
    try {
      const result = await handler(ctx) as BashHookResult | undefined;
      if (result?.skipExecution) return result;
    } catch (e: any) {
      logger.warn(`Hook error (${type})`, { error: e.message });
    }
  }
  return null;
}

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
      // Node environment
      NODE_ENV: process.env.NODE_ENV || 'development',
      // Allow user-provided env to override defaults
      ...options.env,
    };

    return new Promise((resolve, reject) => {
      const proc = spawn('bash', ['-c', command], {
        cwd: workingDir,
        env: safeEnv as NodeJS.ProcessEnv,
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
  enabled: boolean,
  agentId: string,
  command: string,
  result: BashExecutionResult
): Promise<string | null> {
  if (!enabled) {
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

        // ROUTING: Check if command should be simulated vs sandbox via terminal router
        let routeDecision: { mode: string; reason?: string } | null = null;
        if (cfg.getFilesystemState) {
          try {
            const { routeLLMCommand, executeRoutedCommand } = await import('@/lib/terminal/commands/llm-bash-router');
            routeDecision = routeLLMCommand(command, {
              getFilesystem: cfg.getFilesystemState,
              onOutput: cfg.onTerminalOutput,
            });
            logger.debug('Command routed', routeDecision);
            
            // Execute based on routing decision
            if (routeDecision.mode === 'simulate') {
              const simOutput = await executeRoutedCommand(routeDecision, {
                getFilesystem: cfg.getFilesystemState,
                onOutput: cfg.onTerminalOutput,
              });
              // Stream to terminal if callback provided
              if (cfg.onTerminalOutput) {
                cfg.onTerminalOutput(simOutput);
              }
              return {
                success: true,
                output: simOutput,
                error: undefined,
                exitCode: 0,
                duration: 0,
                _routed: 'simulate',
              };
            } else if (routeDecision.mode === 'blocked') {
              return {
                success: false,
                output: '',
                error: routeDecision.reason || 'Command blocked',
                exitCode: 1,
                duration: 0,
                _routed: 'blocked',
              };
            } else if (routeDecision.mode === 'confirm') {
              // For now, require confirmation through the tool result
              // In full integration, this would prompt the user
              return {
                success: false,
                output: '',
                error: `[CONFIRM REQUIRED] ${routeDecision.reason || 'This command requires confirmation. Please re-run with confirmation.'}`,
                exitCode: 1,
                duration: 0,
                _routed: 'confirm',
              };
            }
            // 'sandbox' mode falls through to normal execution
          } catch (e) {
            // Router unavailable - fall through to normal execution
            logger.debug('Command router unavailable', { error: (e as Error).message });
          }
        }

        // PATCH 1: Intercept text editor commands (vim/nano/emacs) — they'd hang the PTY
        const editorResult = await handleTextEditorCommand(command, wd) as any;
        if (editorResult) {
          logger.info('Text editor command intercepted', { editor: editorResult.editor, filePath: editorResult.filePath });
          return {
            success: false,
            output: '',
            error: editorResult.stderr,
            exitCode: 1,
            duration: 0,
          };
        }

        // PATCH 2: Trigger preExecution hooks (allows VFS sync, scope injection, etc.)
        const hookCtx: BashHookContext = { command, workingDir: wd, userId: agentId };
        const preResult = await triggerHooks('preExecution', hookCtx);
        if (preResult?.skipExecution) {
          logger.info('Pre-execution hook skipped execution');
          return {
            success: true,
            output: preResult.output || '',
            error: preResult.error,
            exitCode: 0,
            duration: 0,
          };
        }

        let result: BashExecutionResult;

        try {
          // PATCH 3: Direct command detection — skip self-healing for trivial commands
          // ls, pwd, whoami, etc. rarely fail — skip the retry loop to save latency
          const isDirect = isDirectCommand(command);
          const shouldSelfHeal = selfHeal && cfg.enableSelfHealing && !isDirect;

          if (shouldSelfHeal) {
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

          if (isDirect) {
            logger.debug('Direct command executed (skipped self-healing)', { command });
          }

          // Persist to VFS if requested
          if (persist) {
            const outputPath = await persistToVFS(cfg.persistToVFS, agentId, command, result);
            if (outputPath) {
              result.outputPath = outputPath;
            }
          }

          // PATCH 2: Trigger postExecution hooks (allows file sync, logging, etc.)
          await triggerHooks('postExecution', { ...hookCtx, result });

          // Stream output to terminal callback if provided (for TerminalPanel integration)
        if (cfg.onTerminalOutput && result.stdout) {
          cfg.onTerminalOutput(result.stdout);
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

          // PATCH 2: Trigger onError hooks
          await triggerHooks('onError', { ...hookCtx, error: error.message });

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
      const outputPath = await persistToVFS(DEFAULT_CONFIG.persistToVFS, event.agentId, event.command, result);
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

// ============================================================================
// VFS Sync Hook (registers automatically when imported)
// Syncs files created by bash commands back into the VFS session workspace
// ============================================================================

/**
 * Register the default VFS sync hook for bash execution.
 * This syncs files created by bash redirects (`> file.txt`) and `touch` commands
 * back into the VFS session workspace so they appear in the workspace panel.
 *
 * Call this once during app initialization.
 */
export function registerVFSSyncHook(): void {
  registerBashHook('postExecution', async (ctx: BashHookContext & { result?: BashExecutionResult }) => {
    if (!ctx.result?.success) return;

    // Extract files created by redirects (echo "x" > file.txt, cat > file.txt << EOF)
    const outputFiles = extractOutputFiles(ctx.command);

    for (const filePath of outputFiles) {
      try {
        // Read the file from disk and sync to VFS
        const { readFile } = await import('fs/promises');
        const { resolve } = await import('path');
        const absolutePath = resolve(ctx.workingDir, filePath);
        const content = await readFile(absolutePath, 'utf8');

        // Determine VFS scope path from session
        const scopePath = ctx.scopePath || 'project';
        const vfsPath = filePath.startsWith('/')
          ? filePath.replace(/^\/+/, '')
          : `${scopePath}/${filePath}`;

        await virtualFilesystem.writeFile(
          ctx.userId || 'anonymous',
          vfsPath,
          content,
          'text/plain',
          { failIfExists: false }
        );

        logger.debug('VFS sync: bash-created file synced to VFS', {
          command: ctx.command.slice(0, 80),
          diskPath: absolutePath,
          vfsPath,
          contentLength: content.length,
        });
      } catch (e: any) {
        logger.debug('VFS sync failed for bash output file', {
          file: filePath,
          error: e.message,
        });
      }
    }
  });
}


