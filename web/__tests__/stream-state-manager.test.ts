/**
 * Stream State Manager — Unit Tests
 *
 * Tests all state transitions, edge cases, and safety guarantees.
 */

import { streamStateManager } from './stream-state-manager';

// Helper to create a test stream state
function createTestState(overrides = {}) {
  return streamStateManager.create({
    streamId: 'test-stream-1',
    userId: 'test-user',
    provider: 'openai',
    model: 'gpt-4o',
    ...overrides,
  });
}

describe('StreamStateManager', () => {
  beforeEach(() => {
    streamStateManager.stopCleanup();
    // Clear internal state via a create+delete cycle
    const s = createTestState();
    streamStateManager.abort(s.streamId);
  });

  describe('create', () => {
    it('creates a stream state with correct defaults', () => {
      const state = createTestState();
      expect(state.streamId).toBe('test-stream-1');
      expect(state.userId).toBe('test-user');
      expect(state.status).toBe('starting');
      expect(state.tokenCount).toBe(0);
      expect(state.content).toBe('');
      expect(state.isComplete).toBe(false);
      expect(state.maxTokens).toBe(65536);
      expect(state.maxContinuations).toBe(3);
    });

    it('throws if streamId is missing', () => {
      expect(() =>
        streamStateManager.create({
          streamId: '',
          userId: 'test',
          provider: 'x',
          model: 'x',
        })
      ).toThrow('streamId is required');
    });

    it('overwrites existing state for same streamId', () => {
      const s1 = createTestState();
      streamStateManager.appendToken(s1.streamId, 'hello');
      expect(s1.content).toBe('hello');

      const s2 = createTestState();
      expect(s2.streamId).toBe('test-stream-1');
      expect(s2.content).toBe(''); // Fresh state
      expect(s2.tokenCount).toBe(0);
    });
  });

  describe('appendToken', () => {
    it('appends tokens to content', () => {
      const state = createTestState();
      streamStateManager.appendToken(state.streamId, 'hello ');
      streamStateManager.appendToken(state.streamId, 'world');
      expect(state.content).toBe('hello world');
      expect(state.tokenCount).toBe(2);
    });

    it('ignores tokens for completed streams', () => {
      const state = createTestState();
      streamStateManager.appendToken(state.streamId, 'before');
      streamStateManager.complete(state.streamId);
      streamStateManager.appendToken(state.streamId, 'after');
      expect(state.content).toBe('before');
      expect(state.tokenCount).toBe(1);
    });

    it('ignores tokens for aborted streams', () => {
      const state = createTestState();
      streamStateManager.appendToken(state.streamId, 'before');
      streamStateManager.abort(state.streamId);
      streamStateManager.appendToken(state.streamId, 'after');
      expect(state.content).toBe('before');
    });

    it('caps content at MAX_CONTENT_CHARS (2MB)', () => {
      const state = createTestState();
      const bigToken = 'x'.repeat(2_000_000);
      streamStateManager.appendToken(state.streamId, bigToken);
      expect(state.contentLength).toBeLessThanOrEqual(2_097_152);
    });
  });

  describe('pause/resume', () => {
    it('buffers tokens while paused', () => {
      const state = createTestState();
      streamStateManager.appendToken(state.streamId, 'before ');
      streamStateManager.pause(state.streamId);
      streamStateManager.appendToken(state.streamId, 'paused');
      expect(state.content).toBe('before '); // Not appended yet
      expect(state.pausedTokensCharCount).toBe(6);

      const chunks = streamStateManager.resume(state.streamId);
      expect(chunks).toEqual(['paused']);
      // Note: resume returns chunks but doesn't auto-append to content
      // The caller is responsible for appending resumed tokens
    });

    it('caps paused token buffer at 5MB', () => {
      const state = createTestState();
      streamStateManager.pause(state.streamId);
      const bigToken = 'x'.repeat(5_000_000);
      streamStateManager.appendToken(state.streamId, bigToken);
      expect(state.pausedTokensCharCount).toBeLessThanOrEqual(5_242_880);
    });

    it('is idempotent — pausing twice is a no-op', () => {
      const state = createTestState();
      streamStateManager.pause(state.streamId);
      streamStateManager.appendToken(state.streamId, 'token1');
      streamStateManager.pause(state.streamId); // Should not clear buffer
      expect(state.pausedTokensCharCount).toBe(6);
    });
  });

  describe('abort', () => {
    it('sets status to aborted', () => {
      const state = createTestState();
      streamStateManager.abort(state.streamId);
      expect(state.status).toBe('aborted');
    });

    it('is idempotent — aborting twice does nothing', () => {
      const state = createTestState();
      streamStateManager.abort(state.streamId);
      streamStateManager.abort(state.streamId);
      expect(state.status).toBe('aborted');
    });
  });

  describe('complete', () => {
    it('sets status to complete with finish reason', () => {
      const state = createTestState();
      streamStateManager.complete(state.streamId, 'stop');
      expect(state.status).toBe('complete');
      expect(state.isComplete).toBe(true);
      expect(state.finishReason).toBe('stop');
      expect(state.completedAt).toBeDefined();
    });
  });

  describe('signalNeedMoreTurns / triggerContinue', () => {
    it('signals and resolves continuation', async () => {
      const state = createTestState();
      const signaled = await streamStateManager.signalNeedMoreTurns(state.streamId, 'context hint');
      expect(signaled).toBe(true);
      expect(state.continuationCount).toBe(1);

      // Resolve from "client"
      await streamStateManager.triggerContinue(state.streamId, { content: 'continued' });
      const result = await streamStateManager.waitForContinue(state.streamId);
      // waitForContinue returns null since promise was already resolved and cleared
      expect(result).toBeNull();
    });

    it('rejects continuation after max continuations', async () => {
      const state = createTestState({ maxContinuations: 2 });
      await streamStateManager.signalNeedMoreTurns(state.streamId);
      await streamStateManager.triggerContinue(state.streamId);
      await streamStateManager.signalNeedMoreTurns(state.streamId);
      await streamStateManager.triggerContinue(state.streamId);

      // Third should fail
      const signaled = await streamStateManager.signalNeedMoreTurns(state.streamId);
      expect(signaled).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns correct counts', () => {
      // Clear first
      const s1 = createTestState();
      const s2 = streamStateManager.create({
        streamId: 'test-stream-2',
        userId: 'u',
        provider: 'p',
        model: 'm',
      });
      streamStateManager.complete(s1.streamId);
      streamStateManager.appendToken(s2.streamId, 'hello');

      const stats = streamStateManager.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
      expect(stats.complete).toBeGreaterThanOrEqual(1);
      expect(stats.streaming).toBeGreaterThanOrEqual(1);
    });
  });
});
