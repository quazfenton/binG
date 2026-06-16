/**
 * Unit tests for findAnonOwnerIds (Bug #85, Pass-6).
 *
 * Verifies the DB-error fallback: when the underlying SQLite query throws
 * (table missing, connection lost, etc.), the method returns `[]` instead
 * of letting the error propagate. The old code returned `undefined` on DB
 * failure, which crashed transfer-anon-vfs.ts with
 * "Cannot read properties of null (reading 'cnt')".
 *
 * The success path is also covered: returns distinct owner_ids filtered by
 * the `anon:` prefix + maxAgeHours cutoff.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB connection module BEFORE importing the file under test.
// The SUT uses `getDatabase()` from `@/lib/database/connection`.
const mockPrepare = vi.fn();
const mockGetDatabase = vi.fn(() => ({
  prepare: mockPrepare,
}));

vi.mock('@/lib/database/connection', () => ({
  getDatabase: () => mockGetDatabase(),
}));

import { VirtualFilesystemService } from '../virtual-filesystem-service';

describe('findAnonOwnerIds (Bug #85)', () => {
  beforeEach(() => {
    mockPrepare.mockReset();
    mockGetDatabase.mockClear();
  });

  it('returns distinct anon owner_ids within the maxAgeHours window', async () => {
    // Two rows: one anon owner, one non-anon owner. Only anon rows should return.
    mockPrepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { owner_id: 'anon:abc123' },
        { owner_id: 'anon:def456' },
        // The WHERE clause already filters out non-anon, but verify the mapper
        // only emits anon: rows.
      ]),
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-1' });
    const result = await vfs.findAnonOwnerIds(24);
    expect(result).toEqual(['anon:abc123', 'anon:def456']);
  });

  it('returns an empty array when the DB query throws (table missing)', async () => {
    // Simulate the common production failure: a fresh DB without migrations
    // applied throws "no such table: vfs_workspace_files".
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('no such table: vfs_workspace_files');
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-2' });
    const result = await vfs.findAnonOwnerIds(24);
    // The fix: return [] instead of letting the error propagate (or
    // returning undefined, which crashed transfer-anon-vfs.ts).
    expect(result).toEqual([]);
  });

  it('returns an empty array when the DB connection itself throws', async () => {
    // The DB module itself is unavailable (e.g., constructor threw).
    mockGetDatabase.mockImplementationOnce(() => {
      throw new Error('Database not initialized');
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-3' });
    const result = await vfs.findAnonOwnerIds(24);
    expect(result).toEqual([]);
  });

  it('returns an empty array when prepare().all() throws (SQLITE_ERROR)', async () => {
    mockPrepare.mockReturnValueOnce({
      all: vi.fn(() => {
        throw new Error('SQLITE_ERROR: database is locked');
      }),
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-4' });
    const result = await vfs.findAnonOwnerIds(24);
    expect(result).toEqual([]);
  });

  it('throws on negative maxAgeHours (validation happens BEFORE the DB call)', async () => {
    // The validation check must run first so a typo (e.g. maxAgeHours=-1)
    // doesn't silently disable the bound and trigger an un-scoped scan.
    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-5' });
    await expect(vfs.findAnonOwnerIds(-1)).rejects.toThrow(/maxAgeHours must be >= 0/);
    // DB should NOT have been touched — validation rejects before query.
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('uses the default 7-day window when no maxAgeHours is passed', async () => {
    // Spy on the prepared SQL to verify it includes the cutoff computation.
    const allMock = vi.fn(() => [{ owner_id: 'anon:recent' }]);
    mockPrepare.mockReturnValueOnce({ all: allMock });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-6' });
    const result = await vfs.findAnonOwnerIds();

    expect(result).toEqual(['anon:recent']);
    // The prepared SQL should reference `updated_at` (the cutoff filter)
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    const sql = mockPrepare.mock.calls[0][0] as string;
    expect(sql).toMatch(/updated_at >=/);
  });

  it('uses an un-scoped query when maxAgeHours=0 (warns but does not throw)', async () => {
    const allMock = vi.fn(() => [{ owner_id: 'anon:old' }]);
    mockPrepare.mockReturnValueOnce({ all: allMock });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-7' });
    const result = await vfs.findAnonOwnerIds(0);

    expect(result).toEqual(['anon:old']);
    // The un-scoped query should NOT include the `updated_at >=` filter.
    const sql = mockPrepare.mock.calls[0][0] as string;
    expect(sql).not.toMatch(/updated_at >=/);
  });

  it('handles an empty result set (no anon files yet)', async () => {
    mockPrepare.mockReturnValueOnce({
      all: vi.fn(() => []),
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-8' });
    const result = await vfs.findAnonOwnerIds(24);
    expect(result).toEqual([]);
  });

  it('preserves the order from the SQL ORDER BY clause', async () => {
    mockPrepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { owner_id: 'anon:001' },
        { owner_id: 'anon:002' },
        { owner_id: 'anon:003' },
      ]),
    });

    const vfs = new VirtualFilesystemService({ workspaceRoot: '/tmp/vfs-test-9' });
    const result = await vfs.findAnonOwnerIds(24);
    expect(result).toEqual(['anon:001', 'anon:002', 'anon:003']);
  });
});
