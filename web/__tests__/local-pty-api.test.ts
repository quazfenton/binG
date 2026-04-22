/**
 * Unit tests for local PTY API routes (route.ts, input/route.ts, resize/route.ts)
 *
 * Tests security gates, session creation, auth, validation, SSE streaming,
 * and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ============================================================
// Mock dependencies BEFORE importing the route
// ============================================================

// Mock resolveRequestAuth
vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn().mockResolvedValue({
    success: true,
    userId: 'user-123',
    source: 'jwt',
  }),
}));

// Mock VFS workspace materializer — avoids real filesystem and DB access
vi.mock('@/lib/virtual-filesystem/vfs-workspace-materializer', () => ({
  materializeWorkspace: vi.fn().mockResolvedValue('/tmp/test-workspace'),
  watchWorkspaceForChanges: vi.fn().mockReturnValue({ stop: vi.fn() }),
  syncFileToVfs: vi.fn().mockResolvedValue(undefined),
}));

// Mock database — avoids real SQLite dependency
vi.mock('@/lib/database/connection', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
    }),
  }),
}));

// Mock node-pty
const mockPtyOnData = vi.fn();
const mockPtyOnExit = vi.fn();
const mockPtyKill = vi.fn();
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();

const mockSpawn = vi.fn().mockReturnValue({
  onData: mockPtyOnData,
  onExit: mockPtyOnExit,
  kill: mockPtyKill,
  write: mockPtyWrite,
  resize: mockPtyResize,
  pid: 12345,
});

vi.mock('node-pty', () => ({
  spawn: mockSpawn,
}));

// We need to access the global sessions map for assertions
// Set it up before the route module loads
declare global {
  var __localPtySessions: Map<string, any> | undefined;
}

// Clear sessions before each test
beforeEach(() => {
  if (globalThis.__localPtySessions) {
    globalThis.__localPtySessions.clear();
  } else {
    globalThis.__localPtySessions = new Map();
  }
  vi.clearAllMocks();
  // NOTE: Do NOT use vi.resetModules() here — the route module registers
  // module-level setInterval and process.on listeners. Resetting would
  // leak handles and destabilize the test suite.
});

// ============================================================
// POST handler tests
// ============================================================

describe('POST /api/terminal/local-pty', () => {
  it('returns 503 when ENABLE_LOCAL_PTY is off', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'off');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('disabled');
    expect(body.mode).toBe('sandbox');

    vi.unstubAllEnvs();
  });

  it('returns 503 when not localhost in localhost mode', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'localhost');

    const { POST } = await import('@/app/api/terminal/local-pty/route');    const req = new NextRequest('http://example.com/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
      host: 'example.com',
      },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('localhost');

    vi.unstubAllEnvs();
  });

  it('allows localhost requests in localhost mode', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'localhost');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost:3000/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });

    const res = await POST(req);
    // Should NOT be rejected for localhost check (503).
    // May succeed (200) if dependencies are available, or fail later (4xx/5xx).
    expect(res.status).not.toBe(503);

    vi.unstubAllEnvs();
  });

  it('returns 400 for invalid dimensions', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 0, rows: 0 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid dimensions');

    vi.unstubAllEnvs();
  });

  it('returns checkOnly result', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkOnly: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.mode).toBe('on');

    vi.unstubAllEnvs();
  });

  it('creates a PTY session in direct mode', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeDefined();
    expect(body.mode).toBe('direct');
    expect(mockSpawn).toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('enforces session limit per user', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');

    const { POST } = await import('@/app/api/terminal/local-pty/route');

    // Create 5 sessions (MAX_SESSIONS_PER_USER)
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest('http://localhost/api/terminal/local-pty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      });
      await POST(req);
    }

    // 6th should fail
    const req = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Too many PTY sessions');

    vi.unstubAllEnvs();
  });
});

// ============================================================
// GET handler tests
// ============================================================

describe('GET /api/terminal/local-pty', () => {
  it('returns 400 without sessionId', async () => {
    const { GET } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty');

    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('sessionId is required');
  });

  it('returns 404 for unknown session', async () => {
    const { GET } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty?sessionId=unknown');

    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns SSE stream for valid session', async () => {
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');

    // First create a session
    const { POST } = await import('@/app/api/terminal/local-pty/route');    const postReq = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });

    const postRes = await POST(postReq);
    const { sessionId } = await postRes.json();

    // Now GET the SSE stream
    const { GET } = await import('@/app/api/terminal/local-pty/route');
    const req = new NextRequest(`http://localhost/api/terminal/local-pty?sessionId=${sessionId}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');

    vi.unstubAllEnvs();
  });
});

// ============================================================
// Input route tests
// ============================================================

describe('POST /api/terminal/local-pty/input', () => {
  it('returns 415 for non-JSON Content-Type', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/input/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/input', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });

    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain('Content-Type');
  });

  it('returns 400 for missing sessionId', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/input/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing data', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/input/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/input/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'unknown', data: 'test' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 413 for oversized input', async () => {
    // First create a session
    vi.stubEnv('ENABLE_LOCAL_PTY', 'on');
    vi.stubEnv('NODE_ENV', 'development');
    const { POST: createPost } = await import('@/app/api/terminal/local-pty/route');
    const createReq = new NextRequest('http://localhost/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    const createRes = await createPost(createReq);
    const { sessionId } = await createRes.json();

    // Now try to write too much data
    const { POST: inputPost } = await import('@/app/api/terminal/local-pty/input/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        data: 'x'.repeat(17000), // > 16KB
      }),
    });

    const res = await inputPost(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain('too large');

    vi.unstubAllEnvs();
  });
});

// ============================================================
// Resize route tests
// ============================================================

describe('POST /api/terminal/local-pty/resize', () => {
  it('returns 415 for non-JSON Content-Type', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/resize/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/resize', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'test',
    });

    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('returns 400 for missing cols', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/resize/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/resize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test', rows: 24 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for out-of-range dimensions', async () => {
    const { POST } = await import('@/app/api/terminal/local-pty/resize/route');
    const req = new NextRequest('http://localhost/api/terminal/local-pty/resize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'test', cols: 999, rows: 24 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
