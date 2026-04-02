/**
 * TerminalUse Agent Service
 *
 * Run AI agents on TerminalUse with persistent filesystems and state management.
 * TerminalUse provides:
 * - Persistent filesystems across task executions
 * - Task/event streaming for real-time interaction
 * - State management for agent memory
 * - Agent-to-Client Protocol (ACP) for task creation
 *
 * @see https://docs.terminaluse.com/
 * @see https://docs.terminaluse.com/api-reference/adk
 *
 * @example
 * ```typescript
 * import { TerminalUseProvider } from './terminaluse-provider'
 * import { createTerminalUseAgentService } from './terminaluse-agent-service'
 *
 * const provider = new TerminalUseProvider()
 * const handle = await provider.createSandbox({
 *   envVars: {
 *     OPENAI_API_KEY: process.env.OPENAI_API_KEY,
 *   },
 * })
 *
 * const agentService = createTerminalUseAgentService(handle)
 *
 * // Run agent with prompt
 * const result = await agentService.run({
 *   agent_name: 'my-namespace/my-agent',
 *   prompt: 'Refactor the codebase to use TypeScript',
 *   streamEvents: true,
 * })
 *
 * // Stream events for real-time monitoring
 * for await (const event of agentService.streamEvents({
 *   agent_name: 'my-namespace/my-agent',
 *   prompt: 'Add error handling to the API',
 * })) {
 *   console.log('Event:', event)
 * }
 *
 * // Continue conversation with thread
 * const continued = await agentService.continue(result.taskId, 'Now add tests')
 *
 * // Access persistent state
 * const state = await agentService.getState(result.taskId)
 * console.log('Agent state:', state)
 * ```
 */

import type { TerminalUseSandboxHandle, TerminalUseTask, TerminalUseEvent, TerminalUseState } from '../providers/terminaluse-provider'

/**
 * Agent execution configuration
 */
export interface TerminalUseAgentConfig {
  /** Agent name in format namespace/agent */
  agent_name?: string

  /** The prompt/task for the agent to execute */
  prompt: string

  /** Branch to use (default: main) */
  branch?: string

  /** Additional parameters for the agent */
  params?: Record<string, unknown>

  /** Timeout in milliseconds */
  timeout?: number

  /** Stream events in real-time */
  streamEvents?: boolean

  /** Callback for stdout (streaming) */
  onStdout?: (data: string) => void

  /** Callback for stderr */
  onStderr?: (data: string) => void

  /** Callback for events (when streaming) */
  onEvent?: (event: TerminalUseEvent) => void
}

/**
 * Agent execution result
 */
export interface TerminalUseAgentResult {
  /** Task ID */
  taskId: string

  /** Agent name */
  agentName?: string

  /** Final status */
  status: 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMED_OUT'

  /** Output content */
  output: string

  /** All events if streaming was enabled */
  events?: TerminalUseEvent[]

  /** Error message if failed */
  error?: string

  /** Execution time in milliseconds */
  executionTime?: number

  /** Filesystem ID if persistent storage was used */
  filesystemId?: string
}

/**
 * Agent thread for multi-turn conversations
 */
export interface TerminalUseThread {
  /** Task ID */
  id: string

  /** Agent name */
  agentName?: string

  /** Created at timestamp */
  createdAt: number

  /** Last message timestamp */
  lastMessageAt?: number

  /** Message count */
  messageCount?: number

  /** Filesystem ID for persistence */
  filesystemId?: string
}

/**
 * Agent state for memory management
 */
export interface AgentState {
  /** State data */
  data: Record<string, unknown>

  /** Last updated timestamp */
  updatedAt: number

  /** Version for optimistic locking */
  version?: number
}

/**
 * TerminalUse Agent Service interface
 */
export interface TerminalUseAgentService {
  /** Run agent with configuration */
  run(config: TerminalUseAgentConfig): Promise<TerminalUseAgentResult>

  /** Stream agent events */
  streamEvents(config: TerminalUseAgentConfig): AsyncIterable<TerminalUseEvent>

  /** Continue conversation in existing thread */
  continue(taskId: string, prompt: string, options?: Partial<TerminalUseAgentConfig>): Promise<TerminalUseAgentResult>

  /** Get thread state */
  getState(taskId: string, agentId?: string): Promise<AgentState>

  /** Update thread state */
  setState(taskId: string, state: Record<string, unknown>, agentId?: string): Promise<void>

  /** List all threads */
  listThreads(): Promise<TerminalUseThread[]>

  /** Delete thread */
  deleteThread(taskId: string): Promise<void>

  /** Get messages from thread */
  getMessages(taskId: string): Promise<{ role: string; content: string; timestamp: number }[]>

  /** Cancel running task */
  cancelTask(taskId: string): Promise<void>
}

/**
 * Create TerminalUse agent service instance
 *
 * @param handle - TerminalUse sandbox handle
 * @returns Agent service instance
 */
export function createTerminalUseAgentService(
  handle: TerminalUseSandboxHandle
): TerminalUseAgentService {
  /**
   * Run agent with configuration
   */
  async function run(config: TerminalUseAgentConfig): Promise<TerminalUseAgentResult> {
    const startTime = Date.now()

    // Create task for agent execution
    const task = await handle.createTask({
      agent_name: config.agent_name,
      branch: config.branch,
      params: {
        type: 'agent',
        prompt: config.prompt,
        ...config.params,
      },
    })

    // Send initial event with prompt
    await handle.sendEvent(task.id, config.prompt)

    // Stream or poll for completion
    if (config.streamEvents) {
      return streamToCompletion(task, config, startTime)
    } else {
      return pollToCompletion(task, config, startTime)
    }
  }

  /**
   * Stream events to completion
   */
  async function streamToCompletion(
    task: TerminalUseTask,
    config: TerminalUseAgentConfig,
    startTime: number
  ): Promise<TerminalUseAgentResult> {
    const events: TerminalUseEvent[] = []
    let lastStatus = 'RUNNING'

    const abortController = new AbortController()
    const timeoutId = config.timeout
      ? setTimeout(() => abortController.abort(), config.timeout)
      : undefined

    try {
      // Poll status while streaming events
      const statusPollInterval = setInterval(async () => {
        try {
          const status = await handle.callAgent({ targetAgent: '', input: {}, waitForCompletion: false })
            .then(() => ({ status: 'RUNNING' }))
            .catch(() => ({ status: 'FAILED' }))
          lastStatus = status.status as any

          if (lastStatus === 'COMPLETED' || lastStatus === 'FAILED' || lastStatus === 'CANCELED') {
            clearInterval(statusPollInterval)
            if (timeoutId) clearTimeout(timeoutId)
            abortController.abort()
          }
        } catch {
          // Ignore poll errors
        }
      }, 2000)

      // Stream events
      for await (const event of handle.streamTask(task.id, abortController.signal)) {
        events.push(event)

        // Call callbacks
        if (event.content.type === 'text' && event.content.text) {
          config.onStdout?.(event.content.text)
        }
        config.onEvent?.(event)
      }

      clearInterval(statusPollInterval)
      if (timeoutId) clearTimeout(timeoutId)

      // Get final status
      const client = (handle as any).getClient?.()
      const finalTask = client ? await client.getTask(task.id) : { status: lastStatus }

      // Get messages for output
      const messages = await handle.getMessages()
      const output = messages.map((m) => m.content).join('\n') || 'Task completed'

      return {
        taskId: task.id,
        agentName: task.agent_name,
        status: finalTask.status as any,
        output,
        events,
        executionTime: Date.now() - startTime,
        filesystemId: task.filesystem_id,
      }
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId)

      return {
        taskId: task.id,
        agentName: task.agent_name,
        status: 'FAILED',
        output: events.filter((e) => e.content.type === 'text').map((e) => e.content.text).join('\n'),
        events,
        error: error.message || 'Agent execution failed',
        executionTime: Date.now() - startTime,
        filesystemId: task.filesystem_id,
      }
    }
  }

  /**
   * Poll to completion without streaming
   */
  async function pollToCompletion(
    task: TerminalUseTask,
    config: TerminalUseAgentConfig,
    startTime: number
  ): Promise<TerminalUseAgentResult> {
    const client = (handle as any).getClient?.()
    if (!client) {
      throw new Error('Client not available')
    }

    const maxAttempts = config.timeout ? Math.floor(config.timeout / 2000) : 300

    for (let i = 0; i < maxAttempts; i++) {
      const status = await client.getTask(task.id)

      if (status.status === 'COMPLETED') {
        break
      }
      if (status.status === 'FAILED' || status.status === 'CANCELED' || status.status === 'TIMED_OUT') {
        const messages = await handle.getMessages()
        return {
          taskId: task.id,
          agentName: task.agent_name,
          status: status.status as any,
          output: messages.map((m) => m.content).join('\n'),
          error: `Task failed with status: ${status.status}`,
          executionTime: Date.now() - startTime,
          filesystemId: task.filesystem_id,
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    // Get final output
    const messages = await handle.getMessages()
    const output = messages.map((m) => m.content).join('\n') || 'Task completed'

    return {
      taskId: task.id,
      agentName: task.agent_name,
      status: 'COMPLETED',
      output,
      executionTime: Date.now() - startTime,
      filesystemId: task.filesystem_id,
    }
  }

  /**
   * Stream agent events
   */
  async function* streamEvents(config: TerminalUseAgentConfig): AsyncIterable<TerminalUseEvent> {
    const task = await handle.createTask({
      agent_name: config.agent_name,
      branch: config.branch,
      params: {
        type: 'agent',
        prompt: config.prompt,
      },
    })

    // Send initial event
    await handle.sendEvent(task.id, config.prompt)

    // Stream events
    yield* handle.streamTask(task.id)
  }

  /**
   * Continue conversation in existing thread
   */
  async function continueThread(
    taskId: string,
    prompt: string,
    options?: Partial<TerminalUseAgentConfig>
  ): Promise<TerminalUseAgentResult> {
    // Send new prompt as event
    await handle.sendEvent(taskId, prompt)

    // Poll or stream to completion
    const client = (handle as any).getClient?.()
    if (!client) {
      throw new Error('Client not available')
    }

    return pollToCompletion(
      { id: taskId } as TerminalUseTask,
      { ...options, prompt } as TerminalUseAgentConfig,
      Date.now()
    )
  }

  /**
   * Get thread state
   */
  async function getState(taskId: string, agentId?: string): Promise<AgentState> {
    const client = (handle as any).getClient?.()
    if (!client) {
      throw new Error('Client not available')
    }

    // Get task to find agent ID
    const task = await client.getTask(taskId)
    const effectiveAgentId = agentId || task.agent_name || 'default'

    try {
      const state = await client.getState(taskId, effectiveAgentId)
      return {
        data: state.state,
        updatedAt: new Date(state.updated_at).getTime(),
      }
    } catch {
      return {
        data: {},
        updatedAt: 0,
      }
    }
  }

  /**
   * Update thread state
   */
  async function setState(taskId: string, state: Record<string, unknown>, agentId?: string): Promise<void> {
    const client = (handle as any).getClient?.()
    if (!client) {
      throw new Error('Client not available')
    }

    const task = await client.getTask(taskId)
    const effectiveAgentId = agentId || task.agent_name || 'default'

    await client.updateState(taskId, effectiveAgentId, state)
  }

  /**
   * List all threads
   */
  async function listThreads(): Promise<TerminalUseThread[]> {
    const client = (handle as any).getClient?.()
    if (!client) {
      return []
    }

    const tasks = await client.listTasks({ limit: 100 })
    return tasks
      .filter((t) => t.params && (t.params as any).type === 'agent')
      .map((t) => ({
        id: t.id,
        agentName: t.agent_name,
        createdAt: new Date(t.created_at).getTime(),
        lastMessageAt: new Date(t.updated_at).getTime(),
        filesystemId: t.filesystem_id,
      }))
  }

  /**
   * Delete thread
   */
  async function deleteThread(taskId: string): Promise<void> {
    const client = (handle as any).getClient?.()
    if (!client) {
      return
    }

    await client.cancelTask(taskId)
    await client.deleteTask(taskId)
  }

  /**
   * Get messages from thread
   */
  async function getMessages(taskId: string): Promise<{ role: string; content: string; timestamp: number }[]> {
    const messages = await handle.getMessages()
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: new Date(m.created_at).getTime(),
    }))
  }

  /**
   * Cancel running task
   */
  async function cancelTask(taskId: string): Promise<void> {
    const client = (handle as any).getClient?.()
    if (!client) {
      return
    }

    await client.cancelTask(taskId)
  }

  return {
    run,
    streamEvents,
    continue: continueThread,
    getState,
    setState,
    listThreads,
    deleteThread,
    getMessages,
    cancelTask,
  }
}

/**
 * Execute an agent task in a new TerminalUse sandbox
 * Convenience function that creates a sandbox, runs the task, and cleans up
 */
export async function executeTerminalUseAgent(config: {
  agent_name?: string
  prompt: string
  branch?: string
  timeout?: number
  apiKey?: string
}): Promise<{ output: string; taskId: string }> {
  const { TerminalUseProvider } = await import('../providers/terminaluse-provider')

  const apiKey = config.apiKey || process.env.TERMINALUSE_API_KEY
  if (!apiKey) {
    throw new Error('TERMINALUSE_API_KEY environment variable is required')
  }

  const provider = new TerminalUseProvider()

  const handle = await provider.createSandbox({
    envVars: {},
  }) as unknown as TerminalUseSandboxHandle

  try {
    const agentService = createTerminalUseAgentService(handle)
    const result = await agentService.run({
      agent_name: config.agent_name,
      prompt: config.prompt,
      branch: config.branch,
      timeout: config.timeout,
    })

    return {
      output: result.output,
      taskId: result.taskId,
    }
  } finally {
    await provider.destroySandbox(handle.id)
  }
}
