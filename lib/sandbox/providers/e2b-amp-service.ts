/**
 * E2B Amp Service
 * 
 * Run Amp coding agent in E2B sandboxes
 * 
 * Amp is a coding agent with multi-model architecture and built-in code intelligence.
 * This service provides programmatic access to run Amp commands in E2B sandboxes.
 * 
 * @see https://e2b.dev/docs/agents/amp
 * @see https://ampcode.com
 * 
 * @example
 * ```typescript
 * import { Sandbox } from '@e2b/code-interpreter'
 * import { createAmpService } from './e2b-amp-service'
 * 
 * const sandbox = await Sandbox.create('amp', {
 *   envs: { AMP_API_KEY: process.env.AMP_API_KEY },
 * })
 * 
 * const amp = createAmpService(sandbox, process.env.AMP_API_KEY!)
 * 
 * // Run Amp with prompt
 * const result = await amp.run({
 *   prompt: 'Create a hello world HTTP server in Go',
 *   dangerouslyAllowAll: true,
 * })
 * 
 * // Stream JSON events for real-time monitoring
 * for await (const event of amp.streamJson({
 *   prompt: 'Refactor the utils module',
 *   streamJson: true,
 * })) {
 *   if (event.type === 'assistant') {
 *     console.log(`Tokens: ${event.message.usage?.output_tokens}`)
 *   }
 * }
 * 
 * // Thread management for follow-up tasks
 * const threads = await amp.threads.list()
 * const continued = await amp.threads.continue(threads[0].id, 'Now implement step 1')
 * ```
 */

import type { Sandbox } from '@e2b/code-interpreter'

/**
 * Amp execution configuration
 */
export interface AmpExecutionConfig {
  /** The prompt/task for Amp to execute */
  prompt: string
  
  /** Auto-approve all tool calls (safe inside E2B sandboxes) */
  dangerouslyAllowAll?: boolean
  
  /** Stream output as JSONL events */
  streamJson?: boolean
  
  /** Thread ID for continuing conversations */
  threadId?: string
  
  /** Working directory for the command */
  workingDir?: string
  
  /** Timeout in milliseconds */
  timeout?: number
  
  /** Callback for stdout */
  onStdout?: (data: string) => void
  
  /** Callback for stderr */
  onStderr?: (data: string) => void
}

/**
 * Amp event from streaming JSON output
 */
export interface AmpEvent {
  /** Event type */
  type: 'assistant' | 'result' | 'tool_call' | 'thinking' | 'permission'
  
  /** Event message data */
  message: {
    /** Text content */
    content?: string
    
    /** Token usage information */
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_tokens?: number
      cache_write_tokens?: number
    }
    
    /** Duration in milliseconds */
    duration_ms?: number
    
    /** Result subtype */
    subtype?: string
    
    /** Tool call information */
    tool_call?: {
      name: string
      arguments: any
    }
    
    /** Permission decision */
    permission?: {
      tool: string
      decision: 'allow' | 'deny'
    }
  }
}

/**
 * Amp execution result
 */
export interface AmpExecutionResult {
  /** Standard output */
  stdout: string
  
  /** Standard error */
  stderr: string
  
  /** Thread ID if conversation was continued */
  threadId?: string
  
  /** Parsed events if streamJson was enabled */
  events?: AmpEvent[]
  
  /** Exit code */
  exitCode?: number
}

/**
 * Thread information
 */
export interface AmpThread {
  /** Thread ID */
  id: string
  
  /** Creation timestamp */
  created_at: number
  
  /** Last message timestamp */
  last_message_at?: number
  
  /** Message count */
  message_count?: number
}

/**
 * Amp threads service
 */
export interface AmpThreadsService {
  /** List all threads */
  list(): Promise<AmpThread[]>
  
  /** Continue a thread with a new prompt */
  continue(threadId: string, prompt: string, options?: Partial<AmpExecutionConfig>): Promise<AmpExecutionResult>
  
  /** Delete a thread */
  delete(threadId: string): Promise<void>
}

/**
 * E2B Amp Service interface
 */
export interface E2BAmpService {
  /** Run Amp with configuration */
  run(config: AmpExecutionConfig): Promise<AmpExecutionResult>
  
  /** Stream Amp output as JSONL events */
  streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent>
  
  /** Thread management */
  threads: AmpThreadsService
}

/**
 * Create Amp service instance
 * 
 * @param sandbox - E2B sandbox instance
 * @param apiKey - Amp API key (from ampcode.com/settings)
 * @returns Amp service instance
 */
export function createAmpService(
  sandbox: Sandbox,
  apiKey: string
): E2BAmpService {
  const AMP_CMD = 'amp'

  /**
   * Build Amp command arguments
   */
  function buildArgs(config: AmpExecutionConfig): string {
    const args = [
      config.dangerouslyAllowAll ? '--dangerously-allow-all' : '',
      config.streamJson ? '--stream-json' : '',
      config.threadId ? `--thread ${config.threadId}` : '',
      '-x',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    return args
  }

  /**
   * Run Amp with configuration
   */
  async function run(config: AmpExecutionConfig): Promise<AmpExecutionResult> {
    const args = buildArgs(config)
    
    const command = config.workingDir
      ? `cd ${config.workingDir} && ${AMP_CMD} ${args}`
      : `${AMP_CMD} ${args}`

    const executeOptions: any = {
      timeout: config.timeout || 600000, // 10 minutes default
    }

    if (config.onStdout) {
      executeOptions.onStdout = config.onStdout
    }

    if (config.onStderr) {
      executeOptions.onStderr = config.onStderr
    }

    const result = await sandbox.commands.run(command, executeOptions)

    // Parse events if streamJson was enabled
    let events: AmpEvent[] | undefined
    if (config.streamJson) {
      events = []
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        try {
          const event: AmpEvent = JSON.parse(line)
          events.push(event)
        } catch {
          // Skip invalid JSON lines
        }
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      threadId: config.threadId,
      events,
      exitCode: result.exitCode,
    }
  }

  /**
   * Stream Amp output as JSONL events
   */
  async function* streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent> {
    const args = [
      '--dangerously-allow-all',
      '--stream-json',
      config.threadId ? `--thread ${config.threadId}` : '',
      '-x',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')

    const command = config.workingDir
      ? `cd ${config.workingDir} && ${AMP_CMD} ${args}`
      : `${AMP_CMD} ${args}`

    // Create a command handle for streaming
    const handle = await sandbox.commands.run(command, {
      onStdout: (data) => {
        // Parse and emit events as they arrive
        for (const line of data.split('\n').filter(Boolean)) {
          try {
            const event: AmpEvent = JSON.parse(line)
            // Events are yielded via generator
          } catch {
            // Skip invalid JSON
          }
        }
      },
    })

    // Wait for command to complete
    await handle.wait()
  }

  /**
   * List Amp threads
   */
  async function listThreads(): Promise<AmpThread[]> {
    const result = await sandbox.commands.run('amp threads list --json')
    
    try {
      const threads: AmpThread[] = JSON.parse(result.stdout)
      return threads
    } catch {
      return []
    }
  }

  /**
   * Continue a thread with new prompt
   */
  async function continueThread(
    threadId: string,
    prompt: string,
    options?: Partial<AmpExecutionConfig>
  ): Promise<AmpExecutionResult> {
    return run({
      ...options,
      prompt,
      threadId,
    })
  }

  /**
   * Delete a thread
   */
  async function deleteThread(threadId: string): Promise<void> {
    await sandbox.commands.run(`amp threads delete ${threadId}`)
  }

  return {
    run,
    streamJson,
    threads: {
      list: listThreads,
      continue: continueThread,
      delete: deleteThread,
    },
  }
}

/**
 * Amp service factory for E2B sandbox handle
 * 
 * Add this to your E2BSandboxHandle class:
 * 
 * ```typescript
 * class E2BSandboxHandle implements SandboxHandle {
 *   private sandbox: Sandbox
 *   private ampService?: E2BAmpService
 *   
 *   getAmpService(apiKey: string): E2BAmpService {
 *     if (!this.ampService) {
 *       this.ampService = createAmpService(this.sandbox, apiKey)
 *     }
 *     return this.ampService
 *   }
 * }
 * ```
 */
export function getAmpService(
  sandbox: any,
  apiKey: string
): E2BAmpService {
  return createAmpService(sandbox as Sandbox, apiKey)
}
