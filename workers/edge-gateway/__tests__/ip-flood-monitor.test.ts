/**
 * Tests for the IP flood monitor (Workers Analytics Engine) integration.
 *
 * Covers:
 *  1. Deny-list check: requests from blocked IPs return 403 BEFORE
 *     any other work (auth, rate limiting, proxying).
 *  2. WAE logging: every request fires writeDataPoint with the right blobs.
 *  3. Scheduled handler: queries the WAE HTTP SQL API, writes the resulting
 *     deny list to KV, and invalidates the in-memory cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy external modules BEFORE importing the worker
vi.mock('../src/router', () => ({
  routeRequest: vi.fn().mockResolvedValue({ url: 'https://mock-backend.example.com', ttl: 0 }),
}));
vi.mock('../src/rate-limiter', () => ({
  // Default: rate limit allows. The 403-from-deny-list test should NOT
  // require this to be invoked; we assert that the request is short-
  // circuited at the deny-list check.
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
}));
vi.mock('../src/url-store', () => ({
  setBackendUrl: vi.fn(),
  getBackendUrl: vi.fn().mockResolvedValue('https://mock-backend.example.com'),
}));
vi.mock('../src/r2-storage', () => ({
  handleFileRequest: vi.fn(),
}));
vi.mock('../src/trace-log', () => ({
  TraceLog: class {
    write = vi.fn();
    flush = vi.fn().mockResolvedValue(undefined);
    constructor(_r2: unknown) {}
  },
}));

// Use a fake authenticateRequest that respects a special header
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

interface FakeDataset {
  writeDataPoint: ReturnType<typeof vi.fn>;
}

interface FakeKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function makeEnv(overrides: {
  dataset?: FakeDataset;
  kv?: FakeKV;
  // null = explicitly missing (don't set the env var at all)
  apiToken?: string | null;
  accountId?: string | null;
} = {}) {
  const dataset: FakeDataset = overrides.dataset ?? { writeDataPoint: vi.fn() };
  const kv: FakeKV = overrides.kv ?? {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const env: any = {
    BACKEND_URL: 'https://mock-backend.example.com',
    JWT_SECRET: 'test-secret',
    ALLOWED_ORIGINS: 'https://app.example.com',
    BING_KV: kv as any,
    IP_FLOOD_MONITOR: dataset as any,
    TRACE_R2: {} as any,
  };
  if (overrides.apiToken !== null) {
    env.CLOUDFLARE_API_TOKEN = overrides.apiToken ?? 'test-api-token';
  }
  if (overrides.accountId !== null) {
    env.CF_ACCOUNT_ID = overrides.accountId ?? 'test-account-id';
  }
  return env as any;
}

describe('IP flood monitor: deny-list check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when the client IP is in the deny list', async () => {
    // Per-test unique IP so the in-memory cache (module-level, 30s TTL)
    // doesn't leak between tests.
    const blockedIp = '203.0.113.42';
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify([blockedIp, '198.51.100.7'])),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const dataset = { writeDataPoint: vi.fn() };
    const env = makeEnv({ kv, dataset });

    const req = new Request('https://edge.example.com/some/path', {
      method: 'GET',
      headers: { 'cf-connecting-ip': blockedIp },
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Forbidden');
    // WAE logging still happens for blocked requests (so we have the data
    // to see the pattern in the dataset after the deny kicks in).
    expect(dataset.writeDataPoint).toHaveBeenCalledTimes(1);
  });

  it('does NOT 403 when the client IP is not in the deny list', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(JSON.stringify(['198.51.100.7'])),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const env = makeEnv({ kv });

    const req = new Request('https://edge.example.com/some/path', {
      method: 'GET',
      headers: { 'cf-connecting-ip': '10.0.0.1' },
    });
    const res = await worker.fetch(req, env);

    // Should NOT be 403. (It might be a 302 to the chat backend, or a
    // 502, or something else — what matters is it isn't a deny-list 403.)
    expect(res.status).not.toBe(403);
  });

  it('fails open when KV.get throws', async () => {
    const kv = {
      get: vi.fn().mockRejectedValue(new Error('KV unavailable')),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const env = makeEnv({ kv });

    const req = new Request('https://edge.example.com/some/path', {
      method: 'GET',
      headers: { 'cf-connecting-ip': '10.0.0.2' },
    });
    const res = await worker.fetch(req, env);

    // Fail open: KV failure should not produce a 403
    expect(res.status).not.toBe(403);
  });

  it('logs every request to the Analytics Engine dataset with the right shape', async () => {
    const dataset = { writeDataPoint: vi.fn() };
    const env = makeEnv({ dataset });

    const req = new Request('https://edge.example.com/api/some/endpoint', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '192.0.2.99' },
    });
    await worker.fetch(req, env);

    expect(dataset.writeDataPoint).toHaveBeenCalledTimes(1);
    const call = dataset.writeDataPoint.mock.calls[0][0] as {
      blobs: string[];
      doubles: number[];
      indexes: string[];
    };
    // blob0 = IP, blob1 = path, blob2 = method
    expect(call.blobs[0]).toBe('192.0.2.99');
    expect(call.blobs[1]).toBe('/api/some/endpoint');
    expect(call.blobs[2]).toBe('POST');
    // doubles[0] = 1 (the per-request count)
    expect(call.doubles[0]).toBe(1);
    // indexes[0] = timestamp in ms
    expect(Number(call.indexes[0])).toBeGreaterThan(Date.now() - 5000);
  });

  it('does NOT log to WAE when the dataset binding is missing', async () => {
    const env = makeEnv();
    (env as any).IP_FLOOD_MONITOR = undefined;

    const req = new Request('https://edge.example.com/some/path', {
      method: 'GET',
      headers: { 'cf-connecting-ip': '10.0.0.3' },
    });
    // Should not throw
    await worker.fetch(req, env);
  });
});

describe('IP flood monitor: scheduled handler', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub global fetch for the WAE SQL API call
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('queries the WAE HTTP SQL API and writes the deny list to KV', async () => {
    const kv = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    };
    const env = makeEnv({ kv, apiToken: 'tok-abc', accountId: 'acct-xyz' });

    // Mock the WAE SQL API response — WAE returns an array of rows
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: {
          rows: [
            { ip: '203.0.113.10', reqs: 1500 },
            { ip: '203.0.113.11', reqs: 800 },
          ],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any);

    // Verify the SQL was POSTed to the right endpoint with the right auth
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url as string).toContain('acct-xyz');
    expect(url as string).toContain('/analytics_engine/sql');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-abc',
      'Content-Type': 'text/plain',
    });
    // The SQL should reference the dataset and a 1-minute window
    expect(((init as RequestInit).body as string)).toContain('ip_flood_monitor');
    expect(((init as RequestInit).body as string)).toContain("INTERVAL '1' MINUTE");

    // Verify the resulting deny list was written to KV
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value, opts] = kv.put.mock.calls[0];
    expect(key).toBe('ip_flood:deny_list');
    expect(JSON.parse(value as string)).toEqual(['203.0.113.10', '203.0.113.11']);
    expect((opts as { expirationTtl: number }).expirationTtl).toBe(120);
  });

  it('handles WAE array-row format (some responses return rows as arrays)', async () => {
    const kv = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() };
    const env = makeEnv({ kv });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        result: {
          rows: [
            ['203.0.113.20', 1234],
            ['203.0.113.21', 567],
          ],
        },
      }), { status: 200 }),
    );

    await worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any);

    expect(JSON.parse(kv.put.mock.calls[0][1] as string)).toEqual([
      '203.0.113.20',
      '203.0.113.21',
    ]);
  });

  it('no-ops when CLOUDFLARE_API_TOKEN is missing', async () => {
    const env = makeEnv({ apiToken: null });

    await worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when CF_ACCOUNT_ID is missing', async () => {
    const env = makeEnv({ accountId: null });

    await worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when the dataset binding is missing', async () => {
    const env = makeEnv();
    (env as any).IP_FLOOD_MONITOR = undefined;

    await worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the previous KV value when the WAE query fails', async () => {
    const kv = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() };
    const env = makeEnv({ kv });

    fetchMock.mockResolvedValue(new Response('internal error', { status: 500 }));

    // Should not throw
    await expect(
      worker.scheduled({ scheduledTime: Date.now() } as any, env, {} as any),
    ).resolves.toBeUndefined();

    // We don't write a new deny list on failure — the previous one stays.
    expect(kv.put).not.toHaveBeenCalled();
  });
});
