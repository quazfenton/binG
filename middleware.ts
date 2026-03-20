import { NextRequest, NextResponse } from 'next/server';
import { blockSensitiveFiles } from './lib/security/file-access-blocker';
import { generateAndStoreNonces, generateCspHeader } from './lib/security/nonce-generator';
import { auth0 } from './lib/auth0';

/**
 * Next.js Middleware
 *
 * This middleware runs on every request and:
 * 1. Blocks access to sensitive files (.db, .env, etc.)
 * 2. Generates cryptographic nonces for CSP
 * 3. Adds security headers with nonce-based CSP
 * 4. Handles Auth0 authentication routing (sidelayer for future integrations)
 * 5. Can add authentication checks, rate limiting, etc.
 */

export async function middleware(request: NextRequest) {
  // Block access to sensitive files
  const blockedResponse = blockSensitiveFiles(request);
  if (blockedResponse) {
    return blockedResponse;
  }

  // Auth0 middleware - handles /auth/* routes (login, logout, callback, profile)
  // Runs alongside existing auth system - NOT a replacement
  const auth0Response = await auth0.middleware(request);

  // If this is an Auth0 auth route (/auth/*), return Auth0's response directly
  // Auth0 handles login, logout, callback, profile, etc.
  // CRITICAL: Must return auth0Response directly to preserve:
  // - Redirect status codes (302/307)
  // - Location header for redirects
  // - Auth0 session cookies
  // - OAuth state parameters
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    return auth0Response;
  }

  // Generate unique nonces for this request
  const requestId = request.headers.get('x-request-id') || 
                    request.headers.get('x-correlation-id') ||
                    `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  const nonces = generateAndStoreNonces(requestId);

  // Create response
  const response = NextResponse.next();

  // Add nonce to headers for use in components
  response.headers.set('x-csp-nonce-script', nonces.script);
  response.headers.set('x-csp-nonce-style', nonces.style);
  response.headers.set('x-request-id', requestId);

  // Add security headers to all responses
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking - allow same-origin framing for plugin iframes
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  // XSS protection (deprecated but still useful for older browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy with nonce-based script/style control
  // In development, use a more permissive CSP for compatibility
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // Development CSP - more permissive for debugging, allows iframe embedding
    // MUST include ws: and wss: for Next.js HMR WebSocket connections
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https: ws: wss: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
    );
  } else {
    // Production CSP - RELAXED for Next.js compatibility
    // Next.js uses its own script loading mechanism that doesn't support nonces
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https: wss: blob:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' https: blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
    );
  }

  // Permissions Policy - restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );

  // Strict Transport Security - enforce HTTPS
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  // NOTE: Cross-Origin isolation headers (COEP/COOP/CORP) are NOT set globally
  // because they would break third-party resources used by plugins:
  // - HuggingFace Spaces iframes (hf.space doesn't send CORP headers)
  // - unpkg.com FFmpeg WASM resources
  // - qrserver.com QR code images
  // These headers should only be set on specific routes that explicitly need
  // cross-origin isolation (e.g., SharedArrayBuffer for threading).
  // If you need cross-origin isolation for a specific feature, set headers
  // in that route handler instead of here.

  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};