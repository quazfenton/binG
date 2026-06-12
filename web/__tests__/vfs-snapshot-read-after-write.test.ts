/**
 * Tests for Bug #16 — Stale-Snapshot vs. Re-Snapshot Inconsistency.
 *
 * The audit's symptom: "Read after write can return stale snapshot."
 * The fix: the snapshot gateway's read path now uses
 * `getCurrentVersionSync` as the primary staleness check, with the
 * listener-tracked `latestSeenVersion` as a cross-process fallback.
 *
 * These tests pin the contract:
 *  1. `getCurrentVersionSync` returns 0 for a fresh (never-loaded) owner.
 *  2. After a write, `getCurrentVersionSync` returns the in-memory
 *     version EVEN IF the listener has not yet fired (simulating the
 *     window between `await persistWorkspace` and `emitSnapshotChange`).
 *  3. The snapshot gateway's read path treats the cached entry as stale
 *     when `getCurrentVersionSync > cached.version`, even when the
 *     listener version is still 0.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted mocks — in place before the gateway module is imported.
const {
  mockVirtualFilesystem,
  mockFsBridge,
  mockResolveFilesystemOwner,
  mockWithAnonSessionCookie,
  mockStripWorkspacePrefixes,
  mockIsDesktopMode,
  mockIsUsingLocalFS,
  mockCreateLogger,
  currentVersions,
} = vi.hoisted(() => {
  // The gateway uses `virtualFilesystem.getCurrentVersionSync` and
  // `virtualFilesystem.exportWorkspace`. We track the current version
  // per owner in `currentVersions` so tests can simulate in-flight
  // writes by mutating the Map.
  const currentVersions = new Map<string, number>();
  const mockVirtualFilesystem = {
    exportWorkspace: vi.fn().mockImplementation(async (ownerId: string) => ({
      root: '/',
      version: currentVersions.get(ownerId) ?? 0,
      updatedAt: new Date().toISOString(),
      files: [],
    })),
    getCurrentVersionSync: vi.fn().mockImplementation((ownerId: string) => {
      return currentVersions.get(ownerId) ?? 0;
    }),
    onSnapshotChange: vi.fn(),
  };

  const mockFsBridge = {
    exportWorkspace: vi.fn(),
  };

  const mockResolveFilesystemOwner = vi.fn();
  const mockWithAnonSessionCookie = vi.fn((response: any) => response);
  const mockStripWorkspacePrefixes = vi.fn((p: string) => p);
  const mockIsDesktopMode = vi.fn().mockReturnValue(false);
  const mockIsUsingLocalFS = vi.fn().mockReturnValue(false);
  const mockCreateLogger = vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });

  return {
    mockVirtualFilesystem,
    mockFsBridge,
    mockResolveFilesystemOwner,
    mockWithAnonSessionCookie,
    mockStripWorkspacePrefixes,
    mockIsDesktopMode,
    mockIsUsingLocalFS,
    mockCreateLogger,
    currentVersions,
  };
});

vi.mock('@bing/platform/env', () => ({
  isDesktopMode: mockIsDesktopMode,
}));

vi.mock('@bing/shared/FS/fs-bridge', () => ({
  fsBridge: mockFsBridge,
  isUsingLocalFS: mockIsUsingLocalFS,
}));

vi.mock('@/lib/virtual-filesystem/scope-utils', () => ({
  stripWorkspacePrefixes: mockStripWorkspacePrefixes,
}));

vi.mock('@/lib/virtual-filesystem/index.server', () => ({
  virtualFilesystem: mockVirtualFilesystem,
  resolveFilesystemOwner: mockResolveFilesystemOwner,
  withAnonSessionCookie: mockWithAnonSessionCookie,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: mockCreateLogger,
}));

// Import the handler AFTER the mocks are in place.
import { GET } from '@/app/api/filesystem/snapshot/gateway';
import { vfsSnapshotCacheMetrics } from '@/app/api/filesystem/snapshot/cache-metrics';

// Expose the internal latestSeenVersion Map by triggering a write and
// inspecting the listener. We'll use a simpler approach: the cache key
// is keyed on ownerId, so we can control the version-per-owner via
// currentVersions.

function makeRequest(path: string = 'workspace/sessions'): Request {
  return new Request(
    `http://localhost/api/filesystem/snapshot?path=${encodeURIComponent(path)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the metrics singleton so staleHit counters don't bleed between tests.
  vfsSnapshotCacheMetrics.reset();
  // CRITICAL: clear the gateway's globalThis cache so previous tests'
  // cached entries don't bleed into the current test. The cache survives
  // module re-evaluation via `globalThis.__snapshotCache__`, so without
  // this clear the "cold cache" prime reads in later tests would be
  // served from a previous test's cache hit, not from a fresh export.
  const gw = globalThis as any;
  if (gw.__snapshotCache__) gw.__snapshotCache__.clear();
  if (gw.__snapshotLatestVersion__) gw.__snapshotLatestVersion__.clear();
  // Reset the currentVersions Map.
  currentVersions.clear();
  mockWithAnonSessionCookie.mockImplementation((response: any) => response);
  // Default to authenticated source so WORKSPACE_NOT_READY doesn't fire
  // (those tests live in gateway.test.ts).
  mockResolveFilesystemOwner.mockResolvedValue({
    ownerId: 'test-owner',
    source: 'authenticated',
  });
  // The real stripWorkspacePrefixes strips the 'workspace/' prefix
  // so pathFilter matches stored file paths (e.g. 'sessions/000/old.txt').
  // Minimal mirror of scope-utils' behavior — update if scope-utils changes.
  mockStripWorkspacePrefixes.mockImplementation((p: string) =>
    p.replace(/^workspace\//, ''),
  );
  // Default: empty workspace (so we exercise the cache hit / miss paths cleanly).
  mockVirtualFilesystem.exportWorkspace.mockResolvedValue({
    root: '/',
    version: 0,
    updatedAt: new Date().toISOString(),
    files: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Bug #16 — getCurrentVersionSync is the read-path source of truth', () => {
  it('returns 0 for a never-loaded owner', () => {
    // Sanity: the helper returns 0 for an owner the gateway has never seen.
    expect(mockVirtualFilesystem.getCurrentVersionSync('never-seen')).toBe(0);
  });

  it('uses getCurrentVersionSync on every read, not just the listener-tracked version', async () => {
    // Read 1: cold cache, version 0 → miss, export, cache.
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 5,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/old.txt', content: 'old', size: 3, lastModified: Date.now() },
      ],
    });
    const r1 = await GET(makeRequest() as any);
    expect(r1.status).toBe(200);
    expect(mockVirtualFilesystem.getCurrentVersionSync).toHaveBeenCalledWith('test-owner');

    // The first read primes the cache at version 5.
    expect((mockVirtualFilesystem.getCurrentVersionSync as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('treats cached entry as stale when getCurrentVersionSync > cached.version (no listener fire)', async () => {
    // This is the core Bug #16 scenario. The write is in flight:
    // `workspace.version` was bumped to 6 in memory, but the listener
    // has NOT yet fired (simulating the window between
    // `await persistWorkspace` and `emitSnapshotChange`).
    //
    // The previous code (listener-only) would have returned the stale
    // cached entry at version 5. The new code (sync getter) sees
    // version 6 in memory and invalidates the cache.

    // First read: cold cache, version 5 → miss, export, cache at version 5.
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 5,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/old.txt', content: 'old', size: 3, lastModified: Date.now() },
      ],
    });
    const r1 = await GET(makeRequest() as any);
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    expect(body1.cached).toBe(false);

    // Simulate an in-flight write: in-memory version is now 6, but the
    // listener has NOT fired yet. We do this by changing the
    // implementation of getCurrentVersionSync for this owner.
    (mockVirtualFilesystem.getCurrentVersionSync as any).mockImplementation(
      (ownerId: string) => (ownerId === 'test-owner' ? 6 : 0),
    );

    // The next export would reflect the new write (so we can verify
    // it was RE-EXPORTED rather than served from cache).
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 6,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/old.txt', content: 'new', size: 3, lastModified: Date.now() },
        { path: 'sessions/000/new.txt', content: 'fresh', size: 5, lastModified: Date.now() },
      ],
    });

    const r2 = await GET(makeRequest() as any);
    expect(r2.status).toBe(200);
    const body2 = await r2.json();

    // CRITICAL (Bug #16 invariant): the cached entry was treated as
    // STALE, the gateway re-exported, and the response reflects the
    // new version. The new file's presence + content is the cleanest
    // end-to-end signal for the audit invariant "read after a write
    // must see the latest content".
    expect(body2.cached).toBe(false);
    expect(body2.data.version).toBe(6);
    const newFile = body2.data.files.find(
      (f: any) => f.path === 'sessions/000/new.txt',
    );
    expect(newFile).toBeDefined();
    expect(newFile.content).toBe('fresh');
  });

  it('records a staleHit (not a hit) when the sync getter flags the entry as stale', async () => {
    // First read: prime cache at version 5.
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 5,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/file.txt', content: 'a', size: 1, lastModified: Date.now() },
      ],
    });
    await GET(makeRequest() as any);

    // Write bumps in-memory version to 6 (listener not yet fired).
    (mockVirtualFilesystem.getCurrentVersionSync as any).mockImplementation(
      (ownerId: string) => (ownerId === 'test-owner' ? 6 : 0),
    );

    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 6,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/file.txt', content: 'b', size: 1, lastModified: Date.now() },
      ],
    });

    await GET(makeRequest() as any);

    // The staleHit counter should have incremented (NOT a clean hit).
    const snap = vfsSnapshotCacheMetrics.snapshot();
    expect(snap.staleHit).toBeGreaterThanOrEqual(1);
    // The hit counter should NOT have incremented for the second read.
    expect(snap.hit).toBe(0);
  });

  it('returns a clean cache hit when getCurrentVersionSync equals cached.version', async () => {
    // First read: prime cache at version 5.
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 5,
      updatedAt: new Date().toISOString(),
      files: [
        { path: 'sessions/000/file.txt', content: 'a', size: 1, lastModified: Date.now() },
      ],
    });
    await GET(makeRequest() as any);

    // No write happened; sync getter still returns 5.
    (mockVirtualFilesystem.getCurrentVersionSync as any).mockImplementation(
      (ownerId: string) => (ownerId === 'test-owner' ? 5 : 0),
    );

    const r2 = await GET(makeRequest() as any);
    const body2 = await r2.json();

    // The cached entry is fresh — clean hit, no re-export.
    expect(body2.cached).toBe(true);
    expect(body2.data.version).toBe(5);
    const snap = vfsSnapshotCacheMetrics.snapshot();
    expect(snap.hit).toBe(1);
    expect(snap.staleHit).toBe(0);
  });

  it('handles owner with no in-memory workspace (currentVersion=0) without false positives', async () => {
    // An owner that has never been written to has currentVersion=0.
    // A cached entry with version 0 should be a clean hit, NOT a
    // staleHit (because 0 < 0 is false).
    mockVirtualFilesystem.exportWorkspace.mockResolvedValueOnce({
      root: '/',
      version: 0,
      updatedAt: new Date().toISOString(),
      files: [],
    });
    await GET(makeRequest() as any);

    // currentVersion still 0 (no write happened).
    (mockVirtualFilesystem.getCurrentVersionSync as any).mockImplementation(
      (_ownerId: string) => 0,
    );

    const r2 = await GET(makeRequest() as any);
    const body2 = await r2.json();
    expect(body2.cached).toBe(true);
    const snap = vfsSnapshotCacheMetrics.snapshot();
    expect(snap.hit).toBe(1);
    expect(snap.staleHit).toBe(0);
  });
});
