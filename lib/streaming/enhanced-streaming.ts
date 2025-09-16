"use client";

import { EventEmitter } from 'events';
import { streamingErrorHandler, type StreamingError } from './streaming-error-handler';

// Types for streaming events
export interface StreamingEvent {
  type: 'token' | 'error' | 'done' | 'heartbeat' | 'commands';
  data: any;
  timestamp: number;
  requestId: string;
}

export interface StreamingMetrics {
  timeToFirstToken: number;
  tokensPerSecond: number;
  completionLatency: number;
  totalTokens: number;
  errorCount: number;
  reconnectCount: number;
}

export interface StreamingConfig {
  heartbeatInterval: number; // 15-30s
  bufferSizeLimit: number; // 1-2KB
  maxRetries: number; // 3 attempts
  softTimeoutMs: number; // Client nudge timeout
  hardTimeoutMs: number; // Server timeout
  minChunkSize: number; // 5-10 chars
  enableBackpressure: boolean;
  enableMetrics: boolean;
}

export interface StreamChunk {
  content: string;
  timestamp: number;
  chunkId: string;
  isCommand?: boolean;
}

export class EnhancedStreamingService extends EventEmitter {
  private config: StreamingConfig;
  private activeStreams: Map<string, AbortController> = new Map();
  private streamMetrics: Map<string, StreamingMetrics> = new Map();
  private buffers: Map<string, StreamChunk[]> = new Map();
  private renderQueues: Map<string, string[]> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private renderAnimationFrames: Map<string, number> = new Map();

  constructor(config: Partial<StreamingConfig> = {}) {
    super();
    this.config = {
      heartbeatInterval: 20000, // 20 seconds
      bufferSizeLimit: 2048, // 2KB
      maxRetries: 3,
      softTimeoutMs: 30000, // 30 seconds
      hardTimeoutMs: 120000, // 2 minutes
      minChunkSize: 8, // 8 characters
      enableBackpressure: true,
      enableMetrics: true,
      ...config,
    };
  }

  /**
   * Start a new streaming request with enhanced features
   */
  async startStream(
    requestId: string,
    url: string,
    body: any,
    options: { resumeFromOffset?: number } = {}
  ): Promise<void> {
    try {
      // Clean up any existing stream with the same requestId
      this.stopStream(requestId);

      const abortController = new AbortController();
      this.activeStreams.set(requestId, abortController);

      // Initialize metrics
      if (this.config.enableMetrics) {
        this.streamMetrics.set(requestId, {
          timeToFirstToken: 0,
          tokensPerSecond: 0,
          completionLatency: 0,
          totalTokens: 0,
          errorCount: 0,
          reconnectCount: 0,
        });
        
        // Track streaming session in performance manager
      }

      // Initialize buffers
      this.buffers.set(requestId, []);
      this.renderQueues.set(requestId, []);

      // Add resume capability to body if supported
      const requestBody = {
        ...body,
        requestId,
        resumeFromOffset: options.resumeFromOffset || 0,
      };

      const startTime = Date.now();
      let firstTokenTime = 0;
      let tokenCount = 0;

      // Start heartbeat
      this.startHeartbeat(requestId);

      // Set up soft timeout
      const softTimeoutId = setTimeout(() => {
        this.emit('softTimeout', { requestId });
      }, this.config.softTimeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      clearTimeout(softTimeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            clearTimeout(softTimeoutId);
            this.finishStream(requestId, startTime);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '') continue;

            try {
              const eventData = this.parseSSELine(line);
              if (!eventData) continue;

              // Record first token time
              if (firstTokenTime === 0 && eventData.type === 'token') {
                firstTokenTime = Date.now();
                if (this.config.enableMetrics) {
                  const metrics = this.streamMetrics.get(requestId)!;
                  metrics.timeToFirstToken = firstTokenTime - startTime;
                }
              }

              // Process the event with error recovery
              await this.processStreamEventSafely(requestId, eventData, startTime);
              tokenCount++;

            } catch (parseError) {
              // Handle parsing errors gracefully without exposing to user
              console.warn('SSE parsing error (recovered):', {
                line: line.substring(0, 100) + (line.length > 100 ? '...' : ''),
                error: parseError instanceof Error ? parseError.message : String(parseError),
                requestId
              });
              
              // Update error metrics but continue processing
              if (this.config.enableMetrics) {
                const metrics = this.streamMetrics.get(requestId);
                if (metrics) {
                  metrics.errorCount++;
                }
              }
              
              // Continue processing other lines instead of failing
              continue;
            }
          }
        }
      } catch (streamError) {
        if (streamError instanceof Error && streamError.name !== 'AbortError') {
          await this.handleStreamError(requestId, streamError, startTime);
        }
      } finally {
        reader.releaseLock();
        this.cleanup(requestId);
      }

    } catch (error) {
      await this.handleStreamError(requestId, error as Error, Date.now());
    }
  }

  /**
   * Stop an active stream
   */
  stopStream(requestId: string): void {
    const abortController = this.activeStreams.get(requestId);
    if (abortController) {
      abortController.abort();
    }
    this.cleanup(requestId);
  }

  /**
   * Parse Server-Sent Events format with enhanced validation and error recovery
   */
  private parseSSELine(line: string): StreamingEvent | null {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith(':')) {
      return null;
    }

    // Parse data events
    if (line.startsWith('data: ')) {
      try {
        const dataString = line.slice(6).trim();
        
        // Handle empty data
        if (!dataString) {
          return null;
        }

        // Try to parse as JSON
        let data: any;
        try {
          data = JSON.parse(dataString);
        } catch (jsonError) {
          // If JSON parsing fails, treat as plain text content
          console.warn('Failed to parse SSE data as JSON, treating as text:', dataString);
          data = {
            type: 'token',
            content: dataString,
            timestamp: Date.now()
          };
        }

        // Validate and normalize the event type
        const eventType = this.validateEventType(data.type);
        
        return {
          type: eventType,
          data: data,
          timestamp: Date.now(),
          requestId: data.requestId || '',
        };
      } catch (error) {
        console.warn('Failed to process SSE data line:', line, error);
        return null;
      }
    }

    // Parse event type declarations
    if (line.startsWith('event: ')) {
      const eventType = line.slice(7).trim();
      const validatedType = this.validateEventType(eventType);
      
      return {
        type: validatedType,
        data: {},
        timestamp: Date.now(),
        requestId: '',
      };
    }

    // Parse id field (for event stream resumption)
    if (line.startsWith('id: ')) {
      // Store the ID for potential resumption, but don't create an event
      return null;
    }

    // Parse retry field
    if (line.startsWith('retry: ')) {
      // Handle retry directive, but don't create an event
      return null;
    }

    // Unknown SSE field - log warning but don't fail
    console.warn('Unknown SSE field encountered:', line);
    return null;
  }

  /**
   * Validate and normalize event types to prevent invalid event errors
   */
  private validateEventType(eventType: string | undefined): StreamingEvent['type'] {
    if (!eventType || typeof eventType !== 'string') {
      return 'token';
    }

    const normalizedType = eventType.toLowerCase().trim();
    
    // Map of valid event types
    const validEventTypes: Record<string, StreamingEvent['type']> = {
      'token': 'token',
      'data': 'token',
      'text': 'token',
      'content': 'token',
      'chunk': 'token',
      'error': 'error',
      'done': 'done',
      'complete': 'done',
      'finished': 'done',
      'end': 'done',
      'heartbeat': 'heartbeat',
      'ping': 'heartbeat',
      'keepalive': 'heartbeat',
      'commands': 'commands',
      'command': 'commands',
      'action': 'commands',
      'init': 'token',
      'start': 'token',
      'metrics': 'token',
      'progress': 'token',
      'softtimeout': 'heartbeat',
      'timeout': 'error'
    };

    // Return validated type or default to 'token'
    const validatedType = validEventTypes[normalizedType];
    if (validatedType) {
      return validatedType;
    }

    // Handle unknown event types gracefully
    console.warn(`Unknown event type "${eventType}" normalized to "token"`);
    return 'token';
  }

  /**
   * Process a streaming event with enhanced error recovery
   */
  private async processStreamEventSafely(
    requestId: string,
    event: StreamingEvent,
    startTime: number
  ): Promise<void> {
    try {
      await this.processStreamEvent(requestId, event, startTime);
    } catch (error) {
      console.warn('Stream event processing error (recovered):', {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
        requestId
      });
      
      // Update error metrics
      if (this.config.enableMetrics) {
        const metrics = this.streamMetrics.get(requestId);
        if (metrics) {
          metrics.errorCount++;
        }
      }
      
      // Don't propagate the error - continue processing
    }
  }

  /**
   * Process a streaming event with buffering and flow control
   */
  private async processStreamEvent(
    requestId: string,
    event: StreamingEvent,
    startTime: number
  ): Promise<void> {
    const buffer = this.buffers.get(requestId) || [];
    const renderQueue = this.renderQueues.get(requestId) || [];

    switch (event.type) {
      case 'token':
        // Safely extract content from event data
        const content = this.extractContentFromEvent(event);
        if (content) {
          // Create chunk
          const chunk: StreamChunk = {
            content,
            timestamp: event.timestamp,
            chunkId: `${requestId}-${Date.now()}-${Math.random()}`,
          };

          // Add to buffer
          buffer.push(chunk);
          this.buffers.set(requestId, buffer);

          // Check if we should coalesce small chunks
          const shouldRender = this.shouldRenderChunk(buffer);
          if (shouldRender) {
            const coalescedContent = this.coalesceChunks(buffer);
            if (coalescedContent) {
              renderQueue.push(coalescedContent);
              this.renderQueues.set(requestId, renderQueue);

              // Schedule render with backpressure
              this.scheduleRender(requestId);

              // Clear processed chunks from buffer
              buffer.length = 0;
            }
          }

          // Update metrics
          this.updateMetrics(requestId, chunk.content);
        }
        break;

      case 'commands':
        // Safely extract commands from event data
        const commands = this.extractCommandsFromEvent(event);
        if (commands) {
          this.emit('commands', { requestId, commands });
        }
        break;

      case 'error':
        // Safely extract error message from event data
        const errorMessage = this.extractErrorFromEvent(event);
        this.handleStreamError(requestId, new Error(errorMessage), startTime);
        break;

      case 'done':
        // Flush remaining buffer
        const remainingContent = this.coalesceChunks(buffer);
        if (remainingContent) {
          renderQueue.push(remainingContent);
          this.scheduleRender(requestId);
        }
        this.finishStream(requestId, startTime);
        break;

      case 'heartbeat':
        // Reset heartbeat timer
        this.resetHeartbeat(requestId);
        break;

      default:
        // Handle unknown event types gracefully
        console.warn(`Unknown event type "${event.type}" - treating as token`);
        const unknownContent = this.extractContentFromEvent(event);
        if (unknownContent) {
          const chunk: StreamChunk = {
            content: unknownContent,
            timestamp: event.timestamp,
            chunkId: `${requestId}-${Date.now()}-${Math.random()}`,
          };
          buffer.push(chunk);
          this.buffers.set(requestId, buffer);
          this.updateMetrics(requestId, chunk.content);
        }
        break;
    }
  }

  /**
   * Determine if chunks should be rendered based on size and natural boundaries
   */
  private shouldRenderChunk(buffer: StreamChunk[]): boolean {
    if (buffer.length === 0) return false;

    const totalSize = buffer.reduce((size, chunk) => size + chunk.content.length, 0);

    // Render if we've hit the minimum chunk size
    if (totalSize >= this.config.minChunkSize) return true;

    // Render if we find natural boundaries (word/sentence breaks)
    const lastChunk = buffer[buffer.length - 1];
    const content = lastChunk.content;
    if (/[\s\.\!\?\;\:]+$/.test(content)) return true;

    // Render if buffer is getting too large
    if (totalSize >= this.config.bufferSizeLimit) return true;

    return false;
  }

  /**
   * Coalesce buffered chunks into renderable content
   */
  private coalesceChunks(chunks: StreamChunk[]): string {
    return chunks.map(chunk => chunk.content).join('');
  }

  /**
   * Schedule rendering with requestAnimationFrame throttling
   */
  private scheduleRender(requestId: string): void {
    if (this.renderAnimationFrames.has(requestId)) return;

    const frameId = requestAnimationFrame(() => {
      this.renderAnimationFrames.delete(requestId);
      const renderQueue = this.renderQueues.get(requestId) || [];

      if (renderQueue.length > 0) {
        const content = renderQueue.join('');
        this.emit('render', { requestId, content });

        // Clear render queue
        renderQueue.length = 0;
        this.renderQueues.set(requestId, renderQueue);
      }
    });

    this.renderAnimationFrames.set(requestId, frameId);
  }

  /**
   * Start heartbeat for connection keep-alive
   */
  private startHeartbeat(requestId: string): void {
    const interval = setInterval(() => {
      if (this.activeStreams.has(requestId)) {
        this.emit('heartbeat', { requestId });
      } else {
        clearInterval(interval);
      }
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(requestId, interval);
  }

  /**
   * Reset heartbeat timer
   */
  private resetHeartbeat(requestId: string): void {
    const existingInterval = this.heartbeatIntervals.get(requestId);
    if (existingInterval) {
      clearInterval(existingInterval);
      this.startHeartbeat(requestId);
    }
  }

  /**
   * Handle streaming errors with enhanced error processing and recovery
   */
  private async handleStreamError(
    requestId: string,
    error: Error,
    startTime: number
  ): Promise<void> {
    // Process error through error handler
    const streamingError = streamingErrorHandler.processError(error, {
      requestId,
      sessionId: requestId
    });

    // Update metrics
    if (this.config.enableMetrics) {
      const metrics = this.streamMetrics.get(requestId);
      if (metrics) {
        metrics.errorCount++;
      }
    }

    // Only emit error to UI if it should be shown to user
    if (streamingErrorHandler.shouldShowToUser(streamingError)) {
      const userMessage = streamingErrorHandler.getUserMessage(streamingError);
      this.emit('error', { 
        requestId, 
        error: new Error(userMessage), 
        canRetry: streamingError.recoverable 
      });
    } else {
      // Log error for debugging but don't show to user
      console.warn('Streaming error (handled silently):', {
        type: streamingError.type,
        message: streamingError.message,
        requestId
      });
    }

    // Attempt recovery if error is recoverable
    if (streamingError.recoverable) {
      const recovered = await streamingErrorHandler.attemptRecovery(
        streamingError,
        async () => {
          // Recovery function - could restart stream or reconnect
          const metrics = this.streamMetrics.get(requestId);
          if (metrics) {
            metrics.reconnectCount++;
            this.emit('retry', { requestId, attempt: metrics.reconnectCount });
          }
        }
      );

      if (!recovered) {
        // Recovery failed - emit final error
        this.emit('error', { 
          requestId, 
          error: new Error('Connection could not be restored. Please try again.'), 
          canRetry: false 
        });
      }
    }
  }

  /**
   * Finish streaming and emit final metrics
   */
  private finishStream(requestId: string, startTime: number): void {
    const endTime = Date.now();
    const totalLatency = endTime - startTime;

    if (this.config.enableMetrics) {
      const metrics = this.streamMetrics.get(requestId);
      if (metrics) {
        metrics.completionLatency = totalLatency;
        if (totalLatency > 0 && metrics.totalTokens > 0) {
          metrics.tokensPerSecond = (metrics.totalTokens / totalLatency) * 1000;
        }

        this.emit('metrics', { requestId, metrics });
      }
    }

    this.emit('done', { requestId, totalLatency });
  }

  /**
   * Update streaming metrics
   */
  private updateMetrics(requestId: string, content: string): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.streamMetrics.get(requestId);
    if (metrics) {
      metrics.totalTokens += content.length;
    }
  }

  /**
   * Clean up resources for a stream
   */
  private cleanup(requestId: string): void {
    // Clear abort controller
    this.activeStreams.delete(requestId);

    // Clear heartbeat
    const heartbeatInterval = this.heartbeatIntervals.get(requestId);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      this.heartbeatIntervals.delete(requestId);
    }

    // Clear render frame
    const frameId = this.renderAnimationFrames.get(requestId);
    if (frameId) {
      cancelAnimationFrame(frameId);
      this.renderAnimationFrames.delete(requestId);
    }

    // Clear buffers
    this.buffers.delete(requestId);
    this.renderQueues.delete(requestId);

    // Keep metrics for a while for analysis
    setTimeout(() => {
      this.streamMetrics.delete(requestId);
    }, 60000); // Keep for 1 minute
  }

  /**
   * Get current metrics for a stream
   */
  getMetrics(requestId: string): StreamingMetrics | null {
    return this.streamMetrics.get(requestId) || null;
  }

  /**
   * Get all active stream IDs
   */
  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  /**
   * Safely extract content from event data
   */
  private extractContentFromEvent(event: StreamingEvent): string {
    try {
      // Try multiple possible content fields
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return '';
      }

      // Check common content field names
      if (typeof data.content === 'string') {
        return data.content;
      }
      if (typeof data.text === 'string') {
        return data.text;
      }
      if (typeof data.data === 'string') {
        return data.data;
      }
      if (typeof data.chunk === 'string') {
        return data.chunk;
      }
      if (typeof data.token === 'string') {
        return data.token;
      }

      // If data itself is a string, use it
      if (typeof data === 'string') {
        return data;
      }

      return '';
    } catch (error) {
      console.warn('Failed to extract content from event:', error);
      return '';
    }
  }

  /**
   * Safely extract commands from event data
   */
  private extractCommandsFromEvent(event: StreamingEvent): any {
    try {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return null;
      }

      // Check for commands field
      if (data.commands) {
        return data.commands;
      }
      if (data.command) {
        return data.command;
      }
      if (data.actions) {
        return data.actions;
      }

      // Return the data itself if it looks like commands
      if (data.request_files || data.write_diffs) {
        return data;
      }

      return null;
    } catch (error) {
      console.warn('Failed to extract commands from event:', error);
      return null;
    }
  }

  /**
   * Safely extract error message from event data
   */
  private extractErrorFromEvent(event: StreamingEvent): string {
    try {
      const data = event.data;
      if (!data) {
        return 'Unknown streaming error';
      }

      // Check for error message fields
      if (typeof data.message === 'string') {
        return data.message;
      }
      if (typeof data.error === 'string') {
        return data.error;
      }
      if (typeof data.description === 'string') {
        return data.description;
      }

      // If data itself is a string, use it
      if (typeof data === 'string') {
        return data;
      }

      return 'Unknown streaming error';
    } catch (error) {
      console.warn('Failed to extract error from event:', error);
      return 'Failed to parse error message';
    }
  }
}

// Export singleton instance
export const enhancedStreaming = new EnhancedStreamingService();
