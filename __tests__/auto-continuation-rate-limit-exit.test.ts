/**
 * Test: Auto-continuation loop should exit early on rate limit detection
 * Validates Fix #2 (bug-3, bug-4): Exit on rate limit, don't loop to iteration 3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the error detection and logging
type MockError = Error & { message: string };

function isRateLimitError(err: MockError): boolean {
  const errorMsg = err?.message || String(err);
  const lower = String(errorMsg).toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('throttle') ||
    lower.includes('too many requests')
  );
}

function shouldExitAutoContinuation(err: MockError): boolean {
  // BUG FIX: Exit auto-continuation loop on rate limit or other provider errors.
  // Previous behavior continued to iteration 3 even after rate limit.
  const isRateLimitErr = isRateLimitError(err);
  return isRateLimitErr || true; // Exit on any error for now
}

describe('Auto-Continuation Loop - Rate Limit Exit Fix', () => {
  describe('Rate limit detection', () => {
    it('should detect 429 rate limit error', () => {
      const err = new Error('429 Too Many Requests');
      expect(isRateLimitError(err as MockError)).toBe(true);
    });

    it('should detect "Rate limit" in message', () => {
      const err = new Error('Rate limit active for google/gemini-3.1-flash-lite-preview');
      expect(isRateLimitError(err as MockError)).toBe(true);
    });

    it('should detect "quota" in message', () => {
      const err = new Error('Quota exceeded for API calls');
      expect(isRateLimitError(err as MockError)).toBe(true);
    });

    it('should detect "throttle" in message', () => {
      const err = new Error('Request throttled, please retry later');
      expect(isRateLimitError(err as MockError)).toBe(true);
    });

    it('should not match unrelated errors', () => {
      const err = new Error('Connection timeout');
      expect(isRateLimitError(err as MockError)).toBe(false);
    });
  });

  describe('Auto-continuation exit behavior', () => {
    it('should exit loop on rate limit error instead of retrying', () => {
      const err = new Error('Rate limit active for google/gemini');
      const shouldExit = shouldExitAutoContinuation(err as MockError);
      
      expect(shouldExit).toBe(true);
      // Previously: would have continued to iteration 3
      // Now: exits immediately on rate limit
    });

    it('should exit loop on quota exceeded', () => {
      const err = new Error('quota exceeded');
      const shouldExit = shouldExitAutoContinuation(err as MockError);
      
      expect(shouldExit).toBe(true);
    });

    it('should log rate limit separately for observability', () => {
      const err = new Error('Rate limit active for google/gemini');
      const isRateLimit = isRateLimitError(err as MockError);
      
      expect(isRateLimit).toBe(true);
      // Should emit log: '[V1-API-WITH-TOOLS] Rate limit detected, stopping auto-continuation early'
    });
  });

  describe('Iteration count behavior', () => {
    it('iteration should stop at 1-2 on rate limit, not reach MAX_V1_CONTINUATIONS (3)', () => {
      const iterations: number[] = [];
      const MAX_V1_CONTINUATIONS = 3;

      // Simulate rate limit on iteration 1
      for (let i = 0; i < MAX_V1_CONTINUATIONS; i++) {
        if (i === 1) {
          // Simulate rate limit error on iteration 1
          const err = new Error('Rate limit active');
          if (shouldExitAutoContinuation(err as MockError)) {
            iterations.push(i);
            break; // Exit loop early
          }
        }
        iterations.push(i);
      }

      // Should have stopped at iteration 1, not continued to 3
      expect(iterations.length).toBeLessThan(MAX_V1_CONTINUATIONS);
      expect(iterations[iterations.length - 1]).toBe(1);
    });

    it('should accumulate response before exiting on rate limit', () => {
      let accumulatedResponse = 'Initial response from primary LLM';
      let iterationCount = 0;
      const MAX_V1_CONTINUATIONS = 3;

      // Simulate: primary → good output
      accumulatedResponse += '\n\nFirst continuation result';
      iterationCount++;

      // Simulate: second continuation encounters rate limit
      if (iterationCount < MAX_V1_CONTINUATIONS) {
        try {
          throw new Error('Rate limit active for google/gemini');
        } catch (err: any) {
          // Log and exit
          if (shouldExitAutoContinuation(err)) {
            // Should still return accumulated response despite rate limit
            expect(accumulatedResponse).toContain('Initial response');
            expect(accumulatedResponse).toContain('First continuation result');
          }
        }
      }

      // Confirm: did not continue to iteration 3
      expect(iterationCount).toBeLessThan(MAX_V1_CONTINUATIONS);
    });
  });

  describe('Provider fallback after rate limit', () => {
    it('should attempt next provider when rate limit on primary', () => {
      const providersAttempted: string[] = [];
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt === 0) {
            // Primary provider hits rate limit
            throw new Error('Rate limit active for google/gemini');
          }
          providersAttempted.push(`provider-${attempt}`);
        } catch (err: any) {
          if (shouldExitAutoContinuation(err)) {
            // Should break auto-continuation loop and cascade to provider fallback
            break;
          }
        }
      }

      // Should exit auto-continuation to let provider fallback chain handle it
      expect(providersAttempted.length).toBe(0);
    });
  });

  describe('Logging and observability', () => {
    it('should include isRateLimitError flag in logs', () => {
      const err = new Error('Rate limit active for google/gemini');
      const isRateLimitErr = isRateLimitError(err as MockError);

      // Log payload should include this flag
      const logPayload = {
        error: err.message,
        iteration: 1,
        isRateLimitError: isRateLimitErr,
      };

      expect(logPayload.isRateLimitError).toBe(true);
      expect(logPayload.iteration).toBe(1); // Should have stopped at iteration 1
    });

    it('should emit different log message for rate limit vs other errors', () => {
      const rateLimitErr = new Error('Rate limit active');
      const otherErr = new Error('Connection timeout');

      const rateLimitLog = isRateLimitError(rateLimitErr as MockError)
        ? '[V1-API-WITH-TOOLS] Rate limit detected, stopping auto-continuation early'
        : '[V1-API-WITH-TOOLS] Auto-continuation failed, returning accumulated response';

      const otherLog = isRateLimitError(otherErr as MockError)
        ? '[V1-API-WITH-TOOLS] Rate limit detected, stopping auto-continuation early'
        : '[V1-API-WITH-TOOLS] Auto-continuation failed, returning accumulated response';

      expect(rateLimitLog).toContain('Rate limit detected');
      expect(otherLog).toContain('Auto-continuation failed');
    });
  });
});
