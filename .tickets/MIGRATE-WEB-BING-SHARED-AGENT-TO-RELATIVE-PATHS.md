Ticket — Migrate `/opt/bing/web/.bing-shared/agent/` to relative-path imports (out-of-scope from Part 3 closure)

**Ticket type:** postaudit-followup (correction-of-closure)
**Status:** 🟡 OPEN 2026-07-16 (MIGRATION WORK NEVER STARTED — first hoist-epic relocation cycle is tracked separately below)
**Opened:** 2026-07-16
**Code-reviewer reference:** SHOULD-CONSIDER (b) on Part 3 closure correction turn (2026-07-16) — see `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md:165`-`169`.

## Summary

Part 3 closure narrative in `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` initially claimed that the user's `grep` for un-migrated raw-string `getMCPToolsForAI_SDK(...)` sites returned 0 un-migrated sites. **This claim was WRONG.**

Verification (2026-07-16) confirmed that `/opt/bing/web/.bing-shared/` is a **physical COPY** of `/opt/bing/packages/shared/`, NOT a symlink:

```
$ ls -la /opt/bing/web/.bing-shared
drwxr-xr-x ... .bing-shared
$ readlink /opt/bing/web/.bing-shased
(no output — not a symlink)
```

The `grep -rnE` invocation finds 4 raw-string call sites at `/opt/bing/web/.bing-shared/agent/{unified-agent,opencode-direct,task-router}.ts` (4 hits including 2 in `unified-agent.ts:705/726`) that carry the legacy `@/lib/*` aliased imports because the COPY diverges from `/opt/bing/packages/shared/agent/` after Part 1's edit (which only touched the canonical source):

```
$ grep -c '@/lib/' /opt/bing/web/.bing-shared/agent/unified-agent.ts
9
$ grep -c '@/lib/' /opt/bing/packages/shared/agent/unified-agent.ts
0 (post-Part-1)
```

This ticket tracks the `.bing-shared/agent/` migration as a SEPARATE workstream from Part 3 (which closes on the user's literal `route-bug86-full.ts:1405` scope).

## Impact

- The `.bing-shared/agent/` tree contains 4 raw-string `getMCPToolsForAI_SDK(...)` call sites that still pass raw strings (likely `task`/`userMessage` strings) to the function instead of `SelectToolPlanResult` objects.
- These sites are loaded by a runtime path that's distinct from the canonical `packages/shared/agent/` (the `.bing-shared/` tree appears to be a build artifact or runtime mirror for the web app). Until `.bing-shared/agent/*.{ts,js}` has the relative-path + `selectToolPlan`-wrapped form, it ships code that bypasses the source-of-truth `SelectToolPlanResult | string` overload contract.
- Without this migration, future operators inspecting runtime behavior at `.bing-shased/agent/*` see legacy `@/lib/*` imports inconsistent with the canonical source — a confusing maintenance hazard.
- Currently the `.bing-shared/` files compile via web's tsconfig (which still has `@` aliased to `web/lib/`), so they don't fail immediately — but they DON'T get the Part 1 refactor's benefits (cross-package boundary explicitness, transitive-error clarity).

## Options for Resolution

### Option A — Mirror the canonical source via sync script (lightest)
- Add a `pnpm run sync:bing-shared` (or similar) that runs `cp -r packages/shared/agent/ web/.bing-shared/agent/` after Part 1 edits.
- Pros: trivial; preserves the COPY semantics the runtime expects (whatever that is); zero risk of breaking unknown runtime behaviors.
- Cons: requires the canonical source to be the ONLY edits site — if someone accidentally edits `.bing-shared/agent/`, the sync overwrites their work; needs a build/CI step to enforce.

### Option B — Symlink conversion (cleanest if runtime permits)
- Replace `/opt/bing/web/.bing-shased/` with a symlink to `/opt/bing/packages/shared/` (or `…/shared/agent` specifically).
- Pros: eliminates the divergence problem at the filesystem level; future Part 1-type refactors propagate automatically.
- Cons: runtime code that expects `.bing-shared/` as a directory (especially any FS walk, `fs.lstat()`, or build-time directory check) might break. Requires verification at the runtime boundary (Next.js bundler, pnpm workspace resolution, Vitest module resolution).

### Option C — Mirror the migration to `.bing-shared/agent/` (matches Part 1 refactor)
- Apply the EXACT Part 1 relative-path refactor to `/opt/bing/web/.bing-shared/agent/{unified-agent,opencode-direct,task-router}.ts` (8 imports in unified-agent + 9 in opencode-direct + 10 in task-router = 27 @/lib/* replacements).
- Pros: simplest direct fix; surgical scope; matches Part 1; no filesystem-level changes.
- Cons: requires manual duplication; future Part 1-type refactors would still need to be mirrored here; until Part 1 itself is mechanized via Option A or B, the COPY continues to diverge silently.

### Option D — Identify what `.bing-shared/` is and decommission it (deepest)
- Investigate: is `.bing-shased/` a build artifact (should be gitignored + regenerated), a pnpm workspace mirror, a runtime module-resolution fallback? If it's a build artifact, `.gitignore` + regenerate-on-build solves the problem.
- Pros: identifies the ROOT CAUSE rather than treating symptoms; might eliminate the divergence category entirely.
- Cons: requires understanding the unknown purpose of the directory first; risk of breaking unrelated paths.

## Recommendation

**Recommended (per code-reviewer SHOULD-CONSIDER (a)):** Option D first (cheap 2-command filesystem investigation), THEN Option C informed by D's findings. This sequence avoids wasted Option-C manual migration if D reveals `.bing-shared/` is a build artifact (gitignored + auto-regenerated; manual mirror would be overwritten). If D confirms `.bing-shared/` is a runtime mirror of the canonical source, Option C is the correct fix.

**Option D investigation commands (run BEFORE Option C):**
1. `grep -E '\.bing-shared' /opt/bing/.gitignore /opt/bing/web/.gitignore 2>/dev/null` — check if gitignored.
2. `find /opt/bing -type f \( -name 'build.bing-shared*' -o -name 'cp-bing-shared*' -o -name 'sync.bing-shared*' -o -name 'generate-bing-shared*' \) 2>/dev/null -maxdepth 5` — find any generator/sync script.
3. `grep -rlE 'cp -r.*packages/shared|rsync.*packages/shared|src.*\.bing-shared' /opt/bing/web/scripts /opt/bing/scripts 2>/dev/null` — grep scripts/builds for `.bing-shared` generation.
4. `ls -la /opt/bing/web | grep -E 'build|cache|generated|sync'` — check for sibling build/cache directories that might be `.bing-shared/`'s purpose.

**Option B (symlink conversion)** is DEFERRED until D's finding settles the question of what `.bing-shared/` actually IS — running symlink conversion against a build-artifact would break the regeneration flow.

## Acceptance Criteria

**Step 1 (Option D — investigate first, per SHOULD-CONSIDER (a)):** Identify what `/opt/bing/web/.bing-shared/` is. Run the 4 investigation commands listed in `## Recommendation` above. Record findings in a `## Findings` section beneath this ticket (decision: build-artifact OR runtime-mirror).

**Step 2 (Option C — informed by Step 1; per SHOULD-CONSIDER (b)):** If Step 1 confirms `.bing-shared/` is a runtime mirror of the canonical source, apply the Part 1 relative-path refactor pattern to `/opt/bing/web/.bing-shared/agent/{unified-agent,opencode-direct,task-router}.ts`. **Note the audit category distinction (per SHOULD-CONSIDER (b)):** the 4 hits returned by the user's literal Part 3 grep (`getMCPToolsForAI_SDK(...)` call sites) are a SUB-SET of the broader @/lib/* refactor work. The full refactor is:
- **21 static-import replacements** matching Part 1's pattern (8 import lines in unified-agent.ts, 7 in opencode-direct.ts L13-L19, 6 in task-router.ts L11-L20): `from '@/lib/X'` → `from '../../../web/lib/X'`.
- **6 unique dynamic-import replacements** across **7 source occurrences** — breakdown: **3 unique** in opencode-direct.ts (L124 `/sandbox/spawn/opencode-cli`, L125 `/mcp`, L219 `/virtual-filesystem/sync/sandbox-filesystem-sync`); **4 occurrences → 3 unique** in task-router.ts (L751, L752, L753, L915 — L915 is a SECOND occurrence of L752's target `/session/agent/agent-session-manager`, so the 4 occurrences collapse to 3 unique replacements; total across both files: 3 + 3 = 6 unique dynamic-import replacements collapsing 7 source occurrences): `await import('@/lib/X')` → `await import('../../../web/lib/X')`.

The 4 raw-string `getMCPToolsForAI_SDK(...)` call sites the audit grep surfaced (in unified-agent.ts:705+:726, opencode-direct.ts:147, task-router.ts:777) are a SEPARATE audit sub-concern (pre-Part-3 closure scope) addressed by routing each site to pass a `SelectToolPlanResult` instead of a raw task string. That's the user's literal Part 3 ask scope, not Step 2 here.

**Step 3:** If Step 1 confirms `.bing-shared/` is a build artifact, add a `.gitignore` entry under `/opt/bing/.gitignore` (prevent accidental commits + ensure regeneration stays canonical-source-aligned).

**Step 4 (verification):** Confirm the raw-string grep returns 0 sites in BOTH `/opt/bing/web/.bing-shared/agent/` AND `/opt/bing/packages/shared/agent/`. Acceptable result: the existing 4 hits inside `.bing-shared/agent/` all collapse to 0 after the migration.

**Step 5 (mirror closure per SHOULD-CONSIDER (b)):** Append a new `- [x]` row to the `## Acceptance criteria for ticket closure` section of `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md`. **WHERE spec:** placement is **immediately after the Part 3 audit-note (currently L169), before the next horizontal rule at L170**. Row text:

```
- [x] **Item ⑦ closure (2026-07-16):** `.bing-shared/agent/` migration ticket resolved — `tsc --noEmit` reports 0 NEW errors **relative to the canonical-source (post-Part-1) baseline** in the 3 `.bing-shared/agent/` files + final raw-string sweep returns 0 sites. See `/opt/bing/.tickets/MIGRATE-WEB-BING-SHARED-AGENT-TO-RELATIVE-PATHS.md` for closure narrative.
```

The sequential `Item ⑦` numbering matches the existing `Item ①`–`Item ⑥` convention in this section (per SHOULD-CONSIDER (a)); it does NOT denote a sub-item of item ④ (item ④ is the tsc PARTIAL closure row at a different position in the doc).

**Placement spec (per NEEDS-CHANGE (c), 2026-07-16):** `Item ⑦ closure` is a SHORT summary row that fits the **bulleted `## Acceptance criteria for ticket closure` section at L138-L172** (`- [x]` checkbox list). A SEPARATE longer prose narrative for this item goes into a new `## Item ⑦ closure (2026-07-16)` sub-section in the doc (mirroring the existing `## Item ⑥ closure (2026-07-16)` sub-section format). Operators should append BOTH the bulleted-row (in the bullet list) AND the prose-narrative (as a new sub-section). The shorthand `Item ⑦ closure` token in the bullet row is the canonical forward-reference for the prose sub-section.

## Cross-references

- Part 3 closure row in `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md:165-169` — the audit-note paragraph cites this ticket as the forward-reference target.
- Part 1 refactor in `/opt/bing/packages/shared/agent/{unified-agent,opencode-direct,task-router}.ts` — the canonical 3-file refactor this ticket mirrors.
- Prior closed-ticket format references (canonical examples):
  - `/opt/bing/.tickets/OUTERCATCH-PROD-REACHABILITY.md`
  - `/opt/bing/.tickets/PICKER-LAYER-PRODUCTION-FIX-CLOSED.md`
  - `/opt/bing/.tickets/STABLE-STRINGIFY-CANONICAL-MIGRATION.md` (if present)
- Code-reviewer verdict: SHOULD-CONSIDER (b) — append canonical-ticket path inline so audit-note has a forward reference.

---

## THREAD 1 — Migrate 14 @/lib/sandbox/types callers (CLOSE, 2026-07-16)

**Result:** ✅ CLOSED. The 14 enumerable TS2307 callers bucketized post-grep into:

| Bucket | Files | Treatment |
|--------|-------|-----------|
| **A. Canonical source (already migrated)** | `opencode-direct.ts`, `task-router.ts`, `unified-agent.ts` | NO ACTION — they already use `'../../../web/lib/sandbox/types'` (3-dot cross-package relative) |
| **B. Canonical source (migration target)** | `v2-executor.ts` (L9-L15 + L453) | MIGRATED — 8 imports (`@/lib/session/agent/agent-session-manager`, `@/lib/tools`, `@/lib/utils/logger`, `@/lib/types/tool-invocation`, `@/lib/sandbox/types` ×2, `@/lib/virtual-filesystem/scope-utils` static + L453 dynamic) → all `'../../../web/lib/X'` (3-dot cross-package relative, identical to siblings) |
| **C. web/lib/* files (migration target)** | `agent-session-manager.ts` (L19 + L25), `terminal-session-manager.ts` (L1261), `terminal-manager.ts` (L17), `workspace-control-plane.ts` (L82) | MIGRATED — `@/lib/sandbox/types` → direct relative path to `web/lib/sandbox/types` (the in-package RE-EXPORT SHIM from Step 2) |
| **D. Stale mirror (separate workstream)** | `web/.bing-shared/agent/task-router.ts`, `node_modules/@bing/shared/agent/*` pnpm mirror copies | OUT OF SCOPE this turn — `.bing-shared/` mirrors tracked in the parent ticket; pnpm mirror copies regenerated by `pnpm install` on next sync |

**7 str_replace edits landed (byte-exact):**
1. `packages/shared/agent/v2-executor.ts` — 8 imports migrated in 1 multi-replace + 1 single-replace (L453 dynamic)
2. `web/lib/session/agent/agent-session-manager.ts` — L19 + L25 migrated
3. `web/lib/terminal/terminal-manager.ts` — L17 migrated (NO semicolon — original style preserved)
4. `web/lib/workspace/workspace-control-plane.ts` — L82 migrated
5. `web/lib/terminal/session/terminal-session-manager.ts` — L1261 migrated (NO semicolon — original style preserved)

**tsc delta (packages/shared baseline 485 → 471, -14):**

| Metric | Pre-migration | Post-migration | Δ |
|--------|---------------|----------------|---|
| Total TS error mentions | 485 | 471 | **−14** |
| `lib/sandbox/types` errors | 14 | 0 | **−14** |
| TS2307 `lib/sandbox/types` errors | 14 | 0 | **−14** |
| `web/lib/*` mirror errors (proxy from cross-package walks) | 429 | 424 | −5 (incidental) |
| Unique TS codes | 24 | 24 | unchanged |

**Verifier confirmation (`grep` per migrated file):**
```
v2-executor.ts @/lib/ count: 0
agent-session-manager.ts @/lib/sandbox/types: 0
terminal-manager.ts @/lib/sandbox/types: 0
workspace-control-plane.ts @/lib/sandbox/types: 0
terminal-session-manager.ts @/lib/sandbox/types: 0
```

**Code-reviewer-minimax-m3 verdict:** **OK with 1 SHOULD-CONSIDER.** Path depths byte-correct (`v2-executor.ts` at depth 1 uses 3-dot matching the canonical sibling pattern; the 4 web/lib/* files use 1-or-2-dot direct-relative matching their directory depth). The `@`-alias uniformly fails in `packages/shared` scope (its `paths` map is `"@/*": [\"./lib-shims/*\"]` only — no `web/*` fallback), so direct-relative is the structurally correct fix. SHOULD-CONSIDER: `workspace-control-plane.ts` has 12 additional `@/lib/*` imports beyond the migrated L82 (L40 logger, L47/L53 terminal services, L60/L66 sandbox-orchestrator, L71 sync, L80/L81/L83 type imports, plus 4 dynamic imports at L550/L561/L572/L596). They were explicitly out of scope for the 14-caller audit (which targeted `@/lib/sandbox/types` only) but the same migration pattern would close them. Track as `.tickets/FOLLOWUP-WORKSPACE-CONTROL-PLANE-12-MIGRATIONS.md`.

## THREAD 1 follow-up — workspace-control-plane.ts 12-line extension (2026-07-16) — PARTIAL CLOSURE + REGRESSION

**Status:** 🟡 PARTIAL CLOSURE — 10 of 12 attempted migrations clean; 2 directory-path migrations caused **+19 unexpected tsc regression** and were reverted.

**Original attempt (12 migrations):**

Extended THREAD 1's success by migrating 12 additional `@/lib/*` paths in `workspace-control-plane.ts` (per code-reviewer's SHOULD-CONSIDER from the prior review). The migration covered 13 individual import lines via 12 unique path replacements:

| L# | Path | Type |
|----|------|------|
| L40 | `./utils/logger` | static |
| L47 | `./terminal/workspace-runtime-service` | static |
| L53 | `./terminal/workspace-service-manager` | static |
| L60 | `./sandbox/sandbox-orchestrator` | static |
| L66 | `./sandbox/workspacefs-snapshot-service` | static |
| L71 | `./virtual-filesystem/sync` | **directory** |
| L80 | `./sandbox/providers` | **directory** |
| L81 | `./sandbox/sandbox-orchestrator` | static (allowsMultiple with L60) |
| L83 | `./virtual-filesystem/resolve-filesystem-owner` | static |
| L550 | `./storage/content-addressable-storage` | dynamic |
| L561 | `./sandbox/runtime-broker` | dynamic |
| L572 | `./sandbox/workspace-image-registry` | dynamic |
| L596 | `./sandbox/workspacefs-sync-service` | dynamic |

All 12 paths byte-migrated with correct path-depth math (1-dot-up from `web/lib/workspace/` to `web/lib/`).

**Expected outcome:** total error count drops further (THREAD 1's -14 + ~10 additional expected from the file-path migrations).

**Actual outcome:** tsc error count went **UP** from 471 to **490 (+19 regression)**. code-reviewer verdict on the migration flagged 2 SHOULD-CONSIDERs (L26 docstring inconsistency + bundler directory resolution); verifier output confirmed regressed count.

**Diagnosis:** the 2 of the 12 migrations that were DIRECTORY paths (`'../virtual-filesystem/sync'` at L71 and `'../sandbox/providers'` at L80) auto-walked into `web/lib/virtual-filesystem/sync/index.ts` and `web/lib/sandbox/providers/index.ts`, respectively. Those `index.ts` files re-export from many internal modules with pre-existing TS errors. The walks surfaced them:

- **BEFORE migration (THREAD 1 baseline):** `@/lib/X` resolved to `./lib-shims/*` (per `packages/shared/tsconfig.json`'s `paths` override) → TS2307 errors. The unresolved import **broke** the walk before it could discover the resolved file's transitive errors.
- **AFTER migration:** `'../X'` resolves to a real directory → tsc walks into `index.ts` → surfaces pre-existing transitive errors (~+21 errors surfaced).

Net effect of the 2 directory migrations: -2 TS2307 (gone) + ~21 transitive (new) = **+19 net regression**.

The 10 FILE-PATH migrations were clean: each one moved from `@-aliased` → direct-relative `<instance>.ts`, with no index.ts resolution (the file at the path is the file consumed). Expected behavior matches THREAD 1's 7-migration where the analog pattern was confirmed.

**Recovery action (2026-07-16):**

- L71 reverted: `'../virtual-filesystem/sync'` → `'@/lib/virtual-filesystem/sync'`
- L80 reverted: `'../sandbox/providers'` → `'@/lib/sandbox/providers'`
- 10 file-path migrations STAY.
- Inline-documentation comment added at L71 explaining the alias divergence (per code-reviewer's SHOULD-CONSIDER): see `web/lib/workspace/workspace-control-plane.ts` for the inline note.

**Net effect (best estimate, tsc verification pending due to `spawn_agents` unavailability this turn):**

- `workspace-control-plane.ts` `@/lib/*` count now: 3 (the 2 reverted directory paths + L26 docstring example).
- Expected tsc count: ~461 (471 baseline - 10 file-path clean migrations).
- Cannot re-run tsc directly this turn; the +19 → restore-to-461 transition is hypothetical until a future operator re-verifies.

**Future operator's recovery options when ready to handle the directory-path migration:**

1. **Fix the underlying `index.ts` transitive errors first** — `web/lib/virtual-filesystem/sync/index.ts` and `web/lib/sandbox/providers/index.ts` re-export from modules with pre-existing TS errors (e.g., TS2722 "no exported member"). Closing those errors first unblocks the directory-path migration without the +19 regression.
2. **Add `.bing-shared`-style directory excludes in `packages/shared/tsconfig.json`** for specific subtrees — partial bypass but loses type-check coverage.
3. **Skip the 2 directory paths in perpetuity** — the alias divergence with documented rationale is the current resolution. The 10 file-path migrations are the migration surface that's actually safe.
4. **Migrate the chain as a single compilation unit** — when sandbox-orchestrator / virtual-filesystem / sandbox roots are cleanly hoistable into `packages/shared/lib/`, the cross-package import replaces the alias.

**Code-reviewer verdict on the 12-attempt + revert:** NEEDS-CHANGE on this documentation update + OK with 1 SHOULD-CONSIDER on adding the inline-doc comment at L71. Both landed.

---

## THREAD 1 follow-up (continued) — L47 + L53 additional reverts (2026-07-16) — CLOSED

**Status:** 🟢 CLOSED — targeted additional reverts at L47 + L53 recovered the partial-revert regression, achieving **net Δ -22 vs cycle baseline** (better than THREAD 1 alone's Δ -14).

**Stage progression (verified by re-running `packages/shared tsc`):**

| Stage | tsc errors | Δ vs cycle (485) | Δ vs previous |
|-------|-----------|-------------------|---------------|
| Cycle baseline | 485 | — | — |
| THREAD 1 (7-mig) | 471 | -14 | -14 |
| THREAD 1 follow-up: 12-mig attempt | 490 | -5 | **+19 unexpected** |
| THREAD 1 follow-up: partial revert (L71+L80 dir paths) | 483 | -2 | -7 |
| **THREAD 1 follow-up: L47+L53 revert** | **463** | **-22** | **-20** |

**Diagnostic for the +12 unaccounted-for regression:**

The partial-revert left the file at 483 (a +12 net vs THREAD 1's 471). Diagnostic diff revealed 22 NEW errors at 4 file paths in `terminal/workspace-*` subtree that didn't appear in the THREAD 1 baseline:

| Walk target | NEW errors | Source path in workspace-control-plane |
|-------------|-----------|---------------------------------------|
| `workspace-service-manager.ts` | +11 | L53 → `'../terminal/workspace-service-manager'` |
| `workspace-runtime-service.ts` | +4 | L47 → `'../terminal/workspace-runtime-service'` |
| `workspace-preview-registry.ts` | +6 | (transitively pulled in via L47/L53 — `workspace-runtime-service.ts` and `workspace-service-manager.ts` re-export shared types that `workspace-preview-registry.ts` walks into; specific symbol names unverified) |
| `virtual-pid-registry.ts` | +1 | (transitively pulled in via L47/L53 — same chain via shared type re-exports in the workspace lifecycle subtree; specific symbol names unverified) |
| **Total** | **+22** | |

**Note on lineage accuracy (correction 2026-07-16):** the prior diagnostic attribution "L71 transitively" was incorrect. L71 was already reverted to `@/lib/X` in the partial-revert turn (`/tmp/tsc-after-partial-revert.log`) while the +6/+1 errors at `workspace-preview-registry.ts` and `virtual-pid-registry.ts` were STILL present in that log. After THIS turn's revert of L47 + L53 alone (L71 status unchanged), both error buckets dropped to 0 in `tsc-after-l47-l53-revert.log`. The actual lineage is **L47 + L53 → transitive walks → workspace-preview-registry + virtual-pid-registry**. The corrected attribution above matches the empirical evidence.

After reverting L47 + L53 to `'@/lib/X'` aliases (matching L71/L80 pattern), all 4 walks were blocked at the alias-resolution boundary. Result: 463 errors (down from 483 — **net -20 from the revert, plus the diagnostic isolation confirmed**).

**Recovery action (2026-07-16):**

2 str_replace on `workspace-control-plane.ts`:
- L47 reverted: `'../terminal/workspace-runtime-service'` → `'@/lib/terminal/workspace-runtime-service'` + inline-doc comment.
- L53 reverted: `'../terminal/workspace-service-manager'` → `'@/lib/terminal/workspace-service-manager'` + inline-doc comment.

Inline-doc comments mirror L70/L82 precedents:
- L42 (Phase 2 entry): documents +4 walk-regression avoidance for `workspace-runtime-service.ts`
- L49 (Phase 4 entry): documents +11 walk-regression avoidance for `workspace-service-manager.ts`
- L70 (Phase 9 entry): documents +21 walk-regression avoidance for `virtual-filesystem/sync/index.ts`
- L80 (Types entry): documents `~Y` walk-regression avoidance for `sandbox/providers/index.ts`

**Final state of `workspace-control-plane.ts`:**

- 8 file-path migrations STAY (all `'../X'` direct-relative to file targets): utils/logger, sandbox/sandbox-orchestrator (×2 due to L60+L81), sandbox/workspacefs-snapshot-service, virtual-filesystem/resolve-filesystem-owner, storage/content-addressable-storage, sandbox/runtime-broker, sandbox/workspace-image-registry, sandbox/workspacefs-sync-service.
- 4 path migrations REVERTED to `@/lib/X` alias (L47 + L53 + L71 + L80) with inline-doc comments.
- 1 docstring example at L26 remains `@/lib/X` (not typechecked — JSDoc only).
- tsc error count for the file itself: **0**.
- workspace-control-plane.ts @/lib/* grep count: 9 (4 reverted imports + 4 inline-doc comments mentioning `@/lib/X` + 1 docstring example).

**Code-reviewer verdict on the recovery action:** OK with 1 SHOULD-CONSIDER. The 4 inline-doc comments now mix specific measured counts (`~21`, `+4`, `+11`) with the `~Y` placeholder at L82. Future operator should re-run `cd /opt/bing/packages/shared && timeout 60 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -cE 'sandbox/providers/index'` once after the L47/L53 revert stabilizes, then replace `~Y` with the measured count and align parenthetical wording (L82 was missing the "via transitive re-exports" mechanism phrase that L71/L47/L53 include). Costs 1 future maintenance edit; preserves parallel documentation structure.

**Diagnostic gap worth flagging (not blocking closure):**

The 22 NEW errors at 4 paths in the prior diagnostic were targeted by file, not by walk lineage. Future diagnostic should include a L-line drill-down on the 4 surviving dynamic imports (L550/L561/L572/L596) + their walked-into targets to confirm whether the surviving 8 are net-neutral or net-positive. The empirical result (463 < 485) confirms net positive, but the per-walk-lineage breakdown is not yet fully verified.

**Net effective migrations completed (THREAD 1 + THREAD 1 follow-up combined):**

- **Forward migrations ledger:**
  - THREAD 1 (7-mig): cycle 485 → 471 = **Δ-14**
  - THREAD 1 follow-up (8 surviving file-path migrations in workspace-control-plane.ts): 471 → 463 = **Δ-8**
  - **Total forward savings: Δ-22** (slot 1+2 confirmed by /tmp tsc logs)
- **Reverts (4 of 12 attempted in follow-up):** L47, L53, L71, L80 — each reverted to `@/lib/X` alias with inline-doc comment. The reverts exactly cancel by construction since the pre-migration form was the THREAD 1 baseline (alias paths don't walk into cross-package targets).

**Cycle outcomes & lesson learned:**

The most impactful finding from this thread: in `packages/shared/tsconfig.json` scope (where `@/*` overrides to `./lib-shims/*`), direct-relative paths that walk into web/lib files can surface pre-existing TS errors from cross-package transitive dependencies. This is **expected behavior** of the @-alias override, but it means every direct-relative migration into web/lib/X from packages/shared needs a per-target diagnostic to verify whether the resolution would surface unrelated errors.

The 12-line experiment + diagnostic + targeted revert demonstrated this pattern. Future migrations of web/lib/X paths from packages/shared scope should: (1) check the pre-existing error count of the target file at the projected walk-site, (2) factor that into the migration's expected Δ, (3) document the trade-off explicitly in the MIGRATE ticket.

---

## THREAD 2 — Stash-test 429 baseline (PIVOT 2026-07-16)

**Original intent:** git-stash the cycle's 8 file edits → run tsc → capture pre-cycle count → git restore → compare.

**Outcome:** PIVOTED (working tree is CLEAN — `nothing to commit, working tree clean` per `git -C /opt/bing status`; branch is `dev` ahead of `origin/dev` by 7 commits). The cycle's prior 8 file edits are COMMITTED, so there is nothing in the working tree to stash.

**Equivalent diagnostic via tsconfig inspection:**

The root cause of the 429 web/lib/* mirror errors is independent of the ambient.d.ts state and the @-alias resolution:

1. `packages/shared/tsconfig.json` overrides `paths` to `"@/*": ["./lib-shims/*"]` (no `web/*` fallback), so `@/lib/X` paths ONLY resolve to local shims, never to `web/lib/X`.
2. Despite the `"../../web/**"` exclude, tsc's `exclude` governs only initial file discovery; semantic resolution still walks imports INTO `web/lib/*` whenever a `packages/shared/*` file references it via cross-package relative (e.g., `'../../../web/lib/X'`). Each walked-into web/lib/* file has its own pre-existing TS errors.
3. The 429 web/lib/* mirror errors are SURFACE ARTIFACTS of cross-package walks — they're NOT introduced by the re-export shim. They're pre-existing errors in web/lib/* files that packages/shared/tsc discovers via semantic import resolution.

**Conclusion:** Even hypothetically without the cycle's edits, packages/shared/tsc would surface those 429 errors. The 14 caller errors are a SEPARATE bucket (TS2307 unbound `@/lib/X` paths) which this turn's THREAD 1 migration closed completely (14 → 0).

**Status:** Diagnostic complete. No action required unless a future operator wants to clear the 429 web/lib/* mirror errors (would require fixing the source errors in those web/lib/* files themselves — separate workstream).

## THREAD 3 — Phase A audit (RESEARCH 2026-07-16)

**Reference:** `/opt/bing/.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md` (Status: 🟡 OPEN, P0 priority).

**The "3-vs-122 phase1Status asymmetry"** is now documented as the propagation-chain surface area:

- **3/4 propagation sites** that explicitly consume or derive `phase1Status` semantics:
  1. `filesystem-edits.ts:L777` (DERIVE) — producer
  2. `use-enhanced-chat.ts:L1586` (CONSUME) — UI chat hook
  3. `shared-agent-context.ts:L345` (CONSUME) — loop-guard
  4. `route.ts` chat-router retry path ~L626 (CONSUME, also adding a 4th consumer)

- **vs. ~122 downstream layers** in the codebase that currently treat Phase 1 outcome as a binary `applied > 0` signal: error handlers, retry decorators, SSE observers, UI panels, telemetry emitters, observability hooks, and the model router fallback chain — all collapse `success-with-edits`, `empty`, `error`, and `skipped` into a single "no edits" signal.

**The 6-bug cascade** documented in the ticket (BUG 1-6) all stem from this asymmetry: each independently appears as "user saw empty response" but has structurally different root causes (Phase 1 succeeded vs empty vs error vs skipped). The proposed 4-state enum `phase1Status: 'success' | 'empty' | 'error' | 'skipped'` is the minimum information-theoretic representation that covers all 6 bugs.

**Implementation is staged in 5 PRs (Phase A-E):**
- A: Define type + extend return shape (~50 LOC) — independently mergeable
- B: Propagate via SSE metadata (~30 LOC)
- C: Update consumers (~30 LOC)
- D: Retry path consumes signal (~20 LOC)
- E: Test matrix + cascade test (~200 LOC)

**Audit outcome:** Research complete; ticket design validated. NO CODE CHANGES this turn — Phase A is a 5-PR roadmap requiring dedicated cycles (each ≥50 LOC). Recommend picking up Phase A as the next workstream.

---

## Closure statement update (post-THREAD 1 + 2 + 3)

**Status:** 🟡 OPEN with partial-closure annotation (2026-07-16). The 3 follow-up threads (migrate 14 / stash-test 429 / Phase A audit) are resolved as SUB-COMPLETIONS:

- **THREAD 1 (sub-completion):** 14 `lib/sandbox/types` callers → 0 (verified via tsc delta -14). The THREAD 1 scope was specifically the `@/lib/sandbox/types` bucket; it does NOT close the full `@/lib/*` decoupling epic which extends to L40+ in workspace-control-plane.ts and other files.
- **THREAD 2 (sub-completion):** Pivoted to tsconfig diagnostic. 429 web/lib/* mirror errors confirmed pre-existing via semantic cross-package walks, independent of cycle edits. No action required for the cycle artifact.
- **THREAD 3 (sub-completion):** Phase A audit complete. Ticket design validated; 5-PR implementation roadmap identified. No code changes this turn (Phase A is a 5-PR roadmap requiring dedicated cycles).

**The parent ticket's PRIMARY GOAL remains open:** `.bing-shared/agent/*` migration per Option A-D in the original `## Recommendation` section. The Step-1 Option D investigation (4 filesystem commands to characterize `.bing-shared/` as build-artifact vs runtime-mirror) was NOT run this turn. The Step-2 Option C mirror migration (apply the Part 1 relative-path refactor pattern to `.bing-shased/agent/{unified-agent,opencode-direct,task-router}.ts` with 21 static + 6 unique dynamic import replacements across 7 source occurrences) was NOT done.

**Remaining open items (out of this ticket's scope, tracked elsewhere):**
- 12 additional `@/lib/*` imports in `workspace-control-plane.ts` (L40, L47, L53, L60, L66, L71, L80, L81, L83 + 4 dynamic at L550/L561/L572/L596) — `.tickets/FOLLOWUP-WORKSPACE-CONTROL-PLANE-12-MIGRATIONS.md`
- 4 pnpm mirror copies regenerate on `pnpm install` (operator-driven)
- `.bing-shared/agent/*` mirror — parent ticket's PRIMARY GOAL (Option A-D investigation + Option C migration)
- Phase A-E implementation — `.tickets/PHASE1-PHASE2-SUCCESS-SIGNAL-ARCHITECTURE.md`

---

## First hoist-epic relocation cycle (2026-07-16) — PARTIAL CLOSURE

**Cycle scope:** the user invoked option (a) of the pick-and-continue prompt — "iterative hoist epic to dissolve the cross-package web/lib/* → packages/shared/lib/* coupling that surfaced the 169 NEW TS2307 transitive errors in Part 1's verifier". Per the thinker's analysis, **interpretation 1 (RELOCATION)** was the correct interpretation (file-move + re-export shim dissolves the coupling structurally — `packages/shared` becomes self-contained for the hoisted module's dependents).

**Cycle target:** `/opt/bing/web/lib/sandbox/types.ts` (490 lines — the highest-impact TS2307 source in `packages/shared` per the postaudit doc's ambient.d.ts footprint) PLUS its latent-bug consumers (3 packages/shared/* files importing from the wrong `@/lib/voice/types` path for `ExecutionPolicy`).

6 file edits landed (Step 1 = `write_file` for body; Step 2 = `write_file` for re-export shim; Steps 3-5 = `str_replace` for 3 caller fixes; Step 6 = `str_replace` for ambient.d.ts cleanup, with 1 follow-up recovery to restore `@/lib/sandbox/types` shim after 14 external consumers surfaced):

### Step 1 — Body move to packages/shared/lib/sandbox/types.ts

- **NEW `/opt/bing/packages/shared/lib/sandbox/types.ts`** — verbatim copy of the 490-line `web/lib/sandbox/types.ts` body (ExecutionPolicy union + ExecutionPolicyConfig + determineExecutionPolicy + RiskAssessment + WorkspaceSession + many other sandbox-related types).
- This is the canonical moved source. packages/shared/tsconfig.json includes `**/*.ts` recursive, so the new file is in typecheck scope.

### Step 2 — Bridge re-export shim at web/lib/sandbox/types.ts

- **`/opt/bing/web/lib/sandbox/types.ts`** replaced with a 7-line re-export shim:
  ```typescript
  /**
   * Sandbox Execution Policies — re-export shim.
   * Canonical body at /opt/bing/packages/shared/lib/sandbox/types.ts.
   * Relocated 2026-07-16 per the hoist epic / MCP_TOOL_SELECTION_POSTAUDIT item ④ PARTIAL closure track.
   * This shim preserves API for any web/* caller still using the old path until those migrate.
   */
  export * from '../../../packages/shared/lib/sandbox/types';
  ```
- Path depth: from `web/lib/sandbox/`, 3 `../` reaches `/opt/bing/` (project root), then DOWN into `packages/shared/lib/sandbox/types`. Matches the same 3-dot depth used by the 3 already-migrated Part-1 agents (`'../../../web/lib/sandbox/types'`).

### Step 3-5 — 3 latent-bug caller fixes

These 3 callers incorrectly imported `ExecutionPolicy` and `determineExecutionPolicy` from `@/lib/voice/types` (wrong path) — the canonical home is `web/lib/sandbox/types.ts`. The ambient.d.ts shim had papered over the bug:

| File | L | Old import | New import |
|------|---|-----------|-----------|
| `/opt/bing/packages/shared/agent/services/agent-worker/src/index.ts` | L28 | `from '@/lib/voice/types';` | `from '../../../../lib/sandbox/types';` |
| `/opt/bing/packages/shared/lib/worker-schemas.ts` | L14 | `from '@/lib/voice/types';` | `from './sandbox/types';` (REGRESSION-FIXED this turn, see Step 5.5 below) |
| `/opt/bing/packages/shared/services/planner-worker/index.ts` | L19-20 | `from '@/lib/voice/types';` × 2 | `from '../../lib/sandbox/types';` × 2 |

Path depth rationale:
- `agent-worker/src/index.ts` at depth 4 → `../../../../lib/sandbox/types` (4 dots up to packages/shared/, then DOWN)
- `worker-schemas.ts` at depth 1 in `packages/shared/lib/` → `./sandbox/types` (sibling within lib/)
- `planner-worker/index.ts` at depth 2 → `../../lib/sandbox/types` (2 dots up, then DOWN)

### Step 5.5 — path-depth regression fix for worker-schemas.ts

- The first attempt at Step 4 used `'../sandbox/types'` for worker-schemas.ts — applied by str_replace in this turn. Code-reviewer-minimax-m3 flagged this as a NEEDS-CHANGE on review:
  - File is at `packages/shared/lib/worker-schemas.ts` — `../` resolves to `packages/shared/sandbox/types` (NOT `packages/shared/lib/sandbox/types.ts`).
  - Fix: `../sandbox/types` → `./sandbox/types` (sibling in same directory).
- Verifier confirmed: 0 worker-schemas.ts tsc errors AFTER the fix. Cycle closure preserved.

### Step 6 — ambient.d.ts cleanup

- The 2 `declare module` shim entries were deleted from `/opt/bing/packages/shared/lib-shims/ambient.d.ts`:
  - `@/lib/voice/types` block (4 lines, exports `ExecutionPolicy` + `determineExecutionPolicy` typed as `any`) — DELETION STANDS. After the 3 caller fixes, no remaining `@/lib/voice/types` importers exist in packages/shared (verified by grep).
  - `@/lib/sandbox/types` block (6 lines, exports `ExecutionPolicy`/`PreviewInfo`/`SandboxHandle` types + `determineExecutionPolicy` function) — DELETION WAS REVERTED on this same turn.

### Step 7 — recovery edit (re-add @/lib/sandbox/types shim)

- Verifier (after Step 6's deletion) reported 14 `lib/sandbox/types` TS2307 errors arising at (precisely enumerated from `/tmp/tsc-after.log` on 2026-07-16):
  - `../../node_modules/@bing/shared/agent/opencode-direct.ts` (×2 at L15+L16)
  - `../../node_modules/@bing/shared/agent/task-router.ts` (L10)
  - `../../node_modules/@bing/shared/agent/unified-agent.ts` (L48)
  - `../../node_modules/@bing/shared/agent/v2-executor.ts` (×2 at L13+L14)
  - `agent/v2-executor.ts` (×2 at L13+L14 — local-source-path duplicates of the prior 2)
  - `../../web/.bing-shared/agent/task-router.ts` (L14)
  - `../../web/lib/session/agent/agent-session-manager.ts` (×2 at L19+L25)
  - `../../web/lib/terminal/session/terminal-session-manager.ts` (L1261)
  - `../../web/lib/terminal/terminal-manager.ts` (L17)
  - `../../web/lib/workspace/workspace-control-plane.ts` (L82)
- These 14 callers still import `@/lib/sandbox/types` via the `@`-aliased path — they don't know about the relocated body. The shim was ACTIVE CODE, not dead code.
- Recovery edit: `str_replace` to re-add the `@/lib/sandbox/types` declaration block (verbatim copy of the original) immediately before the `@/lib/utils/logger` declaration block in ambient.d.ts. File line count: 199 → 206.
- Code-reviewer-minimax-m3 verdict on recovery edit: **OK with 1 SHOULD-CONSIDER** (the 429 web/lib mirror errors are an independent concern that needs a separate `tsc --pretty false` baseline-stash test to characterize — outside this cycle's scope).

### Cycle outcomes (PARTIAL closure)

**Durable wins (this cycle's value):**
1. **3 latent-bug caller fixes** (Steps 3-5) — these were REAL bugs (3 files imported `ExecutionPolicy` from the wrong path). The ambient.d.ts `@/lib/voice/types` shim was masking them. Fix verified clean (tsc 0 errors at those file paths after fix + path-depth regression fix).
2. **`worker-schemas.ts` path-depth fix** (Step 5.5) — sibling-directory import verified clean.
3. **Body relocation** (Step 1) — `packages/shared/lib/sandbox/types.ts` is now the canonical source; the body is physically INSIDE packages/shared (dissolves the cross-package boundary for any future packages/shared/* caller).
4. **Re-export shim at web/lib/sandbox/types.ts** (Step 2) — bridges ALL web/* callers (including the 3 Part-1 agents) without a behavioral break.
5. **`@/lib/voice/types` shim deletion STANDS** — only 1 of the 2 shim deletions had independent confirmation that 0 importers exist. Verified CLEAN post-cycle.

**Still pending (follow-up cycles):**

6. **14 lib/sandbox/types TS2307 callers** at (precise per-file breakdown that sums to 14):
   - **6 prefix-pathed** in `../../node_modules/@bing/shared/agent/*` (opencode-direct ×2 at L15+L16, task-router at L10, unified-agent at L48, v2-executor ×2 at L13+L14 — pnpm mirror copies importing `@/lib/sandbox/types` via the `@`-aliased path)
   - **2 non-prefixed** `agent/v2-executor.ts` (×2 at L13+L14 — local-source-path duplicates of the mirror-path version; **NOTE:** the same file is reported twice by tsc — once at the mirror path (`../../node_modules/@bing/shared/agent/v2-executor.ts`) and once at the local source path (`agent/v2-executor.ts`) — these 2 are 2 OCCURRENCES of 1 distinct caller, counted once per occurrence to keep the bucket sum methodology explicit)
   - **1** in `../../web/.bing-shared/agent/task-router.ts` (L14 — .bing-shared local mirror)
   - **2** in `../../web/lib/session/agent/agent-session-manager.ts` (L19 + L25)
   - **1** in `../../web/lib/terminal/session/terminal-session-manager.ts` (L1261)
   - **1** in `../../web/lib/terminal/terminal-manager.ts` (L17)
   - **1** in `../../web/lib/workspace/workspace-control-plane.ts` (L82)
   - **Bucket sum:** 6 + 2 + 1 + 2 + 1 + 1 + 1 = **14** ✓
   - All import `@/lib/sandbox/types` via the `@`-aliased path. Each needs to migrate to `'../../../web/lib/sandbox/types'` (the re-export shim chain) in a separate hoist cycle OR `'../../sandbox/types'` / `../../sandbox/types` (relative within packages/shared) after the re-export shim drops.
7. **3 Part-1 agents' relative-path migration** — opencode-direct.ts (L17/L18), task-router.ts (L26), unified-agent.ts (L34/L35) still use `'../../../web/lib/sandbox/types'` (resolves via the new re-export shim, typecheck-clean). Future cycle: replace with `'../../sandbox/types'` (one less dot) for the architecturally clean dissolution.

**Independent concerns (out-of-scope, separate diagnostic):**
8. **429 web/lib mirror errors** — verifier reported 429 errors at `../../web/lib/*` paths in `packages/shared/tsconfig.json`'s output. Whether this is pre-existing (Part-1's relative-path reach into web/lib/* reports web/lib/* errors) or new (this cycle's re-export shim introduced a new mirror→canonical edge) requires a stash-test pre-and-post-cycle. SHOULD be deferred to a separate baseline-stash test ticket.

**Test parity (cycle boundary conditions verified):**
- worker-schemas.ts: 0 tsc errors
- The 3 fixed callers (agent-worker/src/index.ts, planner-worker/index.ts): 0 tsc errors (after the cycle's edits)
- web tsc parity: 0 errors (re-export shim + ambient.d.ts recovery don't break web compilation)

### Closure statement

**Status: 🟡 OPEN with PARTIAL closure annotation** (2026-07-16). The hoist epic's first relocation unit (sandbox/types.ts body + 3 latent-bug caller fixes + path-depth fix + voice/types shim deletion) is **CLOSED**. The re-export shim DELETE-AND-MIGRATE step (replacing 14 `@/lib/sandbox/types` callers with relative paths to `packages/shared/lib/sandbox/types` directly) is **OPEN** and tracked as a separate follow-up cycle to be opened after this artifact lands in the review surface.

**Code-reviewer verdict summary:**
- Steps 1, 2, 3-5, 5.5, 7: **OK** (mechanically correct, byte-exact, path-resolution verified).
- Step 6 (sandbox/types deletion): **NEEDS-CHANGE** — incomplete; 14 external callers reveal the deletion was premature. Recovery edit (Step 7) restored the shim.
- Independent concern: 429 web/lib mirror errors — baseline-stash test deferred.
