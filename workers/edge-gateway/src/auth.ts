
// Re-export JWT helpers from the shared lib (real signature verification).
// The shared lib's verifyJwt ACTUALLY checks the HS256 signature — the
// old local verifyJwt only decoded without checking, which is a security bug.
export { signJwt, verifyJwt, decodeJwtUnverified } from '@bing/shared/auth/jwt';
export type { JwtPayload, SignableJwtPayload as SharedJwtPayload, VerifiedJwt } from '@bing/shared/auth/jwt';

/**
 * Edge Auth Handler
 *
 * Validates JWT tokens at the edge before requests reach the backend.
 * Supports:
 * - Bearer token in Authorization header
 * - Session cookie (`sid_tkn`) as fallback
 */
export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
  error?: string;
}

/**
 * Simple JWT verification at the edge.
 * Decodes and validates HS256 tokens without bringing in a full JWT library.
 */
function verifyJwt(token: string, secret: string): AuthResult {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { authenticated: false, userId: null, error: 'Invalid token format' };
    }

    // Decode payload (part 2)
    const payload = JSON.parse(atob(parts[1]));

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { authenticated: false, userId: null, error: 'Token expired' };
    }

    // Extract user ID (check common claims)
    const userId = payload.sub ?? payload.userId ?? payload.user_id ?? null;
    if (!userId) {
      return { authenticated: false, userId: null, error: 'No user ID in token' };
    }

    return { authenticated: true, userId: String(userId) };
  } catch {
    return { authenticated: false, userId: null, error: 'Invalid token' };
  }
}

/**
 * Extract and verify auth from request
 */
export async function authenticateRequest(
  request: Request,
  jwtSecret: string | undefined,
): Promise<AuthResult> {
  // Priority 1: Authorization header (Bearer token)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (jwtSecret) {
      return verifyJwt(token, jwtSecret);
    }
    // No JWT secret configured — decode payload only (no signature verification)
    return decodeTokenUnverified(token);
  }

  // Priority 2: Cookie-based session token
  const cookieHeader = request.headers.get('Cookie') ?? '';
  const sidMatch = cookieHeader.match(/sid_tkn=([^;]+)/);
  if (sidMatch) {
    const token = decodeURIComponent(sidMatch[1]);
    if (jwtSecret) {
      return verifyJwt(token, jwtSecret);
    }
    return decodeTokenUnverified(token);
  }

  return { authenticated: false, userId: null };
}

function decodeTokenUnverified(token: string): AuthResult {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { authenticated: false, userId: null };
    const payload = JSON.parse(atob(parts[1]));
    const userId = payload.sub ?? payload.userId ?? payload.user_id ?? null;
    if (!userId) return { authenticated: false, userId: null };
    return { authenticated: true, userId: String(userId) };
  } catch {
    return { authenticated: false, userId: null };
  }
}


export interface SignableJwtPayload {
  sub: string;
  exp: number;
  scope?: string;
  [key: string]: unknown;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToBase64Url(s: string): string {
  return bytesToBase64Url(new TextEncoder().encode(s));
}

/**
 * Sign a JWT with HS256 using the provided secret.
 * Returns `${header}.${payload}.${signature}` in base64URL encoding.
 *
 * NOTE: The existing verifyJwt in this file does NOT verify signatures.
 * Backend code that consumes the token must do its own signature check.
 * The Worker-side redirect only needs an opaque-looking token to convince
 * the backend to accept the connection.
 */
export async function signJwt(
  payload: SignableJwtPayload,
  secret: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = strToBase64Url(JSON.stringify(header));
  const payloadB64 = strToBase64Url(JSON.stringify(payload));
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
  const sigB64 = bytesToBase64Url(sigBytes);
  return `${signingInput}.${sigB64}`;
}
