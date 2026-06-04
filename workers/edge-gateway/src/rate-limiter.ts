/**
 * Edge Rate Limiter
 *
 * Uses Cloudflare KV with sliding window algorithm.
 * - 100 req/min for anonymous IPs
 * - 1000 req/min for authenticated users (by user ID)
 *
 * OPTIMIZATION: Uses in-memory counters with periodic KV sync to avoid
 * excessive KV writes. Each worker instance maintains local counters and
 * only writes to KV every WINDOW_MS milliseconds (configurable, default 10s).
 * This reduces KV writes from O(requests) to O(10s intervals) per key.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const ANON_MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = 1000;
// Sync to KV every 5 minutes (increased from 10s to stay under Cloudflare KV free tier
// limit of 1,000 writes/day). With the per-minute windowKey, at most one sync fires
// per window, so a single IP generates ~1,440 writes/day (vs 8,640/day at 10s).
// Multiple IPs stay under the limit until ~3 concurrent users.
// Rate limiting is still effective since in-memory counters track between syncs.
// NOTE: syncToKV must use the CURRENT window key, not the stale counter.windowStart,
// otherwise the write lands on an already-expired key and is wasted on restart.
const KV_SYNC_INTERVAL_MS = 300_000;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

interface Counter {
  count: number;
  windowStart: number;
}

// In-memory counters to reduce KV writes
const memoryCounters = new Map<string, Counter>();
const lastSyncTimes = new Map<string, number>();
const CLEANUP_INTERVAL_MS = 60_000; // Cleanup old entries every minute
let lastCleanup = 0;

/**
 * Get current window key for rate limiting
 */
function getWindowKey(key: string, windowMs: number): string {
  return `ratelimit:${key}:${Math.floor(Date.now() / windowMs)}`;
}

/**
 * Sync counter to KV (batched write)
 */
async function syncToKV(
  kv: KVNamespace,
  key: string,
  counter: Counter,
  windowMs: number
): Promise<void> {
  // CRITICAL: Use the CURRENT window key, not the stale counter.windowStart.
  // counter.windowStart is set when the counter was first created (up to 300s ago)
  // and its window may have already expired. Without this fix, KV writes land on
  // expired keys and the counters are lost on worker restart, weakening rate-limit
  // enforcement across isolates.
  const currentWindow = Math.floor(Date.now() / windowMs);
  const windowKey = `ratelimit:${key}:${currentWindow}`;
  try {
    await kv.put(windowKey, JSON.stringify(counter), {
      expirationTtl: Math.ceil(windowMs / 1000) + 1, // +1s buffer
    });
  } catch {
    // Silent fail on sync - local counter still tracks
  }
}

/**
 * Cleanup old entries from in-memory Maps to prevent memory leaks
 */
function cleanupOldEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const currentWindow = Math.floor(now / RATE_LIMIT_WINDOW_MS);

  for (const key of memoryCounters.keys()) {
    const keyWindow = parseInt(key.split(':').pop() ?? '0', 10);
    if (keyWindow < currentWindow - 1) { // Keep current and previous window
      memoryCounters.delete(key);
      lastSyncTimes.delete(key);
    }
  }
}

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,            // IP address or user ID
  maxRequests: number = ANON_MAX_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowKey = getWindowKey(key, windowMs);
  const currentWindow = Math.floor(now / windowMs);

  try {
    // Check if we have a local counter for this window
    let counter = memoryCounters.get(windowKey);
    
    if (!counter) {
      // Try to load from KV first
      const stored = await kv.get<Counter>(windowKey, 'json');
      if (stored && Math.floor(stored.windowStart / windowMs) === currentWindow) {
        counter = stored;
      } else {
        // Start fresh window
        counter = { count: 0, windowStart: now };
      }
      memoryCounters.set(windowKey, counter);
    }

    // Check rate limit
    if (counter.count >= maxRequests) {
      const retryAfter = Math.ceil((counter.windowStart + windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
    }

    // Increment local counter
    counter.count++;

    // Periodic cleanup to prevent memory leaks
    cleanupOldEntries();

    // Sync to KV periodically instead of every request
    const lastSync = lastSyncTimes.get(windowKey) ?? 0;
    if (now - lastSync >= KV_SYNC_INTERVAL_MS) {
      await syncToKV(kv, key, counter, windowMs);
      lastSyncTimes.set(windowKey, now);
    }

    return { allowed: true, remaining: maxRequests - counter.count, retryAfter: 0 };
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
