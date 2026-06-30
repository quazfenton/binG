/**
 * Tests for the concurrent LLM fallback coordinator.
 *
 * Covers the race semantics:
 *   - Primary produces a chunk before silenceMs → fallback never created
 *   - Primary is silent → fallback fired → fallback wins → primary aborted
 *   - Primary is silent → fallback fired → primary wins → fallback aborted
 *   - Fallback setup throws → coordinator falls through to primary
 *   - Empty fallback chain → just iterate primary
 *   - User-signal abort BEFORE silenceMs → primary aborted, fallback never fired
 *   - silenceMs <= 0 → coordinator disabled
 *   - Telemetry callbacks (onFallbackWin, onLoser) fire with correct info
 *   - Explicit fallbackChain override beats the default resolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/providers/provider-fallback-chains', () => ({
  getConfiguredFallbackChain: vi.fn((provider: string) => {
    if (provider === 'primary') return ['fallbackA', 'fallbackB'];
    return [];
  }),
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  coordinateConcurrentFallback,
} from '../llm-fallback-coordinator';
import {
  _resetHealthForTests,
  _getCallsForTests,
  shouldDeprioritize,
  getHealthScore,
  SLOW_CALL_THRESHOLD_MS,
} from '../llm-provider-health';

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Build a controllable async generator handle (gen + abort) that yields
 * items on demand. The handle's abort() is a no-op by default (the
 * coordinator is responsible for cancelling the network request, not
 * the test stub).
 */
function makeControllable<T>(): {
  gen: AsyncGenerator<T>;
  abort: () => void;
  aborted: boolean;
  push: (item: T) => void;
  end: () => void;
  fail: (err: unknown) => void;
} {
  let ended = false;
  let failed: unknown = null;
  let pending: Deferred<IteratorResult<T>> | null = null;
  // Buffer for items pushed before the consumer starts iterating. Without
  // this, multiple push() calls before next() would overwrite `pending`
  // and lose all but the first item. With this, items enqueue FIFO and
  // are returned one-per-next() call.
  let buffer: T[] = [];

  const gen = (async function* () {
    while (true) {
      if (failed !== null) throw failed;
      // Drain any buffered items first. The push() function enqueues
      // here when no consumer is waiting, and end() pushes a sentinel.
      if (buffer.length > 0) {
        const item = buffer.shift()!;
        if (item === undefined) return; // end() sentinel
        yield item;
        continue;
      }
      // No buffered items — wait for the next push()/end().
      if (pending) {
        const d = pending;
        pending = null;
        const r = await d.promise;
        if (r.done) return;
        yield r.value;
        continue;
      }
      if (ended) return;
      const d = deferred<IteratorResult<T>>();
      pending = d;
      const r = await d.promise;
      pending = null;
      if (r.done) return;
      yield r.value;
    }
  })();
  const handle = {
    gen,
    abort: () => {},
    aborted: false as boolean,
    push: (item: T) => {
      if (pending) {
        // Consumer is waiting — hand the item to it directly.
        const d = pending;
        pending = null;
        d.resolve({ value: item, done: false });
        return;
      }
      // No consumer is waiting yet — buffer the item for the next next() call.
      buffer.push(item);
    },
    end: () => {
      ended = true;
      if (pending) {
        // Consumer is waiting — close the stream immediately.
        const d = pending;
        pending = null;
        d.resolve({ value: undefined as any, done: true });
        return;
      }
      // No consumer waiting — stash a "done" marker that the next next()
      // call will observe (via `ended`) and return done:true.
      buffer.push(undefined as any); // sentinel: when we see this, return done
    },
    fail: (err: unknown) => {
      failed = err;
      if (pending) {
        pending.reject(err);
        pending = null;
      }
    },
  };

  // Make abort() observable for tests.
  handle.abort = () => { handle.aborted = true; };
  return handle;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('coordinateConcurrentFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetHealthForTests();
  });

  it('yields primary chunks when primary produces before silenceMs', async () => {
    const primary = makeControllable<number>();
    primary.push(1);
    primary.push(2);
    primary.end();

    const factory = vi.fn(() => {
      throw new Error('fallback factory must NOT be called when primary produces early');
    });

    const yielded: number[] = [];
    for await (const item of coordinateConcurrentFallback({
      primaryProvider: 'primary',
      model: 'm',
      createPrimaryStream: () => primary,
      createFallbackStream: factory,
      silenceMs: 1000,
    })) {
      yielded.push(item);
    }

    expect(yielded).toEqual([1, 2]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('fires fallback after silenceMs when primary is silent, fallback wins', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const fallback = makeControllable<number>();
      const onFallbackWin = vi.fn();
      const onLoser = vi.fn();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: (p) => {
          expect(p).toBe('fallbackA');
          return Promise.resolve(fallback);
        },
        silenceMs: 100,
        onFallbackWin,
        onLoser,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Advance past silenceMs so the timeout fires and the fallback is created.
      await vi.advanceTimersByTimeAsync(150);

      // Fallback produces a chunk. Drive it.
      fallback.push(42);
      fallback.end();

      const first = await firstP;
      expect(first.done).toBe(false);
      expect(first.value).toBe(42);

      for await (const _ of iter) { /* drain */ }

      // Fallback won → primary should have been aborted.
      expect(primary.aborted).toBe(true);

      expect(onFallbackWin).toHaveBeenCalledTimes(1);
      expect(onFallbackWin).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'fallbackA', index: 0 }),
      );
      expect(onLoser).toHaveBeenCalledTimes(1);
      expect(onLoser).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'primary', source: 'primary', index: -1 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires fallback after silenceMs when primary is silent, primary wins', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>();
      const onFallbackWin = vi.fn();
      const onLoser = vi.fn();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 100,
        onFallbackWin,
        onLoser,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(150);

      // Primary produces a chunk after the fallback has been created.
      primary.push(99);
      primary.end();

      const first = await firstP;
      expect(first.done).toBe(false);
      expect(first.value).toBe(99);

      for await (const _ of iter) { /* drain */ }

      expect(onFallbackWin).not.toHaveBeenCalled();
      expect(onLoser).toHaveBeenCalledTimes(1);
      expect(onLoser).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'fallbackA', source: 'fallback', index: 0 }),
      );
      // Fallback should have been aborted.
      expect(fallback.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls through to primary when fallback setup throws', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      primary.push(7);
      primary.end();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => {
          throw new Error('fallback setup failed');
        },
        silenceMs: 50,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(60);

      // The first iter.next() call already consumes the only emitted
      // chunk here (7). The subsequent for-await starts at the second
      // item, so the first yield must be captured from firstP and
      // prepended to the results — otherwise `results` can never
      // contain 7 even though the test expects it to.
      const first = await firstP;
      const results: number[] = [];
      if (first.value !== undefined) results.push(first.value);
      for await (const item of iter) results.push(item);

      expect(results).toEqual([7]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the coordinator entirely when silenceMs <= 0', async () => {
    const primary = makeControllable<number>();
    primary.push(1);
    primary.end();

    const factory = vi.fn(() => {
      throw new Error('fallback factory must NOT be called when silenceMs <= 0');
    });

    const yielded: number[] = [];
    for await (const item of coordinateConcurrentFallback({
      primaryProvider: 'primary',
      model: 'm',
      createPrimaryStream: () => primary,
      createFallbackStream: factory,
      silenceMs: 0,
    })) {
      yielded.push(item);
    }

    expect(yielded).toEqual([1]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('skips the coordinator entirely when fallback chain is empty', async () => {
    const primary = makeControllable<number>();
    primary.push(1);
    primary.end();

    const factory = vi.fn(() => {
      throw new Error('fallback factory must NOT be called when chain is empty');
    });

    const yielded: number[] = [];
    for await (const item of coordinateConcurrentFallback({
      primaryProvider: 'no-chain-provider',
      model: 'm',
      createPrimaryStream: () => primary,
      createFallbackStream: factory,
      silenceMs: 1000,
    })) {
      yielded.push(item);
    }

    expect(yielded).toEqual([1]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('aborts primary and never fires the fallback when user aborts before silenceMs', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const controller = new AbortController();
      const factory = vi.fn(() => {
        throw new Error('fallback factory must NOT be called when user aborts');
      });

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: factory,
        signal: controller.signal,
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Abort BEFORE silenceMs elapses.
      controller.abort();

      // Advance past silenceMs to let any pending timer fire.
      await vi.advanceTimersByTimeAsync(150);

      // Drain — should return immediately because we aborted.
      for await (const _ of iter) { /* empty */ }
      await firstP;

      expect(primary.aborted).toBe(true);
      expect(factory).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when primary stream errors before silenceMs', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => {
          throw new Error('fallback must not be called when primary errors');
        },
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      primary.fail(new Error('primary boom'));

      await expect(firstP).rejects.toThrow('primary boom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an explicit fallbackChain override instead of getConfiguredFallbackChain', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>();
      const onFallbackWin = vi.fn();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: (p) => {
          expect(p).toBe('custom-fb');
          return Promise.resolve(fallback);
        },
        fallbackChain: ['custom-fb'],
        silenceMs: 50,
        onFallbackWin,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(60);
      fallback.push(5);
      fallback.end();

      const first = await firstP;
      expect(first.value).toBe(5);
      for await (const _ of iter) { /* drain */ }

      expect(onFallbackWin).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'custom-fb' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Abort-invocation recording tests ─────────────────────────────────────
  // These tests use dedicated vi.fn() spies to record exactly when each
  // handle's abort() is invoked. This complements the existing tests
  // that check the .aborted flag on the controllable handle — these
  // tests verify the abort spy is actually fired (and only fired once)
  // for the loser, not the winner.

  it('records primary abort invocation when fallback wins the race', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>();
      const primaryAbortSpy = vi.fn(() => {
        primary.aborted = true;
      });
      const fallbackAbortSpy = vi.fn(() => {
        fallback.aborted = true;
      });
      primary.abort = primaryAbortSpy;
      fallback.abort = fallbackAbortSpy;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(150);
      fallback.push(42);
      fallback.end();

      const first = await firstP;
      expect(first.value).toBe(42);
      for await (const _ of iter) { /* drain */ }

      // Fallback won → primary abort should have been recorded, fallback abort should NOT.
      expect(primaryAbortSpy).toHaveBeenCalledTimes(1);
      expect(fallbackAbortSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records fallback abort invocation when primary wins the race', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>();
      const primaryAbortSpy = vi.fn(() => {
        primary.aborted = true;
      });
      const fallbackAbortSpy = vi.fn(() => {
        fallback.aborted = true;
      });
      primary.abort = primaryAbortSpy;
      fallback.abort = fallbackAbortSpy;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(150);
      primary.push(99);
      primary.end();

      const first = await firstP;
      expect(first.value).toBe(99);
      for await (const _ of iter) { /* drain */ }

      // Primary won → fallback abort should have been recorded, primary abort should NOT.
      expect(fallbackAbortSpy).toHaveBeenCalledTimes(1);
      expect(primaryAbortSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('records exactly one abort invocation per loser, not multiple', async () => {
    vi.useFakeTimers();
    try {
      // Test that abort is fired EXACTLY once (idempotent), even if the
      // loser is iterated or drained after the race resolves.
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>();
      const primaryAbortSpy = vi.fn(() => {
        primary.aborted = true;
      });
      primary.abort = primaryAbortSpy;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      await vi.advanceTimersByTimeAsync(150);
      fallback.push(1);
      fallback.push(2);
      fallback.push(3);
      fallback.end();

      const first = await firstP;
      expect(first.value).toBe(1);
      for await (const _ of iter) { /* drain all fallback chunks */ }

      // Fallback won → primary abort should have been recorded EXACTLY once,
      // not once per fallback chunk drained.
      expect(primaryAbortSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── HTTP-level abort verification ──────────────────────────────────────
  // Verifies that the abort() function actually fires the AbortController
  // whose signal would be passed to fetch in production — not just that
  // the stream is dropped. Uses a hand-rolled globalThis.fetch mock that
  // captures the AbortSignal from each call (nock/undici are not installed
  // in this project, so we use vi.fn() with the same pattern as
  // timeout-logic.test.ts).

  /**
   * Shared scenario runner for the HTTP-level abort tests. Sets up:
   *   - globalThis.fetch mock that captures the AbortSignal from each call
   *   - Stream factories that wire AbortController → fetch signal → abort
   *   - Returns a way to run the coordinator with a custom winner and
   *     assert the loser's fetch signal was aborted
   *
   * Must be called inside a vi.useFakeTimers() block. The caller is
   * responsible for vi.useFakeTimers() and vi.useRealTimers(); the helper
   * handles globalThis.fetch save/restore in a try/finally.
   */
  async function runHttpAbortScenario(opts: {
    winner: 'primary' | 'fallback';
    winnerChunk: number;
  }): Promise<{ primarySignal: AbortSignal; fallbackSignal: AbortSignal }> {
    const originalFetch = globalThis.fetch;
    const fetchSignals: Array<{ label: 'primary' | 'fallback'; signal: AbortSignal }> = [];

    try {
      // Mock globalThis.fetch: capture the signal, reject on abort
      // (mimics real fetch behavior under cancellation). One abort listener
      // per call — the signal's own .aborted property is the source of truth.
      globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        const label: 'primary' | 'fallback' = url.includes('primary') ? 'primary' : 'fallback';
        fetchSignals.push({ label, signal });
        return new Promise((_resolve, reject) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        });
      }) as any;

      // Create stream factories that simulate the production wiring:
      // AbortController → fetch with signal → abort fires the controller.
      // Uses a simple deferred for chunk delivery (avoids the fragile
      // callback-wrapping pattern from the prior version).
      const makeDeferred = <T>() => {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((res) => { resolve = res; });
        return { promise, resolve };
      };
      const makeStream = (label: 'primary' | 'fallback') => {
        const ac = new AbortController();
        globalThis.fetch(`http://mock-${label}`, { signal: ac.signal });
        const chunkDeferred = makeDeferred<number>();
        const gen = (async function* () {
          yield await chunkDeferred.promise;
        })();
        return {
          gen,
          abort: () => ac.abort(),
          push: (chunk: number) => chunkDeferred.resolve(chunk),
        };
      };

      const primary = makeStream('primary');
      const fallback = makeStream('fallback');

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 100,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Advance past silenceMs so the timeout fires and the fallback is created.
      await vi.advanceTimersByTimeAsync(150);

      // Drive the winner to produce a chunk.
      if (opts.winner === 'primary') {
        primary.push(opts.winnerChunk);
      } else {
        fallback.push(opts.winnerChunk);
      }

      const first = await firstP;
      expect(first.value).toBe(opts.winnerChunk);
      for await (const _ of iter) { /* drain */ }

      // Both fetches should have been called (primary at start, fallback after timeout).
      expect(fetchSignals).toHaveLength(2);
      const primaryRecord = fetchSignals.find((f) => f.label === 'primary')!;
      const fallbackRecord = fetchSignals.find((f) => f.label === 'fallback')!;

      return { primarySignal: primaryRecord.signal, fallbackSignal: fallbackRecord.signal };
    } finally {
      // Always restore globalThis.fetch, even if assertions above throw,
      // to avoid leaking the mock into subsequent tests.
      globalThis.fetch = originalFetch;
    }
  }

  it('cancels the underlying fetch AbortSignal when the fallback wins (primary is loser)', async () => {
    vi.useFakeTimers();
    try {
      const { primarySignal, fallbackSignal } = await runHttpAbortScenario({
        winner: 'fallback',
        winnerChunk: 42,
      });

      // Fallback won → primary's fetch signal should have been aborted
      // (the coordinator called primaryHandle.abort() → ac.abort() →
      // the signal we captured in the fetch mock is now aborted).
      // AbortSignal.aborted is the source of truth — no custom flag needed.
      expect(primarySignal.aborted).toBe(true);
      // Fallback's signal should NOT be aborted (it's the winner).
      expect(fallbackSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the underlying fetch AbortSignal when the primary wins (fallback is loser)', async () => {
    vi.useFakeTimers();
    try {
      const { primarySignal, fallbackSignal } = await runHttpAbortScenario({
        winner: 'primary',
        winnerChunk: 99,
      });

      // Primary won → fallback's fetch signal should have been aborted.
      expect(fallbackSignal.aborted).toBe(true);
      // Primary's signal should NOT be aborted (it's the winner).
      expect(primarySignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Chain walk tests (per-fallback hardDeadlineMs) ──────────────────
  // Bug #86 regression: the secondary Promise.race (primary vs. fallback #1)
  // had no timeout arm, so when fallback #1 ALSO stalled past silenceMs —
  // the ninerouter-class scenario, where every fallback hits the same stuck
  // in-cluster network edge — the request wedged indefinitely. These tests
  // guard against that regression.

  it('throws within silenceMs + hardDeadlineMs + ε when both primary and fallback never produce (chain exhausted)', async () => {
    // Regression test for Bug #86. With chain.length=1 and both factories
    // returning never-resolving generators, the coordinator must surface
    // a throw within the bounded window of (silenceMs + hardDeadlineMs) plus
    // some slack for scheduler overhead — not wedge indefinitely.
    vi.useFakeTimers();
    try {
      const silent = makeControllable<number>(); // never produces
      const silenceMs = 30;
      const hardDeadlineMs = 100;
      const EPSILON = 100; // scheduler + microtask + chain-exhaustion overhead

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => silent,
        createFallbackStream: () => silent,
        fallbackChain: ['fb1'],
        silenceMs,
        hardDeadlineMs,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Advance past silenceMs (fallback #1 created) + hardDeadlineMs
      // (race 2 times out) + slack for the chain-exhaustion throw.
      // Eagerly register matcher BEFORE advancing timers: the chain-exhausted throw
      // leaks as an unhandled rejection when this microtask slips past the await-expect
      // matcher under mock timers (chain-walks slowed by the abortable() factory wrapper).
      const chainExhaustedMatcher = expect(firstP).rejects.toThrow(/Concurrent fallback: chain exhausted/);
      await vi.advanceTimersByTimeAsync(silenceMs + hardDeadlineMs + EPSILON);

      // The chain has been exhausted (only 1 entry); the generator throws.
      await chainExhaustedMatcher;
    } finally {
      vi.useRealTimers();
    }
  });

  it('walks the chain to fallback #2 when fallback #1 stalls past hardDeadlineMs', async () => {
    // Chain-walking happy path: fallback #1 times out, fallback #2 is fired
    // in parallel with the still-in-flight primary; fallback #2 produces a
    // chunk and wins the race.
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const fb1 = makeControllable<number>(); // stalls forever
      const fb2 = makeControllable<number>(); // produces a chunk after creation
      const silenceMs = 30;
      const hardDeadlineMs = 100;
      const factoryCalls: string[] = [];
      const onFallbackWin = vi.fn();

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: (p) => {
          factoryCalls.push(p);
          if (p === 'fb1') return fb1;
          if (p === 'fb2') return fb2;
          throw new Error(`unexpected provider: ${p}`);
        },
        fallbackChain: ['fb1', 'fb2'],
        silenceMs,
        hardDeadlineMs,
        onFallbackWin,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Advance past silenceMs → fb1 created (chain iteration 0 begins).
      await vi.advanceTimersByTimeAsync(silenceMs + 5);

      // Advance past hardDeadlineMs → fb1 timed out, fb2 created
      // (chain iteration 1 begins).
      await vi.advanceTimersByTimeAsync(hardDeadlineMs + 5);

      // fb2 produces a chunk.
      fb2.push(99);
      fb2.end();

      const first = await firstP;
      expect(first.done).toBe(false);
      expect(first.value).toBe(99);

      for await (const _ of iter) { /* drain */ }

      // Both factories should have been called in chain order.
      expect(factoryCalls).toEqual(['fb1', 'fb2']);
      expect(onFallbackWin).toHaveBeenCalledTimes(1);
      expect(onFallbackWin).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'fb2', index: 1 }),
      );
      // fb1 should have been aborted (timed out).
      expect(fb1.aborted).toBe(true);
      // fb2 should NOT have been aborted (winner).
      expect(fb2.aborted).toBe(false);
      // Primary should have been aborted (loser).
      expect(primary.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits primary as winner when primary produces a chunk during the fallback chunk race (chain-walk sanity)', async () => {
    // Sanity check: chain walking does NOT break the original
    // primary-wins-during-race behavior. Primary produces a chunk during
    // the chunk race for fallbackA (the chain's first entry); primary
    // wins, fallbackA aborted, no further chain entries attempted.
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>(); // stalls forever
      const silenceMs = 30;
      // Long enough that primary produces first instead of timing out.
      const hardDeadlineMs = 1000;
      const onFallbackWin = vi.fn();
      const onLoser = vi.fn();
      const factoryCalls: string[] = [];

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: (p) => {
          factoryCalls.push(p);
          return fallback;
        },
        // Don't override fallbackChain — use the mocked
        // getConfiguredFallbackChain('primary') which returns
        // ['fallbackA', 'fallbackB'].
        silenceMs,
        hardDeadlineMs,
        onFallbackWin,
        onLoser,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();

      // Advance to silenceMs + 5ms so fallbackA is created and the
      // chunk race is in flight — both primary.next() and
      // fallbackA.next() are pending, and the hardDeadlineMs timer is
      // registered.
      await vi.advanceTimersByTimeAsync(silenceMs + 5);

      // Primary produces a chunk during the fallback chunk race.
      primary.push(99);
      primary.end();

      const first = await firstP;
      expect(first.done).toBe(false);
      expect(first.value).toBe(99);

      for await (const _ of iter) { /* drain */ }

      // Primary wins → fallbackA is the loser, fallbackB is never tried.
      expect(onFallbackWin).not.toHaveBeenCalled();
      expect(onLoser).toHaveBeenCalledTimes(1);
      expect(onLoser).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'fallbackA',
          source: 'fallback',
          index: 0,
        }),
      );
      expect(factoryCalls).toEqual(['fallbackA']);
      expect(fallback.aborted).toBe(true);
      expect(primary.aborted).toBe(false); // primary won
    } finally {
      vi.useRealTimers();
    }
  });

  // ── recordCall wiring tests (derank loop) ────────────────────────
  // Verify that each warn-log site in the chain-walk loop feeds
  // recordCall(...) with the right provider/latencyMs/errorType so
  // the derank-by-bad-calls loop in llm-provider-health can move
  // stalling/failing fallback providers to the tail of the configured
  // chain on subsequent requests.

  it('records a setup-fail bad call when the fallback factory throws', async () => {
    _resetHealthForTests();
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const silenceMs = 30;
      const hardDeadlineMs = 100;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => {
          throw new Error('fallback setup failed');
        },
        fallbackChain: ['fallbackA'],
        silenceMs,
        hardDeadlineMs,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      const chainExhaustedMatcher = expect(firstP).rejects.toThrow(/Concurrent fallback: chain exhausted/);
      await vi.advanceTimersByTimeAsync(silenceMs + hardDeadlineMs + 50);

      // Chain has been exhausted (single fallback threw on setup).
      await chainExhaustedMatcher;

      const calls = _getCallsForTests('fallbackA');
      expect(calls).toHaveLength(1);
      expect(calls[0].ok).toBe(false);
      expect(calls[0].latencyMs).toBe(0);
      expect(calls[0].errorType).toBe('setup-fail');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a stall bad call when fallback stalls past hardDeadlineMs', async () => {
    _resetHealthForTests();
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const stalled = makeControllable<number>(); // never produces
      const silenceMs = 30;
      const hardDeadlineMs = 80;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => stalled,
        fallbackChain: ['stalling-fb'],
        silenceMs,
        hardDeadlineMs,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      const chainExhaustedMatcher = expect(firstP).rejects.toThrow(/Concurrent fallback: chain exhausted/);
      await vi.advanceTimersByTimeAsync(silenceMs + hardDeadlineMs + 50);

      await chainExhaustedMatcher;

      const calls = _getCallsForTests('stalling-fb');
      expect(calls).toHaveLength(1);
      expect(calls[0].ok).toBe(false);
      expect(calls[0].latencyMs).toBe(hardDeadlineMs);
      expect(calls[0].errorType).toBe('stall');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records an error bad call when the fallback stream errors before producing', async () => {
    _resetHealthForTests();
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const failing = makeControllable<number>();
      const silenceMs = 30;
      const hardDeadlineMs = 500;

      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => failing,
        fallbackChain: ['erroring-fb'],
        silenceMs,
        hardDeadlineMs,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      await vi.advanceTimersByTimeAsync(silenceMs + 5);
      // Register matcher BEFORE failing.fail — the fail() triggers the factory reject
      // path which walks the chain to exhaustion; firstP then rejects inside the await.
      const chainExhaustedMatcher = expect(firstP).rejects.toThrow(/Concurrent fallback: chain exhausted/);
      failing.fail(new Error('fallback authorization failed'));
      await vi.advanceTimersByTimeAsync(10);

      await chainExhaustedMatcher;

      const calls = _getCallsForTests('erroring-fb');
      expect(calls).toHaveLength(1);
      expect(calls[0].ok).toBe(false);
      expect(calls[0].latencyMs).toBe(0);
      expect(calls[0].errorType).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('records the fallback as a successful call when the primary wins the race', async () => {
    _resetHealthForTests();
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      const fallback = makeControllable<number>(); // never produces
      const silenceMs = 30;
      const hardDeadlineMs = 500;

      const onLoser = vi.fn();
      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs,
        hardDeadlineMs,
        onLoser,
      });

      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      await vi.advanceTimersByTimeAsync(silenceMs + 5);
      primary.push(99);
      primary.end();

      const first = await firstP;
      expect(first.value).toBe(99);
      for await (const _ of iter) { /* drain */ }

      // Sanity: primary did win (fallback was the loser).
      expect(onLoser).toHaveBeenCalledTimes(1);
      expect(onLoser).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'fallbackA', source: 'fallback' }),
      );

      // Gating regression: the fallback is recorded as a SUCCESSFUL call.
      // isBadCall only flags records where `!ok || latencyMs > SLOW_CALL_THRESHOLD_MS`,
      // so a fast loser is NOT counted as a bad call. This prevents a
      // perfectly healthy fallback from being demoted just because it lost
      // a coin flip against a faster primary. No errorType is attached on
      // an ok=true record (errorType is reserved for actual failures).
      const calls = _getCallsForTests('fallbackA');
      expect(calls).toHaveLength(1);
      expect(calls[0].ok).toBe(true);
      expect(calls[0].errorType).toBeUndefined();
      expect(calls[0].latencyMs).toBeGreaterThan(0);
      expect(calls[0].latencyMs).toBeLessThan(SLOW_CALL_THRESHOLD_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT count a fast lost-race against shouldDeprioritize (gating regression)', async () => {
    // Regression for the over-penalization flagged by the code reviewer:
    // the original 'lost-race' wire recorded every primary-wins race as a
    // bad call for the fallback. After gating via success=true, a fast
    // loser must NOT contribute to the rolling bad-call count used by
    // shouldDeprioritize(). Otherwise a perfectly functional fallback
    // would be demoted after a few races just because the primary was
    // marginally faster. The legitimate bad-call path (ok=false records
    // from setup-fail / stall / error) is already covered by the three
    // sibling recordCall wiring tests above, so this test focuses
    // exclusively on the gating fix.
    _resetHealthForTests();
    vi.useFakeTimers();
    try {
      // Run DEPRIORITIZE_AFTER_COUNT+ lost-races (each fast, well under
      // SLOW_CALL_THRESHOLD_MS). The fallback MUST remain healthy despite
      // accumulating raced-but-lost records.
      for (let i = 0; i < 5; i++) {
        const primary = makeControllable<number>();
        const fallback = makeControllable<number>(); // never produces
        const silenceMs = 30;
        const hardDeadlineMs = 500;

        const gen = coordinateConcurrentFallback({
          primaryProvider: 'primary',
          model: 'm',
          createPrimaryStream: () => primary,
          createFallbackStream: () => fallback,
          silenceMs,
          hardDeadlineMs,
        });

        const iter = gen[Symbol.asyncIterator]();
        const firstP = iter.next();
        await vi.advanceTimersByTimeAsync(silenceMs + 5);
        primary.push(i);
        primary.end();

        await firstP;
        for await (const _ of iter) { /* drain */ }
      }

      // 5 lost-race calls recorded, but shouldDeprioritize MUST stay false
      // because each is ok=true with latencyMs << SLOW_CALL_THRESHOLD_MS —
      // none of them satisfy isBadCall, so the rolling bad-call count
      // stays at 0 well below DEPRIORITIZE_AFTER_COUNT=3.
      const calls = _getCallsForTests('fallbackA');
      expect(calls).toHaveLength(5);
      expect(calls.every((c) => c.ok === true)).toBe(true);
      expect(calls.every((c) => c.errorType === undefined)).toBe(true);
      expect(calls.every((c) => c.latencyMs < SLOW_CALL_THRESHOLD_MS)).toBe(true);
      expect(shouldDeprioritize('fallbackA')).toBe(false);
      // And getHealthScore (=good/total) must remain at 1.0 since every
      // recorded call was good under isBadCall.
      expect(getHealthScore('fallbackA')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * PR-B race-cleanup regression tests.
 *
 * Verifies that `coordinateConcurrentFallback` and the helper
 * `raceWithTimeout` no longer leak setTimeout handles or
 * AbortSignal listeners after each Promise.race resolves. With the
 * `ENABLE_FALLBACK_RACE_CLEANUP` flag (default ON), every race captures
 * its timer + listener in outer scope and clears both via a `.finally()`
 * chained to the race.
 *
 * T-B1: no leaked setTimeout after the primary wins the silence-vs-primary race.
 * T-B2: no leaked setTimeout after the fallback wins the same race.
 * T-B3: no leaked setTimeout after the user-aborts during a race.
 * T-B4: no leaked AbortSignal listener after each race resolves.
 * T-B5: raceWithTimeout's timer is cleared even on the rejection path.
 *
 * Note: tests use the same `vi.useFakeTimers()` pattern as the existing
 * tests in this file so they slot in cleanly. The race coordinator's
 * `for-await` pattern tracks timer setup via the timestamp the listener
 * was added to the symbol — vitest's `vi.getTimerCount()` is the source
 * of truth.
 */
describe('PR-B race-cleanup regression (llm-fallback-coordinator)', () => {
  beforeEach(() => {
    // Default ON: do not delete process.env.ENABLE_FALLBACK_RACE_CLEANUP.
    // Each test exercises the flag-on path (the default behavior). Rollback
    // path (`ENABLE_FALLBACK_RACE_CLEANUP=0`) disables cleanup; we don't
    // test that explicitly because the existing tests already cover all
    // observable behavior — the flag only controls cleanup.
  });

  it('T-B1: no leaked setTimeout after primary wins the silence-vs-primary race', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      primary.push(99);
      primary.end();
      const unusedFactory = () => {
        throw new Error('fallback factory must not run when primary wins');
      };
      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: unusedFactory,
        silenceMs: 1000,
      });
      // Drain completely.
      for await (const _ of gen) { /* drain */ }
      // Primary produced before silenceMs — no fallback was created and no
      // chunk race ran. Only the silence-vs-primary race fired, and its
      // timer should be cleared (via the .finally() cleanup hook).
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-B2: no leaked setTimeout after fallback wins the chunk race (per-fallback hardDeadline cleaned up)', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>(); // never produces
      const fallback = makeControllable<number>();
      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        silenceMs: 30,
        hardDeadlineMs: 200,
      });
      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      // Advance past silenceMs so the fallback is created and the chunk
      // race begins. Both arms and the hardDeadline timer are now armed.
      await vi.advanceTimersByTimeAsync(40);
      // Fallback produces a chunk and wins.
      fallback.push(42);
      fallback.end();
      const first = await firstP;
      expect(first.value).toBe(42);
      for await (const _ of iter) { /* drain */ }
      // No timers should remain — chunk-race timer cleared via .finally().
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-B3: no leaked setTimeout after user-abort during either race', async () => {
    vi.useFakeTimers();
    try {
      // To exercise BOTH race-site .finally() cleanups, we abort AFTER
      // silenceMs elapses (so the fallback is created) and DURING the
      // chunk race (race site 2). This way both `firstRaceTimer` (race
      // site 1) and `race2Timer` (race site 2) are armed when we abort,
      // and BOTH handles' abort() paths fire.
      const primary = makeControllable<number>(); // never produces
      const fallback = makeControllable<number>(); // never produces
      const controller = new AbortController();
      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => fallback,
        signal: controller.signal,
        silenceMs: 50,
        hardDeadlineMs: 500,
      });
      const iter = gen[Symbol.asyncIterator]();
      const firstP = iter.next();
      // Advance past silenceMs so the fallback is created and the
      // chunk race begins — both race timers are now armed.
      await vi.advanceTimersByTimeAsync(70);
      // Abort DURING the chunk race. Both the chunk-race `.finally()` and
      // the abort-listener removal fire.
      controller.abort();
      // Advance further so any pending timers settle.
      await vi.advanceTimersByTimeAsync(20);
      for await (const _ of iter) { /* empty */ }
      await firstP.catch(() => { /* may reject on abort */ });
      // PR-B guarantee: every race's setTimeout cleared and listener
      // removed. No orphaned timers.
      expect(vi.getTimerCount()).toBe(0);
      // Both handles must have been aborted by the coordinator.
      expect(primary.aborted).toBe(true);
      expect(fallback.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-B4: no leaked AbortSignal listener on signal after each race resolves', async () => {
    vi.useFakeTimers();
    try {
      const primary = makeControllable<number>();
      primary.push(1);
      primary.end();
      const controller = new AbortController();
      // Track listener count via a wrapper around addEventListener.
      const originalAdd = controller.signal.addEventListener.bind(controller.signal);
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
      let liveListeners = 0;
      let peakListeners = 0;
      controller.signal.addEventListener = (type: string, listener: any, opts?: any) => {
        if (type === 'abort') {
          liveListeners += 1;
          if (liveListeners > peakListeners) peakListeners = liveListeners;
        }
        return originalAdd(type, listener, opts);
      };
      controller.signal.removeEventListener = (type: string, listener: any, opts?: any) => {
        if (type === 'abort') {
          liveListeners -= 1;
        }
        return originalRemove(type, listener, opts);
      };
      const gen = coordinateConcurrentFallback({
        primaryProvider: 'primary',
        model: 'm',
        createPrimaryStream: () => primary,
        createFallbackStream: () => {
          throw new Error('factory must not run when primary produced before silenceMs');
        },
        signal: controller.signal,
        silenceMs: 1000,
      });
      for await (const _ of gen) { /* drain */ }
      // After every race resolves, the PR-B .finally() should remove
      // any abort listeners attached by the coordinator.
      expect(liveListeners).toBe(0);
      // Sanity: at least one listener was added and then removed during
      // the silence-vs-primary race. (If peakListeners stayed 0 the test
      // accidentally skipped the cleanup path.)
      expect(peakListeners).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T-B5: raceWithTimeout timer is cleared even when the timeout wins (rejection path)', async () => {
    vi.useFakeTimers();
    try {
      // The only way to exercise `raceWithTimeout` publicly is through
      // `drainIterator`, which `coordinateConcurrentFallback` invokes when
      // `idleTimeoutPerChunkMs` is set and the silence-vs-primary race
      // resolution path reaches drain. We pick a primary that NEVER
      // produces and `idleTimeoutPerChunkMs: 50`; the first .next() call
      // races against a 50ms timer that must fire before the test
      // mock-clock advances.
      const primary = makeControllable<number>(); // never produces

      // Fire-and-forget the coordinator. Inside drainIterator,
      // raceWithTimeout(it.next(), 50) is awaiting the never-resolving
      // primary.next() against a 50ms setTimeout. The Promise.race will
      // resolve by reject (timer wins). drainIterator's await throws
      // IdleTimeoutError, the for-await catches it, and the async IIFE
      // resolves with the caught error.
      const errorP = (async () => {
        try {
          for await (const _ of coordinateConcurrentFallback({
            primaryProvider: 'no-chain',
            model: 'm',
            createPrimaryStream: () => primary,
            createFallbackStream: () => { throw new Error('unused'); },
            silenceMs: 0, // disables coordinator; just exercises drainIterator
            idleTimeoutPerChunkMs: 50,
          })) { /* drain */ }
          return null;
        } catch (err) {
          return err as Error;
        }
      })();

      // Yield microtasks so drainIterator reaches raceWithTimeout and
      // registers the 50ms setTimeout.
      await Promise.resolve();
      await Promise.resolve();

      // Advance the fake clock past 50ms so the idle-timeout timer
      // fires. raceWithTimeout's try/finally will clear the timer
      // BEFORE the rejection propagates out.
      await vi.advanceTimersByTimeAsync(80);

      const err = await errorP;
      // The thrown error must be IdleTimeoutError — confirming we
      // actually exercised raceWithTimeout.
      expect(err).not.toBeNull();
      expect((err as Error).name).toBe('IdleTimeoutError');
      // PR-B guarantee: the timer was cleared in the try/finally block,
      // so vi.getTimerCount() reports 0 even after the rejection path.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
