/**
 * Safe Command Execution Utility
 *
 * Provides secure command execution with validation, auditing, and resource limits.
 * Prevents command injection attacks through allowlisting and argument validation.
 *
 * @see docs/COMPREHENSIVE_SECURITY_AUDIT.md Security audit findings
 *
 * @example
 * ```typescript
 * // Basic usage
 * import { safeExec } from '@/lib/security/safe-exec';
 *
 * const result = await safeExec('git', ['clone', repoUrl, destPath], {
 *   timeout: 60000,
 *   auditContext: { userId: 'user-123', action: 'clone-repo' },
 * });
 *
 * // Streaming output
 * import { safeSpawn } from '@/lib/security/safe-exec';
 *
 * const proc = safeSpawn('npm', ['install'], { cwd: '/workspace' });
 * proc.stdout.on('data', (data) => console.log(data.toString()));
 * ```
 */

import { execFile, spawn, ExecFileOptions, SpawnOptions, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const execFilePromise = promisify(execFile);

// ============================================================================
// Security Configuration
// ============================================================================

/**
 * Allowlist of safe commands
 * Only these commands can be executed via safeExec/safeSpawn
 */
export const ALLOWED_COMMANDS = new Set([
  // Package managers
  'npm', 'npx', 'pnpm', 'yarn', 'bun',

  // Version control
  'git', 'gh',

  // Build tools
  'node', 'tsc', 'tsx', 'ts-node', 'esbuild', 'vite', 'webpack', 'rollup',

  // Code quality
  'eslint', 'prettier', 'stylelint', 'biome',

  // Testing
  'jest', 'vitest', 'pytest', 'mocha', 'cypress', 'playwright',

  // Search/file operations
  'rg', 'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc',

  // Directory operations
  'mkdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'chown',

  // Security scanning
  'semgrep', 'trufflehog', 'gitleaks', 'snyk',

  // Container/DevOps (carefully restricted)
  'docker-compose', 'docker',

  // System info
  'pwd', 'whoami', 'uname', 'date', 'echo',

  // Archive
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
]);

/**
 * Blocked command patterns (defense in depth)
 * These patterns are blocked even if the command is in the allowlist
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  // System destruction
  /\brm\s+(-[rf]+\s+)?\/(\s|$)/,           // rm -rf /
  /\brm\s+(-[rf]+\s+)?\*\s*$/,             // rm -rf *
  /\bmkfs\b/,                               // Format disk
  /\bdd\s+if=\/dev\/zero/,                 // Zero fill
  /\bshutdown\b/,                           // Shutdown system
  /\breboot\b/,                             // Reboot system
  /\bhalt\b/,                               // Halt system
  /\bpoweroff\b/,                           // Power off

  // Remote code execution
  /\bwget\b.*\|\s*(ba)?sh/,                // wget | bash
  /\bcurl\b.*\|\s*(ba)?sh/,                // curl | bash
  /\bwget\b.*-O\s*-\s*\|/,                 // wget -O - |
  /\bcurl\b.*-o\s*-\s*\|/,                 // curl -o - |

  // Privilege escalation
  /\bsudo\b/,                               // sudo
  /\bsu\s+-/,                               // su -
  /\bchmod\s+[0-7]+\s+\/(etc|bin|usr|sbin)/, // chmod system dirs
  /\bchown\s+.*\s+\/(etc|bin|usr|sbin)/,    // chown system dirs

  // Process killing (mass kill)
  /\bkill\s+-9\s+1\b/,                     // kill init
  /\bkillall\s+-9/,                         // killall -9
  /\bpkill\s+-9/,                           // pkill -9

  // Disk operations
  />\s*\/dev\/sd/,                          // Redirect to disk
  /\bmkfs\.\w+\s+\/dev\/sd/,               // Format disk partition
  /\bfdisk\s+\/dev\/sd/,                   // Partition disk
  /\bparted\s+\/dev\/sd/,                  // Partition disk

  // Environment manipulation
  /\bexport\s+LD_PRELOAD/,                 // LD_PRELOAD injection
  /\bunset\s+PATH\b/,                      // Unset PATH

  // Kernel module loading
  /\binsmod\b/,                             // Insert kernel module
  /\brmmod\b/,                              // Remove kernel module
  /\bmodprobe\b/,                           // Probe kernel module

  // Network attacks
  /\bnmap\b/,                               // Network scanning
  /\bmasscan\b/,                            // Mass network scanning
  /\bnc\s+-[el]/,                           // Netcat listener
  /\bnetcat\b.*-[el]/,                      // Netcat listener

  // Fork bomb
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/,          // Fork bomb pattern
];

/**
 * Shell metacharacters that are blocked in arguments
 */
export const BLOCKED_METACHARACTERS = /[;&|`$(){}\\]/;

/**
 * Default resource limits
 */
export const DEFAULT_TIMEOUT = 60000; // 60 seconds
export const DEFAULT_MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

// ============================================================================
// Types
// ============================================================================

export interface SafeExecOptions extends ExecFileOptions {
  /** Audit log context for compliance and debugging */
  auditContext?: {
    userId?: string;
    action?: string;
    sandboxId?: string;
    conversationId?: string;
  };
  /** Max output size in bytes (default: 10MB) */
  maxOutputSize?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

export interface SafeSpawnOptions extends SpawnOptions {
  /** Audit log context */
  auditContext?: {
    userId?: string;
    action?: string;
    sandboxId?: string;
    conversationId?: string;
  };
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate command against allowlist and blocked patterns
 */
function validateCommand(command: string, args: string[]): { valid: boolean; reason?: string } {
  // Check allowlist
  if (!ALLOWED_COMMANDS.has(command)) {
    return {
      valid: false,
      reason: `Command not allowed: ${command}. Use only allowlisted commands.`,
    };
  }

  // Check blocked patterns (full command string)
  const fullCommand = `${command} ${args.join(' ')}`;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCommand)) {
      return {
        valid: false,
        reason: `Command blocked by security policy: dangerous pattern detected`,
      };
    }
  }

  // Check each argument for metacharacters
  for (const arg of args) {
    if (BLOCKED_METACHARACTERS.test(arg)) {
      return {
        valid: false,
        reason: `Invalid argument: shell metacharacters not allowed: ${arg}`,
      };
    }

    // Block null bytes
    if (arg.includes('\0')) {
      return {
        valid: false,
        reason: `Invalid argument: null bytes not allowed`,
      };
    }
  }

  return { valid: true };
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Execute command safely with validation and auditing
 *
 * @param command - Command to execute (must be in allowlist)
 * @param args - Command arguments (validated for safety)
 * @param options - Execution options including timeout, audit context, etc.
 * @returns Promise with stdout, stderr, exitCode, and duration
 * @throws Error if command is blocked or execution fails
 *
 * @example
 * ```typescript
 * const result = await safeExec('git', ['clone', repoUrl], {
 *   timeout: 120000,
 *   auditContext: { userId: 'user-123', action: 'clone-repo' },
 * });
 * console.log(result.stdout);
 * ```
 */
export async function safeExec(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {}
): Promise<ExecResult> {
  const {
    auditContext,
    maxOutputSize = DEFAULT_MAX_OUTPUT_SIZE,
    verbose = false,
    timeout: timeoutMs = DEFAULT_TIMEOUT,
    ...execOptions
  } = options;

  const startTime = Date.now();

  // 1. Validate command and arguments
  const validation = validateCommand(command, args);
  if (!validation.valid) {
    logger.error({ command, args, reason: validation.reason }, 'command blocked');
    throw new Error(validation.reason);
  }

  // 2. Audit log (start)
  if (verbose || auditContext) {
    logger.info(
      {
        command,
        args,
        userId: auditContext?.userId,
        action: auditContext?.action,
        sandboxId: auditContext?.sandboxId,
        conversationId: auditContext?.conversationId,
      },
      'executing command'
    );
  }

  try {
    // 3. Execute with resource limits
    const result = await execFilePromise(command, args, {
      ...execOptions,
      timeout: timeoutMs,
      maxBuffer: maxOutputSize,
    });

    const duration = Date.now() - startTime;

    // 4. Audit log (success)
    if (verbose || auditContext) {
      logger.info(
        {
          command,
          args,
          exitCode: 0,
          duration,
          outputSize: result.stdout.length,
          userId: auditContext?.userId,
        },
        'command completed'
      );
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // 5. Audit log (failure)
    logger.error(
      {
        command,
        args,
        error: error.message,
        exitCode: error.code,
        duration,
        userId: auditContext?.userId,
      },
      'command failed'
    );

    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.code || 1,
      duration,
    };
  }
}

/**
 * Spawn command safely with streaming output
 *
 * @param command - Command to execute (must be in allowlist)
 * @param args - Command arguments (validated for safety)
 * @param options - Spawn options including audit context
 * @returns ChildProcess for streaming output handling
 * @throws Error if command is blocked
 *
 * @example
 * ```typescript
 * const proc = safeSpawn('npm', ['install'], {
 *   cwd: '/workspace',
 *   auditContext: { userId: 'user-123', action: 'npm-install' },
 * });
 *
 * proc.stdout.on('data', (data) => {
 *   console.log(data.toString());
 * });
 *
 * proc.on('close', (code) => {
 *   console.log(`Exited with code ${code}`);
 * });
 * ```
 */
export function safeSpawn(
  command: string,
  args: string[] = [],
  options: SafeSpawnOptions = {}
): ChildProcess {
  const { auditContext, verbose = false, ...spawnOptions } = options;

  // 1. Validate command and arguments
  const validation = validateCommand(command, args);
  if (!validation.valid) {
    logger.error({ command, args, reason: validation.reason }, 'command blocked');
    throw new Error(validation.reason);
  }

  // 2. Audit log
  if (verbose || auditContext) {
    logger.info(
      {
        command,
        args,
        userId: auditContext?.userId,
        action: auditContext?.action,
        sandboxId: auditContext?.sandboxId,
      },
      'spawning command'
    );
  }

  // 3. Spawn with shell:false (always)
  const proc = spawn(command, args, {
    ...spawnOptions,
    shell: false, // SECURITY: Never use shell with safeSpawn
  });

  // 4. Log process events
  proc.on('error', (error: Error) => {
    logger.error({ command, args, error: error.message }, 'spawn error');
  });

  proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (verbose || auditContext) {
      logger.info({ command, args, exitCode: code, signal }, 'process exited');
    }
  });

  return proc;
}

/**
 * Execute command with retry logic for transient failures
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param options - Execution options including retry settings
 * @returns Promise with execution result
 *
 * @example
 * ```typescript
 * const result = await safeExecWithRetry('npm', ['install'], {
 *   maxRetries: 3,
 *   retryDelay: 1000,
 *   auditContext: { userId: 'user-123' },
 * });
 * ```
 */
export async function safeExecWithRetry(
  command: string,
  args: string[] = [],
  options: SafeExecOptions & {
    maxRetries?: number;
    retryDelay?: number;
    retryableExitCodes?: number[];
  } = {}
): Promise<ExecResult> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    retryableExitCodes = [1, 127, 128], // Network errors, command not found, etc.
    ...execOptions
  } = options;

  let lastError: Error | null = null;
  let result: ExecResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      result = await safeExec(command, args, {
        ...execOptions,
        auditContext: {
          ...execOptions.auditContext,
          action: `${execOptions.auditContext?.action || 'exec'}-attempt-${attempt}`,
        },
      });

      // Check if retry is needed
      if (result.exitCode === 0 || !retryableExitCodes.includes(result.exitCode)) {
        return result;
      }

      // Retry
      if (attempt < maxRetries) {
        logger.warn(
          { command, args, exitCode: result.exitCode, attempt, maxRetries },
          'retrying command'
        );
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt)); // Exponential backoff
      }
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        logger.warn(
          { command, args, error: error.message, attempt, maxRetries },
          'retrying after error'
        );
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return result!;
}

// Note: ALLOWED_COMMANDS, BLOCKED_PATTERNS, etc. are already exported at their declaration
