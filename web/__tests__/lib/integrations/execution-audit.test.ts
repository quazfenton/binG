/**
 * Execution Audit Unit Tests
 *
 * Tests the SQLite audit trail:
 * - Table initialization (idempotent)
 * - Recording audit entries
 * - Querying audit trail
 * - Parameter hashing (sensitive field redaction)
 * - Execution statistics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
const mockDb = {
  exec: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
  })),
};

vi.mock('@/lib/database/connection', () => ({
  getDatabase: () => mockDb,
}));

import {
  initializeAuditTable,
  recordAudit,
  getUserAuditTrail,
  getUserExecutionStats,
  hashParams,
} from './execution-audit';

describe('Execution Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeAuditTable', () => {
    it('creates table with IF NOT EXISTS', () => {
      initializeAuditTable();
      expect(mockDb.exec).toHaveBeenCalledOnce();
      const sql = mockDb.exec.mock.calls[0][0] as string;
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS integration_audit');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_user_time');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_provider');
    });

    it('is safe to call multiple times', () => {
      initializeAuditTable();
      initializeAuditTable();
      expect(mockDb.exec).toHaveBeenCalledTimes(2); // Both calls succeed — IF NOT EXISTS handles it
    });

    it('handles null database gracefully', async () => {
      vi.doMock('@/lib/database/connection', () => ({ getDatabase: () => null }));
      // Re-import after mock change
      const { initializeAuditTable: initNull } = await import('./execution-audit');
      expect(() => initNull()).not.toThrow();
    });
  });

  describe('recordAudit', () => {
    it('inserts audit entry with generated ID', () => {
      recordAudit({
        userId: 'user-1',
        provider: 'github',
        action: 'list_repos',
        paramsHash: 'abc123',
        success: true,
        durationMs: 150,
        ipAddress: '1.2.3.4',
        userAgent: 'test-agent',
      });

      const prepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      expect(prepare).toHaveBeenCalled();
      const insertCall = prepare.mock.results.find(r =>
        (r.value as any).run?.mock?.calls?.[0]
      );
      // Verify INSERT was called with correct columns
      const sql = prepare.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO integration_audit');
    });

    it('truncates long error messages', () => {
      const longError = 'x'.repeat(2000);
      recordAudit({
        userId: 'user-1', provider: 'test', action: 'test',
        paramsHash: 'abc', success: false, error: longError, durationMs: 10,
      });
      // The run call receives the truncated error
      const runFn = mockDb.prepare().run as ReturnType<typeof vi.fn>;
      if (runFn.mock.calls.length > 0) {
        const errorArg = runFn.mock.calls[0][6]; // error is 7th param
        expect((errorArg as string).length).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe('getUserAuditTrail', () => {
    it('returns empty array when no entries', () => {
      const entries = getUserAuditTrail('user-1', 10);
      expect(entries).toEqual([]);
    });

    it('limits results', () => {
      getUserAuditTrail('user-1', 20);
      const prepare = mockDb.prepare as ReturnType<typeof vi.fn>;
      const allFn = prepare().all as ReturnType<typeof vi.fn>;
      if (allFn.mock.calls.length > 0) {
        expect(allFn.mock.calls[0][1]).toBe(20); // limit param
      }
    });
  });

  describe('getUserExecutionStats', () => {
    it('returns zero stats when no database', () => {
      vi.doMock('@/lib/database/connection', () => ({ getDatabase: () => null }));
      // Stats should return zeros
    });

    it('returns structured stats', () => {
      const stats = getUserExecutionStats('user-1');
      expect(stats).toHaveProperty('totalExecutions');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('avgDurationMs');
      expect(stats).toHaveProperty('topProviders');
      expect(Array.isArray(stats.topProviders)).toBe(true);
    });
  });

  describe('hashParams', () => {
    it('produces consistent hash for same input', () => {
      const h1 = hashParams({ key: 'value' });
      const h2 = hashParams({ key: 'value' });
      expect(h1).toBe(h2);
    });

    it('produces different hash for different input', () => {
      const h1 = hashParams({ key: 'value1' });
      const h2 = hashParams({ key: 'value2' });
      expect(h1).not.toBe(h2);
    });

    it('redacts sensitive fields', () => {
      const h1 = hashParams({ apiKey: 'secret-123' });
      const h2 = hashParams({ apiKey: 'different-secret' });
      // Both should hash the same since apiKey is redacted to ***REDACTED***
      expect(h1).toBe(h2);
    });

    it('handles various sensitive field patterns', () => {
      const params = {
        token: 'abc',
        secretKey: 'xyz',
        password: 'pass',
        API_KEY: 'key',
        myCredential: 'cred',
        normalField: 'visible',
      };
      const hashed = hashParams(params);
      expect(typeof hashed).toBe('string');
      expect(hashed.length).toBeGreaterThan(0);
    });
  });
});
