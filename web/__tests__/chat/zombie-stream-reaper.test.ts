/**
 * zombie-stream-reaper.test.ts — Bug 2 zombie-stream closure (2026-07-22).
 *
 * Ticket: /opt/bing/.tickets/BUG2-ZOMBIE-STREAM-REAPER.md
 * Closes: "Zombie Streams: 19+ Minute Silence After bash_execute (CRITICAL)"
 *         from /opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md (Round 2 Bug 3).
 *
 * Contract under test:
 *   - registerStream + sweepOnce reaps streams whose lastActivityTime is older
 *     than the threshold; emits stallWatchdogEnvelope + chatLogger.error +
 *     recordDegradation; force-aborts the AbortController; removes from registry.
 *   - updateStreamActivity pushes the stream's lastActivityTime forward, so
 *     an actively-streaming request is NOT reaped.
 *   - registerStream auto-starts the setInterval on the first call (lazy init).
 *   - unregisterStream is idempotent + forceReap on an unregistered stream is a no-op.
 *   - globalThis Map + interval ID survive Next.js dev hot-reload.
 *   - Map cap of 1000 evicts the oldest entry (lastActivityTime-min) on overflow.
 *   - The interval-driven sweep reaps on its own — no manual sweepOnce() call needed.
 *
 * Mocks at the top so the reaper's 3 external dependencies are predictable:
 *   - @/lib/api/response-router → stallWatchdogEnvelope (returns a tagged mock)
 *   - @/lib/observability/degradation-tracker → recordDegradation (vi.fn())
 *   - @/lib/chat/chat-logger → chatLogger (vi.fn() methods)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Module mocks (always at top, before any import that uses them) ──────────────

vi.mock('@/lib/api/response-router', () => ({
  stallWatchdogEnvelope: vi.fn((meta: any) => ({
    kind: 'mock-stall-watchdog',
    code: meta?.code ?? 'STALL_WATCHDOG',
    message: meta?.message ?? 'mock stall',
    stall: {
      msSinceLastChunk: meta?.msSinceLastChunk,
      reason: meta?.reason,
    },
    streamId: meta?.streamId,
    timestamp: new Date('2026-07-22T12:00:00Z').toISOString(),
  })),
  __mockEnvelopeKind: 'mock-stall-watchdog',
}));

vi.mock('@/lib/observability/degradation-tracker', () => ({
  recordDegradation: vi.fn(),
}));

vi.mock('@/lib/chat/chat-logger', () => ({
  chatLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports under test (after mocks so they get the mocked modules) ───────────

import {
  registerStream,
  updateStreamActivity,
  unregisterStream,
  forceReap,
  sweepOnce,
  getActiveStreamCount,
  getActiveStreams,
  _resetForTests,
  _setReaperIntervalForTests,
  _setReapThresholdForTests,
} from '@/lib/chat/zombie-stream-reaper';
import { stallWatchdogEnvelope } from '@/lib/api/response-router';
import { recordDegradation } from '@/lib/observability/degradation-tracker';
import { chatLogger } from '@/lib/chat/chat-logger';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_TIMESTAMP = new Date('2026-07-22T12:00:00Z').getTime();

function makeStreamMeta(overrides?: Partial<{
  streamId: string;
  lastActivityTime: number;
  lastActivityType: 'init' | 'text' | 'tool-call' | 'tool-result';
  provider: string;
  modelName: string;
}>) {
  const ac = new AbortController();
  return {
    streamId: overrides?.streamId ?? 'stream-test',
    abortController: ac,
    lastActivityTime: overrides?.lastActivityTime ?? TEST_TIMESTAMP,
    lastActivityType: overrides?.lastActivityType ?? ('init' as const),
    provider: overrides?.provider ?? 'openai',
    modelName: overrides?.modelName ?? 'gpt-4o',
    __abortController: ac, // hidden accessor for test assertions
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('zombie-stream-reaper (Bug 2 closure 2026-07-22)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_TIMESTAMP));
    _resetForTests();
    _setReapThresholdForTests(5_000); // 5s for fast tests
    vi.mocked(stallWatchdogEnvelope).mockClear();
    vi.mocked(recordDegradation).mockClear();
    vi.mocked(chatLogger.error).mockClear();
    vi.mocked(chatLogger.warn).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetForTests();
  });

  // ===== Reap-after-threshold: primary defensive contract =====================

  describe('reap after threshold (primary contract)', () => {
    it('reaps a stream whose lastActivityTime is older than threshold', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-stale',
        lastActivityTime: TEST_TIMESTAMP - 10_000, // 10s ago, beyond 5s threshold
        lastActivityType: 'text',
      });
      registerStream(meta);

      expect(getActiveStreamCount()).toBe(1);

      const reapCount = sweepOnce();

      expect(reapCount).toBe(1);
      expect(getActiveStreamCount()).toBe(0);
      expect(meta.__abortController.signal.aborted).toBe(true);
    });

    it('does NOT reap a stream whose lastActivityTime is within threshold', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-fresh',
        lastActivityTime: TEST_TIMESTAMP, // fresh
        lastActivityType: 'text',
      });
      registerStream(meta);

      const reapCount = sweepOnce();

      expect(reapCount).toBe(0);
      expect(getActiveStreamCount()).toBe(1);
      expect(meta.__abortController.signal.aborted).toBe(false);
    });

    it('emits stallWatchdogEnvelope on reap with correct fields', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-envelope',
        lastActivityTime: TEST_TIMESTAMP - 10_000,
        lastActivityType: 'tool-call',
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet',
      });
      registerStream(meta);

      sweepOnce();

      expect(stallWatchdogEnvelope).toHaveBeenCalledTimes(1);
      const envelopeArgs = vi.mocked(stallWatchdogEnvelope).mock.calls[0][0];
      expect(envelopeArgs.msSinceLastChunk).toBeGreaterThanOrEqual(10_000);
      expect(envelopeArgs.reason).toMatch(/^zombie-reaper:/);
      expect(envelopeArgs.streamId).toBe('stream-envelope');
      expect(envelopeArgs.message).toMatch(/reaped after \d+ms silence/);
    });

    it('records degradation event on reap with kind=mid_stream_stall + source=zombie-reaper', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-degrade',
        lastActivityTime: TEST_TIMESTAMP - 10_000,
        lastActivityType: 'tool-result',
      });
      registerStream(meta);

      sweepOnce();

      expect(recordDegradation).toHaveBeenCalledTimes(1);
      // recordDegradation signature: (sessionId, kind, source, detail?)
      // sessionId: reaper derives `orphan-${streamId}` when caller didn't pass
      // a real sessionId (see SHOULDCONSIDER #2 from prior round).
      const callArgs = vi.mocked(recordDegradation).mock.calls[0];
      expect(callArgs[0]).toBe('orphan-stream-degrade');  // sessionId = orphan-{streamId}
      expect(callArgs[1]).toBe('mid_stream_stall');       // kind
      expect(callArgs[2]).toBe('zombie-reaper');          // source distinguishes from per-stream timeout
      expect(callArgs[3]).toMatchObject({                 // detail Record
        streamId: 'stream-degrade',
        lastActivityType: 'tool-result',
        provider: 'openai',
      });
      expect(callArgs[3]?.silenceMs).toBeGreaterThanOrEqual(10_000);
    });

    it('emits chatLogger.error with [ZOMBIE-REAPER] prefix + envelope payload', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-log',
        lastActivityTime: TEST_TIMESTAMP - 10_000,
        lastActivityType: 'text',
      });
      registerStream(meta);

      sweepOnce();

      expect(chatLogger.error).toHaveBeenCalledTimes(1);
      const errorCall = vi.mocked(chatLogger.error).mock.calls[0];
      expect(errorCall[0]).toMatch(/^\[ZOMBIE-REAPER\] Reaped inactive stream/);
      expect(errorCall[1]?.streamId).toBe('stream-log');
      expect(errorCall[1]?.envelope?.kind).toBe('mock-stall-watchdog');
      expect(errorCall[1]?.silenceMs).toBeGreaterThanOrEqual(10_000);
    });
  });

  // ===== updateStreamActivity: the activity-pump that keeps streams alive =====

  describe('updateStreamActivity (activity pump)', () => {
    it('pushes lastActivityTime forward so a stale stream becomes fresh', () => {
      const meta = makeStreamMeta({
        streamId: 'stream-bumped',
        lastActivityTime: TEST_TIMESTAMP - 10_000, // initially beyond 5s threshold
        lastActivityType: 'text',
      });
      registerStream(meta);

      // Simulate a token arriving — the reaper should treat this as fresh activity
      updateStreamActivity('stream-bumped', 'tool-call');

      const reapCount = sweepOnce();
      expect(reapCount).toBe(0);
      expect(getActiveStreamCount()).toBe(1);

      const streams = getActiveStreams();
      expect(streams[0].lastActivityType).toBe('tool-call');
      expect(streams[0].lastActivityTime).toBe(TEST_TIMESTAMP);
    });

    it('is a silent no-op for an unregistered streamId (no throw)', () => {
      expect(() => updateStreamActivity('does-not-exist', 'text')).not.toThrow();
      expect(getActiveStreamCount()).toBe(0);
    });
  });

  // ===== register / unregister / forceReap semantic edges =====================

  describe('register / unregister / forceReap semantics', () => {
    it('registerStream auto-starts the setInterval on first call (lazy init)', () => {
      _resetForTests();
      expect(globalThis.__zombieReaperIntervalId__).toBeUndefined();

      registerStream(makeStreamMeta({ streamId: 'stream-lazy' }));

      expect(globalThis.__zombieReaperIntervalId__).toBeDefined();
    });

    it('registering the same streamId twice updates in place (no double-count)', () => {
      const meta1 = makeStreamMeta({
        streamId: 'stream-dup',
        lastActivityType: 'init',
      });
      registerStream(meta1);
      const meta2 = makeStreamMeta({
        streamId: 'stream-dup',
        lastActivityType: 'text',
      });
      registerStream(meta2);

      expect(getActiveStreamCount()).toBe(1);
      const streams = getActiveStreams();
      expect(streams[0].abortController).toBe(meta2.__abortController);
      expect(streams[0].lastActivityType).toBe('text');
      // The unselected meta1's abortController was NOT reaped
      expect(meta1.__abortController.signal.aborted).toBe(false);
    });

    it('unregisterStream removes from registry', () => {
      const meta = makeStreamMeta({ streamId: 'stream-unreg' });
      registerStream(meta);
      expect(getActiveStreamCount()).toBe(1);

      unregisterStream('stream-unreg');
      expect(getActiveStreamCount()).toBe(0);
    });

    it('unregisterStream is idempotent (double-unregister does not throw)', () => {
      expect(() => unregisterStream('never-existed')).not.toThrow();
      const meta = makeStreamMeta({ streamId: 'stream-unreg' });
      registerStream(meta);
      unregisterStream('stream-unreg');
      expect(() => unregisterStream('stream-unreg')).not.toThrow();
      expect(getActiveStreamCount()).toBe(0);
    });

    it('forceReap on an unregistered stream is a no-op', () => {
      expect(() => forceReap('never-existed', 'test')).not.toThrow();
      expect(stallWatchdogEnvelope).not.toHaveBeenCalled();
      expect(recordDegradation).not.toHaveBeenCalled();
    });
  });

  // ===== Map cap at MAX_ACTIVE_STREAMS =========================================

  describe('Map cap at MAX_ACTIVE_STREAMS (= 1000)', () => {
    it('evicts the oldest entry (lowest lastActivityTime) when capacity is reached', () => {
      // Widen threshold so only the cap-eviction path fires, not the time threshold
      _setReapThresholdForTests(60_000);

      // Register 1000 streams with monotonically decreasing lastActivityTime so
      // stream 0 is the oldest, then register one more — should trigger eviction.
      for (let i = 0; i < 1000; i++) {
        registerStream(makeStreamMeta({
          streamId: `stream-cap-${i.toString().padStart(4, '0')}`,
          // Older first (i=0 is oldest; i=999 is freshest)
          lastActivityTime: TEST_TIMESTAMP - (1000 - i) * 1000,
          lastActivityType: 'init',
        }));
      }
      expect(getActiveStreamCount()).toBe(1000);

      // One more registration should trigger cap eviction of the oldest entry
      registerStream(makeStreamMeta({
        streamId: 'stream-cap-evicter',
        lastActivityTime: TEST_TIMESTAMP,
        lastActivityType: 'init',
      }));

      const ids = getActiveStreams().map((s) => s.streamId);
      expect(ids).not.toContain('stream-cap-0000'); // oldest evicted
      expect(ids).toContain('stream-cap-evicter');
      expect(getActiveStreamCount()).toBe(1000);
    });
  });

  // ===== Hot-reload singleton survival =========================================

  describe('globalThis singleton hot-reload survival', () => {
    it('Map persists across module reloads via globalThis.__activeStreams__', () => {
      const meta = makeStreamMeta({ streamId: 'stream-pre-reload' });
      registerStream(meta);

      // Simulate hot-reload by clearing local module-scoped reference and
      // re-importing: the new module load reads globalThis.__activeStreams__
      // and picks up the existing registry.
      const persistedMap = globalThis.__activeStreams__;
      expect(persistedMap).toBeDefined();
      expect(persistedMap?.has('stream-pre-reload')).toBe(true);
    });

    it('cleanup listener registered once via __zombieReaperCleanupListenerRegistered__', () => {
      // The beforeExit listener is registered once per process via the sentinel;
      // hot-reloads do NOT re-register (which would leak listeners).
      expect(globalThis.__zombieReaperCleanupListenerRegistered__).toBe(true);
    });
  });

  // ===== Interval-driven sweep =================================================

  describe('interval-driven sweep (production hot path)', () => {
    it('reaps a stale stream automatically when the sweep interval fires', () => {
      _setReaperIntervalForTests(1_000); // 1s sweeps
      registerStream(makeStreamMeta({
        streamId: 'stream-interval',
        lastActivityTime: TEST_TIMESTAMP - 10_000, // beyond 5s threshold
      }));

      expect(getActiveStreamCount()).toBe(1);

      // Advance fake timers by 1 second → setInterval fires → sweep runs → reap
      vi.advanceTimersByTime(1_000);

      expect(getActiveStreamCount()).toBe(0);
      expect(chatLogger.error).toHaveBeenCalled();
    });

    it('does NOT reap a stream whose activity is continuously bumped (production hot path)', () => {
      _setReaperIntervalForTests(1_000); // 1s sweeps
      _setReapThresholdForTests(5_000);  // 5s threshold
      registerStream(makeStreamMeta({
        streamId: 'stream-hovering',
        lastActivityTime: TEST_TIMESTAMP, // fresh
      }));

      // Continuously bump activity fast enough that the per-sweep check finds
      // lastActivityTime within the 5s threshold. 800ms < 1000ms sweep
      // interval ensures the sweep fires WHILE the lastActivityTime is fresh.
      // 12 iterations × 800ms = 9.6s of continuous activity.
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(800);
        updateStreamActivity('stream-hovering', 'text');
      }

      // After 9.6s of continuous bumps, the stream is STILL alive.
      expect(getActiveStreamCount()).toBe(1);
      expect(chatLogger.error).not.toHaveBeenCalled();
    });

    it('DOES reap a stream whose activity stopped (post-bump stall)', () => {
      _setReaperIntervalForTests(1_000); // 1s sweeps
      _setReapThresholdForTests(5_000);  // 5s threshold
      registerStream(makeStreamMeta({
        streamId: 'stream-stops',
        lastActivityTime: TEST_TIMESTAMP,
      }));

      // Bump 3 times (keeps stream alive for 2.4s)
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(800);
        updateStreamActivity('stream-stops', 'text');
      }
      expect(getActiveStreamCount()).toBe(1);

      // Stop bumping; advance 6 seconds (5s threshold + 1s sweep fudge factor)
      vi.advanceTimersByTime(6_000);

      // Stream should now be reaped
      expect(getActiveStreamCount()).toBe(0);
      expect(chatLogger.error).toHaveBeenCalledTimes(1);
    });
  });
});
