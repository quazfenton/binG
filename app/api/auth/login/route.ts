import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { rateLimitMiddleware } from '@/lib/middleware/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Normalize email for rate limiting (prevent bypass via whitespace/casing)
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : undefined;

    // Rate limiting: Check before processing (strict limits to prevent brute-force)
    const rateLimitResult = rateLimitMiddleware(request, 'login', normalizedEmail);
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response;
    }

    // Get client info for session
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Login user
    const result = await authService.login(
      { email, password },
      { ipAddress, userAgent }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 401 }
      );
    }

    // Check if email is verified (optional - can be disabled via env var)
    const requireEmailVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
    if (requireEmailVerification && result.user && !result.user.emailVerified) {
      // Delete the session since we're not allowing login
      if (result.sessionId) {
        await authService.logout(result.sessionId);
      }
      
      return NextResponse.json(
        { 
          success: false, 
          error: 'Please verify your email before logging in. Check your inbox for the verification link.',
          requiresVerification: true
        },
        { status: 403 }
      );
    }

    // Set session cookie
    const response = NextResponse.json({
      success: true,
      user: result.user,
      token: result.token
    });

    if (result.sessionId) {
      response.cookies.set('session_id', result.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      });
    }

    return response;

  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}