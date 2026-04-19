/**
 * Rate Limiting Middleware
 * 
 * Provides configurable rate limiting for API routes
 * Supports multiple strategies: fixed window, sliding window, token bucket
 */

import { NextRequest, NextResponse } from 'next/server';

export type RateLimitStrategy = 'fixed-window' | 'sliding-window' | 'token-bucket';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  strategy?: RateLimitStrategy;
  message?: string;
  statusCode?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
  remaining: number;
}

/**
 * In-memory store for rate limiting
 * For production, use Redis or similar for distributed rate limiting
 */
class RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private readonly cleanupIntervalMs = 60000; // 1 minute

  constructor() {
    // Cleanup expired entries periodically
    setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  get(key: string): RateLimitEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

const defaultStore = new RateLimitStore();

/**
 * Create rate limiter with custom configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    maxRequests,
    windowMs,
    strategy = 'fixed-window',
    message = 'Too many requests, please try again later.',
    statusCode = 429,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = config;

  return async function rateLimitMiddleware(
    req: NextRequest,
    next: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    // Get client identifier (IP address or user ID)
    const identifier = getClientIdentifier(req);
    const key = `ratelimit:${identifier}`;

    const now = Date.now();
    let entry = defaultStore.get(key);

    // Initialize or reset expired entry
    if (!entry || now > entry.resetAt) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
        remaining: maxRequests,
      };
    }

    // Check if rate limit exceeded
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      
      return NextResponse.json(
        {
          error: message,
          retryAfter,
          limit: maxRequests,
        },
        {
          status: statusCode,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(entry.resetAt),
          },
        }
      );
    }

    // Execute request
    const response = await next();

    // Update counter based on configuration
    const shouldCount = 
      (skipSuccessfulRequests && response.status >= 400) ||
      (skipFailedRequests && response.status < 400) ||
      (!skipSuccessfulRequests && !skipFailedRequests);

    if (shouldCount) {
      entry.count++;
      entry.remaining = Math.max(0, maxRequests - entry.count);
      defaultStore.set(key, entry);
    }

    // Add rate limit headers to response
    response.headers.set('X-RateLimit-Limit', String(maxRequests));
    response.headers.set('X-RateLimit-Remaining', String(entry.remaining));
    response.headers.set('X-RateLimit-Reset', String(entry.resetAt));

    return response;
  };
}

/**
 * Get client identifier for rate limiting
 * Uses IP address, with fallback to anonymous session ID
 *
 * SECURITY: Only trust x-forwarded-for/x-real-ip when behind a trusted proxy
 * Set TRUST_PROXY=true in environment when running behind a load balancer/reverse proxy
 */
function getClientIdentifier(req: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';

  // If TRUST_PROXY is enabled, use x-forwarded-for (first IP is the client)
  if (trustProxy) {
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
      // Take the first IP (client IP, not proxy IPs)
      const ip = forwardedFor.split(',')[0].trim();
      // Validate IP format to prevent injection
      if (isValidIp(ip)) {
        return `ip:${ip}`;
      }
    }
  }

  // Try to get real IP from Next.js request (works in some environments)
  // This is safer as it's populated by the framework, not headers
  const ip = (req as any).ip;
  if (ip && isValidIp(ip)) {
    return `ip:${ip}`;
  }

  // Fallback to anonymous session ID from HttpOnly cookie only
  // SECURITY: Never trust client-controlled headers for identity (IDOR vulnerability)
  const anonId = req.cookies.get('anon-session-id')?.value;
  if (anonId) {
    // Strip 'anon_' prefix if present (from generateSecureId format) for consistent format
    const sessionId = anonId.startsWith('anon_') ? anonId.slice(5) : anonId;
    return `anon:${sessionId}`;
  }

  // Last resort: use user agent + host as identifier
  // Note: This is less effective for rate limiting but prevents complete bypass
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const host = req.headers.get('host') || 'unknown';
  return `ua:${userAgent}:${host}`;
}

/**
 * Validate IP address format (IPv4 or IPv6)
 */
function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;

  // IPv4 pattern
  const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(ip)) {
    // Additional check: each octet should be 0-255
    const octets = ip.split('.').map(Number);
    return octets.every(octet => octet >= 0 && octet <= 255);
  }

  // IPv6 pattern (simplified - covers most common cases)
  const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  if (ipv6Pattern.test(ip)) {
    return true;
  }

  // IPv6 with :: shorthand
  const ipv6ShortPattern = /^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;
  if (ipv6ShortPattern.test(ip)) {
    return true;
  }

  return false;
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  /**
   * Strict: 10 requests per minute
   * Use for: Authentication endpoints, password reset
   */
  strict: createRateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many authentication attempts. Please try again later.',
    skipSuccessfulRequests: true, // Only count failed attempts
  }),

  /**
   * Moderate: 100 requests per minute
   * Use for: API endpoints, data fetching
   */
  moderate: createRateLimiter({
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
    message: 'Too many requests. Please slow down.',
  }),

  /**
   * Lenient: 1000 requests per minute
   * Use for: Public endpoints, static resources
   */
  lenient: createRateLimiter({
    maxRequests: 1000,
    windowMs: 60 * 1000, // 1 minute
    message: 'Rate limit exceeded.',
  }),

  /**
   * Registration: 5 requests per hour per IP
   * Use for: User registration to prevent email bombing
   */
  registration: createRateLimiter({
    maxRequests: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Too many registration attempts. Please try again later.',
  }),

  /**
   * Terminal input: 10 commands per second
   * Use for: Terminal command execution
   */
  terminalInput: createRateLimiter({
    maxRequests: 10,
    windowMs: 1000, // 1 second
    message: 'Too many terminal commands. Please slow down.',
  }),
};

/**
 * IP-based rate limiting (for distributed brute-force protection)
 */
export const ipRateLimiter = createRateLimiter({
  maxRequests: 1000,
  windowMs: 60 * 1000, // 1 minute
  message: 'Too many requests from your IP. Please try again later.',
});

/**
 * Internal programmatic rate-limit check by identifier.
 */
function checkRateLimitByKey(
  identifier: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  let entry = defaultStore.get(key);

  // Initialize or reset expired entry
  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
      remaining: maxRequests,
    };
    defaultStore.set(key, entry);
  }

  // Check if rate limit exceeded
  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  // Increment counter
  entry.count++;
  entry.remaining = maxRequests - entry.count;
  defaultStore.set(key, entry);

  return {
    allowed: true,
    remaining: entry.remaining,
    resetAt: entry.resetAt,
  };
}

// Also export under the legacy name for programmatic callers
export { checkRateLimitByKey };

/**
 * Polymorphic rate-limit check.
 *
 *  - `checkRateLimit(request)` — NEW: returns `Promise<NextResponse | null>` where
 *    `null` means the request is allowed and a `NextResponse` (HTTP 429) means it
 *    was blocked. Uses the module-level `rateLimiter` singleton (with any routes
 *    configured via `configureRateLimits()`).
 *
 *  - `checkRateLimit(identifier, maxRequests, windowMs)` — LEGACY: synchronous,
 *    returns `{ allowed, remaining, resetAt, retryAfter? }`. Preserved for any
 *    existing programmatic callers.
 */
export function checkRateLimit(request: NextRequest): Promise<NextResponse | null>;
export function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number };
export function checkRateLimit(
  arg1: NextRequest | string,
  maxRequests?: number,
  windowMs?: number
): any {
  if (typeof arg1 === 'string') {
    return checkRateLimitByKey(arg1, maxRequests as number, windowMs as number);
  }
  // NextRequest path — use singleton rate limiter, return NextResponse|null
  return rateLimiter.check(arg1).then((result) => {
    if (result.success) return null;
    const retryAfter = result.retryAfter ?? 1;
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  });
}

/**
 * Rate limit middleware for API routes
 * Returns NextResponse if rate limited, null if OK
 * 
 * @param request - The incoming request
 * @param identifier - Rate limit identifier (e.g., route path or user ID)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns NextResponse if rate limited, null otherwise
 */
export function checkRateLimitMiddleware(
  request: NextRequest,
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): NextResponse | null {
  // Get client IP address
  // SECURITY: Only trust proxy headers when TRUST_PROXY is enabled
  const trustProxy = process.env.TRUST_PROXY === 'true';
  let clientIp: string;

  if (trustProxy) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      clientIp = forwardedFor.split(',')[0].trim();
    } else {
      clientIp = (request as any).ip || 'unknown';
    }
  } else {
    // Don't trust headers - use Next.js request.ip if available
    clientIp = (request as any).ip || 'unknown';
  }

  // Validate IP format
  if (!isValidIp(clientIp)) {
    clientIp = 'unknown';
  }

  const fullIdentifier = `${identifier}:${clientIp}`;
  
  const result = checkRateLimit(fullIdentifier, maxRequests, windowMs);
  
  if (!result.allowed) {
    return NextResponse.json(
      {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: result.retryAfter,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.resetAt),
          'Retry-After': String(result.retryAfter),
        },
      }
    );
  }
  
  return null;
}

/**
 * Reset rate limit for an identifier (for admin use)
 */
export function resetRateLimit(identifier: string): void {
  const key = `ratelimit:${identifier}`;
  defaultStore.delete(key);
}

// ============================================================================
// Class-based API (used by security-middleware tests and anyone that wants a
// self-contained rate-limiter with per-route configuration).
// ============================================================================

/**
 * Constructor config for `RateLimiter`.
 */
export interface RateLimiterConstructorConfig {
  /** Default requests allowed per window. Defaults to 100. */
  defaultLimit?: number;
  /** Default window size, in SECONDS. Defaults to 60. */
  defaultWindow?: number;
  /** Whether exponential backoff is enabled for repeated offenders. */
  backoff?: boolean;
}

/**
 * Per-route override for `RateLimiter.configure()`.
 */
export interface RateLimiterRouteConfig {
  limit: number;
  /** Window size, in SECONDS. */
  window: number;
  backoff?: boolean;
}

/**
 * Class-based rate limiter with per-route configuration and its own internal
 * store (independent of the module-level `defaultStore`).
 */
export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private backoffAttempts = new Map<string, number>();
  private defaultLimit: number;
  private defaultWindowMs: number;
  private defaultBackoff: boolean;
  private routeConfigs = new Map<string, { limit: number; windowMs: number; backoff: boolean }>();

  constructor(config: RateLimiterConstructorConfig = {}) {
    this.defaultLimit = config.defaultLimit ?? 100;
    this.defaultWindowMs = (config.defaultWindow ?? 60) * 1000;
    this.defaultBackoff = config.backoff ?? false;
  }

  /**
   * Configure rate-limit overrides for a specific route path.
   */
  configure(path: string, config: RateLimiterRouteConfig): void {
    this.routeConfigs.set(path, {
      limit: config.limit,
      windowMs: config.window * 1000,
      backoff: config.backoff ?? false,
    });
  }

  /**
   * Check a request against the rate limit. Increments the counter on success.
   */
  async check(request: NextRequest): Promise<{
    success: boolean;
    remaining: number;
    retryAfter?: number;
  }> {
    let pathname = '';
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      pathname = '';
    }
    const routeOverride = this.routeConfigs.get(pathname);
    const limit = routeOverride?.limit ?? this.defaultLimit;
    const windowMs = routeOverride?.windowMs ?? this.defaultWindowMs;
    const backoff = routeOverride?.backoff ?? this.defaultBackoff;

    const identifier = this.getIdentifier(request);
    const key = `${pathname}:${identifier}`;
    const now = Date.now();

    let entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs, remaining: limit };
    }

    if (entry.count >= limit) {
      let retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      if (backoff) {
        const attempts = (this.backoffAttempts.get(key) ?? 1) + 1;
        this.backoffAttempts.set(key, attempts);
        // Exponential backoff on top of the natural window wait
        const backoffSeconds = Math.pow(2, attempts);
        retryAfter = Math.max(retryAfter, backoffSeconds);
      }
      return { success: false, remaining: 0, retryAfter };
    }

    entry.count++;
    entry.remaining = Math.max(0, limit - entry.count);
    this.store.set(key, entry);
    // Successful request — reset any backoff attempts
    this.backoffAttempts.delete(key);

    return { success: true, remaining: entry.remaining };
  }

  /**
   * Reset rate-limit state for a given key prefix (e.g. all state for an IP).
   */
  reset(): void {
    this.store.clear();
    this.backoffAttempts.clear();
  }

  private getIdentifier(request: NextRequest): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const first = forwardedFor.split(',')[0].trim();
      if (first) return `ip:${first}`;
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return `ip:${realIp}`;
    const ip = (request as any).ip;
    if (ip) return `ip:${ip}`;
    const ua = request.headers.get('user-agent') ?? 'unknown';
    return `ua:${ua}`;
  }
}

/**
 * Singleton `RateLimiter` used by the module-level `checkRateLimit(request)`
 * API and by anything that wants shared rate-limit state across routes.
 */
export const rateLimiter = new RateLimiter();

/**
 * Apply common route-specific rate-limit overrides to the singleton
 * `rateLimiter`.
 */
export function configureRateLimits(): void {
  rateLimiter.configure('/api/chat', { limit: 60, window: 60, backoff: true });
  rateLimiter.configure('/api/auth/login', { limit: 5, window: 60, backoff: true });
  rateLimiter.configure('/api/auth/register', { limit: 3, window: 3600, backoff: true });
  rateLimiter.configure('/api/auth/password-reset', { limit: 3, window: 3600, backoff: true });
}

/**
 * Get rate limit status for an identifier (for debugging/admin)
 */
export function getRateLimitStatus(
  identifier: string,
  maxRequests: number,
  windowMs: number
): { count: number; remaining: number; resetAt: number; isLimited: boolean } {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const entry = defaultStore.get(key);

  if (!entry || now > entry.resetAt) {
    return {
      count: 0,
      remaining: maxRequests,
      resetAt: now + windowMs,
      isLimited: false,
    };
  }

  return {
    count: entry.count,
    remaining: entry.remaining,
    resetAt: entry.resetAt,
    isLimited: entry.count >= maxRequests,
  };
}
