import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { verifyAuth } from '@/lib/auth/jwt';

export async function POST(request: NextRequest) {
  try {
    // Try session-based validation first
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
    const userId = parseInt(authResult.userId || '0');
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