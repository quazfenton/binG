/**
 * Request Router
 *
 * Routes incoming requests to the appropriate backend:
 * - /api/chat → OCI Backend (Node.js Hono server)
 * - /api/*    → OCI Backend (or Vercel fallback)
 * - /*        → Vercel Frontend (Next.js)
 *
 * Note: /health and /api/health are handled by index.ts before routing.
 */
import type { Env } from './env';

export interface RouteTarget {
  url: string;
  ttl?: number;  // cache TTL in seconds (0 = no cache)
}

export function routeRequest(request: Request, env: Env): RouteTarget | null {
  const url = new URL(request.url);
  const path = url.pathname;

  // Chat API → OCI backend (or fallback to Vercel if BACKEND_URL not set)
  if (path.startsWith('/api/chat')) {
    const backend = env.BACKEND_URL;
    if (backend) {
      const target = new URL(path, backend);
      target.search = url.search;
      return { url: target.toString() };
    }
    // Fallback: send to Vercel frontend which handles it natively
    return { url: `${env.FRONTEND_URL}${path}${url.search}`, ttl: 0 };
  }

  // All /api/* routes → OCI backend
  if (path.startsWith('/api/')) {
    const backend = env.BACKEND_URL;
    if (backend) {
      const target = new URL(path, backend);
      target.search = url.search;
      return { url: target.toString() };
    }
    return { url: `${env.FRONTEND_URL}${path}${url.search}`, ttl: 0 };
  }

  // Static assets → Vercel frontend (with caching)
  const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|webp|avif|json|xml)$/i;
  if (STATIC_EXTENSIONS.test(path)) {
    return { url: `${env.FRONTEND_URL}${path}${url.search}`, ttl: 31536000 }; // 1 year
  }

  // Everything else → Vercel frontend
  return { url: `${env.FRONTEND_URL}${path}${url.search}`, ttl: 0 };
}
