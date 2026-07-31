# MCP-ITEM-04-FULL-CLOSURE-EPIC

> **Ticket ID:** `MCP-ITEM-04-FULL-CLOSURE-EPIC`
> **Parent ticket:** `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (item ④ sub-section)
> **Parent audit:** `MCP tool-selection audit` (closed 2026-07-15 — 0 MUST-FIX)
> **Sibling ticket — closed:** `/opt/bing/.tickets/STALL-ROUTEINTEGRATION-FOLLOWUP.md` (Path C discriminator + 524 mapping, closed 2026-07-16)
> **Sibling ticket — joint work:** `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` `### MCP-TOOL-SELECTION-POSTAUDIT` L710+
> **Status:** 🟡 OPEN
> **Tracker convention:** This is the project's **local markdown ticket system** at `/opt/bing/.tickets/*.md` (consistent with `UAG-LOG-SHAPE-CONTRACT-INVESTIGATION.md`, `MCP-RATE-LIMITED-TTL-RECOVERY.md`, `STALL-ROUTEINTEGRATION-FOLLOWUP.md`). Not a GitHub or Linear issue — the local file IS the canonical ticket artifact.
> **Architecture divergence:** User prompt asked for "Each gets Option A/C treatment" — the ticket's actual architecture is bifurcated: **1/3 modules Option A/C** (`database/schema`), **2/3 modules ambient** (`connection-shim` ✅ DONE + `virtual-filesystem/index.server` 🟡 PENDING). Per-module rationale documented in the Tasks section below.
> **Opened:** 2026-07-16
> **Last updated:** 2026-07-16 — initial triage + per-module architecture decisions merged from connection-shim pilot + 2 pending hot-spots
> **Priority:** 🟡 P2 (audit follow-up, residual)
> **Effort:** ~1–2 days engineering (estimated, depends on Option A/C loader.ts co-move surface)
> **Impact:** Hardens CI tsc target for `packages/shared/`; if every task below lands, the residual mirror error count drops from current 181 to ~165.

---

## Context (verified state as of 2026-07-16)

The MCP audit's item ④ PARTIAL closure landed the **89% reduction** pattern (535 → 59 error lines) via ambient declarations in `/opt/bing/packages/shared/lib-shims/ambient.d.ts`. This ticket's architectural template is the **`### Pilot verification (2026-07-16, round 2)`** subsection of `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (stable anchor `#pilot-verification-round-2` for grep-discoverability across future header-text drift). Three hot-spot modules contribute ~26 of the remaining 181 TS2307 errors:

| Module                                                | Errors | Status                          |
|-------------------------------------------------------|--------|---------------------------------|
| `@/lib/database/connection-shim`                      | 13     | ✅ DONE 2026-07-16 (ambient)    |
| `@/lib/virtual-filesystem/index.server`               | 8      | 🟡 PENDING — ambient path       |
| `@/lib/database/schema`                               | 8      | 🟡 PENDING — Option A/C path    |

Aggregate remaining delta expectation: **−16 NEW TS2307 errors** → tsc baseline **450 → 434**.
**Combined with the −13 ALREADY-DONE connection-shim ambient clearance (2026-07-16), the full epic accounts for −29 TS2307 errors total** — matches the user's aggregate target of "25-30 TS2307 errors cleanly per the 89% reduction pattern established."
This epic tracks the remaining 2 PENDING modules; connection-shim is the verified precedent whose solution path is referenced inline.

---

## Why this ticket exists

The verified ambient-declaration pattern (from the connection-shim pilot) generalizes: any `@/lib/X` module with heavily-coupled sibling web/lib deps is **not Option A/C safe** — co-move cascades inflate transitive TS errors. The pattern-only path (cleanup) fails when the module is leaf-friendly but cold-moved without co-moving its `./loader`-class sibling.

Item ④'s full closure requires:

1. **Apply ambient** to leaf-friendly but heavily-coupled modules (1-line per module, 5-line context comment, follows the existing first/second/third-round convention in `lib-shims/ambient.d.ts`).
2. **Apply Option A/C** (`web/lib/X` → `packages/shared/lib/X` plus re-export facade) to modules that pass the leaf-friendly dep-tree audit AND have small enough subtree co-move surface (≤2-3 sibling files).
3. **Re-measure** the post-application baseline (target: 434 errors / 165 ts2307), then iterate to next hot-spot batch from the postaudit doc's next-candidate list.

The user-context goal: full exit 0 for `tsc --noEmit -p packages/shared/tsconfig.json` cannot be reached without wholesale decouple `packages/shared ↔ web/lib/*`. This ticket clears more of that residual coupling while staying inside the ambient / Option A/C architectural envelope set by the connection-shim pilot.

---

## Tasks (per-module, ordered by recommended ship order)

### Task 1 — `@/lib/virtual-filesystem/index.server` AMBIENT DECLARATION (mirroring connection-shim precedent)

- **File:** `/opt/bing/packages/shared/lib-shims/ambient.d.ts` (append below the connection-shim third-round block)
- **Approach:** Body-less `declare module '@/lib/virtual-filesystem/index.server';` in a fourth-round block, following the existing convention.
- **Why ambient, not Option A/C:** the module has **5 sibling web/lib deps** (`virtual-filesystem-service`, `filesystem-edit-session-service`, `git-backed-vfs`, `vfs-batch-operations`, `vfs-file-watcher`) plus `externals → server-only`. Co-move would require moving all 5 sibling files + their transitive deps, which would surface ~10× more errors than the 8 errors this module contributes. Verdicted same architecture as connection-shim — 1-line ambient shim is the safer path.
- **Expected delta:** −8 TS2307 errors (verified count from clean basher audit 2026-07-16).
- **Acceptance criteria:**
  - L220+ in `ambient.d.ts` extended with `// --- Fourth-round body-less declarations (2026-07-16) ---` block.
  - `declare module '@/lib/virtual-filesystem/index.server';` present.
  - 11-line context comment explaining the rejected Option A/C variant (5 sibling web/lib deps).
  - `cd /opt/bing/packages/shared && tsc --noEmit -p tsconfig.json` reports 0 `error TS2307` mentioning `virtual-filesystem/index.server`.
  - vitest sanity: at least one consumer test still passes (e.g. `__tests__/audit-recs/*` or `__tests__/terminal/*`).

### Task 2 — `@/lib/database/schema` OPTION A/C MOVE + FACADE (verifying the leaf-friendly path works for non-trivial modules)

- **Files:**
  - **MOVE:** `/opt/bing/web/lib/database/schema/index.ts` (25 lines) → `/opt/bing/packages/shared/lib/database/schema/index.ts`.
  - **MOVE:** `/opt/bing/web/lib/database/schema/loader.ts` (its only sibling import, `./loader`) → `/opt/bing/packages/shared/lib/database/schema/loader.ts`.
  - **FACADE:** Replace `web/lib/database/schema/index.ts` with the proven re-export facade:
    ```typescript
    /** Database schema — re-export shim. Canonical body relocated to packages/shared. */
    export * from '../../../packages/shared/lib/database/schema/index';
    ```

- **Why Option A/C, not ambient:** the module has only **1 sibling (./loader.ts)**, both files are small (25 + likely ~80 lines), and the dep-tree has NO web/lib/* siblings. This is the leaf-friendly archetype — Option A/C is safe and the cleanest demonstration of the decouple-and-move pattern. Task 2 is the proof point that proves Option A/C IS viable for the leaf-friendly subset, even though Task 1's heavily-coupled module requires the ambient shortcut.

- **Expected delta:** −8 TS2307 errors.

- **Acceptance criteria:**
  - `/opt/bing/packages/shared/lib/database/schema/{index,loader}.ts` exist with byte-equal content to the original web/ sources.
  - `/opt/bing/web/lib/database/schema/index.ts` reduced to a 2-3 line re-export facade matching the existing `sandbox/types.ts` precedent.
  - `cd /opt/bing/packages/shared && tsc --noEmit -p tsconfig.json` reports 0 `error TS2307` mentioning `database/schema`.
  - vitest sanity: `__tests__/database/*` and any consumers (e.g. `self-healing.ts`, `store.ts`, `content-addressable-storage.ts`) still pass.
  - No new transitive errors surfacing from the co-moved loader.ts content.

### Task 3 — Regenerate postaudit baseline narrative

After Task 1 + Task 2 land, regenerate the closure narrative in `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` to add:

- New `### Item ④ v2 / full-closure progress (2026-07-16, tasks 1-2 complete)` subsection under the existing Connection-shim pilot completion.
- Update CENTRALIZED_TODO_LIST.md MCP-TOOL-SELECTION-POSTAUDIT audit-followup entry's Status line from "13 of 19 cleared" → "21 of 26 cleared".
- Update next-candidate list: drop `database/schema` + `virtual-filesystem/index.server` (now done); re-rank remaining hot-spots.

### Task 4 — Open the next epic if remaining budget permits

After Task 1 + Task 2 + Task 3 land, the aggregate delta is `−16 + 13 = −29` TS2307 errors from the original 194 baseline (after the 89% reduction in round I). Remaining ~165 TS2307 errors require either:

- More ambient declarations per the round-bound first/second/third/fourth pattern (low risk, single-line).
- Wholesale decouple `packages/shared ↔ web/lib/*` (arch epic, multi-day).
- Test the new WHAT-NEXT decision: decide whether to ship a second "epic batch" of 3 more modules, or pivot to wholesale decoupling once enough pattern-proof exists.

---

## Acceptance criteria for ticket closure

- [ ] Task 1 ambient declaration landed in `lib-shims/ambient.d.ts` (L220+).
- [ ] Task 2 Option A/C move + facade landed for `database/schema/{index,loader}.ts`.
- [ ] Post-tasks tsc baseline: **434 total / 165 TS2307** (±5 drift).
- [ ] Post-tasks vitest: full `audit-recs` + `mcp` + `database` test surfaces green.
- [ ] No new transitive errors surfaced from the database/schema co-move.
- [ ] Closure narrative updated in postaudit doc + CENTRALIZED mirror entry flipped.

---

## Files to be touched

### Created
- (none — existing files only)

### Modified
- `/opt/bing/packages/shared/lib-shims/ambient.d.ts` (Task 1: append fourth-round block at L220+)
- `/opt/bing/web/lib/database/schema/index.ts` (Task 2: replace with 2-3 line facade)
- `/opt/bing/web/lib/database/schema/loader.ts` (Task 2: DELETE — file moved to packages/shared/lib/database/schema/loader.ts)
- `/opt/bing/packages/shared/lib/database/schema/index.ts` (Task 2: NEW — moved body)
- `/opt/bing/packages/shared/lib/database/schema/loader.ts` (Task 2: NEW — moved body)
- `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (Task 3: closure narrative)
- `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` (Task 3: status flip)

---

## Risks + mitigations

- **Risk 1: Database/schema co-move surfaces new errors from loader.ts body.** Mitigation: pre-flight audit before move — read loader.ts and confirm zero `@/lib/*` imports besides the parent ./index via `./loader` itself. If new errors surface, fall back to ambient path for the whole subtree as a fallback (still −8 errors).
- **Risk 2: virtual-filesystem/index.server ambient path isolates the wrong consumer.** Mitigation: after Task 1 lands, run grep over `web/lib/**/*.{ts,tsx}` for any new TS errors at the consumer sites (bash-tool.ts, self-healing.ts, agent-filesystem.ts etc.). If new errors surface, the ambient path has TDZ-on-shape effects; reconsider.
- **Risk 3: Doc truncation on the postaudit narrative update.** Mitigation: use write_file (one-shot, no truncation risk) for the new subsections, NOT str_replace multi-line content with backtick escapes (which truncated the prior turn's POSTAUDIT closeout twice).
- **Risk 4: Ticket drift on close dates due to multi-day ship.** Mitigation: include Last-updated header field on every intermediate state in the postaudit doc; final state anchor `#item-04-full-closure-2026-07-16`.

---

## Cross-references

- **Parent audit doc:** `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (item ④ subsection, includes Connection-shim pilot completion narrative)
- **Sibling epic ticket:** `/opt/bing/.tickets/STALL-ROUTEINTEGRATION-FOLLOWUP.md` (closed 2026-07-16 — Path C discriminator)
- **Sibling open ticket:** `/opt/bing/.tickets/UAG-LOG-SHAPE-CONTRACT-INVESTIGATION.md` (parallel investigation, format mirror for this ticket)
- **Centralized mirror:** `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` `### MCP-TOOL-SELECTION-POSTAUDIT (opened 2026-07-15)` L710+

---

## Operational guidance for next operator

- **Per-module triage rule.** Apply ambient declaration FIRST when the module has ≥3 sibling web/lib deps. Apply Option A/C only when the module is leaf-friendly (≤2 sibling deps AND all siblings have minimal dep trees). The Option A/C path produces the cleanest architectural decoupling but fails on heavily-coupled leaves (proven by connection-shim precedent and verified by Task 1's 5-sibling catch).
- **Doc hygiene.** Every task that lands must update both the postaudit doc's item ④ subsection AND the CENTRALIZED mirror entry. The audit thread's integrity depends on the two docs cross-referencing via stable anchors (`#item-04-full-closure-2026-07-16` once this ticket closes).
- **Order of operations.** Ship Task 1 (ambient) BEFORE Task 2 (Option A/C). The ambient pattern unlocks Task 2's architectural confidence without requiring it to be cold-moved first.
- **Test discipline.** After each task lands, re-run the full audit-recs + the relevant consumer FOLDER's test surfaces. Do NOT rely on `tsc -p packages/shared/tsconfig.json` as the only validation — that tsc only checks the mirror; web-side vitest still needs to pass.

---

> **Stable anchor for cross-doc reference (to be locked at closure):** `#item-04-full-closure-2026-07-16`
