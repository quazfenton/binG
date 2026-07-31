# STALL-524-OUTERCATCH-GAP

## Status: CLOSED — landed (2026-07-08)

## What landed

The stall-aware catch branches were added at the outer try/catch candidates in `bing/web/app/api/chat/route.ts:5392-5422` via the typed-error-class splice (`class StallWatchdogError extends Error` with `readonly kind: 'stall' as const`). The chain-walk now propagates `stallDidFire` through the typed discriminator rather than the previous string-sniffing `err.message.startsWith('Chat route stall watchdog')` predicate, so the outer try/catches at L5529 + L6121 no longer collapse a fresh race-winner error from the inner branch into a generic 500. Any `StallWatchdogError` that reaches an outer catch now maps to the same 524 status (with `x-stall-fired` + `x-stall-reason` headers) that the inner race-winner branch at `route.ts:2774-2797` already returned, which closes the original "524 was bubbling as 500 on the non-streaming path" gap.

The test assertion at `bing/web/app/api/chat/__tests__/route-shape-audit.test.ts:848` (FIX 9 test A's status assertion) and `:936` (the chain-engagement log assertion) was tightened from the prior "accepts 200/524/500" permissive pivot to an explicit `expect(response.status).toBe(524)` (with the existing `'[CHAT-ROUTE] Stall watchdog fired — aborting agent turn'` log assertion preserved), giving a vitest-native regression gate on the now-closed contract. Both sites sit inside the same fixed-test describe block that the previous "permit-all" pivot had deliberately relaxed; tightening them is the test-side half of the closed gap and locks the 524 correctness in CI going forward.

## Cross-references

- **`/opt/bing/.tickets/FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX.md`** — the consolidating ticket that bundles this STALL fix as PR 1 of a 3-PR Next.js-splice landing plan (STALL polish → VFS safe-path → native bcrypt migration). Status: Open.
- **`/opt/bing/.tickets/ARCH-001-vendor-shape-consolidation.md`** — the prior architectural-ticket family. Unrelated to STALL but cited in the cross-cutting comment pattern.
- **`/opt/bing/web/app/api/chat/route.ts:2774-2797`** — the inner race-winner branch that the outer L5392-5422 splice now matches. Originally the only correctly-524 site; the close of this ticket makes L5392-5422 a symmetric sibling rather than a one-off.
- **`/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts`** — FIX 9 test A describe block; the prior relaxed-pivot assertion is replaced by the tightening documented above.

## Out of scope

- Companion changes from the original ticket (FIX 7 comment trim, route-level `stallDidFire` telemetry metric) deferred intentionally; can be re-opened as a follow-up if a regression re-surfaces.
- Re-bench of `bing/web/__tests__/chat/streaming/stall-bench.test.ts` (or its successor path) to capture post-fix timing delta — the prior run was a pre-splice baseline.
