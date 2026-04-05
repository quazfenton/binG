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