/**
 * Phase 9: Sandbox File Sync Bridge
 *
 * Automatically propagates VFS file changes (from MCP tools like write_file,
 * apply_diff, delete_file) to attached sandbox providers so that code executed
 * in the sandbox sees the latest file state immediately.
 *
 * This closes the Phase 9 gap: "No file change events propagated to sandbox
 * providers." Previously, VFS changes were only synced to sandboxes on explicit
 * full-sync operations (migration, snapshot restore, or manual trigger). Now,
 * every file create/update/delete in the VFS automatically syncs to the sandbox.
 *
 * Architecture:
 *   ┌──────────────┐     emitFileEvent      ┌────────────────────┐
 *   │ vfs-mcp-tools │ ──────────────────────→│   file-events.ts   │
 *   │ write_file    │                        │ (UI + session      │
 *   │ apply_diff    │                        │  tracking)         │
 *   │ delete_file   │                        └────────────────────┘
 *   └──────────────┘                                 │
 *        │                                           │
 *        │  syncFileChangeToSandbox()                │
 *        └───────────────────────────┐               │
 *                                    ▼               ▼
 *                          ┌────────────────────────────────┐
 *                          │  sandbox-file-sync-bridge.ts   │
 *                          │  - Look up sandboxId from      │
 *                          │    sessionManager              │
 *                          │  - Determine workspace dir     │
 *                          │  - writeFile / deleteFile      │
 *                          │    in sandbox                  │
 *                          └────────────────────────────────┘
 *
 * Integration points:
 *   - vfs-mcp-tools.ts: called after write_file, apply_diff, delete_file
 *   - file-events.ts: emitFileEvent already fires before sync
 *
 * @see lib/sandbox/sandbox-service-bridge.ts — Sandbox writeFile/executeCommand
 * @see lib/session/session-manager.ts — Session lookup for sandboxId
 * @see lib/virtual-filesystem/file-events.ts — File event emission
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SandboxFileSyncBridge');

// ============================================================================
// Configuration
// ============================================================================

/** Maximum file size (in bytes) to auto-sync to sandbox. Larger files are skipped. */
const MAX_SYNC_FILE_SIZE = parseInt(
  process.env.SANDBOX_FILE_SYNC_MAX_SIZE || String(5 * 1024 * 1024),
  10,
); // 5MB default

/** Whether the sync bridge is enabled. */
const ENABLED = process.env.SANDBOX_FILE_SYNC_ENABLED !== 'false';

// ============================================================================
// Types
// ============================================================================

export type FileSyncOperation = 'create' | 'update' | 'delete';

export interface FileSyncEvent {
  userId: string;
  /** VFS-relative file path (e.g., "src/app.ts") */
  filePath: string;
  /** Operation type */
  operation: FileSyncOperation;
  /** New file content (for create/update) */
  content?: string;
}

export interface FileSyncResult {
  synced: boolean;
  sandboxId?: string;
  reason?: string;
}

// ============================================================================
// Workspace Directory Mapping
// ============================================================================

/**
 * Get the workspace directory for a sandbox, matching the convention
 * used by workspacefs-sync-service.ts and sandbox-filesystem-sync.ts.
 *
 * Covers all provider prefixes from sandbox-service-bridge.ts
 * inferProviderFromSandboxId().
 */
function getWorkspaceDirForSandbox(sandboxId: string): string {
  // Provider-specific workspace directories
  if (sandboxId.startsWith('e2b-')) return '/home/user';
  if (sandboxId.startsWith('daytona-')) return '/home/daytona/workspace';
  if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-'))
    return '/home/sprite/workspace';

  // Default /workspace for all others (covers: csb, modal, firecracker, local,
  // desktop, webcontainer, opensandbox, microsandbox, vercel, blaxel, runloop,
  // mistral-agent, agentfs, terminaluse, codespace, and any future providers)
  return '/workspace';
}

// ============================================================================
// Sandbox File Sync Bridge
// ============================================================================

export class SandboxFileSyncBridge {
  /**
   * Propagate a VFS file change to the user's attached sandbox.
   *
   * Best-effort, fire-and-forget — failures are logged but never throw.
   * This ensures file operations complete successfully even if the sandbox
   * is unavailable or disconnected.
   *
   * @param event - The file sync event from the VFS operation
   * @returns Result indicating whether the sync completed and why
   */
  async syncFileChange(event: FileSyncEvent): Promise<FileSyncResult> {
    if (!ENABLED) {
      return { synced: false, reason: 'sync bridge disabled' };
    }

    const { userId, filePath, operation, content } = event;

    try {
      // Step 1: Look up the sandboxId from the session manager
      const { sessionManager } = await import('@/lib/session/session-manager');
      const sessions = sessionManager.getUserSessions(userId);

      // Find the first session with an active sandbox
      const activeSession = sessions.find(
        (s) => s.sandboxId && s.status !== 'stopped' && s.status !== 'stopping',
      );

      if (!activeSession?.sandboxId) {
        logger.debug('No active sandbox for user, skipping file sync', {
          userId: userId.slice(0, 12),
          filePath,
          operation,
          sessionCount: sessions.length,
        });
        return { synced: false, reason: 'no active sandbox' };
      }

      const sandboxId = activeSession.sandboxId;

      // Step 2: Build the sandbox file path
      const workspaceDir = getWorkspaceDirForSandbox(sandboxId);
      const sandboxPath = `${workspaceDir}/${filePath}`;

      // Step 3: Perform the sync operation
      const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');

      switch (operation) {
        case 'create':
        case 'update': {
          if (content === undefined || content === null) {
            return { synced: false, reason: 'no content for create/update', sandboxId };
          }

          // Skip large files to avoid saturating sandbox bandwidth
          const byteLength = Buffer.byteLength(content, 'utf-8');
          if (byteLength > MAX_SYNC_FILE_SIZE) {
            logger.debug('File exceeds size threshold, skipping sync', {
              sandboxId: sandboxId.slice(0, 12),
              filePath,
              size: byteLength,
              max: MAX_SYNC_FILE_SIZE,
            });
            return {
              synced: false,
              sandboxId,
              reason: `file size ${byteLength} exceeds max ${MAX_SYNC_FILE_SIZE}`,
            };
          }

          // Ensure parent directory exists in sandbox
          try {
            const parentDir = sandboxPath.substring(0, sandboxPath.lastIndexOf('/'));
            if (parentDir) {
              await sandboxBridge.executeCommand(
                sandboxId,
                `mkdir -p "${parentDir.replace(/"/g, '\\"')}"`,
                workspaceDir,
              );
            }
          } catch {
            // Directory may already exist — non-fatal
          }

          await sandboxBridge.writeFile(sandboxId, sandboxPath, content);
          logger.debug('File synced to sandbox', {
            sandboxId: sandboxId.slice(0, 12),
            filePath,
            operation,
            size: content.length,
          });
          return { synced: true, sandboxId };
        }

        case 'delete': {
          try {
            await sandboxBridge.executeCommand(
              sandboxId,
              `rm -f "${sandboxPath.replace(/"/g, '\\"')}"`,
              workspaceDir,
            );
            logger.debug('File deleted from sandbox', {
              sandboxId: sandboxId.slice(0, 12),
              filePath,
            });
          } catch (rmErr: any) {
            // File may not exist in sandbox — non-fatal
            logger.debug('Delete from sandbox had non-zero exit (file may not exist)', {
              sandboxId: sandboxId.slice(0, 12),
              filePath,
              error: rmErr.message,
            });
          }
          return { synced: true, sandboxId };
        }

        default:
          return { synced: false, reason: `unknown operation: ${operation}` };
      }
    } catch (error: any) {
      // Best-effort: don't fail the file operation if sync fails
      logger.warn('Sandbox file sync failed (non-blocking)', {
        userId: userId.slice(0, 12),
        filePath,
        operation,
        error: error.message,
      });
      return { synced: false, reason: error.message };
    }
  }

  /**
   * Check if the sync bridge is enabled and operational.
   */
  getStatus(): { enabled: boolean; maxFileSize: number } {
    return {
      enabled: ENABLED,
      maxFileSize: MAX_SYNC_FILE_SIZE,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const sandboxFileSyncBridge = new SandboxFileSyncBridge();

// ============================================================================
// Convenience function for vfs-mcp-tools.ts
// ============================================================================

/**
 * Sync a file change to the sandbox (fire-and-forget).
 *
 * Designed to be called from vfs-mcp-tools.ts after each file operation,
 * alongside the existing emitFileEvent calls. Intentionally NOT async/await
 * so callers don't need to await it — the bridge handles errors internally.
 *
 * @example
 * ```ts
 * // In write_file handler:
 * await emitFileEvent({ userId, sessionId, path, type: 'create', content, source: 'mcp-tool' });
 * syncFileChangeToSandbox(userId, path, 'create', content);
 * ```
 */
export function syncFileChangeToSandbox(
  userId: string,
  filePath: string,
  operation: FileSyncOperation,
  content?: string,
): void {
  // Fire-and-forget — let the bridge handle the result
  sandboxFileSyncBridge
    .syncFileChange({ userId, filePath, operation, content })
    .catch(() => {
      // Already logged inside syncFileChange
    });
}
