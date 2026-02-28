/**
 * Rate Limiting Middleware
 *
 * Provides rate limiting for API routes to prevent abuse and DoS attacks.
 * Uses in-memory storage with optional Redis backend for distributed rate limiting.
 *
 * Features:
 * - Configurable limits per endpoint
 * - User-based and IP-based limiting
 * - Exponential backoff
 * - Distributed rate limiting (Redis)
 * - Custom key generation
 *
 * @see docs/sdk/rate-limiting.md
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Rate limit result
 */
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed */
  limit: number;
  /** Time window in seconds */
  window: number;
  /** Enable exponential backoff */
  backoff?: boolean;
  /** Custom key generator */
  keyGenerator?: (request: NextRequest) => string;
}

/**
 * In-memory store for rate limiting
 */
class InMemoryStore {
  private store = new Map<string, { count: number; reset: number }>();

  async get(key: string): Promise<{ count: number; reset: number } | null> {
    return this.store.get(key) || null;
  }

  async set(key: string, value: { count: number; reset: number }, ttl: number): Promise<void> {
    this.store.set(key, value);
    setTimeout(() => this.store.delete(key), ttl * 1000);
  }

  async increment(key: string, window: number): Promise<{ count: number; reset: number }> {
    const now = Date.now();
    const existing = await this.get(key);

    if (!existing || now > existing.reset) {
      const newValue = { count: 1, reset: now + window * 1000 };
      await this.set(key, newValue, window);
      return newValue;
    }

    const newValue = { count: existing.count + 1, reset: existing.reset };
    await this.set(key, newValue, window);
    return newValue;
  }
}

/**
 * Redis store for distributed rate limiting
 */
class RedisStore {
  private redis: any;

  constructor(redisClient: any) {
    this.redis = redisClient;
  }

  async increment(key: string, window: number): Promise<{ count: number; reset: number }> {
    const now = Date.now();
    const reset = now + window * 1000;

    const multi = this.redis.multi();
    multi.incr(key);
    multi.expire(key, window);

    const [count] = await multi.exec();

    return {
      count: count[1],
      reset,
    };
  }

  async get(key: string): Promise<{ count: number; reset: number } | null> {
    const count = await this.redis.get(key);
    if (!count) return null;

    const ttl = await this.redis.ttl(key);
    const reset = Date.now() + ttl * 1000;

    return { count: parseInt(count, 10), reset };
  }
}

/**
 * Rate limiter class
 */
export class RateLimiter {
  private store: InMemoryStore | RedisStore;
  private configs = new Map<string, RateLimitConfig>();
  private defaultConfig: RateLimitConfig;

  constructor(options?: {
    redisClient?: any;
    defaultLimit?: number;
    defaultWindow?: number;
  }) {
    if (options?.redisClient) {
      this.store = new RedisStore(options.redisClient);
    } else {
      this.store = new InMemoryStore();
    }

    this.defaultConfig = {
      limit: options?.defaultLimit || 100,
      window: options?.defaultWindow || 60,
      backoff: false,
    };
  }

  /**
   * Configure rate limit for a specific route
   *
   * @param route - Route pattern
   * @param config - Rate limit configuration
   */
  configure(route: string, config: RateLimitConfig): void {
    this.configs.set(route, config);
  }

  /**
   * Check rate limit for a request
   *
   * @param request - Next.js request
   * @param route - Current route
   * @returns Rate limit result
   */
  async check(request: NextRequest, route?: string): Promise<RateLimitResult> {
    const config = route ? this.configs.get(route) : this.defaultConfig;
    if (!config) {
      return this.check(request, undefined);
    }

    const key = this.generateKey(request, config);
    const result = await (this.store as any).increment(key, config.window);

    const remaining = Math.max(0, config.limit - result.count);
    const reset = Math.ceil(result.reset / 1000);

    if (result.count > config.limit) {
      const retryAfter = config.backoff
        ? Math.pow(2, result.count - config.limit)
        : Math.ceil((result.reset - Date.now()) / 1000);

      return {
        success: false,
        limit: config.limit,
        remaining: 0,
        reset,
        retryAfter,
      };
    }

    return {
      success: true,
      limit: config.limit,
      remaining,
      reset,
    };
  }

  /**
   * Generate rate limit key
   */
  private generateKey(request: NextRequest, config: RateLimitConfig): string {
    if (config.keyGenerator) {
      return `ratelimit:${config.keyGenerator(request)}`;
    }

    // Default: use IP address
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
               request.headers.get('x-real-ip') ||
               'unknown';

    return `ratelimit:${ip}`;
  }

  /**
   * Create rate limit middleware
   *
   * @param route - Route pattern
   * @returns Middleware function
   */
  middleware(route?: string) {
    return async (request: NextRequest): Promise<NextResponse | null> => {
      const result = await this.check(request, route);

      if (!result.success) {
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            message: `Too many requests. Please try again in ${result.retryAfter} seconds.`,
            retryAfter: result.retryAfter,
          },
          {
            status: 429,
            headers: {
              'X-RateLimit-Limit': String(result.limit),
              'X-RateLimit-Remaining': String(result.remaining),
              'X-RateLimit-Reset': String(result.reset),
              'Retry-After': String(result.retryAfter),
            },
          }
        );
      }

      return null;
    };
  }
}

/**
 * Default rate limiter instance
 */
export const rateLimiter = new RateLimiter({
  defaultLimit: 100,
  defaultWindow: 60,
});

/**
 * Configure common rate limits
 */
export function configureRateLimits(): void {
  // Chat endpoints
  rateLimiter.configure('/api/chat', {
    limit: 20,
    window: 60,
    backoff: true,
  });

  // Agent endpoints
  rateLimiter.configure('/api/agent', {
    limit: 10,
    window: 60,
    backoff: true,
  });

  // Tool execution
  rateLimiter.configure('/api/tools/execute', {
    limit: 30,
    window: 60,
    backoff: true,
  });

  // Sandbox execution
  rateLimiter.configure('/api/sandbox/execute', {
    limit: 50,
    window: 60,
    backoff: true,
  });

  // Filesystem operations
  rateLimiter.configure('/api/filesystem', {
    limit: 100,
    window: 60,
    backoff: false,
  });

  // Authentication endpoints
  rateLimiter.configure('/api/auth', {
    limit: 5,
    window: 60,
    backoff: true,
  });

  // Webhook endpoints
  rateLimiter.configure('/api/webhooks', {
    limit: 1000,
    window: 60,
    backoff: false,
  });

  // Health checks (no limit)
  rateLimiter.configure('/api/health', {
    limit: 10000,
    window: 60,
    backoff: false,
  });
}

/**
 * Rate limit hook for API routes
 *
 * @param request - Next.js request
 * @param route - Route pattern
 * @returns Rate limit response or null
 *
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const rateLimitResponse = await checkRateLimit(request, '/api/chat');
 *   if (rateLimitResponse) {
 *     return rateLimitResponse;
 *   }
 *
 *   // Process request...
 * }
 * ```
 */
export async function checkRateLimit(
  request: NextRequest,
  route?: string
): Promise<NextResponse | null> {
  const middleware = rateLimiter.middleware(route);
  return await middleware(request);
}

/**
 * Get rate limit headers
 *
 * @param result - Rate limit result
 * @returns Headers object
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.reset),
    ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
  };
}

/**
 * Create custom rate limit key
 *
 * @param userId - User ID
 * @param endpoint - Endpoint name
 * @returns Rate limit key
 */
export function createRateLimitKey(userId: string, endpoint: string): string {
  return `ratelimit:${userId}:${endpoint}`;
}

// Initialize rate limits on module load
configureRateLimits();
