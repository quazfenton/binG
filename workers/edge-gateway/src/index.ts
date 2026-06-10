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

// Security headers applied to all responses
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Initialize trace logger (requires env — safe to call on every request;
    // subsequent calls return the cached instance)
    void getTraceLog(env);

    const url = new URL(request.url);
    const isHealthPath = url.pathname === '/health' || url.pathname === '/api/health' || url.pathname === '/copa/api/health' || url.pathname === '/nocturne/api/health';
    const doTrace = shouldTrace(url.pathname, isHealthPath);

    if (doTrace) {
      traceRequest(request.method, url.pathname, {
        cfCountry: request.headers.get('cf-ipcountry') ?? '??',
        userAgent: request.headers.get('user-agent') ?? '',
      });
    }

    // ─── Health Check ────────────────────────────────────────────────
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'shared-ingress',
        timestamp: new Date().toISOString(),
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(request, env),
        },
      });
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
        // (5) Sign a 5-minute JWT for the redirect
        const jwtSecret = env.JWT_SECRET || 'fallback-dev-secret-change-me';
        const token = await signJwt(
          { sub: auth.userId || 'anonymous', exp: Date.now() + 5 * 60 * 1000, scope: 'chat:stream' },
          jwtSecret,
        );
        // (6) Return 302 redirect
        const qs = url.search ? url.search + '&' : '?';
        const location = `${backendUrl}${url.pathname}${qs}token=${encodeURIComponent(token)}`;
        return new Response(null, {
          status: 302,
          headers: { ...CORS_HEADERS, Location: location },
        });
      }

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