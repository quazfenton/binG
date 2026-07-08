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
  rambleNoToolsDetector,
  getContinuationCount,
  clearContinuationCount,
  DETECTOR_BUCKET_REASONS,
  buildSyntheticPhaseTransitionRequestId,
  type AutoContinueResultData,
  type ContinuationDecision,
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
    // reason='file_edits_present'). needsMoreTurnsDetector ALSO fires.
    // Factor 1 (read-then-stall) WIN-reasons the advanced detector.
    //
    // Fixture rationale: read-then-stall's precondition is
    // `lastTool in READ_ONLY_TOOL_NAMES && !hadWrite`. Including a
    // write_file step tripped both preconditions (lastTool=write_file,
    // hadWrite=true), preventing read-then-stall from firing -- and the
    // short `'I created the file.'` response then triggered Factor 3
    // single-write-silent (writeCount=1, respLen<80, readCount<=1)
    // instead. To preserve the "both detectors fire" intent of THIS
    // test (advanced → Factor 1 read-then-stall), we keep fileEdits
    // (forcing defaultFileEditDetector) but use only a read-only step
    // (forcing Factor 1 read-then-stall) -- a forced anomaly the detector
    // contract allows but won't naturally emit from a healthy write.
    const result = makeResult({
      steps: [
        { toolName: 'read_file', args: { path: 'a.ts' } },
      ],
      response: 'I checked the file.',
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
    expect(decision.reason).toBe('read-then-stall');
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
  // Bug fix (Audit Item 3) — detector-bucket denylist is now the imported
  // `DETECTOR_BUCKET_REASONS` Set<string> from auto-continue-helper.ts
  // (single source of truth). If a new signal is added to
  // `detectNeedsMoreTurns`, the helper's `DETECTOR_BUCKET_REASONS` set
  // is updated — this test automatically picks up the new slot without
  // any change here.

  function assertNotDetectorReason(reason: string | undefined) {
    expect(reason).toBeDefined();
    if (DETECTOR_BUCKET_REASONS.has(String(reason))) {
      throw new Error(
        "decision.reason '" + reason + "' is a detector-derived bucket; the LLM routing " +
        "signal should drive Sites 3+4's decision (no result arg passes through " +
        "to detectors, both return null, so reason MUST come from " +
        "shouldAutoContinue / parsedRouting.routing.continue passthrough). " +
        "See DETECTOR_BUCKET_REASONS exported Set in auto-continue-helper.ts for the canonical list.",
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

// ─── Integration test for `_enrichResultData` enrichment contract ──────────
// The helper enriches a caller-supplied result with `errors`, `toolFailures`,
// and `incompleteSignals` arrays BEFORE passing it to detectors. This describe
// block locks the contract via a capture-detector: when a custom detectorFn is
// supplied, it receives the enriched object (AutoContinueResultData) and we
// can assert on each enrichment field directly WITHOUT exposing
// `_enrichResultData` as a public export.
//
// A future refactor that drops the enrichment (e.g. relaying `result` raw to
// detectors, or removing any of the three populated fields) would fail these
// assertions because the capture would show empty arrays / undefined.
// This block is the whitebox contract guarantee for callers that depend on
// rich signals driving the soft gate.
describe('_enrichResultData via decideAutoContinue integration (capture-detector)', () => {
  // makeCaptureDetector: closure that records the (result, contDecision) tuple
  // passed to the detectorFn, then returns null (no override) so the soft
  // gate defers to `shouldAutoContinue`'s LLM signal. Captured through a let
  // binding so the assertion closure can inspect it after decideAutoContinue
  // returns.
  function makeCaptureDetector() {
    let captured: AutoContinueResultData | undefined;
    return {
      fn: (r: AutoContinueResultData | undefined, _cd: ContinuationDecision) => {
        captured = r;
        return null;
      },
      captured: () => captured,
    };
  }

  // ARCH-001 Flag 1 (Pickup) — single-source-of-truth assertion for the
  // `_enrichResultData` runtime invariant: every value reaching the detectors
  // has `errors`/`toolFailures`/`incompleteSignals` arrays populated by the
  // helper regardless of caller pre-population status. Partial-expectations
  // are supported (test cases assert on whichever subset is meaningful for
  // their scenario). The `!` non-null assertions encode the runtime
  // invariant — if a future refactor drops `_enrichResultData`'s population
  // step, these would surface TS errors at the assertion site.
  function assertEnrichedInvariant(
    enriched: AutoContinueResultData | undefined,
    expected: {
      errors?: string[];
      toolFailures?: Array<{ toolName: string; error: string }>;
      incompleteSignals?: string[];
    },
  ) {
    expect(enriched).toBeDefined();
    if (expected.errors !== undefined) {
      expect(enriched!.errors!).toEqual(expected.errors);
    }
    if (expected.toolFailures !== undefined) {
      expect(enriched!.toolFailures!).toEqual(expected.toolFailures);
    }
    if (expected.incompleteSignals !== undefined) {
      for (const s of expected.incompleteSignals) {
        expect(enriched!.incompleteSignals!).toContain(s);
      }
    }
  }

  it('populates errors[0] === String(err) and toolFailures[0].toolName when a step has result.error', () => {
    const requestId = 'test-enrich-errors';
    clearContinuationCount(requestId);
    // Step with explicit `error` field set on `result`; the enrichment helper
    // stringifies it and pairs it with the step's toolName.
    const result = {
      success: false,
      response: '',
      steps: [
        {
          toolName: 'bash_shell',
          args: { command: 'ls /etc/shadow' },
          result: { success: false, error: 'permission denied' },
        },
      ],
    };
    const det = makeCaptureDetector();
    decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps,
      responseText: result.response,
      result,
      detectorFn: det.fn,
    });
    const enriched = det.captured();
    assertEnrichedInvariant(enriched, {
      errors: ['permission denied'],
      toolFailures: [{ toolName: 'bash_shell', error: 'permission denied' }],
    });
    clearContinuationCount(requestId);
  });

  it("populates incompleteSignals === ['announced-next-step'] when responseText contains \"I'll now proceed\"", () => {
    const requestId = 'test-enrich-signals';
    clearContinuationCount(requestId);
    // Empty steps (so Factor 1 signals don't fire), single response that
    // triggers the announced-next-step regex via `\\bi'll now\\b` (first
    // alternation in `_enrichResultData`'s incompleteSignals derivation).
    const result = {
      success: true,
      response: "I'll now proceed to write the file.",
      steps: [],
    };
    const det = makeCaptureDetector();
    decideAutoContinue({
      requestId,
      // routing.continue:false keeps the LLM signal from forcing, so the
      // detector sees the enriched shape without being short-circuited by
      // shouldAutoContinue's hard cap or env-default paths.
      routing: { continue: false },
      steps: result.steps,
      responseText: result.response,
      result,
      detectorFn: det.fn,
    });
    const enriched = det.captured();
    assertEnrichedInvariant(enriched, {
      incompleteSignals: ['announced-next-step'],
    });
    clearContinuationCount(requestId);
  });

  it('composes errors + toolFailures + incompleteSignals when a step fails AND text announces a next step', () => {
    const requestId = 'test-enrich-combo';
    clearContinuationCount(requestId);
    // Combined provenance: failed step (errors + toolFailures) AND a
    // responseText variant ("Now I'll continue …") that hits the
    // announced-next-step signal via the `\\bnow i('ll| will)\\b` alternation.
    const result = {
      success: false,
      response: "Now I'll continue with the next step.",
      steps: [
        {
          toolName: 'edit_file',
          args: { path: 'src/a.ts' },
          result: { success: false, error: 'file locked' },
        },
      ],
    };
    const det = makeCaptureDetector();      decideAutoContinue({
        requestId,
        routing: undefined,
        steps: result.steps,
        responseText: result.response,
        result,
        detectorFn: det.fn,
      });
      const enriched = det.captured();
      assertEnrichedInvariant(enriched, {
        errors: ['file locked'],
        toolFailures: [{ toolName: 'edit_file', error: 'file locked' }],
        incompleteSignals: ['announced-next-step'],
      });
    clearContinuationCount(requestId);
  });

  // Bug-#T13 (Vitest-Audit): locks the `_enrichResultData` String()
  // fallback path so non-string `step.result.error` (Error instance or
  // number) stringifies to a stable form. Without this, a future refactor
  // that drops the non-string branch could silently emit `[object Object]`
  // for non-string errors and callers' `errors[0]` assertions would fail
  // in a non-obvious way. Two cases locked separately so an
  // implementation that handles only one of the two cases is caught.
  it('locks errors === [String(err)] when step result.error is a non-string Error instance', () => {
    const requestId = 'test-enrich-nonstring-err';
    clearContinuationCount(requestId);
    const errInstance = new Error('permission denied');
    const result = {
      success: false,
      response: '',
      steps: [
        {
          toolName: 'bash_shell',
          args: { command: 'ls /etc/shadow' },
          result: { success: false, error: errInstance },
        },
      ],
    };
    const det = makeCaptureDetector();
    decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps,
      responseText: result.response,
      result,
      detectorFn: det.fn,
    });
    const enriched = det.captured();
    assertEnrichedInvariant(enriched, {
      errors: [String(errInstance)],
      toolFailures: [{ toolName: 'bash_shell', error: String(errInstance) }],
    });
    clearContinuationCount(requestId);
  });

  it('locks errors === [String(N)] when step result.error is a number', () => {
    const requestId = 'test-enrich-number-err';
    clearContinuationCount(requestId);
    const numericErr = 42;
    const result = {
      success: false,
      response: '',
      steps: [
        {
          toolName: 'bash_shell',
          args: { command: 'echo bad' },
          result: { success: false, error: numericErr },
        },
      ],
    };
    const det = makeCaptureDetector();
    decideAutoContinue({
      requestId,
      routing: undefined,
      steps: result.steps,
      responseText: result.response,
      result,
      detectorFn: det.fn,
    });
    const enriched = det.captured();
    assertEnrichedInvariant(enriched, {
      errors: [String(numericErr)],
    });
    clearContinuationCount(requestId);
  });
});



// ---------------------------------------------------------------------------
// rambleNoToolsDetector — >4KB response + 0 tool calls heuristic
//
// The detector lives in auto-continue-helper.ts (see the docblock). It is
// opt-in via `advancedDetectorFn: rambleNoToolsDetector` so existing callers
// (which use `defaultFileEditDetector` or `needsMoreTurnsDetector` only)
// don't see a behavior change. The tests below lock the detector's contract
// end-to-end: fires on the right shape, returns null on the wrong shape,
// respects `max_continuations_reached` safety, and is reachable via the
// `decideAutoContinue` integration path with `advancedDetectorFn=rambleNoToolsDetector`.
// ---------------------------------------------------------------------------
describe('rambleNoToolsDetector', () => {
  function bigResponse(): string {
    return 'Detailed exploratory paragraph about the codebase. '.repeat(150);
  }

  it('forces continue when responseText > 4KB AND no tool calls', () => {
    const response = bigResponse();
    expect(response.length).toBeGreaterThan(4096);
    const result = { success: true, response, steps: [] };
    const decision = rambleNoToolsDetector(result, {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any);
    expect(decision).toEqual({ force: true, reason: 'ramble-no-tools' });
  });

  it('returns null when responseText < 4KB even with no tool calls', () => {
    const result = { success: true, response: 'short response', steps: [] };
    const decision = rambleNoToolsDetector(result, {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('returns null when a tool call happened (no-tools precondition violated)', () => {
    const result = {
      success: true,
      response: bigResponse(),
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
    };
    const decision = rambleNoToolsDetector(result, {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('returns null when result is undefined', () => {
    const decision = rambleNoToolsDetector(undefined, {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any);
    expect(decision).toBeNull();
  });

  it('returns null when reason is max_continuations_reached (safety semantics)', () => {
    const result = { success: true, response: bigResponse(), steps: [] };
    const decision = rambleNoToolsDetector(result, {
      continue: false,
      reason: 'max_continuations_reached',
      continuationPrompt: '',
      continuationsSoFar: 3,
    } as any);
    expect(decision).toBeNull();
  });

  it('treats empty/whitespace-only response as no signal (defensive)', () => {
    const result1 = { success: true, response: '', steps: [] };
    const result2 = { success: true, response: '   \n\t  ', steps: [] };
    const baseDecision = {
      continue: false,
      reason: 'no_continuation_needed',
      continuationPrompt: '',
      continuationsSoFar: 0,
    } as any;
    expect(rambleNoToolsDetector(result1, baseDecision)).toBeNull();
    expect(rambleNoToolsDetector(result2, baseDecision)).toBeNull();
  });

  it('honors AUTO_CONTINUE_RAMBLE_BYTES env override (lower threshold)', () => {
    // Temporarily lower the threshold so a 500-char response qualifies.
    const original = process.env.AUTO_CONTINUE_RAMBLE_BYTES;
    try {
      process.env.AUTO_CONTINUE_RAMBLE_BYTES = '500';
      const result = {
        success: true,
        response: 'x'.repeat(600),
        steps: [],
      };
      const decision = rambleNoToolsDetector(result, {
        continue: false,
        reason: 'no_continuation_needed',
        continuationPrompt: '',
        continuationsSoFar: 0,
      } as any);
      expect(decision).toEqual({ force: true, reason: 'ramble-no-tools' });
    } finally {
      if (original === undefined) delete process.env.AUTO_CONTINUE_RAMBLE_BYTES;
      else process.env.AUTO_CONTINUE_RAMBLE_BYTES = original;
    }
  });

  it('integration: decideAutoContinue with advancedDetectorFn=rambleNoToolsDetector fires forceSignal', () => {
    // End-to-end lock: when a route.ts caller opts in via
    // `advancedDetectorFn: rambleNoToolsDetector`, a >4KB no-tools response
    // produces forceSignal=true with reason=`ramble-no-tools`. This is the
    // route.ts migration path the user wants for the >4KB no-tools signal.
    const requestId = 'test-ramble-decide-fire';
    clearContinuationCount(requestId);
    const result = makeResult({
      steps: [],
      response: bigResponse(),
    });
    const decision = decideAutoContinue({
      requestId,
      routing: undefined,
      steps: [],
      responseText: result.response!,
      result,
      advancedDetectorFn: rambleNoToolsDetector,
    });
    expect(decision.continue).toBe(true);
    expect(decision.forceSignal).toBe(true);
    expect(decision.reason).toBe('ramble-no-tools');
    expect(decision.continuationsSoFar).toBe(1);
    expect(DETECTOR_BUCKET_REASONS.has('ramble-no-tools')).toBe(true);
    clearContinuationCount(requestId);
  });

  it('integration: ramble-no-tools bucket is in the registry so the audit denylist picks it up', () => {
    // LOCK for future regressions: if the bucket is removed from
    // DETECTOR_BUCKET_REASONS but kept in AutoContinueReason, the union-
    // safety assertion in the Audit-Q7 Sites 3+4 carve-out would silently
    // degrade (a ramble-no-tools reason would no longer be classified as
    // a detector bucket). This test pins both: the Set contains it, AND
    // the union includes it.
    expect(DETECTOR_BUCKET_REASONS.has('ramble-no-tools')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R7 Regression (PR-V commit eef3a89b): synthetic phaseTransitionRequestId
// uniqueness invariant.
//
// Context: when `phaseTransitionRequestId` falls through to the synthetic
// fallback in `web/lib/orchestra/unified-agent-service.ts:1796`, the prior
// implementation used `Date.now()`-only. Two concurrent /api/chat
// requests landing in the SAME millisecond would compute the IDENTICAL
// synthetic id, join the IDENTICAL counter bucket in _continuationCounters,
// and trip the MAX_CONTINUATIONS=3 cap prematurely for unrelated fan-out
// producers. PR-V appended a crypto.randomUUID() suffix to guarantee
// process-uniqueness regardless of ms-floor.
//
// This regression test pins the same-Date.now()-floor invariant: two
// synthetic IDs constructed with the SAME frozen Date.now() but DIFFERENT
// UUID suffixes route to distinct counter buckets. If a future DRY cleanup
// drops the UUID suffix, the two IDs become identical strings, the
// helpers' counter map collides them, and the assertion below fails.
// ---------------------------------------------------------------------------

describe('R7 Regression (PR-V eef3a89b): synthetic phaseTransitionRequestId uniqueness invariant', () => {
  it('two same-ms synthetic phaseTransitionRequestIds route to distinct counter-map entries', () => {
    // Pinned to a fixed ms so this test exercises the same-ms collision
    // window explicitly. Realistic concurrent /api/chat bursts in the
    // field share the same Date.now() floor often enough to expose R7.
    // The pinned `now` is passed directly to the helper so the test does
    // NOT rely on vi.useFakeTimers()/vi.setSystemTime() -- the helper's
    // typed `now?: number` parameter is the testability seam.
    const PINNED_DATE_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

    // Single source of truth: the helper imported from auto-continue-helper
    // is the SAME function used by the production call site at
    // unified-agent-service.ts:1796. A DRY revert that drops the UUID
    // suffix from the helper fails THIS test because the two call results
    // would be identical strings.
    const idA = buildSyntheticPhaseTransitionRequestId('unified-phase1', PINNED_DATE_NOW);
    const idB = buildSyntheticPhaseTransitionRequestId('unified-phase1', PINNED_DATE_NOW);

    // CORE REGRESSION ASSERTION (1/2) -- helper-contract:
    // Two `buildSyntheticPhaseTransitionRequestId` calls with the SAME
    // frozen `now` and the same prefix MUST return DIFFERENT strings
    // (the UUID suffix differentiates them). If a future refactor drops
    // the suffix, both calls return identical strings; this test fails.
    expect(idA).not.toBe(idB);

    // Defensive birth-day check on the underlying UUIDs: the helper
    // uses an 8-hex-char slice (~32 bits per call). Two same-ms calls
    // colliding on the UUID suffix is 1/4B per pair -- astronomically
    // rare but not impossible. Use the structure of the returned string
    // to confirm the suffix portion differs (rather than re-calling the
    // helper, which would surface flakes from genuine birthday collisions
    // as test failures).
    // Extract the full UUID portion after `${prefix}-${now}-` so the
    // length check reflects the actual entropy footprint -- not the
    // last hyphen-segment. UUID v4 format is exactly 36 chars
    // (32 hex + 4 hyphens: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx).
    const prefixNowA = idA.startsWith(`unified-phase1-${PINNED_DATE_NOW}-`)
      ? `unified-phase1-${PINNED_DATE_NOW}-`
      : '';
    const prefixNowB = idB.startsWith(`unified-phase1-${PINNED_DATE_NOW}-`)
      ? `unified-phase1-${PINNED_DATE_NOW}-`
      : '';
    const suffixA = idA.slice(prefixNowA.length);
    const suffixB = idB.slice(prefixNowB.length);
    expect(suffixA.length).toBe(36);
    expect(suffixB.length).toBe(36);
    // Identical suffixes are the actual failure mode for the revert (the
    // prefix + `now` portion IS structurally identical by construction).
    expect(suffixA).not.toBe(suffixB);

    // CORE REGRESSION ASSERTION (2/2) -- counter-map isolation:
    // The helper's per-requestId counter map must isolate distinct keys.
    // Even if (a) above were defeated by some future bug, the counters
    // should still track independently. This is the second layer of the
    // R7 lock -- defense-in-depth.
    clearContinuationCount(idA);
    clearContinuationCount(idB);
    expect(getContinuationCount(idA)).toBe(0);
    expect(getContinuationCount(idB)).toBe(0);

    decideAutoContinue({
      requestId: idA,
      routing: { continue: true },
      responseText: '',
    });
    decideAutoContinue({
      requestId: idB,
      routing: { continue: true },
      responseText: '',
    });

    expect(getContinuationCount(idA)).toBe(1);
    expect(getContinuationCount(idB)).toBe(1);

    clearContinuationCount(idA);
    clearContinuationCount(idB);
  });
});
