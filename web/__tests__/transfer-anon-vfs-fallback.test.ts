/**
 * Integration test: VFS anon file recovery when the auth cookie is rotated.
 *
 * The cookie-based derivation of the VFS ownerId in transfer-anon-vfs.ts
 * is lossy in some cases — e.g. when the cookie is rotated between write
 * and transfer, or when the sanitizer can't round-trip a particular input.
 * To handle this, the helper uses a two-tier strategy:
 *
 *   1. FAST PATH — derive the anon ownerId from the cookie using the same
 *      sanitizer as `resolveFilesystemOwner`, then call `transferOwnership`.
 *      This matches the common case where the cookie and the DB are in sync.
 *
 *   2. FALLBACK — if the fast path transferred 0 files, scan the VFS for
 *      anon ownerIds with recent activity, then SCOPE the candidates to
 *      ownerIds whose session-id portion starts with the cookie's
 *      timestamp prefix. This prevents silent data graft from other
 *      browsers' anon workspaces while still recovering orphan files
 *      for the same browser (same timestamp prefix).
 *
 * This test exercises both paths and verifies that:
 *   - the fast path transfers when the cookie matches the writer, and
 *   - the fallback path recovers the files when the cookie has been
 *     rotated (same prefix, different random suffix), and
 *   - the prefix scoping correctly REJECTS candidates from other browsers
 *     (different prefix → no transfer), and
 *   - missing cookie / no anon files are no-ops.
 *
 * IMPLEMENTATION NOTE: We pre-populate the mock DB directly with the
 * anon-owned files (instead of going through virtualFilesystem.writeFile)
 * because the VFS path normalization in the test environment is
 * workspace-root-sensitive. The mock DB layer is the same one the
 * VFS service reads from in tests (see vitest.config.ts SKIP_DB_INIT
 * and the mock at bing/web/lib/database/connection.client.ts), so
 * pre-inserted rows are visible to transferOwnership's queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { transferVFSFromAnonymous, transferVFSOnLogin } from '@/lib/auth/transfer-anon-vfs';
import { getDatabase, resetMockDatabase } from '@/lib/database/connection';
import type { NextRequest } from 'next/server';

// A stable anon identity and a rotated version of it. The two cookies
// share the same timestamp prefix (so the fallback scoping matches) but
// have different random suffixes (so the cookie-derived ownerId is
// different and the fast path misses).
const ANON_TIMESTAMP = '1700000000000';
const ORIGINAL_COOKIE = `anon_${ANON_TIMESTAMP}_aaaa1111`;
const ROTATED_COOKIE = `anon_${ANON_TIMESTAMP}_bbbb2222`;

const ANON_OWNER_ID = `anon:${ANON_TIMESTAMP}_aaaa1111`;
const UNRELATED_OWNER_ID = `anon:9999999999_cccc3333`;
const NEW_USER_ID = 'new-user-test-id';

// The VFS stores file paths with the default workspace root as a
// prefix. We mirror that prefix here so the pre-inserted mock-DB rows
// are visible to transferOwnership's queries. If the VFS default root
// changes, this constant must be updated to match.
const TEST_WORKSPACE_ROOT = 'workspace';

// Helper: insert a single anon-owned file row directly into the mock DB.
// Bypasses writeFile path normalization (which rejects bare paths when
// the test workspace root isn't isSessionRoot / absolute).
function insertAnonFile(
  ownerId: string,
  relativePath: string,
  content: string,
): void {
  const db = getDatabase();
  const fullPath = `${TEST_WORKSPACE_ROOT}/${relativePath}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO vfs_workspace_files
     (id, owner_id, path, content, blob_hash, is_compressed, language, size, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, 'text', ?, 1, ?, ?)`
  ).run(
    `${ownerId}:${fullPath}`,
    ownerId,
    fullPath,
    content,
    Buffer.byteLength(content, 'utf8'),
    now,
    now,
  );
}

function listOwnerPaths(ownerId: string): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT path FROM vfs_workspace_files WHERE owner_id = ? ORDER BY path'
    )
    .all(ownerId) as Array<{ path: string }>;
  return rows.map((r) => r.path);
}

// Minimal NextRequest stub: only the parts transfer-anon-vfs uses
// (specifically `cookies.get('anon-session-id')?.value`).
function makeMockRequest(anonCookieValue: string | undefined): NextRequest {
  return {
    cookies: {
      get: (name: string) => {
        if (name === 'anon-session-id' && anonCookieValue) {
          return { name, value: anonCookieValue };
        }
        return undefined;
      },
    },
  } as unknown as NextRequest;
}

describe('transferVFSOnLogin — cookie fast-path', () => {
  beforeEach(() => {
    resetMockDatabase();
  });

  it('transfers anon files when the cookie matches the writer (fast path)', async () => {
    insertAnonFile(ANON_OWNER_ID, 'note.md', 'first anon note');
    insertAnonFile(ANON_OWNER_ID, 'code.ts', 'export const x = 1;');

    expect(listOwnerPaths(ANON_OWNER_ID)).toHaveLength(2);

    // The cookie is the SAME as the one that originally produced the
    // ownerId `anon:1700000000000_aaaa1111`. The fast path derives this
    // exact ownerId from the cookie, finds the 2 files, and moves them.
    const request = makeMockRequest(ORIGINAL_COOKIE);
    const result = await transferVFSOnLogin(request, { id: NEW_USER_ID });

    expect(result.transferredFiles).toBe(2);
    expect(listOwnerPaths(ANON_OWNER_ID)).toHaveLength(0);
    expect(listOwnerPaths(NEW_USER_ID).sort()).toEqual([
      `${TEST_WORKSPACE_ROOT}/code.ts`,
      `${TEST_WORKSPACE_ROOT}/note.md`,
    ]);
  });
});

describe('transferVFSOnLogin — DB fallback when cookie is rotated', () => {
  beforeEach(() => {
    resetMockDatabase();
  });

  it('recovers anon files via the DB fallback when the cookie is rotated (same prefix)', async () => {
    insertAnonFile(ANON_OWNER_ID, 'note.md', 'first anon note');
    insertAnonFile(ANON_OWNER_ID, 'code.ts', 'export const x = 1;');
    insertAnonFile(ANON_OWNER_ID, 'data.json', '{"hello":"world"}');

    expect(listOwnerPaths(ANON_OWNER_ID)).toHaveLength(3);

    // The cookie has been rotated. The new cookie has the SAME timestamp
    // prefix (so the fallback scoping matches) but a different random
    // suffix. The fast path will derive ownerId
    // `anon:1700000000000_bbbb2222` which does NOT exist in the DB, so
    // the fallback fires and recovers the 3 files because their
    // session-id portion starts with the cookie's timestamp prefix.
    const request = makeMockRequest(ROTATED_COOKIE);
    const result = await transferVFSOnLogin(request, { id: NEW_USER_ID });

    expect(result.transferredFiles).toBe(3);
    expect(listOwnerPaths(ANON_OWNER_ID)).toHaveLength(0);
    expect(listOwnerPaths(NEW_USER_ID).sort()).toEqual([
      `${TEST_WORKSPACE_ROOT}/code.ts`,
      `${TEST_WORKSPACE_ROOT}/data.json`,
      `${TEST_WORKSPACE_ROOT}/note.md`,
    ]);
  });

  it('preserves file content through the DB fallback transfer', async () => {
    const originalContent = 'const important = "do not lose this";';
    insertAnonFile(ANON_OWNER_ID, 'preserve.ts', originalContent);

    const request = makeMockRequest(ROTATED_COOKIE);
    const result = await transferVFSOnLogin(request, { id: NEW_USER_ID });

    expect(result.transferredFiles).toBe(1);

    const db = getDatabase();
    const row = db
      .prepare(
        'SELECT content FROM vfs_workspace_files WHERE owner_id = ? AND path = ?'
      )
      .get(NEW_USER_ID, `${TEST_WORKSPACE_ROOT}/preserve.ts`) as { content: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.content).toBe(originalContent);
  });
});

describe('transferVFSOnLogin — scoping and edge cases', () => {
  beforeEach(() => {
    resetMockDatabase();
    // Pre-populate an unrelated anon ownerId to verify prefix scoping
    // REJECTS it (would be a data graft from a different browser).
    insertAnonFile(
      UNRELATED_OWNER_ID,
      'other-user-note.md',
      'belongs to a different browser'
    );
  });

  it('does NOT transfer anon files from a different browser (prefix scoping prevents data graft)', async () => {
    // Use ROTATED_COOKIE (same timestamp prefix as ANON_OWNER_ID, different
    // random suffix) so the FAST PATH MISSES — the cookie-derived ownerId
    // `anon:1700000000000_bbbb2222` doesn't exist in the DB. The FALLBACK
    // fires and finds two candidates: ANON_OWNER_ID (prefix matches the
    // cookie's `1700000000000`) and UNRELATED_OWNER_ID (prefix `9999999999`
    // does NOT match). The prefix filter must keep only ANON_OWNER_ID's
    // file; the unrelated file must be left alone.
    insertAnonFile(ANON_OWNER_ID, 'mine.md', 'my anon note');

    const request = makeMockRequest(ROTATED_COOKIE);
    const result = await transferVFSOnLogin(request, { id: NEW_USER_ID });

    // Only the same-prefix file is moved; the unrelated file is left alone
    expect(result.transferredFiles).toBe(1);

    // Verify the unrelated file still exists under its original owner
    expect(listOwnerPaths(UNRELATED_OWNER_ID)).toEqual([
      `${TEST_WORKSPACE_ROOT}/other-user-note.md`,
    ]);

    // Verify the new user got only the matching file, not the unrelated one
    expect(listOwnerPaths(NEW_USER_ID)).toEqual([
      `${TEST_WORKSPACE_ROOT}/mine.md`,
    ]);
  });

  it('returns 0 transferred files when no cookie is present', async () => {
    insertAnonFile(ANON_OWNER_ID, 'note.md', 'first anon note');

    const request = makeMockRequest(undefined);
    const result = await transferVFSOnLogin(request, { id: NEW_USER_ID });

    expect(result.transferredFiles).toBe(0);

    // The anon file is still there — we never tried to transfer
    expect(listOwnerPaths(ANON_OWNER_ID)).toEqual([`${TEST_WORKSPACE_ROOT}/note.md`]);
  });

  it('returns 0 transferred files when no user id is provided', async () => {
    insertAnonFile(ANON_OWNER_ID, 'note.md', 'first anon note');

    const request = makeMockRequest(ORIGINAL_COOKIE);
    const result = await transferVFSOnLogin(request, undefined);

    expect(result.transferredFiles).toBe(0);
    // The anon file is still there
    expect(listOwnerPaths(ANON_OWNER_ID)).toEqual([`${TEST_WORKSPACE_ROOT}/note.md`]);
  });
});

describe('transferVFSFromAnonymous — register flow uses the same helper', () => {
  beforeEach(() => {
    resetMockDatabase();
  });

  it('register flow also recovers files via the fallback when the cookie is rotated', async () => {
    // Register and login share the same underlying transfer logic —
    // verify the register path also exercises the fallback.
    insertAnonFile(ANON_OWNER_ID, 'note.md', 'first anon note');

    const request = makeMockRequest(ROTATED_COOKIE);
    // transferVFSFromAnonymous returns void (the function name and the
    // return type intentionally differ from transferVFSOnLogin, which
    // is the login-gateway helper that DOES return a count for the
    // client to surface a "restored N files" message). Verify by
    // inspecting the destination workspace, not the return value.
    const result = await transferVFSFromAnonymous(request, { id: NEW_USER_ID });
    expect(result).toBeUndefined();

    expect(listOwnerPaths(ANON_OWNER_ID)).toHaveLength(0);
    expect(listOwnerPaths(NEW_USER_ID)).toEqual([`${TEST_WORKSPACE_ROOT}/note.md`]);
  });
});
