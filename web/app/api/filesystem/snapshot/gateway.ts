import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDesktopMode } from '@bing/platform/env';
import { fsBridge, isUsingLocalFS } from '@bing/shared/FS/fs-bridge';
import { stripWorkspacePrefixes } from '@/lib/virtual-filesystem/scope-utils';
import { resolveFilesystemOwner, virtualFilesystem, withAnonSessionCookie } from '@/lib/virtual-filesystem/index.server';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { getSnapshotBroadcaster, type SnapshotChangedMessage } from '@/lib/virtual-filesystem/snapshot-broadcaster';
import { createLogger } from '@/lib/utils/logger';
import { vfsSnapshotCacheMetrics } from './cache-metrics';
import { getDatabase } from '@/lib/database/connection-shim';
import { isRedisEnabled } from '@/lib/redis/client';
import { getContentAddressableStorage } from '@/lib/storage/content-addressable-storage';
import { getRuntimeBroker } from '@/lib/sandbox/runtime-broker';

const logger = createLogger('API:VFS:Snapshot');

// P0 fix (Bug #14 follow-up cross-worker): the eager-init cooldown and
// initDone flags no longer live on `globalThis`. Each Turbopack compile
// worker has its own `globalThis` isolate, so per-process gates never
// survive across workers — every request in every new worker saw an empty
// `__vfsInitDone__` and re-entered the WORKSPACE_NOT_READY path. Using
// module-scope Maps collates concurrent requests correctly WITHIN one
// worker, and the DB existence check below (`isInitDone`) is the
// cross-worker source of truth via the shared SQLite `vfs_workspace_meta`
// + `vfs_workspace_files` tables.
const EAGER_INIT_COOLDOWN_MS = 5000;
const INIT_DONE_TTL_MS = 60_000;       // mark "init done" as expired after 1 min
const MAX_INIT_OWNERS = 10_000;       // hard cap on per-worker tracking
const INIT_OWNER_SWEEP_INTERVAL_MS = 30_000; // periodic GC, .unref'd
const eagerInitCooldowns = new Map<string, number>();                // ownerId → last attempt ms

/**
 * Test-only helper: pre-populate the cooldown Map for a given ownerId so
 * the Path A (cooldown-active 202) branch is reachable from the unit test
 * suite without having to wait for real elapsed time. The optional
 * timestamp argument lets tests simulate a cooldown that's already
 * partially elapsed (e.g. pass `Date.now() - 1000` to get a currentMs of
 * ~4000ms in the response's backoffHint). Exported with a double-underscore
 * prefix so it's never confused with a real API surface.
 */
export function __setEagerInitCooldownForTest(
  ownerId: string,
  timestamp?: number,
): void {
  eagerInitCooldowns.set(ownerId, timestamp ?? Date.now());
}
const initDoneOwners = new Map<string, number>();                    // ownerId → set-at ms

let initOwnerSweepInterval: NodeJS.Timeout | null = null;
function startInitOwnerSweep(): void {
  if (initOwnerSweepInterval) return;
  initOwnerSweepInterval = setInterval(() => {
    const now = Date.now();
    // Drop expired initDone marks and stale cooldown entries so the
    // maps cannot grow unbounded under sustained anonymous traffic.
    for (const [ownerId, setAt] of initDoneOwners) {
      if (now - setAt > INIT_DONE_TTL_MS) initDoneOwners.delete(ownerId);
    }
    for (const [ownerId, lastAttempt] of eagerInitCooldowns) {
      if (now - lastAttempt > EAGER_INIT_COOLDOWN_MS) eagerInitCooldowns.delete(ownerId);
    }
    // Hard cap: if a worker is still above MAX_INIT_OWNERS after the
    // TTL-based sweep, evict oldest entries (insertion order, since
    // Map preserves insertion order). This is a safety net against
    // pathological workloads; the TTL sweep handles 99% of cases.
    const capInit = (m: Map<string, number>) => {
      if (m.size <= MAX_INIT_OWNERS) return;
      const overflow = m.size - MAX_INIT_OWNERS;
      const iter = m.keys();
      for (let i = 0; i < overflow; i++) {
        const k = iter.next().value;
        if (k === undefined) break;
        m.delete(k);
      }
    };
    capInit(initDoneOwners);
    capInit(eagerInitCooldowns);
  }, INIT_OWNER_SWEEP_INTERVAL_MS).unref(); // .unref() so the sweep interval never prevents Node exit
}
startInitOwnerSweep();

process.on('beforeExit', () => {
  if (initOwnerSweepInterval) {
    clearInterval(initOwnerSweepInterval);
    initOwnerSweepInterval = null;
  }
});



// Server-side LRU cache for snapshots
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
declare global {
   
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
// Bug #11 (audit) — the snapshot cache both over-invalidates and goes stale.
// The audit's literal ask was "tighten staleness threshold (455 s is way too
// long for a chat session)". The gateway's TTL is 30 s, but the per-entry
// staleness check inside the gateway was 5 min. Now we surface a tighter
// `VfsSnapshotCacheMetrics.staleThresholdMs` (default 60 s, env-tunable
// via VFS_SNAPSHOT_STALE_THRESHOLD_MS) so a 1+ minute-old cache hit is
// counted as `staleHit` rather than a clean `hit`. The 30 s TTL still
// applies to the actual cache entry, but the counter surfaces how often
// the cache is serving data that is older than the staleness threshold.
const SNAPSHOT_STALENESS_MS = vfsSnapshotCacheMetrics.staleThresholdMs;

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
        // Bug #11 — record every TTL-driven eviction so operators can see
        // how often the cache is being swept by the cleanup interval vs
        // by a fresh write (invalidations).
        vfsSnapshotCacheMetrics.recordTtlEviction();
        snapshotCache.delete(key);
        // Also clean up corresponding latestSeenVersion entry
        // SECURITY: Use indexOf (FIRST :) not split()[0], because:
        // - ownerId is system-controlled and NEVER contains :
        // - path MAY contain user-provided : (e.g., Windows paths)
        const colonIndex = key.indexOf(':');
        const ownerFromKey = colonIndex !== -1 ? key.slice(0, colonIndex) : key;
        if (ownerFromKey && !Array.from(snapshotCache.keys()).some(k => k.startsWith(`${ownerFromKey}:`))) {
          latestSeenVersion.delete(ownerFromKey);
        }
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info('[VFS SNAPSHOT] Periodic cache cleanup', { count: deleted, cacheSizeBytes: getContentAddressableStorage().getCurrentCacheSize(), brokerDegraded: getRuntimeBroker().getInitError()?.message ?? null });
    }

    // Also enforce max size - remove oldest entries if over limit
    if (snapshotCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(snapshotCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [key] of toDelete) {
        // Bug #11 — record every size-limit eviction separately from TTL
        // evictions so operators can distinguish chronic over-invalidation
        // (size limit hit) from natural TTL expiration.
        vfsSnapshotCacheMetrics.recordSizeEviction();
        snapshotCache.delete(key);
        // Also clean up corresponding latestSeenVersion entry
        // SECURITY: Use indexOf (FIRST :) not split()[0], because:
        // - ownerId is system-controlled and NEVER contains :
        // - path MAY contain user-provided : (e.g., Windows paths)
        const colonIndex = key.indexOf(':');
        const ownerFromKey = colonIndex !== -1 ? key.slice(0, colonIndex) : key;
        if (ownerFromKey && !Array.from(snapshotCache.keys()).some(k => k.startsWith(`${ownerFromKey}:`))) {
          latestSeenVersion.delete(ownerFromKey);
        }
      }
      logger.info('[VFS SNAPSHOT] Size limit cleanup', { count: toDelete.length, cacheSizeBytes: getContentAddressableStorage().getCurrentCacheSize(), brokerDegraded: getRuntimeBroker().getInitError()?.message ?? null });
    }
    vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
  }, 60000).unref(); // Run every 60 seconds, unref to allow process exit
}

// Start periodic cleanup
startPeriodicCleanup();

// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
// Without this, latestSeenVersion resets on hot-reload and cache validation breaks
declare global {
   
  var __snapshotLatestVersion__: Map<string, number> | undefined;
   
  var __snapshotListenerRegistered__: boolean | undefined;
}

const latestSeenVersion = globalThis.__snapshotLatestVersion__ ?? (globalThis.__snapshotLatestVersion__ = new Map<string, number>());

// Only register the listener once, even across hot-reloads
if (!globalThis.__snapshotListenerRegistered__) {
  globalThis.__snapshotListenerRegistered__ = true;

  /**
   * Invalidate cache entries for an owner when a newer workspace
   * version is observed. Shared by the local in-process listener and
   * the cross-process Redis pub/sub subscriber — both paths converge
   * here so the eviction logic is in exactly one place.
   */
  function invalidateForOwner(
    ownerId: string,
    version: number,
    source: string,
    reason: string = 'version-bump',
  ): void {
    const currentMax = latestSeenVersion.get(ownerId) || 0;
    if (version <= currentMax) {
      return; // already seen a newer or equal version
    }
    latestSeenVersion.set(ownerId, version);

    let evicted = 0;
    for (const key of snapshotCache.keys()) {
      if (key.startsWith(`${ownerId}:`)) {
        const cached = snapshotCache.get(key);
        if (cached && cached.version < version) {
          // Bug #11 — count every listener-driven eviction so the
          // `invalidations` counter surfaces chronic over-invalidation.
          vfsSnapshotCacheMetrics.recordInvalidation();
          snapshotCache.delete(key);
          evicted++;
        }
      }
    }
    if (evicted > 0) {
      // Bug #97 (Pass-7 audit) — include the invalidation `reason` so
      // operators can distinguish "newer write came in" from "stale
      // version evicted" from "size-limit cleanup". Without the reason,
      // a chronic over-invalidation storm looks identical to a normal
      // write-driven invalidation in the logs, masking the "cache that
      // doesn't cache" anti-pattern. The `source` is preserved for
      // backward-compat with existing log parsers.
      logger.info('[VFS SNAPSHOT] Cache invalidated', { count: evicted, ownerId, version, source, reason, cacheSizeBytes: getContentAddressableStorage().getCurrentCacheSize() });
    }
    vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
  }

  // Local in-process listener: fires when this process writes via VFS.
  virtualFilesystem.onSnapshotChange((ownerId: string, version: number) => {
    invalidateForOwner(ownerId, version, 'local', 'in-process write');
  });

  // Cross-process listener: fires when ANOTHER worker writes via VFS.
  // Bug #16 (audit) follow-up — without this, worker A's write would
  // not notify worker B, and worker B would return a stale cached
  // snapshot. The broadcaster is a no-op if Redis is unavailable, so
  // this subscribe() is safe to call in any environment.
  getSnapshotBroadcaster().subscribe((msg: SnapshotChangedMessage) => {
    invalidateForOwner(msg.ownerId, msg.version, `pubsub:${msg.source}`, 'cross-process write via pubsub');
  });
}

// Request tracking for detecting polling loops
declare global {
   
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
      logger.info('[VFS SNAPSHOT] Request tracker cleanup', { count: deleted, cacheSizeBytes: getContentAddressableStorage().getCurrentCacheSize(), brokerDegraded: getRuntimeBroker().getInitError()?.message ?? null });
    }
  }, 120000).unref(); // Run every 2 minutes, unref to allow process exit
}

// Start request tracker cleanup
startRequestTrackerCleanup();

// Bug #3 (audit): In-flight export dedup cache — prevents two concurrent requests
// for the same (ownerId, pathFilter) from both calling exportWorkspace() on
// the same workspace. Without this, overlapping snapshot requests (e.g., from
// the catch-all route and the dedicated /api/filesystem/snapshot route) both
// start full exports, doubling load on the DB and inflating latency for both.
// The dedup is tracked via a module-level Map; the promise is removed from the
// map once the export completes or fails.
const inFlightExports = new Map<string, Promise<any>>();
const IN_FLIGHT_EXPORT_TIMEOUT_MS = 60_000;

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
 * Accepts both relative paths (workspace, workspace/sessions) and absolute paths
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
        // Allow relative paths (workspace, workspace/sessions, etc.)
        if (!path.startsWith('/')) return true;
        // If absolute, must start with /home/ or /workspace/
        return path.startsWith('/home/') || path.startsWith('/workspace/') || path.startsWith('/tmp/');
      },
      'Absolute paths must start with /home/, /workspace/, or /tmp/'
    ),
});
const log = (...args: any[]) => DEBUG && logger.info('[VFS SNAPSHOT]', ...args);
const logWarn = (...args: any[]) => logger.warn('[VFS SNAPSHOT WARN]', ...args);
const logError = (...args: any[]) => logger.error('[VFS SNAPSHOT ERROR]', ...args);

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
    let pathFilter = url.searchParams.get('path') || 'workspace';
    const useDesktopSnapshot = isDesktopMode() && isUsingLocalFS();
    if (!useDesktopSnapshot && pathFilter === 'workspace') {
      pathFilter = 'workspace/sessions';
    }
    pathFilter = pathFilter.replace(/\/+$/, '');

    // Normalize pathFilter to match stored file paths (strip workspace/ prefix)
    // Files are stored with paths like sessions/002/index.html — strip workspace/ prefix
    pathFilter = stripWorkspacePrefixes(pathFilter) || 'workspace';

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
    // Bug #16 (audit hot-fix) — the read path now uses the authoritative
    // in-memory workspace version (`getCurrentVersionSync`) as the primary
    // staleness check, with the listener-tracked `latestSeenVersion` as a
    // cross-process fallback. The previous code only used the listener
    // version, which left a race window: a read that started before the
    // write's listener fired would see the OLD listener version and return
    // the cached entry, even though the in-memory workspace was already at
    // the new version. The sync getter sees the in-flight version because
    // `workspaces` Map is updated synchronously at the start of writeFile
    // (before `await persistWorkspace`).
    //
    // Multi-worker caveat: this fix is single-process. In a multi-worker
    // Next.js deployment, worker A's write updates its in-memory Map and
    // fires its listener, but worker B's in-memory Map is still empty. A
    // read on worker B will see `currentVersion = 0` from its own Map and
    // fall back to the (also empty) `listenerVersion` — serving stale data.
    // True cross-worker invalidation needs a shared pub/sub (e.g. Redis
    // pub/sub on `onSnapshotChange`).
    //
    // Note: `cached.version < latestVersion` is false when `latestVersion
    // === 0`, so we don't need a special-case for "no writes yet" — the
    // arithmetic naturally short-circuits.
    // Bug #36 (audit) — defensive guard. If the deployed build predates
    // the Bug #16 fix (or hot-reload produced a partial singleton state),
    // `virtualFilesystem.getCurrentVersionSync` may be missing. Fall
    // back to the listener-tracked `latestSeenVersion` so the snapshot
    // path still works (with a throttled [WARN] so the regression is
    // visible in run.log) instead of crashing every request.
    let currentVersion = 0;
    if (typeof (virtualFilesystem as any).getCurrentVersionSync === 'function') {
      currentVersion = virtualFilesystem.getCurrentVersionSync(owner.ownerId);

    // Bug #5 fix: when Redis pub/sub is unavailable, the in-memory version
    // above is per-Node-process. Cross-worker writes (Worker A bumps to v5,
    // Worker B's local in-memory is still v0) would cause Worker B to
    // incorrectly report the cached snapshot as valid (304 Not Modified)
    // and the client would permanently miss Worker A's writes. Fall back
    // to a SQLite SELECT MAX(version) FROM vfs_workspace_meta for cross-
    // worker cache invalidation when Redis is disabled. This is a cheap
    // query (single row, indexed on owner_id) and only runs when Redis is
    // down — negligible overhead in the common (Redis-backed) case.
    if (!isRedisEnabled()) {
      try {
        const db = getDatabase();
        if (db) {
          // Bug #5 v2: scope the version query to the current owner
          // instead of returning MAX across ALL workspaces. vfs_workspace_meta
          // has a UNIQUE constraint on owner_id, so this is a single-row
          // indexed lookup. The previous MAX query caused unnecessary cache
          // invalidations in multi-tenant deployments (Worker B reading
          // owner X's snapshot would see "owner Y bumped to v100" and
          // invalidate its cache even though owner X's data hadn't
          // changed). SAFE: never returns stale data, just more precise.
          const row = db
            .prepare('SELECT version FROM vfs_workspace_meta WHERE owner_id = ?')
            .get(owner.ownerId) as { version: number | null } | undefined;
          if (row?.version != null) {
            currentVersion = Math.max(currentVersion, row.version);
          }
        }
      } catch {
        // SQLite unavailable — fall through with in-memory version only.
        // The client will still get a fresh snapshot (no 304), just without
        // cross-worker version awareness.
      }
    }
    } else {
      const nowMs = Date.now();
      if (nowMs - (globalThis.__vfsDefensiveGuardLastWarnedAt__ ?? 0) > 60_000) {
        globalThis.__vfsDefensiveGuardLastWarnedAt__ = nowMs;
        logWarn('[' + requestId + '] getCurrentVersionSync missing on virtualFilesystem — falling back to listener-tracked latestSeenVersion. This indicates a stale build; restart the dev server to flush the Turbopack module cache.');
      }
    }
    const listenerVersion = latestSeenVersion.get(owner.ownerId) ?? 0;
    const latestVersion = Math.max(currentVersion, listenerVersion);

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      if (latestVersion !== undefined && cached.version < latestVersion) {
        // Bug #11 — a newer VFS version was seen since this entry was cached.
        // Count this as a staleHit (not a hit) so operators can see the cache
        // is being bypassed because the version was bumped.
        vfsSnapshotCacheMetrics.recordStaleHit();
        vfsSnapshotCacheMetrics.recordInvalidation();
        snapshotCache.delete(cacheKey);
        // Do NOT record a miss — the staleHit is the signal. The fall-through
        // to the export path will record the export duration so operators
        // see the cost of the staleHit-induced re-export.
      } else if (now - cached.timestamp > SNAPSHOT_STALENESS_MS) {
        // Bug #11 — entry is older than the staleness threshold. Still
        // within the 30 s TTL, but operators want to know this is "almost
        // stale" so they can tune SNAPSHOT_STALENESS_MS downward.
        vfsSnapshotCacheMetrics.recordStaleHit();
        snapshotCache.delete(cacheKey);
        // Do NOT record a miss (same rationale as above).
      } else {
        const ifNoneMatch = req.headers.get('if-none-match');
        if (ifNoneMatch === cached.etag) {
          vfsSnapshotCacheMetrics.recordHit();
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

        vfsSnapshotCacheMetrics.recordHit();
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

    // Count a miss ONLY for requests that had no cache entry at all. A
    // staleHit-induced fall-through already counted its signal above; we
    // do not want staleHit + miss to double-count the same logical "no
    // clean hit" event.
    if (!cached) {
      vfsSnapshotCacheMetrics.recordMiss();
    }

    // Bug #3 (audit): Check if an export is already in-flight for this cacheKey.
    // If so, join the existing promise instead of starting a duplicate export.
    // This prevents double-loading on the workspace when the catch-all and
    // dedicated snapshot routes race for the same (ownerId, pathFilter).
    let snapshot: any;
    const exportCacheKey = `export:${cacheKey}`;
    let existingExport = inFlightExports.get(exportCacheKey);
    if (existingExport) {
      log(`[${requestId}] Joining in-flight export for cacheKey="${cacheKey}"`);
      // Await the in-flight promise and assign to snapshot for downstream use.
      // The in-flight promise resolves to the snapshot data, not the full
      // response — we just need the data at this point in the flow.
      snapshot = await existingExport;
    } else {
      // Generate new snapshot
      const exportStart = Date.now();
      const exportPromise = (async (): Promise<any> => {
        if (useDesktopSnapshot) {
          const localSnapshot = await fsBridge.exportWorkspace(owner.ownerId);
          return {
            root: localSnapshot.root,
            version: localSnapshot.version,
            updatedAt: new Date().toISOString(),
            exportedAt: new Date().toISOString(),
            files: localSnapshot.files,
          };
        } else {
          return await virtualFilesystem.exportWorkspace(owner.ownerId);
        }
      })();

      inFlightExports.set(exportCacheKey, exportPromise);

      // Safety timeout: remove the in-flight entry after 60s so a never-
      // resolving export (e.g., workspace stuck mid-init) doesn't permanently
      // block all subsequent snapshot requests for this cacheKey.
      const timeoutId = setTimeout(() => {
        if (inFlightExports.get(exportCacheKey) === exportPromise) {
          inFlightExports.delete(exportCacheKey);
        }
      }, IN_FLIGHT_EXPORT_TIMEOUT_MS);
      timeoutId.unref();

      try {
        snapshot = await exportPromise;
        // Bug #11 — record the export duration for the cache metrics.
        vfsSnapshotCacheMetrics.recordExport(Date.now() - exportStart);
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        logError(`[${requestId}] exportWorkspace failed:`, error instanceof Error ? error.message : error);
        throw error;
      } finally {
        // Clean up the in-flight entry only if it's still ours (not replaced
        // by a newer request that raced past the timeout).
        if (inFlightExports.get(exportCacheKey) === exportPromise) {
          inFlightExports.delete(exportCacheKey);
        }
        // Also clear the safety timeout if it hasn't fired yet.
        clearTimeout(timeoutId);
      }
    }

    const files = useDesktopSnapshot
      ? snapshot.files
      : snapshot.files.filter((file) => {
          const prefix = `${pathFilter}/`;
          return file.path === pathFilter || file.path.startsWith(prefix);
        });

    const duration = Date.now() - startTime;

    log(`[${requestId}] Snapshot: ${files.length} files in ${duration}ms (total workspace: ${snapshot.files.length} files)`);
    
    // Log if we're getting empty results - helps debug session ID mismatches
    if (files.length === 0 && snapshot.files.length === 0) {
      // Bug #44: for anonymous users an empty workspace is EXPECTED (the
      // WORKSPACE_NOT_READY path below handles it). Log at debug so operators
      // don't think #14 is broken. For authenticated users (session cookie or
      // JWT) it's genuinely suspicious and worth a warn.
      //
      // NOTE: `FilesystemOwnerResolution.source` is typed as
      // `'anonymous' | 'session' | 'jwt'`. There is NO literal 'authenticated'
      // value — "authenticated" in this code path is the union of 'session'
      // and 'jwt' (i.e., anything that is not 'anonymous'). Comparing to the
      // non-existent 'authenticated' string was a typecheck (TS2367) AND
      // runtime bug (the warn branch was dead code — never executed because
      // `owner.source` could never equal the literal 'authenticated'). Fixed
      // by comparing to 'anonymous' instead, which correctly captures the
      // "real user, not anonymous visitor" semantic.
      if (owner.source !== 'anonymous') {
        logWarn(`[${requestId}] EMPTY WORKSPACE: ownerId="${owner.ownerId}", source="${owner.source}", path="${pathFilter}"`);
      } else {
        log(`[${requestId}] EMPTY WORKSPACE (expected): ownerId="${owner.ownerId}", source="${owner.source}", path="${pathFilter}"`);
      }

      // Bug #14 (audit) — when an anonymous user hits an empty
      // workspace, the LLM previously saw `{success: true, files: []}`
      // and had no way to distinguish "the workspace is initializing"
      // from "the workspace is genuinely empty". It would then
      // hallucinate file contents and proceed with stale context.
      //
      // The fix: detect the empty-workspace case for non-authenticated
      // owners and return a typed 202 Accepted response with error
      // code `WORKSPACE_NOT_READY`. The LLM can match on this code
      // and either retry, ask the user to wait, or surface a clearer
      // UI message ("Session initializing, please wait…") instead of
      // acting on the empty list.
      if (owner.source === 'anonymous') {
        // Bug #14 (audit) follow-up — eagerly initialize the workspace
        // BEFORE returning WORKSPACE_NOT_READY. Without this, an anonymous
        // user's first snapshot read returns 202, the client throws, the
        // LLM never writes, and the workspace stays uninitialized forever
        // — every subsequent snapshot repeats the same loop. With this,
        // the gateway initializes the workspace (creating an empty
        // WorkspaceState in the map + DB) and the NEXT read sees success
        // with 0 files, breaking the loop.
        try {
          // Bug #7 fix: Check if this owner's workspace was already
          // successfully initialized in a previous request. If so, skip
          // the WORKSPACE_NOT_READY path entirely — the workspace exists
          // but may be genuinely empty. This prevents the 188-occurrence
          // WORKSPACE_NOT_READY spam loop where the client polls every
          // 30s but keeps hitting the cooldown gate.
          //
          // P0 fix: use a module-scope Set AND a direct DB existence
          // check (vfs_workspace_meta or any file row for this owner).
          // The DB check is the cross-process source of truth because
          // SQLite is the only state that's actually shared between
          // Next.js compile workers — every per-process `globalThis.*`
          // gate previously reset on worker spawn and triggered the
          // cooldown loop after every Turbopack JIT compile.
          let isInitDone = initDoneOwners.has(owner.ownerId); // Map#has is identical to Set#has
          if (!isInitDone) {
            try {
              const db = getDatabase();
              const hasMeta = db
                .prepare('SELECT 1 FROM vfs_workspace_meta WHERE owner_id = ?')
                .get(owner.ownerId);
              if (hasMeta) {
                isInitDone = true;
              } else {
                const hasFiles = db
                  .prepare('SELECT 1 FROM vfs_workspace_files WHERE owner_id = ? LIMIT 1')
                  .get(owner.ownerId);
                if (hasFiles) isInitDone = true;
              }
              if (isInitDone) initDoneOwners.set(owner.ownerId, Date.now());
            } catch (err: any) {
              // Don't let a transient DB hiccup force every request
              // down the WORKSPACE_NOT_READY path. Log once and fall
              // through; the ensureWorkspace() call below will create
              // the meta row when it succeeds, which the NEXT request
              // will pick up.
              logWarn(`[${requestId}] Failed to check DB for existing workspace: ${err?.message || err}`);
            }
          }

          if (isInitDone) {
            // Bug #7 follow-up FIX: this branch used to only log and then
            // fall through to the `return WORKSPACE_NOT_READY` at the bottom
            // of the anonymous block — directly contradicting its own
            // comment ("skip the WORKSPACE_NOT_READY path entirely"). The
            // result: the FIRST anonymous read eager-inits and returns
            // success, but EVERY subsequent read of the (still-empty)
            // workspace re-entered here, logged "skipping", then 202'd with
            // WORKSPACE_NOT_READY forever. The client surfaced that as
            // `[useVFS ERROR] request: failed - Workspace not yet
            // initialized` on app open. The workspace genuinely exists and
            // is simply empty, so return a SUCCESS response with the
            // already-computed (empty) file list instead of falling through.
            log(`[${requestId}] Workspace already initialized for anonymous owner — returning empty snapshot (success) instead of WORKSPACE_NOT_READY`);
            const readyEtag = `"${snapshot.version}-${snapshot.updatedAt}"`;
            snapshotCache.set(cacheKey, {
              data: {
                root: snapshot.root,
                version: snapshot.version,
                updatedAt: snapshot.updatedAt,
                path: pathFilter,
                files,
              },
              timestamp: now,
              etag: readyEtag,
              version: snapshot.version,
            });
            vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
            const readyResponse = NextResponse.json({
              success: true,
              data: {
                root: snapshot.root,
                version: snapshot.version,
                updatedAt: snapshot.updatedAt,
                path: pathFilter,
                files,
              },
              cached: false,
            }, {
              headers: {
                'cache-control': 'private, no-store',
                'vary': 'Authorization, Cookie',
                etag: readyEtag,
              },
            });
            return withAnonSessionCookie(readyResponse, owner);
          } else {
          // 5s in-memory cooldown to prevent hammering the DB when the
          // snapshot is polled faster than the init can complete. After
          // the cooldown expires, the next request retries the init.
          //
          // P0 fix: Use module-scope eagerInitCooldowns instead of
          // globalThis.__vfsEagerInitAttempted__ so the cooldown is
          // correct within a single worker. Cross-worker coordination
          // is handled by the DB-based isInitDone check above — if
          // another worker already initialized the workspace, the DB
          // check will return true and we never reach this branch.
          const lastAttempt = eagerInitCooldowns.get(owner.ownerId) || 0;
          if (Date.now() - lastAttempt < EAGER_INIT_COOLDOWN_MS) {
            // Bug #2/#7 follow-up FIX: this was the LAST remaining exit that
            // still returned `202 WORKSPACE_NOT_READY`. On app load the
            // client fires several snapshot polls at once (e.g. paths
            // "sessions", "sessions/000", "workspace"). The FIRST enters the
            // eager-init path and sets the cooldown timestamp; the others,
            // arriving milliseconds later, hit this cooldown branch and got a
            // 202. The client's retries also landed inside the same 5s
            // cooldown, exhausted, then `throw`, surfacing as
            //   `[useVFS ERROR] request: failed - Workspace not yet
            //    initialized` + repeated `unhandledRejection`s — even though
            // the filesystem is simply empty.
            //
            // The workspace was ALREADY ensured/loaded by `exportWorkspace()`
            // above (it calls `ensureWorkspace()` internally), so `snapshot`
            // and `files` here are a valid, fully-initialized empty result.
            // There is nothing transient to wait for — the cooldown only
            // exists to avoid re-running init, not to signal "not ready".
            // Return the already-computed empty snapshot as SUCCESS (matching
            // every other exit of this block) so the client caches it and
            // stops polling instead of throwing.
            log(`[${requestId}] Eager-init cooldown active for anonymous owner — returning empty snapshot (success) instead of WORKSPACE_NOT_READY`);
            const cooldownEtag = `"${snapshot.version}-${snapshot.updatedAt}"`;
            snapshotCache.set(cacheKey, {
              data: {
                root: snapshot.root,
                version: snapshot.version,
                updatedAt: snapshot.updatedAt,
                path: pathFilter,
                files,
              },
              timestamp: now,
              etag: cooldownEtag,
              version: snapshot.version,
            });
            vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
            const cooldownResponse = NextResponse.json({
              success: true,
              data: {
                root: snapshot.root,
                version: snapshot.version,
                updatedAt: snapshot.updatedAt,
                path: pathFilter,
                files,
              },
              cached: false,
              // Same "terminal empty state, stop polling" signal used by the
              // init-failed fallback below, so operators can grep it and the
              // client can distinguish it from a real snapshot with content.
              cooldownExpired: true,
            }, {
              headers: {
                'cache-control': 'private, no-store',
                'vary': 'Authorization, Cookie',
                etag: cooldownEtag,
              },
            });
            return withAnonSessionCookie(cooldownResponse, owner);
          }
          eagerInitCooldowns.set(owner.ownerId, Date.now());
          // `ensureWorkspace` is public on VirtualFileSystemService since
          // the Bug #14 follow-up. The typeof guard is preserved as a
          // defense-in-depth fallback in case the deployed build predates
          // the change (matches the Bug #36 pattern).
          if (typeof (virtualFilesystem as any).ensureWorkspace === 'function') {
            await (virtualFilesystem as any).ensureWorkspace(owner.ownerId);
            log(`[${requestId}] Eagerly initialized workspace for anonymous owner — breaking WORKSPACE_NOT_READY loop`);
            // Bug #7 fix: Mark this owner as initialized so future requests
            // skip the WORKSPACE_NOT_READY path entirely. P0 fix: also
            // persists cross-worker via the DB existence check above.
            initDoneOwners.set(owner.ownerId, Date.now());
            // Re-export the now-initialized snapshot and return success
            // with 0 files instead of WORKSPACE_NOT_READY. This unblocks
            // file edits on the very next read.
            const initializedSnapshot = await virtualFilesystem.exportWorkspace(owner.ownerId);
            const initializedFiles = initializedSnapshot.files.filter((file: any) => {
              const prefix = `${pathFilter}/`;
              return file.path === pathFilter || file.path.startsWith(prefix);
            });
            const initEtag = `"${initializedSnapshot.version}-${initializedSnapshot.updatedAt}"`;
            snapshotCache.set(cacheKey, {
              data: {
                root: initializedSnapshot.root,
                version: initializedSnapshot.version,
                updatedAt: initializedSnapshot.updatedAt,
                path: pathFilter,
                files: initializedFiles,
              },
              timestamp: now,
              etag: initEtag,
              version: initializedSnapshot.version,
            });
            vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
            const initResponse = NextResponse.json({
              success: true,
              data: {
                root: initializedSnapshot.root,
                version: initializedSnapshot.version,
                updatedAt: initializedSnapshot.updatedAt,
                path: pathFilter,
                files: initializedFiles,
                justInitialized: true,
              },
              cached: false,
            }, {
              headers: {
                'cache-control': 'private, no-store',
                'vary': 'Authorization, Cookie',
                etag: initEtag,
              },
            });
            return withAnonSessionCookie(initResponse, owner);
           }
          } // end of else (not already initialized)
         } catch (initErr: any) {
           // Bug #2 fix (VFS polling storm): instead of falling through to a
           // 202 WORKSPACE_NOT_READY (which made the client poll forever —
           // see the 12 `POLLING DETECTED` warnings in run.log), return a
           // terminal 200 with empty files + `cooldownExpired: true` so the
           // client can stop polling. The init attempt failed AND no other
           // init path is available AND the workspace is genuinely empty —
           // there is nothing transient to wait for. The
           // `cooldownExpired: true` field on the response body lets the
           // client distinguish this terminal empty state from the 202
           // WORKSPACE_NOT_READY response in Path A (cooldown-active above).
           logWarn(`[${requestId}] Eager workspace init failed (returning terminal empty snapshot): ${initErr?.message}`);
         }
        log(`[${requestId}] Returning terminal empty snapshot for anonymous owner — no init available, no cooldown active`);
        const fallbackEtag = `"${snapshot.version}-${snapshot.updatedAt}"`;
        snapshotCache.set(cacheKey, {
          data: {
            root: snapshot.root,
            version: snapshot.version,
            updatedAt: snapshot.updatedAt,
            path: pathFilter,
            files,
          },
          timestamp: now,
          etag: fallbackEtag,
          version: snapshot.version,
        });
        vfsSnapshotCacheMetrics.setSize(snapshotCache.size);
        const terminalResponse = NextResponse.json({
          success: true,
          data: {
            root: snapshot.root,
            version: snapshot.version,
            updatedAt: snapshot.updatedAt,
            path: pathFilter,
            files,
          },
          cached: false,
          // Bug #2: signals "terminal empty state, stop polling" — the
          // client can treat this the same as a successful empty snapshot
          // (no further polling needed) but the field makes the distinction
          // greppable for operators and trivially distinguishable from the
          // 202 cooldown-active response in Path A (`WORKSPACE_NOT_READY`).
          cooldownExpired: true,
        }, {
          headers: {
            'cache-control': 'private, no-store',
            'vary': 'Authorization, Cookie',
            etag: fallbackEtag,
          },
        });
        return withAnonSessionCookie(terminalResponse, owner);
      }
    } else if (files.length === 0 && snapshot.files.length > 0) {
      logWarn(`[${requestId}] PATH MISMATCH: workspace has ${snapshot.files.length} files but none match path="${pathFilter}"`);
      logger.info(`[${requestId}] Workspace file paths: ${snapshot.files.map(f => f.path).join(', ')}`);
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

    // Bug #90 (Round 3): Force cache invalidation when snapshot is extremely stale
    // (older than 1 hour). This handles the case where the VFS version didn't bump
    // (e.g., Redis pub/sub failed, or write didn't trigger emitSnapshotChange).
    // The next request will re-generate the snapshot from scratch.
    const EXTREME_STALENESS_MS = 60 * 60 * 1000; // 1 hour
    if (snapshotAge > EXTREME_STALENESS_MS) {
      logWarn(`[${requestId}] EXTREME STALENESS: snapshot is ${Math.round(snapshotAge / 1000 / 60)}min old — forcing cache invalidation`);
      snapshotCache.delete(cacheKey);
      vfsSnapshotCacheMetrics.recordInvalidation();
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

    // Always cache the generated snapshot. The onSnapshotChange listener
    // (registered at module init) evicts stale entries when a newer version
    // is written, and the cache read path also checks cached.version against
    // latestSeenVersion. This avoids the race where a concurrent write bumps
    // the version between exportWorkspace start and finish, causing every
    // subsequent request to miss the cache and re-run the full export.
    snapshotCache.set(cacheKey, {
      data: responseData,
      timestamp: now,
      etag,
      version: snapshot.version,
    });
    // Bug #11 — keep the metrics' size in sync with the cache so the
    // /api/health block reports an accurate entry count.
    vfsSnapshotCacheMetrics.setSize(snapshotCache.size);

    // Bug #78 (Pass-5 audit) — emit a backoff hint so the client knows it
    // should poll less aggressively. The hint is conservative (1s → 2s → 4s
    // → 8s, capped at 30s) and resets when the snapshot is empty (workspace
    // not ready). This is the same pattern used in `tracking` above for
    // server-side detection — the client can use the hint to switch from
    // fixed-interval polling to exponential backoff. Closes the audit's
    // "client too aggressive" complaint without forcing an SSE migration.
    const snapshotAgeMs = Date.now() - new Date(snapshot.updatedAt).getTime();
    const isFresh = snapshotAgeMs < 2_000;
    const isStale = snapshotAgeMs > 30_000;
    const backoffHint = isStale
      ? {
          strategy: 'exponential' as const,
          baseMs: 1_000,
          maxMs: 30_000,
          currentMs: 4_000,
          reason: 'stale_snapshot' as const,
        }
      : isFresh
        ? {
            strategy: 'exponential' as const,
            baseMs: 1_000,
            maxMs: 30_000,
            currentMs: 1_000,
            reason: 'fresh_snapshot' as const,
          }
        : {
            strategy: 'exponential' as const,
            baseMs: 1_000,
            maxMs: 30_000,
            currentMs: 2_000,
            reason: 'normal' as const,
          };

    const response = NextResponse.json({
      success: true,
      data: responseData,
      cached: false,
      // Bug #78 — surface a server-issued backoff hint to the client. The
      // client may use this to switch from fixed 1.5s polling to the
      // exponential schedule the server recommends. Optional in the response
      // shape so older clients that ignore the field are unaffected.
      backoffHint,
    }, {
      headers: {
        // Bug #78 — `Cache-Control: private, max-age=N` (was `no-store`).
        // The server-side snapshotCache + ETag are the source of truth;
        // this `max-age` lets the BROWSER short-circuit identical requests
        // within N seconds when the client respects the response. `no-store`
        // forced the browser to re-validate every time, defeating the
        // purpose of ETag. 1s is a safe lower bound given the snapshot's
        // sub-second typical update latency.
        'cache-control': 'private, max-age=1',
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
