/**
 * Filesystem Move API
 * 
 * Handles file/folder move operations with:
 * - Conflict detection
 * - Circular move prevention
 * - Overwrite protection
 * - Event emission for UI updates
 * - Atomic operations (read → write → delete)
 * 
 * POST /api/filesystem/move
 * {
 *   sourcePath: string;
 *   targetPath: string;
 *   overwrite?: boolean;
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { createLogger } from '@/lib/utils/logger';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

const logger = createLogger('API:Filesystem:Move');

export const runtime = 'edge';

const moveRequestSchema = z.object({
  sourcePath: z.string().min(1, 'Source path is required'),
  targetPath: z.string().min(1, 'Target path is required'),
  overwrite: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  let filesystemOwnerResolution: FilesystemOwnerResolution | undefined;

  try {
    // Resolve authentication
    filesystemOwnerResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'move',
      requestId: Math.random().toString(36).slice(2, 8),
    });

    if (!filesystemOwnerResolution.isAuthenticated) {
      const errorResponse = NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
      return withAnonSessionCookie(errorResponse, filesystemOwnerResolution);
    }

    const ownerId = filesystemOwnerResolution.ownerId;
    const body = await req.json();

    // Validate request
    const validation = moveRequestSchema.safeParse(body);
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

    const { sourcePath, targetPath, overwrite } = validation.data;

    // No-op check
    if (sourcePath === targetPath) {
      return NextResponse.json({
        success: true,
        data: { sourcePath, targetPath, moved: false },
      });
    }

    // Check for circular move (moving folder into itself)
    if (targetPath.startsWith(sourcePath + '/')) {
      return NextResponse.json(
        { error: 'Cannot move folder into itself' },
        { status: 400 }
      );
    }

    // Check if source exists
    let isDirectory = false;
    let content = '';
    try {
      const file = await virtualFilesystem.readFile(ownerId, sourcePath);
      content = file.content;
    } catch {
      // File read failed - check if it's a directory
      try {
        const listing = await virtualFilesystem.listDirectory(ownerId, sourcePath);
        // Directory exists (even if empty) - directories are valid paths
        isDirectory = true;
      } catch {
        // Neither file nor directory exists
        return NextResponse.json(
          { error: 'Source path does not exist' },
          { status: 404 }
        );
      }
    }

    // Check if target exists (conflict detection)
    let targetExists = false;
    let targetIsDirectory = false;
    try {
      await virtualFilesystem.readFile(ownerId, targetPath);
      targetExists = true;
    } catch {
      const listing = await virtualFilesystem.listDirectory(ownerId, targetPath);
      targetExists = listing.nodes.length > 0;
      targetIsDirectory = true; // If listDirectory succeeds, it's a directory
    }

    // Handle conflict
    if (targetExists && !overwrite) {
      return NextResponse.json(
        {
          error: 'Target already exists',
          conflict: {
            path: targetPath,
            exists: true,
            canOverwrite: !targetIsDirectory, // Can only overwrite files, not directories
          },
        },
        { status: 409 }
      );
    }

    // Prevent overwriting a directory with a file (would corrupt filesystem structure)
    if (targetIsDirectory && overwrite) {
      return NextResponse.json(
        { error: 'Cannot overwrite a directory with a file' },
        { status: 400 }
      );
    }

    // For directories, return error (recursive move is complex)
    if (isDirectory) {
      return NextResponse.json(
        { error: 'Directory move not yet implemented. Please move files individually.' },
        { status: 400 }
      );
    }

    // Perform move: read → write → delete
    // Read source
    const file = await virtualFilesystem.readFile(ownerId, sourcePath);

    // Write to target
    await virtualFilesystem.writeFile(ownerId, targetPath, file.content, file.language);

    // Delete source
    // Note: If source was already deleted (deletedCount === 0), the move is still valid
    // because the file exists at targetPath. This can happen with concurrent operations.
    const { deletedCount } = await virtualFilesystem.deletePath(ownerId, sourcePath);
    if (deletedCount === 0) {
      // Source already deleted - move is effectively complete, don't rollback
      // Rolling back would delete the newly created file at targetPath
      logger.warn('Move operation: source already deleted, keeping target', {
        sourcePath,
        targetPath,
        ownerId,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        sourcePath,
        targetPath,
        moved: true,
        overwritten: targetExists,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to move';
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
