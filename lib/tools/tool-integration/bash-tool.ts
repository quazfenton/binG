/**
 * Bash Tool Executor
 * 
 * Executes bash commands in sandboxed environments with:
 * - Self-healing (automatic error recovery)
 * - Safety validation
 * - VFS integration for file operations
 * - Comprehensive logging
 * 
 * Uses existing sandbox infrastructure (executeCommand) - no new sandbox code needed!
 * 
 * @example
 * ```typescript
 * const result = await bashToolExecutor.execute({
 *   params: { command: 'cat > test.txt << EOF\nhello\nEOF' },
 *   ownerId: 'user_123',
 *   sandboxId: 'sandbox_456',
 * });
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from '@/lib/sandbox/providers';
import { createLogger } from '@/lib/utils/logger';
import { executeWithHealing } from '@/lib/chat/bash-self-heal';
import type { ToolExecutionContext, ToolExecutionResult } from '../tool-integration-system';

const logger = createLogger('Tool:Bash');

// ============================================================================
// Type Definitions
// ============================================================================

export interface BashToolConfig {
  /** Default timeout in milliseconds */
  defaultTimeout?: number;
  /** Maximum output size in bytes */
  maxOutputSize?: number;
  /** Enable self-healing */
  enableSelfHealing?: boolean;
  /** Maximum healing attempts */
  maxHealingAttempts?: number;
}

export interface BashToolParams {
  /** Bash command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable self-healing for this command */
  enableHealing?: boolean;
}

export interface BashToolExecutionResult extends ToolExecutionResult {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code */
  exitCode: number;
  /** Execution duration in milliseconds */
  duration: number;
  /** Number of attempts (with healing) */
  attempts: number;
  /** Applied fixes */
  fixesApplied?: Array<{
    attempt: number;
    original: string;
    fixed: string;
  }>;
}

export interface BashExecutionContext extends ToolExecutionContext {
  params: BashToolParams;
  sandboxId?: string;
  sandboxProvider?: SandboxProviderType;
}

// ============================================================================
// Bash Tool Executor Class
// ============================================================================

export class BashToolExecutor {
  private config: BashToolConfig;

  constructor(config: BashToolConfig = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout || 30000,
      maxOutputSize: config.maxOutputSize || 1024 * 1024, // 1MB
      enableSelfHealing: config.enableSelfHealing ?? true,
      maxHealingAttempts: config.maxHealingAttempts || 3,
    };
  }

  /**
   * Execute bash command with optional self-healing
   * 
   * @param context - Tool execution context
   * @returns Execution result with stdout, stderr, exitCode
   */
  async execute(
    context: BashExecutionContext
  ): Promise<BashToolExecutionResult> {
    const { command, cwd, timeout, enableHealing } = context.params;
    const startTime = Date.now();

    logger.info('Bash command received', {
      command: command.substring(0, 100),
      cwd,
      timeout,
      enableHealing: enableHealing ?? this.config.enableSelfHealing,
    });

    try {
      // Get sandbox handle
      const sandbox = await getSandboxProvider(context.sandboxProvider || 'daytona');
      const handle = await sandbox.getSandbox(context.sandboxId);

      // Create execute function for healing wrapper
      const executeCommand = async (cmd: string) => {
        const result = await handle.executeCommand(
          cmd,
          cwd || context.params.cwd,
          timeout || this.config.defaultTimeout
        );

        return {
          success: result.success,
          stdout: result.output || '',
          stderr: result.error || '',
          exitCode: result.exitCode || 0,
        };
      };

      // Execute with or without healing
      let execResult: {
        success: boolean;
        stdout: string;
        stderr: string;
        exitCode: number;
        attempts?: number;
        fixesApplied?: Array<{ attempt: number; original: string; fixed: string }>;
      };

      const useHealing = enableHealing ?? this.config.enableSelfHealing;

      if (useHealing) {
        // Execute with self-healing
        execResult = await executeWithHealing(
          executeCommand,
          command,
          this.config.maxHealingAttempts
        );
      } else {
        // Execute without healing (direct execution)
        execResult = await executeCommand(command);
        execResult.attempts = 1;
        execResult.fixesApplied = [];
      }

      const duration = Date.now() - startTime;

      logger.info('Bash command completed', {
        success: execResult.success,
        duration,
        exitCode: execResult.exitCode,
        attempts: execResult.attempts,
        fixesApplied: execResult.fixesApplied?.length || 0,
      });

      return {
        success: execResult.success,
        output: execResult.stdout || execResult.stderr,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        duration,
        attempts: execResult.attempts || 1,
        fixesApplied: execResult.fixesApplied,
      };
    } catch (error: any) {
      logger.error('Bash command failed', {
        error: error.message,
        command: command.substring(0, 100),
      });

      const duration = Date.now() - startTime;

      return {
        success: false,
        output: error.message,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
        duration,
        attempts: 1,
      };
    }
  }

  /**
   * Execute bash command without self-healing (faster, no retries)
   * 
   * @param context - Tool execution context
   * @returns Execution result
   */
  async executeSimple(
    context: BashExecutionContext
  ): Promise<BashToolExecutionResult> {
    return this.execute({
      ...context,
      params: {
        ...context.params,
        enableHealing: false,
      },
    });
  }

  /**
   * Execute bash command with self-healing enabled (default)
   * 
   * @param context - Tool execution context
   * @returns Execution result
   */
  async executeWithHealing(
    context: BashExecutionContext
  ): Promise<BashToolExecutionResult> {
    return this.execute({
      ...context,
      params: {
        ...context.params,
        enableHealing: true,
      },
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BashToolConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Bash tool config updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): BashToolConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const bashToolExecutor = new BashToolExecutor();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute bash command with default settings
 */
export async function executeBash(
  command: string,
  options: {
    userId: string;
    sandboxId: string;
    sandboxProvider?: SandboxProviderType;
    cwd?: string;
    timeout?: number;
    enableHealing?: boolean;
  }
): Promise<BashToolExecutionResult> {
  return bashToolExecutor.execute({
    userId: options.userId,
    params: {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
      enableHealing: options.enableHealing,
    },
    sandboxId: options.sandboxId,
    sandboxProvider: options.sandboxProvider,
  });
}

/**
 * Execute bash command with self-healing
 */
export async function executeBashWithHealing(
  command: string,
  options: {
    userId: string;
    sandboxId: string;
    sandboxProvider?: SandboxProviderType;
    cwd?: string;
    timeout?: number;
  }
): Promise<BashToolExecutionResult> {
  return bashToolExecutor.executeWithHealing({
    userId: options.userId,
    params: {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
    },
    sandboxId: options.sandboxId,
    sandboxProvider: options.sandboxProvider,
  });
}

/**
 * Execute bash command without self-healing
 */
export async function executeBashSimple(
  command: string,
  options: {
    userId: string;
    sandboxId: string;
    sandboxProvider?: SandboxProviderType;
    cwd?: string;
    timeout?: number;
  }
): Promise<BashToolExecutionResult> {
  return bashToolExecutor.executeSimple({
    userId: options.userId,
    params: {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
    },
    sandboxId: options.sandboxId,
    sandboxProvider: options.sandboxProvider,
  });
}
