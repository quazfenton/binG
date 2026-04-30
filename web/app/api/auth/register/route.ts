import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { validateRequest, schemas } from '@/lib/middleware/validate';
import { createLogger } from '@/lib/utils/logger';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';

const logger = createLogger('API:Auth:Register');

/**
 * Transfer anonymous VFS workspace to the newly authenticated user.
 * Non-fatal — failures are logged but do not block registration.
 */
async function transferVFSFromAnonymous(
  request: NextRequest,
  user: { id: number | string } | undefined
): Promise<void> {
  const anonCookie = request.cookies.get('anon-session-id')?.value;
  if (!anonCookie || !user?.id) return;

  try {
    const rawSessionId = anonCookie.startsWith('anon_') ? anonCookie.slice(5) : anonCookie;
    const sanitizedSessionId = rawSessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const anonOwnerId = `anon:${sanitizedSessionId}`;
    const newOwnerId = String(user.id);

    if (anonOwnerId !== newOwnerId) {
      const transferResult = await virtualFilesystem.transferOwnership(anonOwnerId, newOwnerId);
      if (transferResult.transferredFiles > 0) {
        logger.info('VFS ownership transferred from anonymous to authenticated user', {
          from: anonOwnerId,
          to: newOwnerId,
          transferredFiles: transferResult.transferredFiles,
        });
      }
    }
  } catch (err) {
    logger.warn('VFS ownership transfer failed during registration (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Registration input validation schema
 *
 * Security requirements:
 * - Email must be valid format
 * - Password must meet strength requirements (8+ chars, uppercase, lowercase, number)
 * - Username must be 3-30 chars, alphanumeric + underscore only
 */
const registerSchema = schemas.registration.extend({
  username: schemas.nonEmptyString.optional(),
});

export const POST = validateRequest(registerSchema)(async (request, { validatedBody }) => {
  try {
    const { email, password, username } = validatedBody;

    // Rate limiting: 5 registrations per hour per IP
    // This prevents email bombing and spam registrations
    const rateLimitResult = await rateLimiters.registration(
      request,
      async () => NextResponse.json({ success: true })
    );

    // Check if rate limit was exceeded
    if (rateLimitResult.status === 429) {
      logger.warn('Registration rate limit exceeded', {
        ip: request.headers.get('x-forwarded-for') || 'unknown',
      });
      return rateLimitResult;
    }

    // Get client info for session
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    logger.info('Registration attempt', {
      email,
      username: username || 'not provided',
      ip: ipAddress,
    });

    // Register user
    const result = await authService.register(
      { email, password, username },
      { ipAddress, userAgent }
    );

    if (!result.success) {
      logger.warn('Registration failed', {
        email,
        error: result.error,
      });

      // MED-5 fix: Log registration failure
      try {
        const { logRegisterFailure } = await import('@/lib/auth/auth-audit-logger');
        const reason = result.error?.includes('already') ? 'email_already_exists' : 'unknown';
        logRegisterFailure(email, reason, request);
      } catch (auditError) {
        console.warn('[Register] Audit log failed:', auditError);
      }

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Check if email verification is required
    if (result.requiresVerification) {
      logger.info('Registration successful, verification required', { email });

      // Still transfer VFS ownership — the user exists even if not yet verified
      await transferVFSFromAnonymous(request, result.user);

      return NextResponse.json({
        success: true,
        requiresVerification: true,
        message: result.message || 'Registration successful! Please check your email to verify your account.',
        user: result.user,
      });
    }

    logger.info('Registration successful', { email, userId: result.user?.id });

    // MED-5 fix: Log successful registration
    try {
      const { logRegisterSuccess } = await import('@/lib/auth/auth-audit-logger');
      logRegisterSuccess(String(result.user?.id), email, request, { requiresVerification: result.requiresVerification });
    } catch (auditError) {
      console.warn('[Register] Audit log failed:', auditError);
    }

    // Transfer anonymous VFS data to the newly created authenticated user
    await transferVFSFromAnonymous(request, result.user);

    // Set session cookie
    // SECURITY: Do NOT expose sessionId in response body - it's available via httpOnly cookie
    const response = NextResponse.json({
      success: true,
      user: result.user,
      token: result.token,
    });

    if (result.sessionId) {
      response.cookies.set('session_id', result.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });
      // Clear anonymous session cookie — authenticated users should NOT
      // fall back to their old anonymous workspace identity
      response.cookies.set('anon-session-id', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
      });
    }

    // HIGH-10 fix: Set CSRF token cookie on successful registration
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    return response;
  } catch (error) {
    logger.error('Registration error', error as Error);

    return NextResponse.json(
      { success: false, error: 'Registration failed' },
      { status: 500 }
    );
  }
});
