/**
 * Enhanced SSE Event Streaming for AI State/Thinking
 * 
 * Streams real-time AI state events including:
 * - Reasoning/thinking traces
 * - Tool invocations with state
 * - Processing steps
 * - Filesystem changes
 * - Git diffs
 * - Sandbox output
 * 
 * Integrates with:
 * - lib/api/response-router.ts - createStreamingEvents()
 * - lib/streaming/sse-event-schema.ts - Canonical SSE types
 * - app/api/chat/route.ts - Streaming endpoint
 * - components/agent/AgentTerminal.tsx - UI display
 * 
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/streaming
 */

import { generateSecureId } from '../utils'
import { sseEncode, type SSEEventTypeName } from '../streaming/sse-event-schema'

export interface StreamingEventOptions {
  requestId?: string
  includeReasoning?: boolean
  includeToolState?: boolean
  includeFilesystem?: boolean
  includeDiffs?: boolean
  chunkSize?: number
}

/**
 * Create streaming events from unified response
 * 
 * Converts response data into SSE events for real-time UI updates
 */
export function createStreamingEvents(
  response: any,
  requestId: string,
  options: StreamingEventOptions = {}
): string[] {
  const {
    includeReasoning = true,
    includeToolState = true,
    includeFilesystem = true,
    includeDiffs = true,
    chunkSize = 30,
  } = options

  const events: string[] = []

  // Init event
  events.push(sseEncode('token', {
    requestId,
    startTime: Date.now(),
    provider: response.data?.provider,
    model: response.data?.model,
    source: response.source,
    priority: response.priority,
  }))

  // Processing steps if available
  if (response.data?.processingSteps?.length) {
    response.data.processingSteps.forEach((step: any, index: number) => {
      events.push(sseEncode('step', {
        requestId,
        stepIndex: index,
        ...step,
      }))
    })
  }

  // Reasoning trace for explainability
  if (includeReasoning && response.data?.reasoning) {
    events.push(sseEncode('reasoning', {
      requestId,
      reasoning: response.data.reasoning,
    }))
  }

  // Tool invocation lifecycle for agentic UI
  if (includeToolState && response.data?.toolInvocations?.length) {
    const startedAt = new Map<string, number>()
    
    response.data.toolInvocations.forEach((invocation: any) => {
      const now = Date.now()
      const toolCallId = invocation?.toolCallId || `tool-${generateSecureId('call')}`
      
      if (invocation?.state === 'call') {
        startedAt.set(toolCallId, now)
      }
      
      const latencyMs = invocation?.state === 'result'
        ? now - (startedAt.get(toolCallId) || now)
        : undefined

      const payload = {
        ...invocation,
        toolCallId,
        requestId,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      }

      events.push(sseEncode('tool_invocation', payload))
      
      // Also emit step metric for tool calls
      events.push(sseEncode('step_metric', {
        requestId,
        toolCallId,
        toolName: invocation?.toolName,
        state: invocation?.state,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      }))
    })
  }

  // Filesystem changes
  if (includeFilesystem && response.data?.files?.length) {
    events.push(sseEncode('filesystem', {
      requestId,
      files: response.data.files,
    }))
  }

  // Git-style diffs for client sync
  if (includeDiffs && response.commands?.write_diffs?.length) {
    events.push(sseEncode('diffs', {
      requestId,
      files: response.commands.write_diffs.map((diff: any) => ({
        path: diff.path,
        diff: diff.diff,
        changeType: 'update' as const,
      })),
      count: response.commands.write_diffs.length,
    }))
  }

  // Content tokens (chunked for smooth streaming)
  const content = response.content
  if (content) {
    const chunks = chunkContent(content, chunkSize)
    chunks.forEach((chunk, index) => {
      events.push(sseEncode('token', {
        type: 'token',
        content: chunk,
        requestId,
        timestamp: Date.now(),
        offset: index * chunkSize,
      }))
    })
  }

  // Reflection results if available
  if (response.data?.reflectionResults?.length) {
    events.push(sseEncode('reflection', {
      requestId,
      reflections: response.data.reflectionResults,
      qualityScore: response.data.qualityScore,
    }))
  }

  // Multimodal content if available
  if (response.data?.multiModalContent?.length) {
    response.data.multiModalContent.forEach((item: any, index: number) => {
      events.push(sseEncode('multimodal', {
        requestId,
        index,
        ...item,
      }))
    })
  }

  // Sandbox output chunks (extracted from tool results)
  const sandboxChunks = extractSandboxOutputChunks(response.data?.toolInvocations || [])
  for (const chunk of sandboxChunks) {
    events.push(sseEncode('sandbox_output', {
      requestId,
      ...chunk,
      timestamp: Date.now(),
    }))
  }

  // Done event
  events.push(sseEncode('done', {
    requestId,
    success: response.success,
    totalTokens: response.data?.usage?.totalTokens || content?.length || 0,
    qualityScore: response.data?.qualityScore,
    source: response.source,
    metadata: response.metadata,
    messageMetadata: response.data?.messageMetadata || response.metadata?.messageMetadata,
  }))

  return events
}

/**
 * Extract sandbox output chunks from tool invocations
 */
function extractSandboxOutputChunks(
  invocations: Array<{ result?: any; args?: any }>,
): Array<{ stream: 'stdout' | 'stderr'; chunk: string; toolCallId?: string }> {
  const chunks: Array<{ stream: 'stdout' | 'stderr'; chunk: string; toolCallId?: string }> = []

  for (const invocation of invocations) {
    const result = invocation?.result || {}
    const output = result?.output
    const error = result?.error

    if (typeof output === 'string' && output.trim()) {
      for (const part of chunkText(output, 800)) {
        chunks.push({ stream: 'stdout' as const, chunk: part, toolCallId: (invocation as any)?.toolCallId })
      }
    } else if (output && typeof output === 'object') {
      if (typeof output.stdout === 'string' && output.stdout.trim()) {
        for (const part of chunkText(output.stdout, 800)) {
          chunks.push({ stream: 'stdout' as const, chunk: part, toolCallId: (invocation as any)?.toolCallId })
        }
      }
      if (typeof output.stderr === 'string' && output.stderr.trim()) {
        for (const part of chunkText(output.stderr, 800)) {
          chunks.push({ stream: 'stderr' as const, chunk: part, toolCallId: (invocation as any)?.toolCallId })
        }
      }
    }

    if (typeof error === 'string' && error.trim()) {
      for (const part of chunkText(error, 800)) {
        chunks.push({ stream: 'stderr' as const, chunk: part, toolCallId: (invocation as any)?.toolCallId })
      }
    }
  }

  return chunks
}

/**
 * Chunk text for streaming
 */
function chunkText(text: string, maxSize: number): string[] {
  const chunks: string[] = []
  let offset = 0

  while (offset < text.length) {
    let endOffset = Math.min(offset + maxSize, text.length)

    // Try to break at word boundaries
    if (endOffset < text.length) {
      const nextSpace = text.indexOf(' ', endOffset)
      const nextNewline = text.indexOf('\n', endOffset)

      if (nextSpace !== -1 && nextSpace - endOffset < 20) {
        endOffset = nextSpace
      } else if (nextNewline !== -1 && nextNewline - endOffset < 30) {
        endOffset = nextNewline + 1
      }
    }

    chunks.push(text.slice(offset, endOffset))
    offset = endOffset
  }

  return chunks
}

/**
 * Build supplemental agentic events from response
 * 
 * Adds reasoning, tool invocations, and sandbox output that may not have been
 * included in the initial streaming events
 */
export function buildSupplementalAgenticEvents(
  response: any,
  requestId: string,
  existingEvents: string[] = []
): string[] {
  const events: string[] = []
  const hasReasoningEvent = existingEvents.some((event) => String(event).startsWith('event: reasoning'))
  const hasToolInvocationEvent = existingEvents.some((event) => String(event).startsWith('event: tool_invocation'))

  const reasoning = response?.data?.reasoning || response?.metadata?.reasoning
  const toolInvocations = Array.isArray(response?.data?.toolInvocations)
    ? response.data.toolInvocations
    : []

  // Add reasoning if not already present
  if (!hasReasoningEvent && typeof reasoning === 'string' && reasoning.trim()) {
    events.push(sseEncode('reasoning', {
      requestId,
      reasoning: reasoning.trim(),
      timestamp: Date.now(),
    }))
  }

  // Add tool invocations if not already present
  if (!hasToolInvocationEvent && toolInvocations.length > 0) {
    const startedAt = new Map<string, number>()
    for (const invocation of toolInvocations) {
      const now = Date.now()
      const toolCallId = invocation?.toolCallId || `tool-${generateSecureId('call')}`
      if (invocation?.state === 'call') {
        startedAt.set(toolCallId, now)
      }
      const latencyMs =
        invocation?.state === 'result'
          ? now - (startedAt.get(toolCallId) || now)
          : undefined

      const payload = {
        ...invocation,
        toolCallId,
        requestId,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      }

      events.push(sseEncode('tool_invocation', payload))
      events.push(sseEncode('step_metric', {
        requestId,
        toolCallId,
        toolName: invocation?.toolName,
        state: invocation?.state,
        timestamp: now,
        ...(typeof latencyMs === 'number' ? { latencyMs } : {}),
      }))
    }
  }

  // Add sandbox output chunks
  const sandboxChunks = extractSandboxOutputChunks(toolInvocations)
  for (const chunk of sandboxChunks) {
    events.push(sseEncode('sandbox_output', {
      requestId,
      ...chunk,
      timestamp: Date.now(),
    }))
  }

  return events
}
