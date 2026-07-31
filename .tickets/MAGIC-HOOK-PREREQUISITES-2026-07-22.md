# Magic-hook defensive guard — MISSING WIRE-UP discovered (2026-07-22)

## Problem

The Bug 2 closure SHOULDCONSIDER #1 magic-hook defensive guard was attempted
at /opt/bing/web/lib/chat/vercel-ai-streaming.ts on 2026-07-22 and FAILED
to land: 5 TS2304 errors (`Cannot find name 'streamId'` × 3 + `Cannot find
name 'updateStreamActivity'` × 2 at L3373-L3374).

## Diagnostic findings

The diagnostic revealed that the prerequisite Bug 2 wire-up — which prior
conversation turns documented as "DONE" — was an ASPIRATIONAL TARGET that
never actually landed in the codebase:

| Claim from prior turns                          | Actual state in code (grep-verified 2026-07-22)                                      |
|--------------------------------------------------|---------------------------------------------------------------------------------------|
| L37: `import { ... } from './zombie-stream-reaper'` | EMPTY — grep returns 0 matches                                                       |
| L1660: `let streamId = ...` declared            | WRONG — L1660 is `let totalTokensReceived = 0`; `streamId` is not declared anywhere  |
| L1685: `registerStream({...streamId})` call      | DOES NOT EXIST in the file                                                            |
| L2014: `updateStreamActivity(streamId)` hook in resetIdleTimeout | L2014 is a template literal in a diagnostic array — call site DOES NOT EXIST |
| L4135: `unregisterStream(streamId)` in finally   | DOES NOT EXIST in the file                                                            |

The actual scope structure is:
- L1525 `export async function* streamWithVercelAI(...)`
- L1662 `if (firstTokenTimeoutMs > 0) { ... registerRegion but NOT streamId ... }` (sub-block scope)
- L1982 `const resetIdleTimeout = (extensionMultiplier?: number) => {` (arrow function, NOT `function resetIdleTimeout(...) {}`)
- L3362-L3370 inner switch + `case 'start':`/`case 'finish':` (cleanly closes at L3366/L3367 inside a try-finally at L3368)

## Recovery path (REVERTED the broken hook)

1. **REVERTED** the broken 9-line magic-hook block from
   /opt/bing/web/lib/chat/vercel-ai-streaming.ts (removed L3367-L3375 insertion,
   restored original 4-line case structure at L3362-L3370).
2. **RE-ASSERTED** with `node --check` + `tsc --noEmit` — file parses cleanly,
   no NEW errors at vercel-ai-streaming.ts (revert restored the pre-edit baseline).
3. **REWROTE** /opt/bing/web/__tests__/chat/vercel-ai-streaming-magic-hook.test.ts
   as a GATED SOURCE-ANALYSIS REGRESSION that uses REAL `readFileSync` assertions
   for each prerequisite. **Gate OFF by default** (REAPER_MAGIC_HOOK_TEST_GATE !== 'on')
   to bypass the pre-existing vite:oxc PARSE_ERROR at vercel-ai-streaming.ts:4179:2.
   With gate ON, the file FAILS today on PREREQ #1-#5 and FLIPS to green as the
   wire-up lands.

## 5-step landing plan (in dependency order)

### PREREQ #1 — top-level import
Add at the top of /opt/bing/web/lib/chat/vercel-ai-streaming.ts (around L37
import cluster):
```ts
import {
  registerStream,
  updateStreamActivity,
  unregisterStream,
} from './zombie-stream-reaper';
```

### PREREQ #2 — streamId at function-body scope
Inside the body of `streamWithVercelAI` (L1525) — declared at function-body
scope, NOT inside the `if (firstTokenTimeoutMs > 0) { ... }` sub-block:
```ts
const streamId =
  `vercelStream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
```

### PREREQ #3 — registerStream call BEFORE fullStream consumption
Right before `for await (const chunk of result.fullStream)`:
```ts
registerStream({
  streamId,
  provider,
  modelName,
  requestId,
  firstActivityTime: Date.now(),
});
```

### PREREQ #4 — unregisterStream in OUTER finally
In the `} finally {` envelope at L3368 (try-finally around the inner for-of):
```ts
} finally {
  if (ttftTimeoutId) clearTimeout(ttftTimeoutId);
  if (hardDeadlineTimeoutId) clearTimeout(hardDeadlineTimeoutId);
  if (idleTimeoutId) clearTimeout(idleTimeoutId);
  stopThinkPingInterval();
  unregisterStream(streamId); // <-- BUG 2 WIRE-UP — closes the stream's reaper entry
}
```

### PREREQ #5 — updateStreamActivity in resetIdleTimeout (arrow function)
Inside `const resetIdleTimeout = (extensionMultiplier?: number) => {` at L1982:
```ts
const resetIdleTimeout = (extensionMultiplier?: number) => {
  if (idleTimeoutId) clearTimeout(idleTimeoutId);
  if (!timeoutController) return;
  const effectiveMultiplier = extensionMultiplier ?? activeExtensionMultiplier;
  // BUG 2 WIRE-UP — bump reaper activity so each idle-reset keeps the reaper alive
  updateStreamActivity(streamId);
  // ... existing timeout setup ...
};
```

### GUARD — the magic-hook defensive guard itself
Inside the `case 'start':` / `case 'finish':` body, BEFORE the existing
`break;`, add:
```ts
// Bug 2 closure (2026-07-22) — SHOULD-CONSIDER #1: magic-hook defensive guard.
// Bump reaper activity on case-bypass chunks so the reaper's lastActivityTime
// cannot desync from resetIdleTimeout().
if (typeof streamId === 'string' && streamId && updateStreamActivity) {
  updateStreamActivity(streamId);
}
```

NOTE: in this revised position, the hook is INSIDE the case body (which
resolves the prior scope-vs-TSC error). The hook fires ONLY on
`case 'start':` / `case 'finish':` chunks (the bypass path). Other
case branches (text-delta, tool-call, step-start/finish) already bump
activity via their existing `onFirstToken()` / `resetIdleTimeout()`
calls inside the same case body.

## Files in this workstream

| File                                                                                  | State (2026-07-22)                                              |
|---------------------------------------------------------------------------------------|------------------------------------------------------------------|
| /opt/bing/web/lib/chat/vercel-ai-streaming.ts                                         | Reverted clean (4128 lines). Magic-hook NOT yet added.          |
| /opt/bing/web/__tests__/chat/vercel-ai-streaming-magic-hook.test.ts                  | NEW (REV 2). Source-analysis regression. Gate ON fails today.   |
| /opt/bing/web/__tests__/chat/vercel-ai-streaming-reaper-integration.test.ts           | PRE-EXISTING broken (6/7 fail) — same wire-up missing root cause |
| /opt/bing/web/lib/chat/zombie-stream-reaper.ts                                        | Importer target — review for canonical `globalThis.__activeStreams__` globals |

## IMPORTANT structural facts to preserve in future audits

### `resetIdleTimeout` is an ARROW FUNCTION (not a `function` declaration)

The file declares it as:
```ts
const resetIdleTimeout = (extensionMultiplier?: number) => { ... }
```
at L1982. Tests / future audits that assume `function resetIdleTimeout(...) {}`
will produce broken assertions. The existing
`vercel-ai-streaming-reaper-integration.test.ts` had this exact bug — its
`/function\s+resetIdleTimeout\s*\(/` regex missed the arrow form.

### `streamId` was NEVER actually declared in the file

Prior audits/PR descriptions that claim "registerStream at L1685 passes
`streamId`" are FICTION — the variable was never declared, the call site
never existed, and the precondition for the guard (a real `streamId` in
the function-body scope) is missing.

### `globalThis.__bug2WireStreamIdFallbackCount__` is not in scope either

The crash log from prior turns referenced this global, but no current code
reads from it. If the wire-up is implemented from scratch, the canonical
entry point is `registerStream({ streamId, ... })` from zombie-stream-reaper
+ `updateStreamActivity(streamId)` on every idle-reset + chunk delivery.

## Verification steps after landing the wire-up

1. `cd /opt/bing/web && npx tsc --noEmit -p tsconfig.json` — expect 0 NEW errors.
2. `REAPER_MAGIC_HOOK_TEST_GATE=on npx vitest run __tests__/chat/vercel-ai-streaming-magic-hook.test.ts` — expect 6/6 PASS (PREREQ #1-#5 + GUARD now present).
3. `REAPER_WIRE_TEST_GATE=on npx vitest run __tests__/chat/vercel-ai-streaming-reaper-integration.test.ts` — expect 7/7 PASS (regex now matches `from './zombie-stream-reaper'`).
4. `node --check lib/chat/vercel-ai-streaming.ts` — expect exit 0.
5. Automated end-to-end test using a mocked-log walker (NOT manual smoke):
   - Create `/opt/bing/web/__tests__/chat/vercel-ai-streaming-reaper-gate.test.ts`
     using `vi.mock('chat-logger', ...)` to spy on chatLogger.error/info.
   - Drive `streamWithVercelAI()` through a synthetic fullStream that yields
     `start` → `text-delta` × 3 → `finish` chunks.
   - Assert `[CHAT-REAPER] updateStreamActivity fired` log appears 5 times
     (1 per chunk) via `expect(spy).toHaveBeenCalledTimes(5)` + matcher per call.
   - Manual smoke is NOT a valid verification step because the artifact a
     future audit needs (the green CI log) comes from an automated test,
     not an operator's terminal.

## Future work (post-recovery)

### F1 — vitest.config.ts conditional include gate (SHOULDCONSIDER #2 from REV 3 code-review)
**Stable anchor: `#vitest-config-gate-2026-07-22`**
The current gate is implemented via nested `describe.skip + it.skip + early-return`
in the test file itself, which works but keeps the test file in the runtime
collection tree at all times. A more robust convention — used elsewhere in this
codebase for stage-gated tests — is to gate at the vitest.config.ts level:

```ts
// vitest.config.ts (or wherever projects root config lives)
test: {
  include: process.env.REAPER_MAGIC_HOOK_TEST_GATE === 'on'
    ? ['__tests__/chat/vercel-ai-streaming-magic-hook.test.ts']
    : [],
  // ...
}
```

Benefits: (a) vitest never even LOADS the file in gate-OFF mode (no vite:oxc
parse-error risk even if vitest version later upgrades), (b) the file's source
stays focused on the assertions (no gate plumbing), (c) matches the
stage-gating convention used elsewhere. Track as a follow-up ticket.

### F2 — Reaper integration test (existing) renew
**Stable anchor: `#reaper-integration-renewal-2026-07-22`**
(mirrors F1's `#vitest-config-gate-2026-07-22` so cross-references survive header text drift)
**Committed approach: SAME vitest.config.ts gate as F1.** Do NOT widen the
existing /opt/bing/web/__tests__/chat/vercel-ai-streaming-reaper-integration.test.ts
regex. Instead, when F1 lands, move BOTH this test + the magic-hook test into
the same vitest.config.ts conditional include block.

Rationale: both tests assume the same wire-up (Bug 2 zombie-stream-reaper
integration that hasn't landed) — guarding them under ONE config-side gate
gives a single signal-flip point. Widening the existing test's regex is a
real-but-distracting alternative that mixes two fix vectors for one root
cause; the cleanest convention is "gated test = same config-side include
trigger".

## Closure narrative (mirrors POSTAUDIT-FOLLOWUPS pattern)

- Discovery date: 2026-07-22
- Diagnostic authority: spawn_agents verifier + grep-verified byte-exact
- Recovery action: REVERT + BLUEPRINT + ticket
- Future landing: tracked here as 5 PREREQs + 1 GUARD + 2 future-work sub-items
- Stable anchor: `#magic-hook-prerequisites-2026-07-22`
