/**
 * Bash Tool Implementation
 *
 * LLM-facing bash execution tool with VFS integration
 *
 * @see bash.md - Bash-native agent execution patterns
 */

import { tool } from 'ai';
import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';
import {
  BashExecutionEvent,
  BashExecutionResult,
  BashFailureContext,
  createBashExecutionEvent,
  createBashFailureContext,
} from './bash-event-schema';
import { executeWithHealing, isCommandSafe as _isCommandSafe } from './self-healing';
// Bug #39: pre-flight env probe + 2nd-ENOENT-retry hard-block. The probe
// gives the LLM a concrete list of available binaries (so it stops reaching
// for `npx`/`python3` when they aren't on $PATH), and the retry counter
// hard-blocks the 2nd ENOENT for the same binary with a "use write_file
// / read_file instead" suggestion. Closes the "3 consecutive tool failures"
// loop on the same missing binary.
import {
  formatAvailableBinariesAsync,
  incrementMissingBinaryRetry,
  resetMissingBinaryRetry,
} from './env-probe';
// Pass-2 cross-cutting theme: every silent-failure path that contributes to
// 'user has to reprompt' is recorded into the degradation chain so the next
// time the user complains, run.log shows which kinds fired. The bash tool
// records both the 1st-ENOENT steer and the 2nd-ENOENT hard-block (Bug #39).
import { recordDegradation } from '@/lib/observability/degradation-tracker';
// Lazy-loaded steer helper so the bash tool can emit [STEER] hints on
// ENOENT/EACCES so the LLM switches strategy (try a different binary,
// use write_file/read_file, etc.) instead of looping on the same
// missing command. Closes bugs G (loop-guard kills on python3 ENOENT)
// and H (no auto-detection of missing interpreter).
let _bashSteer: ((input: { command: string; code: string; tool: string }) => string | null) | null = null;
let _bashSteerImportFailed = false;
async function getBashSteer() {
  if (_bashSteer) return _bashSteer;
  try {
    const mod = await import('@/lib/orchestra/steer-service');
    _bashSteer = mod.wireBashErrorSteer;
  } catch (err: any) {
    // One-shot WARN so production logs surface a broken/missing steer-service
    // module instead of silently letting the LLM loop on the same ENOENT.
    if (!_bashSteerImportFailed) {
      _bashSteerImportFailed = true;
      logger.warn('[STEER] bash steer helper unavailable — ENOENT will not emit hints', {
        error: err?.message,
      });
    }
    _bashSteer = null;
  }
  return _bashSteer;
}
import {
  rewriteCommand,
  filterOutput,
  summarizeOutput,
  trackSavings,
  estimateTokens,
  canRewrite,
  getCommandCategory,
  type FilterOptions,
} from '@/lib/context/rtk-integration';

/**
 * Extract the base command from a shell command string. Returns the first
 * whitespace-delimited token, lowercased, or `null` if the input is empty/undefined.
 *
 * Used to identify the executable being run so retry-counter state and
 * missing-binary warnings can be scoped per-command rather than globally.
 *
 * NOTE: This does NOT handle quoted executables like `"my tool"`. If/when that
 * support is added, update this helper and all call sites will follow.
 */
function extractBaseCommand(command: string | undefined): string | null {
  if (!command) return null;
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? null;
}

/**
 * Bug #77 / #83: build a descriptive, actionable error string for a failed
 * bash execution. Many failures (especially sandbox-routed ones) come back
 * with `success: false` but an empty `stderr`, which the chat layer then logs
 * as the opaque "Unknown error". The LLM has nothing to act on, retries the
 * exact same command, and the loop-guard kills the turn after 3 attempts —
 * forcing a manual reprompt. A specific message lets the model self-correct.
 */
function describeBashFailure(result: BashExecutionResult): string {
  const parts: string[] = [];
  const stderr = (result.stderr || '').trim();
  const stdoutTail = (result.stdout || '').trim().split('\n').slice(-5).join('\n').trim();
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1;

  if (stderr) {
    parts.push(stderr);
  } else if (stdoutTail) {
    // Some shells write failure detail to stdout (e.g. `which` prints nothing,
    // build tools print to stdout). Surface the tail so the LLM has context.
    parts.push(stdoutTail);
  }

  // Common, recognizable failure modes get an explicit remediation hint.
  const combined = `${stderr}\n${stdoutTail}`.toLowerCase();
  if (/command not found|not found|no such file|enoent/.test(combined)) {
    const base = extractBaseCommand(result.command) ?? 'the command';
    parts.push(`The interpreter/binary for \`${base}\` may not be installed in this environment. Try a different tool, install it first, or use the VFS file tools (write_file/read_file) instead of shelling out.`);
  } else if (exitCode === 124 || /timed out|timeout/.test(combined)) {
    parts.push('The command timed out. Run a faster/non-interactive variant, or background long-running processes.');
  } else if (parts.length === 0) {
    // Truly empty failure — still give the LLM the exit code and a nudge.
    parts.push(`Command exited with code ${exitCode} and produced no output. The command may have failed to start (missing binary, wrong working directory, or unavailable sandbox). Verify the command and path, or try an alternative approach.`);
  }

  return `Command failed (exit ${exitCode}): ${parts.join(' ')}`.trim();
}

/**
 * Re-export isCommandSafe for external consumers
 */
export function isCommandSafe(command: string): boolean {
  return _isCommandSafe(command);
}

const logger = createLogger('Bash:Tool');

async function getVirtualFilesystem() {
  const mod = await import('@/lib/virtual-filesystem/index.server');
  return mod.virtualFilesystem;
}

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
  /** RTK: Enable command rewriting for token reduction */
  rtkEnableRewrite?: boolean;
  /** RTK: Enable output filtering for token reduction */
  rtkEnableFilter?: boolean;
  /** RTK: Max output lines */
  rtkMaxLines?: number;
  /** RTK: Max output characters */
  rtkMaxChars?: number;
  /** RTK: Track token savings */
  rtkTrackSavings?: boolean;
  /**
   * Maximum wall-clock duration (ms) for which a bash_execute result may be
   * persisted to VFS. Outputs from commands that ran longer than this cap
   * are dropped to prevent the VFS from filling up with multi-MB logs from
   * long-running build/test commands. Default: 30000 (30s).
   *
   * Long-running daemons (nohup, `&`, `pm2 start`, `systemctl start`, …) are
   * never persisted regardless of this cap, since their output streams
   * indefinitely and persisting them would exhaust VFS quota within minutes.
   */
  maxPersistMs?: number;
}

const DEFAULT_CONFIG: BashToolConfig = {
  persistToVFS: true,
  enableSelfHealing: process.env.BASH_SELF_HEALING_ENABLED === 'true',
  maxRetries: 3,
  workingDir: process.env.BASH_WORKING_DIR || '/workspace',
  defaultTimeout: 30000,
  maxPersistMs: parseInt(process.env.BASH_MAX_PERSIST_MS || '30000', 10),
  // RTK settings - enable token reduction by default
  rtkEnableRewrite: process.env.RTK_ENABLE_REWRITE !== 'false',
  rtkEnableFilter: process.env.RTK_ENABLE_FILTER !== 'false',
  rtkMaxLines: parseInt(process.env.RTK_MAX_LINES || '100', 10),
  rtkMaxChars: parseInt(process.env.RTK_MAX_CHARS || '50000', 10),
  rtkTrackSavings: process.env.RTK_TRACK_SAVINGS === 'true',
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
  const base = extractBaseCommand(command) ?? '';
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
  scopePath?: string;
  _isSandboxRoute?: boolean;
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
  hooks.preExecution.splice(0, hooks.preExecution.length);
  hooks.postExecution.splice(0, hooks.postExecution.length);
  hooks.onError.splice(0, hooks.onError.length);
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

    // SECURITY (CRIT-1 fix): Parse command to detect shell metacharacters.
    // If the command contains no chaining/substitution, split into args and use
    // spawn with arg array (no shell interpretation). If shell metacharacters are
    // present, escape all parts and reconstruct for bash -c.
    //
    // This prevents injection like: echo "hello" && rm -rf /
    // where && causes rm to execute unconditionally.
    
    // Detect shell metacharacters and quoting — any of these means we need bash -c
    // for proper shell interpretation (quotes, pipes, redirects, substitution, etc.).
    // Also detect multi-line commands (\n, \r) which require bash -c for heredocs
    // and multi-line scripts.
    const hasShellMetacharacters = /[;&|`()$<>'"\n\r]/.test(command);
    
    let spawnArgs: string[];
    
    if (!hasShellMetacharacters) {
      // Safe path: No shell metacharacters — split into command + args array
      // This avoids bash -c entirely, preventing any shell interpretation
      const parts = command.trim().split(/\s+/);
      const baseCmd = parts[0];
      const cmdArgs = parts.slice(1);
      spawnArgs = [baseCmd, ...cmdArgs];
      logger.debug('Using direct spawn (no shell metacharacters)', { baseCmd, argCount: cmdArgs.length });
    } else {
      // Shell metacharacters present — must use bash -c.
      // The security check (isCommandSafe) is the primary defense: it blocks
      // dangerous metacharacter patterns like &&, ||, $(), backticks, etc.
      // Commands that reach this point have passed the security check,
      // meaning their metacharacters (e.g., pipes for legitimate pipelines)
      // are considered safe.
      spawnArgs = ['-c', command];
      logger.debug('Using bash -c (shell metacharacters detected, passed security check)', { command: command.slice(0, 100) });
    }
    
    return new Promise((resolve, reject) => {
      const proc = spawn(
        hasShellMetacharacters ? 'bash' : spawnArgs[0],
        hasShellMetacharacters ? spawnArgs : spawnArgs.slice(1),
        {
          cwd: workingDir,
          env: safeEnv as NodeJS.ProcessEnv,
          timeout: options.timeout || DEFAULT_CONFIG.defaultTimeout,
          shell: false,
        }
      );

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

        // Bug #39 follow-up: clear the hard-block retry counter for this binary
        // on success, so a transient PATH issue doesn't permanently block it.
        // Pushed into executeBashCommand itself (not just the LLM tool) so ALL
        // bash entry points — direct callers, executeBashViaEvent, etc. —
        // benefit from the "blocked only while broken" recovery.
        // Guard: require BOTH `result.success` AND `exitCode === 0` to avoid
        // over-resetting on signal kills (where spawn's exitCode may be 0 even
        // though the process was killed) or on partial-failure states. Mirrors
        // the LLM tool's postExecution check and the sandbox routing check.
        if (result.success && exitCode === 0) {
          const baseCmd = extractBaseCommand(command);
          if (baseCmd) resetMissingBinaryRetry(baseCmd);
        }

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
 * Patterns indicating a long-running daemon / persistent service.
 * When matched, the command is NEVER persisted to VFS regardless of
 * `maxPersistMs` because its output stream is unbounded and would
 * exhaust VFS quota within minutes.
 */
const DAEMON_PERSIST_PATTERNS: RegExp[] = [
  /\bnohup\b/,
  /&\s*(?:\||&|$)/,              // backgrounded with `&` (followed by pipe, another &, or EOL)
  /\bdisown\b/,
  /\bpm2\s+(start|restart|reload)\b/,
  /\bsystemctl\s+(start|restart|enable)\b/,
  /\bservice\s+\S+\s+(start|restart)\b/,
  /\b(flask|django|uvicorn|gunicorn|fastapi)\s+run\b/,
  /\b(npm|pnpm|yarn)\s+run\s+(dev|start|serve|watch)\b/,
  /\b(next|vite|nuxt|remix|svelte-kit)\s+(dev|start)\b/,
  /\b(docker|podman)\s+(run|start)\b.*--detach/,
  /\b(docker|podman)\s+(run|start)\b.*-[a-zA-Z]*d[a-zA-Z]*\b/,
  /\btail\s+-[a-zA-Z]*f\b/,     // tail -f blocks indefinitely
  /\bwatch\s+/,
  /\bwhile\s+true\b/,
  /\bsleep\s+(\d{3,}|infinity)\b/,
  // `ping` without `-c` (count) runs until interrupted — refuse unconditionally.
  // Common forms: `ping host` is refused; `ping -c 3 host` is fine.
  /\bping\b(?![^\n]*\s-[a-zA-Z]*c\b)/,
];

/**
 * Decide whether a bash command's output should be persisted to VFS.
 *
 * Bug #28: cap persistence to commands that finished within `maxPersistMs`,
 * and never persist long-running daemons. Without this, a single
 * `npm run dev &` or a multi-hour `find /` would silently fill the VFS.
 *
 * Returns `{ persist: boolean, reason?: string }`. When `persist` is false,
 * `reason` is a short code (e.g. 'daemon_detected', 'duration_exceeded_cap')
 * suitable for log/UX surfacing.
 */
export function shouldPersistBashOutput(
  command: string,
  result: Pick<BashExecutionResult, 'duration' | 'success'>,
  config: Pick<BashToolConfig, 'maxPersistMs'>,
): { persist: boolean; reason?: string } {
  if (DAEMON_PERSIST_PATTERNS.some((re) => re.test(command))) {
    return { persist: false, reason: 'daemon_detected' };
  }
  const cap = config.maxPersistMs ?? 30000;
  if (result.duration > cap) {
    return { persist: false, reason: 'duration_exceeded_cap' };
  }
  return { persist: true };
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
    // #10/#18/#25 fix: opt into strictConcurrency so concurrent modifications
    // to the same outputPath are blocked at the VFS layer instead of
    // racing and producing a torn write.
    await (await getVirtualFilesystem()).writeFile(agentId, outputPath, output, undefined, { strictConcurrency: true });

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
    const listing = await (await getVirtualFilesystem()).listDirectory(agentId, workingDir);
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
 * Bug #47 — Sandbox-aware bash routing.
 *
 * Routes bash commands through an available sandbox when one exists.
 * A pre-warmed sandbox pool (SandboxPoolService) maintains ready sandboxes
 * at startup. When bash_execute runs and no sandbox session is mapped to
 * this user, this function acquires a sandbox from the pool and registers
 * it against the user's ID — so subsequent bash_execute calls reuse it.
 *
 * If the sandbox pool is unavailable (not initialized, no provider), falls
 * through to local `child_process.spawn`. The `routed: false` signal tells
 * the caller to proceed with local execution.
 *
 * Lazy-loads sandbox dependencies to keep bash-tool.ts import-light.
 */
async function trySandboxRoute(
  agentId: string,
  command: string,
  workingDir: string,
  timeout?: number,
  signal?: AbortSignal,
): Promise<{
  routed: boolean;
  sandboxId?: string;
  result: BashExecutionResult;
}> {
  try {
    const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
    let session = sandboxBridge.getSessionByUserId(agentId);

    // No existing session — ask sandboxBridge to get or create one.
    // This bridges to the pre-warmed sandbox pool when available.
    if (!session) {
      logger.info('[SandboxRoute] Allocation started', { agentId });
      try {
        // Bound sandbox acquisition separately (15s) so a stuck provider
        // does not block the caller indefinitely. The watchdog timeout is
        // separate from the command execution timeout.
        const createPromise = sandboxBridge.getOrCreateSession(agentId);
        const acquisitionTimeout = 15_000;
        const timedCreate = timeoutPromise(createPromise, acquisitionTimeout,
          'Sandbox acquisition timed out');
        const newSession = await (signal
          ? abortablePromise(timedCreate, signal, 'Sandbox acquisition cancelled')
          : timedCreate);
        if (newSession && newSession.sandboxId) {
          session = newSession;
          logger.info('[SandboxRoute] Session acquired', {
            sandboxId: newSession.sandboxId,
            agentId,
          });
        }
      } catch (createErr: any) {
        logger.warn('[SandboxRoute] Allocation timed out or failed, falling back to local spawn', {
          error: createErr?.message,
          agentId,
        });
      }
    }

    if (!session || !session.sandboxId) {
      return { routed: false, result: { success: false, stdout: '', stderr: '', exitCode: -1, duration: 0, command, workingDir } };
    }

    // Bound sandbox execution using the requested command timeout.
    // Default to 30s if no timeout was provided.
    const execTimeout = timeout ?? 30_000;
    logger.info('[SandboxRoute] Command execution started', {
      sandboxId: session.sandboxId,
      timeout: execTimeout,
    });
    const startTime = Date.now();
    let execResult: any;
    try {
      const execPromise = sandboxBridge.executeCommand(session.sandboxId, command, workingDir, execTimeout);
      execResult = await (signal
        ? abortablePromise(execPromise, signal, 'Sandbox command cancelled')
        : execPromise);
    } catch (execErr: any) {
      const duration = Date.now() - startTime;
      logger.warn('[SandboxRoute] Command timed out or failed', {
        error: execErr?.message,
        duration,
        timeout: execTimeout,
        sandboxId: session.sandboxId,
      });
      return {
        routed: true,
        sandboxId: session.sandboxId,
        result: {
          success: false,
          stdout: '',
          stderr: execErr?.message || 'Sandbox command execution failed',
          exitCode: -1,
          duration,
          command,
          workingDir,
        },
      };
    }
    const duration = Date.now() - startTime;
    // Map sandbox-provider result to BashExecutionResult shape.
    // CRITICAL (review fix): do NOT short-circuit on truthy `success` — some
    // sandbox providers return `{ success: true, exitCode: 1 }` for soft-fail
    // states. Treat `success` as authoritative; fall back to exitCode only
    // when `success` is undefined. Also default missing exitCode to -1 (not 0)
    // so sandbox crashes are not silently masked as success.
    const sx = (execResult as any) ?? {};
    const hasSuccess = typeof sx.success === 'boolean';
    const result: BashExecutionResult = {
      success: hasSuccess ? Boolean(sx.success) : (typeof sx.exitCode === 'number' ? sx.exitCode === 0 : false),
      stdout: typeof sx.stdout === 'string' ? sx.stdout : '',
      stderr: typeof sx.stderr === 'string' ? sx.stderr : '',
      exitCode: typeof sx.exitCode === 'number' ? sx.exitCode : -1,
      duration,
      command,
      workingDir,
    };
    // Bug #39: clear the hard-block retry counter for this binary on success.
    // Guard: require BOTH `result.success` AND `result.exitCode === 0` — the
    // CRIT-1 review note above warns that some sandbox providers return
    // `{ success: true, exitCode: 1 }` for soft-fail states. A bare
    // `result.success` check would over-reset and let a persistently-broken
    // sandbox binary slip through the hard-block. Matches the other 2 sites.
    const baseCmd = extractBaseCommand(command);
    if (result.success && result.exitCode === 0 && baseCmd) {
      resetMissingBinaryRetry(baseCmd);
    }
    return { routed: true, sandboxId: session.sandboxId, result };
  } catch (err: any) {
    logger.debug('[SandboxRoute] sandboxBridge unavailable or executeCommand failed, falling back to local spawn', {
      error: err?.message,
      agentId,
    });
    return { routed: false, result: { success: false, stdout: '', stderr: '', exitCode: -1, duration: 0, command, workingDir } };
  }
}

/**
 * Race a promise against a timeout. Rejects if the timeout fires first.
 */
function timeoutPromise<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Race a promise against an AbortSignal. Rejects if the signal fires first.
 */
function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException(message, 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException(message, 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => { signal.removeEventListener('abort', onAbort); resolve(val); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

/**
 * Create bash tool for LLM
 */
export function createBashTool(config: Partial<BashToolConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    bash_execute: tool({
      description: 'Execute bash commands. Routes to a sandbox environment when one is available (pre-warmed sandbox pool) for full runtime support including node, python3, npx, npm. Use for file operations (create, read, write, delete), navigating directories, running scripts, installing packages, and any shell task. Supports pipes, redirects, multi-line heredocs, and complex pipelines. Output is persisted to VFS.\n\nEXAMPLES:\n  Create files:  echo "content" > file.txt  |  cat > file.txt << EOF  |  mkdir -p src/components\n  Read files:    cat file.txt  |  grep pattern file.txt\n  Navigate:      mkdir -p src/components  |  cd src && pwd\n  Build/Test:    npm install  |  npm test  |  npx tsc --noEmit',
      inputSchema: z.object({
        command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern > output.txt")').optional(),
        code: z.string().describe('Bash command to execute (alias for command)').optional(),
        workingDir: z.string().optional().describe('Working directory. Default is /workspace — you are already there. Only set this if you need a different directory.'),
        persist: z.boolean().optional().default(true).describe('Persist output to VFS'),
        selfHeal: z.boolean().optional().default(cfg.enableSelfHealing).describe('Enable self-healing on failure'),
        timeout: z.number().optional().default(cfg.defaultTimeout).describe('Timeout in milliseconds'),
      }),
      execute: async ({ command, code, workingDir, persist, selfHeal, timeout }, ctx) => {
        // Accept both 'command' and 'code' parameter names - some LLMs use 'code'
        const actualCommand = command || code;
        const agentId = (ctx as any).threadId || 'default';
        const wd = workingDir || cfg.workingDir;

        logger.info('Bash execution requested', {
          command,
          workingDir: wd,
          agentId,
          selfHeal,
        });

        if (!actualCommand) {
          throw new Error('command is required for bash_execute');
        }

        const commandToUse = actualCommand;

        // Bug #47: route through sandboxBridge when an active sandbox session
        // exists for this user. Closes the gap where bash_execute always fell
        // through to local `child_process.spawn`, causing ENOENT for sandbox-
        // specific binaries (npx serve, etc.) and breaking tasks that need a
        // development environment. Falls back to local spawn if no sandbox is
        // active (e.g. dev mode without a sandbox provider configured).
        const sandboxRoute = await trySandboxRoute(agentId, commandToUse, wd, timeout);
        if (sandboxRoute.routed) {
          logger.info('Bug #47: routed bash_execute through sandboxBridge', {
            agentId,
            sandboxId: sandboxRoute.sandboxId,
            command: commandToUse.slice(0, 80),
          });
          if (persist) {
            const decision = shouldPersistBashOutput(actualCommand, sandboxRoute.result, cfg);
            if (decision.persist) {
              const outputPath = await persistToVFS(cfg.persistToVFS, agentId, actualCommand, sandboxRoute.result);
              if (outputPath) sandboxRoute.result.outputPath = outputPath;
            }
          }
          return {
            success: sandboxRoute.result.success,
            output: sandboxRoute.result.stdout,
            // Bug #77/#83: never surface an empty error on failure — the chat
            // layer would log "Unknown error" and the LLM cannot self-correct.
            error: sandboxRoute.result.success
              ? sandboxRoute.result.stderr
              : describeBashFailure(sandboxRoute.result),
            exitCode: sandboxRoute.result.exitCode,
            duration: sandboxRoute.result.duration,
            outputPath: sandboxRoute.result.outputPath,
            _routed: 'sandbox',
          };
        }

        if (!isCommandSafe(commandToUse)) {
          throw new Error(`Command blocked by safety filter: ${commandToUse.slice(0, 100)}`);
        }

        // RTK: Optionally rewrite command for token optimization
        // This transforms verbose commands like `git log` to `git log --oneline -20`
        let rewrittenCommand = commandToUse;
        let rtkCategory: string | null = null;
        if (cfg.rtkEnableRewrite && canRewrite(commandToUse)) {
          rewrittenCommand = rewriteCommand(commandToUse, { enableRewrite: true });
          rtkCategory = getCommandCategory(commandToUse);
          if (rewrittenCommand !== commandToUse) {
            logger.info('RTK: Command rewritten', {
              original: commandToUse,
              rewritten: rewrittenCommand,
              category: rtkCategory,
            });
          }
        }

        // ROUTING: Check if command should be simulated vs sandbox via terminal router
        let routeDecision: { mode: string; reason?: string } | null = null;
        if (cfg.getFilesystemState) {
          try {
            const { routeLLMCommand, executeRoutedCommand } = await import('@/lib/terminal/commands/llm-bash-router');
            routeDecision = routeLLMCommand(commandToUse, {
              getFilesystem: cfg.getFilesystemState,
              onOutput: cfg.onTerminalOutput,
            });
            logger.debug('Command routed', routeDecision);
            
            // Execute based on routing decision
            if (routeDecision.mode === 'simulate') {
              const simOutput = await executeRoutedCommand(routeDecision as any, {
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
          } catch (e: unknown) {
            // Router unavailable - fall through to normal execution
            logger.debug('Command router unavailable', { error: (e as Error).message });
          }
        }

        // PATCH 1: Intercept text editor commands (vim/nano/emacs) — they'd hang the PTY
        // Use commandToUse (which merges 'command' and 'code' params) to support
        // both parameter names — some LLMs send the command as 'code'.
        const editorResult = await handleTextEditorCommand(commandToUse, wd) as any;
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
        const hookCtx: BashHookContext = { command, workingDir: wd, userId: agentId, scopePath: 'workspace' };
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
          const isDirect = isDirectCommand(rewrittenCommand);
          const shouldSelfHeal = selfHeal && cfg.enableSelfHealing && !isDirect;

          if (shouldSelfHeal) {
            result = await executeWithHealing(rewrittenCommand, {
              workingDir: wd,
              maxRetries: cfg.maxRetries,
              timeout,
            });
          } else {
            result = await executeBashCommand(rewrittenCommand, {
              workingDir: wd,
              timeout,
            });
          }

          if (isDirect) {
            logger.debug('Direct command executed (skipped self-healing)', { command });
          }

          // Persist to VFS if requested — but cap the duration and refuse
          // long-running daemons. See shouldPersistBashOutput() for the
          // policy and bug #28.
          if (persist) {
            const decision = shouldPersistBashOutput(actualCommand, result, cfg);
            if (decision.persist) {
              const outputPath = await persistToVFS(cfg.persistToVFS, agentId, actualCommand, result);
              if (outputPath) {
                result.outputPath = outputPath;
              }
            } else {
              logger.warn('Skipped VFS persist for bash output', {
                command: actualCommand.slice(0, 80),
                duration: result.duration,
                maxPersistMs: cfg.maxPersistMs,
                reason: decision.reason,
              });
            }
          }

          // PATCH 2: Trigger postExecution hooks (allows file sync, logging, etc.)
          await triggerHooks('postExecution', { ...hookCtx, result });

          // Bug #39 follow-up: a successful invocation of a binary clears
          // its missing-binary retry counter. Without this, the 2nd-ENOENT
          // hard-block would persist forever (or until process restart) even
          // after the LLM / user fixed the underlying PATH issue. Matches
          // the loop-guard philosophy: "blocked only while broken".
          if (result.success && result.exitCode === 0) {
            const baseCmd = extractBaseCommand(command) ?? '';
            if (baseCmd) {
              resetMissingBinaryRetry(baseCmd);
            }
          }

          // Stream output to terminal callback if provided (for TerminalPanel integration)
        if (cfg.onTerminalOutput && result.stdout) {
          cfg.onTerminalOutput(result.stdout);
        }

        // RTK: Filter output for token reduction
        // Apply ANSI removal, deduplication, truncation, and grouping
        let filteredOutput = result.stdout;
        let rtkStats: { originalTokens: number; filteredTokens: number; savedTokens: number } | undefined;
        
        if (cfg.rtkEnableFilter && result.stdout) {
          const filterOptions: FilterOptions = {
            maxLines: cfg.rtkMaxLines,
            maxChars: cfg.rtkMaxChars,
            groupByFile: true,
            enableDedupe: true,
          };
          filteredOutput = filterOutput(result.stdout, rewrittenCommand, filterOptions);
          
          // Track token savings if enabled
          if (cfg.rtkTrackSavings && filteredOutput !== result.stdout) {
            const origTokens = estimateTokens(result.stdout);
            const filteredTokens = estimateTokens(filteredOutput);
            const savedTokens = origTokens - filteredTokens;
            
            rtkStats = {
              originalTokens: origTokens,
              filteredTokens,
              savedTokens,
            };
            
            logger.info('RTK: Token savings', {
              command: rewrittenCommand,
              category: rtkCategory,
              originalTokens: origTokens,
              filteredTokens,
              savedTokens,
              savingsPercent: Math.round((savedTokens / origTokens) * 100),
            });
          }
        }

          // RTK visibility: prepend a notice when command was rewritten so the
          // LLM caller sees the actual command that was executed, avoiding confusion
          // when `ls -la` silently becomes `ls -F` but output doesn't match expectations.
          let finalOutput = filteredOutput;
          if (rewrittenCommand !== commandToUse && rtkCategory) {
            const rtkHeader = `[RTK: "${commandToUse}" → "${rewrittenCommand}"]\n`;
            finalOutput = rtkHeader + filteredOutput;
          }

          return {
            success: result.success,
            output: finalOutput,
            // Bug #77/#83: never surface an empty error on failure.
            error: result.success ? result.stderr : describeBashFailure(result),
            exitCode: result.exitCode,
            duration: result.duration,
            outputPath: result.outputPath,
            // RTK metadata
            rtkRewritten: rewrittenCommand !== commandToUse ? rewrittenCommand : undefined,
            rtkCategory,
            rtkStats,
          };
        } catch (error: any) {
          // Bug #77/#83: never surface an empty error on failure — the chat
          // layer would log "Unknown error" and the LLM cannot self-correct.
          // When error.message is empty, extract meaningful info from other
          // error fields (stderr, exitCode, code, statusCode, reason) to give
          // the LLM actionable feedback instead of the generic fallback.
          let errorMessage: string;
          if (error.message) {
            errorMessage = error.message;
          } else {
            // Error object has no .message — build from available fields
            const parts: string[] = [];
            if (typeof error.stderr === 'string' && error.stderr.trim()) {
              parts.push(error.stderr.trim());
            }
            if (typeof error.code === 'string' && error.code.trim()) {
              parts.push(`[${error.code}]`);
            }
            if (typeof error.statusCode === 'number' || typeof error.status === 'number') {
              const sc = error.statusCode ?? error.status;
              parts.push(`HTTP ${sc}`);
            }
            if (typeof error.reason === 'string' && error.reason.trim()) {
              parts.push(error.reason.trim());
            }
            if (typeof error.exitCode === 'number' && error.exitCode !== 0) {
              parts.push(`exit code ${error.exitCode}`);
            }
            if (typeof error.signal === 'string') {
              parts.push(`signal ${error.signal}`);
            }
            if (parts.length > 0) {
              errorMessage = `Command failed: ${parts.join(' — ')}`;
            } else {
              // Truly nothing to extract — give the LLM the result keys and a nudge
              const keys = error ? Object.keys(error) : [];
              errorMessage = `Command failed without details` +
                (keys.length > 0 ? ` (available fields: [${keys.join(', ')}])` : '');
            }
          }

          // Bug #39: If the command was blocked by the safety/router layer
          // (routeDecision.mode === 'blocked' or 'confirm'), surface a
          // structured BLOCKED_ENV code so the LLM's upstream logic can
          // distinguish a safety-block from a generic crash. Without this,
          // the LLM sees 'Tool failed Unknown error' and can't tell that
          // the command was refused (not executed). Operators can also
          // surface a banner with the remediation text.
          // Null-guard: routeDecision is only assigned when getFilesystemState
          // is set. If it's null, the command was never routed (default
          // behavior) and we fall through to the env-error handling below.
          if (routeDecision != null && (routeDecision.mode === 'blocked' || routeDecision.mode === 'confirm')) {
            const blockCode = routeDecision.mode === 'blocked' ? 'BLOCKED_ENV' : 'BLOCKED_CONFIRM';
            errorMessage = `[${blockCode}] ${routeDecision.reason || 'Command blocked by safety policy'}. ` +
              `Remediation: use a different command, or use write_file/read_file for file operations.`;
            logger.warn(`[Bash] ${blockCode} — structured denial`, {
              command: commandToUse.slice(0, 100),
              reason: routeDecision.reason,
              code: blockCode,
            });
            return {
              success: false,
              output: '',
              error: errorMessage,
              exitCode: -1,
              duration: 0,
              _routed: routeDecision.mode,
              _blockCode: blockCode,
            };
          }

          // Detect environment-level errors (ENOENT, EACCES, ENOEXEC, ENOSPC, …)
          // and give a clear diagnostic + [STEER] hint so the LLM stops
          // retrying the same missing binary or hitting the same permission
          // wall. Closes bugs G + H (ENOENT loop) and the EACCES gap.
          const ENV_ERROR_RE = /(ENOENT|EACCES|ENOEXEC|ENOSPC|EISDIR|ENOTDIR)\b/;
          const envMatch = errorMessage.match(ENV_ERROR_RE);
          if (envMatch) {
            const envCode = envMatch[1];
            const baseCmd = command.trim().split(/\s+/)[0] || command;

            // Bug #39: 2nd-ENOENT-retry hard-block. Increment the counter for
            // this binary and refuse the 2nd retry with a "use write_file"
            // suggestion. Breaks the "3× same ENOENT → loop-guard kills" cycle.
            const retryCount = incrementMissingBinaryRetry(baseCmd);
            if (envCode === 'ENOENT' && retryCount >= 2) {
              const hardBlock = `Hard-blocked (Bug #39): "${baseCmd}" failed with ENOENT ${retryCount}× in this process. ` +
                `It is not on $PATH. Stop calling bash_execute with "${baseCmd}". ` +
                `Use write_file / read_file / apply_diff for file operations, ` +
                `or use a different binary that IS available (see the "Available Binaries" list in your system prompt).`;
              logger.warn(`[Bug #39] Hard-blocked 2nd ENOENT retry for "${baseCmd}"`, {
                baseCmd,
                retryCount,
                command: command.slice(0, 80),
              });
              // Pass-2 cross-cutting theme: record the hard-block into the
              // per-session degradation chain so run.log shows the silent
              // failure that contributed to the user reprompting.
              try {
                recordDegradation(
                  agentId || 'default',
                  'binary_missing',
                  'bash-tool',
                  { baseCmd, retryCount, kind: 'hard_block' },
                );
              } catch { /* best-effort */ }
              return {
                success: false,
                output: '',
                error: hardBlock,
                exitCode: -1,
                duration: 0,
              };
            }

            const diagnosticMap: Record<string, string> = {
              ENOENT: `Command not found: "${baseCmd}" is not available in this environment. Available tools: use "which <cmd>" to check, or use write_file/read_file for file operations. Do NOT retry "${baseCmd}" — it will keep failing.`,
              EACCES: `Permission denied: "${baseCmd}" is not executable or the target is not writable. Check file permissions with ls -l, or use write_file/read_file for file operations. Do NOT retry with the same path/permissions.`,
              ENOEXEC: `Exec format error: "${baseCmd}" is not a valid executable for this platform. Verify the binary architecture (e.g. file <cmd>) or use a compatible alternative.`,
              ENOSPC: `No space left on device while running "${baseCmd}". Free up disk space (df -h) or persist outputs to a smaller path. Do NOT retry — it will keep failing until space is freed.`,
              EISDIR: `"${baseCmd}" is a directory, not a file. Use ls, cd, or stat to inspect it; do not pass it to commands that expect a file path.`,
              ENOTDIR: `Not a directory: a path component in "${baseCmd}" is not a directory. Verify the path with ls; do not retry with the same path.`,
            };
            const diagnostic = diagnosticMap[envCode] ||
              `Environment error ${envCode} while running "${baseCmd}". Use a different command or fix the underlying issue; do not retry.`;
            // Bug #39: on the FIRST ENOENT for a binary, also include the
            // env probe result so the LLM sees concrete alternatives right
            // at the point of failure (not just the steer hint).
            let envProbeFragment = '';
            if (envCode === 'ENOENT') {
              try {
                const probeList = await formatAvailableBinariesAsync();
                if (probeList) {
                  // Take only the first ~600 chars of the probe list to keep
                  // the error message under budget. The full list is also in
                  // the system prompt.
                  envProbeFragment = `\n\n[ENV PROBE]\n${probeList.length > 600 ? probeList.slice(0, 600) + '\n[... truncated; full list in system prompt ...]' : probeList}`;
                }
              } catch (probeErr: any) {
                logger.debug('Env probe fragment skipped (non-fatal)', { error: probeErr?.message });
              }
            }
            errorMessage = diagnostic + envProbeFragment;
            logger.warn(`${envCode} caught — providing diagnostic`, { command, baseCmd, envCode, retryCount });
            // Pass-2 cross-cutting theme: record the 1st-ENOENT steer so
            // operators can distinguish "user got the hint" (1st event
            // only) from "user hit the 2nd-retry hard-block" (1st event
            // + 2nd hard-block event). sessionId = threadId from the LLM
            // tool context, falling back to agentId/default.
            try {
              recordDegradation(
                agentId || 'default',
                'binary_missing',
                'bash-tool',
                { baseCmd, envCode, retryCount, kind: 'steer' },
              );
            } catch { /* best-effort */ }
            // [STEER] G + H: emit a one-shot corrective hint so the LLM
            // switches strategy (use a different command or fall back to
            // write_file/read_file) instead of looping on the same env error.
            // The hint is APPENDED to the error string so the LLM actually
            // sees it in the next tool result.
            try {
              const steer = await getBashSteer();
              const hint = steer?.({ command, code: envCode, tool: 'bash_execute' });
              if (hint) {
                errorMessage = errorMessage + '\n\n[STEER] ' + hint;
                logger.info(`[STEER] bash ${envCode} — corrective hint appended to error`, { baseCmd, hintLength: hint.length, retryCount });
              }
            } catch (steerErr: any) {
              logger.debug('Steer hint skipped (non-fatal)', { error: steerErr?.message });
            }
          }

          // PATCH 2: Trigger onError hooks
          await triggerHooks('onError', { ...hookCtx, error: errorMessage });

          return {
            success: false,
            output: '',
            error: errorMessage,
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

    // Persist to VFS if requested — capped at maxPersistMs; never persist daemons.
    if (event.persist) {
      const decision = shouldPersistBashOutput(event.command, result, DEFAULT_CONFIG);
      if (decision.persist) {
        const outputPath = await persistToVFS(DEFAULT_CONFIG.persistToVFS, event.agentId, event.command, result);
        if (outputPath) {
          result.outputPath = outputPath;
        }
      } else {
        logger.warn('Skipped VFS persist for bash output (event path)', {
          command: event.command.slice(0, 80),
          duration: result.duration,
          maxPersistMs: DEFAULT_CONFIG.maxPersistMs,
          reason: decision.reason,
        });
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
 * Post-execution: recursively scans the working directory and syncs all
 * changed/new files back to VFS. Replaces the old regex-based
 * extractOutputFiles approach which only captured shell redirects.
 *
 * Catches files created by npm, Python, build tools, generators, and
 * arbitrary subprocesses — not just shell redirect syntax.
 */
export function registerVFSSyncHook(): void {
  registerBashHook('postExecution', async (ctx: BashHookContext & { result?: BashExecutionResult }) => {
    if (!ctx.result) return;
    const ownerId = ctx.userId || 'anonymous';
    const workDir = ctx.workingDir;

    try {
      const vfs = await getVirtualFilesystem();
      const { readdir, stat, readFile } = await import('fs/promises');
      const { join, relative } = await import('path');

      // Recursively walk the working directory and sync all files to VFS.
      // Excludes node_modules, .git, and build output directories.
      const excludeDirs = new Set([
        'node_modules', '.git', '.next', 'dist', 'build', '.cache',
        '__pycache__', '.venv', 'venv', '.tox', 'target',
      ]);
      const excludeFiles = new Set(['pnpm-lock.yaml', 'package-lock.json', '.gitignore']);

      async function walkDir(dir: string): Promise<void> {
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          let entryStat: any;
          try {
            entryStat = await stat(fullPath);
          } catch {
            continue;
          }
          if (entryStat.isDirectory()) {
            if (!excludeDirs.has(entry)) {
              await walkDir(fullPath);
            }
            continue;
          }
          if (excludeFiles.has(entry)) continue;
          const relativePath = relative(workDir, fullPath);
          const scopePath = ctx.scopePath || 'workspace';
          const vfsPath = `${scopePath}/${relativePath}`;

          try {
            const content = await readFile(fullPath, 'utf8');
            await vfs.writeFile(ownerId, vfsPath, content, 'text/plain', {
              failIfExists: false,
              strictConcurrency: true,
            });
          } catch (fileErr: any) {
            logger.debug('[VFS Sync] Failed to sync file', {
              path: relativePath,
              error: fileErr?.message,
            });
          }
        }
      }

      await walkDir(workDir);
      logger.debug('[VFS Sync] Post-execution recursive sync complete', {
        ownerId,
        workDir,
      });
    } catch (err: any) {
      logger.debug('[VFS Sync] Post-execution sync failed', {
        error: err?.message,
      });
    }
  });
}


