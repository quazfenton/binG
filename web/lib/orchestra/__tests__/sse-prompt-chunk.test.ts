/**
 * SSE chunk schema regression tests.
 *
 * Single-source-of-truth surface for the SSE chunk protocol:
 *   - `makeSseChunk` is the only producer of `SseContinuationChunk`.
 *   - The factory returns a structurally-matched variant whose `reason`
 *     flows to the operator-grep layer.
 *
 * This test locks down the failure_plan_loop case so a future
 * serialization-layer regression (reason rename / field drop / type
 * widening to `string`) is caught at CI rather than at the operator-grep
 * stage. The literal `"failure_plan_loop"` MUST survive the round-trip
 * verbatim — operators grep the SSE stream for that token to detect
 * upstream-tool-failure-induced loops.
 */
import { describe, it, expect } from 'vitest';
import { makeSseChunk, type SseContinuationChunk } from '../sse-prompt-chunk';

// Sentinel marker used in serialised output to confirm the reason
// field name has not been renamed.
const REASON_FIELD = '"reason":"failure_plan_loop"';

describe('SseContinuationChunk round-trip — failure_plan_loop serialization', () => {
  it('emits failure_plan_loop verbatim through the makeSseChunk factory', () => {
    // 'continuation' kind uses varargs (see sse-prompt-chunk.ts signature:
    // `makeSseChunk<K extends SseChunkKind>(kind: K, ...args: SseChunkArgs<K>)`
    // so the payload tuple is unpacked into its 3 elements.
    const chunk = makeSseChunk<SseContinuationChunk['type']>(
      'continuation',
      false, // continue === false (decision is to STOP the loop, not continue)
      'failure_plan_loop', // ContinuationReason — typed via SseChunkArgs
      1, // iteration mirrors AutoContinueDecision.continuationsSoFar
    );

    // Direct structural assertions — pin the producer contract.
    expect(chunk.type).toBe('continuation');
    expect(chunk.continue).toBe(false);
    expect(chunk.reason).toBe('failure_plan_loop');
    expect(chunk.iteration).toBe(1);
  });

  it('preserves "failure_plan_loop" verbatim across JSON.stringify + JSON.parse round-trip (operator-grep layer)', () => {
    const chunk = makeSseChunk<SseContinuationChunk['type']>(
      'continuation',
      false,
      'failure_plan_loop',
      1,
    );

    // 1. Serialise the chunk to its on-the-wire JSON representation.
    //    This is the exact bytes that flow onto the SSE stream.
    const wireJson = JSON.stringify(chunk);

    // 2. Operator-grep layer: the `"reason":"failure_plan_loop"` token
    //    MUST be present verbatim in the wire format so operators can
    //    `grep '"reason":"failure_plan_loop"'` against the live stream.
    expect(wireJson).toContain(REASON_FIELD);

    // 3. Parser layer: a downstream SSE parser JSON.parses the chunk
    //    and the reason field MUST round-trip to the same literal. This
    //    defends against TypeScript-narrowing regressions that might
    //    accidentally widen the type to `string` (which would still pass
    //    step 2 if the value were preserved but wouldn't compile-error
    //    on a typo'd reason literal at consumer sites).
    const parsed = JSON.parse(wireJson) as SseContinuationChunk;
    expect(parsed.reason).toBe('failure_plan_loop');
    expect(parsed.continue).toBe(false);
    expect(parsed.iteration).toBe(1);
    expect(parsed.type).toBe('continuation');
  });
});
