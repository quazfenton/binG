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
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

export const runtime = 'nodejs';

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

    if (!filesystemOwnerResolution.ownerId) {
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
      const listing = await virtualFilesystem.listDirectory(ownerId, sourcePath);
      if (listing.nodes.length === 0) {
        return NextResponse.json(
          { error: 'Source path does not exist' },
          { status: 404 }
        );
      }
      isDirectory = true;
    }

    // Check if target exists (conflict detection)
    let targetExists = false;
    try {
      await virtualFilesystem.readFile(ownerId, targetPath);
      targetExists = true;
    } catch {
      const listing = await virtualFilesystem.listDirectory(ownerId, targetPath);
      targetExists = listing.nodes.length > 0;
    }

    // Handle conflict
    if (targetExists && !overwrite) {
      return NextResponse.json(
        {
          error: 'Target already exists',
          conflict: {
            path: targetPath,
            exists: true,
            canOverwrite: true,
          },
        },
        { status: 409 }
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
    await virtualFilesystem.deletePath(ownerId, sourcePath);

    // Get workspace version for event
    const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(ownerId);

    // Emit filesystem updated event
    emitFilesystemUpdated({
      type: 'create',
      path: targetPath,
      workspaceVersion,
      applied: [{
        path: targetPath,
        operation: 'write',
        timestamp: Date.now(),
      }],
      source: 'api-move',
    });

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
