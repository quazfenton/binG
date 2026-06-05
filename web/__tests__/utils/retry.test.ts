/**
 * Tests: Retry Utility
 *
 * Tests for withRetry and withRetryAndTimeout with exponential backoff,
 * jitter, timeouts, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, withRetryAndTimeout } from '@/lib/utils/retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('basic retry behavior', () => {
    it('should return result on first success without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const final = await result;

      expect(final).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed on retry', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('recovered');

      const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, jitter: false });

      // First call fails
      await vi.advanceTimersByTimeAsync(10);
      // Second call - wait for backup delay
      await vi.advanceTimersByTimeAsync(100);
      // Third call - wait for exponential backup
      await vi.advanceTimersByTimeAsync(200);
      await vi.runAllTimersAsync();

      const final = await promise;
      expect(final).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting all retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

      const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitter: false });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('exponential backoff', () => {
    it('should increase delay exponentially with each retry', async () => {
      const delays: number[] = [];
      const onRetry = vi.fn((_error: Error, _attempt: number, delayMs: number) => {
        delays.push(delayMs);
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'))
        .mockResolvedValue('finally');

      const promise = withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        jitter: false,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(delays).toHaveLength(3);
      expect(delays[0]).toBe(100);  // 100 * 2^0
      expect(delays[1]).toBe(200);  // 100 * 2^1
      expect(delays[2]).toBe(400);  // 100 * 2^2
    });

    it('should cap delay at maxDelayMs', async () => {
      const delays: number[] = [];
      const onRetry = vi.fn((_error: Error, _attempt: number, delayMs: number) => {
        delays.push(delayMs);
      });

      const fn = vi
        .fn()
        .mockRejectedValue(new Error('fail'));

      const promise = withRetry(fn, {
        maxRetries: 4,
        baseDelayMs: 5000,
        maxDelayMs: 10000,
        jitter: false,
        onRetry,
      });

      // Let all retries run through
      await vi.runAllTimersAsync();
      try { await promise; } catch {}

      // With baseDelayMs=5000, the sequence would be: 5000, 10000, 20000, 40000
      // But maxDelayMs=10000 caps each at 10000
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(10000);
      }
    });
  });

  describe('jitter', () => {
    it('should add jitter to delay when enabled', async () => {
      const delays: number[] = [];
      const onRetry = vi.fn((_error: Error, _attempt: number, delayMs: number) => {
        delays.push(delayMs);
      });

      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 1000,
        jitter: true,
        onRetry,
      });

      await vi.runAllTimersAsync();
      try { await promise; } catch {}

      // With jitter, delay should be >= baseDelayMs but less than baseDelayMs + jitter cap
      expect(delays[0]).toBeGreaterThanOrEqual(1000);
      expect(delays[0]).toBeLessThanOrEqual(1300); // baseDelayMs + 30% of baseDelayMs
    });

    it('should not add jitter when disabled', async () => {
      const delays: number[] = [];
      const onRetry = vi.fn((_error: Error, _attempt: number, delayMs: number) => {
        delays.push(delayMs);
      });

      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const promise = withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 100,
        jitter: false,
        onRetry,
      });

      await vi.runAllTimersAsync();
      try { await promise; } catch {}

      expect(delays[0]).toBe(100);
    });
  });

  describe('error handling', () => {
    it('should wrap non-Error throwables in Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      const promise = withRetry(fn, { maxRetries: 0, baseDelayMs: 10 });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('string error');
    });

    it('should preserve original Error instance', async () => {
      const original = new Error('typed error');
      const fn = vi.fn().mockRejectedValue(original);

      const promise = withRetry(fn, { maxRetries: 0, baseDelayMs: 10 });

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('typed error');
    });

    it('should call onRetry callback with error and attempt info', async () => {
      const onRetry = vi.fn();
      const error = new Error('test error');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('ok');

      const promise = withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 10,
        jitter: false,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'test error' }),
        1,
        10,
      );
    });

    it('should not call onRetry when no retries are configured', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(withRetry(fn, { maxRetries: 0, onRetry })).rejects.toThrow('fail');
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('maxRetries=0 (no retry)', () => {
    it('should execute once and throw on failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should execute once and return on success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const promise = withRetry(fn, { maxRetries: 0 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-attempt timeout', () => {
    it('should timeout individual attempts when timeoutMs is set', async () => {
      vi.useRealTimers();

      const slowFn = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('too slow'), 5000)),
      );

      const promise = withRetry(slowFn, {
        maxRetries: 0,
        timeoutMs: 10,
      });

      await expect(promise).rejects.toThrow('timed out');
    }, 10000);

    it('should retry after timeout', async () => {
      vi.useRealTimers();

      const fn = vi
        .fn()
        .mockImplementationOnce(
          () => new Promise(resolve => setTimeout(() => resolve('too slow'), 5000)),
        )
        .mockResolvedValue('fast enough');

      const promise = withRetry(fn, {
        maxRetries: 1,
        timeoutMs: 10,
        baseDelayMs: 5,
        jitter: false,
      });

      const result = await promise;
      expect(result).toBe('fast enough');
      expect(fn).toHaveBeenCalledTimes(2);
    }, 10000);
  });
});

describe('withRetryAndTimeout', () => {
  it('should be a convenience wrapper that delegates to withRetry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetryAndTimeout(fn, 5000, { maxRetries: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should timeout per attempt when using withRetryAndTimeout', async () => {
    vi.useRealTimers();

    const slowFn = () => new Promise<string>(resolve => setTimeout(() => resolve('slow'), 5000));

    const promise = withRetryAndTimeout(slowFn, 50, { maxRetries: 0 });

    await expect(promise).rejects.toThrow('timed out');
  });
});
