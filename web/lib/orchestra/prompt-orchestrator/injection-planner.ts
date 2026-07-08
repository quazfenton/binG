/**
 * prompt-orchestrator/injection-planner.ts
 *
 * The injection planner is the orchestrator of the foundation. Given a
 * target string (e.g. an agent's chat history) and a parsed PromptScript,
 * it produces a new target string with the script's steps injected as
 * `[PO-INJECT ...]...[/PO-INJECT]` markers.
 *
 * Idempotency:
 *   For each (promptId, step, sha) tuple in the script, the planner checks
 *   whether an existing marker with the same tuple is already present in the
 *   target. If yes, the step is skipped (no duplicate injection). If the
 *   payload changes, `sha` changes, and the new step is injected.
 *
 *   The `ts` field is generated fresh on each call and is NOT part of the
 *   idempotency key — see marker-scanner.ts.
 *
 * Insertion modes:
 *   - `append`: concat the marker block at the end of the target (with a
 *     leading newline if needed for readability).
 *   - other modes: fall back to `append` for now. Future modes (after-divider,
 *     replace-block) plug in here without changing the planner's signature.
 */
import { createHash } from 'crypto';
import { scanMarkers, formatMarker, idempotencyKey } from './marker-scanner';
import type { InsertMode, PromptScript } from './types';

/**
 * The set of InsertMode values that this planner version actually implements.
 * When a new mode is added to the `InsertMode` union, extend this set AND
 * implement the corresponding branch in `applyScript`.
 */
const IMPLEMENTED_MODES: ReadonlySet<InsertMode> = new Set<InsertMode>(['append']);

/** Compute the SHA-256 of a payload (hex-encoded). Used as the idempotency key. */
export function calculateSha(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Apply a parsed PromptScript to a target string. Returns the new target
 * with the script's steps injected.
 *
 * Idempotency: re-running with the same script + target is a no-op. The
 * idempotency key is `(promptId, step, sha)` where `sha = SHA-256(payload)`.
 * The `ts` field is generated fresh on each call and is NOT part of the key.
 *
 * Semantic: this is "ADD NEW", NOT "update in place". If a payload changes
 * for the same `(promptId, step)`, BOTH the old and new markers are kept
 * (history of all versions). True in-place update needs a "where in target"
 * planner that is deferred to brainstorm step 5 (adapter writes).
 *
 * Insertion modes: only `append` is currently implemented. Other modes
 * (`after-divider`, `replace-block`) throw an explicit error — better to
 * fail loud than silently fall back to the wrong behavior.
 */
export function applyScript(target: string, script: PromptScript): string {
  // 1. Build the set of existing (promptId, step, sha) tuples.
  const existingMarkers = scanMarkers(target);
  const existingKeys = new Set<string>();
  for (const m of existingMarkers) {
    existingKeys.add(idempotencyKey(m.promptId, m.step, m.sha));
  }

  // 2. Build the new target by appending new markers (idempotency-filtered).
  let updatedTarget = target;

  for (const step of script.steps) {
    // Defense in depth: validate the mode even though the type is now a
    // strict union. A future edit to the union or a runtime mutation could
    // bypass the compile-time check.
    if (!IMPLEMENTED_MODES.has(step.mode)) {
      const implemented = [...IMPLEMENTED_MODES].join(', ');
      throw new Error(
        `[PromptOrchestrator] applyScript: unknown mode '${step.mode}' for step '${step.step}'. Implemented modes: ${implemented}. Other modes (after-divider, replace-block) are reserved for future planner extensions.`,
      );
    }

    const sha = calculateSha(step.payload);
    const key = idempotencyKey(script.promptId, step.step, sha);

    if (existingKeys.has(key)) {
      // Already injected — skip (idempotent).
      continue;
    }

    const injectedBlock = formatMarker(
      script.promptId,
      step.step,
      sha,
      step.mode,
      step.payload,
    );

    // Append with a leading newline if needed for readability. All current
    // modes (append + fallbacks) share this concat strategy.
    const needsLeadingNewline = updatedTarget.length > 0 && !updatedTarget.endsWith('\n');
    updatedTarget += (needsLeadingNewline ? '\n' : '') + injectedBlock;
  }

  return updatedTarget;
}
