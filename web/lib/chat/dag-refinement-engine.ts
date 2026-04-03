/**
 * DAG (Directed Acyclic Graph) Execution Engine
 *
 * Enables parallel refinement of spec sections with dependency tracking.
 * Streams progress updates via SSE events.
 *
 * @see lib/streaming/sse-event-schema.ts
 */

import { createLogger } from '@/lib/utils/logger'
import { RefinementChunk } from './spec-parser'
import {
  createSSEEmitter,
  SSE_EVENT_TYPES,
} from '@/lib/streaming/sse-event-schema'

const logger = createLogger('Refinement:DAG')

export interface DAGTask {
  id: string
  title: string
  tasks: string[]
  dependencies: string[]
  status: 'pending' | 'running' | 'complete' | 'error' | 'timeout'
  error?: string
  startedAt?: number
  completedAt?: number
  result?: string
}

export interface DAGConfig {
  model: string
  /**
   * LLM provider to use for refinement tasks. Defaults to 'auto'.
   * Use the fast spec model's provider here, NOT the user's primary model
   * provider, to avoid rate-limiting free-tier models with concurrent DAG tasks.
   */
  provider?: string
  baseResponse: string
  chunks: RefinementChunk[]
  mode: 'enhanced' | 'max'
  userId?: string
  conversationId?: string
  maxConcurrency?: number
  /**
   * Time budget for DAG execution in milliseconds.
   * Default: 60 seconds (increased from 10s to handle complex refinements)
   * Each LLM task can take 7-18 seconds, so 60s allows for ~3-8 tasks to complete
   */
  timeBudgetMs?: number
  /** Callback for emitting SSE events during refinement */
  emit?: (event: string, data: unknown) => void
}

export interface DAGProgress {
  overallProgress: number
  activeTasks: string[]
  completedTasks: string[]
  failedTasks: string[]
  pendingTasks: string[]
  partialResults: Map<string, string>
}

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

type SSEEmitter = ReturnType<typeof createSSEEmitter>

interface TaskOutcome {
  taskId: string
  result: string | null
  success: boolean
  error?: unknown
}

// ---------------------------------------------------------------------------
// DAGExecutor
// ---------------------------------------------------------------------------

export class DAGExecutor {
  private readonly tasks: Map<string, DAGTask>
  private readonly startTime: number
  private readonly timeBudgetMs: number
  private readonly maxConcurrency: number
  private readonly abortController: AbortController
  private readonly config: DAGConfig

  constructor(config: DAGConfig) {
    this.tasks = new Map()
    this.startTime = Date.now()
    this.timeBudgetMs = config.timeBudgetMs ?? 60_000 // Increased from 10s to 60s for complex refinements
    this.maxConcurrency = config.maxConcurrency ?? 3
    this.abortController = new AbortController()
    this.config = config

    this.buildTaskGraph(config.chunks, config.baseResponse)
  }

  // -------------------------------------------------------------------------
  // Graph construction
  // -------------------------------------------------------------------------

  private buildTaskGraph(chunks: RefinementChunk[], baseResponse: string): void {
    this.tasks.set('base', {
      id: 'base',
      title: 'Base Response',
      tasks: ['Generate initial response'],
      dependencies: [],
      status: 'complete',
      startedAt: this.startTime,
      completedAt: this.startTime,
      result: baseResponse,
    })

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const taskId = `refine-${i}`
      this.tasks.set(taskId, {
        id: taskId,
        title: chunk.title,
        tasks: chunk.tasks,
        dependencies: ['base'],
        status: 'pending',
      })
    }

    logger.debug('DAG task graph built', {
      totalTasks: this.tasks.size,
      tasks: Array.from(this.tasks.values()).map(t => ({
        id: t.id,
        title: t.title,
        dependencies: t.dependencies,
      })),
    })
  }

  // -------------------------------------------------------------------------
  // Scheduling helpers
  // -------------------------------------------------------------------------

  private getReadyTasks(): DAGTask[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false
      return task.dependencies.every(
        depId => this.tasks.get(depId)?.status === 'complete',
      )
    })
  }

  private calculateProgress(): number {
    const completed = Array.from(this.tasks.values()).filter(
      t => t.status === 'complete',
    ).length
    return Math.round((completed / this.tasks.size) * 100)
  }

  // -------------------------------------------------------------------------
  // Provider resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the LLM provider for refinement tasks.
   *
   * Priority:
   * 1. Explicit provider in config (not 'auto')
   * 2. Namespace prefix in model string (e.g. "nvidia/nemotron-…" → "nvidia")
   * 3. Default chat provider from task-providers config
   */
  private async resolveProvider(): Promise<string> {
    const { provider, model } = this.config

    if (provider && provider !== 'auto') return provider

    const slashIdx = model.indexOf('/')
    if (slashIdx > 0) return model.slice(0, slashIdx)

    const { getProviderForTask } = await import('@/lib/config/task-providers')
    return getProviderForTask('chat')
  }

  // -------------------------------------------------------------------------
  // Task execution
  // -------------------------------------------------------------------------

  private async executeTask(task: DAGTask, emit?: SSEEmitter): Promise<string> {
    task.status = 'running'
    task.startedAt = Date.now()

    logger.debug('Spec: Executing task', { taskId: task.id, title: task.title, dependencies: task.dependencies })

    try {
      const baseContent = task.dependencies.reduce((acc, depId) => {
        return this.tasks.get(depId)?.result ?? acc
      }, '')

      logger.debug('Spec: Task preparing LLM call', { 
        taskId: task.id, 
        baseContentLength: baseContent.length,
        model: this.config.model,
        provider: this.config.provider,
      })

      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service')
      const provider = await this.resolveProvider()

      const refined = await enhancedLLMService.generateResponse({
        provider,
        model: this.config.model,
        messages: [
          { role: 'system', content: this.buildRefinementPrompt(task) },
          { role: 'user', content: baseContent },
        ],
        maxTokens: 80_000,
        temperature: 0.7,
        stream: false,
      })

      const refinedContent = refined.content ?? ''
      logger.debug('Spec: Task LLM returned', { 
        taskId: task.id, 
        contentLength: refinedContent.length,
        tokensUsed: refined.tokensUsed,
      })

      task.status = 'complete'
      task.completedAt = Date.now()
      task.result = refinedContent

      logger.debug('Spec: Task complete', {
        taskId: task.id,
        durationMs: task.completedAt - task.startedAt!,
      })

      emit?.(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
        stage: 'task_complete',
        taskId: task.id,
        taskTitle: task.title,
        content: refinedContent,
        timestamp: Date.now(),
      })

      return refinedContent
    } catch (error) {
      task.status = 'error'
      task.completedAt = Date.now()
      task.error = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Spec: Task failed', { 
        taskId: task.id, 
        error: task.error,
        errorStack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  private buildRefinementPrompt(task: DAGTask): string {
    const tasksList = task.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
    // Use a placeholder to avoid template literal issues with code block markers
    const codeBlockStart = '```'
    return `You are improving an existing AI-generated solution.

FOCUS AREA:
${task.title}

TASKS:
${tasksList}

OUTPUT FORMAT (REQUIRED - use this format exactly):
When making changes to existing files, use PATCH format with unified diff:

${codeBlockStart}fs-actions
PATCH src/file.ts <<<
@@ -1,5 +1,6 @@
-old line to remove
+new line to add
-another line to remove
+replacement line
>>>
${codeBlockStart}

For NEW files (not modifications), use WRITE:

${codeBlockStart}fs-actions
WRITE new-file.ts <<<complete file content here>>>
${codeBlockStart}

RULES:
- Use PATCH format for changes to existing files (REQUIRED - this is most reliable)
- Use WRITE only for entirely new files, not modifications
- Do NOT duplicate content from other focus areas
- Focus on QUALITY over speed
- Make it PRODUCTION-READY
- Output the improved response including any file changes in fs-actions blocks

FALLBACK: If you use a different format, the system will attempt fuzzy patching.

Return the improved output with file edits embedded.`
  }

  // -------------------------------------------------------------------------
  // Main execution loop
  // -------------------------------------------------------------------------

  async execute(emit: SSEEmitter): Promise<string> {
    logger.info('Spec: DAG execution started', {
      totalTasks: this.tasks.size,
      maxConcurrency: this.maxConcurrency,
      timeBudgetMs: this.timeBudgetMs,
    })

    // Skip emit test - emit may be undefined (no-op) when stream is closed
    logger.debug('Spec: DAG task graph built', {
      totalTasks: this.tasks.size,
      taskIds: Array.from(this.tasks.keys()),
    })

    // activeTasks maps taskId → a Promise<TaskOutcome> that never rejects
    const activeTasks = new Map<string, Promise<TaskOutcome>>()

    const wrapTask = (task: DAGTask): Promise<TaskOutcome> =>
      this.executeTask(task, emit)
        .then(result => ({ taskId: task.id, result, success: true }))
        .catch(error => ({ taskId: task.id, result: null, success: false, error }))

    while (true) {
      // Budget check
      if (Date.now() - this.startTime > this.timeBudgetMs) {
        logger.warn('Time budget exceeded, stopping DAG execution')
        // Mark still-pending / running tasks as timed-out
        for (const task of this.tasks.values()) {
          if (task.status === 'pending' || task.status === 'running') {
            task.status = 'timeout'
          }
        }
        emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
          stage: 'complete',
          error: 'Time budget exceeded',
          timestamp: Date.now(),
        })
        break
      }

      // Completion check
      const allDone = Array.from(this.tasks.values()).every(
        t => t.status === 'complete' || t.status === 'error' || t.status === 'timeout',
      )
      if (allDone) {
        logger.info('DAG execution complete')
        break
      }

      // Start newly-ready tasks up to the concurrency limit
      const readyTasks = this.getReadyTasks()
      for (const task of readyTasks) {
        if (activeTasks.size >= this.maxConcurrency) break
        activeTasks.set(task.id, wrapTask(task))

        emit(SSE_EVENT_TYPES.DAG_TASK_STATUS, {
          tasks: Array.from(this.tasks.values()).map(t => ({
            taskId: t.id,
            title: t.title,
            status: t.status,
            dependencies: t.dependencies,
            error: t.error,
            startedAt: t.startedAt,
            completedAt: t.completedAt,
          })),
          overallProgress: this.calculateProgress(),
          activeTasks: Array.from(activeTasks.keys()),
          timestamp: Date.now(),
        })
      }

      // Wait for at least one task to finish before re-evaluating
      if (activeTasks.size > 0) {
        const completed = await Promise.race(Array.from(activeTasks.values()))
        activeTasks.delete(completed.taskId)

        emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
          stage: 'refining',
          currentIteration: Array.from(this.tasks.values()).filter(
            t => t.status === 'complete',
          ).length,
          totalIterations: this.tasks.size - 1,
          currentSection: completed.taskId,
          timestamp: Date.now(),
        })
      } else {
        // No active tasks and no ready tasks — all remaining must be blocked
        // (shouldn't happen in a correct DAG, but guard against infinite loop)
        break
      }
    }

    const finalOutput = this.mergeResults()

    const timedOutTasks = Array.from(this.tasks.values()).filter(
      t => t.status === 'timeout',
    )

    if (timedOutTasks.length === 0) {
      emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
        stage: 'complete',
        currentIteration: this.tasks.size - 1,
        totalIterations: this.tasks.size - 1,
        timestamp: Date.now(),
      })
    } else {
      emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
        stage: 'complete_with_timeouts',
        currentIteration: this.tasks.size - 1,
        totalIterations: this.tasks.size - 1,
        timedOutTasks: timedOutTasks.map(t => t.id),
        timestamp: Date.now(),
      })
    }

    return finalOutput
  }

  // -------------------------------------------------------------------------
  // Result merging
  // -------------------------------------------------------------------------

  private mergeResults(): string {
    const baseTask = this.tasks.get('base')
    let output = baseTask?.result ?? ''

    const completedTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'complete' && t.id !== 'base')
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))

    logger.debug('Spec: Merging results', { 
      completedTaskCount: completedTasks.length,
      baseLength: baseTask?.result?.length || 0,
    })

    for (const task of completedTasks) {
      if (task.result) {
        logger.debug('Spec: Task result merged', { 
          taskId: task.id, 
          resultLength: task.result.length,
          hasFsActions: task.result.includes('WRITE'),
        })
        output += '\n\n---\n\n' + task.result
      }
    }

    logger.debug('Spec: Final merged output', { 
      totalLength: output.length,
      hasFsActions: output.includes('WRITE'),
    })

    return output
  }

  // -------------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------------

  abort(): void {
    this.abortController.abort()
    logger.info('DAG execution aborted')
  }
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Execute refinement with DAG parallelization.
 * Falls back to the base response if execution fails.
 */
export async function executeRefinementWithDAG(
  config: DAGConfig,
  emitFn?: SSEEmitter,
): Promise<string> {
  // Prefer config.emit; fall back to the parameter; then no-op
  const hasRealEmitter = !!(config.emit || emitFn);
  const emitter: SSEEmitter = config.emit ?? emitFn ?? (() => {})
  const executor = new DAGExecutor(config)

  try {
    return await executor.execute(emitter)
  } catch (error) {
    // Only emit if we have a real emitter (stream is still open)
    if (hasRealEmitter) {
      emitter(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
        stage: 'error',
        error: error instanceof Error ? error.message : 'DAG execution failed',
        timestamp: Date.now(),
      })
    }

    // Safe fallback: return base response via private map access
    const baseTask = (executor as unknown as { tasks: Map<string, DAGTask> }).tasks.get('base')
    return baseTask?.result ?? ''
  }
}
