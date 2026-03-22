/**
 * Session Lock Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  acquireMemoryLock,
  acquireMemoryLockWithRetry,
  isSessionLocked,
  getMemoryLockStats,
  __clearAllLocks__,
} from '../memory-lock';
import {
  acquireQueueLock,
  getQueueStats,
  __clearAllQueues__,
} from '../queue-lock';
import { getLockMetrics, __clearAllMetrics__, recordLockMetric, getLockHealth } from '../lock-metrics';

describe('Memory Lock', () => {
  beforeEach(() => {
    __clearAllLocks__();
  });

  afterEach(() => {
    __clearAllLocks__();
  });

  it('should acquire and release lock', async () => {
    const { release } = await acquireMemoryLock('test-session');
    
    expect(release).toBeDefined();
    expect(isSessionLocked('test-session')).toBe(true);
    
    await release();
    expect(isSessionLocked('test-session')).toBe(false);
  });

  it('should throw if lock already held', async () => {
    const { release } = await acquireMemoryLock('test-session');
    
    await expect(acquireMemoryLock('test-session')).rejects.toThrow('already held');
    
    await release();
  });

  it('should allow re-acquire after release', async () => {
    const { release: release1 } = await acquireMemoryLock('test-session');
    await release1();
    
    const { release: release2 } = await acquireMemoryLock('test-session');
    await release2();
    
    expect(isSessionLocked('test-session')).toBe(false);
  });

  it('should track stats', async () => {
    await acquireMemoryLock('session-1');
    await acquireMemoryLock('session-2');
    
    const stats = getMemoryLockStats();
    expect(stats.activeLocks).toBe(2);
    
    __clearAllLocks__();
    
    const clearedStats = getMemoryLockStats();
    expect(clearedStats.activeLocks).toBe(0);
  });
});

describe('Memory Lock with Retry', () => {
  beforeEach(() => {
    __clearAllLocks__();
    vi.useRealTimers();
  });

  afterEach(() => {
    __clearAllLocks__();
  });

  it('should acquire lock with retry', async () => {
    const { release, attempts } = await acquireMemoryLockWithRetry('test-session', {
      maxAttempts: 3,
    });
    
    expect(attempts).toBe(1);
    await release();
  });

  it('should retry if lock held', async () => {
    const { release: release1 } = await acquireMemoryLock('test-session');
    
    // Try to acquire with retry - should fail after max attempts
    await expect(
      acquireMemoryLockWithRetry('test-session', {
        maxAttempts: 2,
        baseDelay: 10, // Fast for testing
      })
    ).rejects.toThrow('after 2 attempts');
    
    await release1();
  });
});

describe('Queue Lock', () => {
  beforeEach(() => {
    __clearAllQueues__();
    vi.useRealTimers();
  });

  afterEach(() => {
    __clearAllQueues__();
  });

  it('should acquire lock immediately if first in queue', async () => {
    const { release, waitTime, position } = await acquireQueueLock('test-session');
    
    expect(position).toBe(0);
    expect(waitTime).toBe(0);
    expect(release).toBeDefined();
    
    await release();
  });

  it('should queue subsequent requests', async () => {
    const { release: release1 } = await acquireQueueLock('test-session');
    
    // Start a second request that will queue
    const secondPromise = acquireQueueLock('test-session', { timeout: 1000 });
    
    // Give it time to queue
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const stats = getQueueStats('test-session');
    expect(stats.session?.queueLength).toBe(1);
    
    // Release first lock - should trigger second
    await release1();
    
    const { release: release2 } = await secondPromise;
    await release2();
  });

  it('should timeout queued requests', async () => {
    const { release: release1 } = await acquireQueueLock('test-session');
    
    // Start a second request with short timeout
    const secondPromise = acquireQueueLock('test-session', { timeout: 100 });
    
    // Don't release first lock - let second timeout
    await expect(secondPromise).rejects.toThrow('timeout');
    
    await release1();
  });

  it('should track queue stats', async () => {
    const { release: release1 } = await acquireQueueLock('session-1');
    const { release: release2 } = await acquireQueueLock('session-2');
    
    const stats = getQueueStats();
    expect(stats.totalQueues).toBe(2);
    expect(stats.activeQueues).toBe(2);
    
    await release1();
    await release2();
  });
});

describe('Lock Metrics', () => {
  beforeEach(() => {
    __clearAllMetrics__();
    vi.useRealTimers();
  });

  afterEach(() => {
    __clearAllMetrics__();
  });

  it('should record and retrieve metrics', () => {
    recordLockMetric({
      strategy: 'redis',
      sessionId: 'test-1',
      timestamp: Date.now(),
      duration: 15,
      attempts: 1,
    });
    
    recordLockMetric({
      strategy: 'memory',
      sessionId: 'test-2',
      timestamp: Date.now(),
      duration: 2,
      attempts: 1,
      error: 'Test error',
    });
    
    const metrics = getLockMetrics();
    
    expect(metrics.totalAttempts).toBe(2);
    expect(metrics.successes).toBe(1);
    expect(metrics.failures).toBe(1);
    expect(metrics.successRate).toBe(0.5);
    expect(metrics.byStrategy.redis).toBeDefined();
    expect(metrics.byStrategy.memory).toBeDefined();
  });

  it('should calculate recent stats', () => {
    // Record some recent metrics
    for (let i = 0; i < 10; i++) {
      recordLockMetric({
        strategy: 'redis',
        sessionId: `test-${i}`,
        timestamp: Date.now(),
        duration: 10,
        attempts: 1,
      });
    }

    const metrics = getLockMetrics();

    expect(metrics.recent.last5Minutes.attempts).toBe(10);
    expect(metrics.recent.last5Minutes.successRate).toBe(1.0);
  });

  it('should provide health status', () => {
    // Record mostly successful metrics
    for (let i = 0; i < 20; i++) {
      recordLockMetric({
        strategy: 'redis',
        sessionId: `test-${i}`,
        timestamp: Date.now(),
        duration: 10,
        attempts: 1,
        error: i >= 18 ? 'error' : undefined, // 10% failure
      });
    }

    const health = getLockHealth();

    expect(health.status).toBeDefined();
    expect(health.successRate).toBeGreaterThan(0.8);
  });
});
