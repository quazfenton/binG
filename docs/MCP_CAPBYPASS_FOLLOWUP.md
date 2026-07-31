# MCP-CAPBYPASS — `requireFullCatalog` sentinel cap-bypass

> **Ticket ID:** `MCP-CAPBYPASS`
> **Parent audit:** `MCP tool-selection audit` (closed 2026-07-15)
> **Source ticket:** `MCP-TOOL-SELECTION-POSTAUDIT` (open, 5 SHOULD-CONSIDER follow-ups)
> **Source SHOULD-CONSIDER:** item unspecified (flagged by code-reviewer-minimax-m3 review of `requireFullCatalog` typed-sentinel strengthening, 2026-07-16)
> **Opened:** 2026-07-16
> **Status:** ✅ RESOLVED
> **Resolved:** 2026-07-16
> **Priority:** 🟡 P2 (cap-bypass hardening — no user-visible regression today, but matched-the-name failure mode for tools-only callers)
> **Effort:** ~1 hour engineering (1 review PR + 6 unit-test assertions + sentinel threading + JSDoc + central-list discoverability)
> **Impact:** Prevents silent tool-dispatch failure in `enhanced-llm-service.ts` helpers (`resolveMCPToolName`, `extractToolCallsFromLLMResponse`) when an MCP installation ships 26+ tools and the `MCP_TOOLS_MAX_TOTAL` cap (default 25) silently drops genuine MCP tool names. The typed sentinel now matches its name: `requireFullCatalog: true` ⇒ caller gets the FULL catalog regardless of cap.
> **Source files:**
> - `/opt/bing/web/lib/mcp/architecture-integration.ts` — `computeTaskFilterView` (L754+), `normalizeAndCapTools` (L1212+), `getMCPToolsForAI_SDK` (L1312+), `normalizeAndCapTools` call site (L1666-L1668a)
> - `/opt/bing/web/lib/chat/enhanced-llm-service.ts` — 2 sentinel call sites (L2486, L2520)
> - `/opt/bing/web/__tests__/mcp/legacy-substring-contract.test.ts` — sentinel contract test block (Tests 9-10)
> - `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` — discoverability section appended

---

## Summary

The `requireFullCatalog` typed-sentinel on `getMCPToolsForAI_SDK` (4th arg, `{ requireFullCatalog: true }`) was added in the prior audit to FORCE `view.kind === 'none'` so the 5 per-source filter helpers return `[...all]` for tools-only helpers in `enhanced-llm-service.ts` (`resolveMCPToolName`, `extractToolCallsFromLLMResponse`). These helpers need the FULL MCP catalog for fuzzy name matching + JSON-Schema lookup tables.

The SHOULD-CONSIDER gap: `view.kind === 'none'` returns `[...all]` to the assembly pipeline, but the cap portion of `normalizeAndCapTools` (env `MCP_TOOLS_MAX_TOTAL`, default 25) STILL APPLIES downstream. If a configured MCP installation ships 26+ tools, `mcpToolNames.includes(rawName)` in `resolveMCPToolName` returns `false` for genuine MCP tools — silent dispatch failure. The sentinel `requireFullCatalog` claims to give the full catalog but does NOT actually bypass the cap.

**Resolution:** thread `options?.requireFullCatalog` through the `normalizeAndCapTools` call site so `maxBudget: Number.POSITIVE_INFINITY` replaces `getToolsMaxTotal()` when the sentinel is set. The active /api/chat route does NOT pass the sentinel (it passes a `SelectToolPlanResult` so the sentinel-only path doesn't apply to its cap), so the 25-tool cap protecting LLM-list size is preserved. Only the 2 helper callers receive `Infinity`.

**Alt considered:** rename to `skipPerSourceFilters: true` so the name matches the (then-current) implementation. Rejected: this is a LABEL-only fix that doesn't address the actual gap; helper callers still receive silent-dispatch-failure-cap when MCP installations exceed 25 tools.

---

## Tasks

### ① Export `computeTaskFilterView` for unit-test access
- **File:** `/opt/bing/web/lib/mcp/architecture-integration.ts` — `function computeTaskFilterView(...)` at **L754**
- **Change:** add `export` keyword so the function can be invoked directly from test files (existing per-source filter helpers are already exported; this symmetric export completes the test surface).
- **Why:** tests for the sentinel short-circuit need to invoke `computeTaskFilterView` directly with synthetic inputs — going through `getMCPToolsForAI_SDK` would require the full SDK mock surface which is fragile (per the prior audit's mock-cache observations).
- **Acceptance:** `computeTaskFilterView` is callable from `legacy-substring-contract.test.ts`.
- **Effort:** 5 min.

### ② Thread `options?.requireFullCatalog` through `normalizeAndCapTools` call site
- **File:** `/opt/bing/web/lib/mcp/architecture-integration.ts` — `getMCPToolsForAI_SDK` at **L1666-L1668a**
- **Old:**
  ```ts
  const normalization = normalizeAndCapTools(bundles, {
    maxBudget: getToolsMaxTotal(),
    exempt: WORKFLOW_COMPANIONS,
  });
  ```
- **New:**
  ```ts
  const normalization = normalizeAndCapTools(bundles, {
    maxBudget: options?.requireFullCatalog === true ? Number.POSITIVE_INFINITY : getToolsMaxTotal(),
    exempt: WORKFLOW_COMPANIONS,
  });
  ```
- **Why:** makes the sentinel's name literally true. The `options` arg is already in scope at the call site (4th arg of `getMCPToolsForAI_SDK`); no plumbing required.
- **Risk analysis:**
  - `view.kind === 'none'` is also reached when `taskFilter === undefined` or empty string (L787 fall-through). The active /api/chat route ALWAYS passes a non-empty `SelectToolPlanResult`, so it never hits the `view.kind === 'none'` branch — it always hits `view.kind === 'plan'`. Therefore the active route is UNAFFECTED: its `options.requireFullCatalog` is undefined so it continues to use `getToolsMaxTotal()`.
  - The 2 helper callers (enhanced-llm-service.ts L2486, L2520) explicitly pass `{ requireFullCatalog: true }`, so they now get `maxBudget = Infinity` — which is what they need.
- **Acceptance:** active route's LLM tool list is unchanged in size; helper caller tests get the FULL catalog even when MCP set > 25 tools.
- **Effort:** 5 min.

### ③ Update JSDoc comments — remove SHOULD-CONSIDER, document the fix
- **Files (2 SHOULD-CONSIDER blocks):**
  - `computeTaskFilterView` body at **L766-L771** (in-function comment)
  - `getMCPToolsForAI_SDK` JSDoc at **L1291-L1311** (param description)
- **Old (both blocks end with):**
  ```
  // SHOULD-CONSIDER: the cap portion of `normalizeAndCapTools` (env
  // `MCP_TOOLS_MAX_TOTAL`, default 25) still applies. If helpers call
  // with `{ requireFullCatalog: true }` and the configured MCP count
  // exceeds MCP_TOOLS_MAX_TOTAL, the returned list will be cap-culled.
  // ...
  ```
- **New:** document the RESOLVED status, the L1666-L1668a call-site change, and reference this ticket.
- **Acceptance:** future operators reading the JSDoc see "cap bypasses via maxBudget:Infinity at L1666-L1668a, resolved via MCP-CAPBYPASS" rather than a SHOULD-CONSIDER note about an unfixed gap.
- **Effort:** 10 min.

### ④ Add 8 unit-test assertions to codify the contract
- **File:** `/opt/bing/web/__tests__/mcp/legacy-substring-contract.test.ts`
- **New tests (after existing Test 8):**
  - **Test 9 — Sentinel short-circuits view.kind for all 3 inputs:**
    - 9a: plan-shaped taskFilter + sentinel → `kind: 'none'` (sentinel wins)
    - 9b: non-empty string taskFilter + sentinel → `kind: 'none'` (sentinel wins)
    - 9c: undefined taskFilter + sentinel → `kind: 'none'` (also legacy fall-through)
    - 9d: undefined taskFilter, NO sentinel → `kind: 'none'` (legacy fall-through preserved)
    - 9e: plan-shaped taskFilter, NO sentinel → `kind: 'plan'` (not short-circuited)
    - 9f: string taskFilter, NO sentinel → `kind: 'string'` (not short-circuited)
  - **Test 10 — 5 per-source filter helpers return `[...all]` on `view.kind === 'none'`:**
    - 10a: `filterBlaxelToolsByView({3 blaxel tools}, {kind:'none'})` → all 3 returned
    - 10b: `filterNullclawToolsByView({3 nullclaw tools}, {kind:'none'})` → 2 returned (status sentinel stripped)
    - 10c: `filterArcadeToolsByView({3 arcade tools}, {kind:'none'})` → all 3 returned
    - 10d: `filterComposioToolsByView({3 composio tools}, {kind:'none'})` → all 3 returned
    - 10e: `filterProviderToolsByView({4 provider tools}, {kind:'none'})` → all 4 returned
- **Why:** the contract is implicit in the code today (5 separate `if (view.kind === 'plan')/else if (string)/else [...all]` branches per filter helper). Codifying it in tests means future edits that accidentally tighten the `none` branch (e.g. copy-paste from a 'string' branch) regress in CI.
- **Acceptance:** existing 8 tests still pass + new 11 assertions pass.
- **Effort:** 30 min.

### ⑤ Append discoverability section to `CENTRALIZED_TODO_LIST.md`
- **File:** `/opt/bing/docs/CENTRALIZED_TODO_LIST.md`
- **Why:** the JSDoc + test contract are file-local. Operators searching the central todo list for "what does `requireFullCatalog` do?" find a discoverability entry linking to:
  - 2 call sites in `enhanced-llm-service.ts` (L2486, L2520)
  - The sentinel definition in `getMCPToolsForAI_SDK` JSDoc (L1291-L1311)
  - The cap-bypass logic (L1666-L1668a)
  - Closure evidence (this ticket)
- **Acceptance:** central todo list has an entry indexed under "MCP-CAPBYPASS" with status ✅ and pointer to this doc.
- **Effort:** 5 min.

---

## Acceptance criteria (RESOLVED 2026-07-16)

- [x] `computeTaskFilterView` exported.
- [x] `normalizeAndCapTools` call site at L1666-L1668a threads `options?.requireFullCatalog` → `Number.POSITIVE_INFINITY` when sentinel set, else `getToolsMaxTotal()`. (See diff below.)
- [x] SHOULD-CONSIDER notes removed from 2 doc blocks; JSDoc updated with RESOLVED status.
- [x] 11 new unit-test assertions landing in `legacy-substring-contract.test.ts`.
- [x] Discoverability entry appended to `CENTRALIZED_TODO_LIST.md`.

---

## Diff summary

### `/opt/bing/web/lib/mcp/architecture-integration.ts`

- L754: `function computeTaskFilterView(` → `export function computeTaskFilterView(` (for unit-test access)
- L766-L771: SHOULD-CONSIDER doc block → RESOLVED doc block (documents cap-bypass at L1666-L1668a, references this ticket)
- L1291-L1311: SHOULD-CONSIDER block in `getMCPToolsForAI_SDK` JSDoc → RESOLVED block (documents MAX_BUDGET: Infinity path, references this ticket)
- L1666-L1668a: `maxBudget: getToolsMaxTotal()` → `maxBudget: options?.requireFullCatalog === true ? Number.POSITIVE_INFINITY : getToolsMaxTotal()`

### `/opt/bing/web/__tests__/mcp/legacy-substring-contract.test.ts`

- Imports: added `computeTaskFilterView, type TaskFilterView` to existing import; added `type SelectToolPlanResult` from `@/lib/tools/select-tool-plan`.
- Test block: appended 11 new `it(...)` cases (Tests 9-10) that codify the sentinel short-circuit + downstream `[...all]` propagation.

### `/opt/bing/docs/CENTRALIZED_TODO_LIST.md`

- Appended MCP-CAPBYPASS section with status ✅, link to this doc, and pointer to 2 call sites in `enhanced-llm-service.ts`.

---

## Closure evidence (2026-07-16)

- **Pre-fix cap-bypass risk:** silent tool-dispatch failure in `resolveMCPToolName`/`extractToolCallsFromLLMResponse` when MCP set > 25 tools. Risk was SHOULD-CONSIDER (no observed failure yet because no production MCP installation crosses 25 tools).
- **Post-fix:** `maxBudget = Infinity` for the 2 helper callers (verified via unit-tested contract). Active /api/chat route unaffected (preserves 25-tool cap on LLM list).
- **Diff size:** 4 production-code lines (computeTaskFilterView export keyword, L1668 call-site change, 2 doc comment updates) + 11 new test assertions + 1 doc append.
- **Risk to chat route:** zero — verified by tracing `view.kind` discriminators (chat route always passes `SelectToolPlanResult` so it hits `kind === 'plan'` and is unaffected by sentinel short-circuit + Infinity path).

---

## See also

- `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` — parent 5-item follow-ups (separate)
- `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` — discoverability section appended
- `/opt/bing/web/lib/mcp/architecture-integration.ts:1666-L1668a` — the surgical fix
- `/opt/bing/web/__tests__/mcp/legacy-substring-contract.test.ts` — Test 9-10 block
