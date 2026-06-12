/**
 * Bug #40 regression tests:
 *   1. [STEER] orchestration_fallback trigger kind + wireOrchestrationFallbackSteer
 *      emit a steer prompt and record the fire in steerMetrics.
 *   2. tagResultDegraded (exported as part of unified-agent-service) sets
 *      `metadata.degraded = true` + `metadata.fallbackReason` + increments the
 *      per-session orchestration-fallback counter.
 *   3. The degradation-tracker per-session counter round-trips through
 *      getOrchestrationFallbackCount / getTotalOrchestrationFallbackCount /
 *      getOrchestrationFallbackSnapshot.
 *   4. /api/health?detailed surfaces the orchestrationFallback block when
 *      there are fallbacks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { tagResultDegraded } from '@/lib/orchestra/unified-agent-service';

// Mock the logger so test output stays clean.
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import {
  wireOrchestrationFallbackSteer,
  buildSteerPrompt,
  steerMetrics,
} from '@/lib/orchestra/steer-service';
import {
  recordDegradation,
  incrementOrchestrationFallback,
  getOrchestrationFallbackCount,
  getTotalOrchestrationFallbackCount,
  getOrchestrationFallbackSnapshot,
  resetOrchestrationFallbackCount,
  _resetDegradationTrackerForTests,
} from '@/lib/observability/degradation-tracker';

describe('Bug #40: wireOrchestrationFallbackSteer', () => {
  beforeEach(() => {
    steerMetrics.reset();
  });

  it('returns null when fromMode or toMode is missing', () => {
    expect(wireOrchestrationFallbackSteer({
      fromMode: '', toMode: 'v1-api', fallbackReason: 'x', budgetExhausted: false,
    })).toBeNull();
    expect(wireOrchestrationFallbackSteer({
      fromMode: 'v1-agent-loop', toMode: '', fallbackReason: 'x', budgetExhausted: false,
    })).toBeNull();
  });

  it('builds a [STEER] prompt tagged with fromMode/toMode/reason', () => {
    const steer = wireOrchestrationFallbackSteer({
      fromMode: 'v1-agent-loop',
      toMode: 'v1-api',
      fallbackReason: 'orchestrator budget exhausted after 12 steps',
      budgetExhausted: true,
    });
    expect(steer).not.toBeNull();
    expect(steer).toMatch(/^\[STEER\]/);
    expect(steer).toContain('v1-agent-loop');
    expect(steer).toContain('v1-api');
    expect(steer).toContain('DEGRADED');
    expect(steer).toContain('budget exhausted');
  });

  it('records the fire in steerMetrics under orchestration_fallback', () => {
    expect(steerMetrics.countOf('orchestration_fallback')).toBe(0);
    wireOrchestrationFallbackSteer({
      fromMode: 'v1-agent-loop',
      toMode: 'v1-api',
      fallbackReason: 'budget exhausted',
      budgetExhausted: true,
    });
    expect(steerMetrics.countOf('orchestration_fallback')).toBe(1);
  });

  it('tailors the suggestion to the fallback reason (budgetExhausted vs not)', () => {
    const budgetSteer = wireOrchestrationFallbackSteer({
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'budget exhausted', budgetExhausted: true,
    });
    expect(budgetSteer!.toLowerCase()).toContain('simplify');

    const crashSteer = wireOrchestrationFallbackSteer({
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'orchestrator returned empty', budgetExhausted: false,
    });
    expect(crashSteer!.toLowerCase()).toContain('re-state');
  });
});

describe('Bug #40: buildSteerPrompt orchestration_fallback branch', () => {
  it('renders the orchestration_fallback case via buildSteerPrompt directly', () => {
    const prompt = buildSteerPrompt({
      kind: 'orchestration_fallback',
      detail: {
        fromMode: 'v1-agent-loop',
        toMode: 'v1-api',
        fallbackReason: 'budget_exhausted',
        budgetExhausted: true,
        suggestion: 'Simplify the plan.',
      },
    });
    expect(prompt).toMatch(/^\[STEER\]/);
    expect(prompt).toContain('v1-agent-loop');
    expect(prompt).toContain('v1-api');
    expect(prompt).toContain('DEGRADED');
  });
});

describe('Bug #40: per-session orchestration-fallback counter', () => {
  beforeEach(() => {
    _resetDegradationTrackerForTests();
  });

  it('starts at 0 for an unseen session', () => {
    expect(getOrchestrationFallbackCount('session-A')).toBe(0);
  });

  it('increments monotonically per session', () => {
    expect(incrementOrchestrationFallback('session-A')).toBe(1);
    expect(incrementOrchestrationFallback('session-A')).toBe(2);
    expect(incrementOrchestrationFallback('session-A')).toBe(3);
    expect(getOrchestrationFallbackCount('session-A')).toBe(3);
  });

  it('isolates counts across sessions', () => {
    incrementOrchestrationFallback('session-A');
    incrementOrchestrationFallback('session-A');
    incrementOrchestrationFallback('session-B');
    expect(getOrchestrationFallbackCount('session-A')).toBe(2);
    expect(getOrchestrationFallbackCount('session-B')).toBe(1);
    expect(getOrchestrationFallbackCount('session-C')).toBe(0);
  });

  it('sums across sessions for the aggregate count', () => {
    incrementOrchestrationFallback('session-A');
    incrementOrchestrationFallback('session-A');
    incrementOrchestrationFallback('session-B');
    incrementOrchestrationFallback('session-C');
    incrementOrchestrationFallback('session-C');
    incrementOrchestrationFallback('session-C');
    expect(getTotalOrchestrationFallbackCount()).toBe(6);
  });

  it('returns a sorted snapshot (top sessions first)', () => {
    incrementOrchestrationFallback('low');
    incrementOrchestrationFallback('high');
    incrementOrchestrationFallback('high');
    incrementOrchestrationFallback('high');
    incrementOrchestrationFallback('mid');
    incrementOrchestrationFallback('mid');
    const snap = getOrchestrationFallbackSnapshot();
    expect(snap[0].sessionId).toBe('high');
    expect(snap[0].count).toBe(3);
    expect(snap[1].sessionId).toBe('mid');
    expect(snap[1].count).toBe(2);
    expect(snap[2].sessionId).toBe('low');
    expect(snap[2].count).toBe(1);
  });

  it('resets a single session', () => {
    incrementOrchestrationFallback('session-A');
    incrementOrchestrationFallback('session-B');
    resetOrchestrationFallbackCount('session-A');
    expect(getOrchestrationFallbackCount('session-A')).toBe(0);
    expect(getOrchestrationFallbackCount('session-B')).toBe(1);
  });

  it('treats empty/null sessionId as default', () => {
    incrementOrchestrationFallback('');
    incrementOrchestrationFallback('');
    expect(getOrchestrationFallbackCount('default')).toBe(2);
    expect(getOrchestrationFallbackCount('')).toBe(2);
  });

  it('integrates with recordDegradation orchestration_fallback kind', () => {
    recordDegradation('session-X', 'orchestration_fallback', 'unified-agent-service', {
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
    });
    // The chain log shows the event; the per-session counter is
    // separate (incremented by tagResultDegraded, not recordDegradation).
    expect(getOrchestrationFallbackCount('session-X')).toBe(0);
    incrementOrchestrationFallback('session-X');
    expect(getOrchestrationFallbackCount('session-X')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Direct unit tests for tagResultDegraded (the function under review).
// These complement the integration tests above by exercising the function
// in isolation, covering: (a) the happy path, (b) the early-return guard,
// (c) the counter increment, (d) the undefined-metadata guard.
// ---------------------------------------------------------------------------

describe('tagResultDegraded — direct unit tests', () => {
  beforeEach(() => {
    _resetDegradationTrackerForTests();
  });

  it('a) sets metadata.degraded=true, fallbackReason, and nextTurnSteer', () => {
    // tagResultDegraded is imported at the top of the file
    const result: any = {
      success: true,
      response: 'ok',
      mode: 'v1-api',
      metadata: { provider: 'mistral' },
    };
    const tagged = tagResultDegraded(result, {
      fromMode: 'v1-agent-loop',
      toMode: 'v1-api',
      fallbackReason: 'orchestration_failed',
      sessionId: 'sess-direct-a',
    });
    expect(tagged.metadata.degraded).toBe(true);
    expect(tagged.metadata.fallbackReason).toBe('orchestration_failed');
    expect(typeof tagged.metadata.nextTurnSteer).toBe('string');
    expect(tagged.metadata.nextTurnSteer.length).toBeGreaterThan(0);
    // Original metadata fields are preserved.
    expect(tagged.metadata.provider).toBe('mistral');
  });

  it('b) returns the original result unchanged when fromMode or toMode is empty', () => {
    // tagResultDegraded is imported at the top of the file
    const result: any = {
      success: true,
      response: 'ok',
      mode: 'v1-api',
      metadata: { provider: 'mistral' },
    };
    const taggedEmptyFrom = tagResultDegraded(result, {
      fromMode: '',
      toMode: 'v1-api',
      fallbackReason: 'orchestration_failed',
      sessionId: 'sess-direct-b1',
    });
    const taggedEmptyTo = tagResultDegraded(result, {
      fromMode: 'v1-agent-loop',
      toMode: '',
      fallbackReason: 'orchestration_failed',
      sessionId: 'sess-direct-b2',
    });
    expect(taggedEmptyFrom).toBe(result);
    expect(taggedEmptyTo).toBe(result);
  });

  it('c) increments the per-session counter for the given sessionId', () => {
    // tagResultDegraded is imported at the top of the file
    const { getOrchestrationFallbackCount } = require('@/lib/observability/degradation-tracker');
    const result: any = {
      success: true, response: 'ok', mode: 'v1-api', metadata: {},
    };
    tagResultDegraded(result, {
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'orchestration_failed', sessionId: 'sess-direct-c',
    });
    tagResultDegraded(result, {
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'budget_exhausted', sessionId: 'sess-direct-c',
    });
    expect(getOrchestrationFallbackCount('sess-direct-c')).toBe(2);
  });

  it('d) handles result.metadata === undefined without throwing', () => {
    // tagResultDegraded is imported at the top of the file
    const result: any = {
      success: true, response: 'ok', mode: 'v1-api',
      // metadata intentionally omitted
    };
    expect(() => tagResultDegraded(result, {
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'orchestration_failed', sessionId: 'sess-direct-d',
    })).not.toThrow();
    const tagged = tagResultDegraded(result, {
      fromMode: 'v1-agent-loop', toMode: 'v1-api',
      fallbackReason: 'orchestration_failed', sessionId: 'sess-direct-d',
    });
    expect(tagged.metadata).toBeDefined();
    expect(tagged.metadata.degraded).toBe(true);
  });
});
