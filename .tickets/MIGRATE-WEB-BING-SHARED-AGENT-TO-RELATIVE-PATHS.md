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
