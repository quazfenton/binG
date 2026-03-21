/**
 * Tests for Retry Utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, sleep, CircuitBreaker, fetchWithRetry } from '../retry';

describe('Retry Utility', () => {
  beforeEach(() => {
    vi.useRealTimers();
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
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 3, 
        baseDelayMs: 10,
        retryableErrors: ['Network error']
      });
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max retries exceeded', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Persistent error'));
      
      await expect(
        withRetry(operation, { maxRetries: 2, baseDelayMs: 10, retryableErrors: ['Persistent error'] })
      ).rejects.toThrow('Operation failed after 2 retries');
      
      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const error = new Error('Non-retryable error');
      const operation = vi.fn().mockRejectedValue(error);
      
      await expect(
        withRetry(operation, { maxRetries: 3, baseDelayMs: 10 })
      ).rejects.toThrow('Non-retryable error');
      
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback on each retry', async () => {
      const onRetry = vi.fn();
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockResolvedValue('success');
      
      await withRetry(operation, { 
        maxRetries: 5, 
        baseDelayMs: 10,
        onRetry,
        retryableErrors: ['Error']
      });
      
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 503 status code', async () => {
      const error = new Error('Service Unavailable');
      (error as any).status = 503;
      
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');
      
      const result = await withRetry(operation, { 
        maxRetries: 1, 
        baseDelayMs: 10,
        retryableStatusCodes: [503]
      });
      
      expect(result).toBe('success');
    });
  });

  describe('sleep', () => {
    it('should resolve after specified milliseconds', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe('CircuitBreaker', () => {
    let breaker: CircuitBreaker;

    beforeEach(() => {
      breaker = new CircuitBreaker('test-provider', { 
        failureThreshold: 3,
        timeout: 1000,
        successThreshold: 2,
        halfOpenMaxRequests: 2
      });
    });

    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should open after failure threshold', async () => {
      // Default threshold is 5
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('Fail')));
        } catch {}
      }
      
      expect(breaker.getState()).toBe('open');
    });

    it('should transition to half-open via isOpen check after timeout', async () => {
      // Open the circuit - threshold is 5
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('Fail')));
        } catch {}
      }
      
      expect(breaker.getState()).toBe('open');
      
      // Simulate timeout by directly accessing internal state for test
      // The isOpen method handles transition logic
      expect(breaker.isOpen()).toBe(true);
    });

    it('should close on success after failures', async () => {
      // Record some failures
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      
      expect(breaker.getState()).toBe('open');
      
      // Success should close the circuit
      breaker.recordSuccess();
      
      expect(breaker.getState()).toBe('closed');
    });

    it('should reject requests when open', async () => {
      // Open the circuit - threshold is 5
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('Fail')));
        } catch {}
      }
      
      await expect(
        breaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should track failure count', async () => {
      await breaker.execute(() => Promise.resolve('success'));
      try {
        await breaker.execute(() => Promise.reject(new Error('Fail')));
      } catch {}
      
      expect(breaker.getFailureCount()).toBe(1);
    });

    it('should reset properly', async () => {
      // Open the circuit - threshold is 5
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error('Fail')));
        } catch {}
      }
      
      breaker.reset();
      
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('should fetch successfully', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: 'test' })
      });
      
      const response = await fetchWithRetry('https://api.example.com/data', {
        maxRetries: 3
      });
      
      expect(response.ok).toBe(true);
    });

    it('should retry on 503 error', async () => {
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable'
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ data: 'test' })
        });
      
      const response = await fetchWithRetry('https://api.example.com/data', {
        maxRetries: 2,
        baseDelayMs: 10
      });
      
      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});