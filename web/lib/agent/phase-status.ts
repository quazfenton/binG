/**
 * Phase 1 status — unified success-signal for the chat route's Phase 1
 * (initial LLM call → tool execution → filesystem edits).
 *
 * ## Why this exists
 *
 * The chat route's downstream consumers (UI chat hook, retry path,
 * loop-guard, shared agent context) have historically relied on a binary
 * `applied > 0` signal to distinguish "Phase 1 produced edits" from
 * "Phase 1 produced nothing". This conflates 4 structurally distinct
 * outcomes:
 *
 *  - `'success'`: Phase 1 produced edits successfully (≥ 1 filesystem edit
 *    applied AND zero tool errors)
 *  - `'empty'`:   Phase 1 produced nothing (0 edits, 0 errors, not skipped —
 *    LLM was thinking or the response had no actionable content)
 *  - `'error'`:   Phase 1 produced errors (≥ 1 tool error regardless of
 *    edits — error signal wins over success signal)
 *  - `'skipped'`: Phase 1 was bypassed (text-mode-only path, VFS-disabled
 *    path, or no response content at all)
 *
 * A single boolean (`applied > 0`) cannot distinguish these 4 cases. The
 * 4-state enum is the minimum information-theoretic representation:
 * it covers all 6 log-evidence bugs (see PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE),
 * the baseline case, and all known fallback paths.
 *
 * ## Propagation contract
 *
 * The `phase1Status` is set by `applyFilesystemEditsFromResponse` on every
 * return path, then propagated to:
 *
 *  1. The SSE event payload (`route.ts` SSE emit sites)
 *  2. The chat hook (`use-enhanced-chat.ts:L1586`)
 *  3. The retry path (`route.ts` `retryContext?.isEmptyResponseRetry` branch)
 *  4. The loop-guard (`shared-agent-context.ts:L345`)
 *
 * Downstream consumers SHOULD key decisions off `phase1Status` rather than
 * the legacy `applied > 0` boolean. The legacy `status: 'none' | 'auto_applied' | ...`
 * field is preserved for backward compatibility with existing consumers.
 *
 * ## Derivation priority order
 *
 * The derivation is deterministic and prioritizes the most informative
 * signal:
 *
 *   1. Explicit `skipped: true` input → `skipped`
 *   2. `errors > 0`                  → `error` (errors always win)
 *   3. `applied > 0 AND errors == 0` → `success`
 *   4. otherwise                     → `empty`
 *
 * This order ensures the retry path (`phase1Status === 'error' → retry with
 * model rotation`) and the loop-guard (`phase1Status === 'empty' → evaluate`)
 * see the most actionable signal first.
 */

/**
 * The 4-state enum for Phase 1 outcomes.
 */
export type Phase1Status = 'success' | 'empty' | 'error' | 'skipped';

/**
 * Input shape for `derivePhase1Status`. All fields are numeric/boolean counts.
 */
export interface Phase1DerivationInput {
  /** Number of filesystem edits applied (≥ 0). */
  applied: number;
  /** Number of tool errors encountered (≥ 0). */
  errors: number;
  /** Optional explicit skip signal — true when Phase 1 was bypassed. */
  skipped?: boolean;
}

/**
 * Phase 1 outcome shape. Designed to be merged into `FilesystemEditResult` (or
 * any other Phase 1 result type) as additive fields. The `status` field is the
 * legacy 5-state enum (preserved for backward compatibility).
 */
export interface Phase1Outcome {
  /** The unified 4-state Phase 1 status (new field). */
  phase1Status: Phase1Status;
  /** Number of filesystem edits applied (mirrors `applied.length`). */
  applied: number;
  /** Number of tool errors encountered (mirrors `errors.length`). */
  errors: number;
  /** Human-readable reason — useful for log emission + debugging. */
  reason?: string;
  /** Legacy 5-state status — preserved for backward compatibility. */
  status:
    | 'auto_applied'
    | 'accepted'
    | 'denied'
    | 'reverted_with_conflicts'
    | 'none';
}

/**
 * Derive the `phase1Status` from the (applied, errors, skipped) tuple.
 *
 * Priority order (highest signal first):
 *   skipped input → 'skipped'   (explicit gate; explicit user opt-out)
 *   errors > 0    → 'error'     (tool errors always win over success)
 *   applied > 0   → 'success'   (filesystem edits succeeded)
 *   otherwise     → 'empty'     (default — LLM was thinking, etc.)
 *
 * Pure function — never throws, never returns undefined. Defensive against
 * negative inputs by clamping to 0.
 *
 * @example
 *   derivePhase1Status({ applied: 0, errors: 0 })           // → 'empty'
 *   derivePhase1Status({ applied: 3, errors: 0 })           // → 'success'
 *   derivePhase1Status({ applied: 0, errors: 1 })           // → 'error'
 *   derivePhase1Status({ applied: 0, errors: 0, skipped: true }) // → 'skipped'
 *   derivePhase1Status({ applied: 3, errors: 1 })           // → 'error' (errors win)
 */
export function derivePhase1Status(
  input: Phase1DerivationInput,
): Phase1Status {
  // Defensive clamp — negative inputs shouldn't reach this function, but
  // guarding here prevents a runtime NaN/-Infinity from leaking into the
  // SSE payload.
  const applied = Math.max(0, Number.isFinite(input.applied) ? input.applied : 0);
  const errors = Math.max(0, Number.isFinite(input.errors) ? input.errors : 0);

  // Skipped is an explicit gate — even if there were incidental edits
  // (rare but possible in tests), the explicit skip wins because the
  // caller is asserting Phase 1 was bypassed.
  if (input.skipped === true) return 'skipped';

  // Errors always win over applied — if a tool errored out, the user
  // needs to know about it regardless of whether other edits succeeded.
  if (errors > 0) return 'error';

  // Applied with zero errors = success.
  if (applied > 0) return 'success';

  // No errors, no edits, no skip signal = empty (LLM was thinking).
  return 'empty';
}

/**
 * Convenience helper that builds a full `Phase1Outcome` from the derivation
 * inputs + a known legacy `status` value. Useful for the call sites in
 * `applyFilesystemEditsFromResponse` that already know the legacy status.
 *
 * @example
 *   buildPhase1Outcome({ applied: 3, errors: 0 }, 'auto_applied')
 *   // → { phase1Status: 'success', applied: 3, errors: 0, status: 'auto_applied' }
 */
export function buildPhase1Outcome(
  input: Phase1DerivationInput,
  legacyStatus: Phase1Outcome['status'],
  reason?: string,
): Phase1Outcome {
  return {
    phase1Status: derivePhase1Status(input),
    applied: Math.max(0, input.applied),
    errors: Math.max(0, input.errors),
    status: legacyStatus,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/**
 * Default sentinel value when the derivation inputs are unavailable (e.g.,
 * before Phase 1 has even started, or in mock test fixtures). Always returns
 * `'empty'` as the safest default — `'empty'` triggers the loop-guard
 * evaluation rather than skipping it, which is the correct behavior for
 * "Phase 1 hasn't reported yet".
 */
export const DEFAULT_PHASE1_STATUS: Phase1Status = 'empty';
