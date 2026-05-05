import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { sessionIdSchema } from '@/lib/validation/schemas';

export const runtime = 'edge';

/**
 * GET /api/filesystem/commits?sessionId=...&limit=20
 * Returns commit history for a session (git-backed VFS)
 */

const commitsQuerySchema = z.object({
  sessionId: sessionIdSchema,
  limit: z.string()
    .optional()
    .default('20')
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val > 0 && val <= 100, {
      message: 'Limit must be between 1 and 100',
    }),
});

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams);
    
    // Validate query parameters with Zod
    const parseResult = commitsQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return NextResponse.json(
        { 
          success: false, 
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 },
      );
    }
    
    const { sessionId, limit } = parseResult.data;

    // Resolve auth upfront for cookie wrapping
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'commits',
      requestId: Math.random().toString(36).slice(2, 8),
    });
    const ownerId = authResolution.ownerId;

    // Session IDs are scoped to owner
    const scopedSessionId = `${ownerId}$${sessionId}`;

    const commitManager = new ShadowCommitManager();
    const history = await commitManager.getCommitHistory(scopedSessionId, limit);

    const response = NextResponse.json({
      success: true,
      data: {
        sessionId,
        commits: history,
      },
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    console.error('[VFS Commits] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get commit history';
    const errorResponse = NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
