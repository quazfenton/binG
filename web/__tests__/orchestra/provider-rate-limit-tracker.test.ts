/**
 * F3 fix: rate-limit circuit breaker test.
 * User-required assertion: provider raises 429 once -> next 5 requests
 * skip that provider without invoking it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
