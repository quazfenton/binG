/**
 * Tests for the next-step suggestions API route.
 *
 * Covers:
 *  - 400 on missing/invalid body
 *  - 413 on oversized body
 *  - 429 when the rate limit is exceeded
 *  - 200 with extracted suggestions on success
 *  - lastResponse is truncated to MAX_RESPONSE_CHARS
 *  - recentPrompts is filtered, sliced, and capped
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse {
    body: any;
    status: number;
    headers: Headers;
    constructor(body: any, init: { status?: number; headers?: HeadersInit } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.headers = new Headers(init.headers ?? {});
    }
    static json(body: any, init: { status?: number; headers?: HeadersInit } = {}) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextRequest: class {}, NextResponse: MockNextResponse };
});

vi.mock('@/lib/chat/next-step-suggestions', () => ({
  generateNextStepSuggestions: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { POST } from '../next-step-suggestions/route';
import { generateNextStepSuggestions } from '@/lib/chat/next-step-suggestions';

const mockedGen = generateNextStepSuggestions as unknown as ReturnType<typeof vi.fn>;

function makeReq(body: any, opts: { contentLength?: number } = {}): any {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.contentLength !== undefined) {
    headers['content-length'] = String(opts.contentLength);
  }
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => JSON.parse(json),
    text: async () => json,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/chat/next-step-suggestions', () => {
  it('returns 400 on invalid JSON', async () => {
    const req: any = {
      headers: { get: () => null },
      json: async () => {
        throw new Error('bad');
      },
      text: async () => 'not-json',
    };
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when lastResponse is missing', async () => {
    const res = await POST(makeReq({ recentPrompts: ['hi'] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lastResponse/);
  });

  it('returns 413 when content-length exceeds the body cap', async () => {
    const res = await POST(
      makeReq({ lastResponse: 'x' }, { contentLength: 200_000 }),
    );
    expect(res.status).toBe(413);
  });

  it('returns 200 with suggestions on success', async () => {
    mockedGen.mockResolvedValue([
      { label: 'A', fullText: 'a-text' },
      { label: 'B', fullText: 'b-text' },
    ]);
    const res = await POST(
      makeReq({ lastResponse: 'done.', messageId: 'msg-1' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.suggestions).toHaveLength(2);
    expect(res.body.data.messageId).toBe('msg-1');
  });

  it('caps lastResponse to MAX_RESPONSE_CHARS (8000)', async () => {
    mockedGen.mockResolvedValue([]);
    const huge = 'x'.repeat(20_000);
    await POST(makeReq({ lastResponse: huge }));
    const passed = mockedGen.mock.calls[0][1] as string;
    expect(passed.length).toBeLessThanOrEqual(8_000);
  });

  it('filters and caps recentPrompts', async () => {
    mockedGen.mockResolvedValue([]);
    const prompts = [
      '',
      '   ',
      'good prompt 1',
      'x'.repeat(5_000),
      'good prompt 2',
    ];
    await POST(makeReq({ lastResponse: 'x', recentPrompts: prompts }));
    const passed = mockedGen.mock.calls[0][0] as string[];
    // Only the last 2 prompts survive the slice (after filtering empties).
    expect(passed).toHaveLength(2);
    // The cap (2000) applies BEFORE the slice, so the second prompt is
    // 2000 chars of "x" (the 5000-char string was truncated).
    expect(passed[0].length).toBeLessThanOrEqual(2_000);
    expect(passed[1]).toBe('good prompt 2');
  });

  it('returns 500 when the underlying call throws (with safe error message)', async () => {
    mockedGen.mockRejectedValue(new Error('provider exploded'));
    const res = await POST(makeReq({ lastResponse: 'x' }));
    expect(res.status).toBe(500);
    // The raw error message must NOT leak to the client.
    expect(res.body.error).not.toMatch(/provider exploded/);
    expect(res.body.error).toMatch(/Failed to generate/);
  });

  it('returns 429 after RATE_LIMIT_MAX_REQUESTS hits', async () => {
    // The rate-limit bucket is module-level and per-IP. Use a fresh
    // x-forwarded-for IP so we start with a full quota, then burst
    // the same key to trigger 429.
    mockedGen.mockResolvedValue([]);
    const req = () => ({
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'x-forwarded-for') return '9.9.9.9';
          if (name.toLowerCase() === 'content-type') return 'application/json';
          if (name.toLowerCase() === 'content-length') return '13';
          return null;
        },
      },
      text: async () => JSON.stringify({ lastResponse: 'x' }),
    });
    // Burst the limit (20/min per IP).
    for (let i = 0; i < 20; i++) {
      const r = await POST(req());
      expect(r.status).toBe(200);
    }
    const r = await POST(req());
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('60');
  });

  it('forwards messageId (when valid) and clamps to 128 chars', async () => {
    mockedGen.mockResolvedValue([]);
    // The SUT uses messageId to construct a requestId for telemetry.
    // First call: valid id.
    await POST(makeReq({ lastResponse: 'x', messageId: 'msg-1' }));
    const call1 = mockedGen.mock.calls[0];
    expect(call1[2]).toBe('nextstep-msg-1');

    // Over-long id is rejected — we drop it on the server side rather
    // than passing 500+ chars of id-derived requestId to the LLM.
    const longId = 'a'.repeat(500);
    await POST(makeReq({ lastResponse: 'x', messageId: longId }));
    const call2 = mockedGen.mock.calls[1];
    // requestId is undefined; the underlying service generates its own.
    expect(call2[2]).toBeUndefined();
  });
});
