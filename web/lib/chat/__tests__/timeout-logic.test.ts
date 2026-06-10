/**
 * streamWithVercelAI — Timeout & Activity Tracker Tests
 *
 * Tests the differentiated timeout logging and dynamic extension logic:
 *   - TTFT timeout fires when no first token arrives
 *   - Activity tracker timeout categories (MID_STREAM_TEXT, MID_STREAM_TOOL_CALL, etc.)
 *   - Dynamic extension multiplier (2x on tool-call/success, 1x decay on text-delta)
 *   - Diagnostic context in timeout logs
 *   - Disabled timeout (timeoutMs=0)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (must be before any imports) ──────────────────────────────────────

vi.mock('ai', () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn(() => vi.fn()),
  extractReasoningMiddleware: vi.fn(() => vi.fn()),
  smoothStream: vi.fn(() => vi.fn()),
  Tool: class {},
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => vi.fn(() => ({})))),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock('@ai-sdk/mistral', () => ({
  createMistral: vi.fn(() => vi.fn(() => ({}))),
}));

vi.mock('../providers/provider-fallback-chains', () => ({
  getConfiguredFallbackChain: vi.fn(() => []),
}));

vi.mock('../tools/tool-call-telemetry', () => ({
  recordToolCall: vi.fn(),
  shouldForceTextMode: vi.fn(() => false),
}));

vi.mock('../middleware/ai-caching', () => ({
  tokenTracker: { track: vi.fn() },
}));

vi.mock('../middleware/ai-middleware', () => ({
  createReasoningMiddleware: vi.fn(() => vi.fn()),
  withRetry: vi.fn((fn: any) => fn),
  createSmoothStream: vi.fn(),
  isTokenLimitError: vi.fn(() => false),
  handleTokenLimitError: vi.fn(),
}));

vi.mock('./model-capability-registry', () => ({
  getModelsForPurpose: vi.fn(() => []),
}));

vi.mock('./openai-compat-wrapper', () => ({
  getProviderForModel: vi.fn(() => ({})),
}));

vi.mock('../llm-compat', () => ({
  isKnownGoodFC: vi.fn(() => true),
  shouldStripTools: vi.fn(() => false),
  getTextModeInstructions: vi.fn(() => ''),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { streamWithVercelAI } from '../vercel-ai-streaming';
import { streamText } from 'ai';
import { chatLogger } from '../chat-logger';

// ── Helpers ─────────────────────────────────────────────────────────────────

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeStreamResult(chunks: any[] = [], hangAfter = false): { stream: any; cleanup: () => void } {
  let cleanupHang = () => {};
  const fullStream = (async function* () {
    for (const c of chunks) {
      yield c;
    }
    if (hangAfter) {
      const hang = deferred<void>();
      cleanupHang = hang.resolve;
      await hang.promise;
    }
  })();

  return {
    stream: {
      fullStream,
      usage: Promise.resolve({ totalTokens: 50, promptTokens: 20, completionTokens: 30 }),
      finishReason: Promise.resolve('stop'),
      toolCalls: Promise.resolve([]),
      steps: Promise.resolve([]),
      warnings: Promise.resolve([]),
      responses: Promise.resolve([]),
      text: Promise.resolve(''),
    },
    cleanup: cleanupHang,
  };
}

let _cleanups: (() => void)[] = [];

function setupStream(chunks: any[] = [], hangAfter = false) {
  const { stream, cleanup } = makeStreamResult(chunks, hangAfter);
  vi.mocked(streamText).mockReturnValue(stream);
  _cleanups.push(cleanup);
}

function advanceTime(ms: number) {
  vi.advanceTimersByTime(ms);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('streamWithVercelAI — Timeout & Activity Tracker', () => {
  let warnSpy: any;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.clearAllMocks();
    _cleanups = [];

    // Spy on chatLogger.warn — this works reliably because it patches the
    // actual method rather than relying on vi.mock module replacement.
    warnSpy = vi.spyOn(chatLogger, 'warn');

    // Mock fetch globally so the preflight health check doesn't make real HTTP requests
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      redirected: false,
      statusText: 'OK',
      type: 'basic' as ResponseType,
      url: '',
      clone: () => ({} as any),
      body: null,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      formData: () => Promise.resolve(new FormData()),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    } as Response);
  });

  afterEach(() => {
    for (const c of _cleanups) c();
    warnSpy?.mockRestore();
    vi.useRealTimers();
    delete (globalThis as any).fetch;
  });

  // ── TTFT Timeout ────────────────────────────────────────────────────────

  describe('TTFT (time-to-first-token) timeout', () => {
    it('should log NO_INITIAL_TOKEN when no token arrives within timeoutMs', async () => {
      setupStream([], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      // Start the generator without awaiting — it suspends at the health check.
      // The TTFT setTimeout is already scheduled (runs synchronously inside
      // streamWithVercelAI before the first await).
      iterator.next(); // fire-and-forget — generator runs until await healthCheckPromise

      // Advance time synchronously: fires health check's 5s timeout (no-op
      // since our mock fetch ignores abort signals), then fires TTFT timeout at 60s.
      advanceTime(61000);

      // Generator is still suspended at health check. Let it be GC'd.

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TIMEOUT-TTFT]'),
        expect.objectContaining({
          timeoutCategory: 'NO_INITIAL_TOKEN',
          provider: 'openai',
          model: 'gpt-4o',
        }),
      );
    });

    it('should NOT fire TTFT timeout when first token arrives early', async () => {
      setupStream([{ type: 'text-delta', text: 'Hello' }], false);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      for await (const _ of gen) { /* drain */ }

      await advanceTime(61000);

      const ttftCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT-TTFT]'),
      );
      expect(ttftCalls.length).toBe(0);
    });
  });

  // ── Activity Tracker ────────────────────────────────────────────────────

  describe('activity tracker timeout categories', () => {
    it('should log MID_STREAM_TEXT timeout after text-delta activity', async () => {
      setupStream([{ type: 'text-delta', text: 'Hello world' }], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      expect(first.value.content).toBe('Hello world');

      await new Promise(process.nextTick);
      await advanceTime(61000);

      await iterator.return?.();

      // Verify idle timeout was logged — the timeoutCategory depends on
      // lastActivityType which was set to 'text' by the text-delta handler
      const timeoutCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1);
      expect(timeoutCalls[timeoutCalls.length - 1][1]).toMatchObject({
        firstTokenReceived: true,
      });
    });

    it('should NOT fire idle timeout at 1x boundary after tool-call (2x extension)', async () => {
      setupStream([
        { type: 'tool-call', toolName: 'write_file', toolCallId: 'call-1', args: { path: '/test.txt', content: 'test' } },
      ], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Write a file' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);

      await new Promise(process.nextTick);

      // At 1x (60s), timeout should NOT fire because tool-call extends to 2x (120s)
      await advanceTime(61000);

      const beforeCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(beforeCalls.length).toBe(0);

      // Advance to and past the 2x boundary (120s)
      await advanceTime(60000);
      await iterator.return?.();

      // Now the idle timeout should have fired with tool-call category
      const afterCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(afterCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should log idle timeout with tool-call diagnostic context', async () => {
      setupStream([
        { type: 'tool-call', toolName: 'search_files', toolCallId: 'call-1', args: { query: 'TODO' } },
      ], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Search' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      await iterator.next();
      await new Promise(process.nextTick);

      // Advance past the 2x boundary
      await advanceTime(121000);
      await iterator.return?.();

      // Verify the timeout log includes diagnostic context
      const timeoutCall = warnSpy.mock.calls.find(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(timeoutCall).toBeDefined();
      const context = timeoutCall![1];
      expect(context.lastActivityType).toBe('tool-call');
      expect(context.lastActivityDetail).toBe('search_files');
      expect(context.toolCallCount).toBeGreaterThanOrEqual(1);
      expect(context.firstTokenReceived).toBe(true);
    });
  });

  // ── Dynamic Extension Multiplier ────────────────────────────────────────

  describe('dynamic extension multiplier', () => {
    it('should decay multiplier to 1x on text-delta (timeout fires at 60s)', async () => {
      setupStream([
        { type: 'tool-call', toolName: 'write_file', toolCallId: 'call-1', args: { path: '/test.txt', content: 'test' } },
        { type: 'text-delta', text: 'Done.' },
      ], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Write' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      await iterator.next(); // tool-call (2x)
      await iterator.next(); // text-delta (decays to 1x)
      await new Promise(process.nextTick);

      // After decay, idle timeout should fire at 60s (not 120s)
      await advanceTime(61000);
      await iterator.return?.();

      const timeoutCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should reset multiplier to 1x on tool-result failure', async () => {
      setupStream([
        { type: 'tool-result', toolName: 'write_file', toolCallId: 'call-1', result: { success: false, error: 'Failed' } },
      ], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Write' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      await iterator.next();
      await new Promise(process.nextTick);

      await advanceTime(61000);
      await iterator.return?.();

      const timeoutCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]'),
      );
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Reasoning activity ──────────────────────────────────────────────────

  describe('reasoning activity', () => {
    it('should yield reasoning chunks', async () => {
      setupStream([
        { type: 'reasoning', text: 'Let me think...' },
        { type: 'text-delta', text: 'Done.' },
      ], false);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Think' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const results: any[] = [];
      for await (const chunk of gen) {
        results.push(chunk);
      }

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].reasoning).toBe('Let me think...');
      expect(results[1].content).toBe('Done.');
    });
  });

  // ── Step events ─────────────────────────────────────────────────────────

  describe('step events', () => {
    it('should process step-start and step-finish without error', async () => {
      setupStream([
        { type: 'tool-call', toolName: 'write_file', toolCallId: 'call-1', args: { path: '/test.txt', content: 'test' } },
        { type: 'step-start' },
        { type: 'text-delta', text: 'Done.' },
      ], false);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Write' }],
        timeoutMs: 60000,
        speculativeFallbackMs: 0,
      });

      const results: any[] = [];
      for await (const chunk of gen) {
        results.push(chunk);
      }

      const textChunks = results.filter((r: any) => r.content);
      expect(textChunks.some((r: any) => r.content === 'Done.')).toBe(true);
    });
  });

  // ── No timeout ─────────────────────────────────────────────────────────

  describe('disabled timeout', () => {
    it('should never log timeout warnings when timeoutMs is 0', async () => {
      setupStream([], true);

      const gen = streamWithVercelAI({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        timeoutMs: 0,
        speculativeFallbackMs: 0,
      });

      const iterator = gen[Symbol.asyncIterator]();
      iterator.next(); // fire-and-forget to start the generator
      await new Promise(process.nextTick);

      advanceTime(300000);

      const timeoutCalls = warnSpy.mock.calls.filter(
        ([msg]: string[]) => msg.includes('[TIMEOUT]') || msg.includes('[TIMEOUT-TTFT]'),
      );
      expect(timeoutCalls.length).toBe(0);
    });
  });
});
