/**
 * R2 Regression Lock (PR-S commit 061a4f5a)
 * ────────────────────────────────────────────
 *
 * Stage 3 R2 re-instated the inline success-path `clearTimeout` re-arm
 * inside `wrapAsHandle`'s envelope generator in
 * web/lib/chat/enhanced-llm-service.ts. Without the re-arm, healthy-
 * but-slow streams whose inter-chunk gap EXCEEDS `firstChunkTimeoutMs`
 * are silently cut mid-drain: the timer keeps running after the first
 * chunk arrives, fires when wall-clock crosses `firstChunkTimeoutMs`,
 * and aborts the controller while the iterator is suspended awaiting a
 * second chunk.
 *
 * This test exercises EXACTLY the regression scenario with vitest fake
 * timers + a mocked `streamWithVercelAI` upstream:
 *
 *   - TTFT 2s                      < firstChunkTimeoutMs (25s)
 *   - inter-chunk gap 30s          > firstChunkTimeoutMs (25s)
 *
 * With PR-S in place, both chunks deliver. Without PR-S, the timer
 * fires at t=25s while the iterator is awaiting the 2nd chunk, aborts
 * the controller, and `gen.next()` throws AbortError -- the test fails.
 *
 * How the test reaches `wrapAsHandle`: the factory was lifted out of
 * `streamWithConcurrentFallback`'s closure into the module-level
 * `wrapAsHandleForConcurrentFallback` export, so the test can drive
 * it directly with a synchronous firstChunkTimeoutMs override (default
 * 25s would force the test to await real wall-clock time, which is
 * impossible under vi.useFakeTimers without an override), and we can
 * assert the success-path clearTimeout re-arm in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist: replace streamWithVercelAI BEFORE the factory import resolves.
// The auto-mock turns streamWithVercelAI into a vi.fn() we configure in
// beforeEach for each scenario.
vi.mock('@/lib/chat/vercel-ai-streaming');

import * as vercelAIStreaming from '@/lib/chat/vercel-ai-streaming';
import { wrapAsHandleForConcurrentFallback } from '@/lib/chat/enhanced-llm-service';

const streamWithVercelAIMock = vi.mocked(vercelAIStreaming.streamWithVercelAI);

// Regression-scenario timings (short wall-clock windows):
//   ttftMs = 100   (TTFT — first chunk arrives in 100ms)
//   gap    = 300   (inter-chunk gap — second chunk arrives 300ms after first)
//   firstChunkTimeoutMsOverride = 200
// Scenario invariant: TTFT (100) < firstChunkTimeoutMs (200) < gap (300).
// Without PR-S, the 200ms timer would fire at wall-clock 200ms while the
// iterator is suspended awaiting chunk-2 at wall-clock 400ms — AbortError.
// With PR-S, the timer is disarmed at the 100ms chunk-1 arrival, so the
// 300ms gap elapses cleanly and chunk-2 delivers.
//
// Why real setTimeout (not vi.useFakeTimers): vitest's fake-timer
// interaction with the `while { await upstreamIter.next() }` post-
// chunk-1 drain loop appears to wall-clock block for the full timer
// window in this vitest version (the test hit the 30s default timeout
// under fake timers). Real setTimeout with these short durations
// completes in ~400ms regardless of vitest internals.
const TTFT_MS = 100;
const INTER_CHUNK_GAP_MS = 300;
const FIRST_CHUNK_TIMEOUT_MS = 200;

/**
 * Mock upstream that yields chunk-1 after TTFT (default 2000ms) and
 * chunk-2 after the additional inter-chunk gap (default 30000ms), then
 * returns done. Timings use the (vitest-faked) global `setTimeout`.
 */
async function* buildMockUpstream(opts?: {
  ttftMs?: number;
  interChunkGapMs?: number;
  chunk2Final?: boolean;
}): AsyncGenerator<any> {
  const ttft = opts?.ttftMs ?? 2000;
  const gap = opts?.interChunkGapMs ?? 30000;
  const chunk2Final = opts?.chunk2Final ?? true;
  await new Promise<void>((r) => setTimeout(r, ttft));
  yield {
    content: 'chunk-1',
    isComplete: false,
    timestamp: new Date(),
    metadata: { kind: 'test' },
  };
  await new Promise<void>((r) => setTimeout(r, gap));
  yield {
    content: 'chunk-2',
    isComplete: chunk2Final,
    finishReason: chunk2Final ? 'stop' : undefined,
    timestamp: new Date(),
    metadata: { kind: 'test' },
  };
  // No further yields -- upstream done.
}

describe('R2 Regression (PR-S 061a4f5a): wrapAsHandle success-path clearTimeout re-arm', () => {
  beforeEach(() => {
    // Production `streamWithVercelAI` is declared `async function*`,
    // so the factory call `streamWithVercelAI(...)` synchronously returns
    // an AsyncGenerator (NOT a Promise wrapping one). The mock must
    // mirror this — `Promise.resolve(...)` would force the factory's
    // `upstreamGen[Symbol.asyncIterator]()` to read the symbol on a
    // Promise (returns undefined) and throw TypeError.
    streamWithVercelAIMock.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => buildMockUpstream({
        ttftMs: TTFT_MS,
        interChunkGapMs: INTER_CHUNK_GAP_MS,
      }),
    } as any));
  });

  afterEach(() => {
    streamWithVercelAIMock.mockReset();
  });

  /**
   * R2 regression: TTFT < firstChunkTimeoutMs < inter-chunk-gap.
   * PR-S2 (commit 061a4f5a) re-instated the inline success-path
   * `clearTimeout(firstChunkTimer)` re-arm inside the factory's
   * `firstChunkEnvelope` generator. Without it, the firstChunkTimer
   * keeps running after chunk-1 arrives and fires at the
   * firstChunkTimeoutMs deadline WHILE the iterator is suspended on
   * `await upstreamIter.next()` awaiting chunk-2 -- the controller
   * abort propagates through the merged signal and `gen.next()` throws
   * AbortError mid-drain, silently cutting off an otherwise healthy
   * stream.
   *
   * Concretely with the test timings:
   *   t=0:   wrapAsHandle() arms firstChunkTimer (200ms)
   *   t=100: chunk-1 yields; PR-S2 disarms firstChunkTimer
   *   t=200: WITHOUT PR-S, the (un-disarmed) timer fires here, AbortError
   *          WITH PR-S, the timer is gone -- no abort
   *   t=400: chunk-2 yields (after the 300ms gap)
   *
   * A future DRY revert that removes the `clearTimeout(firstChunkTimer)`
   * 3 lines beneath `if (first.done) return;` inside the factory's
   * `firstChunkEnvelope` generator (e.g. PR-Z2's "redundant with finally"
   * rationale resurfaces) makes this test fail at the second try/catch
   * with a clear "R2 regression re-introduced" message.
   */
  it(`delivers chunk-2 when TTFT=${TTFT_MS}ms + inter-chunk gap=${INTER_CHUNK_GAP_MS}ms exceeds firstChunkTimeoutMs=${FIRST_CHUNK_TIMEOUT_MS}ms (PR-S disarms timer)`, async () => {
    const wrapAsHandle = wrapAsHandleForConcurrentFallback({
      rest: { provider: 'openai', model: 'mock', messages: [] } as any,
      options: { model: 'mock' } as any,
      // No findCompatibleModelFn -- factory falls through to `options.model`.
      firstChunkTimeoutMsOverride: FIRST_CHUNK_TIMEOUT_MS,
    });
    expect(typeof wrapAsHandle).toBe('function');

    // (1) Establish the envelope. wrapAsHandle() arms the firstChunkTimer
    //     INSIDE its closure (200ms in this code path).
    const start = Date.now();
    const handle = await wrapAsHandle();
    expect(handle.gen).toBeDefined();
    expect(typeof handle.abort).toBe('function');

    // (2) Wait for TTFT (100ms wall-clock) and read chunk-1. PR-S2
    //     disarms firstChunkTimer immediately on chunk-1 arrival.
    await new Promise<void>((r) => setTimeout(r, TTFT_MS));
    expect(Date.now() - start).toBeGreaterThanOrEqual(TTFT_MS);
    const first = await handle.gen.next();
    expect(first.done).toBe(false);
    expect(first.value.content).toBe('chunk-1');
    expect((first.value as any).finishReason).toBeUndefined();

    // (3) Wait for the timer deadline to elapse (FIRST_CHUNK_TIMEOUT_MS).
    //     The PR-S2-disarmed timer is gone, so NO abort should fire here.
    //     If PR-S2 is reverted, the un-disarmed timer would fire inside
    //     this window and abort the controller.
    await new Promise<void>((r) => setTimeout(r, FIRST_CHUNK_TIMEOUT_MS));
    expect(Date.now() - start).toBeGreaterThanOrEqual(TTFT_MS + FIRST_CHUNK_TIMEOUT_MS);

    // (4) Wait past the inter-chunk gap so chunk-2 yields, then read it.
    //     chunk-2 arrives at t=400ms (TTFT_MS + INTER_CHUNK_GAP_MS).
    //     gen.next() at this point should return chunk-2 (NOT throw).
    await new Promise<void>((r) => setTimeout(r, INTER_CHUNK_GAP_MS));
    let second: IteratorResult<any>;
    try {
      second = await handle.gen.next();
    } catch (err: any) {
      throw new Error(
        'R2 regression re-introduced: gen.next() threw during the ' +
        'post-chunk-1 drain -- `' + (err?.message ?? String(err)) + '`. PR-S ' +
        '(061a4f5a) success-path clearTimeout re-arm is missing.',
      );
    }
    expect(second.done).toBe(false);
    expect(second.value.content).toBe('chunk-2');
    expect((second.value as any).isComplete).toBe(true);
    expect((second.value as any).finishReason).toBe('stop');

    handle.abort(); // explicit cleanup
  });
});
