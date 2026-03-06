/**
 * Rate Limiter for Terminal and API Endpoints
 * 
 * Provides rate limiting to prevent DoS attacks and resource exhaustion
 */

import { TERMINAL_LIMITS } from '@/lib/terminal/terminal-constants';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blockedUntil?: number;
  totalRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  blockedUntil?: number;
  remaining?: number;
  limit?: number;
}

export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(
    maxRequests: number,
    windowMs: number,
    blockDurationMs: number = 60000
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;
  }

  /**
   * Check if request is allowed under rate limit
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.limits.get(key) || { 
      count: 0, 
      resetAt: now + this.windowMs,
      totalRequests: 0,
    };

    // Check if user is blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        blockedUntil: entry.blockedUntil,
        limit: this.maxRequests,
      };
    }

    // Reset if window expired
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + this.windowMs;
      entry.blockedUntil = undefined;
    }

    // Track total requests for abuse detection
    entry.totalRequests++;

    // Check limit
    if (entry.count >= this.maxRequests) {
      // Block user if they exceed limit too many times (abuse detection)
      if (entry.totalRequests >= this.maxRequests * 3) {
        entry.blockedUntil = now + this.blockDurationMs;
        this.limits.set(key, entry);
        return {
          allowed: false,
          blockedUntil: entry.blockedUntil,
          limit: this.maxRequests,
        };
      }
      
      this.limits.set(key, entry);
      return {
        allowed: false,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        limit: this.maxRequests,
      };
    }

    entry.count++;
    this.limits.set(key, entry);
    
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      limit: this.maxRequests,
    };
  }

  /**
   * Get current rate limit status without incrementing counter
   */
  getStatus(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.limits.get(key);
    
    if (!entry) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        limit: this.maxRequests,
      };
    }

    if (entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        blockedUntil: entry.blockedUntil,
        limit: this.maxRequests,
      };
    }

    if (now > entry.resetAt) {
      return {
        allowed: true,
        remaining: this.maxRequests,
        limit: this.maxRequests,
      };
    }

    return {
      allowed: entry.count < this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.count),
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      limit: this.maxRequests,
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Cleanup old entries to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = this.windowMs + this.blockDurationMs;
    
    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetAt + maxAge) {
        this.limits.delete(key);
      }
    }
  }

  /**
   * Get statistics about rate limiter
   */
  getStats(): { totalKeys: number; blockedKeys: number } {
    const now = Date.now();
    let blockedKeys = 0;
    
    for (const [, entry] of this.limits.entries()) {
      if (entry.blockedUntil && now < entry.blockedUntil) {
        blockedKeys++;
      }
    }
    
    return {
      totalKeys: this.limits.size,
      blockedKeys,
    };
  }
}

// Pre-configured rate limiters for different use cases
export const terminalCommandRateLimiter = new RateLimiter(
  TERMINAL_LIMITS.MAX_COMMANDS_PER_SECOND,
  1000, // 1 second window
  60000 // 1 minute block
);

export const sandboxCreationRateLimiter = new RateLimiter(
  TERMINAL_LIMITS.MAX_SANDBOX_CREATIONS_PER_MINUTE,
  60000, // 1 minute window
  300000 // 5 minute block
);

export const websocketConnectionRateLimiter = new RateLimiter(
  TERMINAL_LIMITS.MAX_WEBSOCKET_CONNECTIONS_PER_MINUTE,
  60000, // 1 minute window
  300000 // 5 minute block
);

export const apiRateLimiter = new RateLimiter(
  100, // 100 requests per minute
  60000,
  300000
);

// Cleanup old entries every minute
const cleanupInterval = setInterval(() => {
  terminalCommandRateLimiter.cleanup();
  sandboxCreationRateLimiter.cleanup();
  websocketConnectionRateLimiter.cleanup();
  apiRateLimiter.cleanup();
}, TERMINAL_LIMITS.CLEANUP_INTERVAL_MS);

// Don't prevent process exit
if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

/**
 * Express/Next.js middleware for rate limiting
 */
export function createRateLimitMiddleware(
  rateLimiter: RateLimiter,
  keyExtractor: (req: any) => string = (req) => req.headers['x-forwarded-for'] || 'unknown'
) {
  return function rateLimitMiddleware(req: any, res: any, next: () => void) {
    const key = keyExtractor(req);
    const result = rateLimiter.check(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining || 0);
    
    if (result.retryAfter) {
      res.setHeader('Retry-After', String(result.retryAfter));
    }

    if (!result.allowed) {
      res.setHeader('Content-Type', 'application/json');
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: result.retryAfter,
        blockedUntil: result.blockedUntil,
      });
      return;
    }

    next();
  };
}
