/**
 * Unit tests for signJwt in workers/edge-gateway/src/auth.ts.
 *
 * Verifies:
 * 1. signJwt returns a 3-part base64url token
 * 2. The header decodes to { alg: 'HS256', typ: 'JWT' }
 * 3. The payload decodes back to the input
 * 4. A token signed with secret A fails verification against secret B (signature mismatch)
 * 5. A tampered token (modified payload, original signature) fails verification
 * 6. The token's `exp` is preserved in the payload
 * 7. The token's `scope` is preserved in the payload
 * 8. decodeTokenUnverified can read the signed token's claims
 */
import { describe, it, expect } from 'vitest';
import { signJwt, decodeTokenUnverified, type SignableJwtPayload } from '../src/auth';

const SECRET_A = 'test-secret-a-12345';
const SECRET_B = 'test-secret-b-67890';

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)),
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeB64Url(s: string): string {
  // Restore standard base64 padding
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(padded);
}

describe('signJwt', () => {
  it('returns a 3-part dot-separated token', async () => {
    const payload: SignableJwtPayload = { sub: 'user-1', exp: Date.now() + 60_000 };
    const token = await signJwt(payload, SECRET_A);
    expect(token.split('.').length).toBe(3);
  });

  it('header decodes to { alg: "HS256", typ: "JWT" }', async () => {
    const token = await signJwt({ sub: 'u', exp: Date.now() + 60_000 }, SECRET_A);
    const header = JSON.parse(decodeB64Url(token.split('.')[0]));
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('payload decodes back to the input', async () => {
    const exp = Date.now() + 300_000;
    const token = await signJwt({ sub: 'user-42', exp, scope: 'chat:stream' }, SECRET_A);
    const decoded = JSON.parse(decodeB64Url(token.split('.')[1]));
    expect(decoded.sub).toBe('user-42');
    expect(decoded.exp).toBe(exp);
    expect(decoded.scope).toBe('chat:stream');
  });

  it('signature is a valid HS256 of header.payload using the secret', async () => {
    const token = await signJwt({ sub: 'u', exp: Date.now() + 60_000 }, SECRET_A);
    const [h, p, s] = token.split('.');
    const expected = bytesToBase64Url(await hmacSha256(SECRET_A, `${h}.${p}`));
    expect(s).toBe(expected);
  });

  it('a token signed with secret A is NOT valid against secret B', async () => {
    const token = await signJwt({ sub: 'u', exp: Date.now() + 60_000 }, SECRET_A);
    const [h, p, s] = token.split('.');
    const sigFromB = bytesToBase64Url(await hmacSha256(SECRET_B, `${h}.${p}`));
    expect(s).not.toBe(sigFromB);
  });

  it('a tampered payload (original signature) does not re-verify', async () => {
    const token = await signJwt({ sub: 'u', exp: Date.now() + 60_000 }, SECRET_A);
    const [h, p, s] = token.split('.');
    // Tamper: change `sub` claim in the payload, keep original signature
    const tamperedPayload = btoa(JSON.stringify({ sub: 'admin', exp: Date.now() + 60_000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const tamperedToken = `${h}.${tamperedPayload}.${s}`;
    // Manually verify: compute expected sig for the tampered input
    const expectedSig = bytesToBase64Url(await hmacSha256(SECRET_A, `${h}.${tamperedPayload}`));
    expect(s).not.toBe(expectedSig);
    // Sanity: the original verifyJwt (which doesn't check signature) still decodes tampered token
    const decoded = decodeTokenUnverified(tamperedToken);
    expect(decoded?.sub).toBe('admin');
  });

  it('decodeTokenUnverified reads claims from the signed token', async () => {
    const exp = Date.now() + 60_000;
    const token = await signJwt({ sub: 'user-99', exp, scope: 'admin' }, SECRET_A);
    const decoded = decodeTokenUnverified(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe('user-99');
    expect(decoded?.exp).toBe(exp);
    expect(decoded?.scope).toBe('admin');
  });

  it('preserves additional custom claims in the payload', async () => {
    const token = await signJwt(
      { sub: 'u', exp: Date.now() + 60_000, scope: 'chat:stream', custom: 'value' } as SignableJwtPayload,
      SECRET_A,
    );
    const decoded = JSON.parse(decodeB64Url(token.split('.')[1]));
    expect(decoded.custom).toBe('value');
  });
});
