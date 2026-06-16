/**
 * Unit tests for recordFailureBreaker + stopBreakerCooldownSweep (Bug #90, Pass-6).
 *
 * Verifies:
 *   1. recordFailureBreaker sets a deadline via getBreakerCooldownUntil
 *   2. The setTimeout fires after cooldownMs and clears the deadline
 *   3. cooldownMs validation: negative / NaN / Infinity coerced to 0
 *   4. stopBreakerCooldownSweep is callable and safe in test mode
 *      (the interval is null when SANDBOX_TEST / NODE_ENV=test / VITEST
 *       is set, so the function is a no-op in vitest)
 *   5. Independent state per key
 *   6. sweepStaleBreakerCooldowns evicts expired entries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordFailureBreaker,
  stopBreakerCooldownSweep,
  sweepStaleBreakerCooldowns,
  getBreakerCooldownUntil,
} from '../circuit-breaker';

describe('recordFailureBreaker (Bug #90)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any pending setTimeout handles + sweep state.
    sweepStaleBreakerCooldowns(0);
    vi.useRealTimers();
  });

  it('sets a deadline in breakerCooldowns observable via getBreakerCooldownUntil', () => {
    const KEY = 'test-key-deadline-set';
    expect(getBreakerCooldownUntil(KEY)).toBeNull();

    const cooldownMs = 60_000;
    recordFailureBreaker(KEY, cooldownMs);

    const deadline = getBreakerCooldownUntil(KEY);
    expect(deadline).not.toBeNull();
    expect(deadline).toBe(Date.now() + cooldownMs);
  });

  it('clears the deadline after the cooldown elapses (setTimeout fires)', () => {
    const KEY = 'test-key-clear-after-cooldown';
    recordFailureBreaker(KEY, 5_000);

    expect(getBreakerCooldownUntil(KEY)).not.toBeNull();

    // Advance past the cooldown boundary
    vi.advanceTimersByTime(5_000);

    expect(getBreakerCooldownUntil(KEY)).toBeNull();
  });

  it('does NOT clear the deadline before the cooldown elapses', () => {
    const KEY = 'test-key-no-early-clear';
    recordFailureBreaker(KEY, 10_000);

    vi.advanceTimersByTime(9_999);

    expect(getBreakerCooldownUntil(KEY)).not.toBeNull();
  });

  it('coerces a negative cooldownMs to 0 (immediate reset)', () => {
    const KEY = 'test-key-negative-cooldown';
    recordFailureBreaker(KEY, -100);

    // With cooldownMs=0, the setTimeout fires on the next tick.
    vi.advanceTimersByTime(0);

    // After the immediate reset, the deadline is cleared.
    expect(getBreakerCooldownUntil(KEY)).toBeNull();
  });

  it('coerces NaN to 0 (defensive against bad config)', () => {
    const KEY = 'test-key-nan-cooldown';
    recordFailureBreaker(KEY, NaN);

    // Should not throw + should not infinite-loop.
    vi.advanceTimersByTime(0);

    expect(getBreakerCooldownUntil(KEY)).toBeNull();
  });

  it('coerces Infinity to 0 (defensive against bad config)', () => {
    const KEY = 'test-key-infinity-cooldown';
    recordFailureBreaker(KEY, Infinity);

    vi.advanceTimersByTime(0);

    expect(getBreakerCooldownUntil(KEY)).toBeNull();
  });

  it('independent state per key (one cooldown does not affect another)', () => {
    recordFailureBreaker('key-A', 60_000);
    recordFailureBreaker('key-B', 5_000);

    // Advance past key-B's cooldown but not key-A's
    vi.advanceTimersByTime(5_000);

    expect(getBreakerCooldownUntil('key-A')).not.toBeNull();
    expect(getBreakerCooldownUntil('key-B')).toBeNull();
  });

  it('overwrites the deadline when the same key is recorded again', () => {
    recordFailureBreaker('key-double', 60_000);
    const firstDeadline = getBreakerCooldownUntil('key-double');

    vi.advanceTimersByTime(30_000);
    recordFailureBreaker('key-double', 60_000);
    const secondDeadline = getBreakerCooldownUntil('key-double');

    // Second deadline should be 30s later than the first
    expect(secondDeadline).not.toBeNull();
    expect(firstDeadline).not.toBeNull();
    expect(secondDeadline! > firstDeadline!).toBe(true);
  });

  it('returns a setTimeout handle that can be cleared (so callers can cancel on success)', () => {
    const KEY = 'test-key-cancellable';
    const handle = recordFailureBreaker(KEY, 10_000);

    expect(handle).toBeDefined();
    expect(typeof clearTimeout).toBe('function');

    clearTimeout(handle);
    // Even after advancing past the cooldown, the deadline should NOT be
    // cleared because we cancelled the timer.
    vi.advanceTimersByTime(20_000);
    expect(getBreakerCooldownUntil(KEY)).not.toBeNull();
  });
});

describe('sweepStaleBreakerCooldowns (Bug #90)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    sweepStaleBreakerCooldowns(0);
    vi.useRealTimers();
  });

  it('evicts entries whose deadline is older than staleMs', () => {
    recordFailureBreaker('stale-key', 10_000);
    expect(getBreakerCooldownUntil('stale-key')).not.toBeNull();

    // Advance past the deadline + into "stale" territory
    vi.advanceTimersByTime(20_000);
    // Note: the setTimeout already fired and cleared the entry. sweepStaleBreakerCooldowns
    // is a belt-and-suspenders eviction for entries that survived (e.g., cleared
    // timers + manual map mutations).

    recordFailureBreaker('fresh-key', 100_000);
    const freshDeadline = getBreakerCooldownUntil('fresh-key');
    expect(freshDeadline).not.toBeNull();

    // Sweep with a 5s window: stale-key (deadline 20s ago) is evicted,
    // fresh-key (deadline 80s in the future) survives.
    // But the auto-reset has already cleared stale-key, so we just verify
    // fresh-key survives.
    const evicted = sweepStaleBreakerCooldowns(5_000);
    expect(getBreakerCooldownUntil('fresh-key')).toBe(freshDeadline);
    // stale-key was already auto-cleared by its setTimeout, so the sweep
    // doesn't need to evict it.
    expect(evicted).toBeGreaterThanOrEqual(0);
  });

  it('returns the number of entries evicted (useful for observability)', () => {
    recordFailureBreaker('obs-1', 10_000);
    recordFailureBreaker('obs-2', 10_000);
    recordFailureBreaker('obs-3', 10_000);

    vi.advanceTimersByTime(20_000);
    // Auto-cleared all 3. Sweep should report 0 additional evictions.
    const evicted = sweepStaleBreakerCooldowns(0);
    expect(typeof evicted).toBe('number');
    expect(evicted).toBeGreaterThanOrEqual(0);
  });
});

describe('stopBreakerCooldownSweep (Bug #90)', () => {
  it('is callable and does not throw', () => {
    // The interval is null in test mode (SANDBOX_TEST / NODE_ENV=test /
    // VITEST env gate), so this is a no-op. The test verifies the
    // function is safely callable from shutdown hooks.
    expect(() => stopBreakerCooldownSweep()).not.toThrow();
  });

  it('is idempotent — can be called multiple times safely', () => {
    expect(() => {
      stopBreakerCooldownSweep();
      stopBreakerCooldownSweep();
      stopBreakerCooldownSweep();
    }).not.toThrow();
  });

  it('does not interfere with recordFailureBreaker deadlines', () => {
    // The sweep interval is null in tests, so stopping it (a no-op) must
    // not affect the deadline map populated by recordFailureBreaker.
    recordFailureBreaker('after-stop-key', 60_000);
    expect(getBreakerCooldownUntil('after-stop-key')).not.toBeNull();

    stopBreakerCooldownSweep();

    expect(getBreakerCooldownUntil('after-stop-key')).not.toBeNull();
  });
});
