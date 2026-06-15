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
 *   - This module has no internal timeout/idle machinery of its own — the
 *     underlying stream factories are responsible for their own TTFT/idle
 *     budgets. The coordinator only fires a single parallel fallback after
 *     `silenceMs` of silence on the primary.
 *
 * Design notes:
 *   - BOTH factories return `{ gen, abort }` so the coordinator can truly
 *     cancel the loser's underlying network request. The factories are
 *     responsible for wiring an AbortController (or equivalent) into the
 *     stream and returning the abort function. This is essential: without
 *     it, the user's "cancel the loser" requirement would be partially
 *     unmet (the fallback can be aborted, but the primary cannot).
 *   - The factories are invoked lazily: the fallback is NOT created until
 *     the primary has been silent for `silenceMs`. This avoids unnecessary
 *     work and API-credit usage on the common case where the primary
 *     responds promptly.
 *   - The coordinator only fires ONE parallel fallback (the next entry in
 *     the chain). If the user wants progressive escalation, they can wrap
 *     this function in a chain-walking outer loop (a future enhancement).
 *
 * @see getConfiguredFallbackChain for the self-correcting chain source
 * @see llm-provider-health for the derank-by-bad-calls heuristic
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getConfiguredFallbackChain } from '../providers/provider-fallback-chains';
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
 */
type ChunkRaceResult<T> =
  | { kind: 'chunk'; value: T; source: 'primary' | 'fallback' }
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
    const handle = await createPrimaryStream();
    yield* drainIterator(handle.gen, signal);
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
    const handle = await createPrimaryStream();
    yield* drainIterator(handle.gen, signal);
    return;
  }

  // Start primary.
  const primaryHandle = await createPrimaryStream();
  const primaryIt = primaryHandle.gen[Symbol.asyncIterator]();

  // Cache the first primary result so if the timeout fires between
  // primary.next() resolving and the race starting, we don't orphan
  // (lose) that chunk.
  let firstPrimaryResult: IteratorResult<T> | null = null;

  // Race: first primary chunk vs silenceMs timeout vs user abort.
  const first: FirstRaceResult<T> = await Promise.race([
    primaryIt
      .next()
      .then((r): FirstRaceResult<T> => {
        firstPrimaryResult = r;
        return { kind: 'chunk', value: r };
      })
      .catch((err): FirstRaceResult<T> => ({ kind: 'primary-error', error: err })),
    new Promise<FirstRaceResult<T>>((resolve) => {
      const t = setTimeout(
        () => resolve({ kind: 'timeout' }),
        silenceMs,
      );
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve({ kind: 'aborted' });
        },
        { once: true },
      );
    }),
  ]);

  if (first.kind === 'primary-error') {
    throw first.error;
  }

  if (first.kind === 'chunk') {
    // Primary produced a chunk before silenceMs — yield and continue.
    if (first.value && !first.value.done) {
      yield first.value.value;
    }
    yield* drainIterator(primaryIt, signal);
    return;
  }

  if (first.kind === 'aborted') {
    // User aborted during the silence race — primary is still running but
    // the caller doesn't want the result. Abort primary and return.
    primaryHandle.abort();
    return;
  }

  // first.kind === 'timeout' — primary was silent. Fire the first fallback
  // in parallel. But first, re-check the signal: the user might have
  // aborted between the race resolving and us getting here.
  if (signal?.aborted) {
    primaryHandle.abort();
    return;
  }

  const fallbackProvider = chain[0];
  const raceStartTime = Date.now();
  let fallbackHandle: StreamHandle<T>;
  try {
    fallbackHandle = await createFallbackStream(fallbackProvider);
  } catch (err) {
    // Fallback setup failed — log and fall through to primary.
    logger.warn('Concurrent fallback: setup failed, continuing with primary', {
      primaryProvider,
      fallbackProvider,
      model,
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (firstPrimaryResult && !firstPrimaryResult.done) {
      yield firstPrimaryResult.value;
    }
    yield* drainIterator(primaryIt, signal);
    return;
  }
  const setupMs = Date.now() - raceStartTime;
  // Defense-in-depth: the user might have aborted while the fallback
  // factory was running (e.g. a slow import of the underlying SDK).
  // Abort the fallback and return without racing.
  if (signal?.aborted) {
    fallbackHandle.abort();
    primaryHandle.abort();
    return;
  }
  const fallbackIt = fallbackHandle.gen[Symbol.asyncIterator]();

  // Race: first chunk from primary (if not already) vs first chunk from fallback.
  const raceResult: ChunkRaceResult<T> = await Promise.race([
    firstPrimaryResult && !firstPrimaryResult.done
      ? Promise.resolve({
          kind: 'chunk' as const,
          value: firstPrimaryResult.value as T,
          source: 'primary' as const,
        })
      : primaryIt
          .next()
          .then(
            (r): ChunkRaceResult<T> =>
              r.done
                ? { kind: 'primary-error', error: new Error('primary stream done before producing') }
                : { kind: 'chunk', value: r.value, source: 'primary' },
          )
          .catch((err): ChunkRaceResult<T> => ({ kind: 'primary-error', error: err })),
    fallbackIt
      .next()
      .then(
        (r): ChunkRaceResult<T> =>
          r.done
            ? { kind: 'fallback-error', error: new Error('fallback stream done before producing') }
            : { kind: 'chunk', value: r.value, source: 'fallback' },
      )
      .catch((err): ChunkRaceResult<T> => ({ kind: 'fallback-error', error: err })),
  ]);

  // Handle race errors.
  if (raceResult.kind === 'primary-error') {
    // Primary errored. Try the fallback instead.
    fallbackHandle.abort();
    if (firstPrimaryResult && !firstPrimaryResult.done) {
      yield firstPrimaryResult.value;
    }
    yield* drainIterator(primaryIt, signal);
    return;
  }
  if (raceResult.kind === 'fallback-error') {
    // Fallback errored before producing a chunk. Try the primary instead.
    fallbackHandle.abort();
    if (firstPrimaryResult && !firstPrimaryResult.done) {
      yield firstPrimaryResult.value;
    }
    yield* drainIterator(primaryIt, signal);
    return;
  }

  // We have a winner. Defense-in-depth: re-check the user signal before
  // committing to the winner — if the user aborted during the race
  // (between the race resolving and us getting here), drop the chunk
  // and abort both streams instead of leaking partial data.
  if (signal?.aborted) {
    primaryHandle.abort();
    fallbackHandle.abort();
    return;
  }

  // We have a winner. Abort the loser.
  const fallbackLatencyMs = Date.now() - raceStartTime - setupMs;
  if (raceResult.source === 'fallback') {
    // Loser = primary. The primary has been running since start (silenceMs
    // plus the time from the timeout to the race resolution).
    const primaryLatencyMs = Date.now() - raceStartTime + silenceMs;
    onLoser?.({
      provider: primaryProvider,
      source: 'primary',
      index: -1,
      latencyMs: primaryLatencyMs,
    });
    onFallbackWin?.({ provider: fallbackProvider, index: 0, latencyMs: fallbackLatencyMs });
    logger.warn('Concurrent fallback: fallback won the race', {
      primaryProvider,
      fallbackProvider,
      model,
      requestId,
      primaryLatencyMs,
      fallbackLatencyMs,
    });
    // Cancel the primary's underlying request.
    primaryHandle.abort();
  } else {
    // Loser = fallback. Abort it via the factory-provided handle.
    onLoser?.({
      provider: fallbackProvider,
      source: 'fallback',
      index: 0,
      latencyMs: fallbackLatencyMs,
    });
    fallbackHandle.abort();
    logger.warn('Concurrent fallback: primary won the race', {
      primaryProvider,
      fallbackProvider,
      model,
      requestId,
      fallbackLatencyMs,
    });
  }

  // Yield the winner's first chunk.
  yield raceResult.value;

  // Continue with the winner's iterator.
  const winnerIt = raceResult.source === 'primary' ? primaryIt : fallbackIt;
  yield* drainIterator(winnerIt, signal);
}

/**
 * Drain an async iterator, yielding each value until the iterator is
 * exhausted or the signal is aborted. Used as a final continuation step
 * after the race resolves to a winner.
 */
async function* drainIterator<T>(
  it: AsyncIterator<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  while (true) {
    if (signal?.aborted) return;
    const next = await it.next();
    if (next.done) return;
    yield next.value;
  }
}
