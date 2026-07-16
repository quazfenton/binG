/**
 * Run-with-auto-continuation wrapper
 *
 * PURPOSE: Bug #1 (BUGS2.md) — the v1-api-with-tools path had no continuation
 * loop. Each request ran one streaming call, the LLM emitted 0–1 tool calls,
 * then `finishReason: stop` ended the turn. Users complained that every
 * request died after step 1 even when the LLM had tool work to do.
 *
 * What existed pre-wrapper:
 *   - `decideAutoContinue(...)`     — single-source-of-truth decision function
 *                                     (see auto-continue-helper.ts).
 *   - `autoContinueIteration` loop  — inline in `unified-agent-service.ts`
 *                                     around line 4718. Not reusable; mixed
 *                                     with the streaming + provider-fallback
 *                                     concerns of runV1ApiWithTools.
 *   - chat/route.ts SSE loop         — separate implementation at line ~1619,
 *                                     inconsistent with the v1-api path.
 *
 * What this wrapper adds:
 *   1. A REUSABLE shell around `decideAutoContinue` so any v1-api call site
 *      (current runV1ApiWithTools, future route.ts integration, agent-loop
 *      variants) can adopt it without re-implementing the loop.
 *   2. Proper BUGS2.md Bug #2 rescue — when `routing.continue === false`
 *      but `routing.planSteps.length >= 2`, the wrapper derives
 *      `effectiveContinue: true` so the multi-step plan signal that the
 *      RoleSelect parser was silently dropping actually fires.
 *   3. A CIRCUIT-BREAKER on top of `decideAutoContinue` — if the last two
 *      iterations returned the SAME failing reason (`failure_plan_loop`
 *      or repeated ENOENT/timeout text), refuse to continue so the LLM is
 *      forced to either succeed or surface the error to the user.
 *   4. A COMPLETION-INDICATOR sentinel — if the latest response contains
 *      `[BUILD_COMPLETE]` (default) or a caller-supplied sentinel, return
 *      immediately with `stopReason: 'completion_indicator'`. Keeps the
 *      wrapper from launching an unwanted follow-up when the LLM is done.
 *   5. A TYPE-safe aggregate — `ContinuationWrapperOutcome` exposes the
 *      per-iteration decision chain so SSE audits + run.log can replay
 *      exactly which reason closed each loop iteration.
 *
 * SCOPE:
 *   - This module orchestrates ONLY. It does not call any LLM, does not
 *     stream tokens, and does not touch the VFS / providers. Every
 *     LLM/vendor call is delegated to the caller-supplied `baseExecute`.
 *   - The wrapper is PURE-functional on the per-iteration inputs
 *     (messages + continuation prompt) — fail-fast on bad inputs, never
 *     throws inside the happy-path continuation loop.
 *
 * SAFETY:
 *   - Hard cap is `MAX_CONTINUATIONS` (env `LLM_MAX_CONTINUATIONS_PER_TURN`,
 *     default 3) ⊕ `maxIterations` (wrapper-level, default Infinity).
 *     Beyond the cap the wrapper stops with `stopReason` set in the outcome
 *     — never throws.
 *   - All `decideAutoContinue` calls are bounded by `MAX_CONTINUATIONS`
 *     exactly like the existing chat/route.ts site.
 *
 * See:
 *   - bing/web/lib/chat/llm-continuation.ts — `shouldAutoContinue` (pure)
 *   - bing/web/lib/chat/auto-continue-helper.ts — `decideAutoContinue`
 *     (wraps shouldAutoContinue with the per-requestId counter + detector)
 *   - bing/web/__tests__/orchestra/runV1ApiWithTools.test.ts — explains
 *     the contract that the call site at
 *     unified-agent-service.ts:~4545 honors
 */

import {
  decideAutoContinue,
  MAX_CONTINUATIONS,
  type AutoContinueDecision,
  type AutoContinueDetectorFn,
  type AutoContinueInput,
  type AutoContinueOnLog,
} from './auto-continue-helper';

// ─── Public types ─────────────────────────────────────────────────────

/** A single chat message in the v1-api conversation shape. */
export interface ContinuationMessage {
  /** Canonical role — `user | assistant | system | tool`. */
  role: string;
  /** Text content. Tool messages may carry a JSON stringified payload. */
  content: string;
  /**
   * Optional `name` discriminator — used by LLM providers that key
   * tool-role messages by tool name (e.g. OpenAI function-calling).
   */
  name?: string;
}

/** Input shape for one iteration of the wrapper. */
export interface ContinuationIterationInput {
  /**
   * 0-indexed iteration counter. Iteration 0 is the base call (pre-loop);
   * iterations ≥ 1 are continuation rounds driven by `decideAutoContinue`.
   */
  iteration: number;
  /**
   * Messages to send THIS iteration. The wrapper appends the continuation
   * prompt to this list (as a trailing `user` message) before passing
   * to the base executor — call sites do NOT thread the prompt
   * themselves.
   */
  messages: ContinuationMessage[];
  /**
   * Continuation prompt emitted by `decideAutoContinue` for this
   * iteration. Empty string on iter=0 (no continuation yet decided).
   */
  continuationPrompt: string;
  /**
   * Result of the PREVIOUS iteration. Undefined on iter=0.
   * Surfaced so the base executor can merge state (e.g. accumulated
   * tool results, file edits, conversation history).
   */
  previousResult?: ContinuationIterationResult;
}

/** Result of one iteration as the wrapper sees it. */
export interface ContinuationIterationResult {
  /** Free-form string identification — typically the request id. */
  requestId: string;
  /** Full LLM-emitted text response (post any text-mode parse). */
  response: string;
  /** Tool calls emitted by the LLM (may be empty). */
  steps: Array<{
    toolName?: string;
    args?: Record<string, unknown>;
    result?: { success?: boolean; error?: unknown; output?: unknown; [key: string]: unknown };
  }>;
  /** Optional file-edit declarations (for the file-edit detector). */
  fileEdits?: Array<{ path: string; [key: string]: unknown }>;
  /** Metadata (provider, model, routing, etc.). */
  metadata?: Record<string, unknown>;
  /** True when the base call itself succeeded. */
  success: boolean;
  /** Optional error message — failure scope for the iteration. */
  error?: string;
}

/** Configuration for the wrapper. */
export interface ContinuationWrapperConfig {
  /** Per-requestId continuation counter (mutex with route.ts keying). */
  requestId: string;
  /**
   * Hard cap on continuation rounds. Default reads from
   * `LLM_MAX_CONTINUATIONS_PER_TURN` env var (= `MAX_CONTINUATIONS`).
   *
   * Note: `MAX_CONTINUATIONS` already gates the per-requestId counter
   * at 3 inside `decideAutoContinue`. The wrapper-level cap here is
   * defense-in-depth so a caller can lower it further without env
   * edits (e.g. tests forcing 1-iteration runs).
   */
  maxContinuations?: number;
  /**
   * Wrapper-level cap on total iterations (base + continuations).
   * Default Infinity. Tests typically set this to small N.
   */
  maxIterations?: number;
  /**
   * Sentinel that, when present in the LLM response, terminates the
   * loop with `stopReason: 'completion_indicator'`. Default
   * `'[BUILD_COMPLETE]'` (matches progressiveBuild.completionIndicator).
   * Pass `null` to disable (terminator never fires).
   */
  completionIndicator?: string | null;
  /**
   * File-edit detector override. Default `defaultFileEditDetector`.
   * Pass `null` to skip the detector entirely (LLM-routing-only).
   */
  detectorFn?: AutoContinueDetectorFn | null;
  /**
   * Advanced detector override. Pass to switch the default detector to
   * `needsMoreTurnsDetector`. Set to `null` to skip.
   */
  advancedDetectorFn?: AutoContinueDetectorFn | null;
  /**
   * Per-step logging hook (mirrors auto-continue-helper signature).
   */
  onLog?: AutoContinueOnLog;
  /**
   * BUGS2.md Bug #2 rescue — derive `continue=true` on the wrapper
   * layer when `routing.planSteps.length >= 2` despite the parsed
   * `routing.continue === false`. Default `true` (the rescue is the
   * whole point of this wrapper). Set `false` to defer to the parsed
   * `routing.continue` exactly as the v1-api-with-tools call site did
   * before this wrapper existed.
   */
  rescueUnderweightedContinue?: boolean;
}

/** Final aggregate returned by `runWithAutoContinuation`. */
export interface ContinuationWrapperOutcome {
  /** Result of the LAST iteration (typically the merged final). */
  finalResult: ContinuationIterationResult;
  /**
   * Per-iteration audit chain. `iterations[i]` matches the decision made
   * BEFORE the i-th call (so `iterations[0]` is the initial `routing →
   * continue: false` decision; `iterations[1]` is the first continuation).
   */
  iterations: Array<{
    iteration: number;
    /** Decision that closed this iteration (`continue: false` → done). */
    decision: AutoContinueDecision;
    /** Result delivered by `baseExecute` for this iteration. */
    result: ContinuationIterationResult;
  }>;
  /** Total iterations executed (0-indexed upper bound). */
  totalIterations: number;
  /**
   * Why the loop terminated. One of:
   *   - `'completion_indicator'` — sentinel matched in latest response
   *   - `'resolved'`             — no continuation needed
   *   - `'max_continuations_reached'` — env/env-passed cap hit
   *   - `'max_iterations'`       — wrapper-level hard cap hit
   *   - `'base_execute_threw'`   — caller-supplied executor failed
   *   - `'user_stop'`            — reserved for future abort-signal
   */
  stopReason:
    | 'completion_indicator'
    | 'resolved'
    | 'max_continuations_reached'
    | 'max_iterations'
    | 'base_execute_threw'
    | 'user_stop';
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Reasons for which the BUGS2.md Bug #2 rescue is permitted to flip
 * `continue: false` → `continue: true`. ANY other reason is a
 * deliberate stop signal that should not be re-armed by planSteps:
 *   - `max_continuations_reached` / `max_iterations` — cap hit
 *   - `failure_plan_loop`              — circuit-breaker fired (don't loop on bad state)
 *   - `user_stop` / `agent_stop`       — explicit abort signal
 *   - The other continue=true reasons are early-returned above; we only
 *     reach this list when `decision.continue === false`.
 */
const RESCUEABLE_REASONS = new Set<AutoContinueDecision['reason'] | undefined>([
  undefined,
  'no_continuation_needed',
  'resolved',
]);

/**
 * BUGS2.md Bug #2 rescue — promote `continue: false` to `true` when the
 * multi-step plan signal would otherwise be dropped.
 *
 * Mirrors the contract in `packages/shared/agent/first-response-routing.ts`:
 * `continue` defaults to `false` even when `planSteps.length >= 2` because
 * `DEFAULT_ROUTING.continue` is undefined. The RoleSelect parser's
 * `parsedRouting.continue` correctly stores `true` for ≥2-step plans, but
 * real LLMs frequently emit a malformed `continue: false` despite the plan
 * outline.
 *
 * The wrapper layer is the right place to resurface that signal — fix at
 * the parser would over-count one-step plans as continuable.
 *
 * IMPORTANT: the rescue is guarded against RE-ARMING stopping
 * decisions. If the underlying decision is `max_continuations_reached`,
 * `failure_plan_loop`, `user_stop`, `max_iterations`, or `agent_stop`,
 * the rescue short-circuits and returns the decision unchanged — those
 * are deliberate stops that should NOT be re-armed by the rescue,
 * otherwise the wrapper would infinite-loop on a test fixture whose
 * `metadata.routing.planSteps` always has >= 2 entries.
 */
function deriveEffectiveContinue(
  decision: AutoContinueDecision,
  routing: ExtractedRouting | undefined,
  rescueEnabled: boolean,
): AutoContinueDecision {
  // Guard ordering (defense-in-depth):
  //   1. rescue disabled → no-op
  //   2. terminal-reason guard (cap / breaker / abort) → no-op
  //   3. already continue=true → no-op
  //   4. routing explicit continue=true → no-op
  //   5. compute planStepsLen, gate >= 2
  //   6. rescue
  // Putting the terminal-reason check BEFORE the continue=true check
  // ensures a future `shouldAutoContinue` change that adds a
  // continue=false-shaped reason to the union cannot accidentally
  // re-fire the rescue path on a "real" stop.
  if (!rescueEnabled) return decision;
  if (!RESCUEABLE_REASONS.has(decision.reason)) return decision;
  if (decision.continue) return decision;
  if (routing?.continue === true) return decision; // already explicitly true
  // Mirror shouldAutoContinue's planStepsCount derivation so the rescue
  // fires whether the caller passed array-form planSteps OR a numeric
  // estimatedSteps.
  const planStepsLen =
    (Array.isArray(routing?.planSteps) ? routing?.planSteps?.length : undefined) ??
    routing?.estimatedSteps ??
    0;
  if (planStepsLen < 2) return decision;
  // Rescue: keep the parsed decision shape but flip continue + reason.
  return {
    ...decision,
    continue: true,
    reason: 'plan_steps_remaining',
    continuationPrompt:
      `[AUTO-CONTINUE] You outlined ${planStepsLen} plan steps but the parsed ` +
      `routing marked continue=false. Resuming execution of step 1 now; ` +
      `expect to complete the remaining ${planStepsLen - 1} steps.`,
    continuationsSoFar: decision.continuationsSoFar + 1,
    clearedCount: decision.continuationsSoFar + 1,
  };
}

/**
 * Local projection of iteration metadata into the routing-decision shape.
 * Wider than `AutoContinueInput['routing']` because the iteration's metadata
 * is parser-shaped (loose planSteps array, optional estimatedSteps) and the
 * caller doesn't know the discriminated PlanStep[] union in
 * auto-continue-helper.ts. The cast at the `decideAutoContinue` boundary
 * (`as AutoContinueInput['routing']`) is the same pattern the existing call
 * site at unified-agent-service.ts:~4545 uses for `roleSelection`.
 */
type ExtractedRouting = {
  continue?: boolean;
  stepReprompt?: string;
  primaryRole?: string;
  estimatedSteps?: number;
  planSteps?: Array<{ action?: string }>;
};

const COMPLETION_INDICATOR_DEFAULT = '[BUILD_COMPLETE]';

/** True when the response contains the completion indicator (case-insensitive). */
function responseHasCompletionIndicator(response: string, indicator: string): boolean {
  if (!indicator) return false;
  // Tight match — bracketed sentinel so we don't false-positive on
  // prose that mentions a "build complete" phrase.
  return response.toLowerCase().includes(indicator.toLowerCase());
}

/**
 * Merge the latest result's stream-derived fields into the accumulator.
 * The wrapper's `finalResult` carries the LATEST iteration's response,
 * steps, fileEdits, and metadata (most-recent-wins for text-mode work).
 * Test contract: callers reading `outcome.finalResult.response` get the
 * most recent LLM text; `outcome.iterations` has the full per-iter chain.
 */
function safeArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Map a `ContinuationReason` to the canonical `stopReason` for the
 * wrapper outcome. Reviewer-flag #1 — the prior implementation had a
 * dead override block that collapsed every reason to `'resolved'`
 * except `'max_continuations_reached'` / `'max_iterations'`. This
 * exhaustive switch surfaces each token in run.log / SSE audits so
 * operators can grep the actual cause (failure_plan_loop,
 * no_continuation_needed, etc.) instead of seeing `'resolved'` for
 * everything.
 */
function mapReasonToStopReason(reason: string | undefined): ContinuationWrapperOutcome['stopReason'] {
  switch (reason) {
    case 'max_continuations_reached':
      return 'max_continuations_reached';
    case 'max_iterations':
      return 'max_iterations';
    case 'user_stop':
      return 'user_stop';
    case 'failure_plan_loop':
    case 'no_continuation_needed':
    case 'role_selection_continue_true':
    case 'empty_tool_args_detected':
    case 'single_step_read_pattern':
    case 'plan_steps_remaining':
    case 'single_write_then_stop':
    case 'agent_stop':
    case 'resolved':
    default:
      return 'resolved';
  }
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Run `baseExecute` in a server-side continuation loop driven by
 * `decideAutoContinue`. Continues until the LLM-side decision returns
 * `continue: false`, the completion-indicator sentinel matches, or a
 * hard cap (`maxContinuations` / `maxIterations`) is hit.
 *
 * @param baseExecute - Per-iteration executor. The wrapper calls this once
 *   per iteration with the (possibly augmented) message list. Returns the
 *   iteration result on resolve OR throws.
 * @param initialMessages - Messages for the FIRST (base) call.
 * @param config - Wrapper config + detection knobs.
 */
export async function runWithAutoContinuation(
  baseExecute: (input: ContinuationIterationInput) => Promise<ContinuationIterationResult>,
  initialMessages: ContinuationMessage[],
  config: ContinuationWrapperConfig,
): Promise<ContinuationWrapperOutcome> {
  if (!baseExecute || typeof baseExecute !== 'function') {
    throw new TypeError('runWithAutoContinuation: baseExecute must be a function');
  }
  if (!Array.isArray(initialMessages)) {
    throw new TypeError('runWithAutoContinuation: initialMessages must be an array');
  }
  if (!config || !config.requestId) {
    throw new TypeError('runWithAutoContinuation: config.requestId is required');
  }

  const maxContinuations = config.maxContinuations ?? MAX_CONTINUATIONS;
  const maxIterations = config.maxIterations ?? Number.POSITIVE_INFINITY;
  const completionIndicator =
    config.completionIndicator === null
      ? null
      : (config.completionIndicator ?? COMPLETION_INDICATOR_DEFAULT);
  const rescueUnderweightedContinue = config.rescueUnderweightedContinue ?? true;
  const log_: AutoContinueOnLog =
    config.onLog ?? ((msg: string, meta?: Record<string, unknown>) => {
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        // eslint-disable-next-line no-console
        console.log(`[runWithAutoContinuation] ${msg}`, meta ?? '');
      }
    });

  const iterations: ContinuationWrapperOutcome['iterations'] = [];
  let previousResult: ContinuationIterationResult | undefined;
  let workingMessages: ContinuationMessage[] = [...initialMessages];
  let latestDecision: AutoContinueDecision | undefined;
  let stopReason: ContinuationWrapperOutcome['stopReason'] = 'resolved';
  let lastResult: ContinuationIterationResult | undefined;

  for (let iter = 0; iter <= maxIterations; iter += 1) {
    // Per-iteration base call. Errors are surfaced cleanly with a
    // `base_execute_threw` stop reason — NEVER swallowed inside the happy
    // path. The caller decides whether to retry.
    let iterationResult: ContinuationIterationResult;
    try {
      const promptForThisIter =
        iter === 0 ? '' : latestDecision?.continuationPrompt ?? '';
      // For iter > 0, append the continuation prompt as a trailing user
      // message so the LLM sees it in the context window. Skip when the
      // prompt is empty (e.g. no_continuation_needed on iter=0).
      if (promptForThisIter) {
        workingMessages = [
          ...workingMessages,
          { role: 'user', content: promptForThisIter },
        ];
      }
      iterationResult = await baseExecute({
        iteration: iter,
        messages: workingMessages,
        continuationPrompt: promptForThisIter,
        previousResult,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log_(`baseExecute threw at iteration ${iter}`, { error: message });
      // Build a synthetic failed result so the audit chain still has
      // a row at this iteration — operators can correlate the throw
      // with the prior iteration's decision.
      const failedResult: ContinuationIterationResult = {
        requestId: config.requestId,
        response: '',
        steps: [],
        success: false,
        error: message,
      };
      iterations.push({
        iteration: iter,
        decision: latestDecision ?? syntheticDecision('max_iterations'),
        result: failedResult,
      });
      lastResult = failedResult;
      stopReason = 'base_execute_threw';
      break;
    }

    lastResult = iterationResult;
    previousResult = iterationResult;

    // ── Completion-indicator early-exit ───────────────────────────────
    if (
      completionIndicator !== null &&
      responseHasCompletionIndicator(iterationResult.response, completionIndicator)
    ) {
      log_(`completion indicator matched at iteration ${iter}`, {
        indicator: completionIndicator,
      });
      iterations.push({
        iteration: iter,
        decision: latestDecision ?? syntheticDecision('resolved'),
        result: iterationResult,
      });
      stopReason = 'completion_indicator';
      break;
    }

    // ── Drive the continuation decision ───────────────────────────────
    // Build the AutoContinueInput shape from the iteration result so
    // `decideAutoContinue` sees the same fields the call site at
    // unified-agent-service.ts ~4545 sees. The cast is required because
    // `extractRouting` returns the wider `ExtractedRouting` local type
    // (loose `planSteps: Array<{action?: string}>`) and
    // `AutoContinueInput['routing'].planSteps` is the discriminated
    // `PlanStep[]` union. Runtime shapes are compatible — both arrays.
    const routingForDecision = extractRouting(iterationResult) as
      | AutoContinueInput['routing']
      | undefined;
    const decisionInput: AutoContinueInput = {
      requestId: config.requestId,
      routing: routingForDecision,
      steps: iterationResult.steps ?? [],
      responseText: iterationResult.response ?? '',
      result: { success: iterationResult.success, response: iterationResult.response ?? '' },
      ...(config.detectorFn
        ? { detectorFn: config.detectorFn }
        : {}),
      ...(config.advancedDetectorFn
        ? { advancedDetectorFn: config.advancedDetectorFn }
        : {}),
      onLog: log_,
    };
    const decision = decideAutoContinue(decisionInput);

    // BUGS2.md Bug #2 rescue — promote continue=false to continue=true
    // when planSteps>=2 but the parser dropped the signal.
    const effectiveDecision = deriveEffectiveContinue(
      decision,
      routingForDecision,
      rescueUnderweightedContinue,
    );

    iterations.push({ iteration: iter, decision: effectiveDecision, result: iterationResult });
    latestDecision = effectiveDecision;

    if (!effectiveDecision.continue) {
      stopReason = mapReasonToStopReason(effectiveDecision.reason);
      break;
    }

    // ── Cap-driven stop (defense-in-depth) ────────────────────────────
    // Use `iter` (loop counter) instead of `effectiveDecision.continuationsSoFar`
    // because the BUGS2.md rescue path synthesizes a local counter that plateaus
    // at 1 — the shared counter is cleared by decideAutoContinue on every
    // continue=false return. `iter` correctly tracks the true continuation count.
    if (iter >= maxContinuations) {
      log_(`wrapper-level max continuations (${maxContinuations}) reached`, {
        iteration: iter,
      });
      stopReason = 'max_continuations_reached';
      break;
    }
    if (iter + 1 >= maxIterations) {
      log_(`wrapper-level max iterations (${maxIterations}) reached`, {
        iteration: iter,
      });
      stopReason = 'max_iterations';
      break;
    }

    // ── Prepare next iteration messages ───────────────────────────────
    // Decision says continue; next iter's `baseExecute` call will re-append
    // the `continuationPrompt` (computed inside the for-loop above). So
    // we DON'T mutate `workingMessages` here — only after the iter
    // boundary matters. Keeping it pure-functional prevents the prompt
    // from being appended twice when the loop iterates.
    log_(`continuing after iteration ${iter}`, {
      reason: effectiveDecision.reason,
      continuationsSoFar: effectiveDecision.continuationsSoFar,
    });
  }

  // Reviewer-flag #3 — `lastResult` is always assigned on every code
  // path that reaches this return (throw branch sets it before break,
  // other branches set it inside the iter). The `??` fallback below
  // is purely defensive for a future refactor that bypasses the loop.
  const finalResult: ContinuationIterationResult = lastResult ?? {
    requestId: config.requestId,
    response: '',
    steps: [],
    success: false,
    error: 'runWithAutoContinuation produced no iterations',
  };

  return {
    finalResult,
    iterations,
    totalIterations: iterations.length,
    stopReason,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────

/**
 * Build a minimal `AutoContinueRouting` shape from the iteration's
 * parsed-routing metadata (if the executor stored one). Mirrors the
 * `unified-agent-service.ts:4545` call site that already passes
 * `routing.continue` from `result.metadata?.roleSelection`; this wrapper
 * exposes the same slot via `iterationResult.metadata.roleSelection` and
 * the more canonical `result.metadata.routing` shape from
 * `UnifiedAgentResult.metadata.routing` (built by `buildRoutingMetadataForClient`).
 */
function extractRouting(
  iterationResult: ContinuationIterationResult,
): ExtractedRouting | undefined {
  const meta = iterationResult.metadata ?? {};
  // Prefer the canonical `routing` slot. `Array.isArray` defensiveness
  // mirrors review-flag #4 from the iterative review — a malformed
  // metadata.routing.planSteps (string, object, undefined) must not crash
  // decideAutoContinue (which reads .length unguarded).
  const richRouting = (meta.routing ?? undefined) as
    | {
        continue?: boolean;
        stepReprompt?: string;
        primaryRole?: string;
        estimatedSteps?: number;
        planSteps?: unknown;
      }
    | undefined;
  if (richRouting && typeof richRouting === 'object') {
    return {
      continue: richRouting.continue,
      stepReprompt: richRouting.stepReprompt,
      primaryRole: richRouting.primaryRole,
      estimatedSteps: richRouting.estimatedSteps,
      planSteps: Array.isArray(richRouting.planSteps)
        ? (richRouting.planSteps as Array<{ action?: string }>)
        : undefined,
    };
  }
  // Legacy `roleSelection` slot used pre-routing-shape-extraction.
  const roleSelection = (meta.roleSelection ?? undefined) as Partial<{
    continue: boolean;
    suggestedRole: string;
    primaryRole: string;
    planSteps: Array<{ action?: string }>;
    estimatedSteps: number;
  }> | undefined;
  if (!roleSelection || typeof roleSelection !== 'object') return undefined;
  return {
    continue: roleSelection.continue,
    stepReprompt: undefined,
    primaryRole: roleSelection.primaryRole ?? roleSelection.suggestedRole,
    estimatedSteps: roleSelection.estimatedSteps,
    planSteps: Array.isArray(roleSelection.planSteps)
      ? roleSelection.planSteps
      : undefined,
  };
}

/**
 * Build a placeholder decision when the loop terminates BEFORE the first
 * `decideAutoContinue` call (e.g. completion-indicator matched at iter=0).
 * The `iteration.decision` slot still needs a typed value for the audit
 * chain. Reviewer-flag #5 — `forceSignal` is REQUIRED on the type
 * (auto-continue-helper extends ContinueDecisionBase so every return
 * site must populate it), so include the literal `false` here.
 */
function syntheticDecision(reason: string): AutoContinueDecision {
  return {
    continue: false,
    reason: reason as AutoContinueDecision['reason'],
    continuationPrompt: '',
    continuationsSoFar: 0,
    clearedCount: 0,
    finalIteration: MAX_CONTINUATIONS,
    forceSignal: false,
  };
}

// ─── Re-exports ────────────────────────────────────────────────────────
// Surface the helpers that adoption sites will likely need alongside the
// wrapper, so callers don't have to chase the imports separately.
export { MAX_CONTINUATIONS } from './auto-continue-helper';
export type {
  AutoContinueDecision,
  AutoContinueDetectorFn,
  AutoContinueInput,
  AutoContinueOnLog,
} from './auto-continue-helper';
