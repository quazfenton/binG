/**
 * Bug #119 (Pass-8 audit) regression tests — defensive JSON.parse hardening.
 *
 * The audit noted: "Plain-text fallback can still return invalid JSON; currently
 * if a provider returns malformed JSON, the orchestrator logs and propagates. No
 * defensive `try/catch`." This test locks the contract for the helper that
 * replaces the silent `try { return JSON.parse(raw); } catch { return {}; }`
 * pattern at 4 sites in `bing/web/lib/chat/vercel-ai-streaming.ts`.
 *
 * Locks down:
 *   1. Malformed JSON fixture: returns `{}`, increments metric via `recordInvalidJsonFallback`.
 *   2. Valid JSON object: returns object verbatim, does NOT bump metric.
 *   3. Valid JSON array: returns `{}`, bumps metric with `.non-object` suffix.
 *   4. Valid JSON null: returns `{}`, bumps metric with `.non-object` suffix.
 *   5. Valid JSON string primitive: returns `{}`, bumps metric with `.non-object` suffix.
 *   6. `recordInvalidJsonFallback` directly: counter increments, bySource populated,
 *      lastAt updated. Multiple calls with same source accumulate per-source count.
 *   7. Multiple distinct sources: bySource buckets are independent.
 *   8. Empty string fixture: returns {} and bumps metric (edge-input guard).
 *   9. Same raw via different sources: each source keeps independent count.
 *
 * NOT covered by this test (deliberately deferred):
 *   - plan-act-verify.ts `_invalidJsonFallback` helper: that path lives in the
 *     shared package (`bing/packages/shared/agent/orchestration/`); the
 *     function is module-local (not exported), and the only way to trigger
 *     it is via a live `generateText` call, which requires mocking the AI
 *     SDK. The vitest harness targets `bing/web/__tests__/`; cross-package
 *     vitest with AI SDK mocking is non-trivial. The helper is unit-tested
 *     via its log marker (grep `'[INVALID-JSON-FALLBACK]'`) and the metric
 *     is surfaced via the vercel-ai-streaming.ts sister path.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  tryParseToolArgs,
} from '@/lib/chat/vercel-ai-streaming';
import {
  recordInvalidJsonFallback,
} from '@/lib/chat/chat-metrics';

interface InvalidJsonFallbacks {
  count: number;
  bySource: Record<string, number>;
  lastAt: number | null;
}

interface ChatMetricsHandle {
  invalidJsonFallbacks: InvalidJsonFallbacks;
}

function resetMetrics(): void {
  const g = globalThis as unknown as { __chatMetrics__?: { invalidJsonFallbacks?: InvalidJsonFallbacks } };
  if (!g.__chatMetrics__) {
    g.__chatMetrics__ = {
      invalidJsonFallbacks: { count: 0, bySource: {}, lastAt: null },
    };
  } else if (!g.__chatMetrics__.invalidJsonFallbacks) {
    g.__chatMetrics__.invalidJsonFallbacks = { count: 0, bySource: {}, lastAt: null };
  } else {
    g.__chatMetrics__.invalidJsonFallbacks.count = 0;
    g.__chatMetrics__.invalidJsonFallbacks.bySource = {};
    g.__chatMetrics__.invalidJsonFallbacks.lastAt = null;
  }
}

function readMetrics(): InvalidJsonFallbacks {
  const g = globalThis as unknown as { __chatMetrics__?: ChatMetricsHandle };
  if (!g.__chatMetrics__ || !g.__chatMetrics__.invalidJsonFallbacks) {
    throw new Error('chatMetrics singleton was not initialized');
  }
  return g.__chatMetrics__.invalidJsonFallbacks;
}

describe('Bug #119: defensive JSON.parse', () => {
  beforeEach(resetMetrics);

  it('tryParseToolArgs returns {} when the input is malformed JSON', () => {
    const result = tryParseToolArgs(
      '{ unterminated: "object, missing }',
      'vercel-ai-streaming.tool-call-input',
    );
    expect(result).toEqual({});
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['vercel-ai-streaming.tool-call-input']).toBe(1);
  });

  it('tryParseToolArgs returns the parsed object when the input is valid JSON', () => {
    const result = tryParseToolArgs(
      '{"path":"/tmp/foo","content":"hello"}',
      'vercel-ai-streaming.tool-result-input',
    );
    expect(result).toEqual({ path: '/tmp/foo', content: 'hello' });
    const m = readMetrics();
    expect(m.count).toBe(0);
    expect(m.bySource['vercel-ai-streaming.tool-result-input'] ?? 0).toBe(0);
  });

  it('tryParseToolArgs coerces a JSON array to {} and bumps the .non-object metric', () => {
    const result = tryParseToolArgs(
      '[1, 2, 3]',
      'vercel-ai-streaming.fallback-chain-args',
    );
    expect(result).toEqual({});
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['vercel-ai-streaming.fallback-chain-args.non-object']).toBe(1);
  });

  it('tryParseToolArgs coerces a JSON null to {} and bumps the .non-object metric', () => {
    const result = tryParseToolArgs('null', 'vercel-ai-streaming.fallback-chain-result');
    expect(result).toEqual({});
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['vercel-ai-streaming.fallback-chain-result.non-object']).toBe(1);
  });

  it('tryParseToolArgs coerces a JSON string primitive to {} and bumps the .non-object metric', () => {
    const result = tryParseToolArgs('"some string"', 'vercel-ai-streaming.tool-call-input');
    expect(result).toEqual({});
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['vercel-ai-streaming.tool-call-input.non-object']).toBe(1);
  });

  it('recordInvalidJsonFallback increments counter, populates bySource, sets lastAt', () => {
    const before = Date.now();
    recordInvalidJsonFallback('test.source.alpha');
    const after = Date.now();
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['test.source.alpha']).toBe(1);
    expect(m.lastAt).toBeGreaterThanOrEqual(before);
    expect(m.lastAt).toBeLessThanOrEqual(after + 5);
  });

  it('recordInvalidJsonFallback accumulates when called multiple times with the same source', () => {
    recordInvalidJsonFallback('test.source.beta');
    recordInvalidJsonFallback('test.source.beta');
    recordInvalidJsonFallback('test.source.beta');
    const m = readMetrics();
    expect(m.count).toBe(3);
    expect(m.bySource['test.source.beta']).toBe(3);
  });

  it('recordInvalidJsonFallback keeps bySource buckets independent across distinct sources', () => {
    recordInvalidJsonFallback('test.source.alpha');
    recordInvalidJsonFallback('test.source.alpha');
    recordInvalidJsonFallback('test.source.gamma');
    const m = readMetrics();
    expect(m.count).toBe(3);
    expect(m.bySource['test.source.alpha']).toBe(2);
    expect(m.bySource['test.source.gamma']).toBe(1);
  });

  it('tryParseToolArgs source-key routing: same raw passed via different sources bumps each independently', () => {
    const malformed = '{ bad json: }';
    tryParseToolArgs(malformed, 'source.x');
    tryParseToolArgs(malformed, 'source.y');
    tryParseToolArgs(malformed, 'source.x');
    const m = readMetrics();
    expect(m.count).toBe(3);
    expect(m.bySource['source.x']).toBe(2);
    expect(m.bySource['source.y']).toBe(1);
  });

  it('empty string input returns {} and bumps metric (proves guards against edge input)', () => {
    const result = tryParseToolArgs('', 'vercel-ai-streaming.tool-call-input');
    expect(result).toEqual({});
    const m = readMetrics();
    expect(m.count).toBe(1);
    expect(m.bySource['vercel-ai-streaming.tool-call-input']).toBe(1);
  });
});
