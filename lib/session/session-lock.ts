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
 * Acquire session lock to prevent concurrent access
 */
export async function acquireSessionLock(sessionId: string): Promise<() => void> {
  const redis = getRedisClient();
  const lockKey = `${LOCK_PREFIX}${sessionId}`;
  const lockValue = `${Date.now()}-${Math.random()}`;

  const acquired = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
  
  if (acquired) {
    log.debug('Session lock acquired', { sessionId });
    
    const release = async () => {
      const currentValue = await redis.get(lockKey);
      if (currentValue === lockValue) {
        await redis.del(lockKey);
        log.debug('Session lock released', { sessionId });
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
        const currentValue = await redis.get(lockKey);
        if (currentValue === lockValue) {
          await redis.del(lockKey);
          log.debug('Session lock released', { sessionId });
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
  await redis.del(lockKey);
  log.debug('Session lock released explicitly', { sessionId });
}
