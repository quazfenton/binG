import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { verifyAuth, generateToken } from '@/lib/auth/jwt';

export async function POST(request: NextRequest) {
  try {
    // Try session-based refresh first
    const sessionId = request.cookies.get('session_id')?.value;
    
    if (sessionId) {
      const sessionResult = await authService.validateSession(sessionId);
      
      if (sessionResult.success) {
        // Session is valid, generate new token
        const newToken = generateToken({
          userId: sessionResult.user!.id.toString(),
          email: sessionResult.user!.email
        });

        return NextResponse.json({
          success: true,
          token: newToken,
          user: sessionResult.user
        });
      }
    }

    // Fallback to JWT-based refresh
    const authResult = await verifyAuth(request);
    
    if (!authResult.success) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Generate new token
    const newToken = generateToken({
      userId: authResult.userId!,
      email: authResult.email!
    });

    // Get user details
    const userId = parseInt(authResult.userId || '0');
    const user = await authService.getUserById(userId);

    return NextResponse.json({
      success: true,
      token: newToken,
      user: user
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}