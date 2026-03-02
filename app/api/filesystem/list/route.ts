import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

/**
 * Schema for filesystem list requests
 * Validates directory path and prevents path traversal attacks
 */
const listRequestSchema = z.object({
  path: z.string()
    .min(1, 'Path is required')
    .max(500, 'Path too long (max 500 characters)')
    .refine(
      (path) => !path.includes('..') && !path.includes('\0'),
      'Path contains invalid characters'
    )
    .refine(
      (path) => !path.startsWith('/') || path.startsWith('/home/') || path.startsWith('/workspace/'),
      'Absolute paths must start with /home/ or /workspace/'
    ),
  ownerId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || 'project';
    const ownerIdFromQuery = url.searchParams.get('ownerId');

    // Validate path
    const validation = listRequestSchema.safeParse({ path, ownerId: ownerIdFromQuery });
    if (!validation.success) {
      console.error('[VFS API] Validation failed:', {
        path,
        ownerId: ownerIdFromQuery,
        errors: validation.error.errors,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    // SECURITY: Always derive ownerId from authenticated request context
    // Reject any attempt to override ownerId via query parameter
    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;

    // If ownerId was explicitly provided in query, verify it matches authenticated user
    if (ownerIdFromQuery && ownerIdFromQuery !== ownerId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: cannot list filesystems for other users',
        },
        { status: 403 },
      );
    }

    console.log('[VFS API] Listing directory:', { path, ownerId, source: 'auth' });

    const listing = await virtualFilesystem.listDirectory(ownerId, path);

    return NextResponse.json({
      success: true,
      data: {
        path: listing.path,
        nodes: listing.nodes,
      },
    });
  } catch (error: unknown) {
    console.error('[VFS API] List error:', error);
    const message = error instanceof Error ? error.message : 'Failed to list directory';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
