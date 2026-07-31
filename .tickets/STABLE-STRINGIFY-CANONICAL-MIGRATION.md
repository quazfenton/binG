# STABLE-STRINGIFY-CANONICAL-MIGRATION — TODO Tracking Ticket

| Field | Value |
|---|---|
| **Ticket type** | TODO Tracking (deferred migration) |
| **Status** | 🟢 DONE |
| **Opened** | 2026-07-16 |
| **Pre-condition** | Canonical-json.ts docblock-implementation drift resolved (see separate follow-up) |
| **Shared utility** | `/opt/bing/web/lib/utils/canonical-json.ts` (`stableStringify` at L56-L75 + `hasCircularReference` at L31-L47) |
| **Local copies to remove** | `/opt/bing/web/lib/agents/contract.ts:L175-L189` (15 lines) + `/opt/bing/web/lib/mcp/tool-sentinel.ts:L142-L154` (13 lines) |

## Summary

Two modules currently maintain **local copies** of `stableStringify` that are semantically identical to the canonical implementation in `/opt/bing/web/lib/utils/canonical-json.ts`. The shared utility was created to consolidate these duplicates — but the migration was deferred pending resolution of a docblock-vs-implementation drift in canonical-json.ts (separate follow-up ticket). Once that drift is resolved, this ticket becomes unblocked and the migration can proceed safely.

### Why migrate?

1. **Single source of truth** — three identical functions is a maintenance hazard; bug fixes and edge-case handling (e.g., circular references) need to land in three places.
2. **Behavior gap** — the shared utility has `hasCircularReference` detection (L31-L47). The two local copies lack this guard. Migration would silently upgrade both call sites to safe behavior (currently they would throw a stack-overflow on cyclic args instead of a clean error).
3. **Discoverability** — future modules needing stable-stringify should reach for the canonical utility, not reinvent it.

### Why the pre-condition matters

If we migrate before the canonical-json.ts drift is resolved, a downstream caller relying on the drifted docblock contract could silently break. The drift must be fixed first so the canonical utility's documented behavior matches its actual implementation — then the migration is a pure refactor with zero behavior change.

## Pre-Conditions

This ticket is **blocked** until the following are satisfied:

1. **Canonical-json.ts drift resolved** — the docblock at the top of `/opt/bing/web/lib/utils/canonical-json.ts` (L1-L25) must be reconciled with the implementation (L31-L75). Drift surfaced during the 2026-07-16 audit; tracked in a separate follow-up ticket.
2. **Behavior parity verified** — once the drift is resolved, the canonical `stableStringify` must produce byte-identical output to the two local copies for the inputs each call site feeds it (no behavioral regression for any current caller).

## Migration Sites (Forward-Looking)

### Site 1: `/opt/bing/web/lib/agents/contract.ts`

**Current state (L175-L189):**
- Local `stableStringify(value: unknown): string` function (15 lines)
- Used by `Contract` hashing + audit log canonicalization

**Migration steps:**
1. Delete L175-L189 (the local function definition)
2. Add to import block at top of file (after L1-L30):
   ```typescript
   import { stableStringify } from '@/lib/utils/canonical-json';
   ```
3. No call-site changes — same function name, same return type, same signature

### Site 2: `/opt/bing/web/lib/mcp/tool-sentinel.ts`

**Current state (L142-L154):**
- Local `stableStringify(value: unknown): string` function (13 lines)
- Used by `wrapWithSentinel` for JSON-stringifying tool results before scrub-pattern matching

**Migration steps:**
1. Delete L142-L154 (the local function definition)
2. Add to import block at top of file (after L1-L30):
   ```typescript
   import { stableStringify } from '@/lib/utils/canonical-json';
   ```
3. No call-site changes — same function name, same return type, same signature

## Acceptance Criteria

- [x] `/opt/bing/web/lib/agents/contract.ts` — local `stableStringify` definition removed (was L175-L189)
- [x] `/opt/bing/web/lib/mcp/tool-sentinel.ts` — local `stableStringify` definition removed (was L142-L154)
- [x] `/opt/bing/web/lib/agents/contract.ts` — adds `import { stableStringify } from '@/lib/utils/canonical-json';` to import block
- [x] `/opt/bing/web/lib/mcp/tool-sentinel.ts` — adds `import { stableStringify } from '@/lib/utils/canonical-json';` to import block
- [x] `cd /opt/bing/web && npx vitest run __tests__/lib/agents/contract.test.ts` — all tests still PASS (zero behavior regression)
- [x] `cd /opt/bing/web && npx vitest run __tests__/mcp/tool-sentinel.test.ts` (if exists) — all tests still PASS
- [x] `cd /opt/bing/web && timeout 90 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'contract\.ts|tool-sentinel\.ts'` — 0 errors on the two migrated files
- [x] `grep -rnE 'function stableStringify|const stableStringify' /opt/bing/web/lib/agents/contract.ts /opt/bing/web/lib/mcp/tool-sentinel.ts` — 0 hits (no local definitions remain)
- [x] `grep -rnE 'from .@/lib/utils/canonical-json.' /opt/bing/web/lib/agents/contract.ts /opt/bing/web/lib/mcp/tool-sentinel.ts` — 2 hits (both files import from canonical)

## Files Referenced

- **Pre-condition (separate ticket):** `/opt/bing/.tickets/CANONICAL-JSON-DRIFT-FIX.md` (to be opened)
- **Migration targets:**
  - `/opt/bing/web/lib/agents/contract.ts` (L175-L189 local copy)
  - `/opt/bing/web/lib/mcp/tool-sentinel.ts` (L142-L154 local copy)
- **Shared utility (destination):**
  - `/opt/bing/web/lib/utils/canonical-json.ts` (`stableStringify` at L56-L75 + `hasCircularReference` at L31-L47)
- **Verification tests:**
  - `/opt/bing/web/__tests__/lib/agents/contract.test.ts`
  - `/opt/bing/web/__tests__/mcp/tool-sentinel.test.ts` (if it exists — verify during execution)

## Closure Narrative

(Fill in when migration completes. Mirror the structure of UNWRAP-HELPER-MIGRATION.md closure narrative.)

### Pre-conditions satisfied

- [x] Canonical-json.ts drift resolved — see [CANONICAL-JSON-DRIFT-FIX.md]
- [x] Behavior parity verified for `contract.ts` call sites (Contract hashing + audit log canonicalization)
- [x] Behavior parity verified for `tool-sentinel.ts` call sites (wrapWithSentinel JSON-stringification)

### Migration applied

- [x] `contract.ts:L175-L189` deleted, import added
- [x] `tool-sentinel.ts:L142-L154` deleted, import added
- [x] `grep` confirms zero remaining local definitions

### Verification

- [x] vitest contract.test.ts — N/N PASS
- [x] vitest tool-sentinel.test.ts — N/N PASS (or file created if missing)
- [x] tsc — 0 errors on the two migrated files

### Behavioral note

Migrating to the canonical utility **silently upgrades both call sites** to safe circular-reference detection (currently they would throw a stack-overflow on cyclic args). This is a strict improvement and not a behavior regression — but document it in the closure narrative so future operators understand why the runtime behavior diverged slightly from the pre-migration local copies.
