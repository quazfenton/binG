import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { generateToken } from '@/lib/auth/jwt';
import { RateLimiter } from '@/lib/security';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Auth:Refresh');

// HIGH-5 fix: Rate limit refresh endpoint — 10 requests per hour per user/IP
const refreshRateLimiter = new RateLimiter(10, 60 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    // HIGH-5 fix: Rate limit refresh requests
    const clientIP =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    if (!refreshRateLimiter.isAllowed(clientIP)) {
      const retryAfter = refreshRateLimiter.getRetryAfter(clientIP);
      logger.warn('Refresh rate limit exceeded', { ip: clientIP, retryAfter });
      return NextResponse.json(
        { error: 'Too many refresh requests', retryAfter },
        { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
      );
    }

    // Try session-based refresh first (primary path)
    const sessionId = request.cookies.get('session_id')?.value;

    if (sessionId) {
      const sessionResult = await authService.validateSession(sessionId);

      if (sessionResult.success && sessionResult.user) {
        // Session is valid, generate new token
        // HIGH-8 fix: email removed from JWT — use getUserEmail() from jwt.ts if needed
        // tokenVersion default to 1 (matching other callers)
        const newToken = generateToken({
          userId: sessionResult.user.id.toString(),
          tokenVersion: (sessionResult.user as any).token_version ?? 1,
        });

        // HIGH-5 fix: Per-user rate limit for authenticated refresh
        if (sessionResult.user.id) {
          const userKey = `user:${sessionResult.user.id}`;
          if (!refreshRateLimiter.isAllowed(userKey)) {
            logger.warn('Per-user refresh rate limit exceeded', { userId: sessionResult.user.id });
            return NextResponse.json(
              { error: 'Too many refresh requests' },
              { status: 429 }
            );
          }
        }

        // MED-5 fix: Log token refresh
        try {
          const { logTokenRefresh } = await import('@/lib/auth/auth-audit-logger');
          logTokenRefresh(String(sessionResult.user.id), request);
        } catch (auditError) {
          console.warn('[Refresh] Audit log failed:', auditError);
        }

        return NextResponse.json({
          success: true,
          token: newToken,
          user: sessionResult.user
        });
      }
    }

    // HIGH-5 fix: Remove JWT fallback — refresh tokens should be the only way to extend sessions.
    // Previously, a valid JWT alone could refresh, allowing stolen JWTs to persist indefinitely.
    // Now, only a valid session cookie (refresh token) can refresh — JWT-only requests are rejected.
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // JWT-only refresh is no longer allowed — attacker with stolen JWT could refresh forever
      logger.warn('JWT-only refresh attempt rejected (session cookie required)', {
        ip: clientIP,
      });
      return NextResponse.json(
        { error: 'Session cookie required for token refresh. Re-authenticate to obtain a new session.' },
        { status: 401 }
      );
    }

    // No session cookie and no valid auth
    return NextResponse.json(
      { error: 'Invalid or expired session. Please log in again.' },
      { status: 401 }
    );

  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
