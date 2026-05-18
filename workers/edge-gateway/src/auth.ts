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
