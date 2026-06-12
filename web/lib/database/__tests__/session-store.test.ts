/**
 * Tests for DatabaseSessionStore — Bug #35 (audit)
 *
 * Bug #35 (audit): `SessionStore` re-initialized 4× in 1 hour. Either
 * a hot-reload leak (prior instance not closed) or a lifecycle bug.
 * The fix: initCount tracking, globalThis singleton persistence, and
 * a warn-level log when re-init count > 1.
 *
 * NOTE: The db-close-on-re-init test is omitted because better-sqlite3
 * is a native module that vitest's vi.mock cannot intercept. The core
 * code paths (singleton, initCount, re-init warn) are validated below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockLogger };
});

// NOTE: vi.mock for better-sqlite3 is intentionally omitted — it's a
// native module and vitest's vi.mock cannot intercept it. The
// initialize() method will fall through to the real native module and
// either succeed or gracefully degrade (the catch block sets db=null).
// This does not affect the singleton / initCount / re-init tests.
vi.mock('@/lib/utils/logger', () => ({ createLogger: () => mockLogger }));

import {
  getDatabaseSessionStore,
  __resetDatabaseSessionStoreForTests,
} from '../session-store';

describe('DatabaseSessionStore — Bug #35 (re-init warning + singleton persistence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetDatabaseSessionStoreForTests();
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
      const persisted = (globalThis as any).__dbSessionStore__;
      expect(persisted).toBe(a);
      const b = getDatabaseSessionStore();
      expect(b).toBe(a);
    });
  });

  describe('initCount tracking (Bug #35)', () => {
    it('starts at 1 after singleton getter calls initialize()', () => {
      __resetDatabaseSessionStoreForTests();
      (globalThis as any).__dbSessionStore__ = undefined;
      const store = getDatabaseSessionStore();
      expect(store.initCount).toBe(1);
    });

    it('warns on every re-init past the first (e.g., initCount = 3, 4, …)', () => {
      const store = getDatabaseSessionStore();
      store.initialize();
      store.initialize();
      store.initialize();
      expect(store.initCount).toBe(4);
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('re-initialized'),
      );
      expect(warnCalls.length).toBe(3);
    });
  });
});
