# FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX — Consolidating ticket for the three session-findings + Next.js 14 splice pattern

**Status:** Open (consolidating — see "Not in this commit")
**ID:** FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX (parallel-prefix ticket; not part of any existing family — see "Naming note")

> **Naming note.** This ticket opens the **PATH-FIX-NNN** ticket family for consolidating-tickets that bundle 2+ cross-cutting findings surfaced in the same session and propose a multi-PR landing strategy.
>
> Suggested naming:
> - **RT-NNN** — Routing/threshold followups (RT-001..RT-005 active; RT-006 soft-reserved).
> - **ARCH-NNN** — Cross-cutting architectural followups (ARCH-001 active).
> - **SEV-NN** — Severity-tagged bug reports (SEV-12 / SEV-13 / SEV-15 active).
> - **AUTH-NNN** — Auth-path latency / cost-center observations (AUTH-LOGIN-COLD-PATH-5380MS).
> - **STALL-NNN** — Stall propagation / catch-block correctness (STALL-524-OUTERCATCH-GAP).
> - **PATH-FIX-NNN** — Consolidating tickets that bundle 2+ cross-cutting findings from the same session and propose a multi-PR landing plan. (This ticket = PATH-FIX-001.)
>
> The literal "FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX" file name is the user's chosen filename (the `/path-fix` suffix rather than a `/` separator); the ticket family prefix would be `PATH-FIX-001` if this body were the canonical ID. Either form is acceptable — this file is namespaced by the family and a grep for "PATH-FIX" surfaces it.

**Severity:** low-to-medium across the three bundled findings; none of them are user-blocking today, but the bundle as a whole represents "the next round of maintenance fixes has enough overlap risk to merit a coordination ticket rather than three independent PRs landing in isolation."
**Type:** coordination / multi-PR landing plan / Next.js 14 splice pattern
**Affected files (cross-cuts):**

| Finding | Primary sites |
|---|---|
| 1. STALL-524 OUTERCATCH (closed) | `/opt/bing/web/app/api/chat/route.ts` (the streaming branch + the non-streaming `Promise.race` + `fireStall` + `rejectOnAbort` chain at L2774-L2797; outer try/catch candidates at L5529 + L6121 may still need stall-aware branches per the open-source-of-truth in `/opt/bing/.tickets/STALL-524-OUTERCATCH-GAP.md`); test: `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` (FIX 9 test A still permits 200/524/500 status — the 524-correctness is follow-up polish) |
| 2. VFS path-traversal (open) | `/opt/bing/web/lib/auth/auth.ts:86` (currently a SECURITY COMMENT only — `Validate user ID to prevent path traversal and command injection` via `/^[a-zA-Z0-9_\-\|]+$/` regex; no centralized `sanitizePath`/`safeResolve` helper exists in `lib/`; sibling sites spread across `lib/voice/`, `lib/bash/` — fragmented, no shared hardening library) |
| 3. Login cold-path (open; defer to native `bcrypt` migration) | `/opt/bing/web/lib/auth/auth-service.ts:812` (`const saltRounds = 12;`), `/opt/bing/web/lib/database/connection-shim.ts` (the canonical DB surface), `/opt/bing/web/instrumentation.ts` + `/opt/bing/web/server.ts` (the just-shipped `getDatabase()` pre-warm with `globalThis.__betterSqlite3Warmed__` dedup — structural template for the proposed `bcrypt.hash('warmup-payload', 4)` pre-warm), `/opt/bing/web/app/api/auth/login/gateway.ts:65` (b0) + `:295` (b1) |

> **Not in this commit.** This ticket is opened so the next round of fixes has a documented landing plan. Each flag below is meant to land as its OWN pull request (with this ticket's body as the cross-cutting review reference); this commit deliberately contains only the ticket file.
>
> **Gitignore note.** `/opt/bing/.tickets/` is **not** in `/opt/bing/.gitignore` (verified during RT-005 pickup). Stage by path (`git add .tickets/FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX.md`); do not let `git add -A` carry it along with source-edit commits.

---

## Context — session entry-point

The user's original signal was **4+ Firefox failures on `/ws/previews` within 3 hours at 08:43 + 11:13 + 11:14** (per `web/logs/run.log` cold-storage). On investigation, the failures were not strictly Firefox-shaped but rather **three concurrent issues surfacing in the same session**, two of which manifest offline the previews-WebSocket’s failure rates:

1. The STALL-524 OUTERCATCH gap (a non-blocking polish issue that the previews-WS inherits because the same outer try/catch boundary at route.ts:L5529 catches previews-broadcast errors if they fail through the chain-walk).
2. A latent VFS path-traversal hardening gap (`auth.ts:86` is a regex-only defense; no `path.normalize` / `path.resolve`-based `safeResolve` helper exists in `lib/` to defend against constructed payloads that escape the userId regex when the userId is later concat'd into file paths).
3. The login cold-path bottleneck (`bcryptjs.compare` at cost-12 is the single CPU-bound component in the auth/login request path that the recent pre-warm + audit-fire-and-forget changes cannot pre-cache).

The three findings share a **Next.js 14 splice-pattern** characteristic: each fix touches disjoint primary files but has overlapping smoke-test concerns (especially the login cold-path's `__tests__/perf/auth-login-gateway-cold-warm.bench.test.ts` mock-stripped boundaries). This ticket's purpose is to record the splice pattern so the three fixes can land in parallel without re-litigating the test-harness question in each PR.

---

## The three findings (linked, NOT replaced)

### Finding 1 — STALL-524 OUTERCATCH

**Status:** Closed (per the user; the inner-race-winner 524 propagation in route.ts:L2774-L2797 lands). The STALL-524-OUTERCATCH-GAP ticket itself is still `Status: OPEN — non-blocking, tracked for follow-up` for two residual concerns: (a) outer try/catch candidates at L5529 + L6121 may still need stall-aware branches (a typed-error class refactor is the recommended path), (b) the FIX 9 test-A at `route-shape-audit.test.ts` was deliberately pivoted to permit 200/524/500 status, marking the gap rather than failing.

> **Why the gap remains open after the fix.** The original STALL-524 finding was a "200-OK-contradicting-SSE-error-event" silent-stream-OK-but-stall bug. The fix landed an engagement signal (CHAT-ROUTE log line + streaming-branch pre-stream 524 + `controller.error()` mid-stream) that prevents the silent-success case. The remaining polish (correctly emitting 524 instead of 500 on the non-streaming path) doesn't change the user-visible bug → it changes the *error code* the client sees. Closing this follow-up is a polish, not a fix.

**Linked ticket:** `/opt/bing/.tickets/STALL-524-OUTERCATCH-GAP.md`

### Finding 2 — VFS path-traversal hardening

**Status:** Open. The existing `validateUserId(userId)` at `/opt/bing/web/lib/auth/auth.ts:86` is a regex-only defense (`/^[a-zA-Z0-9_\-\|]+$/`) that prevents command injection for the userId token itself. However:

- There is **no centralized `sanitizePath`/`safeResolve` helper** in `web/lib/` to defend against constructed payloads that bypass the userId regex (e.g., downstream sites that concat userId into file paths, or accept an `argv` shape from the user).
- Sibling hardening logic is **fragmented** across `lib/voice/`, `lib/bash/`, etc. (per the prior `auth/` `grep` audit). A future maintainer adding a new VFS-shaped feature must re-invent the safe-path lookup rather than import a shared helper.

> **Why sibling sites matter.** The "VFS path-traversal" framing in this ticket intentionally encompasses the WHOLE width of file-shaped features in the codebase, not just auth. The audit anchor is `auth.ts:86` because that's the highest-visibility comment-to-implementation gap; the actual hardening scope is broader.

### Finding 3 — Login cold-path (deferred to native `bcrypt` migration)

**Status:** Open. Per the user's most recent ask_user answer ("Defer to native `bcrypt` migration" — the cost-factor reduction 12 → 10 was declined; the native migration is the chosen path). The `AUTH-LOGIN-COLD-PATH-5380MS` ticket already lays out the migration plan in §"Migration plan (when / if the decision is 'go')" with 11 acceptance criteria; the better-sqlite3 pre-warm shipped this session is the structural template for the proposed `bcrypt.hash('warmup-payload', 4)` pre-warm.

> **Why this is bundled here and not landed yet.** The native bcrypt migration is ~half a day of work + CI arch-matrix verification + opportunistic re-hash-on-next-login wiring. It's deferred so the other two findings (smaller, mechanical, file-local) can land first; the cold-path migration is the slowest cycle of the three.

**Linked ticket:** `/opt/bing/.tickets/AUTH-LOGIN-COLD-PATH-5380MS.md`

---

## Next.js 14 splice pattern — how the three fixes land in parallel

Next.js 14+ (this project is on 16.x per `package.json`; the pattern is the same) supports several "splice-friendly" seams that the three findings can naturally partition into without conflict:

### The 4 candidate splice shapes

| Splice shape | Where it lives | Best for | Trade-off |
|---|---|---|---|
| **A. File-level isolation** | Each fix touches a disjoint primary file | Mechanical, single-PR fixes | Smoke-test edits are spread across 3 PRs; risk that one PR's stub breaks another PR's fixture |
| **B. Middleware-level isolation** | `web/middleware.ts` + HOFs (`withStallAware`, `withSafePathLookup`, `withNativeBcrypt`) | Cross-cutting surface changes | Up-front coordination cost; HOFs must land first then routes adopt them in follow-ups |
| **C. PR split with shared test harness** | `web/__tests__/_harness/` (NEW directory) provides a test-fixture boundary each fix consumes | Tests-as-contract across PR boundaries | New harness directory; needs reviewer buy-in on the harness API |
| **D. Atomic + diatomic deploy** | Per-fix feature flags (`STALL_AWARE_OUTER_CATCH=true`, `VFS_SAFE_PATH_ENABLED=true`, `BCRYPT_NATIVE_ENABLED=true`) backed by `process.env` | Per-fix feature gating + rollback | Adds env var sprawl; flag rollouts need ops coordination |

**Recommended splice shape: C (test harness) + A (file isolation) for the two smaller fixes (STALL closed + VFS open), and D (atomic + diatomic via feature flag) for the larger fix (LOGIN open).** Specifically:

1. **First PR — Test harness + STALL-524 polish** (smallest, lands first, doesn't conflict)
   - New file: `web/__tests__/_harness/auth-cold-path.harness.ts` (the harness consumer for the login migration; stays dormant until the LOGIN PR lands).
   - Edit `/opt/bing/web/app/api/chat/route.ts` (outer try/catch candidates at L5529 + L6121 gain stall-aware branches per STALL-524-OUTERCATCH-GAP.md §"Suggested fix").
   - Edit `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` (FIX 9 test-A pivots BACK from "accepts 200/524/500" to "asserts 524" now that the outer catch is stall-aware).
2. **Second PR — VFS safe-path helper + VFS site migrations** (file-local, can merge while STALL-524 fuzzes)
   - New file: `web/lib/security/safe-path.ts` (centralized `sanitizePath`, `safeResolve`, `validateVfsPrefix` helpers with vitest coverage).
   - New file: `web/lib/security/__tests__/safe-path.test.ts` (covers baseline path-traversal payload tests).
   - Edit `/opt/bing/web/lib/auth/auth.ts:86` (replace the regex-only comment-to-defense with `sanitizePath`-backed lookup; keep the regex as a defense-in-depth layer).
   - Sibling migrations: `web/lib/voice/`, `web/lib/bash/`, etc. — migrate each fragment to the new helper (small per-file edits; landed in the SAME PR to avoid leaving fragmented copies).
3. **Third PR (largest) — Native `bcrypt` migration + cold-path pre-warm** (gated by `process.env.BCRYPT_NATIVE_ENABLED`, see AUTH-LOGIN-COLD-PATH-5380MS.md §"Migration plan" for the 11 acceptance criteria; lands LAST to avoid taking the cold-path cost out from under feet of the previous fixes' smoke tests)
   - New dep: `bcrypt` (replaces `bcryptjs` in `package.json`).
   - Edit `/opt/bing/web/lib/auth/auth-service.ts:812` (import swap; `saltRounds=12` preserved).
   - Edit `/opt/bing/web/instrumentation.ts` + `/opt/bing/web/server.ts` (add `bcrypt.hash('warmup-payload', 4)` pre-warm with `globalThis.__bcryptNativeWarmed__` dedup, mirroring the just-shipped `__betterSqlite3Warmed__` pattern).
   - Edit `/opt/bing/web/app/api/auth/login/gateway.ts:289-291` (cold-path comment updates from "expected ~4.2 s on cost-12" to "expected ~250ms warm / ~350ms cold-cold").
   - Op-flag `BCRYPT_NATIVE_ENABLED=true` toggles the new path; default off for the first 24hr of deployment so rollback via env flip is one-change-and-restart.
   - Re-benchmark: capture b0/b1 deltas from a fresh-worker first hit. Annotate `gateway.ts:289-291` with the new measurement.

### Why this ordering specifically

- **STALL-524 lands first** because: (a) it's small (≤ 50 lines of diff), (b) it touches chat-route.ts only, (c) it's the closest to being CLOSED (just needs the polish).
- **VFS lands second** because: (a) it's also file-local (new helper + ≥1 site edits), (b) it introduces a new test fixture (`safe-path.test.ts`) that doesn't conflict with STALL-524's edit, (c) it leaves the auth/login cold-path untouched, so the bench test under `__tests__/perf/auth-login-gateway-cold-warm.bench.test.ts` keeps working as-is.
- **LOGIN lands last** because: (a) it's the largest surface change (~half a day of work), (b) it requires CI arch-matrix verification for the native-binding prebuilds, (c) it needs the new test harness from PR #1 to be green before it lands, (d) the `BCRYPT_NATIVE_ENABLED` env flag means even if PR #3 needs to revert, the env flip + worker restart is a clean recovery.

> **Critical decision point: native-bcrypt vs stop-at-STALL-and-VFS**. The third PR is technically optional from a security-correctness standpoint — the VFS safe-path helper is the most security-impactful single fix. If the native-bcrypt migration is blocked on review capacity or CI time, the user can land PRs 1 + 2 and close this ticket with the deferred-to-native-bcrypt decision recorded.

### What unblocks parallel landings (the "splice-friendly" property)

The 3 PRs above can land **in any order** in time (one per day for 3 days is fine; one per hour is fine too) because:
1. None of them rename or delete files the others use.
2. PR 1's harness is additive (new file) and dormant until PR 3 consumes it.
3. PR 2's safe-path helper is additive (new file) and the auth-site migration IS its own PR; sibling migrations in `lib/voice/`, `lib/bash/`, etc. are inside PR 2 (no leakage to PR 3).
4. PR 3's env flag means it can ship disabled for the first 24hr; smoke testing + ops observability can confirm "bcrypt native behaves identically to bcryptjs" before the flag flips.

This is the Next.js 14 splice pattern the user asked for: **additive seams (new files + feature flags) + disjoint-file edits (no zip conflicts) + harness-first testing (dormant fixtures) + disjoint review surfaces (each PR is its own shape).**

---

## Acceptance criteria (when the bundle lands)

- [ ] **PR 1 (STALL-524 polish + harness):**
  - [ ] `/opt/bing/web/app/api/chat/route.ts:L5529` and `:L6121` outer try/catch candidates have stall-aware branches (typed-error class refactor recommended).
  - [ ] `/opt/bing/web/app/api/chat/__tests__/route-shape-audit.test.ts` FIX 9 test-A pivots BACK from `expects: [200, 524, 500]` to `expect: 524` now that the outer catch is stall-aware.
  - [ ] `/opt/bing/web/__tests__/_harness/auth-cold-path.harness.ts` exists as additive file; doesn't interfere with existing tests.
  - [ ] STALL-524-OUTERCATCH-GAP.md updated to `Status: PICKUP LANDED` with verification log.
- [ ] **PR 2 (VFS safe-path):**
  - [ ] `/opt/bing/web/lib/security/safe-path.ts` exists with `sanitizePath`, `safeResolve`, `validateVfsPrefix` exports + full vitest coverage at `web/lib/security/__tests__/safe-path.test.ts`.
  - [ ] `/opt/bing/web/lib/auth/auth.ts:86` (the regex comment) is updated to `safe-path`-backed lookup; the regex is preserved as defense-in-depth.
  - [ ] Sibling migrations to the new helper in `lib/voice/`, `lib/bash/`, and any other audit-discovered fragment sites (`bin lib grep` per the prior auth audit) are landed in the SAME PR.
  - [ ] No new `path.resolve`, `fs.readFile` calls outside `lib/security/safe-path.ts`.
- [ ] **PR 3 (native bcrypt migration):**
  - [ ] All 11 acceptance criteria from `/opt/bing/.tickets/AUTH-LOGIN-COLD-PATH-5380MS.md` §"Migration plan" are marked done.
  - [ ] Cold-path benchmark at `/opt/bing/web/__tests__/perf/auth-login-gateway-cold-warm.bench.test.ts` re-captured with new mock boundaries (MOCK_BCRYPT_MS updated from 100ms to ~30ms to reflect native speed).
  - [ ] `gateway.ts:289-291` cold-path comment updated to reflect post-migration expected deltas.

---

## Cross-references

- **STALL-524-OUTERCATCH-GAP** — chat route stall race-winner errors leaking through outer try/catch → 500 instead of 524. Status: OPEN (non-blocking polish). Becomes CLOSED on PR 1 pickup.
- **AUTH-LOGIN-COLD-PATH-5380MS** — login cold-path bottleneck bounded by `bcryptjs.compare` cost-12 (~4200ms). Status: OPEN. Migration plans to native `bcrypt` per user's most recent decision. Becomes CLOSED on PR 3 pickup.
- **ARCH-001** — Three architectural followups. Status: Partially landed. Touches Node addon / vendor API drift; the better-sqlite3 pre-warm shipped alongside this ticket's session is structurally parallel to the proposed bcrypt pre-warm in PR 3.
- **RT-001 / RT-005** — routing/threshold family. Adjacent but distinct; not bundled here because they don't touch the previews-WS surface or the auth-surfacing code.
- **`/opt/bing/web/lib/auth/auth.ts:86`** — source-of-truth anchor for the VFS path-traversal hardening gap (regex-only defense, no shared helper).
- **`/opt/bing/web/hooks/use-preview-websocket.ts`** + **`/opt/bing/web/lib/terminal/ws-preview-broadcaster.ts`** + **`/opt/bing/web/server.ts` (the `/ws/previews` upgrade handler)** — the previews-WS surfaces that originally surfaced the Firefox-failure signal; PRs 1-3 don't edit these directly, but PR 1's STALL-524 polish affects the outer try/catch around the broadcast emit.
- **`/opt/bing/web/instrumentation.ts`** + **`/opt/bing/web/server.ts` (the just-shipped `getDatabase()` pre-warm with `globalThis.__betterSqlite3Warmed__`)** — source-of-truth for the bcrypt pre-warm pattern in PR 3.

---

## Open question (for the bundle's first reviewer)

1. **Should PR 2 carry the sibling migrations or be split?** The fragmentation site count (per the prior `auth/` `grep` audit) is unknown without a fresh sweep. If the count is ≤ 5 sites, single PR is fine; if > 5, ship the helper alone in PR 2a, then migrate siblings in PR 2b + PR 2c.
2. **PR 3 feature flag: per-env or per-request?** Per-env (`process.env.BCRYPT_NATIVE_ENABLED`) is the lighter-touch surface; per-request (`X-Use-Native-Bcrypt: true` header) is finer-grain but more code. Default to per-env for the first deployment; revisit if ops needs per-tenant toggling.
3. **Bundle landing cadence: parallel or staggered?** If CI capacity is tight, the 3 PRs can land one per day on consecutive days (the splice pattern guarantees no merge conflicts within that window). If CI has spare capacity, they can land in any order within a single sprint.
4. **Should STALL-524 actually CLOSE on PR 1?** Or stay OPEN as a polish-tracker indefinitely? Closing on PR 1 is cleanest; staying open is fine if the team prefers a "follow-up list completeness" framing.
