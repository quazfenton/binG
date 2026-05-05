import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ClearSessionsAPI');

export const runtime = 'edge';

/**
 * POST /api/sandbox/clear-sessions
 *
 * Clear stale sandbox sessions to recover from creation failures.
 * This is useful when:
 * - Sandbox creation fails with "Unauthorized"
 * - Session exists in store but sandbox doesn't exist in provider
 * - Switching between sandbox providers after a failure
 *
 * SECURITY: Requires authentication and only clears the caller's own sessions.
 * Global stale session cleanup has been removed to prevent DoS attacks.
 */
export async function POST(req: NextRequest) {
  try {
    // SECURITY: Require authentication - no anonymous session clearing
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    logger.info('Clearing sandbox sessions', { userId });

    // SECURITY: Only clear sessions for the authenticated user
    sandboxBridge.clearUserSessions(userId);

    // REMOVED: Global stale session cleanup (was a DoS vector)
    // If stale session cleanup is needed, it should run server-side via cron/job,
    // not triggered by arbitrary API calls.

    logger.info('Sessions cleared successfully', { userId });

    return NextResponse.json({
      success: true,
      message: 'Sessions cleared successfully',
      userId,
    });
  } catch (error: any) {
    logger.error('Failed to clear sessions:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to clear sessions',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox/clear-sessions
 *
 * Returns session status info (doesn't clear anything)
 * SECURITY: Requires authentication.
 */
export async function GET(req: NextRequest) {
  try {
    // SECURITY: Require authentication
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = authResult.userId;

    const session = sandboxBridge.getSessionByUserId(userId);

    return NextResponse.json({
      success: true,
      hasActiveSession: !!session,
      session: session ? {
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
        status: session.status,
        createdAt: session.createdAt,
      } : null,
    });
  } catch (error: any) {
    logger.error('Failed to get session status:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get session status',
      },
      { status: 500 }
    );
  }
}
