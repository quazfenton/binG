/**
 * Bug #117 (Pass-9 audit) regression tests — chat-metrics
 * completion-outcome discriminator.
 *
 * Locks down:
 *   1. recordEmptyCompletion(provider, finishReason) bumps emptyCompletions.count,
 *      populates byProviderAndReason[`${provider}:${finishReason}`], and sets lastAt.
 *   2. recordToolOnlyCompletion mirrors #1 with the same bucket-key contract.
 *   3. Repeated calls accumulate into the SAME bucket without cross-talk.
 *   4. Calling both record fns with overlapping provider+reason stays disjoint.
 *   5. Best-effort: never throws on a tampered proxy counter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordEmptyCompletion,
  recordToolOnlyCompletion,
  _resetChatMetricsForTests,
  getState,
} from '@/lib/chat/chat-metrics';

describe('Bug #117 — chat-metrics completion-outcome discriminator', () => {
  beforeEach(() => {
    _resetChatMetricsForTests();
  });

  it('records a single empty-completion bucket + count', () => {
    recordEmptyCompletion('mistral', 'length');
    const s = getState();
    expect(s.emptyCompletions.count).toBe(1);
    expect(s.emptyCompletions.byProviderAndReason['mistral:length']).toBe(1);
    expect(s.emptyCompletions.lastAt).toBeTypeOf('number');
    // Tool-only counter should stay at 0.
    expect(s.toolOnlyCompletions.count).toBe(0);
    expect(Object.keys(s.toolOnlyCompletions.byProviderAndReason)).toEqual([]);
  });

  it('records a single tool-only-completion bucket + count', () => {
    recordToolOnlyCompletion('openai', 'stop');
    const s = getState();
    expect(s.toolOnlyCompletions.count).toBe(1);
    expect(s.toolOnlyCompletions.byProviderAndReason['openai:stop']).toBe(1);
    expect(s.toolOnlyCompletions.lastAt).toBeTypeOf('number');
    // Empty counter should stay at 0.
    expect(s.emptyCompletions.count).toBe(0);
    expect(Object.keys(s.emptyCompletions.byProviderAndReason)).toEqual([]);
  });

  it('repeated calls accumulate into the same bucket', () => {
    recordEmptyCompletion('openai', 'stop');
    recordEmptyCompletion('openai', 'stop');
    recordEmptyCompletion('kimi', 'other');
    const s = getState();
    expect(s.emptyCompletions.count).toBe(3);
    expect(s.emptyCompletions.byProviderAndReason['openai:stop']).toBe(2);
    expect(s.emptyCompletions.byProviderAndReason['kimi:other']).toBe(1);
  });

  it('mixed providers + finishReasons do NOT collide', () => {
    recordEmptyCompletion('a', 'x');
    recordEmptyCompletion('a', 'y'); // different finishReason
    recordToolOnlyCompletion('a', 'x'); // same provider+reason but different outcome
    const s = getState();
    expect(s.emptyCompletions.byProviderAndReason['a:x']).toBe(1);
    expect(s.emptyCompletions.byProviderAndReason['a:y']).toBe(1);
    expect(s.emptyCompletions.count).toBe(2);
    expect(s.toolOnlyCompletions.byProviderAndReason['a:x']).toBe(1);
    expect(s.toolOnlyCompletions.byProviderAndReason['a:y']).toBeUndefined();
    expect(s.toolOnlyCompletions.count).toBe(1);
  });

  it('is best-effort: never throws on tampered proxy counter', () => {
    const state = getState();
    const orig = state.emptyCompletions;
    // Simulate a counter object that throws on assignment.
    (state as any).emptyCompletions = new Proxy({}, {
      set() { throw new Error('forced counter failure'); },
    });
    expect(() => recordEmptyCompletion('p', 'r')).not.toThrow();
    // Restore so beforeEach reset works next.
    (state as any).emptyCompletions = orig;
  });
});
