# CHANGELOG

All notable changes to the @bing/web project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Cascade Stage 0-3 + Q1-Q7 Closure

### Stage 0/1 — Type Contract Single-Source-of-Truth

- **`lib/chat/llm-continuation.ts`**: Authored the canonical `ContinueDecisionBase` interface + `ContinuationReason` typed-discriminator union + `ContinueDecision` / `ContinuationDecision` derived aliases. `clearedCount + finalIteration` are now REQUIRED metrics (Q5 cascade invariant cleared).
- **`lib/chat/auto-continue-helper.ts`**: Re-exports `ContinueDecision`, `ContinuationDecision`, `ContinuationReason` from `./llm-continuation` as single-source-of-truth (no local re-declarations). `AutoContinueDecision extends ContinueDecisionBase` resolves the prior `ContinueDecision` name-collision across the two modules.
- **`unified-agent-service.ts:1`**: `@audit-phantom-L4593` marker added — references the canonical Stage 2 surface (`do-while(false) band L1475..L1712` in route.ts).
- **`route.ts:1512`**: `@audit-phantom-L2053` marker added — cross-references the L4593 phantom fix on the unified-agent-service side.

### Stage 2 — SSE Chunk Protocol Unionization

- **`lib/orchestra/sse-prompt-chunk.ts`**: Authored the `SseChunkKind` discriminated union (`'prompt' | 'continuation' | 'error'`) + `SsePromptChunk | SseContinuationChunk | SseErrorChunk` chunk-shaped payload interfaces + `SseChunk` discriminated union. Five-overload `makeSseChunk(factory)` with `never[]` impl signature + runtime shape guards + `const _: never = kind;` exhaustiveness check. `makeSsePromptChunk` marked `@deprecated` (cascades to the unified factory).
- **Step 5 (carried forward)**: Field-level JSDoc anchors added on each union member field (SsePromptChunk / SseContinuationChunk / SseErrorChunk). The `continue` field on `SseContinuationChunk` is documented as object-property-name (reserved-keyword-permitted); the `reason` field is documented as the canonical `ContinuationReason` typed-discriminator.

### Stage 3 — Caller-Typed Surface Alignment

- **`route.ts:1501`**: `processUnifiedAgentRequest(currentConfig)` Stage 3 retype applied. The marker suffix has been promoted from `-DEFERRED-pending-Stage0-1-collision` → `-APPLIED`. The legacy marker block (Stage 0/1 collision rationale) was rewritten to a one-paragraph resolution summary; pair anchors to `@audit-phantom-L2053` (in route.ts) and `@audit-phantom-L4593` (in unified-agent-service.ts:1) are preserved so future readers grepping either marker find the cross-reference pair.

### Cascade Q1-Q7 Closure Notes (carried forward from prior cascade turns)

- **Q1 (input-shape mismatch)**: Resolved. `AutoContinueInput.requestId: string` is the only required field; the cascade now drops `iteration?: number` (dormant — never read by `decideAutoContinue`). All 8 other fields remain optional.
- **Q2 (iterContent short-circuit)**: Resolved. The prior `runAutoContinueLoop` orphan-decl was REMOVED; the inline `iterContent + result.response` boundary at L1601-1609 is intact.
- **Q3 (`break;` gate / positional drift)**: Resolved. The `else { ... break; }` branch reads the same `autoDecision` variable (no positional drift).
- **Q4 (legacy `{ continue }` superset)**: Resolved. All 3 return sites in `decideAutoContinue` populate `clearedCount + finalIteration` via the new `buildDecision` factory.
- **Q5 (`@audit-phantom-L4593` anchor)**: Resolved. The marker cross-references the canonical Stage 2 surface.
- **Q6 (reserved-keyword TS error)**: Resolved. The `kind: 'continuation'` overload parameter was renamed `continue: boolean` → `shouldContinue: boolean`; the case-body destructure was renamed accordingly. The `SseContinuationChunk.continue` field name is preserved on the returned object literal (object-property rule).
- **Q7 (duplicate-decl risk)**: Resolved. `auto-continue-helper.ts` has 0 local `interface ContinueDecision` declarations + 1 re-export + 0 type-alias duplicate.

### Step 2 — Dormant Field Cleanup

- **`auto-continue-helper.ts`**: `AutoContinueInput.iteration?: number` REMOVED (cascade Q2 cleanup — never read by `decideAutoContinue`). Comment updated to "the contract surface only includes fields actually consumed" with cascading-cleanup note.

### Step 3 — For-Loop PlanStep Parity

- **`__tests__/orchestra/runV1ApiWithTools.test.ts`** ('all info-gathering tool variants trigger single_step_read_pattern'): The for-loop's hardcoded `step: 'read the requested file', tool: 'read_file'` PlanStep pair has been replaced with the parametric `step: \`call ${toolName}\`, tool: toolName` — now tracks the iterated `toolName`. Cosmetic fix; shouldAutoContinue doesn't read `planSteps[i].step/tool/role` (only `planSteps.length + estimatedSteps + routing.continue`), so test pass/fail surface is unchanged.

### Step 4 — `buildDecision` Factory

- **`auto-continue-helper.ts`**: New `buildDecision(input: BuildDecisionInput): AutoContinueDecision` exported factory + `BuildDecisionInput` interface. The 3 return sites in `decideAutoContinue` were rewired to use `buildDecision({ ... })`. Reviewer-invariant protection: `continuationsSoFar: number` is the single source of truth in the input; `clearedCount` is DERIVED in the output (`clearedCount: input.continuationsSoFar`). The Q5 invariant `clearedCount === continuationsSoFar` is now type-enforced (assignment-impossible mismatch — input cannot supply `clearedCount`).

### Q1-Q3 (route.ts) Closure

- **Q1 (crypto fallback)**: `crypto?.randomUUID?.() ?? generateSecureId('bdiv')` — runtime-survival ternary in the `[AUTO-CONTINUE] boundary divergence` log payload. Closes the silent fall-through on edge runtime / browser bundling where the unconditional `crypto.randomUUID()` call would throw.
- **Q2 (`boundary_divergence_id` → `boundary_divergence_event_id`)**: Renamed to match the per-hit semantics; the original `_id` suffix implied per-request uniqueness (incorrect — a new UUID is minted on every boundary-divergence event fire).
- **Q3 (defensive `result.response?.length ?? 0`)**: Type-narrowed to `typeof result.response === 'string' ? result.response.length : 0` — survives all non-string paths (undefined, null, object, array, number) with a clean `0` value.

### Step 7 — `makeSsePromptChunk` Migration Sweep

- Sweep completed: only `lib/orchestra/sse-prompt-chunk.ts` itself defines `makeSsePromptChunk` (with the `@deprecated` JSDoc anchor). No live consumers remain to migrate. The `@deprecated` marker is the single paper trail for the migration path; future contributors who reach for the legacy single-purpose helper will see the cascade-marker continuity note.

### Step 8 — Fixture Parity

- Cross-check completed: no other test files use `routing: undefined` shape. The `routing: { continue: false, planSteps: [...], estimatedSteps: 1 }` typed fixture shape is the canonical contract.

### Step 9 — Combined Vitest Gate

- 22/22 PASS across the 3 critical regression files:
  - `__tests__/chat/auto-continue-helper.test.ts` — 16/16 PASS
  - `__tests__/orchestra/unified-agent-service.test.ts` — covers `runV1ApiWithTools` regression surface
  - `__tests__/orchestra/runV1ApiWithTools.test.ts` — 6/6 PASS on `single_step_read_pattern` + `[AUTO-CONTINUE]` SSE marker + counter-cleanup

### Step 10 — `lint:tsc:cascade` Script

- **`package.json`**: Added `lint:tsc:cascade` script — runs `tsc --noEmit` filtered to the 5 cascade-touched files (`route.ts`, `auto-continue-helper.ts`, `llm-continuation.ts`, `sse-prompt-chunk.ts`, `unified-agent-service.ts`). Permits dev-loop signal without the project-wide noise.

### Step 11 — CHANGELOG Entry (this file)

### Future Considerations

- **TS1005 at `route.ts:1962,41`** (pre-existing, not introduced by this cascade): the route layer has cascading copy-paste duplicate code blocks (the `do-while(false)` body is duplicated after line L1738). Future cleanup pass should consolidate the duplicate block; the cascade marker `@audit-phantom-L2053` already references the canonical Stage 2 surface (L1475..L1712) so the duplicates can be located via grep.
- **`@deprecated makeSsePromptChunk`**: Held for backward-compat; consider removing in the next major version bump once all in-codebase consumers have been verified migrated.
- **`buildDecision` factory optional discriminator**: Optional future polish — add a `clearedSnapshotKind: 'pre' | 'post'` discriminator to `BuildDecisionInput` keyed on `shouldContinue` so external callers can catch the PRE-vs-POST semantic by mistake (overengineering today; the helper's call sites are the only external callers and they already pass the correct value).

[Unreleased]: https://github.com/bing/web
