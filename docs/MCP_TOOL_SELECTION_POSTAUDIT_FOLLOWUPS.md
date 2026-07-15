# MCP-TOOL-SELECTION-POSTAUDIT — 5 SHOULD-CONSIDER follow-ups

> **Ticket ID:** `MCP-TOOL-SELECTION-POSTAUDIT`
> **Parent audit:** `MCP tool-selection audit` (closed 2026-07-15, READY TO CLOSE with 0 MUST-FIX)
> **Opened:** 2026-07-15
> **Status:** OPEN
> **Priority:** 🟡 P2 (SHOULD-CONSIDER — no MUST-FIX remain)
> **Effort:** ~1–2 days engineering
> **Impact:** Medium. Improves `selectToolPlan` symmetry, fixes CI lint target, prevents agent-purpose URL contamination.
> **Source:** code-reviewer-minimax-m3 review of OUTERCATCH-GAP fix + 4 legacy→plan migrations + `agentTask` plumbing in `select-tool-plan.ts`.

---

## Summary

The MCP tool-selection audit closed with 0 MUST-FIX items. The code-reviewer flagged 5 SHOULD-CONSIDER items that are worth addressing in a follow-up pass: 3 in `select-tool-plan.ts` (API symmetry), 1 in `packages/shared/tsconfig.json` (CI infrastructure), and 1 in `unified-agent.ts` (TODO tracking). None are user-visible regressions today; all are hardening + ergonomics.

---

## Tasks

### ① Document `agentTask` negative-evidence asymmetry
- **File:** `/opt/bing/web/lib/tools/select-tool-plan.ts` — `scoreIntent()` around **L484–L496**
- **Problem:** `agentTask` participates in POSITIVE scoring (matched against `rule.keywordsRegExp`, weighted by `opts.agentTaskWeight`), but the `negativeMultiplier` block (L490–L496) only inspects `currentTurn`. Effect: when a user says "explain only, don't browse" and the agent's standing task is "github PR review", the planner still scores `web.fetch` positively from `agentTask` — the user-turn negative evidence cannot mute the standing task.
- **This is by design**: standing tasks represent the agent's purpose and are intentionally harder to override than the current turn. But the asymmetry is undocumented, so future operators may expect parity.
- **Minimal fix:** Add a docblock above the `agentTask` block describing the asymmetric design and explicitly noting: *"current turn can mute agentTask scoring only when `score *= opts.negativeMultiplier` (default 0) drives the cumulative agentTask contribution below the intent floor; agentTask otherwise survives current-turn negation."*
- **Acceptance criteria:**
  - JSDoc above `if (agentTask && safeMatches(rule.keywordsRegExp, agentTask))` explains the asymmetry.
  - Tests `request-to-final-list.test.ts` + `select-tool-plan.test.ts` still pass.
- **Effort:** 15 min.

### ② Gate `agentTask` scoring to fire ONLY when `currentTurn` is empty
- **File:** `/opt/bing/web/lib/tools/select-tool-plan.ts` — `scoreIntent()` around **L484–L485**
- **Problem:** When a future caller wires both `userMessage` and `agentTask` (intending the planner to weight current-turn higher), `agentTask` STILL scores at weight 0.6 alongside current-turn's 1.0. The two positive signals combine and risk double-counting intents the user already covered.
- **This is OK today** because the only callers with `agentTask` set also pass `userMessage: ''` (the unified-agent TODO state). But once `currentUserTurn()` lands in `UnifiedAgentConfig`, double-counting becomes live.
- **Minimal fix:** Wrap the agentTask positive-match block with a guard:
  ```typescript
  if (currentTurn.trim() === '' && agentTask && safeMatches(rule.keywordsRegExp, agentTask)) {
    score += rule.weight * opts.agentTaskWeight;
  }
  ```
  For legacy callers (`userMessage: '' + agentTask: ...`), behavior is unchanged. For future callers (both non-empty), agentTask falls back to weight 0 — making the asymmetry in scoring explicit rather than implicit.
- **Acceptance criteria:**
  - Add a `select-tool-plan` unit test covering the case `userMessage: 'fix the bug' + agentTask: 'github PR review'` — expect `score(web.fetch) === 0`.
  - Existing `request-to-final-list.test.ts` (which uses empty userMessage) still passes.
- **Effort:** 30 min (incl. test).

### ③ Track `unified-agent` TODO for `currentUserTurn()` accessor
- **File:** `/opt/bing/packages/shared/agent/unified-agent.ts` — TODOs at **L692** AND **L713**
- **Problem:** Two TODO comments mark where `selectToolPlan({userMessage: ''})` should be replaced by `selectToolPlan({userMessage: getCurrentUserTurn()})` once `UnifiedAgentConfig` exposes a turn accessor. Currently the agent uses `userMessage: '' + agentTask: this.config.task || ''` for both `mcpListTools` (L689) and `initializeMCP` (L706) call sites.
- **Risk:** TODOs are easy to forget in code review and get re-purposed or deleted. There is no tracking outside the file itself.
- **Minimal fix:** Add a ticket reference link in both TODOs, e.g.:
  ```typescript
  // TODO(MCP-TOOL-SELECTION-POSTAUDIT ③): populate userMessage from
  //   getCurrentUserTurn() once UnifiedAgentConfig exposes it. See
  //   bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md.
  ```
  Plus a one-line audit on whether the TODO is still accurate OR whether the missing accessor is itself a separate ticket.
- **Acceptance criteria:**
  - Both TODO comments reference the ticket ID.
  - Ticket closed when `currentUserTurn()` accessor lands AND both call sites are migrated.
- **Effort:** 10 min.

### ④ Add `packages/shared/tsconfig.json` so CI has a clean target
- **Files:**
  - **NEW:** `/opt/bing/packages/shared/tsconfig.json`
  - **Reference:** `/opt/bing/packages/shared/package.json` (currently has no `"typecheck"` script)
  - **Caller:** CI runners that want to typecheck `packages/shared/` in isolation
- **Problem:** Today, running `tsc --noEmit` from the workspace root (via `/opt/bing/tsconfig.json`) compiles `packages/shared/agent/unified-agent.ts`, `opencode-direct.ts`, `task-router.ts` etc. as part of the workspace graph. Running `tsc --noEmit -p packages/shared/tsconfig.json` (post-fix) should ALSO compile them in isolation — useful for CI contracts ("did the agent package publish clean?"). Workspace-root tsc previously reported TS5058 ("path does not exist: 'shared/tsconfig.json'") when engineers tried.
- **Minimal fix:** Create `packages/shared/tsconfig.json`:
  ```json
  {
    "extends": "../../tsconfig.json",
    "compilerOptions": {
      "rootDir": ".",
      "outDir": "./dist",
      "composite": false,
      "noEmit": true
    },
    "include": ["./**/*.ts"]
  }
  ```
  Plus add a `"typecheck": "tsc --noEmit -p tsconfig.json"` script to `packages/shared/package.json`.
- **Acceptance criteria:**
  - `cd /opt/bing/packages/shared && tsc --noEmit -p tsconfig.json` exits 0.
  - Pre-existing TS errors in `unified-agent.ts` (already documented in POSTAUDIT) remain unchanged — out of scope for THIS ticket.
  - CI can opt in by adding `pnpm --filter @bing/shared typecheck` to its matrix.
- **Effort:** 30 min.

### ⑤ Gate `agentTask` URL detection behind an opt-in flag
- **File:** `/opt/bing/web/lib/tools/select-tool-plan.ts` — URL detection block around **L628–L633**
  ```typescript
  const urlMatch =
    (!!agentTask && /(https?:\/\/[^\s)}\]]+)/i.test(agentTask));
  const looseUrlMatch =
    (!!agentTask && /[^\s]+\.[a-z0-9]{1,5}\b/i.test(agentTask));
  ```
- **Problem:** Every turn that uses an agent with a URL-bearing agentTask (e.g. "agent for github.com/...PR review") produces a `web.fetch`/`web.search` intent — even if the user says "thanks" or "I have a question". This is the same URL-bleed pattern the per-source filters were designed to mitigate for the user message but not for the standing task.
- **Minimal fix:** Extend `SelectToolPlanOptions` with `agentTaskUrlReadsEnabled?: boolean` (default `false`). Update the URL detection block to require the flag. Document the option. Add a `select-tool-plan` unit test asserting: with the flag off, an agentTask of `"github.com/PR"` produces NO `web.fetch`/`web.search` intent; with the flag on, it does (current behavior).
- **Acceptance criteria:**
  - New option `agentTaskUrlReadsEnabled?: boolean` added to `SelectToolPlanOptions`.
  - Flag defaults to `false`; no callsite updates required for backward compat.
  - Test added: agentTask github URL with default flag → no web intent; with opt-in → web intent present.
  - Existing `request-to-final-list.test.ts` still passes.
- **Effort:** 45 min (incl. test).

---

## Dependencies & ordering

- **②** and **⑤** are independent. Either can ship first.
- **①** is documentation-only; can ship alongside anything.
- **③** is TODO-comment-only; trivial to ship with anything.
- **④** is CI infrastructure; orthogonal to all 5.
- Recommendation: ship ③ + ① + ④ in a single small PR, then ② + ⑤ together (they both touch the same `scoreIntent` / URL-detection region of `select-tool-plan.ts` and benefit from a shared test fixture).

---

## Files touched

### Modified
- `/opt/bing/web/lib/tools/select-tool-plan.ts` (① docblock, ② score guard, ⑤ opt-in flag + URL-detection guard)
- `/opt/bing/packages/shared/agent/unified-agent.ts` (③ TODO comments, 2 sites at L692 + L713)
- `/opt/bing/packages/shared/package.json` (④ `"typecheck"` script)
- `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` (reference entry)

### Created
- `/opt/bing/packages/shared/tsconfig.json` (④)
- A new test in `/opt/bing/web/__tests__/tools/select-tool-plan*.test.ts` covering ② and ⑤

---

## Acceptance criteria for ticket closure

- [ ] ① docblock landed in `select-tool-plan.ts` above L484.
- [ ] ② `currentTurn.trim() === ''` guard landed; unit test added & passing.
- [ ] ③ both TODO comments reference `MCP-TOOL-SELECTION-POSTAUDIT ③`.
- [ ] ④ `packages/shared/tsconfig.json` exists; `pnpm --filter @bing/shared typecheck` exits 0.
- [ ] ⑤ opt-in flag landed; unit test added & passing.
- [ ] Full audit suite passes: `vitest run web/__tests__/api/chat/route-shape-audit.test.ts web/__tests__/api/chat/route-tool-list.test.ts web/__tests__/mcp/legacy-substring-contract.test.ts web/__tests__/mcp/request-to-final-list.test.ts web/__tests__/tools/select-tool-plan*.test.ts` — 100% green.
- [ ] `tsc --noEmit` from `/opt/bing` reports 0 NEW errors (pre-existing errors in `unified-agent.ts`/`opencode-direct.ts`/`task-router.ts` are out of scope).
- [ ] `CENTRALIZED_TODO_LIST.md` updated with `MCP-TOOL-SELECTION-POSTAUDIT` reference.

---

## Out of scope

- Pre-existing TS errors in `packages/shared/agent/unified-agent.ts`/`opencode-direct.ts`/`task-router.ts` (already documented in the original audit; tracked elsewhere).
- The `route-bug86-full.ts:1405` 4th un-migrated raw-string site (separate ticket).
- `requireFullCatalog` typed sentinel for `enhanced-llm-service.ts` (separate ticket).
- `FULL_CATALOG_REQUIRED` comment wording softening (separate ticket).

---

## Parent audit context

This ticket is a direct child of the MCP tool-selection audit that closed in 2026-07-15. The audit identified 9 P0/P1/P2 findings in the chat-route tool-selection pipeline; the remediations closed all P0 + P1 items but left 5 SHOULD-CONSIDER for followup. The MUST-FIX status was `READY TO CLOSE AUDIT`. This ticket captures everything the code-reviewer flagged as worth-doing-but-not-blocking.

Status of the parent at ticket creation:
- ✅ OUTERCATCH-GAP fix (route.ts stall watchdog → 524 mapping)
- ✅ 4 legacy callers migrated (unified-agent.ts, opencode-direct.ts, task-router.ts, vercel-ai-tools.ts)
- ✅ `agentTask` plumbing in `select-tool-plan.ts`
- ❌ This ticket (5 SHOULD-CONSIDER items)
