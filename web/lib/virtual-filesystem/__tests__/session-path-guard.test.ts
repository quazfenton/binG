import { resolveScopePathFromOwnerId } from '../scope-utils';
/**
 * Unit tests for session-path-guard (Bug #26: path-drift protection)
 *
 * Covers:
 *   1. SESSION_SCOPED_PATH_REGEX pattern matching
 *   2. isSessionScopedPath() boolean check
 *   3. assertScopePathMatchesSessionId() — match, mismatch, no-ops
 *   4. SessionPathMismatchError — class shape, message, fields
 *   5. invalidateAllScopeCachesForRename() — drops old/new/ancestor + search entries
 *
 * The cache and logger modules are mocked at the top of the file so the tests
 * run in isolation without a real cache backend.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted to the top of the file, so the mock variables MUST be
// declared with vi.hoisted() to be available inside the factory.
const { mockDelete, mockKeys } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockKeys: vi.fn(() => [] as string[]),
}));

vi.mock('@/lib/utils/cache', () => ({
  toolResultCache: {
    delete: mockDelete,
    keys: mockKeys,
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  SESSION_SCOPED_PATH_REGEX,
  isSessionScopedPath,
  assertScopePathMatchesSessionId,
  SessionPathMismatchError,
  invalidateAllScopeCachesForRename,
} from '../session-path-guard';

beforeEach(() => {
  mockDelete.mockReset();
  mockKeys.mockReset();
  mockKeys.mockReturnValue([]);
});

describe('SESSION_SCOPED_PATH_REGEX', () => {
  it('matches numeric session ids', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/001')).toBe(true);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/1234567')).toBe(true);
  });

  it('matches alpha session ids', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/alpha')).toBe(true);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/ai_terminal')).toBe(true);
  });

  it('matches alpha-numeric session ids', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/alpha-1')).toBe(true);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/session-42-test')).toBe(true);
  });

  it('matches composite session ids', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/1$004')).toBe(true);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/anon$001')).toBe(true);
  });

  it('matches paths with subdirectories', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/001/src/app.ts')).toBe(true);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/alpha/nested/deep/file.txt')).toBe(true);
  });

  it('rejects root scope', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace')).toBe(false);
  });

  it('rejects sessions/ without an id', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions')).toBe(false);
    expect(SESSION_SCOPED_PATH_REGEX.test('workspace/sessions/')).toBe(false);
  });

  it('rejects sessions/ prefix without workspace/', () => {
    expect(SESSION_SCOPED_PATH_REGEX.test('sessions/001')).toBe(false);
  });
});

describe('isSessionScopedPath', () => {
  it('returns true for session-scoped paths', () => {
    expect(isSessionScopedPath('workspace/sessions/001')).toBe(true);
    expect(isSessionScopedPath('workspace/sessions/alpha/src/app.ts')).toBe(true);
  });

  it('returns false for non-session-scoped paths', () => {
    expect(isSessionScopedPath('workspace')).toBe(false);
    expect(isSessionScopedPath('workspace/src/app.ts')).toBe(false);
    expect(isSessionScopedPath('sessions/001')).toBe(false);
  });

  it('returns false for undefined/empty', () => {
    expect(isSessionScopedPath(undefined)).toBe(false);
    expect(isSessionScopedPath('')).toBe(false);
  });
});

describe('assertScopePathMatchesSessionId', () => {
  it('passes when scopePath session id matches ownerId session id (composite ownerId)', () => {
    expect(() => {
      assertScopePathMatchesSessionId('1$001', 'workspace/sessions/001');
    }).not.toThrow();
  });

  it('passes when scopePath session id matches ownerId session id (composite anon ownerId)', () => {
    expect(() => {
      assertScopePathMatchesSessionId(
        'anon:1781140394202_dfe2a8d006d3d4db22$001',
        'workspace/sessions/001',
      );
    }).not.toThrow();
  });

  it('is a no-op for plain anon:USERID ownerIds (no $) — USERID is NOT a sessionId', () => {
    // REGRESSION FIX: previously `extractSessionIdFromOwnerId` returned
    // the entire USERID portion (e.g. `1781140394202_dfe2a8d006d3d4db22`)
    // as the sessionId, which caused the guard to throw `SessionPathMismatchError`
    // for every anon write/read/list against `workspace/sessions/001`
    // (234 occurrences in run.log). The USERID is the user's identity,
    // not a sessionId — so the guard must short-circuit when the ownerId
    // has no `$` delimiter.
    expect(() => {
      assertScopePathMatchesSessionId(
        'anon:1781140394202_dfe2a8d006d3d4db22',
        'workspace/sessions/001',
      );
    }).not.toThrow();
  });

  it('is a no-op for plain anon:USERID ownerIds even against a renamed-looking scopePath', () => {
    // The guard cannot detect drift when the ownerId carries no session
    // information. The caller is responsible for the scopePath.
    expect(() => {
      assertScopePathMatchesSessionId(
        'anon:1781140394202_dfe2a8d006d3d4db22',
        'workspace/sessions/ai_terminal',
      );
    }).not.toThrow();
  });

  it('throws SessionPathMismatchError on real session id drift (composite ownerId)', () => {
    // ownerId `1$001` encodes session `001` but scopePath points at
    // `ai_terminal` — true drift, must throw.
    expect(() => {
      assertScopePathMatchesSessionId('1$001', 'workspace/sessions/ai_terminal');
    }).toThrow(SessionPathMismatchError);
  });

  it('throws SessionPathMismatchError on drift for composite anon ownerIds', () => {
    // ownerId `anon:USERID$001` encodes session `001` but scopePath
    // points at `ai_terminal` — true drift, must throw.
    expect(() => {
      assertScopePathMatchesSessionId(
        'anon:1781140394202_dfe2a8d006d3d4db22$001',
        'workspace/sessions/ai_terminal',
      );
    }).toThrow(SessionPathMismatchError);
  });

  it('throws SessionPathMismatchError with all the right fields populated', () => {
    let captured: SessionPathMismatchError | undefined;
    try {
      assertScopePathMatchesSessionId('1$001', 'workspace/sessions/ai_terminal');
    } catch (err: any) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SessionPathMismatchError);
    expect(captured!.name).toBe('SessionPathMismatchError');
    expect(captured!.ownerId).toBe('1$001');
    expect(captured!.ownerIdSession).toBe('001');
    expect(captured!.scopePathSession).toBe('ai_terminal');
    // The error message should mention the mismatch and the remediation hint
    expect(captured!.message).toMatch(/mismatch/i);
    expect(captured!.message).toMatch(/ai_terminal/);
    expect(captured!.message).toMatch(/001/);
  });

  it('is a no-op when scopePath is undefined', () => {
    expect(() => {
      assertScopePathMatchesSessionId('1$001', undefined);
    }).not.toThrow();
  });

  it('is a no-op when scopePath is empty string', () => {
    expect(() => {
      assertScopePathMatchesSessionId('1$001', '');
    }).not.toThrow();
  });

  it('is a no-op when scopePath is just "workspace" (root scope)', () => {
    expect(() => {
      assertScopePathMatchesSessionId('1$001', 'workspace');
    }).not.toThrow();
  });

  it('is a no-op when ownerId is empty (no session to compare against)', () => {
    // The guard short-circuits when extractSessionIdFromOwnerId returns
    // an empty string. Drift detection requires the ownerId to actually
    // encode a session (have a `$` delimiter).
    expect(() => {
      assertScopePathMatchesSessionId('', 'workspace/sessions/001');
    }).not.toThrow();
  });

  it('is a no-op for bare ownerIds like "default" (no $) — whole string is the userId, not a session', () => {
    // REGRESSION FIX: previously `extractSessionIdFromOwnerId` returned
    // the whole string (`default`) as the sessionId, which caused false
    // drift errors. Bare ownerIds without `$` carry no session info.
    expect(() => {
      assertScopePathMatchesSessionId('default', 'workspace/sessions/001');
    }).not.toThrow();
  });

  it('normalizes scopePath before comparison (trailing slash, leading slash)', () => {
    expect(() => {
      assertScopePathMatchesSessionId(
        '1$001',
        '/workspace/sessions/001/',
      );
    }).not.toThrow();
  });
});

describe('SessionPathMismatchError', () => {
  it('is a proper Error subclass with the expected fields', () => {
    const err = new SessionPathMismatchError(
      'anon:001',
      'workspace/sessions/ai_terminal',
      '001',
      'ai_terminal',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SessionPathMismatchError);
    expect(err.name).toBe('SessionPathMismatchError');
    expect(err.ownerId).toBe('anon:001');
    expect(err.scopePath).toBe('workspace/sessions/ai_terminal');
    expect(err.ownerIdSession).toBe('001');
    expect(err.scopePathSession).toBe('ai_terminal');
  });

  it('message is helpful and points to the path-drift cause', () => {
    const err = new SessionPathMismatchError(
      'anon:001',
      'workspace/sessions/ai_terminal',
      '001',
      'ai_terminal',
    );
    expect(err.message).toContain('Session id mismatch');
    expect(err.message).toContain('workspace/sessions/ai_terminal');
    expect(err.message).toContain('ai_terminal');
    expect(err.message).toContain('001');
    expect(err.message).toContain('rename');
  });
});

describe('invalidateAllScopeCachesForRename', () => {
  it('deletes cache entries for the old path + new path + ancestors + trailing-slash variants', () => {
    mockKeys.mockReturnValue([]); // no search entries
    invalidateAllScopeCachesForRename(
      'anon:001',
      'workspace/sessions/001/old-sub',
      'workspace/sessions/001/new-sub',
      undefined,
    );

    // Old path + ancestor + trailing-slash variants
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/old-sub');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/old-sub/');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/');

    // New path + ancestor + trailing-slash variants
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/new-sub');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/new-sub/');

    // Wildcard root variants
    expect(mockDelete).toHaveBeenCalledWith('anon:001:');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:.');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:/');
  });

  it('clears the search: prefix entries for the owner', () => {
    mockKeys.mockReturnValue([
      'search:anon:001:src',
      'search:anon:001:docs',
      'tool:file:list:workspace/sessions/001', // NOT a search entry — should be left alone
      'search:other:user:src', // not our owner — should be left alone
    ]);
    invalidateAllScopeCachesForRename(
      'anon:001',
      'workspace/sessions/001/old',
      'workspace/sessions/001/new',
      undefined,
    );

    // The two search:anon:001:* entries must be deleted
    expect(mockDelete).toHaveBeenCalledWith('search:anon:001:src');
    expect(mockDelete).toHaveBeenCalledWith('search:anon:001:docs');
    // Non-search entries and other-owner entries must NOT be deleted by the
    // search-prefix loop (they may be deleted by other invalidate paths, but
    // not via the search-prefix code path). Verify the search:other:user:src
    // key was never called via the keys() iteration — since we mock keys()
    // returning it, if the search-prefix code path touched it via a separate
    // delete call we'd see it. Best-effort check: just verify the count of
    // delete calls for those keys is 0 by filtering.
    const allCalls = mockDelete.mock.calls.map((args) => args[0]);
    expect(allCalls).not.toContain('search:other:user:src');
  });

  it('is safe when called with only oldPath', () => {
    mockKeys.mockReturnValue([]);
    expect(() => {
      invalidateAllScopeCachesForRename(
        'anon:001',
        'workspace/sessions/001/foo',
        undefined,
        undefined,
      );
    }).not.toThrow();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('is safe when called with only scopePath', () => {
    mockKeys.mockReturnValue([]);
    expect(() => {
      invalidateAllScopeCachesForRename(
        'anon:001',
        undefined,
        undefined,
        'workspace/sessions/001/sub',
      );
    }).not.toThrow();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('is safe when called with all undefined', () => {
    mockKeys.mockReturnValue([]);
    expect(() => {
      invalidateAllScopeCachesForRename('anon:001', undefined, undefined, undefined);
    }).not.toThrow();
    // Even with no paths, the wildcard root entries should still be attempted
    expect(mockDelete).toHaveBeenCalledWith('anon:001:');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:.');
    expect(mockDelete).toHaveBeenCalledWith('anon:001:/');
  });

  it('normalizes backslashes to forward slashes', () => {
    mockKeys.mockReturnValue([]);
    invalidateAllScopeCachesForRename(
      'anon:001',
      'workspace\\sessions\\001\\old',
      undefined,
      undefined,
    );
    expect(mockDelete).toHaveBeenCalledWith('anon:001:workspace/sessions/001/old');
  });

  it('strips trailing slashes before computing ancestors', () => {
    mockKeys.mockReturnValue([]);
    invalidateAllScopeCachesForRename(
      'anon:001',
      'workspace/sessions/001/old/',
      undefined,
      undefined,
    );
    // Should not produce a duplicate `...001/old//` entry
    const allCalls = mockDelete.mock.calls.map((args) => args[0]);
    const trailingDoubleSlash = allCalls.filter((k) => k.endsWith('//'));
    expect(trailingDoubleSlash).toEqual([]);
  });
});


describe('resolveScopePathFromOwnerId', () => {
  it('returns the fallback unchanged for plain anon:USERID ownerIds (no $) — USERID is NOT a sessionId', () => {
    // REGRESSION FIX: previously this derived `workspace/sessions/1780963912001_a097129a4515a7fa67`,
    // which is wrong — the USERID is the user's identity, not a session.
    // The system should keep the default fallback (`workspace/sessions/000`)
    // until the ownerId is upgraded to composite form with a `$SESSIONID` suffix.
    const ownerId = 'anon:1780963912001_a097129a4515a7fa67';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/000');
    expect(result).toBe('workspace/sessions/000');
  });

  it('derives scopePath from anon:USERID$SESSION ownerId when scopePath is the default fallback', () => {
    const ownerId = 'anon:1780963912001_a097129a4515a7fa67$001';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/000');
    expect(result).toBe('workspace/sessions/001');
  });

  it('derives scopePath from anon$ ownerId when scopePath is the default fallback', () => {
    const ownerId = 'anon$session_abc';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/000');
    expect(result).toBe('workspace/sessions/session_abc');
  });

  it('derives scopePath from user$session ownerId when scopePath is the default fallback', () => {
    const ownerId = 'user@domain$001';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/000');
    expect(result).toBe('workspace/sessions/001');
  });

  it('returns scopePath unchanged when it is NOT the default fallback', () => {
    const ownerId = 'anon:abc123';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/001');
    expect(result).toBe('workspace/sessions/001');
  });

  it('returns the fallback unchanged when ownerId is empty', () => {
    // An empty ownerId is the canonical "no session" case — the guard
    // already returns early when ownerSession is empty, so the fallback
    // is the correct scopePath to use.
    const ownerId = '';
    const result = resolveScopePathFromOwnerId(ownerId, 'workspace/sessions/000');
    expect(result).toBe('workspace/sessions/000');
  });

  it('returns "workspace" when scopePath is undefined', () => {
    const ownerId = 'anon:abc123';
    const result = resolveScopePathFromOwnerId(ownerId, undefined);
    expect(result).toBe('workspace');
  });
});
