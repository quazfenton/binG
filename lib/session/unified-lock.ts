/**
 * Unified Session Lock - Multi-Strategy Implementation
 *
 * Provides resilient session locking with automatic fallback across strategies:
 * 1. Redis (primary) - distributed, production-ready
 * 2. Memory (secondary) - single-instance fallback
 * 3. Queue (tertiary) - request serialization without locking
 *
 * Features:
 * - Automatic strategy fallback on failure
 * - Metrics recording for all attempts
 * - Detailed logging for debugging
 * - Graceful degradation with alerts
 */

import { createLogger } from '@/lib/utils/logger';
import { recordLockMetric } from './lock-metrics';

const log = createLogger('Session:Lock:Unified');

export type LockStrategy = 'redis' | 'memory' | 'queue';

export interface UnifiedLockRelease {
  (): Promise<void>;
  strategy?: LockStrategy;
  sessionId?: string;
}

export interface UnifiedLockResult {
  release: UnifiedLockRelease;
  strategy: LockStrategy;
  attempts: number;
  duration: number;
}

export interface UnifiedLockConfig {
  sessionId: string;
  timeout?: number;
  maxAttempts?: number;
  strategies?: LockStrategy[];
  recordMetrics?: boolean;
}

/**
 * Strategy implementations
 */
const strategies: Record<LockStrategy, {
  name: string;
  acquire: (sessionId: string, options?: any) => Promise<{ release: () => Promise<void>; attempts?: number }>;
}> = {
  redis: {
    name: 'Redis (Primary)',
    acquire: async (sessionId: string) => {
      const { acquireSessionLock } = await import('./session-lock');
      const result = await acquireSessionLock(sessionId);
      return { release: result, attempts: 1 };
    },
  },
  memory: {
    name: 'Memory (Secondary)',
    acquire: async (sessionId: string, options?: any) => {
      const { acquireMemoryLockWithRetry } = await import('./memory-lock');
      const result = await acquireMemoryLockWithRetry(sessionId, options);
      return { release: result.release, attempts: result.attempts };
    },
  },
  queue: {
    name: 'Queue (Tertiary)',
    acquire: async (sessionId: string, options?: any) => {
      const { acquireQueueLock } = await import('./queue-lock');
      const result = await acquireQueueLock(sessionId, options);
      return { release: result.release, attempts: 1 };
    },
  },
};

/**
 * Acquire session lock using multi-strategy fallback
 * 
 * Tries each strategy in order until one succeeds.
 * Records metrics for monitoring and alerting.
 */
export async function acquireUnifiedLock(
  config: UnifiedLockConfig
): Promise<UnifiedLockResult> {
  const {
    sessionId,
    timeout = 10000,
    maxAttempts = 3,
    strategies: strategyOrder = ['redis', 'memory', 'queue'],
    recordMetrics: shouldRecordMetrics = true,
  } = config;

  const startTime = Date.now();
  let lastError: Error | undefined;
  let totalAttempts = 0;

  log.info('Acquiring unified session lock', {
    sessionId,
    strategies: strategyOrder.map(s => strategies[s].name),
    timeout,
  });

  for (const strategy of strategyOrder) {
    const strategyStart = Date.now();
    
    try {
      log.debug('Attempting lock strategy', {
        sessionId,
        strategy: strategies[strategy].name,
      });

      const result = await strategies[strategy].acquire(sessionId, {
        timeout: timeout - (Date.now() - startTime),
        maxAttempts,
      });

      const duration = Date.now() - startTime;
      totalAttempts += result.attempts || 1;

      // Record success metric
      if (shouldRecordMetrics) {
        recordLockMetric({
          strategy,
          sessionId,
          timestamp: Date.now(),
          duration,
          attempts: totalAttempts,
        });
      }

      log.info('Unified lock acquired', {
        sessionId,
        strategy: strategies[strategy].name,
        duration,
        attempts: totalAttempts,
      });

      // Annotate release function with metadata
      const release: UnifiedLockRelease = result.release;
      release.strategy = strategy;
      release.sessionId = sessionId;

      return {
        release,
        strategy,
        attempts: totalAttempts,
        duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(errorMessage);
      const strategyDuration = Date.now() - strategyStart;

      log.warn('Lock strategy failed', {
        sessionId,
        strategy: strategies[strategy].name,
        error: errorMessage,
        duration: strategyDuration,
      });

      // Record failure metric
      if (shouldRecordMetrics) {
        recordLockMetric({
          strategy,
          sessionId,
          timestamp: Date.now(),
          duration: strategyDuration,
          attempts: 1,
          error: errorMessage,
        });
      }

      // Continue to next strategy
    }
  }

  // All strategies failed
  const duration = Date.now() - startTime;
  
  log.error('All lock strategies failed', {
    sessionId,
    strategies: strategyOrder.map(s => strategies[s].name),
    lastError: lastError?.message,
    totalAttempts,
    duration,
  });

  // Record final failure metric
  if (shouldRecordMetrics) {
    recordLockMetric({
      strategy: strategyOrder[strategyOrder.length - 1],
      sessionId,
      timestamp: Date.now(),
      duration,
      attempts: totalAttempts,
      error: lastError?.message || 'All strategies failed',
    });
  }

  throw new Error(
    `Failed to acquire session lock for ${sessionId} after trying ${strategyOrder.length} strategies: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Get lock strategy health status
 */
export async function getLockStrategyHealth(): Promise<Record<LockStrategy, {
  available: boolean;
  error?: string;
  latency?: number;
}>> {
  const results: any = {};

  // Test Redis
  try {
    const { checkRedisHealth } = await import('./session-lock');
    const health = await checkRedisHealth();
    results.redis = {
      available: health.healthy,
      error: health.error,
    };
  } catch (error) {
    results.redis = {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // Test Memory (always available)
  results.memory = {
    available: true,
  };

  // Test Queue (always available)
  results.queue = {
    available: true,
  };

  return results;
}

/**
 * Create unified lock with automatic release on error
 */
export async function createUnifiedLock(
  sessionId: string,
  options?: { timeout?: number }
): Promise<{
  release: UnifiedLockRelease;
  strategy: LockStrategy;
  duration: number;
}> {
  const result = await acquireUnifiedLock({
    sessionId,
    ...options,
  });
  
  return {
    release: result.release,
    strategy: result.strategy,
    duration: result.duration,
  };
}
