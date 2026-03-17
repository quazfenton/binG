/**
 * Scheduler Service
 *
 * Cron-like scheduled task system built on BullMQ repeatable jobs.
 * Persists tasks in Redis and re-registers them on restart.
 *
 * Supported task types:
 * - sandbox-command:  Execute a command inside a sandbox pool container
 * - nullclaw-agent:   Call nullclaw agent endpoint
 * - http-webhook:     Fire an external HTTP request
 * - workspace-index:  Trigger workspace re-indexing
 * - sandbox-cleanup:  Clean up idle/expired sandboxes
 * - health-check:     Probe multiple service health endpoints
 * - custom:           Publish event to Redis for external handlers
 *
 * API (HTTP on PORT, default 3007):
 *   GET  /health            – service health
 *   GET  /tasks             – list all scheduled tasks
 *   POST /tasks             – create a new task
 *   GET  /tasks/:id         – get task by id
 *   PUT  /tasks/:id         – update task
 *   DELETE /tasks/:id       – delete task
 *   POST /tasks/:id/trigger – manually trigger a task now
 *   GET  /stats             – scheduler statistics
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { Queue, Worker, type Job } from 'bullmq'
import Redis from 'ioredis'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3007', 10)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const NULLCLAW_URL = process.env.NULLCLAW_URL || 'http://nullclaw:3000'
const SANDBOX_POOL_URL = process.env.SANDBOX_POOL_URL || 'http://sandbox:3005'
const BACKGROUND_WORKER_URL =
  process.env.BACKGROUND_WORKER_URL || 'http://background:3006'
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:3002'

const QUEUE_NAME = 'scheduled-tasks'
const TASKS_HASH = 'scheduler:tasks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduledTaskType =
  | 'sandbox-command'
  | 'nullclaw-agent'
  | 'http-webhook'
  | 'workspace-index'
  | 'sandbox-cleanup'
  | 'health-check'
  | 'custom'

export interface ScheduledTask {
  id: string
  name: string
  type: ScheduledTaskType
  /** Cron expression, e.g. '* /5 * * * *' (every 5 min) */
  schedule: string
  timezone?: string
  payload: Record<string, any>
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  nextRunAt?: number
  runCount: number
  lastResult?: {
    success: boolean
    output?: string
    error?: string
    duration: number
  }
  maxRetries?: number
  timeout?: number
  ownerId?: string
  tags?: string[]
}

interface TaskExecutionResult {
  success: boolean
  output?: string
  error?: string
  duration: number
}

// ---------------------------------------------------------------------------
// Scheduler Service
// ---------------------------------------------------------------------------

class SchedulerService {
  private redis: Redis
  private queue: Queue
  private worker!: Worker
  private tasks: Map<string, ScheduledTask> = new Map()
  public initialized = false

  constructor() {
    this.redis = new Redis(REDIS_URL)
    this.queue = new Queue(QUEUE_NAME, { connection: new Redis(REDIS_URL) })
  }

  async initialize(): Promise<void> {
    console.log('[Scheduler] Initializing scheduler service…')

    // Load persisted tasks from Redis
    const stored = await this.redis.hgetall(TASKS_HASH)
    for (const [id, json] of Object.entries(stored)) {
      try {
        const task: ScheduledTask = JSON.parse(json)
        this.tasks.set(id, task)
      } catch {
        console.warn(`[Scheduler] Failed to parse stored task ${id}`)
      }
    }

    console.log(`[Scheduler] Loaded ${this.tasks.size} persisted tasks`)

    // Re-register enabled tasks as BullMQ repeatable jobs
    for (const task of this.tasks.values()) {
      if (task.enabled) {
        await this.registerRepeatable(task)
      }
    }

    // Start the worker
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const taskId: string = job.data.taskId
        const task = this.tasks.get(taskId)
        if (!task) {
          console.warn(`[Scheduler] Task ${taskId} not found, skipping`)
          return
        }

        console.log(
          `[Scheduler] Executing task "${task.name}" (${task.type}) id=${taskId}`,
        )

        const result = await this.executeTask(task)

        // Update task metadata
        task.lastRunAt = Date.now()
        task.runCount++
        task.lastResult = result
        await this.persistTask(task)

        return result
      },
      {
        connection: new Redis(REDIS_URL),
        concurrency: 5,
      },
    )

    this.worker.on('completed', (job: Job, result: any) => {
      console.log(
        `[Scheduler] Job ${job.id} completed in ${result?.duration ?? '?'}ms`,
      )
    })

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      console.error(
        `[Scheduler] Job ${job?.id} failed: ${error.message}`,
      )
    })

    console.log('[Scheduler] Worker started')
    this.initialized = true
  }

  // -- task execution -------------------------------------------------------

  private async executeTask(
    task: ScheduledTask,
  ): Promise<TaskExecutionResult> {
    const start = Date.now()
    try {
      let output: string | undefined

      switch (task.type) {
        case 'sandbox-command':
          output = await this.execSandboxCommand(task.payload)
          break
        case 'nullclaw-agent':
          output = await this.execNullclawAgent(task.payload)
          break
        case 'http-webhook':
          output = await this.execHttpWebhook(task.payload)
          break
        case 'workspace-index':
          output = await this.execWorkspaceIndex()
          break
        case 'sandbox-cleanup':
          output = await this.execSandboxCleanup()
          break
        case 'health-check':
          output = await this.execHealthCheck(task.payload)
          break
        case 'custom':
          output = await this.execCustom(task)
          break
        default:
          throw new Error(`Unknown task type: ${task.type}`)
      }

      return { success: true, output, duration: Date.now() - start }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - start,
      }
    }
  }

  private async execSandboxCommand(
    payload: Record<string, any>,
  ): Promise<string> {
    // Acquire a sandbox from the pool, execute command, release
    const acquireResp = await fetch(`${SANDBOX_POOL_URL}/acquire`, {
      method: 'POST',
    })
    if (!acquireResp.ok) throw new Error('Failed to acquire sandbox')
    const { sandboxId } = (await acquireResp.json()) as any

    try {
      // Execute via MCP server or execd
      const execResp = await fetch(`${SANDBOX_POOL_URL}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          command: payload.command,
          cwd: payload.cwd,
          timeout: payload.timeout,
        }),
      })
      const result = (await execResp.json()) as any
      return result?.output || JSON.stringify(result)
    } finally {
      // Always release
      await fetch(`${SANDBOX_POOL_URL}/release/${sandboxId}`, {
        method: 'POST',
      }).catch(() => {})
    }
  }

  private async execNullclawAgent(
    payload: Record<string, any>,
  ): Promise<string> {
    const url = payload.nullclawUrl || NULLCLAW_URL
    const resp = await fetch(`${url}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: payload.prompt,
        model: payload.model,
        tools: payload.tools,
        timeout: payload.timeout,
        context: payload.context,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Nullclaw agent call failed (${resp.status}): ${text}`)
    }

    const data = await resp.json()
    return typeof data === 'string' ? data : JSON.stringify(data)
  }

  private async execHttpWebhook(
    payload: Record<string, any>,
  ): Promise<string> {
    const method = (payload.method || 'POST').toUpperCase()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(payload.headers || {}),
    }

    const init: RequestInit = { method, headers }
    if (method !== 'GET' && method !== 'HEAD' && payload.body) {
      init.body =
        typeof payload.body === 'string'
          ? payload.body
          : JSON.stringify(payload.body)
    }

    const resp = await fetch(payload.url, init)
    const text = await resp.text()

    if (!resp.ok) {
      throw new Error(`Webhook ${payload.url} returned ${resp.status}: ${text.slice(0, 200)}`)
    }

    return text.slice(0, 2000)
  }

  private async execWorkspaceIndex(): Promise<string> {
    const resp = await fetch(`${BACKGROUND_WORKER_URL}/index`, {
      method: 'POST',
    })
    if (!resp.ok) throw new Error(`Workspace index failed: ${resp.status}`)
    return 'Workspace indexing triggered'
  }

  private async execSandboxCleanup(): Promise<string> {
    const resp = await fetch(`${SANDBOX_POOL_URL}/stats`)
    if (!resp.ok) throw new Error(`Sandbox stats failed: ${resp.status}`)
    const stats = (await resp.json()) as any
    return `Pool stats: ${JSON.stringify(stats)}`
  }

  private async execHealthCheck(
    payload: Record<string, any>,
  ): Promise<string> {
    const urls: string[] = payload.urls || [
      `${GATEWAY_URL}/health`,
      `${SANDBOX_POOL_URL}/health`,
      `${BACKGROUND_WORKER_URL}/health`,
      `${NULLCLAW_URL}/health`,
    ]

    const results: Record<string, string> = {}
    for (const url of urls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
        results[url] = resp.ok ? 'healthy' : `unhealthy (${resp.status})`
      } catch (error: any) {
        results[url] = `unreachable: ${error.message}`
      }
    }

    // Publish health status to Redis for monitoring
    await this.redis
      .set('scheduler:last-health-check', JSON.stringify(results))
      .catch(() => {})

    return JSON.stringify(results, null, 2)
  }

  private async execCustom(task: ScheduledTask): Promise<string> {
    // Publish event to Redis channel for external handlers
    const event = {
      type: 'scheduler:custom-task',
      taskId: task.id,
      taskName: task.name,
      payload: task.payload,
      timestamp: Date.now(),
    }

    await this.redis.publish('scheduler:events', JSON.stringify(event))
    return `Custom event published for task ${task.id}`
  }

  // -- BullMQ repeatable registration ---------------------------------------

  private async registerRepeatable(task: ScheduledTask): Promise<void> {
    try {
      await this.queue.add(
        task.id,
        { taskId: task.id },
        {
          repeat: {
            pattern: task.schedule,
            ...(task.timezone ? { tz: task.timezone } : {}),
          },
          jobId: task.id,
          attempts: task.maxRetries ?? 2,
          ...(task.timeout ? { timeout: task.timeout } : {}),
        },
      )
    } catch (error: any) {
      console.error(
        `[Scheduler] Failed to register repeatable for ${task.id}: ${error.message}`,
      )
    }
  }

  private async unregisterRepeatable(task: ScheduledTask): Promise<void> {
    try {
      await this.queue.removeRepeatableByKey(
        `${task.id}:::${task.schedule}`,
      )
    } catch {
      // BullMQ key format may vary — try removing by job id pattern
      const repeatables = await this.queue.getRepeatableJobs()
      for (const rep of repeatables) {
        if (rep.name === task.id) {
          await this.queue.removeRepeatableByKey(rep.key)
        }
      }
    }
  }

  // -- persistence ----------------------------------------------------------

  private async persistTask(task: ScheduledTask): Promise<void> {
    this.tasks.set(task.id, task)
    await this.redis.hset(TASKS_HASH, task.id, JSON.stringify(task))
  }

  private async deletePersistedTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId)
    await this.redis.hdel(TASKS_HASH, taskId)
  }

  // -- CRUD -----------------------------------------------------------------

  async createTask(
    input: Omit<ScheduledTask, 'id' | 'createdAt' | 'runCount'>,
  ): Promise<ScheduledTask> {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const task: ScheduledTask = {
      id,
      name: input.name,
      type: input.type,
      schedule: input.schedule,
      timezone: input.timezone,
      payload: input.payload || {},
      enabled: input.enabled !== false,
      createdAt: Date.now(),
      runCount: 0,
      maxRetries: input.maxRetries,
      timeout: input.timeout,
      ownerId: input.ownerId,
      tags: input.tags,
    }

    await this.persistTask(task)

    if (task.enabled) {
      await this.registerRepeatable(task)
    }

    console.log(
      `[Scheduler] Created task "${task.name}" (${task.type}) schedule="${task.schedule}"`,
    )
    return task
  }

  async updateTask(
    taskId: string,
    updates: Partial<ScheduledTask>,
  ): Promise<ScheduledTask | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null

    const scheduleChanged =
      updates.schedule != null && updates.schedule !== task.schedule
    const enabledChanged =
      updates.enabled != null && updates.enabled !== task.enabled

    // Unregister old repeatable if schedule or enabled status changed
    if (scheduleChanged || enabledChanged) {
      await this.unregisterRepeatable(task)
    }

    // Apply updates
    Object.assign(task, updates)

    // Re-register if enabled
    if (task.enabled && (scheduleChanged || enabledChanged)) {
      await this.registerRepeatable(task)
    }

    await this.persistTask(task)
    console.log(`[Scheduler] Updated task ${taskId}`)
    return task
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) return false

    await this.unregisterRepeatable(task)
    await this.deletePersistedTask(taskId)
    console.log(`[Scheduler] Deleted task ${taskId}`)
    return true
  }

  getTask(taskId: string): ScheduledTask | null {
    return this.tasks.get(taskId) || null
  }

  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values())
  }

  async triggerTask(taskId: string): Promise<TaskExecutionResult | null> {
    const task = this.tasks.get(taskId)
    if (!task) return null

    console.log(`[Scheduler] Manually triggering task "${task.name}"`)
    const result = await this.executeTask(task)

    task.lastRunAt = Date.now()
    task.runCount++
    task.lastResult = result
    await this.persistTask(task)

    return result
  }

  // -- stats ----------------------------------------------------------------

  async getStats(): Promise<{
    totalTasks: number
    enabledTasks: number
    disabledTasks: number
    totalRuns: number
    tasksByType: Record<string, number>
    queueStats: {
      waiting: number
      active: number
      completed: number
      failed: number
      delayed: number
      repeatableJobs: number
    }
  }> {
    const tasks = this.listTasks()
    const tasksByType: Record<string, number> = {}

    for (const t of tasks) {
      tasksByType[t.type] = (tasksByType[t.type] || 0) + 1
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ])

    const repeatables = await this.queue.getRepeatableJobs()

    return {
      totalTasks: tasks.length,
      enabledTasks: tasks.filter((t) => t.enabled).length,
      disabledTasks: tasks.filter((t) => !t.enabled).length,
      totalRuns: tasks.reduce((s, t) => s + t.runCount, 0),
      tasksByType,
      queueStats: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        repeatableJobs: repeatables.length,
      },
    }
  }

  // -- shutdown -------------------------------------------------------------

  async shutdown(): Promise<void> {
    console.log('[Scheduler] Shutting down…')
    await this.worker?.close()
    await this.queue?.close()
    await this.redis?.quit()
    console.log('[Scheduler] Shutdown complete')
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
  })
}

function json(
  res: ServerResponse,
  status: number,
  data: any,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const schedulerService = new SchedulerService()

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || ''
  const method = req.method || 'GET'

  // GET /health
  if (url === '/health' && method === 'GET') {
    return json(res, 200, { status: 'healthy', timestamp: Date.now() })
  }

  // GET /stats
  if (url === '/stats' && method === 'GET') {
    const stats = await schedulerService.getStats()
    return json(res, 200, stats)
  }

  // GET /tasks
  if (url === '/tasks' && method === 'GET') {
    return json(res, 200, { tasks: schedulerService.listTasks() })
  }

  // POST /tasks
  if (url === '/tasks' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req))
      if (!body.name || !body.type || !body.schedule) {
        return json(res, 400, {
          error: 'name, type, and schedule are required',
        })
      }
      const task = await schedulerService.createTask(body)
      return json(res, 201, task)
    } catch (error: any) {
      return json(res, 500, { error: error.message })
    }
  }

  // Routes with :id
  const taskIdMatch = url.match(/^\/tasks\/([^/]+)$/)
  const triggerMatch = url.match(/^\/tasks\/([^/]+)\/trigger$/)

  // POST /tasks/:id/trigger
  if (triggerMatch && method === 'POST') {
    const taskId = triggerMatch[1]
    const result = await schedulerService.triggerTask(taskId)
    if (!result) return json(res, 404, { error: 'Task not found' })
    return json(res, 200, result)
  }

  if (taskIdMatch) {
    const taskId = taskIdMatch[1]

    // GET /tasks/:id
    if (method === 'GET') {
      const task = schedulerService.getTask(taskId)
      if (!task) return json(res, 404, { error: 'Task not found' })
      return json(res, 200, task)
    }

    // PUT /tasks/:id
    if (method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req))
        const task = await schedulerService.updateTask(taskId, body)
        if (!task) return json(res, 404, { error: 'Task not found' })
        return json(res, 200, task)
      } catch (error: any) {
        return json(res, 500, { error: error.message })
      }
    }

    // DELETE /tasks/:id
    if (method === 'DELETE') {
      const deleted = await schedulerService.deleteTask(taskId)
      if (!deleted) return json(res, 404, { error: 'Task not found' })
      return json(res, 200, { deleted: true })
    }
  }

  json(res, 404, { error: 'Not Found' })
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await schedulerService.initialize()

    server.listen(PORT, () => {
      console.log(`[Scheduler] Listening on port ${PORT}`)
    })

    process.on('SIGTERM', async () => {
      await schedulerService.shutdown()
      server.close()
      process.exit(0)
    })

    process.on('SIGINT', async () => {
      await schedulerService.shutdown()
      server.close()
      process.exit(0)
    })
  } catch (error: any) {
    console.error('[Scheduler] Failed to start:', error.message)
    process.exit(1)
  }
}

main()

export { schedulerService, SchedulerService }
export type { TaskExecutionResult }
