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
 *   - This helper handles the DECISION + COUNTER only.
 *   - The actual stream-and-merge logic stays in each call site because
 *     the two paths use different stream APIs (streamText vs
 *     streamWithConcurrentFallback) and different merge strategies.
 *   - SSE event emission stays in the call sites because the event
 *     shapes differ.
 */

import { shouldAutoContinue, type ContinuationDecision } from './llm-continuation';
import { createLogger } from '@/lib/utils/logger';

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
  result: any,
  continuationDecision: ContinuationDecision,
) => AutoContinueDetectorOverride | null;

/**
 * Default file-edit detector: forces a continuation if the result
 * contains file edits. Mirrors the maybeDetectorContinuation logic
 * in route.ts:111. Returns null if the hard limit was already reached
 * (so the detector never overrides a `max_continuations_reached` stop).
 */
export function defaultFileEditDetector(
  result: any,
  continuationDecision: ContinuationDecision,
): AutoContinueDetectorOverride | null {
  if (continuationDecision.reason === 'max_continuations_reached') {
    return null;
  }
  if (
    result?.fileEdits &&
    Array.isArray(result.fileEdits) &&
    result.fileEdits.length > 0
  ) {
    return { force: true, reason: 'file_edits_present' };
  }
  return null;
}

export interface AutoContinueInput {
  /** Stable identifier for the request — used as the counter key. */
  requestId: string;
  /** Routing metadata from the first-response parse. */
  routing: any;
  /** Steps (tool invocations) from the completed turn. */
  steps: any[];
  /** The final assistant text. */
  responseText: string;
  /**
   * Optional result object — passed to the detector so it can inspect
   * fileEdits, tool results, etc. May be undefined for the very first
   * call before the result is finalized.
   */
  result?: any;
  /**
   * Optional detector override. Defaults to defaultFileEditDetector,
   * which forces a continuation if the result contains file edits.
   * Pass `() => null` to disable the detector entirely.
   */
  detectorFn?: AutoContinueDetectorFn;
  /** Optional logger — defaults to the module-level logger. */
  onLog?: (msg: string, meta?: any) => void;
}

export interface AutoContinueDecision {
  /** True if the caller should issue a follow-up LLM call. */
  continue: boolean;
  /** Reason from shouldAutoContinue (e.g. 'incomplete_response'). */
  reason?: string;
  /** True if the detector forced the continuation (vs the LLM decision). */
  forceSignal: boolean;
  /** New counter value (post-increment if continue=true). */
  continuationsSoFar: number;
  /** The continuation prompt to feed into the next LLM call. */
  continuationPrompt?: string;
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
    onLog,
  } = input;

  const continuationsSoFar = getContinuationCount(requestId);
  const log_ = onLog ?? ((msg: string, meta?: any) => log.info(msg, meta));

  // Hard limit check — mirrors route.ts:1641 `iteration < MAX_CONTINUATIONS - 1`
  if (continuationsSoFar >= MAX_CONTINUATIONS) {
    clearContinuationCount(requestId);
    return {
      continue: false,
      reason: 'max_continuations_reached',
      forceSignal: false,
      continuationsSoFar,
    };
  }

  const continuationDecision = shouldAutoContinue({
    routing,
    steps,
    responseText,
    continuationsSoFar,
    maxContinuations: MAX_CONTINUATIONS,
  });

  // Detector override (file-edit detector by default)
  const detectorOverride = detectorFn(result, continuationDecision);

  const shouldContinue =
    continuationDecision.continue || (detectorOverride?.force ?? false);

  if (shouldContinue) {
    const newCount = incrementContinuationCount(requestId);
    log_('[AutoContinue] triggered', {
      requestId,
      reason: continuationDecision.reason,
      detectorReason: detectorOverride?.reason,
      forceSignal: detectorOverride?.force ?? false,
      continuationsSoFar: newCount,
    });
    return {
      continue: true,
      reason: continuationDecision.reason,
      forceSignal: detectorOverride?.force ?? false,
      continuationsSoFar: newCount,
      continuationPrompt: continuationDecision.continuationPrompt,
    };
  }

  // No continuation — clean up the counter (mirrors route.ts:1689)
  clearContinuationCount(requestId);
  return {
    continue: false,
    reason: continuationDecision.reason,
    forceSignal: false,
    continuationsSoFar,
  };
}
