# COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT

> **Ticket ID:** `COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT`
> **Status:** 🟡 OPEN
> **Opened:** 2026-07-22
> **Last updated:** 2026-07-22
> **Priority:** 🔴 P1 (production — LLM response halting, MCP broken, tool chain failures)
> **Effort:** ~3–5 days engineering (4 fixes shipped, ~12 remaining items)
> **Impact:** Fixes the core agentic chat reliability problem (LLM stops after 1 tool call) and identifies all systemic failure patterns.

---

## Executive Summary

This audit covers a full diagnostic sweep of the binG web application's agentic chat system, driven by user-reported symptoms: **LLM stops after 1 tool call and never chains actions**, **MCP HTTP transport (SSE) stopped working**, **stream interrupted errors with stall watchdog firing**, **self-heal retries always fail**, **dynamic prompt systems never used**, and **reviewer/specialization roles never invoked**.

The investigation traced the complete request path from the Vercel frontend through the CF Worker edge proxy (`shared-ingress`), Cloudflare Tunnel, Caddyfile routing, to the Hono backend and ninerouter LLM gateway. Analysis of `bing/web/logs/run.log` (50,800 lines) identified **12 distinct failure patterns** with **4 critical bugs fixed in code** and **8 additional issues requiring follow-up**.

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
