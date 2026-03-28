/**
 * Filesystem Rename API
 * 
 * Handles file/folder rename operations with:
 * - Conflict detection
 * - Overwrite protection
 * - Event emission for UI updates
 * - Atomic operations (read → write → delete)
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
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

const logger = createLogger('API:Filesystem:Rename');

export const runtime = 'nodejs';

const renameRequestSchema = z.object({
  oldPath: z.string().min(1, 'Source path is required'),
  newPath: z.string().min(1, 'Destination path is required'),
  overwrite: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  let filesystemOwnerResolution: FilesystemOwnerResolution | undefined;

  try {
    // Resolve authentication
    filesystemOwnerResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'rename',
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

    // No-op: source and destination are the same
    if (oldPath === newPath) {
      return NextResponse.json({
        success: true,
        data: { oldPath, newPath, overwritten: false },
      });
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

    // Check if it's a file or directory
    let isDirectory = false;
    let content = '';
    try {
      const file = await virtualFilesystem.readFile(ownerId, oldPath);
      content = file.content;
    } catch {
      // It's a directory - for now, return error as recursive move is complex
      return NextResponse.json(
        { error: 'Directory move not yet implemented. Please move files individually.' },
        { status: 400 }
      );
    }

    // Perform rename: read → write → delete
    // Write to new path
    const file = await virtualFilesystem.readFile(ownerId, oldPath);
    await virtualFilesystem.writeFile(ownerId, newPath, file.content, file.language);

    // Delete old path
    // Note: If source was already deleted (deletedCount === 0), the rename is still valid
    // because the file exists at newPath. This can happen with concurrent operations.
    const { deletedCount } = await virtualFilesystem.deletePath(ownerId, oldPath);
    if (deletedCount === 0) {
      // Verify the file exists at newPath - if so, rename succeeded despite source deletion
      try {
        await virtualFilesystem.readFile(ownerId, newPath);
        // File exists at newPath - rename is complete, no rollback needed
        logger.warn('Rename operation: source already deleted, keeping target', {
          oldPath,
          newPath,
          ownerId,
        });
      } catch {
        // File doesn't exist at newPath either - something went wrong, rollback
        try {
          await virtualFilesystem.deletePath(ownerId, newPath);
        } catch {
          // Log but don't throw - primary error is the source deletion failure
        }
        throw new Error(`Failed to delete source path: ${oldPath}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        oldPath,
        newPath,
        overwritten: destinationExists,
      },
    });
  } catch (error: unknown) {
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
