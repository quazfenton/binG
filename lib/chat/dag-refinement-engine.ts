/**
 * DAG (Directed Acyclic Graph) Execution Engine
 * 
 * Enables parallel refinement of spec sections with dependency tracking
 * Streams progress updates via SSE events
 * 
 * @see lib/streaming/sse-event-schema.ts
 */

import { createLogger } from '@/lib/utils/logger'
import { RefinementChunk } from './spec-parser'
import { createSSEEmitter, SSE_EVENT_TYPES, SSESpecAmplificationPayload, SSEDAGTaskStatusPayload } from '@/lib/streaming/sse-event-schema'

const logger = createLogger('Refinement:DAG')

export interface DAGTask {
  id: string
  title: string
  tasks: string[]
  dependencies: string[]
  status: 'pending' | 'running' | 'complete' | 'error'
  error?: string
  startedAt?: number
  completedAt?: number
  result?: string
}

export interface DAGConfig {
  model: string
  baseResponse: string
  chunks: RefinementChunk[]
  mode: 'enhanced' | 'max'
  userId?: string
  conversationId?: string
  maxConcurrency?: number
  timeBudgetMs?: number
}

export interface DAGProgress {
  overallProgress: number
  activeTasks: string[]
  completedTasks: string[]
  failedTasks: string[]
  pendingTasks: string[]
  partialResults: Map<string, string>
}

export class DAGExecutor {
  private tasks: Map<string, DAGTask>
  private results: Map<string, string>
  private startTime: number
  private timeBudgetMs: number
  private maxConcurrency: number
  private abortController: AbortController
  private config: DAGConfig

  constructor(config: DAGConfig) {
    this.tasks = new Map()
    this.results = new Map()
    this.startTime = Date.now()
    this.timeBudgetMs = config.timeBudgetMs || 10000
    this.maxConcurrency = config.maxConcurrency || 3
    this.abortController = new AbortController()
    this.config = config

    // Build task graph from chunks
    this.buildTaskGraph(config.chunks, config.baseResponse)
  }
  
  /**
   * Build DAG from spec chunks
   */
  private buildTaskGraph(chunks: RefinementChunk[], baseResponse: string) {
    // First task is always the base response
    this.tasks.set('base', {
      id: 'base',
      title: 'Base Response',
      tasks: ['Generate initial response'],
      dependencies: [],
      status: 'complete',
      startedAt: this.startTime,
      completedAt: this.startTime,
      result: baseResponse
    })
    
    // Add refinement tasks
    chunks.forEach((chunk, index) => {
      const taskId = `refine-${index}`
      this.tasks.set(taskId, {
        id: taskId,
        title: chunk.title,
        tasks: chunk.tasks,
        dependencies: ['base'], // All depend on base completing
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined
      })
    })
    
    logger.debug('DAG task graph built', {
      totalTasks: this.tasks.size,
      tasks: Array.from(this.tasks.values()).map(t => ({
        id: t.id,
        title: t.title,
        dependencies: t.dependencies
      }))
    })
  }
  
  /**
   * Get tasks ready to execute (all dependencies met)
   */
  private getReadyTasks(): DAGTask[] {
    return Array.from(this.tasks.values()).filter(task => {
      if (task.status !== 'pending') return false
      
      // Check if all dependencies are complete
      const depsMet = task.dependencies.every(depId => {
        const depTask = this.tasks.get(depId)
        return depTask?.status === 'complete'
      })
      
      return depsMet
    })
  }
  
  /**
   * Execute a single refinement task
   */
  private async executeTask(
    task: DAGTask,
    emit?: ReturnType<typeof createSSEEmitter>
  ): Promise<string> {
    task.status = 'running'
    task.startedAt = Date.now()

    logger.debug('Executing task', { taskId: task.id, title: task.title })

    try {
      // Get base response from dependencies
      const baseContent = task.dependencies.reduce((acc, depId) => {
        const depTask = this.tasks.get(depId)
        return depTask?.result || acc
      }, '')

      const { enhancedLLMService } = await import('@/lib/chat/enhanced-llm-service')

      const refinementPrompt = this.buildRefinementPrompt(task)

      const refined = await enhancedLLMService.generateResponse({
        provider: 'auto',
        model: this.config.model, // Use user's selected model from config
        messages: [
          {
            role: 'system',
            content: refinementPrompt
          },
          {
            role: 'user',
            content: baseContent
          }
        ],
        maxTokens: 8000,
        temperature: 0.7,
        stream: false
      })

      const refinedContent = refined.content || ''

      task.status = 'complete'
      task.completedAt = Date.now()
      task.result = refinedContent

      logger.debug('Task complete', { taskId: task.id, duration: task.completedAt - task.startedAt! })

      return refinedContent

    } catch (error) {
      task.status = 'error'
      task.completedAt = Date.now()
      task.error = error instanceof Error ? error.message : 'Unknown error'

      logger.error('Task failed', { taskId: task.id, error: task.error })

      throw error
    }
  }
  
  /**
   * Build refinement prompt for a task
   */
  private buildRefinementPrompt(task: DAGTask): string {
    const tasksList = task.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
    
    return `You are improving an existing AI-generated solution.

FOCUS AREA:
${task.title}

TASKS:
${tasksList}

RULES:
- Improve depth and correctness
- Add missing implementation details
- Do not repeat unchanged parts
- Output the COMPLETE improved result
- Focus on QUALITY over speed
- Make it PRODUCTION-READY

Return ONLY the improved output, no explanations.`
  }
  
  /**
   * Execute DAG with parallel task execution
   */
  async execute(
    emit: ReturnType<typeof createSSEEmitter>
  ): Promise<string> {
    logger.info('Starting DAG execution', {
      totalTasks: this.tasks.size,
      maxConcurrency: this.maxConcurrency,
      timeBudgetMs: this.timeBudgetMs
    })
    
    // Emit initial status
    emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
      stage: 'refining',
      currentIteration: 0,
      totalIterations: this.tasks.size - 1, // Exclude base
      timestamp: Date.now()
    })
    
    const activeTasks = new Map<string, Promise<string>>()
    
    while (true) {
      // Check time budget
      const elapsed = Date.now() - this.startTime
      if (elapsed > this.timeBudgetMs) {
        logger.warn('Time budget exceeded, stopping DAG execution')
        emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
          stage: 'complete',
          error: 'Time budget exceeded',
          timestamp: Date.now()
        })
        break
      }
      
      // Check if all tasks are done
      const allDone = Array.from(this.tasks.values()).every(
        t => t.status === 'complete' || t.status === 'error'
      )
      
      if (allDone) {
        logger.info('DAG execution complete')
        break
      }
      
      // Get ready tasks
      const readyTasks = this.getReadyTasks()
      
      // Start new tasks up to concurrency limit
      for (const task of readyTasks) {
        if (activeTasks.size >= this.maxConcurrency) break
        
        const promise = this.executeTask(task, emit)
        activeTasks.set(task.id, promise)
        
        // Emit task status
        emit(SSE_EVENT_TYPES.DAG_TASK_STATUS, {
          tasks: Array.from(this.tasks.values()).map(t => ({
            taskId: t.id,
            title: t.title,
            status: t.status,
            dependencies: t.dependencies,
            error: t.error,
            startedAt: t.startedAt,
            completedAt: t.completedAt
          })),
          overallProgress: this.calculateProgress(),
          activeTasks: Array.from(activeTasks.keys()),
          timestamp: Date.now()
        })
      }
      
      // Wait for at least one task to complete
      if (activeTasks.size > 0) {
        const completed = await Promise.race(
          Array.from(activeTasks.entries()).map(async ([taskId, promise]) => {
            try {
              const result = await promise
              return { taskId, result, success: true }
            } catch (error) {
              return { taskId, result: null, success: false, error }
            }
          })
        )
        
        activeTasks.delete(completed.taskId)
        
        // Update progress
        emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
          stage: 'refining',
          currentIteration: Array.from(this.tasks.values()).filter(
            t => t.status === 'complete'
          ).length,
          totalIterations: this.tasks.size - 1,
          currentSection: completed.taskId,
          timestamp: Date.now()
        })
      }
    }
    
    // Merge all results
    const finalOutput = this.mergeResults()
    
    emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
      stage: 'complete',
      currentIteration: this.tasks.size - 1,
      totalIterations: this.tasks.size - 1,
      timestamp: Date.now()
    })
    
    return finalOutput
  }
  
  /**
   * Calculate overall progress (0-100)
   */
  private calculateProgress(): number {
    const completed = Array.from(this.tasks.values()).filter(
      t => t.status === 'complete'
    ).length
    const total = this.tasks.size
    return Math.round((completed / total) * 100)
  }
  
  /**
   * Merge all task results into final output
   */
  private mergeResults(): string {
    // Start with base response
    const baseTask = this.tasks.get('base')
    let output = baseTask?.result || ''
    
    // Append completed refinement results
    const completedTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'complete' && t.id !== 'base')
      .sort((a, b) => {
        // Sort by completion time
        return (a.completedAt || 0) - (b.completedAt || 0)
      })
    
    for (const task of completedTasks) {
      if (task.result) {
        output += '\n\n---\n\n' + task.result
      }
    }
    
    return output
  }
  
  /**
   * Abort execution
   */
  abort() {
    this.abortController.abort()
    logger.info('DAG execution aborted')
  }
}

/**
 * Execute refinement with DAG parallelization
 */
export async function executeRefinementWithDAG(
  config: DAGConfig,
  emit?: ReturnType<typeof createSSEEmitter>
): Promise<string> {
  const executor = new DAGExecutor(config)
  
  try {
    return await executor.execute(emit || (() => {}))
  } catch (error) {
    if (emit) {
      emit(SSE_EVENT_TYPES.SPEC_AMPLIFICATION, {
        stage: 'error',
        error: error instanceof Error ? error.message : 'DAG execution failed',
        timestamp: Date.now()
      })
    }
    
    // Fallback to base response
    const baseTask = (executor as any).tasks.get('base')
    return baseTask?.result || ''
  }
}
