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
 * How the test reaches `wrapAsHandle`: the function is closure-local
 * inside `streamWithConcurrentFallback`'s body. We expose a captured
 * reference via `__getWrapAsHandleForTests()` (test seam, @internal)
 * which holds a pointer to the SAME function instance used in
 * production when `streamWithConcurrentFallback`'s body executes at
 * first call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist: replace streamWithVercelAI BEFORE the test seam import resolves.
// The auto-mock turns streamWithVercelAI into a vi.fn() we configure in
// beforeEach for each scenario.
vi.mock('@/lib/chat/vercel-ai-streaming');

import * as vercelAIStreaming from '@/lib/chat/vercel-ai-streaming';
import { __getWrapAsHandleForTests } from '@/lib/chat/enhanced-llm-service';

const streamWithVercelAIMock = vi.mocked(vercelAIStreaming.streamWithVercelAI);

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
    vi.useFakeTimers();
    streamWithVercelAIMock.mockImplementation(() =>
      // wrapAsHandle awaits streamWithVercelAI(...) and then takes
      // .[Symbol.asyncIterator]() on the returned value. We return a
      // Promise resolving to an object whose Symbol.asyncIterator yields
      // the buildMockUpstream async generator.
      Promise.resolve({
        [Symbol.asyncIterator]: () => buildMockUpstream(),
      } as any),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    streamWithVercelAIMock.mockReset();
  });

  /**
   * Core regression: TTFT 2s + inter-chunk gap 30s exceeds
   * firstChunkTimeoutMs 25s. PR-S locks the success-path clearTimeout
   * so chunk-2 still delivers at t=32s (>= firstChunkTimeoutMs 25s).
   *
   * A future DRY revert that removes the inline
   * `clearTimeout(firstChunkTimer); firstChunkTimer = undefined;` line
   * (e.g. PR-Z2's "redundant with finally" rationale comes back) makes
   * the test fail: at t=25s the un-disarmed timer fires and aborts the
   * controller, so gen.next() at t=30s throws AbortError.
   */
  it('delivers chunk-2 when TTFT=2s + inter-chunk gap=30s exceeds firstChunkTimeoutMs=25s (PR-S disarms timer)', async () => {
    const wrapAsHandle = __getWrapAsHandleForTests();
    expect(wrapAsHandle).toBeDefined();

    // (1) Establish the envelope. wrapAsHandle() arms the firstChunkTimer
    //     INSIDE its closure (defaults in this code path: 25s).
    const handle = await wrapAsHandle!();
    expect(handle.gen).toBeDefined();
    expect(typeof handle.abort).toBe('function');

    // (2) Advance to TTFT (2s) and read chunk-1.
    //     vi.advanceTimersByTimeAsync flushes pending microtasks after
    //     advancing, so the awaited setTimeout() in the upstream can
    //     resolve and the iterator can yield.
    await vi.advanceTimersByTimeAsync(2000);
    const first = await handle.gen.next();
    expect(first.done).toBe(false);
    expect(first.value.content).toBe('chunk-1');
    expect((first.value as any).finishReason).toBeUndefined();

    // (3) Advance PAST firstChunkTimeoutMs (25s). Without PR-S: timer
    //     was never disarmed after chunk-1 arrived at t=2s, so the
    //     deadline elapses at t=25s mid-drain and aborts via controller.
    //     With PR-S: timer was cleared at t=2s — no abort.
    await vi.advanceTimersByTimeAsync(25000);

    // (4) Advance past the inter-chunk gap (chunk-2 yielded at t=32s).
    //     gen.next() at this point should return chunk-2 (NOT throw).
    //     Without PR-S: throws AbortError.
    await vi.advanceTimersByTimeAsync(7000);
    let second: IteratorResult<any>;
    try {
      second = await handle.gen.next();
    } catch (err: any) {
      throw new Error(
        'R2 regression re-introduced: gen.next() threw during the ' +
        'post-chunk-1 drain -- `' + err?.message + '`. PR-S ' +
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
