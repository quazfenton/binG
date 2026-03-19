/**
 * OpenCode Event Stream Service
 * 
 * Provides real-time event streaming via OpenCode server SSE endpoints.
 * Enables live updates for file changes, tool calls, and session updates.
 * 
 * Features:
 * - Real-time event streaming
 * - Tool call interception
 * - Session state tracking
 * - Text chunk streaming
 * - Error handling
 * 
 * @see https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('OpenCode:EventStream')

export type EventType =
  | 'part'
  | 'tool_call'
  | 'session_updated'
  | 'session_created'
  | 'session_deleted'
  | 'message_created'
  | 'message_updated'
  | 'error'
  | 'diff_updated'
  | 'file_changed'

export interface OpencodeEvent {
  type: EventType
  properties: Record<string, any>
  timestamp?: number
}

export interface OpencodeEventHandler {
  onTextChunk?: (text: string, sessionId?: string) => void
  onToolCall?: (tool: string, args: any, sessionId?: string) => void
  onSessionUpdate?: (session: any) => void
  onSessionCreated?: (session: any) => void
  onSessionDeleted?: (sessionId: string) => void
  onMessageCreated?: (message: any) => void
  onMessageUpdated?: (message: any) => void
  onDiffUpdated?: (diff: string, sessionId?: string) => void
  onFileChanged?: (path: string, sessionId?: string) => void
  onError?: (error: Error, sessionId?: string) => void
}

export interface OpencodeEventStreamConfig {
  baseUrl?: string
  hostname?: string
  port?: number
  reconnectDelay?: number
  maxReconnectAttempts?: number
}

export class OpencodeEventStream {
  private baseUrl: string
  private reconnectDelay: number
  private maxReconnectAttempts: number
  private eventSource: EventSource | null = null
  private handlers: OpencodeEventHandler[] = []
  private reconnectAttempts = 0
  private isConnecting = false

  constructor(config: OpencodeEventStreamConfig = {}) {
    const hostname = config.hostname || process.env.OPENCODE_HOSTNAME || '127.0.0.1'
    const port = config.port || parseInt(process.env.OPENCODE_PORT || '4096')
    this.baseUrl = config.baseUrl || `http://${hostname}:${port}`
    this.reconnectDelay = config.reconnectDelay || 3000
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5
  }

  /**
   * Subscribe to global event stream
   * 
   * GET /global/event (SSE stream)
   * 
   * @param handler - Event handler callbacks
   * @returns Unsubscribe function
   * 
   * @example
   * ```typescript
   * const unsubscribe = eventStream.subscribe({
   *   onTextChunk: (text) => console.log('Stream:', text),
   *   onToolCall: (tool, args) => console.log('Tool:', tool, args),
   *   onSessionUpdate: (session) => console.log('Session:', session),
   * })
   * 
   * // Later...
   * unsubscribe()
   * ```
   */
  subscribe(handler: OpencodeEventHandler): () => void {
    this.handlers.push(handler)
    logger.debug('Event handler subscribed')

    // Start connection if not already connected
    if (!this.eventSource && !this.isConnecting) {
      this.connect()
    }

    // Return unsubscribe function
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
      logger.debug('Event handler unsubscribed')

      // Close connection if no more handlers
      if (this.handlers.length === 0) {
        this.disconnect()
      }
    }
  }

  /**
   * Subscribe to session-specific events
   * 
   * Filters events to only those for a specific session
   * 
   * @param sessionId - Session ID to filter by
   * @param handler - Event handler callbacks
   * @returns Unsubscribe function
   */
  subscribeToSession(sessionId: string, handler: OpencodeEventHandler): () => void {
    const wrappedHandler: OpencodeEventHandler = {
      onTextChunk: (text, eventSessionId) => {
        if (eventSessionId === sessionId) {
          handler.onTextChunk?.(text, sessionId)
        }
      },
      onToolCall: (tool, args, eventSessionId) => {
        if (eventSessionId === sessionId) {
          handler.onToolCall?.(tool, args, sessionId)
        }
      },
      onSessionUpdate: (session) => {
        if (session.id === sessionId) {
          handler.onSessionUpdate?.(session)
        }
      },
      onDiffUpdated: (diff, eventSessionId) => {
        if (eventSessionId === sessionId) {
          handler.onDiffUpdated?.(diff, sessionId)
        }
      },
      onFileChanged: (path, eventSessionId) => {
        if (eventSessionId === sessionId) {
          handler.onFileChanged?.(path, sessionId)
        }
      },
      onError: (error, eventSessionId) => {
        if (eventSessionId === sessionId) {
          handler.onError?.(error, sessionId)
        }
      },
    }

    return this.subscribe(wrappedHandler)
  }

  /**
   * Connect to event stream
   */
  private connect(): void {
    if (this.isConnecting) {
      logger.debug('Already connecting to event stream')
      return
    }

    this.isConnecting = true
    const url = `${this.baseUrl}/global/event`

    logger.debug(`Connecting to event stream: ${url}`)

    try {
      // Use global EventSource if available (browser), otherwise use node-fetch with SSE
      if (typeof EventSource !== 'undefined') {
        // Browser environment
        this.eventSource = new EventSource(url)

        this.eventSource.onopen = () => {
          logger.info('Connected to event stream')
          this.isConnecting = false
          this.reconnectAttempts = 0
        }

        this.eventSource.onmessage = (event) => {
          try {
            const opencodeEvent: OpencodeEvent = JSON.parse(event.data)
            this.handleEvent(opencodeEvent)
          } catch (error: any) {
            logger.error('Failed to parse event:', error.message)
          }
        }

        this.eventSource.onerror = (error) => {
          logger.error('Event stream error:', error)
          this.isConnecting = false

          // Attempt reconnection
          this.handleReconnect()
        }
      } else {
        // Node.js environment - use fetch with streaming
        logger.warn('EventSource not available, using fetch streaming')
        this.connectWithFetch(url)
      }
    } catch (error: any) {
      logger.error('Failed to connect to event stream:', error.message)
      this.isConnecting = false
      this.handleReconnect()
    }
  }

  /**
   * Connect using fetch with streaming (Node.js fallback)
   */
  private async connectWithFetch(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/event-stream',
        },
      })

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect: ${response.status}`)
      }

      logger.info('Connected to event stream (fetch)')
      this.isConnecting = false
      this.reconnectAttempts = 0

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              this.handleEvent(data as OpencodeEvent)
            } catch (error: any) {
              logger.error('Failed to parse SSE data:', error.message)
            }
          }
        }
      }
    } catch (error: any) {
      logger.error('Fetch stream error:', error.message)
      this.isConnecting = false
      this.handleReconnect()
    }
  }

  /**
   * Handle incoming event
   */
  private handleEvent(event: OpencodeEvent): void {
    logger.debug(`Received event: ${event.type}`, event.properties);

    switch (event.type) {
      case 'part':
        this.handlePartEvent(event)
        break

      case 'tool_call':
        this.handleToolCallEvent(event)
        break

      case 'session_updated':
      case 'session_created':
      case 'session_deleted':
        this.handleSessionEvent(event)
        break

      case 'message_created':
      case 'message_updated':
        this.handleMessageEvent(event)
        break

      case 'diff_updated':
        this.handleDiffEvent(event)
        break

      case 'file_changed':
        this.handleFileChangedEvent(event)
        break

      case 'error':
        this.handleErrorEvent(event)
        break

      default:
        logger.debug('Unknown event type:', event.type)
    }
  }

  /**
   * Handle part event (text chunks)
   */
  private handlePartEvent(event: OpencodeEvent): void {
    if (event.properties.type === 'text' && event.properties.text) {
      const sessionId = event.properties.sessionID
      this.handlers.forEach(h => h.onTextChunk?.(event.properties.text, sessionId))
    }
  }

  /**
   * Handle tool call event
   */
  private handleToolCallEvent(event: OpencodeEvent): void {
    const tool = event.properties.name || event.properties.tool
    const args = event.properties.arguments || event.properties.args
    const sessionId = event.properties.sessionID

    if (tool) {
      this.handlers.forEach(h => h.onToolCall?.(tool, args, sessionId))
    }
  }

  /**
   * Handle session events
   */
  private handleSessionEvent(event: OpencodeEvent): void {
    const sessionId = event.properties.id || event.properties.sessionID

    switch (event.type) {
      case 'session_created':
        this.handlers.forEach(h => h.onSessionCreated?.(event.properties))
        break

      case 'session_updated':
        this.handlers.forEach(h => h.onSessionUpdate?.(event.properties))
        break

      case 'session_deleted':
        this.handlers.forEach(h => h.onSessionDeleted?.(sessionId))
        break
    }
  }

  /**
   * Handle message events
   */
  private handleMessageEvent(event: OpencodeEvent): void {
    switch (event.type) {
      case 'message_created':
        this.handlers.forEach(h => h.onMessageCreated?.(event.properties))
        break

      case 'message_updated':
        this.handlers.forEach(h => h.onMessageUpdated?.(event.properties))
        break
    }
  }

  /**
   * Handle diff updated event
   */
  private handleDiffEvent(event: OpencodeEvent): void {
    const diff = event.properties.diff || event.properties.content
    const sessionId = event.properties.sessionID

    if (diff) {
      this.handlers.forEach(h => h.onDiffUpdated?.(diff, sessionId))
    }
  }

  /**
   * Handle file changed event
   */
  private handleFileChangedEvent(event: OpencodeEvent): void {
    const path = event.properties.path || event.properties.file
    const sessionId = event.properties.sessionID

    if (path) {
      this.handlers.forEach(h => h.onFileChanged?.(path, sessionId))
    }
  }

  /**
   * Handle error event
   */
  private handleErrorEvent(event: OpencodeEvent): void {
    const error = new Error(event.properties.message || 'Unknown error')
    const sessionId = event.properties.sessionID

    this.handlers.forEach(h => h.onError?.(error, sessionId))
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * this.reconnectAttempts

    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(() => {
      logger.debug('Attempting reconnection...')
      this.connect()
    }, delay)
  }

  /**
   * Disconnect from event stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
      logger.info('Disconnected from event stream')
    }
    this.isConnecting = false
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN
  }

  /**
   * Get connection state
   */
  getState(): 'connecting' | 'open' | 'closed' {
    if (this.isConnecting) return 'connecting'
    if (this.isConnected()) return 'open'
    return 'closed'
  }
}

/**
 * Create event stream instance
 */
export function createOpencodeEventStream(config?: OpencodeEventStreamConfig): OpencodeEventStream {
  return new OpencodeEventStream(config)
}
