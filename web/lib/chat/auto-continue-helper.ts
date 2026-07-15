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

import { shouldAutoContinue, type ContinuationDecision, type ContinueDecisionBase, type ContinuationReason } from './llm-continuation';
import { detectNeedsMoreTurns, type DetectableResult } from './auto-continue-detector';
import { createLogger } from '@/lib/utils/logger';
// Re-export Single-Source-of-Truth: ContinueDecision originates in
// llm-continuation.ts (the canonical Stage 0/1 module). auto-continue-helper
// re-exports the same name so backward compat imports keep resolving.
export { type ContinueDecision, type ContinuationDecision, type ContinuationReason } from '@/lib/chat/llm-continuation';

/**
 * Pre-existing TS2304 fix — Stage 0/1 contract types defined here so
 * `AutoContinueInput`'s `routing` / `steps` / `onLog` slots type-check.
 * Mirrors the shapes passed by `route.ts` and other callers; keep aligned
 * with ContinueDecisionBase's Q5 strict semantic anchors in
 * `llm-continuation.ts`. The shapes below are intentionally permissive
 * (every field optional except `toolName`) so callers with partial context
 * (Audit-Q7 Sites 3+4 carve-out: `decideAutoContinue({ routing, steps: [],
 * responseText })` with no `result`) still satisfy the type.
 */
/**
 * Plan-step variants for `AutoContinueRouting.planSteps`.
 *
 * Each variant carries an `action` discriminator that TS narrows on. There is
 * intentionally NO `[key: string]: unknown` index signature: members here are
 * statically-typed per variant so the `attempt`, `maxAttempts`, `toolCount`,
 * `errorsCount` fields are checked at compile time. Adding a new planStep
 * shape means defining a new variant here AND at every callsite that produces
 * it — fail-fast on planStep schema drift instead of silently widening
 * `unknown`.
 */
export type RecoverPlanStep = {
  action: 'recover';
  attempt: number;
  maxAttempts: number;
  errorsCount?: number;
};

export type HasToolCallsPlanStep = {
  action: 'has-tool-calls';
  toolCount: number;
};

export type PlanStep = RecoverPlanStep | HasToolCallsPlanStep;

export type AutoContinueRouting = {
  continue?: boolean;
  stepReprompt?: string;
  primaryRole?: string;
  estimatedSteps?: number;
  /**
   * Optional explicit-flag override — when `true`, the orchestrator continues
   * even if the heuristic-decay signal would otherwise route a stop.
   * Allowed so downstream agents (e.g. self-healer, stateful-agent) can pin
   * a continue decision to a single boolean instead of recomputing routing.
   */
  explicitContinue?: boolean;
  /**
   * Plan steps array — each element is a discriminated union variant.
   * Currently: `RecoverPlanStep` (self-healer trace) and `HasToolCallsPlanStep`
   * (stateful-agent progress). Empty array `[]` is naturally assignable to
   * `PlanStep[]` — no separate `EmptyPlanStep` variant needed.
   */
  planSteps?: PlanStep[];
};

export type AutoContinueStep = {
  toolName?: string;
  args?: Record<string, unknown>;
  result?: {
    success?: boolean;
    error?: unknown;
    output?: unknown;
    [key: string]: unknown;
  };
};

export type AutoContinueOnLog = (
  msg: string,
  meta?: Record<string, unknown>,
) => void;

/**
 * Pre-existing TS2322 fix — combined reason union for AutoContinueDecision.
 * Inherits every ContinuationReason literal from `llm-continuation.ts` AND
 * extends with the 17 detector-bucket reason strings from
 * `auto-continue-detector.ts` (mirror of `DETECTOR_BUCKET_REASONS`).
 * The two reason sets share no overlap — the union is intentional so
 * callers can read `decision.reason` as a single canonical telemetry
 * label regardless of whether the LLM routing or a detector branch fired.
 * AutoContinueDecision declares `reason?: AutoContinueReason` (via Omit
 * extension) so a single field carries both sets without discriminator
 * gymnastics at the read site.
 */
export type AutoContinueReason =
  | ContinuationReason
  | 'file_edits_present'
  | 'needs_more_turns'
  | 'read-then-stall'
  | 'read-loop'
  | 'deep-research-loop'
  | 'failure-cascade'
  | 'write-verify-loop'
  | 'announced-next-step'
  | 'incomplete-thought'
  | 'step-enumeration'
  | 'planned-multi-step'
  | 'read-many-write-none'
  | 'single-write-silent'
  | 'diff-no-explanation'
  | 'edits-mismatch'
  | 'empty-after-tools'
  | 'unclosed-code-block'
  | 'mid-sentence-cutoff'
  | 'ramble-no-tools';

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

/**
 * Bug fix (Audit Item 2) — `AutoContinueResultData` extends
 * `DetectableResult` with three WRAPPER-DERIVED signal arrays that the
 * detectors inspect:
 *
 *   - `errors`                : all tool-failure stringified messages
 *                                extracted from `steps[].result.error`
 *                                or `steps[].result.success === false`.
 *   - `toolFailures`          : `{ toolName, error }` pairs for the
 *                                same set of steps, useful for
 *                                "failure-cascade" and similar
 *                                pattern-name signal emission.
 *   - `incompleteSignals`     : responseText-derived heuristic signal
 *                                names (`announced-next-step`,
 *                                `step-enumeration`,
 *                                `planned-multi-step`,
 *                                `unclosed-code-block`,
 *                                `mid-sentence-cutoff`). Mirrors a
 *                                subset of `detectNeedsMoreTurns`
 *                                Factor 2 + Factor 4 so the wrapper
 *                                pre-computes them and the detector
 *                                consumes the pre-computed array.
 *
 * Pre-computation matters: previously the wrapper only relayed
 * `fileEdits` / `steps` / `stepCount` / `maxSteps` / `toolResults` to
 * the detector, so Factor 1 (tool-call patterns) was the only thing
 * that actually fired. With these arrays pre-populated, the soft gate
 * trips on real signals (a written-failed tool chain, a mid-sentence
 * truncation, a planned-next-step prompt). The 17 detector-bucket
 * reason names enumerate in `DETECTOR_BUCKET_REASONS` below — every
 * emitted reason MUST match one of those 17 slots.
 *
 * Why not just call `detectNeedsMoreTurns` directly inside the wrapper?
 *   - The detectors (`defaultFileEditDetector`,
 *     `needsMoreTurnsDetector`) take
 *     `(result: DetectableResult, continuationDecision)` — keeping the
 *     wrapper transparent to the typed detector signature avoids
 *     breaking every existing callsite. The enrichment is best-effort:
 *     if a future caller passes a `result` whose `steps` /
 *     `responseText` are partial, the wrapper still passes the original
 *     shape to the detector and appends the enriched fields as
 *     additional candidates.
 */
export interface AutoContinueResultData extends DetectableResult {
  // ARCH-001 Flag 1 (Pickup): the 3 helper-derived enrichment fields are
  // OPTIONAL on `AutoContinueResultData`. They are pre-computed by
  // `_enrichResultData` from `result.steps` + `responseText` BEFORE detectors
  // run (steps[].result.error → errors/toolFailures; responseText regex
  // detector → incompleteSignals). Callers do not have to populate them; the
  // helper guarantees populated arrays at the detector call site.
  //
  // Making them optional structurally unblocks passing `UnifiedAgentResult`
  // (which now also carries these as optional) into `decideAutoContinue({ result })`
  // without `as unknown as AutoContinueResultData`. The 4 boundary casts at
  // route.ts:1701 + unified-agent-service.ts:1712/3947/4648 are dropped.
  //
  // Runtime invariant (NOT a type-system one): every value reaching the
  // detectors has all 3 arrays populated by `_enrichResultData`. The
  // `?`-declaration is purely a compile-time concession to upstream callers
  // like `UnifiedAgentResult`, which builds its result shape long before
  // `_enrichResultData` runs. The `__tests__/chat/auto-continue-helper.test.ts`
  // capture-detector suite encodes this invariant via `enriched!.errors!`.
  errors?: string[];
  toolFailures?: Array<{ toolName: string; error: string }>;
  incompleteSignals?: string[];
}

/**
 * Single source of truth (Audit Item 3) — detector-derived bucket reason
 * strings emitted by `defaultFileEditDetector` (file_edits_present) and
 * `needsMoreTurnsDetector` (needs_more_turns + the 15 signal names from
 * `detectNeedsMoreTurns` in `auto-continue-detector.ts`).
 *
 * Exported as `Set<string>` so audit tests (e.g. Audit-Q7 Sites 3+4
 * carve-out in `__tests__/chat/auto-continue-helper.test.ts`) can
 * assert their decision does NOT come from a detector. If a new signal
 * is added to `detectNeedsMoreTurns`, this set MUST grow in lockstep —
 * the asserted contract is "any string a detector emits is in this set".
 */
export const DETECTOR_BUCKET_REASONS: Set<string> = new Set<string>([
  'file_edits_present',           // defaultFileEditDetector
  'needs_more_turns',             // needsMoreTurnsDetector fallback (signal[0] undefined)
  'read-then-stall',
  'read-loop',
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
  'ramble-no-tools',              // rambleNoToolsDetector (>4KB response, 0 tool calls)
]);

/**
 * Single source of truth (Audit Item 3) — `ContinuationReason` literals
 * from `llm-continuation.ts`. Exported as `Set<string>` so audit tests
 * can assert their decision IS driven by an LLM routing signal (vs a
 * detector-derived bucket). Mirror of the typed `ContinuationReason`
 * union — kept as Set<string> because TS doesn't allow `Set<ContinuationReason>`
 * to widen for `.includes(string)` checks without a cast.
 */
export const SHOULD_AUTO_CONTINUE_REASONS: Set<string> = new Set<string>([
  'role_selection_continue_true',
  'empty_tool_args_detected',
  'single_step_read_pattern',
  'plan_steps_remaining',
  'single_write_then_stop',
  'no_continuation_needed',
  'max_continuations_reached',
  'max_iterations',
  'user_stop',
  'agent_stop',
  'resolved',
]);

/**
 * Bug fix (Audit Item 2) — derive `AutoContinueResultData` fields from
 * the wrapper's `steps` + `responseText` inputs. Called inside
 * `decideAutoContinue` BEFORE invoking the detectors so both the basic
 * (`defaultFileEditDetector`) and the advanced (`needsMoreTurnsDetector`)
 * detector see the enriched shape. The 17 detector-bucket reason names
 * correspond 1:1 to the signal names this helper can pre-compute plus
 * the existing Factor 1 (tool-call patterns) and Factor 3 (partial
 * edits) signals that the underlying `detectNeedsMoreTurns` keeps
 * deriving directly.
 *
 * Best-effort: never throws. If `result` / `steps` / `responseText` are
 * sparse, the returned object still has the required shape with empty
 * arrays — the detectors tolerate that (return null or fall through).
 */
function _enrichResultData(
  result: DetectableResult | undefined,
  steps: ReadonlyArray<{ toolName?: string; result?: { success?: boolean; error?: unknown } }> | undefined,
  responseText: string | undefined,
): AutoContinueResultData {
  const stepsToUse = steps ?? result?.steps ?? [];
  const resolvedSteps = (Array.isArray(stepsToUse) ? stepsToUse : []) as Array<{
    toolName?: string;
    result?: { success?: boolean; error?: unknown };
  }>;
  const responseResolved = (responseText ?? result?.response ?? '').toString();

  const errors: string[] = [];
  const toolFailures: Array<{ toolName: string; error: string }> = [];
  for (const s of resolvedSteps) {
    const sr = s?.result;
    if (!sr) continue;
    if (sr.success !== false && !sr.error) continue;
    const rawErr = sr.error;
    const msg = typeof rawErr === 'string' && rawErr.length > 0
      ? rawErr
      : rawErr != null
        ? String(rawErr)
        : 'tool failed';
    errors.push(msg);
    toolFailures.push({ toolName: String(s?.toolName ?? 'unknown'), error: msg });
  }

  const incompleteSignals: string[] = [];
  const lowered = responseResolved.toLowerCase();
  const responseLen = responseResolved.length;
  if (responseLen > 0) {
    // Note: the 'ramble-no-tools' signal is NOT pre-computed here.
    // The `_enrichResultData` pre-compute runs once and pushes signal
    // names onto `incompleteSignals`, but no current detector consumes
    // that array (the existing detectors read `result.response` /
    // `result.steps` / `fileEdits` directly). To avoid dead work in the
    // hot path of `decideAutoContinue`, the ramble rule lives ONLY in
    // the opt-in `rambleNoToolsDetector` function. Callers who want the
    // signal pass `advancedDetectorFn: rambleNoToolsDetector`.
    //
    // announced-next-step — LLM explicitly said it will do something next.
    const announcedNextStep = /\b(i'll now\b|\blet me\b|\bnext i('ll| will)\b|\bi will (start|begin|proceed|continue)\b|\bnow i('ll| will)\b)/;
    if (responseLen < 500 && announcedNextStep.test(lowered)) {
      incompleteSignals.push('announced-next-step');
    }
    // step-enumeration — "Step 1:", "First," on the LAST line.
    const lastLine = responseResolved.split('\n').pop() || '';
    if (
      responseLen < 300 &&
      lastLine.length > 0 &&
      /\b(step \d[:\)]|first[,:]\s*$|second[,:]\s*$|^\s*\d+\.\s*$)/i.test(lastLine)
    ) {
      incompleteSignals.push('step-enumeration');
    }
    // planned-multi-step — response describes a plan without executing it.
    const planWords = /\b(first|then|after that|finally|next)\b/g;
    const planMatch = lowered.match(planWords);
    const planWordCount = planMatch ? planMatch.length : 0;
    if (planWordCount >= 2 && responseLen < 500) {
      incompleteSignals.push('planned-multi-step');
    }
    // unclosed-code-block — odd number of ``` fences near the end.
    const fenceOpen = (responseResolved.match(/```/g) || []).length;
    if (fenceOpen % 2 !== 0 && responseLen > 20) {
      const lastFenceIdx = responseResolved.lastIndexOf('```');
      if (lastFenceIdx > responseLen - 200) {
        incompleteSignals.push('unclosed-code-block');
      }
    }
    // mid-sentence-cutoff — truncated without terminal punctuation.
    const terminalPunct = /[.!?\"\'\)\u201d\u2019]\s*$/;
    if (
      !terminalPunct.test(responseResolved) &&
      responseLen > 30 &&
      responseLen < 1000 &&
      !responseResolved.endsWith('```')
    ) {
      const lastLineTrim = (responseResolved.split('\n').pop() || '').trim();
      const looksLikeCode = /^[\s{}\[\]();><=|&^%$#@!*,.\-\+\/\\]+$/.test(lastLineTrim);
      if (!looksLikeCode) {
        incompleteSignals.push('mid-sentence-cutoff');
      }
    }
  }

  return {
    ...(result ?? {}),
    success: result?.success ?? true,
    // Belt-and-suspenders: `responseResolved` is already `responseText ?? result?.response ?? ''`
    // but the explicit `?? ''` keeps the contract visible if upstream coalescing
    // is ever refactored. DetectableResult.response is required (`string`),
    // so an undefined would break the structural contract.
    response: responseResolved ?? '',
    steps: resolvedSteps as AutoContinueResultData['steps'],
    // Pre-existing TS2552 followup: `result?.fileEdits` is `Array | undefined`
    // when result is undefined; `DetectableResult.fileEdits` is optional
    // (`Array | undefined`), so a bare passthrough compiles, but the runtime
    // check inside `defaultFileEditDetector` is `Array.isArray(result.fileEdits)
    // && result.fileEdits.length > 0` — already guarded at the read site.
    // `?? []` here makes the enriched shape strictly-shape-complete (detectors
    // can read `result.fileEdits.length` without `?.length`), and matches the
    // Step 3 typing in `stateful-agent.ts:runSelfHealingPhase` which expects
    // fileEdits to always be an array.
    fileEdits: result?.fileEdits ?? [],
    errors,
    toolFailures,
    incompleteSignals,
  };
}

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

/**
 * Build a process-unique synthetic requestId for the
 * `phaseTransitionRequestId` fallback used in
 * `web/lib/orchestra/unified-agent-service.ts:1796` (and any other
 * producer that needs to discriminate concurrent /api/chat requests
 * landing in the same millisecond).
 *
 * Format: `${prefix ?? 'unified-phase1'}-${now ?? Date.now()}-${uuid.slice(0, 8)}`
 *
 * Why the UUID suffix (`crypto.randomUUID().slice(0, 8)`): two
 * concurrent requests landing in the same millisecond would otherwise
 * compute the IDENTICAL fallback key, share a counter bucket in
 * `_continuationCounters`, and trip the MAX_CONTINUATIONS=3 cap
 * prematurely. The UUID suffix guarantees process-uniqueness across
 * fan-out producers regardless of ms-floor (R7 fix, PR-V commit
 * eef3a89b). Single source of truth -- production callers and the
 * regression test in `__tests__/chat/auto-continue-helper.test.ts`
 * share this function, so a future DRY revert that drops the suffix
 * fails the R7 regression test automatically.
 *
 * - `prefix?: string`  -- caller-supplied prefix (default
 *   `'unified-phase1'`). Exposed so a future caller can tag its
 *   producers differently in `run.log` / metrics without copying the
 *   template literal.
 * - `now?: number`     -- pinned-date injection for testability. When
 *   omitted, reads `Date.now()` at call time (production path).
 *   Tests pass a frozen ms to deterministically exercise the same-ms
 *   collision window without relying on `vi.setSystemTime`.
 *
 * Returns a string. Never throws. On cryptographic-API
 * unavailability (Node <14.17, certain edge runtimes) the helper
 * falls back to `Math.random().toString(36).slice(2, 10)` --
 * weaker entropy (~52 bits) but still unique per call.
 */
export function buildSyntheticPhaseTransitionRequestId(
  prefix?: string,
  now?: number,
): string {
  const usedNow = typeof now === 'number' ? now : Date.now();
  const uuidSlice =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `${prefix ?? 'unified-phase1'}-${usedNow}-${uuidSlice}`;
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

/**
 * Ramble-no-tools detector: forces a continuation when the model
 * produces a >4KB response (env-tunable via `AUTO_CONTINUE_RAMBLE_BYTES`)
 * AND no tool calls were attempted this turn. This catches the failure
 * mode where an LLM writes a wall of explanatory text without taking
 * any action — almost always indicates it should be nudged to actually
 * DO something (read a file, run a search, write a file). Sub-tool-call
 * scenarios are handled by `needsMoreTurnsDetector` (read-then-stall,
 * deep-research-loop); this detector specifically catches the
 * tool-less-response wall of text.
 *
 * - Mirrors the safety-semantics of `defaultFileEditDetector`:
 *   returns `null` on `max_continuations_reached` so the detector
 *   never overrides the cap-reached stop.
 * - Mirrors the contract of `needsMoreTurnsDetector`:
 *   returns `null` when `result` is undefined (no signal source).
 * - The threshold default (4096 bytes) matches the user-facing
 *   narrative (">4KB no-tools signal") and is conservative enough
 *   to avoid false positives in health responses (e.g. model
 *   explaining a long-form decision tree).
 */
export function rambleNoToolsDetector(
  result: DetectableResult | undefined,
  continuationDecision: ContinuationDecision,
): AutoContinueDetectorOverride | null {
  if (continuationDecision.reason === 'max_continuations_reached') return null;
  if (!result) return null;
  const response = (result.response || '').trim();
  if (!response) return null;
  const threshold = parseInt(
    process.env.AUTO_CONTINUE_RAMBLE_BYTES || '4096',
    10,
  );
  const steps = Array.isArray(result.steps) ? result.steps : [];
  if (response.length > threshold && steps.length === 0) {
    return { force: true, reason: 'ramble-no-tools' };
  }
  return null;
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
/**
 * Pre-existing TS2430 fix — drop `continuationsSoFar` and the
 * `continuationPrompt?: string` (incompatible narrowing from parent's
 * required `string` to optional `string | undefined`) declarations so the
 * extension stays structurally compatible with `ContinueDecisionBase`.
 * Both fields already live on the parent interface; redeclaring them here
 * was triggering TS2430. The Omit extension widens `reason` from
 * `ContinuationReason` to `AutoContinueReason` so detector bucket reasons
 * can ride on the same field as LLM-routing reasons without type loss.
 */
export interface AutoContinueDecision extends Omit<ContinueDecisionBase, 'reason'> {
  /** Combined reason — accepts both LLM routing reasons and detector bucket reasons. */
  reason?: AutoContinueReason;
  /** True if the detector forced the continuation (vs the LLM decision). */
  forceSignal: boolean;
  /** Which detector branch fired (when forceSignal=true). */
  forcedBy?: 'base' | 'advanced';
}

/**
 * Cascade Q4 factory: `buildDecision` is a single typed-narrowed constructor
 * for `AutoContinueDecision`. Keeps every return site in `decideAutoContinue`
 * structurally pinned to the ContinueDecisionBase contract (clearedCount +
 * finalIteration required) without hand-cloning them at three call sites.
 *
 * Step C discriminator (cascade Q5 polish): `BuildDecisionInput` is a
 * DISCRIMINATED UNION keyed on `shouldContinue` with a required
 * `clearedSnapshotKind: 'pre' | 'post'` literal that pins the counter
 * snapshot semantic at compile time:
 *
 *   - `shouldContinue: true`  branch REQUIRES `clearedSnapshotKind: 'post'`.
 *     POST-increment: `clearedCount = continuationsSoFar + 1` (this decision
 *     IS the Nth continuation being dispatched). The factory collapses this
 *     to `clearedCount = continuationsSoFar` (POST-snapshot via the helper's
 *     `incrementContinuationCount(requestId)` which mutates-and-returns).
 *
 *   - `shouldContinue: false` branch REQUIRES `clearedSnapshotKind: 'pre'`.
 *     PRE-snapshot at the moment of decision: `clearedCount = continuationsSoFar`
 *     (the counter at the moment the decision fired; `this many were in-flight`).
 *
 * The discriminator prevents future external callers from accidentally
 * inverting the PRE-vs-POST semantic. Without it, a caller could pass
 * `shouldContinue: true` plus a `continuationsSoFar` value that's PRE-snapshot
 * (off-by-one drift on `clearedCount`); the discriminator enforces a
 * type-safe pairing.
 *
 * Reviewer-invariant protection (cascade Q4 polish): the prior draft typed
 * `clearedCount` and `continuationsSoFar` as independently-required numbers,
 * but the cascade's Q5 invariant in `llm-continuation.ts:257-309` actually
 * pins them to ALWAYS be equal at the moment of decision. The factory
 * collapses them: `continuationsSoFar` is the single source of truth, and
 * `clearedCount` is DERIVED from it. The invariant is now type-enforced
 * (assignment-impossible mismatch), not just convention.
 *
 * Why a factory rather than inline object literals?
 *   * Compile-time exhaustiveness: every return shape passes through the same
 *     type-narrowed constructor, so any drift in ContinueDecisionBase's field
 *     requirements is one-place to fix.
 *   * Telemetry parity: exactly the same telemetry fields are populated at
 *     each site (counter snapshot, detector reason, advanced reason).
 *   * Readability: callers read `buildDecision({ ... })` without memorizing
 *     the 7-field literal shape.
 */

/**
 * Shared fields for BuildDecisionInput variants. The `shouldContinue` and
 * `clearedSnapshotKind` discriminators are NOT in this base — they're
 * pinned on each union variant.
 */
interface BuildDecisionInputBase {
  /**
   * Reason — accepts both LLM routing reasons and detector bucket reasons.
   * Typed as `string | undefined` for caller-side ergonomics; the
   * `buildDecision` factory narrows to `AutoContinueDecision['reason']`
   * (AutoContinueReason | undefined) in its return so the typed contract
   * is preserved end-to-end without forcing every call site to cast.
   */
  reason?: string | undefined;
  forceSignal: boolean;
  forcedBy?: AutoContinueDecision['forcedBy'];
  /** Single source of truth — clearedCount is derived from this in the output. */
  continuationsSoFar: number;
  finalIteration: number;
  continuationPrompt?: string;
}

/**
 * Discriminated union for buildDecision input. The `shouldContinue` literal
 * and the matching `clearedSnapshotKind` literal are pinned per branch so
 * external callers can't accidentally invert PRE vs POST semantic.
 */
export type BuildDecisionInput =
  | (BuildDecisionInputBase & {
      shouldContinue: true;
      /** POST-increment: clearedCount = continuationsSoFar (post-snapshot). */
      clearedSnapshotKind: 'post';
    })
  | (BuildDecisionInputBase & {
      shouldContinue: false;
      /** PRE-snapshot: clearedCount = continuationsSoFar (the in-flight count). */
      clearedSnapshotKind: 'pre';
    });

export function buildDecision(
  input: BuildDecisionInput,
): AutoContinueDecision {
  return {
    continue: input.shouldContinue,
    // Pre-existing TS2322 fix — narrow `string | undefined` to
    // AutoContinueDecision['reason'] (AutoContinueReason | undefined) on
    // assignment. Safe at runtime because every emit site passes either a
    // typed ContinuationReason literal or a known detector-bucket reason
    // string; the Omit extension on AutoContinueDecision widened the parent
    // type to accept both sets without loss of type safety.
    reason: input.reason as AutoContinueDecision['reason'],
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
      // PRE-snapshot: clearedCount = continuationsSoFar at the moment of
      // decision (the cap-hit path reads the in-flight counter before the
      // cleanup). The discriminator union (Step C polish) catches any
      // inversion attempt at compile time.
      clearedSnapshotKind: 'pre',
    });
  }

  const continuationDecision = shouldAutoContinue({
    routing,
    steps,
    responseText,
    continuationsSoFar,
    maxContinuations: MAX_CONTINUATIONS,
  });

  // Bug fix (Audit Item 2) — pre-compute the enriched result shape BEFORE
  // invoking the detectors. The wrapper used to relay `result` verbatim
  // to the detectors (only fileEdits/steps/stepCount/maxSteps/toolResults
  // were derived upstream), so the detectors rarely tripped beyond
  // Factor 1 (file-edit heuristic). The enrichment below populates
  // `errors`, `toolFailures`, `incompleteSignals` so Factor 2 /
  // Factor 4 signals pre-fire on real data without a full
  // `detectNeedsMoreTurns` pass.
  const enrichedResult = _enrichResultData(result, steps, responseText);

  // Primary detector override (file-edit detector by default)
  const detectorOverride = detectorFn(enrichedResult, continuationDecision);

  // Advanced detector override (opt-in richer signal set). When provided,
  // BOTH detectors are evaluated; whichever returns `force: true` wins,
  // with the advanced reason taking priority when both fire. The advanced
  // reason is preferred because it carries a more specific signal name
  // (e.g. `read-then-stall`) than the basic fileEdits reason
  // (`file_edits_present`), giving operators sharper run.log signals.
  const advancedOverride = advancedDetectorFn
    ? advancedDetectorFn(enrichedResult, continuationDecision)
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
      reason: activeOverride?.reason ?? continuationDecision.reason,
      detectorReason: detectorOverride?.reason,
      advancedReason: advancedOverride?.reason,
      forceSignal: activeOverride !== null,
      continuationsSoFar: newCount,
    });
    return buildDecision({
      shouldContinue: true,
      reason: activeOverride?.reason ?? continuationDecision.reason,
      forceSignal: activeOverride !== null,
      forcedBy: activeOverride !== null
        ? (advancedFired ? 'advanced' : 'base')
        : undefined,
      continuationsSoFar: newCount,
      finalIteration: MAX_CONTINUATIONS,
      continuationPrompt: continuationDecision.continuationPrompt,
      // POST-increment: clearedCount = continuationsSoFar (= newCount) AFTER
      // incrementContinuationCount returns. The discriminator union (Step C)
      // catches any PRE-on-continue-true inversion attempt at compile time.
      clearedSnapshotKind: 'post',
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
    // PRE-snapshot: clearedCount = continuationsSoFar at the moment of
    // decision (no-continue branch keeps the in-flight counter as-is).
    // The discriminator union (Step C) catches any POST-on-continue-false
    // inversion attempt at compile time.
    clearedSnapshotKind: 'pre',
  });
}
