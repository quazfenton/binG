/**
 * Session Lock - Queue-based Fallback Implementation
 *
 * Provides request queuing as final fallback when Redis and memory locks fail.
 * Serializes requests for the same session without actual locking.
 * 
 * Features:
 * - FIFO queue per session
 * - Automatic cleanup when queue empties
 * - Timeout protection
 * - No external dependencies
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Session:Lock:Queue');

const QUEUE_LOCK_TIMEOUT_MS = parseInt(process.env.SESSION_LOCK_QUEUE_TIMEOUT || '60000');
const QUEUE_CLEANUP_INTERVAL_MS = 30000;

interface QueueEntry {
  resolve: (release: QueueLockRelease) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  enqueued: number;
}

interface SessionQueue {
  entries: QueueEntry[];
  active: boolean;
  created: number;
  lastActivity: number;
}

const sessionQueues = new Map<string, SessionQueue>();

/**
 * Periodic cleanup of empty queues
 */
function startCleanupInterval(): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, queue] of sessionQueues.entries()) {
      // Remove queues that are inactive and have no entries
      if (!queue.active && queue.entries.length === 0) {
        sessionQueues.delete(sessionId);
        cleaned++;
        log.debug('Empty queue cleaned up', { sessionId });
      }
      
      // Log stale queues (no activity for 5 minutes)
      if (now - queue.lastActivity > 5 * 60 * 1000) {
        log.warn('Stale queue detected', { 
          sessionId, 
          inactiveMs: now - queue.lastActivity,
          entries: queue.entries.length,
        });
      }
    }
    
    if (cleaned > 0) {
      log.info('Queue cleanup cycle complete', { cleaned });
    }
  }, QUEUE_CLEANUP_INTERVAL_MS);
}

// Start cleanup interval (singleton)
const cleanupInterval = startCleanupInterval();

// Cleanup on process exit
process.on('beforeExit', () => {
  clearInterval(cleanupInterval);
});

export type QueueLockRelease = () => Promise<void>;

export interface QueueLockResult {
  release: QueueLockRelease;
  waitTime: number;
  position: number;
}

/**
 * Acquire queue-based session lock
 * 
 * Queues the request and resolves when it's at the front of the queue.
 * Implements timeout protection to prevent indefinite waiting.
 */
export async function acquireQueueLock(
  sessionId: string,
  options: { timeout?: number } = {}
): Promise<QueueLockResult> {
  const { timeout = QUEUE_LOCK_TIMEOUT_MS } = options;
  const enqueued = Date.now();
  let resolved = false;
  let releaseCalled = false;

  return new Promise((resolvePromise, rejectPromise) => {
    // Get or create queue for this session
    let queue = sessionQueues.get(sessionId);
    if (!queue) {
      queue = {
        entries: [],
        active: false,
        created: enqueued,
        lastActivity: enqueued,
      };
      sessionQueues.set(sessionId, queue);
    }

    queue.lastActivity = enqueued;

    // Create timeout for this request
    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Remove from queue by finding entry with matching timeout
        const index = queue!.entries.findIndex(e => e.timeout === timeoutTimer);
        if (index !== -1) {
          queue!.entries.splice(index, 1);
        }
        log.warn('Queue lock timeout', {
          sessionId,
          waitTimeMs: Date.now() - enqueued,
          position: index !== -1 ? index + 1 : -1,
        });
        rejectPromise(new Error(`Queue lock timeout after ${timeout}ms`));
      }
    }, timeout);

    const queueEntry: QueueEntry = {
      resolve: (release) => {
        if (!resolved) {
          resolved = true;
          resolvePromise({
            release,
            waitTime: Date.now() - enqueued,
            position: queue!.entries.length + 1,
          });
        }
      },
      reject: rejectPromise,
      timeout: timeoutTimer,
      enqueued,
    };

    if (!queue.active && queue.entries.length === 0) {
      // First in line - acquire immediately
      queue.active = true;
      resolved = true;
      
      log.debug('Queue lock acquired (first)', { sessionId });
      
      const release: QueueLockRelease = async () => {
        if (releaseCalled) return;
        releaseCalled = true;
        clearTimeout(timeoutTimer);

        queue!.active = false;
        queue!.lastActivity = Date.now();

        // Process next in queue
        if (queue!.entries.length > 0) {
          const next = queue!.entries.shift()!;
          queue!.active = true;
          next.resolve(createReleaseFunction(sessionId, queue!));
        }

        log.debug('Queue lock released', { sessionId });
      };

      resolvePromise({ 
        release, 
        waitTime: 0, 
        position: 0,
      });
    } else {
      // Wait in queue - position is current queue length + 1 (will be decremented when others complete)
      const position = queue.entries.length + 1;
      queue.entries.push(queueEntry);
      
      log.debug('Queue lock waiting', { 
        sessionId, 
        position,
        queueLength: queue.entries.length,
      });
    }
  });
}

/**
 * Create release function for queue lock
 */
function createReleaseFunction(
  sessionId: string,
  queue: SessionQueue
): QueueLockRelease {
  let releaseCalled = false;

  return async () => {
    if (releaseCalled) return;
    releaseCalled = true;

    queue.active = false;
    queue.lastActivity = Date.now();

    // Process next in queue
    if (queue.entries.length > 0) {
      const next = queue.entries.shift()!;
      queue.active = true;
      next.resolve(createReleaseFunction(sessionId, queue));
    }

    log.debug('Queue lock released', { sessionId });
  };
}

/**
 * Get queue statistics for a session
 */
export function getQueueStats(sessionId?: string): {
  totalQueues: number;
  totalWaiting: number;
  activeQueues: number;
  session?: {
    position: number;
    queueLength: number;
    active: boolean;
  };
} {
  let totalWaiting = 0;
  let activeQueues = 0;

  for (const [, queue] of sessionQueues.entries()) {
    totalWaiting += queue.entries.length;
    if (queue.active) activeQueues++;
  }

  let sessionStats = undefined;
  if (sessionId) {
    const queue = sessionQueues.get(sessionId);
    if (queue) {
      sessionStats = {
        position: queue.active ? 0 : 1, // If not active, next in line
        queueLength: queue.entries.length,
        active: queue.active,
      };
    }
  }

  return {
    totalQueues: sessionQueues.size,
    totalWaiting,
    activeQueues,
    session: sessionStats,
  };
}

/**
 * Clear all queues (for testing only)
 */
export function __clearAllQueues__(): void {
  // Reject all pending entries
  for (const [, queue] of sessionQueues.entries()) {
    for (const entry of queue.entries) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Queues cleared (testing only)'));
    }
  }
  sessionQueues.clear();
  log.warn('All queues cleared (testing only)');
}
