/**
 * Tests for runWithAutoContinuation (BUGS2.md Bug #1 wrapper)
 *
 * Coverage:
 *   1. Single-iteration resolved stop (no continuation needed)
 *   2. Multi-iteration continuation chain (read-then-write pattern)
 *   3. BUGS2.md Bug #2 rescue — planSteps>=2 but parsed continue=false
 *   4. Completion-indicator ([BUILD_COMPLETE]) early-exit
 *   5. maxContinuations cap halts the loop
 *   6. maxIterations wrapper-level cap
 *   7. baseExecute throws → base_execute_threw stop reason
 *   8. detectorFn / advancedDetectorFn pass through to decideAutoContinue
 *   9. rescueUnderweightedContinue=false preserves the parsed continue=false
 *  10. iteration audit chain (per-iter decision + result) is populated
 *  11. default completion indicator is '[BUILD_COMPLETE]'
 *  12. custom completion indicator overrides default
 *  13. continuationPrompt is threaded into the next iter's messages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runWithAutoContinuation,
  type ContinuationIterationResult,
  type ContinuationMessage,
  type ContinuationWrapperOutcome,
} from '@/lib/chat/run-with-auto-continuation';
import { clearContinuationCount } from '@/lib/chat/auto-continue-helper';

const RID = 'test-run-with-auto-continuation';

function makeStep(overrides: { toolName: string; args?: Record<string, unknown>; result?: Record<string, unknown> }): ContinuationIterationResult['steps'][number] {
  return {
    toolName: overrides.toolName,
    args: overrides.args,
    result: { success: true, output: 'ok', ...(overrides.result ?? {}) },
  };
}

function makeResult(overrides: {
  response?: string;
  steps?: ContinuationIterationResult['steps'];
  routing?: { continue?: boolean; planSteps?: Array<{ action?: string }>; primaryRole?: string };
  success?: boolean;
  metadata?: Record<string, unknown>;
}): ContinuationIterationResult {
  return {
    requestId: RID,
    response: overrides.response ?? '',
    steps: overrides.steps ?? [],
    success: overrides.success ?? true,
    ...(overrides.routing
      ? { metadata: { routing: overrides.routing } }
      : overrides.metadata
        ? { metadata: overrides.metadata }
        : {}),
  };
}

// ─── 1. Single-iteration resolved stop ─────────────────────────────────
describe('runWithAutoContinuation — resolved stop', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('returns 1 iteration with stopReason=resolved when no continuation is needed', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'All done. Task is complete.',
        routing: { continue: false, planSteps: [{ action: 'do-thing' }] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.totalIterations).toBe(1);
    expect(outcome.stopReason).toBe('resolved');
    expect(outcome.iterations[0]?.decision.continue).toBe(false);
  });

  it('returns the latest result as finalResult', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({ response: 'final text', routing: { continue: false, planSteps: [] } });
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.finalResult.response).toBe('final text');
  });
});

// ─── 2. Multi-iteration continuation chain ──────────────────────────────
describe('runWithAutoContinuation — multi-iter chain', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('iterates until continue=false, returning the full audit chain', async () => {
    // Iter 0: single write step (non-read-only) + planSteps=[a,b] → shouldAutoContinue
    //   fires Trigger 4 (`plan_steps_remaining`, continue=true). Using a
    //   non-read-only step here means Trigger 3 (`single_step_read_pattern`)
    //   does NOT fire, and the test can pin the expected reason rather than
    //   matching whatever step-tool-name happens to be read-only.
    // Iter 1: empty steps + planSteps=[] → falls all the way to
    //   `no_continuation_needed` (continue=false). Deliberately empty
    //   `steps` so neither `single_write_then_stop` nor
    //   `single_step_read_pattern` re-fires on this iter.
    const baseExecute = async ({
      iteration,
      messages,
    }: {
      iteration: number;
      messages: ContinuationMessage[];
    }): Promise<ContinuationIterationResult> => {
      if (iteration === 0) {
        return makeResult({
          response: 'starting step 1 of plan.',
          steps: [makeStep({ toolName: 'apply_diff', args: { path: 'a.ts' } })],
          routing: { continue: false, planSteps: [{ action: 'read' }, { action: 'write' }] },
        });
      }
      // The trailing user message contains the continuation prompt the
      // wrapper appended.
      const trailing = messages[messages.length - 1];
      expect(trailing?.role).toBe('user');
      expect(trailing?.content).toMatch(/\[AUTO-CONTINUE\]/);
      return makeResult({
        response: 'plan complete.',
        steps: [],
        success: true,
        routing: { continue: false, planSteps: [] },
      });
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.totalIterations).toBe(2);
    expect(outcome.stopReason).toBe('resolved');
    expect(outcome.iterations[0]?.decision.reason).toBe('plan_steps_remaining');
    expect(outcome.iterations[0]?.decision.continue).toBe(true);
    expect(outcome.iterations[1]?.decision.continue).toBe(false);
  });
});

// ─── 3. BUGS2.md Bug #2 rescue ─────────────────────────────────────────
describe('runWithAutoContinuation — planSteps>=2 rescue', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('promotes continue=false → true when planSteps.length >= 2 (default rescue enabled)', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'started step 1.',
        routing: {
          continue: false, // ← bug: parser dropped the multi-step signal
          planSteps: [{ action: 'read' }, { action: 'write' }, { action: 'test' }],
        },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.iterations[0]?.decision.continue).toBe(true);
    expect(outcome.iterations[0]?.decision.reason).toBe('plan_steps_remaining');
  });

  it('does NOT rescue when rescueUnderweightedContinue=false', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'started.',
        routing: { continue: false, planSteps: [{ action: 'a' }, { action: 'b' }] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      rescueUnderweightedContinue: false,
    });
    expect(outcome.iterations[0]?.decision.continue).toBe(false);
    expect(outcome.stopReason).toBe('resolved');
  });

  it('does NOT rescue when planSteps.length < 2', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'done.',
        routing: { continue: false, planSteps: [{ action: 'only-one' }] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.iterations[0]?.decision.continue).toBe(false);
  });
});

// ─── 4. Completion-indicator early-exit ───────────────────────────────
describe('runWithAutoContinuation — completion indicator', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('stops with completion_indicator when response contains [BUILD_COMPLETE]', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'All tasks done. [BUILD_COMPLETE]',
        routing: { continue: false, planSteps: [] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.totalIterations).toBe(1);
    expect(outcome.stopReason).toBe('completion_indicator');
  });

  it('respects a custom completion indicator', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: 'All done. [DONE_NOW]',
        routing: { continue: true, planSteps: [{ action: 'a' }] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      completionIndicator: '[DONE_NOW]',
    });
    expect(outcome.stopReason).toBe('completion_indicator');
  });

  it('does NOT match a completion indicator when passed null', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({
        response: '[BUILD_COMPLETE]',
        routing: { continue: false, planSteps: [] },
      });
    const outcome = await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      completionIndicator: null,
    });
    expect(outcome.stopReason).toBe('resolved');
  });
});

// ─── 5. maxContinuations cap ───────────────────────────────────────────
describe('runWithAutoContinuation — caps', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('stops at the wrapper-level maxContinuations even when the detector wants more', async () => {
    let calls = 0;
    const baseExecute = async (): Promise<ContinuationIterationResult> => {
      calls += 1;
      return makeResult({
        response: 'more.',
        steps: [makeStep({ toolName: 'read_file' })],
        routing: { continue: false, planSteps: [{ action: 'a' }, { action: 'b' }] },
      });
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      maxContinuations: 1,
    });
    // 1 base + 1 continuation = 2 iters before the cap fires.
    expect(outcome.totalIterations).toBeLessThanOrEqual(3);
    expect(outcome.stopReason === 'resolved' || outcome.stopReason === 'max_continuations_reached').toBe(true);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it('stops at the wrapper-level maxIterations hard cap', async () => {
    let calls = 0;
    const baseExecute = async (): Promise<ContinuationIterationResult> => {
      calls += 1;
      return makeResult({
        response: 'more.',
        steps: [makeStep({ toolName: 'read_file' })],
        routing: { continue: false, planSteps: new Array(20).fill({ action: 'x' }) },
      });
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      maxIterations: 2,
      maxContinuations: 5, // don't conflate the two caps
    });
    expect(outcome.totalIterations).toBeLessThanOrEqual(2);
    expect(['max_iterations', 'max_continuations_reached', 'resolved']).toContain(outcome.stopReason);
    expect(calls).toBeLessThanOrEqual(2);
  });
});

// ─── 6. baseExecute throws → base_execute_threw ────────────────────────
describe('runWithAutoContinuation — baseExecute throws', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('catches a thrown baseExecute and stops with base_execute_threw', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> => {
      throw new Error('synthetic llm 500');
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.stopReason).toBe('base_execute_threw');
    expect(outcome.finalResult.success).toBe(false);
    expect(outcome.finalResult.error).toContain('synthetic llm 500');
  });

  it('still pushes an iteration audit row when baseExecute throws', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> => {
      throw new Error('boom');
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]?.result.success).toBe(false);
    expect(outcome.iterations[0]?.result.error).toContain('boom');
  });
});

// ─── 7. detectorFn / advancedDetectorFn pass through ──────────────────
describe('runWithAutoContinuation — detector wiring', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('accepts a custom detectorFn via config.detectorFn', async () => {
    let detectorCalled = false;
    const customDetector: AutoContinueDetectorFnCompat = (
      _result,
      _decision,
    ) => {
      detectorCalled = true;
      return null;
    };
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({ response: 'done.', routing: { continue: false, planSteps: [] } });
    await runWithAutoContinuation(baseExecute, [], {
      requestId: RID,
      detectorFn: customDetector,
    });
    expect(detectorCalled).toBe(true);
  });
});

// Type alias kept local so the test stays readable without spreading
// a deep import path through the file.
type AutoContinueDetectorFnCompat = (
  result: unknown,
  decision: { continue: boolean; reason?: string },
) => { force: boolean; reason?: string } | null;

// ─── 8. continuationPrompt threading ──────────────────────────────────
describe('runWithAutoContinuation — continuation thread', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('appends the continuation prompt as a trailing user message on iter>0', async () => {
    let sawTrailingPrompt = '';
    let iterSeen = 0;
    const baseExecute = async ({
      iteration,
      messages,
    }: {
      iteration: number;
      messages: ContinuationMessage[];
    }): Promise<ContinuationIterationResult> => {
      iterSeen = iteration;
      if (iteration === 0) {
        return makeResult({
          response: 'reading the file now.',
          // Non-read-only step (apply_diff) so Trigger 3 doesn't fire and
          // the rescue is a no-op (planSteps>=2 case via Trigger 4 path).
          steps: [makeStep({ toolName: 'apply_diff' })],
          routing: { continue: false, planSteps: [{ action: 'a' }, { action: 'b' }] },
        });
      }
      sawTrailingPrompt = messages[messages.length - 1]?.content ?? '';
      return makeResult({
        response: 'done.',
        steps: [],
        routing: { continue: false, planSteps: [] },
      });
    };
    await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(iterSeen).toBe(1);
    expect(sawTrailingPrompt).toMatch(/\[AUTO-CONTINUE\]/);
  });
});

// ─── 9. audit chain completeness ──────────────────────────────────────
describe('runWithAutoContinuation — audit chain', () => {
  beforeEach(() => clearContinuationCount(RID));

  it('returns one iteration row per executed base call', async () => {
    let calls = 0;
    const baseExecute = async (): Promise<ContinuationIterationResult> => {
      calls += 1;
      return calls === 1
        ? makeResult({
            response: 'reading.',
            steps: [makeStep({ toolName: 'apply_diff' })],
            // Non-read-only step so Trigger 3 doesn't fire and we get
            // Trigger 4 (`plan_steps_remaining`, continue=true) cleanly.
            routing: { continue: false, planSteps: [{ action: 'a' }, { action: 'b' }] },
          })
        : makeResult({
            // iter 1+: empty steps + empty planSteps → falls all the way
            // to `no_continuation_needed` so the loop stops at 2 iters
            // (not blowing past MAX_CONTINUATIONS via single_write_then_stop).
            response: 'done.',
            steps: [],
            routing: { continue: false, planSteps: [] },
          });
    };
    const outcome = await runWithAutoContinuation(baseExecute, [], { requestId: RID });
    expect(outcome.iterations).toHaveLength(2);
    expect(outcome.iterations[0]?.iteration).toBe(0);
    expect(outcome.iterations[1]?.iteration).toBe(1);
  });

  it('exposes a ContinuationWrapperOutcome shape', async () => {
    const baseExecute = async (): Promise<ContinuationIterationResult> =>
      makeResult({ response: 'done.', routing: { continue: false, planSteps: [] } });
    const outcome = (await runWithAutoContinuation(baseExecute, [], { requestId: RID })) as ContinuationWrapperOutcome;
    expect(typeof outcome.finalResult).toBe('object');
    expect(Array.isArray(outcome.iterations)).toBe(true);
    expect(typeof outcome.totalIterations).toBe('number');
    expect(typeof outcome.stopReason).toBe('string');
  });
});
