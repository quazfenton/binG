/**
 * Session Lock - Memory-based Fallback Implementation
 *
 * Provides in-memory session locking as fallback when Redis is unavailable.
 * Suitable for single-instance deployments or as temporary fallback.
 * 
 * Features:
 * - Automatic TTL-based expiration
 * - Periodic cleanup of expired locks
 * - Atomic release with ownership check
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Session:Lock:Memory');

const MEMORY_LOCK_TTL_MS = parseInt(process.env.SESSION_LOCK_MEMORY_TTL || '30000');
const CLEANUP_INTERVAL_MS = 5000;

interface MemoryLock {
  value: string;
  expires: number;
  acquired: number;
  attempts: number;
}

const memoryLocks = new Map<string, MemoryLock>();

/**
 * Periodic cleanup of expired locks
 */
function startCleanupInterval(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, lock] of memoryLocks.entries()) {
      if (now > lock.expires) {
        memoryLocks.delete(sessionId);
        cleaned++;
        log.debug('Expired memory lock cleaned up', { sessionId });
      }
    }
    
    if (cleaned > 0) {
      log.info('Cleanup cycle complete', { cleaned });
    }
  }, CLEANUP_INTERVAL_MS);
}

// Start cleanup interval (singleton)
const cleanupInterval = startCleanupInterval();

// Cleanup on process exit
process.on('beforeExit', () => {
  clearInterval(cleanupInterval);
});

export type MemoryLockRelease = () => Promise<void>;

export interface MemoryLockResult {
  release: MemoryLockRelease;
  attempts: number;
}

/**
 * Acquire memory-based session lock
 * 
 * Throws error if lock is already held (no waiting - fail fast for fallback).
 * Caller should implement their own retry logic if needed.
 */
export async function acquireMemoryLock(
  sessionId: string,
  options: { timeout?: number; maxAttempts?: number } = {}
): Promise<MemoryLockResult> {
  const { timeout = 5000, maxAttempts = 3 } = options;
  const now = Date.now();
  const existingLock = memoryLocks.get(sessionId);

  // Check if existing lock is still valid
  if (existingLock && now < existingLock.expires) {
    log.warn('Memory lock already held', { 
      sessionId, 
      expiresAt: existingLock.expires,
      remainingMs: existingLock.expires - now,
    });
    throw new Error(`Memory lock already held for session ${sessionId}`);
  }

  // If expired lock exists, clean it up
  if (existingLock) {
    log.debug('Cleaning up expired lock', { 
      sessionId, 
      expiredMs: now - existingLock.expires,
    });
    memoryLocks.delete(sessionId);
  }

  const lockValue = `${now}-${crypto.randomUUID()}`;
  const lock: MemoryLock = {
    value: lockValue,
    expires: now + MEMORY_LOCK_TTL_MS,
    acquired: now,
    attempts: 1,
  };

  memoryLocks.set(sessionId, lock);

  log.debug('Memory lock acquired', { 
    sessionId,
    ttlMs: MEMORY_LOCK_TTL_MS,
  });

  const release: MemoryLockRelease = async () => {
    const currentLock = memoryLocks.get(sessionId);
    if (currentLock && currentLock.value === lockValue) {
      memoryLocks.delete(sessionId);
      log.debug('Memory lock released', { sessionId });
    } else if (currentLock) {
      log.warn('Memory lock release skipped - lock owned by different holder', { sessionId });
    } else {
      log.debug('Memory lock already cleared on release', { sessionId });
    }
  };

  return { release, attempts: 1 };
}

/**
 * Try to acquire memory lock with retry
 */
export async function acquireMemoryLockWithRetry(
  sessionId: string,
  options: { timeout?: number; maxAttempts?: number; baseDelay?: number } = {}
): Promise<MemoryLockResult> {
  const { timeout = 5000, maxAttempts = 3, baseDelay = 50 } = options;
  const deadline = Date.now() + timeout;
  let attempts = 0;
  let lastError: Error | undefined;

  while (attempts < maxAttempts && Date.now() < deadline) {
    attempts++;
    
    try {
      const result = await acquireMemoryLock(sessionId, { 
        timeout: deadline - Date.now(),
        maxAttempts: 1, // Single attempt per retry cycle
      });
      
      log.debug('Memory lock acquired after retry', { 
        sessionId, 
        attempts,
      });
      
      return { ...result, attempts };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.debug('Memory lock attempt failed', { 
        sessionId, 
        attempt: attempts,
        error: lastError.message,
      });

      if (attempts < maxAttempts && Date.now() < deadline) {
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempts - 1) + Math.random() * 50;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to acquire memory lock for ${sessionId} after ${attempts} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Release memory lock explicitly (alternative to using release function)
 */
export async function releaseMemoryLock(sessionId: string): Promise<void> {
  const lock = memoryLocks.get(sessionId);
  if (lock) {
    memoryLocks.delete(sessionId);
    log.debug('Memory lock released explicitly', { sessionId });
  }
}

/**
 * Check if a session is currently locked
 */
export function isSessionLocked(sessionId: string): boolean {
  const lock = memoryLocks.get(sessionId);
  if (!lock) return false;
  
  const now = Date.now();
  if (now > lock.expires) {
    // Lock is expired
    return false;
  }
  
  return true;
}

/**
 * Get lock statistics
 */
export function getMemoryLockStats(): {
  activeLocks: number;
  expiredLocks: number;
  oldestLockAge: number;
} {
  const now = Date.now();
  let activeLocks = 0;
  let expiredLocks = 0;
  let oldestLockAge = 0;

  for (const [, lock] of memoryLocks.entries()) {
    if (now < lock.expires) {
      activeLocks++;
      const age = now - lock.acquired;
      if (age > oldestLockAge) {
        oldestLockAge = age;
      }
    } else {
      expiredLocks++;
    }
  }

  return {
    activeLocks,
    expiredLocks,
    oldestLockAge,
  };
}

/**
 * Clear all locks (for testing only)
 */
export function __clearAllLocks__(): void {
  memoryLocks.clear();
  log.warn('All memory locks cleared (testing only)');
}
