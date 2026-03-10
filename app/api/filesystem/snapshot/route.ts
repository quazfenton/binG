import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFilesystemOwner, virtualFilesystem } from '@/lib/virtual-filesystem';

export const runtime = 'nodejs';

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
    
    // Track request frequency
    const tracking = trackRequest(pathFilter);
    
    // Log polling detection
    if (tracking.isPolling) {
      logWarn(`POLLING DETECTED: ${tracking.requestCount} requests in ${tracking.windowMs}ms for path "${pathFilter}"`);
    }
    
    log(`[${requestId}] GET /api/filesystem/snapshot path="${pathFilter}" (polling=${tracking.isPolling}, count=${tracking.requestCount})`);
    
    const snapshot = await virtualFilesystem.exportWorkspace(owner.ownerId);
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

    return NextResponse.json({
      success: true,
      data: {
        root: snapshot.root,
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        path: pathFilter,
        files,
      },
    });
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logError(`[${requestId}] ERROR after ${duration}ms:`, error instanceof Error ? error.message : error);
    
    const message = error instanceof Error ? error.message : 'Failed to export workspace snapshot';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
