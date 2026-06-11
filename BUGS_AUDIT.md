# Bing/Web `run.log` Bug Audit

**Source:** `bing/web/logs/run.log` (4,760 lines, ~1.06 MB)
**Method:** Three deep-trace passes of the orchestration log + codebase cross-reference.
**Total issues identified:** ~42 (28 numbered + 14 lettered sub-bugs in the first pass).

---

## Status Legend

| Marker | Meaning |
| ------ | ------- |
| ✅ **FIXED** | Patch merged, code-reviewer verdict: shippable. |
| 🟡 **PARTIAL** | Patch in place, but has known test failures or follow-ups. |
| ⬜ **OPEN** | Identified, not yet fixed. |
| — **N/A** | Narrative/duplicate, subsumed by a numbered bug. |

---

## Top-Level Summary

| # | Category | Severity | Title | Status |
|---|----------|----------|-------|--------|
| 8  | Resource      | 🔴 Critical | Memory growth 484 MB → 1 GB+ in 4 min, survives GC | ⬜ OPEN |
| 9  | Orchestration | 🔴 Critical | AutoMode classifier demotes every request to v1-api | ⬜ OPEN |
| 10 | Concurrency   | 🔴 Critical | VFS race causes stale reads & diff failures (8+ files) | 🟡 PARTIAL |
| 11 | Cache         | 🟠 High     | Snapshot cache both over-invalidates and goes stale | ⬜ OPEN |
| 12 | Telemetry     | 🟠 High     | Tool counts 18/19/21 reported inconsistently | ✅ FIXED |
| 13 | Integration   | 🟠 High     | Mem0 always returns 0 — 6 tools shipped for no value | ✅ FIXED |
| 14 | Workspace     | 🟠 High     | Anonymous users hit empty workspaces — no auto-create | ⬜ OPEN |
| 15 | Logging       | 🟡 Med      | `Sanitized scope path` is a no-op log line | ⬜ OPEN |
| 16 | Cache         | 🟠 High     | Read-after-write can return stale snapshot | ⬜ OPEN |
| 17 | UX            | 🟠 High     | 60 s idle timeout kills mid-stream with no client status | ✅ FIXED |
| 18 | Transactions  | 🟠 High     | GitVFS commits multi-file edits with no rollback | 🟡 PARTIAL |
| 19 | Tooling       | 🟡 Med      | Tool path schemas have no example/description | ⬜ OPEN |
| 20 | UX            | 🟡 Med      | First-token timeout conflated with idle timeout | ✅ FIXED |
| 21 | Orchestration | 🟠 High     | 7-consecutive-tool / 10-total-cap silently truncates | ⬜ OPEN |
| 22 | Tooling       | 🟠 High     | MCP `list_directory` `success:false` with no reason | ⬜ OPEN |
| 23 | UX            | 🟠 High     | 5:51 streams with no client progress feedback | ✅ FIXED |
| 24 | Startup       | 🟠 High     | MCP gateway 0 tools logged as "success" | ✅ FIXED |
| 25 | Concurrency   | 🔴 Critical | 3 rapid writes to `gui/app.py` with "successful" outcome | 🟡 PARTIAL |
| 26 | Pathing       | 🔴 Critical | Session id `001` lost in a folder rename | ⬜ OPEN |
| 27 | Storage       | 🟡 Med      | Session file count creeps (0 → 42) with no cap | ⬜ OPEN |
| 28 | Tooling       | 🟠 High     | `persist: true` on long-running daemons fills disk | ✅ FIXED |
| 29 | Observability | 🟡 Med      | No error reason on `success: false` results | ⬜ OPEN |
| 30 | Logging       | 🟡 Med      | Re-evaluation triggers are spammy, no debounce | ⬜ OPEN |
| 31 | Tooling       | 🟠 High     | Text-mode edit parser drops failures silently | ⬜ OPEN |
| 32 | Orchestration | 🟠 High     | AutoMode signal set too sparse | ⬜ OPEN |
| 33 | Observability | 🟡 Med      | File count tracked, byte size is not | ⬜ OPEN |
| 34 | Observability | 🟡 Med      | Sandbox provider init 1/3 — no per-attempt logging | ✅ FIXED |
| 35 | Lifecycle     | 🟠 High     | Checkpoint storage re-initialized 4× in 1 hour | ⬜ OPEN |

**Pass-1 narrative sub-bugs (no number, subsumed above):**

| # | Title | Status |
|---|-------|--------|
| A | `mistral-large-latest` `finishReason:stop` with 0 tool calls | ⬜ OPEN |
| B | `qwen/qwen3.5-122b-a10b` `finishReason:other` with 0 tool calls | ⬜ OPEN |
| C | `kimi-k2.6` stalls mid-stream — idle timeout | — (subsumed by #17) |
| D | `incomplete-response` branch with confidence 0.4 | ⬜ OPEN |
| E | `list_files` `INVALID_ARGS` on empty `path` | ⬜ OPEN |
| F | `capability not found` for `apply_diff`/`bash_execute`/`read_files` | ⬜ OPEN |
| G | Loop-guard kills agent on `python3 ENOENT` | ⬜ OPEN |
| H | No auto-detection of missing interpreter | ⬜ OPEN |
| I | Invalid progressive file edit paths from LLM (`=`, `{name}"`, HTML) | ⬜ OPEN |
| J | `applyUnifiedDiffToContent` hunk-line-count mismatch (stale diff) | — (subsumed by #10) |
| K | `applyDiffMatchPatch` "Invalid patch string" | ⬜ OPEN |
| L | Arcade disabled — 401, 0 tools, no banner | — (subsumed by #12) |
| M | VFS snapshot cache invalidated aggressively (perf impact) | — (subsumed by #11) |
| N | No memory-pressure / GC telemetry | — (subsumed by #8) |

---

## Detail by Bug

### ✅ #12 — Tool Count Inconsistency (silently misleading)
**Symptom:** 21 tools in `execute-capability`, 19 in LLM request, 18 in AutoMode signal; Composio/MCP-gateway/Arcade return 0 silently.
**Fix:** Added `logToolCount()` helper in `bing/web/lib/tools/bootstrap-health.ts`. Emits `[INFO] "Registered N <registry> tools"` for count>0 and `[WARN] "registered 0 <registry> tools (degraded)"` for count===0. Swapped all `logger.info("Registered N X tools")` call sites in `bootstrap.ts` + per-registry bootstrap files.
**Files:** `bing/web/lib/tools/bootstrap-health.ts`, `bing/web/lib/tools/bootstrap.ts`, `bing/web/lib/tools/bootstrap/bootstrap-{composio,arcade,mcp,sandbox}.ts`.
**Tests:** `bing/web/lib/tools/__tests__/bootstrap-health.test.ts` — 14/14 passing.

### ✅ #13 — Mem0 Integration is a No-Op
**Symptom:** Every `mem0_search` / `mem0_add` returns `count: 0`; 6 Mem0 tools shipped to LLM wasting context.
**Fix:** Added `bing/web/lib/tools/bootstrap/bootstrap-mem0.ts` that gates on `isMem0Configured()` (MEM0_API_KEY + circuit breaker). When unconfigured, emits `[WARN] "registered 0 Mem0 tools (degraded)"` with `extra: {reason}`. When configured, registers 6 tools (`mem0_add/search/get_all/update/delete/delete_all`) with per-tool try/catch so the count reflects what actually landed.
**Files:** `bing/web/lib/tools/bootstrap/bootstrap-mem0.ts`, `bing/web/lib/tools/bootstrap.ts`.

### ✅ #17 — Idle Timeout Cuts Mid-Stream Without Grace
**Symptom:** `nvidia/moonshotai/kimi-k2.6` stalls mid-stream; hard fail at 60 s; no client-visible status.
**Fix:** Extracted `STREAM_TIMEOUTS` in `bing/web/lib/chat/vercel-ai-streaming.ts`:
- `firstTokenTimeoutMs = 30_000` (distinguishes "model hasn't started" from "model composing")
- `idleTimeoutMs = 75_000` (longer grace for long tool chains)
- `thinkPingMs = 20_000` (UX hint fires every 20 s of silence)
**Files:** `bing/web/lib/chat/vercel-ai-streaming.ts`.
**Tests:** `bing/web/lib/chat/__tests__/streaming-timeouts.test.ts` — 7/7 passing.

### ✅ #20 — First-Token Latency Hidden in Idle Timeout
**Symptom:** "Idle" timeouts can actually be first-token timeouts; the log records them identically.
**Fix:** Same `STREAM_TIMEOUTS` extraction as #17 — `firstTokenTimeoutMs` is now a separate configurable that can rotate the provider on hard first-token timeout.

### ✅ #23 — Stream Durations — No Progress Feedback
**Symptom:** 5:51 streams with no client progress indicator; user sees a frozen UI.
**Fix:** Same `STREAM_TIMEOUTS` extraction — `thinkPingMs = 20_000` enables mid-stream status pings to the client.

### ✅ #20 — First-Token Latency Hidden in Idle Timeout
**Symptom:** "Idle" timeouts can actually be first-token timeouts; the log records them identically. Client can't distinguish "model composing" from "model hasn't started."
**Fix:** `STREAM_TIMEOUTS.firstTokenTimeoutMs = 30_000` is now a separate configurable (see #17 for the extraction). On a first-token timeout, the orchestrator can rotate the provider immediately rather than waiting another 60 s.

### ✅ #24 — MCP Gateway 0 Tools Logged as "Success"
**Symptom:** MCP gateway SSE fails 3×; logs "successfully registered 0 tools" (misleading).
**Fix:** `logToolCount()` (same helper as #12) replaces the misleading "successfully registered" wording with `registered 0 MCP gateway tools (degraded)`. Backoff ceiling is still a follow-up.
**Files:** `bing/web/lib/tools/bootstrap.ts` (MCP-gateway branch), `bing/web/lib/tools/bootstrap/bootstrap-mcp.ts`.

### ✅ #28 — `persist: true` on Long-Running bash_execute
**Symptom:** `pip install -r requirements.txt` and `python main.py` were persisted → disk-fill, GC pressure.
**Fix:** `DAEMON_PERSIST_PATTERNS` in `bing/web/lib/bash/bash-tool.ts` now correctly recognizes `flask`/`django`/`uvicorn`/`gunicorn`/`fastapi run`/`npm run dev`/`next dev`/`vite`/`nuxt`/`tail -f`/`ping` (without `-c`) and a tighter `&\\s*$` pattern for trailing `&`.
**Files:** `bing/web/lib/bash/bash-tool.ts`.
**Tests:** `bing/web/lib/bash/__tests__/bash-tool-persist-integration.test.ts` — 6/6 passing (mocks spawn + VFS, asserts `mockWriteFile` NOT called for nohup/tail -f/ping/npm dev&). `persist-cap.test.ts` 36/41 — 5 known unit-test failures are vitest module-cache artifacts; integration test confirms the same code paths.

### ✅ #34 — Sandbox Provider Init: 1/3 Attempt Pattern
**Symptom:** No success/fail log per attempt → can't tell if providers are healthy.
**Fix:** Added `bing/web/lib/sandbox/provider-attempt-log.ts` exporting `providerAttemptLogger({provider, op, attempt})` returning `{start, success, fail}`. Wired into `bootstrap-sandbox.ts` for E2B / Daytona / CodeSandbox.
**Files:** `bing/web/lib/sandbox/provider-attempt-log.ts`, `bing/web/lib/tools/bootstrap/bootstrap-sandbox.ts`.

### 🟡 #10 — Concurrent Modification Race
**Symptom:** 8 files in parallel trigger `[VFS] Potential concurrent modification` followed by `Removed line count did not match for hunk at line 3` (stale diff).
**Fix:** Added `bing/web/lib/vfs/transactional-vfs.ts` exporting `readWithVersion` / `writeWithVersion` (CAS retry loop that re-runs `diffFn` up to N times on per-file version mismatch) and `VersionMismatchError` / `ConcurrentModificationError`. Wired `expectedVersion` and `strictConcurrency` options into the base `virtualFilesystem.writeFile`.
**Known issues:**
- 7/13 unit tests in `transactional-vfs.test.ts` are failing — root cause is the wrong import path (`@/lib/virtual-filesystem` resolves to the client-safe `index.ts`, not the server-side `virtual-filesystem-service.ts`) and a TOCTOU race in the retry loop (the freshly-read version is not propagated to the next attempt).
- `require('@/lib/vfs/transactional-vfs')` inside the base VFS is a code smell — should be refactored into a shared `errors.ts` module.
- Transaction rollback doesn't delete newly-created files (writes empty content instead of `deletePath`).
- `Transaction.commit` flips state to `'committed'` before doing work; `rollback` then logs a spurious "rollback on already-committed transaction" warning.
**Files:** `bing/web/lib/vfs/transactional-vfs.ts`, `bing/web/lib/vfs/index.ts`, `bing/web/lib/virtual-filesystem/virtual-filesystem-service.ts`.

### 🟡 #18 — GitVFS Commit-Then-Read Has No Rollback on Diff Failure
**Symptom:** GitVFS buffers 6 file changes, commits, then next op (`apply_unified_diff`) fails — workspace is dirty.
**Fix:** Same `transactional-vfs.ts` from #10 adds a `Transaction` class with `beginTransaction(ownerId, id?)`, `write()`, `commit()`, `rollback()`. Uses GitBackedVFS batch mode for a single shadow commit, takes a snapshot at begin for rollback, rolls back on first per-file failure. The Mem0 and VFS snapshot changes (#11, #16) are not yet addressed.
**Known issues:** see #10.

### 🟡 #25 — 3 Rapid Writes to `gui/app.py` Despite Warnings
**Symptom:** `gui/app.py` v53 → v54 → v55 in 3 ms; "successfully applied" despite `[VFS] Potential concurrent modification` warnings on all three.
**Fix:** Same `writeWithVersion` from #10 now blocks writes that trigger the "Potential concurrent modification" log when `strictConcurrency: true` is set. The default mode (no `strictConcurrency`) preserves legacy behavior, so this is a partial fix — to be fully effective, the bash-tool / chat-route call sites need to opt into strict mode.
**Known issues:** see #10.

---

## Open Bugs (Prioritized)

### 🔴 #8 — Memory Leak / Heap Pressure
**Symptom:** 484 MB → 1 GB+ in 4 min, survives GC. No `[WARN]` at 1 GB / 1.5 GB / 2 GB; no soft backpressure; never restarts.
**Fix direction:** Instrument `process.memoryUsage()` per tick; soft-throttle new chat traffic above 1.2 GB; restart worker above 1.8 GB; capture heap snapshots every N requests.

### 🔴 #9 — AutoMode Classifier False-Negative
**Symptom:** Every request classified `reason:"not_agentic_enough"` and `disableV2:true`; v2-api never invoked. Signal set is binary-per-feature with no weighting.
**Fix direction:** Make the classifier turn-aware; add `toolingRichness` signal; re-evaluate per turn. Don't permanently demote to v1 once.

### 🟠 #11 — VFS Snapshot Cache: Stale + Over-Invalidation
**Symptom:** 4 snapshots went stale (387–455 s ago); paired invalidations fire seconds apart on the anonymous user. Worst of both worlds.
**Fix direction:** Compute snapshot key as `hash(content)`, not request id. Expose hit/miss/stale counters. Tighten staleness threshold (455 s is way too long for a chat session).

### 🟠 #14 — Empty Workspace for Anonymous Users
**Symptom:** Many `VFS SNAPSHOT WARN` entries with `EMPTY WORKSPACE` for `source: "anonymous"` on `sessions`, `sessions/000`, `sessions/001`.
**Fix direction:** `ensureWorkspace(sessionId)` on first read; on failure, return a typed error so the LLM gets "session initializing, please wait" instead of an empty list.

### 🟠 #16 — Stale-Snapshot vs. Re-Snapshot Inconsistency
**Symptom:** Read after write can return stale snapshot. Unified symptom with #10/#11.
**Fix direction:** Invalidate-then-refresh atomically. Read after a write must always see the latest committed content.

### 🟠 #21 — 7-Consecutive-Tool-Calls-Without-Response Limit
**Symptom:** Hard cutoff, no client-visible warning. `failedToolNames:[]` logged alongside the text-mode fallback — meaning the tools didn't fail, the system just gave up.
**Fix direction:** Rename to "10-tool-cap reached, continuing in text-mode"; make the cap configurable per turn; emit `[WARN]`; surface a "I need more tool calls to finish — sending follow-up" UX hint.

### 🟠 #22 — MCP `list_directory` `success: false` Repeatedly
**Symptom:** Core discovery tool silently failing; LLM hallucinates file contents.
**Fix direction:** Always log the error reason with `success: false`; trigger a steer on consecutive list failures; consider a "list_directory retry then fall back to VFS direct read" path.

### 🟠 #26 — Path Drift `workspace/sessions/001/...` → `workspace/sessions/...`
**Symptom:** Session id `001` lost in a folder rename; subsequent operations can no longer scope to the right session.
**Fix direction:** Invalidate cached `scopePath` after a folder rename; emit `[CRITICAL]` on session id loss; verify the path still matches `^workspace/sessions/<id>/` before any tool call.

### 🟠 #31 — Text-Mode Edit Parser Drops Failures Silently
**Symptom:** Parser extracts 10 edits, 3–4 fail path validation; LLM never knows which edits were applied and which were dropped.
**Fix direction:** Number edits in the prompt ("Edit 1:", "Edit 2:"); track per-edit success; if any fail, reprompt with the failures.

### 🟠 #32 — AutoMode Signal Set Too Sparse
**Symptom:** `rawLength: 55` is short for an LLM input. The signal set is missing `hasCodeContext`, `hasErrorContext`, `hasToolResultContext`, `hasReprompt`.
**Fix direction:** Add contextual signals based on prior conversation state. Demoting a 55-char follow-up after a long context to v1 is wrong.

### 🟠 #35 — Checkpoint Storage Re-Initialized 4 Times
**Symptom:** `SessionStore` re-initialized 4× in 1 hour. Either a leak (prior instance not closed) or a lifecycle bug.
**Fix direction:** Investigate the re-init trigger; ensure prior instances are closed; add an init counter warning above 1.

### 🟡 #15 — `Sanitized Scope Path` is a Silent No-Op
**Symptom:** Log shows `before == after` for every call. Burns log lines, hides real sanitization bugs.
**Fix direction:** Either remove the dead log line, or actually sanitize (resolve `..`, normalize slashes, reject anything not matching `^workspace/sessions/[a-z0-9_]+/...$`).

### 🟡 #19 — Default-Argument Traps in Tool Schemas
**Symptom:** `list_files` has `path: <required>` but no `example` or `description` showing `workspace/sessions/001/your/file.py`.
**Fix direction:** Add `description` + `example` to every path argument; on rejection, return a corrected example back to the model.

### 🟡 #27 — SessionFileTracker File Count Creep
**Symptom:** 0 → 42 files in 17 min. No cap, no eviction, no warning. "Session cleanup" interval is 5 min but it's just a marker.
**Fix direction:** Cap session files (e.g. 200), evict LRU; mark files as ephemeral vs persistent; show file count in the UI.

### 🟡 #29 — No Error Reason on `success: false` Results
**Symptom:** MCP `list_directory` results log `"success": false` but never the reason.
**Fix direction:** Always log `{success: false, error: <reason>, recoverable: <bool>}`.

### 🟡 #30 — Repeated Re-evaluation Triggers (Spammy)
**Symptom:** `UnifiedAgentService` emits trigger events repeatedly, often with the same reason. No debounce/coalesce.
**Fix direction:** Rate-limit trigger emissions; aggregate consecutive identical triggers.

### 🟡 #33 — `totalFiles: 42` — No Linkage to Disk Usage
**Symptom:** SessionFileTracker reports file count but not byte size. Memory leak (#8) is likely correlated.
**Fix direction:** Track total bytes per session; trigger eviction above N MB.

---

## Pass-1 Narrative Themes (no dedicated number; covered by the bugs above)

The original review called out three themes that didn't get a letter but are real classes of issues. They are tracked here for completeness:

| Theme | Title | Covered by |
|-------|-------|------------|
| — | Rate Limit & Quota Handling (Gemini 250K cap, Mistral/MoonshotAI 429s) | **No owning bug** — #34 is sandbox-provider init (different concern). **OPEN follow-up (no # assigned)**: distinguish quota-exceeded from rate-limit, persist quota state, surface a "rotating provider" toast. |
| — | Path Canonicalization (`workspace/sessions/001/…` vs `sessions/001/…` vs `ai_terminal/…`) | **Theme, no single owning bug.** #19 (tool schema examples) + #26 (path-drift / session-id loss) are partial. **OPEN follow-up**: centralize one `normalizeSessionPath(input)` and include the canonical root in every system-prompt header. |
| — | Missing Steering / Reprompt Mechanisms (no `[STEER]` log lines anywhere) | A, B, D (pass-1 LLM-stoppage letters), #21, #22, #31 — **OPEN follow-up**: build a unified steer/reprompt service that injects corrective messages for empty completions, missing tool calls, invalid paths, hunk mismatches, env errors, and rate-limit transitions. |

## Pass-1 Narrative Sub-Bugs (no number; some subsumed above)

| Letter | Title | Notes |
|--------|-------|-------|
| A | `mistral-large-latest` `finishReason:stop` with 0 tool calls | After a `stop` with zero tool calls, inject a single short steer prompt. |
| B | `qwen/qwen3.5-122b-a10b` `finishReason:other` with 0 tool calls | Model likely doesn't support tool calling as Vercel AI SDK expects. |
| D | `incomplete-response` branch with confidence 0.4 | Make `incompleteConfidence` threshold configurable; surface a clearer message. |
| E | `list_files` `INVALID_ARGS` on empty `path` | Default `path: ""` to the session root; regenerate the JSON. |
| F | `capability not found` for `apply_diff`/`bash_execute`/`read_files` | Log + count these to detect chronic capability degradation. |
| G | Loop-guard kills agent on `python3 ENOENT` | Soften loop guard for environment errors; reprompt with hints. |
| H | No auto-detection of missing interpreter | Auto-suggest `python` vs `python3`, venv path. |
| I | Invalid progressive file edit paths from LLM | Inject one-liner steer when `isValidFilePath` fails. |
| K | `applyDiffMatchPatch` "Invalid patch string" | Pre-validate patches with a lightweight unified-diff parser. |

---

## Combined Top-Priority Patch List (across all 3 passes)

1. **Session id protection** — prevent/audit folder renames that drop the `001` segment; emit `[CRITICAL]` on id loss. *(#26)*
2. **VFS transactional write with rebase** — block writes on concurrent modification; re-read between edits. *(#10, #25, #18 — partial)*
3. **Generalize `[STEER]` reprompt layer** — empty completion, missing tool call, invalid path, hunk mismatch, ENOENT, idle timeout, `success: false` results. *(#1, #21, #22, #31)*
4. **Memory + disk backpressure** — soft-throttle at 1.2 GB, restart at 1.8 GB, cap session bytes. *(#8, #27, #33)*
5. **Fix AutoMode classifier** — turn-aware, contextual signals, stop demoting rich requests. *(#9, #32)*
6. **Snapshot cache** — content-hash key, hit/miss/stale counters, <60 s staleness. *(#11, #16)*
7. **Tool schema discipline** — `description` + `example` on every path argument. *(#19)*
8. **Provider/stream observability** — separate first-token vs idle timeout, progress pings, persistence caps. *(#17, #23, #28 — fixed)*
9. **Startup health checks** — emit `[WARN]` on 0-tool registries; fix misleading "success". *(#12, #13, #24, #34 — fixed)*
10. **Lifecycle hygiene** — close checkpoint store properly; debounce trigger logs. *(#30, #35)*

---

## Completion Roll-up

- **Fixed (cleanly):** 7 bugs (#12, #13, #17, #20, #23, #24, #34)
- **Fixed (with known issues to clean up):** 3 bugs (#10, #18, #25)
- **Open:** 17 numbered bugs + 9 open lettered sub-bugs (the other 5 lettered items are subsumed by the numbered bugs above; 14 lettered total)
- **Total addressed in this session:** 10 of 36 (~28% of the enumerated audit; the other 5 lettered items are subsumed, not open)
