/**
 * Auth Cache Module
 * 
 * Simple LRU cache for authentication results
 * Separated to avoid circular dependencies
 */

interface CachedAuthResult {
  result: ResolvedRequestAuth;
  expires: number;
  sessionExpiresAt?: number;
  jti?: string;
  jwtExpiresAt?: number;
}

export interface ResolvedRequestAuth {
  success: boolean;
  userId?: string;
  source?: 'jwt' | 'session' | 'anonymous';
  error?: string;
}

export class AuthCache {
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

  delete(key: string): void {
    this.cache.delete(key);
  }

  invalidateAllForUser(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${userId}:`) || key.endsWith(`:${userId}`)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateSession(sessionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${sessionId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateAnonymous(anonId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:anon:${anonId}`) || key.endsWith(`:${anonId}`)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }

  static sanitizeError(error: any): string {
    const message = error?.message || String(error);

    const sanitized = message
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/key-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/Bearer\s+[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g, 'Bearer [REDACTED_TOKEN]')
      .replace(/eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/gi, '[REDACTED_JWT]')
      .replace(/password[=:]\s*[^\s,;]+/gi, 'password=[REDACTED]')
      .replace(/pwd[=:]\s*[^\s,;]+/gi, 'pwd=[REDACTED]')
      .replace(/secret[=:]\s*[^\s,;]+/gi, 'secret=[REDACTED]')
      .replace(/api[_-]?key[=:]\s*[^\s,;]+/gi, 'api_key=[REDACTED]')
      .replace(/token[=:]\s*[^\s,;]+/gi, 'token=[REDACTED]')
      .replace(/access[_-]?token[=:]\s*[^\s,;]+/gi, 'access_token=[REDACTED]')
      .replace(/-----BEGIN\s+\w+\s+PRIVATE\s+KEY-----[\s\S]+?-----END\s+\w+\s+PRIVATE\s+KEY-----/g, '[REDACTED_PRIVATE_KEY]');

    return sanitized;
  }
}

export const authCache = new AuthCache();
