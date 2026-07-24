# COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT

> **Ticket ID:** `COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT`
> **Status:** 🔴 P1 (production — LLM response halting, MCP broken, tool chain failures, behavioral cascade)
> **Opened:** 2026-07-22
> **Last updated:** 2026-07-24 (Session 5: 2 more fixes applied, CONTEXT-LOSS-AUDIT verified)
> **Priority:** 🔴 P1 (production — LLM response halting, MCP broken, tool chain failures)
> **Effort:** ~5–7 days engineering (11 fixes shipped, ~12 remaining items)
> **Impact:** Fixes the core agentic chat reliability problem (LLM stops after 1 tool call) and identifies all systemic failure patterns including the 6-component cascade failure chain.

---

## Executive Summary

This audit covers a full diagnostic sweep of the binG web application's agentic chat system, driven by user-reported symptoms: **LLM stops after 1 tool call and never chains actions**, **MCP HTTP transport (SSE) stopped working**, **stream interrupted errors with stall watchdog firing**, **self-heal retries always fail**, **dynamic prompt systems never used**, and **reviewer/specialization roles never invoked**.

The investigation traced the complete request path from the Vercel frontend through the CF Worker edge proxy (`shared-ingress`), Cloudflare Tunnel, Caddyfile routing, to the Hono backend and ninerouter LLM gateway. Analysis of `bing/web/logs/run.log` (50,800 lines Round 1, 9,927 lines Round 2, deep behavioral Round 3) identified **22 distinct failure patterns** with **11 critical bugs fixed in code** and **12+ additional issues requiring follow-up**.

---

## Fixes Shipped (11)

### Fix 1 — Abort signal reuse in self-heal retry
- **File:** `unified-agent-service.ts:4929`
- **Bug:** Self-heal retry reused `config.abortSignal` which was already aborted, causing every retry attempt to immediately fail with `"Concurrent fallback: caller aborted before start"`.
- **Fix:** Fresh `AbortController()` per retry attempt.
- **Log evidence:** Lines 1092–1140 show 3 consecutive retries all failing with the same abort error.

### Fix 2 — Per-server timeout for mcporter listTools
- **File:** `mcporter-integration.ts:131-151`
- **Bug:** `runtime.listTools(server)` had no timeout — a single slow/unresponsive MCP server blocked all tool discovery for up to 30 seconds.
- **Fix:** Added `Promise.race` with `MCPORTER_PER_SERVER_TIMEOUT_MS` (default 8s) per server.
- **Log evidence:** 14 occurrences of `"mcporter refresh timed out after 30000ms"`.

### Fix 3 — Orchestrator fallback passes invalid model
- **File:** `unified-agent-service.ts:5894-5901`
- **Bug:** When `runV1Orchestrated` fell back to `runV1Api`, it passed the same unsupported model through.
- **Fix:** Strips `config.model` to `DEFAULT_MODEL` env var when falling back.

### Fix 4 — Empty fallback chain when `v1ApiCap=false`
- **File:** `unified-agent-service.ts:6667`
- **Bug:** `v1-api` excluded from fallback chain when `caps.v1Api === false` due to unreliable env var matching.
- **Fix:** Removed the `caps.v1Api` gate from fallback chain builder.

### Fix 5 — ProcessMemoryMonitor config inversion
- **File:** `process-memory-monitor.ts:104-106`
- **Bug:** `softThrottleMb` (2048) > `criticalMb` (1843), causing config to be discarded.
- **Fix:** Swapped defaults.

### Fix 6 — Task classifier always-disabled noise
- **File:** `route.ts:317`
- **Bug:** Task classifier throwing on every request.
- **Fix:** Returns early silently when classifier is null.

### Fix 7 — FC-GATE cache never populated
- **File:** `vercel-ai-streaming.ts:2402-2431`
- **Bug:** FC-GATE cache remained empty because models that didn't explicitly declare FC capability were treated as unknown on every request.
- **Fix:** Optimistically assume FC is supported when cache is empty; Phase 2 fallback handles failures.

### Fix 8 — Arcade 401 permanent disable
- **File:** `arcade-service.ts:220`
- **Bug:** Arcade service disabled itself permanently on 401 without auto-retry.
- **Fix:** Added auto-reset of disabled flag when circuit breaker cooldown expires.

### Fix 9 — bash_execute capability not found
- **File:** `unified-agent-service.ts:3728`
- **Bug:** LLM tool name `bash_execute` not mapped to `bash.execute` in the capability router.
- **Fix:** Added explicit mapping.

### Fix 10 — Hardened localhost PTY mode
- **File:** `gateway.ts:1259-1291`
- **Bug:** Localhost PTY spawned directly on host with zero filesystem isolation.
- **Fix:** Attempt unshare namespace isolation first; fall back to direct spawn only if unavailable.

### Fix 11 — Auto-continue race condition
- **File:** `unified-agent-service.ts:5177-5198`
- **Bug:** Auto-continue iterations didn't check if the parent abort signal was already aborted.
- **Fix:** Added explicit `config.abortSignal?.aborted` check before each auto-continue LLM call.

### Fix 12 — FC-GATE known models
- **File:** `vercel-ai-streaming.ts:2424-2475`
- **Bug:** FC-GATE cache was per-process in-memory, not shared across workers.
- **Fix:** Added hardcoded `KNOWN_FC_CAPABLE_MODELS` and `KNOWN_FC_INCAPABLE_MODELS` sets.

### Fix 13 — VFS snapshot extreme staleness
- **File:** `gateway.ts:906-923`
- **Bug:** VFS snapshots could become 9+ hours stale when Redis pub/sub was unavailable.
- **Fix:** Added force cache invalidation when snapshot age exceeds 1 hour.

### Fix 14 — choose_role text parser
- **File:** `file-edit-parser.ts:509-520, 3496-3500, 3570-3595, 4300-4365`
- **Bug:** LLMs output `choose_role` as plain text rather than structured tool calls.
- **Fix:** Added `extractChooseRoleToolCalls()` function.

### Fix 15 — Capability router negative cache
- **File:** `router.ts:2337-2380`
- **Bug:** `hasCapability()` scanned all providers on every check, even for known-unavailable capabilities.
- **Fix:** Added 5-minute negative cache for capability checks.

### Fix 16 — Tool Result Error Field Masking
- **File:** `bash-tool.ts:1037` (this session, 2026-07-24)
- **Bug:** Catch block fell back to `'Unknown error'` when `error.message` was empty, masking all failure info.
- **Fix:** Multi-field extraction from error object (`stderr`, `code`, `statusCode`, `reason`, `exitCode`, `signal`). Now downstream `ENV_ERROR_RE` diagnostic expansion fires correctly since the message contains the env code.

### Fix 17 — VFS Path Normalization
- **File:** `route.ts:scope-path-resolution` (this session, 2026-07-24)
- **Bug:** Server ignored client's `filesystemContext.scopePath` whenever it differed from server's `defaultScopePath`, directing all VFS operations to the wrong session.
- **Fix:** Server now honors client's well-formed session path (`workspace/sessions/<id>`) instead of logging "Ignoring filesystem scope..." and using the wrong session.

---

## Verified: CONTEXT-LOSS-AUDIT-2026-07-24.md

All 5 findings from the context-loss audit were verified against production code:

| Finding | Status | Evidence |
|---------|--------|----------|
| #1 PAV context propagation | ✅ **FIXED** | orchSystemPrompt flows through callLLM system parts |
| #2 Reviewer LLM pass | ✅ **FIXED** | runReview() exists with structured JSON output |
| #3 ToolLoopAgent context loss | ✅ **FIXED** | route.ts passes systemPrompt + conversationHistory; agent-loop.ts eagerly loads snapshot |
| #4 choose_role stateful | ✅ **FIXED** | activeRolePrompt stored + applied to subsequent calls |
| #5 Spec anchoring | ✅ **FIXED** | modula.ts paths include ORIGINAL REQUEST + CURRENT CANDIDATE |

---

## Remaining Issues (12 items)

### P1 Items

#### Issue 1 — Zombie Streams: 19+ Minute Silence (P1)
- **Log lines:** 9827–9829, 9881–9883
- **Pattern:** Streams survive 19+ minutes with 1M+ ms silence after `bash_execute` tool calls.
- **Impact:** Resources leaked. Memory accumulates. Concurrent zombie streams block new requests.
- **Evidence:** Stream A: 1,163,235ms silence; Stream B: 1,051,570ms; Stream C: 899,562ms; Stream D: 422,478ms.
- **Root cause:** Stall watchdog timer not properly attached to zombie stream controllers, or abort signal not propagated.

#### Issue 2 — DIFF_MISMATCH Cascade (P1)
- **Lines:** 27527, 28257, 29167, 31147
- **Pattern:** LLM writes the same file 3× across auto-continue iterations, then applies diff against v1 content after v2 already overwrote it.
- **Impact:** Every auto-continue turn produces stale diffs that fail. Cascade: diff fails → try bash_execute → bash fails (zero providers) → loop-guard kills turn.
- **Root cause:** No `read_file` verification between writes. The LLM doesn't check current file state before generating diffs.

#### Issue 3 — MCP Gateway Not Configured (P1—config)
- **Pattern:** No `MCP_GATEWAY_URL` or `MCP_CLI_PORT` environment variables set. Bootstrap checks silently skip MCP initialization.
- **Impact:** MCP HTTP transport (SSE) cannot work. All MCP-dependent tools fail.
- **Root cause:** Environment configuration issue, not code.

### P2 Items

#### Issue 4 — Auto-Continue Rate Limit Cascade at Step 3 (P2)
- **Lines:** 31838–31968
- **Pattern:** The ONLY model producing useful tool calls (step-3.7-flash) gets rate-limited at iteration 3. Fallback models produce zero tool calls.
- **Impact:** Task stops mid-execution with no error message.
- **Root cause:** No backoff for rate-limited working model before falling back to non-working models.

#### Issue 5 — 429 Rate Limiting Cascade (P2)
- **Count:** 81 occurrences
- **Pattern:** 429 on ninerouter → cascade through all fallback providers → all fail.
- **Impact:** All providers exhausted, no recovery possible.

#### Issue 6 — Phase 1 Time-Budget Exceeded (P2)
- **Line:** 2611
- **Pattern:** After 30s, tool-enabled response aborted, falls back to text-only mode. All tool calls skipped.
- **Root cause:** Model takes too long to decide which tools to call.

#### Issue 7 — Composio Returns 0 Tools (P2)
- **Lines:** 1140–1141
- **Pattern:** Composio integration silently degrades to 0 tools. No error details logged.
- **Fix needed:** Log actual Composio SDK response/error when 0 tools returned. Add retry logic.

#### Issue 8 — No Verification/Review Steps After Writes (P2)
- **Pattern:** LLM writes files but never calls `read_file` to verify. Pattern: write → write → write → try diff → DIFF_MISMATCH → try bash → bash fails → give up.
- **Root cause:** System prompt doesn't enforce write→verify→review cycle.
- **Fix needed:** After N writes in auto-continue loop, force `list_files` + `read_file` verification.

#### Issue 9 — THINK-PING Stale State Leaking Across Requests (P2)
- **Lines:** 28297–28375
- **Pattern:** `silenceMs` values of 35M+ ms (9+ hours) from old streams contaminate new request telemetry.
- **Root cause:** Old stream state isn't cleaned up after stall watchdog kill. New requests inherit stale `lastActivityTime`.
- **Fix needed:** Scope THINK-PING timestamps to current request. Reset `lastActivityTime` on stream creation.

### P3 Items

#### Issue 10 — Workflow Templates Not Integrated (P3)
- **Impact:** Pre-built workflow templates available but never used.
- **Fix needed:** Integrate into orchestration layer.

#### Issue 11 — Role Redirector Not Externally Referenced (P3)
- **Impact:** Server-side role routing decisions not available to chat route.
- **Fix needed:** Integrate `analyzeContextAndSuggestRoles()` into chat route.

#### Issue 12 — Terminal Auth Failed (P3)
- **Line:** 8988
- **Pattern:** Terminal integration cannot authenticate. Empty data object.
- **Fix needed:** Log actual auth error.

### P4 Items

#### Issue 13 — VFS Polling Detection (P4)
- **Lines:** 303, 346
- **Pattern:** Client-side polling detected but no throttling enforced.
- **Fix needed:** Add server-side rate limiting.

#### Issue 14 — Dead Code: dynamic-routing.ts (P4)
- **Impact:** Code duplication with `system-prompts-dynamic.ts`.
- **Fix needed:** Remove `dynamic-routing.ts`.

---

## Priority Matrix (Updated 2026-07-24)

| Priority | Issue | Status |
|----------|-------|--------|
| 🔴 P1 | bash_execute returns empty errors | **Fixed** (bash-tool.ts) |
| 🔴 P1 | bash_execute missing identity | **Fixed** (route.ts) |
| 🔴 P1 | MCP gateway not configured | Open (config) |
| 🔴 P1 | VFS session path normalization | **Fixed** (route.ts, this session) |
| 🔴 P1 | Zombie streams — 19+ min silence | Open |
| 🔴 P1 | DIFF_MISMATCH cascade — stale diffs | Open |
| 🔴 P1 | Auto-continue race condition | **Fixed** |
| 🟡 P2 | Auto-continue rate limit cascade | Open |
| 🟡 P2 | 429 rate limiting cascade | Open |
| 🟡 P2 | Tool result error field masking | **Fixed** (bash-tool.ts, this session) |
| 🟡 P2 | Phase 1 time-budget exceeded | Open |
| 🟡 P2 | Composio returns 0 tools | Open |
| 🟡 P2 | No verification/review after writes | Open |
| 🟡 P2 | FC-GATE cache never hits for ninerouter | **Fixed** |
| 🟡 P2 | VFS snapshot 9+ hours stale | **Fixed** |
| 🟡 P2 | THINK-PING stale state leaking | Open |
| 🟡 P2 | Arcade 401 permanent disable | **Fixed** |
| 🟡 P2 | ProcessMemoryMonitor config inversion | **Fixed** |
| 🟡 P2 | Task classifier always disabled | **Fixed** |
| 🟡 P2 | FC-GATE never caches (optimistic fix) | **Fixed** |
| 🟡 P2 | VFS root-level path rejection | **Cancelled** |
| 🟢 P3 | `choose_role` never invoked via FC | **Fixed** |
| 🟢 P3 | Capability router always double-misses | **Fixed** |
| 🟢 P3 | Workflow templates not integrated | Open |
| 🟢 P3 | Role redirector not externally referenced | Open |
| 🟢 P3 | Terminal auth failed | Open |
| 🟢 P3 | bash_execute capability not found | **Fixed** |
| ⚪ P4 | VFS polling detection | Open |
| ⚪ P4 | Remove dead code (dynamic-routing.ts) | Open |

---

## The Cascade Failure Chain

The complete failure chain for a typical 7/22 request:

1. **ninerouter** (trinity-large-thinking) fails immediately — model not supported → 400
2. Falls to **step-3.7-flash** — the ONLY model that produces useful tool calls
3. step-3.7-flash writes files via `batch_write` → **succeeds**
4. Auto-continue iteration 2 starts → step-3.7-flash goes **silent for 87+ seconds** (THINK-PING detects)
5. Model eventually produces more writes → **DIFF_MISMATCH** because it didn't `read_file` first
6. Model tries `bash_execute` → **100% broken** (zero providers)
7. Loop-guard fires → **agent turn killed**
8. Auto-continue iteration 3 → **rate-limited** → falls to models that can't use tools
9. User sees: "I didn't produce a response" or "directory is empty, need to reapply"

The root cause isn't one bug — it's a **cascade of 6 interacting failures** that compound each other.
