/**
 * Request Router
 *
 * Routes incoming requests to the appropriate backend:
 * - /api/chat       → OCI Backend (Node.js Hono server)
 * - /api/*          → OCI Backend (or Vercel fallback)
 * - /copa/*         → OCI Backend (CopaMundial via shared tunnel)
 * - /nocturne/*     → OCI Backend (Nocturne via shared tunnel)
 * - /novnc/*        → OCI Backend (noVNC via shared tunnel)
 * - /*              → Vercel Frontend (Next.js)
 *
 * BACKEND_URL resolution order (per-request):
 *   1. KV key `runtime:BACKEND_URL` — set via POST /admin/backend-url so the
 *      ARM box can broadcast tunnel URL changes without redeploying.
 *   2. `env.BACKEND_URL` — deploy-time default from wrangler.toml [vars].
 *
 * Note: /health and /api/health are handled by index.ts before routing.
 */
import type { Env } from './env';
import { getBackendUrl } from './url-store';

export interface RouteTarget {
  url: string;
  ttl?: number;  // cache TTL in seconds (0 = no cache)
}

/**
 * Strip trailing slashes from a URL string. Returns '' for falsy input.
 */
function stripTrailingSlash(u: string | undefined | null): string {
  if (!u) return '';
  return u.replace(/\/+$/, '');
}

/**
 * Validate that a string is a usable http(s) URL.
 */
function isValidHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}



/**
 * Build a target URL by concatenating a base (no trailing slash) with the
 * incoming path + search. This preserves any base-path prefix on the backend
 * (unlike `new URL(absolutePath, base)` which silently drops it).
 */
function joinUrl(base: string, path: string, search: string): string | null {
  if (!base) return null;
  if (!isValidHttpUrl(base)) return null;
  // Guard: if path already contains a query string, merge rather than append.
  const qIndex = path.indexOf('?');
  if (qIndex !== -1) {
    // path has its own query — combine with search params
    const basePath = `${stripTrailingSlash(base)}${path}`;
    if (!search) return basePath;
    return `${basePath}&${search.slice(1)}`;
  }
  return `${stripTrailingSlash(base)}${path}${search}`;
}

export async function routeRequest(request: Request, env: Env): Promise<RouteTarget | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const search = url.search;

  const backend = await getBackendUrl(env);
  const frontend = stripTrailingSlash(env.FRONTEND_URL);

  // Chat API → OCI backend (or fallback to Vercel if BACKEND_URL not set)
  if (path.startsWith('/api/chat')) {
    const target = joinUrl(backend, path, search);
    if (target) return { url: target };
    const fallback = joinUrl(frontend, path, search);
    return fallback ? { url: fallback, ttl: 0 } : null;
  }

  // All /api/* routes → OCI backend
  if (path.startsWith('/api/')) {
    const target = joinUrl(backend, path, search);
    if (target) return { url: target };
    const fallback = joinUrl(frontend, path, search);
    return fallback ? { url: fallback, ttl: 0 } : null;
  }

  // /copa/* → OCI backend (CopaMundial via shared tunnel)
  if (path === '/copa' || path.startsWith('/copa/')) {
    const target = joinUrl(backend, path, search);
    if (target) return { url: target };
    const fallback = joinUrl(frontend, path, search);
    return fallback ? { url: fallback, ttl: 0 } : null;
  }

  // /nocturne/* → OCI backend (Nocturne via shared tunnel)
  if (path === '/nocturne' || path.startsWith('/nocturne/')) {
    const target = joinUrl(backend, path, search);
    if (target) return { url: target };
    const fallback = joinUrl(frontend, path, search);
    return fallback ? { url: fallback, ttl: 0 } : null;
  }

  // /novnc/* → OCI backend (noVNC via shared tunnel)
  if (path === '/novnc' || path.startsWith('/novnc/')) {
    const target = joinUrl(backend, path, search);
    if (target) return { url: target };
    const fallback = joinUrl(frontend, path, search);
    return fallback ? { url: fallback, ttl: 0 } : null;
  }

  // Static assets → Vercel frontend (with caching)
  const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif|json|xml)$/i;
  if (STATIC_EXTENSIONS.test(path)) {
    const target = joinUrl(frontend, path, search);
    return target ? { url: target, ttl: 31536000 } : null; // 1 year
  }

  // Everything else → Vercel frontend
  const target = joinUrl(frontend, path, search);
  return target ? { url: target, ttl: 0 } : null;
}
