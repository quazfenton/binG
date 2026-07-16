# OUTERCATCH-PROD-REACHABILITY — F3.5 SHOULD-CONSIDER (d)

**Ticket type:** Follow-up audit finding (code-reviewer verdict: OK with N SHOULD-CONSIDER, item d)
**Status:** 🟡 OPEN
**Opened:** 2026-07-16
**Code-reviewer:** OK with 1 SHOULD-CONSIDER (F3.5 refactor — `isStallWatchdogErrorCode` predicate + `instanceof` dispatch + JSDoc trim)

## Summary

The route.ts **OUTERCATCH** discriminator at **L5621** maps `StallWatchdogError` → HTTP 524 (mirroring the inner catch's 524 contract). This is the production-side safety net for the rare case where `StallWatchdogError` escapes the orchestrator.

**However:** the outer try/catch at **`lib/orchestra/unified-agent-service.ts:L2172`** wraps `processUnifiedAgentRequest` and catches **all** thrown errors — including `StallWatchdogError` instances thrown internally at L2378, L2467, L2609, L2655, L2738, L3043. The catch:
1. Logs the error
2. Calls `attemptFallback(...)`
3. Returns either a **degraded** `UnifiedAgentResult` (if fallback succeeded) OR an `allFailedResult` (if fallback exhausted)
4. **Never rethrows** the original `StallWatchdogError`

**Consequence:** in production, `StallWatchdogError` instances thrown by the orchestrator's drift/no-progress detectors are caught and converted to `{success: false, ...}` results at the L2172 envelope. The route's OUTERCATCH at L5621 is therefore **only reachable via test mocks** (which can inject a `StallWatchdogError` directly into the `processUnifiedAgentRequest` mock implementation, bypassing the L2172 envelope).

## Impact

- **In production:** stalls map to `success: false` results that flow through Path A (orchestration mode) and are mapped to 524 via the `orchStallError` discriminator at L2988. The OUTERCATCH at L5621 never fires.
- **In tests:** the OUTERCATCH IS exercised by mocks that throw `StallWatchdogError` from `processUnifiedAgentRequest`. The discriminator works correctly for the test scenarios.
- **Documentation gap:** future operators reading route.ts:L5621 might assume the OUTERCATCH is production-active. It is not.

## Options for Resolution

### Option (a) — Extract StallWatchdogError-throwing helpers outside the L2172 envelope

Refactor `unified-agent-service.ts` so the drift/no-progress detectors (currently inline at L2378/L2467/L2609/L2655/L2738/L3043) throw `StallWatchdogError` from a **separate helper function** that is **NOT wrapped** by the L2172 try/catch. The orchestrator's main try/catch stays in place for other errors, but stalls bubble up to the route's OUTERCATCH.

**Pros:**
- Restores the original intent: stalls are a distinct error class that should bypass the fallback chain.
- OUTERCATCH becomes production-active.
- Cleaner separation: drift/no-progress is a different category from regular tool failures.

**Cons:**
- Larger refactor (touches 6+ throw sites + the orchestrator's main flow).
- Risk: if any caller in the chain relies on the current behavior (catching stalls as `{success: false}`), the refactor would surface 524s unexpectedly.
- Testing surface increases (each helper needs its own unit test).

### Option (b) — Add a `rethrowStalls: true` config flag

Extend `UnifiedAgentConfig` (route.ts:L1720) with `rethrowStalls?: boolean` defaulting to `false`. The L2172 envelope checks the flag before swallowing; when `true`, it rethrows `StallWatchdogError` instances to the caller.

**Pros:**
- Backward-compatible: existing callers continue to get `{success: false}` for stalls.
- Opt-in: operators who want production-grade stall handling flip the flag.
- Minimal surface change (1 new config field + 1 conditional rethrow).

**Cons:**
- Splits the contract: same orchestrator behaves differently per config.
- Doesn't fix the documentation gap (OUTERCATCH becomes active only for some callers).
- Future drift risk: operators may forget to set the flag and silently swallow stalls.

### Option (c) — Document the gap explicitly

Add a JSDoc above the OUTERCATCH at route.ts:L5621 stating: "Production unreachable — `processUnifiedAgentRequest`'s outer try/catch at lib/orchestra/unified-agent-service.ts:L2172 converts all throws (including `StallWatchdogError`) to `{success: false}` results. This OUTERCATCH is exercised only by test mocks." Cross-reference the L141 row in `MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` + the L141 status note.

**Pros:**
- Zero behavior change.
- Closes the documentation gap immediately.
- Operators searching for "OUTERCATCH production" find the explicit caveat.
- Cheapest to implement (JSDoc + doc cross-reference).

**Cons:**
- Doesn't fix the underlying issue (OUTERCATCH still not production-active).
- Drift risk: future operator refactors might remove the JSDoc without re-evaluating.

## Recommendation

**Adopt Option (c) immediately + open a follow-up ticket for Option (a).**

Rationale:
- **Option (c)** is the cheapest fix that prevents the documentation gap from misleading operators. It costs ~10 lines of JSDoc + doc updates and is non-controversial.
- **Option (a)** is the architecturally correct fix but requires non-trivial refactoring with multiple risk surfaces. Track it as a separate ticket so the work can be prioritized independently.
- **Option (b)** is a half-measure that splits the contract without fully solving the problem. Skip.

## Acceptance Criteria

- [ ] **c.1** Add 3-5 line JSDoc above the OUTERCATCH at route.ts:L5621 stating the production-unreachable nature + cross-referencing this ticket + `MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#L141`.
- [ ] **c.2** Add a one-line comment near `processUnifiedAgentRequest`'s outer catch at `lib/orchestra/unified-agent-service.ts:L2172` explaining that `StallWatchdogError` is intentionally caught + converted to `{success: false}` here (so future refactors don't accidentally rethrow).
- [ ] **c.3** Update `CENTRALIZED_TODO_LIST.md` with a cross-reference to this ticket under the audit-followup section.
- [ ] **a.1** Open a separate ticket `STALL-RETHROUGH-REFACTOR.md` tracking the Option (a) refactor (extract StallWatchdogError-throwing helpers outside the L2172 envelope). Estimated scope: 6 throw sites + 1 helper file + 6+ unit tests + regression sweep.
- [ ] Verify with tsc + vitest on route-shape-audit.test.ts + stall-watchdog-error.test.ts (target: no regressions).

## Files Referenced

- `/opt/bing/web/app/api/chat/route.ts` — OUTERCATCH at L5621
- `/opt/bing/web/lib/orchestra/unified-agent-service.ts` — L2172 envelope + throw sites at L2378, L2467, L2609, L2655, L2738, L3043
- `/opt/bing/web/lib/chat/llm-fallback-coordinator.ts` — `StallWatchdogError` class + `stallWatchdogErrorToStatus` helper
- `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` — L141 row + audit context
- `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` — audit-followup section

## Closure Narrative

_To be filled when ticket is closed._
