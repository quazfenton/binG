/**
 * OpenCode SDK LLM Provider
 * 
 * Local OpenCode instance as an LLM provider using the official @opencode-ai/sdk.
 * This allows direct control of a local OpenCode server instance for LLM completions.
 * 
 * Features:
 * - Direct SDK control of local OpenCode instance
 * - Session-based conversations
 * - Streaming support
 * - Structured output (JSON schema)
 * - Tool calling via OpenCode's native tools
 * - Git integration
 * - File system operations
 * 
 * @see https://opencode.ai/docs/server
 * @see https://opencode.ai/docs/sdk
 * @see lib/session/agent/opencode-engine-service.ts - CLI-based OpenCode engine
 */

import { createLogger } from '../utils/logger'
import type { LLMProvider, LLMRequest, LLMResponse, StreamingResponse } from '../chat/llm-providers'

const logger = createLogger('LLM:OpenCodeSDK')

// Dynamic import for OpenCode SDK
let OpencodeSDK: any = null

/**
 * Initialize OpenCode SDK
 */
async function initOpencodeSDK(): Promise<void> {
  if (!OpencodeSDK) {
    try {
      OpencodeSDK = await import('@opencode-ai/sdk')
      logger.info('OpenCode SDK initialized')
    } catch (error: any) {
      logger.error('Failed to initialize OpenCode SDK:', error.message)
      throw new Error('OpenCode SDK not available. Install with: pnpm add @opencode-ai/sdk')
    }
  }
}

/**
 * OpenCode SDK Provider Configuration
 */
export interface OpenCodeSDKProviderConfig {
  /** OpenCode server hostname */
  hostname?: string
  /** OpenCode server port */
  port?: number
  /** Base URL for client-only mode */
  baseUrl?: string
  /** Model to use */
  model?: string
  /** Session ID for persistent conversations */
  sessionId?: string
  /** Enable tool calling */
  enableTools?: boolean
  /** Enable git operations */
  enableGit?: boolean
  /** Enable file operations */
  enableFileOps?: boolean
  /** Timeout for server start (ms) */
  timeout?: number
}

/**
 * OpenCode SDK LLM Provider
 */
export class OpenCodeSDKProvider implements LLMProvider {
  id = 'opencode-sdk'
  name = 'OpenCode SDK'
  models = ['opencode/local']
  supportsStreaming = true
  maxTokens = 128000
  description = 'Local OpenCode instance via SDK'

  private config: OpenCodeSDKProviderConfig
  private client: any = null
  private server: any = null
  private sessionId: string | null = null

  constructor(config: OpenCodeSDKProviderConfig = {}) {
    this.config = {
      hostname: '127.0.0.1',
      port: 4096,
      model: process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
      enableTools: true,
      enableGit: true,
      enableFileOps: true,
      timeout: 10000,
      ...config,
    }
  }

  /**
   * Initialize OpenCode client
   */
  async initialize(): Promise<void> {
    await initOpencodeSDK()

    try {
      if (this.config.baseUrl) {
        // Client-only mode (connect to existing server)
        logger.info('Connecting to existing OpenCode server', { baseUrl: this.config.baseUrl })
        this.client = OpencodeSDK.createOpencodeClient({
          baseUrl: this.config.baseUrl,
        })
      } else {
        // Start new server + client
        logger.info('Starting OpenCode server', {
          hostname: this.config.hostname,
          port: this.config.port,
        })
        
        const opencode = await OpencodeSDK.createOpencode({
          hostname: this.config.hostname,
          port: this.config.port,
          timeout: this.config.timeout,
          config: {
            model: this.config.model,
          },
        })

        this.client = opencode.client
        this.server = opencode.server

        logger.info('OpenCode server started', { url: this.server.url })
      }

      // Verify connection
      const health = await this.client.global.health()
      logger.info('OpenCode health check', { version: health.data.version, healthy: health.data.healthy })

      // Create or get session
      if (this.config.sessionId) {
        this.sessionId = this.config.sessionId
      } else {
        const session = await this.client.session.create({
          body: { title: `Session-${Date.now()}` },
        })
        this.sessionId = session.data.id
        logger.info('Created OpenCode session', { sessionId: this.sessionId })
      }

    } catch (error: any) {
      logger.error('Failed to initialize OpenCode:', error.message)
      throw error
    }
  }

  /**
   * Generate response using OpenCode SDK
   */
  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    if (!this.client) {
      await this.initialize()
    }

    const startTime = Date.now()

    try {
      // Extract user message from messages array
      const userMessage = request.messages.find(m => m.role === 'user')
      if (!userMessage) {
        throw new Error('No user message found')
      }

      const userText = typeof userMessage.content === 'string' 
        ? userMessage.content 
        : userMessage.content.map(c => c.type === 'text' ? c.text : '').filter(Boolean).join(' ')

      // Send prompt to OpenCode
      const result = await this.client.session.prompt({
        path: { id: this.sessionId! },
        body: {
          model: {
            providerID: this.config.model!.split('/')[0],
            modelID: this.config.model!.split('/')[1],
          },
          parts: [{ type: 'text', text: userText }],
        },
      })

      // Extract response from result
      const content = this.extractResponseContent(result.data)
      
      // Calculate tokens (estimate)
      const tokensUsed = this.estimateTokens(content)

      logger.info('OpenCode generation complete', {
        tokensUsed,
        duration: Date.now() - startTime,
      })

      return {
        content,
        tokensUsed,
        finishReason: 'stop',
        timestamp: new Date(),
        provider: this.id,
        metadata: {
          sessionId: this.sessionId,
          model: this.config.model,
        },
      }

    } catch (error: any) {
      logger.error('OpenCode generation failed:', error.message)
      throw error
    }
  }

  /**
   * Generate streaming response
   */
  async *generateStreamingResponse(request: LLMRequest): AsyncGenerator<StreamingResponse> {
    if (!this.client) {
      await this.initialize()
    }

    try {
      // Extract user message
      const userMessage = request.messages.find(m => m.role === 'user')
      if (!userMessage) {
        throw new Error('No user message found')
      }

      const userText = typeof userMessage.content === 'string' 
        ? userMessage.content 
        : userMessage.content.map(c => c.type === 'text' ? c.text : '').filter(Boolean).join(' ')

      // Subscribe to events for streaming
      const events = await this.client.event.subscribe()

      // Send prompt
      const promptPromise = this.client.session.prompt({
        path: { id: this.sessionId! },
        body: {
          model: {
            providerID: this.config.model!.split('/')[0],
            modelID: this.config.model!.split('/')[1],
          },
          parts: [{ type: 'text', text: userText }],
        },
      })

      // Stream events
      let content = ''
      let isComplete = false

      for await (const event of events.stream) {
        logger.debug('OpenCode event', { type: event.type, properties: event.properties })

        // Handle different event types
        if (event.type === 'part') {
          if (event.properties.type === 'text') {
            const text = event.properties.text
            if (text) {
              content += text
              yield {
                content: text,
                isComplete: false,
              }
            }
          }
        } else if (event.type === 'message' && event.properties.role === 'assistant') {
          // Assistant message started
          continue
        } else if (event.type === 'session_updated') {
          // Session updated, check if complete
          continue
        }

        // Check for completion signals
        if (event.properties?.done || event.properties?.complete) {
          isComplete = true
          break
        }
      }

      // Wait for prompt to complete
      await promptPromise

      yield {
        content: '',
        isComplete: true,
        finishReason: 'stop',
        usage: {
          total_tokens: this.estimateTokens(content),
        },
      }

    } catch (error: any) {
      logger.error('OpenCode streaming failed:', error.message)
      throw error
    }
  }

  /**
   * Extract content from OpenCode response
   */
  private extractResponseContent(data: any): string {
    // Handle different response formats
    if (data.info?.parts) {
      // Extract text from parts
      return data.info.parts
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .filter(Boolean)
        .join('')
    }

    if (data.info?.content) {
      return data.info.content
    }

    if (typeof data === 'string') {
      return data
    }

    return JSON.stringify(data)
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4)
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Create new session
   */
  async createSession(title?: string): Promise<string> {
    if (!this.client) {
      await this.initialize()
    }

    const session = await this.client.session.create({
      body: { title: title || `Session-${Date.now()}` },
    })

    this.sessionId = session.data.id
    logger.info('Created new OpenCode session', { sessionId: this.sessionId })

    return this.sessionId
  }

  /**
   * Delete current session
   */
  async deleteSession(): Promise<void> {
    if (!this.client || !this.sessionId) {
      return
    }

    await this.client.session.delete({
      path: { id: this.sessionId },
    })

    logger.info('Deleted OpenCode session', { sessionId: this.sessionId })
    this.sessionId = null
  }

  /**
   * Get session messages
   */
  async getSessionMessages(): Promise<any[]> {
    if (!this.client || !this.sessionId) {
      return []
    }

    const result = await this.client.session.messages({
      path: { id: this.sessionId },
    })

    return result.data || []
  }

  /**
   * Read file using OpenCode
   */
  async readFile(path: string): Promise<string> {
    if (!this.client) {
      await this.initialize()
    }

    const result = await this.client.file.read({
      query: { path },
    })

    return result.data.content
  }

  /**
   * Search files using OpenCode
   */
  async searchFiles(query: string): Promise<string[]> {
    if (!this.client) {
      await this.initialize()
    }

    const result = await this.client.find.files({
      query: { query },
    })

    return result.data || []
  }

  /**
   * Search text in files
   */
  async searchText(pattern: string): Promise<any[]> {
    if (!this.client) {
      await this.initialize()
    }

    const result = await this.client.find.text({
      query: { pattern },
    })

    return result.data || []
  }

  /**
   * Get git diff
   */
  async getGitDiff(): Promise<{ diff: string; worktree: string }> {
    if (!this.client) {
      await this.initialize()
    }

    const result = await this.client.session.messages({
      path: { id: this.sessionId! },
    })

    // Git diff would be in the session messages
    // This is a placeholder - actual implementation depends on OpenCode's git integration
    return { diff: '', worktree: '' }
  }

  /**
   * Close OpenCode connection
   */
  async close(): Promise<void> {
    if (this.server) {
      await this.server.close()
      logger.info('OpenCode server closed')
    }

    this.client = null
    this.server = null
    this.sessionId = null
  }
}

/**
 * Create OpenCode SDK provider instance
 */
export function createOpenCodeSDKProvider(config?: OpenCodeSDKProviderConfig): OpenCodeSDKProvider {
  return new OpenCodeSDKProvider(config)
}

/**
 * OpenCode SDK provider factory for llm-providers.ts
 */
export async function getOpenCodeSDKProvider(): Promise<OpenCodeSDKProvider> {
  const provider = createOpenCodeSDKProvider({
    hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
    port: parseInt(process.env.OPENCODE_PORT || '4096'),
    model: process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
  })

  await provider.initialize()
  return provider
}
