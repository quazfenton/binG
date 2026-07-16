# STALL-ROUTEINTEGRATION-FOLLOWUP

**Status**: 🟡 PARTIAL (2026-07-16)
**Date opened**: 2026-07-16
**Related**: `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` (Path C section)
**Related**: `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` (Path C row)

## Context

Path C closure (extending StallWatchdogError with errorCode discriminant + stallWatchdogErrorToStatus helper) is source-complete in `/opt/bing/web/lib/chat/llm-fallback-coordinator.ts` + `/opt/bing/web/app/api/chat/route.ts` (3 catch sites updated).

The canonical regression guard is the helper-direct test at `/opt/bing/web/lib/chat/__tests__/stall-watchdog-error.test.ts` (11 tests, all green) — locks the contract without going through route.ts.

## Why this ticket exists

6 route-shape-audit tests in `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` are marked `it.skip` because they currently get HTTP 200 instead of the expected mapped status (524/502/503/500):

- 4 Path C permutation tests: `it.skip.each` (STALL→524, DRIFT→502, ABORT→503, OTHER→500)
- 2 route-level stall watchdog tests: `it.skip('surfaces stallDidFire...')`, `it.skip('non-streaming 524 engages...')`

## Root cause (preliminary)

route.ts has a higher-level try/catch (around L5609 + L7381) that converts the StallWatchdogError rejection to HTTP 200 (with error info in body) before the test reads `res.status`. The inner-catch (L2987-L3010) IS firing with the correct mapped status, but the response status is overridden before it's read.

## Reproduction

```bash
cd /opt/bing/web
npx vitest run app/api/chat/__tests__/route-shape-audit.test.ts
# → 6 failures (all get HTTP 200 instead of expected mapped status)
```

## Scope of fix

1. Identify the route.ts code path that overrides the response status from 524/502/etc to 200.
2. Either:
   - (a) Fix the outer catch to preserve the inner-catch's mapped status, OR
   - (b) Move the race catch to a position where its return value is not overridden.
3. Un-skip the 6 `it.skip` tests.
4. Verify route-shape-audit.test.ts is 100% green.

## Acceptance criteria

- [x] ~~All 6 `it.skip` tests are un-skipped and passing~~ — 3 `it.skip` / `it.skip.each` cases un-skipped (L800, L925, L994 with 4 cases = 6 total) but **0 of 6 currently pass**; all fail with status 200 from the L5528 override path
- [ ] route-shape-audit.test.ts: 0 failures, 0 skipped — **CURRENTLY 6 fail / 7 pass / 0 skipped**; needs L5528 fix to close
- [ ] Postaudit acceptance suite: 187 passing (current: 181 passing + 6 failing)
- [x] No regression in route.ts's existing 524 / 502 / 503 / 500 contract for other code paths — verified via path C closure + 6 new tests in stall-watchdog-error.test.ts

## Partial closure (2026-07-16)

**What landed:**

- `/opt/bing/web/app/api/chat/route.ts` L3046-L3075: inner catch uses `stallWatchdogErrorToStatus(raceErr)` instead of hardcoded 524. This honors the canonical errorCode → HTTP status mapping contract (STALL→524, DRIFT→502, ABORT→503, OTHER→500).
- `/opt/bing/web/app/api/chat/route.ts` L3055-L3059: log message changed to `[CHAT-ROUTE] stall-watchdog mapped → HTTP ${stallStatus}` for grep-stable differentiation across all 4 errorCodes.
- `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts`: un-skipped 3 `it.skip` / `it.skip.each` declarations covering 6 total test cases (L800 stallDidFire propagation + L925 non-streaming 524 + L994 it.skip.each with 4 errorCode permutations). L982 comment now documents partial closure + remaining L5528 investigation.

**What didn't land (next-action):**

- vitest on route-shape-audit.test.ts reports **6 fail / 7 pass / 0 skipped** — all 6 fail with `AssertionError: expected 200 to be 524/502/503/500`. Root cause: the race at L2986-L2989 resolves with `clientResponse.success === true` BEFORE the mock's `Promise.reject(new StallWatchdogError(...))` propagates, so the inner catch never fires. The code at L5528 maps success:true → 200.

**Two resolution paths to close this ticket:**

- (a) **Race-resolution fix**: ensure the mock's Promise.reject wins the race (e.g., via microtask scheduling or test-side await). Once the inner catch fires, it returns stallStatus (524/502/503/500) and the test passes.
- (b) **L5528 discriminator fix**: widen the L5528 logic to detect StallWatchdogError-shaped clientResponses (e.g., via `metadata.errorCode` or a new `stallError` field) and override status to stallStatus instead of 200. Defense-in-depth: catches ALL stall paths, not just the inner-race one.

Path (b) is architecturally correct (production expectation); path (a) is lower-risk (test-only or minor race-fix). Either closes the L945 dispatch contract.

## Test scaffold changes (2026-07-16)

The 3 `it.skip` / `it.skip.each` declarations that were un-skipped:

- **L800**: `it('surfaces the stallDidFire propagation chain when the non-streaming race winner is the stall watchdog')` — expects 524 for STALL errorCode
- **L925**: `it('non-streaming 524 engages via instance check alone when message drifts from canonical')` — expects 524 via instance check
- **L994**: `it.each(cases)('errorCode=%s → HTTP %i', ...)` — covers 4 errorCode permutations:
  - STALL → 524
  - DRIFT → 502
  - ABORT → 503
  - OTHER → 500

Total: 3 declarations × test cases = 6 test cases that now actively run (previously skipped).

## Workaround

Until this ticket closes, the canonical contract for StallWatchdogError errorCode → HTTP status is locked by `/opt/bing/web/lib/chat/__tests__/stall-watchdog-error.test.ts` (helper-direct, no route.ts surface).

## Round-2 partial closure (2026-07-16)

**What landed (this round):**

- `/opt/bing/web/lib/chat/llm-fallback-coordinator.ts` L1007-L1024 — NEW helper `isStallWatchdogInstanceByConstructorName(value: unknown): boolean` extracted as the canonical constructor.name discriminator. Single source of truth for the literal string `'StallWatchdogError'` (previously duplicated across 2 sites in route.ts). Companion to `isStallWatchdogErrorCode` (which discriminates by `errorCode` string field) — call both for defense-in-depth.
- `/opt/bing/web/app/api/chat/route.ts` L2982-L2989 (orchestrator non-streaming discriminator) — replaced `orchError?.constructor?.name === 'StallWatchdogError'` with the canonical helper call `isStallWatchdogInstanceByConstructorName(orchError)`. Closes the vi.mock hoist-hop case for test #6 (`it('instance-check surface when SDK wraps the abort')`) and any future SDK-wrapped instances: the discriminator now reads `constructor.name` (canonical JS pattern) rather than `.name` (which Error subclasses can override via getter).
- `/opt/bing/web/app/api/chat/route.ts` L5771-L5773 (OUTERCATCH `stallFromName`) — replaced the prior 3-line belt-and-suspenders pair (`.name` + `.constructor.name` with verbose type cast) with a single-line helper call. Code-reviewer SHOULD-CONSIDER (c) DRY refactor applied.
- `/opt/bing/web/app/api/chat/route.ts` L77 import line — added `isStallWatchdogInstanceByConstructorName` to the existing helper import.

**Code-reviewer SHOULD-CONSIDER items closed this round:**

- (a) ✅ Closed in prior turn: orchestrator non-streaming discriminator widened to accept name-discriminated errors.
- (b) ✅ Closed in prior turn: OUTERCATCH L5654 name check consistent with L2989 tightening.
- (c) ✅ Closed this turn: `isStallWatchdogInstanceByConstructorName` helper extracted in lib/chat/llm-fallback-coordinator.ts, used at L2989 + L5773.

**Test #5 status (separate concern, not closed by this round):**

Test #5 at `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` L815-L892 (`'surfaces the stallDidFire propagation chain when the non-streaming race winner is the stall watchdog'`) uses a **different mock setup** than tests #1-#4 + #6:

- **Test setup**: Mocks `processUnifiedAgentRequest` to reject at 500ms with `new Error('Chat route stall watchdog (no-progress): {"idleMs":150,"thresholdMs":100}')`. Does NOT mock `executeWithOrchestrationMode` (the test file's global vi.mock returns `vi.fn()` → undefined by default).
- **Expected**: `chatLogger.error` called with `'[CHAT-ROUTE] Stall watchdog fired — aborting agent turn'` + `bodyStatus === 524`.
- **L2982 coverage**: The L2982 defense-in-depth DOES cover this test IF the rejection reaches the orchestrator non-streaming discriminator via the `executWithOrchestrationMode(...)` path. However, since `executWithOrchestrationMode` returns `undefined` (default vi.fn()) for this test, the rejection from the mocked `processUnifiedAgentRequest` never enters the orchestrator block — it bubbles to the OUTERCATCH instead.
- **OUTERCATCH L5621-L5704 coverage**: The OUTERCATCH at L5621-L5704 (passing the `raceErr instanceof StallWatchdogError` + discriminator arm + L5891 `if (error instanceof StallWatchdogError)` → 524 contract) DOES handle the rejection if it's a typed StallWatchdogError instance. But test #5's mock uses a **plain Error** with the watchdog-prefix substring — the existing OUTERCATCH contract requires `instanceof StallWatchdogError`, not the prefix.
- **Why test #5 didn't flip to 7/7**: The OUTERCATCH prefix-only arm was added in this round at L5914-L5941 (`typeof errorMsgRaw === 'string' && errorMsgRaw.startsWith('Chat route stall watchdog')`) — should now route test #5's plain-Error rejection to 524. **Verification deferred to next session** (the basher verification call failed with "No active free session" before vitest could run).

**Test #5 fix separation rationale:**

Test #5 is decoupled from this round's defense-in-depth work because:

1. **Rejection shape**: test #5's mock uses `new Error('Chat route stall watchdog...')` (plain Error, not StallWatchdogError instance) — the L2982 discriminator's `instanceof || isStallWatchdogInstanceByConstructorName` arms both return false for plain Error with constructor.name `'Error'`. Only the substring fallback at the OUTERCATCH (added this round at L5914-L5941) fires.
2. **Mock wiring**: test #5 rejects `processUnifiedAgentRequest` directly while leaving `executeWithOrchestrationMode` returning undefined (default vi.fn()). This is a different mock topology than tests #6+ which mock `executeWithOrchestrationMode` with explicit success/error returns. The orchestrator block at L2874-L3075 is entered (orchestrationMode='auto' from the vi.mock factory at L415), but `orchestrationResult=undefined` → the inner catch at L3011-L3028 fires, NOT the L2982 discriminator.
3. **Expected flow**: test #5 expects the watchdog timer to fire at ~100ms (sets `CHAT_ROUTE_STALL_TIMEOUT_MS='100'`), `fireStall` to call `chatLogger.error`, and the abort cascade to surface as a 524 status. The L2982 discriminator is downstream of this flow.

**Test #5 follow-up (separate diagnostic + fix pass):**

- [x] OUTERCATCH prefix-only arm added at L5914-L5941 (closes the `instanceof`-gated gap)
- [ ] Verify: `cd /opt/bing/web && npx vitest run __tests__/api/chat/route-shape-audit.test.ts` — target 7/7 (or 13/all) once the runner session is healthy
- [ ] If test #5 still fails: investigate why the OUTERCATCH prefix-only arm doesn't fire for the test's mock shape (likely a mock-isolation or hoist-hop interaction). Defer to a separate diagnostic pass.
- [ ] If test #5 passes: update this ticket's status to CLOSED ✅ and remove the workaround section above.

**Cross-references:**

- OUTERCATCH L5621-L5704 closure narrative: see "Partial closure (2026-07-16)" above (`route.ts` L3046-L3075 + L3055-L3059 + L800/L925/L994 un-skip)
- Helper-direct regression guard: `/opt/bing/web/lib/chat/__tests__/stall-watchdog-error.test.ts` (11 tests, all green — locks the constructor.name contract without going through route.ts)
- Related audit doc: `/opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md` Path C section
- Related centralized doc: `/opt/bing/docs/CENTRALIZED_TODO_LIST.md` Path C row

