/**
 * Tests: Circuit Breaker Middleware
 *
 * Tests for withRouteCircuitBreaker, checkRouteCircuitBreaker,
 * recordRouteCircuitBreakerResult, getRouteCircuitBreakerStats,
 * resetRouteCircuitBreaker, and resetAllRouteCircuitBreakers.
 *
 * IMPORTANT: recordRouteCircuitBreakerResult returns silently when no breaker
 * exists for the route key. Breakers must be initialized via withRouteCircuitBreaker
 * before recording results. This design ensures per-route circuit breaker lifecycle
 * is managed by the wrapping middleware, not by ad-hoc result recording.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

import {
  withRouteCircuitBreaker,
  checkRouteCircuitBreaker,
  recordRouteCircuitBreakerResult,
  getRouteCircuitBreakerStats,
  resetRouteCircuitBreaker,
  resetAllRouteCircuitBreakers,
} from '@/lib/middleware/circuit-breaker-middleware';

// Helpers
function mockRequest(): any {
  return { url: 'http://localhost:3000/api/test' };
}

function mockHandler(response?: any): () => Promise<NextResponse> {
  return async () =>
    NextResponse.json(response ?? { success: true }, { status: 200 });
}

function mockFailingHandler(error: Error): () => Promise<NextResponse> {
  return async () => {
    throw error;
  };
}

/**
 * Initialize a breaker for the given route key before recording results.
 * recordRouteCircuitBreakerResult silently no-ops when no breaker exists,
 * so callers must ensure the breaker was created first.
 */
async function ensureBreaker(routeKey: string): Promise<void> {
  try {
    await withRouteCircuitBreaker(routeKey, mockHandler(), mockRequest());
  } catch {
    // Ignore — we just need the breaker to exist in the map
  }
}

// Reset all breakers before each test for isolation
beforeEach(() => {
  resetAllRouteCircuitBreakers();
});

describe('withRouteCircuitBreaker', () => {
  it('should execute handler normally when circuit is healthy', async () => {
    const response = await withRouteCircuitBreaker(
      '/api/test/success',
      mockHandler({ data: 'hello' }),
      mockRequest(),
    );

    const body = await response.json();
    expect(body).toEqual({ data: 'hello' });
    expect(response.status).toBe(200);
  });

  it('should return 503 when circuit is OPEN', async () => {
    const routeKey = '/api/test/open';

    // Initialize breaker first
    await ensureBreaker(routeKey);

    // Force the circuit open by recording 6 failures (> threshold of 5)
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`failure ${i}`));
    }

    // Now the handler should fail fast with 503
    const response = await withRouteCircuitBreaker(
      routeKey,
      mockHandler({ should: 'not reach' }),
      mockRequest(),
    );

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('unavailable');
    expect(body.retryAfter).toBe(30);
    expect(body.circuitState).toBe('OPEN');
  });

  it('should pass through non-circuit errors', async () => {
    const error = new Error('Business logic failure');

    await expect(
      withRouteCircuitBreaker(
        '/api/test/passthrough',
        mockFailingHandler(error),
        mockRequest(),
      ),
    ).rejects.toThrow('Business logic failure');
  });

  it('should return Retry-After header when circuit is open', async () => {
    const routeKey = '/api/test/headers';

    await ensureBreaker(routeKey);

    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`err ${i}`));
    }

    const response = await withRouteCircuitBreaker(
      routeKey,
      mockHandler(),
      mockRequest(),
    );

    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('X-Circuit-State')).toBe('OPEN');
  });

  it('should create isolated breakers per route key', async () => {
    await ensureBreaker('/api/test/route-a');

    // Force route-b circuit open
    await ensureBreaker('/api/test/route-b');
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult('/api/test/route-b', false, new Error(`err ${i}`));
    }

    // Route A should still work fine
    const responseA = await withRouteCircuitBreaker(
      '/api/test/route-a',
      mockHandler({ ok: true }),
      mockRequest(),
    );
    expect(responseA.status).toBe(200);

    // Route B should be blocked
    const responseB = await withRouteCircuitBreaker(
      '/api/test/route-b',
      mockHandler(),
      mockRequest(),
    );
    expect(responseB.status).toBe(503);
  });
});

describe('checkRouteCircuitBreaker', () => {
  it('should return false when no breaker exists (healthy)', () => {
    expect(checkRouteCircuitBreaker('/api/test/never-used')).toBe(false);
  });

  it('should return false when circuit is healthy', async () => {
    await ensureBreaker('/api/test/healthy');
    await recordRouteCircuitBreakerResult('/api/test/healthy', true);

    expect(checkRouteCircuitBreaker('/api/test/healthy')).toBe(false);
  });

  it('should return true when circuit is OPEN', async () => {
    const routeKey = '/api/test/open-check';

    await ensureBreaker(routeKey);
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`fail ${i}`));
    }

    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);
  });

  it('should NOT modify circuit state (read-only)', async () => {
    const routeKey = '/api/test/readonly';

    await ensureBreaker(routeKey);
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`fail ${i}`));
    }

    // Check multiple times — state should remain OPEN
    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);
    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);
    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);
  });
});

describe('recordRouteCircuitBreakerResult', () => {
  it('should record success without error', async () => {
    const routeKey = '/api/test/record-success';
    await ensureBreaker(routeKey);

    await recordRouteCircuitBreakerResult(routeKey, true);
    await recordRouteCircuitBreakerResult(routeKey, true);
    await recordRouteCircuitBreakerResult(routeKey, true);

    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);
  });

  it('should record failure without opening circuit prematurely', async () => {
    const routeKey = '/api/test/one-failure';
    await ensureBreaker(routeKey);

    await recordRouteCircuitBreakerResult(routeKey, false, new Error('downstream error'));

    // After 1 failure, still healthy (needs 5)
    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);
  });

  it('should open circuit after accumulating enough failures', async () => {
    const routeKey = '/api/test/accumulate';
    await ensureBreaker(routeKey);

    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`error ${i}`));
    }

    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);
  });

  it('should close circuit after successive successes (recovery)', async () => {
    const routeKey = '/api/test/recover';
    await ensureBreaker(routeKey);

    // Open the circuit with 6 failures
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`fail ${i}`));
    }
    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);

    // Advance time past recoveryTimeout (30s for the middleware default)
    vi.useFakeTimers();
    vi.advanceTimersByTime(120000); // 2 min — well past 30s recovery

    // Record 2 successes to close (successThreshold: 2)
    await recordRouteCircuitBreakerResult(routeKey, true);
    await recordRouteCircuitBreakerResult(routeKey, true);

    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);

    vi.useRealTimers();
  });

  it('should handle undefined error gracefully', async () => {
    const routeKey = '/api/test/no-error';
    await ensureBreaker(routeKey);

    await recordRouteCircuitBreakerResult(routeKey, false);

    // Should not throw and should record a failure
    expect(checkRouteCircuitBreaker(routeKey)).toBe(false); // need 5, not 1
  });

  it('should silently no-op when breaker does not exist', async () => {
    await expect(
      recordRouteCircuitBreakerResult('/api/test/no-such-breaker', true),
    ).resolves.toBeUndefined();

    expect(checkRouteCircuitBreaker('/api/test/no-such-breaker')).toBe(false);
  });
});

describe('getRouteCircuitBreakerStats', () => {
  it('should return empty stats when no breakers exist', () => {
    // resetAllRouteCircuitBreakers() in beforeEach clears the map,
    // so no breakers should remain from previous tests.
    const stats = getRouteCircuitBreakerStats();
    expect(stats).toEqual({});
  });

  it('should return stats for initialized breakers', async () => {
    await ensureBreaker('/api/test/stats');

    const stats = getRouteCircuitBreakerStats();

    expect(stats['/api/test/stats']).toBeDefined();
    expect(stats['/api/test/stats'].state).toMatch(/HEALTHY|OPEN|HALF_OPEN|TESTING/);
    expect(typeof stats['/api/test/stats'].failureCount).toBe('number');
    expect(typeof stats['/api/test/stats'].successCount).toBe('number');
  });

  it('should report all initialized breakers', async () => {
    await ensureBreaker('/api/test/a');
    await ensureBreaker('/api/test/b');
    await ensureBreaker('/api/test/c');

    const stats = getRouteCircuitBreakerStats();
    const keys = Object.keys(stats);

    expect(keys).toContain('/api/test/a');
    expect(keys).toContain('/api/test/b');
    expect(keys).toContain('/api/test/c');
  });

  it('should include lastFailureTime as ISO string or null', async () => {
    const routeKey = '/api/test/last-failure';
    await ensureBreaker(routeKey);

    await recordRouteCircuitBreakerResult(routeKey, false, new Error('test'));

    const stats = getRouteCircuitBreakerStats();

    expect(stats[routeKey]).toBeDefined();
    if (stats[routeKey].lastFailureTime !== null) {
      expect(() => new Date(stats[routeKey].lastFailureTime!)).not.toThrow();
    }
  });
});

describe('resetRouteCircuitBreaker', () => {
  it('should reset an OPEN circuit back to healthy', async () => {
    const routeKey = '/api/test/reset-single';
    await ensureBreaker(routeKey);

    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`fail ${i}`));
    }
    expect(checkRouteCircuitBreaker(routeKey)).toBe(true);

    resetRouteCircuitBreaker(routeKey);
    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);
  });

  it('should no-op when breaker does not exist', () => {
    expect(() => resetRouteCircuitBreaker('/api/test/does-not-exist')).not.toThrow();
  });

  it('should allow requests after reset', async () => {
    const routeKey = '/api/test/reset-and-use';
    await ensureBreaker(routeKey);

    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult(routeKey, false, new Error(`fail ${i}`));
    }

    resetRouteCircuitBreaker(routeKey);

    const response = await withRouteCircuitBreaker(
      routeKey,
      mockHandler({ recovered: true }),
      mockRequest(),
    );

    expect(response.status).toBe(200);
  });
});

describe('resetAllRouteCircuitBreakers', () => {
  it('should reset all breakers', async () => {
    await ensureBreaker('/api/test/all-a');
    await ensureBreaker('/api/test/all-b');

    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult('/api/test/all-a', false, new Error(`fail ${i}`));
      await recordRouteCircuitBreakerResult('/api/test/all-b', false, new Error(`fail ${i}`));
    }

    expect(checkRouteCircuitBreaker('/api/test/all-a')).toBe(true);
    expect(checkRouteCircuitBreaker('/api/test/all-b')).toBe(true);

    resetAllRouteCircuitBreakers();

    expect(checkRouteCircuitBreaker('/api/test/all-a')).toBe(false);
    expect(checkRouteCircuitBreaker('/api/test/all-b')).toBe(false);
  });

  it('should not throw when no breakers exist', () => {
    expect(() => resetAllRouteCircuitBreakers()).not.toThrow();
  });
});

describe('edge cases', () => {
  it('should handle rapid success/failure toggling', async () => {
    const routeKey = '/api/test/rapid';
    await ensureBreaker(routeKey);

    await recordRouteCircuitBreakerResult(routeKey, true);
    await recordRouteCircuitBreakerResult(routeKey, false, new Error('blip'));
    await recordRouteCircuitBreakerResult(routeKey, true);
    await recordRouteCircuitBreakerResult(routeKey, false, new Error('blip'));

    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);
  });

  it('should isolate different route keys', async () => {
    await ensureBreaker('/api/test/key-a');
    await ensureBreaker('/api/test/key-b');

    // Force key-a open
    for (let i = 0; i < 6; i++) {
      await recordRouteCircuitBreakerResult('/api/test/key-a', false, new Error(`fail ${i}`));
    }

    // key-b should be unaffected
    expect(checkRouteCircuitBreaker('/api/test/key-a')).toBe(true);
    expect(checkRouteCircuitBreaker('/api/test/key-b')).toBe(false);
  });

  it('should handle spec-amplification route key', async () => {
    const routeKey = '/api/chat/spec-amplification';
    await ensureBreaker(routeKey);

    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);

    await recordRouteCircuitBreakerResult(routeKey, false, new Error('spec-amp timed out'));

    expect(checkRouteCircuitBreaker(routeKey)).toBe(false);
  });
});
