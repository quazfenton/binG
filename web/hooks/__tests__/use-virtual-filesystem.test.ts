/**
 * Tests for the anonymous ownerId resolution in use-virtual-filesystem.ts.
 * Covers Critical Bug #2 (IDOR via getOwnerId Priority 3) — two different
 * browser sessions navigating to the same URL path (e.g. /chat/004) must
 * get DISTINCT ownerIds so they can't read/write each other's VFS files.
 *
 * The old code returned the raw session number derived from the URL path
 * (e.g. "004") directly, which meant two browsers on /chat/004 both got
 * ownerId="004" and shared the same VFS database partition. This test
 * suite locks in the fix: every anonymous ownerId MUST be `anon:<unique>`
 * and MUST be unique per localStorage instance.
 */
import { describe, it, expect } from 'vitest';
import { resolveAnonymousOwnerId, isAnonOwner } from '../use-virtual-filesystem';

describe('resolveAnonymousOwnerId (Critical Bug #2 IDOR fix)', () => {
  // In-memory storage mock — each instance simulates a separate browser's
  // localStorage. Two different instances are guaranteed to have independent
  // state, so this directly tests the "two different browser sessions"
  // scenario the user asked about.
  function makeStorage(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
  }

  it('returns an ownerId prefixed with "anon:" on first call', () => {
    const storage = makeStorage();
    const ownerId = resolveAnonymousOwnerId(storage);
    expect(ownerId.startsWith('anon:')).toBe(true);
  });

  it('returns the same ownerId on subsequent calls (stable within a browser session)', () => {
    const storage = makeStorage();
    const first = resolveAnonymousOwnerId(storage);
    const second = resolveAnonymousOwnerId(storage);
    expect(first).toBe(second);
  });

  it('returns DISTINCT ownerIds for two different browser sessions on the same URL path (IDOR fix)', () => {
    // The exact scenario from Critical Bug #2: two different browser sessions
    // on /chat/004. The old code returned "004" for both. The new code
    // generates a unique UUID per localStorage, so the two sessions are
    // properly partitioned in the VFS database.
    const browserA = makeStorage();
    const browserB = makeStorage();
    const ownerA = resolveAnonymousOwnerId(browserA);
    const ownerB = resolveAnonymousOwnerId(browserB);
    expect(ownerA).not.toBe(ownerB);
    expect(ownerA.startsWith('anon:')).toBe(true);
    expect(ownerB.startsWith('anon:')).toBe(true);
  });

  it('normalizes existing localStorage values that lack the "anon:" prefix (backward compat)', () => {
    // Old code may have stored a raw UUID or timestamp without the prefix.
    const storage = makeStorage({ anonymous_session_id: 'abc123-def456' });
    const ownerId = resolveAnonymousOwnerId(storage);
    expect(ownerId).toBe('anon:abc123-def456');
  });

  it('normalizes the legacy "anon_xxx" format to "anon:xxx"', () => {
    // The prior Priority 4 had a normalization fix for this exact case.
    // Make sure the new function preserves that behavior.
    const storage = makeStorage({ anonymous_session_id: 'anon_12345_abc' });
    const ownerId = resolveAnonymousOwnerId(storage);
    expect(ownerId).toBe('anon:12345_abc');
  });

  it('does not overwrite a valid existing "anon:" value (idempotent)', () => {
    const storage = makeStorage({ anonymous_session_id: 'anon:existing-uuid' });
    const ownerId = resolveAnonymousOwnerId(storage);
    expect(ownerId).toBe('anon:existing-uuid');
  });
});

describe('isAnonOwner (Step 2 regression fix for anon: prefix recognition)', () => {
  // Critical: the new `resolveAnonymousOwnerId` returns `anon:<uuid>`, so
  // `isAnonOwner` MUST recognize that prefix. The previous predicate
  // missed `anon:` and would have returned `false` for the canonical
  // anonymous ownerId, misclassifying anonymous users as authenticated.
  // That broke the session-switch clearing logic in the OPFS init
  // useEffect (it would skip the localStorage + IndexedDB clear when it
  // should have run).

  it('recognizes the canonical anon:<uuid> format produced by resolveAnonymousOwnerId', () => {
    expect(isAnonOwner('anon:abc-123-def-456')).toBe(true);
    expect(isAnonOwner('anon:')).toBe(true);
    // Whatever crypto.randomUUID() produces
    expect(isAnonOwner('anon:550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('recognizes the composite-session anon$sessionNum format (composite SessionID branch)', () => {
    // The composite-session branch returns `anon:<sessionPart>` (e.g. 'anon:004').
    expect(isAnonOwner('anon:004')).toBe(true);
    expect(isAnonOwner('anon:1')).toBe(true);
  });

  it('recognizes the legacy anon_xxx format (backward compat)', () => {
    expect(isAnonOwner('anon_12345_abc')).toBe(true);
  });

  it('recognizes the legacy anon- and anonymous- prefixed formats', () => {
    expect(isAnonOwner('anon-12345')).toBe(true);
    expect(isAnonOwner('anonymous-12345')).toBe(true);
  });

  it('recognizes the legacy anon$ and anonymous$ prefixed formats', () => {
    expect(isAnonOwner('anon$12345')).toBe(true);
    expect(isAnonOwner('anonymous$12345')).toBe(true);
  });

  it('recognizes the bare literals "anon" and "anonymous"', () => {
    expect(isAnonOwner('anon')).toBe(true);
    expect(isAnonOwner('anonymous')).toBe(true);
  });

  it('returns false for authenticated user IDs', () => {
    expect(isAnonOwner('user-123')).toBe(false);
    expect(isAnonOwner('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    expect(isAnonOwner('1$004')).toBe(false); // composite auth session
  });

  it('returns false for the empty string (defensive)', () => {
    expect(isAnonOwner('')).toBe(false);
  });

  it('does NOT misclassify the literal "annona" or "anonymous-substring" as anonymous', () => {
    // Defensive: startsWith is fine because we use `anon:` (colon, not just letters)
    expect(isAnonOwner('annona-xyz')).toBe(false);
    expect(isAnonOwner('foo-anonymous-123')).toBe(false); // starts with 'foo-', not 'anonymous-'
  });
});
