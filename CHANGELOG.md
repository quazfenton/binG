# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — Local PTY Security + Trigger.dev Stubs Fixed + Timeout Fixes

### 🔴 Trigger.dev Stub Fixes

- **All 6 `executeWithTrigger()` functions were no-ops** — Every task wrapper logged a warning and fell back to local execution regardless of SDK availability. Added `invokeTriggerTask()` using the Trigger.dev management API (`POST /api/v1/tasks/{taskId}/trigger`) with proper auth via `TRIGGER_SECRET_KEY`.
- **All 4 scheduling functions returned `{ scheduled: false }`** — Now call `schedules.create()` from `@trigger.dev/sdk/v3` when the SDK is available, with event bus fallback for skill-bootstrap.
- **No registered `task()` definitions existed** — Created `web/trigger/` directory with 6 real v3 `task()` definitions: `agent-loop`, `consensus-task`, `dag-task`, `reflection-task`, `research-task`, `skill-bootstrap`. Each has `maxDuration`, retry config, and a concrete `run` function.
- **`executeWithFallback` signature didn't pass payload** — Old 3-arg version couldn't pass payload to local execution. Changed to 4-arg: `(triggerExecute, localExecute, taskName, payload)` — all 6 wrappers updated.
- **Dual `trigger.config.ts` with non-overlapping `dirs`** — Root config only scanned `web/lib/events/trigger/`, web config only scanned `web/trigger/`. Fixed: root config now includes both directories.
- **`invokeTriggerTask` used non-existent SDK method** — Old code called `tasks.invoke()` which doesn't exist in v3/v4. Replaced with management API `fetch()` call that throws on failure (triggering fallback to local execution).

### 🔴 Critical Bug Fixes

- **Sandbox connection timeout firing during sandbox creation** — Timeout started BEFORE `/api/sandbox/terminal` completed, so 10s timeout fired while sandbox was still being created (24s for Daytona). Fixed: timeout now starts AFTER sandbox creation, only timing out the SSE/PTY connection phase.
- **NaN timeout from invalid env var** — `parseInt(NaN)` on `NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS` caused immediate timeout. Added `clampTimeout()` validation with min 10s / max 120s bounds.
- **AbortError triggered duplicate PTY fallback** — When timeout aborted the SSE connection, catch block attempted PTY WebSocket fallback using an aborted signal. Added `AbortError` detection to skip fallback when timeout already handled.
- **Local PTY session leak on SSE disconnect** — `ReadableStream.cancel()` killed the PTY and deleted the session on every SSE disconnect (Fast Refresh/HMR). Fixed: `cancel()` is now a no-op; PTY persists independently of SSE streams and is cleaned up by TTL or explicit close.
- **Local PTY auth bypass on SSE stream** — Auth check only verified ownership if `authResult.success && authResult.userId`, allowing unauthenticated users through. Now requires auth before stream creation.
- **Stale terminal closure in web local PTY callbacks** — `onOutput` and `onClose` closed over `termRef` set once during init; if terminal closed/reopened, callbacks wrote to stale or null instance. Fixed: callbacks now lookup terminal by ID on each invocation.
- **TypeScript syntax error in session store** — `(session as any).outputQueue: string[] = []` is invalid TS syntax. Fixed: added `outputQueue: string[]` to `LocalPtySession` interface, removed all `any` casts.
- **Overly aggressive env var filtering** — Pattern `'KEY'` filtered legitimate vars like `PRIMARY_KEY`, `CACHE_KEY`. Changed to anchored regex patterns matching only secret-like names.
- **Docker PTY race condition** — `docker exec` ran before container shell was ready. Added exponential backoff retry loop (200ms-2000ms) with health check before PTY spawn.
- **Session map initialization race** — Input/resize routes used `?? new Map()` creating separate maps when route.ts hadn't loaded. Changed to `??= new Map()` for safe singleton.
- **Wrong SSE Connection header** — `Connection: 'keep-alive'` is incorrect for SSE. Changed to `Connection: 'close'` per spec (sandbox + local PTY routes).
- **Missing Content-Type validation** — Input and resize routes accepted any Content-Type. Added `application/json` check returning 415.
- **Null reference in SSE disconnect handler** — `s?.exitCode` where `s` was null (just checked `!s`). Fixed: use captured `session` variable.
- **Env var hint referenced invalid mode** — Error message said `ENABLE_LOCAL_PTY=direct` but valid mode is `on`. Fixed.
- **Terminal disconnect didn't close EventSource promptly** — `disconnect()` closed EventSource after an `await fetch()`, allowing browser auto-reconnect. Fixed: EventSource closed synchronously first, state reset immediately, async cleanup fire-and-forget.
- **cleanupHandlers didn't await disconnect** — `cleanupHandlers` was sync, returned before disconnect finished. Made async + await.
- **closeTerminal didn't await cleanupHandlers** — Terminal disposed before connections closed. Added `await`.
- **Terminal-manager PTY retry loop had unclosed try block** — Outer `try {` never closed, causing connection limit code to run inside the try block. Removed unnecessary outer try, moved retry logic to standalone for loop.
- **Duplicate session validation in sandbox input route** — Redundant ownership check after rate limit. Removed duplicate.
- **Sandbox stream didn't close on PTY creation failure** — Stream hung forever when PTY creation failed. Added `controller.close()` after error message.
- **Local PTY Windows PATH overwritten with Unix paths** — `getCleanEnv()` set `PATH` to `/usr/local/sbin:..` on Windows, making PowerShell unable to find commands. Fixed: preserves system `PATH` on Windows, sets `HOME` from `USERPROFILE`.
- **Local PTY spawn errors crashed the route** — Unhandled `node-pty.spawn()` exceptions. Added try-catch with helpful error messages per platform.
- **Local PTY unsafe terminal dimensions** — No min/max clamping on cols/rows. Added 1-500 cols, 1-200 rows validation for all spawn paths (direct, unshare, docker).
- **Web local PTY SSE false-positive onerror** — EventSource fires `onerror` before `onopen` on slow connections. Added 3s grace period + `everConnected` tracking to distinguish real failures from transient reconnects.
- **Web local PTY close callback jarring flash** — `onClose` fired immediately on PTY exit. Added 500ms delay to let user see final output.
- **NaN timeout from invalid env var** — `parseInt(NaN)` on `NEXT_PUBLIC_TERMINAL_CONNECTION_TIMEOUT_MS` caused immediate timeout. Added `clampTimeout()` validation with min 10s / max 120s bounds.
- **AbortError triggered duplicate PTY fallback** — When timeout aborted the SSE connection, catch block attempted PTY WebSocket fallback using an aborted signal. Added `AbortError` detection to skip fallback when timeout already handled.
- **Local PTY session leak on SSE disconnect** — `ReadableStream.cancel()` killed the PTY but didn't delete session from the map. Added `sessions.delete(sessionId)` in cancel handler.
- **Local PTY auth bypass on SSE stream** — Auth check only verified ownership if `authResult.success && authResult.userId`, allowing unauthenticated users through. Now requires auth before stream creation.
- **Stale terminal closure in web local PTY callbacks** — `onOutput` and `onClose` closed over `termRef` set once during init; if terminal closed/reopened, callbacks wrote to stale or null instance. Fixed: callbacks now lookup terminal by ID on each invocation.
- **TypeScript syntax error in session store** — `(session as any).outputQueue: string[] = []` is invalid TS syntax. Fixed: added `outputQueue: string[]` to `LocalPtySession` interface, removed all `any` casts.
- **Overly aggressive env var filtering** — Pattern `'KEY'` filtered legitimate vars like `PRIMARY_KEY`, `CACHE_KEY`. Changed to anchored regex patterns matching only secret-like names (`*_API_KEY`, `*_TOKEN`, `*_PASSWORD`, `DATABASE_URL`, etc.).
- **Docker PTY race condition** — `docker exec` ran before container shell was ready. Added exponential backoff retry loop (200ms-2000ms) with health check before PTY spawn.
- **Session map initialization race** — Input/resize routes used `?? new Map()` creating separate maps when route.ts hadn't loaded. Changed to `??= new Map()` for safe singleton.
- **Wrong SSE Connection header** — `Connection: 'keep-alive'` is incorrect for SSE. Changed to `Connection: 'close'` per spec.
- **Missing Content-Type validation** — Input and resize routes accepted any Content-Type. Added `application/json` check returning 415.
- **Null reference in SSE disconnect handler** — `s?.exitCode` where `s` was null (just checked `!s`). Fixed: use captured `session` variable.
- **Env var hint referenced invalid mode** — Error message said `ENABLE_LOCAL_PTY=direct` but valid mode is `on`. Fixed.

### 🛡 Security

- **Local PTY isolation modes**: Added `unshare` (Linux user namespace), `docker` (container isolation), `localhost` (dev-only), `off` (production default), `on` (dev no-isolation).
- **Environment variable sanitization**: Regex-based filtering removes secrets (`*_API_KEY`, `*_TOKEN`, `*_PASSWORD`, `DATABASE_URL`, `REDIS_URL`) while preserving safe vars.
- **Session ownership enforcement**: All API endpoints (create, input, resize, SSE) verify authenticated user owns the session.
- **Input size limits**: 16KB max per write, dimension validation (cols 10-500, rows 5-200).
- **Session rate limits**: Max 5 PTY sessions per user, 30-minute session TTL with 5-minute cleanup.
- **Process cleanup**: Graceful shutdown on SIGTERM, process exit cleanup, container auto-removal.

### 🐧 New: Linux User Namespace Isolation (`unshare` mode)

- Each PTY session runs in isolated user/mount/PID namespaces via `unshare --user --map-root-user --mount --pid --fork --mount-proc`.
- No cross-user process visibility, isolated filesystem view, no network isolation (use `docker` mode for that).
- Requires: Linux kernel 3.8+, `kernel.unprivileged_userns_clone=1`, `util-linux` package.

### 🐳 New: Docker PTY Isolation

- Per-session Docker containers with `--network none`, memory/CPU limits, auto-removal.
- Includes readiness probe with exponential backoff before PTY exec.
- Dockerfile: `web/Dockerfile.local-pty` (node:20-slim + dev tools).

### 📝 Documentation

- `docs/LOCAL_PTY_WEB_MODE.md` — Complete guide: architecture, isolation modes, API reference, troubleshooting.

### 🧪 Tests

- `__tests__/web-local-pty.test.ts` — 16 tests (14 passed, 2 skipped for vitest 4 native fetch limitation): session creation, input, resize, close, SSE message handling, error recovery, SSR detection.

### Changed Files

- `web/app/api/terminal/local-pty/route.ts` — Complete rewrite: security gates, 5 isolation modes, typed session store, env sanitization, Docker readiness probe.
- `web/app/api/terminal/local-pty/input/route.ts` — Auth, ownership, Content-Type validation, 16KB size limit.
- `web/app/api/terminal/local-pty/resize/route.ts` — Auth, ownership, dimension validation, Content-Type check.
- `web/lib/terminal/web-local-pty.ts` — SSE grace period, reconnect handling, typed interface, proper cleanup.
- `web/components/terminal/TerminalPanel.tsx` — Stale closure fix, web local PTY input/resize/close routing, VFS handler restored.
- `web/lib/sandbox/sandbox-connection-manager.ts` — Timeout timing fix, NaN clamp, AbortError guard, progress messages.
- `env.example` — Added `ENABLE_LOCAL_PTY` documentation.
- `web/Dockerfile.local-pty` — New: purpose-built image for Docker isolation mode.

### 🔴 Critical Bug Fixes

- **Next.js hot-reload state loss (multiple singletons)** — Module-level Maps, Sets, and singletons were reset on every hot-reload, causing VFS workspace data loss, cache invalidation failure, rate limit bypass, circuit breaker reset, and duplicate event listeners. Fixed by storing all critical singletons on `globalThis`: `__vfsSingleton__`, `__gitVFSInstances__`, `__diffTracker__`, `__recentMcpFileEdits__`, `__sessionFileTrackerStore__`, `__rateLimitStore__`, `__responseRouter__`, `__enhancedLLMService__`, `__snapshotCache__`, `__snapshotLatestVersion__`, `__snapshotRequestTracker__`. Timer-based intervals are guarded with registration flags to prevent leaks.
- **Provider tracking showed `'original-system'` instead of real LLM provider** — `metadata.actualProvider` was not propagated through the streaming response chain. Added `actualProvider`/`actualModel` to streaming response metadata in `response-router.ts`, `route.ts` now checks `data?.provider` before falling back to `source`, and `enhanced-llm-service.ts` emits metadata chunks during fallback events.
- **Infinite retry loop on empty responses** — After a retry also returned empty, it triggered another retry. Fixed: `maxRetries = 1`, and after retry also returns empty, `isEmptyResponse: false` prevents further retries.
- **Empty message bubble with VFS MCP tools** — Tool invocations were stored in React state but `messagesRef.current` hadn't synced when the `done` event fired. Added `streamingToolInvocations` local array populated synchronously during SSE event parsing.
- **Code Preview button didn't light up for VFS MCP edits** — Button only glowed for markdown code blocks. Added `hasMcpFileEdits` state that listens to `filesystem-updated` events with `source: 'mcp-tool'`, combined with `hasCodeBlocks` for the glow condition.
- **Stale closures in `onFinish` callbacks** — Multiple `onFinish` calls used `currentMessageRef.current` which could be stale after retries. All callbacks now use `assistantMessage` directly or read from `messagesRef.current`.
- **Duplicate variable declarations in `vfs-mcp-tools.ts`** — `successCount` and `failCount` were declared twice in `batchWriteTool`, causing compile error. Removed duplicate.
- **Missing input validation in MCP tools** — Added null checks for `content`, content size guards (5MB per file, 50MB for batch), and context validation warnings.
- **Path traversal detection improved** — Changed from `includes('..')` to segment-level `some(seg => seg === '..')` to prevent edge case bypasses.
- **ToolLoopAgent tool invocation tracking** — ToolLoopAgent wasn't populating `result.toolInvocations` even when tools executed. Added manual tracking array `lastExecutedToolCalls` that records each tool execution, used as fallback when ToolLoopAgent doesn't report invocations. Fixes: logs show "0 tool calls" despite tools running.
- **VFS file scoping for all tools** — Added `resolveWorkspacePath()` to `create_directory`, `search_files`, and `file_exists` tools. All VFS MCP tools now scope paths to workspace, preventing cross-session file access.

### 🧪 Test Coverage

- **file-edit-parser.test.ts** — Added 24 new edge case tests: multiple file blocks, whitespace handling, nested paths, empty content/path rejection, 10K char content, unicode paths (rejected by design), special characters, command name/JSON rejection, mixed case openers, multiple mkdir/delete blocks, path validation, mixed format integration. **47/47 passing.**
- **batch-write-parser.test.ts** — Added 28 new tests: single/multi file creation, newlines/special chars, unicode, backticks in code, 50K char content, nested paths, whitespace preservation, escaped quotes, empty content, error handling (invalid JSON, non-array, null/number/string elements, undefined), mixed format prefixes (files=, files:, args=, data=, input=, items=). **88/88 passing.**
- **run-e2e-test.cjs** — End-to-end test suite: chat with tools, filesystem snapshot verification, directory listing, provider tracking, simple chat, error handling. **10/10 passing.**

### 🏗 Architecture

- **LLM function calling fallback** — When the model doesn't support native function calling (or ignores tools), it outputs tool calls as raw JSON text. Added `extractJsonToolCalls()` parser that catches `{ "tool": "batch_write", "arguments": { "files": [...] } }` format and converts to structured `FileEdit` objects for execution through the existing file-edit pipeline.
- **Function calling support detection** — Added `model.supports?.functionCalling` check in `vercel-ai-streaming.ts`. If `false`, tools are stripped and a warning is logged, preventing confusing the model with tools it can't use. Applied to both main and fallback streaming paths.
- **CSS value false positives in path validation** — `looksLikeCssValueSegment()` regex `\d*[a-z%]+` didn't match decimal values like `0.3s`. Fixed to `\d+(?:\.\d+)?[a-z%]+|\d+(?:\.\d+)?` which correctly catches `0.3s`, `1.5rem`, `10px`, `50%`.
- **VFS MCP tools write to wrong user workspace (userId: 'default')** — `createVFSTools()` used `initializeVFSTools()` with `toolContextStore.enterWith()` to set the async context, but Vercel AI SDK's `streamText()` auto-executes tools in its own internal async context that doesn't inherit from `enterWith`. So `getToolContext()` fell back to `'default'`, writing files to the wrong user's workspace. Fixed by wrapping each tool's `execute` with `toolContextStore.run({ userId, sessionId }, ...)` which properly propagates context into the SDK's tool execution.
- **Spec amplification not triggered after VFS MCP tool execution** — When files are modified via function calling (MCP tools), the spec amplification system wasn't detecting them because it only checked text-based file edit markers (`parseFilesystemResponse`). Added a request-scoped file edit tracker in `file-events.ts` that `emitFileEvent()` writes to for `mcp-tool` sources. All three spec amplification check points (non-streaming, regular LLM stream, ToolLoopAgent stream) now check both text-based edits AND MCP tool file edits.
- **Git versions endpoint 404 for anonymous sessions** — The `/api/gateway/git/[sessionId]/versions` endpoint looked up `user_sessions` table which doesn't exist for anonymous users, always returning 404. Rewrote to query `shadow_commits` directly by `owner_id` + `session_id`, which is how commits are actually stored. Also fixed `paths` JSON.parse to handle malformed data gracefully.
- **Git rollback endpoint 404 for anonymous sessions** — Same `user_sessions` lookup issue. Fixed to use `owner_id` + extracted `conversation_id` for shadow commit operations.
- **VFS workspace now uses SQLite instead of JSON file storage** — Replaced `%LOCALAPPDATA%/vfs-storage/*.json` with `vfs_workspace_files` and `vfs_workspace_meta` tables in the main SQLite database. No local files are written — all workspace content is stored atomically in the database. Benefits: atomic transactions, concurrent access safety, indexed queries, and unified backup with the rest of the application.
- **Google (Gemini) streaming "transform is not a function" error** — `smoothStream()` middleware is incompatible with the Google provider in Vercel AI SDK v6. Skip transforms for `provider === 'google'`.
- **rm -rf regex bypass** — Original `/\brm\s+-rf\s+\s/i` required `\s+\s` (two+ whitespace chars), so `rm -rf /home` with single space passed through. Fixed to `/\brm\s+-rf\s+\//i` which blocks `rm -rf` on any absolute path.
- **SSRF IPv6 bypass** — Added `::ffff:` to `SSRF_BLOCKED_HOSTS` blocklist to prevent IPv4-mapped IPv6 address bypasses (e.g., `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`).
- **Directory traversal broken in migration script** — `findFiles()` in `migrate-agent-imports.js` ignored recursive results. Fixed with `fs.statSync` + `results.concat()` for proper recursive traversal.
- **TerminalPanel.tsx TS syntax error** — Missing closing `}` for `if (term.terminal.rows > 0)` block, causing cascading parse error. Fixed.
- **`getGeneralMinimalPromptV2/V3` truncates tool list** — Splitting on `/={20,}/` matched `====` separators inside `NON_TECHNICAL_TOOL_REFERENCE`, dropping the actual tool list from minimal prompts. Fixed: split only at `\n={20,}\n# PRIME DIRECTIVES` boundary to keep identity + tool reference intact.
- **Text-mode tool instructions for non-function-calling models** — When a model reports `supports.functionCalling === false`, tools are stripped and text-mode instructions are injected into the system prompt. The model is told to use parseable fenced formats: ```file: path\ncontent\n```, ```diff: path\ndiff\n```, ```mkdir: path```, ```delete: path```. New parsers `extractFencedFileEdits`, `extractFencedMkdirEdits`, `extractFencedDeleteBlocks` extract these from responses and wire them into both batch and incremental parsing paths.
- **ToolLoopAgent stops after one iteration** — Two bugs: (1) `maxIterations` was never passed to the `ToolLoopAgent` constructor, defaulting to 1 iteration instead of the configured 10; (2) tools were mapped using array indices (`"0"`, `"1"`) instead of tool names (`"read_file"`, `"write_file"`), so the agent couldn't find its tools. Fixed: pass `maxIterations` and build proper `{ [name]: Tool }` map.
- **VFS persistWorkspace partial-commit risk** — Metadata update and delete operations ran outside the transaction, leaving workspace inconsistent if upserts failed. Fixed: all operations (meta, deletes, upserts) now run in a single atomic transaction.
- **VFS ensureWorkspace silent error swallowing** — All DB errors were caught and silently returned an empty workspace. Now distinguishes "table doesn't exist" (expected before migration) from real errors (logged as `console.error`).
- **IndexedDB transaction error handling** — `idbGet/idbPut/idbDelete` in secrets/web.ts and `readFile/listDirectory/deleteFile/clear` in indexeddb-backend.ts were missing `tx.onerror` handlers, causing promises to hang forever if transactions failed. Added `tx.onerror` to all.
- **IndexedDB clear() non-atomic** — Used two separate transactions (one to read keys, another to delete). Fixed: single atomic transaction.
- **Double promise resolution in file dialog** — Added `settled` guard flag and unified `settle()` function in `openFileDialog` to prevent race between `onchange` and `onfocus` handlers.
- **Incomplete error reporting in job error handling** — Changed `error.message` to `error?.message || String(error)` in `jobs.ts` catch block to handle non-Error throws.
- **Silent error in secrets get()** — Added conditional error logging in `secrets/desktop.ts` `get()` method; logs unexpected errors but silences expected "not found" errors.

### 🏗 Architecture

- **Raw JSON tool call sanitization** — `sanitizeFileEditTags()` now strips raw JSON tool call objects from display using balanced brace counting (O(n), no regex backtracking), preventing leaking tool call JSON into the UI.
- **Incremental JSON tool call tracking** — `detectUnclosedTags()` in the streaming parser now tracks unclosed JSON tool call objects, preventing incomplete edits from being emitted during streaming.

### ✅ Tests

- **25 unit tests** for `extractJsonToolCalls`, `extractFileEdits` integration, `sanitizeFileEditTags`, `sanitizeAssistantDisplayContent`, `extractIncrementalFileEdits`, and `isValidExtractedPath`.

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

## [Unreleased] — Smart Context & @mention Autocomplete System

### 🧠 Smart Context Pack System

- **Intelligent file ranking** — Replaced blanket context-pack with scored file selection: explicit @mentions (1000), exact filename match (500), extension match (200), keyword match (100×N), import relationships (75), same-directory (50), session history (30), current project boost (40)
- **O(1) session file tracking** — New `session-file-tracker.ts` incrementally collects file references as messages arrive; eliminates O(n·m) regex re-scanning on every context generation (~100-500x improvement)
- **Auto-continue mechanism** — Detects LLM file read requests (`<request_file>`, "read X.ts", tool calls) and automatically generates follow-up context packs with requested files attached
- **Import map optimization** — Lazy scanning limited to 30 code files max; skips external packages (`react`, `lodash`, `@/` aliases); caches file contents to avoid reading same file multiple times
- **Project awareness** — `currentProjectPath` option prioritizes files in the active project, preventing LLM from editing wrong project when user has multiple sessions
- **Circular symlink protection** — `buildTreeString` now tracks visited directories to prevent infinite recursion

### 🎯 @mention Autocomplete (Client-Side)

- **`useFileMentionAutocomplete` hook** — Detects `@` pattern in textarea, fetches VFS file list via snapshot API, provides ranked suggestions with keyboard navigation (↑↓ Enter/Tab/Esc)
- **`FileMentionMenu` component** — Dropdown UI with file/folder icons, loading state, selected item scroll-into-view, keyboard shortcut hints
- **`FileMentionAutocompleteIntegration`** — Wraps existing Textarea in InteractionPanel while preserving all original behavior: voice input, file attachment, pending input queue, shift+enter newline, mobile scroll-into-view
- **Backend @mention extraction** — Chat route extracts `@filename.ext` patterns from last user message and passes as `includePatterns` for max-priority file ranking

### 🐛 Bug Fixes

- **`scoreFile()` early return** — Fixed exact filename match returning before accumulating extension/keyword/import signals; now accumulates all signals for accurate scoring
- **Session cleanup memory leak** — `cleanupExpiredSessions()` now auto-starts on module import (5-minute interval with `.unref()`)
- **XML injection** — Added `escapeXml()` for file paths and reason strings in XML-format context bundles
- **Null safety** — Added comprehensive null/length checks for `llmRequest.messages` access in both streaming and non-streaming paths
- **Import map filtering** — Skips bare imports (`react`, `lodash`), only tracks relative imports that reference local files; added path length validation (max 200 chars)
- **File request detection false positives** — Added word boundary checks, length validation (2-500 chars), space rejection for file patterns
- **VFS type mismatch** — Fixed `node.isDirectory` → `node.type === 'directory'` across `buildTreeString` and `collectAllFiles`; added missing `VirtualFile` properties (`language`, `createdAt`)

### 📦 New Files

- `web/lib/virtual-filesystem/session-file-tracker.ts` — O(1) incremental session file tracking with LRU eviction
- `web/hooks/use-file-mention-autocomplete.ts` — Client-side @mention detection and autocomplete hook
- `web/components/file-mention-menu.tsx` — Autocomplete dropdown UI component
- `web/lib/virtual-filesystem/__tests__/smart-context.test.ts` — Unit tests for session tracker, file detection, @mention extraction

### 📊 Performance

- Session file lookup: O(n·m) regex scan → O(1) Map lookup
- File content reads: 3× per file → 1× per file (caching)
- Import map: All files → max 30 code files
- Auto-cleanup: Manual → every 5 minutes with `.unref()`

### 🔧 Iteration 2 Fixes

- **Import resolution rewrite** — Complete rewrite from raw string matching to VFS-aware path resolution: handles relative paths (`./utils`, `../components`), extensionless imports, index file resolution (`index.ts`, `__init__.py`), cross-language support (JS/TS, Python, Rust, Go, CSS/SCSS, C/C++)
- **Race condition fix** — `fetchAllFiles()` now uses Promise-based guard instead of boolean flag, preventing concurrent duplicate API calls
- **Python dot-notation fix** — `.utils.helpers` → `./utils/helpers` (was producing `/utils/helpers`)
- **Rust crate import fix** — `use crate::module::Item` → `/module/Item` (was producing `//module/Item` double-slash)
- **Empty workspace state** — File mention menu now shows friendly "No files in workspace yet" message instead of blank dropdown
- **Session cleanup robustness** — Added triple-guard for `typeof process`, `typeof process.env`, and `NODE_ENV !== 'test'`
- **JSX nesting verification** — Verified `relative` div properly wraps Textarea + buttons + file selector without breaking form structure
- **Comprehensive test suite** — 20+ tests covering session tracking, file detection, @mention extraction, import resolution, and edge cases

---

## [Unreleased] — VFS Size Limits, MCP Tool Calling, and Security Hardening

### 🔴 Critical Security Fixes

- **OOM vulnerability on file uploads** — All API routes that accept file content now have O(1) `Content-Length` guards BEFORE buffering via `req.json()` or `req.formData()`. Prevents server crash from arbitrarily large payloads.
  - `/api/filesystem/write` — 110MB body limit
  - `/api/filesystem/import` — 120MB body + 100MB per-file via `File.size`
  - `/api/sandbox/sync` — 120MB body + 100MB per-file
  - `/api/sandbox/devbox` — 120MB body + 100MB per-file
  - `/api/sandbox/webcontainer` — 120MB body + 100MB per-file
  - GitHub import `fetchFileContent` — `Content-Length` check before `response.text()`

- **Cross-user data leak in MCP tools** — Replaced global mutable `setToolContext()` with `AsyncLocalStorage` request-scoped isolation. Each async execution chain gets its own isolated context; concurrent requests cannot corrupt each other's userId.

- **Error detail leakage to clients** — `/api/mcp` route and `/api/sandbox/webcontainer` no longer expose `error.message` (stack traces, internal paths) in responses. Returns generic "Internal server error" to clients; logs details server-side.

### 🏗 Architecture

- **VFS size limits raised to 100MB** — `MAX_FILE_SIZE` 10→100MB, `MAX_TOTAL_WORKSPACE_SIZE` 100→500MB, `fileContentSchema` Zod max 100MB. All limits consistent across 15+ files.
- **MCP tool calling wired into LLM chat** — `getMCPToolsForAI_SDK()` now includes `vfsTools` (write_file, read_file, apply_diff, delete_file, list_files, search_files, batch_write, create_directory). `callMCPToolFromAI_SDK()` routes `vfs_*` tool calls with proper `AsyncLocalStorage` userId context.
- **System prompt → tool calling** — Replaced XML tag-based editing instructions (`<file_edit>`, `WRITE <<<`, `<apply_diff>`) with function-calling instructions. Centralized in `packages/shared/agent/system-prompts.ts` as `VFS_FILE_EDITING_TOOL_PROMPT`. Old prompt preserved as comment for fallback.
- **Desktop shadow commit protection** — `ShadowCommitManager.commit()` strips file content from transactions in desktop mode (files already on disk). Only metadata (paths, types, timestamps) persisted as audit trail. Automatic pruning after each commit (keep last 20 per session).
- **Dead code cleanup** — `web/lib/mcp/server.ts` (standalone `StreamableHTTPServerTransport` server) moved to `deprecated/`. Zero callers; incompatible with Next.js architecture.

### 🐛 Bug Fixes

- **`ToolContext` type export crash** — Changed `ToolContext` from value export to `type` export in `web/lib/mcp/index.ts`. Was causing Next.js build failure ("Export ToolContext doesn't exist in target module").
- **Architecture integration re-exports** — Added `getMCPToolsForAI_SDK`, `callMCPToolFromAI_SDK`, and other architecture-integration exports to `web/lib/mcp/index.ts` barrel. `chat/route.ts` import was failing at build time.
- **Sandbox sync file size mismatch** — `sandbox-filesystem-sync.ts` hardcoded 5MB `MAX_FILE_SIZE_BYTES` silently dropped files that passed all other 100MB checks. Made configurable via `SANDBOX_SYNC_MAX_FILE_BYTES` env var with clear documentation.
- **VFS sync-back default mismatch** — `vfs-sync-back.ts` `maxFileSize` default was 10MB; aligned to 100MB.
- **pnpm workspace gap** — Added `packages/*` to `pnpm-workspace.yaml` to resolve `@bing/platform@workspace:*` dependency not found error.
- **Desktop `git-tools` shadow commit skip** — `if (Object.keys(vfsState).length > 0)` guard in `git_commit` tool was skipping commits entirely in desktop mode (since `vfsState` was `{}`). Changed to `if (transactions.length > 0)`.

### 📝 Files Changed

| File | Change |
|------|--------|
| `web/lib/virtual-filesystem/virtual-filesystem-service.ts` | `MAX_FILE_SIZE` 10→100MB, `MAX_TOTAL_WORKSPACE_SIZE` 100→500MB |
| `web/lib/validation/schemas.ts` | `fileContentSchema.max` 10→100MB |
| `web/app/api/filesystem/write/route.ts` | O(1) `Content-Length` guard, desktop mode vfs skip |
| `web/app/api/filesystem/import/route.ts` | O(1) `Content-Length` + `File.size` check |
| `web/app/api/sandbox/sync/route.ts` | O(1) `Content-Length` + per-file guard |
| `web/app/api/sandbox/devbox/route.ts` | O(1) `Content-Length` + per-file guard |
| `web/app/api/sandbox/webcontainer/route.ts` | O(1) `Content-Length` + per-file guard, error leak fix |
| `web/app/api/integrations/github/route.ts` | O(1) `Content-Length` in `fetchFileContent` |
| `web/lib/virtual-filesystem/import-service.ts` | Desktop mode skip vfs snapshot, `.length` size check |
| `web/lib/virtual-filesystem/git-backed-vfs.ts` | Desktop mode skip vfs snapshot build |
| `web/lib/virtual-filesystem/sync/vfs-sync-back.ts` | `maxFileSize` default 10→100MB |
| `web/lib/virtual-filesystem/sync/sandbox-filesystem-sync.ts` | Made `MAX_FILE_SIZE_BYTES` configurable via env var |
| `web/lib/sandbox/security-manager.ts` | `MAX_FILE_SIZE` 10→1GB (sandbox provider limit, not VFS) |
| `web/lib/middleware/filesystem-security.ts` | `maxFileSize` default 10→100MB |
| `web/lib/orchestra/stateful-agent/commit/shadow-commit.ts` | Desktop mode content strip, auto-prune (`void` fire-and-forget) |
| `web/app/api/chat/route.ts` | Desktop mode skip readFile loop, system prompt → tool-calling |
| `web/app/api/filesystem/rollback/route.ts` | Desktop mode skip readFile loop |
| `web/app/api/mcp/route.ts` | `AsyncLocalStorage` request-scoped context, error leak fix |
| `web/lib/mcp/vfs-mcp-tools.ts` | `AsyncLocalStorage` context, `batch_write` max(50) |
| `web/lib/mcp/index.ts` | Re-export architecture integration, `type ToolContext` fix |
| `web/lib/mcp/architecture-integration.ts` | VFS tools registered in tool list, execution routing |
| `packages/shared/agent/system-prompts.ts` | New `VFS_FILE_EDITING_TOOL_PROMPT` |
| `pnpm-workspace.yaml` | Added `packages/*` workspace glob |
| `web/lib/tools/git-tools.ts` | Desktop mode vfs skip, `transactions.length > 0` guard |
| `deprecated/web/lib/mcp/server.ts` | Moved from `web/lib/mcp/server.ts` (dead code) |

### ✅ How to Verify

```bash
# 1. Verify VFS tool registration (LLM sees file tools)
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Response should include: write_file, read_file, apply_diff, delete_file, etc.

# 2. Verify O(1) body size guard
curl -X POST http://localhost:3000/api/filesystem/write \
  -H "Content-Type: application/json" \
  -H "Content-Length: 999999999" \
  -d '{}'
# Should return 413 "Request body too large"

# 3. Verify desktop mode shadow commits strip content
# Set DESKTOP_MODE=true and check SQLite shadow_commits table:
# The `transactions` column should contain only {path, type} without content fields

# 4. Verify no cross-user data leak
# Make two concurrent requests with different x-user-id headers
# Each tool execution should use the correct userId via AsyncLocalStorage
```

### ⚠️ Breaking Changes

- **MCP system prompt change** — LLM is now instructed to use function calling (`write_file()`, `apply_diff()`) instead of XML tags (`<file_edit>`, `WRITE <<<`). Models that don't support tool calling may need the old tag-based prompt re-enabled (see commented block in `chat/route.ts`).
- **`setToolContext()` no longer global** — MCP tool context now uses `AsyncLocalStorage`. Any code calling `setToolContext()` outside of `toolContextStore.run()` will not affect tool execution. Use `toolContextStore.run({ userId, sessionId }, async () => ...)` instead.

### 🔮 Future Work

- **Streaming file import** — Replace `req.formData()` buffering with streaming multipart parser for imports >120MB
- **Desktop git repo integration** — Use actual git commits (not shadow commits) for desktop mode version tracking
- **Sandbox disk quota enforcement** — Add proactive disk usage monitoring per sandbox container
- **MCP tool response compression** — Large `read_file` results should be chunked/paginated

---

## [Unreleased] — Capability Consolidation & Powers System

### 🔴 Critical Bug Fixes

- **Naming collision in command validation** (`agent-loop-wrapper.ts`) — `validateShellCommand(validated.command, validateCommand)` was passing the method itself as the validation config. Fixed by importing `validateCommand` from security as `validateBlockedCommand`.
- **Tool routing silently failing** (`agent-loop.ts`) — `toolNameToCapability` mapped snake_case names (`exec_shell`) but LLM providers call tools by camelCase (`execShell`). Routing now falls through to original name on no match.
- **Capability chain tool was plain object, not Vercel `Tool`** (`stateful-agent.ts`) — `additionalTools.runCapabilityChain` was a raw `{ description, parameters, execute }` object passed to `generateText`. Wrapped in `tool()` factory.
- **Empty files treated as read failures** (`tool-executor-wrapper.ts`) — `!readResult.content` returned `true` for empty strings. Fixed to check `=== undefined || === null`.
- **VFS updated before sandbox write, creating inconsistency** (`tool-executor-wrapper.ts`) — `writeFile()` updated VFS first, then sandbox. If sandbox write failed, VFS had stale data. Reversed order: sandbox first, VFS only on success.
- **`require()` in ES modules** (`bing-handlers.ts`) — `require('../router')` replaced with `await import('../router')`. `registerbinGHandlers()` now async.
- **`require('ai')` in ES modules** (`powers/index.ts`) — Replaced with `await import('ai')`. `buildPowerTools()` now async.
- **WASM runner instance per call** (`powers/index.ts`, `invoke.ts`) — `new WasmRunner()` on every invocation wasted module cache. Now uses exported `globalRunner` singleton.
- **Empty enum crashes zod** (`powers/index.ts`) — `z.enum([] as [string, ...string[]])` throws. Added guard: empty arrays return `z.any()`.
- **`executeCapability` swallowed all errors** (`tool-executor-wrapper.ts`) — Catch block returned `{ success: false }` silently. Removed catch; errors now propagate so callers can handle them explicitly.
- **Consensus check broken — string equality impossible** (`bing-handlers.ts`) — `checkConsensus` compared full LLM response strings which never match character-for-character. Replaced with keyword-overlap 2/3 threshold algorithm.
- **Majority vote returned first item, not majority** (`bing-handlers.ts`) — Fixed to return median-length response as proxy for "most reasoned".
- **Hardcoded `openrouter` provider** (`bing-handlers.ts`) — `handleAgentLoop` now derives provider from model name prefix (gpt→openai, claude→anthropic, gemini→google).
- **Post-execution hooks could fail main execution** (`stateful-agent.ts`) — `recordAgencyExecution` and `triggerSkillBootstrap` now wrapped in try/catch with warning logs. Failures are non-fatal.
- **Fork bomb regex incomplete** (`tool-executor-wrapper.ts`) — Fixed pattern to match spacing variations: `:(){ :|:& };:` → `:\(\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;`.
- **`CAPABILITIES_BY_CATEGORY` hardcoded category list** (`capabilities.ts`) — Now derives categories dynamically from `ALL_CAPABILITIES` using `Set`. New categories auto-appear.
- **Placeholder research functions returned fake data** (`bing-handlers.ts`) — `performSearch`, `analyzeSource`, `synthesizeResearch` now return empty/results with TODO markers instead of fabricated search results.

### 🏗 Architecture

- **Powers System** (`web/lib/powers/`) — User-installable, WASM-sandboxed skill capabilities. Less formal than native capabilities, customizable via SKILL.md + optional WASM handlers. Includes:
  - `index.ts` — PowersRegistry, executePower, buildPowerTools, buildPowersSystemPrompt, jsonSchemaToZod
  - `market.ts` — Marketplace index, install/search, parseSkillMd
  - `invoke.ts` — InvokeSkill orchestration (policy → WASM → artifacts)
  - `powers-cli.ts` — CLI: list, show, install, uninstall, search, add
  - `use-power.ts` — React hook for marketplace UI
  - `wasm/` — Wasmtime WASI runner with host_read/write/fetch/poll/log/getrandom, AsyncFetchQueue, SimpleVFS, Rust example handler
- **System prompt integration** (`packages/shared/agent/system-prompts.ts`) — Added `generatePowersBlock()` and `composePromptWithPowers()` for injecting user-installed powers into role system prompts.
- **Skill store service** (`web/lib/services/skill-store.ts`) — DB-backed CRUD with reinforcement tracking, tag search, top skills by success rate.
- **Skill bootstrap event** (`web/lib/events/schema.ts`) — Added `SkillBootstrapEvent` to Zod union and EventTypes enum. `scheduleSkillBootstrap()` now emits via event bus.
- **24 new capabilities added to ALL_CAPABILITIES** — `computer_use.*` (4), `mcp.*` (2), `process.*` (3), `preview.*` (2), `file.sync`, `file.batch_write`, `code.run`, `code.ast_diff`, `code.syntax_check`, `workspace.stats`, `workflow.*` (6).
- **BootstrappedAgency wired into StatefulAgent.run()** — Records executions for pattern learning, triggers skill bootstrap on success.
- **Capability chain tool in editing phase** — StatefulAgent now exposes `run_capability_chain` tool to LLM for multi-step workflows.
- **Bootstrapped agency in agent-loop** — Agent loop now uses Agency for adaptive capability selection.

### 🔒 Security

- **Fork bomb pattern improved** — Regex now catches spacing variations
- **WASM sandbox enforced** — Powers run in Wasmtime with memory caps (8 MB), timeouts (30s), host allowlists, VFS path prefixes
- **Artifact path normalization** — Prevents double-slash path injection in WASM artifact persistence

### 🗑️ Deleted

- `packages/shared/agent/tool-router/` — Dead code, never imported anywhere
- `web/lib/tools/tool-integration/router.ts` — Inlined into `tool-integration-system.ts` (ToolProviderRouter → private methods)
- `web/lib/powers/powers-registry.ts` — Merged into `index.ts` with tag indexing, capability indexing, override protection
- `web/lib/powers/powers-manager.ts` — Identical to existing `skills-manager.ts`
- `web/lib/powers/prompt-engineering.ts` — Identical to existing prompt engineering in `skills/`
- `web/lib/powers/readme.txt` — Chat log, not documentation
- `web/lib/powers/SKILL.md` — Example skill, not needed as code

### 📝 Environment Variables

- `STATEFUL_AGENT_ENABLE_CAPABILITY_CHAINING` — Defaults to `true` (was `false`)
- `STATEFUL_AGENT_ENABLE_BOOTSTRAPPED_AGENCY` — Defaults to `true` (was `false`)
- `USE_STATEFUL_AGENT` — Defaults to `!== 'false'` (was `=== 'true'`)
- `AI_SDK_MAX_STEPS` — Default changed from `10` to `15`


 -        * ─────────────────────────────────────────────────────────────                                                               │
  │    3686 -        * COMMENTED OUT — Old tag-based editing instructions.                                                                         │
  │    3687 -        * Re-enable this block (and replace VFS_FILE_EDITING_TOOL_PROMPT below)                                                       │
  │    3688 -        * if you need to fall back to <file_edit> / APPLY_DIFF / WRITE <<<                                                            │
  │    3689 -        * tag-based parsing instead of MCP tool calling.                                                                              │
  │    3690 -        *                                                                                                                             │
  │    3691 -        * For file changes, prefer one of these parseable schemas:                                                                    │
  │    3692 -        *                                                                                                                             │
  │    3693 -        * CAPABILITY CHOICE:                                                                                                          │
  │    3694 -        * - For modifying an existing file, use APPLY_DIFF first.                                                                     │
  │    3695 -        * - For creating a brand-new file, use WRITE or <file_edit path="...">...</file_edit>.                                        │
  │    3696 -        * - For deleting a file, use DELETE <path>.                                                                                   │
  │    3697 -        * - For reading or referring to existing workspace content, use <file_read path="..." /> when needed.                         │
  │    3698 -        * - For shell/runtime instructions meant for the user terminal, emit a single ```bash block.                                  │
  │    3699 -        *                                                                                                                             │
  │    3700 -        * FOR EXISTING FILES, prefer surgical edits (APPLY_DIFF) over full rewrites:                                                  │
  │    3701 -        *   <apply_diff path="src/utils.ts">                                                                                          │
  │    3702 -        *     <search>function oldName() {                                                                                            │
  │    3703 -        *       return 1;                                                                                                             │
  │    3704 -        *     }</search>                                                                                                              │
  │    3705 -        *     <replace>function newName() {                                                                                           │
  │    3706 -        *       return 2;                                                                                                             │
  │    3707 -        *     }</replace>                                                                                                             │
  │    3708 -        *   </apply_diff>                                                                                                             │
  │    3709 -        * Or in fs-actions blocks:                                                                                                    │
  │    3710 -        *   APPLY_DIFF <path>                                                                                                         │
  │    3711 -        *   <<<                                                                                                                       │
  │    3712 -        *   <exact code to find>                                                                                                      │
  │    3713 -        *   ===                                                                                                                       │
  │    3714 -        *   <replacement code>                                                                                                        │
  │    3715 -        *   >>>                                                                                                                       │
  │    3716 -        *                                                                                                                             │
  │    3717 -        * FOR NEW FILES, use full writes:                                                                                             │
  │    3718 -        * 1) <file_edit path="...">...</file_edit>                                                                                    │
  │    3719 -        * 2) COMMANDS write_diffs                                                                                                     │
  │    3720 -        * 3) ```fs-actions ...``` blocks with:                                                                                        │
  │    3721 -        *    WRITE <path>                                                                                                             │
  │    3722 -        *    <<<                                                                                                                      │
  │    3723 -        *    <full file content>                                                                                                      │
  │    3724 -        *    >>>                                                                                                                      │
  │    3725 -        *    PATCH <path>                                                                                                             │
  │    3726 -        *    <<<                                                                                                                      │
  │    3727 -        *    <unified diff body>                                                                                                      │
  │    3728 -        *    >>>                                                                                                                      │
  │    3729 -        *    DELETE <path>                                                                                                            │
  │    3730 -        *                                                                                                                             │
  │    3731 -        * IMPORTANT: For edits to existing files, ALWAYS use APPLY_DIFF instead of WRITE.                                             │
  │    3732 -        * APPLY_DIFF only replaces the exact block you specify, preventing context truncation.                                        │
  │    3733 -        * Use WRITE only when creating new files or when a complete rewrite is explicitly needed.                                     │
  │    3734 -        * Do not rewrite whole existing files unless the user explicitly wants a full rewrite.                                        │
  │    3735 -        *                                                                                                                             │
  │    3736 -        * DIFF AUTHORING RULES:                                                                                                       │
  │    3737 -        * - The <search> block or APPLY_DIFF search section must match the existing code exactly, including spacing and punctuation.  │
  │    3738 -        * - Keep each diff surgical and minimal; prefer multiple small APPLY_DIFF operations over one large rewrite.                  │
  │    3739 -        * - Include enough surrounding context in the search block to uniquely identify the target.                                   │
  │    3740 -        * - If multiple files are involved, emit one operation per file rather than mixing contents.                                  │
  │    3741 -        *                                                                                                                             │
  │    3742 -        * DIFF-BASED SELF-HEALING:                                                                                                    │
  │    3743 -        * - If an edit might fail because surrounding code may have drifted, first read/reference the latest file content and then    │
  │         emit a narrower APPLY_DIFF.                                                                                                            │
  │    3744 -        * - If a search block is large, brittle, or repeated, reduce it to the smallest unique exact block.                           │
  │    3745 -        * - If an earlier attempted patch likely failed, do not repeat the same broad patch; emit a corrected APPLY_DIFF with fresher │
  │         exact context.                                                                                                                         │
  │    3746 -        * - Prefer preserving user code and making the minimum viable edit rather than replacing entire functions or files.           │
  │    3747 -        * Prefer concrete multi-file edits when user requests full project scaffolding.                                               │
  │    3748 -        *                                                                                                                             │
  │    3749 -        * To read a file from the workspace, use: <file_read path="..." />                                                            │
  │    3750 -        *                                                                                                                             │
  │    3751 -        * When the user asks how to run code, include shell commands in ```bash blocks.                                               │
  │    3752 -        * The user has a terminal that can execute these commands.                                                                    │
  │    3753 -        * For multi-step setups, provide all commands in a single bash block so they can be run together.                             │
  │    3754 -        * Use bash blocks for user-facing commands only; use filesystem edit schemas for file mutations.                              │
  │    3755 -        * If a task is too large for a single response, end with the exact token: [CONTINUE_REQUESTED]                                │
  │    3756 -        * Example: ```bash                                                                                                            │
  │    3757 -        * npm install                                                                                                                 │
  │    3758 -        * npm run dev                                                                                                                 │
  │    3759 -        * ```                                                                                                                         │
  │    3760 -        * ─────────────────────────────────────────────────────────────                                                               │
  │    3761 -        */                                                                                                                            │
  │    3762 -       VFS_FILE_EDITING_TOOL_PROMPT,

## [Unreleased] — VFS Tool Calling Robustness + Parser Hardening + Session Scope Fixes

### 🔴 Critical Bug Fixes

- **`batchWrite` duplicate GitVFS buffering (4-6x per write)** — Each write file operation buffered the same change multiple times because `trackTransaction()` and `changeBuffer` independently tracked changes with no deduplication. Fixed: `trackTransaction()` now removes existing entries for same path before adding; `handleFileChange()` deduplicates by path+version in `changeBuffer`; `commitChanges()` uses Set-based O(1) deduplication when merging buffers.
- **VFS MCP tool call args empty (`args: {}`)** — Vercel AI SDK's `tool-result` stream chunks don't include args. The `toolCallArgsCache` in `vercel-ai-streaming.ts` now caches args from `tool-call` chunks and recovers them in `tool-result` chunks. Route.ts now omits the `args` field entirely from SSE events when empty instead of emitting `{}`.
- **Empty tool_call SSE events from Vercel AI SDK** — Models without function calling support produced partial tool call chunks with empty args. Added filter in `route.ts` to skip emitting `tool_call` events when `args` is empty — only `tool_invocation` result events are emitted.
- **`/project/` paths rejected by read/write/delete APIs (400)** — Validation schemas in `read/route.ts`, `write/route.ts`, and `delete/route.ts` only allowed `/home/`, `/workspace/`, or `/tmp/` for absolute paths. Added `/project/` to all three schemas.
- **Session scope not flowing to VFS tools** — `scopePath` was computed in `route.ts` but never passed through the LLM request chain to `enhanced-llm-service.ts` → `vercel-ai-tools.ts` → `toolContextStore.run()`. Added `scopePath` to `RouterRequest` interface, `EnhancedLLMRequest` interface, and threaded it through all call sites.
- **`@bing/platform/env` import resolution error in tests** — Missing `"./env"` export in `packages/platform/package.json`. Added export entry.
- **`vitest.config.ts` missing** — Created with proper `@/` and `@bing/*` aliases for test module resolution.

### 🛠 Parser Hardening (`parseBatchWriteFiles`)

- **Raw control character sanitization** — LLMs often emit unescaped `\n`, `\t`, `\r` inside JSON string values. Added `sanitizeJsonString()` that walks text character-by-character tracking quote state and escapes raw control chars.
- **Trailing comma support** — LLMs commonly output `[{...},]`. Added `text.replace(/,\s*([}\]])/g, '$1')` fallback before sanitization.
- **Single-quote normalization** — LLMs output `"{'path':'a','content':'b'}"`. Added `text.replace(/'/g, '"')` fallback.
- **Invalid entry filtering** — `[{...}, null, "string"]` now filters to only valid objects. `filterValidFiles()` removes non-objects and nulls.
- **Unified `parseAndValidate()`** — All parse paths now use a single function that handles parse + validate + filter, eliminating code duplication.

### 📋 Test Infrastructure

- **`vitest.config.ts`** — Added with `@/` and `@bing/*` aliases for proper module resolution.
- **116 batch-write-parser tests passing** — 88 standalone + 28 production parser tests.
- **`@bing/platform/package.json`** — Added `"./env"` export for test import resolution.

### 📝 System Prompt Improvements

- **`VFS_FILE_EDITING_TOOL_PROMPT`** — Rewritten to be explicit: "CRITICAL: All file operations MUST use the provided filesystem tools via function/tool calling." Includes exact parameter formats, numbered critical rules, and forbids XML tags/heredocs.
- **Removed 80-line commented-out XML tag instructions** from `route.ts` that confused models about which format to use.                              

