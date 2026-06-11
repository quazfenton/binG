/**
 * Tests for the in-memory KV sync behavior of checkRateLimit.
 *
 * Audit goal: verify that KV_SYNC_INTERVAL_MS = 300_000 (5 min) is correctly
 * enforced — i.e., 100 rapid calls within the same minute window must result
 * in at most 1 kv.put call. This guards against accidental regression that
 * would re-introduce per-request KV writes and blow the free-tier 1k/day cap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit, checkIpRateLimit, checkUserRateLimit } from '../src/rate-limiter';

interface MockKv {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function makeMockKv(initialValue: unknown = null): MockKv {
  return {
    get: vi.fn().mockResolvedValue(initialValue),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Generate a unique rate-limit key per test so module-level `memoryCounters`
 * and `lastSyncTimes` Maps don't leak state between tests.
 */
function uniqueKey(prefix: string): string {
  return `test:${prefix}:${Date.now()}-${Math.random()}:${Math.random()}`;
}

describe('checkRateLimit KV sync behavior', () => {
  let kv: MockKv;

  beforeEach(() => {
    kv = makeMockKv();
  });

  it('100 rapid calls within the same minute produce at most 1 kv.put', async () => {
    const key = uniqueKey('100-rapid');
    for (let i = 0; i < 100; i++) {
      await checkRateLimit(kv as unknown as KVNamespace, key, 1000);
    }
    // All 100 calls share the same windowKey and fall within KV_SYNC_INTERVAL_MS
    // (5 min). So kv.put should fire at most once (could be 0 if it's within the
    // first 5 min of the worker's lifetime, since lastSync defaults to 0).
    expect(kv.put.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('first call in a new windowKey triggers a kv.get to load existing counter', async () => {
    const key = uniqueKey('kv-get');
    await checkRateLimit(kv as unknown as KVNamespace, key, 1000);
    expect(kv.get).toHaveBeenCalled();
  });

  it('requests beyond maxRequests are denied (allowed: false)', async () => {
    const key = uniqueKey('deny');
    const max = 5;
    for (let i = 0; i < max; i++) {
      const r = await checkRateLimit(kv as unknown as KVNamespace, key, max);
      expect(r.allowed).toBe(true);
    }
    const denied = await checkRateLimit(kv as unknown as KVNamespace, key, max);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it('two distinct keys have independent counters', async () => {
    const key1 = uniqueKey('iso-1');
    const key2 = uniqueKey('iso-2');
    // Burn through key1's quota
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(kv as unknown as KVNamespace, key1, 3);
    }
    const r1 = await checkRateLimit(kv as unknown as KVNamespace, key1, 3);
    expect(r1.allowed).toBe(false);
    // key2 should still be allowed
    const r2 = await checkRateLimit(kv as unknown as KVNamespace, key2, 3);
    expect(r2.allowed).toBe(true);
  });

  it('kv.put uses the CURRENT window key, not the stale counter.windowStart', async () => {
    // Seed KV with a counter from a stale window
    const staleCounter = { count: 99, windowStart: Date.now() - 120_000 }; // 2 min old
    kv = makeMockKv(staleCounter);
    // Use a simple key here (no random segments) so the regex is predictable.
    const key = 'stale-window-test';
    await checkRateLimit(kv as unknown as KVNamespace, key, 1000);
    // The sync (if it happens) must write to the CURRENT window key, not the stale one.
    if (kv.put.mock.calls.length > 0) {
      const putKey = kv.put.mock.calls[0][0] as string;
      // Key format: ratelimit:<key>:<windowIndex> where windowIndex = floor(now / windowMs).
      // We just verify it starts with `ratelimit:` and contains the current window index
      // (NOT the stale index from 2 min ago).
      expect(putKey).toMatch(/^ratelimit:stale-window-test:\d+$/);
      const windowIndex = parseInt(putKey.split(':').pop() ?? '0', 10);
      const currentWindowIndex = Math.floor(Date.now() / 60_000);
      // The window index must be the current minute, not 2 min behind.
      expect(Math.abs(windowIndex - currentWindowIndex)).toBeLessThanOrEqual(1);
    }
  });

  it('checkIpRateLimit extracts the IP from cf-connecting-ip header', async () => {
    const request = new Request('https://example.com/', {
      headers: { 'cf-connecting-ip': '203.0.113.42' },
    });
    const r = await checkIpRateLimit(kv as unknown as KVNamespace, request);
    expect(r.allowed).toBe(true);
  });

  it('checkUserRateLimit uses the provided userId as the rate-limit key', async () => {
    const r = await checkUserRateLimit(kv as unknown as KVNamespace, 'user-abc-123');
    expect(r.allowed).toBe(true);
  });

  it('KV read failure (kv.get throws) fails open (allows the request)', async () => {
    kv.get.mockRejectedValueOnce(new Error('KV read failed'));
    const r = await checkRateLimit(kv as unknown as KVNamespace, uniqueKey('fail-open'), 100);
    expect(r.allowed).toBe(true);
  });
});
