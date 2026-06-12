/**
 * Filesystem Rename API
 * 
 * Handles file/folder rename operations with:
 * - Conflict detection
 * - Overwrite protection
 * - Event emission for UI updates
 * - File rename: read → write → delete
 * - Directory rename: NOT ATOMIC - rejected until transactional support exists
 * 
 * POST /api/filesystem/rename
 * {
 *   oldPath: string;
 *   newPath: string;
 *   overwrite?: boolean;
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { createLogger } from '@/lib/utils/logger';
import { wouldLoseSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { invalidateAllScopeCachesForRename } from '@/lib/virtual-filesystem/session-path-guard';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

const logger = createLogger('API:Filesystem:Rename');



const renameRequestSchema = z.object({
  oldPath: z.string().min(1, 'Source path is required'),
  newPath: z.string().min(1, 'Destination path is required'),
  overwrite: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  let filesystemOwnerResolution: FilesystemOwnerResolution | undefined;

  try {
    // Resolve authentication (anonymous sessions are allowed)
    filesystemOwnerResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'rename',
      requestId: Math.random().toString(36).slice(2, 8),
    });

    const ownerId = filesystemOwnerResolution.ownerId;
    const body = await req.json();

    // Validate request
    const validation = renameRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { oldPath, newPath, overwrite } = validation.data;

    logger.info('Rename request received:', { oldPath, newPath, overwrite, ownerId });

    // No-op: source and destination are the same
    if (oldPath === newPath) {
      logger.info('No-op: source and destination are the same');
      return NextResponse.json({
        success: true,
        data: { oldPath, newPath, overwritten: false },
      });
    }

    // ── Bug #26: session-id-loss guard ────────────────────────────────
    // Block any rename that would REPLACE the session-id segment under
    // workspace/sessions/ with a non-session-id value. The previous code
    // path (safeRename) already has this guard, but the gateway is a
    // separate implementation that was unprotected — a folder rename
    // here would orphan every subsequent tool call scoped to the session.
    const lostSessionId = wouldLoseSessionId(oldPath, newPath);
    if (lostSessionId) {
      logger.error(
        `[CRITICAL] Refusing rename: would lose session id segment "${lostSessionId}". ` +
        `Source: "${oldPath}" → Dest: "${newPath}". ` +
        `Session-scoped renames must preserve the workspace/sessions/<id> prefix.`,
        { oldPath, newPath, lostSessionId, ownerId },
      );
      invalidateAllScopeCachesForRename(ownerId, oldPath, newPath, undefined);
      return NextResponse.json(
        {
          error: `Refusing rename: would lose session id "${lostSessionId}". ` +
            `Renaming workspace/sessions/${lostSessionId} to a non-session-id path ` +
            `is not allowed because it orphans every tool call scoped to that session. ` +
            `Move the folder inside a session (e.g. workspace/sessions/${lostSessionId}/<name>) ` +
            `or pick a different destination that keeps the session id segment intact.`,
        },
        { status: 400 },
      );
    }

    // Check for circular move (moving folder into itself)
    if (newPath.startsWith(oldPath + '/')) {
      return NextResponse.json(
        { error: 'Cannot move folder into itself' },
        { status: 400 }
      );
    }

    // Check if source exists
    try {
      await virtualFilesystem.readFile(ownerId, oldPath);
    } catch {
      const listing = await virtualFilesystem.listDirectory(ownerId, oldPath);
      if (listing.nodes.length === 0) {
        return NextResponse.json(
          { error: 'Source path does not exist' },
          { status: 404 }
        );
      }
    }

    // Check if destination exists (conflict detection)
    let destinationExists = false;
    try {
      await virtualFilesystem.readFile(ownerId, newPath);
      destinationExists = true;
    } catch {
      const listing = await virtualFilesystem.listDirectory(ownerId, newPath);
      destinationExists = listing.nodes.length > 0;
    }

    // Handle conflict
    if (destinationExists && !overwrite) {
      return NextResponse.json(
        {
          error: 'Destination already exists',
          conflict: {
            path: newPath,
            exists: true,
            canOverwrite: true,
          },
        },
        { status: 409 }
      );
    }

    // Check if it's a file or directory and perform rename
    let isDirectory = false;
    let content = '';
    let language = '';
    
    try {
      // Try as file first
      const file = await virtualFilesystem.readFile(ownerId, oldPath);
      content = file.content;
      language = file.language;
    } catch {
      // Directory rename is not atomic - reject until transactional support exists
      return NextResponse.json(
        {
          error: 'Directory rename is not supported',
          details: 'Directory rename requires atomic operations which are not currently supported. Only file renames are allowed.',
        },
        { status: 501 }
      );
    }

    // Perform file rename: read → write → delete → verify
    await virtualFilesystem.writeFile(ownerId, newPath, content, language);
    await virtualFilesystem.deletePath(ownerId, oldPath);

    // Verify the old path was actually deleted to prevent duplicates
    try {
      await virtualFilesystem.readFile(ownerId, oldPath);
      // If we can still read the old file, the deletion failed - clean up
      await virtualFilesystem.deletePath(ownerId, newPath);
      return NextResponse.json(
        { error: 'Rename failed: could not delete source file' },
        { status: 500 }
      );
    } catch {
      // Expected - old path no longer exists
    }

    // Verify the new path exists
    try {
      await virtualFilesystem.readFile(ownerId, newPath);
    } catch {
      return NextResponse.json(
        { error: 'Rename failed: destination file not found after operation' },
        { status: 500 }
      );
    }

    // ── Bug #26: invalidate stale caches after a successful rename ─────
    // Drop every toolResultCache entry that could be pointing at the old
    // path (old + new + ancestors + search: prefix). Without this, the next
    // listDirectory or readFile call may serve a stale directory listing
    // that doesn't reflect the rename.
    invalidateAllScopeCachesForRename(ownerId, oldPath, newPath, undefined);

    logger.info('Rename operation completed:', { oldPath, newPath, isDirectory });

    return NextResponse.json({
      success: true,
      data: {
        oldPath,
        newPath,
        overwritten: destinationExists,
      },
    });
  } catch (error: unknown) {
    logger.error('Rename operation failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof Error ? error.message : 'Failed to rename';
    const errorResponse = NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
    return withAnonSessionCookie(errorResponse, filesystemOwnerResolution || {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
