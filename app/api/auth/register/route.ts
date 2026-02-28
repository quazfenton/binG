import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/auth/auth-service';
import { rateLimiters } from '@/lib/middleware/rate-limit';
import { validateRequest, schemas } from '@/lib/middleware/validate';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('API:Auth:Register');

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

      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Check if email verification is required
    if (result.requiresVerification) {
      logger.info('Registration successful, verification required', { email });

      return NextResponse.json({
        success: true,
        requiresVerification: true,
        message: result.message || 'Registration successful! Please check your email to verify your account.',
        user: result.user,
      });
    }

    logger.info('Registration successful', { email, userId: result.user?.id });

    // Set session cookie
    const response = NextResponse.json({
      success: true,
      user: result.user,
      token: result.token,
      sessionId: result.sessionId,
    });

    if (result.sessionId) {
      response.cookies.set('session_id', result.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });
    }

    return response;
  } catch (error) {
    logger.error('Registration error', error as Error);

    return NextResponse.json(
      { success: false, error: 'Registration failed' },
      { status: 500 }
    );
  }
});
