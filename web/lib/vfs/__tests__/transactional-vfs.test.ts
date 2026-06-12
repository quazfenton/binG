/**
 * Unit tests for the transactional VFS layer (Bug #10, #25, #18).
 *
 * Covers:
 *   - readWithVersion returns { content, version }
 *   - writeWithVersion unconditional path (no expectedVersion)
 *   - writeWithVersion CAS retry on version mismatch (re-runs diffFn)
 *   - writeWithVersion TOCTOU retry passes the freshly-read expectedVersion
 *   - VersionMismatchError thrown after maxRetries exhausted
 *   - ConcurrentModificationError thrown in strict-concurrency mode
 *   - beginTransaction writes atomically (single batch)
 *   - beginTransaction rollback restores pre-tx snapshot
 *   - beginTransaction rollback deletes files that were created (not empty-writes)
 *   - beginTransaction first-failure triggers full rollback (no spurious warning)
 *   - Errors module re-exports the same classes as transactional-vfs
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the base VFS so we can drive version/conflict behavior deterministically.
// IMPORTANT: the production import in transactional-vfs.ts uses
// `@/lib/virtual-filesystem/index.server` because the client-safe
// `@/lib/virtual-filesystem/index.ts` intentionally omits `virtualFilesystem`.
// The mock must match the production import path.
const versionByPath = new Map<string, number>();
const contentByPath = new Map<string, string>();
let workspaceVersion = 0;
let flushBatchResult: { success: boolean; error?: string } = { success: true };
const deletedPaths: string[] = [];

// Default writeFile mock implementation. Extracted to module level so the
// initial `vi.mock` install and both beforeEach `mockReset` calls share a
// single source of truth (previously duplicated 3x). The function closes
// over the module-level `versionByPath` / `contentByPath` / `workspaceVersion`
// maps defined above, so vi.mocked(vfs.writeFile).mockImplementation(
// defaultWriteFileImpl) restores the canonical behavior.
async function defaultWriteFileImpl(
  ownerId: string,
  filePath: string,
  content: string,
  _language: string | undefined,
  options: any,
) {
  // NOTE: must use a named 5th parameter — `arguments` is not available
  // in arrow functions and would silently read `undefined` for the
  // options object, defeating the OCC check.
  const expectedVersion = options?.expectedVersion;
  const strictConcurrency = options?.strictConcurrency;
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
}


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
    writeFile: vi.fn(defaultWriteFileImpl),
    deletePath: vi.fn(async (ownerId: string, filePath: string) => {
      deletedPaths.push(filePath);
      versionByPath.delete(filePath);
      contentByPath.delete(filePath);
      return { deletedCount: 1 };
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
  Transaction,
  VersionMismatchError,
  ConcurrentModificationError,
} from '../transactional-vfs';
import {
  VersionMismatchError as ErrorsVersionMismatchError,
  ConcurrentModificationError as ErrorsConcurrentModificationError,
} from '../errors';

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
  beforeEach(async () => {
    versionByPath.clear();
    contentByPath.clear();
    workspaceVersion = 0;
    // Reset to the default writeFile mock (some tests in this block install
    // a custom mockImplementation that would otherwise persist into the
    // Transaction block below).
    const vfs = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
    vi.mocked(vfs.writeFile).mockReset();
    vi.mocked(vfs.writeFile).mockImplementation(defaultWriteFileImpl);
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
    // Simulate a concurrent writer: file is now at v2 but the caller
    // believes it's at v1 (the version they read before deciding to write).
    versionByPath.set('a.ts', 2);

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    let callCount = 0;
    realWrite.mockImplementation(async (_owner: string, p: string, content: string, lang?: string, opts?: any) => {
      callCount += 1;
      const currentVersion = versionByPath.get(p) ?? 0;
      if (typeof opts?.expectedVersion === 'number' && currentVersion !== opts.expectedVersion) {
        // Bump the version (simulate yet another concurrent writer slipping
        // in between our re-read and our retry).
        const bumped = currentVersion + 1;
        versionByPath.set(p, bumped);
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

    // First attempt: v2 != v1, mock bumps to v3 with OTHER-WRITER-3, throws.
    // Wrapper re-reads (v3, content OTHER-WRITER-3), updates baselineVersion=3,
    // calls diffFn(OTHER-WRITER-3\n). Second attempt: v3 == v3, succeeds.
    expect(callCount).toBe(2);
    expect(diffFn).toHaveBeenCalledWith('OTHER-WRITER-3\n');
    expect(f.content).toBe('appended-to: OTHER-WRITER-3');
    expect(f.version).toBe(4); // start 2 + 1 (mock bump) + 1 (our write)
  });

  it('CAS retry propagates freshly-read expectedVersion to next attempt (TOCTOU fix)', async () => {
    contentByPath.set('a.ts', 'old');
    versionByPath.set('a.ts', 2); // concurrent writer bumped from v1 to v2

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    const observedExpectedVersions: Array<number | undefined> = [];
    realWrite.mockImplementation(async (_owner: string, p: string, content: string, lang?: string, opts?: any) => {
      observedExpectedVersions.push(opts?.expectedVersion);
      const currentVersion = versionByPath.get(p) ?? 0;
      if (typeof opts?.expectedVersion === 'number' && currentVersion !== opts.expectedVersion) {
        // First attempt: bump and throw to force a retry.
        const bumped = currentVersion + 1;
        versionByPath.set(p, bumped);
        contentByPath.set(p, `RACE-${bumped}`);
        const err: any = new Error('mismatch');
        err.name = 'VersionMismatchError';
        throw err;
      }
      const newVersion = currentVersion + 1;
      versionByPath.set(p, newVersion);
      contentByPath.set(p, content);
      return { path: p, content, language: lang ?? 'text', size: content.length, version: newVersion, lastModified: '', createdAt: '' };
    });

    await writeWithVersion('owner-1', 'a.ts', 'new', {
      expectedVersion: 1, // caller read at v1
      diffFn: (cur) => `appended-to: ${cur}`,
      maxRetries: 3,
    });

    // The FIRST attempt should pass expectedVersion: 1 (what the caller read).
    // The SECOND attempt (after re-read) should pass the freshly-read version
    // (3, after the mock bumped 2 -> 3). This closes the TOCTOU window where
    // a third writer could slip in between re-read and retry.
    expect(observedExpectedVersions).toEqual([1, 3]);
  });

  it('throws VersionMismatchError when retries are exhausted', async () => {
    contentByPath.set('a.ts', 'x');
    // Mock that ALWAYS throws a real VersionMismatchError instance on every
    // attempt (real instance, not a plain Error with the same name, so
    // toBeInstanceOf works).
    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async () => {
      throw new VersionMismatchError('a.ts', 1, 99, 1, 'mismatch');
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

    // The mock must throw a real ConcurrentModificationError instance, not
    // a plain Error with a matching name, so the toBeInstanceOf check works.
    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (_o: string, _p: string) => {
      throw new ConcurrentModificationError('a.ts', 1, 100, 5);
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
  beforeEach(async () => {
    versionByPath.clear();
    contentByPath.clear();
    workspaceVersion = 0;
    flushBatchResult = { success: true };
    deletedPaths.length = 0;

    // Reset the writeFile mock to its default behavior. The previous describe
    // block ('writeWithVersion') sets custom mockImplementations that would
    // otherwise bleed into these tests (e.g. an always-throw mock would make
    // every unconditional write fail).
    const vfs = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem;
    vi.mocked(vfs.writeFile).mockReset();
    vi.mocked(vfs.writeFile).mockImplementation(defaultWriteFileImpl);
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

  it('rollback deletes files that were CREATED during the transaction (not empty-writes)', async () => {
    // c.ts does NOT exist at the start of the transaction. We make the
    // commit FAIL on c.ts so that rollback is triggered from inside
    // commit()'s catch handler — and the snapshot taken at the start of
    // commit() will have marked c.ts as `created: true` because it didn't
    // exist at snapshot time. Rollback must call deletePath (not writeFile
    // with empty content) to leave the workspace in its pre-tx state.
    deletedPaths.length = 0;

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (_o: string, p: string, _content: string) => {
      if (p === 'c.ts') {
        const err: any = new Error('boom');
        err.name = 'TestWriteError';
        throw err;
      }
      // Any other write (a.ts in the same tx) would succeed, but c.ts
      // throws first so the tx rolls back.
      const v = versionByPath.get(p) ?? 0;
      const newV = v + 1;
      versionByPath.set(p, newV);
      return { path: p, content: _content, language: 'text', size: _content.length, version: newV, lastModified: '', createdAt: '' };
    });

    const tx = beginTransaction('owner-1');
    tx.write('c.ts', 'CREATED');
    const r = await tx.commit();

    expect(r.success).toBe(false);
    // c.ts never made it into the workspace, so deletePath is the correct
    // restore step (the file never existed in the first place).
    expect(deletedPaths).toContain('c.ts');
    expect(contentByPath.has('c.ts')).toBe(false);
  });

  it('failed commit lands the state machine in rolled-back (not committed)', async () => {
    // After a failed commit, the transaction must end in 'rolled-back' state,
    // not 'committed'. We verify by checking that the next tx.write() throws
    // `/rolled-back/` (matches the new transient-state path) and that
    // `isOpen` is false.
    contentByPath.set('a.ts', 'PRE-A');
    versionByPath.set('a.ts', 1);

    const realWrite = (await import('@/lib/virtual-filesystem/index.server')).virtualFilesystem.writeFile as any;
    realWrite.mockImplementation(async (_o: string, p: string, content: string) => {
      if (p === 'a.ts') {
        const err: any = new Error('boom');
        err.name = 'TestWriteError';
        throw err;
      }
      const v = versionByPath.get(p) ?? 0;
      const newV = v + 1;
      versionByPath.set(p, newV);
      contentByPath.set(p, content);
      return { path: p, content, language: 'text', size: content.length, version: newV, lastModified: '', createdAt: '' };
    });

    const tx = beginTransaction('owner-1');
    tx.write('a.ts', 'POST-A');
    const r = await tx.commit();
    expect(r.success).toBe(false);

    // isOpen must be false (state is 'rolled-back', not 'open' or 'committed').
    expect(tx.isOpen).toBe(false);

    // Writing again must throw with the rolled-back message, NOT the
    // committed message. This is the load-bearing assertion: it proves
    // the state-flip bug (where state was set to 'committed' before work
    // completed, causing rollback to log a spurious warning) is fixed.
    expect(() => tx.write('x.ts', 'X')).toThrow(/rolled-back/);
  });

  it('error classes are re-exported from the shared errors module', () => {
    // The classes exported from `transactional-vfs` must be the SAME
    // identities as those from `./errors` (no duplicate definitions).
    expect(VersionMismatchError).toBe(ErrorsVersionMismatchError);
    expect(ConcurrentModificationError).toBe(ErrorsConcurrentModificationError);
  });
});
