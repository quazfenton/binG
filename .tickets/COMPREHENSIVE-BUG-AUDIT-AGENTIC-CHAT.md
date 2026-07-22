# COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT

> **Ticket ID:** `COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT`
> **Status:** 🔴 P1 (production — LLM response halting, MCP broken, tool chain failures, behavioral cascade)
> **Opened:** 2026-07-22
> **Last updated:** 2026-07-22 (Round 3 behavioral analysis appended)
> **Priority:** 🔴 P1 (production — LLM response halting, MCP broken, tool chain failures)
> **Effort:** ~5–7 days engineering (9 fixes shipped, ~15 remaining items including behavioral cascade)
> **Impact:** Fixes the core agentic chat reliability problem (LLM stops after 1 tool call) and identifies all systemic failure patterns including the 6-component cascade failure chain.

---

## Executive Summary

This audit covers a full diagnostic sweep of the binG web application's agentic chat system, driven by user-reported symptoms: **LLM stops after 1 tool call and never chains actions**, **MCP HTTP transport (SSE) stopped working**, **stream interrupted errors with stall watchdog firing**, **self-heal retries always fail**, **dynamic prompt systems never used**, and **reviewer/specialization roles never invoked**.

The investigation traced the complete request path from the Vercel frontend through the CF Worker edge proxy (`shared-ingress`), Cloudflare Tunnel, Caddyfile routing, to the Hono backend and ninerouter LLM gateway. Analysis of `bing/web/logs/run.log` (50,800 lines Round 1, 9,927 lines Round 2, deep behavioral Round 3) identified **22 distinct failure patterns** with **9 critical bugs fixed in code** and **15+ additional issues requiring follow-up**, including a **6-component cascade failure chain** that explains why the LLM "stops after 1 tool call."

---

## Fixes Shipped (4)

### Fix 1 — Abort signal reuse in self-heal retry
- **File:** `unified-agent-service.ts:4929`
- **Bug:** Self-heal retry reused `config.abortSignal` which was already aborted, causing every retry attempt to immediately fail with `"Concurrent fallback: caller aborted before start"`.
- **Fix:** Fresh `AbortController()` per retry attempt.
- **Log evidence:** Lines 1092–1140 show 3 consecutive retries all failing with the same abort error.

### Fix 2 — Per-server timeout for mcporter listTools
- **File:** `mcporter-integration.ts:131-151`
- **Bug:** `runtime.listTools(server)` had no timeout — a single slow/unresponsive MCP server blocked all tool discovery for up to 30 seconds.
- **Fix:** Added `Promise.race` with `MCPORTER_PER_SERVER_TIMEOUT_MS` (default 8s) per server.
- **Log evidence:** 14 occurrences of `"mcporter refresh timed out after 30000ms"` (lines 47627, 48128, 49323, 49916, etc.).

### Fix 3 — Orchestrator fallback passes invalid model
- **File:** `unified-agent-service.ts:5894-5901`
- **Bug:** When `runV1Orchestrated` fell back to `runV1Api` due to `orchestration_failed`, it passed the same unsupported model (`gh/gpt-5.2`) through, causing the fallback to also fail with 400.
- **Fix:** Strips `config.model` to `DEFAULT_MODEL` env var when falling back.
- **Log evidence:** Line 1304: `"The requested model is not supported."` for `gh/gpt-5.2` → 400 → cascade.

### Fix 4 — Empty fallback chain when `v1ApiCap=false`
- **File:** `unified-agent-service.ts:6667`
- **Bug:** `v1-api` was excluded from the fallback chain when `caps.v1Api === false`, but `v1ApiCap` is computed from env var API key names (`${LLM_PROVIDER.toUpperCase()}_API_KEY`) which often don't match the actual env var name — making the flag unreliable.
- **Fix:** Removed the `caps.v1Api` gate from fallback chain builder. `v1-api` is now always a candidate in auto mode since the orchestrator already falls back to it internally.
- **Root cause chain:** `startup-capabilities.ts:104-105` computes `v1Api` from env var names; when `LLM_PROVIDER` is unset or key doesn't match, returns false — even though runtime provider resolution works fine.

### Fix 5 — ProcessMemoryMonitor config inversion
- **File:** `process-memory-monitor.ts:104-106`
- **Bug:** `softThrottleMb` (2048 MB) was configured greater than `criticalMb` (1843 MB), causing custom config to be discarded.
- **Fix:** Swapped defaults — `softThrottleMb: 1843`, `criticalMb: 2048`.

### Fix 6 — Task classifier always-disabled noise
- **File:** `route.ts:317`
- **Bug:** Task classifier was throwing "Task classifier disabled" caught on every request, creating log spam.
- **Fix:** Returns early silently when classifier is null.

### Fix 7 — FC-GATE cache never populated
- **File:** `vercel-ai-streaming.ts:2402-2431`
- **Bug:** FC-GATE cache remained empty because models that didn't explicitly declare FC capability were treated as unknown on every request.
- **Fix:** Optimistically assume FC is supported when cache is empty; Phase 2 fallback handles failures automatically.

### Fix 8 — Arcade 401 permanent disable
- **File:** `arcade-service.ts:220`
- **Bug:** Arcade service disabled itself permanently on 401 without auto-retry.
- **Fix:** Added auto-reset of disabled flag when circuit breaker cooldown expires.

### Fix 9 — bash_execute capability not found
- **File:** `unified-agent-service.ts:3728`
- **Bug:** LLM tool name `bash_execute` was not mapped to `bash.execute` in the capability router.
- **Fix:** Added explicit mapping for `bash_execute` → `bash.execute`.

### Fix 10 — Hardened localhost PTY mode
- **File:** `gateway.ts:1259-1291`
- **Bug:** Localhost PTY spawned directly on host with zero filesystem isolation (`cd ../` traversed entire VM).
- **Fix:** Attempt unshare namespace isolation (user/mount/PID) first; fall back to direct spawn only if unshare is unavailable.

---

## Failure Pattern Analysis (from run.log, 50,800 lines)

### Pattern 1 — VFS PATH MISMATCH (HIGH)
- **Count:** 22 occurrences
- **Log lines:** 47892–51162
- **Pattern:** Client sends `sessions/002` as workspace scope, but workspace only contains files under `sessions/000`, `sessions/001`, or `sessions/003`.
- **Excerpt:**
  ```
  [VFS SNAPSHOT WARN] PATH MISMATCH: workspace has 1 files but none match path="sessions/002"
  rawScopePath: "workspace/sessions/002", defaultScopePath: "workspace/sessions/000"
  ```
- **Impact:** All VFS file operations (read, apply_diff, bash_execute) fail with "File not found" because the workspace is mapped to the wrong session directory.
- **Root cause:** Session ID resolution is non-deterministic or default changes across requests. The scope normalization maps `sessions/002` to `sessions/000` or `sessions/001` inconsistently.

### Pattern 2 — `bash_execute` Missing Identity (HIGH)
- **Count:** 42 occurrences across full log; 3 in lines 23850+
- **Log lines:** 50111, 50336, 50349
- **Pattern:** MCP tool dispatcher fails to forward userId/conversationId to `bash_execute`.
- **Excerpt:**
  ```
  MCP tool call failed: bash_execute
  error: "bash_execute requires a userId or conversationId; both are missing.
          This is a caller bug — the tool dispatcher must pass an authenticated identity."
  ```
- **Impact:** Every bash invocation fails. The error is labeled "caller bug" in the codebase itself.
- **Root cause:** The MCP tool dispatcher does not propagate authenticated identity to `bash_execute`.

### Pattern 3 — Tool Result "Unknown Error" Masking (MEDIUM)
- **Count:** 9 in lines 23850+
- **Pattern:** Tools return `{success, output, exitCode, error, _recoveryHint}` but the `error` key is empty/falsy, causing the logger to emit "Unknown error — tool result has keys: [success, output, exitCode, error, _recoveryHint], no error field".
- **Impact:** Real error information is masked. Recovery hints are lost.

### Pattern 4 — File Not Found with Session Path Translation (HIGH)
- **Count:** 6 in lines 23850+
- **Pattern:** LLM requests `sessions/004/agent-tui.py` but system resolves to `sessions/000`, `sessions/001`, or `sessions/003`.
- **Excerpt:**
  ```
  File not found: sessions/000/agent-tui.py
  argsPreview: {"path":"sessions/004/agent-tui.py"}
  ```
- **Impact:** Cascading file-not-found errors across read_file, apply_diff, bash_execute.

### Pattern 5 — 429 Rate Limiting → Fallback Cascade (HIGH)
- **Count:** 81 occurrences (all before line 23850)
- **Pattern:** 429 on ninerouter → cascade through nvidia → mistral → google, all ultimately failing with "Concurrent fallback: caller aborted before start".
- **Excerpt:**
  ```
  [429]: "poolside/laguna-m.1:free is temporarily rate-limited upstream"
  ATTEMPT FAILED → fallback to nvidia → mistral → google
  "Concurrent fallback: caller aborted before start"
  ```
- **Impact:** All providers exhausted, no recovery possible.

### Pattern 6 — Mcporter Refresh Timeout (MEDIUM)
- **Count:** 14 across full log; 4 in lines 23850+
- **Log lines:** 47627, 48128, 49323, 49916
- **Pattern:** `"Failed to refresh mcporter tools: mcporter refresh timed out after 30000ms"`
- **Impact:** MCP tool discovery blocked for 30 seconds.

### Pattern 7 — Stall Watchdog (LOW — works correctly)
- **Count:** 1 in lines 23850+
- **Log line:** 47808
- **Pattern:** Agent turn exceeded 120s max-turn threshold (actual: 121.2s).
- **Impact:** Stall watchdog fires as designed. Not a bug, but indicates some requests are very long-running.

### Pattern 8 — Loop-Guard / STEER Aborts (MEDIUM)
- **Count:** 11 across full log; 2 in lines 23850+
- **Log line:** 50352
- **Pattern:** Loop guard fires after consecutive tool failures (bash_execute failures + file-not-found).
- **Impact:** Agent is killed after repeated tool failures. Cascade from VFS path mismatch.

### Pattern 9 — STREAM COMPLETE with 0 Tool Invocations (MEDIUM)
- **Count:** 2 in lines 23850+
- **Log lines:** 47881, 47882
- **Pattern:** 144-second request on `mistral-large-latest` completed with 0 tool invocations — pure text response when tools were expected.
- **Impact:** LLM ignored tool schema entirely. No agentic behavior.

### Pattern 10 — Orchestrator Invalid JSON / Model Not Supported (MEDIUM)
- **Count:** 4 in lines 23850+
- **Log lines:** 48134–48146
- **Pattern:** Orchestrator's callLLM returns invalid JSON → both retries fail → plain-text fallback also fails → orchestrator fatal error → falls back to v1-api.
- **Impact:** Orchestration layer is non-functional for certain models.

### Pattern 11 — Provider Chain Exhaustion (LOW)
- **Count:** 1 in lines 23850+
- **Log line:** 47751
- **Pattern:** All 3 fallback providers (nvidia, mistral, google) failed for `nemotron-3-nano-omni` — nvidia 404, mistral "Invalid model", google 404.
- **Impact:** Expected when models are genuinely unavailable.

### Pattern 12 — MCP Not Configured (HIGH)
- **Count:** Persistent across all requests
- **Pattern:** No `MCP_GATEWAY_URL` or `MCP_CLI_PORT` environment variables set. Bootstrap checks in `bootstrap-mcp.ts` silently skip MCP initialization.
- **Impact:** MCP HTTP transport (SSE) cannot work. All MCP-dependent tools (bash_execute, file operations via MCP) fail.

---

## Additional Findings

### `continue` Parameter Status
- **Verdict:** Active and central to the auto-continue system. Never removed.
- **Key locations:**
  - `auto-continue-helper.ts:80` — `continue?: boolean` on `AutoContinueRouting`
  - `llm-continuation.ts:370` — `continue: boolean` on `ContinueDecisionBase`
  - `unified-agent-service.ts:5044-5338` — `autoContinueIteration` loop (max 3 continuations per turn)
  - `route.ts:2644` — `if (autoDecision.continue)` gates re-invocation
- **Status:** Well-typed, interface-anchored, env-tunable (`LLM_MAX_CONTINUATIONS_PER_TURN`, default 3).

### Reviewer / Specialization Role Status
- **Verdict:** Actively implemented across multiple subsystems, but mostly LLM-driven (not server-enforced).
- **Key locations:**
  - `unified-role-selector.ts:922-932` — Canonical 9-role menu includes `reviewer` and `specialist`
  - `choose-role-tool.ts:82` — Example explicitly mentions `role="reviewer"`
  - `spawn/orchestration/agent-team.ts:491` — Reviewer agent looked up for result review
  - `spawn/orchestration/index.ts:57-89` — Reviewer appears in refactor, bugfix, review, docs workflows
  - `orchestra/modes/adversarial-verify.ts:58-73` — Critic prompts for correctness, security, performance
- **Gap:** `shouldTriggerReview` (first-response-routing.ts:447-466) sets metadata flags (`reviewTriggered`, `reviewReason`) but does NOT switch to a reviewer role. The review is informational only at the orchestration level.

### Dynamic Prompt System Integration
- **Verdict:** Well-integrated. Core prompt files are properly imported and used.
- **Key integration points:**
  - `route.ts:1518` — `generateDynamicInjection()` injected for code/agentic requests
  - `unified-agent-service.ts:4237` — `composeRoleWithTools(config.role, ...)` for role-specific prompts
  - `route.ts:1595-1611` — `applyPromptModifiers()` for response parameter tuning
- **Integration gaps (dead code):**
  - `dynamic-routing.ts` — Content duplicated into `system-prompts-dynamic.ts`. Standalone file is dead code.
  - `productive-scripts.ts` — Only imported by `capability-chain.ts` within packages.
  - `workflow-templates.ts` — No external imports. Should be integrated into orchestration layer.
  - `role-redirector.ts` — Only imported within packages by `feedback-injection.ts`.

### CF Worker Heartbeat/Keep-Alive
- **File:** `workers/edge-gateway/src/index.ts:909-983`
- **Mechanism:** SSE heartbeat comments (`:\n\n`) injected every ~10 seconds on `/v1/*` streaming responses.
- **Purpose:** Prevents Cloudflare's ~15-30s idle TCP timeout from killing connections.
- **Configuration:** `idleTimeoutMs = 10_000`, check interval = `idleTimeoutMs / 3` (~3.3s).
- **Upstream:** No keep-alive on Worker→backend fetch. Subject to CF's 100s idle chunk timeout (hard limit).

### Caddyfile Routing
- **File:** `infra/oracle/Caddyfile:32`
- **`/api/mcp/*` → ninerouter:3000** (NOT the bing backend). This means MCP API requests go through ninerouter, not the application backend.
- **All `reverse_proxy` blocks use `flush_interval -1`** — flushes SSE chunks immediately.

---

## Remaining Issues (8 items)

### Issue 1 — VFS Session Path Normalization (CRITICAL)
- **Severity:** HIGH
- **Impact:** All VFS file operations fail when session ID doesn't match workspace.
- **Root cause:** Scope normalization maps client session IDs to workspace directories non-deterministically.
- **Fix needed:** Ensure session ID resolution is deterministic and consistent across requests. Consider using the resolved conversation ID consistently rather than the raw scope path.

### Issue 2 — `bash_execute` Missing Identity (CRITICAL)
- **Severity:** HIGH
- **Impact:** All bash invocations fail. 42 occurrences in the log.
- **Root cause:** MCP tool dispatcher does not propagate userId/conversationId to `bash_execute`.
- **Fix needed:** Pass authenticated identity through the tool dispatcher chain.

### Issue 3 — MCP Gateway Not Configured (HIGH)
- **Severity:** HIGH
- **Impact:** MCP HTTP transport (SSE) cannot work. All MCP-dependent tools fail.
- **Root cause:** No `MCP_GATEWAY_URL` or `MCP_CLI_PORT` environment variables set.
- **Fix needed:** Configure MCP gateway environment variables or implement MCP gateway startup.

### Issue 4 — Tool Result Error Field Masking (MEDIUM)
- **Severity:** MEDIUM
- **Impact:** Real errors are masked by "Unknown error" messages. Recovery hints are lost.
- **Root cause:** Tool result schema expects `error` field to be truthy, but tools return `{success: false, error: ""}`.
- **Fix needed:** Update tool result validation to handle empty error fields gracefully.

### Issue 5 — 429 Rate Limiting Cascade (MEDIUM)
- **Severity:** MEDIUM
- **Impact:** All providers exhausted when ninerouter is rate-limited.
- **Root cause:** No backoff/retry strategy for 429s. Immediate cascade through all fallback providers.
- **Fix needed:** Implement exponential backoff for 429 responses. Consider circuit breaker pattern.

### Issue 6 — Workflow Templates Not Integrated (LOW)
- **Severity:** LOW
- **Impact:** Pre-built workflow templates (code-review, deployment, etc.) are available but never used.
- **Root cause:** `workflow-templates.ts` has no external imports.
- **Fix needed:** Integrate into orchestration layer so LLM can trigger pre-built workflows.

### Issue 7 — Role Redirector Not Externally Referenced (LOW)
- **Severity:** LOW
- **Impact:** Server-side role routing decisions are not available to the chat route.
- **Root cause:** `role-redirector.ts` only imported within packages.
- **Fix needed:** Integrate `analyzeContextAndSuggestRoles()` into chat route for server-side role routing.

### Issue 8 — Dynamic Routing Dead Code (LOW)
- **Severity:** LOW
- **Impact:** Code duplication. `dynamic-routing.ts` content is duplicated into `system-prompts-dynamic.ts`.
- **Root cause:** Historical refactoring left standalone file intact.
- **Fix needed:** Remove `dynamic-routing.ts` or refactor `system-prompts-dynamic.ts` to import from it.

---

## Architecture Summary

```
Browser → CF Edge → CF Worker (shared-ingress)
                      ├─ /health → local response (cached 5s)
                      ├─ /v1/*   → proxy to BACKEND_URL (ninerouter via CF Tunnel)
                      │            ├─ SSE keep-alive: 10s heartbeat comments
                      │            ├─ Bypasses edge auth/rate-limiting
                      │            └─ Subject to CF 100s idle chunk timeout
                      ├─ /api/chat → 302 redirect to BACKEND_URL with JWT
                      ├─ /api/*  → proxy to BACKEND_URL (bing backend via CF Tunnel)
                      ├─ /copa/* → proxy to BACKEND_URL
                      ├─ /nocturne/* → proxy to BACKEND_URL
                      └─ /*      → proxy to FRONTEND_URL (Vercel)

Docker Network (Caddy :80):
  ├─ /health* → backend:3001 (30m timeouts)
  ├─ /api/mcp/* → ninerouter:3000 (NOT backend)
  ├─ /api/* → backend:3001 (30m timeouts)
  ├─ /nocturne/* → nocturne_backend:8000 (5m timeouts)
  ├─ /copa/* → copa-app:3000 (30m timeouts)
  ├─ /novnc/* → 172.18.0.1:6080 (2m timeouts)
  └─ /* → ninerouter:3000 (dashboard catch-all)
```

---

## Request Flow (Agentic Chat)

1. **Vercel frontend** → sends chat request to `/api/chat`
2. **CF Worker** → authenticates JWT, signs short-lived token, 302 redirects to backend
3. **Hono backend** (`route.ts`) → assembles system prompt:
   - Layer 1: Base prompt from `OPENCODE_SYSTEM_PROMPT` env var
   - Layer 2: Role prompt from `unified-role-selector.ts` (76 roles available)
   - Layer 3: Dynamic injection from `generateDynamicInjection()` (6 sections)
   - Layer 4: Response modifiers from `applyPromptModifiers()`
   - Layer 5: Feedback loop from `feedback-injection.ts`
4. **Orchestration** → `runV1Orchestrated` or `runV1Api` based on `statefulAgentCap`
5. **LLM call** → ninerouter (`/v1/chat/completions`) or direct provider
6. **Tool execution** → MCP tools (bash_execute, file ops) or built-in tools (choose_role)
7. **Auto-continue** → `decideAutoContinue()` checks if more turns needed (max 3)
8. **Response streaming** → SSE events back through the chain

**Critical failure points:**
- Step 5: Orchestrator fails with unsupported model → cascading failures
- Step 6: VFS path mismatch → all file operations fail
- Step 6: bash_execute missing identity → all bash invocations fail
- Step 7: Auto-continue blocked by stalled/failed responses

---

## Testing Recommendations

1. **Unit tests:** Mock ninerouter responses to test fallback chain behavior
2. **Integration tests:** Test VFS session path normalization with multiple session IDs
3. **E2E tests:** Verify tool chaining (LLM calls tool → processes result → calls another tool)
4. **Load tests:** Verify 429 handling and fallback cascade behavior under rate limiting
5. **MCP tests:** Test MCP gateway configuration and tool discovery

---

## Next Steps

1. **Immediate (P1):** Fix VFS session path normalization
2. **Immediate (P1):** Fix bash_execute identity propagation
3. **Immediate (P1):** Configure MCP gateway environment variables
4. **Short-term (P2):** Implement exponential backoff for 429 responses
5. **Short-term (P2):** Fix tool result error field masking
6. **Medium-term (P3):** Integrate workflow templates into orchestration
7. **Medium-term (P3):** Integrate role redirector into chat route
8. **Cleanup (P4):** Remove dead code (dynamic-routing.ts)

---

## Round 2 Findings — Updated `run.log` (2026-07-22 08:33, 9,927 lines)

> **Appended:** 2026-07-22
> **Log window:** 08:05:26 → 08:34:57 UTC
> **Scope:** New failure patterns not present in Round 1 analysis (50,800-line log)

### New Bug 1 — Arcade API Key 401 Permanent Disable (HIGH)

- **Lines:** 1136, 1173
- **Excerpt:**
  ```
  [ArcadeService] Disabling: SDK returned 401 (key arc_proj...NjDN). Fix ARCADE_API_KEY and
  call reenableArcadeService() to re-enable, or restart the server. Local tools continue to work.
  ```
- **Impact:** Arcade tools permanently disabled for the lifetime of the server process. No retry, no backoff, no auto-recovery. Any tool routed through Arcade silently fails.
- **Root cause:** `ARCADE_API_KEY` env var contains an expired or invalid key. The Arcade SDK returns 401 on init, and the service disables itself permanently.
- **Fix needed:** Either rotate the API key or change the Arcade service to retry with exponential backoff (e.g., every 60s) instead of permanent disable. The `reenableArcadeService()` function exists but is never called automatically.

### New Bug 2 — Composio Returns 0 Tools (MEDIUM)

- **Lines:** 1140–1141
- **Excerpt:**
  ```
  registered 0 Composio tools (degraded) — registry is configured but returned no tools.
  Check API keys, network reachability, and provider auth.
  ```
- **Impact:** Composio integration silently degrades to 0 tools. No error details logged about why zero tools were returned (unlike Arcade which logs the 401).
- **Root cause:** Unknown — Composio SDK returns empty tool list without error. Could be auth, network, or configuration.
- **Fix needed:** Log the actual Composio SDK response/error when 0 tools are returned. Add retry logic.

### New Bug 3 — Zombie Streams: 19+ Minute Silence After bash_execute (CRITICAL)

- **Lines:** 9827–9829, 9881–9883
- **Excerpt:**
  ```
  [THINK-PING] Model has been silent; emitting ping — silenceMs: 1163235 (19.4 min)
  lastActivityType: "tool-call", lastActivityDetail: "bash_execute"
  ```
- **Multiple concurrent zombie streams detected:**
  | Stream | Silence at log end | Last activity |
  |--------|-------------------|---------------|
  | Stream A | 1,163,235ms (19.4 min) | bash_execute tool-call |
  | Stream B | 1,051,570ms (17.5 min) | bash_execute tool-call |
  | Stream C | 899,562ms (15.0 min) | text (os.path.isdir) |
  | Stream D | 422,478ms (7.0 min) | text (elif) |
- **Impact:** Model goes completely silent after `bash_execute` tool call. THINK-PING emits every ~20s but the model never responds. The stall watchdog (75s idle timeout) should have killed these streams but **did not fire** for streams that persisted 19+ minutes.
- **Root cause:** Likely the stall watchdog timer is not properly attached to these zombie stream controllers, or the abort signal is not propagated. The streams survive well beyond the 75s `LLM_STREAM_IDLE_TIMEOUT_MS` and even the 120s `CHAT_ROUTE_STALL_TIMEOUT_MS`.
- **Fix needed:** Investigate why stall watchdog does not abort streams with `silenceMs > 1,000,000`. Ensure the abort signal reaches all concurrent stream consumers.

### New Bug 4 — VFS Path Rejection Blocks Root-Level File Reads (MEDIUM)

- **Line:** 2137
- **Excerpt:**
  ```
  [VFS normalizePath] path rejected: out of scope
  inputPath: "package.json", normalizedPath: "package.json",
  workspacePrefix: "workspace/sessions"
  isWithin: false, isAncestor: false
  ```
- **Impact:** LLM attempting to read `package.json` at the workspace root gets rejected because VFS only allows paths under `workspace/sessions/<sessionId>/...`. This blocks legitimate file reads for project config files.
- **Root cause:** VFS scope enforcement is too strict — it requires all paths to be under a session-scoped directory, but many useful files (package.json, tsconfig.json, etc.) live at the workspace root.
- **Fix needed:** Allow reads for a whitelist of common root-level files, or relax the scope check for read-only operations.

### New Bug 5 — ProcessMemoryMonitor Config Inversion (MEDIUM)

- **Line:** 853
- **Excerpt:**
  ```
  [ProcessMemoryMonitor] softThrottleMb >= criticalMb — falling back to defaults
  configuredSoft: 2048, configuredCritical: 1843
  ```
- **Bug:** `softThrottleMb` (2048 MB) is **greater than** `criticalMb` (1843 MB). The soft throttle should trigger before critical, so it must be lower. The config is inverted.
- **Impact:** Custom memory config is discarded. System falls back to defaults, which may not match the deployment's actual memory limits.
- **Fix needed:** Swap the env vars or fix the config validation to reject inverted values.

### New Bug 6 — Task Classifier Always Disabled (MEDIUM)

- **Lines:** 910, 1719, 2100, 8536
- **Excerpt:**
  ```
  Task classifier failed, using regex fallback — error: "Task classifier disabled"
  ```
- **Impact:** Every request falls back to regex task classification. The classifier is disabled but the code still attempts to invoke it on every request, generating a warning each time.
- **Root cause:** Task classifier is not configured/enabled, but the call site doesn't short-circuit before invoking.
- **Fix needed:** Either enable the classifier or skip the call entirely when disabled. Remove the noisy warning.

### New Bug 7 — FC-GATE Always UNKNOWN — No Cache Population (MEDIUM)

- **Lines:** 1411, 1903, 2283, 2337, 2377, 8711, etc.
- **Excerpt:**
  ```
  [FC-GATE] Function calling ability UNKNOWN — using two-phase strategy
  fcCacheHit: false
  ```
- **Impact:** Every single request re-evaluates function calling ability instead of using cached results. The cache is never populated (`fcCacheHit: false` on every request). This adds unnecessary latency to every LLM call.
- **Root cause:** The FC-GATE cache is either not being written to after lookup, or the cache key doesn't match between write and read.
- **Fix needed:** Debug why `fcCacheHit` is always false. Ensure the cache is populated after the first lookup per model.

### New Bug 8 — Phase 1 Time-Budget Exceeded Forces Text-Only Mode (MEDIUM)

- **Line:** 2611
- **Excerpt:**
  ```
  [V1-API-WITH-TOOLS] Phase 1 time-budget exceeded — aborting early (text-only, no tools)
  responseLength: 5030, durationMs: 30234
  ```
- **Impact:** After 30s, the tool-enabled response is aborted and the system falls back to text-only mode. All tool calls are skipped. The LLM produced 5030 chars of text but no tools.
- **Root cause:** The model takes too long to decide which tools to call. 30s budget is exhausted before the first tool call.
- **Fix needed:** Either increase the Phase 1 budget or implement a "tools-first" strategy where tool calls are emitted before text.

### New Bug 9 — Terminal Auth Failed (LOW)

- **Line:** 8988
- **Excerpt:**
  ```
  Terminal auth failed — {}
  ```
- **Impact:** Terminal integration cannot authenticate. Empty data object provides no diagnostic info.
- **Fix needed:** Log the actual auth error (missing token, invalid credentials, etc.).

### New Bug 10 — VFS Polling Detection (LOW)

- **Lines:** 303, 346
- **Excerpt:**
  ```
  POLLING DETECTED: 4 requests in 1059ms for path "sessions"
  POLLING DETECTED: 5 requests in 3612ms for path "sessions"
  ```
- **Impact:** Client-side polling wastes resources. The VFS snapshot endpoint detects this but only warns — no throttling or caching enforced.
- **Fix needed:** Add server-side rate limiting or debouncing for repeated snapshot requests on the same path.

### New Bug 11 — bash_execute Capability Not Found (LOW)

- **Lines:** 1419, 1918
- **Excerpt:**
  ```
  Capability not found, falling back to original executor
  tool: "bash_execute", capability: "bash_execute"
  ```
- **Impact:** `bash_execute` tool falls back to original executor because the capability system can't find it by name. Works but bypasses capability routing (security policies, execution tracking).
- **Fix needed:** Register `bash_execute` as a proper capability in the capability registry.

### New Bug 12 — EMPTY WORKSPACE for Anonymous Users (INFO — by design)

- **Lines:** 9833–9839
- **Excerpt:**
  ```
  EMPTY WORKSPACE (expected): ownerId="anon:...", source="anonymous", path="sessions/002"
  Returning terminal empty snapshot for anonymous owner — no init available
  ```
- **Impact:** Anonymous users always get empty workspace. File operations fail silently.
- **Note:** This appears to be by design but limits anonymous user experience.

---

## Round 3 Findings — Deep Behavioral Analysis (2026-07-22, requests from 17:49–19:07 UTC)

> **Appended:** 2026-07-22
> **Scope:** Behavioral/quality issues beyond crash-level bugs. Focus on why the user experience is broken even when individual operations "succeed."

### Behavioral 1 — `bash_execute` 100% Broken — Zero Providers Function (CRITICAL)

- **Lines:** 29443, 30112, 30879, 31252, 31326, 31682, 31946
- **Excerpt:**
  ```
  All providers failed for bash.execute: 
  ```
- **Impact:** Every `bash_execute` call returns empty error string. The LLM tries `python -m pytest`, `python test_agent_cli.py`, `pwd && ls -la` — all silently fail. This cascades into loop-guard firing at 31948, killing the agent turn after 2 consecutive failures.
- **Root cause:** Zero functioning sandbox providers. The capability router tries MCP Filesystem (always unavailable), Local Filesystem (always unavailable), then VFS (can't execute commands). Each provider swallows its actual failure reason, producing an empty error string.
- **Fix needed:** Surface actual provider errors. Make at least one sandbox provider functional (E2B, Daytona, or local Firecracker).

### Behavioral 2 — DIFF_MISMATCH: LLM Writes File 3x, Then Applies Stale Diff (HIGH)

- **Lines:** 27527 (write v1), 28257 (write v2), 29167 (write v3), 31147 (DIFF_MISMATCH)
- **Excerpt:**
  ```
  batch_write "agent-cli-tui/agent_cli.py" → success (v1, 22977 chars)
  write_file "agent-cli-tui/agent_cli.py"  → success (v2, 22978 chars)
  batch_write "agent-cli-tui/core.py"      → success (v3, overwritten)
  apply_diff  "agent-cli-tui/agent_cli.py" → DIFF_MISMATCH
  ```
- **Impact:** The LLM writes the same file 3 times across auto-continue iterations, then tries to apply a diff generated against v1 content. The diff fails because v2 already overwrote it. The LLM then tries `bash_execute` to "reapply" — which also fails (Behavioral 1). The user sees: "directory is empty" / "need to reapply everything that didn't land."
- **Root cause:** No `read_file` verification between writes. The LLM doesn't check current file state before generating diffs.
- **Fix needed:** Before applying a diff, automatically inject a `read_file` to verify current content matches expectations. Or return current file content in the DIFF_MISMATCH error response.

### Behavioral 3 — Auto-Continue Race Condition: Iteration 2 Aborted Instantly (HIGH)

- **Lines:** 29283–29325
- **Excerpt:**
  ```
  iteration 1: contentLength=0, toolCount=2  → success
  iteration 2: "Concurrent fallback: caller aborted before start"  → FAILED (6ms later)
  ```
- **Impact:** Auto-continue iteration 2 starts 6ms after iteration 1 finishes, but the parent request was already aborted. The LLM never sees the remaining plan steps. The `sseDelivered: true` flag means the client was told about iteration 1, but iteration 2's failure is silent.
- **Root cause:** Auto-continue doesn't check whether its parent request is still alive before starting a new LLM call.
- **Fix needed:** Add `AbortController` check at the start of each auto-continue iteration. If parent signal is aborted, skip and return early.

### Behavioral 4 — Auto-Continue Rate Limit Cascade at Step 3 (HIGH)

- **Lines:** 31838–31968
- **Excerpt:**
  ```
  iteration 2: contentLength=488, toolCount=10  → success (step-3.7-flash)
  iteration 3: "Too Many Requests"              → rate limited
  fallback to mistral: toolCount=0              → no tools called
  fallback to google: toolCount=0               → no tools called
  ```
- **Impact:** The ONLY model that produces useful tool calls (step-3.7-flash) gets rate-limited at iteration 3. Fallback models (mistral, google) produce zero tool calls. The user sees the task stop mid-execution with no error message.
- **Root cause:** The fallback chain goes: ninerouter (fails) → step-3.7-flash (rate-limited) → models that can't use tools. The system effectively has ONE working model.
- **Fix needed:** (a) Rate-limit-aware retry with backoff for step-3.7-flash instead of immediate fallback. (b) Move ninerouter trinity (always fails) to end of chain or remove. (c) Add models with proven FC support to fallback chain.

### Behavioral 5 — `choose_role` Written as Text, Never Parsed or Invoked (MEDIUM)

- **Line:** 33819
- **Excerpt:**
  ```
  responsePreview: '{"type": "function", "name": "choose_role", "parameters": {"role": "tester", ...}}'
  writesFound: 0, diffsFound: 0, applied: 0
  ```
- **Impact:** The LLM (llama-4-maverick via text-mode) embeds `choose_role` as JSON text. The parser only looks for `write_file`/`apply_diff`/`delete_file` patterns — `choose_role` text is ignored. The role routing system (reviewer, specialist, tester, debugger) is completely dead.
- **Root cause:** No model ever invokes `choose_role` via function calling API. Models that lack FC support emit it as text. The text parser doesn't recognize tool-call-as-text for non-file-edit tools.
- **Fix needed:** (a) Add `choose_role` to the text parser. (b) Or auto-route roles based on task analysis instead of relying on LLM self-selection.

### Behavioral 6 — THINK-PING Hallucinating 35M+ ms Silence from Stale State (MEDIUM)

- **Lines:** 28297–28375
- **Excerpt:**
  ```
  silenceMs: 24358 → 47630 → 67631 → 87631
  lastActivityType: "tool-call", lastActivityDetail: "batch_write"
  ```
- **Impact:** After `batch_write` succeeds, the model goes silent for 87+ seconds. The THINK-PING correctly detects this, but `silenceMs` values of 35M+ ms (9+ hours) from other streams are from **stale state leaking across requests**. Old stream timestamps contaminate new request telemetry.
- **Root cause:** After process restart or stall watchdog kill, old stream state isn't cleaned up. New requests inherit stale `lastActivityTime` values.
- **Fix needed:** Scope THINK-PING timestamps to the current request. Reset `lastActivityTime` on stream creation.

### Behavioral 7 — No Verification/Review Steps Ever Run (MEDIUM)

- **Impact:** The LLM writes files but **never** calls `read_file` to verify them. The typical pattern is: write → write → write → try diff → DIFF_MISMATCH → try bash → bash fails → give up. There's no `list_files` → `read_file` → verify pattern.
- **Root cause:** The system prompt doesn't enforce a write→verify→review cycle. The auto-continue loop triggers new writes without checking if previous writes landed.
- **Fix needed:** Add a "verify writes" step to the auto-continue loop. After N writes, force a `list_files` + `read_file` verification before continuing.

### Behavioral 8 — Capability Router Always Double-Misses (LOW)

- **Every tool call:**
  ```
  Provider MCP Filesystem not available (score: 115) → miss
  Provider Local Filesystem not available (score: 110) → miss
  Executing via Virtual Filesystem (score: 110) → hit
  ```
- **Impact:** Two availability checks per tool call, always failing, adding ~10-50ms latency. MCP Filesystem and Local Filesystem are configured but non-functional.
- **Fix needed:** Either make MCP Filesystem available, or remove it from the router config. Cache the "not available" state.

### Behavioral 9 — FC-GATE Cache Never Hits for ninerouter (MEDIUM)

- **Every `ninerouter`/`trinity-large-thinking:free` request:** `fcCacheHit: false`
- **Impact:** Every request to this model pays cold-start cost. Cache works for `mistral` (cacheAgeMs: 3514) and `step-3.7-flash` (cacheAgeMs: 203).
- **Root cause:** ninerouter runs in a separate process (different PID per request), so the in-memory cache is never shared across requests.
- **Fix needed:** Persist FC-GATE results to a shared store (Redis, file), or hardcode `trinity-large-thinking:free` as FC-capable/incapable.

### Behavioral 10 — VFS Snapshot 9+ Hours Stale (MEDIUM)

- **Lines:** 12382–27135 (hundreds of warnings)
- **Excerpt:**
  ```
  STALE SNAPSHOT: last updated 27597s ago → 34471s ago (7.7-9.6 hours)
  ```
- **Impact:** Frontend shows a file tree that doesn't reflect actual VFS state. The snapshot broadcaster logs warnings but never triggers a refresh.
- **Fix needed:** Force snapshot refresh when staleness exceeds threshold (e.g., 60s). Invalidate snapshot cache after any VFS write.

---

## The Cascade Failure Chain (Round 3 Root Cause Summary)

The complete failure chain for a typical 7/22 request:

1. **ninerouter** (trinity-large-thinking) fails immediately — model not supported → 400
2. Falls to **step-3.7-flash** — this is the ONLY model that produces useful tool calls
3. step-3.7-flash writes files via `batch_write` → **succeeds**
4. Auto-continue iteration 2 starts → step-3.7-flash goes **silent for 87+ seconds** (THINK-PING detects)
5. Model eventually produces more writes → **DIFF_MISMATCH** because it didn't `read_file` first
6. Model tries `bash_execute` → **100% broken** (zero providers)
7. Loop-guard fires → **agent turn killed**
8. Auto-continue iteration 3 → **rate-limited** → falls to models that can't use tools
9. User sees: "I didn't produce a response" or "directory is empty, need to reapply"

The root cause isn't one bug — it's a **cascade of 6 interacting failures** that compound each other.

---

## Updated Priority Matrix (Round 1 + Round 2 + Round 3)

| Priority | Issue | Status |
|----------|-------|--------|
| 🔴 P1 | bash_execute 100% broken — zero providers (NEW) | Open |
| 🔴 P1 | bash_execute missing identity | Open |
| 🔴 P1 | MCP gateway not configured | Open |
| 🔴 P1 | VFS session path normalization | Open |
| 🔴 P1 | Zombie streams — 19+ min silence | Open |
| 🔴 P1 | DIFF_MISMATCH cascade — LLM writes stale diffs (NEW) | Open |
| 🔴 P1 | Auto-continue race condition — iteration aborted instantly (NEW) | Open |
| 🟡 P2 | Auto-continue rate limit cascade at step 3 (NEW) | Open |
| 🟡 P2 | 429 rate limiting cascade | Open |
| 🟡 P2 | Tool result error field masking | Open |
| 🟡 P2 | Phase 1 time-budget exceeded | Open |
| 🟡 P2 | Composio returns 0 tools | Open |
| 🟡 P2 | No verification/review steps after writes (NEW) | Open |
| 🟡 P2 | FC-GATE cache never hits for ninerouter (NEW) | Open |
| 🟡 P2 | VFS snapshot 9+ hours stale (NEW) | Open |
| 🟡 P2 | THINK-PING stale state leaking across requests (NEW) | Open |
| 🟡 P2 | Arcade 401 permanent disable | **Fixed** |
| 🟡 P2 | ProcessMemoryMonitor config inversion | **Fixed** |
| 🟡 P2 | Task classifier always disabled | **Fixed** |
| 🟡 P2 | FC-GATE never caches (optimistic fix) | **Fixed** |
| 🟡 P2 | VFS root-level path rejection | **Cancelled** |
| 🟢 P3 | `choose_role` never invoked via FC (NEW) | Open |
| 🟢 P3 | Capability router always double-misses (NEW) | Open |
| 🟢 P3 | Workflow templates not integrated | Open |
| 🟢 P3 | Role redirector not externally referenced | Open |
| 🟢 P3 | Terminal auth failed | Open |
| 🟢 P3 | VFS polling detection | Open |
| 🟢 P3 | bash_execute capability not found | **Fixed** |
| ⚪ P4 | Remove dead code (dynamic-routing.ts) | Open |
