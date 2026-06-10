/**
 * Unit tests for the shared JWT helpers (bing/packages/shared/auth/jwt.ts).
 *
 * Covers: valid round-trip, bad signature (wrong secret), tampered payload,
 * expired token, malformed input, non-HS256 algorithm header (alg confusion),
 * and decodeJwtUnverified reading claims from a valid token.
 */
import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, decodeJwtUnverified } from '../jwt';

const SECRET_A = 'test-secret-a-12345';
const SECRET_B = 'test-secret-b-67890';

function tamperSignature(token: string): string {
  // Replace the last char of the signature with a different valid base64url char
  const parts = token.split('.');
  const last = parts[2].slice(-1);
  const replacement = last === 'A' ? 'B' : 'A';
  parts[2] = parts[2].slice(0, -1) + replacement;
  return parts.join('.');
}

function tamperPayload(token: string, newPayload: object): string {
  const [h, , s] = token.split('.');
  const newPayloadB64 = btoa(JSON.stringify(newPayload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${newPayloadB64}.${s}`;
}

describe('shared/jwt (sign + verify)', () => {
  it('signJwt returns a 3-part base64url token', async () => {
    const token = await signJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET_A);
    expect(token.split('.').length).toBe(3);
  });

  it('verifyJwt accepts a valid token signed with the same secret', async () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const token = await signJwt({ sub: 'user-42', exp, scope: 'chat:stream' }, SECRET_A);
    const result = await verifyJwt(token, SECRET_A);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.payload?.sub).toBe('user-42');
    expect(result.payload?.exp).toBe(exp);
    expect(result.payload?.scope).toBe('chat:stream');
  });

  it('verifyJwt rejects a token signed with a different secret (bad-signature)', async () => {
    const token = await signJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET_A);
    const result = await verifyJwt(token, SECRET_B);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('bad-signature');
    expect(result.payload).toBeNull();
  });

  it('verifyJwt rejects a tampered payload (original signature)', async () => {
    const original = await signJwt({ sub: 'user', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET_A);
    const tampered = tamperPayload(original, { sub: 'admin', exp: Math.floor(Date.now() / 1000) + 60 });
    const result = await verifyJwt(tampered, SECRET_A);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('bad-signature');
  });

  it('verifyJwt rejects a tampered signature', async () => {
    const original = await signJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET_A);
    const tampered = tamperSignature(original);
    const result = await verifyJwt(tampered, SECRET_A);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('bad-signature');
  });

  it('verifyJwt rejects an expired token', async () => {
    // Use exp that's already 1 second in the past
    const token = await signJwt({ sub: 'u', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET_A);
    const result = await verifyJwt(token, SECRET_A);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
    expect(result.payload?.sub).toBe('u');
  });

  it('verifyJwt rejects malformed input (not 3 parts)', async () => {
    const result1 = await verifyJwt('not-a-jwt', SECRET_A);
    expect(result1.valid).toBe(false);
    expect(result1.error).toBe('malformed');
    const result2 = await verifyJwt('a.b', SECRET_A);
    expect(result2.valid).toBe(false);
    expect(result2.error).toBe('malformed');
  });

  it('verifyJwt rejects a non-HS256 algorithm header (alg confusion attack)', async () => {
    // Build a token with alg=none (should be rejected)
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const noneToken = `${header}.${payload}.`;
    const result = await verifyJwt(noneToken, SECRET_A);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('malformed');
  });

  it('decodeJwtUnverified can read claims from a valid token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signJwt({ sub: 'user-99', exp, scope: 'admin' }, SECRET_A);
    const decoded = decodeJwtUnverified(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe('user-99');
    expect(decoded?.exp).toBe(exp);
    expect(decoded?.scope).toBe('admin');
  });

  it('signJwt auto-injects iat (issued-at) claim', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: 'u', exp: before + 60 }, SECRET_A);
    const after = Math.floor(Date.now() / 1000);
    const decoded = decodeJwtUnverified(token);
    expect(decoded?.iat).toBeGreaterThanOrEqual(before);
    expect(decoded?.iat).toBeLessThanOrEqual(after);
  });
});
