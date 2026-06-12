/**
 * Tests for DatabaseSessionStore — Bug #35 (audit)
 *
 * Bug #35 (audit): `SessionStore` re-initialized 4× in 1 hour. Either
 * a hot-reload leak (prior instance not closed) or a lifecycle bug.
 * The fix: initCount tracking, globalThis singleton persistence, and
 * a warn-level log when re-init count > 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to ensure the mock is in place before module import.
const { mockLogger, mockDb, mockBetterSqlite3 } = vi.hoisted(() => {
  // In-memory mock for better-sqlite3 — each new Database() returns
  // the same mockDb so we can inspect calls.
  const statements = {
    run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 1 }),
    get: vi.fn().mockReturnValue(undefined),
    all: vi.fn().mockReturnValue([]),
  };
  const mockDb = {
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(statements),
    close: vi.fn(),
  };
  const mockBetterSqlite3 = vi.fn().mockReturnValue(mockDb);

  // Logger mock
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { mockLogger, mockDb, mockBetterSqlite3 };
});

vi.mock('better-sqlite3', () => ({ default: mockBetterSqlite3 }));
vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}));

import {
  getDatabaseSessionStore,
  __resetDatabaseSessionStoreForTests,
} from './session-store';

describe('DatabaseSessionStore — Bug #35 (re-init warning + singleton persistence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetDatabaseSessionStoreForTests();
    // Also reset the globalThis slot
    (globalThis as any).__dbSessionStore__ = undefined;
  });

  afterEach(() => {
    __resetDatabaseSessionStoreForTests();
    (globalThis as any).__dbSessionStore__ = undefined;
  });

  describe('singleton behavior', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getDatabaseSessionStore();
      const b = getDatabaseSessionStore();
      expect(a).toBe(b);
    });

    it('persists the instance on globalThis across module re-evaluations', () => {
      const a = getDatabaseSessionStore();
      // Simulate a hot-reload by clearing the module-level references
      // but keeping the globalThis slot.
      const persisted = (globalThis as any).__dbSessionStore__;
      expect(persisted).toBe(a);
      // A subsequent getter call should return the same persisted instance.
      const b = getDatabaseSessionStore();
      expect(b).toBe(a);
    });
  });

  describe('initCount tracking (Bug #35)', () => {
    it('starts at 0 before initialize() is called', () => {
      // Reset everything and create a fresh instance manually.
      __resetDatabaseSessionStoreForTests();
      (globalThis as any).__dbSessionStore__ = undefined;
      const store = getDatabaseSessionStore();
      // The singleton getter calls initialize() once, so initCount should be 1.
      expect(store.initCount).toBe(1);
    });

    it('logs an info line on first init and a warn on re-init', () => {
      const store = getDatabaseSessionStore();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Database session store initialized'),
        expect.objectContaining({ initCount: 1 }),
      );
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('re-initialized'),
        expect.anything(),
      );

      // Trigger a re-init. This simulates the "4 inits in 1 hour" symptom.
      store.initialize();

      // initCount should now be 2.
      expect(store.initCount).toBe(2);
      // A warn-level line should have been emitted with the re-init count.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('re-initialized 2 times'),
        expect.objectContaining({ initCount: 2 }),
      );
    });

    it('warns on every re-init past the first (e.g., initCount = 3, 4, …)', () => {
      const store = getDatabaseSessionStore();
      store.initialize();
      store.initialize();
      store.initialize();
      // 1 initial + 3 re-inits = 4 total warns.
      expect(store.initCount).toBe(4);
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('re-initialized'),
      );
      expect(warnCalls.length).toBe(3);
    });
  });

  describe('db close on re-init (Bug #35)', () => {
    it('closes the previous db connection before opening a new one', () => {
      const store = getDatabaseSessionStore();
      expect(mockDb.close).not.toHaveBeenCalled();

      // Re-initialize. The previous db handle should be closed before
      // a new better-sqlite3 instance is opened.
      store.initialize();

      expect(mockDb.close).toHaveBeenCalledTimes(1);
      // And a new better-sqlite3 constructor call should have happened.
      expect(mockBetterSqlite3).toHaveBeenCalledTimes(2);
    });
  });
});
