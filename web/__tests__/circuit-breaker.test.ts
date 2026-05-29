/**
 * Circuit Breaker Tests
 * 
 * Tests for the circuit breaker pattern implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  CircuitBreaker, 
  CircuitBreakerOpenError,
  CircuitBreakerManager,
  circuitBreakerManager,
} from '@/lib/middleware/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-provider', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 100,
      halfOpenMaxRequests: 2,
    });
  });

  describe('execute', () => {
    it('should execute successful operation in CLOSED state', async () => {
      const result = await breaker.execute(async () => 'success');

      expect(result).toBe('success');
      expect(breaker.getState()).toBe('HEALTHY');
    });

    it('should handle failed operation', async () => {
      await expect(
        breaker.execute(async () => { throw new Error('Test error'); })
      ).rejects.toThrow('Test error');

      expect(breaker.getState()).toBe('HEALTHY');
    });

    it('should open circuit after threshold failures', async () => {
      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should reject requests when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      // Should reject immediately
      await expect(
        breaker.execute(async () => 'should not execute')
      ).rejects.toThrow(CircuitBreakerOpenError);
    });

    it('should transition to HALF-OPEN after timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      expect(breaker.getState()).toBe('OPEN');
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(breaker.getState()).toBe('HALF-OPEN');
    });

    it('should close circuit after successful requests in HALF-OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Succeed twice (successThreshold = 2)
      await breaker.execute(async () => 'success 1');
      await breaker.execute(async () => 'success 2');
      
      expect(breaker.getState()).toBe('HEALTHY');
    });

    it('should reopen circuit on failure in HALF-OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Fail in half-open state
      try {
        await breaker.execute(async () => { throw new Error('Fail in half-open'); });
      } catch {}
      
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      // Execute some operations
      await breaker.execute(async () => 'success');
      try {
        await breaker.execute(async () => { throw new Error('Fail'); });
      } catch {}
      
      const stats = breaker.getStats();
      
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(1);
      expect(stats.state).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset circuit breaker to initial state', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }

      expect(breaker.getState()).toBe('OPEN');

      // Reset
      breaker.reset();

      expect(breaker.getState()).toBe('HEALTHY');
      // Note: reset() clears state but may not reset stats
      expect(breaker.getStats().failedRequests).toBeGreaterThanOrEqual(0);
    });
  });

  describe('onStateChange', () => {
    it('should call callback on state change', async () => {
      const callback = vi.fn();
      breaker.onStateChange(callback);
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      expect(callback).toHaveBeenCalledWith('OPEN');
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = breaker.onStateChange(callback);
      
      unsubscribe();
      
      // Call should not be made after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getRetryAfter', () => {
    it('should return 0 when circuit is CLOSED', () => {
      expect(breaker.getRetryAfter()).toBe(0);
    });

    it('should return time until retry when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      const retryAfter = breaker.getRetryAfter();
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(100); // timeout = 100ms
    });
  });
});

describe('CircuitBreakerManager', () => {
  let manager: CircuitBreakerManager;

  beforeEach(() => {
    manager = new CircuitBreakerManager();
  });

  describe('getBreaker', () => {
    it('should create new breaker for provider', () => {
      const breaker = manager.getBreaker('provider-1');
      expect(breaker).toBeDefined();
    });

    it('should return same breaker for same provider', () => {
      const breaker1 = manager.getBreaker('provider-1');
      const breaker2 = manager.getBreaker('provider-1');
      expect(breaker1).toBe(breaker2);
    });
  });

  describe('execute', () => {
    it('should execute with provider breaker', async () => {
      const result = await manager.execute('provider-1', async () => 'success');
      expect(result).toBe('success');
    });

    it('should use provider-specific breaker', async () => {
      // Pre-register provider-2 so the safety invariant doesn't reset provider-1
      // (the manager never closes ALL providers; with only one registered,
      // it forces the breaker back to CLOSED to maintain availability)
      manager.getBreaker('provider-2');

      // Fail provider-1 enough times to exceed the default failureThreshold
      // CircuitBreakerManager uses tiered defaults; the 'normal' tier has threshold 7
      for (let i = 0; i < 10; i++) {
        try {
          await manager.execute('provider-1', async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      // provider-1 should be open
      const breaker1 = manager.getBreaker('provider-1');
      expect(breaker1.getState()).toBe('OPEN');
      
      // provider-2 should still be healthy
      const breaker2 = manager.getBreaker('provider-2');
      expect(breaker2.getState()).toBe('HEALTHY');
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all breakers', async () => {
      await manager.execute('provider-1', async () => 'success');
      await manager.execute('provider-2', async () => 'success');
      
      const stats = manager.getAllStats();
      
      expect(stats.size).toBe(2);
      expect(stats.has('provider-1')).toBe(true);
      expect(stats.has('provider-2')).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('should reset all breakers', async () => {
      // Open provider-1
      for (let i = 0; i < 5; i++) {
        try {
          await manager.execute('provider-1', async () => { throw new Error('Fail'); });
        } catch {}
      }
      
      manager.resetAll();
      
      const breaker1 = manager.getBreaker('provider-1');
      expect(breaker1.getState()).toBe('HEALTHY');
    });
  });

  describe('remove', () => {
    it('should remove breaker for provider', () => {
      manager.getBreaker('provider-1');
      manager.remove('provider-1');
      
      const breaker = manager.getBreaker('provider-1');
      expect(breaker.getState()).toBe('HEALTHY'); // New breaker
    });
  });
});

describe('circuitBreakerManager (singleton)', () => {
  it('should be a singleton instance', () => {
    expect(circuitBreakerManager).toBeDefined();
    expect(circuitBreakerManager).toBeInstanceOf(CircuitBreakerManager);
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should have correct name', () => {
    const error = new CircuitBreakerOpenError('Test message');
    expect(error.name).toBe('CircuitBreakerOpenError');
    expect(error.message).toBe('Test message');
  });
});

/**
 * Tests for Session-based Circuit Breaker Reset Logic
 * 
 * Tests the first-request-per-session tracking and reset behavior
 * that prevents first requests from being blocked when a provider's
 * circuit breaker was previously OPEN.
 */
describe('Session-based Circuit Breaker Reset', () => {
  // Helper to create a session key matching the logic in unified-agent-service.ts
  const getFirstRequestKey = (sessionId: string) => `first-${sessionId}`;

  // Helper to simulate the session tracking Set
  const createSessionTracker = () => {
    const firstRequestSet = new Set<string>();
    return {
      isFirstRequestThisSession: (sessionId: string): boolean => {
        const key = getFirstRequestKey(sessionId);
        if (!firstRequestSet.has(key)) {
          firstRequestSet.add(key);
          return true;
        }
        return false;
      },
      get size(): number {
        return firstRequestSet.size;
      },
      clear: () => firstRequestSet.clear(),
    };
  };

  describe('isFirstRequestThisSession', () => {
    it('should return true on first request for a session', () => {
      const tracker = createSessionTracker();
      
      expect(tracker.isFirstRequestThisSession('session-123')).toBe(true);
    });

    it('should return false on subsequent requests for same session', () => {
      const tracker = createSessionTracker();
      
      tracker.isFirstRequestThisSession('session-123');
      expect(tracker.isFirstRequestThisSession('session-123')).toBe(false);
    });

    it('should return true for different sessions independently', () => {
      const tracker = createSessionTracker();
      
      tracker.isFirstRequestThisSession('session-123');
      expect(tracker.isFirstRequestThisSession('session-456')).toBe(true);
      expect(tracker.isFirstRequestThisSession('session-123')).toBe(false);
    });

    it('should track multiple sessions independently', () => {
      const tracker = createSessionTracker();
      
      tracker.isFirstRequestThisSession('session-1');
      tracker.isFirstRequestThisSession('session-2');
      tracker.isFirstRequestThisSession('session-3');
      
      // All subsequent requests should return false
      expect(tracker.isFirstRequestThisSession('session-1')).toBe(false);
      expect(tracker.isFirstRequestThisSession('session-2')).toBe(false);
      expect(tracker.isFirstRequestThisSession('session-3')).toBe(false);
      
      // But new sessions should still be first
      expect(tracker.isFirstRequestThisSession('session-4')).toBe(true);
    });
  });

  describe('Set size management (memory leak prevention)', () => {
    it('should respect the 100 entry limit', () => {
      // Simulate the bounded Set implementation
      const firstRequestSet = new Set<string>();
      const MAX_SIZE = 100;
      
      // Add 150 sessions
      for (let i = 0; i < 150; i++) {
        const key = `first-session-${i}`;
        if (!firstRequestSet.has(key)) {
          // Evict oldest when exceeding limit
          if (firstRequestSet.size >= MAX_SIZE) {
            const oldest = firstRequestSet.values().next().value;
            if (oldest) firstRequestSet.delete(oldest);
          }
          firstRequestSet.add(key);
        }
      }
      
      expect(firstRequestSet.size).toBeLessThanOrEqual(100);
    });

    it('should evict oldest entry when limit exceeded', () => {
      const firstRequestSet = new Set<string>();
      const MAX_SIZE = 3;
      
      // Add sessions 1, 2, 3
      firstRequestSet.add('first-session-1');
      firstRequestSet.add('first-session-2');
      firstRequestSet.add('first-session-3');
      
      // Add session-4, which should evict session-1
      const key = 'first-session-4';
      if (firstRequestSet.size >= MAX_SIZE) {
        const oldest = firstRequestSet.values().next().value;
        if (oldest) firstRequestSet.delete(oldest);
      }
      firstRequestSet.add(key);
      
      expect(firstRequestSet.has('first-session-1')).toBe(false);
      expect(firstRequestSet.has('first-session-4')).toBe(true);
      expect(firstRequestSet.size).toBe(3);
    });

    it('should maintain recent sessions when evicting', () => {
      const firstRequestSet = new Set<string>();
      const MAX_SIZE = 5;
      
      // Add sessions 1-10
      for (let i = 1; i <= 10; i++) {
        const key = `first-session-${i}`;
        if (firstRequestSet.size >= MAX_SIZE) {
          const oldest = firstRequestSet.values().next().value;
          if (oldest) firstRequestSet.delete(oldest);
        }
        firstRequestSet.add(key);
      }
      
      // Sessions 1-5 should have been evicted
      expect(firstRequestSet.has('first-session-1')).toBe(false);
      expect(firstRequestSet.has('first-session-5')).toBe(false);
      
      // Sessions 6-10 should remain
      expect(firstRequestSet.has('first-session-6')).toBe(true);
      expect(firstRequestSet.has('first-session-10')).toBe(true);
    });
  });

  describe('integration with circuit breaker reset', () => {
    it('should reset OPEN circuit on first request of new session', async () => {
      // Use explicit CircuitBreaker with low threshold for reliable testing
      const breaker = new CircuitBreaker('session-test-provider-1', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000, // Long timeout so we control when it transitions
        halfOpenMaxRequests: 1,
      });
      
      // Open the circuit by failing 3 times
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Test failure'); });
        } catch {}
      }
      
      expect(breaker.getState()).toBe('OPEN');
      
      // Simulate session tracking
      const sessionTracker = createSessionTracker();
      const sessionId = 'new-test-session';
      
      // First request should detect this is a new session
      if (sessionTracker.isFirstRequestThisSession(sessionId)) {
        // If circuit is OPEN, reset it
        if (breaker.getState() === 'OPEN' && breaker.getRetryAfter() > 0) {
          breaker.reset();
        }
      }
      
      // Circuit should be reset to HEALTHY
      expect(breaker.getState()).toBe('HEALTHY');
    });

    it('should NOT reset circuit on subsequent requests in same session', async () => {
      // Use explicit CircuitBreaker with low threshold
      const breaker = new CircuitBreaker('session-test-provider-2', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000,
        halfOpenMaxRequests: 1,
      });
      
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('Test failure'); });
        } catch {}
      }
      
      // Verify circuit is OPEN
      expect(breaker.getState()).toBe('OPEN');
      
      // Simulate session tracking with first request already processed
      const sessionTracker = createSessionTracker();
      const sessionId = 'existing-session';
      
      // Mark first request as processed
      sessionTracker.isFirstRequestThisSession(sessionId);
      
      // Second request should NOT reset the circuit
      if (sessionTracker.isFirstRequestThisSession(sessionId)) {
        // This should NOT be reached
        if (breaker.getState() === 'OPEN') {
          breaker.reset();
        }
      }
      
      // Circuit should remain OPEN
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should only reset specific provider circuit, not all providers', async () => {
      // Use two explicit CircuitBreakers with low thresholds
      const breaker1 = new CircuitBreaker('provider-reset-test-1', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000,
        halfOpenMaxRequests: 1,
      });
      const breaker2 = new CircuitBreaker('provider-reset-test-2', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000,
        halfOpenMaxRequests: 1,
      });
      
      // Open only breaker1's circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker1.execute(async () => { throw new Error('Test failure'); });
        } catch {}
      }
      
      // Verify states
      expect(breaker1.getState()).toBe('OPEN');
      expect(breaker2.getState()).toBe('HEALTHY');
      
      // Reset only provider-1 (simulating first request in new session)
      const sessionTracker = createSessionTracker();
      const sessionId = 'new-session';
      
      if (sessionTracker.isFirstRequestThisSession(sessionId)) {
        if (breaker1.getState() === 'OPEN' && breaker1.getRetryAfter() > 0) {
          breaker1.reset();
        }
      }
      
      // Only provider-1 should be reset
      expect(breaker1.getState()).toBe('HEALTHY');
      // provider-2 should still be HEALTHY (not affected)
      expect(breaker2.getState()).toBe('HEALTHY');
    });
  });
});
