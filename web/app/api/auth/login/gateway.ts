import { NextRequest, NextResponse } from 'next/server';


import { authService } from '@/lib/auth/auth-service';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';
import { generateMfaToken } from '@/lib/auth/jwt';
import { transferVFSOnLogin } from '@/lib/auth/transfer-anon-vfs';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Auth:Login');

// Bound the fail-closed MFA session cleanup at 1s so a hanging DB can't
// stall the 503 response. The logout promise is kept alive in the
// background if it hasn't resolved by then (an orphaned session row is
// acceptable cleanup debt compared to a 30s+ request hang on a degraded
// DB). Tunable here so ops can adjust without grepping the catch block.
const MFA_FAIL_CLOSED_LOGOUT_TIMEOUT_MS = 1000;

export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }
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
      const rateLimitResult = checkUserRateLimit(normalizedEmail, 'login');
      if (!rateLimitResult.allowed) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitResult.headers });
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
        logger.warn('Audit log failed:', auditError);
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
        const { getDatabase } = require('@/lib/database/connection-shim');
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
      // MFA check failed — fail-closed to preserve security guarantees.
      // Fail-open would let a DB/query outage bypass MFA enforcement, which
      // is unacceptable for a security control. Invalidate the session we
      // just created and return a retryable 503 so the client can retry.
      logger.error('MFA check failed, login blocked (fail-closed):', mfaError);
      if (result.sessionId) {
        // Bound the cleanup with the module-scope timeout so a hanging DB
        // can't stall the 503 response. The logout promise is kept alive
        // in the background if it hasn't resolved by then. The inner
        // .catch collapses any rejection (DB error, etc.) so the race
        // always settles within the timeout.
        // Log a short hash of the sessionId (not the raw value) to avoid
        // leaking session tokens in operator logs — same pattern as
        // /api/auth/mfa/challenge/gateway.ts which hashes the MFA token.
        // The hash is computed INSIDE the .catch so the happy path (logout
        // resolves cleanly) skips the work entirely.
        const logoutPromise = authService
          .logout(result.sessionId)
          .catch((err) => {
            const sessionIdHash = require('crypto')
              .createHash('sha256')
              .update(result.sessionId)
              .digest('hex')
              .substring(0, 16);
            logger.warn('MFA-fail-closed: session cleanup failed (non-fatal)', {
              sessionIdHash,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        const timeoutPromise = new Promise<void>((resolve) =>
          setTimeout(resolve, MFA_FAIL_CLOSED_LOGOUT_TIMEOUT_MS)
        );
        await Promise.race([logoutPromise, timeoutPromise]);
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Login temporarily unavailable. Please try again in a moment.',
          retryable: true,
        },
        { status: 503, headers: { 'Retry-After': '5' } }
      );
    }
  }

  // Transfer anonymous VFS workspace to the newly authenticated user.
  // Fire-and-forget so the login response is not blocked by a slow
  // transfer — the helper itself is non-fatal (failures are logged
  // inside) and reads only `request.cookies`, which is a synchronous
  // accessor on the Web Request and remains valid after the response
  // is sent. The function is idempotent: if it runs concurrently with
  // the client-side `auth-context.tsx` post-login fetch to
  // /api/auth/transfer-vfs-on-login, the second call is a no-op.
  //
  // Parity with /api/auth/transfer-vfs-on-login (the client-side
  // endpoint): we log the transferred count when >0 so ops can see
  // when the in-line path actually moves data. Logging on 0 is
  // intentionally suppressed — the vast majority of logins are
  // returning users with no anon data, and a log line per login
  // would drown out the signal.
  //
  // For MFA-enabled users, the mfaRequired branch above returns
  // early before reaching this point. The MFA challenge endpoint
  // calls this same function after TOTP verification.
  const loginUserId = result.user?.id !== undefined ? String(result.user.id) : undefined;
  void transferVFSOnLogin(request, result.user)
    .then((transferResult) => {
      if (transferResult.transferredFiles > 0) {
        logger.info('VFS ownership transferred on login', {
          userId: loginUserId,
          transferredFiles: transferResult.transferredFiles,
          source: 'login-gateway-inline',
        });
      }
    })
    .catch((error) => {
      logger.warn('VFS transfer on login failed', {
        userId: loginUserId,
        error: error instanceof Error ? error.message : String(error),
        source: 'login-gateway-inline',
      });
    });

  // MED-5 fix: Log successful login
    try {
      const { logLoginSuccess } = await import('@/lib/auth/auth-audit-logger');
      await logLoginSuccess(String(result.user?.id), email, request, { mfaEnabled });
    } catch (auditError) {
      logger.warn('Audit log failed:', auditError);
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
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
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
    logger.error('Login API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
