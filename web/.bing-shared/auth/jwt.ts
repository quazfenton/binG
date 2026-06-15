/**
 * Shared JWT helpers with REAL signature verification.
 *
 * Replaces the broken verifyJwt in workers/edge-gateway/src/auth.ts which
 * decoded the payload but never checked the signature against the secret.
 * This is the shared lib used by both the edge-gateway Worker (signs) and
 * the backend chat route (verifies) for the 302-redirect streaming pattern.
 */

export interface JwtPayload {
  sub: string;
  exp: number;
  iat?: number;
  scope?: string;
  [key: string]: unknown;
}

/**
 * The subset of JwtPayload that callers must provide to signJwt().
 * Exported as a separate type so auth.ts can re-export it without
 * `Omit<JwtPayload, 'iat'>` confusing the type checker when the payload
 * is later spread back into a full JwtPayload (TS can't prove that the
 * omitted `iat` doesn't also drop the required `sub`/`exp` through the
 * index signature). Forcing sub/exp to remain required keys here makes
 * the spread type-safe.
 */
export type SignableJwtPayload = {
  sub: string;
  exp: number;
  scope?: string;
  [key: string]: unknown;
};

export interface VerifiedJwt {
  valid: boolean;
  payload: JwtPayload | null;
  error?: 'malformed' | 'bad-signature' | 'expired';
}

/** Base64URL-encode a Uint8Array. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64URL-decode a string to Uint8Array. */
function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64URL-encode a UTF-8 string. */
function strToBase64Url(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

/** Base64URL-decode a string to UTF-8. */
function base64UrlToStr(s: string): string {
  return new TextDecoder().decode(base64UrlToBytes(s));
}

/** Constant-time-ish HMAC-SHA-256 comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Sign a JWT with HS256 using the provided secret.
 * Returns `${header}.${payload}.${signature}` in base64URL encoding.
 */
export async function signJwt(
  payload: SignableJwtPayload,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now };
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = strToBase64Url(JSON.stringify(header));
  const payloadB64 = strToBase64Url(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${bytesToBase64Url(sigBytes)}`;
}

/**
 * Verify a JWT with HS256. ACTUALLY checks the signature against the secret
 * (the previous verifyJwt in workers/edge-gateway/src/auth.ts did not).
 * Returns { valid, payload, error }.
 */
export async function verifyJwt(token: string, secret: string): Promise<VerifiedJwt> {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, payload: null, error: 'malformed' };
  const [h, p, s] = parts;

  // Reject non-HS256 algorithms
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlToStr(h));
  } catch {
    return { valid: false, payload: null, error: 'malformed' };
  }
  if (header.alg !== 'HS256') {
    return { valid: false, payload: null, error: 'malformed' };
  }

  // Verify the signature
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${p}`)),
  );
  const provided = base64UrlToBytes(s);
  if (!timingSafeEqual(expected, provided)) {
    return { valid: false, payload: null, error: 'bad-signature' };
  }

  // Decode the payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlToStr(p));
  } catch {
    return { valid: false, payload: null, error: 'malformed' };
  }
  if (typeof payload.exp !== 'number') {
    return { valid: false, payload: null, error: 'malformed' };
  }
  // Expiry check (with 0s leeway)
  if (Date.now() / 1000 >= payload.exp) {
    return { valid: false, payload, error: 'expired' };
  }
  return { valid: true, payload };
}

/**
 * Decode a JWT without verifying the signature. Use only for diagnostics.
 */
export function decodeJwtUnverified(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlToStr(parts[1]));
  } catch {
    return null;
  }
}
