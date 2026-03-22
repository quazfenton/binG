import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { verifyAuth } from '@/lib/auth/jwt';

// Force Node.js runtime for jsonwebtoken compatibility
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Try Auth0 session first (uses encrypted auth0_session cookie)
    try {
      const { auth0 } = await import('@/lib/auth0');
      const { getLocalUserIdFromAuth0 } = await import('@/lib/oauth/connections');
      const auth0Session = await auth0.getSession(request);
      if (auth0Session?.user) {
        const localUserId = await getLocalUserIdFromAuth0(auth0Session.user.sub);
        
        // Only require local user if there's actually a mapping - if no mapping exists,
        // fall through to try other auth methods (e.g., legacy session or JWT)
        if (localUserId) {
          const user = await authService.getUserById(localUserId);

          if (!user) {
            return NextResponse.json(
              { valid: false, error: 'User not found' },
              { status: 401 }
            );
          }

          return NextResponse.json({
            valid: true,
            user,
          });
        }
      }
    } catch (auth0Error) {
      // Auth0 not configured or session unavailable — fall through
      console.debug('[validate] Auth0 session check failed:', auth0Error);
    }

    // Try legacy session_id cookie
    const sessionId = request.cookies.get('session_id')?.value;
    
    if (sessionId) {
      const sessionResult = await authService.validateSession(sessionId);
      
      if (sessionResult.success) {
        return NextResponse.json({
          valid: true,
          user: sessionResult.user
        });
      }
    }

    // Fallback to JWT validation
    const authResult = await verifyAuth(request);
    
    if (!authResult.success) {
      return NextResponse.json(
        { valid: false, error: authResult.error },
        { status: 401 }
      );
    }

    // Get user details for JWT validation
    const userId = Number.parseInt(authResult.userId || '0');
    const user = await authService.getUserById(userId);

    if (!user) {
      return NextResponse.json(
        { valid: false, error: 'User not found' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      valid: true,
      user: user
    });

  } catch (error) {
    console.error('Validation API error:', error);
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Support GET method as well for convenience
  return POST(request);
}