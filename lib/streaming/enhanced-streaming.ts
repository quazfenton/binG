"use client";

import { EventEmitter } from 'events';
import { performanceManager } from '../performance/performance-manager';

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
        performanceManager.trackStreamingSession(requestId);
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

              // Process the event
              await this.processStreamEvent(requestId, eventData, startTime);
              tokenCount++;

            } catch (parseError) {
              console.warn('Failed to parse SSE line:', line, parseError);
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
   * Parse Server-Sent Events format
   */
  private parseSSELine(line: string): StreamingEvent | null {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.slice(6));
        return {
          type: data.type || 'token',
          data: data,
          timestamp: Date.now(),
          requestId: data.requestId || '',
        };
      } catch {
        return null;
      }
    }

    if (line.startsWith('event: ')) {
      const eventType = line.slice(7).trim();
      return {
        type: eventType as any,
        data: {},
        timestamp: Date.now(),
        requestId: '',
      };
    }

    return null;
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
        if (event.data.content) {
          // Create chunk
          const chunk: StreamChunk = {
            content: event.data.content,
            timestamp: event.timestamp,
            chunkId: `${requestId}-${Date.now()}-${Math.random()}`,
          };

          // Add to buffer
          buffer.push(chunk);
          this.buffers.set(requestId, buffer);

          // Check if we should coalesce small chunks
          const shouldRender = this.shouldRenderChunk(buffer);
          if (shouldRender) {
            const renderStartTime = performance.now();
            const coalescedContent = this.coalesceChunks(buffer);
            if (coalescedContent) {
              renderQueue.push(coalescedContent);
              this.renderQueues.set(requestId, renderQueue);

              // Schedule render with backpressure
              this.scheduleRender(requestId);
              
              // Record performance metrics
              const renderTime = performance.now() - renderStartTime;
              performanceManager.recordStreamingChunk(chunk.content.length, renderTime);

              // Clear processed chunks from buffer
              buffer.length = 0;
            }
          }

          // Update metrics
          this.updateMetrics(requestId, chunk.content);
        }
        break;

      case 'commands':
        this.emit('commands', { requestId, commands: event.data });
        break;

      case 'error':
        performanceManager.recordStreamingError();
        this.handleStreamError(requestId, new Error(event.data.message), startTime);
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
   * Handle streaming errors with retry logic
   */
  private async handleStreamError(
    requestId: string,
    error: Error,
    startTime: number
  ): Promise<void> {
    if (this.config.enableMetrics) {
      const metrics = this.streamMetrics.get(requestId);
      if (metrics) {
        metrics.errorCount++;
      }
    }

    // Record error in performance manager
    performanceManager.recordStreamingError();

    this.emit('error', { requestId, error, canRetry: true });

    // Implement retry logic with exponential backoff
    const metrics = this.streamMetrics.get(requestId);
    if (metrics && metrics.reconnectCount < this.config.maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, metrics.reconnectCount), 10000);
      const jitter = Math.random() * 1000;

      setTimeout(() => {
        metrics.reconnectCount++;
        this.emit('retry', { requestId, attempt: metrics.reconnectCount });
      }, delay + jitter);
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
}

// Export singleton instance
export const enhancedStreaming = new EnhancedStreamingService();
