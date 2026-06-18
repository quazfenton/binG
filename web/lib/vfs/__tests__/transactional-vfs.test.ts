/**
 * Unit tests for the transactional VFS layer (Bug #10, #25, #18).
 *
 * Covers:
 *   - readWithVersion returns { content, version }
 *   - writeWithVersion unconditional path (no expectedVersion)
 *   - writeWithVersion CAS retry on version mismatch (re-runs diffFn)
 *   - VersionMismatchError thrown after maxRetries exhausted
 *   - ConcurrentModificationError thrown in strict-concurrency mode
 *   - beginTransaction writes atomically (single batch)
 *   - beginTransaction rollback restores pre-tx snapshot
 *   - beginTransaction first-failure triggers full rollback
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the base VFS so we can drive version/conflict behavior deterministically.
const versionByPath = new Map<string, number>();
const contentByPath = new Map<string, string>();
let workspaceVersion = 0;
let flushBatchResult: { success: boolean; error?: string } = { success: true };

vi.mock('@/lib/virtual-filesystem/index.server', () => ({
  virtualFilesystem: {
    readFile: vi.fn(async (ownerId: string, filePath: string) => {
      const v = versionByPath.get(filePath) ?? 0;
      if (!contentByPath.has(filePath) && v === 0) {
        throw new Error(`File not found: ${filePath}`);
      }
      return {
        path: filePath,
        content: contentByPath.get(filePath) ?? '',
        language: 'text',
        size: (contentByPath.get(filePath) ?? '').length,
        version: v,
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    }),
    writeFile: vi.fn(async (ownerId: string, filePath: string, content: string, lang?: string, opts?: any) => {
      const expectedVersion = opts?.expectedVersion;
      const strictConcurrency = opts?.strictConcurrency;
      const currentVersion = versionByPath.get(filePath) ?? 0;

      // Bug #25: strict-concurrency block
      if (strictConcurrency && currentVersion > 0) {
        const err: any = new Error(`Potential concurrent modification blocked for ${filePath}`);
        err.name = 'ConcurrentModificationError';
        err.path = filePath;
        err.previousVersion = currentVersion;
        throw err;
      }

      // Bug #10: optimistic-concurrency check
      if (typeof expectedVersion === 'number' && currentVersion !== expectedVersion) {
        const err: any = new Error(`Version mismatch for ${filePath}`);
        err.name = 'VersionMismatchError';
        err.path = filePath;
        err.expectedVersion = expectedVersion;
        err.actualVersion = currentVersion;
        err.attempts = 1;
        throw err;
      }

      const newVersion = currentVersion + 1;
      versionByPath.set(filePath, newVersion);
      contentByPath.set(filePath, content);
      workspaceVersion += 1;
      return {
        path: filePath,
        content,
        language: 'text',
        size: content.length,
        version: newVersion,
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    }),
    getWorkspaceVersion: vi.fn(async () => workspaceVersion),
    forOwner: vi.fn(() => ({
      enableBatchMode: vi.fn(),
      disableBatchMode: vi.fn(),
      flushBatch: vi.fn(async () => flushBatchResult),
    })),
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Now import the module under test (after mocks are set up)
import {
  readWithVersion,
  writeWithVersion,
  beginTransaction,
  VersionMismatchError,
  ConcurrentModificationError,
} from '../transactional-vfs';

describe('transactional-vfs: readWithVersion', () => {
  beforeEach(() => {
    versionByPath.clear();
    contentByPath.clear();
    workspaceVersion = 0;
  });

  it('returns { content, version, path, lastModified }', async () => {
    contentByPath.set('a.ts', 'hello');
    versionByPath.set('a.ts', 7);
    const r = await readWithVersion('owner-1', 'a.ts');
    expect(r.content).toBe('hello');
    expect(r.version).toBe(7);
    expect(r.path).toBe('a.ts');
    expect(typeof r.lastModified).toBe('string');
  });
});

describe('transactional-vfs: writeWithVersion', () => {
  beforeEach(() => {
    versionByPath.clear();
    contentByPath.clear();
    workspaceVersion = 0;
  });

  it('unconditional write (no expectedVersion) writes and bumps version', async () => {
    const f = await writeWithVersion('owner-1', 'a.ts', 'hello');
    expect(f.version).toBe(1);
    expect(f.content).toBe('hello');
  });

  it('CAS write succeeds when version matches', async () => {
    contentByPath.set('a.ts', 'old');
    versionByPath.set('a.ts', 3);
    const f = await writeWithVersion('owner-1', 'a.ts', 'new', {
      expectedVersion: 3,
      diffFn: () => 'new',
    });
    expect(f.version).toBe(4);
    expect(f.content).toBe('new');
  });

  it('CAS retry re-runs diffFn when version changes between read and write', async () => {
    contentByPath.set('a.ts', 'line1\nline2\n');
    versionByPath.set('a.ts', 1);

    // Pre-bump the version to simulate a concurrent write that the read missed.
    // The mocked writeFile throws on mismatch; the wrapper must re-read and re-apply.
    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    let callCount = 0;
    realWrite.mockImplementation(async (_owner: string, p: string, content: string, lang?: string, opts?: any) => {
      callCount += 1;
      const currentVersion = versionByPath.get(p) ?? 0;
      if (typeof opts?.expectedVersion === 'number' && currentVersion !== opts.expectedVersion) {
        // Bump the version (simulate another writer between our read and write)
        const bumped = currentVersion + 1;
        versionByPath.set(p, bumped);
        // Refresh content the "other writer" would have produced
        contentByPath.set(p, `OTHER-WRITER-${bumped}\n`);
        const err: any = new Error('mismatch');
        err.name = 'VersionMismatchError';
        throw err;
      }
      const newVersion = currentVersion + 1;
      versionByPath.set(p, newVersion);
      contentByPath.set(p, content);
      return {
        path: p,
        content,
        language: lang ?? 'text',
        size: content.length,
        version: newVersion,
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    });

    const diffFn = vi.fn((cur: string) => `appended-to: ${cur.trim()}`);

    const f = await writeWithVersion('owner-1', 'a.ts', 'never-used-initial', {
      expectedVersion: 1,
      diffFn,
      maxRetries: 3,
    });

    // After 1 retry, diffFn should have been called with the OTHER writer's content.
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(diffFn).toHaveBeenCalledWith(`OTHER-WRITER-2\n`);
    expect(f.content).toBe(`appended-to: OTHER-WRITER-2`);
    expect(f.version).toBe(3); // initial 1 + 1 other-writer bump + 1 our-write
  });

  it('throws VersionMismatchError when retries are exhausted', async () => {
    contentByPath.set('a.ts', 'x');
    versionByPath.set('a.ts', 1);

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (_o: string, p: string, content: string, lang?: string, opts?: any) => {
      const v = versionByPath.get(p) ?? 0;
      if (typeof opts?.expectedVersion === 'number' && v !== opts.expectedVersion) {
        const bumped = v + 1;
        versionByPath.set(p, bumped);
        contentByPath.set(p, `OTHER-${bumped}`);
        const err: any = new Error('mismatch');
        err.name = 'VersionMismatchError';
        throw err;
      }
      const newVersion = v + 1;
      versionByPath.set(p, newVersion);
      contentByPath.set(p, content);
      return { path: p, content, language: lang ?? 'text', size: content.length, version: newVersion, lastModified: '', createdAt: '' };
    });

    await expect(
      writeWithVersion('owner-1', 'a.ts', 'init', {
        expectedVersion: 1,
        diffFn: () => 'anything',
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('throws when diffFn is required but missing', async () => {
    await expect(
      writeWithVersion('owner-1', 'a.ts', 'x', { expectedVersion: 0 }),
    ).rejects.toThrow(/diffFn is required/);
  });

  it('propagates ConcurrentModificationError without retry', async () => {
    contentByPath.set('a.ts', 'x');
    versionByPath.set('a.ts', 5);

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (_o: string, _p: string) => {
      // Throw a real ConcurrentModificationError instance so the test's
      // `toBeInstanceOf(ConcurrentModificationError)` assertion holds.  The
      // source's writeWithVersion re-throws on `err.name === 'ConcurrentModificationError'`
      // without wrapping, so the original error class must match.
      // Constructor: (path, timeSinceLastWrite, threshold, previousVersion)
      throw new ConcurrentModificationError('a.ts', 0, 100, 5);
    });

    await expect(
      writeWithVersion('owner-1', 'a.ts', 'x', {
        expectedVersion: 5,
        diffFn: () => 'x',
        strictConcurrency: true,
      }),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });
});

describe('transactional-vfs: Transaction', () => {
  beforeEach(() => {
    versionByPath.clear();
    contentByPath.clear();
    workspaceVersion = 0;
    flushBatchResult = { success: true };
  });

  it('commit() runs all queued edits and flushes a single batch', async () => {
    const tx = beginTransaction('owner-1');
    tx.write('a.ts', 'A');
    tx.write('b.ts', 'B');
    expect(tx.size).toBe(2);

    const r = await tx.commit();
    expect(r.success).toBe(true);
    expect(r.committed).toBe(2);
    expect(r.failed).toBe(0);
    expect(contentByPath.get('a.ts')).toBe('A');
    expect(contentByPath.get('b.ts')).toBe('B');
  });

  it('rollback() restores pre-tx snapshot for files that were edited', async () => {
    contentByPath.set('a.ts', 'PRE-A');
    versionByPath.set('a.ts', 1);
    contentByPath.set('b.ts', 'PRE-B');
    versionByPath.set('b.ts', 1);

    const tx = beginTransaction('owner-1');
    tx.write('a.ts', 'POST-A');
    tx.write('b.ts', 'POST-B');
    await tx.rollback();

    // After rollback, files should be back to PRE values
    expect(contentByPath.get('a.ts')).toBe('PRE-A');
    expect(contentByPath.get('b.ts')).toBe('PRE-B');
    expect(tx.isOpen).toBe(false);
  });

  it('first-failure during commit triggers full rollback', async () => {
    contentByPath.set('a.ts', 'PRE-A');
    versionByPath.set('a.ts', 1);
    contentByPath.set('b.ts', 'PRE-B');
    versionByPath.set('b.ts', 1);

    // Make the second write fail with version mismatch
    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (owner: string, p: string, content: string, lang?: string, opts?: any) => {
      if (p === 'b.ts' && opts?.expectedVersion !== undefined) {
        // Force mismatch
        const err: any = new Error('mismatch');
        err.name = 'VersionMismatchError';
        throw err;
      }
      // For unconditional path (a.ts), proceed normally
      const currentVersion = versionByPath.get(p) ?? 0;
      const newVersion = currentVersion + 1;
      versionByPath.set(p, newVersion);
      contentByPath.set(p, content);
      return { path: p, content, language: lang ?? 'text', size: content.length, version: newVersion, lastModified: '', createdAt: '' };
    });

    const tx = beginTransaction('owner-1');
    tx.write('a.ts', 'POST-A');
    tx.write('b.ts', 'POST-B', { expectedVersion: 99, diffFn: () => 'POST-B' });
    const r = await tx.commit();

    expect(r.success).toBe(false);
    expect(r.failed).toBeGreaterThan(0);
    // a.ts was changed to POST-A but should be restored to PRE-A by rollback
    expect(contentByPath.get('a.ts')).toBe('PRE-A');
  });

  it('rejects writes after commit()', async () => {
    const tx = beginTransaction('owner-1');
    await tx.commit();
    expect(() => tx.write('x.ts', 'X')).toThrow(/committed/);
  });

  it('rejects writes after rollback()', async () => {
    const tx = beginTransaction('owner-1');
    await tx.rollback();
    expect(() => tx.write('x.ts', 'X')).toThrow(/rolled-back/);
  });

  it('rollback is idempotent (safe to call multiple times)', async () => {
    const tx = beginTransaction('owner-1');
    await tx.rollback();
    await tx.rollback(); // no throw
  });

  // ========================================================================
  // Pass-X: HMR-protective guards (chat-loop bug regression).
  //
  // Root cause: under Next.js HMR (Turbopack circular dep between
  // git-backed-vfs.ts and virtual-filesystem-service.ts), the cached Map at
  // globalThis.__gitVFSInstances__ can transiently resolve
  // `virtualFilesystem.forOwner(ownerId)` to undefined or to a detached
  // instance lacking `enableBatchMode` / `disableBatchMode` /
  // `flushBatch`. The fix in git-backed-vfs.ts heals the poisoned cache;
  // the four defensive guards in transactional-vfs.ts make commit &
  // rollback tolerant of detached instances so the per-chat-API WARN
  // is silenced at the source.
  // ========================================================================
  describe('Pass-X: HMR-detached GitBackedVFS tolerance', () => {
    // CRITICAL: snapshot the original `forOwner` mock so afterEach can
    // restore it. Without this restore, each test's per-test mock override
    // leaks into sibling describes (the existing 'commit() runs all queued
    // edits' assertion relies on the default mock returning a stub with
    // enableBatchMode/flushBatch), silently breaking unrelated tests.
    let originalForOwner: any;

    beforeEach(async () => {
      const realVFS = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
      originalForOwner = (realVFS as any).forOwner;
    });

    afterEach(async () => {
      const realVFS = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
      (realVFS as any).forOwner = originalForOwner;
    });

    it('commit does NOT throw when forOwner returns undefined (poisoned-cache recovery)', async () => {
      const realVFS = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
      (realVFS as any).forOwner = vi.fn(() => undefined);

      const tx = beginTransaction('owner-hmr-1');
      tx.write('a.ts', 'A');
      const r = await tx.commit();
      // Commit completed despite HMR-detached gitVFS — writes fell through
      // to per-write auto-commit (degraded mode, but no TypeError).
      expect(r).toBeDefined();
      expect(r.failed).toBe(0);
      expect(contentByPath.get('a.ts')).toBe('A');
    });

    it('commit does NOT throw when forOwner returns object missing enableBatchMode (detached-prototype recovery)', async () => {
      const realVFS = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
      // Detached instance: exists, but lacks the class-immutable methods
      // that would normally survive HMR-class-identity changes.
      (realVFS as any).forOwner = vi.fn(() => ({
        // no enableBatchMode, no disableBatchMode, no flushBatch
      }));

      const tx = beginTransaction('owner-hmr-2');
      tx.write('a.ts', 'A');
      const r = await tx.commit();
      expect(r).toBeDefined();
      expect(r.failed).toBe(0);
      expect(contentByPath.get('a.ts')).toBe('A');
    });

    it('rollback does NOT throw when forOwner returns undefined during batch exit', async () => {
      const realVFS = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
      (realVFS as any).forOwner = vi.fn(() => undefined);

      const tx = beginTransaction('owner-hmr-3');
      tx.write('a.ts', 'A');
      // Rollback must complete even if the batch-exit fails silently.
      await expect(tx.rollback()).resolves.toBeUndefined();
      expect(tx.isOpen).toBe(false);
    });
  });
});
