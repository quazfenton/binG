import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { rateLimitMiddleware } from '@/lib/middleware/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, username } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Rate limiting: Check before processing (prevent spam registrations)
    // Rate limit by IP address, not email, to prevent bypass with different emails
    const rateLimitResult = rateLimitMiddleware(request, 'register');
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response;
    }

    // Get client info for session
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Register user
    const result = await authService.register(
      { email, password, username },
      { ipAddress, userAgent }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Check if email verification is required
    if (result.requiresVerification) {
      return NextResponse.json({
        success: true,
        requiresVerification: true,
        message: result.message || 'Registration successful! Please check your email to verify your account.',
        user: result.user
      });
    }

    // Set session cookie (for backward compatibility or if verification not required)
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
    console.error('Registration API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}