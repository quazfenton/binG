/**
 * Stream State Manager
 *
 * Tracks the state of each LLM generation stream server-side.
 * Enables:
 * 1. Stream resume — reconnect and continue from last token index
 * 2. Continuation triggering — server-side "continue" without [CONTINUE_REQUESTED]
 * 3. Pause/resume — buffer tokens while paused, emit when resumed
 * 4. Abort — stop generation mid-stream
 *
 * Lifecycle:
 * 1. Server creates stream state at start of generation
 * 2. Stream state is updated as tokens arrive
 * 3. Client can query/modify state via WebSocket control channel
 * 4. Stream state is cleaned up after completion or timeout
 */

import { chatLogger } from '@/lib/chat/chat-logger';

const logger = chatLogger.child({ component: 'stream-state-manager' });

// =========================================================================
// Constants
// =========================================================================

const MAX_PAUSED_TOKENS_CHARS = 5 * 1024 * 1024; // 5MB cap on paused token buffer
const MAX_CONTENT_CHARS = 2 * 1024 * 1024; // 2MB cap on full content (prevent OOM)

// =========================================================================
// Types
// =========================================================================

export type StreamStatus = 'starting' | 'streaming' | 'paused' | 'complete' | 'aborted' | 'error';

export interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamState {
  streamId: string;
  userId: string;
  status: StreamStatus;
  provider: string;
  model: string;
  tokenCount: number;
  contentLength: number;
  content: string;
  reasoning: string;
  toolCalls: ToolCallState[];
  isComplete: boolean;
  finishReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  maxTokens: number;
  needsMoreTurns: boolean;
  continuationCount: number;
  maxContinuations: number;
  contextHint?: string;
  // For resume capability
  lastTokenIndex: number;
  // Abort controller for stopping the LLM provider call
  abortController?: AbortController;
  // Resolve/reject for continuation promise
  continuePromise?: {
    resolve: (value: { content: string; contextHint?: string }) => void;
    reject: (error: Error) => void;
    promise: Promise<{ content: string; contextHint?: string }>;
  };
  // Pause buffer (capped to prevent OOM)
  pausedTokensBuffer: string;
  pausedTokensCharCount: number;
  onPaused?: () => void;
  onResumed?: () => void;
}

// =========================================================================
// Manager
// =========================================================================

class StreamStateManager {
  private states = new Map<string, StreamState>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Create a new stream state
   */
  create(options: {
    streamId: string;
    userId: string;
    provider: string;
    model: string;
    maxTokens?: number;
    maxContinuations?: number;
    abortController?: AbortController;
  }): StreamState {
    if (!options.streamId) {
      throw new Error('streamId is required');
    }
    if (!options.userId) {
      throw new Error('userId is required');
    }

    // If a state already exists for this streamId, clean it up first
    const existing = this.states.get(options.streamId);
    if (existing) {
      logger.warn('Overwriting existing stream state', {
        streamId: options.streamId,
        oldStatus: existing.status,
      });
      this.delete(options.streamId);
    }

    const state: StreamState = {
      streamId: options.streamId,
      userId: options.userId,
      status: 'starting',
      provider: options.provider,
      model: options.model,
      tokenCount: 0,
      contentLength: 0,
      content: '',
      reasoning: '',
      toolCalls: [],
      isComplete: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxTokens: options.maxTokens || 65536,
      needsMoreTurns: false,
      continuationCount: 0,
      maxContinuations: options.maxContinuations || 3,
      lastTokenIndex: 0,
      abortController: options.abortController,
      pausedTokensBuffer: '',
      pausedTokensCharCount: 0,
    };

    this.states.set(state.streamId, state);
    logger.debug('Stream state created', { streamId: state.streamId, model: state.model });
    return state;
  }

  /**
   * Delete and clean up a stream state
   */
  private delete(streamId: string): void {
    const state = this.states.get(streamId);
    if (state) {
      // Reject any pending continue promise to prevent unhandled rejection
      if (state.continuePromise) {
        state.continuePromise.reject(new Error('Stream state deleted'));
        state.continuePromise = undefined;
      }
      // Abort if still running
      if (state.status !== 'complete' && state.status !== 'aborted' && state.status !== 'error') {
        state.abortController?.abort();
      }
      this.states.delete(streamId);
    }
  }

  /**
   * Get stream state
   */
  get(streamId: string): StreamState | undefined {
    return this.states.get(streamId);
  }

  /**
   * Update stream state (partial update)
   */
  update(streamId: string, updates: Partial<StreamState>): StreamState | null {
    const state = this.states.get(streamId);
    if (!state) return null;

    Object.assign(state, updates, { updatedAt: Date.now() });

    // Update content length if content changed
    if (updates.content !== undefined) {
      state.contentLength = state.content.length;
    }

    return state;
  }

  /**
   * Append a token to the stream content
   */
  appendToken(streamId: string, token: string): void {
    const state = this.states.get(streamId);
    if (!state || state.status === 'aborted' || state.status === 'complete' || state.status === 'error') return;

    if (state.status === 'paused') {
      // Buffer tokens with size cap to prevent OOM
      if (state.pausedTokensCharCount + token.length > MAX_PAUSED_TOKENS_CHARS) {
        logger.warn('Paused token buffer limit reached, dropping tokens', {
          streamId,
          currentChars: state.pausedTokensCharCount,
          newTokenLength: token.length,
          maxChars: MAX_PAUSED_TOKENS_CHARS,
        });
        return;
      }
      state.pausedTokensBuffer += token;
      state.pausedTokensCharCount += token.length;
      return;
    }

    // Cap total content to prevent OOM
    if (state.content.length + token.length > MAX_CONTENT_CHARS) {
      logger.warn('Content limit reached, truncating', {
        streamId,
        currentLength: state.content.length,
        newTokenLength: token.length,
        maxChars: MAX_CONTENT_CHARS,
      });
      // Keep the last MAX_CONTENT_CHARS characters
      const overflow = state.content.length + token.length - MAX_CONTENT_CHARS;
      state.content = state.content.slice(overflow) + token;
      state.contentLength = MAX_CONTENT_CHARS;
    } else {
      state.content += token;
      state.contentLength = state.content.length;
    }

    state.tokenCount++;
    state.lastTokenIndex = state.content.length;
    state.updatedAt = Date.now();
  }

  /**
   * Pause the stream — tokens are buffered
   */
  pause(streamId: string): void {
    const state = this.states.get(streamId);
    if (!state) {
      logger.warn('Cannot pause: stream not found', { streamId });
      return;
    }
    if (state.status === 'paused') {
      return; // Already paused
    }
    if (state.status === 'complete' || state.status === 'aborted' || state.status === 'error') {
      logger.warn('Cannot pause: stream is not active', { streamId, status: state.status });
      return;
    }

    state.status = 'paused';
    state.pausedTokensBuffer = '';
    state.pausedTokensCharCount = 0;
    state.onPaused?.();
    logger.debug('Stream paused', { streamId });
  }

  /**
   * Resume the stream — buffered tokens are released
   */
  resume(streamId: string): string[] {
    const state = this.states.get(streamId);
    if (!state) {
      logger.warn('Cannot resume: stream not found', { streamId });
      return [];
    }

    state.status = 'streaming';
    const bufferedText = state.pausedTokensBuffer;
    state.pausedTokensBuffer = '';
    state.pausedTokensCharCount = 0;
    state.onResumed?.();

    // Split buffered tokens into chunks for processing
    const chunkSize = 100;
    const chunks: string[] = [];
    for (let i = 0; i < bufferedText.length; i += chunkSize) {
      chunks.push(bufferedText.slice(i, i + chunkSize));
    }

    logger.debug('Stream resumed', { streamId, bufferedChars: bufferedText.length, chunks: chunks.length });
    return chunks;
  }

  /**
   * Abort the stream
   */
  abort(streamId: string): void {
    const state = this.states.get(streamId);
    if (!state) return;
    if (state.status === 'aborted' || state.status === 'complete' || state.status === 'error') return;

    state.status = 'aborted';
    state.abortController?.abort();

    // Reject any pending continue promise safely
    if (state.continuePromise) {
      const { reject } = state.continuePromise;
      state.continuePromise = undefined;
      // Use queueMicrotask to avoid synchronous rejection issues
      queueMicrotask(() => {
        reject(new Error('Stream aborted'));
      });
    }

    logger.debug('Stream aborted', { streamId });
  }

  /**
   * Mark stream as complete
   */
  complete(streamId: string, finishReason?: string): void {
    const state = this.states.get(streamId);
    if (!state) return;

    state.status = 'complete';
    state.isComplete = true;
    state.finishReason = finishReason;
    state.completedAt = Date.now();
    state.updatedAt = Date.now();

    // Resolve any pending continue promise (stream ended without needing more turns)
    if (state.continuePromise) {
      const { resolve } = state.continuePromise;
      state.continuePromise = undefined;
      queueMicrotask(() => {
        resolve({ content: '', contextHint: undefined });
      });
    }

    logger.debug('Stream complete', {
      streamId,
      tokenCount: state.tokenCount,
      contentLength: state.contentLength,
      finishReason,
    });
  }

  /**
   * Mark stream as error
   */
  error(streamId: string, errorMessage: string): void {
    const state = this.states.get(streamId);
    if (!state) return;

    state.status = 'error';
    state.isComplete = true;
    state.completedAt = Date.now();

    // Reject any pending continue promise
    if (state.continuePromise) {
      const { reject } = state.continuePromise;
      state.continuePromise = undefined;
      queueMicrotask(() => {
        reject(new Error(`Stream error: ${errorMessage}`));
      });
    }

    logger.warn('Stream error', { streamId, error: errorMessage });
  }

  /**
   * Signal that more turns are needed (replaces [CONTINUE_REQUESTED])
   * Returns true if continuation was triggered, false if max reached
   */
  async signalNeedMoreTurns(
    streamId: string,
    contextHint?: string,
    options?: {
      toolSummary?: string;
      toolCount?: number;
      implicitFiles?: string[];
      fileRequestConfidence?: string;
    }
  ): Promise<boolean> {
    const state = this.states.get(streamId);
    if (!state) {
      logger.warn('Cannot signal need more turns: stream not found', { streamId });
      return false;
    }

    if (state.continuationCount >= state.maxContinuations) {
      logger.warn('Max continuations reached', {
        streamId,
        count: state.continuationCount,
        max: state.maxContinuations,
      });
      return false;
    }

    state.needsMoreTurns = true;
    state.contextHint = contextHint;

    // Create a promise that resolves when the client sends a continue message
    let resolve!: (value: { content: string; contextHint?: string }) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<{ content: string; contextHint?: string }>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    state.continuePromise = { resolve, reject, promise };
    state.continuationCount++;

    logger.info('Signaling need more turns', {
      streamId,
      continuationCount: state.continuationCount,
      maxContinuations: state.maxContinuations,
      contextHint: !!contextHint,
      toolCount: options?.toolCount,
      toolSummary: options?.toolSummary,
      implicitFiles: options?.implicitFiles?.length,
      fileRequestConfidence: options?.fileRequestConfidence,
    });

    return true;
  }

  /**
   * Trigger a continuation (called from WebSocket handler or server-side)
   */
  async triggerContinue(streamId: string, payload?: Record<string, unknown>): Promise<void> {
    const state = this.states.get(streamId);
    if (!state) {
      logger.warn('Cannot trigger continue: stream not found', { streamId });
      return;
    }

    if (!state.continuePromise) {
      logger.warn('Cannot trigger continue: no pending continue promise', { streamId });
      return;
    }

    if (state.status !== 'complete' && state.status !== 'error') {
      // Switch back to streaming state
      state.status = 'streaming';
    }

    const { resolve } = state.continuePromise;
    state.continuePromise = undefined;
    state.needsMoreTurns = false;

    resolve({
      content: (payload?.content as string) || '',
      contextHint: (payload?.contextHint as string) || state.contextHint,
    });

    logger.info('Continue triggered', {
      streamId,
      continuationCount: state.continuationCount,
    });
  }

  /**
   * Wait for continuation to be triggered by client
   * Returns the continuation payload or null if cancelled/expired
   */
  async waitForContinue(streamId: string): Promise<{ content: string; contextHint?: string } | null> {
    const state = this.states.get(streamId);
    if (!state || !state.continuePromise) {
      return null;
    }

    try {
      return await state.continuePromise.promise;
    } catch {
      return null;
    }
  }

  /**
   * Update max tokens
   */
  setMaxTokens(streamId: string, maxTokens: number): void {
    const state = this.states.get(streamId);
    if (!state) return;
    if (maxTokens <= 0 || maxTokens > 1048576) {
      logger.warn('Invalid maxTokens value', { streamId, maxTokens });
      return;
    }
    state.maxTokens = maxTokens;
  }

  /**
   * Add a tool call
   */
  addToolCall(streamId: string, toolCall: ToolCallState): void {
    const state = this.states.get(streamId);
    if (!state) return;
    state.toolCalls.push(toolCall);
  }

  /**
   * Get snapshot for client sync (excludes non-serializable fields)
   */
  getSnapshot(streamId: string): Omit<StreamState, 'abortController' | 'continuePromise' | 'onPaused' | 'onResumed' | 'pausedTokensBuffer' | 'pausedTokensCharCount'> | null {
    const state = this.states.get(streamId);
    if (!state) return null;

    const {
      abortController,
      continuePromise,
      onPaused,
      onResumed,
      pausedTokensBuffer,
      pausedTokensCharCount,
      ...snapshot
    } = state;
    return snapshot;
  }

  /**
   * Clean up expired stream states
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      const toDelete: string[] = [];

      for (const [streamId, state] of this.states) {
        if (now - state.updatedAt > this.TTL_MS && (state.isComplete || state.status === 'aborted' || state.status === 'error')) {
          toDelete.push(streamId);
        }
      }

      for (const streamId of toDelete) {
        this.delete(streamId);
        cleaned++;
      }

      if (cleaned > 0) {
        logger.debug('Cleaned up expired stream states', { cleaned, remaining: this.states.size });
      }
    }, 60000); // Every minute

    // Don't let the interval prevent process exit in test environments
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { total: number; streaming: number; paused: number; complete: number; error: number; aborted: number } {
    const stats = { total: 0, streaming: 0, paused: 0, complete: 0, error: 0, aborted: 0 };
    for (const state of this.states.values()) {
      stats.total++;
      switch (state.status) {
        case 'streaming': stats.streaming++; break;
        case 'paused': stats.paused++; break;
        case 'complete': stats.complete++; break;
        case 'error': stats.error++; break;
        case 'aborted': stats.aborted++; break;
      }
    }
    return stats;
  }
}

// =========================================================================
// Singleton
// =========================================================================

export const streamStateManager = new StreamStateManager();
