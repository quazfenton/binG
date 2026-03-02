import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

/**
 * Schema for filesystem search requests
 * Validates query and path parameters
 */
const searchRequestSchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200, 'Query too long'),
  path: z.string()
    .min(1)
    .max(500)
    .refine(
      (path) => !path.includes('..') && !path.includes('\0'),
      'Path contains invalid characters'
    )
    .optional()
    .default('project'),
  limit: z.number().int().positive().max(200).optional(),
  ownerId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('q') || '';
    const path = url.searchParams.get('path') || 'project';
    const ownerIdFromQuery = url.searchParams.get('ownerId');
    const limitRaw = Number.parseInt(url.searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;

    if (!query.trim()) {
      return NextResponse.json({
        success: true,
        data: {
          query: '',
          results: [],
        },
      });
    }
    
    // Validate parameters
    const validation = searchRequestSchema.safeParse({
      q: query,
      path,
      limit,
      ownerId: ownerIdFromQuery
    });
    if (!validation.success) {
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
          error: 'Unauthorized: cannot search filesystems for other users',
        },
        { status: 403 },
      );
    }

    const results = await virtualFilesystem.search(ownerId, query, { path, limit });
    return NextResponse.json({
      success: true,
      data: {
        query,
        path,
        results,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
