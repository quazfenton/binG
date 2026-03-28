import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import { resolveFilesystemOwnerWithFallback } from '../utils';

export const runtime = 'nodejs';

// Request tracking for detecting polling loops
const requestTracker = new Map<string, { count: number; lastRequest: number; firstRequest: number }>();
const REQUEST_WINDOW_MS = 5000; // 5 second window for tracking
const MAX_TRACKED_PATHS = 1000;

// Debug flag
const DEBUG = process.env.DEBUG_VFS === 'true' || process.env.NODE_ENV === 'development';

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const log = (...args: any[]) => DEBUG && console.log(`${COLORS.bright}${COLORS.cyan}[VFS LIST]${COLORS.reset}`, ...args);
const logWarn = (...args: any[]) => console.warn(`${COLORS.bright}${COLORS.yellow}[VFS LIST WARN]${COLORS.reset}`, ...args);
const logError = (...args: any[]) => console.error(`${COLORS.bright}${COLORS.red}[VFS LIST ERROR]${COLORS.reset}`, ...args);

/**
 * Track request frequency to detect polling loops
 */
function trackRequest(path: string): { isPolling: boolean; requestCount: number; windowMs: number } {
  const now = Date.now();
  const key = path;

  // Cleanup old entries to prevent unbounded growth
  for (const [trackedKey, tracked] of requestTracker.entries()) {
    if (now - tracked.lastRequest > REQUEST_WINDOW_MS * 2) {
      requestTracker.delete(trackedKey);
    }
  }

  if (requestTracker.size > MAX_TRACKED_PATHS) {
    const oldest = Array.from(requestTracker.entries())
      .sort((a, b) => a[1].lastRequest - b[1].lastRequest)
      .slice(0, requestTracker.size - MAX_TRACKED_PATHS);
    for (const [trackedKey] of oldest) {
      requestTracker.delete(trackedKey);
    }
  }

  if (!requestTracker.has(key)) {
    requestTracker.set(key, { count: 1, lastRequest: now, firstRequest: now });
    return { isPolling: false, requestCount: 1, windowMs: 0 };
  }

  const tracker = requestTracker.get(key)!;
  const windowMs = now - tracker.firstRequest;

  // Reset if outside window
  if (windowMs > REQUEST_WINDOW_MS) {
    requestTracker.set(key, { count: 1, lastRequest: now, firstRequest: now });
    return { isPolling: false, requestCount: 1, windowMs: 0 };
  }

  tracker.count++;
  tracker.lastRequest = now;

  const isPolling = tracker.count > 3; // More than 3 requests in 5s = polling
  return { isPolling, requestCount: tracker.count, windowMs };
}

/**
 * Schema for filesystem list requests
 * Validates directory path and prevents path traversal attacks
 * Accepts both relative paths (project, project/sessions) and absolute paths
 */
const listRequestSchema = z.object({
  path: z.string()
    .min(1, 'Path is required')
    .max(500, 'Path too long (max 500 characters)')
    .refine(
      (path) => !path.includes('..') && !path.includes('\0'),
      'Path contains invalid characters'
    )
    .refine(
      (path) => {
        // Allow relative paths (project, project/sessions, etc.)
        if (!path.startsWith('/')) return true;
        // If absolute, must start with /home/ or /workspace/
        return path.startsWith('/home/') || path.startsWith('/workspace/') || path.startsWith('/tmp/');
      },
      'Absolute paths must start with /home/, /workspace/, or /tmp/'
    ),
  ownerId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || 'project';
    const ownerIdFromQuery = url.searchParams.get('ownerId');
    
    // Track request frequency
    const tracking = trackRequest(path);

    // Rate limit aggressive polling — return 429 after threshold
    if (tracking.isPolling && tracking.requestCount > 6) {
      logWarn(`${COLORS.yellow}RATE LIMITED:${COLORS.reset} ${tracking.requestCount} requests in ${tracking.windowMs}ms for path "${COLORS.blue}${path}${COLORS.reset}"`);
      return NextResponse.json(
        { success: false, error: 'Too many requests — slow down' },
        { status: 429, headers: { 'Retry-After': '2' } },
      );
    }

    // Log polling detection
    if (tracking.isPolling) {
      logWarn(`${COLORS.yellow}POLLING DETECTED:${COLORS.reset} ${tracking.requestCount} requests in ${tracking.windowMs}ms for path "${COLORS.blue}${path}${COLORS.reset}"`);
    }

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} GET ${COLORS.green}/api/filesystem/list${COLORS.reset} path="${COLORS.blue}${path}${COLORS.reset}" (polling=${COLORS.yellow}${tracking.isPolling}${COLORS.reset}, count=${COLORS.magenta}${tracking.requestCount}${COLORS.reset})`);

    // Validate path
    const validation = listRequestSchema.safeParse({ path, ownerId: ownerIdFromQuery });
    if (!validation.success) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Validation failed:${COLORS.reset}`, validation.error.errors);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 },
      );
    }

    // Use validated output from zod - ensures any transforms/coercions are applied
    const { path: validatedPath, ownerId: validatedOwnerId } = validation.data;

    // SECURITY: Always derive ownerId from authenticated request context
    // Reject any attempt to override ownerId via query parameter
    const authResolution = await resolveFilesystemOwnerWithFallback(req, {
      route: 'list',
      requestId,
    });
    const authenticatedOwnerId = authResolution.ownerId;

    // If ownerId was explicitly provided in query, verify it matches authenticated user
    if (validatedOwnerId && validatedOwnerId !== authenticatedOwnerId) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Unauthorized ownerId mismatch:${COLORS.reset} requested=${COLORS.yellow}${validatedOwnerId}${COLORS.reset}, authenticated=${COLORS.green}${authenticatedOwnerId}${COLORS.reset}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: cannot list filesystems for other users',
        },
        { status: 403 },
      );
    }

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Listing directory: ${COLORS.green}"${validatedPath}"${COLORS.reset} for owner=${COLORS.magenta}"${authenticatedOwnerId}"${COLORS.reset}`);

    const listing = await virtualFilesystem.listDirectory(authenticatedOwnerId, validatedPath);
    const duration = Date.now() - startTime;
    
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Listed ${COLORS.magenta}${listing.nodes.length}${COLORS.reset} entries in ${COLORS.cyan}${duration}ms${COLORS.reset}`);

    if (duration > 100) {
      logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.yellow}SLOW OPERATION:${COLORS.reset} listDirectory took ${COLORS.cyan}${duration}ms${COLORS.reset} for "${COLORS.blue}${validatedPath}${COLORS.reset}"`);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        path: listing.path,
        nodes: listing.nodes,
      },
    });
    return withAnonSessionCookie(response, authResolution);
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} after ${COLORS.cyan}${duration}ms${COLORS.reset}:`, error instanceof Error ? error.message : error);

    const errorResponse = NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' },
      { status: 400 },
    );
    return withAnonSessionCookie(errorResponse, {
      ownerId: 'unknown',
      source: 'anonymous',
      isAuthenticated: false,
    });
  }
}
