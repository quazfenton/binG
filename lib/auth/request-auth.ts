import { NextRequest } from 'next/server';
import { verifyAuth } from './jwt';
import { authService } from './auth-service';
import { AuthCache, type ResolvedRequestAuth } from './auth-cache';

// Simple LRU cache for auth results (using shared AuthCache from auth-cache.ts)
const authCache = new AuthCache();

// Export for use in other modules
export { authCache };

/**
 * Get cached user auth result
 * @deprecated Use authCache.get() directly
 */
export function getCachedUser(key: string): ResolvedRequestAuth | undefined {
  return authCache.get(key)?.result;
}

/**
 * Set cached user auth result
 * @deprecated Use authCache.set() directly
 */
export function setCachedUser(key: string, result: ResolvedRequestAuth, options?: { sessionExpiresAt?: number }): void {
  authCache.set(key, result, options);
}

/**
 * Invalidate user cache
 * @deprecated Use authCache.delete() directly
 */
export function invalidateUserCache(key: string): void {
  authCache.delete(key);
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

  // CRITICAL FIX: Include multiple factors in cache key to prevent collision attacks
  // Previous implementation only used authorization header, allowing cache poisoning
  const authHeader = req.headers.get('authorization') || ''
  const sessionId = req.cookies.get('session_id')?.value || ''
  const anonId = options.anonymousSessionId || req.headers.get(anonymousHeaderName) || ''

  // Create unique cache key from all auth factors
  const cacheKey = `auth:${authHeader}:${sessionId}:${anonId}`;

  // Check cache first - but ALWAYS re-validate for security
  const cached = authCache.get(cacheKey);
  if (cached) {
    // SECURITY: Re-validate cached results to prevent bypassing expiration checks
    
    // For JWT auth, NEVER cache success - always re-verify to check blacklist
    if (cached.result.source === 'jwt' && cached.result.userId) {
      // Remove from cache - JWT must always be re-verified
      authCache.delete(cacheKey);
    }
    
    // For session auth, re-check expiration using stored metadata
    if (cached.result.source === 'session' && cached.result.userId) {
      if (cached.sessionExpiresAt) {
        // Check if session has expired since caching
        if (Date.now() >= cached.sessionExpiresAt) {
          // Session expired, remove from cache and re-validate
          authCache.delete(cacheKey);
        } else {
          // Session still valid, return cached result
          return cached.result;
        }
      } else if (sessionId) {
        // No expiration metadata, re-validate session
        const sessionAuth = await authService.validateSession(sessionId);
        if (!sessionAuth.success) {
          authCache.delete(cacheKey);
        } else {
          return cached.result;
        }
      } else {
        authCache.delete(cacheKey);
      }
    }
    
    // For anonymous auth, just return (no expiration to check)
    if (cached.result.source === 'anonymous') {
      return cached.result;
    }
    
    // For failed auth, return cached failure (short TTL prevents issues)
    if (!cached.result.success) {
      return cached.result;
    }
  }

  // 1) Try JWT auth from explicit bearer token or existing Authorization header.
  const requestForJwt = bearerToken ? withBearerToken(req, bearerToken) : req;
  const jwtAuth = await verifyAuth(requestForJwt);
  if (jwtAuth.success && jwtAuth.userId) {
    const result: ResolvedRequestAuth = { success: true, userId: jwtAuth.userId, source: 'jwt' };
    // SECURITY: Don't cache JWT success - always re-verify to check blacklist
    // authCache.set(cacheKey, result); // REMOVED for security
    return result;
  }

  // 2) Fallback to session cookie auth.
  if (sessionId) {
    const sessionAuth = await authService.validateSession(sessionId);
    if (sessionAuth.success && sessionAuth.user) {
      const result: ResolvedRequestAuth = {
        success: true,
        userId: String(sessionAuth.user.id),
        source: 'session'
      };
      // Get session expiration for cache re-validation
      const session = (sessionAuth as any).session;
      const sessionExpiresAt = session?.expires_at ? new Date(session.expires_at).getTime() : undefined;
      
      // Cache session success with expiration metadata
      authCache.set(cacheKey, result, { sessionExpiresAt });
      return result;
    }
  }

  // 3) Optional anonymous mode for dev/non-auth shell usage.
  if (allowAnonymous) {
    const anonRaw = options.anonymousSessionId ?? req.headers.get(anonymousHeaderName);
    if (anonRaw) {
      const anonId = normalizeAnonymousId(anonRaw);
      if (anonId) {
        const result: ResolvedRequestAuth = { success: true, userId: `anon:${anonId}`, source: 'anonymous' };
        authCache.set(cacheKey, result);
        return result;
      }
    }
    // If anonymous auth fails or no ID provided, fall through to return error
  }

  const result: ResolvedRequestAuth = {
    success: false,
    error: jwtAuth.error || 'Unauthorized'
  };
  authCache.set(cacheKey, result);
  return result;
}
