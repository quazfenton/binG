/**
 * Session Lock - Redis-based Implementation
 * 
 * Uses Redis to provide distributed session locking for concurrency protection.
 */

import { createLogger } from '../utils/logger';
import { getRedisClient } from '../redis/client';

const log = createLogger('Session:Lock');

const LOCK_TTL_SECONDS = 30;
const LOCK_PREFIX = 'session:lock:';

/**
 * Release function type
 */
export type SessionLockRelease = () => Promise<void>;

/**
 * Acquire session lock to prevent concurrent access
 */
export async function acquireSessionLock(sessionId: string): Promise<SessionLockRelease> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${sessionId}`;
  const lockValue = `${Date.now()}-${Math.random()}`;

  const acquired = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
  
  if (acquired) {
    log.debug('Session lock acquired', { sessionId });

    const release = async () => {
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
          log.debug('Session lock released', { sessionId });
        }
      } catch (err) {
        log.error('Failed to release session lock', { sessionId, error: err });
      }
    };

    return release;
  }

  const timeout = Date.now() + 10000;
  while (Date.now() < timeout) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const reAcquired = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (reAcquired) {
      log.debug('Session lock acquired after wait', { sessionId });
      return async () => {
        try {
          // Use atomic Lua script to prevent race condition
          const deleted = await redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            lockKey,
            lockValue
          );
          if (deleted === 1) {
            log.debug('Session lock released', { sessionId });
          }
        } catch (err) {
          log.error('Failed to release session lock', { sessionId, error: err });
        }
      };
    }
  }

  throw new Error(`Failed to acquire session lock for ${sessionId} after timeout`);
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
