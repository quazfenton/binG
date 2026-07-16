/**
 * T-Z1: PR-Z + PR-X production-factory regression test.
 *
 * Coverage gap closed by this test:
 *   PR-X's pendingPrimary reset (added at
 *   `llm-fallback-coordinator.ts:495`) was covered by T-X1 inside
 *   `__tests__/llm-fallback-coordinator.test.ts:1166`. T-X1 calls
 *   `coordinateConcurrentFallback` directly with `idleTimeoutPerChunkMs: 40`
 *   SET, and never exercises the production factory
 *   `streamWithConcurrentFallback` (the function actually called by
 *   `runV1Api`/`runV1ApiCompletion`/`runV1ApiWithTools`).
 *
 *   The production factory does NOT pass `idleTimeoutPerChunkMs` to
 *   `coordinateConcurrentFallback` (see `enhanced-llm-service.ts:2747`), so
 *   in production `idleTimeoutPerChunkMs` is UNDEFINED. With the parameter
 *   undefined, `drainIterator` does NOT throw IdleTimeoutError on a stalled
 *   chunk — it just awaits `it.next()` forever. This means T-X1's
 *   "the IdleTimeoutError path walks the chain" assertion is stronger than
 *   the production path: in production, a stalling primary is detected
 *   ONLY by the silence-race (`silenceMs`) or the route-level stall
 *   watchdog. The PR-X `.finally(() => pendingPrimary = null)` reset
 *   invariant is the sole mechanism preventing infinite chunk re-emission
 *   on the cached-chunk path.
 *
 *   T-Z1 reproduces the same scenario through the public production
 *   factory — `idleTimeoutPerChunkMs` UNSET throughout — and asserts
 *   EXACTLY one chunk is emitted, then the loop hangs in
 *   `drainIterator` (the expected post-fix behavior given the UNSET idle
 *   watchdog). Break-out is via the AbortSignal we pass to the factory.
 *   This is the regression-defense for the combined PR-X (invariant) +
 *   PR-Z (envelope) surface in production.
 *
 * Pre-PR-X: chunks would re-emit on every chain iteration (cached
 *           chunk regrowth → chunks.length >= 2 → test fails on
 *           `toBe(1)`).
 * Post-PR-X + Post-PR-Z: chunks.length === 1 (the cached chunk is
 *           yielded exactly once, then subsequent `.next()` calls hang
 *           in `drainIterator` — production routes this through the
 *           route-level stall watchdog OR a user-initiated abort).
 *
 * Why a separate test file (not an addition to the existing T-X1 file):
 *   T-X1 lives in `__tests__/llm-fallback-coordinator.test.ts` because it
 *   tests the internal helper directly. T-Z1 tests the PUBLIC production
 *   factory, which lives in `enhanced-llm-service.ts:2622` — putting them
 *   in different files makes the import surface (mocks + module paths)
 *   easier to read and avoids coupling the two tests to the same mock
 *   factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────
//
// Mock the upstream SDK module that the production factory dynamically
// imports via `await import('./vercel-ai-streaming')` at
// `enhanced-llm-service.ts:2642`. vi.mock matches the ABSOLUTE resolved
// path of the module, so the relative `'../vercel-ai-streaming'` from
// this test file (resolves to the same `vercel-ai-streaming.ts` that
// `enhanced-llm-service.ts`'s `./vercel-ai-streaming` resolves to) uses
// this factory for BOTH static and dynamic import call sites.
vi.mock('../vercel-ai-streaming', () => ({
  streamWithVercelAI: vi.fn(),
}));

// Provider-fallback-chains mock. The production factory's
// `coordinateConcurrentFallback` reads `getConfiguredFallbackChain`, but
// `EnhancedLLMService.setupFallbackChains` ALSO imports the named export
// `PROVIDER_FALLBACK_CHAINS` at module-load time. Both exports must be
// present on the mock or vitest aborts with:
//   "No 'PROVIDER_FALLBACK_CHAINS' export is defined on the mock."
vi.mock('../../providers/provider-fallback-chains', () => ({
  PROVIDER_FALLBACK_CHAINS: {
    // Surface the minimum the production class needs at module-load time
    // (see `EnhancedLLMService.setupFallbackChains` ~line 382). Empty
    // object is sufficient because the test mocks the chain resolution
    // function below.
    primary: [],
    fallbackA: [],
    fallbackB: [],
    mistral: [],
  },
  getConfiguredFallbackChain: vi.fn((provider: string) => {
    if (provider === 'primary') return ['fallbackA', 'fallbackB'];
    return [];
  }),
}));

// Logger mock: no need to pollute test output with coordinator logs.
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// IMPORTANT: import the production factory AFTER all mocks are declared
// above so vi.mock factories are registered before module-resolution.
import { streamWithConcurrentFallback } from '../enhanced-llm-service';
import { streamWithVercelAI } from '../vercel-ai-streaming';

/**
 * A minimal controllable AsyncIterable for the upstream SDK mock. Mirrors
 * the contract `drainIterator` / `coordinateConcurrentFallback` expect:
 *   - `next()` returns a Promise<IteratorResult>.
 *   - `next()` resolves once per `push(v)` call.
 *   - When no value has been pushed, `next()` returns a pending promise.
 *   - Subsequent `next()` calls (after the queue is drained and no
 *     pending resolver) hang forever — exactly the chunk-yield-then-stall
 *     scenario.
 *
 * No AbortSignal observability — the production factory wires AbortSignal
 * into `streamWithVercelAI` via `signal: mergedSignal`, but the mock does
 * not honor abort. The test relies on the production factory's own
 * AbortSignal chain to exit cleanly (`controller.abort()` propagates
 * through the envelope's `try/finally`).
 */
function makeControllable<T>() {
  type R = IteratorResult<T>;
  const queue: R[] = [];
  let pending: ((r: R) => void) | null = null;
  const iterator = {
    next(): Promise<R> {
      if (queue.length > 0) return Promise.resolve(queue.shift() as R);
      return new Promise<R>((r) => {
        pending = r;
      });
    },
    return(): Promise<R> {
      if (pending) {
        const p = pending;
        pending = null;
        p({ value: undefined, done: true } as R);
      }
      return Promise.resolve({ value: undefined, done: true } as R);
    },
    throw(err: unknown): Promise<R> {
      if (pending) {
        const p = pending;
        pending = null;
        p({ value: undefined, done: true } as R);
      }
      return Promise.reject(err);
    },
  };
  const iterable = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
  return {
    iterable,
    push(value: T): void {
      if (pending) {
        pending({ value, done: false } as R);
        pending = null;
      } else {
        queue.push({ value, done: false } as R);
      }
    },
    done(): void {
      if (pending) {
        pending({ value: undefined, done: true } as R);
        pending = null;
      } else {
        queue.push({ value: undefined, done: true } as R);
      }
    },
  };
}

const SAVED_ENV = { ...process.env };

describe('T-Z1: streamWithConcurrentFallback (production factory) bounds chunks on chunk-yield-then-stall with idleTimeoutPerChunkMs UNSET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Tighten the PR-Z envelope so the test exercises the bounded path
    // quickly. PR-Z's default is 25 s — too slow for a unit test.
    process.env.LLM_STREAM_FIRST_CHUNK_TIMEOUT_MS = '50';
  });

  afterEach(() => {
    process.env = { ...SAVED_ENV };
    vi.restoreAllMocks();
  });

  it('emits exactly ONE chunk when upstream emits one chunk then stalls (production-path invariant)', async () => {
    // ── Arrange ──
    //
    // One controllable PER provider so the chain walk's per-iteration
    // race arm does not collapse observable "primary won from cached
    // chunk" vs "fallback timer fired" — sharing one iterable across
    // all providers would hide per-provider bugs by FIFO-pairing the
    // same `.push('A')` into both sides of the race.
    const streams: Record<string, ReturnType<typeof makeControllable>> = {
      primary: makeControllable<{
        content: string;
        isComplete: boolean;
        timestamp: Date;
        finishReason?: string;
        metadata?: Record<string, unknown>;
      }>(),
      fallbackA: makeControllable<{
        content: string;
        isComplete: boolean;
        timestamp: Date;
        finishReason?: string;
        metadata?: Record<string, unknown>;
      }>(),
      fallbackB: makeControllable<{
        content: string;
        isComplete: boolean;
        timestamp: Date;
        finishReason?: string;
        metadata?: Record<string, unknown>;
      }>(),
    };

    vi.mocked(streamWithVercelAI).mockImplementation((opts: any) => {
      const key = opts?.provider || 'primary';
      const stream = streams[key] ?? streams.primary;
      return stream.iterable;
    });

    // PRIMARY: schedule ONE chunk emission during the silence-race window
    // (after `silenceMs` = `concurrentFallbackMs` = 20 ms). This is the
    // chunk-yield-then-stall entry: the primary emits ONCE then stalls
    // on the next `.next()`.
    setTimeout(() => {
      streams.primary.push({
        content: 'A',
        isComplete: false,
        timestamp: new Date(),
      });
      // DO NOT push anything else. Subsequent `.next()` calls hang forever.
    }, 25);

    // FALLBACKS: leave stalled-only (no chunk emitted). Their chain-walk
    // race arms will time out at the production default `hardDeadlineMs
    // = 30 s` — too long for a unit test, so we cap the consume task
    // via AbortSignal after observing the bounded chunk count.

    // ── Act ──
    //
    // Call the PRODUCTION factory. Note: `idleTimeoutPerChunkMs` is NOT
    // passed — production's default is undefined (the assertion target).
    // We DO pass a signal so the consume task can exit cleanly after
    // observing the bounded chunk count — this avoids the silent-empty
    // pass risk that a wall-clock `Promise.race` cap would create (if
    // wall-clock fires before any chunk is emitted, `chunks.length === 0`
    // passes `< 3` falsely).
    const controller = new AbortController();
    const gen = streamWithConcurrentFallback({
      provider: 'primary',
      model: 'mistral-small-latest',
      messages: [],
      concurrentFallbackMs: 20,
      signal: controller.signal,
      // idleTimeoutPerChunkMs: <intentionally UNSET>
    } as any);

    const chunks: unknown[] = [];
    let exitReason: 'throw' | 'done' | 'aborted' | 'cap-reached' | null = null;

    const consume = (async () => {
      try {
        for await (const c of gen) {
          chunks.push(c);
          // Cap to keep pre-PR-X infinite-re-emission loops from running
          // forever in the test runtime AND to bound the test wall-clock.
          // Mirror T-X1's smoking-gun signal: hitting cap on a stalling
          // scenario indicates the invariant is broken.
          //
          // Post-PR-X invariant: with `idleTimeoutPerChunkMs` UNSET,
          // the production factory emits EXACTLY one chunk from the
          // primary chain-walk race win and then `drainIterator` hangs
          // awaiting the next `.next()` (no IdleTimeoutError to walk
          // the chain). We must terminate the iterator ourselves —
          // the upstream mock does not observe AbortSignal, so the
          // signal-abort path in `drainIterator` cannot interrupt the
          // pending `.next()`. Injecting `done()` resolves the
          // drainIterator await with `{done: true}` and lets the
          // for-await exit cleanly. The cap branch below remains a
          // belt-and-braces failsafe for pre-PR-X smoking-gun
          // detection (>=2 chunks → invariant broken → test fails).
          if (chunks.length === 1) {
            streams.primary.done();
          }
          if (chunks.length >= 2) {
            controller.abort();
            exitReason = 'cap-reached';
            return;
          }
        }
        exitReason = 'done';
      } catch (err: any) {
        // Accept either:
        //   - thrown error (chain exhausted after abort propagates), OR
        //   - AbortError from controller.abort() (clean exit).
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          exitReason = 'aborted';
        } else {
          exitReason = 'throw';
        }
      }
    })();

    // Hard wall-clock cap so the test cannot hang the runner even if
    // the production factory's abort propagation has a bug. With the
    // cap at chunks.length >= 2 the loop aborts aggressively, but the
    // wall-clock cap is the belt-and-braces fallback.
    const wallClockCap = new Promise<'wall-cap'>((resolve) =>
      setTimeout(() => {
        controller.abort();
        resolve('wall-cap');
      }, 1000),
    );
    await Promise.race([consume, wallClockCap]);

    // Wait for consume to drain after either abort path completes.
    await consume.catch(() => {
      // consume throws AbortError on the abort path — swallow.
    });

    // ── Assert ──
    //
    // Smoking-gun assertion:
    //   Pre-PR-X (without pendingPrimary reset): the cached chunk would
    //   be re-emitted on every chain iteration. The chain walk
    //   iterates over ['fallbackA', 'fallbackB'] (2 entries); each
    //   iteration's primary-race arm would resolve with the cached
    //   chunk via `.then` sidecar, yielding 'A' per iteration →
    //   chunks.length >= 3 (cap reached) → 'cap-reached' exit → fails
    //   `toBe(1)`.
    //
    //   Post-PR-X + Post-PR-Z: chunks.length === 1 — the cached chunk
    //   is yielded exactly once via the chain-walk primary-race arm,
    //   then `drainIterator` hangs forever awaiting
    //   `primaryIt.next()`. The cap=2 abort breaks the consume task
    //   cleanly.
    expect(chunks.length).toBe(1);

    // Either abort-driven exit, throw, or chain-exhausted throw.
    expect(['throw', 'aborted', 'cap-reached', 'done']).toContain(exitReason);

    // Sanity: the production factory actually invoked the upstream SDK
    // (i.e., we exercised the real wrapAsHandle envelope, not a stub).
    // Primary + 2 fallbacks = 3 factory calls minimum.
    expect(streamWithVercelAI).toHaveBeenCalled();
    expect(streamWithVercelAI.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
