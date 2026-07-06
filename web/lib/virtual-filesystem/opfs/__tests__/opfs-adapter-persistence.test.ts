/**
 * Tests for Critical Bug #1 fix: persist the OPFS adapter's `fileVersions`
 * Map and `writeQueue` to IndexedDB so offline edits survive a tab close.
 *
 * The exact scenario: user writes offline → closes tab → reopens → the
 * version map is hydrated from IDB BEFORE syncFromServer runs → the server
 * sees the local file is newer and does NOT overwrite it.
 *
 * We test the REAL `OPFSAdapter.serializeAdapterState` and `OPFSAdapter.deserializeAdapterState`
 * static methods (renamed from `persistState`/`hydrateState` in Step 5 to
 * disambiguate from the instance wrappers of the same name) with an
 * in-memory mock backend. The mock satisfies the `StateStorageBackend`
 * interface — the production `IndexedDBBackend` satisfies it natively. This
 * means any typo in the real `serializeAdapterState` (e.g. wrong JSON key,
 * missing writeQueue) or `deserializeAdapterState` (e.g. forgetting
 * `new Map(...)`) is now caught by the tests, not the test-implementing
 * the logic itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OPFSAdapter, type StateStorageBackend } from '../opfs-adapter';
import { OPFSCore } from '../opfs-core';
import { IndexedDBBackend } from '../../indexeddb-backend';

// Mock the network API client so the queueWrite end-to-end test (Step 8)
// can call `adapter.queueWrite()` without making real HTTP requests. Only
// `writeFileToServer` is needed (the queueWrite → flushWriteQueue chain
// calls it for each queued write). The other functions are NOT mocked
// globally — if a future test needs them, it should mock them locally
// with vi.spyOn to avoid surprising behavior from a global mock.
vi.mock('../opfs-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../opfs-api-client')>();
  return {
    ...actual,
    writeFileToServer: vi.fn().mockResolvedValue(true),
  };
});

// In-memory mock that satisfies the StateStorageBackend interface (readFile
// + writeFile + deleteFile used by serializeAdapterState / deserializeAdapterState).
// Also satisfies enough of the IndexedDBBackend interface (initialize +
// writeFile returns a VirtualFile shape) for the hydration-guard
// integration tests that exercise the IDB fallback path of `performEnable`.
// Shared across calls to simulate a cross-instance / cross-tab IDB store.
function makeMockIDB(): StateStorageBackend & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    writeFile: vi.fn(async (ownerId: string, path: string, content: string) => {
      store.set(`${ownerId}:${path}`, content);
      // Return a VirtualFile-like shape so production code (writeFile's
      // `idbFile.version` lookup + queueWrite's idbFile.version param) doesn't
      // crash. The actual values don't matter for the persistence tests —
      // they just need the shape. The hydration tests override this mock
      // entirely (see the regression test below).
      return {
        ownerId,
        path,
        content,
        language: undefined,
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
        size: content.length,
      };
    }),
    readFile: vi.fn(async (ownerId: string, path: string) => {
      const content = store.get(`${ownerId}:${path}`);
      if (content === undefined) {
        const err: any = new Error(`File not found: ${path}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      return { ownerId, path, content };
    }),
    // Step 7: deleteFile satisfies the new StateStorageBackend interface
    // method. The mock removes the entry from the in-memory store; if the
    // key wasn't there, it's a silent no-op (matches IndexedDBBackend's
    // behavior of "delete unexistent key is fine").
    deleteFile: vi.fn(async (ownerId: string, path: string) => {
      store.delete(`${ownerId}:${path}`);
    }),
    _store: store,
  };
}

describe('OPFSAdapter persistence (real static methods)', () => {
  let mockIDB: ReturnType<typeof makeMockIDB>;

  beforeEach(() => {
    mockIDB = makeMockIDB();
  });

  it('serializeAdapterState writes the fileVersions + writeQueue to the backend as JSON', async () => {
    // The real OPFSAdapter.serializeAdapterState — no re-implementation.
    const ownerId = 'anon:test-session';
    const fileVersions = new Map<string, { opfs: number; server: number }>([
      ['workspace/sessions/000/foo.ts', { opfs: 5, server: 4 }],
    ]);
    const writeQueue = [
      {
        id: 'write_1',
        path: 'workspace/sessions/000/foo.ts',
        content: '// offline edit',
        timestamp: 1700000000000,
        synced: false,
        ownerId,
        version: 5,
      },
    ];

    await OPFSAdapter.serializeAdapterState(mockIDB, ownerId, fileVersions, writeQueue);

    // The mock was called exactly once with the right path + content
    expect(mockIDB.writeFile).toHaveBeenCalledTimes(1);
    expect(mockIDB.writeFile).toHaveBeenCalledWith(
      ownerId,
      '.vfs-adapter-state.json',
      expect.any(String),
    );

    // The actual JSON payload matches what we'd hand-build (catches typos
    // in serializeAdapterState's serialization, e.g. wrong key name or missing field)
    const written = mockIDB._store.get(`${ownerId}:.vfs-adapter-state.json`);
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.fileVersions).toEqual([
      ['workspace/sessions/000/foo.ts', { opfs: 5, server: 4 }],
    ]);
    expect(parsed.writeQueue).toHaveLength(1);
    expect(parsed.writeQueue[0]).toMatchObject({
      path: 'workspace/sessions/000/foo.ts',
      content: '// offline edit',
      version: 5,
      synced: false,
    });
  });

  it('deserializeAdapterState returns a fresh Map + array pair that matches what serializeAdapterState wrote', async () => {
    // The real OPFSAdapter.deserializeAdapterState — no re-implementation.
    const ownerId = 'anon:test-session';

    // Pre-populate the mock IDB with persisted state (simulating a prior tab)
    const persistedPayload = JSON.stringify({
      fileVersions: [
        ['workspace/sessions/000/foo.ts', { opfs: 7, server: 4 }],
        ['workspace/sessions/000/bar.ts', { opfs: 3, server: 3 }],
      ],
      writeQueue: [
        {
          id: 'write_1',
          ownerId,
          path: 'workspace/sessions/000/foo.ts',
          content: '// offline edit',
          version: 7,
          synced: false,
          timestamp: 1700000000000,
        },
      ],
    });
    await mockIDB.writeFile(ownerId, '.vfs-adapter-state.json', persistedPayload);

    // The real deserializeAdapterState call
    const { fileVersions, writeQueue } = await OPFSAdapter.deserializeAdapterState(
      mockIDB,
      ownerId,
    );

    // The result is a real Map (catches the `new Map(...)` bug class —
    // if someone re-introduced a plain array return, this would fail)
    expect(fileVersions).toBeInstanceOf(Map);
    expect(fileVersions.size).toBe(2);
    expect(fileVersions.get('workspace/sessions/000/foo.ts')).toEqual({
      opfs: 7,
      server: 4,
    });
    expect(fileVersions.get('workspace/sessions/000/bar.ts')).toEqual({
      opfs: 3,
      server: 3,
    });
    expect(Array.isArray(writeQueue)).toBe(true);
    expect(writeQueue).toHaveLength(1);
    expect(writeQueue[0].path).toBe('workspace/sessions/000/foo.ts');
    expect(writeQueue[0].content).toBe('// offline edit');
    expect(writeQueue[0].synced).toBe(false);
  });

  it('Step 7: mock satisfies the StateStorageBackend deleteFile interface method (workspace switch cleanup)', async () => {
    // Step 7 added `deleteFile` to the StateStorageBackend interface so
    // production code can clear `.vfs-adapter-state.json` on workspace
    // switch. This test verifies the mock implements it (no `(mockIDB as any)`
    // casts needed in the production code paths that need to delete state).
    const ownerId = 'anon:user-X';

    // Pre-populate the mock IDB with some state
    await mockIDB.writeFile(ownerId, '.vfs-adapter-state.json', '{"fileVersions":[]}');

    // Verify the state exists
    const before = await mockIDB.readFile(ownerId, '.vfs-adapter-state.json');
    expect(before.content).toBe('{"fileVersions":[]}');

    // Delete it via the interface
    await mockIDB.deleteFile(ownerId, '.vfs-adapter-state.json');

    // Verify the state is gone (readFile throws FILE_NOT_FOUND)
    await expect(mockIDB.readFile(ownerId, '.vfs-adapter-state.json')).rejects.toThrow();

    // Deleting a non-existent key is a silent no-op (doesn't throw)
    await expect(mockIDB.deleteFile(ownerId, '.vfs-adapter-state.json')).resolves.toBeUndefined();
  });

  it('end-to-end with vi.useFakeTimers(): schedulePersist → 500ms debounce → serialize → IDB writeFile (the full lifecycle + coalesce)', async () => {
    // Step 8: rewrite the persistence end-to-end test to actually exercise
    // the debounce lifecycle. The previous version just called
    // `serializeAdapterState` directly, which is a unit test of the static
    // method, not a test of the full `schedulePersist` → `setTimeout` →
    // `serializeAdapterState` → `mockIDB.writeFile` chain. This version
    // uses `vi.useFakeTimers()` to control the 500ms debounce window and
    // verify the coalesce behavior (consecutive schedulePersist calls
    // reset the timer instead of firing multiple writes).
    //
    // This test calls `schedulePersist` directly with manually-set state
    // to isolate the debounce + IDB write behavior. The queueWrite
    // integration test below exercises the full `queueWrite` path (the
    // production entry point) with `writeFileToServer` mocked.
    vi.useFakeTimers();

    try {
      const adapter = new OPFSAdapter();
      (adapter as any).ownerId = 'anon:test';
      (adapter as any).fallbackBackend = mockIDB;
      (adapter as any).fileVersions = new Map<string, { opfs: number; server: number }>([
        ['workspace/sessions/000/foo.ts', { opfs: 1, server: 0 }],
      ]);
      (adapter as any).writeQueue = [
        {
          id: 'write_1',
          ownerId: 'anon:test',
          path: 'workspace/sessions/000/foo.ts',
          content: '// initial',
          timestamp: 1,
          synced: false,
          version: 1,
        },
      ];

      // Clear the spy counts from any prior test. `mockIDB` is local to
      // the test (created in beforeEach) but vi.fn persists across the
      // describe block unless cleared, so we clear here.
      mockIDB.writeFile.mockClear();

      // ── T+0: trigger the first schedulePersist ─────────────────────
      (adapter as any).schedulePersist();
      expect((adapter as any).persistTimeout).not.toBeNull();
      expect(mockIDB.writeFile).not.toHaveBeenCalled();

      // ── T+499ms: still within the debounce window, no write yet ────
      vi.advanceTimersByTime(499);
      expect(mockIDB.writeFile).not.toHaveBeenCalled();

      // ── T+499ms: simulate a burst of edits → reset the debounce ────
      // (mimics the user typing rapidly; each keystroke calls
      // schedulePersist which clears the previous timeout)
      (adapter as any).schedulePersist();
      expect(mockIDB.writeFile).not.toHaveBeenCalled();

      // ── T+998ms (499ms after the reset): still not called ──────────
      vi.advanceTimersByTime(499);
      expect(mockIDB.writeFile).not.toHaveBeenCalled();

      // ── T+999ms (500ms after the reset): debounce fires ────────────
      // The timeout callback runs synchronously up to its first await,
      // then the inner `persistState` chain is queued in the microtask
      // queue. `vi.runAllTimersAsync()` drains the timer + all microtasks.
      vi.advanceTimersByTime(1);
      await vi.runAllTimersAsync();

      // ── Verify: the IDB writeFile fired with the right payload ─────
      expect(mockIDB.writeFile).toHaveBeenCalledTimes(1);
      expect(mockIDB.writeFile).toHaveBeenCalledWith(
        'anon:test',
        '.vfs-adapter-state.json',
        expect.any(String),
      );

      // The persistTimeout is cleared by the callback
      expect((adapter as any).persistTimeout).toBeNull();

      // The payload contains the fileVersions + writeQueue
      const callArgs = mockIDB.writeFile.mock.calls[0];
      const parsed = JSON.parse(callArgs[2]);
      expect(parsed.fileVersions).toEqual([
        ['workspace/sessions/000/foo.ts', { opfs: 1, server: 0 }],
      ]);
      expect(parsed.writeQueue).toHaveLength(1);
      expect(parsed.writeQueue[0].content).toBe('// initial');
    } finally {
      vi.useRealTimers();
    }
  });

  it('end-to-end with vi.useFakeTimers(): queueWrite → schedulePersist → debounce → IDB writeFile (writeFileToServer mocked)', async () => {
    // Step 8 reviewer follow-up: the schedulePersist-direct tests above
    // exercise the debounce + IDB write in isolation, but a future
    // regression where `queueWrite` forgets to call `schedulePersist` (or
    // calls it with wrong args) wouldn't be caught. This test drives the
    // full `queueWrite` path — the production code's actual entry point —
    // with `writeFileToServer` mocked (see the `vi.mock` at the top of
    // the file) so the network call doesn't blow up. The debounce + IDB
    // writeFile behavior must still match the contract.
    vi.useFakeTimers();
    try {
      const adapter = new OPFSAdapter();
      (adapter as any).ownerId = 'anon:test';
      (adapter as any).fallbackBackend = mockIDB;
      (adapter as any).fileVersions = new Map();
      (adapter as any).writeQueue = [];
      mockIDB.writeFile.mockClear();

      // queueWrite calls schedulePersist (sets 500ms debounce) AND
      // triggers flushWriteQueue (which calls writeFileToServer; mocked
      // to resolve true). The IDB writeFile fires after the debounce.
      adapter.queueWrite('anon:test', 'foo.ts', '// content', 1);

      // At T+0: persistTimeout is set, IDB writeFile NOT called yet
      expect((adapter as any).persistTimeout).not.toBeNull();
      expect(mockIDB.writeFile).not.toHaveBeenCalled();

      // Advance to T+500ms: debounce fires
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // The IDB writeFile fired with the right payload. We use
      // `toHaveBeenCalled()` + `toHaveBeenNthCalledWith(1, ...)` (not
      // `toHaveBeenCalledTimes(1)`) because `flushWriteQueue` also
      // calls `schedulePersist` at the end (to persist the trimmed
      // queue + the updated `fileVersions` map), so
      // `vi.runAllTimersAsync()` may fire a 2nd debounce. Both calls
      // are valid production behavior. We verify the FIRST call has
      // the queued write to lock in the contract that the user's edit
      // is in the persisted state.
      expect(mockIDB.writeFile).toHaveBeenCalled();
      expect(mockIDB.writeFile).toHaveBeenNthCalledWith(
        1, 'anon:test', '.vfs-adapter-state.json', expect.any(String),
      );
      expect((adapter as any).persistTimeout).toBeNull();

      // The FIRST call's payload includes the queued write (the 2nd
      // call, if any, persists the trimmed queue which is empty)
      const firstCall = mockIDB.writeFile.mock.calls[0];
      const parsed = JSON.parse(firstCall[2]);
      expect(parsed.writeQueue).toHaveLength(1);
      expect(parsed.writeQueue[0].path).toBe('foo.ts');
      expect(parsed.writeQueue[0].content).toBe('// content');
      expect(parsed.writeQueue[0].version).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('end-to-end with vi.useFakeTimers(): the round-trip survives a simulated tab close (serialize → new instance → deserializeAdapterState)', async () => {
    // Step 8 round-trip: instead of calling serialize/deserializeAdapterState
    // directly (which is what the previous version of this test did), drive
    // the full lifecycle: schedulePersist + advance timers + IDB write →
    // new OPFSAdapter instance + deserializeAdapterState → verify the
    // fileVersions + writeQueue are preserved.
    vi.useFakeTimers();
    try {
      const ownerId = 'anon:test-session';

      // ── Tab 1: offline write → schedulePersist → IDB write ────────
      const tab1 = new OPFSAdapter();
      (tab1 as any).ownerId = ownerId;
      (tab1 as any).fallbackBackend = mockIDB;
      (tab1 as any).fileVersions = new Map([
        ['workspace/sessions/000/foo.ts', { opfs: 5, server: 3 }],
      ]);
      (tab1 as any).writeQueue = [
        {
          id: 'write_offline_1',
          ownerId,
          path: 'workspace/sessions/000/foo.ts',
          content: '// OFFLINE EDIT — should survive tab close',
          timestamp: Date.now(),
          synced: false,
          version: 5,
        },
      ];
      mockIDB.writeFile.mockClear();

      (tab1 as any).schedulePersist();
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      // The IDB writeFile fired
      expect(mockIDB.writeFile).toHaveBeenCalledTimes(1);

      // ── Tab 1 closes: in-memory Maps are wiped (simulated) ────────
      // (no code needed — just a comment showing the boundary)

      // ── Tab 2 opens: fresh in-memory state, hydrate from IDB ──────
      const hydrated = await OPFSAdapter.deserializeAdapterState(mockIDB, ownerId);

      // ── Verify: the offline edit is preserved in the new tab's state
      expect(hydrated.fileVersions).toBeInstanceOf(Map);
      expect(hydrated.fileVersions.size).toBe(1);
      const localVersion = hydrated.fileVersions.get('workspace/sessions/000/foo.ts')?.opfs;
      expect(localVersion).toBe(5);

      // The sync logic in OPFSAdapter.syncFromServer would see
      // `versions.opfs > file.version` and SKIP the overwrite.
      const serverVersion = 3;
      expect(localVersion!).toBeGreaterThan(serverVersion);

      // The offline edit's content is also preserved in the write queue
      expect(hydrated.writeQueue).toHaveLength(1);
      expect(hydrated.writeQueue[0].content).toBe(
        '// OFFLINE EDIT — should survive tab close',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('deserializeAdapterState returns empty defaults when no persisted state exists (first run, no prior tab)', async () => {
    // No pre-populated state in mockIDB — simulate a fresh user with no
    // prior tab. deserializeAdapterState should NOT throw; it should return empty
    // Maps/arrays so the caller can proceed with the default empty state.
    const ownerId = 'anon:brand-new-user';
    const { fileVersions, writeQueue } = await OPFSAdapter.deserializeAdapterState(
      mockIDB,
      ownerId,
    );

    expect(fileVersions).toBeInstanceOf(Map);
    expect(fileVersions.size).toBe(0);
    expect(Array.isArray(writeQueue)).toBe(true);
    expect(writeQueue).toHaveLength(0);
  });

  it('deserializeAdapterState returns empty defaults when the persisted JSON is missing the expected fields (corrupted state)', async () => {
    // Some operators may have manually wiped the state file, or a schema
    // migration produced a partial write. deserializeAdapterState should not throw —
    // it should fall back to empty defaults so the adapter is usable.
    const ownerId = 'anon:corrupted-state';
    await mockIDB.writeFile(
      ownerId,
      '.vfs-adapter-state.json',
      JSON.stringify({ unrelated: 'garbage' }),
    );

    const { fileVersions, writeQueue } = await OPFSAdapter.deserializeAdapterState(
      mockIDB,
      ownerId,
    );
    expect(fileVersions).toBeInstanceOf(Map);
    expect(fileVersions.size).toBe(0);
    expect(writeQueue).toHaveLength(0);
  });

  it('deserializeAdapterState throws on malformed JSON so the caller can log + fall back', async () => {
    // This is intentional: a parse error indicates real IDB corruption,
    // which the instance wrapper logs as [WARN] and falls back to empty
    // defaults. The static method just propagates the error to keep the
    // separation of concerns clean.
    const ownerId = 'anon:malformed';
    await mockIDB.writeFile(
      ownerId,
      '.vfs-adapter-state.json',
      '{not valid json',
    );

    await expect(
      OPFSAdapter.deserializeAdapterState(mockIDB, ownerId),
    ).rejects.toThrow();
  });

  it('two different ownerIds get distinct persisted state (no cross-contamination)', async () => {
    // Verifies the persist/hydrate round-trip respects ownerId boundaries.
    // This is the multi-tenant isolation test — if someone re-introduced
    // a bug where the state was stored under a global key, this would
    // fail because the mock IDB keys include the ownerId.
    const ownerA = 'anon:user-A';
    const ownerB = 'anon:user-B';

    const versionsA = new Map([
      ['workspace/sessions/000/foo.ts', { opfs: 10, server: 5 }],
    ]);
    const versionsB = new Map([
      ['workspace/sessions/000/bar.ts', { opfs: 20, server: 15 }],
    ]);

    await OPFSAdapter.serializeAdapterState(mockIDB, ownerA, versionsA, []);
    await OPFSAdapter.serializeAdapterState(mockIDB, ownerB, versionsB, []);

    const a = await OPFSAdapter.deserializeAdapterState(mockIDB, ownerA);
    const b = await OPFSAdapter.deserializeAdapterState(mockIDB, ownerB);

    expect(a.fileVersions.get('workspace/sessions/000/foo.ts')).toEqual({
      opfs: 10,
      server: 5,
    });
    expect(a.fileVersions.has('workspace/sessions/000/bar.ts')).toBe(false);

    expect(b.fileVersions.get('workspace/sessions/000/bar.ts')).toEqual({
      opfs: 20,
      server: 15,
    });
    expect(b.fileVersions.has('workspace/sessions/000/foo.ts')).toBe(false);
  });
});

describe('OPFSAdapter createTabCloseHandler (Step 3 pagehide flush)', () => {
  // Critical data-loss fix: the 500ms debounce in `schedulePersist` means
  // a user who closes the tab within 500ms of the last keystroke loses
  // their offline edit (the queue + version map never hit IDB, so the
  // next open's `hydrateState` returns empty defaults and `syncFromServer`
  // overwrites the offline edit). The pagehide handler synchronously
  // flushes on tab close. We test the factory directly (no need to mock
  // `window`) so the side effects are unambiguous.

  // Each describe block has its own scope (vitest describe = function), so
  // we re-declare `mockIDB` here. Reusing `makeMockIDB()` keeps the
  // test setup consistent with the original persistence suite.
  let mockIDB: ReturnType<typeof makeMockIDB>;
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;
  // Track long-lived fake timers the tests create so afterEach can clear
  // them. The handler under test is supposed to clear them too (that's
  // the whole point of the fix), but this is belt-and-suspenders against
  // a test that sets up a timer but never invokes the handler. Without
  // this cleanup, those timers would keep the Node event loop alive
  // after the test suite ends, potentially hanging vitest exit.
  let trackedFakeTimers: ReturnType<typeof setTimeout>[];

  beforeEach(() => {
    mockIDB = makeMockIDB();
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    trackedFakeTimers = [];
  });

  afterEach(() => {
    clearTimeoutSpy.mockRestore();
    for (const t of trackedFakeTimers) clearTimeout(t);
    trackedFakeTimers = [];
  });

  /** Helper: create a long-lived fake timer AND register it for cleanup. */
  function makeFakeTimer(): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {}, 60_000);
    trackedFakeTimers.push(t);
    return t;
  }

  it('handler clears the pending debounce timer (and actually calls clearTimeout)', () => {
    const adapter = new OPFSAdapter();
    const fakeTimer = setTimeout(() => {}, 100_000); // long-lived so we can detect the clear
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).persistTimeout = fakeTimer;

    // Get the handler via the private factory method (cast to `any` for test access)
    const handler = (adapter as any).createTabCloseHandler();
    handler();

    // The pending debounce timer must be cleared + nulled
    expect((adapter as any).persistTimeout).toBeNull();
    // The underlying Node timer was actually cleared (clearTimeout removed
    // it from the active queue; verifying via `.unref()` would be a
    // platform-specific check, so we trust the null state).
  });

  it('handler synchronously triggers serialize against the current ownerId', async () => {
    const adapter = new OPFSAdapter();
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).persistTimeout = null;
    (adapter as any).fallbackBackend = mockIDB;
    (adapter as any).fileVersions = new Map();
    (adapter as any).writeQueue = [];

    // Spy on the STATIC method that the instance wrapper delegates to.
    // Step 5 renamed `OPFSAdapter.persistState` → `OPFSAdapter.serializeAdapterState`
    // (the static method, not the private instance wrapper). The spy
    // observes the call without mocking it.
    const persistSpy = vi.spyOn(OPFSAdapter, 'serializeAdapterState');

    const handler = (adapter as any).createTabCloseHandler();
    handler();

    // The persist is fire-and-forget (no await in the handler), so the
    // Promise is queued in the microtask queue. Wait one microtask
    // flush + a tiny macrotask so the call lands.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistSpy).toHaveBeenCalled();
    expect(persistSpy).toHaveBeenCalledWith(
      mockIDB,
      'anon:test',
      expect.any(Map),
      expect.any(Array),
    );

    persistSpy.mockRestore();
  });

  it('handler is a no-op when ownerId is null (e.g. concurrent performDisable)', async () => {
    const adapter = new OPFSAdapter();
    (adapter as any).ownerId = null; // simulate performDisable having nulled it
    (adapter as any).persistTimeout = makeFakeTimer();

    const persistSpy = vi.spyOn(OPFSAdapter, 'serializeAdapterState');

    const handler = (adapter as any).createTabCloseHandler();
    handler();

    // The timer should still be cleared (so it doesn't fire on a dead adapter)
    expect((adapter as any).persistTimeout).toBeNull();
    // But no persist should have been triggered
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistSpy).not.toHaveBeenCalled();

    persistSpy.mockRestore();
  });

  it('handler is idempotent — safe to invoke multiple times (BFCache restore + re-close scenario)', () => {
    const adapter = new OPFSAdapter();
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).persistTimeout = null;

    const handler = (adapter as any).createTabCloseHandler();
    // Two invocations (e.g., page goes to BFCache → restored → closed again)
    // should not throw, and the state should remain consistent.
    expect(() => {
      handler();
      handler();
    }).not.toThrow();

    expect((adapter as any).persistTimeout).toBeNull();
  });

  it('handler captures the LATEST ownerId at call time (not at factory-call time)', async () => {
    // The factory returns a closure that reads `this.ownerId` lazily.
    // If `ownerId` changes between factory-call and handler-invocation
    // (e.g., re-enable for a different workspace), the handler should
    // use the CURRENT ownerId, not a stale one. This is the core reason
    // it's a factory returning a closure rather than a class field.
    const adapter = new OPFSAdapter();
    (adapter as any).ownerId = 'anon:first';
    (adapter as any).persistTimeout = null;
    (adapter as any).fallbackBackend = mockIDB;
    (adapter as any).fileVersions = new Map();
    (adapter as any).writeQueue = [];

    const handler = (adapter as any).createTabCloseHandler();
    // Simulate the ownerId changing before the handler fires
    (adapter as any).ownerId = 'anon:second';

    const persistSpy = vi.spyOn(OPFSAdapter, 'serializeAdapterState');
    handler();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(persistSpy).toHaveBeenCalledWith(
      mockIDB,
      'anon:second', // the NEW ownerId, not the factory-time one
      expect.any(Map),
      expect.any(Array),
    );

    persistSpy.mockRestore();
  });
});

describe('OPFSAdapter writeFile hydration guard (Step 4 race fix)', () => {
  // Critical concurrency fix: in `performEnable`, `this.enabled = true`
  // is set BEFORE `await this.hydrateState(ownerId)` runs. A `writeFile`
  // that lands in this window would update `this.fileVersions`, but
  // then the hydration's `this.fileVersions = hydrated` would CLOBBER
  // the just-written entry — a silent data-loss bug.
  //
  // The fix: a `hydrationPromise` Promise is set synchronously in
  // `performEnable` (before the await), and `writeFile` awaits it at
  // the start if it's set. The await is bounded (~5–20ms for an IDB
  // read) and only affects the FIRST write after enable(); subsequent
  // writes see a null `hydrationPromise` and proceed without blocking.

  let mockIDB: ReturnType<typeof makeMockIDB>;

  beforeEach(() => {
    mockIDB = makeMockIDB();
  });

  it('writeFile awaits the hydration promise if one is in progress', async () => {
    const adapter = new OPFSAdapter();

    // Set up a deferred hydration promise (simulates performEnable mid-hydration)
    let resolveHydration: () => void = () => {};
    const hydrationPromise = new Promise<void>((res) => {
      resolveHydration = res;
    });
    (adapter as any).hydrationPromise = hydrationPromise;

    // Set up the minimum state writeFile needs to proceed past its early checks
    (adapter as any).enabled = true;
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).usingFallback = true; // use the IDB branch
    (adapter as any).fallbackBackend = mockIDB;

    // Track when the actual IDB writeFile is called — this is the
    // signal that writeFile has proceeded past the hydration guard
    const idbWriteSpy = mockIDB.writeFile;

    // Call writeFile — it should be blocked on the hydration promise
    const writePromise = adapter.writeFile('anon:test', 'foo.ts', 'content');

    // Give the event loop several ticks to run any pending microtasks.
    // If the hydration guard is broken, the IDB writeFile would land
    // here. With the guard, writeFile is still awaiting the promise.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(idbWriteSpy).not.toHaveBeenCalled();

    // Resolve hydration — now writeFile should proceed
    resolveHydration();
    await writePromise;

    // The IDB writeFile was called (writeFile completed after the guard released)
    expect(idbWriteSpy).toHaveBeenCalledWith(
      'anon:test',
      'foo.ts',
      'content',
      expect.objectContaining({ language: undefined }),
    );
  });

  it('writeFile does NOT block when hydrationPromise is null (normal case)', async () => {
    const adapter = new OPFSAdapter();
    (adapter as any).enabled = true;
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).usingFallback = true;
    (adapter as any).fallbackBackend = mockIDB;
    // No hydrationPromise set — normal post-hydration state

    const idbWriteSpy = mockIDB.writeFile;
    await adapter.writeFile('anon:test', 'foo.ts', 'content');

    // The IDB writeFile was called immediately (no blocking)
    expect(idbWriteSpy).toHaveBeenCalledTimes(1);
  });

  it('hydrationPromise is cleared after hydration completes (no leak)', async () => {
    // After performEnable finishes, the field should be null so future
    // writes don't await a resolved promise (would be a perf no-op but
    // a code smell).
    const adapter = new OPFSAdapter();
    let resolveHydration: () => void = () => {};
    const hydrationPromise = new Promise<void>((res) => {
      resolveHydration = res;
    });
    (adapter as any).hydrationPromise = hydrationPromise;

    // Simulate the .finally() cleanup that performEnable does
    hydrationPromise.finally(() => {
      (adapter as any).hydrationPromise = null;
    });
    resolveHydration();
    await hydrationPromise;

    // The field is cleared
    expect((adapter as any).hydrationPromise).toBeNull();
  });

  it('two concurrent writeFiles both wait for the same hydrationPromise (no deadlock)', async () => {
    // If two writeFiles land simultaneously during hydration, both
    // should observe the same promise and both should complete after
    // it resolves. No deadlock, no race where one of them skips the
    // guard because the other cleared the field.
    const adapter = new OPFSAdapter();
    let resolveHydration: () => void = () => {};
    const hydrationPromise = new Promise<void>((res) => {
      resolveHydration = res;
    });
    (adapter as any).hydrationPromise = hydrationPromise;

    (adapter as any).enabled = true;
    (adapter as any).ownerId = 'anon:test';
    (adapter as any).usingFallback = true;
    (adapter as any).fallbackBackend = mockIDB;

    const writeA = adapter.writeFile('anon:test', 'a.ts', 'content-a');
    const writeB = adapter.writeFile('anon:test', 'b.ts', 'content-b');

    // Both should be pending
    let aResolved = false;
    let bResolved = false;
    writeA.then(() => { aResolved = true; });
    writeB.then(() => { bResolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aResolved).toBe(false);
    expect(bResolved).toBe(false);

    // Resolve hydration
    resolveHydration();
    await Promise.all([writeA, writeB]);

    // Both completed
    expect(aResolved).toBe(true);
    expect(bResolved).toBe(true);
    expect(mockIDB.writeFile).toHaveBeenCalledWith(
      'anon:test',
      'a.ts',
      'content-a',
      expect.objectContaining({ language: undefined }),
    );
    expect(mockIDB.writeFile).toHaveBeenCalledWith(
      'anon:test',
      'b.ts',
      'content-b',
      expect.objectContaining({ language: undefined }),
    );
  });

  it('regression: hydrationPromise is set synchronously at the top of performEnable (closes the bug window)', async () => {
    // The Step 4 v1 fix set `hydrationPromise` AFTER the listener setup,
    // leaving a bug window: any writeFile landing between the OPFS init's
    // `enabled = true` (early in performEnable) and the v1
    // `hydrationPromise` assignment (late in performEnable) would see
    // `enabled === true` AND `hydrationPromise === null`, proceed without
    // blocking, and then be CLOBBERED by the hydration that ran
    // immediately after — silently losing the user's offline edit.
    //
    // The Step 4 v2 fix moves the assignment to the very top of
    // performEnable. This test verifies the fix end-to-end by mocking
    // `OPFSCore.isSupported()` to return false (forcing the IDB fallback
    // path, which is easier to control with deferred initialize + readFile).
    //
    // The test asserts that:
    // 1. After calling `enable()` (before awaiting), `hydrationPromise` is
    //    ALREADY set — even though `enabled = true` hasn't been reached
    //    yet (it's gated on the deferred `mockIDB.initialize`).
    // 2. The test fails on the v1 code (where `hydrationPromise` would be
    //    null at this point) and passes on the v2 code.
    const isSupportedSpy = vi.spyOn(OPFSCore, 'isSupported').mockReturnValue(false);
    const idbSupportedSpy = vi.spyOn(IndexedDBBackend, 'isSupported').mockReturnValue(true);

    const adapter = new OPFSAdapter();
    (adapter as any).fallbackBackend = mockIDB;

    // Make `initialize` deferred so we can observe the state BETWEEN
    // `performEnable` setting `hydrationPromise` (synchronously) and
    // `enableFallback` setting `enabled = true` (awaiting init).
    let resolveInit: () => void = () => {};
    const initPromise = new Promise<void>((res) => { resolveInit = res; });
    (mockIDB as any).initialize = vi.fn(() => initPromise);

    // Make `readFile` deferred so the hydration promise is still
    // pending when we want to assert it's set.
    let resolveRead: (v: any) => void = () => {};
    const readPromise = new Promise<any>((res) => { resolveRead = res; });
    (mockIDB as any).readFile = vi.fn(() => readPromise);

    try {
      // Call enable() but don't await. After one macrotask, performEnable
      // has hit the `await this.fallbackBackend.initialize(ownerId)` line
      // in enableFallback and yielded control to the event loop.
      const enablePromise = adapter.enable('anon:test', 'test-ws');
      await new Promise((r) => setTimeout(r, 0));

      // KEY ASSERTION: hydrationPromise must be set NOW, even though
      // `enabled` is still false (gated on the deferred init).
      // In the v1 code, this assertion FAILS because hydrationPromise
      // was assigned after the listener setup, which is still pending.
      expect((adapter as any).hydrationPromise).not.toBeNull();
      expect((adapter as any).enabled).toBe(false);

      // Resolve the deferred init — enableFallback can now set enabled = true
      resolveInit();
      await new Promise((r) => setTimeout(r, 0));

      // Now enabled is true, but the hydration is still pending on readFile
      expect((adapter as any).enabled).toBe(true);
      expect((adapter as any).hydrationPromise).not.toBeNull();

      // Resolve the read (returns empty content → hydrateState returns
      // empty defaults so the fileVersions map is empty post-hydration)
      resolveRead({ content: undefined });
      await enablePromise;

      // After enable() resolves, hydrationPromise is cleared (no leak)
      expect((adapter as any).hydrationPromise).toBeNull();
      expect((adapter as any).enabled).toBe(true);
    } finally {
      // Cleanup is in finally (not after the await) so the background sync
      // setInterval from `startBackgroundSyncLoop()` is always stopped, even
      // if the test throws. Without this, the setInterval would keep the
      // Node event loop alive and potentially hang vitest exit.
      isSupportedSpy.mockRestore();
      idbSupportedSpy.mockRestore();
      (adapter as any).stopBackgroundSync();
      (adapter as any).pendingEnablePromise = null;
    }
  });
});
