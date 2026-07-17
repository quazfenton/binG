/**
 * Retry-route decision helper for the Phase 1/Phase 2 success-signal
 * architecture. Extracted from /opt/bing/web/app/api/chat/route.ts in
 * Phase D so the decision-fn can be unit-tested without POST() mocking
 * + re-imported across consumers (route.ts + future consumers like the
 * unified-agent-loop retry path).
 *
 * ## Why this exists
 *
 * The chat route's retry path (route.ts ~L648 onward) needs a single
 * answer to "should the retry-path enhancements (Priority 1 model
 * rotation + Priority 2 telemetry ranker + enhancement system-message
 * prepend) run for this retry request, given the client's `phase1Status`
 * value?"
 *
 * The 4-state enum + the explicit OR chain was originally inline in
 * route.ts. Extracting it here:
 *  - Closes the code-reviewer's SHOULD-CONSIDER (eval() in the test was
 *    duplicating the logic → single source of truth).
 *  - Lets future consumers (loop-guard, shared-agent-context) gate on
 *    the same decision without re-deriving.
 *  - Keeps the derivation as a pure function: no route-internal state,
 *    no side-effects, no logger dependency. Easy to unit-test in
 *    isolation.
 *
 * ## Decision matrix
 *
 *   phase1Status === 'empty'   → SKIP (LLM was thinking; original model is correct)
 *   phase1Status === 'success' → SKIP (defensive: shouldn't reach the retry code, but be safe)
 *   phase1Status === 'skipped' → SKIP (defensive: shouldn't reach the retry code, but be safe)
 *   phase1Status === 'error'   → APPLY (tool/rate-limit/provider failure → retry with rotation)
 *   phase1Status undefined     → APPLY (backward compat: clients that pre-date phase1Status)
 *
 * ## Why these defensive cases
 *
 * The retry path is triggered by `retryContext.isEmptyResponseRetry === true`.
 * The 4-state enum tells us WHY the previous response was empty — but a
 * legitimate "empty" means "LLM was thinking", while an `error` means
 * "tool failed → retry with rotation is the right move". The defensive
 * skip-cases for success/skipped exist so that if a future client bug
 * triggers a retry for one of those (e.g., the chat hook incorrectly
 * sets isEmptyResponseRetry when phase1Status=success), the route doesn't
 * BUG-out by stripping tools/tool_choice from the retry body.
 *
 * @see /opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md
 * @see /opt/bing/web/app/api/chat/route.ts (Phase D call site)
 */

import type { Phase1Status } from '@/lib/agent/phase-status';

/**
 * Pure function — returns true when the retry-path enhancements should
 * NOT run (preserve the original request + tools + tool_choice).
 *
 * Backward compatible: `undefined` phase1Status returns `false` (apply
 * the existing retry path) so clients that pre-date the phase1Status
 * field still hit the pre-Phase-D behavior.
 *
 * @example
 *   shouldSkipRetryForPhase('empty')   // → true
 *   shouldSkipRetryForPhase('error')   // → false
 *   shouldSkipRetryForPhase(undefined) // → false (backward compat)
 */
export function shouldSkipRetryForPhase(
  phase1Status: Phase1Status | undefined,
): boolean {
  if (phase1Status === undefined) return false; // backward compat
  return (
    phase1Status === 'empty' ||
    phase1Status === 'success' ||
    phase1Status === 'skipped'
  );
}

/**
 * Retry-action discriminator for log emission — pairs with
 * `shouldSkipRetryForPhase()` so any consumer can log the same
 * grep-discoverable value without re-deriving the string.
 *
 * @example
 *   retryActionForPhase('empty')   // → 'skip-enhancement'
 *   retryActionForPhase('error')   // → 'apply-enhancement'
 *   retryActionForPhase(undefined) // → 'apply-enhancement' (backward compat)
 */
export type RetryAction = 'skip-enhancement' | 'apply-enhancement';

export function retryActionForPhase(
  phase1Status: Phase1Status | undefined,
): RetryAction {
  return shouldSkipRetryForPhase(phase1Status)
    ? 'skip-enhancement'
    : 'apply-enhancement';
}
