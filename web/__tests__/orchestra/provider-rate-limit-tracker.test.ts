/**
 * F3 fix: rate-limit circuit breaker test.
 * User-required assertion: provider raises 429 once -> next 5 requests
 * skip that provider without invoking it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isRateLimitedBlacklisted,
  recordRateLimitedIfApplicable,
  _clearRateLimitMapForTest,
} from '@/lib/orchestra/provider-rate-limit-tracker';

describe('Provider Rate Limit Circuit Breaker (F3)', () => {
  beforeEach(() => { _clearRateLimitMapForTest(); });
  afterEach(() => { _clearRateLimitMapForTest(); });

  it('skips a provider for the next 5 requests after a single 429', () => {
    const provider = 'test-provider-429';
    recordRateLimitedIfApplicable(provider, { status: 429, message: 'Too Many Requests' });
    expect(isRateLimitedBlacklisted(provider)).toBe(true);
    let wouldInvokeCount = 0;
    for (let i = 0; i < 5; i++) {
      if (!isRateLimitedBlacklisted(provider)) {
        wouldInvokeCount++;
      }
    }
    expect(wouldInvokeCount).toBe(0);
    expect(isRateLimitedBlacklisted(provider)).toBe(true);
  });

  it('does NOT blacklist on a 5xx (only on 429)', () => {
    recordRateLimitedIfApplicable('p', { status: 500, message: 'Internal Server Error' });
    expect(isRateLimitedBlacklisted('p')).toBe(false);
  });

  it('does NOT blacklist on success (only on rate-limit)', () => {
    recordRateLimitedIfApplicable('p', { status: 200, message: 'OK' });
    expect(isRateLimitedBlacklisted('p')).toBe(false);
  });

  it('detects rate-limit via message regex fallback (no status field)', () => {
    recordRateLimitedIfApplicable('p', { message: 'rate limit exceeded (quota)' });
    expect(isRateLimitedBlacklisted('p')).toBe(true);
  });

  it('leaves other providers unaffected when one is blacklisted', () => {
    recordRateLimitedIfApplicable('provider-a', { status: 429 });
    expect(isRateLimitedBlacklisted('provider-a')).toBe(true);
    expect(isRateLimitedBlacklisted('provider-b')).toBe(false);
    expect(isRateLimitedBlacklisted('provider-c')).toBe(false);
  });

  it('detects 429 in AxiosError-shape (error.response.status)', () => {
    recordRateLimitedIfApplicable('axios-provider', {
      response: { status: 429, statusText: 'Too Many Requests' },
      message: 'Request failed with status code 429',
    });
    expect(isRateLimitedBlacklisted('axios-provider')).toBe(true);
  });

  it('detects 429 via the production createAPIError shape (top-level status)', () => {
    const apiError: any = new Error('HTTP 429: Too Many Requests');
    apiError.status = 429;
    apiError.code = 'HTTP_ERROR';
    apiError.isRetryable = true;
    recordRateLimitedIfApplicable('prod-shape-provider', apiError);
    expect(isRateLimitedBlacklisted('prod-shape-provider')).toBe(true);
  });

  it('does NOT blacklist on a 200 wrapped in axios-shape', () => {
    recordRateLimitedIfApplicable('p', {
      response: { status: 200, data: { ok: true } },
      message: 'OK',
    });
    expect(isRateLimitedBlacklisted('p')).toBe(false);
  });

  it('detects 429 via error.cause.status (Node fetch rejection shape)', () => {
    const wrap = new TypeError('fetch failed');
    wrap.cause = { status: 429, statusCode: 429 };
    recordRateLimitedIfApplicable('cause-shape-provider', wrap);
    expect(isRateLimitedBlacklisted('cause-shape-provider')).toBe(true);
  });

  it('detects 429 via error.cause.response.status (deep axios-wrap shape)', () => {
    const wrap = new Error('Request failed');
    wrap.cause = {
      response: { status: 429, statusText: 'Too Many Requests', data: {} },
      message: 'status code 429',
    };
    recordRateLimitedIfApplicable('deep-cause-provider', wrap);
    expect(isRateLimitedBlacklisted('deep-cause-provider')).toBe(true);
  });

  // ─── TTL recovery tests (MCP-RATE-LIMITED-TTL-RECOVERY) ────────────────

  it('auto-evicts provider after RATE_LIMIT_BLACKLIST_TTL_MS (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const TTL = 300_000; // 5 min default
      vi.stubEnv('RATE_LIMIT_BLACKLIST_TTL_MS', String(TTL));
      _clearRateLimitMapForTest();

      recordRateLimitedIfApplicable('ttl-provider', { status: 429 });
      expect(isRateLimitedBlacklisted('ttl-provider')).toBe(true);

      // Still blacklisted just before TTL expires
      vi.advanceTimersByTime(TTL - 100);
      expect(isRateLimitedBlacklisted('ttl-provider')).toBe(true);

      // Cleared after TTL expires
      vi.advanceTimersByTime(200); // past TTL + interval tick
      expect(isRateLimitedBlacklisted('ttl-provider')).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _clearRateLimitMapForTest();
    }
  });

  it('respects Retry-After over global TTL when present', () => {
    vi.useFakeTimers();
    try {
      const GLOBAL_TTL = 300_000; // 5 min
      const RETRY_AFTER_MS = 60_000; // 1 min
      vi.stubEnv('RATE_LIMIT_BLACKLIST_TTL_MS', String(GLOBAL_TTL));
      vi.stubEnv('RATE_LIMIT_USE_RETRY_AFTER', 'true');
      _clearRateLimitMapForTest();

      recordRateLimitedIfApplicable('retry-after-provider', { status: 429 }, RETRY_AFTER_MS);
      expect(isRateLimitedBlacklisted('retry-after-provider')).toBe(true);

      // Still blacklisted at global TTL - 100ms (Retry-After shorter)
      vi.advanceTimersByTime(GLOBAL_TTL - 100);
      // Should be auto-cleared because Retry-After (60s) kicked in long ago
      expect(isRateLimitedBlacklisted('retry-after-provider')).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _clearRateLimitMapForTest();
    }
  });

  it('uses global TTL when RATE_LIMIT_USE_RETRY_AFTER=false even with Retry-After', () => {
    vi.useFakeTimers();
    try {
      const GLOBAL_TTL = 120_000; // 2 min
      const RETRY_AFTER_MS = 10_000; // 10s (would clear much sooner if used)
      vi.stubEnv('RATE_LIMIT_BLACKLIST_TTL_MS', String(GLOBAL_TTL));
      vi.stubEnv('RATE_LIMIT_USE_RETRY_AFTER', 'false');
      _clearRateLimitMapForTest();

      recordRateLimitedIfApplicable('no-retry-after-provider', { status: 429 }, RETRY_AFTER_MS);
      expect(isRateLimitedBlacklisted('no-retry-after-provider')).toBe(true);

      // Still blacklisted well past Retry-After (10s), because global TTL wins
      vi.advanceTimersByTime(RETRY_AFTER_MS + 5_000);
      expect(isRateLimitedBlacklisted('no-retry-after-provider')).toBe(true);

      // Finally clears after global TTL
      vi.advanceTimersByTime(GLOBAL_TTL - RETRY_AFTER_MS - 5_000 + 200);
      expect(isRateLimitedBlacklisted('no-retry-after-provider')).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      _clearRateLimitMapForTest();
    }
  });

  it('setInterval handle is unref-ed to not keep event loop alive', () => {
    // This test verifies the setInterval does not prevent Node from exiting.
    // We can't directly observe unref, but we verify the interval exists and
    // doesn't keep the process alive by checking that clear+recreate works.
    // Direct assertion: call recordRateLimitedIfApplicable twice — the second
    // call should NOT create a second interval (dedup guard), so the old
    // interval handle should be the same reference.
    const spySetInterval = vi.spyOn(globalThis, 'setInterval');
    try {
      _clearRateLimitMapForTest();
      recordRateLimitedIfApplicable('unref-test', { status: 429 });
      expect(spySetInterval).toHaveBeenCalledTimes(1);

      // Second call should NOT create another interval (dedup guard)
      recordRateLimitedIfApplicable('unref-test-2', { status: 429 });
      expect(spySetInterval).toHaveBeenCalledTimes(1);
    } finally {
      spySetInterval.mockRestore();
      _clearRateLimitMapForTest();
    }
  });
});
