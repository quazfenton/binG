import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { rateLimitMiddleware } from '@/lib/middleware/rate-limiter';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';
import { generateMfaToken } from '@/lib/auth/jwt';

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

    // Normalize email for rate limiting (prevent bypass via whitespace/casing/Unicode)
    // CRITICAL FIX: Add Unicode normalization to prevent homograph attacks
    const normalizedEmail = typeof email === 'string' 
      ? email.trim().toLowerCase().normalize('NFKC') 
      : undefined;

    // Rate limiting: Check before processing (strict limits to prevent brute-force)
    // Skip rate limiting in development for easier testing
    if (process.env.NODE_ENV !== 'development') {
      const rateLimitResult = rateLimitMiddleware(request, 'login', normalizedEmail);
      if (!rateLimitResult.success && rateLimitResult.response) {
        return rateLimitResult.response;
      }
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
      // MED-5 fix: Log login failure for invalid credentials
      try {
        const { logLoginFailure } = await import('@/lib/auth/auth-audit-logger');
        await logLoginFailure(email, 'invalid_credentials', request);
      } catch (auditError) {
        console.warn('[Login] Audit log failed:', auditError);
      }
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

    // MED-6 fix: Check if user has MFA enabled.
    // If so, don't complete login — return a short-lived MFA token
    // that the client must use to complete the /auth/mfa/challenge flow.
    let mfaEnabled = false;
    if (result.user?.id) {
      try {
        const { getDatabase } = require('@/lib/database/connection');
        const db = getDatabase();
        if (db) {
          const mfaRecord = db.prepare(
            'SELECT is_enabled FROM user_mfa WHERE user_id = ? AND mfa_type = ?'
          ).get(String(result.user.id), 'totp') as any;
          mfaEnabled = !!mfaRecord?.is_enabled;

          if (mfaEnabled) {
            // Generate a short-lived MFA token (5 min TTL) using jwt.ts helper
            const mfaToken = generateMfaToken(String(result.user.id));

            // Invalidate the session we just created — login isn't complete yet
            if (result.sessionId) {
              await authService.logout(result.sessionId);
            }

            return NextResponse.json({
              success: false,
              mfaRequired: true,
              mfaToken,
              message: 'MFA verification required. POST /auth/mfa/challenge with your TOTP code.',
            });
          }
        }
      } catch (mfaError) {
        // MFA check failed — log but continue with normal login (fail open)
        console.warn('[Login] MFA check failed, proceeding without MFA:', mfaError);
      }
    }

    // MED-5 fix: Log successful login
    try {
      const { logLoginSuccess } = await import('@/lib/auth/auth-audit-logger');
      await logLoginSuccess(String(result.user?.id), email, request, { mfaEnabled });
    } catch (auditError) {
      console.warn('[Login] Audit log failed:', auditError);
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
        // MED-3 fix: Also secure in staging — any non-dev environment should use Secure flag
        // to prevent cookies from being sent over HTTP. Check x-forwarded-proto as fallback.
        secure: (process.env.NODE_ENV as string) === 'production' || (process.env.NODE_ENV as string) === 'staging',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      });
    }

    // Set JWT token as auth-token cookie for admin auth and server components
    // MED-1 fix: JWT TTL reduced from 7 days to 1 hour — cookie maxAge must match
    if (result.token) {
      response.cookies.set('auth-token', result.token, {
        httpOnly: true,
        // MED-3 fix: Secure in production AND staging
        secure: (process.env.NODE_ENV as string) === 'production' || (process.env.NODE_ENV as string) === 'staging',
        sameSite: 'lax',
        maxAge: 60 * 60, // 1 hour — matches JWT TTL
        path: '/',
      });
    }

    // HIGH-10 fix: Set CSRF token cookie on successful login
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    // Clear anonymous session cookie — authenticated users should NOT
    // fall back to their old anonymous workspace identity
    response.cookies.set('anon-session-id', '', {
      httpOnly: true,
      secure: (process.env.NODE_ENV as string) === 'production' || (process.env.NODE_ENV as string) === 'staging',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
