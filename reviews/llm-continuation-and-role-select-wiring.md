# Review: LLM Continuation Flow & Role-Select Tool Wiring

**Module:** Chat continuation, auto-reprompt, and role-selection wiring
**Date:** 2026-06-15
**Scope:** `bing/web/lib/chat/`, `bing/web/lib/orchestra/`, `bing/web/.bing-shared/agent/`, `bing/packages/shared/agent/`
**Status:** ⚠️ CRITICAL GAPS IDENTIFIED

---

## Executive Summary

The user reported that **the LLM always stops on step 1** — generating a basic HTML at most, or stopping at the plan/scaffold text, and **never continuing the chat flow** even when tool calls (e.g., `read_file`) have a clear purpose that requires follow-up action. A deep audit reveals:

1. **choose_role IS wired in** as a default tool — the wiring exists at two sites (`vercel-ai-tools.ts:555` and `unified-agent-service.ts:3585-3586`).
2. **The `continue` parameter from role selection EXISTS** — `first-response-routing.ts:130` emits `continue: false` in metadata.
3. **Auto-continue mechanism EXISTS** — `auto-continue-detector.ts` watches for `[CONTINUE_REQUESTED]` tokens.
4. **BUT the route layer does NOT actively trigger a re-prompt** when `roleSelection.continue === true` or when the auto-continue detector fires. The flag is consumed only as a *guard* (`!roleSelection?.continue`) to skip Phase 2 fallback — it's never used to *initiate* a follow-up turn.

This is the root cause of the "stops at step 1" bug.

---

## Key Findings

### ✅ What EXISTS (wiring is present but incomplete)

| Component | Location | Status |
|---|---|---|
| `chooseRoleCapability` tool | `bing/web/lib/chat/tools/choose-role-tool.ts` | ✅ Exported |
| choose_role in default tool set | `bing/web/lib/chat/vercel-ai-tools.ts:555` | ✅ Wired |
| choose_role in AI SDK tools | `bing/web/lib/orchestra/unified-agent-service.ts:3585-3586` | ✅ Wired |
| `continue: false` in routing metadata | `bing/web/.bing-shared/agent/first-response-routing.ts:130` | ✅ Exists |
| `autoContinue` event in stream | `bing/web/lib/chat/auto-continue-detector.ts` | ✅ Exists |
| `[CONTINUE_REQUESTED]` token detection | `bing/web/lib/chat/auto-continue-detector.ts` | ✅ Exists |
| `isEmptyResponse` detection | `bing/web/lib/orchestra/unified-agent-service.ts:2283` | ✅ Exists |
| `roleSelection.continue` consumption | `bing/web/lib/orchestra/unified-agent-service.ts:1585, 1618` | ⚠️ Only as guard, not trigger |

### ❌ What's MISSING (the root cause of the bug)

#### Gap 1: route.ts does NOT trigger a re-prompt when `roleSelection.continue === true`

**Current state:** `unified-agent-service.ts:1618` uses `!roleSelection?.continue` as a guard to skip Phase 2 fallback. But there's no corresponding code in `route.ts` that reads `result.metadata.routing.continue` and **actively issues a follow-up LLM call** to drive the chat forward.

**Missing behavior:** When the LLM emits a `[ROLE_SELECT]` block with `continue: true`, the route should:
1. Detect the flag in the streaming `done` event metadata
2. Build a continuation prompt from `stepReprompt` or a generic "continue with the next step" message
3. Issue a follow-up LLM call (server-side, not client-side)
4. Append the result to the stream
5. Repeat until `continue === false` or a max-iteration cap is hit

**Reference:** `unified-agent-service.ts` at line 1585-1592 logs the auto-continue trigger but doesn't *act* on it.

#### Gap 2: Empty tool args detection is not wired into the stream

**Current state:** There's a known failure mode where the LLM calls a tool with empty `args: {}` and the stream silently stops. The detection exists in `successive-tracker.ts` (`STEER_CONSECUTIVE_CAP`, `STEER_TOTAL_CAP`) but the empty-args specific path is not surfaced to the route layer.

**Missing behavior:** When a tool call has `Object.keys(args).length === 0`, inject a feedback steer ("The previous tool call had no arguments. Please provide the required arguments and retry.") and continue the stream.

#### Gap 3: Max 1 tool call is enforced but not bypassed

**Current state:** The user reports "only 1 max tool call used and then the chat flow stops abruptly". This suggests the tool-loop agent's `maxSteps` or the per-request step cap is firing after 1 call.

**Likely cause:** In `route.ts`, the `enableFilesystemEdits` flag or the `applyFilesystemEditsFromResponse` call is consuming the entire conversation budget on the first response. The LLM doesn't get a second turn to act on the tool result.

**Missing behavior:** After applying file edits, if the response had only 1 step, the route should automatically issue a continuation turn with the tool result as context (similar to Gap 1 but triggered by step count, not the `continue` flag).

---

## Recommended Fixes (Prioritized)

### Priority 1: Wire `roleSelection.continue` into the route as a re-prompt trigger

In `bing/web/app/api/chat/route.ts`, after the streaming response completes, check `result.metadata.routing.continue`. If true, build a continuation prompt and issue a follow-up LLM call. Append the result to the stream.

**Estimated impact:** Fixes the primary "stops at step 1" bug for all role-selection-driven continuations.

### Priority 2: Wire empty-tool-args detection into the stream

In `bing/web/lib/chat/auto-continue-detector.ts`, add a detector for `tool_call.args === {}` or `Object.keys(args).length === 0`. Inject a feedback steer and continue the stream.

**Estimated impact:** Fixes the "read_file with no follow-up" bug specifically.

### Priority 3: Auto-continue when only 1 step was used

In `bing/web/app/api/chat/route.ts`, after the stream completes, if `result.steps.length === 1` and the LLM's response is a tool result that needs follow-up (e.g., `read_file` output), automatically issue a continuation turn.

**Estimated impact:** Fixes the "max 1 tool call" bug for read-then-act patterns.

### Priority 4: Add a behavioral test for the continuation flow

Add a test that simulates: LLM emits `[ROLE_SELECT] continue=true`, route receives the flag, issues a follow-up call, appends to stream. This locks in the behavior so future refactors don't reintroduce the bug.

---

## Additional Observations

### Observation A: The `continue` field in `first-response-routing.ts:130` is hardcoded to `false`

```ts
continue: false,  // <-- always false?
```

This suggests the LLM is never being prompted to emit `continue: true`. The system prompt for the first-response routing likely doesn't include a clear instruction to set this flag when the task requires multiple steps.

**Recommendation:** Audit the first-response routing system prompt to ensure it instructs the LLM to set `continue: true` when the plan has more than 1 step and the current step is complete.

### Observation B: The `auto-continue-detector` watches for a token that the LLM may not be emitting

The detector watches for `[CONTINUE_REQUESTED]` in the response stream, but if the system prompt doesn't tell the LLM to emit this token when it wants to continue, the detector will never fire.

**Recommendation:** Add a clear instruction in the system prompt: "If you need more turns to complete this task, end your response with the exact token `[CONTINUE_REQUESTED]`."

### Observation C: The `chat-metrics.ts` module has incomplete instrumentation

The `recordFallbackChainAttempt` and `recordOrchestrationFallback` functions exist but the success rate of auto-continue triggers is not tracked. Without this data, it's hard to know if the auto-continue mechanism is actually firing in production.

**Recommendation:** Add a `recordAutoContinueTrigger` and `recordAutoContinueSuccess` counter to `chat-metrics.ts` and emit them when the auto-continue path is taken.

---

## Test Coverage Gaps

The following scenarios are NOT covered by existing tests:

1. **Continuation after role selection with `continue: true`** — no test verifies the route re-prompts
2. **Empty tool args feedback injection** — no test verifies the steer is injected
3. **Max 1 tool call auto-continue** — no test verifies the route auto-continues after 1 step
4. **Auto-continue success rate metrics** — no test verifies the metrics are recorded

**Recommendation:** Add a `bing/web/__tests__/chat/llm-continuation.test.ts` file with integration tests for all 4 scenarios.

---

## Conclusion

The wiring for `choose_role`, `roleSelection.continue`, and `auto-continue` **exists in the codebase** but is **not fully connected** to the route layer. The primary fix is to make `route.ts` actively trigger a re-prompt when `roleSelection.continue === true` or when the auto-continue detector fires. This is a focused change that should restore the multi-step agentic flow.

**Status:** Awaiting implementation of Priority 1 fix.
