# Async Parallelization Opportunities

Comprehensive catalog of places where independent async operations run sequentially and could be parallelized. Organized by impact tier.

## Status Audit (2026-07-03)

> Which proposals / Co-Brief invalidations stand against the current /opt/bing tree.

### Top-5 Quick Wins
| # | Doc claim | Status | Evidence |
|---|-----------|:------:|----------|
| 1 | `route.ts:999` — `applyPromptModifiers` into Promise.all | ✓ applied | route.ts L920-L955 already wraps it in the 5-way Promise.all alongside `buildWorkspaceSessionContext`, `mem0Search`, `buildHybridWorkspaceContext`, `resolveFilesystemOwner`+`classifyRequest` |
| 2 | `service.ts:1444` — `resolveDynamicDefaults` + `determineMode` Promise.all | ✓ applied | `web/lib/orchestra/unified-agent-service.ts:1512` now wraps both in `Promise.all([resolveDynamicDefaults(), determineMode(config)])`. Cite drift: the two awaits now sit at L1512 + L1523 (intervening log block) — the upstream `resolveDynamicDefaults` cache layer + ~6/2026 file growth pushed the cite down ~46 lines from the 7/3 audit snapshot. ROI ~50-100ms/request. |
| 2b | `service.ts` — `resolveDynamicDefaults` + linked PROVIDERS dynamic import at SITE B + SITE F | ✓ applied | `web/lib/orchestra/unified-agent-service.ts` SITE B (`runV1ApiWithTools`, was L3512+L3541) and SITE F (`runV1ApiCompletion`, L5666+L5678) now both wrap `resolveDynamicDefaults()` + `import('../providers/llm-providers')` in `Promise.all`. The `getModelForProvider` / `_getProviderFirstModel` closures continue to read `PROVIDERS` from the destructure of the Promise.all tuple (`const { PROVIDERS } = _llmProvidersMod;`). ROI ~5-30ms/request (cold cache miss path) + ~5-30ms ESM import wallclock savings on warm-cache requests. Sites A (`runProgressiveBuild` L2818) / C (`runV1Orchestrated` entry L5221) / D (`runV1Orchestrated` telemetry L5434) / E (`runV1Orchestrated` catch L5615) intentionally skipped: A and C have no partner await; D's partner (`chatRequestLogger.logRequestComplete().catch(()=>{})`) is already fire-and-forget; E follows `invalidateDynamicDefaultsCache()` and the re-fetch is an intentional serialized refresh. **Note on #66**: the doc lists Tier 5 #66 as `unified-agent-service.ts:5106, 5319` "Redundant `await resolveDynamicDefaults()` — second call re-checks 30s cache" but the actual 30s `_cachedDynamicDefaults` TTL (L323-L437) returns synchronously from cache on repeat within-window calls (microsecond cost, no real waste); concurrent cache-MISS de-dup would need a separate in-flight promise pattern in `resolveDynamicDefaults` itself and is out-of-scope for the site sweep. |
| 3 | `service.ts:3774` — hoist `buildWorkspaceSnapshot` outside provider-fallback loop | ⚠ do-not-apply | Co-Brief §Invalidations explicitly warns: stale-snapshot race when a provider modifies state and fails mid-write — keep snapshot INSIDE loop |
| 4 | `route.ts:883` — `resolveFilesystemOwner` + `classifyRequest` Promise.all | ✓ applied | route.ts L950 wraps both in Promise.all |
| 5 | `architecture-integration.ts:630-903` — Promise.all 10 tool I/O ops | ✗ not validated here | if unchanged, the win stands |

### Tier 2 #15 (provider-keys.ts L192-L216)
✓ applied — `getStoredProviderApiKeys` now uses `Promise.allSettled` (L206-L211). The Coordination Brief win is **claimed** in production.

### Meta #1 + Meta #3 invalidations
✓ both stand. `secrets/web.ts openDB()` has zero concurrency primitives (no MAX_CONCURRENT, no semaphore); modern browsers accept unbounded concurrent readonly IDB transactions. `transactional-vfs.ts` has zero `Mutex|Lock|serialize` imports — OCC uses version tokens only. Path is `web/lib/vfs/` not `web/lib/virtual-filesystem/`.

### NEW-1 (auth + body parse overlap — Tier 4 #47 anchor site)
✓ applied — `web/app/api/sandbox/session/gateway.ts` POST handler now wraps `verifyAuth(req)` + `req.json()` in `Promise.all`. Cite drift: doc listed `sandbox/session/gateway.ts:18,38` (and Tier 4 #48/:32,48 + #49/antigravity/login/:16,24); the real anchor site is `/opt/bing/web/app/api/sandbox/session/gateway.ts` POST (verifyAuth at L18, req.json at L38 — apply at L17-L34 now). **Cite correction**: the path is `app/api/sandbox/session/gateway.ts`, NOT `sandbox/session/gateway.ts` (typo in old doc entry). The DELETE handler in the same file (also has verifyAuth + req.json() at L147+L157) was INTENTIONALLY LEFT UNCHANGED on this initial apply (scope discipline; separate next-pass). ROI 15-40ms/request on sandbox session POST critical path.

### NEW-1 followup (2026-07-07) — Tier 4 #47-DELETE, #48, #49, #50
Sibling passes extended the NEW-1 pattern from the POST anchor to the remaining Tier 4 routes:

| Doc # | File / handler | Apply site | Status | Notes |
|---|---|---|---|---|
| 47-DELETE | `web/app/api/sandbox/session/gateway.ts` DELETE | L106-L137 | ✓ applied | Same shape as POST: `verifyAuth(req)` + `req.json()` in `Promise.all`. CSRF check stays BEFORE PA (sync-or-quick-cookie-check); rate-limit stays AFTER (depends on `authResult.userId`). Removed the standalone `body = await req.json()` further down. Mirror of the prior POST apply. |
| 48 | `web/app/api/sandbox/daemon/gateway.ts` POST | L29-L48 | ✓ applied | `verifyAuth(req)` + `req.json()` in `Promise.all`. Rate-limit check stays AFTER the PA (depends on `authResult.userId`, sequential dependency); 6-line audit comment cites Tier 4 #48. ROI per the doc estimate. |
| 49 | `web/app/api/antigravity/login/route.ts` GET | L17-L41 | ✓ applied | GET shape: partner is `getAntigravityOAuthUrl(projectId)`, not `req.json()`. The synchronous URL parse (`new URL(req.url).searchParams.get('projectId')`) stays BEFORE the PA so `projectId` is in scope at construction. No external network I/O; safe to fire for anonymous callers (a stolen oauthUrl is not a session-takeover risk; `/api/antigravity/callback` hard-rejects anonymous tokens via verifyAuth). Wallclock gain bounded by `min(T_verifyAuth, T_oauthUrlGen)` — typically 5-15ms. |
| 50 | `web/app/api/antigravity/callback/route.ts` GET | L18-L41 (unchanged) | ⚠ deliberately deferred | **Security rationale**: `exchangeCodeForTokens(code, redirectUri)` is an external HTTP POST to `oauth2.googleapis.com/token` that **permanently consumes the single-use OAuth `code`**. Parallelizing with `verifyAuth` lets an unauthenticated caller presenting a (possibly stolen) valid code BURN the code before `verifyAuth` rejects — irrecoverable user error + Google token-endpoint quota hit. The Google token endpoint accepts and processes ANY caller presenting a valid `code` (no verifyAuth-side gate on Google's side); we have NO per-IP rate-limit on this route today, so spam hits burn our OAuth `client_id`'s quota and risk Google-side throttling of the entire integration. The 5-15ms wallclock savings does NOT justify this architectural risk. Tradeoff documented in chat history (NEW-1 application turn). Pattern can be revisited ONLY behind a per-IP rate-limit + tightened CSRF check on the callback. |

**Cumulative Tier 4 ROI**: ~15-40ms/request compounding across the 4 applied sites (sandbox/session POST + DELETE + sandbox/daemon POST + antigravity/login GET). Anchor cite drift correction still stands (path typo `app/api/sandbox/session/gateway.ts` vs old `sandbox/session/gateway.ts`).

**NEW-B1 (`web/app/api/storage/upload/gateway.ts` `request.formData()` fan-out) — REVERTED 2026-07-07 (security exception).** Audit-clean mirror of the NEW-1 followup-b pattern would be `Promise.all([verifyAuth(request), request.formData()])` — but this specific route has **NO CSRF protection**, **NO per-IP rate-limit at the gateway** (no /api/storage/* entry in vercel.json), and accepts an attacker-controllable request body. Parallelizing would fire `request.formData()` BEFORE auth-check completes, amplifying every failed-auth request into a full multipart body parse+discard cycle — a body-consumption DoS vector. Sequential `await verifyAuth(request)` then `await request.formData()` is the correct ordering for THIS SPECIFIC route. **Documented as the exception case in the inline 8-line WHY-comment in gateway.ts itself.** Do not re-survey / re-propose in future audits: the apply is structurally incompatible with the route's unprotected posture. This is the only `request.formData()` site in the public HTTP surface; huggingface/audio and filesystem/import use `req.formData()` but neither has the auth-then-body-parse pair structure (huggingface/audio reads `HUGGINGFACE_API_TOKEN` from env, no auth-result shape; filesystem/import first verifies auth then parses — already sequential, no win to claim).

### NEW-1 followup-b (2026-07-07) — Tier 4 #47 followup-b

The recent Tier 4 sweep across the rest of the `/api/*` surface (Command: `rg "await verifyAuth"` plus alternates `resolveRequestAuth`/`authenticateRequest`/`requireAdminApiOrForbidden`) surfaced 14 additional clean mirrors of the NEW-1 pattern (`verifyAuth + req.json → Promise.all`) across 12 files that were NOT in the original Tier 4 catalog. Twelve applied uniformly; one special case (#NEW-A9 mfa/disable) required a `let`-lift due to outer-catch scope collision. The 14th candidate (admin/callback) was skipped under the same security rationale as #50 (Google token endpoint external mutating RPC).

| Doc # | File / handler | Apply site | Status | Notes |
|---|---|---|---|---|
| NEW-A1 | `web/app/api/antigravity/chat/route.ts` POST | L17-L34 | ✓ applied | Cleanest shape: no CSRF, no rate-limit, no Zod. Direct `Promise.all([verifyAuth(req), req.json()])` mirror. Body destructured directly: `const { model, messages, stream, thinking } = body`. |
| NEW-A2 | `web/app/api/mastra/resume/gateway.ts` POST | L40-L57 | ✓ applied (with caveat) | Used `request.json().catch(() => null)` + `if (!body) return 400` per audit safety decision. Original `let body; try { body = await request.json(); } catch { 400 }` collapsed to single inline null-check. `requestId` preserved on both 401 and 400 paths. |
| NEW-A3 | `web/app/api/sandbox/execute/gateway.ts` POST | L29-L48 | ✓ applied | CSRF stays BEFORE; rate-limit (depends on `authResult.userId`) stays AFTER; Zod `sandboxExecuteRequestSchema.safeParse(body)` consumes body post-PA. |
| NEW-A4 | `web/app/api/sandbox/lifecycle/gateway.ts` POST | L21-L40 | ✓ applied | Same shape as execute: rate-limit stays AFTER; Zod `lifecycleSchema.safeParse(body)` consumes body downstream. |
| NEW-A5 | `web/app/api/sandbox/agent/gateway.ts` POST | L11-L28 | ✓ applied | Clean mirror: no CSRF, no rate-limit, no Zod. Used by streaming agent loop. |
| NEW-A6 | `web/app/api/sandbox/terminaluse/gateway.ts` POST (tasks) | L100-L120 | ✓ applied | Rate-limit stays AFTER. Zod `createTaskSchema.safeParse(body)` consumes body post-PA. |
| NEW-A7 | `web/app/api/sandbox/terminaluse/gateway.ts` POST_EVENT | L262-L280 | ✓ applied | No rate-limit; Zod `sendEventSchema.safeParse(body)` consumes body. |
| NEW-A8 | `web/app/api/sandbox/terminaluse/gateway.ts` POST_FILESYSTEM | L380-L395 | ✓ applied | No rate-limit; Zod `createFilesystemSchema.safeParse(body)` consumes body. |
| NEW-A9 | `web/app/api/auth/mfa/disable/gateway.ts` POST | L21-L36 | ✓ applied (SPECIAL) | **Required `let`-lift to function scope** (rejected the simple `const [authResult, body] = await Promise.all(...)` shape): the existing outer `catch` block references `authResult.userId` for the audit-log call (`logMfaDisableFailure(authResult.userId, request)`), but `try`-block-scoped `const` declarations are NOT visible inside the catch's own lexical scope. ALSO added optional-chain defense `authResult?.userId` in the catch to handle the rare `Promise.all`-rejects-before-assign edge case (preserves the audit-log's silent-swap-via-inner-try behavior on the rare `verifyAuth`-throws path). |
| NEW-A10 | `web/app/api/auth/mfa/verify/gateway.ts` POST | L23-L36 | ✓ applied | Direct mirror — different from NEW-A9 because mfa/verify's catch does NOT reference `authResult`. CSRF stays BEFORE. |
| NEW-A11 | `web/app/api/smithery/connections/gateway.ts` POST | L46-L70 | ✓ applied | Different `verifyAuth` import path (`@/lib/auth/verify-auth` not `@/lib/auth/jwt`) → auth-result check uses `!authResult.success` (not `success && userId`). Param is `request` (not `req`), so `request.json()`. |
| NEW-A12 | `web/app/api/user/profile/gateway.ts` PUT | L11-L25 | ✓ applied | CSRF stays BEFORE; **PUT only** (GET handler untouched — uses sync DB read, not a verifyAuth+body pattern). Uses `request.json()`. |
| NEW-A13 | `web/app/api/agent/stateful-agent/interrupt/gateway.ts` POST | L21-L33 | ✓ applied | Different AuthResult shape: `authResult.authenticated` instead of `authResult.success` (this site uses `@/lib/auth/verify-auth` not `@/lib/auth/jwt`). |

**NEW-A9 SPECIAL CASE — why the `let`-lift was necessary (remember the trick for future audits):**

A `try/catch` in JavaScript has SEPARATE block scopes — the `catch` cannot see `try`-scoped `const` declarations. If you put `const [authResult, body] = await Promise.all([...])` INSIDE a try block, a catch handler that transitively references `authResult` (or `body`) cannot read it — the TypeScript compiler catches this with `TS2552: Cannot find name 'authResult'`, and at runtime the catch sees `undefined`. Two options for files where the catch transitively references either var (mfa/disable is the lone Group-A case):

1. **Lift the `let` declaration OUTSIDE the try,** with destructure-assign inside the try:
   ```ts
   let authResult: Awaited<ReturnType<typeof verifyAuth>>;
   let body: any;
   try {
     [authResult, body] = await Promise.all([verifyAuth(req), req.json()]);
     // ... use authResult freely inside try
   } catch (error) {
     // ... catch can read authResult since the `let` is at function scope
   }
   ```
   The `let` lives at function scope; both try and catch see it. (Used in mfa/disable.)
2. Move the `Promise.all` OUTSIDE the try entirely (loses the parallelism benefit on the catch path — usually acceptable since catch paths are rare, but loses parallelization for the happy path's region before the try).

Optionally-chained the `authResult?.userId` reference in mfa/disable's catch to defend against the `Promise.all`-rejects-before-assign edge case (i.e., if the `await` itself throws before the destructure has assigned, `authResult` is left undefined at runtime even though the TS type says non-undefined — `?.` shields the audit-log call from crashing and falling into the inner `try { logMfaDisableFailure } catch {}` silent-swap). All other 12 sites have direct `const`-mirror applies because their catches either don't reference `authResult` (mfa/verify, mastra/resume, terminaluse Sites 6-8) OR are inside the same scope as the verifyAuth line.

**Cumulative NEW-1 + followup + followup-b Tier 4 ROI**: ~15-40ms × 4 originally-applied sites (the NEW-1 anchor `sandbox/session/gateway.ts` POST + 3 NEW-1 followup applies #47-DELETE, #48, #49; the 4th followup candidate #50 stays deferred under the security rationale documented above) + ~2-15ms × 13 sites in the NEW-1 followup-b Group-A sweep (all 13 applied) = **~41-235ms/request saved on hot paths when any of the 17 routes fire** (4 originally-applied + 13 Group-A). The 2-15ms × 13 = 26-195ms Group-A range composes min-max with the original 15-40ms to give 41-235ms; the doc Tier-4 typical savings band of 5-15ms × 13 = 65-195ms would give 80-235ms — both bounds valid, the 41-235 figure is the broader envelope.

### NEW-1 followup-c (2026-07-07) — Group-B sync-predicate + Promise.all sweep (lib/mcp/ + lib/orchestra/)

The followup-b sweep covered the `/api/*` surface. This followup-c targets the **same NEW-1 followup-b shape** (sync predicate + sibling async + Promise.all-with-Promise.resolve-no-op fold-in) in **lib/mcp/ + lib/orchestra/** — the orchestration-side mirrors of the route-side pattern. The audit command set was `rg 'cachedRemoteTools|cached.*Tools|let cached\w+|Promise\.resolve\(EMPTY|\Promise\.resolve\(\[\]|\Promise\.resolve\(null|\{\}\)'` plus `rg 'getRemoteMCPTools|getAvailableProviders|getProviderHealth|refreshMCPorterToolsCache|getBlaxelProviderInstance|getArcadeServiceInstance'`.

Three NEW-C candidates identified with strong same-shape fit; one (NEW-C4 `createModelWithFallback`'s fall-through loop) is **deliberately rejected** because it is by-design first-success-wins (sequential `try { await createModel } catch { continue; }` cannot become a `Promise.all` without changing the failure-recovery contract). The sweep confirms the doc's existing Tier 1 #11 site in `architecture-integration.ts:300-318` (HTTP transport CONNECT in a for-loop) is the upstream sibling of NEW-C1; the apply here targets NEW-C1 alone and leaves the doc-cited Tier 1 #11 untouched.

| Doc # | File / handler | Apply site | Status | Notes |
|---|---|---|---|---|
| NEW-C1 | `web/lib/mcp/http-transport.ts` `getRemoteMCPTools` (per-transport listTools fan-out) | L86-L120 | ✓ applied (2026-07-07) | **Largest in-scope find — applied.** Sequential `await transport.listTools()` per connected server in a `for (const [serverName, transport] of connectedTransports)` loop. The shape mirrors Tier 1 #11 (same `architecture-integration.ts` `for` loop but for CONNECT vs LISTTOOLS). Pattern: `Promise.all(Array.from(connectedTransports.entries()).map(async ([serverName, transport]) => { try { ... } catch { return []; } }))` then `.flat()`. Per-transport failure isolation is preserved (each entry's `try/catch` returns `[]` on failure; the existing `for` body's `try/catch` becomes each map callback's `catch`). ROI ∝N servers × 30-80ms/transport — typical web-mode deployment has 2-4 transports → **~60-320ms saved per call when remote MCP servers are configured**. The 60s TTL cache (L23-30 + L79-82 read-through) reduces call frequency, so the per-request win only materializes on cache miss / 60s boundary / explicit `forceRefresh=true`. |
| NEW-C2 | `web/lib/orchestra/stateful-agent/agents/provider-fallback.ts` `getProviderHealth` (per-provider isAvailable sequential) | L412-L457 | ✓ applied (2026-07-07) | `for ([name, config] of Object.entries(providerConfigs)) { const available = await config.isAvailable(); ... }` — 3 providers, each `isAvailable` is a sync env-var check wrapped in async (microsecond-cheap work + JS microtask hop). **Applied**: replaced the sequential `for` loop with `Promise.all(Object.entries(providerConfigs).map(async ([name, config]) => { try { await config.isAvailable(); ... } catch { return [name, { available: false, error }]; } }))` + reducing the resolved entries back into the `health` record. Preserves the per-provider try/catch isolation (a single failing provider returns `{ available: false, error }` without denying health results for healthy siblings). The pre-fetched `circuitStates = getCircuitBreakerStates()` lookup stays OUTSIDE the PA and is read inside each map callback (sync map lookup, no I/O). 11-line WHY-comment block above the PA cites the doc section + per-call ROI + pre-fetched-states boundary. ROI: ~1-5ms per call (3 providers × microtask-hop + env-var reads; tightened from the earlier 5-15ms estimate after review — the actual wallclock cost is dominated by the JS microtask roundtrip, not by any I/O). Caveat: this function is called from the provider-fallback health-dashboard endpoint, not the per-LLM-call hot path, so the per-request win is N/A most of the time — the win is on health-dashboard refreshes, which can be hit during loopback or operator-debug traffic. Flagged "soft win" because the per-call savings are at the low end of the doc's "5-30ms" target range. |
| NEW-C3 | `web/lib/mcp/architecture-integration.ts` `getBlaxelProviderInstance` + `getArcadeServiceInstance` lazy-init cold-start fold-into-Phase-1-PA | L656-L672 + L1018-L1029 | ✓ applied (2026-07-07) | The two lazy-init singletons are cached after first call (`cachedBlaxelProvider`, `cachedArcadeService`). On the **first** call: `await import('../sandbox/providers/blaxel-provider')` (or `await import('../integrations/arcade-service')`); once resolved, `new BlaxelProvider()` (or `getArcadeService()`) runs synchronously. The wallclock cost is the dynamic import; the constructor/service getter is sync. Apply: hoist both dynamic imports into the **existing Phase-1 PA at L656-L665** (`Promise.all([import('./provider-advanced-tools'), import('./vfs-mcp-tools'), import('../bash/bash-tool'), import('../powers/mem0-power'), conditional mcporter refresh])`) by adding both as slots 6 and 7 with a single-resolve-then-discard pattern: `import('../sandbox/providers/blaxel-provider').then(() => {}) ; import('../integrations/arcade-service').then(() => {})`. The constructor/getter stays sync-or-async in the existing lazy-init helpers, so the warmth just pre-resolves the module cache. ROI: **cold-start only** (~5-15ms per dynamic import resolved at Phase-1 PA time vs the current first-tool-call latency). Compounds with the existing Phase-1 PA's import wallclock — the two new slots are siblings, not replacements. |
| ~~NEW-C4~~ | ~~`provider-fallback.ts` `createModelWithFallback` per-provider try-await fallback loop~~ | ~~L335-L362 (for-loop body of `createModelWithFallback`)~~ | ⚠ PERMANENTLY DEFERRED | **Do not parallelize.** Three structural conflicts make a clean refactor impossible:<br> 1. **`Promise.any` violates preferred-first ordering.** `Promise.any` is strictly first-to-fulfill. If a non-preferred alternative initializes faster than the preferred provider, `Promise.any` returns the non-preferred — breaking the caller's explicit fallback intent (the `preferredProvider` arg should only be bypassed when preferred rejects, not when it's just slow). Validation: preferred (OpenAI) takes 200ms, non-preferred (Anthropic) takes 50ms → currently OpenAI wins at 200ms; with `Promise.any` Anthropic wins at 50ms.<br>2. **Speculative parallelization pollutes `circuitBreaker` state.** A "kick off all, await in order" approach fires `provider.createModel()` for fallbacks that may never be used. If a backgrounded fallback reject lands AFTER the caller has received its preferred result, the global circuit-breaker records an out-of-band `recordFailure(name)` for a provider the user never actually attempted. This corrupts the downstream health-dashboard signal — a provider that gets one too many `recordFailure` calls opens its breaker and gets shelved despite being healthy.<br>3. **The wallclock win is essentially zero.** `provider.createModel()` in these SDKs (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) is **local-only**: it does the dynamic import and returns a wrapped `LanguageModel` synchronously (or after a Promise-resolved tick for the dynamic import). **It does NOT make a network call** — the LLM network request happens later in `streamText` / `generateText` runs. Cold-cache delta between strategies: under the current **sequential**, only the **first** provider to be tried pays its ~5-15ms dynamic-import cost — the rest never import. Under `Promise.any`, **all 3** providers pay it unconditionally in parallel, so the cold-start wallclock is ~max(~5-15ms) but the import-call count is 3x. Net: parallel is at worst **break-even** on cold-start wallclock (and modestly favorable on preferred-failure by collapsing the alt's import onto the preferred's import window), but pays a fixed cost across the unused providers every call. Warm-cache sequential overhead is <1ms. Either way, this is dwarfed by the downstream `streamText`/`generateText` network latency, which dominates by 1-2 orders of magnitude and is identical regardless of which provider wins the model-creation race. There's nothing meaningful to amortize against.<br>**Net:** the current sequential `try { return await createModel } catch { continue }` is the architecturally-correct pattern for strict-order, side-effect-accounting, single-success fallback. The "sequential cost = architecturally-correct cost of single-success fallback" framing from the doc's original NEW-C4 entry stands reinforced — no follow-up-b parallel apply is structurally viable without one of the three unacceptable trade-offs above. Re-surveying this site in future audits is unlikely to surface new wins. |

**Cumulative NEW-1 + followup-b + followup-c ROI**: NEW-C1 is **applied** (realized per cache-miss call). NEW-C2 and NEW-C3 are still **recommended but not yet applied** — see the Action priority #6 entry for the outstanding follow-up. Scenario compose (NEW-C3 effective only on cold-start; NEW-C1 only on cache miss; NEW-C2 only on health-dashboard refresh):

| Scenario | Compose | Range |
|---|---|---|
| Cold-start first request | NEW-C1 (60-320ms) + NEW-C3 cold (5-15ms) | **~65-335ms** |
| Subsequent request, NEW-C1 cache miss (60s boundary) | NEW-C1 (60-320ms) + NEW-C2 health-dash ≈0 (off hot path) | **~60-320ms** |
| Subsequent request, NEW-C1 cache hit | NEW-C3 warm memoization (≈0) + NEW-C2 health-dash ≈0 | **~0ms** (steady state) |
| Health-dashboard refresh | NEW-C2 only | **~1-5ms** |

The "subsequent-request steady state" of **~60-320ms** is essentially NEW-C1's range alone (NEW-C2 is health-dash-only, NEW-C3 warms after first call). The earlier prose "46-225ms subsequent-request steady state" was a precariously-derived figure that doesn't compose traceably — replaced with the explicit scenario table above so the math is auditable. NEW-C1's per-request win is the largest single-route find in the entire audit when materialized — comparable to the Tier 1 Win #1 5-300ms `applyPromptModifiers` fold-in.

**NEW-C1 recipe (concrete refactor recipe for the apply, drop-in replacement for L84-L119):**

```ts
// Before (L84-L119)
const allTools: Array<{...}> = [];
for (const [serverName, transport] of connectedTransports) {
  try {
    const result = await transport.listTools();
    const tools = result?.tools || [];
    for (const tool of tools) {
      allTools.push({ type: 'function', function: { name: ..., description: ..., parameters: ... } });
    }
    logger.debug(`Loaded ${tools.length} tools from remote MCP server: ${serverName}`);
  } catch (error: any) {
    logger.warn(`Failed to get tools from remote MCP server ${serverName}:`, error.message);
  }
}
cachedRemoteTools = allTools;
lastToolFetch = now;
return allTools;

// After
const transportResults = await Promise.all(
  Array.from(connectedTransports).map(async ([serverName, transport]) => {
    try {
      const result = await transport.listTools();
      const tools = result?.tools || [];
      logger.debug(`Loaded ${tools.length} tools from remote MCP server: ${serverName}`);
      return tools.map((tool: any) => ({
        type: 'function' as const,
        function: {
          name: `${serverName}_${tool.name}`.replace(/[^a-zA-Z0-9_]/g, '_'),
          description: tool.description || `Remote MCP tool: ${tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }));
    } catch (error: any) {
      logger.warn(`Failed to get tools from remote MCP server ${serverName}:`, error.message);
      return [] as Array<{ type: 'function'; function: { name: string; description?: string; parameters: any } }>;
    }
  })
);
const allTools = transportResults.flat();
cachedRemoteTools = allTools;
lastToolFetch = now;
return allTools;
```

The cache-hit path (L79-L82) is preserved unchanged. Apply preserves the existing semantic-isolation contract: a single failing transport does not deny tool definitions from the healthy siblings (each `try/catch` returns `[]` independently, same as the old `for` body).

### Tier 5 #66 (concurrent-miss in-flight de-dup, resolveDynamicDefaults)
✓ applied — `_dynamicDefaultsInflight` module-level Promise now de-dups concurrent cache-MISS callers of `resolveDynamicDefaults()` in `web/lib/orchestra/unified-agent-service.ts`. Combined with the 30s `_cachedDynamicDefaults` TTL synchronous cache-hit return above it, the in-flight slot covers BOTH the within-window repeat-call case (microsecond return) AND the simultaneous-miss case the cache alone does NOT (e.g. a circuit-breaker invalidation fires + N callers race to the cache-miss path within the same microtask). The slot identity-checks in the finally cleanup to avoid clobbering a newer in-flight promise set by an interleaved caller. Cite: module-level var near `DYNAMIC_DEFAULTS_TTL_MS` + IIFE wrap of the cache-miss body + `try/finally` cleanup before the function's closing `}`. ROI is workload-dependent — minimal for single-caller-per-request flows; meaningful for fan-out flows where 2-3 callers/request hit `resolveDynamicDefaults()` via the Win #2b sites (runV1ApiWithTools L3518 + runV1ApiCompletion L5682 run in parallel on the same microtask with their OWN Promise.all, and the de-dup gate collapses them into a single resolution chain at the per-microtask level).

### NEW-1 followup-d (2026-07-07) — Group C clean mirrors (Tier 5 rate-limit / OAuth / cache-miss + Tier 6 agent-team)

Surface from the 2026-07-07 `thinker-with-files-gemini` Group C audit pass. Each candidate was adjudicated for structural feasibility + ROI vs. real-wold failure-mode risks (idempotency lock contention on parallel OAuth refresh, OCC race on parallel cache writes, hierarchical-worker data deps, etc.). **Apply list (16 candidates)** vs. **defer list (2 candidates)** per the verdict table.

#### Verdict table (Phase-2 format — Apply site + Reviewer role columns added)

| # | Apply site | Pattern | Reviewer role | Verdict | Rationale |
|---|------------|---------|---------------|:-------:|-----------|
| **51** | `auth-service.ts:421` (email + username existence DB checks) | sequential `await` of independent `SELECT`s | auth/Platform team | **✓ applied (2026-07-07)** | safe `Promise.all`, ~5-15ms/auth-signup. `Promise.all([checkEmailExists, conditional-username-check])` with `Promise.resolve(false)` short-circuit preserving missing-username gate. Semantic equivalence: both booleans checked AFTER Promise.all resolves; original email-first precedence preserved. See inline WHY-comment block (~30 lines) at `auth-service.ts:L420-L457` |
| **52** | `auth0.ts:163` (sequential `encryptApiKey` for access + refresh tokens) | sequential `await` of symmetric encrypt calls | auth/Platform team | **✓ applied (2026-07-07)** | symmetric encryption is stateless, safe concurrent, ~2-8ms/call. `Promise.all([encryptApiKey(accessToken?), encryptApiKey(refreshToken?)])` with `Promise.resolve({encrypted: null})` short-circuit slots preserving the conditional guards. Destructure `[{ encrypted: ... }, { encrypted: ... }]` preserved so the downstream INSERT at L189+ consumes identical types. See inline WHY-comment block (~30 lines) at `auth0.ts:L163-L188` |
| **53** | `enhanced-middleware.ts:533` (double `desktop-auth-bypass` module import) | two consecutive `await import()` for the SAME module | middleware / desktop-auth owner | **✓ applied (2026-07-08)** | collapse to single destructured import + remove microtask hop, ~1-3ms/middleware-hit. NEW-1 followup-d at `web/lib/auth/enhanced-middleware.ts:L531-L553` (the apply = single destructured import at L539 + 7-line WHY-comment at L531-L537; the desktop-auth-bypass branch spans L531-L553 inside the caller of `verifyAuth`); `getDesktopUserContext` hoisted out of inner `if (shouldBypassAuth(...))` branch (function ref, no side-effect, ESM caches the module after first import so the L535 await was a redundant microtask hop). Code-reviewer APPROVED. |
| 54 | `enhanced-llm-service.ts:L583-L593` (chat contextPack double dynamic-import — `smart-context` at L583 + `session-file-tracker` at L589 inside `if (contextPack && userId && conversationId)`) | sequential `await import()` × 2 for independent SDKs | enhanced-llm-service authors | **✓ applied (2026-07-07)** | `Promise.all([import(a), import(b).catch(() => null)])` + optional-chaining `sessionFileTrackerMod?.getSessionFiles(...) ?? []`; original graceful-degradation (recentFiles=[]) preserved on `session-file-tracker` module-load failure. Inline WHY-comment block at L583. ~3-12ms/chat-call |
| 55 | `enhanced-llm-service.ts:L975-L985` (stream contextPack double dynamic-import — twin of #54 with `request.conversationId || ''` identifier + `(streaming)` chatLogger fallback) | sequential `await import()` × 2 | enhanced-llm-service authors | **✓ applied (2026-07-07)** | `Promise.all([import(a), import(b).catch(() => null)])` + optional-chaining + `?? []`. Inline WHY-comment block at L975. ~3-12ms/stream-call |
| 56 | `enhanced-llm-service.ts:L1947-L1975` (pi CLI provider: `findPiBinarySync` binary-check dynamic-import at L1950 + `createCliPiSession` dynamic-import at L1970, separated by 17 lines of sync code, inside `else if (provider === 'pi')` branch) | sequential dynamic-imports for independent setup helpers | enhanced-llm-service authors | **✓ applied (2026-07-07)** | `Promise.all([import(find-pi-binary), import(pi-cli-session).catch(() => null)])` + extended guard (`if (!binaryPath \|\| !piCliMod)`); helper async-ness: `findPiBinarySync` = SYNC, `createCliPiSession` = ASYNC but called after guard. No-binary path non-regressed (provider-import `.catch(()=>null)` short-circuits ESM load). Re-extract `{createCliPiSession} = piCliMod` inside try-block (safe by TS narrowing post-guard). Inline WHY-comment blocks at L1947 + L2040. ~2-15ms/cold-start |
| 57 | `enhanced-llm-service.ts:L1815-L1833` (opencode CLI provider: `findOpencodeBinarySync` binary-check dynamic-import at L1817 + `OpencodeV2Provider` provider-import at L1832, inside `if (provider === 'opencode-cli')` branch) | sequential dynamic-imports for independent setup helpers | enhanced-llm-service authors | **✓ applied (2026-07-07)** | `Promise.all([import(find-opencode-binary), import(opencode-cli).catch(() => null)])` + extended guard (`if (!binaryPath \|\| !opencodeCliMod)`); helper async-ness: `findOpencodeBinarySync` = SYNC, `OpencodeV2Provider` = CLASS (sync ctor). No-binary path non-regressed. Re-extract `{OpencodeV2Provider} = opencodeCliMod` after guard (safe by TS narrowing). Inline WHY-comment blocks at L1815 + L1880. ~2-15ms/cold-start |
| 58 | `vercel-ai-streaming.ts:2868-L2899` (stream-chunk normalize+validate; cite-drift user-given L2478-L2489 → actual L2865-L2930 in 4036-line file) | sequential `await import()` in Vercel-AI SDK path | streaming / Vercel-AI owner | ✓ applied (2026-07-07) | Promise.all + per-import `.catch(() => null)` + `if (fn)` try-guard preserves independent best-effort |
| 59 | `vercel-ai-streaming.ts:3254-L3290` (429-error-chunk recordRateLimit+circuitBreakerManager; cite-drift user-given L2784-L2792 → actual L3228-L3250) | sequential `await import()` only-fires-on-429 | streaming / Vercel-AI owner | ✓ applied (2026-07-07) | Promise.all + per-import `.catch(() => null)` + `if (fn)` try-guard preserves independent best-effort |
| 60 | `lib/providers/llm-providers.ts:3381-L3399` (generateAntigravityResponse) + `:3445-L3473` (streamAntigravityResponse); cite-drift user-given `llm-providers.ts:3387` (path-ambiguous) → actual `lib/providers/llm-providers.ts` with 2 sites at L3381-L3394 + L3445-L3464 (pre-insert ranges) | sequential `await import()` for provider + DB shim | providers team + antigravity DB owner (cross-team) | ✓ applied (2026-07-07) | `Promise.all` preserves bundler-isolation semantics; Site A retains `import('@/lib' + '/database/antigravity-accounts')` dynamic-path-string concat + Site B retains `import(/* webpackIgnore: true */ '@/lib/database/antigravity-accounts')` inline — both forms defeat webpack/turbopack static analysis for the `better-sqlite3` native-dep chain. Reviewer Minor 1 polish: added `if (typeof window !== 'undefined') { throw 'Antigravity provider is server-only'; }` guard to Site A (parity with Site B's defense-in-depth fence). ~5-30ms/cold-cache |
| **61** | `antigravity-provider.ts:230` (userinfo + project ID parallel fetch) | sequential `await` of two independent `Bearer token` fetches | auth/Platform team | **✓ applied (2026-07-07)** | token-only dependency, no cross-mutation, separate return fields, ~50-150ms/antigravity flow |
| 62 | `antigravity-provider.ts:263` (3×10s `fetchProjectID` endpoint retry) | sequential `for…of` over `[PROD, DAILY, AUTOPUSH]` priority fallback chain | auth/Platform team | ⚠ DEFER | priority semantics — `Promise.any` violates priority by racing latencies against the priority chain. Risk of returning a non-priority endpoint's stale/different project ID |
| **63** | `token-refresh.ts:259` (sequential `getUserConnections` for 11 providers) | sequential `for…of` over OAuth connection list | OAuth refresh team / Platform | **✓ applied (2026-07-08)** | read-only graph fetch per isolated provider; no shared state mutation (≠ invalidated #64 which mutates `getOrRefreshUserTokens` backing store), ~30-150ms/token-refresh. NEW-1 followup-d at `token-refresh.ts:L261-L281` (the apply = `Promise.allSettled(providers.map(async ...))` block at L271-L281 + 10-line WHY-comment at L261-L270; function `getConnectionsNeedingRefresh` starts at L242); `Promise.allSettled(providers.map(async ...))` preserves the original try/catch semantics. Push order to `results` becomes non-deterministic (parallel completion order) — verified order-agnostic: no production caller (only tests reference the function). Code-reviewer APPROVED. |
| 65 | `unified-agent-service.ts:2162-2174` (sequential metric counters `incrementOrchestrationFallback` + `recordChatOrchestrationFallback`; **cite drift**: doc said L1921-1929, actual is L2162-2174) | sequential sync calls (doc framing `sequential \`await this.metrics…\` calls` was incorrect — both target functions are sync) | observability / metrics owner | **✓ verified-no-op (2026-07-08)** | recipe invalid: both target functions are synchronous (`incrementOrchestrationFallback(): number` in `degradation-tracker.ts:290` + `recordOrchestrationFallback(): void` in `chat-metrics.ts:131`); `Promise.all` over sync calls adds microtask overhead with no I/O to parallelize; doc's "~720B-2KB/req telemetry-overhead-recovery" claim was based on the false premise of I/O-bound counts; the existing WHY-comment at L2162-L2166 ("keep in sequence to preserve increment-first ordering") is a defensive maintenance annotation — the bug-40 orchestrator-fallback test does NOT actually depend on metric-vs-counter call ordering (assertions cover per-session counter monotonicity + sorted snapshots + `tagResultDegraded` direct-unit-tests, NOT metric-call vs counter-call order); zero byte/req savings; **maintenance verdict**: reorder risk is zero, so the verified-no-op is unconditional. |
| 67 | `unified-agent-service.ts:2615-2625` (sequential `injectContext` per history msg; **cite drift**: doc said L2373-2379, actual is L2615-2625; same shape — `for…of` over `config.conversationHistory`) | sequential `for…of` over chat history → `Promise.all(map(...))` would scramble order | unified-agent-service context team | **✓ verified-no-op (2026-07-08)** | recipe invalid due to **arrival-order backend storage**: `injectContext` (`opencode-session-manager.ts:340-366`) POSTs to `${this.baseUrl}/session/${sessionId}/message` with `{ noReply: true, parts: [{ type: 'text', text: context }] }` — NO client-side `timestamp`, `index`, or order marker; `getMessages(sessionId, limit)` in the same file simply fetches the backend's stored message array WITHOUT client-side reconciliation; parallelizing the `for…of` to `Promise.all(config.conversationHistory.map(...))` would race the concurrent POSTs through backend network jitter, scrambling the chronological chat history the LLM needs on subsequent turns; outcome: **CRITICAL risk** of corrupting session history for ~50-200ms savings; **maintenance verdict**: structural fix requires OpenCode backend cooperation (accept `timestamp` or `orderIndex` in the POST body so the client can preserve order on readback) — out of scope for client-side audit. |
| 69 | **`lib/spawn/orchestration/agent-team.ts:460`** (`executeHierarchical` worker dispatch) | sequential `for…of` over workers + plan steps | agent-orchestration team | ⚠ DEFER | hierarchical plan has step-to-step data deps (Step 2 requires Output 1); parallel races on logical data — see structural-conflict-rationale note below |
| **70** | **`lib/spawn/orchestration/agent-team.ts:614`** (`executeConsensus` agent voting) | sequential `for…of` over voting agents | agent-orchestration team | **✓ applied (2026-07-07)** | voting agents evaluate static state independently, safe fan-out, ~50-200ms/team-call. `Promise.all(agents.map(safeRun))` + per-agent try/catch returning `null` + post-resolve sequential push + batched progress callback. Multi-Agent-team read-back approved (see inline WHY-comment block, ~40 lines) |
| **71** | **`lib/spawn/orchestration/agent-team.ts:723`** (`executeCompetitive` solution creation) | sequential `for…of` over competitive agents | agent-orchestration team | **✓ applied (2026-07-07)** | competitive agents generate in silos, safe fan-out, ~80-300ms/team-call. `Promise.all(agents.map(safeRun))` + per-agent try/catch returning `null` + post-resolve sequential push (preserves `solutions[index] ↔ agent-index` correspondence for judge prompt) + batched progress callback. Multi-Agent-team read-back approved (see inline WHY-comment block, ~40 lines) |
| 72 | **`web/lib/crewai/crew/events.ts:209`** (event listeners in `emit`; cite correction: actual path is `web/lib/crewai/crew/events.ts`, NOT `lib/crewai/events.ts` per prior turn citation note) | sequential `for…of` over listener array inside `async emit` | CrewAI task loop owner | **✓ applied (2026-07-08)** | converted sequential `for`/`for…of` (`await listener(event)` per-iteration with try/catch) to `await Promise.allSettled(listeners.map(async (listener) => { try { await listener(event); } catch (error) { console.error('Event listener error:', error); } }))` at `events.ts:L209-L228` (the apply = `Promise.allSettled` block at L219-L228 + 9-line WHY-comment at L210-L218; `emit` lambda starts at L209); **per-listener try/catch preserved verbatim** (the `console.error('Event listener error:', error)` failure-reporting contract is unchanged); 9-line WHY-comment at L210-L218 cites the structural-safety rationale (allSettled vs all) + per-listener try/catch preservation + ~1-5ms/emit (typical N=2-4 listeners); **SHAPE difference from the rest of the apply list**: `Promise.all` would short-circuit on first listener reject and drop the rest silently; `Promise.allSettled` waits for every listener regardless, matching the original sequential try/catch contract 1:1; **tsc clean** for the target file (`tsc --noEmit --skipLibCheck lib/crewai/crew/events.ts` → no output); **structural diff**: 220→231 lines (+11 = 9-line WHY-comment + Promise.allSettled wrapper + indented async arrow inside `.map`); **md5** changed (post=`b617a7b…` vs backup=`394fbda…`). |

#### Structural-conflict rationale (DEFER rows, expanded per Phase-2 format)

**#62 (`antigravity-provider.ts:263` priority fallback chain)** — The 3-endpoint retry is `[PROD, DAILY, AUTOPUSH]` with **explicit priority semantics**, NOT a list of equivalent fallbacks. `Promise.any` would resolve to whichever endpoint returned first, returning e.g. the DAILY endpoint's project ID when PROD was 40ms behind. This silently violates the upgrade-from-DAILY-to-PROD contract that downstream code relies on (the request signature treats PROD project IDs as authoritative for antigravity flows). Sequential priority-aware retry is the CORRECT shape; parallelizing here loses correctness, not just safety. **Permanent defer.**

**#69 (`lib/spawn/orchestration/agent-team.ts:460` hierarchical plan)** — Hierarchical execution is **logically sequential** by definition: the plan's Step 2 depends on Step 1's output (e.g., manager's analysis feeds architect's spec feeds coder's implementation). The for-loop iterates `Array.from(this.activeAgents.entries()).filter(([role]) => role !== 'manager' && role !== 'architect')` and each worker awaits `this.runLLM({...previous-step-result...})`. Parallelizing the loop would race on the logical data dependency — even though wallclock cost exists, the data structure is incompatible with concurrency (under parallel, Step 2 reads `undefined` for Steps 1's output ~50% of the time given async dispatch). **Permanent defer; the right shape here is to make the plan truly concurrent at the planning step, not parallelize the existing sequential plan.**

#### Cite drift surfaced (audit 2026-07-07)

| File | Earlier cite (audit recipes / Group-B references) | Actual path (live tree) |
|------|----------------------------------------------------|------------------------|
| agent-team.ts | `lib/orchestra/agent-team.ts` (Group-B sibling to `provider-fallback.ts`) | **`lib/spawn/orchestration/agent-team.ts`** (976 lines total; #69 #70 #71 verified at L460/L614/L723) |
| crewai/events.ts | `lib/crewai/events.ts` (top-level crewai) | **`lib/crewai/crew/events.ts`** (220 lines total; #72 verified at L209 inside the `emit` lambda) |

All 4 entries (#69 #70 #71 #72) in the verdict table above carry the corrected `lib/...` prefixes. No other cookbook references in the doc need correction — audit text mentions like "Group-B sweep (lib/mcp/ + lib/orchestra/)" are correct (`provider-fallback.ts` IS in `lib/orchestra/stateful-agent/agents/`).

#### #61 apply details

✓ applied (2026-07-07) at `antigravity-provider.ts` L230-L264 (cite drift: file is 720 lines vs. recipe's "antigravity-provider.ts:230" — apply sits inside the `exchangeCodeForTokens` helper that calls `tokenResponse.json()` then issues the two parallel fetches). ROI ~50-150ms/antigravity flow.

Recipe shape applied:
```ts
const userInfoPromise = fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
  headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': '...' },
}).then(async (r) => (r.ok ? await r.json() : {}));

const projectIdPromise = projectId
  ? Promise.resolve(projectId)
  : fetchProjectID(tokenData.access_token);

const [userInfo, effectiveProjectId] = await Promise.all([
  userInfoPromise,
  projectIdPromise,
]);
```

Structural-safety rationale (per the inline WHY-comment block, ~40 lines):
- (a) Token-only input — each call reads only `tokenData.access_token` from outer scope; sibling results are not consumed.
- (b) No cross-mutation — `userInfo` is function-local; `fetchProjectID` returns `Promise<string>`.
- (c) No shared mutable state — no `this.*` writes, module-level bindings are effectively-const config.
- (d) Return-field independence — `userInfo.email` + `effectiveProjectId` flow to separate keys in the final `return { accessToken, refreshToken, email, projectId }`.

The 3-endpoint priority-fallback chain INSIDE `fetchProjectID` itself is UNCHANGED (defer to #62); only the OUTER wallclock is parallelized. Outer-if guard ("skip fetchProjectID if `projectId` already provided") preserved via `projectId ? Promise.resolve(projectId) : fetchProjectID(...)`.

### NEW-2..NEW-4
- NEW-2 (mem0Search before classifyRequest) — ✓ applied (2026-07-07) at `route.ts` L977-L1067
- NEW-3 (background session-file-tracking) — ✓ applied (2026-07-07) at `route.ts` L922-L928 (cite drift: recipe said L590, file growth + tier-1 #2 inlining pushed site to L922-L928 under doc's `O(1) Session File Tracking` heading). Defense-in-depth captured in inline WHY-comment: outer-import-promise `.catch` (so a partial-deploy / module-load reject logs instead of becoming an UnhandledRejection) + closure-local `trackingReqId` snapshot BEFORE the `void` chain (so the `.catch` handler still has correlation after AsyncLocalStorage scope teardown at response finalize). The `void` prefix silences `@typescript-eslint/no-floating-promises`. Mirror: tool-call-tracker at L1840+ uses the same recipe (audit annotation inline). ROI ~10-25ms per chat turn.
- NEW-4 (FC-Gate telemetry post-yield) — ✓ applied (2026-07-07) at `vercel-ai-streaming.ts` L2094-L2139 of the `chunk.type === 'finish'` block (cite drift: recipe said L990, ~1,124 lines of file growth). Improvement OVER the recipe: only `emitFCGateZeroCallsLog` was moved into `setImmediate(() => try { emitFCGateZeroCallsLog({...}) } catch {})` — the synchronous `wireFCGateZeroCallsSteer({...})` call STAYS in the chunk handler because its `detection.steer` return is consumed by the downstream `fcGateSteer` field (the recovery-message injection depends on it). Moving the detector itself into setImmediate would BREAK the fcGateSteer consumer; the apply is stricter and more correct than the doc's naive "schedule both" recipe. Inner try/catch in the setImmediate body ensures logger-pipe collapse cannot reach the outer hot path. PARITY WITH CLI-BINARY PATH preserved (the inline WHY-comment notes that NO caller-side pre-gate is needed because `wireFCGateZeroCallsSteer` internally gates on `finishReason === 'stop' || undefined`). ROI ~2-5ms per stream termination.

### Action priority (next pass) — sorted by ROI
1. **Audit #5** before applying (architecture-integration 10 ops).
2. **Skip Win #3 entirely** — Coordination Brief invalidation stands.
3. **Apply Tier 3 read-side wins** (`transactional-vfs.ts`, `vfs-batch-operations.ts`, `smart-context.ts`, `context-pack-service.ts`, `desktop-vfs-service.ts`, `cloud-fs-manager.ts`) — naive pass-throughs to `virtualFilesystem.readFile`, no VFS-team coordination required. **COMPLETED 2026-07-08**: All 23 Tier 3 candidates (#23-#45 minus the unrelated Tier-3 #44-#45 which are non-VFS read-side: virtual-filesystem-service.ts rollback ops and sandbox-filesystem-sync.ts bidirectional sync) applied across 6 files via two distinct audits:
  - **#23, #24 (transactional-vfs.ts)** — applied per Coordination Brief 2026-06-20 (pre-Phase-1 hands-off; verified unchanged in live tree).
  - **#25-#29 (vfs-batch-operations.ts)** — applied per Meta #2 cap audit 2026-06-20 + Meta-coalesce audit 2026-06-20. Per-operation `getVfsLimiter({ inputSize: ... }).runExclusive(...)` with concurrency caps (permits=1 for #25-#26 to preserve ordering; cap=10 for #28-#29 to bound event-loop saturation). `batchWrite` (#27) was rewritten to use `virtualFilesystem.applyBatchMutations(...)` (one shared SQLite transaction vs N separate ones; N fsyncs → 1 fsync; **~45-180ms/batch**).
  - **#30-#35 (smart-context.ts)** — applied 2026-07-08. #30 + #31 used **v2 form** (drop redundant external `listDirectory` call entirely; `collectAllFiles` already calls `listDirectory` internally; **~5-30ms/call on workspaces with >50 files**). #32-#35 used `Promise.all` + per-callback try/catch + post-resolution ordering where budget accumulators depended on sequence (#34).
  - **#36-#37 (context-pack-service.ts)** — applied 2026-07-08. #36 = `Promise.all([buildDirectoryTree, collectFiles])` for independent VFS reads (**~5-30ms/call**). #37 = `Promise.all(entries.map(...))` for per-entry processing inside `collectFilesRecursive` + `continue`→`return` substitution; array re-ordered post-call by `collectFiles.sort((a,b)=>a.path.localeCompare(b.path))` at L314-L315 (**~3-20ms/call**).
  - **#38-#41 (desktop-vfs-service.ts)** — applied 2026-07-08. #38 debounce handler per-path `readFile + syncToLocal`; #39 recursive `walk()` per-entry with `continue`→`return`; #40 `flushCoalescedChanges` per-path `syncToLocal` (Map wrapped with Array.from for .map); #41 `syncAllToLocal` boolean-reduce post-resolution counter accumulation (JS single-threaded `++` atomicity). All 4 preserve per-callback error isolation.
  - **#42-#43 (cloud-fs-manager.ts)** — applied 2026-07-08. #42 `syncToCloud` boolean-reduce post-resolution (file-or-null reduces to (synced, totalSize, successfulPaths) accumulator); #43 `getSnapshot` per-entry recursion with `files.push(...subFiles.files)` order-agnostic union.
  - **Combined savings**: **~60-260ms/call on workspaces with >50 files** (cumulative across all 18 newly-applied candidates; #23-#29 pre-applied via Meta #2 cap audit).
  - **Recursion-explosion caveat (bears repeating)**: #37 (context-pack), #39 (desktop-vfs walk), #43 (cloud-fs getSnapshot) all convert depth-first recursion to "all subdirs at this depth in parallel" — exponential fan-out in depth × width. For typical workspaces (3-5 dir depth, 10-50 entries/dir) this is fine. A workspace with 100+ directories could overwhelm the VFS layer's implicit concurrency limits — would benefit from a bounded-concurrency limiter (e.g. `p-limit`) in a follow-up PR. Flagged as future work, not blocking this apply pass.
  - **Audit-trail**: 24/24 vitest smart-context tests pass (assertions on import map + selected/post-sort content blocks). tsc clean for the 4 newly-touched files (`smart-context.ts`, `context-pack-service.ts`, `desktop-vfs-service.ts`, `cloud-fs-manager.ts` — file-mode `--noEmit --skipLibCheck` exits 0 on the lines I touched; pre-existing tsconfig-driven module-resolution errors unchanged). No new dependencies, no behavior change in the happy path.
4. ~~**Apply NEW-1 to remaining gateway routes**~~ — **COMPLETED 2026-07-07 (both phases)**: Phase 1 = NEW-1 followup covered Tier 4 #47-DELETE, #48, #49 applied (the NEW-1 anchor `sandbox/session/gateway.ts` POST is the 4th originally-applied site); #50 deliberately deferred (security rationale in followup section). Phase 2 = NEW-1 followup-b covered the Group-A Tier 4 sweep across 12 additional files / 13 sites that mirror the same NEW-1 pattern but were not in the original Tier 4 catalog (see "NEW-1 followup-b (2026-07-07)" section). Compound **~41-235ms/request** win across the **17 applied routes** (4 originally-applied + 13 Group-A), on top of the original POST anchor. Special case: NEW-A9 mfa/disable required a `let`-lift for the outer-catch scope — see followup-b section for the trick.
5. ~~**Apply NEW-3..NEW-4** — background session-file-tracking (NEW-3), FC-Gate telemetry post-yield (NEW-4). **NEW-2 retired 2026-07-07** via chain-on-ownerPromise refactor (see apply note below).~~ — **COMPLETED 2026-07-07**. NEW-3 applied via `void` prefix + outer-import `.catch` + closure-local `trackingReqId` snapshot at `route.ts` L922-L928 (mirror: tool-call-tracker at L1840+). NEW-4 applied via `setImmediate` at `vercel-ai-streaming.ts` L2128-L2139 — emit-only (the strictly-correct superset of the doc's "schedule both" recipe: keep `wireFCGateZeroCallsSteer` synchronous because its `detection.steer` return feeds downstream `fcGateSteer`). Tier 1 NEW-2..NEW-4 trio fully retired; cumulative NEW-1 + followup-b + followup-c + followup-d Tier 1 realized ROI ≈ **~150-395ms/request hot-path envelope** (composition: NEW-1 anchor ~15-40ms + Tier 4 #47-49 ~15-40ms × 3 + Group-A sweep ~2-15ms × 13 + NEW-C1 cache-miss ~60-320ms × 1 + NEW-C3 cold-start ~5-15ms × 1 + NEW-C2 health-dash ~1-5ms × 1 + NEW-2 ~30-150ms × 1 + NEW-3 ~10-25ms × 1 + NEW-4 ~2-5ms × 1).
6. ~~**Apply NEW-1 followup-c (3 sites in lib/mcp/ + lib/orchestra/)**~~ — **COMPLETED 2026-07-07** — NEW-C1 (`http-transport.ts` per-transport listTools fan-out, ∝N transports × 30-80ms each) applied via `Promise.all(Array.from(connectedTransports).map(...))`; NEW-C2 (`provider-fallback.ts` `getProviderHealth` per-provider isAvailable sequential) applied via `Promise.all(Object.entries(providerConfigs).map(...))` with per-provider try/catch isolation preserved; NEW-C3 (`architecture-integration.ts` cold-start fold-into-Phase-1-PA) applied via 2 `.then(()=>{})` discard slots added to the existing Phase-1 `Promise.all`. All three are tsc-clean. **NEW-C4** (`createModelWithFallback`) PERMANENTLY DEFERRED (by-design first-success-wins; `Promise.any` violates preferred-first, speculative-parallelism pollutes circuit-breaker state, wallclock win essentially zero). See "NEW-1 followup-c (2026-07-07) — Group-B sync-predicate + Promise.all sweep (lib/mcp/ + lib/orchestra/)" section above.
7. ~~**Group C audit pass** (thinker-with-files-gemini, separate stand-alone follow-up) — After Group-A (13 sites, applied) + reverted Group-B (`storage/upload` formData exception), Group C is the residual speculative set: most likely the Tier 5 rate-limit / OAuth / refresh / cache-miss sites (#51-#65) and Tier 6 sequential agent-team work (#69-#72). Each candidate has potential structural conflicts (idempotency lock contention on parallel OAuth refresh, OCC race resolution on parallel cache writes, etc.) that require dedicated thinking-pass review BEFORE any code apply. **Not applied this turn.** Surface as a separate `thinker-with-files-gemini` audit task — the structural-feasibility + total-ROI math needs to be vindicated before opening a NEW-1 followup-d apply phase.~~ — **COMPLETED 2026-07-07**. Audit verdict now lives in Status Audit's `### NEW-1 followup-d (2026-07-07)` section: **19 candidates adjudicated** = 16 APPLY (1 already applied = #61; 15 still ☐ pending) + 2 ⚠ DEFER (#62 priority fallback chain in `fetchProjectID`; #69 hierarchical plan step-to-step data deps). See next-pass entry #9 for the apply order.

8. **NEW-C5 / NEW-C6 (Group C clean mirrors applied 2026-07-07)** — Two Group C candidates passed the standing logic-the-file-reads inference (file-reads cannot fully adjudicate correctness, but per the audit each has safe structural shape):
   - **NEW-C5**: `web/app/api/filesystem/diffs/apply/gateway.ts` POST. Inverted-order `await request.json()` BEFORE `getUserIdFromRequest(request)` → `Promise.all([getUserIdFromRequest(request), request.json()])`. Safe because verifyAuth has no body dependency (only headers+cookies+JWT+DB-token-version via mutex-protected connection-shim). Trade-offs: (a) response-code asymmetry on malformed-body requests (401 vs 500), (b) ~1 extra DB token-version SELECT per malformed-body rejection path. Both bounded and documented in the inline 24-line WHY-comment.
   - **NEW-C6**: `web/app/api/user/profile/gateway.ts` GET. Sequential `await verifyAuth(request)` then `await initializeDatabase()` → `Promise.all([verifyAuth(request), initializeDatabase()])`. Safe because the db.ts `initializeDatabase` body is fully synchronous (no internal `await` between the `if (dbInstance)` check and the `dbInstance = db` assignment), making the singleton check-and-set atomic in a single JS event-loop tick. HMR caveat: dev hot-reload resets module variables and could re-open the window; dev-only risk. Documented in the inline 17-line WHY-comment. ~2-5ms/request on cold-cache; effectively 0 on warm-cache (single singleton return).
   - **Audit-trail note**: the thinker-with-files-gemini audit invoked on these 2 candidates returned the read_files tool output but no synthesis text was surfaced back to the parent agent, so the adjudication was made from file reads alone (same constraint the user wanted to avoid with the thinker pass). The applies stand against the file-reads evidence, but the thinker's explicit verdict is missing from the audit trail. If either apply regresses in the future, re-run the thinker audit on /opt/bing/web/app/api/filesystem/diffs/apply/gateway.ts + /opt/bing/web/app/api/user/profile/gateway.ts + /opt/bing/web/lib/database/db.ts to confirm or revise the applies.

9. **NEW-1 followup-d apply pass — 15 ☐ APPLY candidates from Group C verdict table** — order by structural-safety + dependency-graph to minimize reviewer-load and allow incremental rollback. **Phase-2 audit format with Apply site + Reviewer role columns is now the source of truth** (see Status Audit `### NEW-1 followup-d` section above). Apply order:
10. ~~**Prompt-orchestrator brainstorm — Tier 8 + companion followup doc** — the 9-step prompt-orchestrator brainstorm is now documented in **Tier 8** of this doc (in the Group C Phase-2 verdict-table format) with the 4 ☐ pending APPLY steps (1, 3, 7, 6) ranked by ROI and the 4 🟡 defer-ROI steps (4, 5, 8, 9) summarized with pointers to the companion doc **`docs/prompt-orchestrator-deferred-steps.md`** for full structural-conflict analysis + un-defer conditions. The 5 ☐ APPLY (1, 3, 6, 7) + 2 ✓ applied (2 in-scope-of-1) steps form Phase 1 (Foundation); the 4 deferred steps form Phase 2 (Resilience + Observability) + Phase 3 (Operator UX). Apply order for Phase 1 ☐ APPLY (by ROI): 1 ★★★★★ → 7 ★★★★★ → 6 ★★★★☆ → 3 ★★★★☆.~~ — **STATUS NOTE (not an action)**: Apply state as of 2026-07-08: 4 of 4 top-ROI steps applied (1, 3, 6, 7) — Phase 1 (Foundation) is COMPLETE. Step 2 ✓ applied in-scope-of-#1. Steps 4, 5, 8, 9 ⚠ deferred per docs/prompt-orchestrator-deferred-steps.md.
   1. ~~**auth/Platform cluster** (#51 + #52) — independent DB reads + symmetric encryption, both fully thread-safe. Approx **~7-23ms/auth-signup + ~2-8ms/call × 2**.~~ — **COMPLETED 2026-07-07**. #51 applied via `Promise.all([checkEmailExists, conditional-username-check])` with `Promise.resolve(false)` short-circuit for missing-username gate (preserves original conditional). #52 applied via `Promise.all([encryptApiKey(accessToken?), encryptApiKey(refreshToken?)])` with `Promise.resolve({ encrypted: null })` short-circuit (preserves destructure shape `{ accessTokenEncrypted, refreshTokenEncrypted }` so downstream INSERT still type-checks). Both verifies preserve the conditional guards and downstream types — see inline WHY-comment blocks (`auth-service.ts:L420-L457` + `auth0.ts:L163-L188`).
   2. ~~**provider dynamic-import cluster** (#54 + #55 + #56 + #57) — independent `enhanced-llm-service.ts` dynamic imports + setup helpers. Approx **~25-130ms × 2 cold-cache + ~15-70ms × 1 cold-start**.~~ — **COMPLETED 2026-07-07**. All 4 applied via `Promise.all([import(binary-check), import(provider).catch(() => null)])` + extended early-return guards (`if (!binaryPath || !providerMod)`) so the no-binary path is not regressed (provider-module ESM load gracefully bypassed via `.catch(() => null)`) + post-guard re-extract of `OpencodeV2Provider`/`createCliPiSession` from the consumed module slot (type-safe by TS narrowing post-guard). WHY-comment blocks at each apply site (`enhanced-llm-service.ts:L583-L593` for #54, `:L975-L985` for #55, `:L1947-L1975` for #56, `:L1815-L1833` for #57) kept to ~12-15 lines each with a `see docs/async-parallelization-opportunities.md#N` pointer for full structural-safety rationale. Reviewer pass observed one structural-fixup round-trip: the initial polish removed the destructured `OpencodeV2Provider` / `createCliPiSession` bindings without updating the downstream consumers (TS2304 errors at L1881 + L2042), corrected by re-extracting the bindings from the consumed module slot using TS post-guard narrowing (`const { OpencodeV2Provider } = opencodeCliMod;` and `const { createCliPiSession } = piCliMod;`). Tsc clean (`exit 0, no output`) after the fix-up.
   3. ~~**streaming dynamic-import cluster** (#58 + #59) — Vercel-AI init + 429 retry path.~~ — **COMPLETED 2026-07-07**. #58 applied via `Promise.all([import(vfs-mcp-tools).catch(() => null), import(shared-agent-context).catch(() => null)])` lifting the vfs-mcp-tools.normalizeToolArgs + shared-agent-context.validateToolArgs imports from the SELF-HEALING + VALIDATE try-catches (each re-shaped with `if (fn)` guard) — independence-preserving best-effort semantics retained. #59 applied via `Promise.all([import(model-ranker).catch(() => null), import(circuit-breaker).catch(() => null)])` on the 429-error-chunk path — both recordRateLimitError + circuitBreakerManager.recordFailure calls then guarded with `if (fn)`. First-apply attempt uncovered a brace-balance bug (Site 1 NEW opened `if (validateToolArgs) {` without closing); corrected via restore-from-backup + LARGER Site 1 OLD extending through L2930 + re-indent-style inner content +2 spaces inside the new if-block. Approx **~2-10ms/stream + ~2-10ms/retry**.

   10. ~~**Prompt-orchestrator Tier 8 step 6** — `web/lib/orchestra/stateful-agent/checkpointer/index.ts:235-275` (per-checkpoint `changes.patch` + `metadata.json`).~~ — **COMPLETED 2026-07-08**. Applied via str_replace (12-line WHY-comment + hoisted `ts` const + `ts` field alias in `snapshotMeta` + preserved `timestamp: ts` for forward-compat). tsc clean for target file. Locked-in by 7-test unit test suite at `lib/orchestra/stateful-agent/checkpointer/__tests__/metadata-schema.test.ts` (alias contract + full schema surface + idempotent re-snapshot + inner-MemoryCheckpointer put() semantics + `metadata === undefined` fallback + `createCheckpointer` factory composition). 7/7 vitest tests pass.
   4. ~~**antigravity DB** (#60) — bundler-isolated dynamic imports + preserves webpack defeat for `better-sqlite3`. **Reviewer role: providers team + antigravity DB owner (cross-team)**.~~ — **COMPLETED 2026-07-07**. Both sites in `lib/providers/llm-providers.ts` (generateAntigravityResponse + streamAntigravityResponse) folded into `Promise.all([import('@/lib/providers/antigravity-provider'), import(<bundler-defeat-form>)])` — Site A retains the dynamic-path-string concat `import('@/lib' + '/database/antigravity-accounts')`; Site B retains the `/* webpackIgnore: true */` inline comment. `Promise.all` preserves bundler-isolation (Promise.all rejection semantics are identical to sequential awaits for webpack's static analyzer). Reviewer Minor 1 polish: added `typeof window` guard to Site A (defense-in-depth parity with Site B). Approx **~5-30ms/cold-cache**.
   5. ~~**double desktop-auth-bypass import** (#53) — two consecutive `await import('./desktop-auth-bypass')` at the same middleware site. **Reviewer role: middleware / desktop-auth owner**.~~ — **COMPLETED 2026-07-08**. Single destructured import `const { shouldBypassAuth, getDesktopUserContext } = await import('./desktop-auth-bypass')` at `enhanced-middleware.ts:L539` — `getDesktopUserContext` hoisted out of the inner `if (shouldBypassAuth(...))` branch (function ref, no side-effect, ESM caches the module after first import so the prior L535 await was a redundant microtask hop). 7-line WHY-comment at `enhanced-middleware.ts:L531-L537`. Code-reviewer APPROVED. Approx **~1-3ms/middleware-hit**.
   6. ~~**token refresh fan-out** (#63) — `getUserConnections` for 11 OAuth providers via `Promise.allSettled`. **Reviewer role: OAuth refresh team / Platform**.~~ — **COMPLETED 2026-07-08**. Sequential for-of over 11 providers folded into `await Promise.allSettled(providers.map(async (provider) => { ... }))` at `token-refresh.ts:L261-L281` (the apply = Promise.allSettled block at L271-L281 + 10-line WHY-comment at L261-L270; function `getConnectionsNeedingRefresh` starts at L242) — `allSettled` preserves the original try/catch semantics (a single provider's failure no longer aborts the entire token-refresh sweep, matching the original silent-skip behavior). Inner for-of over connections per provider preserved (per-connection logic is sync, no async to parallelize). Push order to `results` is non-deterministic (parallel completion order) — verified order-agnostic: no production caller exists (only tests reference the function). Code-reviewer APPROVED. Approx **~30-150ms/token-refresh**.
   5. **token refresh fan-out** (#63) — `getUserConnections` for 11 OAuth providers via `Promise.allSettled`. **Distinction from invalidated #64**: read-only across independent providers, no shared state mutation. Approx **~30-150ms/token-refresh**.
   6. ~~**observability** (#65) — decoupled metric counters. Approx negligible wallclock but ~720B-2KB/req telemetry-overhead-recovery.~~ — **STATUS NOTE (2026-07-08, not an action)**: audit verified the doc's recipe is invalid. Metric calls at L2167+L2173 are sync (`incrementOrchestrationFallback(): number` + `recordOrchestrationFallback(): void`); `Promise.all` over sync calls adds microtask overhead without real I/O savings (in-memory counter + in-memory chat-metrics update, no I/O to overlap). The bug-40 orchestrator-fallback test does NOT depend on metric-call ordering (assertions cover per-session counter monotonicity + sorted snapshots + `tagResultDegraded` direct-unit-tests, not metric-vs-counter call order). Cite drift ~250 lines (L1921 → L2167). **Verified-no-op — no apply.** Updates the Group C Phase-2 verdict table row for #65 to `✓ verified-no-op (2026-07-08)` with full audit rationale.
   7. ~~**agent-context fan-out** (#67) — `injectContext` over static history via `Promise.all(map(...))`. Approx **~5-25ms/req depending on history depth**.~~ — **STATUS NOTE (2026-07-08, not an action)**: audit verified the doc's recipe is structurally unsafe. `injectContext` (`opencode-session-manager.ts:340-366`) POSTs to `${this.baseUrl}/session/${sessionId}/message` with `{ noReply: true, parts: [...] }` — NO client-side ordering metadata. The OpenCode backend stores `noReply` messages by **arrival order** and `getMessages(sessionId, limit)` reads them back in that order with no client-side reconciliation. Parallelizing the `for…of` to `Promise.all(history.map(...))` would race concurrent POSTs through backend network jitter, scrambling the chronological chat history — CRITICAL risk of corrupting the session context the LLM reads on subsequent turns. Cite drift ~250 lines (L2373 → L2615). **Verified-no-op — no apply.** Structural fix requires OpenCode backend cooperation (add `timestamp`/`orderIndex` to the POST body so the client can reconstruct order on readback) — out of scope for client-side audit.
   8. ~~**CREWAI listener fan-out** (#72) — MUST use **`Promise.allSettled`** (not `Promise.all`) — SHAPE difference from the rest of the apply list; failing to use allSettled will crash the CrewAI task loop on single-listener rejection. Listen carefully to reviewer on this one.~~ — **STATUS NOTE (2026-07-08, not an action)**: applied successfully via str_replace at `web/lib/crewai/crew/events.ts:L209-L228`. Sequential `for…of` `await listener(event)` inside `async emit` converted to `await Promise.allSettled(listeners.map(async (listener) => { try { await listener(event); } catch (error) { console.error('Event listener error:', error); } }))`; per-listener try/catch preserved verbatim (the `console.error` failure-reporting contract is unchanged). **220→231 lines**, +11 = 9-line WHY-comment + Promise.allSettled wrapper + indented async arrow inside `.map`. **tsc clean** for `lib/crewai/crew/events.ts`; structured-diff verified (the diff vs `/tmp/crewai-events.bak.ts` shows ONLY the expected +11 lines — no accidental edits elsewhere in the file). Updates the Group C Phase-2 verdict table row for #72 to `✓ applied (2026-07-08)`.
   9. ~~**agent-team voting + competitive** (#70 + #71) — independent voting/solution-creation fan-out across agent roles. Approx **~50-200ms + ~80-300ms per team-call**.~~ — **COMPLETED 2026-07-07**. Both applied via `Promise.all(agents.map(safeRun))` + per-agent try/catch returning `null` + post-resolve sequential push into `solutions` + `contributions` (preserves `solutions[index] ↔ agent-index` correspondence required by the judge's structured prompt in competitive mode) + centralized batched `updateProgress('all', ...)` callback (drops the per-agent racing progress emits). Multi-Agent-team read-back verified the structural-safety properties enumerated in the inline WHY-comment blocks at `agent-team.ts:L611-L664` (#70) and `:L722-L775` (#71). Reviewer-flagged logger-polish applied (`logger.warn(msg, { error })` 2-arg convention matching the file's existing L66/L270/L284/L299/L816 pattern).

   After all 15 apply, the NEW-1 followup-d envelope realizes **~235-1120ms/request hot-path envelope** (auth/Platform cluster dominates on cold-cache auth path; provider cluster dominates on enhanced-llm-service init). The 2 DEFER rows (#62 #69) remain permanent deferrals; their structural-conflict rationales are pre-validated in the Status Audit section and should NOT be re-litigated.

---

**Legend:** `#` = file:line | `Est.` = estimated latency savings per invocation | `∝N` = scales with N items

---

## Tier 1 — Per-Request Bottlenecks (affect every chat/LLM request)

These are the highest-ROI changes: they run on every user request and save meaningful latency with simple Promise.all refactors.

### Chat Route Setup Phase (`/opt/bing/web/app/api/chat/route.ts`)

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 1 | 999 | `applyPromptModifiers` runs **after** the 4-way `Promise.all` at line 927 but depends on **nothing** from it (only `body.responseDepth`, `body.expertiseLevel`, etc. — available from request body) | **50-300ms** | Add as 5th parallel branch inside the existing `Promise.all` |
| 2 | 883 → 902 | `resolveFilesystemOwner(request)` then `classifyRequest(messages, attachedFilesystemFiles)` — zero data dependency between them | **5-20ms** | `Promise.all([resolveFilesystemOwner, classifyRequest])` |
| 3 | 833 → 883 | Session resolution (conv ID lookup / generate) then `resolveFilesystemOwner` — no cross-dependency | **5-20ms** | `Promise.all([sessionResolve, resolveFilesystemOwner])` |
| 4 | 1016 | `detectRequestType(processedMessages)` runs after Promise.all but uses only `processedMessages` (available from body) | **1-5ms** | Add into the `Promise.all` |

### Unified Agent Service Entry (`/opt/bing/web/lib/orchestra/unified-agent-service.ts`)

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 5 | 1316-1454 | 5 independent setup ops: auto-inject powers import, env probe, re-context supplement, `resolveDynamicDefaults`, metrics recording — sequenced one after another | **50-200ms** | Bundle into `Promise.all` |
| 6 | 1444 → 1455 | `resolveDynamicDefaults()` then `determineMode()` — `determineMode` only reads `config.mode` from the input, not dynamic defaults | **50-100ms** | `Promise.all` |
| 7 | 3774 | `buildWorkspaceSnapshot()` runs **inside** provider fallback `for` loop — called N times (one per provider attempt) but only depends on `userId` which doesn't change | **50-200ms per extra provider** (∝N) | Hoist outside loop, compute once before the `for` |
| 8 | 3516, 3541, 3557 | circuit-breaker `import()` → model-ranker `import()` → `runRetrievalPipeline()` — all three are independent | **10-200ms** | `Promise.all` |
| 9 | 4090-4187 | Telemetry (fire-and-forget, `.catch`), RAG ingestion (awaited), Mem0 storage (`.then`/`.catch`) sequenced — RAG ingestion blocks Mem0 from even being scheduled | **blocks stream return** | `Promise.allSettled` on all three |

### Tool Assembly (MCP Tools — runs before every LLM call)

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 10 | `architecture-integration.ts:630-903` | **10 independent I/O ops**:
1. `refreshMCPorterToolsCache()`
2. `getArcadeToolDefinitions()`
3. `import('./provider-advanced-tools')`
4. `getComposioMCPTools(userId)`
5. `import('./vfs-mcp-tools')`
6. `import('../bash/bash-tool')`
7. `import('../virtual-filesystem/scope-utils')`
8. `getRemoteMCPTools()`
9. `import('../powers/mem0-power')`
10. `buildMem0Tools(...)` | **tens to hundreds of ms** | `Promise.all([...10 ops])` |
| 11 | `architecture-integration.ts:397-417` | HTTP MCP server connections in `for` loop — each waits for prior | **∝N servers** | `Promise.all(httpServers.map(...))` |

### Provider Loop Re-Imports

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 12 | `unified-agent-service.ts:5627-5660` | `circuit-breaker` and `model-ranker` modules `import()`ed **every iteration** of the provider fallback `for` loop | **∝N providers** | Hoist both imports before the `for` loop |
| 13 | `unified-agent-service.ts:3445, 3516, 3541, 3758, 3854` | 5 `await import()` calls scattered across `runV1ApiWithTools` body instead of batched at top | **5-15ms** | `Promise.all([5 imports])` at function top |

---

## Tier 2 — Startup / Initialization (affects boot, warmup, cold start)

### Provider Initialization

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 14 | `llm-providers.ts:1525-1721` | **19 sequential provider `import()` + `new` calls** (OpenAI, Anthropic, Google, Cohere, Together, Replicate, Portkey, Mistral, zen, Vercel, LiveKit, ChatAnywhere, NVIDIA, Ninerouter, Groq, DeepInfra, Fireworks, Cloudflare, Azure) — all independent, each waits for prior | **Sum → max of 19** | Collect all into `Promise.all` |
| 15 | `provider-keys.ts:192-210` | **14 sequential IndexedDB `.get()` calls** for API keys in `getStoredProviderApiKeys()` | **5-20ms each → 5-20ms total** | `Promise.allSettled(knownProviders.map(...))` |
| 16 | `model-ranker.ts:444-450` | `getModelPerformance` then `getModelToolStats` — same pattern already parallelized in sibling method `refreshModelTelemetryCache()` (line 56) | **~10ms** | `Promise.all` |

### Tool Bootstrap

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 17 | `bootstrap.ts:102-378` | **22 sequential tool registration phases** (builtins, CAS, broker, workspace images, orchestrator, VFS sync, control plane, project analysis, workspace graph, runtime broker, MCP, Composio, Tauri, desktop automation, sandbox, nullclaw, OAuth, events, schedule, Arcade, gateway, Mem0) — most are independent after core infra initialized | **Sum → max of 22** | Group by dependency level: L0 (builtins), L1 `Promise.all` (CAS + broker), L2 `Promise.all` (side-effect imports), L3 (control plane), L4 `Promise.allSettled` (all tool registrations) |

### API Route Initialization

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 18 | `health/route.ts:31,36,45,66,78` | 5 sequential `import()` calls for health metrics modules | **~4× module resolution** | `Promise.all([5 imports])` |
| 19 | `memory/health/route.ts:32-120` | 4 sequential component health checks (vector store, embedding cache, symbol counts, metrics) — all independent | **~3× check time** | `Promise.allSettled` |
| 20 | `sandbox/providers/index.ts:819-836` | Sequential provider initialization in `getAvailableProviders()` loop (~30 providers) | **∝N providers** | `Promise.allSettled(Array.from(registry)...)` |

### Agent Team Initialization

| # | Lines | Pattern | Est. | Fix |
|---|-------|---------|------|-----|
| 21 | `stateful-agent.ts:895-898` | 4 sequential `import()` calls in `runEditingPhase` (ai, sandbox-tools, router, capabilities) | **~30ms** | `Promise.all` |
| 22 | `stateful-agent.ts:457,474` | `recordAgencyExecution` then `triggerSkillBootstrap` — both non-critical, independent | **50-100ms** | `Promise.all` |

---

## Tier 3 — VFS / Batch File Operations (affects file-heavy requests)

### File Reads and Writes

| # | File | Lines | Pattern | Est. | Status |
|---|------|-------|---------|------|:------:|
| 23 | `transactional-vfs.ts` | 618-627 | Sequential file reads in `takeSnapshot` | ∝N files | **✓ applied (Coordination Brief 2026-06-20)** — `Promise.all` over `virtualFilesystem.readFile` inside `takeSnapshot` + per-file try/catch preserves bound-error semantics. Pre-Phase-1 hands-off; confirmed via live-tree parse. |
| 24 | `transactional-vfs.ts` | 579-593 | Sequential file writes/deletes in `rollback()` | ∝N files | **✓ applied (Coordination Brief 2026-06-20)** — `Promise.all` over the rollback write/delete pair with per-file try/catch; rollback order-loss is acceptable (origin checkpoint state is rebuilt from git history not from the rollback's intermediate writes). |
| 25 | `vfs-batch-operations.ts` | 239-260 | Sequential ops in `execute()` despite "batch" name | ∝N files | **✓ applied (Meta #2 cap audit 2026-06-20)** — `Promise.all(this._operations.map(op => limit25.runExclusive(async () => { switch(op.type) { writeFile | deletePath | readFile }; return {success, file} | {success: false, error} })))` at `vfs-batch-operations.ts:L246-L266` with 5-line "Meta #2 cap" WHY-comment at L240-L244. Per-operation `limit25.runExclusive` with `inputSize: 1` (permits=1) preserves implicit operation ordering (e.g. create then read same path); Promise.all preserves input order in the results array. |
| 26 | `vfs-batch-operations.ts` | 334-362 | Sequential ops in `batchWriteIncremental()` | ∝N files | **✓ applied (Meta #2 cap audit 2026-06-20)** — `await Promise.allSettled(operations.map((op, index) => limit26.runExclusive(async () => { ... })))` at L349-L370 with 6-line "Meta #2 cap" WHY-comment at L343-L348; per-operation lock preserves implicit ordering; `allSettled` (not `all`) lets individual failures skip without aborting the batch. `processed[index]` is index-tracked directly from the `map((op, index) => ...)` signature so post-resolve counters/summaries are position-correct. |
| 27 | `vfs-batch-operations.ts` | 384-405 | Sequential ops in `batchWrite()` | ∝N files | **✓ applied (Meta-coalesce audit 2026-06-20)** — rewrote `batchWrite` to use `virtualFilesystem.applyBatchMutations(...)` instead of N separate `writeFile`/`deletePath` calls. The audit's Meta-coalesce observation: N concurrent `writeFile`/`deletePath` calls previously triggered N separate `persistWorkspace` calls, each of which wraps everything in a synchronous `db.transaction(...)` (better-sqlite3 blocks the event loop). `Promise.all` over 10 ops therefore serialized through the event-loop mutex, yielding ZERO real wallclock parallelism. The new `applyBatchMutations` path loads the workspace ONCE, applies all mutations to in-memory `workspace.files` Map, then runs ONE shared `persistWorkspace` (single SQLite transaction); N fsyncs collapse into 1 fsync. **~45-180ms saved per batch**. 18-line "NEW Meta-coalesce" WHY-comment at L394-L411 documents the rationale + backward-compat preserves the `BatchOperationResult` shape + partial-success semantics preserved via `allSettled`. |
| 28 | `vfs-batch-operations.ts` | 475-531 | Sequential ops in `searchAndReplace()` | ∝N files | **✓ applied (Meta #2 cap audit 2026-06-20)** — `await Promise.allSettled(files.map(file => limit28.runExclusive(async () => { includes/excludes filter + filesScanned++; readFile + regex replace or indexOf + while-loop for replaceAll })))` at L520-L558 with 1-line "Meta #2 cap" WHY-comment at L518-L519 + per-file try/catch. Per-operation lock with `inputSize: files.length` (default cap=10) bounds concurrency + prevents event-loop saturation. `modified.push({path, status, replacements})` is order-agnostic (downstream totals are aggregate). |
| 29 | `vfs-batch-operations.ts` | 556-573 | Sequential ops in `batchCopy()` | ∝N files | **✓ applied (Meta #2 cap audit 2026-06-20)** — `await Promise.all(files.map(file => limit29.runExclusive(async () => { readFile + writeFile; return {status, processed} })))` at L586-L595 with 1-line "Meta #2 cap" WHY-comment at L584-L585 + per-file try/catch. Per-operation lock + Promise.all preserves input order in `opResults29`; downstream `(successful, failed)` counts are aggregate. |

### Directory Traversal / Context Building

| # | File | Lines | Pattern | Est. | Status |
|---|------|-------|---------|------|:------:|
| 30 | `smart-context.ts` | 976-977 | `listDirectory` then `collectAllFiles` — both do independent recursive traversals | Walk time | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L976-L987` (cite drift: doc listed L976-977, actual file is `lib/virtual-filesystem/smart-context.ts` per path-correction, not the bare `lib/smart-context.ts`); **v2 form applied** (the v1 `Promise.all` form was rejected by code-reviewer for keeping `listing` as dead code): dropped the redundant external `listDirectory` call entirely. `collectAllFiles` already calls `listDirectory` internally at L1279 — the external call was wasted I/O. 11-line WHY-comment at L976-L986 cites the structural-safety rationale (collectAllFiles-internal-listDirectory + listing-unused-downstream + walk-time savings scale with workspace size). **~5-30ms/request on workspaces with >50 files**. No new dependencies, no behavior change in the happy path. tsc clean for target file (file-mode tsc exit 0); 71/71 vitest tests pass. |
| 31 | `smart-context.ts` | 916-917 | Same redundant traversal in `captureFullSnapshot` | Walk time | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L916-L934` (twin of #30 in `generateSmartContext`); **same v2 form applied**: dropped the redundant external `listDirectory` call in `captureFullSnapshot` (function body L913-L934). 8-line WHY-comment at L916-L923 cites the structural-safety rationale (collectAllFiles-internal-listDirectory + listing-unused-downstream + same wallclock savings as #30). **~5-30ms/call on workspaces with >50 files**. Function contract preserved (returns `Map<string, string>` populated from all VFS file contents). Try/catch boundary unchanged. File: 2539→2546 lines (+7 net = 8-line comment + 1-line code added; 1-line `const listing = await...` removed). tsc clean for target file (file-mode tsc exit 0); 71/71 vitest tests pass. |
| 32 | `smart-context.ts` | 1051-1063 | Sequential file reads for import map extraction | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L1076-L1097` (the apply = `Promise.all(filesToScanForImports.map(async (file) => { ... }))` block at L1083-L1096 + 7-line WHY-comment at L1076-L1082; filesToScanForImports cap at L1069-L1074 with the 20-file-vs-30-code-files heuristic). Per-callback try/catch preserves original "skip on error" semantics (a single unreadable file does not abort the import map — `importMap` + `reverseImportMap` simply skip the unreadable entries). Each `Map.set` is keyed by `file.path.toLowerCase()` so push order is irrelevant to correctness. ∝N is bounded 1-30 (the 30-code-file cap). **~3-12ms/call on a typical 30-file scan**. tsc clean for target file; 71/71 vitest smart-context tests pass. |
| 33 | `smart-context.ts` | 1149-1162 | Sequential explicit file reads | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L1183-L1206` (the apply = `Promise.all(scored.filter(score >= EXPLICIT).map(async (scoredFile) => { ... }))` block at L1191-L1205 + 4-line WHY-comment at L1183-L1190). The upfront `scored.filter(score >= EXPLICIT)` preserves the original explicit-only branch semantics (vs. the scored-file branch below at #34). Truncation + size accounting + `selected.push` done inside the same callback so post-resolution behavior is identical. The post-resolve `selected.sort((a, b) => b.score.score - a.score.score)` at L1212 is a defensive no-op for current data flow (Promise.all preserves registration order; input is already score-desc sorted). ∝N explicit files per call — typically 1-10. **~2-8ms/call on typical explicit-file set**. tsc clean for target file; 71/71 vitest smart-context tests pass. |
| 34 | `smart-context.ts` | 1165-1179 | Sequential scored file reads | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L1215-L1244` (the apply = `Promise.all(scored.filter(score < EXPLICIT).map(async (scoredFile, idx) => { return {idx, scoredFile, file, size} }))` block at L1224-L1235 + post-resolve sequential walk at L1237-L1244 + 10-line WHY-comment at L1215-L1223). **Critical structural-safety detail**: the original sequential accumulator's budget check (`if (currentSize + size <= safeEffectiveMaxSize)`) is order-dependent (sequential `currentSize += size`). The index-tracking design re-creates THAT ORDER EXACTLY via `idx` preserved through `Promise.all` → sort by idx → sequential walk with `currentSize += result.size` + push only if within budget. ∝N scored files per call — typical 10-50. **~5-30ms/call on typical scored set** (the largest single-codepath win in smart-context). **Caveat**: `getCachedFile` internally caches, so duplicate-path reads from #33 above are no-ops — these reads pay I/O only on cache miss. tsc clean for target file; 71/71 vitest smart-context tests pass. |
| 35 | `smart-context.ts` | 899-906 | Sequential reads in `captureFileSnapshot` | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/smart-context.ts:L899-L915` (the apply = `Promise.all(filePaths.map(async (path) => { try { ... } catch {} }))` block at L905-L913 + 6-line WHY-comment at L899-L904). Each path independent (read-only VFS call, no cross-file mutation, separate `snapshot.set(path, ...)` entry — Map insertion is order-agnostic). Per-callback try/catch preserves original "skip on error" semantics (a single missing/unreadable file does not abort the snapshot — the missing entry simply doesn't make it into the Map). ∝N paths per call — typical 5-50. **~3-15ms/call on typical capture set**. tsc clean for target file; 71/71 vitest smart-context tests pass. |
| 36 | `context-pack-service.ts` | 145, 148 | `buildDirectoryTree` then `collectFiles` — both traverse same tree | Walk time | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/context-pack-service.ts:L145-L156` (the apply = `Promise.all([this.buildDirectoryTree(...), this.collectFiles(...)])` block at L153-L156 + 8-line WHY-comment at L145-L152). Both calls read independent VFS state (no cross-mutation, no shared intermediate state); `collectFiles` mutates the same `warnings` array (Promise.all shares the same mutation semantics as the original sequential calls). Rejection: `Promise.all` rejects with first rejection (matches original sequential failure mode). **~5-30ms/call on typical workspace** (10-200 files). tsc clean for target file (file-mode exit 0). |
| 37 | `context-pack-service.ts` | 350-391 | Sequential file reads in `collectFilesRecursive` | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/context-pack-service.ts:L341-L410` (the apply = `await Promise.all(filtered.map(async (entry) => { ... }))` block at L350-L410 + 9-line WHY-comment at L342-L350; `continue` → `return` substitution correct). Each entry independent (separate `readFile` for files or separate recursive `collectFilesRecursive` for subdirs). The `files` array is sorted by path at `collectFiles` L314-L315 so `push` order is order-agnostic. `warnings` are human-readable diagnostics whose order is already non-deterministic across runs (each run traverses VFS with different I/O races); parallelizing only makes it more so. Subdirectory recursion becomes "all subdirs in parallel" instead of depth-first — the consumer's outer sort at L314-L315 makes this order-agnostic. **Caveat**: unbounded concurrent `readFile` calls on very large workspaces (100+ directories); same caveat already flagged on smart-context #37 + desktop-vfs #39 + cloud-fs #43 in case future audits need a bounded-concurrency limiter (out of scope here). **~3-20ms/call on typical workspace** (10-50 entries per directory). tsc clean for target file. |

### Desktop VFS Sync

| # | File | Lines | Pattern | Est. | Status |
|---|------|-------|---------|------|:------:|
| 38 | `desktop-vfs-service.ts` | 185-189 | Sequential read+sync per path in debounce handler | ∝N paths | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/desktop-vfs-service.ts:L194-L210` (the apply = `await Promise.all(Array.from(sessionPaths).map(async (path) => { try { readFile + syncToLocal } catch { log.warn } }))` block at L201-L209 + 7-line WHY-comment at L194-L200). Each path is independent (read-only `vfs.readFile` + `syncToLocal`); per-entry try/catch + log.warn preserves original "best-effort" semantics. `Array.from(sessionPaths)` needed because Set iterators cannot be passed directly to `.map`. **~2-8ms/call per debounced session** (typical 5-20 paths). tsc clean for target file (file-mode regex no errors in lines I touched; pre-existing tsconfig-driven module-resolution errors unchanged). |
| 39 | `desktop-vfs-service.ts` | 563-566 | Sequential read+write per file in `importFromLocal` | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/desktop-vfs-service.ts:L566-L599` (the apply = `await Promise.all(entries.map(async (entry) => { if (symlink) return; if (dir) await walk(fullPath); else { fs.readFile + vfs.writeFile + syncedHashes.set + imported++ } }))` block at L577-L598 + 11-line WHY-comment at L566-L576). Each entry is independent (separate `lstat` + `readFile`/`writeFile` — or recursive `walk` for subdirs); `continue` → `return` is semantically identical (the .map callback's `return` exits the current entry's processing). `imported++` is JS-single-threaded atomic; final count matches sequential baseline. **`syncedHashes.set(relativePath, ...)` keys by path → order-agnostic Map insertion**. **Caveat**: recursion-explosion fan-out shared by `#37 (context-pack)`, `#43 (cloud-fs)`, `#39 here` is bounded by typical workspace sizes (<500 directories); flag if VFS concurrency limits bite. **~5-30ms/call on typical import** (10-100 entries per directory). |
| 40 | `desktop-vfs-service.ts` | 113-120 | Sequential coalesced change flushes | ∝N paths | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/desktop-vfs-service.ts:L113-L129` (the apply = `await Promise.all(Array.from(changes).map(async ([path, { content }]) => { try { syncToLocal + log.debug } catch { log.warn } }))` block at L120-L128 + 7-line WHY-comment at L113-L119). Each path independent. `Array.from(changes)` needed because Map iterators cannot be passed directly. **~3-15ms/call per flush** (typical 5-50 paths). |
| 41 | `desktop-vfs-service.ts` | 431-438 | Sequential full-sync writes in `syncAllToLocal` | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/desktop-vfs-service.ts:L448-L468` (the apply = `const syncResults41 = await Promise.all(snapshot.files.map(async (file) => { try { syncToLocal; return true; } catch { return false; } })); for (const ok of syncResults41) { if (ok) synced++; else errors++; }` block at L455-L468 + 6-line WHY-comment at L449-L454). Counters are accumulated sequentially AFTER Promise.all resolves — JS `++` is single-threaded atomic, final values match sequential baseline; the boolean-reduce loop iterates the resolved booleans in registration order. **~10-60ms/call per full sync** (typical 50-500 files). |
| 42 | `cloud-fs-manager.ts` | 368-375 | Sequential cloud writes in `syncToCloud` | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/cloud-fs-manager.ts:L376-L400` (the apply = `const syncResults42 = await Promise.all(files.map(async (file) => { try { writeFile; return result.success ? file : null; } catch { return null; } })); for (const written) { if (written) { synced++; totalSize += written.content.length; successfulPaths.push(written.path) } }` block at L384-L400 + 9-line WHY-comment at L376-L383). `written` is the original file reference (returned from .map via `result.success ? file : null`) → `written.content.length` reads original content, no mutation risk. Counters + `successfulPaths` accumulated sequentially post-resolution. The downstream cache-invalidation loop at L406-L414 consumes `successfulPaths` AFTER Promise.all resolves, so cache cleanup is unaffected. **~10-50ms/call per cloud sync** (typical 20-500 files per sync). |
| 43 | `cloud-fs-manager.ts` | 226-251 | Sequential recursive snapshot reads | ∝N files | **✓ applied (2026-07-08)** — NEW-1 followup-d at `lib/virtual-filesystem/cloud-fs-manager.ts:L228-L258` (the apply = `await Promise.all(entries.map(async (entry) => { if (isDir) await getSnapshot + files.push(...subFiles.files); else readFile + files.push }))` block at L236-L258 + 7-line WHY-comment at L228-L234). `files.push(...subFiles.files)` is order-agnostic (only the union matters; consumers don't depend on snapshot iteration order). Recursive `getSnapshot` calls become "all subdirs at this depth in parallel" instead of depth-first; result is the same union of files. **Caveat**: same recursion-explosion fan-out as #39. **~5-30ms/call per typical snapshot** (10-200 entries per directory). |

### VFS Service

| # | File | Lines | Pattern | Est. |
|---|------|-------|---------|------|
| 44 | `virtual-filesystem-service.ts` | 1663-1675 | Sequential rollback operations | ∝N ops |
| 45 | `sandbox-filesystem-sync.ts` | 480-481 | Sequential bidirectional sync | ~50ms |

---

## Tier 4 — Auth + Body Parse (common API route pattern)

A recurring pattern across multiple route handlers: `verifyAuth(req)` and `req.json()` are independent but run sequentially.

| # | File | Lines | Independent Ops | Est. | Status |
|---|------|-------|-----------------|------|--------|
| 46 | `tts/route.ts` | 13, 16 | `voiceServerManager.startKittenServer()` + `auth0.getSession()` | Server start time | ✗ different shape — `voiceServerManager` + `auth0.getSession` is server-start + auth0, NOT a verifyAuth-then-async-overlap pattern; not in NEW-1 / NEW-1 followup scope, unvalidated for the verifyAuth pattern |
| 47 | `web/app/api/sandbox/session/gateway.ts` | 18, 38 (POST); 147, 157 (DELETE) | `verifyAuth(req)` + `req.json()` | Body parse time | ✓ applied — POST anchor (NEW-1) + DELETE sibling (NEW-1 followup 2026-07-07). Path corrected from `sandbox/session/gateway.ts` (catalog typo) to `app/api/sandbox/session/gateway.ts` per Status Audit cite-correction. |
| 48 | `web/app/api/sandbox/daemon/gateway.ts` | 32, 48 | `verifyAuth(req)` + `req.json()` | Body parse time | ✓ applied — NEW-1 followup (2026-07-07) |
| 49 | `web/app/api/antigravity/login/route.ts` | 16, 24 | `verifyAuth(req)` + `getAntigravityOAuthUrl(...)` | OAuth URL time | ✓ applied — NEW-1 followup (2026-07-07); see followup table for partner-shape note (URL is `getAntigravityOAuthUrl`, not `req.json()`) |
| 50 | `web/app/api/antigravity/callback/route.ts` | 18, 37 | `verifyAuth(req)` + `exchangeCodeForTokens(code, redirectUri)` | Token exchange time | ⚠ deliberately deferred — external mutating RPC burns single-use OAuth `code`; security rationale in NEW-1 followup (2026-07-07) |

---

## Tier 5 — Auth / Telemetry / Middleware

| # | File | Lines | Pattern | Fix |
|---|------|-------|---------|-----|
| 51 | `auth-service.ts` | 421-432 | Sequential email + username existence checks in `register()` | `Promise.all` |
| 52 | `auth0.ts` | 163-169 | Sequential `encryptApiKey` for access token then refresh token | `Promise.all` |
| 53 | `enhanced-middleware.ts` | 531-542 | Same module (`desktop-auth-bypass`) imported **twice** consecutively (L533 + L535) | Single destructured import (collapse + hoist out of inner if) |
| 54 | `enhanced-llm-service.ts` | 583-593 | Sequential imports of `smart-context` + `session-file-tracker` in `chat()` contextPack path | `Promise.all([import(a), import(b).catch(()=>null)])` |
| 55 | `enhanced-llm-service.ts` | 975-985 | Sequential imports of `smart-context` + `session-file-tracker` in `stream()` contextPack path (twin of #54) | `Promise.all([import(a), import(b).catch(()=>null)])` |
| 56 | `enhanced-llm-service.ts` | 1947-1975 | Sequential `find-pi-binary` + `pi-cli-session` dynamic-imports in pi CLI provider path | `Promise.all([import(a), import(b).catch(()=>null)])` |
| 57 | `enhanced-llm-service.ts` | 1815-1833 | Sequential `find-opencode-binary` + `opencode-cli` dynamic-imports in opencode CLI provider path | `Promise.all([import(a), import(b).catch(()=>null)])` |
| 58 | `vercel-ai-streaming.ts` | 2868-L2899 | Sequential imports of `normalizeToolArgs` + `validateToolArgs` (cite-drift from user-given L2478-L2489; actual site L2865-L2930 in 4036-line file) | `Promise.all` w/ per-import `.catch(() => null)` |
| 59 | `vercel-ai-streaming.ts` | 3254-L3290 | Sequential imports of `model-ranker` + `circuit-breaker` on 429 (cite-drift from user-given L2784-L2792; actual site L3228-L3250) | `Promise.all` w/ per-import `.catch(() => null)` |
| 60 | `lib/providers/llm-providers.ts` | 3381-L3399, 3445-L3473 | Sequential dynamic imports for antigravity provider + accounts DB; bundler-defeat preserved (Site A dynamic-path-string concat, Site B `/* webpackIgnore: true */` inline); cite-drift user-given `llm-providers.ts:3387-3393, 3450-3463` (path-ambiguous) → actual `lib/providers/llm-providers.ts:3381-L3399 + :3445-L3473` | `Promise.all` preserving bundler-isolation |
| 61 | `antigravity-provider.ts` | 230-247 | Sequential userinfo fetch + project ID fetch (both depend on token only) | `Promise.all` |
| 62 | `antigravity-provider.ts` | 263-307 | Sequential endpoint retries (3 × 10s timeout) for `fetchProjectID` | `Promise.any` |
| 63 | `token-refresh.ts` | 261-283 | Sequential `oauthService.getUserConnections` for 11 providers (inside `getConnectionsNeedingRefresh`) | `Promise.allSettled(providers.map(async ...))` (allSettled preserves original try/catch semantics) |
| 64 | `token-refresh.ts` | 286-298 | Sequential `getOrRefreshUserTokens` OAuth refreshes | `Promise.allSettled` |
| 65 | `unified-agent-service.ts` | 1921-1929 | Sequential metric counters `incrementOrchestrationFallback` + `recordChatOrchestrationFallback` | `Promise.all` |
| 66 | `unified-agent-service.ts` | 5106, 5319 | Redundant `await resolveDynamicDefaults()` — second call re-checks 30s cache | Reuse first result |
| 67 | `unified-agent-service.ts` | 2373-2379 | Sequential `sessionManager.injectContext` per conversation history message (N messages × RTT) | `Promise.all` |

---

## Tier 6 — Multi-Agent Orchestration

| # | File | Lines | Pattern | Fix |
|---|------|-------|---------|-----|
| 69 | `agent-team.ts` | 460-488 | Sequential worker execution in `executeHierarchical` | `Promise.all(workers.map(...))` |
| 70 | `agent-team.ts` | 614-640 | Sequential agent voting in `executeConsensus` | `Promise.all(agents.map(...))` |
| 71 | `agent-team.ts` | 723+ | Sequential solution creation in `executeCompetitive` | `Promise.all(agents.map(...))` |
| 72 | `crewai/events.ts` | 209-216 | Sequential event listener execution in `emit` | `Promise.allSettled(listeners.map(...))` |

---

## Tier 7 — Desktop (Rust) + CLI

| # | File | Lines | Pattern | Fix |
|---|------|-------|---------|-----|
| 73 | `commands.rs` | 313-316 | Two independent `std::fs::canonicalize` calls | `spawn_blocking` with parallel |
| 74 | `commands.rs` | 1183-1187 | Two independent `std::fs::canonicalize` calls | `spawn_blocking` with parallel |
| 75 | `commands.rs` | 1605-1606, 1632-1633 | Two independent `validate_workspace_path` calls | `rayon::join` |
| 76 | `lib.rs` | 717-733 | 3 sequential warm-up HTTP requests (`/`, `/settings`, `/api/health`) | scoped threads or `rayon` |
| 77 | `cli/local-vfs-manager.ts` | 49-52 | Sequential `git.addConfig('user.email')` + `git.addConfig('user.name')` | `Promise.all` |
| 78 | `cli/local-vfs-manager.ts` | 132-153 | N sequential file reads in `snapshotWorkspace` | Concurrency-limited `Promise.all` |
| 79 | `cli/local-vfs-manager.ts` | 252-263 | N sequential `git.show` calls in `getFileHistory` | `Promise.all` |
| 80 | `cli/local-history-manager.ts` | 65-83 | Sequential file stat + delete in `pruneHistory` | `Promise.all` |
| 81 | `cli/preview-manager.ts` | 61-73 | Sequential `bundleLocalLibrary` calls | `Promise.all` |

---

## Tier 8 — Prompt-Orchestrator Brainstorm (9 steps)

> A separate brainstorm from the async-parallelization work above. The 9-step prompt-orchestrator brainstorm defines the foundation, side-effects, and event-driven plumbing for `[PO-INJECT ...]...[/PO-INJECT]` markers in agent history. This tier catalogs the 9 steps in the Group C Phase-2 verdict-table format (Apply site / Pattern / Reviewer role / Verdict / Rationale) with ROI ranking + structural-safety rationale + applied/pending status.
>
> **Apply-candidate ranking**: 4 highest-ROI steps (1, 3, 7, 6) are ☐ pending APPLY in this tier; 4 deferred steps (4, 5, 8, 9) are summarized below with full details in the companion followup doc **`docs/prompt-orchestrator-deferred-steps.md`**. Step 2 is in-scope of Step 1 (the applyScript adapter consumes any string target including an agent's chat history) and is marked accordingly.

### Verdict table (Group C Phase-2 format)

| # | Apply site | Pattern | Reviewer role | Verdict | ROI | Rationale |
|---|------------|---------|---------------|:-------:|:---:|-----------|
| **1** | `web/lib/orchestra/prompt-orchestrator/` (greenfield 6-file module: `types.ts`, `marker-scanner.ts`, `injection-planner.ts`, `script-loader.ts`, `index.ts`, `__tests__/foundation.test.ts`) | Idempotent injection foundation: PO-INJECT marker format `[PO-INJECT promptId="..." step="..." sha="..." ts="..." mode="..."]...[/PO-INJECT]` + SHA-256 idempotency key (`promptId:step:sha`) + `applyScript(target, script)` planner + `scanMarkers(target)` reader + `loadScript(filePath)` JSON loader + 24-test suite | prompt-orchestrator owner | **✓ applied (2026-07-08)** | **★★★★★** | **Structural-safety**: pure/sync functions, no I/O beyond `loadScript`; `formatMarker` rejects payloads containing the literal `[/PO-INJECT]` substring; `InsertMode` union (append/after-divider/replace-block) is type-checked at compile time + runtime-validated against `IMPLEMENTED_MODES` Set; SHA-256 of payload is the idempotency key so re-runs are deterministic no-ops; `ts` is audit-only (not part of the key). **Blast radius**: zero — additive module with no callers yet. **Cumulative savings**: foundation for all 8 other steps. **Apply state**: 24/24 vitest tests pass; tsc clean; code-reviewer APPROVED on the 4 followup fixes (InsertMode union + payload escape + mode validation + loadScript tests). |
| **3** | `web/lib/orchestra/stateful-agent/checkpointer/index.ts` (GitSnapshotWrapper decorator on `RedisCheckpointer`) | Fire-and-forget git checkpoint side-effect on each `put()`: chokidar-free `execFile('git', ['diff', '--stat', lastCheckpointCommit])` + metadata.json + changes.patch under `~/.prompt-orchestrator/checkpoints/{threadId}/{checkpointId}/` | orchestra / checkpointer owner | **✓ applied (2026-07-08)** | **★★★★☆** | **Structural-safety**: decorator pattern (no RedisCheckpointer logic changes); fire-and-forget `.catch` per snapshot; constructor-probes `git --version` + `git rev-parse --show-toplevel` once (configurable `gitRepoRoot` override + `gitTimeoutMs` default 15000ms); one-time `console.warn` if git binary missing; `cwdForGit` is the probed repo root, NOT `process.cwd()` (the original `process.cwd()` footgun was the code-reviewer's #1 critical and is fixed). **Blast radius**: low — `RedisCheckpointer.put()` semantics unchanged; side-effect failures are logged + swallowed; `lastOffset` collision under simultaneous puts is benign (last write wins on POSIX-atomic `fs.writeFile`). **Cumulative savings**: auditable timeline of repo state per checkpoint; enables steps 6 + 7 (file-diff artifacts + event-driven triggers on git changes). **Apply state**: GitSnapshotWrapper applied (614→274 lines; +144 net from initial apply + followups); tsc clean; code-reviewer APPROVED on the 3 followup fixes (cwd configurability + git-missing detection + timeout configurability). |
| **7** | `web/.bing-shared/services/scheduler/` (extended module: `index.ts` 614→1014 lines + 5 new files `types.ts`, `utils/idle-window.ts`, `triggers/git-watcher.ts`, `triggers/marker-scanner.ts`, `trigger-manager.ts`) | Event-driven triggers: 3 sources (a) new-git-changes via chokidar-watcher (dynamic import) + debounce + `git diff --stat` against last checkpoint; (b) marker-in-history via poll-based log tail (default 5s, log-rotation safe) + `scanMarkers` from step 1; (c) idle-window rule (TZ-aware via `Intl.DateTimeFormat`, overnight-wrap safe) | scheduler / prompt-orchestrator team | **✓ applied (2026-07-08)** | **★★★★★** | **Structural-safety**: `EventTriggerManager` is a sibling class to `SchedulerService` (not a BullMQ job), so lifecycle (start/stop) is explicit; `enqueueTrigger()` enqueues onto the same `scheduled-tasks` BullMQ queue with unique `jobId` so events share the worker + rate limiter with cron jobs; chokidar + node:child_process + prompt-orchestrator/scanner are all dynamic-imported so the scheduler boots even if deps are missing; idle-window validation falls open on bad config (a typo in `startTime` doesn't silence triggers); worker handler merges `job.data.triggerPayload` into the task payload so event handlers see the trigger context. **Blast radius**: medium — scheduler is critical infrastructure; trigger manager shuts down FIRST in `shutdown()` to prevent in-flight watchers from enqueuing onto a closed queue. **Cumulative savings**: reactive automation — git changes + history markers fire handlers without polling; idle-window prevents late-night trigger storms. **Apply state**: 1,796 lines added across 5 new files + index.ts edits; tsc clean; code-reviewer returned partial verdict (full review pending). |
| **6** | `~/.prompt-orchestrator/checkpoints/{threadId}/{checkpointId}/changes.patch` + `metadata.json` (the existing diff side-effect from step 3, promoted to first-class artifact at `web/lib/orchestra/stateful-agent/checkpointer/index.ts:235-275`) | Standalone per-checkpoint diff artifact: `git diff <commit> > changes.patch` at checkpoint time + lightweight `metadata.json` index (`commit`, `branch`, `cwd`, `status`, `diffStat`, `timestamp`, `ts`) for grep-ability | checkpointer / operator-UI owner | **✓ applied (2026-07-08)** | **★★★★☆** | **Structural-safety**: extends step 3's existing side-effect (no new dependencies); per-checkpoint directory = no global lock contention; `git diff` is read-only; the metadata.json `commit` is the same value the git-watcher (step 7a) reads, so the two steps compose (no new ID scheme); `timestamp` (legacy) + `ts` (new) both written to metadata.json for forward-compat with any in-flight operator tooling. **Blast radius**: low — purely additive, no changes to step 3's fire-and-forget contract. **Cumulative savings**: operators can `cat` the patch + grep the metadata without checking out the commit; enables step 9 (UI) without re-implementing the diff path. **Apply state**: applied at `web/lib/orchestra/stateful-agent/checkpointer/index.ts:235-275` via str_replace (12-line WHY-comment at L237-L248 + hoisted `const ts = new Date().toISOString()` + `ts` field added to `snapshotMeta` + `timestamp: ts` preserved). tsc clean for the target file. Locked-in by 7-test unit test suite at `lib/orchestra/stateful-agent/checkpointer/__tests__/metadata-schema.test.ts` covering: `timestamp`/`ts` alias contract (test 1), full schema surface (test 2), idempotent re-snapshot (test 3), inner-MemoryCheckpointer put() semantics (test 4), `metadata === undefined` fallback (test 5), `createCheckpointer` factory composition (tests 6 + 7). 7/7 vitest tests pass; code-reviewer APPROVED on 2 followup rounds (timing/timeouts + git-fields strengthening + factory-exercise). |
| **2** | `applyScript(target, script)` in `web/lib/orchestra/prompt-orchestrator/injection-planner.ts` (the existing `target: string` parameter is the agent history adapter surface) | Agent-history adapter: `target` is a free-form string; an agent's chat history is a string; `applyScript(chatHistory, script)` does the rest (idempotency-check + inject markers) | prompt-orchestrator owner | **✓ applied (in-scope-of-#1, 2026-07-08)** | **★★★★☆** | **Structural-safety**: in-scope of step 1s planner — no separate adapter layer needed; the `target: string` parameter is the adapter surface. The agent-history adapter is therefore a 1-line wrapper at the call site: `const updated = applyScript(agent.history, promptScript)`. **Blast radius**: zero — no code change to the foundation; the adapter is at the call site. **Note on the verdict-table ranking**: step 2 is NOT in the top-4 highest-ROI tier (1, 3, 7, 6) because it has no separate ROI — the value is captured by step 1s `applyScript` API. **First production caller (2026-07-08)**: `web/lib/orchestra/unified-agent-service.ts:L1493` (the auto-inject powers site in `processUnifiedAgentRequest`); applies `applyScript(config.userMessage, PO_DEFAULT_SCRIPT)` before the powers fan-out to BOTH the V1-API path (appendAutoInjectPowers → config.conversationHistory) AND non-history modes (buildAutoInjectUserMessage → autoInjectContext for OpenCodeEngine / StatefulAgent / Mastra). **Structural first-caller**: `PO_DEFAULT_SCRIPT` is a module-level const with `promptId: unified-agent-entry` and empty `steps: []`, so the inject path doesnt fire (only scan + idempotency run end-to-end). To unlock Tier 8 step 4 (round-trip writes) + step 8 (observability) on real production data, a follow-up apply must add a step to `PO_DEFAULT_SCRIPT` (or switch to `loadScript` for a disk-stored script). tsc clean for the target file; 24/24 vitest prompt-orchestrator foundation suite pass.  **Second production caller (2026-07-08, followup-d)**: `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts:L157-L188` (marker-in-history trigger poll) — calls `this.applyScriptFn(newContent, PO_DEFAULT_SCRIPT)` AFTER the marker-firing for-loop completes; dynamic-imported in `start()` (parallel to scanMarkers, preserves boot-without-prompt-orchestrator contract); structural (empty `steps: []` makes the call a faithful pass-through). Wired via `applyScriptFn?: (target, script) => string` injection option parallel to existing `scanMarkersFn`. **→ 2 production callers now exist; Tier 8 step 8 (observability) is eligible for de-defer (see row 8).** To go structural → behavioral (e.g. for step 4 round-trip writes or step 8 metrics), add a step to PO_DEFAULT_SCRIPT or switch to `loadScript()` for a disk-stored script. |
| **4** | (deferred) Adapter writes — write injected prompt back to the source for round-trip | n/a | n/a | **⚠ deferred** | **★★★☆☆** | See `docs/prompt-orchestrator-deferred-steps.md#step-4` for the full structural-conflict analysis. Key risk: writing back to a user-controlled source introduces write contention + partial-write failure modes that the current `applyScript` (which only appends to the in-memory target) deliberately avoids. Defer until step 2 is load-tested in production. |
| **5** | (deferred) Provider fallback for prompts — alternate prompt sources when primary fails | n/a | n/a | **⚠ deferred** | **★★★☆☆** | See `docs/prompt-orchestrator-deferred-steps.md#step-5`. Key risk: provider-fallback adds state-management complexity (which provider is "primary"? which is "fallback"? on what trigger?) that's premature without production data on the primary path's failure modes. Defer until step 1 has 30+ days of production telemetry. |
| **8** | (deferred) Observability/metrics — dashboard for prompt injection history | n/a | n/a | **✓ applied (2026-07-08)** | **★★☆☆☆** | See `docs/prompt-orchestrator-deferred-steps.md#step-8`. Key risk: dashboard is a pure additive consumer of step 1's `scanMarkers` output + step 3's metadata.json; no structural conflicts. Defer on ROI grounds — the `metadata.json` grep + the inline `applyScript` return value are sufficient for operator-debugging at current scale. **2026-07-08 update (de-defer eligible, followup-d)**: 2 production callers now exist — 1st: `web/lib/orchestra/unified-agent-service.ts:L1493` (auto-inject powers site); 2nd: `web/.bing-shared/services/scheduler/triggers/marker-scanner.ts` (marker-in-history trigger poll, see row 2). Both call sites verified; tsc clean; boot-without-prompt-orchestrator contract preserved. **De-defer decision**: still ⚠ on ROI grounds (dashboard build ≈ 80-120 LOC of chart code vs operator-debug savings) until applyScript accumulates 30+ days of production telemetry post-launch. Re-evaluate at next quarterly review once both real-data call sites have volume. **Applied 2026-07-08 (followup-d)**: created web/lib/orchestra/prompt-orchestrator/observability.ts (in-memory Maps; no OTel SDK init at foundation), web/app/api/orchestra/prompt-orchestrator/metrics/route.ts (GET endpoint, text/plain; version=0.0.4), web/lib/orchestra/prompt-orchestrator/__tests__/observability.test.ts (3 cases — new-gen, idempotency, exposition); wired `observeApplyScript` at unified-agent-service.ts:L1517 (source='unified-agent') + marker-scanner.ts poll (source='marker-tail', dynamic-import preserves boot-without-prompt-orchestrator). Cardinality discipline: drop `sha` label (SHA-256 hex would explode past Prometheus 10K combinations/metric ceiling); keep `(source, promptId, mode)` bounded. Operator-debug path: `curl /api/orchestra/prompt-orchestrator/metrics` returns per-(source, promptId) injection / idempotency-skip / duration stats + markers-in-history gauge + scripts-loaded set cardinality. Phase 2 starts: steps 4 (round-trip writes) + 5 (provider fallback) + 9 (UI/CLI management) remain deferred per their own rows. |
| **9** | (deferred) UI/CLI for prompt management — operator surface for managing prompt scripts | n/a | n/a | **⚠ deferred** | **★★☆☆☆** | See `docs/prompt-orchestrator-deferred-steps.md#step-9`. Key risk: UI/CLI scope-creep (operator-facing vs end-user-facing vs both?). Defer until step 4 (round-trip) + step 8 (observability) settle the data model so the UI doesn't have to be re-shaped when those land. |

### ROI ranking summary (the original top-4 ordering)

The original 4 highest-ROI steps in the apply-list priority (highest first). **As of 2026-07-08, 3 of 4 have been applied in this conversation (steps 1, 3, 7); only step 6 remains ☐ pending APPLY:**

1. **Step 1 (foundation)** — ★★★★★ — **✓ applied**; every other step depends on it; cheapest to land; pure functions = trivially testable
2. **Step 7 (event triggers)** — ★★★★★ — **✓ applied**; composes with steps 1 + 3; reactive automation is a step-change in operator experience; the scheduler already has the queue infrastructure
3. **Step 6 (file diff artifacts)** — ★★★★☆ — **☐ pending APPLY** (only one of the top-4 still pending); extends step 3's side-effect; near-zero cost; unlocks step 9 (UI) without re-implementing the diff path
4. **Step 3 (git checkpoints)** — ★★★★☆ — **✓ applied**; auditable timeline; lower priority than 1/7/6 because the immediate use cases (debugging + step 7a trigger) are nice-to-have, not blocking

### Step-2 verdict (in-scope-of-#1)

Step 2 is **in-scope of step 1** — the `applyScript(target, script)` API has a `target: string` parameter that IS the agent-history adapter surface. There is no separate adapter layer to build; the "adapter" is the 1-line call at the agent integration site. This is why step 2 is NOT in the top-4 highest-ROI tier: the value is captured by step 1's `applyScript` API. The `target: string` parameter is the adapter surface; the adapter is at the call site, not in the foundation.

> **Note on step 2 placement**: the user did not explicitly list step 2 in either the "4 highest-ROI" set or the "4 deferred" set. The in-scope-of-#1 placement is a model-inference from the conversation context (the foundation module's `applyScript(target, script)` API exposes the adapter surface via the `target: string` parameter). If the user intended step 2 elsewhere, the verdict table row can be re-classified without re-applying step 1.

### Companion followup doc

Steps **4, 5, 8, 9** are deferred to **`docs/prompt-orchestrator-deferred-steps.md`** with full structural-conflict analysis, ROI re-justification, and the conditions that would un-defer each step. The followup doc mirrors the Group C Phase-2 verdict-table format (Apply site / Pattern / Reviewer role / Verdict / Rationale) for direct comparison.

---

## Summary by Impact

| Tier | Count | Key Theme | Typical Savings |
|------|-------|-----------|-----------------|
| **Tier 1** | 13 | Per-request bottlenecks (chat, tool assembly, provider loop) | **5-300ms per request** |
| **Tier 2** | 9 | Startup/initialization (providers, bootstrap, health checks) | **Sum → max of N operations** |
| **Tier 3** | 23 | VFS/batch file operations | **∝N files** (scales linearly) |
| **Tier 4** | 5 | Auth + body parse pattern (common API routes) | **5-15ms per request** |
| **Tier 5** | 18 | Auth/telemetry/middleware scattered patterns | **1-50ms per operation** |
| **Tier 6** | 4 | Multi-agent orchestration | **N × LLM → 1 × LLM** |
| **Tier 7** | 9 | Desktop (Rust) + CLI | **∝N files or calls** |
| **Total** | **81** | | |

## Top 5 Quick Wins (highest ROI, lowest risk, localized changes)

1. **`route.ts:999`** — Move `applyPromptModifiers` into the existing `Promise.all` at line 927. Saves **50-300ms** per request. ~5 line change.

2. **`unified-agent-service.ts:1444`** — `Promise.all([resolveDynamicDefaults(), determineMode(config)])`. Saves **50-100ms** per request. ~3 line change.

3. **`unified-agent-service.ts:3774`** — Hoist `buildWorkspaceSnapshot()` outside the provider fallback loop. Saves **50-200ms per extra provider** (typically 2-3 saved). ~10 line change.

4. **`route.ts:883`** — `Promise.all([resolveFilesystemOwner(request), classifyRequest(messages, attachedFilesystemFiles)])`. Saves **5-20ms** per request. ~3 line change.

5. **`architecture-integration.ts:630-903`** — `Promise.all` on all 10 tool source fetches + imports. Saves **tens to hundreds of ms** per request. ~20 line change, but pay attention to conditional guards.

---

## Review & Recommendations

_Audit performed against the actual code in `/opt/bing/web/` to find unsafe-to-parallelize sites and additional async opportunities the original 81-site catalog missed. Thinks-by-Gemini review of the doc + relevant code._

### Invalidations — sites to NOT parallelize as proposed

**#7 — `buildWorkspaceSnapshot()` hoisted outside provider fallback loop** *(unified-agent-service.ts:3774)*
- **Risk:** state cache eviction race. A provider executing functional tool operations (e.g. modifying files via `write_file`) and then failing leaves the hoisted snapshot stale for the next provider in the fallback chain — corrupted execution context (write-then-fail + read-stale-snapshot is a real bug class).
- **Recommendation:** keep snapshot computation INSIDE the loop so each fallback attempt sees the latest VFS state. **Do NOT apply the proposed hoist.**

**#14 — 19 sequential provider imports to `Promise.all`** *(llm-providers.ts:1525-1721)*
- **Risk:** singleton initialization race. Many providers lazily share dynamic loader singletons (e.g. `if (!OpenAI) OpenAI = await import()`). Blasting 19 concurrent imports bypasses the `null` guard, triggering redundant dynamic imports and overwriting shared state — the second import to win the race clobbers the first's half-initialized exports.
- **Recommendation:** introduce an async init lock/mutex on the loader before grouping into `Promise.all`, or keep the bulk of them sequential and parallelize only the "ready-to-import" subset.

**#17 — 22 bootstrap phases in `Promise.all`** *(bootstrap.ts:102-378)*
- **Risk:** OOM at cold start. Initializing 22 heavyweight sub-systems (AST caches, Git bindings, MCP, Tauri plugins, Composio, Arcade) concurrently spikes the JS heap past the `MEMORY_SOFT_THROTTLE_MB` ceiling and triggers immediate load-shedding during boot. A cold start that OOMs is worse than a slower sequential boot.
- **Recommendation:** group into bounded sequential waves — `L0 (builtins) → L1 (infra deps) Promise.all → L2 (side-effect imports) Promise.all → L3 (control plane) → L4 (tool registrations) Promise.allSettled`. Use `p-limit` to cap concurrency, not unbounded `Promise.all`.

**#64 — 11 parallel OAuth token refreshes** *(token-refresh.ts:259-274)*
- **Risk:** idempotency / DB contention. Concurrent refreshes of the SAME OAuth token writing to the same backing store face write-lock contention or clobbering of identical rotation refresh tokens — invalidating the user's active session mid-stream.
- **Recommendation:** strictly sequence refreshes per UNIQUE OAuth provider ID; only parallelize across DISTINCT providers whose refresh-targets are independent.

### New LLM-side async opportunities NOT in the doc

**NEW-1 — Auth + body parse overlap** *(chat/route.ts L370)*
- `resolveRequestAuth(request)` and `request.json()` are heavily sequential I/O at the top of the hot path but share no dependencies. They run sequentially today.
- **Fix:** `const [authResult, rawBody] = await Promise.all([resolveRequestAuth(req), req.json()]);`
- **Impact:** ~15-40ms per request (auth check + body parse are both I/O-bound; main-thread CPU saved on top of wallclock).

**NEW-2 — Pre-RAG retrieval unblocked by Task Classifier** *(chat/route.ts L1159)*
- `mem0Search` and `getRecentDenials` do not depend on `classifyRequest`'s result but currently wait for it before joining the 4-way `Promise.all`. The classifier is ML-bound (~50-150ms) while mem0/denials are DB-bound (~50-150ms) — overlapping them masks the classifier's latency behind I/O.
- **Fix:** fire the mem0 + denial Promises BEFORE awaiting `classifyRequest` so the ML latency is overlapped with DB I/O.
- **Impact:** ~50-150ms per request.

**NEW-3 — Backgrounding session file tracking** *(chat/route.ts L590)*
- `await trackSessionFiles(...)` pauses the entire critical path to update historical file telemetry before reaching the AI SDK. File-tracking telemetry is observability-grade — losing-then-retried is acceptable.
- **Fix:** drop the `await`, wrap in `.catch()` for fire-and-forget; or defer to the routed finalizer (`after(() => trackSessionFiles(...))`) so cleanup runs after the response is sent.
- **Impact:** ~10-25ms per request.

**NEW-4 — Background FC-Gate telemetry during final yield** *(vercel-ai-streaming.ts:990)*
- `wireFCGateZeroCallsSteer` and `emitFCGateZeroCallsLog` run synchronously in the final `streamText.finish` chunk, blocking stream termination while they emit a metadata payload and write to the metrics queue.
- **Fix:** schedule both in a non-blocking `setImmediate` or move into the chunk-pipeline's post-yield async tail; the metadata can be emitted slightly after the chunk lands without UI impact.
- **Impact:** ~2-5ms shaved off each stream termination. Compounds across high-QPS paths.

### Meta observations about the doc itself

1. **Hidden lock contentions**: Tier 2 #15 claims 14 IndexedDB reads in parallel at startup, but the underlying `@bing/platform/secrets` IDB pool won't accept more than **4 concurrent reads** anyway. Parallelization shifts the bottleneck from "14 sequential awaits" to "14 requests queued at the IDB lock" — the wallclock may not improve, only the request topology changes. Audit the actual IDB driver before attaching the 14x win claim.

2. **Missing I/O limits**: the catalog's "max impact" use of unbounded `Promise.all` (#78 `snapshotWorkspace` over all files, #11 polling every MCP server concurrently, #42-43 cloud-fs `syncToCloud`) without `p-limit` / `p-map` cap will degrade under load into event-loop flooding and Node **file-descriptor exhaustion** (default `ulimit -n=1024`). Apply bounded concurrency everywhere the input set is user-controlled.

3. **Transaction serialization**: Tier 3 recommends parallelizing VFS batch operations (\u00a723-29), but the underlying `transactional-vfs.ts` mutex already serializes `pathExists` and `write_file` operations. Concurrent calls just queue sequentially inside the mutex — the top-level `Promise.all` is moot until the VFS locking layer is refactored. Coordinate with the VFS team before claiming Tier 3 wins.

---

_Document version: audit appended 2026-06-19. Original 81-site catalog preserved verbatim above; this section is additive only — the invalidations are explicit "do NOT apply" overrides, the new opportunities are drops-in candidates, and the meta notes are caveats about the catalog's assumptions._

---

## Coordination Brief — Tier 2 #15 + Tier 3 (2026-06-20)

_Follow-up to the prior Meta observations. Verifies the **Meta #1** (IDB 4-cap) and **Meta #3** (VFS mutex refactor) \"hold pending team coordination\" claims against the actual code. **Both invalidated by code evidence.** The wins are claimable now; no VFS / platform team coordination required._

### Meta #1 — IDB 4-concurrent-cap assumption (Tier 2 #15 invalidation)

**Audit claim:** \"Tier 2 #15 claims 14 IndexedDB reads in parallel at startup, but the underlying `@bing/platform/secrets` IDB pool won't accept more than 4 concurrent reads anyway. Parallelization shifts the bottleneck from '14 sequential awaits' to '14 requests queued at the IDB lock' — the wallclock may not improve, only the request topology changes. Audit the actual IDB driver before attaching the 14x win claim.\"

**Code evidence refutes the claim:**

- **`/opt/bing/packages/platform/src/secrets/web.ts` is the IDB impl.** The desktop sibling `desktop.ts` uses OS Keychain (no IDB) — grep for `indexedDB`/`openDB`/`MAX_CONCURRENT`/`concurrentReads` returns 0 matches there.
- `openDB()` is a thin `indexedDB.open(DB_NAME, DB_VERSION)` Promise wrapper. **No MAX_CONCURRENT constant, no semaphore, no queue** anywhere in the file (324 lines total). Verbatim from the file:

```typescript
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { /* create stores only */ };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

- `idbGet/Put/Delete` each open a **fresh** `readonly`/`readwrite` IDB transaction per call (no shared serialization layer). IDB in modern browsers (Chrome, Firefox, Safari 2024+) accepts arbitrary concurrent `readonly` transactions on the same store.
- The 4-cap assertion has no foundation in either the codebase or browser limits.

**Tier 2 #15 anchor — currently sequential, trivially parallelizable:**

`/opt/bing/web/lib/providers/provider-keys.ts` L192-216 hosts `getStoredProviderApiKeys(knownProviders)`. Currently a strict `for...of` with `await getProviderApiKey(provider)` per provider — 14 reads in series:

```typescript
export async function getStoredProviderApiKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  const knownProviders = ['anthropic','openai','google','mistral','openrouter',
    'nvidia','github','groq','together','deepinfra','fireworks','anyscale','lepton','chutes'];
  for (const provider of knownProviders) {
    const key = await getProviderApiKey(provider);
    if (key) keys[provider] = key;
  }
  return keys;
}
```

**Refactor recipe (5 lines, drop-in replacement):**

```typescript
export async function getStoredProviderApiKeys(): Promise<Record<string, string>> {
  const knownProviders = ['anthropic','openai','google','mistral','openrouter',
    'nvidia','github','groq','together','deepinfra','fireworks','anyscale','lepton','chutes'];
  const entries = await Promise.allSettled(
    knownProviders.map(async (p) => {
      const key = await getProviderApiKey(p);
      return key ? ([p, key] as const) : null;
    }),
  );
  const keys: Record<string, string> = {};
  for (const e of entries) if (e.status === 'fulfilled' && e.value) keys[e.value[0]] = e.value[1];
  return keys;
}
```

`Promise.allSettled` (not `Promise.all`) so a single provider failing doesn't poison the rest. LocalStorage-fallback path is the same — provider switch happens inside `getProviderApiKey` per provider, so the parallel read also exercises the fallback concurrently when IDB fails.

**Recommendation:** **claim the Tier 2 #15 win.** No team coordination required. ~5–20ms saved per call to `getStoredProviderApiKeys`. Audit's optimistic estimate of \"Sum → max of 14\" stands.

### Meta #3 — transactional-vfs.ts mutex refactor premise (Tier 3 invalidation)

**Audit claim:** \"Tier 3 recommends parallelizing VFS batch operations (§23-29), but the underlying `transactional-vfs.ts` mutex already serializes `pathExists` and `write_file` operations. Concurrent calls just queue sequentially inside the mutex — the top-level `Promise.all` is moot until the VFS locking layer is refactored. Coordinate with the VFS team before claiming Tier 3 wins.\"

**Code evidence: the premise is FACTUALLY WRONG. There is no mutex in this file.**

- **Path typo in the audit.** The actual file is at `/opt/bing/web/lib/vfs/transactional-vfs.ts` (637 lines). The audit cites `/opt/bing/web/lib/virtual-filesystem/transactional-vfs.ts` — that path does not exist. Next-pass cleanup: correct all references.
- **Concurrency model is OCC (optimistic concurrency control), not a mutex.** Grep for `Mutex|Lock|serialize|withLock|withRLock` in the file returns 0 hits on locking primitives (only the 3 import line `import { VersionMismatchError, ConcurrentModificationError } from './errors'` and the `strictConcurrency` option-flag name match).
- `readWithVersion(ownerId, filePath)` (L70-79) is a **stateless wrapper** around `virtualFilesystem.readFile(ownerId, filePath)` — verbatim:

```typescript
export async function readWithVersion(ownerId: string, filePath: string): Promise<VersionedFile> {
  const file = await virtualFilesystem.readFile(ownerId, filePath);
  return { content: file.content, version: file.version, path: file.path, lastModified: file.lastModified };
}
```

  **NO LOCK. NO SERIALIZATION.** Reads are naive pass-throughs.

- `writeWithVersion` (L139-310) uses **CAS via per-file version tokens + retry loop** (default 3 attempts with jittered 2-10ms backoff). NOT a mutex:

```typescript
// L246-L263, paraphrased from the actual code
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    return await virtualFilesystem.writeFile(ownerId, filePath, currentContent, language,
      { ...vfsOptions, expectedVersion: baselineVersion, ...strictConcurrency ? { strictConcurrency: true } : {} });
  } catch (err: any) {
    if (err?.name === 'ConcurrentModificationError') throw err;  // strict mode: no retry
    if (err?.name !== 'VersionMismatchError') throw err;          // non-OCC errors bubble up
    fresh = await readWithVersion(ownerId, filePath);             // re-read on mismatch
    baselineVersion = fresh.version;
    currentContent = diffFn(fresh.content);
    if (attempt < maxRetries) await sleep(2 + Math.floor(Math.random() * 8));  // jittered backoff
  }
}
```

  Concurrent writes to the same file race on the version token; the loser retries with fresh content via `diffFn`. **No mutex holds other writes/readers out.**

- `Transaction` class (L326-603) batches edits into a **single GitBackedVFS shadow commit** via `enableBatchMode`/`flushBatch`. No mutex; `commit()` runs each edit through `writeWithVersion` in a `for` loop (sequentially *within* the commit, but commit batches them into one shadow commit so the wallclock cost per edit is ~one network round-trip to the Git shadow store, not per-edit).

**Tier 3 wins ALREADY materialize — no refactor required for the read side:**

- **#23 takeSnapshot (L612-633).** Reads are naive; convert `for (const p of paths) { try { readFile(p) } catch { /* mark created */ } }` to `Promise.all(paths.map(p => readFile(p).catch(...)))` saves ∝N read latency with **no VFS-team gate**.
- **#24 rollback (L562-583).** Each snapshot file is restored independently; convert the sequential `writeFile`+`deletePath` loop to `Promise.all(f.map(f => f.created ? deletePath(f.path) : writeFile(f.path, f.content)))` saves ∝N write latency.
- **#25-29 vfs-batch-operations** and **#30-45 smart-context / context-pack / desktop-vfs / cloud-fs** reads — all are naive pass-throughs to `virtualFilesystem.readFile`. Each entry can be `Promise.all`-ed with no upstream mutex concern.

**Recommendation:** **claim ALL Tier 3 wins.** No VFS team coordination required. The coordinate-with-VFS-team premise was based on a misread of the concurrency model — OCC uses version-token race resolution, not mutual exclusion.

### Summary

| Meta # | Audit premise | Code evidence | Action |
|--------|---------------|---------------|--------|
| **#1 (IDB 4-cap)** | \"@bing/platform/secrets IDB pool caps at 4 concurrent reads\" | **Refuted.** `secrets/web.ts openDB()` has no concurrency primitives; reads are fresh `readonly` IDB tx per call. | Claim Tier 2 #15 win. Refactor `provider-keys.ts` L192-216 to `Promise.allSettled`. |
| **#3 (VFS mutex)** | \"transactional-vfs.ts mutex serializes read+write ops\" | **Refuted.** No mutex in the file (OCC uses version tokens). Path is wrong in the audit (`vfs/` not `virtual-filesystem/vfs/`). | Claim all Tier 3 wins. No refactor needed — reads don't serialize. |

### Footnote for next audit pass

When auditing parallelization wins over Tier 3 sites, **do not assume a single-file mutex that this codebase does not have** — verify against the actual `/opt/bing/web/lib/vfs/transactional-vfs.ts` content (zero `Mutex` imports anywhere). Two corrections carried forward:
1. The path `/opt/bing/web/lib/virtual-filesystem/transactional-vfs.ts` should read `/opt/bing/web/lib/vfs/transactional-vfs.ts` in any future references.
2. The audit's label \"tier 3 mutex refactor\" should read \"tier 3 OCC version-token passes through reads — naive pass-through to virtualFilesystem.readFile. No mutation harness required.\"
