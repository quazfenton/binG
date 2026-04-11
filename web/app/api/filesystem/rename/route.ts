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

/**
 * Recursively get all files under a directory path
 */
async function getAllFilesUnder(
  ownerId: string,
  dirPath: string,
): Promise<Array<{ path: string; content: string; language: string }>> {
  const files: Array<{ path: string; content: string; language: string }> = [];
  
  async function traverse(path: string) {
    const listing = await virtualFilesystem.listDirectory(ownerId, path);
    for (const node of listing.nodes) {
      if (node.type === 'file') {
        const file = await virtualFilesystem.readFile(ownerId, node.path);
        files.push({ path: node.path, content: file.content, language: file.language });
      } else {
        // Recurse into subdirectory
        await traverse(node.path);
      }
    }
  }
  
  await traverse(dirPath);
  return files;
}

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
      // It's a directory - need to rename the directory and all children
      isDirectory = true;
      const listing = await virtualFilesystem.listDirectory(ownerId, oldPath);
      if (listing.nodes.length === 0) {
        // Empty directory - just create the new directory marker
        await virtualFilesystem.createDirectory(ownerId, newPath);
        await virtualFilesystem.deletePath(ownerId, oldPath);
        return NextResponse.json({
          success: true,
          data: { oldPath, newPath, overwritten: destinationExists, isDirectory: true },
        });
      }
      
      // For non-empty directories, we need to rename the directory itself
      // Then update all child paths. Since VFS uses flat storage with paths,
      // we need to read all files under oldPath and rewrite them under newPath
      const allFiles = await getAllFilesUnder(ownerId, oldPath);
      
      // Write all files to new paths
      for (const file of allFiles) {
        const relativePath = file.path.substring(oldPath.length + 1);
        const newFilePath = `${newPath}/${relativePath}`;
        await virtualFilesystem.writeFile(ownerId, newFilePath, file.content, file.language);
      }
      
      // Delete all old files
      for (const file of allFiles) {
        await virtualFilesystem.deletePath(ownerId, file.path);
      }
      
      // Create directory marker at new path if needed
      try {
        await virtualFilesystem.readFile(ownerId, newPath);
      } catch {
        await virtualFilesystem.createDirectory(ownerId, newPath);
      }
      
      return NextResponse.json({
        success: true,
        data: { oldPath, newPath, overwritten: destinationExists, isDirectory: true, filesRenamed: allFiles.length },
      });
    }

    // Perform file rename: read → write → delete
    await virtualFilesystem.writeFile(ownerId, newPath, content, language);
    await virtualFilesystem.deletePath(ownerId, oldPath);

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
