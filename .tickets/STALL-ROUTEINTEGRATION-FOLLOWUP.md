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
