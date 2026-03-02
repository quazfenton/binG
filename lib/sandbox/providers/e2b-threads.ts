/**
 * E2B Thread Management
 *
 * Provides conversation persistence and thread management for E2B agents.
 * Threads persist conversations across sessions, enabling multi-turn interactions.
 *
 * Features:
 * - Thread listing
 * - Thread continuation
 * - Thread deletion
 * - Message history retrieval
 *
 * @see https://e2b.dev/docs/agents/amp#thread-management
 * @see docs/sdk/e2b-llms-full.txt
 */

import type { SandboxHandle } from './sandbox-provider';

/**
 * Thread information
 */
export interface ThreadInfo {
  /** Unique thread identifier */
  id: string;
  /** Thread creation timestamp */
  createdAt: number;
  /** Last message timestamp */
  lastMessageAt: number;
  /** Number of messages in thread */
  messageCount: number;
  /** Agent type (amp, claude, etc.) */
  agent?: string;
}

/**
 * Message in a thread
 */
export interface ThreadMessage {
  /** Message ID */
  id: string;
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: string;
  /** Message timestamp */
  timestamp: number;
  /** Tool calls if any */
  toolCalls?: Array<{
    name: string;
    input: any;
    output?: any;
  }>;
}

/**
 * List all threads for an agent
 *
 * @param sandbox - Sandbox handle
 * @param agent - Agent type ('amp', 'claude', etc.)
 * @param cwd - Working directory
 * @returns Array of thread information
 *
 * @example
 * ```typescript
 * const threads = await listThreads(sandbox, 'amp');
 * const latestThread = threads[0];
 * ```
 */
export async function listThreads(
  sandbox: SandboxHandle,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<ThreadInfo[]> {
  try {
    let command: string;

    switch (agent) {
      case 'amp':
        command = 'amp threads list --json';
        break;
      case 'claude':
        command = 'claude threads list --json';
        break;
      default:
        console.warn(`[E2B Threads] Unknown agent: ${agent}`);
        return [];
    }

    const result = await sandbox.executeCommand(command, cwd);

    if (!result.success) {
      return [];
    }

    const threads = JSON.parse(result.output || '[]');
    return threads.map((t: any) => ({
      id: t.id,
      createdAt: new Date(t.created_at).getTime(),
      lastMessageAt: new Date(t.last_message_at || t.created_at).getTime(),
      messageCount: t.message_count,
      agent,
    }));
  } catch (error) {
    console.error('[E2B Threads] Failed to list threads:', error);
    return [];
  }
}

/**
 * Get detailed information about a specific thread
 *
 * @param sandbox - Sandbox handle
 * @param threadId - Thread ID
 * @param agent - Agent type
 * @param cwd - Working directory
 * @returns Thread information or null if not found
 *
 * @example
 * ```typescript
 * const thread = await getThread(sandbox, 'thread_123', 'amp');
 * if (thread) {
 *   console.log(`Thread has ${thread.messageCount} messages`);
 * }
 * ```
 */
export async function getThread(
  sandbox: SandboxHandle,
  threadId: string,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<ThreadInfo | null> {
  try {
    const threads = await listThreads(sandbox, agent, cwd);
    return threads.find(t => t.id === threadId) || null;
  } catch (error) {
    console.error('[E2B Threads] Failed to get thread:', error);
    return null;
  }
}

/**
 * Get messages from a thread
 *
 * @param sandbox - Sandbox handle
 * @param threadId - Thread ID
 * @param agent - Agent type
 * @param cwd - Working directory
 * @returns Array of messages
 *
 * @example
 * ```typescript
 * const messages = await getThreadMessages(sandbox, 'thread_123', 'amp');
 * for (const msg of messages) {
 *   console.log(`${msg.role}: ${msg.content}`);
 * }
 * ```
 */
export async function getThreadMessages(
  sandbox: SandboxHandle,
  threadId: string,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<ThreadMessage[]> {
  try {
    let command: string;

    switch (agent) {
      case 'amp':
        command = `amp threads show ${threadId} --json`;
        break;
      case 'claude':
        command = `claude threads show ${threadId} --json`;
        break;
      default:
        console.warn(`[E2B Threads] Unknown agent: ${agent}`);
        return [];
    }

    const result = await sandbox.executeCommand(command, cwd);

    if (!result.success) {
      return [];
    }

    const thread = JSON.parse(result.output || '{}');
    const messages = thread.messages || [];

    return messages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.timestamp || m.created_at).getTime(),
      toolCalls: m.tool_calls?.map((tc: any) => ({
        name: tc.name,
        input: tc.input,
        output: tc.output,
      })),
    }));
  } catch (error) {
    console.error('[E2B Threads] Failed to get messages:', error);
    return [];
  }
}

/**
 * Continue a thread with a new message
 *
 * @param sandbox - Sandbox handle
 * @param threadId - Thread ID to continue
 * @param message - Message to send
 * @param agent - Agent type
 * @param options - Continue options
 * @returns Execution result
 *
 * @example
 * ```typescript
 * const result = await continueThread(sandbox, 'thread_123', 'Now implement step 1', 'amp', {
 *   streamJson: true,
 *   dangerouslyAllowAll: true,
 * });
 * ```
 */
export async function continueThread(
  sandbox: SandboxHandle,
  threadId: string,
  message: string,
  agent: string = 'amp',
  options: {
    streamJson?: boolean;
    dangerouslyAllowAll?: boolean;
    timeout?: number;
    cwd?: string;
  } = {}
): Promise<{
  success: boolean;
  output: string;
  threadId: string;
  duration: number;
  error?: string;
}> {
  const startTime = Date.now();
  const cwd = options.cwd || '/home/user';

  try {
    let command: string;
    const flags: string[] = [];

    if (options.dangerouslyAllowAll !== false) {
      flags.push('--dangerously-allow-all');
    }

    if (options.streamJson) {
      flags.push('--stream-json');
    }

    flags.push('-x'); // Non-interactive mode

    switch (agent) {
      case 'amp':
        command = `amp threads continue ${threadId} ${flags.join(' ')} "${escapeMessage(message)}"`;
        break;
      case 'claude':
        command = `claude threads continue ${threadId} ${flags.join(' ')} "${escapeMessage(message)}"`;
        break;
      default:
        return {
          success: false,
          output: '',
          threadId,
          duration: Date.now() - startTime,
          error: `Unknown agent: ${agent}`,
        };
    }

    const result = await sandbox.executeCommand(command, cwd, options.timeout);

    return {
      success: result.success,
      output: result.output || '',
      threadId,
      duration: Date.now() - startTime,
      error: result.success ? undefined : result.output,
    };
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
 * Delete a thread
 *
 * @param sandbox - Sandbox handle
 * @param threadId - Thread ID to delete
 * @param agent - Agent type
 * @param cwd - Working directory
 * @returns True if deleted successfully
 *
 * @example
 * ```typescript
 * const deleted = await deleteThread(sandbox, 'thread_123', 'amp');
 * if (deleted) {
 *   console.log('Thread deleted successfully');
 * }
 * ```
 */
export async function deleteThread(
  sandbox: SandboxHandle,
  threadId: string,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<boolean> {
  try {
    let command: string;

    switch (agent) {
      case 'amp':
        command = `amp threads delete ${threadId}`;
        break;
      case 'claude':
        command = `claude threads delete ${threadId}`;
        break;
      default:
        console.warn(`[E2B Threads] Unknown agent: ${agent}`);
        return false;
    }

    const result = await sandbox.executeCommand(command, cwd);
    return result.success;
  } catch (error) {
    console.error('[E2B Threads] Failed to delete thread:', error);
    return false;
  }
}

/**
 * Create a new thread by starting a fresh conversation
 *
 * @param sandbox - Sandbox handle
 * @param message - Initial message
 * @param agent - Agent type
 * @param options - Thread creation options
 * @returns Thread ID and execution result
 *
 * @example
 * ```typescript
 * const { threadId, result } = await createThread(sandbox, 'Analyze this codebase', 'amp');
 * ```
 */
export async function createThread(
  sandbox: SandboxHandle,
  message: string,
  agent: string = 'amp',
  options: {
    streamJson?: boolean;
    dangerouslyAllowAll?: boolean;
    timeout?: number;
    cwd?: string;
  } = {}
): Promise<{
  threadId: string | null;
  result: {
    success: boolean;
    output: string;
    duration: number;
    error?: string;
  };
}> {
  const startTime = Date.now();
  const cwd = options.cwd || '/home/user';

  try {
    let command: string;
    const flags: string[] = [];

    if (options.dangerouslyAllowAll !== false) {
      flags.push('--dangerously-allow-all');
    }

    if (options.streamJson) {
      flags.push('--stream-json');
    }

    flags.push('-x'); // Non-interactive mode

    switch (agent) {
      case 'amp':
        command = `amp ${flags.join(' ')} "${escapeMessage(message)}"`;
        break;
      case 'claude':
        command = `claude ${flags.join(' ')} "${escapeMessage(message)}"`;
        break;
      default:
        return {
          threadId: null,
          result: {
            success: false,
            output: '',
            duration: Date.now() - startTime,
            error: `Unknown agent: ${agent}`,
          },
        };
    }

    const result = await sandbox.executeCommand(command, cwd, options.timeout);

    // Extract thread ID from output if available
    let threadId: string | null = null;
    if (result.output) {
      const threadIdMatch = result.output.match(/Thread ID: (\w+)/);
      if (threadIdMatch) {
        threadId = threadIdMatch[1];
      }
    }

    return {
      threadId,
      result: {
        success: result.success,
        output: result.output || '',
        duration: Date.now() - startTime,
        error: result.success ? undefined : result.output,
      },
    };
  } catch (error: any) {
    return {
      threadId: null,
      result: {
        success: false,
        output: '',
        duration: Date.now() - startTime,
        error: error.message,
      },
    };
  }
}

/**
 * Escape message for shell execution
 */
function escapeMessage(message: string): string {
  return message.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, ' ');
}

/**
 * Get the latest thread for an agent
 *
 * @param sandbox - Sandbox handle
 * @param agent - Agent type
 * @param cwd - Working directory
 * @returns Latest thread or null if no threads exist
 */
export async function getLatestThread(
  sandbox: SandboxHandle,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<ThreadInfo | null> {
  const threads = await listThreads(sandbox, agent, cwd);

  if (threads.length === 0) {
    return null;
  }

  // Sort by last message time and return the most recent
  threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  return threads[0];
}

/**
 * Export thread to JSON
 *
 * @param sandbox - Sandbox handle
 * @param threadId - Thread ID
 * @param agent - Agent type
 * @param cwd - Working directory
 * @returns Thread data as JSON object
 */
export async function exportThread(
  sandbox: SandboxHandle,
  threadId: string,
  agent: string = 'amp',
  cwd: string = '/home/user'
): Promise<any> {
  const messages = await getThreadMessages(sandbox, threadId, agent, cwd);
  const thread = await getThread(sandbox, threadId, agent, cwd);

  return {
    thread,
    messages,
    exportedAt: new Date().toISOString(),
  };
}
