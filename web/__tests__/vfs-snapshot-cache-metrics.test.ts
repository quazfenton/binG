/**
 * Bug #11 — VfsSnapshotCacheMetrics
 *
 * Regression tests for the snapshot cache counters. The audit observed
 * the snapshot cache both over-invalidating and going stale with no
 * way to verify either behavior. The fix is a small dependency-free
 * counter object that the gateway increments on every hit / miss /
 * stale-hit / invalidation / export, exposed via
 * `getSnapshotCacheMetrics()` and the `/api/health?detailed` endpoint.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  VfsSnapshotCacheMetrics,
  createVfsSnapshotCacheMetrics,
  vfsSnapshotCacheMetrics,
  getSnapshotCacheMetrics,
} from '@/app/api/filesystem/snapshot/cache-metrics';

// ============================================================================
// Counter behavior
// ============================================================================

describe('Bug #11: VfsSnapshotCacheMetrics counter behavior', () => {
  let m: VfsSnapshotCacheMetrics;
  beforeEach(() => {
    m = createVfsSnapshotCacheMetrics();
    m.reset();
  });

  it('starts at zero on a fresh instance', () => {
    const s = m.snapshot();
    expect(s.hit).toBe(0);
    expect(s.miss).toBe(0);
    expect(s.staleHit).toBe(0);
    expect(s.invalidations).toBe(0);
    expect(s.exported).toBe(0);
    expect(s.exportMsTotal).toBe(0);
    expect(s.clears).toBe(0);
    expect(s.size).toBe(0);
    expect(s.sizeEvictions).toBe(0);
    expect(s.ttlEvictions).toBe(0);
  });

  it('recordHit() increments hit by 1', () => {
    m.recordHit();
    m.recordHit();
    m.recordHit();
    expect(m.snapshot().hit).toBe(3);
  });

  it('recordMiss() increments miss by 1', () => {
    m.recordMiss();
    m.recordMiss();
    expect(m.snapshot().miss).toBe(2);
  });

  it('recordStaleHit() increments staleHit by 1 (not hit)', () => {
    m.recordStaleHit();
    m.recordStaleHit();
    expect(m.snapshot().staleHit).toBe(2);
    expect(m.snapshot().hit).toBe(0);
  });

  it('recordInvalidation() increments invalidations by 1', () => {
    m.recordInvalidation();
    m.recordInvalidation();
    m.recordInvalidation();
    expect(m.snapshot().invalidations).toBe(3);
  });

  it('recordExport(durationMs) increments exported and adds to exportMsTotal', () => {
    m.recordExport(50);
    m.recordExport(100);
    m.recordExport(200);
    expect(m.snapshot().exported).toBe(3);
    expect(m.snapshot().exportMsTotal).toBe(350);
  });

  it('recordExport() clamps negative durations to 0', () => {
    m.recordExport(-50);
    expect(m.snapshot().exported).toBe(1);
    expect(m.snapshot().exportMsTotal).toBe(0);
  });

  it('recordClear() increments clears by 1', () => {
    m.recordClear();
    m.recordClear();
    expect(m.snapshot().clears).toBe(2);
  });

  it('recordSizeEviction() and recordTtlEviction() are independent counters', () => {
    m.recordSizeEviction();
    m.recordTtlEviction();
    m.recordTtlEviction();
    expect(m.snapshot().sizeEvictions).toBe(1);
    expect(m.snapshot().ttlEvictions).toBe(2);
  });

  it('setSize(n) clamps to non-negative integers', () => {
    m.setSize(10);
    expect(m.snapshot().size).toBe(10);
    m.setSize(-5);
    expect(m.snapshot().size).toBe(0);
    m.setSize(7.9);
    expect(m.snapshot().size).toBe(7);
  });
});

// ============================================================================
// Derived metrics
// ============================================================================

describe('Bug #11: VfsSnapshotCacheMetrics derived values', () => {
  it('getAverageExportMs() returns 0 when no exports have run', () => {
    const m = createVfsSnapshotCacheMetrics();
    expect(m.getAverageExportMs()).toBe(0);
  });

  it('getAverageExportMs() returns total / count for non-zero exports', () => {
    const m = createVfsSnapshotCacheMetrics();
    m.recordExport(50);
    m.recordExport(150);
    m.recordExport(100);
    expect(m.getAverageExportMs()).toBe(100); // (50+150+100)/3 = 100
  });

  it('getHitRatio() returns 0 when no reads have happened', () => {
    const m = createVfsSnapshotCacheMetrics();
    expect(m.getHitRatio()).toBe(0);
  });

  it('getHitRatio() returns hit / (hit + miss + staleHit)', () => {
    const m = createVfsSnapshotCacheMetrics();
    // 6 hits, 2 misses, 2 staleHits → 6/10 = 0.6
    for (let i = 0; i < 6; i++) m.recordHit();
    m.recordMiss();
    m.recordMiss();
    m.recordStaleHit();
    m.recordStaleHit();
    expect(m.getHitRatio()).toBe(0.6);
  });

  it('getHitRatio() counts staleHits as non-hits (audit semantics)', () => {
    // Audit scenario: "almost hit" should not be counted as a clean hit.
    const m = createVfsSnapshotCacheMetrics();
    m.recordStaleHit();
    m.recordStaleHit();
    m.recordStaleHit();
    m.recordStaleHit();
    expect(m.getHitRatio()).toBe(0); // 0 hits / 4 stale
  });
});

// ============================================================================
// Snapshot
// ============================================================================

describe('Bug #11: snapshot() is O(1) and does not reset', () => {
  it('returns a snapshot of the current counters', () => {
    const m = createVfsSnapshotCacheMetrics();
    m.recordHit();
    m.recordExport(100);
    m.setSize(5);
    const s = m.snapshot();
    expect(s).toMatchObject({
      hit: 1,
      miss: 0,
      staleHit: 0,
      invalidations: 0,
      exported: 1,
      exportMsTotal: 100,
      size: 5,
      staleThresholdMs: 60_000,
    });
  });

  it('snapshot() does not reset the counters', () => {
    const m = createVfsSnapshotCacheMetrics();
    m.recordHit();
    m.recordHit();
    m.snapshot();
    m.snapshot();
    m.snapshot();
    expect(m.snapshot().hit).toBe(2);
  });

  it('snapshot() includes sinceMs (time of last reset or instance creation)', () => {
    const m = createVfsSnapshotCacheMetrics();
    const s = m.snapshot();
    expect(typeof s.sinceMs).toBe('number');
    expect(s.sinceMs).toBeLessThanOrEqual(Date.now());
  });
});

// ============================================================================
// Stale threshold config
// ============================================================================

describe('Bug #11: staleThresholdMs config', () => {
  it('defaults to 60_000 ms', () => {
    const m = createVfsSnapshotCacheMetrics();
    expect(m.staleThresholdMs).toBe(60_000);
  });

  it('accepts a per-instance override (>= 1000 ms)', () => {
    const m = createVfsSnapshotCacheMetrics({ staleThresholdMs: 30_000 });
    expect(m.staleThresholdMs).toBe(30_000);
  });

  it('ignores per-instance override below 1000 ms (falls back to default)', () => {
    const m = createVfsSnapshotCacheMetrics({ staleThresholdMs: 500 });
    expect(m.staleThresholdMs).toBe(60_000);
  });
});

// ============================================================================
// reset()
// ============================================================================

describe('Bug #11: reset()', () => {
  it('zeros all counters and stamps sinceMs = Date.now()', () => {
    const m = createVfsSnapshotCacheMetrics();
    m.recordHit();
    m.recordExport(100);
    m.setSize(5);
    m.reset();
    const s = m.snapshot();
    expect(s.hit).toBe(0);
    expect(s.exported).toBe(0);
    expect(s.exportMsTotal).toBe(0);
    expect(s.size).toBe(0);
    expect(s.sinceMs).toBeLessThanOrEqual(Date.now());
  });

  it('does not reset staleThresholdMs (config, not counter)', () => {
    const m = createVfsSnapshotCacheMetrics({ staleThresholdMs: 30_000 });
    m.recordHit();
    m.reset();
    expect(m.staleThresholdMs).toBe(30_000);
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('Bug #11: singleton + getSnapshotCacheMetrics()', () => {
  it('vfsSnapshotCacheMetrics is an instance of VfsSnapshotCacheMetrics', () => {
    expect(vfsSnapshotCacheMetrics).toBeInstanceOf(VfsSnapshotCacheMetrics);
  });

  it('getSnapshotCacheMetrics() returns a snapshot of the singleton', () => {
    const s = getSnapshotCacheMetrics();
    expect(s).toHaveProperty('hit');
    expect(s).toHaveProperty('miss');
    expect(s).toHaveProperty('staleHit');
    expect(s).toHaveProperty('invalidations');
    expect(s).toHaveProperty('exported');
    expect(s).toHaveProperty('exportMsTotal');
    expect(s).toHaveProperty('staleThresholdMs');
  });
});
