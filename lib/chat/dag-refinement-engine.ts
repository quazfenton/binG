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
    this.timeBudgetMs = config.timeBudgetMs ?? 10_000
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

    logger.debug('Executing task', { taskId: task.id, title: task.title })

    try {
      const baseContent = task.dependencies.reduce((acc, depId) => {
        return this.tasks.get(depId)?.result ?? acc
      }, '')

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

      task.status = 'complete'
      task.completedAt = Date.now()
      task.result = refinedContent

      logger.debug('Task complete', {
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

      logger.error('Task failed', { taskId: task.id, error: task.error })
      throw error
    }
  }

  private buildRefinementPrompt(task: DAGTask): string {
    const tasksList = task.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
    return `You are improving an existing AI-generated solution.

FOCUS AREA:
${task.title}

TASKS:
${tasksList}

RULES:
- Improve depth and correctness for YOUR FOCUS AREA only
- Add missing implementation details for YOUR assigned tasks
- Output ONLY new or changed files relevant to your focus area
- Do NOT re-output files that are unchanged or belong to other focus areas
- Focus on QUALITY over speed
- Make it PRODUCTION-READY

Return ONLY the improved output, no explanations.`
  }

  // -------------------------------------------------------------------------
  // Main execution loop
  // -------------------------------------------------------------------------

  async execute(emit: SSEEmitter): Promise<string> {
    logger.info('Starting DAG execution', {
      totalTasks: this.tasks.size,
      maxConcurrency: this.maxConcurrency,
      timeBudgetMs: this.timeBudgetMs,
    })

    emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
      stage: 'refining',
      currentIteration: 0,
      totalIterations: this.tasks.size - 1, // exclude base
      timestamp: Date.now(),
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

    for (const task of completedTasks) {
      if (task.result) {
        output += '\n\n---\n\n' + task.result
      }
    }

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
  const emitter: SSEEmitter = config.emit ?? emitFn ?? (() => {})
  const executor = new DAGExecutor(config)

  try {
    return await executor.execute(emitter)
  } catch (error) {
    emitter(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
      stage: 'error',
      error: error instanceof Error ? error.message : 'DAG execution failed',
      timestamp: Date.now(),
    })

    // Safe fallback: return base response via private map access
    const baseTask = (executor as unknown as { tasks: Map<string, DAGTask> }).tasks.get('base')
    return baseTask?.result ?? ''
  }
}
