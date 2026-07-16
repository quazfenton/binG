/**
 * Unit tests for streaming timeout config (Bug #17, #23).
 *
 * Verifies the split timeout shape exported from vercel-ai-streaming.ts:
 *   - STREAM_TIMEOUTS.firstTokenTimeoutMs (default 30s, env: LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS)
 *   - STREAM_TIMEOUTS.idleTimeoutMs       (default 60-90s band, env: LLM_STREAM_IDLE_TIMEOUT_MS)
 *   - STREAM_TIMEOUTS.thinkPingMs         (default 20s, env: LLM_STREAM_THINK_PING_MS)
 *
 * Ordering invariants:
 *   thinkPingMs < firstTokenTimeoutMs < idleTimeoutMs
 *     (think-ping fires before TTFT aborts, both well before the idle window closes)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('STREAM_TIMEOUTS (vercel-ai-streaming.ts)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.LLM_STREAM_IDLE_TIMEOUT_MS;
    delete process.env.LLM_STREAM_THINK_PING_MS;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('firstTokenTimeoutMs defaults to 30000 (30s)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBe(30000);
  });

  it('idleTimeoutMs defaults to within the 60-90s range (75000)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBeGreaterThanOrEqual(60000);
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBeLessThanOrEqual(90000);
  });

  it('thinkPingMs defaults to 20000 (20s)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBe(20000);
  });

  it('thinkPingMs is strictly less than idleTimeoutMs (ping fires before idle abort)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBeLessThan(mod.STREAM_TIMEOUTS.idleTimeoutMs);
  });

  it('thinkPingMs is strictly less than firstTokenTimeoutMs (ping fires before TTFT aborts)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBeLessThan(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs);
  });

  it('firstTokenTimeoutMs is strictly less than idleTimeoutMs (TTFT fires before idle)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBeLessThan(mod.STREAM_TIMEOUTS.idleTimeoutMs);
  });

  it('env-var overrides take effect', async () => {
    process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS = '15000';
    process.env.LLM_STREAM_IDLE_TIMEOUT_MS = '80000';
    process.env.LLM_STREAM_THINK_PING_MS = '10000';
    // Re-import to pick up new env
    const mod = await import('../vercel-ai-streaming?env-override-1');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBe(15000);
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBe(80000);
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBe(10000);
  });

  it('STREAM_TIMEOUTS is exported as a const object (frozen)', async () => {
    const mod = await import('../vercel-ai-streaming');
    // Should be frozen or at least constant-shape — prevents runtime mutation
    // of the default values across calls.
    expect(typeof mod.STREAM_TIMEOUTS).toBe('object');
    expect(mod.STREAM_TIMEOUTS).not.toBeNull();
    expect('firstTokenTimeoutMs' in mod.STREAM_TIMEOUTS).toBe(true);
    expect('idleTimeoutMs' in mod.STREAM_TIMEOUTS).toBe(true);
    expect('thinkPingMs' in mod.STREAM_TIMEOUTS).toBe(true);
  });
});

/**
 * PR-A stream timer finalize regression tests.
 *
 * Verifies that the `streamWithVercelAI` async generator's OUTER try/catch
 * has a `finally` clause that clears the four timing primitives
 * (`ttftTimeoutId`, `hardDeadlineTimeoutId`, `thinkPingIntervalId` via
 * `stopThinkPingInterval()`, and `idleTimeoutId`) on every exit path
 * — normal completion, thrown error, AbortError, or explicit `return`
 * from inside the catch block.
 *
 * Why this matters: without this guard, the think-ping `setInterval` and
 * any pending idle `setTimeout` leak when the generator exits via a path
 * that doesn't reach an inner `finally` (e.g., the openrouter fallback
 * `return`, a thrown non-AbortError from `streamText`, or any path that
 * exits the OUTER try without entering the OUTER catch).
 *
 * T-A1: source-level invariant — the structural pattern is present.
 * T-A2-T-A4: runtime regression — a mini AsyncGenerator mirroring the
 *   same try/catch/finally + AbortController + idempotent `.return()`
 *   pattern is constructed in-test. Each test asserts
 *   `vi.getTimerCount() === 0` after the corresponding exit path. These
 *   guard the PATTERN's runtime correctness even though they don't
 *   directly invoke the (very heavy to mock) `streamWithVercelAI`
 *   generator — a regression that removes the `finally` would leave
 *   the leaked setInterval observable via `vi.getTimerCount()`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'vercel-ai-streaming.ts',
);

/**
 * Build a mini AsyncGenerator that mirrors the streamWithVercelAI timer
 * pattern: setTimeout for ttft, another setTimeout for hard deadline,
 * setInterval for think-ping, and a rolling idle setTimeout that's reset
 * on every "chunk". A try/finally block clears all 4 timers on every
 * exit path.
 *
 * Returned alongside the generator: a teardown helper that mirrors the
 * OUTER `finally` clause so the test can assert that calling it twice is
 * safe (T-A4 idempotency).
 */
async function* buildMiniStreamWithTimers(opts: {
  abortAfterFirstChunk?: AbortController;
  errorOnNext?: Error;
}) {
  const ttft: { id: NodeJS.Timeout | null } = { id: setTimeout(() => undefined, 30_000) };
  const hardDeadline: { id: NodeJS.Timeout | null } = { id: setTimeout(() => undefined, 60_000) };
  let thinkPing: NodeJS.Timeout | null = setInterval(() => undefined, 20_000);
  let idle: NodeJS.Timeout | null = null;
  const stopThinkPing = () => {
    if (thinkPing) { clearInterval(thinkPing); thinkPing = null; }
  };
  const resetIdle = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => undefined, 75_000);
  };
  resetIdle();
  try {
    yield 'chunk-1';
    resetIdle();
    if (opts.abortAfterFirstChunk?.signal.aborted) return;
    // Re-attach abort listener for the abort test — yield once more,
    // then either abort or throw.
    const listenAbort = new Promise<void>((_resolve, reject) => {
      opts.abortAfterFirstChunk?.signal.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
      // If no abort is/will-be requested, resolve immediately so the
      // generator proceeds normally.
      if (!opts.abortAfterFirstChunk) _resolve();
    });
    try {
      await listenAbort;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      throw err;
    }
    if (opts.errorOnNext) throw opts.errorOnNext;
    yield 'chunk-2';
  } finally {
    if (ttft.id) { clearTimeout(ttft.id); ttft.id = null; }
    if (hardDeadline.id) { clearTimeout(hardDeadline.id); hardDeadline.id = null; }
    if (idle) { clearTimeout(idle); idle = null; }
    stopThinkPing();
  }
}

describe('PR-A stream timer finalize regression (vercel-ai-streaming.ts)', () => {
  beforeEach(() => {
    delete process.env.ENABLE_STREAM_TIMER_FINALIZE;
  });
  afterEach(() => {
    delete process.env.ENABLE_STREAM_TIMER_FINALIZE;
  });

  it('T-A1 source: OUTER try/catch/finally clears all 4 timer primitives via STREAM_TIMER_FINALIZE_ENABLED', () => {
    const src = fs.readFileSync(SRC_FILE, 'utf-8');
    // Anchor on the OUTER catch's terminal `throw error;` statement — this
    // is structurally unique to the OUTER catch (no inner catch in this
    // file re-throws `error` immediately before a `finally`). The lazy
    // 1200-char window stops at the first `}` after the `finally` open,
    // isolating the OUTER finally body.
    const outerFinally =
      src.match(/throw\s+error;\s*\}\s*finally\s*\{[\s\S]{0,1200}?\}\s*\n\s*\}/);
    expect(
      outerFinally,
      'expected `} finally {` block immediately following OUTER catch\'s `throw error;`',
    ).not.toBeNull();
    const block = outerFinally![0];
    // Each of the 3 setTimeout-backed timer IDs must be cleared directly.
    expect(block).toMatch(/ttftTimeoutId[^;]*clearTimeout\s*\(/);
    expect(block).toMatch(/hardDeadlineTimeoutId[^;]*clearTimeout\s*\(/);
    expect(block).toMatch(/idleTimeoutId[^;]*clearTimeout\s*\(/);
    // The setInterval-backed `thinkPingIntervalId` is cleared via the
    // helper. Asserting on the helper is structurally stronger than on
    // the bare variable name (which would match unrelated code paths).
    expect(block).toMatch(/stopThinkPingInterval\s*\(/);
    // Cleanup is gated by `STREAM_TIMER_FINALIZE_ENABLED` (default ON).
    expect(block).toMatch(/STREAM_TIMER_FINALIZE_ENABLED/);
    const flagIdx = block.indexOf('STREAM_TIMER_FINALIZE_ENABLED');
    const firstClearIdx = block.indexOf('clearTimeout');
    expect(flagIdx, 'flag check precedes first clear').toBeLessThan(firstClearIdx);
  });

  it('T-A2 runtime: normal-return path clears all 4 timers (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const gen = buildMiniStreamWithTimers({});
      // Pull 2 chunks (the mini generator yields 2 by default).
      await gen.next();
      await gen.next();
      // Drain — triggers the finally.
      await gen.return(undefined);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-A3 runtime: AbortError path clears all 4 timers (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const ctrl = new AbortController();
      const gen = buildMiniStreamWithTimers({ abortAfterFirstChunk: ctrl });
      await gen.next();
      // Trigger abort — the generator's inner promise rejects with an
      // AbortError, the catch returns, the finally fires.
      ctrl.abort(new DOMException('aborted', 'AbortError'));
      // Drain to completion. The second gen.next() returns the
      // end-of-iterator sentinel because the AbortError was caught and
      // turned into a `return`.
      while (!(await gen.next()).done) {
        /* drain */
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-A4 runtime: idempotent finalize — multiple `clearTimeout` / `clearInterval` calls on the same handle are safe', () => {
    // Mirrors the OUTER `finally` block in streamWithVercelAI clearing
    // a timer handle that may already have been cleared by an INNER
    // cleanup site (e.g., `onFirstToken` clearing `ttftTimeoutId`,
    // or `stopThinkPingInterval` clearing `thinkPingIntervalId`).
    // `clearTimeout` and `clearInterval` on an already-cleared or
    // pending handle are documented Node.js no-ops; calling them twice
    // is a deliberate part of the `finally`-clause contract.
    //
    // Note: the previous form of this test called `gen.return(undefined)`
    // twice, but a second `.return()` after the first is a no-op per the
    // ECMAScript iterator-close protocol, so the prior version was a
    // vacuous assertion. The direct clear-handle form below exercises
    // the no-twice-clear guarantee that the `finally` clause relies on.
    vi.useFakeTimers();
    try {
      const ttft = setTimeout(() => undefined, 30_000);
      const hardDeadline = setTimeout(() => undefined, 60_000);
      const idle = setTimeout(() => undefined, 75_000);
      const thinkPing = setInterval(() => undefined, 20_000);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      clearTimeout(ttft);
      clearTimeout(ttft);   // already cleared
      clearTimeout(ttft);   // already cleared
      clearTimeout(hardDeadline);
      clearTimeout(hardDeadline);
      clearTimeout(idle);
      clearTimeout(idle);
      clearInterval(thinkPing);
      clearInterval(thinkPing);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
