/**
 * File Events Integration
 * 
 * Unified file event emission for MCP tools, VFS operations, and desktop filesystem.
 * This ensures the new MCP/VFS file editing system emits the same events as the legacy
 * parsing system, integrating with:
 * - Session file tracker (trackSessionFiles) for smart-context
 * - Filesystem sync events (emitFilesystemUpdated) for UI updates
 * - Diff tracking for enhanced-diff-viewer
 * 
 * Usage:
 * ```ts
 * // After any file operation
 * await emitFileEvent({
 *   userId: 'user-123',
 *   sessionId: 'sess-001',
 *   path: '/src/App.tsx',
 *   type: 'create', // or 'update', 'delete'
 *   content: 'new content',
 *   previousContent: 'old content', // for updates
 * });
 * ```
 */

import { emitFilesystemUpdated, type FilesystemUpdatedDetail } from './sync/sync-events';
import { trackSessionFiles } from './session-file-tracker';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('FileEvents');

/**
 * Request-scoped tracker for file edits from MCP tool execution.
 * Used by spec amplification to detect when files were modified via
 * function calling (not text-based file edit markers).
 *
 * Auto-cleanup: entries are removed after 5 minutes to prevent memory leaks
 * from orphaned sessions that never hit the spec amplification check.
 */
const recentMcpFileEdits = new Map<string, { paths: Set<string>; timestamp: number }>();
const MCP_EDIT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Prune expired entries from the tracker.
 * Called lazily on each write to avoid dedicated timer overhead.
 */
function pruneExpired(): void {
  const now = Date.now();
  for (const [key, val] of recentMcpFileEdits.entries()) {
    if (now - val.timestamp > MCP_EDIT_TTL_MS) {
      recentMcpFileEdits.delete(key);
    }
  }
}

/**
 * Track a file edit from MCP tool execution for a given session.
 */
export function trackMcpFileEdit(sessionId: string, path: string): void {
  if (!sessionId) return;
  // Lazy cleanup of expired entries (throttled — only on writes)
  if (recentMcpFileEdits.size > 50) {
    pruneExpired();
  }
  const entry = recentMcpFileEdits.get(sessionId);
  if (entry) {
    entry.paths.add(path);
    entry.timestamp = Date.now(); // refresh TTL
  } else {
    recentMcpFileEdits.set(sessionId, { paths: new Set([path]), timestamp: Date.now() });
  }
}

/**
 * Get recent file edits from MCP tool execution for a session.
 * Returns an array of { path } objects compatible with the spec
 * amplification file edits format.
 */
export function getRecentMcpFileEdits(sessionId?: string): Array<{ path: string; content?: string }> {
  if (!sessionId) return [];
  const entry = recentMcpFileEdits.get(sessionId);
  if (!entry) return [];
  // Check TTL expiry
  if (Date.now() - entry.timestamp > MCP_EDIT_TTL_MS) {
    recentMcpFileEdits.delete(sessionId);
    return [];
  }
  return Array.from(entry.paths).map(path => ({ path }));
}

/**
 * Clear recent MCP file edits tracker for a session.
 * Call after spec amplification check to prevent stale data.
 */
export function clearRecentMcpFileEdits(sessionId?: string): void {
  if (sessionId) {
    recentMcpFileEdits.delete(sessionId);
  } else {
    recentMcpFileEdits.clear();
  }
}

/**
 * File event types - consistent across MCP, VFS, and desktop
 */
export type FileEventType = 'create' | 'update' | 'delete';

/**
 * File event options
 */
export interface EmitFileEventOptions {
  /** User ID for VFS access */
  userId: string;
  /** Session/conversation ID for tracking */
  sessionId?: string;
  /** File path */
  path: string;
  /** Event type */
  type: FileEventType;
  /** New content (for create/update) */
  content?: string;
  /** Previous content (for update/delete) */
  previousContent?: string;
  /** Source of the event (e.g., 'mcp-tool', 'desktop-fs', 'vfs') */
  source?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Emit a unified file event to all subsystems
 * 
 * This function coordinates:
 * 1. UI updates via emitFilesystemUpdated (cross-tab, cross-session)
 * 2. Session file tracking via trackSessionFiles (for smart-context)
 * 3. Diff tracking for enhanced-diff-viewer (via metadata)
 */
export async function emitFileEvent(options: EmitFileEventOptions): Promise<void> {
  const {
    userId,
    sessionId,
    path,
    type,
    content,
    previousContent,
    source = 'file-events',
    metadata = {},
  } = options;

  try {
    // Track file edits from MCP tool execution for spec amplification.
    // When files are modified via function calling (not text-based file edit markers),
    // the spec amplification system needs to know about these changes.
    if (source?.startsWith('mcp-tool') && sessionId) {
      trackMcpFileEdit(sessionId, path);
    }

    // 1. Emit filesystem event for UI updates (cross-tab, cross-session)
    const eventDetail: FilesystemUpdatedDetail = {
      path,
      type,
      source,
      sessionId,
      emittedAt: Date.now(),
      // Include content for diff viewer (only if not too large)
      applied: type !== 'delete' ? {
        content: content?.slice(0, 100000), // Limit to prevent memory issues
      } : undefined,
      // Include previous content for diff calculation
      ...(type === 'update' && previousContent ? {
        previousContent: previousContent.slice(0, 100000),
      } : {}),
      ...metadata,
    };

    emitFilesystemUpdated(eventDetail);
    logger.debug('Filesystem event emitted', { path, type, source });

    // 2. Track session files for smart-context
    // Include path in a format that matches the FILE_PATTERN regex in session-file-tracker.ts
    // The regex matches: /[\w\-/.]+\.(?:tsx?|jsx?|py|rs|go|java|css|scss|json|md|yaml|yml|toml|sh|bash|html|sql|graphql|proto|tf|hcl)/gi
    if (sessionId) {
      // Put the file path in natural text that will be captured by the regex
      const syntheticMessage = {
        role: 'system' as const,
        content: `Completed ${type} operation on ${path}`, // path will be extracted by regex
      };
      
      // Track the file reference in session
      await trackSessionFiles(sessionId, [syntheticMessage]);
      logger.debug('Session file tracked', { sessionId, path, type });
    }

    // 3. For updates with diff, we could emit additional events
    // The enhanced-diff-viewer can pick up from the filesystem-updated event's applied/previousContent

  } catch (error: any) {
    // Don't fail the file operation if event emission fails
    logger.warn('Failed to emit file event', { path, type, error: error.message });
  }
}

/**
 * Emit multiple file events in batch
 * More efficient than calling emitFileEvent multiple times
 */
export async function emitBatchFileEvents(
  options: Omit<EmitFileEventOptions, 'path' | 'type' | 'content' | 'previousContent'> & {
    files: Array<{
      path: string;
      type: FileEventType;
      content?: string;
      previousContent?: string;
    }>;
  }
): Promise<void> {
  const { userId, sessionId, source, metadata } = options;

  // Process in parallel
  await Promise.all(
    options.files.map(file =>
      emitFileEvent({
        userId,
        sessionId,
        path: file.path,
        type: file.type,
        content: file.content,
        previousContent: file.previousContent,
        source,
        metadata,
      })
    )
  );
}

/**
 * Emit diff event for enhanced-diff-viewer
 * This is called when a diff/patch is applied to track the change for UI
 */
export async function emitDiffEvent(options: {
  userId: string;
  sessionId?: string;
  path: string;
  diff: string;
  previousContent: string;
  newContent: string;
  source?: string;
}): Promise<void> {
  await emitFileEvent({
    userId: options.userId,
    sessionId: options.sessionId,
    path: options.path,
    type: 'update',
    content: options.newContent,
    previousContent: options.previousContent,
    source: options.source || 'diff',
    metadata: {
      diff: options.diff.slice(0, 50000), // Limit diff size
      diffLength: options.diff.length,
    },
  });
}

/**
 * Helper to emit events from MCP tool results
 * Extracts the relevant info from tool execution result
 */
export function emitEventFromToolResult(
  toolName: string,
  result: any,
  userId: string,
  sessionId?: string
): void {
  if (!result?.success) return;

  const path = result.path;
  if (!path) return;

  switch (toolName) {
    case 'write_file':
    case 'batch_write':
      emitFileEvent({
        userId,
        sessionId,
        path,
        type: result.existed ? 'update' : 'create',
        content: result.content,
        source: 'mcp-tool',
      });
      break;

    case 'apply_diff':
      // For diffs, we track the result but can't easily get previous/new content here
      // The tool should pass that info explicitly if needed
      emitFileEvent({
        userId,
        sessionId,
        path,
        type: 'update',
        source: 'mcp-tool',
        metadata: { appliedDiff: true },
      });
      break;

    case 'delete_file':
      emitFileEvent({
        userId,
        sessionId,
        path,
        type: 'delete',
        source: 'mcp-tool',
      });
      break;

    case 'create_directory':
      // Directories don't need the same level of tracking
      break;
  }
}

export default {
  emitFileEvent,
  emitBatchFileEvents,
  emitDiffEvent,
  emitEventFromToolResult,
};