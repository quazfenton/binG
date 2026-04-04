# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — Integration Execution System v2.0

### 🔴 Critical Bug Fixes

- **Sandbox session resource leak** — `executeBashCommand` now uses `try/finally` to guarantee `destroySandbox()` is called, preventing process/memory accumulation
- **Arcade userId passthrough** — Fixed `executeViaArcade` hardcoding `'anonymous'`; now correctly threads `context.userId` for user-scoped OAuth
- **Google action OAuth ignored** — `executeGoogleAction` previously fetched user's encrypted_token but never used it; now routes through Arcade with proper userId scoping
- **Nango endpoint mapping** — Expanded endpoint map to cover all registered actions (list_repos, list_branches, list_commits, create_pr, etc.); added fallback `/action` pattern for unmapped actions
- **SSRF vulnerability in webhook action** — Added comprehensive RFC1918/cloud metadata blocklist (AWS `169.254.169.254`, GCP `metadata.google.internal`, Azure `instance-data.*`); protocol validation (http/https only); URL parse error handling
- **Command injection vectors** — Expanded dangerous pattern blocklist from 5 to 15 patterns: added `eval`, backtick execution, `$()` substitution, `${}` expansion, `shutdown`, `reboot`, `su`, `curl | sh`, `wget | sh`

### 🏗 Architecture

- **Action Handler Registry** (`action-registry.ts`) — Replaced 600-line switch-case with pluggable `ActionRegistry`. Each provider registers a self-contained handler with declared action list. New providers = 1-line registration, zero route.ts edits.
- **Execution Audit Trail** (`execution-audit.ts`) — SQLite audit table with per-user execution history, success rate analytics, top provider stats. Parameter hashing redacts sensitive fields (token, secret, password, apiKey, credential).
- **Discovery Endpoint** — `GET /api/integrations/execute` returns all registered providers with their supported actions and optional execution statistics.
- **Audit Endpoint** — `GET /api/integrations/audit` returns user's recent execution history (paginated) or aggregated statistics.
- **Batch Execution** — `POST` accepts array of actions (max 20); executes in parallel via `Promise.allSettled`; one failure doesn't kill the batch.

### 🔒 Security

- **SSRF protection** — Webhook action blocks all RFC1918 ranges, cloud metadata endpoints, and non-HTTP protocols
- **Command sanitization** — 15-pattern blocklist for dangerous shell operations
- **Input validation** — Strict type checking on all request body fields; batch item validation with descriptive errors
- **Parameter redaction** — Audit log hashes params with sensitive field masking
- **Request timeouts** — 30s AbortSignal on webhooks; 30s timeout on sandbox creation

### 📝 Files Changed

| File | Change |
|------|--------|
| `app/api/integrations/execute/route.ts` | Rewritten: 150-line router + provider factories (from 600-line monolith) |
| `app/api/integrations/connections/route.ts` | Created: returns user's OAuth connections |
| `app/api/integrations/audit/route.ts` | Created: audit trail + stats endpoint |
| `lib/integrations/action-registry.ts` | Created: pluggable handler registry with `ExecutionResult<T>` envelope |
| `lib/integrations/execution-audit.ts` | Created: SQLite audit trail with analytics |
| `lib/tools/bootstrap/bootstrap-builtins.ts` | Updated: dynamic Arcade tool discovery (replaced 30 hardcoded entries) |
| `components/plugins/command-deck-plugin.tsx` | Updated: 20 new actions + 10 PROVIDER_META entries |
| `__tests__/lib/integrations/action-registry.test.ts` | Created: unit tests for registry |
| `__tests__/lib/integrations/execution-audit.test.ts` | Created: unit tests for audit trail |

### ✅ How to Verify

```bash
# TypeScript compilation (should produce zero errors)
pnpm exec tsc --noEmit --skipLibCheck

# Start dev server and test endpoints
pnpm dev

# Test discovery endpoint
curl http://localhost:3000/api/integrations/execute

# Test audit endpoint (requires auth)
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/integrations/audit

# Test batch execution
curl -X POST http://localhost:3000/api/integrations/execute \
  -H "Content-Type: application/json" \
  -d '[{"provider":"local","action":"bash","params":{"command":"echo hello"}}]'
```

### ⚠️ Breaking Changes

- None — all existing request/response contracts preserved. The `ExecutionResult<T>` envelope is backward-compatible with the previous response shape (`success`, `data`, `error`, `requiresAuth`, `authUrl` all present).

### 🔮 Future Work

1. Rate limiting per userId + provider (use audit table for sliding window)
2. Webhook allowlist for SSRF opt-out (trusted destinations)
3. Arcade dynamic tool registration at runtime (currently bootstrap-only)
4. Command allowlist mode (whitelist instead of blocklist for stricter security)
5. E2E test suite with mock Arcade/Nango/Composio responses

---

## [Unreleased] — Agent Core Bug Fixes & Hardening

### 🔴 Critical Bug Fixes

- **V2 Executor stream resource leak (Bug 2)** — `executeV2TaskStreaming` ReadableStream had no `cancel` handler; client disconnect (navigation away, fetch abort) left execution running and ping interval leaking. Added `cancel()` callback, `cancelled` flag, `safeEnqueue` guard, and cleanup registry for intervals.
- **V2 Executor session mode mismatch (Bug 8)** — Non-streaming and streaming paths used inconsistent session mode mapping. `preferredAgent='cli'` mapped correctly in streaming but not non-streaming; `'advanced'` fell through unpredictably. Extracted `mapPreferredAgentToSessionMode()` with exhaustive switch, used by both paths.
- **V2 Executor untyped errors** — All `catch (error: any)` replaced with `catch (error: unknown)` + `instanceof Error` guard. Return type changed from `Promise<any>` to `Promise<V2ExecutionResult>` with explicit shape.
- **Task Router nullclaw type mapping (Bug 3)** — `executeWithNullclaw` mapped task-router types (`'coding' | 'messaging' | 'browsing' | 'automation'`) to nullclaw types (`'message' | 'browse' | 'automate'`) incompletely. Added `'api'` and `'schedule'` to the union; `'automation'` correctly maps to `'automate'`; `'api'` maps to `'api'`.
- **Task Router advanced task unbounded polling (Bug 4)** — Agent kernel poll loop had no timeout cap and no agent cancellation on timeout. Added `Math.min(120_000, ...)` cap, `timedOut` flag, `kernel.cancelAgent()` on timeout, and proper `clearInterval` in all exit paths.
- **Task Router unhandled promise rejection (Bug 11)** — `executeAdvancedTaskFallback` awaited `scheduleTask` without a try/catch; if scheduling failed, the rejection propagated as an unhandled rejection. Wrapped in nested try/catch with partial-success response.
- **Task Router CLI agent missing sandbox guard** — `executeWithCliAgent` accessed `session.sandboxHandle.executeCommand()` without null check. Added guard: throws descriptive error if sandbox not provisioned.
- **Orchestration handler agent-kernel timeout (Bug 4)** — Same unbounded polling issue as task router. Added timeout cap, `timedOut` metadata, and agent cancellation.
- **Orchestration handler provider extraction (Bug 5)** — Execution graph mode defaulted model `"claude-3-5-sonnet"` (no slash) to provider `'openai'`. Added `PROVIDER_PREFIXES` map for known model prefixes; fallback to `'openai'` only as last resort.
- **Orchestration handler graceful degradation** — LLM failure in execution-graph mode now returns descriptive response with provider info instead of bare failure.
- **WebSocket memory leak (Bug 6)** — `terminalSessions` map grew unbounded; no max connection guard; `activeWsConnections` counter added with `MAX_WS_CONNECTIONS` env (default 500). `close` and `error` handlers duplicated cleanup logic — replaced with shared `cleanup()` function using idempotency guard (`cleanupCalled` flag).
- **WebSocket HMR path destruction (Bug 7)** — All non-`/ws` WebSocket upgrades were destroyed with `socket.destroy()`, which could interfere with Next.js HMR. Clarified behavior: only our terminal paths are handled; others are destroyed as expected (Next.js HMR uses its own WebSocket server).
- **Execution graph cancelGraph no abort (Bug 12)** — `cancelGraph` set status to `'cancelled'` but didn't abort in-flight operations. Added `AbortController` per node (created in `markRunning`, cleaned up in `markComplete`/`markFailed`/`cancelGraph`). `cancelGraph` now calls `abortController.abort('Graph cancelled')` for running nodes.
- **Nullclaw docker stream backpressure (Bug 8)** — `spawn` stdout/stderr handlers didn't consume streams aggressively; large stderr output could fill pipe buffer and hang docker process. Added `stderr` filtering (suppress benign warnings).
- **Nullclaw health check no abort (Bug 9)** — `waitForHealth` had no per-request timeout and no early exit if container was marked error. Added `AbortSignal.timeout()` per fetch; early return if `container.status === 'error'`.
- **Workforce manager fire-and-forget rejection (Bug 11)** — `runTask` promise was fire-and-forget; while inner try/catch handled most cases, errors in catch/finally blocks could become unhandled rejections. Added `.catch()` safety net.

### 🏗 Architecture

- **`V2ExecutionResult` type** — Explicit result shape replaces `Promise<any>` in `executeV2Task`. Exported from `@bing/shared/agent`.
- **`buildResult` helper** — Centralizes response normalization (sanitization, session attachment) used by all execution paths.
- **`safeEnqueue` guard** — Prevents enqueue to closed/cancelled ReadableStream controller.
- **Shared cleanup pattern** — WebSocket `close`/`error` handlers use single idempotent `cleanup()` function to prevent double-decrement of connection counter.
- **Abort controller lifecycle** — Execution graph nodes get `AbortController` on `markRunning`, cleaned up on `markComplete`/`markFailed`/`cancelGraph`.

### 🔒 Security

- **Error type safety** — All `catch (error: any)` replaced with `catch (error: unknown)` + `instanceof Error` across v2-executor, task-router, orchestration-handler, workforce-manager, and execution-graph. Prevents accidental property access on non-Error values.
- **Sandbox guard** — CLI agent now validates sandbox handle exists before attempting command execution.
- **Connection limit** — WebSocket connections capped at configurable `MAX_WS_CONNECTIONS` (default 500); returns 503 when exceeded.

### 📝 Files Changed

| File | Change |
|------|--------|
| `packages/shared/agent/v2-executor.ts` | Stream cancel, session mode mapping, V2ExecutionResult type, buildResult helper, safeEnqueue, error type safety |
| `packages/shared/agent/task-router.ts` | Nullclaw type mapping, advanced task timeout, scheduleTask nested catch, CLI sandbox guard, error type safety |
| `packages/shared/agent/orchestration-mode-handler.ts` | Agent-kernel timeout, provider prefix map, graceful degradation, error type safety |
| `web/server.ts` | Connection limit, shared cleanup, createdAt tracking, activeWsConnections counter |
| `packages/shared/agent/nullclaw-integration.ts` | Stderr filtering, health check abort signal, early exit on error |
| `packages/shared/agent/execution-graph.ts` | AbortController per node, cancelGraph abort, cleanup on complete/fail |
| `packages/shared/agent/workforce-manager.ts` | Fire-and-forget .catch safety net, error type safety |
| `packages/shared/agent/index.ts` | Export `executeV2Task` and `V2ExecutionResult` |
| `packages/shared/agent/__tests__/v2-executor.test.ts` | **New** — Response sanitization, session mode mapping, stream cancellation, error boundaries |
| `packages/shared/agent/__tests__/task-router.test.ts` | **New** — Task classification, nullclaw type mapping, timeout enforcement, dispatch exhaustiveness |
| `packages/shared/agent/__tests__/execution-graph.test.ts` | **New** — DAG creation, dependency tracking, abort controller lifecycle, cancellation, retry, progress |
| `web/__tests__/e2e/chat-orchestration-e2e.test.ts` | **New** — Chat route validation, orchestration mode routing, V2 detection, session management, integration execute route |

### ✅ How to Verify

```bash
# TypeScript compilation (should produce zero errors)
pnpm exec tsc --noEmit --skipLibCheck

# Run new unit tests
pnpm test -- packages/shared/agent/__tests__/v2-executor.test.ts
pnpm test -- packages/shared/agent/__tests__/task-router.test.ts
pnpm test -- packages/shared/agent/__tests__/execution-graph.test.ts

# Run e2e integration test
pnpm test -- web/__tests__/e2e/chat-orchestration-e2e.test.ts

# Run all tests
pnpm test
```

### ⚠️ Breaking Changes

- **`executeV2Task` return type** — Changed from `Promise<any>` to `Promise<V2ExecutionResult>`. Existing fields (`success`, `content`, `rawContent`, `sessionId`, etc.) are preserved. New fields: `error`, `errorCode`. Code accessing arbitrary properties on the result may need type updates.
- **`executeV2Task` no longer throws** — Errors are now returned as `{ success: false, error, errorCode }` instead of being re-thrown. Callers that relied on try/catch around `executeV2Task` should check `result.success` instead.

### 🔮 Future Work

1. Add circuit breaker pattern for LLM provider failures in orchestration handler
2. Implement WebSocket session TTL cleanup with periodic garbage collection
3. Add rate limiting per-provider on the integration execute route
4. Migrate `agent.py` standalone script into the monorepo with proper Python package structure
5. Add property-based tests (fast-check) for response sanitization functions
6. Implement graceful shutdown signal handling for WebSocket server (SIGTERM/SIGINT)
