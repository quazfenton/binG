/**
 * Filesystem Diffs API Route
 * 
 * Returns git-style diffs for client sync after agent execution
 * Format: { files: [{ path, diff, changeType }] }
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { z } from 'zod';
import { withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { diffTracker } from '@/lib/virtual-filesystem/index.server';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Filesystem:Diffs');

const diffsQuerySchema = z.object({
  maxFiles: z.coerce.number().min(1).max(100).default(50),
});

/**
 * GET /api/filesystem/diffs
 * Get git-style diffs for client sync
 */
export async function GET(request: NextRequest) {
  const requestId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    // Resolve owner from request
    const ownerResolution = await resolveFilesystemOwnerWithFallback(request, {
      route: '/api/filesystem/diffs',
      requestId,
    });

    const { searchParams } = new URL(request.url);
    const validation = diffsQuerySchema.safeParse({
      maxFiles: searchParams.get('maxFiles'),
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query params', details: validation.error.errors },
        { status: 400 }
      );
    }

    const maxFiles = validation.data.maxFiles;
    const ownerId = ownerResolution.ownerId;

    logger.info(`Getting diffs for owner ${ownerId}, maxFiles: ${maxFiles}`, { requestId });

    // Get structured diffs for sync
    const changedFiles = diffTracker.getChangedFilesForSync(ownerId, maxFiles);

    const response = NextResponse.json({
      success: true,
      ownerId,
      count: changedFiles.length,
      files: changedFiles,
    });
    return withAnonSessionCookie(response, ownerResolution);

  } catch (error: any) {
    logger.error('Failed to get diffs', error, { requestId });
    const errorResponse = NextResponse.json(
      { error: error.message || 'Failed to get diffs' },
      { status: 500 }
    );
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
