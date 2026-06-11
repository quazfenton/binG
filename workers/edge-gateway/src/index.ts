/**
 * binG Edge Gateway — Cloudflare Worker (shared ingress for all 3 apps)
 *
 * Sits in front of all Vercel frontends and OCI backends:
 * 1. Rate-limits anonymous requests via KV
 * 2. Authenticates JWT tokens at the edge
 * 3. Routes /api/*, /copa/*, /nocturne/*, /novnc/*, /health* to OCI backend,
 *    /* to Vercel frontend
 * 4. Proxies requests and returns responses with correct headers
 *
 * Vercel frontends point to this Worker's URL as their stable API ingress.
 * The Worker routes to the tunnel URL stored in KV — tunnel rotation is
 * instant with no frontend redeploy.
 *
 * Admin:
 *   POST /admin/backend-url  (header X-Admin-Token: <ADMIN_TOKEN>)
 *     Body: { "url": "https://..." }
 *     Updates the runtime BACKEND_URL in KV + R2 fallback
 *   POST /admin/backend-url-fallback
 *     R2-only fallback when KV put quota is exceeded
 */
import { authenticateRequest, signJwt } from './auth';
import { checkIpRateLimit, checkRateLimit } from './rate-limiter';
import { routeRequest } from './router';
import { setBackendUrl } from './url-store';
import { handleFileRequest } from './r2-storage';
import { TraceLog } from './trace-log';
import type { Env } from './env';
import type { ExecutionContext } from '@cloudflare/workers-types';

// ─── Cacheable GET Path Patterns ─────────────────────────────────────────────
//
// Three endpoint categories get the Cache API treatment to keep the Worker
// request count and KV rate-limit lookups under the free-tier 100k/day cap.
//
//   1. Health checks (/health, /api/health) — public, no auth, cache 5s
//      High hit rate (constant polling), 0% token leakage risk
//
//   2. VFS reads/lists/search (/api/filesystem/(read|list|search|...)) —
//      per-user, cache 1s. Short TTL because VFS polling is for change
//      detection; serving stale data for >1s defeats the purpose.
//
//   3. Sandbox status GETs (/api/sandbox/(session|agent|terminal|...)) —
//      per-user, cache 2s. Status changes are slower than VFS but
//      sandbox polling can still be noisy.
//
// State-changing requests (VFS writes, sandbox execute, chat streams) are
// NOT cached. Admin endpoints are not cached.
const VFS_GET_PATTERNS: RegExp[] = [
  /^\/api\/filesystem\/read(\/|$)/,
  /^\/api\/filesystem\/list(\/|$)/,
  /^\/api\/filesystem\/search(\/|$)/,
  /^\/api\/filesystem\/diffs(\/|$)/,
  /^\/api\/filesystem\/snapshot(\/|$)/,
  /^\/api\/filesystem\/commits(\/|$)/,
  /^\/api\/filesystem\/context-pack(\/|$)/,
];
const SANDBOX_GET_PATTERNS: RegExp[] = [
  /^\/api\/sandbox\/session(\/|$)/,
  /^\/api\/sandbox\/agent(\/|$)/,
  /^\/api\/sandbox\/terminal(\/|$)/,
  /^\/api\/sandbox\/lifecycle(\/|$)/,
];
const HEALTH_PATHS = new Set(['/health', '/api/health']);

/**
 * Cloudflare Cache API helper. Returns the cached response on hit; otherwise
 * invokes `build()`, stores the response under `cacheKey` with the given TTL,
 * and returns it. Adds an `X-Cache-Status: HIT|MISS` header to every response
 * for observability. Failures in the cache layer are non-fatal — falls back
 * to `build()` so the request still completes.
 *
 * `ctx` is used to async-cache via waitUntil() so cache.put() doesn't add
 * latency to the response.
 */
async function cacheGetOrSet(
  cacheKey: string,
  ttlSeconds: number,
  build: () => Promise<Response>,
  ctx?: ExecutionContext,
): Promise<Response> {
  try {
    const cache = caches.default;
    const cacheReq = new Request(cacheKey);
    const cached = await cache.match(cacheReq);
    if (cached) {
      const out = new Response(cached.body, cached);
      out.headers.set('X-Cache-Status', 'HIT');
      return out;
    }
    const fresh = await build();
    // Only cache 2xx responses — never cache 4xx/5xx (would mask real errors)
    if (fresh.ok && ttlSeconds > 0) {
      const cacheable = new Response(fresh.body, fresh);
      // Override the response's own Cache-Control to match our TTL so the
      // Cache API respects it (otherwise it falls back to the response's
      // own header, which may be shorter or longer).
      cacheable.headers.set('Cache-Control', `private, max-age=${ttlSeconds}`);
      cacheable.headers.set('X-Cache-Status', 'MISS');
      if (ctx) {
        ctx.waitUntil(cache.put(cacheReq, cacheable));
      } else {
        // Fallback: store synchronously (small extra latency, no ctx)
        try { await cache.put(cacheReq, cacheable); } catch { /* ignore */ }
      }
      return new Response(fresh.body, cacheable);
    }
    fresh.headers.set('X-Cache-Status', 'MISS');
    return fresh;
  } catch {
    // Cache layer failure must not break the request
    return await build();
  }
}

function isVfsGetPath(pathname: string): boolean {
  return VFS_GET_PATTERNS.some(p => p.test(pathname));
}
function isSandboxGetPath(pathname: string): boolean {
  return SANDBOX_GET_PATTERNS.some(p => p.test(pathname));
}

// ─── IP Flood Monitor (Workers Analytics Engine) ───────────────────────────
//
// Bulk IP flood protection without paying for Cloudflare WAF rate-limit rules
// (which are not available on the Free plan). Architecture:
//
//   ┌──────────────────────────────────────────────────────────────────────────┐
//   │  Every fetch request                                                   │
//   │    1. Check deny list (KV-backed, 30s in-memory cache) → 403 if hit   │
//   │    2. Fire-and-forget writeDataPoint() to Analytics Engine             │
//   │       blobs: [clientIp, path, method]                                   │
//   │       doubles: [1]                                                      │
//   │       indexes: [timestampMs]                                            │
//   │                                                                          │
//   │  Scheduled handler (cron */1 * * * * — every minute)                   │
//   │    1. SQL query against the dataset:                                    │
//   │       SELECT blob1 AS ip, sum(_sample_interval) AS reqs                 │
//   │         FROM ip_flood_monitor                                           │
//   │        WHERE timestamp > NOW() - INTERVAL '1' MINUTE                    │
//   │        GROUP BY ip                                                      │
//   │       HAVING reqs > <FLOOD_THRESHOLD>                                   │
//   │    2. Write the resulting IP set to KV (key: `ip_flood:deny_list`)      │
//   │    3. The in-memory cache in this worker is automatically stale and    │
//   │       will refresh on the next request after 30s.                      │
//   └──────────────────────────────────────────────────────────────────────────┘
//
// Free-tier cost: 1 writeDataPoint per request (up to 100k/day) + 1 KV put
// per minute (well under the 1k/day cap). No Worker invocation cost — the
// scheduled handler runs in the same isolate budget. Hot path adds 1 set
// lookup + 1 async writeDataPoint() (non-blocking, returns void).
//
// Tunables (see [vars] in wrangler.toml or env):
//   IP_FLOOD_THRESHOLD — req/min over which an IP is denied (default 500)
//   IP_FLOOD_DENY_TTL  — KV TTL in seconds for the deny list (default 120)
//
// Why a per-minute cron (not 10s):
//   - WAE's query latency is ~100-500ms; running every second is wasteful.
//   - 60s detection latency is acceptable for a free-tier DDoS absorber.
//   - The 30s in-memory cache amortizes the KV read across 2 cron cycles.
const IP_FLOOD_DENY_LIST_KEY = 'ip_flood:deny_list';
const IP_FLOOD_DENY_LIST_TTL_SECONDS = 120; // KV TTL: 2x the cron interval for safety
const IP_FLOOD_DEFAULT_THRESHOLD = 500;     // req/min over which an IP is denied

// In-memory cache of the deny list. Refreshed on demand at most every 30s.
// Shared across all requests in the same Worker isolate.
let _denyListCache: { ips: Set<string>; loadedAt: number } | null = null;
const IP_FLOOD_CACHE_TTL_MS = 30_000;

/**
 * Load the IP deny list from KV, using a 30s in-memory cache.
 * Returns a Set of blocked IPs. Empty set on KV error (fail open — the
 * rate limiter is the second line of defense).
 */
async function getDenyListedIps(kv: KVNamespace): Promise<Set<string>> {
  const now = Date.now();
  if (_denyListCache && now - _denyListCache.loadedAt < IP_FLOOD_CACHE_TTL_MS) {
    return _denyListCache.ips;
  }
  try {
    const raw = await kv.get(IP_FLOOD_DENY_LIST_KEY);
    if (!raw) {
      _denyListCache = { ips: new Set(), loadedAt: now };
      return _denyListCache.ips;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      _denyListCache = { ips: new Set(parsed.filter((x): x is string => typeof x === 'string')), loadedAt: now };
      return _denyListCache.ips;
    }
  } catch {
    // KV read failure → fail open (empty set)
  }
  _denyListCache = { ips: new Set(), loadedAt: now };
  return _denyListCache.ips;
}

/**
 * Force the in-memory deny list cache to expire. Called by the scheduled
 * handler after writing a new list to KV so the next request picks it up
 * without waiting for the 30s TTL.
 */
function invalidateDenyListCache(): void {
  _denyListCache = null;
}

/**
 * Fire-and-forget Analytics Engine write. writeDataPoint is non-blocking
 * (returns void, queues for batched write to WAE storage), so this adds
 * zero latency to the response.
 *
 * The dataset has a 32 KiB/min write rate limit per Worker — one row per
 * request is well under that.
 */
function logRequestToFloodMonitor(
  dataset: AnalyticsEngineDataset | undefined,
  ip: string,
  method: string,
  pathname: string,
): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      blobs: [ip, pathname, method],
      doubles: [1],
      indexes: [String(Date.now())],
    });
  } catch {
    // WAE writeDataPoint failure is non-fatal — it can throw if the dataset
    // is unavailable or the index value is malformed. We don't want to
    // break the request over a monitoring write.
  }
}

/**
 * Get the client IP from request headers, with the same priority order as
 * checkIpRateLimit. Returns 'unknown' as a fallback (no IP means we can't
 * be denied, but the WAE log will also be unattributable).
 */
function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

// ─── Path-Filtered Observability ──────────────────────────────────────
//
// Only trace these high-value API paths — the Bing project has high-volume
// polling (file checks, SSE heartbeats, static asset fetches) that would
// burn through the free tier's 100k req/day quota at 100% sampling.
// Platform-level observability (wrangler.toml) is set to head_sampling_rate=0
// so we handle filtering entirely in code via console.log.
//
const TRACED_PATTERNS: RegExp[] = [
  // ── AI / Copilot ────────────────────────────────────────────
  /^\/v1\/chat\/completions/,   // OpenAI-compatible AI calls
  /^\/api\/chat/,                // Hono server chat

  // ── CopaMundial & Nocturne ──────────────────────────────────
  /^\/copa\//,                   // CopaMundial API
  /^\/nocturne\//,              // Nocturne API

  // ── Bing: Virtual Filesystem (VFS) operations ───────────────
  /^\/api\/filesystem\/read/,
  /^\/api\/filesystem\/write/,
  /^\/api\/filesystem\/list/,
  /^\/api\/filesystem\/delete/,
  /^\/api\/filesystem\/mkdir/,
  /^\/api\/filesystem\/move/,
  /^\/api\/filesystem\/rename/,
  /^\/api\/filesystem\/search/,
  /^\/api\/filesystem\/snapshot/,
  /^\/api\/filesystem\/diffs/,
  /^\/api\/filesystem\/rollback/,
  /^\/api\/filesystem\/commits/,
  /^\/api\/filesystem\/create-file/,
  /^\/api\/filesystem\/import/,
  /^\/api\/filesystem\/context-pack/,
  /^\/api\/filesystem\/events\/push/,

  // ── Bing: Auth ───────────────────────────────────────────────
  /^\/api\/auth\/login/,
  /^\/api\/auth\/register/,
  /^\/api\/auth\/session/,
  /^\/api\/auth\/password-reset/,

  // ── Bing: Sandbox operations ────────────────────────────────
  /^\/api\/sandbox\/session/,
  /^\/api\/sandbox\/agent/,
  /^\/api\/sandbox\/terminal/,
  /^\/api\/sandbox\/lifecycle/,
  /^\/api\/sandbox\/execute/,

  // ── Bing: Terminal / PTY ────────────────────────────────────
  /^\/api\/terminal\/local-pty/,
  /^\/api\/terminal\/previews\/events/,
];

/**
 * Returns true if this request path should be traced/logged.
 * Health checks are throttled — only log ~1 in 50 to avoid quota burn.
 */
function shouldTrace(pathname: string, isHealth: boolean): boolean {
  // Health checks: noisy, low-value — sample at ~2%
  if (isHealth) {
    return Math.random() < 0.02;
  }
  // High-value API paths: always trace
  return TRACED_PATTERNS.some(p => p.test(pathname));
}

/**
 * Lightweight structured trace for observed requests.
 * Only fires for high-value paths (see TRACED_PATTERNS above).
 *
 * Dual-write strategy:
 *   1. console.log() — feeds Cloudflare tail / Logpush (primary observability)
 *   2. R2 persistence via TraceLog — durable storage independent of platform
 *
 * R2 failure is non-fatal — TraceLog buffers entries and retries on next write.
 */
function traceRequest(method: string, pathname: string, extra?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    method: method.toUpperCase(),
    path: pathname,
    ...extra,
  };
  // writeTraceLog handles console.log + R2 dual-write
  writeTraceLog(entry as any);
}

// TraceLog instance — initialized lazily so we don't require TRACE_R2 to exist
let _traceLog: TraceLog | null = null;
function getTraceLog(env: Env): TraceLog {
  if (!_traceLog) {
    _traceLog = new TraceLog(env.TRACE_R2);
  }
  return _traceLog;
}
function writeTraceLog(entry: {
  ts: string;
  method: string;
  path: string;
  [key: string]: unknown;
}): void {
  if (!_traceLog) return;
  _traceLog.write(entry as any);
}

// CORS headers applied to all responses
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Auth-Token, X-CSRF-Token, X-Admin-Token',
  'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  'Access-Control-Max-Age': '86400',
};

// ─── Cached HMAC Signing Key ────────────────────────────────────────────────
// `crypto.subtle.importKey` costs ~0.5ms per call. The Worker isolate is reused
// across requests within a single CF data center, so cache the CryptoKey at
// module scope and only re-import if the secret changes (e.g., env rotation).
// Signing itself (crypto.subtle.sign) is also a bit faster when the key is
// already a CryptoKey object vs being re-imported inline.
let _signingKey: CryptoKey | null = null;
let _signingKeyForSecret: string | null = null;
async function getOrImportSigningKey(secret: string): Promise<CryptoKey> {
  if (_signingKey && _signingKeyForSecret === secret) return _signingKey;
  _signingKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  _signingKeyForSecret = secret;
  return _signingKey;
}

function _bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _strToBase64Url(s: string): string {
  return _bytesToBase64Url(new TextEncoder().encode(s));
}

/**
 * Sign an HS256 JWT using a cached HMAC key. ~5-10x faster than calling
 * `signJwt()` for repeated requests in the same Worker isolate, because it
 * skips the `crypto.subtle.importKey` step after the first call.
 *
 * Output is byte-identical to `@bing/shared/auth/jwt` `signJwt()` for the
 * same (payload, secret) input.
 */
async function signJwtCached(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = _strToBase64Url(JSON.stringify(header));
  const payloadB64 = _strToBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await getOrImportSigningKey(secret);
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)),
  );
  const sigB64 = _bytesToBase64Url(sigBytes);
  return `${signingInput}.${sigB64}`;
}

// Security headers applied to all responses
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default {
  /**
   * Scheduled handler — runs every minute (see wrangler.toml [triggers] for the
   * cron expression; written there because embedding it in this JSDoc would
   * close the comment block prematurely).
   *
   * Queries the IP flood monitor Analytics Engine dataset for IPs that
   * exceeded the threshold in the last 60 seconds, writes the resulting
   * deny list to KV, and invalidates the in-memory cache so the next
   * request picks up the new list within 30s.
   *
   * The query goes through Cloudflare's HTTP SQL API (Workers can't query
   * their own Analytics Engine datasets directly from inside the Worker;
   * only writeDataPoint is available on the binding). Requires:
   *   - CLOUDFLARE_API_TOKEN secret with `Account Analytics: Read` scope
   *   - CF_ACCOUNT_ID wrangler var (falls back to the wrangler.toml value)
   * If either is missing, the scheduled handler no-ops silently — the rest
   * of the worker still functions; the deny list just won't update.
   *
   * Runs on the same isolated budget as the main worker; failure here
   * doesn't affect request handling.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.IP_FLOOD_MONITOR || !env.BING_KV) {
      // Dataset or KV not bound — nothing to do.
      return;
    }
    const apiToken = (env as any).CLOUDFLARE_API_TOKEN as string | undefined;
    const accountId = (env as any).CF_ACCOUNT_ID as string | undefined;
    if (!apiToken || !accountId) {
      // Required for the SQL query API; skip silently.
      return;
    }
    const threshold = Number((env as any).IP_FLOOD_THRESHOLD) || IP_FLOOD_DEFAULT_THRESHOLD;
    const safeThreshold = Number.isFinite(threshold) ? threshold : IP_FLOOD_DEFAULT_THRESHOLD;
    try {
      // WAE SQL: sum _sample_interval to get the count of data points per IP
      // in the last minute. blob1 holds the IP address (see logRequestToFloodMonitor).
      // HAVING filters to IPs above the threshold; ORDER BY for stable output.
      const sql =
        `SELECT blob1 AS ip, sum(_sample_interval) AS reqs ` +
        `FROM ip_flood_monitor ` +
        `WHERE timestamp > NOW() - INTERVAL '1' MINUTE ` +
        `GROUP BY ip ` +
        `HAVING reqs > ${safeThreshold} ` +
        `ORDER BY reqs DESC ` +
        `LIMIT 1000`;
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'text/plain',
        },
        body: sql,
      });
      if (!response.ok) {
        // Log and bail. The KV deny list keeps its previous value; the next
        // cron tick will try again.
        console.error('[ip-flood-monitor] WAE SQL query failed:',
          response.status, response.statusText);
        return;
      }
      const result = (await response.json()) as {
        success?: boolean;
        result?: { rows?: unknown };
      };
      const ips: string[] = [];
      const rows = result.result?.rows;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          // WAE returns rows as { ip: '1.2.3.4', reqs: 1234 } objects
          // (or sometimes as arrays; handle both).
          if (Array.isArray(row) && typeof row[0] === 'string') {
            if (row[0].length > 0 && row[0].length < 64) ips.push(row[0]);
            continue;
          }
          if (row && typeof row === 'object') {
            const r = row as { ip?: unknown };
            if (typeof r.ip === 'string' && r.ip.length > 0 && r.ip.length < 64) {
              ips.push(r.ip);
            }
          }
        }
      }
      await env.BING_KV.put(IP_FLOOD_DENY_LIST_KEY, JSON.stringify(ips), {
        expirationTtl: IP_FLOOD_DENY_LIST_TTL_SECONDS,
      });
      invalidateDenyListCache();
    } catch (err) {
      // Log but don't throw — scheduled handler errors are not surfaced to users.
      // We don't want a transient WAE or KV failure to keep retrying the cron.
      console.error('[ip-flood-monitor] scheduled handler failed:',
        err instanceof Error ? err.message : String(err));
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize trace logger (requires env — safe to call on every request;
    // subsequent calls return the cached instance)
    void getTraceLog(env);

    const url = new URL(request.url);
    const isHealthPath = HEALTH_PATHS.has(url.pathname) || url.pathname === '/copa/api/health' || url.pathname === '/nocturne/api/health';
    const doTrace = shouldTrace(url.pathname, isHealthPath);

    // ─── IP Flood Monitor: WAE logging (BEFORE deny-list check) ─────
    // writeDataPoint is non-blocking (returns void, batched async). This
    // adds zero latency. WAE is the source of truth for the scheduled
    // handler's SQL aggregation — no cost on the hot path beyond the
    // 32 KiB/min write rate limit (well above 1 row per request). We log
    // every request including ones that will be denied, so the dataset
    // has a complete view of incoming traffic for analytics purposes.
    const clientIp = getClientIp(request);
    logRequestToFloodMonitor(env.IP_FLOOD_MONITOR, clientIp, request.method, url.pathname);

    // ─── IP Flood Monitor: deny-list check (BEFORE rate limiting) ────
    // The KV-backed deny list is rebuilt every minute by the scheduled
    // handler. This is the WAF equivalent on the Free plan: an in-memory
    // 30s cache avoids per-request KV reads; the work is essentially a
    // Set.has() lookup. Denied requests are 403'd before they consume
    // any rate-limit quota or backend request.
    if (clientIp !== 'unknown' && env.BING_KV) {
      try {
        const deniedIps = await getDenyListedIps(env.BING_KV);
        if (deniedIps.has(clientIp)) {
          return new Response(JSON.stringify({
            error: 'Forbidden',
            detail: 'IP blocked due to excessive request rate',
          }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request, env),
            },
          });
        }
      } catch {
        // Deny-list read failure → fail open (rate limiter is the fallback)
      }
    }

    if (doTrace) {
      traceRequest(request.method, url.pathname, {
        cfCountry: request.headers.get('cf-ipcountry') ?? '??',
        userAgent: request.headers.get('user-agent') ?? '',
      });
    }

    // ─── Health Check (Cache API, 5s TTL) ──────────────────────────
    // Public, idempotent, no auth — safe to cache with a global key.
    // Repeated polls within 5s are served from the edge without invoking
    // the Worker at all.
    if (HEALTH_PATHS.has(url.pathname)) {
      return cacheGetOrSet(
        'https://chat.internal/health',
        5,
        async () => new Response(JSON.stringify({
          status: 'healthy',
          service: 'shared-ingress',
          timestamp: new Date().toISOString(),
        }), {
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request, env),
          },
        }),
        ctx,
      );
    }

    // ─── CORS Preflight ──────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request, env),
      });
    }

    // ─── Admin: rotate BACKEND_URL at runtime ────────────────────────
    // Done BEFORE rate limiting so a flood doesn't lock out the rotation hook.
    // BUT: applies its own stricter rate limit (10 req/min) to prevent
    // brute-force on the admin token.

    // R2-only fallback endpoint (when KV quota exceeded)
    // NOTE: no rate limit here intentionally — needed when KV is failing.
    // The primary endpoint has rate limiting to prevent brute force.
    if (url.pathname === '/admin/backend-url-fallback' && request.method === 'POST') {
      return await handleAdminBackendUrlFallback(request, env);
    }

    if (url.pathname === '/admin/backend-url' && request.method === 'POST') {
      const adminRateLimit = await checkRateLimit(env.BING_KV, 'admin:backend-url', 10);
      if (!adminRateLimit.allowed) {
        return new Response(JSON.stringify({
          error: 'Too many admin requests',
          retryAfter: adminRateLimit.retryAfter,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(adminRateLimit.retryAfter),
            ...getCorsHeaders(request, env),
          },
        });
      }
      return await handleAdminBackendUrl(request, env);
    }

    // ─── Rate Limiting (by IP) ────────────────────────────────────────
    const rateLimit = await checkIpRateLimit(env.BING_KV, request);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({
        error: 'Too many requests',
        retryAfter: rateLimit.retryAfter,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfter),
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + rateLimit.retryAfter),
          ...getCorsHeaders(request, env),
        },
      });
    }

    // ─── Authentication ──────────────────────────────────────────────
    const auth = await authenticateRequest(request, env.JWT_SECRET);
    // Pass auth info to backend via headers (even if unauthenticated)
    const proxiedRequest = addAuthHeaders(request, auth);

    // ─── File Storage (R2) — handled at edge ────────────────────────
    if (url.pathname.startsWith('/api/files/')) {
      return await handleFileRequest(request, env, url.pathname, auth.userId);
    }

    // ─── Route Request ───────────────────────────────────────────────
    const target = await routeRequest(request, env);
    if (!target) {
      return new Response(JSON.stringify({
        error: 'No route configured',
        detail: 'Neither BACKEND_URL nor FRONTEND_URL is configured for this path.',
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env),
        },
      });
    }

    // ─── Proxy to Target ─────────────────────────────────────────────
    try {
      const proxyHeaders = new Headers(proxiedRequest.headers);

      // Remove hop-by-hop headers
      for (const h of ['transfer-encoding', 'connection', 'keep-alive', 'upgrade']) {
        proxyHeaders.delete(h);
      }

      // Set forwarded headers
      proxyHeaders.set('X-Forwarded-For', request.headers.get('cf-connecting-ip') ?? url.hostname);
      proxyHeaders.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
      proxyHeaders.set('X-Forwarded-Host', url.hostname);

      // NOTE: no AbortSignal.timeout here on purpose.
      // The previous 25 s cap cut off long agent SSE streams. Cloudflare
      // Workers do NOT charge CPU time for time spent waiting on the
      // upstream `fetch` body, so streaming responses can run for the
      // full request lifetime (up to CF's hard 30 min cap on enterprise,
      // ~10 min on paid, ~5 min on free — all far beyond what we need).
      // ── 302 redirect for streaming chat endpoints ──────────────────────
      // Bypasses the Worker wall-clock cap (30s on Free plan) by handing
      // the streaming connection off to the backend. Worker still does
      // auth, rate limiting, and KV URL resolution. The client then
      // streams directly from the backend with a short-lived signed JWT.
      const isChatStreamPath = url.pathname.startsWith('/api/chat') ||
                                url.pathname.startsWith('/v1/chat/completions');
      if (isChatStreamPath) {
        // (1) CORS preflight
        if (request.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        // (2) Auth check
        const auth = await authenticateRequest(request, env);
        if (!auth.authenticated) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        // (3) Rate limit
        const ipLimit = await checkIpRateLimit(request, env);
        if (!ipLimit.allowed) {
          return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        // (4) Resolve backend URL (env wins, KV is fallback for tunnel URL updates)
        const backendUrl = (env.BACKEND_URL && env.BACKEND_URL.length > 0)
          ? env.BACKEND_URL
          : (await getBackendUrl(env));
        if (!backendUrl) {
          return new Response(JSON.stringify({ error: 'Backend URL not configured' }), {
            status: 503,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        // (5) Sign a 5-minute JWT for the redirect.
        // The `exp` claim MUST be Unix seconds (not milliseconds) per RFC 7519.
        // Setting it in ms produces a value ~1.7e12 that the backend's verifyJwt
        // (and any standard JWT consumer) would interpret as a date in the year 58494.
        // Use WORKER_JWT_SECRET, not the internal JWT_SECRET (which signs app/route
        // session tokens) — distinct secrets for defense-in-depth isolation.
        // A leak of either system does not compromise the other.
        // Use the cached signJwtCached instead of signJwt to amortize the
        // ~0.5ms crypto.subtle.importKey cost across requests in this isolate.
        const workerJwtSecret = env.WORKER_JWT_SECRET || 'fallback-dev-secret-change-me';
        const token = await signJwtCached(
          {
            sub: auth.userId || 'anonymous',
            exp: Math.floor(Date.now() / 1000) + 5 * 60,
            scope: 'chat:stream',
          },
          workerJwtSecret,
        );
        // (6) Return 302 redirect.
        // Cache-Control: private (only the client may cache, not shared proxies)
        // + max-age=4 (4-second freshness window).
        //
        // Cache-key analysis: HTTP cache key is method + request URL + Vary
        // headers. The token is in the RESPONSE (Location header), NOT the
        // request — so the cache key for the 302 is just the request URL +
        // Authorization header. Repeated requests within 4s serve the same
        // cached 302 with the same (still-valid, 5-min-lifetime) token.
        // Safe because the token is short-lived and `private` prevents any
        // intermediary from caching the redirect target.
        const qs = url.search ? url.search + '&' : '?';
        const location = `${backendUrl}${url.pathname}${qs}token=${encodeURIComponent(token)}`;
        return new Response(null, {
          status: 302,
          headers: {
            ...CORS_HEADERS,
            Location: location,
            'Cache-Control': 'private, max-age=4',
          },
        });
      }

      // ── Cache API wrap for VFS GET + sandbox GET (per-user, short TTL) ──
      // VFS polling spam and sandbox status checks are the two biggest
      // sources of repeated Worker invocations on the free tier. Caching
      // their GET responses for 1-2s at the per-user level dedupes
      // rapid-fire polling without serving stale data long enough to matter.
      //
      // The buildProxyResponse closure captures all the variables in scope
      // (request, env, proxiedRequest, target, url, rateLimit, doTrace,
      // proxyHeaders, traceRequest, writeTraceLog, getCorsHeaders) and runs
      // the existing fetch + response build logic on cache miss.
      const buildProxyResponse = async () => {
      const proxyResponse = await fetch(target.url, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? proxiedRequest.body : undefined,
        redirect: 'follow',
      });

      // ─── Build Response ────────────────────────────────────────────
      const responseHeaders = new Headers(proxyResponse.headers);

      // Apply CORS headers
      const cors = getCorsHeaders(request, env);
      for (const [key, value] of Object.entries(cors)) {
        responseHeaders.set(key, value);
      }

      // Add rate limit headers
      responseHeaders.set('X-RateLimit-Limit', '100');
      responseHeaders.set('X-RateLimit-Remaining', String(rateLimit.remaining));

      // Apply cache TTL if specified
      if (target.ttl && target.ttl > 0) {
        responseHeaders.set('Cache-Control', `public, max-age=${target.ttl}, s-maxage=${target.ttl}`);
      }

      const responseBody = proxyResponse.body;

      if (doTrace) {
        traceRequest(request.method, url.pathname, {
          upstreamStatus: proxyResponse.status,
          upstreamStatusText: proxyResponse.statusText,
          contentType: proxyResponse.headers.get('content-type') ?? '',
        });
      }

      return new Response(responseBody, {
        status: proxyResponse.status,
        statusText: proxyResponse.statusText,
        headers: responseHeaders,
      });
      }; // end buildProxyResponse closure

      // Cacheable GETs (VFS + sandbox) go through the Cache API. Non-cacheable
      // paths (writes, chat streams, admin) skip the cache and call directly.
      if (isVfsGetPath(url.pathname) || isSandboxGetPath(url.pathname)) {
        const cacheUserKey = auth.userId || `ip:${request.headers.get('cf-connecting-ip') ?? 'anon'}`;
        const cacheKey = `https://chat.internal/${cacheUserKey}${url.pathname}${url.search}`;
        const cacheTtl = isVfsGetPath(url.pathname) ? 1 : 2; // 1s for VFS, 2s for sandbox
        return await cacheGetOrSet(cacheKey, cacheTtl, buildProxyResponse, ctx);
      }
      return await buildProxyResponse();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (doTrace) {
        traceRequest(request.method, url.pathname, { error: message });
      }

      return new Response(JSON.stringify({
        error: 'Backend unavailable',
        detail: message,
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env),
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks on secrets.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Normalize a URL or origin to its canonical origin form (scheme://host[:port]).
 * Returns null if the input is not a valid URL/origin.
 */
function toOrigin(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    ...SECURITY_HEADERS,
    'Vary': 'Origin',
  };

  const originHeader = request.headers.get('Origin');
  const requestOrigin = toOrigin(originHeader);
  if (!requestOrigin) {
    // No Origin header (or malformed) → don't echo anything.
    return headers;
  }

  const allowedRaw = env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const wildcard = allowedRaw.includes('*');
  const allowedOrigins = new Set(
    allowedRaw
      .filter(s => s !== '*')
      .map(s => toOrigin(s))
      .filter((s): s is string => s !== null),
  );

  const frontendOrigin = toOrigin(env.FRONTEND_URL);
  if (frontendOrigin) allowedOrigins.add(frontendOrigin);

  if (wildcard || allowedOrigins.has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  // Otherwise: omit Access-Control-Allow-Origin entirely (browser will block).

  return headers;
}

function addAuthHeaders(request: Request, auth: { authenticated: boolean; userId: string | null }): Request {
  const headers = new Headers(request.headers);
  headers.set('X-User-Id', auth.userId ?? 'anonymous');
  headers.set('X-User-Authenticated', String(auth.authenticated));
  return new Request(request, { headers });
}

/**
 * POST /admin/backend-url — rotate the runtime BACKEND_URL stored in KV + R2.
 *
 * Auth: header `X-Admin-Token` must equal `env.ADMIN_TOKEN`.
 * Body: `{ "url": "https://..." }`
 *
 * On success: writes KV key `runtime:BACKEND_URL` and R2 object `config/backend-url.txt`.
 * Both writes are attempted; response indicates which succeeded.
 */
async function handleAdminBackendUrl(request: Request, env: Env): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env),
      },
    });

  if (!env.ADMIN_TOKEN) {
    return json(503, {
      error: 'Admin endpoint disabled',
      detail: 'ADMIN_TOKEN is not configured on this worker.',
    });
  }

  const provided = request.headers.get('X-Admin-Token');
  if (!provided) {
    return json(401, { error: 'Missing X-Admin-Token header' });
  }
  if (!constantTimeEqual(provided, env.ADMIN_TOKEN)) {
    return json(403, { error: 'Invalid admin token' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const candidate = (body as { url?: unknown })?.url;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return json(400, { error: 'Missing or invalid "url" field' });
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return json(400, { error: 'Invalid URL', detail: candidate });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(400, { error: 'URL must use http or https', detail: parsed.protocol });
  }

  const normalized = parsed.toString().replace(/\/+$/, '');
  const { kvSuccess, r2Success } = await setBackendUrl(env, normalized);

  return json(200, {
    ok: true,
    url: normalized,
    kvSuccess,
    r2Success,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * POST /admin/backend-url-fallback — R2-only fallback when KV quota is exceeded.
 *
 * Auth: header `X-Admin-Token` must equal `env.ADMIN_TOKEN`.
 * Body: `{ "url": "https://..." }`
 *
 * Only writes to R2 (not KV). Use when KV put quota is exceeded.
 */
async function handleAdminBackendUrlFallback(request: Request, env: Env): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request, env),
      },
    });

  if (!env.ADMIN_TOKEN) {
    return json(503, {
      error: 'Admin endpoint disabled',
      detail: 'ADMIN_TOKEN is not configured on this worker.',
    });
  }

  const provided = request.headers.get('X-Admin-Token');
  if (!provided) {
    return json(401, { error: 'Missing X-Admin-Token header' });
  }
  if (!constantTimeEqual(provided, env.ADMIN_TOKEN)) {
    return json(403, { error: 'Invalid admin token' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const candidate = (body as { url?: unknown })?.url;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return json(400, { error: 'Missing or invalid "url" field' });
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return json(400, { error: 'Invalid URL', detail: candidate });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json(400, { error: 'URL must use http or https', detail: parsed.protocol });
  }

  const normalized = parsed.toString().replace(/\/+$/, '');

  // Only write to R2 (skip KV)
  let r2Success = false;
  if (env.BING_STORAGE) {
    try {
      await env.BING_STORAGE.put('config/backend-url.txt', normalized, {
        httpMetadata: { contentType: 'text/plain' },
      });
      r2Success = true;
    } catch (err) {
      console.error('[url-store] R2 put failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return json(200, {
    ok: true,
    url: normalized,
    r2Success,
    kvSuccess: false,
    fallbackMode: true,
    updatedAt: new Date().toISOString(),
  });
}