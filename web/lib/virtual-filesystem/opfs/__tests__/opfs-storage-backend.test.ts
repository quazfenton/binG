/**
 * Tests for the OPFS storage backend.
 *
 * Focus: data-loss regressions in the merge / delete / fallback paths.
 * The full OPFS interface is stubbed; we exercise only the bits that
 * matter for the sticky-mechanism and orphan-merge behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OPFSStorageBackend } from '../opfs-storage-backend';

const mocks = vi.hoisted(() => {
  const opfsCore = {
    initialize: vi.fn(async () => undefined),
    readFile: vi.fn(),
    writeFile: vi.fn(async () => undefined),
    listDirectory: vi.fn(),
    fileExists: vi.fn(),
    clear: vi.fn(async () => undefined),
  };
  const idbBackend = {
    isInitialized: vi.fn(() => true),
    initialize: vi.fn(async () => undefined),
    readFile: vi.fn(),
    listDirectory: vi.fn(),
    writeFile: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  return { opfsCore, idbBackend };
});

vi.mock('../opfs-core', () => ({
  opfsCore: mocks.opfsCore,
}));

vi.mock('../../indexeddb-backend', () => ({
  indexedDBBackend: mocks.idbBackend,
  IndexedDBBackend: class {},
}));

describe('OPFSStorageBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide minimal browser globals that the SUT touches.
    if (typeof (globalThis as any).window === 'undefined') {
      const store = new Map<string, string>();
      (globalThis as any).window = {
        localStorage: {
          getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear(),
        },
        navigator: {
          storage: { getDirectory: () => ({}) },
        },
      };
    } else {
      window.localStorage.clear();
    }
    // Default: OPFS supported
    (OPFSStorageBackend as any).isSupported = () => true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not probe the other backend when primary is non-empty (sticky behavior)', async () => {
    // OPFS has the metadata + 1 file
    mocks.opfsCore.readFile.mockResolvedValue({
      content: JSON.stringify({ version: 1, updatedAt: 'x', fileCount: 1 }),
    });
    mocks.opfsCore.listDirectory.mockResolvedValue([
      { name: 'index.ts', type: 'file', path: 'index.ts', lastModified: 1 },
    ]);
    mocks.opfsCore.fileExists.mockResolvedValue(true);

    const backend = new OPFSStorageBackend();
    // First load — sticky is empty, primary has 1 file, so the merge
    // check `primary.files.size > 0` early-returns and we never probe IDB.
    const first = await backend.loadWorkspace('owner-A');
    expect(first.files.size).toBe(1);
    expect(mocks.idbBackend.listDirectory).not.toHaveBeenCalled();

    // Second load — sticky is now set, same behaviour.
    mocks.idbBackend.listDirectory.mockClear();
    const second = await backend.loadWorkspace('owner-A');
    expect(mocks.idbBackend.listDirectory).not.toHaveBeenCalled();
    expect(second.files.size).toBe(1);
  });

  it('sets the sticky to IDB when OPFS throws and probes OPFS as the other side', async () => {
    // First OPFS init call throws; subsequent ones succeed (probed by
    // maybeMergeFromOtherBackend).
    mocks.opfsCore.initialize.mockRejectedValueOnce(new Error('opfs denied'));
    // IDB has no data.
    mocks.idbBackend.listDirectory.mockResolvedValue([]);
    // OPFS (probed in the merge step) returns 1 file.
    mocks.opfsCore.readFile.mockResolvedValue({
      content: JSON.stringify({ version: 1, updatedAt: 'x', fileCount: 1 }),
    });
    mocks.opfsCore.listDirectory.mockResolvedValue([
      { name: 'a.ts', type: 'file', path: 'a.ts', lastModified: 1 },
    ]);

    const backend = new OPFSStorageBackend();
    const state = await backend.loadWorkspace('owner-A');
    // The sticky key must point at IDB so future loads skip OPFS first.
    expect(
      (globalThis as any).window.localStorage.getItem('vfs-active-backend:owner-A'),
    ).toBe('indexeddb');
    // The merge step pulled the OPFS file into the empty IDB primary.
    expect(state.files.size).toBe(1);
  });

  it('merges orphans from the other backend into an empty primary (newer wins)', async () => {
    // Primary = OPFS, and it starts EMPTY (no metadata, no files).
    mocks.opfsCore.readFile.mockRejectedValue(new Error('no metadata'));
    mocks.opfsCore.listDirectory.mockResolvedValue([]);

    // Other = IDB, and it has 1 file with a NEW timestamp.
    mocks.idbBackend.listDirectory.mockResolvedValue([
      {
        path: 'a.ts',
        content: '',
        language: 'ts',
        lastModified: '2025-01-01T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        version: 1,
        size: 0,
      },
    ]);
    mocks.idbBackend.readFile.mockResolvedValue({
      path: 'a.ts',
      content: 'NEWER',
      language: 'ts',
      lastModified: '2025-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      version: 1,
      size: 6,
    });

    const backend = new OPFSStorageBackend();
    const state = await backend.loadWorkspace('owner-A');
    // The merge pulled the IDB file into the empty OPFS primary.
    expect(state.files.size).toBe(1);
    expect(state.files.get('a.ts')?.content).toBe('NEWER');
  });

  it('deleteWorkspace clears BOTH backends and removes the sticky key', async () => {
    (globalThis as any).window.localStorage.setItem('vfs-active-backend:owner-A', 'opfs');
    const backend = new OPFSStorageBackend();
    await backend.deleteWorkspace('owner-A');
    expect(mocks.opfsCore.clear).toHaveBeenCalledOnce();
    expect(mocks.idbBackend.clear).toHaveBeenCalledWith('owner-A');
    expect((globalThis as any).window.localStorage.getItem('vfs-active-backend:owner-A')).toBeNull();
  });

  it('deleteWorkspace throws AggregateError if a backend fails', async () => {
    mocks.opfsCore.clear.mockRejectedValueOnce(new Error('opfs gone'));
    const backend = new OPFSStorageBackend();
    await expect(backend.deleteWorkspace('owner-A')).rejects.toBeInstanceOf(
      AggregateError,
    );
  });

  it('workspaceExists does not recurse infinitely when IDB also fails', async () => {
    mocks.opfsCore.initialize.mockRejectedValue(new Error('opfs down'));
    mocks.idbBackend.listDirectory.mockRejectedValue(new Error('idb down'));
    // Make isSupported() return true so we don't short-circuit at the
    // OPFS-unavailable branch.
    (OPFSStorageBackend as any).isSupported = () => true;
    const backend = new OPFSStorageBackend();
    // This MUST terminate and return false (no infinite loop).
    const exists = await backend.workspaceExists('owner-A');
    expect(exists).toBe(false);
  });
});
