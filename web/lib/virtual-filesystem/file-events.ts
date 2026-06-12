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
 *
 * CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
 */
declare global {
   
  var __recentMcpFileEdits__: Map<string, { paths: Set<string>; timestamp: number }> | undefined;
}

const recentMcpFileEdits = globalThis.__recentMcpFileEdits__ ?? (globalThis.__recentMcpFileEdits__ = new Map<string, { paths: Set<string>; timestamp: number }>());
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
  if (recentMcpFileEdits.size > 20) {
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
 * Subscriber mechanism for server-side cache invalidation and other
 * cross-cutting concerns. When any file operation emits an event via
 * emitFileEvent(), all registered subscribers are notified.
 *
 * This allows the tool result cache (in architecture-integration.ts) to
 * invalidate list_files/read_file caches regardless of how the file was
 * modified — whether via MCP tools, bash_execute, direct VFS APIs, or
 * OPFS sync — without having to modify each individual code path.
 */
export type FileEventCallback = (event: EmitFileEventOptions) => void;
const fileEventSubscribers: FileEventCallback[] = [];

/**
 * Register a subscriber to receive all file events.
 * Returns an unsubscribe function.
 */
export function onFileEvent(callback: FileEventCallback): () => void {
  fileEventSubscribers.push(callback);
  return () => {
    const idx = fileEventSubscribers.indexOf(callback);
    if (idx !== -1) fileEventSubscribers.splice(idx, 1);
  };
}

/**
 * File event types - consistent across MCP, VFS, and desktop
 */
export type FileEventType = 'create' | 'update' | 'delete';

/**
 * Standardized source tags for file events.
 *
 * When a file event is emitted, the `source` field identifies the originating
 * UI surface or server-side system. Use one of these constants where possible
 * so run.log entries can be filtered with a single string match:
 *
 *   `rg '"source":"workspace-panel"' run.log`
 *   `rg '"source":"terminal-panel"' run.log`
 *   `rg '"source":"code-preview-panel"' run.log`
 *
 * UI surface tags:
 *   - `workspace-panel` — user actions in the workspace file-tree panel
 *     (paste, rename, move, delete, create, upload).
 *   - `terminal-panel` — file changes triggered by terminal commands
 *     (PTY/bash, sandbox-shell, file-watchers spawned by terminals).
 *   - `code-preview-panel` — preview-related file changes
 *     (scaffolded files, generated assets, preview hot-reload syncs).
 *
 * Server-side subsystem tags (kept for back-compat):
 *   - `mcp-tool`           — VFS MCP tools (write_file, batch_write, apply_diff, delete_file)
 *   - `mcp-tool-diff`      — apply_diff tool with standard unified diff
 *   - `mcp-tool-diff-sar`  — apply_diff tool with search-and-replace format (<<<<< SEARCH / >>>>> REPLACE)
 *   - `mcp-tool:<toolName>` — specific MCP tool (e.g. `mcp-tool:write_file`)
 *   - `desktop-vfs`        — Tauri desktop VFS sync writes
 *   - `desktop-vfs-directory` — Tauri desktop VFS directory creation
 *   - `vfs-file-watcher`   — internal polling watcher (debounced create/update/delete)
 *   - `diff`               — diff-apply event (enhanced-diff-viewer)
 *   - `file-events`        — generic / default (caller didn't specify)
 */
export const FILE_EVENT_SOURCES = {
  WORKSPACE_PANEL: 'workspace-panel',
  TERMINAL_PANEL: 'terminal-panel',
  CODE_PREVIEW_PANEL: 'code-preview-panel',
  MCP_TOOL: 'mcp-tool',
  MCP_TOOL_DIFF: 'mcp-tool-diff',
  MCP_TOOL_DIFF_SAR: 'mcp-tool-diff-sar',
  DESKTOP_VFS: 'desktop-vfs',
  DESKTOP_VFS_DIRECTORY: 'desktop-vfs-directory',
  VFS_FILE_WATCHER: 'vfs-file-watcher',
  DIFF: 'diff',
  FILE_EVENTS: 'file-events',
} as const;

export type FileEventSource = typeof FILE_EVENT_SOURCES[keyof typeof FILE_EVENT_SOURCES] | string;

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
  /**
   * Source of the event. Prefer the constants in {@link FILE_EVENT_SOURCES}
   * (e.g. `workspace-panel`, `terminal-panel`, `code-preview-panel`) so
   * run.log entries can be filtered by originating UI surface.
   */
  source?: FileEventSource;
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
    // ── 0. Notify registered subscribers FIRST ───────────────────────────
    // Data-integrity subscribers (e.g., cache invalidation) must fire even
    // if the UI event emission or session tracking fails below.
    for (const subscriber of fileEventSubscribers) {
      try {
        subscriber(options);
      } catch (subError: any) {
        logger.warn('File event subscriber failed', { path, type, error: subError.message });
      }
    }

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

    // Log the source prominently so run.log can be filtered by originating
    // UI surface (workspace-panel vs terminal-panel vs code-preview-panel).
    logger.info('File event emitted', {
      source,
      origin: classifyFileEventSource(source),
      path,
      type,
      sessionId,
      hasContent: content !== undefined,
      contentLength: content?.length,
    });

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


  }
}

/**
 * Classify a file-event source into a coarse origin bucket for log filtering.
 * Buckets: `ui` (workspace-panel, terminal-panel, code-preview-panel),
 * `mcp` (mcp-tool*), `desktop` (desktop-vfs*), `internal` (vfs-file-watcher, diff, file-events),
 * or `other` for unrecognised sources.
 */
function classifyFileEventSource(source: string | undefined): 'ui' | 'mcp' | 'desktop' | 'internal' | 'other' {
  if (!source) return 'other';
  if (
    source === FILE_EVENT_SOURCES.WORKSPACE_PANEL ||
    source === FILE_EVENT_SOURCES.TERMINAL_PANEL ||
    source === FILE_EVENT_SOURCES.CODE_PREVIEW_PANEL
  ) {
    return 'ui';
  }
  if (source.startsWith('mcp-tool')) return 'mcp';
  if (source.startsWith('desktop-vfs')) return 'desktop';
  if (
    source === FILE_EVENT_SOURCES.VFS_FILE_WATCHER ||
    source === FILE_EVENT_SOURCES.DIFF ||
    source === FILE_EVENT_SOURCES.FILE_EVENTS
  ) {
    return 'internal';
  }
  return 'other';
}

export default {
  emitFileEvent,
  emitBatchFileEvents,
  emitDiffEvent,
  emitEventFromToolResult,
};