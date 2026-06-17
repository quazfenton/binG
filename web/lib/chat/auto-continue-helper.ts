/**
 * Auto-Continue Helper — shared decision logic for the shouldAutoContinue
 * flow used by both app/api/chat/route.ts and lib/orchestra/unified-agent-service.ts.
 *
 * Background:
 *   - The route layer (route.ts:1619) and the v1-api-with-tools path
 *     (unified-agent-service.ts:4475) both implement auto-continuation
 *     for incomplete LLM responses. Historically these were two separate
 *     implementations that drifted apart:
 *       * route.ts had: maybeDetectorContinuation, requestId-keyed Map
 *         counter, env-tunable MAX_CONTINUATIONS, SSE event emission,
 *         counter cleanup on exit.
 *       * unified-agent-service.ts had: none of the above; it used a
 *         config-scoped `(config as any)._autoContinueCount` that was
 *         never cleaned up and could collide across concurrent calls.
 *   - This helper extracts the shared decision logic so both paths get
 *     all the features (detector override, requestId-keyed counter,
 *     env-tunable limit, cleanup) with no behavior change for the route
 *     path and a strict improvement for the v1-api-with-tools path.
 *
 * Scope:
 *   - This helper handles the DECISION + COUNTER + DETECTOR-CATALOG.
 *   - The actual stream-and-merge logic stays in each call site because
 *     the two paths use different stream APIs (streamText vs
 *     streamWithConcurrentFallback) and different merge strategies.
 *   - SSE event emission stays in the call sites because the event
 *     shapes differ.
 *
 * Detector catalog (newest exports — see decision docs below):
 *   - defaultFileEditDetector   — basic fileEdits.length > 0 override
 *   - needsMoreTurnsDetector    — richer detector wrapping
 *                                  detectNeedsMoreTurns (15+ signals).
 *                                  Capture-the-best-of-route.ts.
 */

import { shouldAutoContinue, type ContinuationDecision } from './llm-continuation';
import { detectNeedsMoreTurns, type DetectableResult } from './auto-continue-detector';
import { createLogger } from '@/lib/utils/logger';
// Re-export Single-Source-of-Truth: ContinueDecision originates in
// llm-continuation.ts (the canonical Stage 0/1 module). auto-continue-helper
// re-exports the same name so backward compat imports keep resolving.
export { type ContinueDecision, type ContinuationDecision, type ContinuationReason } from '@/lib/chat/llm-continuation';

const log = createLogger('AutoContinue');

/**
 * Per-requestId continuation counter. Mirrors the continuationCounters
 * Map in route.ts:65. Module-level so both call sites share the same
 * counter space — this prevents a request from being continued twice
 * (once by route.ts, once by unified-agent-service.ts) if both paths
 * run for the same requestId.
 */
const _continuationCounters = new Map<string, number>();

/**
 * Env-tunable max continuations per turn. Mirrors route.ts:74.
 * Default 3 — matches the prior hardcoded value in both call sites.
 */
export const MAX_CONTINUATIONS = parseInt(
  process.env.LLM_MAX_CONTINUATIONS_PER_TURN || '3',
  10,
);

export function getContinuationCount(requestId: string): number {
  return _continuationCounters.get(requestId) ?? 0;
}

export function incrementContinuationCount(requestId: string): number {
  const next = (_continuationCounters.get(requestId) ?? 0) + 1;
  _continuationCounters.set(requestId, next);
  return next;
}

export function clearContinuationCount(requestId: string): void {
  _continuationCounters.delete(requestId);
}

export interface AutoContinueDetectorOverride {
  force: boolean;
  reason?: string;
}

export type AutoContinueDetectorFn = (
  result: DetectableResult | undefined,
  continuationDecision: ContinuationDecision,
) => AutoContinueDetectorOverride | null;

/**
 * Default file-edit detector: forces a continuation if the result
 * contains file edits. Mirrors the maybeDetectorContinuation logic
 * in route.ts:111. Returns null if the hard limit was already reached
 * (so the detector never overrides a `max_continuations_reached` stop).
 *
 * Result type tightened to `DetectableResult | undefined` for parity
 * with `needsMoreTurnsDetector`. The v1-api-with-tools call site
 * already passes DetectableResult-shaped objects; route.ts callers
 * pass the same shape (success+response+steps[].toolName+optional fileEdits).
 */
export function defaultFileEditDetector(
  result: DetectableResult | undefined,
  continuationDecision: ContinuationDecision,
): AutoContinueDetectorOverride | null {
  if (continuationDecision.reason === 'max_continuations_reached') {
    return null;
  }
  if (!result) return null;
  if (Array.isArray(result.fileEdits) && result.fileEdits.length > 0) {
    return { force: true, reason: 'file_edits_present' };
  }
  return null;
}

/**
 * Richer detector: wraps `detectNeedsMoreTurns` from auto-continue-detector.ts.
 * Inspects ~15+ signals grouped into 4 factors:
 *
 *   1. Tool-call patterns   — read-then-stall, deep-research-loop,
 *                              failure-cascade, write-verify-loop
 *   2. Explicit signals     — announced-next-step, incomplete-thought,
 *                              step-enumeration, planned-multi-step
 *   3. Partial edit det.    — read-many-write-none, single-write-silent,
 *                              diff-no-explanation, edits-mismatch
 *   4. Response quality     — empty-after-tools, unclosed-code-block,
 *                              mid-sentence-cutoff
 *
 * "Best consolidation of best parts": this is what route.ts's
 * `maybeDetectorContinuation` (app/api/chat/route.ts:79) effectively
 * does inline. Exposing it here as a named helper means route.ts can
 * later adopt `decideAutoContinue(..., needsMoreTurnsDetector)` as a
 * drop-in replacement WITHOUT losing the richer signals — the prior
 * audit identified this as the unification target.
 *
 * Returns:
 *   - `null` if the max was already reached (so the detector never
 *     overrides a `max_continuations_reached` stop — same safety
 *     semantics as `defaultFileEditDetector`).
 *   - `null` if `result` is undefined (no signal source).
 *   - `{ force: true, reason: <signal-name> }` using the FIRST signal
 *     that fired. Note: signal order is *detection order* (Factor 1 →
 *     Factor 2 → Factor 3 → Factor 4), not priority. The full signal
 *     list lives on `TurnDetectionResult.signals` if a caller needs
 *     all-firing names; this field is just a single-string reason
 *     label for run.log and the SSE payload.
 *
 * Use this over `defaultFileEditDetector` when:
 *   - You want read-then-stall / deep-research-loop / mid-sentence-cutoff
 *     and similar non-fileEdit triggers.
 *   - You want signal-level granularity in run.log / metrics.
 *
 * Use `defaultFileEditDetector` when:
 *   - You only care about fileEdits.length > 0 (cheap heuristic; no
 *     deep signal scan; doesn't pull in auto-continue-detector.ts).
 */
export function needsMoreTurnsDetector(
  result: DetectableResult | undefined,
  continuationDecision: ContinuationDecision,
): AutoContinueDetectorOverride | null {
  if (continuationDecision.reason === 'max_continuations_reached') return null;
  if (!result) return null;
  const det = detectNeedsMoreTurns(result);
  if (!det?.needsMoreTurns) return null;
  return {
    force: true,
    reason: det.signals?.[0] ?? 'needs_more_turns',
  };
}

export interface AutoContinueInput {
  requestId: string;
  // Cascade Q2 cleanup: the `iteration?: number` field was previously declared
  // as part of a Stage 3 retype plan, but `decideAutoContinue` never reads it.
  // It was a dormant shape: callers passing it had no functional effect, and
  // future readers might assume it gates the loop counter. Dropped here so the
  // contract surface only includes fields actually consumed.
  //
  // Optional shape (now): the Stage 3 caller passes only `requestId` (the rest
  // is supplied by route.ts via the typed `result` arg). Other fields remain
  // optional so the full decision logic keeps working when invoked from wider
  // callers.
  routing?: AutoContinueRouting;
  steps?: AutoContinueStep[];
  responseText?: string;
  result?: AutoContinueResultData;
  detectorFn?: AutoContinueDetectorFn;
  advancedDetectorFn?: AutoContinueDetectorFn;
  onLog?: AutoContinueOnLog;
}

// Stage 0/1 contract alignment (cascade Q3 + Q5): the legacy
// `AutoContinueDecision` shape now EXTENDS `ContinueDecisionBase` from
// `./llm-continuation` via TypeScript interface inheritance. This is
// the structural-fix for Q1 + Q5: the `decideAutoContinue` return
// type is `AutoContinueDecision` (which IS-A `ContinueDecision` via
// inheritance), so typed gates downstream (route.ts `autoDecision.continue`,
// runV1ApiWithTools.test.ts `decision.reason` + `decision.clearedCount`
// reads) see the canonical surface area spelled out by the base.
// Excess fields (`forceSignal`, `forcedBy`, `continuationsSoFar`,
// `continuationPrompt`) live on the structural superset and are still
// readable from `autoDecision.<field>` in route.ts without casts.

// Q1-Q5 cascade structural fix: extend the INTERFACE anchor
// (ContinueDecisionBase) rather than the type alias (ContinueDecision).
// TypeScript supports interface extension of type aliases via structural
// resolution, but the cross-file interface-vs-type-alias path can be
// brittle when package-sync forks resolve differently. `ContinueDecisionBase`
// is the literal `interface` declaration in `./llm-continuation`, so
// extending it directly pins to the canonical surface without alias hops.
export interface AutoContinueDecision extends ContinueDecisionBase {
  /** True if the detector forced the continuation (vs the LLM decision). */
  forceSignal: boolean;
  /** New counter value (post-increment if continue=true). */
  continuationsSoFar: number;
  /** The continuation prompt to feed into the next LLM call. */
  continuationPrompt?: string;
  /** Which detector branch fired (when forceSignal=true). */
  forcedBy?: 'base' | 'advanced';
}

/**
 * Cascade Q4 factory: `buildDecision` is a single typed-narrowed constructor
 * for `AutoContinueDecision`. Keeps every return site in `decideAutoContinue`
 * structurally pinned to the ContinueDecisionBase contract (clearedCount +
 * finalIteration required) without hand-cloning them at three call sites.
 *
 * Why a factory rather than inline object literals?
 *   * Compile-time exhaustiveness: every return shape passes through the same
 *     type-narrowed constructor, so any drift in ContinueDecisionBase's field
 *     requirements is one-place to fix.
 *   * Telemetry parity: exactly the same telemetry fields are populated at
 *     each site (counter snapshot, detector reason, advanced reason).
 *   * Readability: callers read `buildDecision({ ... })` without memorizing
 *     the 7-field literal shape.
 *
 * Reviewer-invariant protection (cascade Q4 polish): the prior draft typed
 * `clearedCount` and `continuationsSoFar` as independently-required numbers,
 * but the cascade's Q5 invariant in `llm-continuation.ts:257-309` actually
 * pins them to ALWAYS be equal at the moment of decision (POST-increment on
 * `continue=true`, PRE-snapshot on `continue=false`). Letting callers pass
 * them independently would permit future external callers to violate the
 * invariant by mistake. The factory collapses them: `continuationsSoFar` is
 * the single source of truth, and `clearedCount` is DERIVED from it. The
 * invariant is now type-enforced (assignment-impossible mismatch), not just
 * convention.
 */
export interface BuildDecisionInput {
  shouldContinue: boolean;
  reason?: AutoContinueDecision['reason'];
  forceSignal: boolean;
  forcedBy?: AutoContinueDecision['forcedBy'];
  /** Single source of truth — clearedCount is derived from this in the output. */
  continuationsSoFar: number;
  finalIteration: number;
  continuationPrompt?: string;
}

export function buildDecision(
  input: BuildDecisionInput,
): AutoContinueDecision {
  return {
    continue: input.shouldContinue,
    reason: input.reason,
    forceSignal: input.forceSignal,
    forcedBy: input.forcedBy,
    continuationsSoFar: input.continuationsSoFar,
    // Derived invariant: clearedCount ALWAYS equals continuationsSoFar at the
    // moment of decision (POST-increment on continue=true, PRE-snapshot on
    // continue=false). See cascade Q5 in llm-continuation.ts:257-309.
    clearedCount: input.continuationsSoFar,
    finalIteration: input.finalIteration,
    continuationPrompt: input.continuationPrompt,
  };
}

/**
 * Decide whether to auto-continue. This is the single source of truth
 * for the auto-continue decision used by both route.ts and
 * unified-agent-service.ts.
 *
 * Behavior:
 *   1. Reads the per-requestId counter (creates entry on first call).
 *   2. Applies the hard limit (MAX_CONTINUATIONS) — if reached, returns
 *      `continue: false` and clears the counter.
 *   3. Calls shouldAutoContinue with the current counter + max.
 *   4. Calls the detector function for an override.
 *   5. If EITHER the LLM decision OR the detector says continue,
 *      increments the counter and returns the continuation prompt.
 *   6. If NEITHER says continue, clears the counter (cleanup) and
 *      returns `continue: false`.
 *
 * The caller is responsible for:
 *   - Actually issuing the follow-up LLM call (using continuationPrompt)
 *   - Merging the result with the original response
 *   - Emitting any client-facing events
 *   - Handling errors from the follow-up call
 */
export function decideAutoContinue(input: AutoContinueInput): AutoContinueDecision {
  const {
    requestId,
    routing,
    steps,
    responseText,
    result,
    detectorFn = defaultFileEditDetector,
    advancedDetectorFn,
    onLog,
  } = input;

  const continuationsSoFar = getContinuationCount(requestId);
  const log_ = onLog ?? ((msg: string, meta?: any) => log.info(msg, meta));

  // Hard limit check — mirrors route.ts:1641 `iteration < MAX_CONTINUATIONS - 1`
  if (continuationsSoFar >= MAX_CONTINUATIONS) {
    clearContinuationCount(requestId);
    return buildDecision({
      shouldContinue: false,
      reason: 'max_continuations_reached',
      forceSignal: false,
      continuationsSoFar,
      finalIteration: MAX_CONTINUATIONS,
    });
  }

  const continuationDecision = shouldAutoContinue({
    routing,
    steps,
    responseText,
    continuationsSoFar,
    maxContinuations: MAX_CONTINUATIONS,
  });

  // Primary detector override (file-edit detector by default)
  const detectorOverride = detectorFn(result, continuationDecision);

  // Advanced detector override (opt-in richer signal set). When provided,
  // BOTH detectors are evaluated; whichever returns `force: true` wins,
  // with the advanced reason taking priority when both fire. The advanced
  // reason is preferred because it carries a more specific signal name
  // (e.g. `read-then-stall`) than the basic fileEdits reason
  // (`file_edits_present`), giving operators sharper run.log signals.
  const advancedOverride = advancedDetectorFn
    ? advancedDetectorFn(result, continuationDecision)
    : null;

  const detectorFired = (detectorOverride?.force ?? false);
  const advancedFired = (advancedOverride?.force ?? false);

  // Pick the more-specific reason: advanced wins when both fire.
  const activeOverride = advancedFired
    ? advancedOverride
    : detectorFired
      ? detectorOverride
      : null;

  const shouldContinue =
    continuationDecision.continue || (activeOverride !== null);

  if (shouldContinue) {
    const newCount = incrementContinuationCount(requestId);
    log_('[AutoContinue] triggered', {
      requestId,
      reason: continuationDecision.reason,
      detectorReason: detectorOverride?.reason,
      advancedReason: advancedOverride?.reason,
      forceSignal: activeOverride !== null,
      continuationsSoFar: newCount,
    });
    return buildDecision({
      shouldContinue: true,
      reason: continuationDecision.reason,
      forceSignal: activeOverride !== null,
      forcedBy: activeOverride !== null
        ? (advancedFired ? 'advanced' : 'base')
        : undefined,
      continuationsSoFar: newCount,
      finalIteration: MAX_CONTINUATIONS,
      continuationPrompt: continuationDecision.continuationPrompt,
    });
  }

  // No continuation — clean up the counter (mirrors route.ts:1689)
  clearContinuationCount(requestId);
  return buildDecision({
    shouldContinue: false,
    reason: continuationDecision.reason,
    forceSignal: false,
    forcedBy: undefined,
    continuationsSoFar,
    finalIteration: MAX_CONTINUATIONS,
  });
}
