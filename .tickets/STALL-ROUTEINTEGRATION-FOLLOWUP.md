# STALL-ROUTEINTEGRATION-FOLLOWUP

**Status**: OPEN
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

- [ ] All 6 `it.skip` tests are un-skipped and passing
- [ ] route-shape-audit.test.ts: 0 failures, 0 skipped (current: 7 passing, 6 skipped)
- [ ] Postaudit acceptance suite: 187 passing (current: 181 passing + 6 skipped)
- [ ] No regression in route.ts's existing 524 / 502 / 503 / 500 contract for other code paths

## Workaround

Until this ticket closes, the canonical contract for StallWatchdogError errorCode → HTTP status is locked by `/opt/bing/web/lib/chat/__tests__/stall-watchdog-error.test.ts` (helper-direct, no route.ts surface).
