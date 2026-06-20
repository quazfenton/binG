# Async Parallelization Opportunities

Comprehensive catalog of places where independent async operations run sequentially and could be parallelized. Organized by impact tier.

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

| # | File | Lines | Independent Ops | Est. |
|---|------|-------|-----------------|------|
| 46 | `tts/route.ts` | 13, 16 | `voiceServerManager.startKittenServer()` + `auth0.getSession()` | Server start time |
| 47 | `sandbox/session/gateway.ts` | 18, 38 | `verifyAuth(req)` + `req.json()` | Body parse time |
| 48 | `sandbox/daemon/gateway.ts` | 32, 48 | `verifyAuth(req)` + `req.json()` | Body parse time |
| 49 | `antigravity/login/route.ts` | 16, 24 | `verifyAuth(req)` + `getAntigravityOAuthUrl(...)` | OAuth URL time |
| 50 | `antigravity/callback/route.ts` | 18, 37 | `verifyAuth(req)` + `exchangeCodeForTokens(code, redirectUri)` | Token exchange time |

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
| 60 | `model-ranker.ts` | 444-450 | Sequential `getModelPerformance` + `getModelToolStats` (already parallelized in sibling method) | `Promise.all` |
| 61 | `llm-providers.ts` | 3387-3393, 3450-3463 | Sequential dynamic imports for antigravity provider + accounts DB | `Promise.all` |
| 62 | `antigravity-provider.ts` | 230-247 | Sequential userinfo fetch + project ID fetch (both depend on token only) | `Promise.all` |
| 63 | `antigravity-provider.ts` | 263-307 | Sequential endpoint retries (3 × 10s timeout) for `fetchProjectID` | `Promise.any` |
| 64 | `token-refresh.ts` | 259-274 | Sequential `oauthService.getUserConnections` for 11 providers | `Promise.allSettled` |
| 65 | `token-refresh.ts` | 286-298 | Sequential `getOrRefreshUserTokens` OAuth refreshes | `Promise.allSettled` |
| 66 | `unified-agent-service.ts` | 1921-1929 | Sequential metric counters `incrementOrchestrationFallback` + `recordChatOrchestrationFallback` | `Promise.all` |
| 67 | `unified-agent-service.ts` | 5106, 5319 | Redundant `await resolveDynamicDefaults()` — second call re-checks 30s cache | Reuse first result |
| 68 | `unified-agent-service.ts` | 2373-2379 | Sequential `sessionManager.injectContext` per conversation history message (N messages × RTT) | `Promise.all` |

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
