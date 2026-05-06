/**
 * TerminalUse API Routes
 *
 * Endpoints for TerminalUse cloud agent operations:
 * - POST /api/sandbox/terminaluse/tasks - Create agent tasks
 * - GET /api/sandbox/terminaluse/tasks/:id - Get task status
 * - POST /api/sandbox/terminaluse/tasks/:id/events - Send events to tasks
 * - GET /api/sandbox/terminaluse/tasks/:id/stream - Stream task events (SSE)
 * - GET /api/sandbox/terminaluse/filesystems - List filesystems
 * - POST /api/sandbox/terminaluse/filesystems - Create filesystem
 *
 * @see https://docs.terminaluse.com/api-reference
 */

import { NextRequest, NextResponse } from 'next/server'


import { z } from 'zod'
import { verifyAuth } from '@/lib/auth/jwt'
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('TerminalUse:API')

const DEBUG = process.env.DEBUG_TERMINALUSE === 'true' || process.env.NODE_ENV === 'development'
const log = (...args: any[]) => DEBUG && console.log('[TerminalUse API]', ...args)
const logError = (...args: any[]) => console.error('[TerminalUse API ERROR]', ...args)

// Request schemas
const createTaskSchema = z.object({
  agent_name: z.string().optional(),
  prompt: z.string(),
  branch: z.string().optional(),
  params: z.record(z.unknown()).optional(),
  timeout: z.number().optional(),
  filesystem_id: z.string().optional(),
})

const sendEventSchema = z.object({
  content: z.union([
    z.string(),
    z.object({
      type: z.enum(['text', 'data']),
      text: z.string().optional(),
      data: z.record(z.unknown()).optional(),
    }),
  ]),
  persist_message: z.boolean().optional(),
})

const createFilesystemSchema = z.object({
  name: z.string(),
  project_id: z.string().optional(),
})

/**
 * Stream events as Server-Sent Events (SSE)
 */
function streamSSE(events: AsyncIterable<any>, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  let cancelled = false

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          if (cancelled || signal.aborted) {
            break
          }
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(encoder.encode(data))
        }
        controller.close()
      } catch (error: any) {
        controller.error(error)
      }
    },
    cancel() {
      cancelled = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * POST /api/sandbox/terminaluse/tasks
 * Create a new TerminalUse agent task
 */
export async function POST(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8)
  const startTime = Date.now()

  try {
    log(`[${requestId}] POST /api/sandbox/terminaluse/tasks`)

    // Authenticate user
    const authResult = await verifyAuth(req)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      )
    }

    const authenticatedUserId = authResult.userId

    // Rate limiting: 20 task creations per minute per user
    const rateLimitResult = checkUserRateLimit(authenticatedUserId, 'generic')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many task creations.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      )
    }

    // Parse request body
    const body = await req.json()
    const parseResult = createTaskSchema.safeParse(body)
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      return NextResponse.json(
        { error: firstError.message },
        { status: 400 }
      )
    }

    const { agent_name, prompt, branch, params, timeout, filesystem_id } = parseResult.data

    // Check if TerminalUse is configured
    const apiKey = process.env.TERMINALUSE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TerminalUse is not configured. Set TERMINALUSE_API_KEY environment variable.' },
        { status: 503 }
      )
    }

    // Import and create client
    const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
    const client = new TerminalUseClient({ apiKey })

    // Create task
    const task = await client.createTask({
      agent_name,
      branch,
      params: {
        type: 'agent',
        prompt,
        user_id: authenticatedUserId,
        ...params,
      },
      filesystem_id,
    })

    // Send initial event with prompt
    await client.sendEvent(task.id, { type: 'text', text: prompt })

    log(`[${requestId}] Task created: ${task.id}`)

    return NextResponse.json({
      task: {
        id: task.id,
        agent_name: task.agent_name,
        status: task.status,
        created_at: task.created_at,
        filesystem_id: task.filesystem_id,
      },
    })
  } catch (error: any) {
    logError(`[${requestId}] Error:`, error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to create task' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/sandbox/terminaluse/tasks/:id/stream
 * Stream task events as SSE
 */
export async function GET(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8)
  const url = new URL(req.url)
  const taskId = url.pathname.split('/').pop()

  if (!taskId) {
    return NextResponse.json({ error: 'Task ID required' }, { status: 400 })
  }

  try {
    log(`[${requestId}] GET /api/sandbox/terminaluse/tasks/${taskId}/stream`)

    // Authenticate user
    const authResult = await verifyAuth(req)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if TerminalUse is configured
    const apiKey = process.env.TERMINALUSE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TerminalUse is not configured' },
        { status: 503 }
      )
    }

    // Import and create client
    const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
    const client = new TerminalUseClient({ apiKey })

    // Verify task exists and belongs to user (simplified check)
    try {
      await client.getTask(taskId)
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // Stream events
    const abortController = new AbortController()
    req.signal.addEventListener('abort', () => abortController.abort())

    return streamSSE(client.streamTask(taskId, abortController.signal), req.signal)
  } catch (error: any) {
    logError(`[${requestId}] Error:`, error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to stream events' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/sandbox/terminaluse/tasks/:id/events
 * Send an event to a task
 */
async function POST_EVENT(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8)
  const url = new URL(req.url)
  const taskId = url.pathname.split('/').pop()?.replace('/events', '')

  if (!taskId) {
    return NextResponse.json({ error: 'Task ID required' }, { status: 400 })
  }

  try {
    log(`[${requestId}] POST /api/sandbox/terminaluse/tasks/${taskId}/events`)

    // Authenticate user
    const authResult = await verifyAuth(req)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await req.json()
    const parseResult = sendEventSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid event content' },
        { status: 400 }
      )
    }

    const { content, persist_message } = parseResult.data

    // Check if TerminalUse is configured
    const apiKey = process.env.TERMINALUSE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TerminalUse is not configured' },
        { status: 503 }
      )
    }

    // Import and create client
    const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
    const client = new TerminalUseClient({ apiKey })

    // Normalize content
    const normalizedContent = typeof content === 'string'
      ? { type: 'text' as const, text: content }
      : { type: content.type as 'text' | 'data', text: content.text, data: content.data }

    // Send event
    const event = await client.sendEvent(taskId, normalizedContent, { persist_message })

    return NextResponse.json({ event })
  } catch (error: any) {
    logError(`[${requestId}] Error:`, error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to send event' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/sandbox/terminaluse/filesystems
 * List filesystems
 */
async function GET_FILESYSTEMS(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8)

  try {
    log(`[${requestId}] GET /api/sandbox/terminaluse/filesystems`)

    // Authenticate user
    const authResult = await verifyAuth(req)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if TerminalUse is configured
    const apiKey = process.env.TERMINALUSE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TerminalUse is not configured' },
        { status: 503 }
      )
    }

    // Import and create client
    const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
    const client = new TerminalUseClient({ apiKey })

    // Get project_id from query params
    const url = new URL(req.url)
    const project_id = url.searchParams.get('project_id')

    const filesystems = await client.listFilesystems(project_id ? { project_id } : undefined)

    return NextResponse.json({
      filesystems: filesystems.map((fs: any) => ({
        id: fs.id,
        name: fs.name,
        project_id: fs.project_id,
        status: fs.status,
        created_at: fs.created_at,
        last_synced_at: fs.last_synced_at,
        archive_size_bytes: fs.archive_size_bytes,
      })),
    })
  } catch (error: any) {
    logError(`[${requestId}] Error:`, error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to list filesystems' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/sandbox/terminaluse/filesystems
 * Create a new filesystem
 */
async function POST_FILESYSTEM(req: NextRequest) {
  const requestId = Math.random().toString(36).slice(2, 8)

  try {
    log(`[${requestId}] POST /api/sandbox/terminaluse/filesystems`)

    // Authenticate user
    const authResult = await verifyAuth(req)
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await req.json()
    const parseResult = createFilesystemSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid filesystem configuration' },
        { status: 400 }
      )
    }

    const { name, project_id } = parseResult.data

    // Check if TerminalUse is configured
    const apiKey = process.env.TERMINALUSE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'TerminalUse is not configured' },
        { status: 503 }
      )
    }

    // Require project_id for filesystem creation
    if (!project_id) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      )
    }

    // Import and create client
    const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
    const client = new TerminalUseClient({ apiKey })

    const filesystem = await client.createFilesystem({ project_id, name })

    return NextResponse.json({ filesystem })
  } catch (error: any) {
    logError(`[${requestId}] Error:`, error.message)
    return NextResponse.json(
      { error: error.message || 'Failed to create filesystem' },
      { status: 500 }
    )
  }
}
