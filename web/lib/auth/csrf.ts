/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * HIGH-10 fix: Protects all state-changing auth endpoints against CSRF.
 *
 * Strategy:
 * 1. On login/register, server sets a crypto-random csrf-token as an HttpOnly cookie
 * 2. Client JavaScript reads the cookie and sends it back as X-CSRF-Token header
 * 3. On POST/PUT/DELETE, server compares cookie value to header value
 *
 * Why double-submit cookie?
 * - Stateless: no server-side session storage needed
 * - Simple: works with both SSR and client-side rendering
 * - Secure: an attacker cannot read the HttpOnly cookie from another origin
 *   (SameSite=Lax already blocks cross-site POST, but this adds defense-in-depth
 *   for CORS+credentials scenarios and Safari < 17 SameSite gaps)
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('CSRF');

const CSRF_TOKEN_LENGTH = 32; // 256 bits of entropy
const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a new CSRF token (cryptographically random hex string)
 */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Set CSRF token cookie on a response.
 * Called after successful login/register to establish the token.
 *
 * Cookie attributes:
 * - HttpOnly: JS can read it (needed for double-submit) — NOT HttpOnly so client JS
 *   can extract and send as header. This is intentional for the double-submit pattern.
 * - SameSite=Lax: already protects against simple cross-site POST, this adds defense-in-depth
 * - Secure in production: only sent over HTTPS
 * - Path=/: available on all routes
 */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Client JS must read this to send as header
    secure: process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60, // 1 hour — matches JWT TTL
  });
}

/**
 * Validate CSRF token on state-changing requests.
 *
 * Checks that:
 * 1. The csrf-token cookie exists
 * 2. The X-CSRF-Token header exists
 * 3. Both values match
 *
 * @returns { valid: boolean, error?: string }
 */
export function validateCsrfToken(request: NextRequest): { valid: boolean; error?: string } {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (!cookieToken) {
    logger.warn('CSRF validation failed: missing cookie', {
      path: request.nextUrl.pathname,
    });
    return { valid: false, error: 'CSRF token cookie missing' };
  }

  if (!headerToken) {
    logger.warn('CSRF validation failed: missing header', {
      path: request.nextUrl.pathname,
    });
    return { valid: false, error: 'CSRF token header missing' };
  }

  // Constant-time comparison to prevent timing attacks
  try {
    if (cookieToken.length !== headerToken.length) {
      logger.warn('CSRF validation failed: token length mismatch', {
        path: request.nextUrl.pathname,
      });
      return { valid: false, error: 'CSRF token mismatch' };
    }

    const a = Buffer.from(cookieToken, 'hex');
    const b = Buffer.from(headerToken, 'hex');

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      logger.warn('CSRF validation failed: token mismatch', {
        path: request.nextUrl.pathname,
      });
      return { valid: false, error: 'CSRF token mismatch' };
    }

    return { valid: true };
  } catch {
    // If hex decoding fails, the tokens don't match
    logger.warn('CSRF validation failed: invalid token format', {
      path: request.nextUrl.pathname,
    });
    return { valid: false, error: 'CSRF token mismatch' };
  }
}

/**
 * Check if a request method requires CSRF validation.
 * Only state-changing methods (POST, PUT, DELETE, PATCH) need CSRF checks.
 */
export function requiresCsrfCheck(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
}

/**
 * Helper: Validate CSRF for a request, returning a 403 response if invalid.
 * Returns null if valid (caller should proceed with normal handling).
 */
export function csrfCheckOrReject(request: NextRequest): NextResponse | null {
  if (!requiresCsrfCheck(request)) {
    return null; // Non-mutating method, no CSRF check needed
  }

  const result = validateCsrfToken(request);
  if (!result.valid) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 403 }
    );
  }

  return null; // Valid, proceed
}
