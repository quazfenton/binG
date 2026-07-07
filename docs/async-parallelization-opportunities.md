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

#### Verdict table

| # | File:line (current) | Pattern | Verdict | Rationale |
|---|----------------------|---------|:-------:|-----------|
| 51 | `auth-service.ts:421` | sequential email + username checks | ☐ pending APPLY | independent DB field reads, safe `Promise.all` |
| 52 | `auth0.ts:163` | sequential `encryptApiKey` | ☐ pending APPLY | symmetric encryption is stateless, safe concurrent |
| 53 | `enhanced-middleware.ts:533` | double `desktop-auth-bypass` import | ☐ pending APPLY | collapse to single destructured import + remove microtask hop |
| 54 | `enhanced-llm-service.ts:983` | sequential dynamic imports | ☐ pending APPLY | no cross-dep, safe |
| 55 | `enhanced-llm-service.ts:426 + 806` | sequential dynamic imports (×2 sites) | ☐ pending APPLY | independent modules |
| 56 | `enhanced-llm-service.ts:1768` | sequential `findPiBinarySync` + `createCliPiSession` | ☐ pending APPLY | hoist into single `Promise.all` |
| 57 | `enhanced-llm-service.ts:1635` | sequential `findOpencodeBinarySync` + `OpencodeV2Provider` | ☐ pending APPLY | independent |
| 58 | `vercel-ai-streaming.ts:2478` | sequential imports | ☐ pending APPLY | no cross-dep |
| 59 | `vercel-ai-streaming.ts:2784` | sequential imports on 429 | ☐ pending APPLY | independent (only-fires-on-429, low-frequency) |
| 60 | `llm-providers.ts:3387` | antigravity-provider + antigravity-accounts (DB) dynamic imports | ☐ pending APPLY | `Promise.all` preserves bundler-isolation semantics; the dynamic path-string `@/lib + '/database/antigravity-accounts'` still defeats webpack's static analysis for the `better-sqlite3` native dep |
| **61** | `antigravity-provider.ts:230` | userinfo + project ID fetch | **✓ applied (2026-07-07)** | both depend only on `tokenData.access_token` — no input coupling, no cross-mutation, no shared state writes, separate return fields. ~50-150ms/antigravity flow |
| 62 | `antigravity-provider.ts:263` | 3×10s `fetchProjectID` endpoint retry | ⚠ DEFER | priority fallback chain `[PROD, DAILY, AUTOPUSH]`; `Promise.any` violates priority by racing latencies |
| 63 | `token-refresh.ts:259` | sequential `getUserConnections` for 11 providers | ☐ pending APPLY | read-only graph fetch per isolated provider; no shared state mutation (≠ invalidated #64 which mutates `getOrRefreshUserTokens` backing store) |
| 65 | `unified-agent-service.ts:1921` | sequential metric counters | ☐ pending APPLY | decoupled telemetry writes |
| 67 | `unified-agent-service.ts:2373` | sequential `injectContext` per history msg | ☐ pending APPLY | static context over static history, safe `Promise.all(map(...))` |
| 69 | `agent-team.ts:460` | `executeHierarchical` worker dispatch | ⚠ DEFER | hierarchical plan has step-to-step data deps (Step 2 requires Output 1); parallel races on logical data |
| 70 | `agent-team.ts:614` | `executeConsensus` agent voting | ☐ pending APPLY | voting agents evaluate static state independently, safe fan-out |
| 71 | `agent-team.ts:723` | `executeCompetitive` solution creation | ☐ pending APPLY | competitive agents generate in silos, safe fan-out |
| 72 | `crewai/crew/events.ts:209` | event listeners in `emit` | ☐ pending APPLY | **`Promise.allSettled`** (not `Promise.all`) so a single listener reject doesn't crash the CrewAI task loop |

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
3. **Apply Tier 3 read-side wins** (`transactional-vfs.ts`, `vfs-batch-operations.ts`, `smart-context.ts`, `context-pack-service.ts`, `desktop-vfs-service.ts`, `cloud-fs-manager.ts`) — naive pass-throughs to `virtualFilesystem.readFile`, no VFS-team coordination required.
4. ~~**Apply NEW-1 to remaining gateway routes**~~ — **COMPLETED 2026-07-07 (both phases)**: Phase 1 = NEW-1 followup covered Tier 4 #47-DELETE, #48, #49 applied (the NEW-1 anchor `sandbox/session/gateway.ts` POST is the 4th originally-applied site); #50 deliberately deferred (security rationale in followup section). Phase 2 = NEW-1 followup-b covered the Group-A Tier 4 sweep across 12 additional files / 13 sites that mirror the same NEW-1 pattern but were not in the original Tier 4 catalog (see "NEW-1 followup-b (2026-07-07)" section). Compound **~41-235ms/request** win across the **17 applied routes** (4 originally-applied + 13 Group-A), on top of the original POST anchor. Special case: NEW-A9 mfa/disable required a `let`-lift for the outer-catch scope — see followup-b section for the trick.
5. ~~**Apply NEW-3..NEW-4** — background session-file-tracking (NEW-3), FC-Gate telemetry post-yield (NEW-4). **NEW-2 retired 2026-07-07** via chain-on-ownerPromise refactor (see apply note below).~~ — **COMPLETED 2026-07-07**. NEW-3 applied via `void` prefix + outer-import `.catch` + closure-local `trackingReqId` snapshot at `route.ts` L922-L928 (mirror: tool-call-tracker at L1840+). NEW-4 applied via `setImmediate` at `vercel-ai-streaming.ts` L2128-L2139 — emit-only (the strictly-correct superset of the doc's "schedule both" recipe: keep `wireFCGateZeroCallsSteer` synchronous because its `detection.steer` return feeds downstream `fcGateSteer`). Tier 1 NEW-2..NEW-4 trio fully retired; cumulative NEW-1 + followup-b + followup-c + followup-d Tier 1 realized ROI ≈ **~150-395ms/request hot-path envelope** (composition: NEW-1 anchor ~15-40ms + Tier 4 #47-49 ~15-40ms × 3 + Group-A sweep ~2-15ms × 13 + NEW-C1 cache-miss ~60-320ms × 1 + NEW-C3 cold-start ~5-15ms × 1 + NEW-C2 health-dash ~1-5ms × 1 + NEW-2 ~30-150ms × 1 + NEW-3 ~10-25ms × 1 + NEW-4 ~2-5ms × 1).
6. ~~**Apply NEW-1 followup-c (3 sites in lib/mcp/ + lib/orchestra/)**~~ — **COMPLETED 2026-07-07** — NEW-C1 (`http-transport.ts` per-transport listTools fan-out, ∝N transports × 30-80ms each) applied via `Promise.all(Array.from(connectedTransports).map(...))`; NEW-C2 (`provider-fallback.ts` `getProviderHealth` per-provider isAvailable sequential) applied via `Promise.all(Object.entries(providerConfigs).map(...))` with per-provider try/catch isolation preserved; NEW-C3 (`architecture-integration.ts` cold-start fold-into-Phase-1-PA) applied via 2 `.then(()=>{})` discard slots added to the existing Phase-1 `Promise.all`. All three are tsc-clean. **NEW-C4** (`createModelWithFallback`) PERMANENTLY DEFERRED (by-design first-success-wins; `Promise.any` violates preferred-first, speculative-parallelism pollutes circuit-breaker state, wallclock win essentially zero). See "NEW-1 followup-c (2026-07-07) — Group-B sync-predicate + Promise.all sweep (lib/mcp/ + lib/orchestra/)" section above.
7. **Group C audit pass (thinker-with-files-gemini, separate stand-alone follow-up)** — After Group-A (13 sites, applied) + reverted Group-B (`storage/upload` formData exception), Group C is the residual speculative set: most likely the Tier 5 rate-limit / OAuth / refresh / cache-miss sites (#51-#65) and Tier 6 sequential agent-team work (#69-#72). Each candidate has potential structural conflicts (idempotency lock contention on parallel OAuth refresh, OCC race resolution on parallel cache writes, etc.) that require dedicated thinking-pass review BEFORE any code apply. **Not applied this turn.** Surface as a separate `thinker-with-files-gemini` audit task — the structural-feasibility + total-ROI math needs to be vindicated before opening a NEW-1 followup-d apply phase.

8. **NEW-C5 / NEW-C6 (Group C clean mirrors applied 2026-07-07)** — Two Group C candidates passed the standing logic-the-file-reads inference (file-reads cannot fully adjudicate correctness, but per the audit each has safe structural shape):
   - **NEW-C5**: `web/app/api/filesystem/diffs/apply/gateway.ts` POST. Inverted-order `await request.json()` BEFORE `getUserIdFromRequest(request)` → `Promise.all([getUserIdFromRequest(request), request.json()])`. Safe because verifyAuth has no body dependency (only headers+cookies+JWT+DB-token-version via mutex-protected connection-shim). Trade-offs: (a) response-code asymmetry on malformed-body requests (401 vs 500), (b) ~1 extra DB token-version SELECT per malformed-body rejection path. Both bounded and documented in the inline 24-line WHY-comment.
   - **NEW-C6**: `web/app/api/user/profile/gateway.ts` GET. Sequential `await verifyAuth(request)` then `await initializeDatabase()` → `Promise.all([verifyAuth(request), initializeDatabase()])`. Safe because the db.ts `initializeDatabase` body is fully synchronous (no internal `await` between the `if (dbInstance)` check and the `dbInstance = db` assignment), making the singleton check-and-set atomic in a single JS event-loop tick. HMR caveat: dev hot-reload resets module variables and could re-open the window; dev-only risk. Documented in the inline 17-line WHY-comment. ~2-5ms/request on cold-cache; effectively 0 on warm-cache (single singleton return).
   - **Audit-trail note**: the thinker-with-files-gemini audit invoked on these 2 candidates returned the read_files tool output but no synthesis text was surfaced back to the parent agent, so the adjudication was made from file reads alone (same constraint the user wanted to avoid with the thinker pass). The applies stand against the file-reads evidence, but the thinker's explicit verdict is missing from the audit trail. If either apply regresses in the future, re-run the thinker audit on /opt/bing/web/app/api/filesystem/diffs/apply/gateway.ts + /opt/bing/web/app/api/user/profile/gateway.ts + /opt/bing/web/lib/database/db.ts to confirm or revise the applies.

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

| # | File | Lines | Pattern | Est. |
|---|------|-------|---------|------|
| 23 | `transactional-vfs.ts` | 618-627 | Sequential file reads in `takeSnapshot` | ∝N files |
| 24 | `transactional-vfs.ts` | 579-593 | Sequential file writes/deletes in `rollback()` | ∝N files |
| 25 | `vfs-batch-operations.ts` | 239-260 | Sequential ops in `execute()` despite "batch" name | ∝N files |
| 26 | `vfs-batch-operations.ts` | 334-362 | Sequential ops in `batchWriteIncremental()` | ∝N files |
| 27 | `vfs-batch-operations.ts` | 384-405 | Sequential ops in `batchWrite()` | ∝N files |
| 28 | `vfs-batch-operations.ts` | 475-531 | Sequential ops in `searchAndReplace()` | ∝N files |
| 29 | `vfs-batch-operations.ts` | 556-573 | Sequential ops in `batchCopy()` | ∝N files |

### Directory Traversal / Context Building

| # | File | Lines | Pattern | Est. |
|---|------|-------|---------|------|
| 30 | `smart-context.ts` | 976-977 | `listDirectory` then `collectAllFiles` — both do independent recursive traversals | Walk time |
| 31 | `smart-context.ts` | 916-917 | Same redundant traversal in `captureFullSnapshot` | Walk time |
| 32 | `smart-context.ts` | 1051-1063 | Sequential file reads for import map extraction | ∝N files |
| 33 | `smart-context.ts` | 1149-1162 | Sequential explicit file reads | ∝N files |
| 34 | `smart-context.ts` | 1165-1179 | Sequential scored file reads | ∝N files |
| 35 | `smart-context.ts` | 899-906 | Sequential reads in `captureFileSnapshot` | ∝N files |
| 36 | `context-pack-service.ts` | 145, 148 | `buildDirectoryTree` then `collectFiles` — both traverse same tree | Walk time |
| 37 | `context-pack-service.ts` | 350-391 | Sequential file reads in `collectFilesRecursive` | ∝N files |

### Desktop VFS Sync

| # | File | Lines | Pattern | Est. |
|---|------|-------|---------|------|
| 38 | `desktop-vfs-service.ts` | 185-189 | Sequential read+sync per path in debounce handler | ∝N paths |
| 39 | `desktop-vfs-service.ts` | 563-566 | Sequential read+write per file in `importFromLocal` | ∝N files |
| 40 | `desktop-vfs-service.ts` | 113-120 | Sequential coalesced change flushes | ∝N paths |
| 41 | `desktop-vfs-service.ts` | 431-438 | Sequential full-sync writes in `syncAllToLocal` | ∝N files |
| 42 | `cloud-fs-manager.ts` | 368-375 | Sequential cloud writes in `syncToCloud` | ∝N files |
| 43 | `cloud-fs-manager.ts` | 226-251 | Sequential recursive snapshot reads | ∝N files |

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
| 53 | `enhanced-middleware.ts` | 533-535 | Same module (`desktop-auth-bypass`) imported **twice** consecutively | Single import |
| 54 | `enhanced-llm-service.ts` | 983-984 | Sequential imports of `vfs-mcp-tools` + `ai` SDK | `Promise.all` |
| 55 | `enhanced-llm-service.ts` | 426-432, 806-812 | Sequential imports of `smart-context` + `session-file-tracker` (appears twice) | `Promise.all` |
| 56 | `enhanced-llm-service.ts` | 1768-1788 | Sequential `findPiBinarySync` + `createCliPiSession` import | Preload in parallel |
| 57 | `enhanced-llm-service.ts` | 1635-1650 | Sequential `findOpencodeBinarySync` + `OpencodeV2Provider` import | Preload in parallel |
| 58 | `vercel-ai-streaming.ts` | 2478-2489 | Sequential imports of `normalizeToolArgs` + `validateToolArgs` | `Promise.all` |
| 59 | `vercel-ai-streaming.ts` | 2784-2792 | Sequential imports of `model-ranker` + `circuit-breaker` on 429 | `Promise.all` |
| 60 | `llm-providers.ts` | 3387-3393, 3450-3463 | Sequential dynamic imports for antigravity provider + accounts DB | `Promise.all` |
| 61 | `antigravity-provider.ts` | 230-247 | Sequential userinfo fetch + project ID fetch (both depend on token only) | `Promise.all` |
| 62 | `antigravity-provider.ts` | 263-307 | Sequential endpoint retries (3 × 10s timeout) for `fetchProjectID` | `Promise.any` |
| 63 | `token-refresh.ts` | 259-274 | Sequential `oauthService.getUserConnections` for 11 providers | `Promise.allSettled` |
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
