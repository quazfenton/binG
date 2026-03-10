import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ClearSessionsAPI');

export const runtime = 'nodejs';

/**
 * POST /api/sandbox/clear-sessions
 * 
 * Clear stale sandbox sessions to recover from creation failures.
 * This is useful when:
 * - Sandbox creation fails with "Unauthorized"
 * - Session exists in store but sandbox doesn't exist in provider
 * - Switching between sandbox providers after a failure
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';
    
    logger.info('Clearing sandbox sessions', { userId });
    
    // Clear all sessions for this user
    sandboxBridge.clearUserSessions(userId);
    
    // Also run general stale session cleanup
    sandboxBridge.clearStaleSessions();
    
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
 */
export async function GET(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    const userId = authResult.userId || 'anonymous';
    
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
