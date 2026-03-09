/**
 * Mistral Stream Handler
 * 
 * Handles streaming responses from Mistral API.
 * Additive module that provides real-time output streaming.
 * 
 * Features:
 * - Stream conversation start/append
 * - Chunk parsing and formatting
 * - Event emission
 * - Stream aggregation
 */

import type { Mistral } from '@mistralai/mistralai'
import type { StreamChunk } from './mistral-types'

export interface StreamOptions {
  /** Store conversation */
  store?: boolean
  /** Include usage stats */
  includeUsage?: boolean
  /** Chunk aggregation interval */
  aggregationIntervalMs?: number
}

export interface StreamEvents {
  /** Called on each chunk */
  onChunk?: (chunk: StreamChunk) => void
  /** Called on stream start */
  onStart?: () => void
  /** Called on stream complete */
  onComplete?: (aggregatedContent: string) => void
  /** Called on error */
  onError?: (error: Error) => void
}

export class MistralStreamHandler {
  private client: Mistral

  constructor(client: Mistral) {
    this.client = client
  }

  /**
   * Stream conversation start
   */
  async *streamConversation(
    agentId: string,
    inputs: string | any[],
    options?: StreamOptions
  ): AsyncGenerator<StreamChunk> {
    const normalizedInputs = this.normalizeInputs(inputs)

    try {
      const stream = await this.client.beta.conversations.startStream({
        agentId,
        inputs: normalizedInputs,
        store: options?.store ?? true,
      })

      for await (const chunk of stream) {
        yield this.parseChunk(chunk)
      }
    } catch (error: any) {
      throw new Error(`Stream conversation failed: ${error.message}`)
    }
  }

  /**
   * Stream conversation append
   */
  async *streamAppend(
    conversationId: string,
    inputs: string | any[],
    options?: StreamOptions
  ): AsyncGenerator<StreamChunk> {
    const normalizedInputs = this.normalizeInputs(inputs)

    try {
      const stream = await this.client.beta.conversations.appendStream({
        conversationId,
        conversationAppendRequest: {
          inputs: normalizedInputs,
          store: options?.store ?? true,
        },
      })

      for await (const chunk of stream) {
        yield this.parseChunk(chunk)
      }
    } catch (error: any) {
      throw new Error(`Stream append failed: ${error.message}`)
    }
  }

  /**
   * Stream with event callbacks
   */
  async streamWithEvents(
    agentId: string,
    inputs: string | any[],
    events: StreamEvents,
    options?: StreamOptions
  ): Promise<string> {
    const chunks: string[] = []

    try {
      events.onStart?.()

      const stream = this.streamConversation(agentId, inputs, options)

      for await (const chunk of stream) {
        chunks.push(chunk.content)
        events.onChunk?.(chunk)
      }

      const aggregatedContent = chunks.join('')
      events.onComplete?.(aggregatedContent)
      
      return aggregatedContent
    } catch (error: any) {
      events.onError?.(error)
      throw error
    }
  }

  /**
   * Aggregate stream chunks
   */
  async aggregateStream(
    agentId: string,
    inputs: string | any[],
    options?: StreamOptions & {
      aggregationIntervalMs?: number
    }
  ): Promise<{
    content: string
    chunks: StreamChunk[]
    duration: number
  }> {
    const startTime = Date.now()
    const chunks: StreamChunk[] = []
    const contents: string[] = []

    const stream = this.streamConversation(agentId, inputs, options)

    for await (const chunk of stream) {
      chunks.push(chunk)
      contents.push(chunk.content)
    }

    return {
      content: contents.join(''),
      chunks,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Stream code execution with real-time output
   */
  async *streamCodeExecution(
    agentId: string,
    code: string,
    options?: StreamOptions
  ): AsyncGenerator<StreamChunk & {
    isCodeExecution?: boolean
    codeOutput?: string
  }> {
    const prompt = `Execute the following code and show output in real-time:\n\n\`\`\`\n${code}\n\`\`\``

    const stream = this.streamConversation(agentId, prompt, options)

    for await (const chunk of stream) {
      yield {
        ...chunk,
        isCodeExecution: true,
      }
    }
  }

  /**
   * Parse stream chunk from API
   */
  private parseChunk(chunk: any): StreamChunk {
    return {
      type: chunk.type || 'unknown',
      content: chunk.content || chunk.text || chunk.delta || '',
      timestamp: new Date(),
      metadata: {
        conversationId: chunk.conversation_id,
        entryId: chunk.id,
        ...chunk.metadata,
      },
    }
  }

  /**
   * Normalize inputs to array format
   */
  private normalizeInputs(inputs: string | any[]): any[] {
    if (typeof inputs === 'string') {
      return [{
        role: 'user',
        content: inputs,
        type: 'message.input',
        object: 'entry',
      }]
    }
    return inputs
  }
}

/**
 * Stream aggregator for collecting and processing chunks
 */
export class StreamAggregator {
  private chunks: StreamChunk[] = []
  private contentParts: string[] = []
  private startTime: number

  constructor() {
    this.startTime = Date.now()
  }

  /**
   * Add chunk to aggregator
   */
  addChunk(chunk: StreamChunk): void {
    this.chunks.push(chunk)
    if (chunk.content) {
      this.contentParts.push(chunk.content)
    }
  }

  /**
   * Get aggregated content
   */
  getContent(): string {
    return this.contentParts.join('')
  }

  /**
   * Get all chunks
   */
  getChunks(): StreamChunk[] {
    return [...this.chunks]
  }

  /**
   * Get stream duration
   */
  getDuration(): number {
    return Date.now() - this.startTime
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunks.length
  }

  /**
   * Reset aggregator
   */
  reset(): void {
    this.chunks = []
    this.contentParts = []
    this.startTime = Date.now()
  }

  /**
   * Get statistics
   */
  getStats(): {
    chunkCount: number
    totalContentLength: number
    duration: number
    chunksPerSecond: number
    averageChunkSize: number
  } {
    const duration = this.getDuration()
    const totalLength = this.contentParts.reduce((sum, part) => sum + part.length, 0)
    
    return {
      chunkCount: this.chunks.length,
      totalContentLength: totalLength,
      duration,
      chunksPerSecond: duration > 0 ? (this.chunks.length / duration) * 1000 : 0,
      averageChunkSize: this.chunks.length > 0 ? totalLength / this.chunks.length : 0,
    }
  }
}

/**
 * Stream transformer for processing chunks
 */
export class StreamTransformer {
  private transformations: Array<(chunk: StreamChunk) => StreamChunk> = []

  /**
   * Add transformation
   */
  addTransformation(
    transform: (chunk: StreamChunk) => StreamChunk
  ): StreamTransformer {
    this.transformations.push(transform)
    return this
  }

  /**
   * Filter chunks
   */
  filter(
    predicate: (chunk: StreamChunk) => boolean
  ): StreamTransformer {
    this.addTransformation(chunk => {
      if (predicate(chunk)) {
        return chunk
      }
      return { ...chunk, content: '' }
    })
    return this
  }

  /**
   * Map chunk content
   */
  mapContent(
    mapper: (content: string) => string
  ): StreamTransformer {
    this.addTransformation(chunk => ({
      ...chunk,
      content: mapper(chunk.content),
    }))
    return this
  }

  /**
   * Remove empty chunks
   */
  removeEmpty(): StreamTransformer {
    return this.filter(chunk => chunk.content.trim().length > 0)
  }

  /**
   * Apply all transformations
   */
  transform(chunk: StreamChunk): StreamChunk {
    let transformed = { ...chunk }
    for (const transform of this.transformations) {
      transformed = transform(transformed)
    }
    return transformed
  }

  /**
   * Create async generator with transformations
   */
  async *transformStream(
    stream: AsyncGenerator<StreamChunk>
  ): AsyncGenerator<StreamChunk> {
    for await (const chunk of stream) {
      yield this.transform(chunk)
    }
  }
}
