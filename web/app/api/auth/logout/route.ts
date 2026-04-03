import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { deleteSessionsByUserId } from '@/lib/storage/session-store';
import { revokeToken, extractTokenFromHeader } from '@/lib/security/jwt-auth';
import { authCache } from '@/lib/auth/request-auth';

export async function POST(request: NextRequest) {
  try {
    // Get session ID from cookie
    const sessionId = request.cookies.get('session_id')?.value;

    if (sessionId) {
      // Get the sandbox session before destroying it
      const sandboxSession = sandboxBridge.getSession(sessionId);
      
      // Destroy sandbox if it exists
      if (sandboxSession?.sandboxId) {
        try {
          await sandboxBridge.destroyWorkspace(sessionId, sandboxSession.sandboxId);
          console.log('[Logout] Sandbox destroyed:', sandboxSession.sandboxId);
        } catch (error) {
          console.error('[Logout] Failed to destroy sandbox:', error);
          // Continue with logout even if sandbox destruction fails
        }
      }
      
      // Delete ALL sessions for this user (cleanup any stale sessions)
      const authResult = await authService.validateSession(sessionId);
      if (authResult.user?.id) {
        deleteSessionsByUserId(String(authResult.user.id));
        console.log('[Logout] All sessions deleted for user:', authResult.user.id);
      }
      
      // Logout user (delete session)
      await authService.logout(sessionId);
    }

    // Revoke JWT token if present (adds to blacklist until natural expiry)
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);
    if (token) {
      try {
        await revokeToken(token);
        console.log('[Logout] JWT token revoked');
      } catch (error) {
        console.warn('[Logout] Failed to revoke JWT token:', error);
      }
    }

    // Invalidate auth cache for this user
    const authResult2 = await authService.validateSession(sessionId || '');
    if (authResult2.user?.id) {
      authCache.invalidateAllForUser(String(authResult2.user.id));
    }

    // Clear session cookie
    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    });

    response.cookies.set('session_id', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0 // Expire immediately
    });

    return response;

  } catch (error) {
    console.error('Logout API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}