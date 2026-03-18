import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

// Server-side LRU cache for snapshots
const snapshotCache = new Map<string, {
  data: any;
  timestamp: number;
  etag: string;
}>();
const CACHE_TTL_MS = 30000; // 30 seconds server-side cache

// Request tracking for detecting polling loops
const requestTracker = new Map<string, { count: number; lastRequest: number; firstRequest: number }>();
const REQUEST_WINDOW_MS = 5000; // 5 second window for tracking

// Debug flag
const DEBUG = process.env.DEBUG_VFS === 'true' || process.env.NODE_ENV === 'development';

/**
 * Schema for filesystem snapshot requests
 * Validates directory path and prevents path traversal attacks
 * Accepts both relative paths (project, project/sessions) and absolute paths
 */
const snapshotRequestSchema = z.object({
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
});
const log = (...args: any[]) => DEBUG && console.log('[VFS SNAPSHOT]', ...args);
const logWarn = (...args: any[]) => console.warn('[VFS SNAPSHOT WARN]', ...args);
const logError = (...args: any[]) => console.error('[VFS SNAPSHOT ERROR]', ...args);

/**
 * Track request frequency to detect polling loops
 */
function trackRequest(path: string): { isPolling: boolean; requestCount: number; windowMs: number } {
  const now = Date.now();
  const key = path;
  
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

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    const owner = await resolveFilesystemOwner(req);
    const url = new URL(req.url);
    const pathFilter = (url.searchParams.get('path') || 'project').replace(/\/+$/, '');

    // SECURITY: Validate pathFilter with schema before use
    const parseResult = snapshotRequestSchema.safeParse({ path: pathFilter });
    if (!parseResult.success) {
      logError(`[${requestId}] Invalid pathFilter:`, parseResult.error.errors[0].message);
      return NextResponse.json({ 
        success: false, 
        error: parseResult.error.errors[0].message 
      }, { status: 400 });
    }

    // Track request frequency
    const tracking = trackRequest(pathFilter);

    // Log polling detection
    if (tracking.isPolling) {
      logWarn(`POLLING DETECTED: ${tracking.requestCount} requests in ${tracking.windowMs}ms for path "${pathFilter}"`);
    }

    log(`[${requestId}] GET /api/filesystem/snapshot path="${pathFilter}" (polling=${tracking.isPolling}, count=${tracking.requestCount})`);

    // SECURITY: Set anonymous session cookie for new anonymous users
    const responseInit: ResponseInit = {
      headers: {
        'cache-control': 'private, no-store',
        'vary': 'Authorization, Cookie',
      }
    };

    if (owner.anonSessionId) {
      // Set secure, http-only cookie for anonymous session
      responseInit.headers!['set-cookie'] = `anon-session-id=${owner.anonSessionId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
    }

    // Check server-side cache first
    // SECURITY: Use owner + path + auth status as cache key to prevent cross-user leakage
    const authHeader = req.headers.get('authorization');
    const cacheKey = `${owner.ownerId}:${pathFilter}:${authHeader ? 'auth' : 'anon'}`;
    const cached = snapshotCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      // Check If-None-Match header for conditional request
      const ifNoneMatch = req.headers.get('if-none-match');
      if (ifNoneMatch === cached.etag) {
        log(`[${requestId}] Cache hit with matching ETag, returning 304`);
        // SECURITY: Use private cache headers to prevent shared caching
        return new NextResponse(null, {
          status: 304,
          headers: {
            ...responseInit.headers,
            etag: cached.etag,
          }
        });
      }

      log(`[${requestId}] Cache hit (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
      // SECURITY: Use private cache headers to prevent shared caching
      return NextResponse.json({
        success: true,
        data: cached.data,
        cached: true,
      }, {
        headers: {
          ...responseInit.headers,
          etag: cached.etag,
        }
      });
    }

    // Generate new snapshot
    let snapshot;
    try {
      snapshot = await virtualFilesystem.exportWorkspace(owner.ownerId);
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      logError(`[${requestId}] exportWorkspace failed:`, error instanceof Error ? error.message : error);
      throw error;
    }
    
    const prefix = `${pathFilter}/`;
    const files = snapshot.files.filter(
      (file) => file.path === pathFilter || file.path.startsWith(prefix),
    );

    const duration = Date.now() - startTime;

    log(`[${requestId}] Snapshot: ${files.length} files in ${duration}ms (total workspace: ${snapshot.files.length} files)`);

    if (duration > 200) {
      logWarn(`[${requestId}] SLOW OPERATION: exportWorkspace took ${duration}ms for "${pathFilter}"`);
    }

    // Log if snapshot is stale (older than 5 minutes)
    const snapshotAge = Date.now() - new Date(snapshot.updatedAt).getTime();
    if (snapshotAge > 5 * 60 * 1000) {
      logWarn(`[${requestId}] STALE SNAPSHOT: last updated ${Math.round(snapshotAge / 1000)}s ago`);
    }

    // Cache with ETag
    const etag = `"${snapshot.version}-${snapshot.updatedAt}"`;
    const responseData = {
      root: snapshot.root,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      path: pathFilter,
      files,
    };

    snapshotCache.set(cacheKey, {
      data: responseData,
      timestamp: now,
      etag,
    });

    // Clean up old cache entries asynchronously to avoid blocking request
    if (snapshotCache.size > 100) {
      // Use setImmediate to defer cleanup to next event loop
      setImmediate(() => {
        let deleted = 0;
        const cacheThreshold = CACHE_TTL_MS * 2;
        for (const [key, value] of snapshotCache.entries()) {
          if (deleted >= 20) break; // Delete max 20 old entries at a time
          if (now - value.timestamp > cacheThreshold) {
            snapshotCache.delete(key);
            deleted++;
          }
        }
        if (deleted > 0) {
          log(`Cache cleanup: deleted ${deleted} old entries`);
        }
      });
    }

    const response = NextResponse.json({
      success: true,
      data: responseData,
      cached: false,
    }, {
      headers: {
        ...responseInit.headers,
        etag,
      }
    });
    return response;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logError(`[${requestId}] ERROR after ${duration}ms:`, error instanceof Error ? error.message : error);
    
    const message = error instanceof Error ? error.message : 'Failed to export workspace snapshot';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
