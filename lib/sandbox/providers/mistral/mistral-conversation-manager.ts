/**
 * Mistral Conversation Manager
 *
 * Manages conversation lifecycle, history, and multi-turn interactions.
 * Additive module that enhances the core provider with advanced conversation features.
 *
 * Features:
 * - Start/append/restart conversations
 * - Conversation history retrieval
 * - Multi-turn conversation support
 * - Conversation branching
 * - Message management
 * - Streaming support
 */

import type { Mistral } from '@mistralai/mistralai'
import type {
  Conversation,
  ConversationEntry,
  StreamChunk,
  TokenUsage,
} from './mistral-types'

export interface ConversationOptions {
  /** Store conversation in Mistral cloud */
  store?: boolean
  /** Handoff execution mode */
  handoffExecution?: 'server' | 'client'
  /** Completion arguments */
  completionArgs?: {
    temperature?: number
    topP?: number
    maxTokens?: number
    [key: string]: any
  }
}

export interface ConversationAppendOptions extends ConversationOptions {
  /** Entry ID to restart from */
  fromEntryId?: string
}

// Simplified conversation entry for Mistral SDK compatibility
interface MistralConversationEntry {
  role?: 'user' | 'assistant' | 'system'
  content: string
  type?: 'message.input' | 'message.output'
}

export class MistralConversationManager {
  private client: Mistral

  constructor(client: Mistral) {
    this.client = client
  }

  /**
   * Start a new conversation
   *
   * @param agentId - Agent ID to use for conversation
   * @param inputs - Initial conversation entries
   * @param options - Conversation options
   * @returns Conversation object with ID and outputs
   */
  async startConversation(
    agentId: string,
    inputs: ConversationEntry[] | string,
    options?: ConversationOptions
  ): Promise<Conversation> {
    const normalizedInputs = this.normalizeInputs(inputs)

    const response = await this.client.beta.conversations.start({
      agentId,
      inputs: normalizedInputs as any,
      store: options?.store ?? true,
      ...(options?.completionArgs && { completionArgs: options.completionArgs }),
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs || [],
      usage: response.usage as unknown as TokenUsage,
      createdAt: new Date(),
    }
  }

  /**
   * Start conversation with streaming
   */
  async *startConversationStream(
    agentId: string,
    inputs: ConversationEntry[] | string,
    options?: ConversationOptions
  ): AsyncGenerator<StreamChunk> {
    const normalizedInputs = this.normalizeInputs(inputs)

    const stream = await this.client.beta.conversations.startStream({
      agentId,
      inputs: normalizedInputs,
      store: options?.store ?? true,
    })

    for await (const chunk of stream) {
      yield this.parseStreamChunk(chunk)
    }
  }

  /**
   * Append message to existing conversation
   *
   * @param conversationId - Conversation ID
   * @param inputs - New message entries
   * @param options - Append options
   * @returns Updated conversation
   */
  async appendMessage(
    conversationId: string,
    inputs: ConversationEntry[] | string,
    options?: ConversationAppendOptions
  ): Promise<Conversation> {
    const normalizedInputs = this.normalizeInputs(inputs)

    const response = await this.client.beta.conversations.append({
      conversationId,
      conversationAppendRequest: {
        inputs: normalizedInputs as any,
        store: options?.store ?? true,
        ...(options?.completionArgs && { completionArgs: options.completionArgs }),
      },
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs || [],
      usage: response.usage as unknown as TokenUsage,
      createdAt: new Date(),
    }
  }

  /**
   * Append message with streaming
   */
  async *appendMessageStream(
    conversationId: string,
    inputs: ConversationEntry[] | string,
    options?: ConversationAppendOptions
  ): AsyncGenerator<StreamChunk> {
    const normalizedInputs = this.normalizeInputs(inputs)

    const stream = await this.client.beta.conversations.appendStream({
      conversationId,
      conversationAppendStreamRequest: {
        inputs: normalizedInputs as any,
        store: options?.store ?? true,
      },
    })

    for await (const chunk of stream) {
      yield this.parseStreamChunk(chunk)
    }
  }

  /**
   * Restart conversation from a specific entry
   *
   * @param conversationId - Conversation ID
   * @param fromEntryId - Entry ID to restart from
   * @param inputs - New inputs after restart point
   * @param options - Restart options
   * @returns New conversation branching from entry
   */
  async restartConversation(
    conversationId: string,
    fromEntryId: string,
    inputs: ConversationEntry[] | string,
    options?: ConversationOptions
  ): Promise<Conversation> {
    const normalizedInputs = this.normalizeInputs(inputs)

    const response = await this.client.beta.conversations.restart({
      conversationId,
      conversationRestartRequest: {
        fromEntryId,
        inputs: normalizedInputs,
        store: options?.store ?? true,
      },
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs || [],
      usage: response.usage as TokenUsage,
      createdAt: new Date(),
    }
  }

  /**
   * Get conversation history
   *
   * @param conversationId - Conversation ID
   * @returns Array of conversation entries
   */
  async getHistory(conversationId: string): Promise<ConversationEntry[]> {
    const response = await this.client.beta.conversations.getHistory({
      conversationId,
    })
    return response.entries || []
  }

  /**
   * Get all messages in conversation
   *
   * @param conversationId - Conversation ID
   * @returns Array of messages
   */
  async getMessages(conversationId: string): Promise<ConversationEntry[]> {
    const response = await this.client.beta.conversations.getMessages({
      conversationId,
    })
    return response.messages || []
  }

  /**
   * List all conversations
   *
   * @param options - Pagination options
   * @returns Array of conversations
   */
  async listConversations(options?: {
    page?: number
    pageSize?: number
  }): Promise<Conversation[]> {
    const response = await this.client.beta.conversations.list({
      page: options?.page ?? 0,
      pageSize: options?.pageSize ?? 100,
    })

    return (response || []).map((conv: any) => ({
      conversationId: conv.id,
      outputs: [],
      createdAt: new Date(conv.createdAt),
      usage: undefined,
    }))
  }

  /**
   * Get conversation details
   * 
   * @param conversationId - Conversation ID
   * @returns Conversation details
   */
  async getConversation(conversationId: string): Promise<{
    id: string
    createdAt: Date
    updatedAt: Date
    agentId?: string
    model?: string
  }> {
    const response = await this.client.beta.conversations.get({
      conversationId,
    })

    return {
      id: response.id,
      createdAt: new Date((response as any).createdAt || response.created_at),
      updatedAt: new Date((response as any).updatedAt || response.updated_at),
      agentId: (response as any).agentId || (response as any).agent_id,
      model: (response as any).model,
    }
  }

  /**
   * Extract tool execution results from conversation
   * 
   * @param conversation - Conversation to extract from
   * @returns Array of tool execution results
   */
  extractToolExecutions(conversation: Conversation): Array<{
    name: string
    code?: string
    codeOutput?: string
    fileId?: string
    fileName?: string
    fileType?: string
  }> {
    const executions: any[] = []

    for (const entry of conversation.outputs) {
      const entryAny = entry as any
      if (entryAny.type === 'tool.execution') {
        const execution: any = {
          name: entryAny.name,
        }

        if (entryAny.info) {
          if (entryAny.name === 'code_interpreter') {
            execution.code = entryAny.info.code
            execution.codeOutput = entryAny.info.code_output
          }
          if (entryAny.name === 'image_generation') {
            execution.fileId = entryAny.info.file_id
          }
        }

        executions.push(execution)
      }

      // Also check message outputs for tool_file chunks
      if (entryAny.type === 'message.output' && Array.isArray(entryAny.content)) {
        for (const chunk of entryAny.content) {
          if (chunk.type === 'tool_file') {
            executions.push({
              name: chunk.tool,
              fileId: chunk.file_id,
              fileName: chunk.file_name,
              fileType: chunk.file_type,
            })
          }
        }
      }
    }

    return executions
  }

  /**
   * Extract text content from conversation
   * 
   * @param conversation - Conversation to extract from
   * @returns Combined text content
   */
  extractTextContent(conversation: Conversation): string {
    const texts: string[] = []

    for (const entry of conversation.outputs) {
      if (entry.type === 'message.output') {
        if (typeof entry.content === 'string') {
          texts.push(entry.content)
        } else if (Array.isArray(entry.content)) {
          for (const chunk of entry.content) {
            if (chunk.type === 'text' && chunk.text) {
              texts.push(chunk.text)
            }
          }
        }
      }
    }

    return texts.join('\n').trim()
  }

  /**
   * Extract code execution output
   * 
   * @param conversation - Conversation to extract from
   * @returns Code execution result or null
   */
  extractCodeExecution(conversation: Conversation): {
    code: string
    output: string
  } | null {
    for (const entry of conversation.outputs) {
      if (entry.type === 'tool.execution' && entry.name === 'code_interpreter') {
        return {
          code: entry.info?.code || '',
          output: entry.info?.code_output || '',
        }
      }
    }
    return null
  }

  /**
   * Normalize inputs to ConversationEntry array
   */
  private normalizeInputs(
    inputs: ConversationEntry[] | string
  ): ConversationEntry[] {
    if (typeof inputs === 'string') {
      return [{ role: 'user', content: inputs, type: 'message.input', object: 'entry' }]
    }
    return inputs
  }

  /**
   * Parse stream chunk from Mistral API
   */
  private parseStreamChunk(chunk: any): StreamChunk {
    return {
      type: chunk.type || 'unknown',
      content: chunk.content || chunk.text || '',
      timestamp: new Date(),
      metadata: {
        conversationId: chunk.conversation_id,
        entryId: chunk.id,
        ...chunk.metadata,
      },
    }
  }
}

/**
 * Conversation builder for fluent API
 */
export class ConversationBuilder {
  private entries: ConversationEntry[] = []
  private systemPrompt?: string

  withSystemPrompt(prompt: string): ConversationBuilder {
    this.systemPrompt = prompt
    this.entries.unshift({
      role: 'system',
      content: prompt,
      type: 'message.input',
      object: 'entry',
    })
    return this
  }

  withUserMessage(message: string): ConversationBuilder {
    this.entries.push({
      role: 'user',
      content: message,
      type: 'message.input',
      object: 'entry',
    })
    return this
  }

  withAssistantMessage(message: string): ConversationBuilder {
    this.entries.push({
      role: 'assistant',
      content: message,
      type: 'message.output',
      object: 'entry',
    })
    return this
  }

  build(): ConversationEntry[] {
    return [...this.entries]
  }
}
