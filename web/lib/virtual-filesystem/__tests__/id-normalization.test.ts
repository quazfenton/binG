/**
 * Unit tests for id-normalization (Bug #26 regression fix)
 *
 * The two extractors are the single source of truth for parsing ownerId
 * strings. A regression in either of them either (a) blocks all anon
 * writes (false SessionPathMismatchError) or (b) silently misroutes
 * files between sessions.
 *
 * Critical cases (Bug #26 regression):
 *   - `anon:1780963912001_a097129a4515a7fa67` → sessionId is '' (NOT
 *     the USERID). The USERID is the user's identity, not a session.
 *   - `anon:1780963912001_a097129a4515a7fa67$001` → sessionId is '001'.
 *   - Bare strings like `default` carry no session info either.
 */

import { describe, it, expect } from 'vitest';

import {
  extractSessionIdFromOwnerId,
  extractUserIdFromOwnerId,
  buildScopePath,
  buildOwnerId,
  normalizeSessionIdToFolder,
  isValidSessionId,
  isValidOwnerId,
  cookieToOwnerId,
  cookieToScopePath,
  generateAnonSessionId,
  sanitizePathSegment,
} from '../id-normalization';

describe('extractSessionIdFromOwnerId (Bug #26 regression)', () => {
  describe('plain anon:USERID ownerIds (no $)', () => {
    it('returns empty string for the canonical anon:USERID format', () => {
      // The USERID is the user's identity, not a sessionId.
      // Previously this returned `1780963912001_a097129a4515a7fa67`,
      // which caused 234 false "Session id mismatch" errors in run.log.
      expect(extractSessionIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67')).toBe('');
    });

    it('returns empty string for short anon ownerIds', () => {
      expect(extractSessionIdFromOwnerId('anon:abc123')).toBe('');
    });

    it('returns empty string for 3-digit anon ownerIds', () => {
      // Previously this returned '001' — the path-drift guard would
      // then refuse every read/write to workspace/sessions/001.
      expect(extractSessionIdFromOwnerId('anon:001')).toBe('');
    });

    it('returns empty string for anonymous edge cases', () => {
      expect(extractSessionIdFromOwnerId('anon:')).toBe('');
      expect(extractSessionIdFromOwnerId('anon:0')).toBe('');
    });
  });

  describe('composite ownerIds with $', () => {
    it('returns the sessionId from anon:USERID$SESSIONID', () => {
      expect(extractSessionIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67$001')).toBe('001');
    });

    it('returns the sessionId from anon$session', () => {
      expect(extractSessionIdFromOwnerId('anon$session_abc')).toBe('session_abc');
    });

    it('returns the sessionId from user@domain$001 (FIRST $)', () => {
      // SECURITY: we use indexOf (FIRST $) so a user-provided $ in the
      // sessionId (e.g. `user$session$with$dollars`) is preserved.
      expect(extractSessionIdFromOwnerId('user@domain$001')).toBe('001');
    });

    it('preserves user-provided $ in the sessionId', () => {
      expect(extractSessionIdFromOwnerId('user$session$with$dollars')).toBe('session$with$dollars');
    });

    it('returns empty string when $ is the last char', () => {
      expect(extractSessionIdFromOwnerId('user$')).toBe('');
    });
  });

  describe('bare ownerIds (no anon: prefix, no $)', () => {
    it('returns empty string for "default"', () => {
      // Previously this returned 'default', causing false drift.
      expect(extractSessionIdFromOwnerId('default')).toBe('');
    });

    it('returns empty string for bare usernames', () => {
      expect(extractSessionIdFromOwnerId('alice')).toBe('');
      expect(extractSessionIdFromOwnerId('user_42')).toBe('');
    });
  });

  describe('invalid inputs', () => {
    it('returns empty string for empty input', () => {
      expect(extractSessionIdFromOwnerId('')).toBe('');
    });

    it('returns empty string for null', () => {
      expect(extractSessionIdFromOwnerId(null as any)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(extractSessionIdFromOwnerId(undefined as any)).toBe('');
    });

    it('returns empty string for non-string input', () => {
      expect(extractSessionIdFromOwnerId(123 as any)).toBe('');
      expect(extractSessionIdFromOwnerId({} as any)).toBe('');
    });
  });
});

describe('extractUserIdFromOwnerId', () => {
  it('returns the WHOLE ownerId (incl. anon: prefix) from anon:USERID', () => {
    // The `anon:` prefix is part of the user identity, not a namespace
    // marker to strip. The user (in the user's own model) IS the entire
    // `anon:USERID` string — that's the userId. There is no session
    // embedded in this form; the session would only be present after a
    // `$` delimiter (e.g. `anon:USERID$001`).
    expect(extractUserIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67'))
      .toBe('anon:1780963912001_a097129a4515a7fa67');
  });

  it('returns the full string for bare ownerIds (no $)', () => {
    expect(extractUserIdFromOwnerId('default')).toBe('default');
    expect(extractUserIdFromOwnerId('alice')).toBe('alice');
  });

  it('returns the part before $ for composite ownerIds (FIRST $)', () => {
    expect(extractUserIdFromOwnerId('user@domain$001')).toBe('user@domain');
    expect(extractUserIdFromOwnerId('anon$session_abc')).toBe('anon');
  });

  it('returns anon:USERID for composite anon ownerIds', () => {
    expect(extractUserIdFromOwnerId('anon:1780963912001_a097129a4515a7fa67$001'))
      .toBe('anon:1780963912001_a097129a4515a7fa67');
  });

  it('returns empty string for empty / null / undefined / non-string', () => {
    expect(extractUserIdFromOwnerId('')).toBe('');
    expect(extractUserIdFromOwnerId(null as any)).toBe('');
    expect(extractUserIdFromOwnerId(undefined as any)).toBe('');
    expect(extractUserIdFromOwnerId(123 as any)).toBe('');
  });
});

describe('round-trip: extractSessionIdFromOwnerId ∘ extractUserIdFromOwnerId', () => {
  it('reconstructs the original ownerId for composite anon ownerIds', () => {
    const ownerId = 'anon:1780963912001_a097129a4515a7fa67$001';
    const userId = extractUserIdFromOwnerId(ownerId);
    const sessionId = extractSessionIdFromOwnerId(ownerId);
    expect(`${userId}$${sessionId}`).toBe(ownerId);
  });

  it('extracts empty sessionId for plain anon:USERID', () => {
    const ownerId = 'anon:1780963912001_a097129a4515a7fa67';
    const userId = extractUserIdFromOwnerId(ownerId);
    const sessionId = extractSessionIdFromOwnerId(ownerId);
    // The whole `anon:USERID` IS the userId (the `anon:` prefix is part
    // of the user identity); no session is encoded without a `$`.
    expect(userId).toBe('anon:1780963912001_a097129a4515a7fa67');
    expect(sessionId).toBe('');
  });
});

describe('buildScopePath / buildOwnerId / normalizeSessionIdToFolder / isValid*', () => {
  it('buildScopePath produces canonical session paths', () => {
    expect(buildScopePath('001')).toBe('workspace/sessions/001');
    expect(buildScopePath('alpha-1')).toBe('workspace/sessions/alpha-1');
  });

  it('buildOwnerId produces canonical anon ownerIds', () => {
    expect(buildOwnerId('001')).toBe('anon:001');
  });

  it('normalizeSessionIdToFolder handles composite IDs', () => {
    expect(normalizeSessionIdToFolder('001')).toBe('001');
    expect(normalizeSessionIdToFolder('1$004')).toBe('004');
    expect(normalizeSessionIdToFolder('anon$004')).toBe('004');
    expect(normalizeSessionIdToFolder('')).toBe('');
  });

  it('isValidSessionId accepts and rejects correctly', () => {
    expect(isValidSessionId('001')).toBe(true);
    expect(isValidSessionId('alpha-1')).toBe(true);
    expect(isValidSessionId('user_42')).toBe(true);
    expect(isValidSessionId('has space')).toBe(false);
    expect(isValidSessionId('has$dollar')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
  });

  it('isValidOwnerId accepts and rejects correctly', () => {
    expect(isValidOwnerId('user:session')).toBe(true);
    expect(isValidOwnerId('anon:abc123')).toBe(true);
    expect(isValidOwnerId('user_42')).toBe(true);
    expect(isValidOwnerId('has space')).toBe(false);
  });
});

describe('cookieToOwnerId / cookieToScopePath / generateAnonSessionId / sanitizePathSegment', () => {
  it('cookieToOwnerId normalizes anon_<id> to anon:<id>', () => {
    expect(cookieToOwnerId('anon_1780963912001_a097129a4515a7fa67'))
      .toBe('anon:1780963912001_a097129a4515a7fa67');
    expect(cookieToOwnerId('plain-cookie-value'))
      .toBe('anon:plain-cookie-value');
  });

  it('cookieToScopePath produces workspace/sessions/<id>', () => {
    expect(cookieToScopePath('anon_1780963912001_a097129a4515a7fa67'))
      .toBe('workspace/sessions/1780963912001_a097129a4515a7fa67');
  });

  it('generateAnonSessionId returns anon_<id> format', () => {
    const id = generateAnonSessionId();
    expect(id).toMatch(/^anon_[a-z0-9_]+$/);
  });

  it('sanitizePathSegment strips invalid chars and caps length', () => {
    expect(sanitizePathSegment('hello world/../etc')).toBe('hello_world____etc');
    expect(sanitizePathSegment('a'.repeat(100))).toHaveLength(64);
  });
});
