import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem';
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { sessionIdSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

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

    const authResolution = await resolveFilesystemOwner(req);
    const ownerId = authResolution.ownerId;

    // Session IDs are scoped to owner
    const scopedSessionId = `${ownerId}:${sessionId}`;

    const commitManager = new ShadowCommitManager();
    const history = await commitManager.getCommitHistory(scopedSessionId, limit);

    return NextResponse.json({
      success: true,
      data: {
        sessionId,
        commits: history,
      },
    });
  } catch (error: unknown) {
    console.error('[VFS Commits] Error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get commit history';
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
