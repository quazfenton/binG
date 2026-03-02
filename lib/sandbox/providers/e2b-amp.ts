/**
 * E2B Amp Template Support
 *
 * Provides integration with Amp coding agent template.
 * Amp is a coding agent with multi-model architecture and built-in code intelligence.
 *
 * Features:
 * - Amp template creation
 * - Headless Amp execution
 * - Streaming JSON event parsing
 * - Thread management
 * - Git integration
 *
 * @see https://e2b.dev/docs/agents/amp
 * @see docs/sdk/e2b-llms-full.txt
 */

import type { SandboxHandle } from './sandbox-provider';

/**
 * Amp configuration options
 */
export interface AmpConfig {
  /** Amp API key from ampcode.com/settings */
  apiKey: string;
  /** Working directory for Amp */
  cwd?: string;
  /** Enable streaming JSON events */
  streamJson?: boolean;
  /** Auto-approve all tool calls (safe inside sandboxes) */
  dangerouslyAllowAll?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Amp event types from streaming JSON
 */
export type AmpEventType = 'assistant' | 'user' | 'result' | 'tool' | 'thinking' | 'permission';

/**
 * Amp streaming event
 */
export interface AmpStreamEvent {
  type: AmpEventType;
  message?: {
    content?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
    subtype?: string;
    duration_ms?: number;
  };
  tool?: {
    name: string;
    input?: any;
    output?: any;
  };
  timestamp: number;
}

/**
 * Amp thread information
 */
export interface AmpThread {
  id: string;
  created_at: number;
  last_message_at: number;
  message_count: number;
}

/**
 * Amp execution result
 */
export interface AmpExecutionResult {
  success: boolean;
  output: string;
  events?: AmpStreamEvent[];
  threadId?: string;
  duration: number;
  error?: string;
}

/**
 * Run Amp in a sandbox
 *
 * @param sandbox - Sandbox handle
 * @param config - Amp configuration
 * @param prompt - Prompt to execute
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const result = await runAmp(sandbox, {
 *   apiKey: process.env.AMP_API_KEY,
 *   streamJson: true,
 * }, 'Create a hello world HTTP server in Go');
 * ```
 */
export async function runAmp(
  sandbox: SandboxHandle,
  config: AmpConfig,
  prompt: string
): Promise<AmpExecutionResult> {
  const startTime = Date.now();
  const cwd = config.cwd || '/home/user';
  const events: AmpStreamEvent[] = [];

  try {
    // Build Amp command
    const ampCmd = buildAmpCommand(prompt, config);

    // Execute with streaming if enabled
    if (config.streamJson) {
      const result = await executeAmpWithStreaming(sandbox, ampCmd, cwd, events);
      return {
        success: true,
        output: result.output,
        events,
        duration: Date.now() - startTime,
      };
    } else {
      const result = await sandbox.executeCommand(ampCmd, cwd, config.timeout);
      return {
        success: result.success,
        output: result.output || '',
        duration: Date.now() - startTime,
        error: result.success ? undefined : result.output,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      output: '',
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Run Amp on a cloned repository
 *
 * @param sandbox - Sandbox handle
 * @param config - Amp configuration
 * @param repoUrl - Repository URL to clone
 * @param prompt - Prompt to execute
 * @param options - Git clone options
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const result = await runAmpOnRepo(sandbox, {
 *   apiKey: process.env.AMP_API_KEY,
 *   cwd: '/home/user/repo',
 * }, 'https://github.com/user/repo.git', 'Add error handling to all API endpoints');
 * ```
 */
export async function runAmpOnRepo(
  sandbox: SandboxHandle,
  config: AmpConfig,
  repoUrl: string,
  prompt: string,
  options: {
    path?: string;
    username?: string;
    password?: string;
    depth?: number;
  } = {}
): Promise<AmpExecutionResult> {
  const startTime = Date.now();
  const cwd = config.cwd || '/home/user';
  const repoPath = options.path || `${cwd}/repo`;
  const events: AmpStreamEvent[] = [];

  try {
    // Clone repository
    const cloneCmd = buildGitCloneCommand(repoUrl, repoPath, options);
    const cloneResult = await sandbox.executeCommand(cloneCmd, cwd);

    if (!cloneResult.success) {
      return {
        success: false,
        output: '',
        duration: Date.now() - startTime,
        error: `Failed to clone repository: ${cloneResult.output}`,
      };
    }

    // Build Amp command with cd
    const ampCmd = buildAmpCommand(prompt, { ...config, cwd: repoPath });

    // Execute Amp
    if (config.streamJson) {
      const result = await executeAmpWithStreaming(sandbox, ampCmd, repoPath, events);
      return {
        success: true,
        output: result.output,
        events,
        duration: Date.now() - startTime,
      };
    } else {
      const result = await sandbox.executeCommand(ampCmd, repoPath, config.timeout);
      return {
        success: result.success,
        output: result.output || '',
        duration: Date.now() - startTime,
        error: result.success ? undefined : result.output,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      output: '',
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * List Amp threads in a sandbox
 *
 * @param sandbox - Sandbox handle
 * @param cwd - Working directory (default: /home/user)
 * @returns Array of threads
 *
 * @example
 * ```typescript
 * const threads = await listAmpThreads(sandbox);
 * const latestThread = threads[0];
 * ```
 */
export async function listAmpThreads(
  sandbox: SandboxHandle,
  cwd: string = '/home/user'
): Promise<AmpThread[]> {
  try {
    const result = await sandbox.executeCommand(
      'amp threads list --json',
      cwd
    );

    if (!result.success) {
      return [];
    }

    const threads = JSON.parse(result.output || '[]');
    return threads.map((t: any) => ({
      id: t.id,
      created_at: new Date(t.created_at).getTime(),
      last_message_at: new Date(t.last_message_at).getTime(),
      message_count: t.message_count,
    }));
  } catch (error) {
    console.error('[E2B Amp] Failed to list threads:', error);
    return [];
  }
}

/**
 * Continue an Amp thread with a follow-up task
 *
 * @param sandbox - Sandbox handle
 * @param config - Amp configuration
 * @param threadId - Thread ID to continue
 * @param prompt - Follow-up prompt
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const threads = await listAmpThreads(sandbox);
 * const result = await continueAmpThread(sandbox, {
 *   apiKey: process.env.AMP_API_KEY,
 * }, threads[0].id, 'Now implement step 1 of the plan');
 * ```
 */
export async function continueAmpThread(
  sandbox: SandboxHandle,
  config: AmpConfig,
  threadId: string,
  prompt: string
): Promise<AmpExecutionResult> {
  const startTime = Date.now();
  const cwd = config.cwd || '/home/user';
  const events: AmpStreamEvent[] = [];

  try {
    // Build Amp continue command
    const ampCmd = buildAmpContinueCommand(threadId, prompt, config);

    // Execute with streaming if enabled
    if (config.streamJson) {
      const result = await executeAmpWithStreaming(sandbox, ampCmd, cwd, events);
      return {
        success: true,
        output: result.output,
        events,
        threadId,
        duration: Date.now() - startTime,
      };
    } else {
      const result = await sandbox.executeCommand(ampCmd, cwd, config.timeout);
      return {
        success: result.success,
        output: result.output || '',
        threadId,
        duration: Date.now() - startTime,
        error: result.success ? undefined : result.output,
      };
    }
  } catch (error: any) {
    return {
      success: false,
      output: '',
      threadId,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Get diff from Amp execution
 *
 * @param sandbox - Sandbox handle
 * @param cwd - Working directory
 * @returns Git diff output
 */
export async function getAmpDiff(
  sandbox: SandboxHandle,
  cwd: string = '/home/user'
): Promise<string> {
  try {
    const result = await sandbox.executeCommand('git diff', cwd);
    return result.output || '';
  } catch (error) {
    console.error('[E2B Amp] Failed to get diff:', error);
    return '';
  }
}

/**
 * Build Amp command from configuration
 */
function buildAmpCommand(prompt: string, config: AmpConfig): string {
  const flags: string[] = [];

  if (config.dangerouslyAllowAll !== false) {
    flags.push('--dangerously-allow-all');
  }

  if (config.streamJson) {
    flags.push('--stream-json');
  }

  flags.push('-x'); // Non-interactive mode

  const ampCmd = `amp ${flags.join(' ')} "${escapePrompt(prompt)}"`;

  return ampCmd;
}

/**
 * Build Amp continue command for thread continuation
 */
function buildAmpContinueCommand(threadId: string, prompt: string, config: AmpConfig): string {
  const flags: string[] = [];

  if (config.dangerouslyAllowAll !== false) {
    flags.push('--dangerously-allow-all');
  }

  if (config.streamJson) {
    flags.push('--stream-json');
  }

  flags.push('-x'); // Non-interactive mode

  const ampCmd = `amp threads continue ${threadId} ${flags.join(' ')} "${escapePrompt(prompt)}"`;

  return ampCmd;
}

/**
 * Build git clone command
 */
function buildGitCloneCommand(
  repoUrl: string,
  path: string,
  options: { username?: string; password?: string; depth?: number }
): string {
  const flags: string[] = [];

  if (options.depth) {
    flags.push(`--depth ${options.depth}`);
  }

  let url = repoUrl;
  if (options.username && options.password) {
    // Handle GitHub token auth
    if (repoUrl.includes('github.com')) {
      url = `https://${options.username}:${options.password}@${repoUrl.replace('https://', '')}`;
    }
  }

  return `git clone ${flags.join(' ')} ${url} ${path}`;
}

/**
 * Execute Amp with streaming JSON event parsing
 */
async function executeAmpWithStreaming(
  sandbox: SandboxHandle,
  command: string,
  cwd: string,
  events: AmpStreamEvent[]
): Promise<{ output: string }> {
  let output = '';

  // Execute command with stdout handler
  const result = await sandbox.executeCommand(command, cwd);

  if (result.output) {
    output = result.output;

    // Parse JSONL events
    const lines = result.output.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type) {
          events.push({
            ...event,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        // Not a JSON line, skip
      }
    }
  }

  return { output };
}

/**
 * Escape prompt for shell execution
 */
function escapePrompt(prompt: string): string {
  return prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

/**
 * Create Amp sandbox with pre-configured template
 *
 * @param provider - E2B provider instance
 * @param config - Amp configuration
 * @returns Sandbox handle
 *
 * @deprecated Use runAmp() with existing sandbox instead
 */
export async function createAmpSandbox(
  provider: any,
  config: AmpConfig
): Promise<SandboxHandle> {
  // Create sandbox with 'amp' template
  const sandbox = await provider.createSandbox({
    language: 'amp',
    envVars: {
      AMP_API_KEY: config.apiKey,
    },
  });

  return sandbox;
}
