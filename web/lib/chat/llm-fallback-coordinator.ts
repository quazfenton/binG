/**
 * Concurrent LLM Fallback Coordinator
 *
 * Coordinates parallel fallback for streaming LLM calls. After the primary
 * stream has been silent for `silenceMs`, the next provider in the configured
 * fallback chain is fired in parallel. Whichever stream emits a chunk first
 * wins; the loser's abort handle is fired immediately so the network request
 * is cancelled and API credits are not wasted.
 *
 * Differences from the in-place `withSpeculativeFallback` in
 * `vercel-ai-streaming.ts`:
 *   - This module is generic (works with any AsyncGenerator<T>, not just
 *     Vercel AI SDK streams).
 *   - This module resolves the fallback chain from
 *     `getConfiguredFallbackChain(primaryProvider)` by default (so it picks
 *     up the self-correcting derank loop in `llm-provider-health.ts`).
 *   - This module has its own internal hard-deadline machinery — it does
 *     NOT delegate TTFT/idle budgets to the underlying stream factories.
 *     See the chain-walking note below.
 *
 * Design notes:
 *   - BOTH factories return `{ gen, abort }` so the coordinator can truly
 *     cancel the loser's underlying network request. The factories are
 *     responsible for wiring an AbortController (or equivalent) into the
 *     stream and returning the abort function. This is essential: without
 *     it, the user's "cancel the loser" requirement would be partially
 *     unmet (the fallback can be aborted, but the primary cannot).
 *   - The factories are invoked lazily: the FIRST fallback is NOT created
 *     until the primary has been silent for `silenceMs`. This avoids
 *     unnecessary work and API-credit usage on the common case where the
 *     primary responds promptly.
 *   - Chain walking: after the silence race times out, the coordinator
 *     iterates `fallbackChain` from index 0 to `length-1`, RACING each
 *     fallback against the still-in-flight primary with a per-iteration
 *     `hardDeadlineMs` (default 30 s) ceiling. If a fallback stalls past
 *     `hardDeadlineMs` (or errors, or fails to set up), the coordinator
 *     aborts it and walks to the next entry. If the chain is exhausted
 *     without any provider producing a chunk within its budget, the
 *     generator throws. This bounds the worst-case stall to
 *     `chain.length * hardDeadlineMs` and is the bug fix for the
 *     ninerouter-class scenario where every fallback stalls past the
 *     silence-on-primary timeout (Bug #86 regression).
 *
 * @see getConfiguredFallbackChain for the self-correcting chain source
 * @see llm-provider-health for the derank-by-bad-calls heuristic
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getConfiguredFallbackChain } from '../providers/provider-fallback-chains';
import { recordCall } from './llm-provider-health';
// PR-C — opt-in 530-blacklist reset on success (flag default OFF). See provider-530-tracker.ts for details.
import { maybeReset530OnSuccess } from '../orchestra/provider-530-tracker';
// PR-E: 5xx success-side reset paired at the chunk-race loser-success site.
import { maybeResetServerErrorOnSuccess } from '../orchestra/provider-server-error-tracker';
import { createLogger } from '../utils/logger';

const logger = createLogger('LLM:FallbackCoordinator');

/**
 * A handle to a stream + its abort function. The abort function must
 * cancel the underlying network request (typically by firing an
 * AbortController whose signal is wired into the stream).
 */
export interface StreamHandle<T> {
  gen: AsyncGenerator<T>;
  abort: () => void;
}

/**
 * Factory that returns a stream handle. May be sync (returning a handle
 * directly) or async (returning a Promise<handle>). Takes no arguments
 * — used for the primary stream.
 */
export type StreamHandleFactory<T> =
  | (() => StreamHandle<T>)
  | (() => Promise<StreamHandle<T>>);

/**
 * Factory that returns a stream handle for a specific fallback provider.
 * Receives the provider name (and optionally a model) so the factory can
 * resolve provider-specific credentials and base URLs. May be sync or
 * async. Used for the fallback stream.
 */
export type ProviderStreamHandleFactory<T> =
  | ((provider: string) => StreamHandle<T>)
  | ((provider: string) => Promise<StreamHandle<T>>);

export interface ConcurrentFallbackOptions<T> {
  /** Primary provider name (for telemetry + chain resolution). */
  primaryProvider: string;
  /** Model name (for telemetry only). */
  model: string;
  /** Factory to create the primary stream handle. */
  createPrimaryStream: StreamHandleFactory<T>;
  /** Factory to create a stream handle for a specific fallback provider. */
  createFallbackStream: ProviderStreamHandleFactory<T>;
  /**
   * Ordered list of fallback providers to try. The first entry is fired
   * in parallel after `silenceMs` of no chunks on the primary; the first
   * stream to emit a chunk wins. Defaults to
   * `getConfiguredFallbackChain(primaryProvider)`.
   */
  fallbackChain?: string[];
  /**
   * Silence threshold (ms) to fire the first fallback. Default 20000 (20s).
   * Set to 0 to disable the coordinator entirely (the primary will be
   * iterated without any parallel fallback).
   */
  silenceMs?: number;
  /**
   * Per-fallback hard deadline (ms) — the maximum wall-clock time the
   * coordinator will wait for any single fallback stream to emit its first
   * chunk before aborting that fallback and walking to the next entry in
   * `fallbackChain`. Defaults to 30_000. The coordinator applies this
   * ceiling per fallback iteration, NOT as a cumulative chain-wide budget
   * — long chains therefore measure in roughly
   * `chain.length * hardDeadlineMs` end-to-end in the worst case. If the
   * chain is exhausted without any provider producing a chunk within its
   * budget, the generator throws (the caller is responsible for
   * surfacing the throw to the user as a streamed error).
   */
  hardDeadlineMs?: number;
  /**
   * Idle timeout per chunk (ms). After yielding a chunk, if the next chunk
   * does not arrive within this window the stream is treated as stalled and
   * the coordinator walks to the next fallback in the chain. Defaults to
   * undefined (no idle timeout — relies solely on the route-level stall
   * watchdog and SDK timeouts).
   */
  idleTimeoutPerChunkMs?: number;
  /** User's abort signal. Forwarded to both streams' iteration loops. */
  signal?: AbortSignal;
  /** Optional request ID for log correlation. */
  requestId?: string;
  /**
   * Called when a fallback wins the race. Latency is measured from when
   * the fallback factory was invoked (not from when the timeout fired).
   */
  onFallbackWin?: (info: { provider: string; index: number; latencyMs: number }) => void;
  /**
   * Called whenever a loser is determined. `source` is `'primary'` when
   * the primary lost (fallback won) or `'fallback'` when the fallback
   * lost (primary won). `index` is -1 for the primary; otherwise it's
   * the position in `fallbackChain` (0 for the first fallback).
   */
  onLoser?: (info: {
    provider: string;
    source: 'primary' | 'fallback';
    index: number;
    latencyMs: number;
  }) => void;
}

const DEFAULT_SILENCE_MS = 20000;

/**
 * Default per-fallback hard deadline (ms) — the maximum wall-clock time the
 * coordinator will wait for any SINGLE fallback stream to produce its first
 * chunk. If a fallback stalls past this deadline the coordinator aborts it
 * and walks to the next entry in the configured fallback chain. If the chain
 * is exhausted without any provider producing a chunk within its budget, the
 * generator throws — this is the bug fix for the wedged-request regression
 * where `ninerouter` (and any other in-cluster provider that hits a stuck
 * edge) would leave the secondary Promise.race (primary vs. fallback #1)
 * dangling indefinitely, defeating every other abort/fallback mechanism.
 *
 * Picked at 30_000 ms to match `STREAM_TIMEOUTS.firstTokenTimeoutMs` from
 * `vercel-ai-streaming.ts` so users see consistent per-stream TTFT semantics
 * across both fallback paths. The coordinator applies this ceiling per
 * fallback iteration (NOT as a cumulative chain-wide budget); a chain of
 * length N therefore measures `chain.length * hardDeadlineMs` end-to-end
 * in the worst case. Override per-call via `hardDeadlineMs`.
 */
const DEFAULT_HARD_DEADLINE_MS = 30000;

/**
 * Discriminated union for the first-race result (primary chunk vs silence
 * timeout). Errors are also represented here so they can be surfaced.
 */
type FirstRaceResult<T> =
  | { kind: 'chunk'; value: IteratorResult<T> }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'primary-error'; error: unknown };

/**
 * Discriminated union for the post-fallback-creation race result.
 *
 * New kinds (vs the original two-arm race):
 *   - `fallback-timeout`: the per-fallback hard-deadline timer fired before
 *     either side produced a chunk. The coordinator aborts the current
 *     fallback and walks to the next entry in the chain. `provider` and
 *     `index` are populated so the warning log surfaces WHICH fallback
 *     stalled (useful for per-provider derank decisions).
 *   - `aborted`: the user's `signal` aborted during the race. We abort
 *     both streams and exit.
 */
type ChunkRaceResult<T> =
  | { kind: 'chunk'; value: T; source: 'primary' | 'fallback' }
  | { kind: 'fallback-timeout'; provider: string; index: number }
  | { kind: 'aborted' }
  | { kind: 'primary-error'; error: unknown }
  | { kind: 'fallback-error'; error: unknown };

/**
 * Coordinate a primary stream against a parallel fallback. See the
 * module-level JSDoc for the full algorithm. This is a generic async
 * generator that yields whatever the underlying streams yield.
 *
 * Throws nothing for normal fallback failures (fallback setup error,
 * fallback stream error after a winner was already determined). The
 * primary stream's errors propagate normally.
 */
export async function* coordinateConcurrentFallback<T>(
  options: ConcurrentFallbackOptions<T>,
): AsyncGenerator<T> {
  const {
    primaryProvider,
    model,
    createPrimaryStream,
    createFallbackStream,
    signal,
    silenceMs = DEFAULT_SILENCE_MS,
    hardDeadlineMs = DEFAULT_HARD_DEADLINE_MS,
    idleTimeoutPerChunkMs,
    requestId = `coord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    onFallbackWin,
    onLoser,
  } = options;

  // User already aborted: don't even start the primary.
  if (signal?.aborted) {
    throw new Error('Concurrent fallback: caller aborted before start');
  }

  // Coordinator disabled: just iterate the primary.
  if (silenceMs <= 0) {
    let handle: StreamHandle<T>;
    try {
      handle = await abortable(
        Promise.resolve(createPrimaryStream()),
        signal,
        'Concurrent fallback: primary setup aborted (silenceMs disabled)',
      );
    } catch (err) {
      if (isAbortError(err, signal)) {
        logger.debug('Concurrent fallback: primary setup aborted (silenceMs disabled)', { primaryProvider, model, requestId });
        return;
      }
      throw err;
    }
    yield* drainIterator(handle.gen, signal, idleTimeoutPerChunkMs);
    return;
  }

  // Resolve fallback chain. Empty chain → just iterate primary.
  const chain =
    options.fallbackChain ?? getConfiguredFallbackChain(primaryProvider);
  if (chain.length === 0) {
    logger.debug('Concurrent fallback: no fallbacks configured for primary; delegating to primary', {
      primaryProvider,
      model,
      requestId,
    });
    let handle: StreamHandle<T>;
    try {
      handle = await abortable(
        Promise.resolve(createPrimaryStream()),
        signal,
        'Concurrent fallback: primary setup aborted (no fallbacks)',
      );
    } catch (err) {
      if (isAbortError(err, signal)) {
        logger.debug('Concurrent fallback: primary setup aborted by user (no fallbacks)', { primaryProvider, model, requestId });
        return;
      }
      throw err;
    }
    yield* drainIterator(handle.gen, signal, idleTimeoutPerChunkMs);
    return;
  }

  // Start primary.
  const primaryHandle = await createPrimaryStream();
  const primaryIt = primaryHandle.gen[Symbol.asyncIterator]();

  // Capture the primary chunk promise at start so the chain walk can
  // REUSE it instead of calling `primaryIt.next()` a second time. This
  // matters because async-generator `.next()` calls are FIFO-paired with
  // the gen's successive resolutions: the FIRST `.next()` is paired with
  // the gen's first yield; if the gen then returns/throws, the SECOND
  // `.next()` gets `{value:undefined, done:true}` rather than a second
  // chunk. Concretely, calling `.next()` twice would manifest as the
  // chain walk's race arm receiving `'primary stream done before
  // producing'` immediately, even though the primary stream is still
  // producing data — and wedge the request indefinitely.
  const primaryPromiseAtStart: Promise<IteratorResult<T>> = primaryIt.next();

  // Cache the first primary result so if the timeout fires between
  // primary.next() resolving and the race starting, we don't orphan
  // (lose) that chunk.
  let firstPrimaryResult: IteratorResult<T> | null = null;

  // Race: first primary chunk vs silenceMs timeout vs user abort.
  let firstRaceTimer: NodeJS.Timeout | undefined;
  let firstRaceAbortListener: (() => void) | undefined;
  const first: FirstRaceResult<T> = await Promise.race([
    primaryPromiseAtStart
      .then((r): FirstRaceResult<T> => {
        firstPrimaryResult = r;
        return { kind: 'chunk', value: r };
      })
      .catch((err): FirstRaceResult<T> => ({ kind: 'primary-error', error: err })),
    new Promise<FirstRaceResult<T>>((resolve) => {
      firstRaceTimer = setTimeout(
        () => resolve({ kind: 'timeout' }),
        silenceMs,
      );
      if (signal) {
        firstRaceAbortListener = () => {
          if (firstRaceTimer) clearTimeout(firstRaceTimer);
          firstRaceTimer = undefined;
          resolve({ kind: 'aborted' });
        };
        signal.addEventListener('abort', firstRaceAbortListener, { once: true });
      }
    }),
  ]).finally(() => {
    if (FALLBACK_RACE_CLEANUP_ENABLED) {
      if (firstRaceTimer) clearTimeout(firstRaceTimer);
      if (signal && firstRaceAbortListener) signal.removeEventListener('abort', firstRaceAbortListener);
    }
  });

  if (first.kind === 'primary-error') {
    throw first.error;
  }

  if (first.kind === 'chunk') {
    // Primary produced a chunk before silenceMs — yield and continue.
    if (first.value && !first.value.done) {
      yield first.value.value;
    }
    yield* drainIterator(primaryIt, signal, idleTimeoutPerChunkMs);
    return;
  }

  if (first.kind === 'aborted') {
    // User aborted during the silence race — primary is still running but
    // the caller doesn't want the result. Abort primary and return.
    primaryHandle.abort();
    return;
  }

  // first.kind === 'timeout' — primary was silent for `silenceMs`. Walk
  // the configured fallback chain, racing each entry against the
  // still-in-flight primary with a per-fallback hard deadline. If the
  // fallback stalls past `hardDeadlineMs` (or errors, or fails to set up),
  // we abort it and walk to the next entry. This is the chain-walking
  // upgrade to the original "fire ONE parallel fallback" semantics — see
  // the module-level docstring for the regression context.
  if (signal?.aborted) {
    primaryHandle.abort();
    return;
  }

  // Cross-iteration cache for primary chunks. We initialize from the
  // first race's resolved result if available, and update this whenever
  // a primary chunk resolves during a fallback race so the next race can
  // use the cached value instead of calling `primaryIt.next()` again.
  //
  // Critical correctness detail: we must NOT call `primaryIt.next()` more
  // than once per actual produced chunk. Calling `.next()` twice would
  // orphan the first promise's chunk by advancing the iterator past it
  // while the first awaiter is still pending. `pendingPrimary` therefore
  // shares a single promise across iterations that haven't yet consumed
  // the chunk, so a chunk that races after a fallback-timeout is
  // preserved for the next iteration rather than lost.
  // `primaryChunkCache` may regrow with the same value across iterations.
  // When we consume the cache in race N (the sidecar `.then` then fires
  // and re-arms `primaryChunkCache` from the same resolved Promise), the
  // race arm in iteration `N+1` would see the cached chunk again — but
  // this is harmless: `drainIterator` is the only path that actually
  // advances the primary iterator (via subsequent `.next()` calls),
  // so chunks are correctly drained after a winner commit. The degenerate
  // case is "all fallbacks time out" where the cached chunk is never
  // yielded — acceptable because that branch throws chain-exhausted
  // anyway. Do NOT "fix" this by adding another `.next()` call: a
  // second `.next()` would tilt the gen's FIFO-pairing and reintroduce
  // the deadlock Bug #86 fixed at `primaryPromiseAtStart`.
  let primaryChunkCache: IteratorResult<T> | null = firstPrimaryResult;
  // Reuse race 1's primary promise for the chain walk — do NOT call
  // `primaryIt.next()` again here. See the comment on
  // `primaryPromiseAtStart` above for why a second `.next()` would tilt
  // the FIFO-pairing against the consumer (the gen's RETURN-done would
  // be paired with our chain-walk race arm).
  let pendingPrimary: Promise<IteratorResult<T>> | null = primaryPromiseAtStart;

  for (let fallbackIndex = 0; fallbackIndex < chain.length; fallbackIndex++) {
    // Defense-in-depth: re-check user signal between iterations.
    if (signal?.aborted) {
      primaryHandle.abort();
      return;
    }

    const fallbackProvider = chain[fallbackIndex];
    const raceStartTime = Date.now();
    let fallbackHandle: StreamHandle<T>;
    try {
      // Factory await wrapped in `abortable(...)` so a stalled setup
      // (OpenCode container spin-up, HTTP/2 SETUP hang) bails within
      // ~1s of user-initiated stop rather than hanging the chain walk
      // for the full setup duration.
      fallbackHandle = await abortable(
        Promise.resolve(createFallbackStream(fallbackProvider)),
        signal,
        'Concurrent fallback: fallback setup aborted',
      );
    } catch (err) {
      // User-initiated abort during fallback setup: do NOT walk to the
      // next provider — abort the still-in-flight primary and exit.
      if (isAbortError(err, signal)) {
        logger.warn('Concurrent fallback: fallback setup aborted by user; halting chain walk', {
          primaryProvider,
          fallbackProvider,
          fallbackIndex,
          model,
          requestId,
        });
        primaryHandle.abort();
        return;
      }
      logger.warn(
        'Concurrent fallback: setup failed, walking to next',
        {
          primaryProvider,
          fallbackProvider,
          fallbackIndex,
          model,
          requestId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      // Feed the derank-by-bad-calls loop in llm-provider-health so
      // providers whose fallback factories are broken get demoted on
      // subsequent requests via getConfiguredFallbackChain.
      recordCall(fallbackProvider, false, 0, 'setup-fail');
      continue;
    }
    const setupMs = Date.now() - raceStartTime;
    if (signal?.aborted) {
      fallbackHandle.abort();
      primaryHandle.abort();
      return;
    }
    const fallbackIt = fallbackHandle.gen[Symbol.asyncIterator]();

    // Build the primary chunk promise for this race iteration. Three
    // paths: (1) cache-consume when a prior iter pinned a non-done chunk,
    // (2) pendingPrimary-reuse when the previous iter's `.next()` is
    // still in flight (its resolution may yield a NEW chunk during this
    // race), or (3) fresh `.next()` when neither is available.
    //
    // PR-R — cache-sidecar scope fix (closes R1 + R3 + R4):
    //   R1 (re-pin staleness): the pre-PR-R sidecar was attached to
    //     `primaryChunkPromise` regardless of which path produced it.
    //     On path 1 (cache-consume), `Promise.resolve(primaryChunkCache)`
    //     fires the `.then(r => primaryChunkCache = r)` synchronously,
    //     RE-PINNING the same value. Every subsequent chain iteration
    //     then re-entered path 1, replayed the cached chunk, and any
    //     chunk the iterator actually produced in the meantime was
    //     orphaned (Bug #86 FIFO-pairing would re-emerge if a fresh
    //     `.next()` were issued while the prior pin was somehow still
    //     outstanding — the corner case behind the regression).
    //   R3 (infinite-loop chain walk): the failure-mode multiplier of
    //     R1. If the iterator stalls mid-drain (one chunk then blocks
    //     indefinitely), `drainIterator` throws `IdleTimeoutError` →
    //     `continue` → next iter re-enters path 1 with the same pinned
    //     cache → race resolves to `primary-error` → fallback wins →
    //     `drainIterator` on the new fallback stalls → `continue` →
    //     re-enter path 1 (cache still pinned from before) → … loop
    //     continues capped only by `chain.length * hardDeadlineMs`.
    //     /api/chat hangs. After PR-R, path 1 is excluded from the
    //     sidecar so the cache cannot re-pin itself across iterations.
    //   R4 (cache completion hardening): the pre-PR-R sidecar also
    //     pinned `done: true` entries into `primaryChunkCache`. Today
    //     `!primaryChunkCache.done` excludes them from replay, but as
    //     defense-in-depth against any future code path that loosens
    //     the check (e.g., a fast-path that skips the check entirely
    //     on assumption of "cache always means streaming"), PR-R clears
    //     the cache to `null` on `r.done === true` rather than pinning
    //     a sentinel entry.
    //
    // The fix: ONLY attach the sidecar on paths 2 + 3 (where a live
    // promise is outstanding and a new chunk can still resolve). Path 1
    // is excluded — its value is already known.
    let primaryChunkPromise: Promise<IteratorResult<T>>;
    if (primaryChunkCache !== null && !primaryChunkCache.done) {
      // Path 1: cache-consume. NO sidecar attached — re-attaching would
      // re-pin the same value (R1).
      primaryChunkPromise = Promise.resolve(primaryChunkCache);
      primaryChunkCache = null;
    } else if (pendingPrimary !== null) {
      // Path 2: pendingPrimary-reuse. Re-issuing `.next()` would tilt
      // the gen's FIFO-pairing against the consumer (Bug #86); the
      // outstanding `.next()` is reused as-is. Sidecar attached below.
      primaryChunkPromise = pendingPrimary;
    } else {
      // Path 3: fresh `.next()`. Sidecar attached below.
      pendingPrimary = primaryIt.next();
      primaryChunkPromise = pendingPrimary;
    }
    if (pendingPrimary !== null && primaryChunkPromise === pendingPrimary) {
      // Identity gate (post-fix vs leaky `pendingPrimary !== null`):
      //   - Path 1 (cache-consume) sets `primaryChunkPromise =
      //     Promise.resolve(primaryChunkCache)` — a fresh resolved
      //     promise whose reference is NOT `pendingPrimary`. The gate
      //     correctly excludes path 1 from receiving the sidecar,
      //     closing R1 (no re-pin of the cached value across iters).
      //   - Paths 2 (pendingPrimary-reuse) and 3 (fresh `.next()`)
      //     both make `primaryChunkPromise` reference-identical to
      //     `pendingPrimary`. The gate correctly attaches the sidecar
      //     so a chunk resolving during this race is captured for the
      //     next iter.
      // The first-iter boundary is the canary case: `pendingPrimary =
      // primaryPromiseAtStart` is non-null when iter 0 enters path 1,
      // so a `pendingPrimary !== null` gate alone leaks the re-pin.
      //
      // PR-R — R4 hardening: pin the cache only when the promise
      // resolves to a non-done chunk. A `done: true` resolution is the
      // gen's exhausted sentinel — clearing `primaryChunkCache` to
      // `null` here (rather than pinning the sentinel) means the next
      // chain iteration falls through to a fresh `.next()` and resolves
      // cleanly via `primary-error`, rather than being tricked into a
      // replay by a sentinel cache entry.
      pendingPrimary.then((r) => {
        primaryChunkCache = r.done ? null : r;
      });
      // PR-X — pendingPrimary reset (preserved): clear the pin slot on
      // resolve OR reject so the next chain iteration makes a fresh
      // decision. Single source of truth mirroring PR-H's
      // record-or-noop contract. The identity gate ensures this same
      // `pendingPrimary` reference — the one we wrote into in path 2
      // (reused) or path 3 (fresh-pinned) — is the one we now null out,
      // so a future iter can enter any of the three paths without a
      // stale pin poisoning its decision.
      pendingPrimary.finally(() => {
        pendingPrimary = null;
      });
    }

    // The chunk race for this fallback iteration has THREE arms:
    //   1. primary chunk (cached, shared, or fresh `primaryIt.next()`)
    //   2. fallback chunk (fresh `fallbackIt.next()`)
    //   3. hard deadline (per-fallback TTFT, default 30_000 ms)
    // If neither side produces a chunk within `hardDeadlineMs`, the race
    // resolves with `'fallback-timeout'` and we walk to the next entry.
    let race2Timer: NodeJS.Timeout | undefined;
    let race2AbortListener: (() => void) | undefined;
    const raceResult: ChunkRaceResult<T> = await Promise.race([
      primaryChunkPromise
        .then(
          (r): ChunkRaceResult<T> =>
            r.done
              ? {
                  kind: 'primary-error',
                  error: new Error('primary stream done before producing'),
                }
              : { kind: 'chunk', value: r.value, source: 'primary' },
        )
        .catch(
          (err): ChunkRaceResult<T> => ({ kind: 'primary-error', error: err }),
        ),
      fallbackIt
        .next()
        .then(
          (r): ChunkRaceResult<T> =>
            r.done
              ? {
                  kind: 'fallback-error',
                  error: new Error('fallback stream done before producing'),
                }
              : { kind: 'chunk', value: r.value, source: 'fallback' },
        )
        .catch(
          (err): ChunkRaceResult<T> => ({ kind: 'fallback-error', error: err }),
        ),
      new Promise<ChunkRaceResult<T>>((resolve) => {
        race2Timer = setTimeout(
          () =>
            resolve({
              kind: 'fallback-timeout',
              provider: fallbackProvider,
              index: fallbackIndex,
            }),
          hardDeadlineMs,
        );
        if (signal) {
          race2AbortListener = () => {
            if (race2Timer) clearTimeout(race2Timer);
            race2Timer = undefined;
            resolve({ kind: 'aborted' });
          };
          signal.addEventListener('abort', race2AbortListener, { once: true });
        }
      }),
    ]).finally(() => {
      if (FALLBACK_RACE_CLEANUP_ENABLED) {
        if (race2Timer) clearTimeout(race2Timer);
        if (signal && race2AbortListener) signal.removeEventListener('abort', race2AbortListener);
      }
    });

    // Defense-in-depth: re-check the user signal before deciding what
    // the race outcome means. If the user aborted during the race, drop
    // the chunk and abort both streams instead of leaking partial data.
    if (signal?.aborted) {
      primaryHandle.abort();
      fallbackHandle.abort();
      return;
    }

    if (raceResult.kind === 'aborted') {
      primaryHandle.abort();
      fallbackHandle.abort();
      return;
    }

    if (raceResult.kind === 'fallback-timeout') {
      logger.warn(
        'Concurrent fallback: fallback stalled past hardDeadlineMs; walking to next',
        {
          primaryProvider,
          fallbackProvider,
          fallbackIndex,
          hardDeadlineMs,
          model,
          requestId,
        },
      );
      // Derank-on-stall: record the fallback as a failed call with the
      // full hardDeadlineMs budget so shouldDeprioritize() / getHealthScore()
      // bump this provider's bad-call counter for the rolling window.
      recordCall(fallbackProvider, false, hardDeadlineMs, 'stall');
      fallbackHandle.abort();
      continue;
    }

    if (raceResult.kind === 'fallback-error') {
      logger.warn(
        'Concurrent fallback: fallback errored before chunk; walking to next',
        {
          primaryProvider,
          fallbackProvider,
          fallbackIndex,
          model,
          requestId,
        },
      );
      // Derank-on-error: capture the operator-visible failure so the next
      // getConfiguredFallbackChain re-ordering can move this provider later.
      recordCall(fallbackProvider, false, 0, 'error');
      fallbackHandle.abort();
      continue;
    }

    if (raceResult.kind === 'primary-error') {
      // Primary errored after this fallback was launched. Keep the
      // fallback alive — it's our only rescue path now. (Pre-fix bug:
      // the wrong handle was aborted; committing to the live fallback
      // is correct.)
      primaryHandle.abort();
      try {
        yield* drainIterator(fallbackIt, signal, idleTimeoutPerChunkMs);
        return;
      } catch (err) {
        if (err instanceof IdleTimeoutError) {
          logger.warn('Concurrent fallback: fallback stalled post-first-chunk; walking to next', {
            primaryProvider,
            fallbackProvider,
            fallbackIndex,
            model,
            requestId,
          });
          fallbackHandle.abort();
          continue;
        }
        throw err;
      }
    }

    // raceResult.kind === 'chunk' — we have a winner for this iteration.
    // Abort the loser and commit the winner's first chunk.
    const fallbackLatencyMs = Date.now() - raceStartTime - setupMs;
    // Preserve the original telemetry invariant: primaryLatencyMs is the
    // "primary has been running since the silence race fired" measurement.
    // For iteration 0 this is exact; for higher iterations it's a lower
    // bound (chain-walk overhead is not counted). Acceptable for derank
    // decisions in llm-provider-health, which cares about ORDERING more
    // than absolute values.
    const primaryLatencyMs = Date.now() - raceStartTime + silenceMs;

    if (raceResult.source === 'fallback') {
      onLoser?.({
        provider: primaryProvider,
        source: 'primary',
        index: -1,
        latencyMs: primaryLatencyMs,
      });
      onFallbackWin?.({
        provider: fallbackProvider,
        index: fallbackIndex,
        latencyMs: fallbackLatencyMs,
      });
      logger.warn('Concurrent fallback: fallback won the race', {
        primaryProvider,
        fallbackProvider,
        fallbackIndex,
        model,
        requestId,
        primaryLatencyMs,
        fallbackLatencyMs,
      });
      // Cancel the primary's underlying request.
      primaryHandle.abort();
    } else {
      onLoser?.({
        provider: fallbackProvider,
        source: 'fallback',
        index: fallbackIndex,
        latencyMs: fallbackLatencyMs,
      });
      fallbackHandle.abort();
      logger.warn('Concurrent fallback: primary won the race', {
        primaryProvider,
        fallbackProvider,
        fallbackIndex,
        model,
        requestId,
        fallbackLatencyMs,
      });
      // derank-on-slow-lost-race: the fallback produced later than the
      // primary during the chunk race. Record with `success: true` so the
      // existing isBadCall heuristic only flags this provider when the
      // measured fallbackLatencyMs exceeds SLOW_THRESHOLD_MS (the same
      // 30s ceiling every other call site uses). A fast loser (typical
      // race outcome — a few hundred ms after silenceMs) is a normal
      // outcome and MUST NOT be counted as a bad call, otherwise a
      // perfectly healthy fallback gets demoted just because it lost
      // a coin flip against a faster primary. No errorType tag is
      // attached here because ok=true means this record isn't an error;
      // operators wanting race-loss telemetry should look at the
      // onLoser callback, not the health tracker.
      recordCall(fallbackProvider, true, fallbackLatencyMs);
      // PR-C: clear the 530-blacklist counter on the loser's behalf so a
      // healthy fallback that lost this race isn't penalised across future requests.
      // PR-E: mirror enhanced-llm-service.ts:1434 — pair the 5xx success-reset
      // alongside the 530 reset in the chunk-race loser-success arm. A
      // healthy fallback that lost a race but produced a chunk via the
      // primary's natural completion is the SAME shape as a primary's
      // natural success — both tracks should be cleared.
      maybeReset530OnSuccess(fallbackProvider);
      maybeResetServerErrorOnSuccess(fallbackProvider);
    }

    yield raceResult.value;

    const winnerIt = raceResult.source === 'primary' ? primaryIt : fallbackIt;
    try {
      yield* drainIterator(winnerIt, signal, idleTimeoutPerChunkMs);
      return;
    } catch (err) {
      if (err instanceof IdleTimeoutError) {
        logger.warn('Concurrent fallback: winner stalled post-first-chunk; walking to next fallback', {
          primaryProvider,
          fallbackProvider: raceResult.source === 'primary' ? 'primary' : fallbackProvider,
          stalledProvider: raceResult.source,
          fallbackIndex,
          model,
          requestId,
        });
        continue;
      }
      throw err;
    }
  }

  // Fell through the entire chain without any provider producing a chunk
  // within its `hardDeadlineMs` budget. Abort primary and throw. This is
  // the bug fix: previously the secondary race had no timeout arm, so
  // when fallback #1 stalled (the ninerouter-class scenario, where every
  // fallback hits the same stuck in-cluster network edge), the request
  // wedged indefinitely. The caller is responsible for surfacing this
  // throw upstream, typically by yielding a streamed error to the SSE
  // channel in `app/api/chat/route.ts`.
  primaryHandle.abort();
  throw new Error(
    `Concurrent fallback: chain exhausted after ${chain.length} attempts ` +
      `(hardDeadlineMs=${hardDeadlineMs}): no provider produced a chunk.`,
  );
}

/**
 * PR-B race-cleanup guard.
 *
 * When true (default ON), every Promise.race inside this module captures
 * its setTimeout handle and any AbortSignal listener in outer scope, and
 * clears both via a `.finally()` chained to the race. Without this guard,
 * the setTimeout remains armed until it naturally fires (or forever if
 * the timeout window is long) and the abort listener stays attached to
 * the user's signal even after the race has resolved — a memory leak
 * per concurrent fallback request.
 *
 * Operators can disable by setting `ENABLE_FALLBACK_RACE_CLEANUP=0`.
 * The effect is purely a leak fix; no observable streaming behavior
 * changes.
 */
const FALLBACK_RACE_CLEANUP_ENABLED = process.env.ENABLE_FALLBACK_RACE_CLEANUP !== '0';

/**
 * Drain an async iterator, yielding each value until the iterator is
 * exhausted or the signal is aborted. Used as a final continuation step
 * after the race resolves to a winner.
 *
 * When `idleTimeoutMs` is set, a rolling idle timer fires between chunks:
 * after yielding a value, if the next `it.next()` does not resolve within
 * `idleTimeoutMs`, the generator throws `IdleTimeoutError`. This lets the
 * caller (e.g. the chain-walk loop in `coordinateConcurrentFallback`)
 * detect a post-first-chunk stall and walk to the next fallback rather
 * than relying solely on the route-level stall watchdog.
 */
export class IdleTimeoutError extends Error {
  name = 'IdleTimeoutError' as const;
  constructor(timeoutMs: number) {
    super(`Stream idle timeout: no chunk received within ${timeoutMs}ms`);
  }
}

async function* drainIterator<T>(
  it: AsyncIterator<T>,
  signal?: AbortSignal,
  idleTimeoutMs?: number,
): AsyncGenerator<T> {
  while (true) {
    if (signal?.aborted) return;
    const next = idleTimeoutMs !== undefined
      ? await raceWithTimeout(it.next(), idleTimeoutMs)
      : await it.next();
    if (next.done) return;
    yield next.value;
  }
}

/**
 * Race a promise against an idle timeout. If the timeout wins, throw
 * `IdleTimeoutError`.
 *
 * PR-B: wraps the body in try/finally so the underlying setTimeout is
 * cleared even on the timeout-wins (rejection) path. Previously this
 * helper only cleared the timer on the success path; when the timeout
 * fired first, the rejection propagated out and the `clearTimeout` line
 * was skipped, leaving an orphaned timer in Node's queue until it
 * naturally fired (or forever if ms was very large).
 */
async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdleTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Race a promise against an AbortSignal. Resolves with the underlying
 * value if the promise resolves first; rejects with an `AbortError`-
 * tagged error if the signal fires first. The signal listener is
 * removed in both branches so races that resolve non-abort do NOT
 * leak the abort handler into the signal's listener registry.
 *
 * This helper closes the chain-walk "factory awaits do not see signal"
 * gap: a stalled `createFallbackStream(...)` factory (e.g., OpenCode
 * container spin-up, HTTP/2 SETUP hang) used to wedge for the full
 * setup duration. With this helper, the setup abandon propagates
 * within ~1s of the user hitting stop.
 */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  errorMsg: string,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(makeAbortError(errorMsg, signal));
  }
  if (!signal) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(makeAbortError(errorMsg, signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function makeAbortError(msg: string, signal: AbortSignal): Error {
  const reason = signal.reason as { name?: string } | undefined;
  const err = new Error(msg) as Error & { name: string; code: string };
  err.name = reason?.name ?? 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

/**
 * Predicate: did `abortable()` (or any abort-aware boundary) throw
 * because `signal` fired (rather than a real underlying error)?
 */
function isAbortError(err: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal) return false;
  const e = err as { name?: string; code?: string } | null | undefined;
  return Boolean(e && (e.name === 'AbortError' || e.code === 'ABORT_ERR'));
}
