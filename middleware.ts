import { NextRequest, NextResponse } from 'next/server';
import { blockSensitiveFiles } from './lib/security/file-access-blocker';

/**
 * Next.js Middleware
 * 
 * This middleware runs on every request and:
 * 1. Blocks access to sensitive files (.db, .env, etc.)
 * 2. Can add authentication checks, rate limiting, etc.
 */

export function middleware(request: NextRequest) {
  // Block access to sensitive files
  const blockedResponse = blockSensitiveFiles(request);
  if (blockedResponse) {
    return blockedResponse;
  }
  
  // Add security headers to all responses
  const response = NextResponse.next();
  
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');
  
  // XSS protection
  response.headers.set('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
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