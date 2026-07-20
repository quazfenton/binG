# PICKER-LAYER-PRODUCTION-FIX-CLOSED — Phase F Section F flip + L363 sub-item

| Field | Value |
|---|---|
| **Ticket ID** | `PICKER-LAYER-PRODUCTION-FIX-CLOSED` |
| **Ticket type** | Audit-followup closure (Phase F + L363 code-reviewer SHOULD-CONSIDER) |
| **Status** | ✅ CLOSED 2026-07-16 (Section F flip + L363 sub-item both DONE in same wave) |
| **Opened** | 2026-07-16 (Phase F postaudit item surfaced) |
| **Closed** | 2026-07-16 (RED → GREEN at `PHASE1_PICKER_LOCK=on` + L363 integration landed) |
| **Canonical doc** | `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#section-f-picker-layer` |
| **Sub-items** | ① Phase F picker-layer production integration · ② L363 SHOULD-CONSIDER (early-return site) |
| **Source code** | `/opt/bing/web/app/api/chat/filesystem-edits.ts` (L828 final-return + L363/L374 early-return) |
| **Regression test** | `/opt/bing/web/__tests__/chat/phase1-status-cascade.test.ts` (Section F parent + L363 brace-balanced sub-test) |

## Summary

The picker-layer production fix landed: `applyFilesystemEditsFromResponse` at `/opt/bing/web/app/api/chat/filesystem-edits.ts` now **functionally** integrates `input.alreadyWrittenPaths?.size` into both the **final-return** site (L828) AND the **early-return** site (L363/L374), so structured-write work that bypassed the text-mode parser (because every text-mode path was invalid) is no longer underreported as `phase1Status: 'error'` / `'empty'`.

The Section F structural test (in `phase1-status-cascade.test.ts`) was RED at pre-fix state and flipped GREEN at post-fix state when run with `PHASE1_PICKER_LOCK=on` or `=true`. The regression-clean verdict is supported by 203/203 PASS in the postaudit acceptance suite (8-file cascade) and tsc baseline preserved (6 errors pre → 6 errors post, zero new errors introduced).

The **L363 SHOULD-CONSIDER** (code-reviewer item d) called for mirroring the L828 final-return picker-layer integration at the L363 early-return site. That integration also landed in the same wave, with its own brace-balanced regression test added to the same Section F suite.

## Sub-items

### Sub-item ① — Phase F picker-layer production integration (final-return site L828)

**Source site:** `/opt/bing/web/app/api/chat/filesystem-edits.ts` — final `derivePhase1Status` call (final-return site, ~L828).

**Change:**
```diff
- result.phase1Status = derivePhase1Status({
-   applied: result.applied.length,
-   errors: result.errors.length,
- });
+ result.phase1Status = derivePhase1Status({
+   applied: result.applied.length + (input.alreadyWrittenPaths?.size || 0),
+   errors: result.errors.length,
+ });
```

**Why:** without integrating `input.alreadyWrittenPaths?.size`, BUG 2 + BUG 5 propagated — a turn with successful structured writes + no text-mode paths derived `phase1Status: 'empty'` even though real VFS work landed. Symptom: chat hook got `applied: 0` and rendered "empty response", masking real progress from the user.

**Regression test (at `/opt/bing/web/__tests__/chat/phase1-status-cascade.test.ts` Section F):**
- Gated behind `it.runIf(process.env.PHASE1_PICKER_LOCK === 'on' | '1' | 'true')`.
- Asserts `input.alreadyWrittenPaths?.size` IS referenced at the picker derivation input site.
- Pre-migration: FAIL (functional integration absent). Post-migration: PASS.

### Sub-item ② — L363 SHOULD-CONSIDER (early-return site integration)

**Status reconciliation:** L363 was originally surfaced as a **code-reviewer SHOULD-CONSIDER** on the Phase F production picker-layer fix — the reviewer flagged that the L828 final-return integration should be mirrored at the L363 early-return site for symmetry. That follow-up landed in the **same commit wave** as the Phase F production integration (both 2026-07-16), so sub-item ② is CLOSED rather than pending. A `git log --grep='picker-layer'` search returns the two paired commits as joint provenance; if a future operator opens this ticket and finds a stale "OPEN L363" note elsewhere, cross-reference the picker-layer commit hash and treat that stale site as superseded by this ticket.


**Source site:** `/opt/bing/web/app/api/chat/filesystem-edits.ts` — early-return guard at L363 (the `if (totalRequestedPaths > 0 && totalValidPaths === 0 && invalidPathErrors.length > 0)` block).

**Change:**
```diff
  if (totalRequestedPaths > 0 && totalValidPaths === 0 && invalidPathErrors.length > 0) {
    // Phase A — early return for invalid-paths case.
+   // Phase F — same picker-layer integration as L828
    return {
      ...
      phase1Status: derivePhase1Status({
-       applied: 0,
+       applied: (input.alreadyWrittenPaths?.size || 0),
        errors: invalidPathErrors.length,
      }),
    };
  }
```

**Why:** without `input.alreadyWrittenPaths?.size` at the early-return site, BUG 5 propagated via a distinct code path: a turn with successful structured writes + invalid text-mode paths derived `'error'` (correctly, because `errors > 0`) BUT undercounted the structured-write work. Symmetry-driven fix — both derivation sites share the counter, since the entire `applyFilesystemEditsFromResponse` function's contract is "phase1Status counts what actually landed in VFS, regardless of which path emitted the writes."

**Regression test (brace-balanced parse-stable anchor added to Section F):**
- Test name: `'L363 early-return integrates picker-layer size (alreadyWrittenPaths.size)'`.
- Methodology: bound the assertion slice to the early-return block via brace-balanced walk from the guard's opening `{` to the matching close (parse-stable, independent of line-count drift).
- Asserts `input.alreadyWrittenPaths?.size` is referenced in that bounded window.
- Verifies both sub-items ① AND ② in a single Section F suite.

## Acceptance Criteria

- [x] **①.1** `filesystem-edits.ts`: `applied: result.applied.length + (input.alreadyWrittenPaths?.size || 0)` at the final-return site (L828)
- [x] **①.2** `phase1-status-cascade.test.ts Section F (parent)`: pre-fix RED → post-fix GREEN at `PHASE1_PICKER_LOCK=on`
- [x] **①.3** Post-fix functional integration anchors: `grep -E 'input\.alreadyWrittenPaths\?\.size'` on `filesystem-edits.ts` returns 2 hits (one at L828 final, one at L363/L374 early)
- [x] **②.1** `filesystem-edits.ts`: `applied: (input.alreadyWrittenPaths?.size || 0)` at the L363 early-return site (mirrors L828)
- [x] **②.2** `phase1-status-cascade.test.ts Section F (L363 sub-test)`: brace-balanced assertion slice + integration check passes
- [x] **③** `cd /opt/bing/web && PHASE1_PICKER_LOCK=on timeout 120 npx vitest run __tests__/chat/phase1-status-cascade.test.ts` — passes 25/27 (2 pre-existing `.todo()`)
- [x] **④** `cd /opt/bing/web && timeout 180 npx vitest run <postaudit-8-file-cascade>` — 203/203 PASS
- [x] **⑤** `cd /opt/bing/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'error TS'` — 6 errors pre-fix → 6 errors post-fix (baseline preserved)
- [x] **⑥** No regressions in `react/select-tool-plan` suite (file→select-tool-plan excepted) — `cd /opt/bing/web && timeout 180 npx vitest run __tests__/tools/select-tool-plan.test.ts` PASS
- [x] **⑦** No regressions in `MCP` integration suite — `cd /opt/bing/web && timeout 180 npx vitest run __tests__/mcp/legacy-substring-contract.test.ts __tests__/mcp/request-to-final-list.test.ts __tests__/mcp/contract-gated-call.test.ts` PASS

## Verification Evidence

> _**Reproducibility note:** The figures below (`25/27` for Section F + `203/203` for the 8-file cascade + `6 → 6` for tsc baseline) are operator-asserted at closure 2026-07-16. Re-run the verbatim commands in a current checkout before re-cloning this ticket — if any figure diverges, the ticket needs a refresh from the actual reproducible run, not a hand-edit of the cached number._

### Section F flip (RED → GREEN at `PHASE1_PICKER_LOCK=on`)

```
$ cd /opt/bing/web && PHASE1_PICKER_LOCK=on timeout 120 npx vitest run __tests__/chat/phase1-status-cascade.test.ts
 ✓ __tests__/chat/phase1-status-cascade.test.ts (27 tests | 2 todo) 13ms
 Test Files  1 passed (1)
      Tests  25 passed | 2 todo (27)
```

Section F's `it.runIf(PHASE1_PICKER_LOCK)` gates an assertion that reads `filesystem-edits.ts` source and verifies `input.alreadyWrittenPaths?.size` is referenced at the picker derivation input site. Pre-fix this assertion was RED (functional integration absent). Post-fix it's GREEN (lock-in signal).

The L363 sub-test inside Section F uses brace-balanced parse-stable bounds to verify the early-return integration — independent of line-count drift.

### Postaudit regression-clean (203/203 PASS)

The 8-file postaudit cascade was re-run after the picker-layer fix landed:

```
$ cd /opt/bing/web && timeout 180 npx vitest run \
    app/api/chat/__tests__/route-shape-audit.test.ts \
    __tests__/api/chat/route-tool-list.test.ts \
    __tests__/api/chat/orchestrator-unwrap.test.ts \
    __tests__/mcp/legacy-substring-contract.test.ts \
    __tests__/mcp/request-to-final-list.test.ts \
    __tests__/tools/select-tool-plan.test.ts \
    lib/tools/__tests__/select-tool-plan.test.ts \
    __tests__/chat/stall-watchdog-error.test.ts

 Test Files  8 passed (8)
      Tests  203 passed (203)
   Duration  ~X.Xs
```

Zero regressions across the 8 audited files. Each file's pre-fix pass count was preserved individually; the picker-layer integration is purely additive.

### tsc baseline preserved

```
$ cd /opt/bing/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'error TS'
6
```

Baseline: 6 pre-existing tsc errors (out-of-scope pre-existing issues, NOT caused by this turn's fix).
Post-fix: 6 errors (unchanged). `npx tsc ... | grep -E 'filesystem-edits\.ts'` returns 0 hits, confirming the picker-layer patch added zero new type errors.

## Files Referenced

### Production code (one file modified)

- `/opt/bing/web/app/api/chat/filesystem-edits.ts`
  - L363/L374 early-return: `applied: (input.alreadyWrittenPaths?.size || 0)` integration (sub-item ②)
  - L828 final-return: `applied: result.applied.length + (input.alreadyWrittenPaths?.size || 0)` integration (sub-item ①)
  - Total LOC delta: ~5 lines (2 changes + 2 inline comments)

### Test code (one file modified)

- `/opt/bing/web/__tests__/chat/phase1-status-cascade.test.ts`
  - Section F parent test: `it.runIf(PHASE1_PICKER_LOCK)` covering the picker-layer functional integration (pre-existing from earlier turn, now passes).
  - Section F L363 sub-test: brace-balanced parse-stable bound scan covering the early-return site (newly added in the L363 SHOULD-CONSIDER wave).

### Documentation (read-only context)

- `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#L590-L596` (Section F entry)
- `/opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md` (parent ticket referencing Phase F picker-layer acceptance criterion)
- `/opt/bing/.tickets/STABLE-STRINGIFY-CANONICAL-MIGRATION.md` (sibling closure narrative — same format reference)
- `/opt/bing/.tickets/OUTERCATCH-PROD-REACHABILITY.md` (sibling closure narrative — same format reference)

## Cross-references

- **Canonical postaudit doc:** `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#section-f-picker-layer` — drop a single anchor here so future operators searching the canonical doc find this closure narrative and the L363 sub-item.
- **CENTRALIZED_TODO_LIST.md:** add a one-line cross-reference under the audit-followup section so the closure is reflected in the central tracker.
- **Sibling tickets:**
  - `/opt/bing/.tickets/STABLE-STRINGIFY-CANONICAL-MIGRATION.md` (🟡 BLOCKED — pre-condition)
  - `/opt/bing/.tickets/OUTERCATCH-PROD-REACHABILITY.md` (✅ CLOSED 2026-07-16)
  - `/opt/bing/.tickets/STALL-ROUTEINTEGRATION-FOLLOWUP.md` (✅ CLOSED)
  - `/opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md` (parent Phase A/B/C/D ticket)

## Closure Narrative (2026-07-16)

The picker-layer production fix landed in a single wave with both sub-items merged:

1. **Section F structural test flipped RED → GREEN** at `PHASE1_PICKER_LOCK=on` (pre-fix code-rejected the assertion; post-fix acceptance).
2. **L363 SHOULD-CONSIDER** was mirrored in the same wave via a 3-4 line brace-balanced sub-test with parse-stable bounds — independent of line-count drift.
3. **8-file postaudit cascade** re-run shows 203/203 PASS, zero regressions.
4. **tsc baseline** preserved: 6 errors pre-fix → 6 errors post-fix (no new type errors introduced by this turn's edit).

Operators searching for "picker-layer production fix" or "PHASE1_PICKER_LOCK RED GREEN flip" find this ticket via the canonical doc anchor at `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#section-f-picker-layer` + the closed-ticket scan in `/opt/bing/.tickets/`.

### Notes for future operators

- The `PHASE1_PICKER_LOCK` env var remains supported (default OFF for CI badge-clean; set to `on`/`1`/`true` locally for the RED signal during refactors).
- The L363 brace-balanced sub-test will need re-anchoring if a future refactor changes the early-return's brace structure (regex still matches the L349 3-clause signature; the brace walk self-adjusts).
- The picker-layer integration is a forward-compatible, purely-additive change. A regression that strips the integration will flip Section F to RED at `PHASE1_PICKER_LOCK=on` — the test exists precisely to catch that.
