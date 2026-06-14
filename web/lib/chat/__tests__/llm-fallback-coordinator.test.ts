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

vi.mock('../providers/provider-fallback-chains', () => ({
  getConfiguredFallbackChain: vi.fn((provider: string) => {
    if (provider === 'primary') return ['fallbackA', 'fallbackB'];
    return [];
  }),
}));

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { coordinateConcurrentFallback } from '../llm-fallback-coordinator';

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

  const gen = (async function* () {
    while (true) {
      if (failed !== null) throw failed;
      // Always wait on a pending resolved-by-push promise; if push was
      // called before the consumer started iterating, the deferred was
      // pre-resolved and resolves immediately on await.
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
      const d = deferred<IteratorResult<T>>();
      d.resolve({ value: item, done: false });
      pending = d;
    },
    end: () => {
      ended = true;
      if (pending) {
        pending.resolve({ value: undefined as any, done: true });
        pending = null;
      } else {
        const d = deferred<IteratorResult<T>>();
        d.resolve({ value: undefined as any, done: true });
        pending = d;
      }
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

      const results: number[] = [];
      for await (const item of iter) results.push(item);
      await firstP;

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
});
