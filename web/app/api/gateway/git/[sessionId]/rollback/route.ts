import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getDatabase } from '@/lib/database/connection';
import { resolveFilesystemOwnerWithFallback } from '@/app/api/filesystem/utils';
import { withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { getGitBackedVFSForOwner } from '@/lib/virtual-filesystem/git-backed-vfs';
import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:GitRollback');

/**
 * POST /api/gateway/git/[sessionId]/rollback
 * Rollback VFS to a specific version
 *
 * Body:
 * - version: The version number to rollback to (required)
 * - mode: 'shadow' | 'vfs-snapshot' | 'git' (optional, default: 'shadow')
 * - files: string[] (optional) - Specific files to rollback. If not provided, rolls back all files.
 *
 * Modes:
 * - shadow: Rollback using shadow commit system (recommended, has full history)
 * - vfs-snapshot: Rollback using VFS snapshot table
 * - git: Rollback using git commit history
 *
 * Examples:
 * - Full rollback: { "version": 5 }
 * - Partial rollback: { "version": 5, "files": ["src/app.ts", "src/utils.ts"] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    // Step 1: Resolve auth with fallback (allows anonymous users)
    const authResolution = await resolveFilesystemOwnerWithFallback(request, {
      route: 'rollback',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    const body = await request.json().catch(() => null);
    if (!body) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    const { version, mode = 'shadow', files } = body;

    if (!Number.isInteger(version) || version < 0) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Invalid version number (must be non-negative integer)' },
        { status: 400 }
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    // Validate files array if provided
    let targetFiles: string[] | undefined;
    if (files !== undefined) {
      if (!Array.isArray(files)) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'files must be an array of file paths' },
          { status: 400 }
        );
        return withAnonSessionCookie(errorResponse, authResolution);
      }
      if (files.length === 0) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'files array cannot be empty' },
          { status: 400 }
        );
        return withAnonSessionCookie(errorResponse, authResolution);
      }
      // Validate each file path
      targetFiles = files.filter(f => typeof f === 'string' && f.length > 0);
      if (targetFiles.length === 0) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'files array must contain valid file paths' },
          { status: 400 }
        );
        return withAnonSessionCookie(errorResponse, authResolution);
      }
    }

    // Extract conversation ID from the URL sessionId
    // Shadow commits store session_id as the raw conversation ID (e.g., "001"),
    // and owner_id as the full owner string (e.g., "anon:abc").
    // The sessionId from the URL may be:
    // - "001" (raw conversation ID) → use as-is
    // - "session-xxx" (generated client ID) → strip prefix
    // - "ownerId$001" or "ownerId:001" (scoped format) → extract conversation ID part
    // SECURITY: Use indexOf (FIRST $) not split().pop(), because:
    // - userId is system-controlled and NEVER contains $
    // - sessionId MAY contain user-provided $ (e.g., folder named "my$project")
    let conversationId = sessionId;
    if (conversationId.includes('$')) {
      const dollarIndex = conversationId.indexOf('$');
      conversationId = conversationId.slice(dollarIndex + 1);
    } else if (conversationId.includes(':')) {
      // Legacy format fallback
      const colonIndex = conversationId.indexOf(':');
      conversationId = conversationId.slice(colonIndex + 1);
    } else if (conversationId.startsWith('session-')) {
      conversationId = conversationId.replace(/^session-/, '');
    }

    // For shadow commit operations, use the resolved owner and conversation ID.
    // Shadow commits store session_id as the raw conversation ID (e.g., "001"),
    // NOT the scoped "ownerId:001" format.
    const fullOwnerId = typeof ownerId === 'string' ? ownerId : `user:${ownerId}`;

    // Step 3: Execute rollback based on mode
    let rollbackResult: {
      success: boolean;
      filesRestored: number;
      error?: string;
      details?: any;
    };

    switch (mode) {
      case 'shadow':
        // Shadow commits store session_id as the raw conversation ID (e.g., "001")
        // Pass conversationId, not scopedSessionId
        rollbackResult = await executeShadowRollback(conversationId, fullOwnerId, version, targetFiles) as any;
        break;

      case 'vfs-snapshot': {
        const db = getDatabase();
        rollbackResult = await executeVFSSnapshotRollback(db, conversationId, version, fullOwnerId, targetFiles);
        break;
      }

      case 'git':
        rollbackResult = await executeGitRollback(conversationId, version, fullOwnerId, targetFiles);
        break;

      default: {
        const errorResponse = NextResponse.json(
          { success: false, error: `Invalid rollback mode: ${mode}. Use 'shadow', 'vfs-snapshot', or 'git'` },
          { status: 400 }
        );
        return withAnonSessionCookie(errorResponse, authResolution);
      }
    }

    if (!rollbackResult.success) {
      logger.error('[Git Rollback] Rollback failed', {
        sessionId,
        version,
        mode,
        error: rollbackResult.error,
      });
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: rollbackResult.error || 'Rollback failed',
          details: rollbackResult.details,
        },
        { status: 400 }
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    logger.info('[Git Rollback] Rollback successful', {
      sessionId,
      version,
      mode,
      filesRestored: rollbackResult.filesRestored,
    });

    const response = NextResponse.json({
      success: true,
      message: `Successfully rolled back to version ${version}`,
      filesRestored: rollbackResult.filesRestored,
      mode,
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error) {
    logger.error('[Git Rollback] Unexpected error:', error);
    const errorResponse = NextResponse.json(
      { success: false, error: 'Failed to rollback', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}

/**
 * Execute rollback using shadow commit system
 *
 * Shadow commits track all file changes with full history and diffs.
 * This is the recommended rollback mode.
 *
 * DESKTOP MODE: Shadow commits are metadata-only (no file content).
 * Falls back to VFS diffTracker-based rollback which tracks content in-memory.
 *
 * @param sessionId - Session ID (scoped as ownerId:sessionId)
 * @param ownerId - Owner ID for VFS operations
 * @param version - Version to rollback to
 * @param targetFiles - Optional array of specific files to rollback (partial rollback)
 */
async function executeShadowRollback(sessionId: string, ownerId: string, version: number, targetFiles?: string[]) {
  try {
    const shadowCommitManager = new ShadowCommitManager();

    // Get commit history to find the target version
    const history = await shadowCommitManager.getCommitHistory(sessionId, 100);

    // Find commit at target version
    const targetCommit = history.find(c => c.workspaceVersion === version);

    if (!targetCommit) {
      return {
        success: false,
        filesRestored: 0,
        error: `Version ${version} not found in shadow commit history. Available versions: ${history.map(h => h.workspaceVersion).join(', ')}`,
      };
    }

    // DESKTOP MODE: Shadow commits are metadata-only (no content in transactions).
    // Fall back to VFS diffTracker-based rollback which tracks content in-memory.
    const isDesktopMode = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
    if (isDesktopMode) {
      logger.info('[Git Rollback] Desktop mode detected, using VFS diffTracker rollback', {
        sessionId,
        version,
      });
      const result = await virtualFilesystem.rollbackToVersion(ownerId, version);
      return {
        success: result.success,
        filesRestored: result.restoredFiles + result.deletedFiles,
        error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
        details: {
          commitId: targetCommit.commitId,
          commitMessage: targetCommit.message,
          commitDate: targetCommit.createdAt,
          restoredFiles: result.restoredFiles,
          deletedFiles: result.deletedFiles,
        },
      };
    }

    // Web mode: Parse commit transactions to get file contents
    let filesToRestore: Record<string, string> = {};
    
    // Use getCommit to reliably extract transactions from the full commit record
    const commit = await shadowCommitManager.getCommit(sessionId, targetCommit.commitId);
    const allTransactions = commit?.transactions ?? [];

    // If targetFiles specified, filter to only those files (partial rollback)
    if (targetFiles && targetFiles.length > 0) {
      // Filter transactions to only include target files
      const filteredTransactions = allTransactions.filter(tx => 
        targetFiles.includes(tx.path)
      );

      if (filteredTransactions.length === 0) {
        return {
          success: false,
          filesRestored: 0,
          error: `None of the specified files were found in version ${version}. Files in version: ${allTransactions.map(t => t.path).join(', ')}`,
        };
      }

      // Build VFS state with only filtered files
      for (const tx of filteredTransactions) {
        if (tx.type !== 'DELETE' && tx.newContent) {
          filesToRestore[tx.path] = tx.newContent;
        }
      }

      // Restore filtered files directly
      const vfs = virtualFilesystem;
      let restoredCount = 0;

      for (const [filePath, content] of Object.entries(filesToRestore)) {
        try {
          await vfs.writeFile(ownerId, filePath, content);
          restoredCount++;
        } catch (error: any) {
          return {
            success: false,
            filesRestored: restoredCount,
            error: `Failed to restore ${filePath}: ${error.message}`,
          };
        }
      }

      return {
        success: true,
        filesRestored: restoredCount,
        details: {
          commitId: targetCommit.commitId,
          commitMessage: targetCommit.message,
          commitDate: targetCommit.createdAt,
          partialRollback: true,
          requestedFiles: targetFiles,
          restoredFiles: Object.keys(filesToRestore),
        },
      };
    }

    // Full rollback - use standard rollback method
    const result = await shadowCommitManager.rollback(sessionId, targetCommit.commitId);

    return {
      success: result.success,
      filesRestored: result.restoredFiles || 0,
      error: result.error,
      details: {
        commitId: targetCommit.commitId,
        commitMessage: targetCommit.message,
        commitDate: targetCommit.createdAt,
        partialRollback: false,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      filesRestored: 0,
      error: `Shadow rollback failed: ${error.message}`,
    };
  }
}

/**
 * Execute rollback using VFS snapshot table
 *
 * Reads snapshot from database and restores VFS state.
 * 
 * @param db - Database instance
 * @param sessionId - Session ID
 * @param version - Version to rollback to
 * @param userId - User ID for ownership verification
 * @param targetFiles - Optional array of specific files to rollback (partial rollback)
 */
async function executeVFSSnapshotRollback(
  db: any,
  sessionId: string,
  version: number,
  userId: string,
  targetFiles?: string[]
) {
  try {
    // Get the snapshot for the target version
    const snapshot = db.prepare(`
      SELECT * FROM vfs_snapshots
      WHERE session_id = ? AND id = ?
    `).get(sessionId, version) as any;

    if (!snapshot) {
      return {
        success: false,
        filesRestored: 0,
        error: `Snapshot version ${version} not found for session ${sessionId}`,
      };
    }

    // Parse snapshot data (stored as JSON)
    const vfsState: Record<string, string> = typeof snapshot.vfs_state === 'string'
      ? JSON.parse(snapshot.vfs_state)
      : snapshot.vfs_state;

    if (!vfsState || Object.keys(vfsState).length === 0) {
      return {
        success: false,
        filesRestored: 0,
        error: 'Snapshot contains no files',
      };
    }

    // If targetFiles specified, filter to only those files (partial rollback)
    let filesToRestore = vfsState;
    if (targetFiles && targetFiles.length > 0) {
      filesToRestore = {};
      const notFound: string[] = [];

      for (const filePath of targetFiles) {
        if (filePath in vfsState) {
          filesToRestore[filePath] = vfsState[filePath];
        } else {
          notFound.push(filePath);
        }
      }

      if (Object.keys(filesToRestore).length === 0) {
        return {
          success: false,
          filesRestored: 0,
          error: `None of the specified files were found in version ${version}. Available files: ${Object.keys(vfsState).join(', ')}`,
          details: { notFound },
        };
      }

      if (notFound.length > 0) {
        logger.warn('[VFS Snapshot Rollback] Some files not found in snapshot', {
          notFound,
          version,
        });
      }
    }

    // Restore VFS state
    const vfs = virtualFilesystem;
    const ownerId = userId;
    let restoredCount = 0;
    const errors: string[] = [];

    for (const [filePath, content] of Object.entries(filesToRestore)) {
      try {
        await vfs.writeFile(ownerId, filePath, content);
        restoredCount++;
      } catch (error: any) {
        errors.push(`Failed to restore ${filePath}: ${error.message}`);
      }
    }

     // Update current version reference (session_id is stored as hash)
     const crypto = require('crypto');
     const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
     db.prepare(`
       UPDATE user_sessions
       SET current_version = ?
       WHERE session_id = ? AND user_id = ?
     `).run(version, sessionHash, userId);

    return {
      success: errors.length === 0,
      filesRestored: restoredCount,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      details: {
        totalFiles: Object.keys(filesToRestore).length,
        restoredCount,
        failedCount: errors.length,
        partialRollback: targetFiles !== undefined,
        requestedFiles: targetFiles,
        restoredFiles: Object.keys(filesToRestore),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      filesRestored: 0,
      error: `VFS snapshot rollback failed: ${error.message}`,
    };
  }
}

/**
 * Execute rollback using git commit history
 *
 * Uses git-backed VFS to restore from git commit.
 * 
 * @param sessionId - Session ID
 * @param version - Version to rollback to
 * @param userId - User ID for ownership verification
 * @param targetFiles - Optional array of specific files to rollback (partial rollback)
 */
async function executeGitRollback(
  sessionId: string,
  version: number,
  userId: string,
  targetFiles?: string[]
) {
  try {
    // Get GitBackedVFS instance
    const gitBackedVFS = getGitBackedVFSForOwner(userId, virtualFilesystem.underlying, {
      sessionId,
      autoCommit: false,
    });

    // Execute rollback (GitBackedVFS.rollback already supports partial rollback via internal filtering)
    const result = await gitBackedVFS.rollback(userId, version, targetFiles);

    return {
      success: result.success,
      filesRestored: result.filesRestored,
      error: result.error,
      details: {
        version: result.version,
        partialRollback: targetFiles !== undefined,
        requestedFiles: targetFiles,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      filesRestored: 0,
      error: `Git rollback failed: ${error.message}`,
    };
  }
}