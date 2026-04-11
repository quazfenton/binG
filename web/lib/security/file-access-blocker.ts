import { NextRequest, NextResponse } from 'next/server';

/**
 * Security middleware to block access to sensitive files
 * Add this to your middleware.ts or as a route middleware
 * 
 * IMPROVED: Handles URL encoding, Unicode normalization, and null byte injection
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
  /\.log$/i,          // Log files
  /\.sql$/i,          // SQL dump files
];

const BLOCKED_PATHS = [
  '/data/',
  '/database/',
  '/db/',
  '/.env',
  '/config.json',
  '/.git/',
  '/node_modules/',
  '/.next/',
];

export function blockSensitiveFiles(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  
  // Get client info for logging
  const clientIp = request.headers.get('x-forwarded-for') ||
                   request.headers.get('x-real-ip') ||
                   'unknown';

  // SECURITY FIX: Decode URL encoding to prevent bypass via encoded characters
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Invalid URL encoding - block request
    console.warn(`[Security] Blocked invalid URL encoding: ${pathname} from ${clientIp}`);
    return new NextResponse('Forbidden', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  }
  
  // SECURITY FIX: Normalize Unicode to prevent homograph bypasses
  const normalizedPath = decodedPath.normalize('NFKC');
  
  // SECURITY FIX: Remove null bytes to prevent null byte injection attacks
  const cleanPath = normalizedPath.replace(/\0/g, '');
  
  // SECURITY FIX: Block path traversal attempts
  if (cleanPath.includes('../') || cleanPath.includes('..\\') || cleanPath.includes('/./')) {
    console.warn(`[Security] Blocked path traversal attempt: ${pathname} from ${clientIp}`);
    return new NextResponse('Forbidden', {
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  }

  // Check blocked paths
  for (const blockedPath of BLOCKED_PATHS) {
    if (cleanPath.includes(blockedPath)) {
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
    if (pattern.test(cleanPath)) {
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
