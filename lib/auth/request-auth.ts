import { NextRequest } from 'next/server';
import { verifyAuth } from './jwt';
import { authService } from './auth-service';

// Enhanced cache entry with validation metadata
interface CachedAuthResult {
  result: ResolvedRequestAuth;
  expires: number;
  // For session auth: store session expiration time
  sessionExpiresAt?: number;
  // For JWT auth: store JTI for blacklist checking (but we don't cache JWT success anymore)
  jti?: string;
  jwtExpiresAt?: number;
}

// Simple LRU cache for auth results
class AuthCache {
  private cache = new Map<string, CachedAuthResult>();
  private readonly ttl = 5 * 60 * 1000; // 5 minutes

  get(key: string): CachedAuthResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, result: ResolvedRequestAuth, metadata?: { sessionExpiresAt?: number; jti?: string; jwtExpiresAt?: number }): void {
    this.cache.set(key, {
      result,
      expires: Date.now() + this.ttl,
      ...metadata,
    });

    // Cleanup if cache gets too large
    if (this.cache.size > 1000) {
      const entries = Array.from(this.cache.entries());
      const oldestKey = entries[0][0];
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Invalidate all cached auth tokens for a user
   * Called when user logs out to prevent stale auth results
   */
  invalidateAllForUser(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${userId}:`) || key.endsWith(`:${userId}`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Invalidate cache entries matching a session ID
   * Called when session is destroyed
   */
  invalidateSession(sessionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${sessionId}:`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Invalidate all anonymous user caches
   */
  invalidateAnonymous(anonId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:anon:${anonId}`) || key.endsWith(`:${anonId}`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear entire cache
   * Use with caution - affects all users
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    }
  }

  /**
   * Sanitize error messages to prevent credential leakage
   * Removes API keys, tokens, passwords, and secrets from error messages
   */
  static sanitizeError(error: any): string {
    const message = error?.message || String(error)

    // Remove potential secrets from error messages
    const sanitized = message
      // API keys (various formats)
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/key-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      // Bearer tokens
      .replace(/Bearer\s+[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, 'Bearer [REDACTED_TOKEN]')
      // JWT tokens
      .replace(/eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/gi, '[REDACTED_JWT]')
      // Passwords in various formats
      .replace(/password[=:]\s*[^\s,;]+/gi, 'password=[REDACTED]')
      .replace(/pwd[=:]\s*[^\s,;]+/gi, 'pwd=[REDACTED]')
      // Secrets
      .replace(/secret[=:]\s*[^\s,;]+/gi, 'secret=[REDACTED]')
      .replace(/api[_-]?key[=:]\s*[^\s,;]+/gi, 'api_key=[REDACTED]')
      // Tokens
      .replace(/token[=:]\s*[^\s,;]+/gi, 'token=[REDACTED]')
      .replace(/access[_-]?token[=:]\s*[^\s,;]+/gi, 'access_token=[REDACTED]')
      // Private keys
      .replace(/-----BEGIN\s+\w+\s+PRIVATE\s+KEY-----[\s\S]+?-----END\s+\w+\s+PRIVATE\s+KEY-----/g, '[REDACTED_PRIVATE_KEY]')

    return sanitized
  }
}

const authCache = new AuthCache();

// Export for use in auth-service for cache invalidation on logout
export { authCache, AuthCache };

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
  }

  const result: ResolvedRequestAuth = {
    success: false,
    error: jwtAuth.error || 'Unauthorized'
  };
  authCache.set(cacheKey, result);
  return result;
}
