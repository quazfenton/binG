/**
 * Unit tests for the `resolveRequestAuth` + `resolveFilesystemOwner` flow.
 *
 * Verifies that anonymous requests get a stable `anon-session-id` cookie
 * and that the cookie persists across requests within the same browser
 * session. This catches the case where the anon ID changes between
 * requests (which would cause session folder fragmentation — 000 → 002 →
 * 003 → 004 in `workspace/sessions/`).
 *
 * Test cases (14 total):
 *  1. First anonymous request generates a new anon ownerId
 *  2. withAnonSessionCookie sets an HttpOnly cookie on the response
 *  3. Second request WITH the cookie returns the SAME ownerId (stable)
 *  4. Third request WITH the same cookie still returns the SAME ownerId
 *  5. Request WITHOUT cookie (new browser) generates a NEW ownerId
 *  6. Authenticated request returns the JWT userId, ignores the anon cookie
 *  7. x-anonymous-session-id header fallback uses the header value as anon ID
 *  8. Cookie value is sanitized to a concrete expected output
 *  9. Cookie value is truncated when input exceeds the length limit
 *  10. Cookie value passes the general sanitization contract
 *  11. withAnonSessionCookie is a no-op for authenticated users
 *  12. x-anonymous-session-id header is NOT trusted when a valid cookie exists
 *  13. Generated anon ownerId has the "anon:" prefix
 *  14. Anon ownerId is unique across multiple fresh requests (no cookie)
 *
 * Bug fixes verified by this file (all should now pass):
 *  - Bug #1: Double-prefix in resolveFilesystemOwner — FIXED by stripping
 *    both 'anon:' and 'anon_' prefixes before sanitizing, so input 'anon:foo'
 *    no longer becomes 'anon:anon_foo'.
 *  - Bug #2: 69-char truncation limit (not 64) — DOCUMENTED, intentional.
 *    The 'anon:' prefix (5 chars) is prepended AFTER the 64-char
 *    sanitizeSessionId truncation, so the effective limit is 64 + 5 = 69.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilesystemOwner,
  withAnonSessionCookie,
} from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

// Mock resolveRequestAuth to control auth outcomes per test
vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn(),
}));

const mockResolveRequestAuth = vi.mocked(resolveRequestAuth);

/**
 * Helper: create a NextRequest with optional cookies and headers.
 * NextRequest cookies are read-only; we build them via the Cookie header.
 */
function makeRequest(options: {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
}): NextRequest {
  const url = options.url ?? 'http://localhost:3000/api/test';
  const headers = new Headers(options.headers ?? {});
  if (options.cookies && Object.keys(options.cookies).length > 0) {
    const cookieStr = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('Cookie', cookieStr);
  }
  return new NextRequest(url, { headers });
}

/**
 * Helper: extract the anon-session-id cookie value from a response.
 *
 * IMPORTANT: `withAnonSessionCookie` sets the cookie via
 * `response.headers.set('set-cookie', ...)` (raw header string), NOT via
 * `response.cookies.set(...)`. So `response.cookies.get()` returns null —
 * we must parse the Set-Cookie header directly.
 */
function getAnonCookie(response: NextResponse): string | null {
  // Prefer getSetCookie() (Node 20+) which returns all Set-Cookie values
  // as an array, so multi-cookie responses don't accidentally return a
  // non-anon cookie. Fall back to a single-string parse for older runtimes.
  const setCookies = response.headers.getSetCookie?.();
  if (setCookies && setCookies.length > 0) {
    const anonHeader = setCookies.find((c) => c.startsWith('anon-session-id='));
    if (!anonHeader) return null;
    const match = anonHeader.match(/anon-session-id=([^;]+)/);
    return match ? match[1] : null;
  }
  const single = response.headers.get('set-cookie');
  if (!single) return null;
  const match = single.match(/anon-session-id=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Helper: extract the x-anonymous-session-id response header value.
 */
function getAnonHeader(response: NextResponse): string | null {
  return response.headers.get('x-anonymous-session-id');
}

describe('resolveFilesystemOwner + withAnonSessionCookie — anon cookie stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: anonymous request (no JWT, no session)
    mockResolveRequestAuth.mockResolvedValue({
      success: false,
      userId: undefined,
      source: 'anonymous',
    });
  });

  it('first anonymous request generates a new anon ownerId', async () => {
    const req = makeRequest({});
    const owner = await resolveFilesystemOwner(req);

    expect(owner.isAuthenticated).toBe(false);
    expect(owner.source).toBe('anonymous');
    // Generated ownerIds use 'anon:timestamp_hash' format (colon preserved)
    expect(owner.ownerId).toMatch(/^anon:[0-9]+_[a-zA-Z0-9]+$/);
    // The owner should be marked as needing a cookie set
    expect(owner.anonSessionId).toBeDefined();
  });

  it('withAnonSessionCookie sets an HttpOnly cookie on the response', async () => {
    const req = makeRequest({});
    const owner = await resolveFilesystemOwner(req);
    const response = withAnonSessionCookie(NextResponse.json({ ok: true }), owner);

    // Cookie should be set with correct attributes
    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('anon-session-id=');
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=31536000/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/HttpOnly/);

    // Helper-based extraction should also work
    expect(getAnonCookie(response as NextResponse)).toBe(owner.anonSessionId);

    // x-anonymous-session-id header should also be set for client-side JS sync
    expect(getAnonHeader(response as NextResponse)).toBe(owner.anonSessionId);
  });

  it('second request WITH the cookie returns the SAME ownerId (stable across requests)', async () => {
    // First request: generate ownerId
    const req1 = makeRequest({});
    const owner1 = await resolveFilesystemOwner(req1);

    // Set the cookie via withAnonSessionCookie
    const response1 = withAnonSessionCookie(NextResponse.json({ ok: true }), owner1);
    const cookieValue = getAnonCookie(response1 as NextResponse);
    expect(cookieValue).toBe(owner1.anonSessionId);

    // Second request: WITH the cookie → should return the SAME ownerId
    const req2 = makeRequest({ cookies: { 'anon-session-id': cookieValue! } });
    const owner2 = await resolveFilesystemOwner(req2);

    // Bug #1 fix: cookie round-trip should now produce the same ownerId.
    // Previously this would fail with 'anon:null' or a double-prefixed value.
    expect(owner2.ownerId).toBe(owner1.ownerId);
    expect(owner2.anonSessionId).toBeUndefined(); // no new cookie needed
  });

  it('third request WITH the same cookie still returns the SAME ownerId', async () => {
    // First request: generate ownerId
    const req1 = makeRequest({});
    const owner1 = await resolveFilesystemOwner(req1);
    const response1 = withAnonSessionCookie(NextResponse.json({ ok: true }), owner1);
    const cookieValue = getAnonCookie(response1 as NextResponse);

    // Second request: WITH the cookie
    const req2 = makeRequest({ cookies: { 'anon-session-id': cookieValue! } });
    const owner2 = await resolveFilesystemOwner(req2);
    expect(owner2.ownerId).toBe(owner1.ownerId);

    // Third request: WITH the same cookie
    const req3 = makeRequest({ cookies: { 'anon-session-id': cookieValue! } });
    const owner3 = await resolveFilesystemOwner(req3);
    expect(owner3.ownerId).toBe(owner1.ownerId);
    expect(owner3.ownerId).toBe(owner2.ownerId);
  });

  it('request WITHOUT cookie (new browser session) generates a NEW ownerId', async () => {
    // First "browser" gets an anon ID
    const req1 = makeRequest({});
    const owner1 = await resolveFilesystemOwner(req1);

    // Second "browser" (no cookie) gets a different anon ID
    const req2 = makeRequest({});
    const owner2 = await resolveFilesystemOwner(req2);

    expect(owner1.ownerId).not.toBe(owner2.ownerId);
    expect(owner1.ownerId).toMatch(/^anon:/);
    expect(owner2.ownerId).toMatch(/^anon:/);
  });

  it('authenticated request returns the JWT userId and ignores the anon cookie', async () => {
    // Mock authenticated request
    mockResolveRequestAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      source: 'jwt',
    });

    // Request with BOTH a JWT and an anon cookie
    const req = makeRequest({
      cookies: { 'anon-session-id': 'anon:should-be-ignored' },
      headers: { authorization: 'Bearer fake-jwt' },
    });
    const owner = await resolveFilesystemOwner(req);

    expect(owner.isAuthenticated).toBe(true);
    expect(owner.source).toBe('jwt');
    expect(owner.ownerId).toBe('user-123');
  });

  it('x-anonymous-session-id header fallback uses the header value as anon ID', async () => {
    // No cookie, but the client sent the x-anonymous-session-id header
    // (prevents session fragmentation during initial page load before cookie is set)
    const headerId = 'client-provided-stable-id-1234567890';
    const req = makeRequest({
      headers: { 'x-anonymous-session-id': headerId },
    });
    const owner = await resolveFilesystemOwner(req);

    expect(owner.isAuthenticated).toBe(false);
    expect(owner.source).toBe('anonymous');
    // Bug #1 fix: header value should NOT be double-prefixed.
    // Should be 'anon:client-provided-stable-id-1234567890' (single prefix).
    expect(owner.ownerId).toBe(`anon:${headerId}`);
    // Should be marked for cookie sync so the client can persist it
    expect(owner.anonSessionId).toBe(headerId);

    // Setting the cookie should put the client-provided value (not double-prefixed)
    const response = withAnonSessionCookie(NextResponse.json({ ok: true }), owner);
    expect(getAnonCookie(response as NextResponse)).toBe(headerId);
  });

  it('cookie value is sanitized to a concrete expected output', async () => {
    // Use a cookie value that contains chars that would be sanitized.
    // After the Bug #1 fix, the input 'anon:test<script>foo<bar>baz' should
    // be sanitized to a single-prefixed ownerId, NOT 'anon:anon_test_...'.
    const input = 'test<script>foo<bar>baz';
    const req = makeRequest({
      cookies: { 'anon-session-id': `anon:${input}` },
    });
    const owner = await resolveFilesystemOwner(req);

    // Expected: strips 'anon:', sanitizes 'test<script>foo<bar>baz'
    // (replacing < and > with _), prepended with 'anon:'
    // Result: 'anon:test_script_foo_bar_baz' (28 chars)
    expect(owner.ownerId).toBe('anon:test_script_foo_bar_baz');
    expect(owner.ownerId).not.toContain('anon:anon_'); // no double prefix
  });

  it('cookie value is truncated when input exceeds the length limit', async () => {
    // Input: 'anon:' + 100 'a's (total 105 chars before sanitization)
    // After stripping 'anon:': 100 'a's
    // After sanitizeSessionId: 64 'a's (truncated to 64)
    // After prepending 'anon:': 'anon:' + 64 'a's (total 69 chars)
    const longInput = 'a'.repeat(100);
    const req = makeRequest({
      cookies: { 'anon-session-id': `anon:${longInput}` },
    });
    const owner = await resolveFilesystemOwner(req);

    // Should be exactly 69 chars (5 for 'anon:' + 64 sanitized)
    expect(owner.ownerId.length).toBe(69);
    expect(owner.ownerId).toBe(`anon:${'a'.repeat(64)}`);
    // No double prefix
    expect(owner.ownerId).not.toContain('anon:anon_');
  });

  it('cookie value passes the general sanitization contract', async () => {
    // General contract: only [a-zA-Z0-9_:-] chars, max 69 chars total,
    // no script tags. The 'anon:' prefix is added by the function itself.
    const maliciousCookie = 'anon:<script>alert("xss")</script>' + 'a'.repeat(100);
    const req = makeRequest({ cookies: { 'anon-session-id': maliciousCookie } });
    const owner = await resolveFilesystemOwner(req);

    // Should be truncated to 69 chars (the actual limit)
    expect(owner.ownerId.length).toBeLessThanOrEqual(69);
    // Should not contain any script tags or special chars (other than the
    // single ':' separator between 'anon' and the rest)
    expect(owner.ownerId).not.toContain('<');
    expect(owner.ownerId).not.toContain('>');
    expect(owner.ownerId).not.toContain('"');
    expect(owner.ownerId).not.toContain('(');
    expect(owner.ownerId).not.toContain(')');
    const colonCount = (owner.ownerId.match(/:/g) ?? []).length;
    expect(colonCount).toBeLessThanOrEqual(1);
    // No double prefix
    expect(owner.ownerId).not.toContain('anon:anon_');
  });

  it('withAnonSessionCookie is a no-op for authenticated users (no anon cookie for JWT users)', async () => {
    // Mock authenticated request
    mockResolveRequestAuth.mockResolvedValue({
      success: true,
      userId: 'user-456',
      source: 'jwt',
    });

    const req = makeRequest({
      headers: { authorization: 'Bearer fake-jwt' },
    });
    const owner = await resolveFilesystemOwner(req);
    expect(owner.isAuthenticated).toBe(true);

    // withAnonSessionCookie should NOT set a cookie for authenticated users
    const response = withAnonSessionCookie(NextResponse.json({ ok: true }), owner);
    const cookieValue = getAnonCookie(response as NextResponse);
    expect(cookieValue).toBeNull();
    // No Set-Cookie header should be present (catches a regression where
    // the cookie is set with an empty value, which would still pass a
    // getAnonCookie-null check but leak an empty cookie to the client)
    expect(response.headers.get('Set-Cookie')).toBeNull();
    // Also verify the response wasn't modified in a way that adds a cookie
    const allSetCookies = response.headers.getSetCookie?.() ?? [];
    expect(allSetCookies).toHaveLength(0);
  });

  it('x-anonymous-session-id header is NOT trusted when a valid cookie exists (security)', async () => {
    // Simulate a browser that already has a stable cookie, but a malicious
    // script tries to override the identity via the header.
    const existingCookie = 'legitimate-stable-id-12345';
    const maliciousHeader = 'attacker-controlled-id';

    const req = makeRequest({
      cookies: { 'anon-session-id': existingCookie },
      headers: { 'x-anonymous-session-id': maliciousHeader },
    });
    const owner = await resolveFilesystemOwner(req);

    // The ownerId should NOT contain the attacker-controlled value
    expect(owner.ownerId).not.toContain('attacker');
    // Should be derived from the cookie (with 'anon:' prefix)
    expect(owner.ownerId).toBe(`anon:${existingCookie}`);
    // The response should NOT issue a new cookie (the existing one wins)
    const response = withAnonSessionCookie(NextResponse.json({ ok: true }), owner);
    const cookieValue = getAnonCookie(response as NextResponse);
    expect(cookieValue).toBeNull();
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('resolveFilesystemOwner — session ID format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveRequestAuth.mockResolvedValue({
      success: false,
      userId: undefined,
      source: 'anonymous',
    });
  });

  it('generated anon ownerId has the "anon:" prefix', async () => {
    const req = makeRequest({});
    const owner = await resolveFilesystemOwner(req);
    // Generated ownerIds use 'anon:timestamp_hash' format
    expect(owner.ownerId.startsWith('anon:')).toBe(true);
  });

  it('anon ownerId is unique across multiple fresh requests (no cookie)', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const owner = await resolveFilesystemOwner(makeRequest({}));
      ids.add(owner.ownerId);
    }
    // All 5 should be unique (no collisions)
    expect(ids.size).toBe(5);
  });
});
