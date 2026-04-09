import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

export const runtime = 'nodejs';

// Server-side LRU cache for snapshots
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
declare global {
  // eslint-disable-next-line no-var
  var __snapshotCache__: Map<string, {
    data: any;
    timestamp: number;
    etag: string;
    version: number;
  }> | undefined;
}

const snapshotCache = globalThis.__snapshotCache__ ?? (globalThis.__snapshotCache__ = new Map<string, {
  data: any;
  timestamp: number;
  etag: string;
  version: number;
}>());
const CACHE_TTL_MS = 30000; // 30 seconds server-side cache
const MAX_CACHE_SIZE = 50; // Max entries before proactive cleanup

// Periodic cache cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;
function startPeriodicCleanup() {
  if (cleanupInterval) return;
  // Use .unref() to allow process to exit without waiting for timer
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const cacheThreshold = CACHE_TTL_MS * 2;
    let deleted = 0;

    for (const [key, value] of snapshotCache.entries()) {
      if (now - value.timestamp > cacheThreshold) {
        snapshotCache.delete(key);
        // Also clean up corresponding latestSeenVersion entry
        const ownerFromKey = key.split(':')[0];
        if (ownerFromKey && !Array.from(snapshotCache.keys()).some(k => k.startsWith(`${ownerFromKey}:`))) {
          latestSeenVersion.delete(ownerFromKey);
        }
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log('[VFS SNAPSHOT] Periodic cache cleanup:', deleted, 'entries removed');
    }

    // Also enforce max size - remove oldest entries if over limit
    if (snapshotCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(snapshotCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [key] of toDelete) {
        snapshotCache.delete(key);
        // Also clean up corresponding latestSeenVersion entry
        const ownerFromKey = key.split(':')[0];
        if (ownerFromKey && !Array.from(snapshotCache.keys()).some(k => k.startsWith(`${ownerFromKey}:`))) {
          latestSeenVersion.delete(ownerFromKey);
        }
      }
      console.log('[VFS SNAPSHOT] Size limit cleanup:', toDelete.length, 'entries removed');
    }
  }, 60000).unref(); // Run every 60 seconds, unref to allow process exit
}

// Start periodic cleanup
startPeriodicCleanup();

// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
// Without this, latestSeenVersion resets on hot-reload and cache validation breaks
declare global {
  // eslint-disable-next-line no-var
  var __snapshotLatestVersion__: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __snapshotListenerRegistered__: boolean | undefined;
}

const latestSeenVersion = globalThis.__snapshotLatestVersion__ ?? (globalThis.__snapshotLatestVersion__ = new Map<string, number>());

// Only register the listener once, even across hot-reloads
if (!globalThis.__snapshotListenerRegistered__) {
  globalThis.__snapshotListenerRegistered__ = true;
  virtualFilesystem.onSnapshotChange((ownerId: string, version: number) => {
    const currentMax = latestSeenVersion.get(ownerId) || 0;
    latestSeenVersion.set(ownerId, Math.max(currentMax, version));

    for (const key of snapshotCache.keys()) {
      if (key.startsWith(`${ownerId}:`)) {
        const cached = snapshotCache.get(key);
        if (cached && cached.version < version) {
          snapshotCache.delete(key);
          console.log('[VFS SNAPSHOT] Cache invalidated for owner:', ownerId, 'version:', version);
        }
      }
    }
  });
}

// Request tracking for detecting polling loops
declare global {
  // eslint-disable-next-line no-var
  var __snapshotRequestTracker__: Map<string, { count: number; lastRequest: number; firstRequest: number }> | undefined;
}

const requestTracker = globalThis.__snapshotRequestTracker__ ?? (globalThis.__snapshotRequestTracker__ = new Map<string, { count: number; lastRequest: number; firstRequest: number }>());
const REQUEST_WINDOW_MS = 5000; // 5 second window for tracking
const MAX_TRACKER_SIZE = 100; // Max entries before cleanup

// Periodic request tracker cleanup
let requestTrackerInterval: NodeJS.Timeout | null = null;
function startRequestTrackerCleanup() {
  if (requestTrackerInterval) return;
  // Use .unref() to allow process to exit without waiting for timer
  requestTrackerInterval = setInterval(() => {
    const now = Date.now();
    let deleted = 0;

    for (const [key, tracker] of requestTracker.entries()) {
      // Remove entries older than 2x the request window
      if (now - tracker.lastRequest > REQUEST_WINDOW_MS * 2) {
        requestTracker.delete(key);
        deleted++;
      }
    }

    // Also enforce max size - remove oldest entries if over limit
    if (requestTracker.size > MAX_TRACKER_SIZE) {
      const entries = Array.from(requestTracker.entries())
        .sort((a, b) => a[1].lastRequest - b[1].lastRequest);
      const toDelete = entries.slice(0, entries.length - MAX_TRACKER_SIZE);
      for (const [key] of toDelete) {
        requestTracker.delete(key);
      }
      deleted += toDelete.length;
    }

    if (deleted > 0 && DEBUG) {
      console.log('[VFS SNAPSHOT] Request tracker cleanup:', deleted, 'entries removed');
    }
  }, 120000).unref(); // Run every 2 minutes, unref to allow process exit
}

// Start request tracker cleanup
startRequestTrackerCleanup();

// Clean up intervals on process exit
process.on('beforeExit', () => {
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (requestTrackerInterval) clearInterval(requestTrackerInterval);
});

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
  let owner: FilesystemOwnerResolution | undefined;

  try {
    owner = await resolveFilesystemOwner(req);
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

    // Check server-side cache first
    // SECURITY: Use owner + path + auth status as cache key to prevent cross-user leakage
    const authHeader = req.headers.get('authorization');
    const cacheKey = `${owner.ownerId}:${pathFilter}:${authHeader ? 'auth' : 'anon'}`;
    const cached = snapshotCache.get(cacheKey);
    const now = Date.now();
    const latestVersion = latestSeenVersion.get(owner.ownerId);

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (latestVersion !== undefined && cached.version < latestVersion) {
        snapshotCache.delete(cacheKey);
      } else {
        const ifNoneMatch = req.headers.get('if-none-match');
        if (ifNoneMatch === cached.etag) {
          log(`[${requestId}] Cache hit with matching ETag, returning 304`);
          const response = new NextResponse(null, {
            status: 304,
            headers: {
              'cache-control': 'private, no-store',
              'vary': 'Authorization, Cookie',
              etag: cached.etag,
            }
          });
          return withAnonSessionCookie(response, owner);
        }

        log(`[${requestId}] Cache hit (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
        const response = NextResponse.json({
          success: true,
          data: cached.data,
          cached: true,
        }, {
          headers: {
            'cache-control': 'private, no-store',
            'vary': 'Authorization, Cookie',
            etag: cached.etag,
          }
        });
        return withAnonSessionCookie(response, owner);
      }
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
    
    // Log if we're getting empty results - helps debug session ID mismatches
    if (files.length === 0 && snapshot.files.length === 0) {
      logWarn(`[${requestId}] EMPTY WORKSPACE: ownerId="${owner.ownerId}", source="${owner.source}", path="${pathFilter}"`);
    } else if (files.length === 0 && snapshot.files.length > 0) {
      logWarn(`[${requestId}] PATH MISMATCH: workspace has ${snapshot.files.length} files but none match path="${pathFilter}"`);
      log(`[${requestId}] Workspace file paths:`, snapshot.files.map(f => f.path));
      logWarn(`[${requestId}] Hint: requested prefix="${pathFilter}" — ensure files are written under "${pathFilter}/" scope`);
    }

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

    const latestVersionBeforeSet = latestSeenVersion.get(owner.ownerId) || 0;
    if (snapshot.version >= latestVersionBeforeSet) {
      snapshotCache.set(cacheKey, {
        data: responseData,
        timestamp: now,
        etag,
        version: snapshot.version,
      });
    }

    const response = NextResponse.json({
      success: true,
      data: responseData,
      cached: false,
    }, {
      headers: {
        'cache-control': 'private, no-store',
        'vary': 'Authorization, Cookie',
        etag,
      }
    });
    return withAnonSessionCookie(response, owner);
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logError(`[${requestId}] ERROR after ${duration}ms:`, error instanceof Error ? error.message : error);

    const message = error instanceof Error ? error.message : 'Failed to export workspace snapshot';
    const errorResponse = NextResponse.json({ success: false, error: message }, { status: 400 });
    return withAnonSessionCookie(errorResponse, owner);
  }
}
