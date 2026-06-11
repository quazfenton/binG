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
 *
 * ─── ARCHITECTURE: WAF vs Custom Rate Limiting ──────────────────────────────────
 *
 * This custom rate limiter is INTENTIONALLY only the second line of defense.
 * The primary bulk-IP-flood protection is a Cloudflare WAF Rate Limit Rule
 * (configured in the dashboard or via API), which runs at the edge BEFORE
 * the Worker is invoked and consumes zero Worker requests or KV quota.
 *
 *  ┌──────────────────────────────────────────────────────────────────────────┐
 *  │  Edge (WAF)  │  Worker (custom)   │  Backend (per-user)                │
 *  │  ───────────  │  ────────────────  │  ──────────────                    │
 *  │  Per-IP bulk  │  Soft per-IP caps  │  Hard per-user caps                │
 *  │  flood guard  │  (in-memory only)  │  (uses backend's own KV/DB)        │
 *  │  Free, 0ms    │  0 KV writes       │  Independent of Worker KV quota    │
 *  │  No Worker    │  Lost on restart   │  Persistent across instances       │
 *  │  invocation   │  (acceptable)      │  (single source of truth)          │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 * Why we keep this custom limiter (instead of relying on WAF alone):
 *  1. Per-user post-auth limits: WAF can match on a custom header, but the
 *     header is set AFTER auth, so the Worker has already been invoked once.
 *  2. Per-tier soft caps (free vs pro): need custom logic the WAF can't express.
 *  3. Custom 429 response bodies (JSON with retryAfter) for the frontend.
 *
 * Why we DON'T persist the soft counter to KV aggressively:
 *  - The Worker's KV free tier is 1,000 writes/day. Even with the 5-min
 *    sync interval below, an active IP generates up to ~1,440 writes/day
 *    (1 per minute window where requests happen). The WAF rule absorbs
 *    the bulk of the noise so this counter rarely hits the cap.
 *  - The counter is a SOFT cap. The WAF is the HARD cap.
 *
 * Sync behavior is asserted by __tests__/rate-limiter.test.ts — 100 rapid
 * calls within the same minute window must produce at most 1 kv.put.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const ANON_MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = 1000;
// Note: the previous 5-min sync interval (KV_SYNC_INTERVAL_MS = 300_000) was
// removed in favor of the deny-only write above. This drops the Worker-side
// KV write rate from ~1,440 writes/day per active IP to ~0 writes/day in the
// common (allowed) case, with 1 write per denied request as a best-effort
// audit trail. The Worker's KV free tier is now reserved for state
// (BACKEND_URL rotation in url-store.ts).

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

interface Counter {
  count: number;
  windowStart: number;
}

// In-memory counters (no periodic KV sync — see checkRateLimit deny branch)
const memoryCounters = new Map<string, Counter>();
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

      // WAF handles bulk IP flood protection at the edge. Backend handles
      // per-user hard limits. This in-memory counter is for soft caps only and
      // is intentionally not persisted to KV. The ONLY kv.put in the hot path
      // is here on deny — it logs the bad-actor counter so the next isolate
      // (or the backend) can pick up the high-water mark if it ever needs to.
      try {
        await syncToKV(kv, key, counter, windowMs);
      } catch {
        // Best-effort: deny path doesn't depend on KV write success
      }

      return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter) };
    }

    // Increment local counter
    counter.count++;

    // Periodic cleanup to prevent memory leaks
    cleanupOldEntries();

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
