/**
 * Retry Utility Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  withRetry, 
  fetchWithRetry, 
  CircuitBreaker,
  sleep 
} from '../lib/utils/retry';

describe('Retry Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sleep', () => {
    it('should sleep for specified duration', async () => {
      vi.useFakeTimers();
      
      const sleepPromise = sleep(1000);
      
      vi.advanceTimersByTime(1000);
      await sleepPromise;
      
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(operation, { maxRetries: 3 });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Always fails'));
      
      await expect(
        withRetry(operation, { 
          maxRetries: 3,
          baseDelayMs: 10,
        })
      ).rejects.toThrow('Operation failed after 3 retries');
      
      expect(operation).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should not retry on non-retryable errors', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Invalid input'));
      
      await expect(
        withRetry(operation, { maxRetries: 3 })
      ).rejects.toThrow('Invalid input');
      
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable status codes', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }))
        .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should retry on retryable error messages', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('First'))
        .mockRejectedValueOnce(new Error('Second'))
        .mockResolvedValueOnce('success');
      
      await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
        onRetry,
      });
      
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
      expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error), expect.any(Number));
    });

    it('should use exponential backoff', async () => {
      vi.useFakeTimers();
      
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      const onRetry = vi.fn();
      
      const retryPromise = withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 1000,
        onRetry,
      }).catch(() => {});
      
      // First retry should be after 1000ms
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      
      // Second retry should be after 2000ms (exponential)
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      
      // Third retry should be after 4000ms (exponential)
      vi.advanceTimersByTime(4000);
      await retryPromise;
      
      expect(onRetry).toHaveBeenCalledTimes(3);
    });

    it('should cap delay at maxDelayMs', async () => {
      vi.useFakeTimers();
      
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      const onRetry = vi.fn();
      
      const retryPromise = withRetry(operation, { 
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        onRetry,
      }).catch(() => {});
      
      // Advance through retries
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      }
      
      await retryPromise;
      
      // All delays should be capped at 5000ms
      expect(onRetry).toHaveBeenCalledTimes(5);
    });

    it('should add jitter by default', async () => {
      vi.useFakeTimers();
      
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      const delays: number[] = [];
      
      await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 1000,
        onRetry: (_, __, delay) => delays.push(delay),
      }).catch(() => {});
      
      // Delays should have jitter (not exactly 1000, 2000, 4000)
      expect(delays.length).toBe(3);
      expect(delays[0]).toBeLessThan(1100);
      expect(delays[0]).toBeGreaterThan(900);
    });

    it('should disable jitter when useJitter is false', async () => {
      vi.useFakeTimers();
      
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      const delays: number[] = [];
      
      await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 1000,
        useJitter: false,
        onRetry: (_, __, delay) => delays.push(delay),
      }).catch(() => {});
      
      // Delays should be exact (1000, 2000, 4000)
      expect(delays).toEqual([1000, 2000, 4000]);
    });

    it('should handle custom retryable errors', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Custom error 1'))
        .mockRejectedValueOnce(new Error('Custom error 2'))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
        retryableErrors: ['Custom error'],
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle custom retryable status codes', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('418'), { status: 418 }))
        .mockRejectedValueOnce(Object.assign(new Error('418'), { status: 418 }))
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3,
        baseDelayMs: 10,
        retryableStatusCodes: [418],
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });
  });

  describe('fetchWithRetry', () => {
    it('should fetch successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
      
      const response = await fetchWithRetry('https://api.example.com', {
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(response.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on HTTP 500', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      
      const response = await fetchWithRetry('https://api.example.com', {
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(response.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on HTTP 429 (rate limit)', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        });
      
      const response = await fetchWithRetry('https://api.example.com', {
        maxRetries: 3,
        baseDelayMs: 10,
      });
      
      expect(response.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries on persistent errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });
      
      await expect(
        fetchWithRetry('https://api.example.com', {
          maxRetries: 3,
          baseDelayMs: 10,
        })
      ).rejects.toThrow('Operation failed after 3 retries');
      
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('should not retry on HTTP 400 (client error)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
      
      await expect(
        fetchWithRetry('https://api.example.com', {
          maxRetries: 3,
          baseDelayMs: 10,
        })
      ).rejects.toThrow('HTTP 400');
      
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('CircuitBreaker', () => {
    it('should start in closed state', () => {
      const breaker = new CircuitBreaker();
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('closed');
    });

    it('should open after failure threshold', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('closed');
      
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('closed');
      
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
      expect(breaker.getState()).toBe('open');
    });

    it('should close after successful execution', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
      
      breaker.recordSuccess();
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('closed');
    });

    it('should transition to half-open after reset timeout', async () => {
      vi.useFakeTimers();
      
      const breaker = new CircuitBreaker({ 
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });
      
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
      
      // Wait for reset timeout
      vi.advanceTimersByTime(5000);
      
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('half-open');
    });

    it('should execute operation when closed', async () => {
      const breaker = new CircuitBreaker();
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await breaker.execute(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should record failure on operation error', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      
      await expect(breaker.execute(operation)).rejects.toThrow('Fail');
      
      expect(breaker.getFailureCount()).toBe(1);
    });

    it('should throw when circuit is open', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1 });
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      
      // Open the circuit
      await breaker.execute(operation).catch(() => {});
      
      expect(breaker.isOpen()).toBe(true);
      
      // Try to execute when open
      await expect(breaker.execute(operation))
        .rejects.toThrow('Circuit breaker is open');
    });

    it('should reset to closed on success in half-open state', async () => {
      vi.useFakeTimers();
      
      const breaker = new CircuitBreaker({ 
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });
      
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe('open');
      
      // Wait for half-open
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('half-open');
      
      // Execute successfully
      const operation = vi.fn().mockResolvedValue('success');
      await breaker.execute(operation);
      
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should open again on failure in half-open state', async () => {
      vi.useFakeTimers();
      
      const breaker = new CircuitBreaker({ 
        failureThreshold: 2,
        resetTimeoutMs: 5000,
      });
      
      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      
      // Wait for half-open
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('half-open');
      
      // Fail in half-open state
      const operation = vi.fn().mockRejectedValue(new Error('Fail'));
      await breaker.execute(operation).catch(() => {});
      
      // Should be open again
      expect(breaker.getState()).toBe('open');
    });

    it('should reset manually', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
      
      breaker.reset();
      
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });
  });
});
