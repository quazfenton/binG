/**
 * Edge Rate Limiter
 *
 * Uses Cloudflare KV with sliding window algorithm.
 * - 100 req/min for anonymous IPs
 * - 1000 req/min for authenticated users (by user ID)
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const ANON_MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = 1000;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,            // IP address or user ID
  maxRequests: number = ANON_MAX_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;

  try {
    const current = await kv.get<{ count: number; windowStart: number }>(windowKey, 'json');
    const count = current?.count ?? 0;
    const windowStart = current?.windowStart ?? now;

    if (count >= maxRequests) {
      const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
    }

    // Increment counter
    await kv.put(windowKey, JSON.stringify({ count: count + 1, windowStart }), {
      expirationTtl: Math.ceil(windowMs / 1000),
    });

    return { allowed: true, remaining: maxRequests - count - 1, retryAfter: 0 };
  } catch {
    // If KV fails, allow the request (fail open)
    return { allowed: true, remaining: maxRequests, retryAfter: 0 };
  }
}

/**
 * Rate limit by IP address
 */
export async function checkIpRateLimit(kv: KVNamespace, request: Request): Promise<RateLimitResult> {
  const ip = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
  return checkRateLimit(kv, `ip:${ip}`, ANON_MAX_REQUESTS);
}

/**
 * Rate limit by authenticated user ID
 */
export async function checkUserRateLimit(kv: KVNamespace, userId: string): Promise<RateLimitResult> {
  return checkRateLimit(kv, `user:${userId}`, AUTH_MAX_REQUESTS);
}
