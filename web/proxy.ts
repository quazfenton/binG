import { NextRequest, NextResponse } from 'next/server';
import { blockSensitiveFiles } from './lib/security/file-access-blocker';
import { generateAndStoreNonces, generateCspHeader } from './lib/security/nonce-generator';
import { auth0 } from './lib/auth0-edge';
import { checkRateLimitMiddleware } from './lib/middleware/rate-limit';
import { rateLimitMiddleware as authRateLimit, RATE_LIMIT_CONFIGS } from './lib/middleware/rate-limiter';

/**
 * Next.js Proxy
 *
 * This middleware runs on every request and:
 * 1. Blocks access to sensitive files (.db, .env, etc.)
 * 2. Generates cryptographic nonces for CSP
 * 3. Adds security headers with nonce-based CSP
 * 4. Handles Auth0 authentication routing (sidelayer for future integrations)
 * 5. Validates sidecar tokens in desktop mode
 * 6. Applies rate limiting to API routes (auth and generic)
 */

export async function proxy(request: NextRequest) {
  // Check for sidecar token in query params (passed from loader)
  const queryToken = request.nextUrl.searchParams.get('sid_tkn');
  if (queryToken) {
    const response = NextResponse.redirect(new URL(request.nextUrl.pathname, request.url));
    response.cookies.set('sid_tkn', queryToken, { 
      httpOnly: true, 
      secure: false, // Localhost
      sameSite: 'strict',
      path: '/' 
    });
    return response;
  }

  // Block access to sensitive files
  const blockedResponse = blockSensitiveFiles(request);
  if (blockedResponse) {
    return blockedResponse;
  }

  // Desktop mode: validate sidecar token on API routes
  const isDesktop = process.env.DESKTOP_MODE === 'true';
  const sidecarToken = process.env.SIDECAR_TOKEN;
  if (isDesktop && request.nextUrl.pathname.startsWith('/api/')) {
    if (!sidecarToken) {
      return NextResponse.json(
        { error: 'Server misconfiguration — missing sidecar token' },
        { status: 500 },
      );
    }

    // Skip token check for routes handled directly by Tauri invoke()
    const tauriRoutes = new Set(['/api/health', '/api/providers']);
    if (!tauriRoutes.has(request.nextUrl.pathname)) {
      const headerToken = request.headers.get('x-sidecar-token');
      const cookieToken = request.cookies.get('sid_tkn')?.value;
      const token = headerToken || cookieToken;
      
      if (!token || token !== sidecarToken) {
        return NextResponse.json(
          { error: 'Unauthorized — invalid or missing sidecar token' },
          { status: 401 },
        );
      }
    }
  }

  // Rate limiting for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Authentication routes: strict rate limiting to prevent brute-force attacks
    if (request.nextUrl.pathname.startsWith('/api/auth/')) {
      const authPath = request.nextUrl.pathname;

      // Determine auth operation for appropriate rate limit config
      let configKey: keyof typeof RATE_LIMIT_CONFIGS = 'generic';
      if (authPath.includes('/login') || authPath.includes('/signin')) {
        configKey = 'login';
      } else if (authPath.includes('/register') || authPath.includes('/signup')) {
        configKey = 'register';
      } else if (authPath.includes('/password-reset') || authPath.includes('/reset-password')) {
        configKey = 'passwordReset';
      } else if (authPath.includes('/verify') || authPath.includes('/send-verification')) {
        configKey = 'sendVerification';
      }

      // Apply auth rate limiting
      const rateLimitResult = authRateLimit(request, configKey);
      if (!rateLimitResult.success) {
        return rateLimitResult.response;
      }
    } else {
      // Generic API rate limiting for all other /api/* routes
      // 100 requests per minute (moderate tier)
      const rateLimitResponse = checkRateLimitMiddleware(
        request,
        'api:global',
        100,
        60 * 1000 // 1 minute window
      );
      if (rateLimitResponse) {
        return rateLimitResponse;
      }
    }
  }

  // Auth0 middleware - handles /auth/* routes (login, logout, callback, profile)
  // Runs alongside existing auth system - NOT a replacement
  // Only run Auth0 middleware for /auth/* routes to avoid unnecessary OIDC discovery calls
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    console.log('[Middleware] Auth0 route requested:', request.nextUrl.pathname, {
      hasDomain: !!process.env.AUTH0_DOMAIN,
      hasClientId: !!process.env.AUTH0_CLIENT_ID,
      hasSecret: !!process.env.AUTH0_SECRET,
      connection: request.nextUrl.searchParams.get('connection'),
    });
    try {
      // Let Auth0 SDK middleware handle all /auth/* routes
      // Query parameters (like ?connection=google) are automatically forwarded
      const auth0Response = await auth0.middleware(request);

      // If this is an Auth0 auth route (/auth/*), return Auth0's response directly
      // Auth0 handles login, logout, callback, profile, etc.
      // CRITICAL: Must return auth0Response directly to preserve:
      // - Redirect status codes (302/307)
      // - Location header for redirects
      // - Auth0 session cookies
      // - OAuth state parameters
      if (auth0Response) {
        // Apply minimal security headers to Auth0 response
        auth0Response.headers.set('X-Content-Type-Options', 'nosniff');
        auth0Response.headers.set('X-Frame-Options', 'DENY');
        auth0Response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        return auth0Response;
      }
    } catch (error: any) {
      console.error('[Middleware] Auth0 middleware error:', {
        message: error.message,
        code: error.code,
        name: error.name,
        cause: error.cause,
        stack: error.stack,
        url: request.url,
      });

      // For login errors, redirect to error page with message
      if (request.nextUrl.pathname === '/auth/login') {
        const errorUrl = new URL('/auth/error', request.url);
        errorUrl.searchParams.set('error', 'auth0_middleware_error');
        errorUrl.searchParams.set('error_description', error.message || 'Failed to initialize login request');
        return NextResponse.redirect(errorUrl);
      }

      // For other auth routes, return error response
      return NextResponse.json(
        { error: 'auth0_middleware_error', message: error.message || 'Failed to initialize login request', url: request.url },
        { status: 500 }
      );
    }
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
    // Development CSP - permissive for debugging
    // frame-src https: allows plugin iframes (YouTube, OpenStreetMap, HuggingFace, etc.)
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https: ws: wss: blob:; font-src 'self' data: https:; frame-src 'self' https: http://localhost:*; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
    );
  } else {
    // Production CSP - relaxed for Next.js compatibility
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https: wss: blob:; font-src 'self' data: https:; frame-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
    );
  }

  // Permissions Policy - restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(self "https://www.youtube.com"), accelerometer=(self "https://www.youtube.com")'
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

  // WebContainer preview route requires COEP/COOP for SharedArrayBuffer
  if (request.nextUrl.pathname === '/webcontainer') {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  // If you need cross-origin isolation for a specific feature, set headers
  // in that route handler instead of here.

  return response;
}

// Configure which routes the proxy runs on
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
