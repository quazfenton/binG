/**
 * Session File Tracker
 *
 * O(1) incremental file reference tracking for conversation sessions.
 * Instead of re-scanning messages with regex on every context generation,
 * this tracker collects file references as messages flow through the system.
 *
 * Usage:
 * ```ts
 * // When a message is sent/received:
 * await trackSessionFiles(conversationId, messages);
 *
 * // When generating context (O(1) lookup):
 * const recentFiles = getSessionFiles(conversationId);
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SessionFileTracker');

/**
 * File reference entry with metadata
 */
interface FileReference {
  path: string;
  firstSeen: number;
  lastSeen: number;
  mentionCount: number;
}

/**
 * Session tracking entry
 */
interface SessionEntry {
  files: Map<string, FileReference>;
  lastAccessed: number;
  messageCount: number;
}

/**
 * Configuration
 */
const CONFIG = {
  /** Maximum sessions to track (LRU eviction) */
  MAX_SESSIONS: 100,
  /** Maximum files per session to track */
  MAX_FILES_PER_SESSION: 50,
  /** Session TTL in milliseconds (1 hour) */
  SESSION_TTL_MS: 60 * 60 * 1000,
  /** File pattern regex - matches common code file extensions */
  FILE_PATTERN: /[\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)/gi,
} as const;

/**
 * In-memory session file tracker
 */
const sessionStore = new Map<string, SessionEntry>();

/**
 * Track file references in messages for a session (incremental, O(n) where n = message count)
 * Call this once when messages are received, not on every context generation
 */
export async function trackSessionFiles(
  conversationId: string,
  messages: Array<{ role: string; content: string | any[] }>
): Promise<void> {
  if (!conversationId || !messages || messages.length === 0) {
    return;
  }

  try {
    // Get or create session entry
    let entry = sessionStore.get(conversationId);
    if (!entry) {
      // Evict if at capacity
      if (sessionStore.size >= CONFIG.MAX_SESSIONS) {
        evictLRU();
      }
      entry = {
        files: new Map(),
        lastAccessed: Date.now(),
        messageCount: 0,
      };
      sessionStore.set(conversationId, entry);
    }

    // Only process new messages (track message count)
    const startIdx = entry.messageCount;
    if (startIdx >= messages.length) {
      // No new messages, just update access time
      entry.lastAccessed = Date.now();
      return;
    }

    // Process only new messages
    for (let i = startIdx; i < messages.length; i++) {
      const msg = messages[i];
      const content = typeof msg.content === 'string' ? msg.content : '';
      
      if (!content) continue;

      // Extract file references from message content
      for (const match of content.matchAll(CONFIG.FILE_PATTERN)) {
        const filePath = match[0];
        
        // Update or create file reference
        let ref = entry.files.get(filePath);
        if (!ref) {
          // Evict if at capacity for this session
          if (entry.files.size >= CONFIG.MAX_FILES_PER_SESSION) {
            evictLeastMentioned(entry);
          }
          ref = {
            path: filePath,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            mentionCount: 0,
          };
          entry.files.set(filePath, ref);
        }
        
        // Update reference metadata
        ref.lastSeen = Date.now();
        ref.mentionCount++;
      }
    }

    // Update session metadata
    entry.messageCount = messages.length;
    entry.lastAccessed = Date.now();

    logger.debug('Session files tracked', { 
      conversationId, 
      newMessages: messages.length - startIdx,
      totalFiles: entry.files.size,
    });
  } catch (error: any) {
    // Don't fail the request if tracking fails
    logger.warn('Failed to track session files', { conversationId, error: error.message });
  }
}

/**
 * Get tracked file references for a session (O(1) lookup)
 * Returns files sorted by mention count (most referenced first)
 */
export function getSessionFiles(
  conversationId: string,
  limit: number = 10
): string[] {
  const entry = sessionStore.get(conversationId);
  if (!entry) {
    return [];
  }

  // Update access time
  entry.lastAccessed = Date.now();

  // Sort by mention count (descending) and take top N
  const sorted = Array.from(entry.files.values())
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, limit)
    .map(ref => ref.path);

  return sorted;
}

/**
 * Get detailed file reference metadata for a session
 */
export function getSessionFileDetails(
  conversationId: string
): Array<{ path: string; mentionCount: number; lastSeen: number }> {
  const entry = sessionStore.get(conversationId);
  if (!entry) {
    return [];
  }

  entry.lastAccessed = Date.now();

  return Array.from(entry.files.values())
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .map(ref => ({
      path: ref.path,
      mentionCount: ref.mentionCount,
      lastSeen: ref.lastSeen,
    }));
}

/**
 * Clear session tracking data
 */
export function clearSession(conversationId: string): boolean {
  return sessionStore.delete(conversationId);
}

/**
 * Clear all session tracking data (useful for testing)
 */
export function clearAllSessions(): void {
  sessionStore.clear();
}

/**
 * Get session statistics (for monitoring/debugging)
 */
export function getSessionStats(): { activeSessions: number; totalFilesTracked: number } {
  let totalFiles = 0;
  for (const entry of sessionStore.values()) {
    totalFiles += entry.files.size;
  }
  return {
    activeSessions: sessionStore.size,
    totalFilesTracked: totalFiles,
  };
}

/**
 * Evict least recently used session
 */
function evictLRU(): void {
  let lruKey: string | null = null;
  let lruTime = Infinity;
  
  for (const [key, entry] of sessionStore.entries()) {
    if (entry.lastAccessed < lruTime) {
      lruTime = entry.lastAccessed;
      lruKey = key;
    }
  }
  
  if (lruKey) {
    sessionStore.delete(lruKey);
    logger.debug('Evicted LRU session', { conversationId: lruKey });
  }
}

/**
 * Evict least mentioned file from a session
 */
function evictLeastMentioned(entry: SessionEntry): void {
  let leastKey: string | null = null;
  let leastCount = Infinity;
  
  for (const [key, ref] of entry.files.entries()) {
    if (ref.mentionCount < leastCount) {
      leastCount = ref.mentionCount;
      leastKey = key;
    }
  }
  
  if (leastKey) {
    entry.files.delete(leastKey);
  }
}

/**
 * Periodic cleanup of expired sessions
 * Call this on an interval (e.g., every 5 minutes)
 */
export function cleanupExpiredSessions(): void {
  const now = Date.now();
  const expired: string[] = [];
  
  for (const [key, entry] of sessionStore.entries()) {
    if (now - entry.lastAccessed > CONFIG.SESSION_TTL_MS) {
      expired.push(key);
    }
  }
  
  for (const key of expired) {
    sessionStore.delete(key);
  }
  
  if (expired.length > 0) {
    logger.debug('Cleaned up expired sessions', { count: expired.length });
  }
}

/**
 * Start automatic cleanup interval
 * Call this once at application startup (auto-started on module import)
 */
let cleanupInterval: NodeJS.Timeout | null = null;

export function startSessionCleanup(intervalMs: number = 5 * 60 * 1000): void {
  if (cleanupInterval) {
    return; // Already running
  }
  
  cleanupInterval = setInterval(cleanupExpiredSessions, intervalMs);
  // Unref to allow process to exit without waiting for timer
  if (typeof cleanupInterval.unref === 'function') {
    cleanupInterval.unref();
  }
  logger.info('Session cleanup started', { intervalMs });
}

/**
 * Stop automatic cleanup interval
 */
export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Session cleanup stopped');
  }
}

// ============================================================================
// Auto-start cleanup on module import
// Runs every 5 minutes to evict expired sessions (TTL: 1 hour)
// Skipped in test environments to avoid interfering with test isolation
// ============================================================================
if (
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env.NODE_ENV !== 'test'
) {
  startSessionCleanup(5 * 60 * 1000); // Every 5 minutes
}
