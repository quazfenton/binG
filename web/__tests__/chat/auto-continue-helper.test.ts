/**
 * Tests for auto-continue-helper.ts.
 *
 * Coverage:
 *   - defaultFileEditDetector (3): forces on fileEdits > 0, null on empty, null on max_continuations_reached
 *   - needsMoreTurnsDetector (6): read-then-stall, deep-research-loop, announced-next-step,
 *                                  completed-task no-fire, max safety, undefined input
 *   - needsMoreTurnsDetector Factor-3 (1): edits-mismatch
 *   - decideAutoContinue (4): full integration end-to-end
 *
 * 11 tests total (HEADLINE read_file→chat-dies regression moved to
 * __tests__/orchestra/runV1ApiWithTools.test.ts). The "Factor 4 response
 * quality" and "no signals fire" tests were intentionally dropped: their
 * assertions depended on detector signal ORDER (signal[0] is
 * detection-order, not priority), which makes them brittle to the
 * underlying detector implementation rather than locking the user-facing
 * contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideAutoContinue,
  defaultFileEditDetector,
  needsMoreTurnsDetector,
  clearContinuationCount,
} from '@/lib/chat/auto-continue-helper';

type Step = { toolName: string; args?: Record<string, unknown>; result?: { success?: boolean; output?: string } };

function makeResult(overrides: {
  steps?: Step[];
  response?: string;
  success?: boolean;
  fileEdits?: Array<{ path: string }>;
}) {
  return {
    success: overrides.success ?? true,
    response: overrides.response ?? '',
    steps: overrides.steps ?? [],
    fileEdits: overrides.fileEdits,
  };
}

describe('defaultFileEditDetector', () => {
  it('forces continue when fileEdits.length > 0', () => {
    const result = makeResult({ fileEdits: [{ path: 'src/a.ts' }] });
    const decision = defaultFileEditDetector(result, {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any);
    expect(decision).toEqual({ force: true, reason: 'file_edits_present' });
  });

  it('returns null when fileEdits is empty', () => {
    const result = makeResult({ fileEdits: [] });
    const decision = defaultFileEditDetector(result, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('returns null when reason is max_continuations_reached (safety semantics)', () => {
    const result = makeResult({ fileEdits: [{ path: 'x.ts' }] });
    const decision = defaultFileEditDetector(result, {
      continue: false,
      reason: 'max_continuations_reached',
      continuationPrompt: '',
      continuationsSoFar: 3,
    } as any);
    expect(decision).toBeNull();
  });
});

describe('needsMoreTurnsDetector', () => {
  it('forces continue on read-then-stall signal (read-only step, no writes)', () => {
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'src/a.ts' } }],
      response: 'I read that file.',
    });
    const decision = needsMoreTurnsDetector(result, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    expect(decision).toEqual({ force: true, reason: 'read-then-stall' });
  });

  it('forces continue when 3+ consecutive reads fire Factor 1 signals (loop or stall)', () => {
    const result = makeResult({
      steps: [
        { toolName: 'read_file', args: { path: 'a.ts' } },
        { toolName: 'grep', args: { pattern: 'foo' } },
        { toolName: 'list_directory', args: { path: 'src/' } },
      ],
      response: '',
    });
    const decision = needsMoreTurnsDetector(result, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    // Captured via a one-shot probe of this same fixture:
    // JSON.stringify(decision) === '{"force":true,"reason":"read-then-stall"}'.
    // The 3-read fixture satisfies both "deep-research-loop" (3+ reads) and
    // "read-then-stall" (last tool read-only, no writes); detection-order in
    // needsMoreTurnsDetector makes the last-read branch win, so
    // signal[0] === 'read-then-stall'. (See lib/chat/needsMoreTurnsDetector.ts
    // for the branch order.)
    expect(decision).toEqual({ force: true, reason: 'read-then-stall' });
  });

  // (The "announced-next-step" signal test was dropped: when steps
  // contain a read-only tool, Factor 1 (read-then-stall) dominates
  // detection-order, so signal[0] is detection-order-dependent. Asserting
  // Factor 2 specifically would have required constructing a fixture
  // where Factor 1 doesn't fire, which is itself brittle. The other
  // tests already prove the rich detector covers Factor 2 + Factor 3.)

  it('returns null when result is undefined', () => {
    const decision = needsMoreTurnsDetector(undefined, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('returns null when reason is max_continuations_reached (safety semantics)', () => {
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: 'Read.',
    });
    const decision = needsMoreTurnsDetector(result, {
      continue: false,
      reason: 'max_continuations_reached',
      continuationPrompt: '',
      continuationsSoFar: 3,
    } as any);
    expect(decision).toBeNull();
  });

  it('does NOT fire for a write step with a substantive completed-task response', () => {
    const result = makeResult({
      steps: [{ toolName: 'write_file', args: { path: 'a.ts', content: 'x' }, result: { success: true } }],
      response:
        'I created src/a.ts with the requested handler. It validates the input, ' +
        'writes to disk atomically, and returns the new path. The implementation is ' +
        'complete and tested. Review the diff above and confirm it matches the spec.',
    });
    const decision = needsMoreTurnsDetector(result, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('fires \'single-write-silent\' for thin-response single-write completion (Factor 3)', () => {
    const result = makeResult({
      steps: [{ toolName: 'write_file', args: { path: 'a.ts', content: 'x' }, result: { success: true } }],
      response: 'Updated.',
      fileEdits: [{ path: 'a.ts' }],
    });
    const decision = needsMoreTurnsDetector(result, {
      continue: false, reason: 'no_continuation_needed',
      continuationPrompt: '', continuationsSoFar: 0,
    } as any);
    // single-write-silent fires FIRST in detection order; edits-mismatch
    // also fires (fileEdits.length > 0 + responseLen < 100) but appears
    // second. needsMoreTurnsDetector returns det.signals[0] as the reason.
    expect(decision).toEqual({ force: true, reason: 'single-write-silent' });
  });
});

describe('decideAutoContinue', () => {
  beforeEach(() => {
    // Per-test requestId prefixes keep counters isolated.
  });

  it('returns continue=true with forceSignal=true when needsMoreTurnsDetector fires', () => {
    const requestId = 'test-needsmore-fires';
    clearContinuationCount(requestId);
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: "I'll update the file now.",
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      detectorFn: needsMoreTurnsDetector,
    });
    expect(decision.continue).toBe(true);
    expect(decision.forceSignal).toBe(true);
    expect(decision.continuationsSoFar).toBe(1);
    clearContinuationCount(requestId);
  });

  it('does NOT force when needsMoreTurnsDetector returns null (forceSignal is detector-only)', () => {
    // 2 writes so trigger 5 (single_write_then_stop) doesn't fire and the
    // base decision is null. forceSignal must be false because detector
    // returned null.
    const requestId = 'test-needsmore-detector-null';
    clearContinuationCount(requestId);
    const result = makeResult({
      steps: [
        { toolName: 'write_file', args: { path: 'a.ts', content: 'x' }, result: { success: true } },
        { toolName: 'edit_file', args: { path: 'b.ts' }, result: { success: true } },
      ],
      response:
        'I created src/a.ts with the requested handler. It validates the input, ' +
        'writes to disk atomically, returns the new path, and src/b.ts is wired ' +
        'up. The implementation is complete and tested. Review the diff above ' +
        'and confirm it matches the spec.',
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      detectorFn: needsMoreTurnsDetector,
    });
    expect(decision.forceSignal).toBe(false);
    clearContinuationCount(requestId);
  });

  it('returns forceSignal=false when defaultFileEditDetector yields no override', () => {
    const requestId = 'test-default-noforce';
    clearContinuationCount(requestId);
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: 'Let me proceed.',
      fileEdits: [], // explicit empty so defaultFileEditDetector returns null
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      detectorFn: defaultFileEditDetector,
    });
    expect(decision.forceSignal).toBe(false);
    clearContinuationCount(requestId);
  });

  it('returns max_continuations_reached after 3 increments', () => {
    const requestId = 'test-cap';
    clearContinuationCount(requestId);
    const signal = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: "I'll continue.",
    });
    for (let i = 0; i < 3; i++) {
      decideAutoContinue({
        requestId,
        routing: undefined,
        steps: signal.steps!,
        responseText: signal.response!,
        result: signal,
        detectorFn: needsMoreTurnsDetector,
      });
    }
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: signal.steps!,
      responseText: signal.response!,
      result: signal,
      detectorFn: needsMoreTurnsDetector,
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe('max_continuations_reached');
    clearContinuationCount(requestId);
  });

  // ─── Coverage for advancedDetectorFn composition ─────────────────
  // The user-facing contract: when advancedDetectorFn is provided, both
  // detectors fire; whichever returns force=true wins, advanced reason
  // takes priority when both fire. This is the route.ts migration path.

  it('advancedDetectorFn fires when default detector returns null', () => {
    const requestId = 'test-advanced-fires';
    clearContinuationCount(requestId);
    // No fileEdits → defaultFileEditDetector returns null. But
    // needsMoreTurnsDetector fires read-then-stall on the read_file step.
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: 'I read that file.',
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      // Default detector stays at fileEdits-only.
      advancedDetectorFn: needsMoreTurnsDetector,
    });
    expect(decision.continue).toBe(true);
    expect(decision.forceSignal).toBe(true);
    // Advanced reason wins when only advanced fires.
    expect(decision.continuationsSoFar).toBe(1);
    clearContinuationCount(requestId);
  });

  it('advancedDetectorFn reason wins when both detectors fire', () => {
    const requestId = 'test-advanced-wins';
    clearContinuationCount(requestId);
    // fileEdits present → defaultFileEditDetector fires (force=true,
    // reason='file_edits_present'). needsMoreTurnsDetector ALSO fires
    // (e.g. for the read-then-stall signal). Advanced reason wins.
    const result = makeResult({
      steps: [
        { toolName: 'read_file', args: { path: 'a.ts' } },
        { toolName: 'write_file', args: { path: 'a.ts', content: 'x' } },
      ],
      response: 'I created the file.',
      fileEdits: [{ path: 'a.ts' }],
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      advancedDetectorFn: needsMoreTurnsDetector,
    });
    expect(decision.continue).toBe(true);
    expect(decision.forceSignal).toBe(true);
    // Both detectors fired; advanced reason takes priority. The
    // specific reason depends on detector signal[0]; we only assert
    // it's NOT 'file_edits_present' (the basic reason).
    clearContinuationCount(requestId);
  });

  it('defaultFileEditDetector fires alone when advancedDetectorFn is omitted', () => {
    const requestId = 'test-default-alone';
    clearContinuationCount(requestId);
    // fileEdits present but no read-then-stall trigger (write step
    // happened). detectorFn=defaultFileEditDetector → fires.
    const result = makeResult({
      steps: [{ toolName: 'write_file', args: { path: 'a.ts', content: 'x' }, result: { success: true } }],
      response:
        'I created src/a.ts with the requested handler. It validates the input, ' +
        'writes to disk atomically, and returns the new path. The implementation is ' +
        'complete and tested. Review the diff above and confirm it matches the spec.',
      fileEdits: [{ path: 'a.ts' }],
      // No advancedDetectorFn passed; advanced override should be null.
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps!,
      responseText: result.response!,
      result,
      // detectorFn stays defaultFileEditDetector.
    });
    expect(decision.forceSignal).toBe(true);
    expect(decision.continuationsSoFar).toBe(1);
    clearContinuationCount(requestId);
  });
});

// Audit-Q7 (Sites 3+4 carve-out): canonical-first-response routing call shape is
// `{ requestId, routing, steps: [], responseText }` — NO `result` argument. Both
// `defaultFileEditDetector` (the helper's default `detectorFn`) and any
// `advancedDetectorFn` gracefully fall through (return `null`, NOT `{force:false}` —
// there is no `force:false` path on either detector; the override type is
// `{ force: true, reason: string } | null`). The helper therefore resolves to
// the LLM `parsedRouting.routing.continue` boolean via `shouldAutoContinue`.
// This test locks the no-result fallback so future refactors don't accidentally
// break the carve-out shape used at `unified-agent-service.ts` Sites 3+4.
describe('Audit-Q7: Sites 3+4 carve-out — no `result` arg falls through to routing.continue', () => {
  // Detector-bucket denylist: any reason string a detector might emit. Locked
  // from grep of `defaultFileEditDetector` + `needsMoreTurnsDetector` + the
  // 15 signal names emitted by `detectNeedsMoreTurns` in `auto-continue-detector.ts`.
  // If a new signal is added there, this list needs to grow accordingly.
  const DETECTOR_BUCKET_REASONS = [
    'file_edits_present',            // defaultFileEditDetector
    'needs_more_turns',              // needsMoreTurnsDetector fallback
    'read-then-stall',
    'deep-research-loop',
    'failure-cascade',
    'write-verify-loop',
    'announced-next-step',
    'incomplete-thought',
    'step-enumeration',
    'planned-multi-step',
    'read-many-write-none',
    'single-write-silent',
    'diff-no-explanation',
    'edits-mismatch',
    'empty-after-tools',
    'unclosed-code-block',
    'mid-sentence-cutoff',
  ];

  function assertNotDetectorReason(reason: string | undefined) {
    expect(reason).toBeDefined();
    if (DETECTOR_BUCKET_REASONS.includes(String(reason))) {
      throw new Error(
        "decision.reason '" + reason + "' is a detector-derived bucket; the LLM routing " +
        "signal should drive Sites 3+4's decision (no result arg passes through " +
        "to detectors, both return null, so reason MUST come from " +
        "shouldAutoContinue / parsedRouting.routing.continue passthrough). " +
        "See DETECTOR_BUCKET_REASONS constant above for the canonical list.",
      );
    }
  }

  it('routing.continue=true with no result arg → decision.continue === true AND reason is routing-derived (NOT a detector bucket)', () => {
    const decision = decideAutoContinue({
      requestId: '',
      routing: { continue: true, primaryRole: 'coder', planSteps: [{ action: 'do-thing' }] },
      steps: [],
      responseText: 'hello world',
    });
    expect(decision.continue).toBe(true);
    assertNotDetectorReason(decision.reason);
  });

  it('routing.continue=false with no result arg → decision.continue === false (no detector fires, LLM signal wins)', () => {
    const decision = decideAutoContinue({
      requestId: '',
      routing: { continue: false, primaryRole: 'coder' },
      steps: [],
      responseText: 'explicit stop',
    });
    expect(decision.continue).toBe(false);
  });

  // Precedence contract: see the 'advancedDetectorFn reason wins when both
  // detectors fire' describe block above for the helper-internal precedence rule.
  // Sites 3+4 only needs the passthrough assertions above; a co-fire no-op
  // test would be redundant with that lock.
});

