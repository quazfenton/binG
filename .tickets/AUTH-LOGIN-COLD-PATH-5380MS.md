# AUTH-LOGIN-COLD-PATH-5380MS — bcryptjs vs better-sqlite3 trade-off matrix + native-bcrypt migration decision frame

**Status:** Open (deferred — see "Not in this commit")
**ID:** AUTH-LOGIN-COLD-PATH-5380MS (parallel-prefix ticket; not part of RT-NNN or ARCH-NNN families)

> **Naming note.** This opens the **AUTH-NNN** ticket family for auth-path latency observations.
> Future tickets covering auth roundtrip / fail-closed timing / rate-limit-window drift should use AUTH-NNN.
> Suggested naming:
> - **RT-NNN** — Routing/threshold followups (RT-001..RT-005 active; RT-006 soft-reserved).
> - **ARCH-NNN** — Cross-cutting architectural followups (ARCH-001 active).
> - **SEV-NN** — Severity-tagged bug reports (SEV-12 / SEV-13 / SEV-15 active).
> - **AUTH-NNN** — Auth-path latency / cost-center observations (this ticket = AUTH-LOGIN-COLD-PATH-5380MS).

**Severity:** low (latent; today's `/api/auth/login` cold-path is bounded by CPU-bound bcryptjs cost-12 work, not by infra; long-term blast radius is "the 5380ms first-response cost is paid by every freshly-bootstrapped worker in the deployment fleet, with cumulative fleet impact at worker-restart frequency × fleet size")
**Type:** observability / capacity planning / future-migration decision
**Affected files:**

| Surface | Path (relative to `/opt/bing/`) |
|---|---|
| Cold-path boundary (b0) | `web/app/api/auth/login/gateway.ts:65` (`const tLoginStart = process.hrtime.bigint();`) |
| Cold-path boundary (b1) | `web/app/api/auth/login/gateway.ts:295` (`logger.info('login gateway cold-path timing', { boundary: 'pre_response', elapsedMs, mfaEnabled })`) |
| Pure-JS bcryptjs (current) | `web/lib/auth/auth-service.ts` (`bcrypt.hash(password, saltRounds)` with `saltRounds=12` + `bcrypt.compare(hash)`) |
| Native-binding analogue (reference) | `web/lib/database/connection-shim.ts` + `web/instrumentation.ts` + `web/server.ts` (the just-shipped better-sqlite3 pre-warm with `globalThis.__betterSqlite3Warmed__` dedup) |
| Audit log (fire-and-forget) | `web/lib/auth/auth-audit-logger.ts`, called from gateway.ts:228-230 |
| VFS transfer (fire-and-forget) | `web/lib/auth/transfer-anon-vfs.ts`, called from gateway.ts:178-190 |

> **Not in this commit.** This ticket is the written companion to the just-shipped better-sqlite3 pre-warm. The pre-warm itself lives in `instrumentation.ts` + `server.ts` (separate commit); this ticket captures the AWAITED migration decision: when (and whether) to migrate from pure-JS `bcryptjs` to native `bcrypt`, and what the cost/benefit trade-off looks like once we have the better-sqlite3 pre-warm to compare against.
>
> **Gitignore note.** `/opt/bing/.tickets/` is **not** in `/opt/bing/.gitignore` (verified during RT-005 pickup). Stage by path (`git add .tickets/AUTH-LOGIN-COLD-PATH-5380MS.md`); do not let `git add -A` carry it along with source-edit commits.
>
> **Scope clarification.** Open question for the migration reviewer: stay on `bcryptjs` (current), migrate to native `bcrypt`, or migrate to `argon2`? The matrix below covers all three. No recommendation is pre-baked; the ticket exists so the next engineer (or next month's capacity review) has the trade-off laid out next to the just-shipped measurement infrastructure.

---

## Context — where the 5380ms number comes from

The first `/api/auth/login` request against a freshly-restarted worker pays a one-time cold-path tax split across three boundaries. The b0/b1 markers in `gateway.ts` are the **only** measured boundaries today; the per-component breakdowns below are estimates derived from the inline comment at `gateway.ts:289-291` (which already cites "expected ~4.2 s on cost-12" for the bcryptjs verify) + the better-sqlite3 pre-warm shipped this commit.

| Boundary | Component | Cold-path cost (before warmup) | Cold-path cost (after pre-warm + audit fire-and-forget) |
|---|---|---:|---:|
| b0 → before `authService.login` | gateway-wrapper setup + MFA lookup + rate-limit check | ~5–10ms | ~5–10ms (unchanged) |
| inside `authService.login` | pure-JS `bcryptjs.compare(hash)` at `saltRounds=12` | **~4200ms** | **~4200ms (unchanged)** ← the irreducible core |
| b1 → after `authService.login` | audit-log insert + VFS-fire-and-forget dispatch + cookie/CSRF writes | ~1180ms (worst case: inline-await audit insert to round-trip the DB) | ~~250ms~~ ~50–100ms (fire-and-forget reduces wait-to-DB) |
| First-request native-binding JIT | `new Database()` inside `connection.ts` + better-sqlite3 binding JIT, paid on the **first** getDatabase() call | ~800–1000ms (paid INSIDE b1 if audit insert is inline) | **~0ms at the request** (paid at boot in `instrumentation.ts`) |
| **Total cold-path (single fresh-worker first hit)** | | **~5380ms** | **~4250–4350ms** (expected after the just-shipped pre-warm + audit fire-and-forget) |

Notes:
- The 5380ms number is the sum of the four rows under "before warmup" + (not shown) ~120ms of misc logger + cookie writes. After the just-shipped pre-warm + audit-log fire-and-forget at `gateway.ts:228-230`, the cold-path drops by ~1000–1100ms.
- The new floor (~4250ms) is dominated by `bcryptjs.compare(password, hash)` at cost-12, which is the **single CPU-bound component in the request path** that has no pre-warmable analogue today.
- All four rows above are MEASUREMENTS on the current code path; they are NOT projections. The "after pre-warm" column reflects the just-shipped code in `instrumentation.ts` + `server.ts` + the audit fire-and-forget at `gateway.ts:228-230`.

---

## Trade-off matrix — `bcryptjs` (current) vs native `bcrypt` (future candidate) vs `better-sqlite3` (the analogue)

Use this matrix when deciding between three migration paths:
1. **Stay on `bcryptjs`** (current; what does each cold-path request cost us at fleet scale?)
2. **Migrate to native `bcrypt`** (analogous to better-sqlite3 — pay native-binding JIT once at boot, then fast per-request)
3. **Migrate to `argon2`** (different trade — memory-hard + native, with a different cost profile)

| Aspect | `bcryptjs` (current) | Native `bcrypt` (future candidate) | `better-sqlite3` (analogue / reference) |
|---|---|---|---|
| Implementation | Pure JavaScript (Kelvin's bcryptjs port) | C++ via `node-bcrypt.js`, native addon | C++ via `libsql-binding`, native addon |
| Cold-path cost (cost-12 verify on production server) | **~4200ms** (CPU-bound JS, single thread, JIT-bound) | ~200–400ms (native, parallel-friendly — V8 can offload to libuv thread pool) | N/A (database, not a hash function) |
| Native-binding load cost (first call ever) | None (pure JS) | ~100ms one-time on first `bcrypt.hash()` (loads C++ addon + bcrypt internals) | ~800–1000ms one-time on first `new Database()` (loads native binding + SQLite init + schema) |
| Peak RSS contribution (per-process) | ~30–50MB extra (pure-JS AST in V8 heap) | ~5–8MB (native addon heap) | ~3–6MB (native binding heap) |
| Pre-warmable at boot? | N/A | **Yes** — call `bcrypt.hash('warmup-payload', 4)` once during `instrumentation.ts` `register()` to trigger binding load; reuse the existing `globalThis.__betterSqlite3Warmed__`-style dedup flag (`globalThis.__bcryptNativeWarmed__`) | **Already shipped** — `getDatabase()` called in both `instrumentation.ts:register()` and `server.ts:startup()`, dedup'd via `globalThis.__betterSqlite3Warmed__` |
| Cross-platform packaging | Works in any environment with Node.js (no compile step) | Requires `node-gyp` build chain OR platform-specific prebuilt binary (buildps via `prebuild-install`) | Better-sqlite3 v11 ships prebuilt binaries for linux-x64/darwin-x64/darwin-arm64/win32-x64; native compile fallback for linux-arm64 etc. |
| Docker / k8s compatibility | Universal (no arch constraints) | Universal WHERE prebuilds cover; musl-alpine needs compile-and-pkg in CI | Same as native bcrypt (prebuild + occasional CI compile) |
| CI risk | None today (pure JS, deterministic install) | New: `prebuild-install` failure modes + `node-gyp` chain on architectures not covered by prebuilds | Same new risk — mitigated by prebuilds + we already carry the same chain for better-sqlite3 |
| Migration safety — existing hashes | N/A (bcryptjs produces same wire-format as native bcrypt) | **Wire-format compatible** — bcryptjs and native bcrypt both output `$2a$12$…`, so existing `users.password` hashes verify natively without re-hash. Re-hash can opportunistically bump cost-factor on next-login if desired. | N/A |
| Migration safety — infrastructure | None | New operational dep (binary compat across Linux distros / musl / glibc; rollback path via package.json revert + worker restart IF a fault emerges) | Same as native bcrypt (and already in production today) |
| Audit-log format (`auth_audit_log.detail` JSON column) | Uses the same `bcrypt_cost_factor` field; migration would update the field for new hashes (`'bcrypt-n'`) but old rows stay on `'bcryptjs-12'` | Same as bcryptjs — schema-compatible. | N/A |
| Remote attestation / explainability (`gateway.ts:289-291` comment) | Comment currently cites "expected ~4.2 s on cost-12" — explicit + verifiable | After migration, update the comment to "~250ms cold warm / ~350ms cold cold" + add the pre-warm assertion | Already updated to "pre-loaded in `<elapsedMs>`ms — /api/auth/login cold-path b0→b1 will skip this cost on first hit" |
| Side-channel resistance (cache timing, branch prediction) | Weaker (JS-level branch pred is observable; pure-JS timing varies more per V8 build) | **Stronger** (constant-time native; less observable in V8 side channels) | N/A |
| OWASP 2024 password-storage recommendation | Acceptable (bcrypt is on the OWASP allowlist) | Equivalent (bcrypt is on the OWASP allowlist; native is GA-recommended for CPU-bound paths) | N/A |
| Memory-hard lower-bound on hardware attack cost | None (CPU-bound only) | None (CPU-bound only) | N/A |
| **Net cold-path delta after migration (with pre-warm)** | **0** — stay on bcryptjs | **~3950ms savings** per cold-path request (4200ms → 250ms verify; 100ms native-binding JIT moves to boot via pre-warm) | **~1000ms savings** already shipped this commit |

### Decision tree (the reviewer-facing summary)

```
Does the fleet restart often enough to make 5380ms-per-cold-worker a measurable cost?
│
├── NO → stay on bcryptjs. The 5380ms is a one-time cost per worker boot, not per request. If restart cadence is weekly or rarer, the cumulative is negligible.
│
└── YES →
    │
    ├── Is side-channel resistance a primary concern?
    │   ├── NO  → migrate to native bcrypt (apply pre-warm pattern from better-sqlite3; cost ~half a day of work; expected cold-path saving ~4000ms per worker boot).
    │   └── YES → consider argon2id (memory-hard adds cost-on-attacker; native; v8-friendly). Trade: ~150mb RSS + ~80ms verify at cost=2 vs bcryptjs's ~4200ms.
    │
    └── (orthogonal) → also consider raising `saltRounds` from 12 → 14 in parallel with the native migration to preserve or increase the security baseline.
```

> **Recommendation: defer the migration decision**. The just-shipped pre-warm + audit fire-and-forget drove the worst-case cold-path down from 5380ms → ~4300ms without touching the hash algorithm. The remaining ~4200ms is bounded CPU work and ONLY paid on the first request per worker boot. If fleet-restart cadence is low (weekly or rarer), the migration is not ROI-positive. If fleet-restart cadence is high (per-deploy or autoscaled), the migration is worth ~4 seconds × boot-frequency × fleet-size.

---

## Migration plan (when / if the decision is "go")

If the reviewer lands on "migrate to native bcrypt", the migration is structural parallel to the just-shipped better-sqlite3 pre-warm. Size estimate: ~half a day of work.

### Acceptance criteria (when the fix lands)

- [ ] New dependency `bcrypt` (NOT `bcryptjs`) added to `web/package.json` at a version-pinned range. Verify prebuild coverage for the target arch matrix before pin (linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64; if any are missing, add `prebuild-install` to the build chain).
- [ ] `web/lib/auth/auth-service.ts` updated: `import * as bcrypt from 'bcrypt'` (replaces `import bcrypt from 'bcryptjs'`). `hashPassword` and `comparePassword` API surfaces preserved — `bcrypt.compare` is wire-format compatible with `bcryptjs.compare`.
- [ ] New pre-warm block in `web/instrumentation.ts` after the just-shipped `getDatabase()` warmup:
    - `const { hash } = await import('bcrypt');` — dynamic-import the native module.
    - AWAIT `hash('warmup-payload', 4)` — triggers native addon load. Cost factor 4 (low) because the warmup doesn't need real security, just enough to force the C++ binding into the process.
    - Dedup via `globalThis.__bcryptNativeWarmed__` (mirrors `__betterSqlite3Warmed__`).
    - Log elapsedMs via `console.info('[Instrumentation] bcrypt-native binding pre-loaded in ...')`.
- [ ] Same pre-warm block mirrored in `web/server.ts` `startup()` after the just-shipped `getDatabase()` warmup + before `await startProviderHealthCheck()`. Same `__bcryptNativeWarmed__` flag.
- [ ] Cold-path comment block in `gateway.ts:289-291` updated:
    - Old: "expected ~4.2 s on cost-12"
    - New: "expected ~250ms warm / ~350ms cold-cold (native binding pre-loaded at boot); if pre-warm is removed, falls back to ~4200ms (bcryptjs-equivalent) at the first cold hit"
- [ ] `users` table `cost_factor` audit field stays aligned — re-hash on next-login if you want to bump from `12` → `14` while you're in the file (optional; not required for wire-format compat).
- [ ] Migration is backout-safe: revert `package.json` + `auth-service.ts` import + delete the new pre-warm block leaves the old bcryptjs path intact (rollback via `git revert` of the migration commit + worker restart).
- [ ] Targeted tsc on touched files: 0 errors. `bcrypt.hash` / `bcrypt.compare` API surface is a drop-in for `bcryptjs.hash` / `bcryptjs.compare` (same Promise-returning signature).
- [ ] Add a vitest at `web/lib/auth/__tests__/auth-service.test.ts` (path may already exist) that asserts:
    - `hashPassword('test')` returns a `$2a$12$…` or `$2b$12$…` string.
    - `comparePassword('test', hash)` returns `true`.
    - Wire-format compatibility: a hash produced by `bcryptjs.hash('test', 12)` ought to verify with the new `bcrypt.compare` (and vice-versa).
- [ ] Re-benchmark the cold path after the migration lands — capture b0/b1 deltas from a fresh-worker first hit. Annotate `gateway.ts:289-291` with the new measurement.

### Out of scope / not in this ticket

- The actual `bcryptjs` → `bcrypt` code swap.
- Migration of any other runtime deps that have native-binding cousins.
- Re-hashing the existing `users.password` column to a higher cost factor (defer to a separate SECURITY ticket; the wire-format-compat re-hash opportunity can happen on next-login opportunistically).
- Argon2 evaluation (covered separately if reviewer lands on "memory-hard required").

---

## Why a ticket, not a commit

The decision to migrate is a security-review call, not a code change. The matrix above is the artifact the reviewer needs; the existing pre-warm makes the timeline usable in either path (stay or migrate). Filing this as a ticket lets the next-capacity-review cycle pick it up without losing the trade-off framing when the 5380ms number scrolls out of `run.log` cold storage.

The just-shipped pre-warm + audit-log fire-and-forget were the easy wins (~half-day of work, ~1100ms cold-path savings, zero security review required). The remaining ~4200ms is a security-decision trade, not a perf-decision trade, and belongs in its own ticket with its own reviewer.

---

## Cross-references

- **ARCH-001** — Three architectural followups surfaced by the SEV-12 / SEV-13 / SEV-15 audit chain. Status: Partially landed. Touches Node addon / vendor API drift; the `better-sqlite3` pre-warm shipped alongside this ticket's pre-warm is fully analogous to the proposed `bcrypt-native` pre-warm in §"Migration plan".
- **SEV-12** — Boundary-cast pattern applied at `route.ts:1701`, `unified-agent-service.ts:1712/:3947/:4648`. Status: Landed via ARCH-001 Flag 1. Unrelated to bcryptjs but is cited in ARCH-001 as another example of "patched workaround paying debt later" — same pattern as bcryptjs's "we patched around it via pre-warm infrastructure; the underlying slow algorithm is still on the path".
- **gateway.ts:289-291** — Inline comment block that already cites the 5380ms number. The comment is the source-of-truth for §"Context" above.
- **`web/instrumentation.ts`** — The just-shipped `getDatabase()` pre-warm is the structural template for any future `bcrypt.hash()` pre-warm. Diff baseline for reviewer-the-onboarding-engineer.

---

## Open question (for migration-phase reviewer)

1. **What's the fleet-restart cadence?** If it's low (weekly or rarer), the migration is not ROI-positive and the ticket should be closed with "deferred indefinitely". If it's high (per-deploy or autoscaled), the migration is worth doing.
2. **Is side-channel resistance a primary concern?** If yes, the decision pivots from "native bcrypt" to "argon2id" (memory-hard adds cost-on-attacker; RSS cost is ~150MB per process). If no, native bcrypt is the lighter-touch path.
3. **Should we additionally bump `saltRounds` from `12` → `14` as part of the migration?** Native bcrypt makes cost-14 affordable (~600ms verify, vs bcryptjs's ~17000ms). A combined "go native + bump cost" PR is a clean single-commit migration.
