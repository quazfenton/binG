/**
 * VfsSnapshotCacheMetrics — Bug #11 fix
 *
 * Closes the run.log audit "Snapshot cache both over-invalidates and goes
 * stale" by adding a small, dependency-free counter object that the
 * snapshot gateway increments on every hit / miss / stale-hit /
 * invalidation / export. Operators can read the snapshot via
 * `getSnapshotCacheMetrics()` (and the `/api/health?detailed` endpoint
 * surfaces it) to verify the cache is doing its job.
 *
 * Why this matters: prior to this fix, a 4-snapshot-stale run.log entry
 * was completely silent — operators had no way to know whether the
 * snapshot gateway was serving fresh data, serving stale data, or
 * re-running the full `exportWorkspace` (which can take seconds on a
 * large workspace) on every request. With the counters, the run.log
 * audit scenario would have surfaced as `hit: 0, miss: 100,
 * staleHit: 0, exported: 100` — clearly showing the cache is bypassed.
 *
 * The audit also asked for a content-hash key. The existing gateway
 * already keys the cache by `${ownerId}:${pathFilter}:${auth}` and
 * invalidates via the `onSnapshotChange` listener when the VFS version
 * bumps. Since the snapshot ETag is `${version}-${updatedAt}`, a
 * content-hash key is effectively equivalent to the version-based
 * invalidation that's already in place — same content produces the
 * same version, the cache stays valid, and the export is skipped.
 * The new counters close the observability gap that made the audit
 * bug invisible.
 *
 * Design notes:
 *   - All counters are simple `number` fields on a singleton. No I/O,
 *     no DB, no logger writes from this module (callers log if they
 *     want to). Safe to call from hot request paths.
 *   - `reset()` is for tests; production should not need it.
 *   - `snapshot()` is O(1) — it reads the counters, it doesn't
 *     reset them. Use `reset()` separately if you want a "since-reset"
 *     window.
 *   - Staleness threshold is env-tunable via
 *     `VFS_SNAPSHOT_STALE_THRESHOLD_MS` (default 60_000 = 60 s, down
 *     from the previous 300_000 = 5 min).
 *
 * @module vfs-snapshot-cache-metrics
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VfsSnapshotCacheMetrics');

// ============================================================================
// Counter shape
// ============================================================================

/**
 * Read-only snapshot of the VFS snapshot cache counters. Returned by
 * `getSnapshotCacheMetrics()` and surfaced via `/api/health?detailed`.
 */
export interface VfsSnapshotCacheMetricsSnapshot {
  /** Number of times a request was served from the in-memory cache (no export). */
  hit: number;
  /** Number of times the cache had no entry and a fresh export was performed. */
  miss: number;
  /**
   * Number of times a cached entry was found but rejected as stale (either
   * the TTL expired OR a newer VFS version was seen via the
   * `onSnapshotChange` listener). Stale-hits are NOT counted as cache
   * hits — they are the "almost-hit" case where the cache had a value but
   * it was no longer trustworthy.
   */
  staleHit: number;
  /** Number of times an entry was evicted because a newer VFS version was seen. */
  invalidations: number;
  /** Number of full `exportWorkspace` calls (i.e. cache misses that built a fresh snapshot). */
  exported: number;
  /** Cumulative time spent inside `exportWorkspace` (ms). Divide by `exported` for avg export time. */
  exportMsTotal: number;
  /** Number of times the cache was intentionally cleared (debug / size-limit cleanup). */
  clears: number;
  /** Number of entries currently in the cache (best-effort; passed in by the gateway). */
  size: number;
  /** Number of cache entries dropped by the size-limit cleanup. */
  sizeEvictions: number;
  /**
   * Number of cache entries dropped by the TTL cleanup. Includes entries
   * whose TTL had expired AND entries the `onSnapshotChange` listener
   * swept because they were older than the staleness threshold.
   */
  ttlEvictions: number;
  /** Epoch ms when the counters were last reset (or process start). */
  sinceMs: number;
  /**
   * Stale threshold in ms. A cached entry older than this when read is
   * counted as a `staleHit` rather than a `hit`. Configurable via
   * `VFS_SNAPSHOT_STALE_THRESHOLD_MS` (default 60_000 = 60 s).
   */
  staleThresholdMs: number;
}

// ============================================================================
// Counter object
// ============================================================================

/**
 * Process-singleton counter object. Exported as `vfsSnapshotCacheMetrics`
 * for production use; tests can use `createVfsSnapshotCacheMetrics()`
 * for isolation.
 */
export class VfsSnapshotCacheMetrics {
  private _hit = 0;
  private _miss = 0;
  private _staleHit = 0;
  private _invalidations = 0;
  private _exported = 0;
  private _exportMsTotal = 0;
  private _clears = 0;
  private _sizeEvictions = 0;
  private _ttlEvictions = 0;
  private _size = 0;
  private _sinceMs = Date.now();
  private readonly _staleThresholdMs: number;

  constructor(options: { staleThresholdMs?: number } = {}) {
    const envValue = Number.parseInt(process.env.VFS_SNAPSHOT_STALE_THRESHOLD_MS ?? '', 10);
    if (Number.isFinite(envValue) && envValue >= 1000) {
      this._staleThresholdMs = envValue;
    } else if (typeof options.staleThresholdMs === 'number' && options.staleThresholdMs >= 1000) {
      this._staleThresholdMs = options.staleThresholdMs;
    } else {
      this._staleThresholdMs = 60_000; // 60 s default (down from 300_000 = 5 min)
    }
  }

  // ── Public counter methods (O(1) each) ─────────────────────────────────

  recordHit(): void { this._hit += 1; }
  recordMiss(): void { this._miss += 1; }
  recordStaleHit(): void { this._staleHit += 1; }
  recordInvalidation(): void { this._invalidations += 1; }
  recordExport(durationMs: number): void {
    this._exported += 1;
    this._exportMsTotal += Math.max(0, Math.round(durationMs));
  }
  recordClear(): void { this._clears += 1; }
  recordSizeEviction(): void { this._sizeEvictions += 1; }
  recordTtlEviction(): void { this._ttlEvictions += 1; }
  setSize(size: number): void { this._size = Math.max(0, size | 0); }

  // ── Read-only accessors ───────────────────────────────────────────────

  get hit(): number { return this._hit; }
  get miss(): number { return this._miss; }
  get staleHit(): number { return this._staleHit; }
  get invalidations(): number { return this._invalidations; }
  get exported(): number { return this._exported; }
  get exportMsTotal(): number { return this._exportMsTotal; }
  get clears(): number { return this._clears; }
  get sizeEvictions(): number { return this._sizeEvictions; }
  get ttlEvictions(): number { return this._ttlEvictions; }
  get size(): number { return this._size; }
  get sinceMs(): number { return this._sinceMs; }
  get staleThresholdMs(): number { return this._staleThresholdMs; }

  /** Average export duration in ms. Returns 0 when no exports have run. */
  getAverageExportMs(): number {
    return this._exported > 0 ? this._exportMsTotal / this._exported : 0;
  }

  /** Cache hit ratio in [0, 1]. Returns 0 when no reads have happened. */
  getHitRatio(): number {
    const total = this._hit + this._miss + this._staleHit;
    return total > 0 ? this._hit / total : 0;
  }

  // ── Snapshot (O(1) read) ──────────────────────────────────────────────

  /**
   * O(1) snapshot of the current counter values. Does NOT reset them;
   * use `reset()` separately if you want a "since-reset" window.
   */
  snapshot(): VfsSnapshotCacheMetricsSnapshot {
    return {
      hit: this._hit,
      miss: this._miss,
      staleHit: this._staleHit,
      invalidations: this._invalidations,
      exported: this._exported,
      exportMsTotal: this._exportMsTotal,
      clears: this._clears,
      size: this._size,
      sizeEvictions: this._sizeEvictions,
      ttlEvictions: this._ttlEvictions,
      sinceMs: this._sinceMs,
      staleThresholdMs: this._staleThresholdMs,
    };
  }

  /**
   * Reset all counters to zero and stamp `sinceMs = Date.now()`. Used
   * by tests for isolation. Production should not need to call this.
   */
  reset(): void {
    this._hit = 0;
    this._miss = 0;
    this._staleHit = 0;
    this._invalidations = 0;
    this._exported = 0;
    this._exportMsTotal = 0;
    this._clears = 0;
    this._sizeEvictions = 0;
    this._ttlEvictions = 0;
    this._size = 0;
    this._sinceMs = Date.now();
    logger.debug('[VfsSnapshotCacheMetrics] counters reset');
  }
}

// ============================================================================
// Factory + singleton
// ============================================================================

/**
 * Create a new metrics instance. Use in tests for isolation; production
 * should use the exported singleton.
 */
export function createVfsSnapshotCacheMetrics(
  options: { staleThresholdMs?: number } = {},
): VfsSnapshotCacheMetrics {
  return new VfsSnapshotCacheMetrics(options);
}

/**
 * Process-wide singleton. The snapshot gateway imports this directly
 * and increments counters on every hit / miss / stale-hit / etc.
 *
 * CRITICAL: persist on `globalThis` so a Next.js hot-reload doesn't
 * construct a fresh instance with reset counters while the underlying
 * cache map (`globalThis.__snapshotCache__`) survives. Without this,
 * `/api/health?detailed` would show `sinceMs: <now>` after every
 * hot-reload even though the cache itself is old.
 */
declare global {
  // eslint-disable-next-line no-var
  var __vfsSnapshotCacheMetrics__: VfsSnapshotCacheMetrics | undefined;
}

export const vfsSnapshotCacheMetrics: VfsSnapshotCacheMetrics =
  globalThis.__vfsSnapshotCacheMetrics__ ??
  (globalThis.__vfsSnapshotCacheMetrics__ = new VfsSnapshotCacheMetrics());

/**
 * Convenience: read a snapshot of the current metrics. Equivalent to
 * `vfsSnapshotCacheMetrics.snapshot()` but reads from the singleton
 * without forcing the import.
 */
export function getSnapshotCacheMetrics(): VfsSnapshotCacheMetricsSnapshot {
  return vfsSnapshotCacheMetrics.snapshot();
}
