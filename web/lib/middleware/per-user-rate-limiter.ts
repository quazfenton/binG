/**
 * Per-User Hard Rate Limiter
 *
 * Provides per-authenticated-userId rate limiting (default: 1000 req/min) for
 * hard caps. Distinct from the existing IP-based limiter in `rate-limiter.ts`:
 *
 *  - 1000 req/min per userId (vs the 30/min generic cap there)
 *  - Bounded LRU cache (vs unbounded Map) — caps memory at high cardinality
 *  - Optional Redis or KV fallback for cross-instance consistency
 *  - Independent of the Worker's KV free-tier quota
 *
 * Use case: a user authenticated across multiple CF PoPs (or multiple
 * Next.js server instances) should still be capped at a single global
 * rate, not per-instance. The in-memory LRU is the fast path; the
 * optional Redis/KV is the consistency layer.
 *
 * The Worker's rate limiter handles bulk anonymous IP floods at the edge
 * (free, 0 Worker invocations). The existing IP-based rate-limiter in
 * this codebase handles per-IP soft caps. THIS module is the per-USER
 * hard cap that sits behind auth — it's the third tier of the
 * WAF → Worker IP → Backend per-user cascade.
 */

/** Optional external store. Pass a Redis client or a KV-like interface. */
export interface CounterStore {
  /** Atomically increment the counter at `key` and return the new value. */
  increment(key: string, windowMs: number): Promise<number>;
  /** Optional: get the current count without incrementing. */
  get?(key: string): Promise<number | null>;
}

export interface PerUserRateLimitConfig {
  windowMs?: number;           // Sliding window size in ms (default 60_000)
  maxRequests?: number;        // Max requests per window (default 1000)
  store?: CounterStore;        // Optional external store (Redis/KV) for cross-instance
  lruMaxSize?: number;         // Max entries in the in-memory LRU (default 10_000)
  keyPrefix?: string;          // Prefix for the cache key (default 'rl:user:')
}

export interface PerUserRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
  retryAfterSec: number;
  source: 'memory' | 'store' | 'hybrid';
}

/**
 * Sliding-window counter for a single key. Stored in an LRU map.
 */
interface Counter {
  windowStart: number;         // When the current window started (ms)
  count: number;               // Requests in the current window
}

/** Per-key TTL in the LRU — used for eviction when count is 0. */
const DEFAULT_LRU_MAX_SIZE = 10_000;

/** Insertion-order-tracked Map = LRU. */
type LruMap<K, V> = Map<K, V>;

export class PerUserRateLimiter {
  private readonly config: Required<Omit<PerUserRateLimitConfig, 'store'>> & { store?: CounterStore };
  private readonly lru: LruMap<string, Counter>;

  constructor(config: PerUserRateLimitConfig = {}) {
    this.config = {
      windowMs: config.windowMs ?? 60_000,
      maxRequests: config.maxRequests ?? 1000,
      store: config.store,
      lruMaxSize: config.lruMaxSize ?? DEFAULT_LRU_MAX_SIZE,
      keyPrefix: config.keyPrefix ?? 'rl:user:',
    };
    this.lru = new Map();
  }

  /**
   * Touch an entry (move to most-recently-used position). When the LRU
   * is at capacity, evict the least-recently-used entry.
   */
  private touch(key: string, counter: Counter): void {
    // Delete + re-set to move to insertion order end (= most recent in Map)
    this.lru.delete(key);
    this.lru.set(key, counter);
    // Evict oldest if over capacity
    if (this.lru.size > this.config.lruMaxSize) {
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) this.lru.delete(oldest);
    }
  }

  /**
   * Check the rate limit for a userId. Returns the decision + diagnostics.
   *
   * Strategy: in-memory LRU is the fast path. If an optional store is
   * configured, we also increment there on each call to keep cross-instance
   * counters consistent. The local LRU mirrors the store's value when the
   * store reports a higher count (e.g., another instance incremented).
   */
  async check(userId: string): Promise<PerUserRateLimitResult> {
    const now = Date.now();
    const cacheKey = `${this.config.keyPrefix}${userId}`;
    const storeKey = cacheKey;

    // ── In-memory LRU check (fast path) ─────────────────────────────
    let counter = this.lru.get(cacheKey);
    if (!counter || now - counter.windowStart >= this.config.windowMs) {
      counter = { windowStart: now, count: 0 };
    }

    // ── Optional store check (cross-instance consistency) ───────────
    let source: 'memory' | 'store' | 'hybrid' = 'memory';
    if (this.config.store) {
      try {
        const storeCount = await this.config.store.increment(storeKey, this.config.windowMs);
        // If another instance has a higher count, use that as the source of truth
        if (storeCount > counter.count) {
          counter = { windowStart: now, count: storeCount };
          source = 'store';
        } else {
          source = 'hybrid';
        }
      } catch {
        // Store failure: fall back to in-memory only (fail open per request)
        source = 'memory';
      }
    }

    // Increment + check limit
    counter.count += 1;
    this.touch(cacheKey, counter);

    const windowEnd = counter.windowStart + this.config.windowMs;
    const resetAfterMs = Math.max(0, windowEnd - now);
    const allowed = counter.count <= this.config.maxRequests;
    const remaining = Math.max(0, this.config.maxRequests - counter.count);

    return {
      allowed,
      remaining,
      resetAfterMs,
      retryAfterSec: allowed ? 0 : Math.ceil(resetAfterMs / 1000),
      source,
    };
  }

  /**
   * Build standard X-RateLimit-* response headers from a result.
   */
  static headers(result: PerUserRateLimitResult, maxRequests: number): Record<string, string> {
    return {
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + result.resetAfterMs / 1000).toString(),
      'X-RateLimit-Source': result.source,
    };
  }

  /**
   * Reset a user's counter (admin action / testing).
   */
  reset(userId: string): void {
    this.lru.delete(`${this.config.keyPrefix}${userId}`);
  }

  /**
   * Current LRU size (for monitoring / test assertions).
   */
  get size(): number {
    return this.lru.size;
  }
}

// ─── Default singleton (1000 req/min per userId, no external store) ───
//
// For multi-instance consistency, replace this with a PerUserRateLimiter
// instance that has a Redis or KV store attached. See below for an example
// KV-backed store (uncomment and configure REDIS_URL or KV_REST_API_URL).
//
// import { createClient } from 'redis';
// const redis = createClient({ url: process.env.REDIS_URL });
// await redis.connect();
// const redisStore: CounterStore = {
//   increment: async (key, windowMs) => {
//     const count = await redis.incr(`rl:${key}:${Math.floor(Date.now() / windowMs)}`);
//     await redis.expire(`rl:${key}:${Math.floor(Date.now() / windowMs)}`, Math.ceil(windowMs / 1000) + 1);
//     return count;
//   },
// };
// export const perUserRateLimiter = new PerUserRateLimiter({
//   maxRequests: 1000,
//   windowMs: 60_000,
//   store: redisStore,
// });

export const perUserRateLimiter = new PerUserRateLimiter({
  maxRequests: 1000,
  windowMs: 60_000,
  // store: <attach a Redis or KV client here for cross-instance consistency>,
});
