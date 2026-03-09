import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { verifyAuth } from '@/lib/auth/jwt';

export const runtime = 'nodejs';

/**
 * GET /api/auth/session
 * 
 * Returns the current user's session information.
 * Used by Tambo and other components to check authentication status.
 */
export async function GET(req: NextRequest) {
  try {
    // First try JWT auth from Authorization header
    const jwtAuth = await verifyAuth(req);
    if (jwtAuth.success && jwtAuth.userId) {
      return NextResponse.json({
        user: {
          id: jwtAuth.userId,
          email: null,
          name: null,
        },
      });
    }

    // Then try session cookie auth
    const sessionId = req.cookies.get('session_id')?.value;
    if (sessionId) {
      const sessionAuth = await authService.validateSession(sessionId);
      if (sessionAuth.success && sessionAuth.user) {
        return NextResponse.json({
          user: {
            id: sessionAuth.user.id?.toString() || sessionAuth.user.id,
            email: sessionAuth.user.email,
            name: sessionAuth.user.username || null,
          },
        });
      }
    }

    // No valid auth found
    return NextResponse.json({
      user: null,
    });
  } catch (error) {
    console.error('[Auth Session] Error:', error);
    return NextResponse.json({
      user: null,
      error: 'Failed to get session',
    }, { status: 500 });
  }
}
