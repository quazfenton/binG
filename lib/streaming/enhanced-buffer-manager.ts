"use client";

import { EventEmitter } from 'events';
import { streamingErrorHandler } from './streaming-error-handler';

// Enhanced streaming interfaces
export interface StreamChunk {
  id: string;
  content: string;
  timestamp: number;
  sequenceNumber: number;
  isComplete: boolean;
  metadata?: {
    tokens?: number;
    chunkType?: 'text' | 'code' | 'command' | 'error';
    language?: string;
    isPartial?: boolean;
  };
}

export interface BufferConfig {
  maxBufferSize: number;
  coalescingThreshold: number;
  renderThrottleMs: number;
  backpressureThreshold: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface StreamState {
  sessionId: string;
  status: 'idle' | 'streaming' | 'paused' | 'completed' | 'error' | 'recovering';
  totalChunks: number;
  processedChunks: number;
  bufferedChunks: number;
  renderQueue: number;
  backpressureActive: boolean;
  lastChunkTime: number;
  averageChunkTime: number;
  error?: Error;
}

export interface RenderFrame {
  content: string;
  timestamp: number;
  frameId: number;
  isComplete: boolean;
}

/**
 * Enhanced Streaming Buffer Manager
 * 
 * Provides intelligent chunk buffering, coalescing, and smooth rendering
 * with backpressure handling and connection recovery mechanisms.
 */
export class EnhancedBufferManager extends EventEmitter {
  private config: BufferConfig;
  private sessions: Map<string, StreamSession> = new Map();
  private renderScheduler: RenderScheduler;
  private recoveryManager: RecoveryManager;

  constructor(config: Partial<BufferConfig> = {}) {
    super();
    
    this.config = {
      maxBufferSize: 1024 * 2, // 2KB buffer
      coalescingThreshold: 50, // Coalesce chunks smaller than 50 chars
      renderThrottleMs: 16, // ~60fps rendering
      backpressureThreshold: 1024 * 5, // 5KB backpressure threshold
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config
    };

    this.renderScheduler = new RenderScheduler(this.config.renderThrottleMs);
    this.recoveryManager = new RecoveryManager(this.config);

    // Set up render scheduler events
    this.renderScheduler.on('render', this.handleRenderFrame.bind(this));
  }

  /**
   * Create a new streaming session
   */
  createSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.destroySession(sessionId);
    }

    const session = new StreamSession(sessionId, this.config);
    this.sessions.set(sessionId, session);

    // Set up session event handlers
    session.on('chunk-ready', (chunk: StreamChunk) => {
      this.handleChunkReady(sessionId, chunk);
    });

    session.on('backpressure', (active: boolean) => {
      this.emit('backpressure', { sessionId, active });
    });

    session.on('error', (error: Error) => {
      this.handleSessionError(sessionId, error);
    });

    this.emit('session-created', { sessionId });
  }

  /**
   * Process incoming chunk for a session with enhanced error handling
   */
  processChunk(sessionId: string, content: string, metadata?: StreamChunk['metadata']): void {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        console.warn(`Session ${sessionId} not found for chunk processing`);
        return;
      }

      // Validate content
      if (typeof content !== 'string') {
        console.warn(`Invalid content type for session ${sessionId}:`, typeof content);
        return;
      }

      // Skip empty content unless it's explicitly marked as complete
      if (!content.trim() && !metadata?.isPartial) {
        return;
      }

      const chunk: StreamChunk = {
        id: `${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        content,
        timestamp: Date.now(),
        sequenceNumber: session.getNextSequenceNumber(),
        isComplete: false,
        metadata: {
          ...metadata,
          tokens: Math.ceil(content.length / 4), // Estimate token count
          chunkType: metadata?.chunkType || this.inferChunkType(content)
        }
      };

      session.addChunk(chunk);
    } catch (error) {
      console.error(`Error processing chunk for session ${sessionId}:`, error);
      this.emit('session-error', { sessionId, error });
    }
  }

  /**
   * Infer chunk type from content
   */
  private inferChunkType(content: string): StreamChunk['metadata']['chunkType'] {
    if (!content || typeof content !== 'string') {
      return 'text';
    }

    const lowerContent = content.toLowerCase();
    
    if (content.includes('```') || lowerContent.includes('code')) {
      return 'code';
    }
    if (content.includes('COMMANDS_START') || lowerContent.includes('command')) {
      return 'command';
    }
    if (lowerContent.includes('error') || lowerContent.includes('failed')) {
      return 'error';
    }
    
    return 'text';
  }

  /**
   * Complete a streaming session
   */
  completeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.complete();
    this.emit('session-completed', { sessionId, state: session.getState() });
  }

  /**
   * Destroy a streaming session
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.destroy();
    this.sessions.delete(sessionId);
    this.emit('session-destroyed', { sessionId });
  }

  /**
   * Get session state
   */
  getSessionState(sessionId: string): StreamState | null {
    const session = this.sessions.get(sessionId);
    return session ? session.getState() : null;
  }

  /**
   * Handle chunk ready for rendering
   */
  private handleChunkReady(sessionId: string, chunk: StreamChunk): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Check for backpressure
    if (session.shouldApplyBackpressure()) {
      session.activateBackpressure();
      return;
    }

    // Schedule for rendering
    this.renderScheduler.scheduleRender(sessionId, chunk);
  }

  /**
   * Handle render frame
   */
  private handleRenderFrame(frame: RenderFrame & { sessionId: string }): void {
    this.emit('render', {
      sessionId: frame.sessionId,
      content: frame.content,
      timestamp: frame.timestamp,
      isComplete: frame.isComplete
    });
  }

  /**
   * Handle session error with enhanced recovery
   */
  private handleSessionError(sessionId: string, error: Error): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`Cannot handle error for non-existent session: ${sessionId}`);
      return;
    }

    // Process error through centralized error handler
    const streamingError = streamingErrorHandler.processError(error, {
      sessionId,
      requestId: sessionId
    });

    // Log error details for debugging
    console.warn(`Session error for ${sessionId}:`, {
      type: streamingError.type,
      message: streamingError.message,
      recoverable: streamingError.recoverable,
      sessionState: session.getState()
    });

    // Attempt recovery for recoverable errors
    if (streamingError.recoverable) {
      streamingErrorHandler.attemptRecovery(
        streamingError,
        async () => {
          // Recovery function - reset session state
          session.setState('streaming');
        }
      ).then((recovered) => {
        if (recovered) {
          console.log(`Successfully recovered session ${sessionId}`);
          this.emit('recovery-success', { sessionId, error: streamingError });
        } else {
          session.setState('error', error);
          // Only emit error if it should be shown to user
          if (streamingErrorHandler.shouldShowToUser(streamingError)) {
            const userMessage = streamingErrorHandler.getUserMessage(streamingError);
            this.emit('session-error', { sessionId, error: new Error(userMessage) });
          }
        }
      }).catch((recoveryError) => {
        console.error(`Recovery failed for session ${sessionId}:`, recoveryError);
        session.setState('error', recoveryError);
        this.emit('session-error', { sessionId, error: recoveryError });
      });
    } else {
      // Non-recoverable error - set error state immediately
      session.setState('error', error);
      if (streamingErrorHandler.shouldShowToUser(streamingError)) {
        const userMessage = streamingErrorHandler.getUserMessage(streamingError);
        this.emit('session-error', { sessionId, error: new Error(userMessage) });
      }
    }
  }

  /**
   * Check if an error is recoverable
   */
  private isRecoverableError(error: Error): boolean {
    const recoverablePatterns = [
      /network/i,
      /timeout/i,
      /connection/i,
      /fetch/i,
      /abort/i,
      /parse.*stream/i,
      /invalid.*event/i
    ];

    return recoverablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Pause a session
   */
  pauseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pause();
      this.emit('session-paused', { sessionId });
    }
  }

  /**
   * Resume a session
   */
  resumeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.resume();
      this.emit('session-resumed', { sessionId });
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys()).filter(sessionId => {
      const session = this.sessions.get(sessionId);
      return session && session.isActive();
    });
  }

  /**
   * Clean up completed sessions
   */
  cleanup(): void {
    const completedSessions = Array.from(this.sessions.entries())
      .filter(([_, session]) => session.isCompleted())
      .map(([sessionId]) => sessionId);

    completedSessions.forEach(sessionId => {
      this.destroySession(sessionId);
    });
  }
}

/**
 * Individual streaming session
 */
class StreamSession extends EventEmitter {
  private sessionId: string;
  private config: BufferConfig;
  private buffer: StreamChunk[] = [];
  private state: StreamState;
  private sequenceCounter = 0;
  private coalescingTimer?: NodeJS.Timeout;
  private backpressureActive = false;

  constructor(sessionId: string, config: BufferConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    
    this.state = {
      sessionId,
      status: 'idle',
      totalChunks: 0,
      processedChunks: 0,
      bufferedChunks: 0,
      renderQueue: 0,
      backpressureActive: false,
      lastChunkTime: 0,
      averageChunkTime: 0
    };
  }

  addChunk(chunk: StreamChunk): void {
    if (this.state.status === 'error' || this.state.status === 'completed') {
      return;
    }

    // Validate chunk data
    if (!chunk || typeof chunk.content !== 'string') {
      console.warn(`Invalid chunk for session ${this.sessionId}:`, chunk);
      return;
    }

    this.state.status = 'streaming';
    this.state.lastChunkTime = chunk.timestamp;
    this.state.totalChunks++;
    
    // Update average chunk time
    if (this.state.processedChunks > 0) {
      const timeDiff = chunk.timestamp - this.state.lastChunkTime;
      this.state.averageChunkTime = 
        (this.state.averageChunkTime * this.state.processedChunks + timeDiff) / 
        (this.state.processedChunks + 1);
    }

    // Sanitize chunk content
    const sanitizedChunk: StreamChunk = {
      ...chunk,
      content: this.sanitizeContent(chunk.content),
      metadata: {
        ...chunk.metadata,
        tokens: chunk.metadata?.tokens || Math.ceil(chunk.content.length / 4)
      }
    };

    this.buffer.push(sanitizedChunk);
    this.state.bufferedChunks = this.buffer.length;

    // Clear existing coalescing timer
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
    }

    // Check if we should process immediately or wait for coalescing
    if (this.shouldProcessBuffer()) {
      this.processBuffer();
    } else {
      // Set coalescing timer
      this.coalescingTimer = setTimeout(() => {
        this.processBuffer();
      }, this.config.renderThrottleMs);
    }
  }

  /**
   * Sanitize chunk content to prevent rendering issues
   */
  private sanitizeContent(content: string): string {
    if (typeof content !== 'string') {
      return '';
    }

    // Remove null bytes and other problematic characters
    return content
      .replace(/\0/g, '') // Remove null bytes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \t, \n, \r
      .trim();
  }

  private shouldProcessBuffer(): boolean {
    if (this.buffer.length === 0) return false;

    // Process if buffer is getting full
    const totalBufferSize = this.buffer.reduce((size, chunk) => size + chunk.content.length, 0);
    if (totalBufferSize >= this.config.maxBufferSize) {
      return true;
    }

    // Process if we have enough content for coalescing
    if (totalBufferSize >= this.config.coalescingThreshold) {
      return true;
    }

    // Process if the last chunk looks complete (ends with punctuation or whitespace)
    const lastChunk = this.buffer[this.buffer.length - 1];
    if (lastChunk && /[\s\.\!\?\;\:\n]+$/.test(lastChunk.content)) {
      return true;
    }

    return false;
  }

  private processBuffer(): void {
    if (this.buffer.length === 0) return;

    // Coalesce chunks
    const coalescedContent = this.buffer.map(chunk => chunk.content).join('');
    const coalescedChunk: StreamChunk = {
      id: `coalesced-${this.sessionId}-${Date.now()}`,
      content: coalescedContent,
      timestamp: Date.now(),
      sequenceNumber: this.buffer[0].sequenceNumber,
      isComplete: false,
      metadata: {
        tokens: Math.ceil(coalescedContent.length / 4),
        chunkType: this.inferChunkType(coalescedContent),
        isPartial: true
      }
    };

    // Clear buffer
    this.state.processedChunks += this.buffer.length;
    this.buffer = [];
    this.state.bufferedChunks = 0;

    // Emit chunk ready for rendering
    this.emit('chunk-ready', coalescedChunk);
  }

  private inferChunkType(content: string): StreamChunk['metadata']['chunkType'] {
    if (content.includes('```')) return 'code';
    if (content.includes('COMMANDS_START')) return 'command';
    if (content.toLowerCase().includes('error')) return 'error';
    return 'text';
  }

  shouldApplyBackpressure(): boolean {
    const totalBufferSize = this.buffer.reduce((size, chunk) => size + chunk.content.length, 0);
    return totalBufferSize >= this.config.backpressureThreshold;
  }

  activateBackpressure(): void {
    if (!this.backpressureActive) {
      this.backpressureActive = true;
      this.state.backpressureActive = true;
      this.emit('backpressure', true);
    }
  }

  deactivateBackpressure(): void {
    if (this.backpressureActive) {
      this.backpressureActive = false;
      this.state.backpressureActive = false;
      this.emit('backpressure', false);
      
      // Process any buffered chunks
      if (this.buffer.length > 0) {
        this.processBuffer();
      }
    }
  }

  getNextSequenceNumber(): number {
    return ++this.sequenceCounter;
  }

  complete(): void {
    // Process any remaining buffer
    if (this.buffer.length > 0) {
      this.processBuffer();
    }

    this.state.status = 'completed';
    
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
    }
  }

  pause(): void {
    this.state.status = 'paused';
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.state.status = 'streaming';
    }
  }

  setState(status: StreamState['status'], error?: Error): void {
    this.state.status = status;
    if (error) {
      this.state.error = error;
    }
  }

  getState(): StreamState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.status === 'streaming' || this.state.status === 'paused';
  }

  isCompleted(): boolean {
    return this.state.status === 'completed' || this.state.status === 'error';
  }

  destroy(): void {
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
    }
    this.removeAllListeners();
  }
}

/**
 * Render scheduler with requestAnimationFrame throttling
 */
class RenderScheduler extends EventEmitter {
  private throttleMs: number;
  private renderQueue: Map<string, StreamChunk[]> = new Map();
  private scheduledFrames: Set<string> = new Set();

  constructor(throttleMs: number) {
    super();
    this.throttleMs = throttleMs;
  }

  scheduleRender(sessionId: string, chunk: StreamChunk): void {
    // Add to render queue
    if (!this.renderQueue.has(sessionId)) {
      this.renderQueue.set(sessionId, []);
    }
    this.renderQueue.get(sessionId)!.push(chunk);

    // Schedule frame if not already scheduled
    if (!this.scheduledFrames.has(sessionId)) {
      this.scheduledFrames.add(sessionId);
      
      requestAnimationFrame(() => {
        this.processRenderQueue(sessionId);
      });
    }
  }

  private processRenderQueue(sessionId: string): void {
    const chunks = this.renderQueue.get(sessionId);
    if (!chunks || chunks.length === 0) {
      this.scheduledFrames.delete(sessionId);
      return;
    }

    // Combine all queued chunks for this session
    const combinedContent = chunks.map(chunk => chunk.content).join('');
    const frame: RenderFrame & { sessionId: string } = {
      sessionId,
      content: combinedContent,
      timestamp: Date.now(),
      frameId: Date.now(),
      isComplete: chunks.some(chunk => chunk.isComplete)
    };

    // Clear the queue for this session
    this.renderQueue.set(sessionId, []);
    this.scheduledFrames.delete(sessionId);

    // Emit render frame
    this.emit('render', frame);
  }
}

/**
 * Recovery manager for handling connection failures
 */
class RecoveryManager {
  private config: BufferConfig;
  private retryAttempts: Map<string, number> = new Map();

  constructor(config: BufferConfig) {
    this.config = config;
  }

  async attemptRecovery(sessionId: string, error: Error): Promise<boolean> {
    const attempts = this.retryAttempts.get(sessionId) || 0;
    
    if (attempts >= this.config.maxRetries) {
      this.retryAttempts.delete(sessionId);
      return false;
    }

    this.retryAttempts.set(sessionId, attempts + 1);

    // Wait before retry with exponential backoff
    const delay = this.config.retryDelayMs * Math.pow(2, attempts);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Check if error is recoverable
    if (this.isRecoverableError(error)) {
      return true;
    }

    return false;
  }

  private isRecoverableError(error: Error): boolean {
    const recoverableErrors = [
      'network',
      'timeout',
      'connection',
      'fetch',
      'abort',
      'parse',
      'invalid',
      'malformed',
      'stream',
      'event'
    ];

    const errorMessage = error.message.toLowerCase();
    return recoverableErrors.some(keyword => errorMessage.includes(keyword));
  }
}

// Export singleton instance
export const enhancedBufferManager = new EnhancedBufferManager();