import { NextRequest, NextResponse } from 'next/server';

/**
 * Security middleware to block access to sensitive files
 * Add this to your middleware.ts or as a route middleware
 */

const BLOCKED_PATTERNS = [
  /\.db$/i,           // SQLite databases
  /\.sqlite3?$/i,     // SQLite files
  /\.env$/i,          // Environment files
  /\.env\./i,         // Environment files with extensions
  /\.key$/i,          // Key files
  /\.pem$/i,          // Certificate files
  /config\.json$/i,   // Config files
  /\/data\//,         // Data directory
  /\.backup$/i,       // Backup files
  /\.bak$/i,          // Backup files
  /~$/,               // Backup files with ~
];

const BLOCKED_PATHS = [
  '/data/',
  '/database/',
  '/db/',
  '/.env',
  '/config.json',
];

export function blockSensitiveFiles(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  
  // Get client info for logging
  const clientIp = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';
  
  // Check blocked paths
  for (const blockedPath of BLOCKED_PATHS) {
    if (pathname.startsWith(blockedPath)) {
      console.warn(`[Security] Blocked access to sensitive path: ${pathname} from ${clientIp}`);
      return new NextResponse('Forbidden', { 
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }
  }
  
  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(pathname)) {
      console.warn(`[Security] Blocked access to sensitive file: ${pathname} from ${clientIp}`);
      return new NextResponse('Forbidden', { 
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
        }
      });
    }
  }
  
  return null; // Allow request
}

// Middleware matcher configuration
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};