import { NextRequest } from 'next/server';
import { verifyAuth } from './jwt';
import { authService } from './auth-service';

export interface ResolvedRequestAuth {
  success: boolean;
  userId?: string;
  source?: 'jwt' | 'session' | 'anonymous';
  error?: string;
}

interface ResolveRequestAuthOptions {
  bearerToken?: string | null;
  allowAnonymous?: boolean;
  anonymousHeaderName?: string;
  anonymousSessionId?: string | null;
}

function normalizeAnonymousId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;

  // Keep only predictable safe chars for in-memory session keys.
  const normalized = trimmed.replace(/[^a-zA-Z0-9:_-]/g, '');
  if (!normalized) return null;
  return normalized;
}

function withBearerToken(req: NextRequest, token: string): NextRequest {
  const headers = new Headers(req.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new NextRequest(req.url, { headers });
}

export async function resolveRequestAuth(
  req: NextRequest,
  options: ResolveRequestAuthOptions = {}
): Promise<ResolvedRequestAuth> {
  const { bearerToken, allowAnonymous = false, anonymousHeaderName = 'x-anonymous-session-id' } = options;

  // 1) Try JWT auth from explicit bearer token or existing Authorization header.
  const requestForJwt = bearerToken ? withBearerToken(req, bearerToken) : req;
  const jwtAuth = await verifyAuth(requestForJwt);
  if (jwtAuth.success && jwtAuth.userId) {
    return { success: true, userId: jwtAuth.userId, source: 'jwt' };
  }

  // 2) Fallback to session cookie auth.
  const sessionId = req.cookies.get('session_id')?.value;
  if (sessionId) {
    const sessionAuth = await authService.validateSession(sessionId);
    if (sessionAuth.success && sessionAuth.user) {
      return { success: true, userId: String(sessionAuth.user.id), source: 'session' };
    }
  }

  // 3) Optional anonymous mode for dev/non-auth shell usage.
  if (allowAnonymous) {
    const anonRaw = options.anonymousSessionId ?? req.headers.get(anonymousHeaderName);
    if (anonRaw) {
      const anonId = normalizeAnonymousId(anonRaw);
      if (anonId) {
        return { success: true, userId: `anon:${anonId}`, source: 'anonymous' };
      }
    }
  }

  return {
    success: false,
    error: jwtAuth.error || 'Unauthorized'
  };
}
