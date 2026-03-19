/**
 * V2 Agent Gateway Client
 * 
 * Communicates with OpenCode V2 Agent Gateway service via HTTP/Redis.
 * Used for routing requests to containerized OpenCode workers.
 * 
 * Architecture:
 * ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
 * │   NextJS    │────▶│Agent Gateway │────▶│Agent Worker │
 * │   (app)    │     │  (gateway)   │     │  (worker)   │
 * └─────────────┘     └──────────────┘     └─────────────┘
 *                           │                    │
 *                           │ Redis Queue        │
 *                           │ (agent:jobs)       │
 *                           ▼                    ▼
 *                    ┌──────────────┐     ┌─────────────┐
 *                    │    Redis     │◀────│   OpenCode  │
 *                    │(queue/pubsub)│     │   Engine    │
 *                    └──────────────┘     └─────────────┘
 * 
 * @see lib/agent/services/agent-gateway/src/index.ts - Gateway implementation
 * @see lib/agent/services/agent-worker/src/index.ts - Worker implementation
 */

import { createLogger } from '@/lib/utils/logger'
import Redis from 'ioredis'

const logger = createLogger('V2:GatewayClient')

// Gateway configuration
const GATEWAY_URL = process.env.V2_GATEWAY_URL || 'http://localhost:3002'
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const JOB_TIMEOUT_MS = parseInt(process.env.V2_JOB_TIMEOUT_MS || '300000', 10)
const SESSION_TIMEOUT_MS = parseInt(process.env.V2_SESSION_TIMEOUT_MS || '3600000', 10)

// Redis connection for direct job queue access
let redisClient: Redis | null = null

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn('Redis retry limit reached')
          return null
        }
        return Math.min(times * 200, 2000)
      },
    })

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err.message)
    })

    redisClient.on('connect', () => {
      logger.info('Redis connected')
    })
  }
  return redisClient
}

/**
 * V2 Agent job request
 */
export interface V2JobRequest {
  userId: string
  conversationId: string
  prompt: string
  context?: string
  tools?: string[]
  model?: string
  stream?: boolean
  executionPolicy?: string
}

/**
 * V2 Agent job response
 */
export interface V2JobResponse {
  jobId: string
  sessionId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  result?: any
  error?: string
}

/**
 * V2 Agent event (from Redis PubSub)
 */
export interface V2AgentEvent {
  type: string
  sessionId: string
  data: any
  timestamp: number
}

/**
 * Submit job to V2 Agent Gateway via HTTP
 */
export async function submitJobToGateway(request: V2JobRequest): Promise<V2JobResponse> {
  try {
    const response = await fetch(`${GATEWAY_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: request.userId,
        conversationId: request.conversationId,
        prompt: request.prompt,
        context: request.context,
        tools: request.tools,
        model: request.model,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Gateway request failed' }))
      throw new Error(error.error || `Gateway HTTP ${response.status}`)
    }

    const result = await response.json()
    
    logger.info('Job submitted to gateway', {
      jobId: result.jobId,
      sessionId: result.sessionId,
      userId: request.userId,
    })

    return {
      jobId: result.jobId,
      sessionId: result.sessionId,
      status: result.status || 'pending',
    }
  } catch (error: any) {
    logger.error('Failed to submit job to gateway:', error.message)
    throw error
  }
}

/**
 * Submit job directly to Redis queue (bypasses gateway HTTP)
 * Useful for local development or when gateway is unavailable
 */
export async function submitJobToRedisQueue(request: V2JobRequest): Promise<V2JobResponse> {
  try {
    const redis = getRedisClient()
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const sessionId = `session-${request.conversationId}-${Date.now()}`

    const job = {
      id: jobId,
      sessionId,
      userId: request.userId,
      conversationId: request.conversationId,
      prompt: request.prompt,
      context: request.context,
      tools: request.tools,
      model: request.model,
      createdAt: Date.now(),
      status: 'pending',
    }

    // Push to Redis queue
    await redis.lpush('agent:jobs', JSON.stringify(job))

    // Set job metadata
    await redis.set(`agent:job:${jobId}`, JSON.stringify(job), 'EX', 3600)

    // Publish job ready event
    await redis.publish('agent:events', JSON.stringify({
      type: 'job:ready',
      sessionId,
      data: { jobId },
      timestamp: Date.now(),
    }))

    logger.info('Job submitted to Redis queue', {
      jobId,
      sessionId,
      userId: request.userId,
    })

    return {
      jobId,
      sessionId,
      status: 'pending',
    }
  } catch (error: any) {
    logger.error('Failed to submit job to Redis queue:', error.message)
    throw error
  }
}

/**
 * Get job status from gateway
 */
export async function getJobStatus(jobId: string): Promise<V2JobResponse> {
  try {
    const response = await fetch(`${GATEWAY_URL}/jobs/${jobId}`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Job status check failed' }))
      throw new Error(error.error || `Gateway HTTP ${response.status}`)
    }

    const result = await response.json()

    return {
      jobId: result.id,
      sessionId: result.sessionId,
      status: result.status,
      result: result.result,
      error: result.error,
    }
  } catch (error: any) {
    logger.error('Failed to get job status:', error.message)
    throw error
  }
}

/**
 * Subscribe to session events via SSE
 * Returns async generator for streaming events
 */
export async function* subscribeToSessionEvents(sessionId: string): AsyncGenerator<V2AgentEvent> {
  const redis = getRedisClient()
  const channel = `agent:events:${sessionId}`

  const messageQueue: V2AgentEvent[] = []
  let errorOccurred: Error | null = null
  let isDone = false

  // Create named listener so we can remove it later (prevents memory leak)
  const messageListener = (pattern: string, pchannel: string, message: string) => {
    try {
      const event: V2AgentEvent = JSON.parse(message)
      if (event.sessionId === sessionId || pchannel.includes(sessionId)) {
        messageQueue.push(event)
      }
    } catch (err: any) {
      errorOccurred = err
    }
  }

  try {
    await redis.psubscribe(channel)
    redis.on('pmessage', messageListener)

    // Poll for messages
    while (!isDone && !errorOccurred) {
      if (messageQueue.length > 0) {
        yield messageQueue.shift()!
      } else {
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    if (errorOccurred) {
      throw errorOccurred
    }
  } finally {
    redis.punsubscribe(channel)
    // Remove listener to prevent memory leak on shared Redis client
    redis.off('pmessage', messageListener)
  }
}

/**
 * Subscribe to session events via HTTP SSE stream
 * Returns ReadableStream for browser consumption
 */
export function createSSEStream(sessionId: string): ReadableStream {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const redis = getRedisClient()
      let isActive = true

      try {
        await redis.psubscribe(`agent:events:${sessionId}`)

        redis.on('pmessage', (pattern, channel, message) => {
          if (!isActive) return

          try {
            const event: V2AgentEvent = JSON.parse(message)
            if (event.sessionId === sessionId || channel.includes(sessionId)) {
              const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
              controller.enqueue(encoder.encode(sseData))
            }
          } catch (err: any) {
            logger.error('Failed to parse event:', err.message)
          }
        })

        // Send connected event
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId, timestamp: Date.now() })}\n\n`)
        )

        // Heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
          if (isActive) {
            controller.enqueue(
              encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`)
            )
          }
        }, 30000)

        // Cleanup on close
        const cleanup = () => {
          isActive = false
          clearInterval(heartbeat)
          redis.punsubscribe(`agent:events:${sessionId}`)
          controller.close()
        }

        // Store cleanup function for external cancellation
        ;(controller as any).cleanup = cleanup

      } catch (error: any) {
        logger.error('Failed to create SSE stream:', error.message)
        controller.error(error)
      }
    },

    cancel() {
      logger.info('SSE stream cancelled', { sessionId })
    },
  })
}

/**
 * Wait for job completion with timeout
 */
export async function waitForJobCompletion(
  jobId: string,
  sessionId: string,
  timeoutMs: number = JOB_TIMEOUT_MS
): Promise<V2JobResponse> {
  const startTime = Date.now()
  const redis = getRedisClient()

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      try {
        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval)
          redis.punsubscribe(`agent:events:${sessionId}`)
          reject(new Error('Job timeout'))
          return
        }

        // Check job status
        const status = await getJobStatus(jobId)

        if (status.status === 'completed') {
          clearInterval(checkInterval)
          redis.punsubscribe(`agent:events:${sessionId}`)
          resolve(status)
        } else if (status.status === 'failed') {
          clearInterval(checkInterval)
          redis.punsubscribe(`agent:events:${sessionId}`)
          reject(new Error(status.error || 'Job failed'))
        }
      } catch (error: any) {
        clearInterval(checkInterval)
        redis.punsubscribe(`agent:events:${sessionId}`)
        reject(error)
      }
    }, 1000)

    // Also listen for completion events
    redis.psubscribe(`agent:events:${sessionId}`, (err, count) => {
      if (err) {
        clearInterval(checkInterval)
        reject(err)
      }
    })

    redis.on('pmessage', async (pattern, channel, message) => {
      try {
        const event: V2AgentEvent = JSON.parse(message)
        
        if (event.type === 'job:completed' && event.data.jobId === jobId) {
          clearInterval(checkInterval)
          redis.punsubscribe(`agent:events:${sessionId}`)
          resolve({
            jobId,
            sessionId,
            status: 'completed',
            result: event.data,
          })
        } else if (event.type === 'error' && event.data.jobId === jobId) {
          clearInterval(checkInterval)
          redis.punsubscribe(`agent:events:${sessionId}`)
          reject(new Error(event.data.error || 'Job error'))
        }
      } catch (err: any) {
        // Ignore parse errors
      }
    })
  })
}

/**
 * Check gateway health
 */
export async function checkGatewayHealth(): Promise<{
  healthy: boolean
  gateway?: boolean
  redis?: boolean
  error?: string
}> {
  const result: any = {
    healthy: false,
  }

  // Check gateway HTTP
  try {
    const response = await fetch(`${GATEWAY_URL}/health`)
    result.gateway = response.ok
  } catch (error: any) {
    result.gateway = false
    result.error = error.message
  }

  // Check Redis
  try {
    const redis = getRedisClient()
    const ping = await redis.ping()
    result.redis = ping === 'PONG'
  } catch (error: any) {
    result.redis = false
    result.error = error.message
  }

  result.healthy = result.gateway && result.redis

  return result
}

/**
 * Cancel job
 */
export async function cancelJob(jobId: string): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/jobs/${jobId}`, {
      method: 'DELETE',
    })
    logger.info('Job cancelled', { jobId })
  } catch (error: any) {
    logger.error('Failed to cancel job:', error.message)
    throw error
  }
}

/**
 * Get active sessions
 */
export async function getActiveSessions(): Promise<Array<{
  id: string
  userId: string
  conversationId: string
  status: string
  jobId?: string
}>> {
  try {
    const response = await fetch(`${GATEWAY_URL}/sessions`)
    if (!response.ok) {
      throw new Error(`Gateway HTTP ${response.status}`)
    }
    const result = await response.json()
    return result.sessions || []
  } catch (error: any) {
    logger.error('Failed to get active sessions:', error.message)
    return []
  }
}

/**
 * Graceful shutdown
 */
export async function shutdown(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info('Redis connection closed')
  }
}

// Auto-cleanup on process exit
process.on('beforeExit', () => shutdown())
process.on('SIGTERM', () => shutdown())
process.on('SIGINT', () => shutdown())
