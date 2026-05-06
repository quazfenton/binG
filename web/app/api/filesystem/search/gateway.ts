import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { searchQuerySchema, pathSchema } from '@/lib/validation/schemas';



/**
 * Schema for filesystem search requests
 * Validates query and path parameters
 */
const searchRequestSchema = z.object({
  q: searchQuerySchema,
  path: pathSchema.optional().default('project'),
  limit: z.number().int().positive().refine((val) => val <= 200, 'Limit must be at most 200').optional(),
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
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'search',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    // If ownerId was explicitly provided in query, verify it matches authenticated user
    if (ownerIdFromQuery && ownerIdFromQuery !== ownerId) {
      const errorResponse = NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: cannot search filesystems for other users',
        },
        { status: 403 },
      );
      return withAnonSessionCookie(errorResponse, authResolution);
    }

    const results = await virtualFilesystem.search(ownerId, query, { path, limit });
    const response = NextResponse.json({
      success: true,
      data: {
        query,
        path,
        results,
      },
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Search failed';
    const errorResponse = NextResponse.json({ success: false, error: message }, { status: 400 });
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
