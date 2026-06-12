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
  /**
   * Bug #33 (audit) — estimated byte cost of the file reference. We use
   * `path.length` as a cheap proxy so we don't have to read the file
   * contents on the hot path. The exact value matters less than the
   * relative ordering it gives the eviction policy.
   */
  byteSize: number;
  /**
   * Bug #27 (audit) — true for paths under cache/ephemeral roots
   * (`/tmp/`, `.cache/`, `/node_modules/`, `.log`, `.tmp`). Ephemeral
   * files are evicted FIRST when the session is at capacity, so a
   * workspace source file is never lost in favor of a build artefact.
   */
  ephemeral: boolean;
}

/**
 * Session tracking entry
 */
interface SessionEntry {
  files: Map<string, FileReference>;
  lastAccessed: number;
  messageCount: number;
  /**
   * Bug #33 (audit) — running sum of `byteSize` across all files in
   * this session. Compared against `CONFIG.MAX_BYTES_PER_SESSION` on
   * every insert so we evict proactively instead of letting memory
   * creep past the cap.
   */
  totalBytes: number;
}

/**
 * Configuration
 */
const CONFIG = {
  /** Maximum sessions to track (LRU eviction) */
  MAX_SESSIONS: 100,
  /**
   * Bug #27 (audit) — was 50. Lowered to 25 so the LRU-eviction
   * pathway is exercised on real sessions; the audit observed 42
   * files in 17 min with no eviction triggering.
   */
  MAX_FILES_PER_SESSION: 25,
  /**
   * Bug #33 (audit) — soft cap on total bytes per session. The
   * tracker uses `path.length` as a proxy for byte cost, so 5 MB
   * roughly maps to ~5 MB of path-string memory in the worst case.
   * Set conservatively; the real disk cost is bounded by what the
   * VFS actually wrote (see #8).
   */
  MAX_BYTES_PER_SESSION: 5 * 1024 * 1024,
  /** Session TTL in milliseconds (1 hour) */
  SESSION_TTL_MS: 60 * 60 * 1000,
  /** File pattern regex - matches common code file extensions */
  FILE_PATTERN: /[\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)/gi,
  /**
   * Bug #27 (audit) — paths matching this regex are flagged
   * `ephemeral: true` and evicted before persistent files when the
   * session is at capacity. Source files in the workspace are
   * `ephemeral: false` and survive eviction.
   */
  EPHEMERAL_PATH_REGEX: /(?:\/tmp\/|\.cache\/|\.npm\/|\.next\/|\.log|\/node_modules\/|\/dist\/|\.tmp$|\.bak$)/i,
} as const;

/**
 * In-memory session file tracker
 * CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
 */
declare global {
   
  var __sessionFileTrackerStore__: Map<string, SessionEntry> | undefined;
   
  var __sessionFileTrackerCleanup__: boolean | undefined;
}

const sessionStore = globalThis.__sessionFileTrackerStore__ ?? (globalThis.__sessionFileTrackerStore__ = new Map<string, SessionEntry>());

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
        totalBytes: 0, // Bug #33 — initialize byte counter for new sessions.
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
          // Bug #27 + #33 — evict BEFORE inserting if either the
          // file-count cap or the byte cap would be exceeded. Uses
          // the new LRU + ephemeral-aware eviction policy.
          const incomingByteSize = filePath.length;
          if (
            entry.files.size >= CONFIG.MAX_FILES_PER_SESSION ||
            entry.totalBytes + incomingByteSize > CONFIG.MAX_BYTES_PER_SESSION
          ) {
            evictForNewFile(entry, incomingByteSize);
          }
          ref = {
            path: filePath,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            mentionCount: 0,
            byteSize: incomingByteSize, // Bug #33 — track byte cost.
            ephemeral: CONFIG.EPHEMERAL_PATH_REGEX.test(filePath), // Bug #27.
          };
          entry.files.set(filePath, ref);
          entry.totalBytes += incomingByteSize; // Bug #33 — update running sum.
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
 * Get detailed file reference metadata for a session.
 *
 * Bug #27 + #33 (audit) — extended to expose `byteSize` and
 * `ephemeral` so callers (and the test surface) can see the new
 * state. The previous shape omitted these, making the dedup
 * behavior invisible to UIs and dashboards.
 */
export function getSessionFileDetails(
  conversationId: string
): Array<{
  path: string;
  mentionCount: number;
  lastSeen: number;
  byteSize: number;
  ephemeral: boolean;
}> {
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
      byteSize: ref.byteSize,
      ephemeral: ref.ephemeral,
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
 * Get session statistics (for monitoring/debugging).
 *
 * Bug #27 + #33 (audit) — extended to surface both file counts AND
 * byte counts, broken down by ephemeral vs persistent. The
 * SessionFileTracker used to expose only `totalFilesTracked`, so the
 * real memory/disk cost was invisible. Now callers can see the
 * proportion of ephemeral bytes (cache, build output) and trigger
 * alerts when the ratio climbs.
 */
export function getSessionStats(): {
  activeSessions: number;
  totalFilesTracked: number;
  totalBytesTracked: number;
  ephemeralFiles: number;
  ephemeralBytes: number;
  persistentFiles: number;
  persistentBytes: number;
} {
  let totalFiles = 0;
  let totalBytes = 0;
  let ephemeralFiles = 0;
  let ephemeralBytes = 0;
  for (const entry of sessionStore.values()) {
    totalFiles += entry.files.size;
    for (const ref of entry.files.values()) {
      totalBytes += ref.byteSize;
      if (ref.ephemeral) {
        ephemeralFiles++;
        ephemeralBytes += ref.byteSize;
      }
    }
  }
  return {
    activeSessions: sessionStore.size,
    totalFilesTracked: totalFiles,
    totalBytesTracked: totalBytes,
    ephemeralFiles,
    ephemeralBytes,
    persistentFiles: totalFiles - ephemeralFiles,
    persistentBytes: totalBytes - ephemeralBytes,
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
 * Bug #27 (audit) — replace `evictLeastMentioned` with an
 * ephemeral-first, LRU eviction policy. The old policy evicted the
 * file with the lowest mention count, which is the OPPOSITE of what
 * a context tracker wants: a single mention might be the only signal
 * for an important file. LRU (oldest `lastSeen` first) preserves the
 * recently-active working set.
 *
 * Order of preference (most evictable first):
 *  1. Ephemeral files, oldest `lastSeen` first (cache/build artefacts
 *     that don't represent user-intent context).
 *  2. Persistent files, oldest `lastSeen` first (the actual fallback
 *     when no ephemeral files exist).
 *
 * Strategy: evict-first, then check. Each iteration evicts one
 * candidate and re-checks whether the incoming file would now fit.
 * Stops as soon as it would. Logs every eviction at debug level.
 */
function evictForNewFile(entry: SessionEntry, incomingByteSize: number): void {
  // No-op if there's already room for the incoming file.
  if (
    entry.files.size < CONFIG.MAX_FILES_PER_SESSION &&
    entry.totalBytes + incomingByteSize <= CONFIG.MAX_BYTES_PER_SESSION
  ) {
    return;
  }

  // Build eviction candidates: ephemeral first, then by oldest lastSeen.
  const candidates: FileReference[] = [];
  for (const ref of entry.files.values()) {
    candidates.push(ref);
  }
  candidates.sort((a, b) => {
    if (a.ephemeral !== b.ephemeral) return a.ephemeral ? -1 : 1;
    return a.lastSeen - b.lastSeen;
  });

  for (const ref of candidates) {
    // Evict this candidate first.
    entry.files.delete(ref.path);
    entry.totalBytes = Math.max(0, entry.totalBytes - ref.byteSize);
    logger.debug('Evicted file for capacity', {
      path: ref.path,
      ephemeral: ref.ephemeral,
      lastSeen: ref.lastSeen,
      totalBytesAfter: entry.totalBytes,
      totalFilesAfter: entry.files.size,
    });
    // Now check whether the incoming file would fit. If yes, stop.
    if (
      entry.files.size < CONFIG.MAX_FILES_PER_SESSION &&
      entry.totalBytes + incomingByteSize <= CONFIG.MAX_BYTES_PER_SESSION
    ) {
      return;
    }
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
// CRITICAL FIX: Guarded by globalThis flag to prevent timer leaks on hot-reload
// ============================================================================
if (
  typeof process !== 'undefined' &&
  typeof process.env !== 'undefined' &&
  process.env.NODE_ENV !== 'test' &&
  !globalThis.__sessionFileTrackerCleanup__
) {
  globalThis.__sessionFileTrackerCleanup__ = true;
  startSessionCleanup(5 * 60 * 1000); // Every 5 minutes
}
