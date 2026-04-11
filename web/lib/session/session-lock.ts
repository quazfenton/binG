/**
 * Session Lock - Redis-based Implementation
 *
 * Uses Redis to provide distributed session locking for concurrency protection.
 * Includes health checking, atomic release, and exponential backoff retry.
 */

import { createLogger } from '../utils/logger';
import { getRedisClient } from '../redis/client';

const log = createLogger('Session:Lock');

const LOCK_TTL_SECONDS = 30;
const LOCK_PREFIX = 'session:lock:';
const lockAcquireTimeoutMs = Number(process.env.SESSION_LOCK_REDIS_TIMEOUT);
const LOCK_ACQUIRE_TIMEOUT_MS =
  Number.isFinite(lockAcquireTimeoutMs) && lockAcquireTimeoutMs > 0 ? lockAcquireTimeoutMs : 10000;
const LOCK_BASE_DELAY_MS = 50;
const LOCK_MAX_JITTER_MS = 50;

/**
 * Release function type
 */
export type SessionLockRelease = () => Promise<void>;

/**
 * Create atomic release function using Lua script
 */
function createReleaseFunction(
  redis: ReturnType<typeof getRedisClient>,
  lockKey: string,
  lockValue: string
): SessionLockRelease {
  return async () => {
    try {
      // Use atomic Lua script to prevent race condition
      // This ensures get and del happen atomically
      const deleted = await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockValue
      );
      if (deleted === 1) {
        log.debug('Session lock released', { sessionId: lockKey.replace(LOCK_PREFIX, '') });
      }
    } catch (err) {
      log.error('Failed to release session lock', { 
        sessionId: lockKey.replace(LOCK_PREFIX, ''), 
        error: err instanceof Error ? err.message : String(err) 
      });
      // Don't throw - lock will expire naturally via TTL
    }
  };
}

/**
 * Check Redis health before attempting lock.
 * Uses a 2-second timeout to fail fast when Redis is unreachable,
 * allowing the unified lock to fall back to Memory without waiting
 * for ioredis's full retry cycle.
 */
export async function checkRedisHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const redis = getRedisClient();

    // Fail fast: if Redis isn't connected within 2s, skip it
    const pingPromise = redis.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis health check timed out (2s)')), 2000)
    );

    const result = await Promise.race([pingPromise, timeoutPromise]);
    if (result === 'PONG') {
      return { healthy: true };
    }
    return { healthy: false, error: `Unexpected ping response: ${result}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { healthy: false, error: `Redis unavailable: ${errorMessage}` };
  }
}

/**
 * Quick health check before attempting lock acquisition
 * Returns null if Redis is healthy, throws if unavailable.
 *
 * Pre-check: If the Redis client is not in 'ready' or 'connect' state,
 * fail immediately instead of waiting for a ping timeout. This avoids
 * the 2s delay when ioredis is still cycling through its internal
 * reconnection attempts.
 */
async function ensureRedisAvailable(): Promise<ReturnType<typeof getRedisClient>> {
  const redis = getRedisClient();

  // Fast path: if ioredis hasn't connected yet (or is reconnecting),
  // skip Redis immediately without waiting for a ping/timeout.
  // ioredis status: 'wait' → 'connecting' → 'connect' → 'ready'
  if (redis.status !== 'ready' && redis.status !== 'connecting') {
    throw new Error(`Redis client status is '${redis.status}' — skipping Redis lock strategy`);
  }

  const health = await checkRedisHealth();
  if (!health.healthy) {
    throw new Error(`Redis unavailable: ${health.error}`);
  }
  return redis;
}

/**
 * Acquire session lock to prevent concurrent access
 * 
 * Uses Redis SETNX with TTL for distributed locking.
 * Implements exponential backoff with jitter for retry.
 * Throws error if Redis is unavailable (caller should fallback to alternative strategy).
 */
export async function acquireSessionLock(sessionId: string): Promise<SessionLockRelease> {
  let redis: ReturnType<typeof getRedisClient>;
  
  try {
    redis = await ensureRedisAvailable();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to get Redis client', { sessionId, error: errorMessage });
    throw new Error(`Redis client unavailable: ${errorMessage}`);
  }

  const lockKey = `${LOCK_PREFIX}${sessionId}`;
  const lockValue = `${Date.now()}-${crypto.randomUUID()}`;

  try {
    const acquired = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');

    if (acquired) {
      log.debug('Session lock acquired', { sessionId });
      return createReleaseFunction(redis, lockKey, lockValue);
    }

    // Wait for lock with timeout and exponential backoff + jitter
    const timeout = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
    let attempt = 0;

    while (Date.now() < timeout) {
      // Exponential backoff: 50ms, 100ms, 200ms, 400ms... with jitter
      const delay = LOCK_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * LOCK_MAX_JITTER_MS;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;

      const reAcquired = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (reAcquired) {
        log.debug('Session lock acquired after wait', { 
          sessionId, 
          attempts: attempt + 1,
        });
        return createReleaseFunction(redis, lockKey, lockValue);
      }
    }

    throw new Error(`Lock acquisition timeout after ${LOCK_ACQUIRE_TIMEOUT_MS}ms (${attempt} attempts)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Redis lock acquisition failed', { sessionId, error: errorMessage });
    throw error; // Propagate to caller for fallback strategy
  }
}

/**
 * Release session lock
 */
export async function releaseSessionLock(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${sessionId}`;
  // Note: This standalone release cannot be atomic without storing lock value.
  // For atomic release, use the acquireSessionLock pattern which returns a release fn.
  await redis.del(lockKey);
  log.debug('Session lock released explicitly', { sessionId });
}
