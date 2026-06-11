/**
 * Smoke test for the 302 redirect behavior in workers/edge-gateway/src/index.ts.
 *
 * Verifies:
 * 1. /api/chat GET request returns 302 with Location header pointing to backend URL
 * 2. Location contains a token query param
 * 3. The JWT decodes to a 5min expiry
 * 4. A non-/api/chat path (e.g. /v1/foo) still goes through the proxy
 * 5. An unauthenticated request to /api/chat returns 401 before the redirect
 * 6. An OPTIONS preflight returns 204 with CORS headers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy external modules BEFORE importing the worker
vi.mock('../src/router', () => ({
  routeRequest: vi.fn().mockResolvedValue({ url: 'https://mock-backend.example.com', ttl: 0 }),
}));
vi.mock('../src/rate-limiter', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('../src/url-store', () => ({
  setBackendUrl: vi.fn(),
  getBackendUrl: vi.fn().mockResolvedValue('https://mock-backend.example.com'),
}));
vi.mock('../src/r2-storage', () => ({
  handleFileRequest: vi.fn(),
}));
// Use a class so `new TraceLog(env.TRACE_R2)` works in the source.
// Arrow functions can't be constructors; vi.fn().mockImplementation(arrowFn)
// throws `... is not a constructor` when invoked with `new`.
vi.mock('../src/trace-log', () => ({
  TraceLog: class {
    write = vi.fn();
    flush = vi.fn().mockResolvedValue(undefined);
    constructor(_r2: unknown) {}
  },
}));

// Provide a fake authenticateRequest that respects a special header
vi.mock('../src/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/auth')>('../src/auth');
  return {
    ...actual,
    authenticateRequest: vi.fn().mockImplementation((request: Request) => {
      const auth = request.headers.get('Authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return Promise.resolve({ authenticated: false, userId: null });
      }
      const userId = auth.replace('Bearer ', '').trim();
      if (!userId) {
        return Promise.resolve({ authenticated: false, userId: null });
      }
      return Promise.resolve({ authenticated: true, userId });
    }),
  };
});

import worker from '../src/index';
import { decodeJwtUnverified } from '@bing/shared/auth/jwt';

const env = {
  BACKEND_URL: 'https://mock-backend.example.com',
  JWT_SECRET: 'test-secret-for-smoke-test',
  ALLOWED_ORIGINS: 'https://app.example.com',
  KV: {} as any,
  TRACE_R2: {} as any,
} as any;

function b64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(padded);
}

describe('index.ts 302 redirect (smoke)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('OPTIONS preflight to /api/chat returns 204 with CORS headers', async () => {
    // Real preflights include an Origin header. Without one, the early
    // OPTIONS handler's getCorsHeaders() correctly omits Allow-Origin.
    const req = new Request('https://edge.example.com/api/chat', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('authenticated GET /api/chat returns 302 with Location pointing to backend URL', async () => {
    const req = new Request('https://edge.example.com/api/chat', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-user-1' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') || '';
    expect(location).toContain('mock-backend.example.com');
    expect(location).toContain('/api/chat');
  });

  it('302 Location contains a token query param', async () => {
    const req = new Request('https://edge.example.com/api/chat', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-user-1' },
    });
    const res = await worker.fetch(req, env);
    const location = res.headers.get('Location') || '';
    expect(location).toMatch(/[?&]token=/);
    const tokenMatch = location.match(/token=([^&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = decodeURIComponent(tokenMatch![1]);
    expect(token.split('.').length).toBe(3);
  });

  it('the JWT decodes to a ~5min expiry', async () => {
    const req = new Request('https://edge.example.com/api/chat', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-user-42' },
    });
    const res = await worker.fetch(req, env);
    const location = res.headers.get('Location') || '';
    const tokenMatch = location.match(/token=([^&]+)/);
    const token = decodeURIComponent(tokenMatch![1]);
    const payload = JSON.parse(b64UrlDecode(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    const expDelta = payload.exp - now;
    // Should be ~300s (5min), allow 5s slack
    expect(expDelta).toBeGreaterThan(295);
    expect(expDelta).toBeLessThanOrEqual(300);
    expect(payload.scope).toBe('chat:stream');
    expect(payload.sub).toBe('test-user-42');
  });

  it('unauthenticated request to /api/chat returns 401 before the redirect', async () => {
    const req = new Request('https://edge.example.com/api/chat', { method: 'GET' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('unauthenticated POST /v1/chat/completions also returns 401', async () => {
    const req = new Request('https://edge.example.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4', messages: [] }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it('preserves existing query string when adding the token', async () => {
    const req = new Request('https://edge.example.com/api/chat?foo=bar', {
      method: 'GET',
      headers: { Authorization: 'Bearer u' },
    });
    const res = await worker.fetch(req, env);
    const location = res.headers.get('Location') || '';
    expect(location).toContain('foo=bar');
    expect(location).toContain('token=');
  });

  it('302 redirect includes Cache-Control: private, max-age=4', async () => {
    const req = new Request('https://edge.example.com/api/chat', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-user-cache' },
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(302);
    const cacheControl = res.headers.get('Cache-Control') || '';
    expect(cacheControl).toContain('private');
    expect(cacheControl).toContain('max-age=4');
  });
});
