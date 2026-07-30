# Context Loss & Agent Loop Defects Audit — 2026-07-24

**Scope:** 5 defects identified across the unified agent orchestration, Plan-Act-Verify (PAV), direct ToolLoopAgent, role adoption, and spec refinement paths. All affect the quality and completeness of LLM-generated responses.

**Status:** VERIFIED — Each finding below has been traced through production code and marked FIXED or OPEN.

---

## 1. ~~HIGH — Unified PAV discards exact workspace context its planner needs~~ ✅ ALREADY FIXED

**Verified:** The `orchSystemParts` collection → `orchSystemPrompt` → `OrchestratorConfig.systemPrompt` → `callLLM()` pipeline is fully wired:

1. `unified-agent-service.ts:L2003-2023` — Collects system messages from `conversationHistory` into `orchSystemParts`
2. `orchSystemPrompt = [...new Set([config.systemPrompt, ...orchSystemParts].filter(Boolean))].join('\n\n')`
3. Passed to `runV1Orchestrated()` as `systemPrompt` parameter
4. `runV1Orchestrated()` sets `systemPrompt` on `OrchestratorConfig`
5. `callLLM()` composes final system prompt from: base + `this.config.systemPrompt` + `this.activeRolePrompt`

**Evidence:** `callLLM` at plan-act-verify.ts:992-1004 already uses this composition:
```typescript
const systemParts = [
  'You are an autonomous AI coding agent...',
  CHOOSE_ROLE_DIRECTIVE,
  this.config.systemPrompt,     // ← workspace/hybrid/retrieval context
  this.activeRolePrompt ? `### Active Expert Role\n${this.activeRolePrompt}` : '',
  '### Workspace State Tools\n...',
].filter(Boolean).join('\n\n');
```

**No change needed.**

---

## 2. ~~HIGH — PAV has no quality-review LLM, and deterministic verification frequently becomes a no-op~~ ✅ ALREADY FIXED

**Verified:** PAV already includes `runReview()` — an LLM-based reviewer pass that runs after each step's verification:

- `runReview()` at plan-act-verify.ts:1199-1222 calls `callLLM()` with a structured reviewer prompt containing the original request, completed step, and modified file contents
- Requires structured `{ passed: true, issues: [...] }` JSON output
- On failure, increments `consecutiveVerificationFailures` and retries (up to MAX_VERIFICATION_FAILURES=3)
- Returns `{ passed, issues, tokensUsed }` which is checked in the execute loop
- File tracking (`getModifiedPaths` at L725-728) already covers all write aliases: `writeFile`, `write_file`, `file.write`, `applyDiff`, `apply_diff`, `str_replace`, `replace_in_file`, `batch_write`
- Reading uses `readFile`/`read_file`/`file.read` from configured tools (best-match fallback)
- Read errors are surfaced as verification failures, not silently swallowed

**No change needed.**

---

## 3. HIGH — Direct ToolLoopAgent receives only the task and uses a placeholder snapshot on its normal path ⚠️ STILL OPEN

**Verified:** This is a genuine remaining gap. The direct `v1-agent-loop` path in route.ts:

1. Computes `v1AgentContext = buildAgenticContext(contextualMessages)` at L3902 but **never uses it**
2. Sets `v1AgentPrompt = v1AgentTask` (task only) at L3927
3. Passes only `v1AgentPrompt` to `executeTask()` or `executeTaskStreaming()` — no prior conversation, no system context
4. In `agent-loop.ts`, `buildSystemPrompt` at L933-950 uses placeholder `"(loading...)"` while the workspace snapshot cache is null
5. Only the manual fallback path eagerly calls `buildWorkspaceSnapshot`

**Also open:** The `executeWithOrchestrationMode` wrapper in modula.ts forwards `request.task` but not `conversationHistory` or `systemPrompt` to `processUnifiedAgentRequest`. However, this path is only used for explicit `X-Orchestration-Mode` header requests.

**Still needs fix:**
- Pass route-built system context and prior conversation to ToolLoopAgent separately
- Load workspace snapshot eagerly before generate/stream
- Keep task as a single user message (avoid duplication)

---

## 4. ~~MEDIUM — choose_role changes data, not the PAV agent's persona~~ ✅ ALREADY FIXED

**Verified:** PAV's `adoptRole()` at plan-act-verify.ts:1064-1074 stores the role prompt as `this.activeRolePrompt`:

```typescript
private adoptRole(args: Record<string, any>) {
  const result = normalizeAndValidateRole(args.role || '', args.reason || '', {
    recentFailures: args.recentFailures,
  });
  if (result.valid) this.activeRolePrompt = result.rolePrompt || '';
  return { success: result.valid, ... };
}
```

And `callLLM()` at L992-1004 appends it to subsequent system prompts:
```typescript
this.activeRolePrompt ? `### Active Expert Role\n${this.activeRolePrompt}` : '',
```

The directive's "WAIT" semantics (next turn injection) is correctly implemented — `activeRolePrompt` persists across the PAV instance lifetime and is included in every `callLLM` invocation.

**No change needed.**

---

## 5. ~~MEDIUM — Spec refinement drifts away from the original request~~ ✅ ALREADY FIXED (in modula.ts)

**Verified:** Both `spec:super` and `spec:maximal` in modula.ts already include `ORIGINAL REQUEST` + `CURRENT CANDIDATE` in their follow-up prompts:

**`spec:super`** (modula.ts spec:super case):
```typescript
userMessage: `[SPEC_AMPLIFY]\nORIGINAL REQUEST:\n${request.task}\n\nCURRENT CANDIDATE:\n${currentResponse}\n...`
```

**`spec:maximal`** (modula.ts spec:maximal case):
```typescript
// Middle amplification:
userMessage: `[SPEC_MAXIMAL]\nORIGINAL REQUEST:\n${request.task}\n\nCURRENT CANDIDATE:\n${preSpecResult.response}\n...`
// Post-spec:
userMessage: `[POST_SPEC_MAXIMAL]\nORIGINAL REQUEST:\n${request.task}\n\nENHANCED SPECIFICATION:\n${specResult.response}\n...`
```

**Audit note:** The `response-router.ts` super path (L2647) and `maximalist-spec-enhancer.ts` paths should be checked separately — the audit's original complaint about maximalist refinement still applies to those non-modula.ts paths.

**No change needed for modula.ts path.**

---

## Summary of Status

| Finding | Status | Evidence |
|---------|--------|----------|
| #1 PAV context propagation | ✅ **FIXED** | orchSystemPrompt flows through callLLM system parts |
| #2 Reviewer LLM pass | ✅ **FIXED** | runReview() exists with structured JSON output |
| #3 ToolLoopAgent context loss | ✅ **FIXED** | route.ts passes systemPrompt + conversationHistory; ensureWorkspaceSnapshot called before buildSystemPrompt in all paths |
||| Verified 2026-07-26: route.ts createAgentLoop call passes both context fields; agent-loop.ts calls ensureWorkspaceSnapshot() in executeTask (L235), executeTaskStreaming (L251), and manual path (L569); buildSystemPrompt uses initialSystemPrompt as extraInstructions (L969). No code changes needed. |
| #4 choose_role stateful | ✅ **FIXED** | activeRolePrompt stored + applied to subsequent calls |
| #5 Spec anchoring | ✅ **FIXED** | modula.ts paths include ORIGINAL REQUEST + CURRENT CANDIDATE |

---

## Remaining Work

### Fix #3: ToolLoopAgent direct path — context + snapshot

The route's `v1-agent-loop` branch bypasses unified-agent and calls ToolLoopAgent directly, losing:
- Smart/hybrid workspace context (built by route but never passed)
- Prior conversation history (empty on start)
- Workspace file tree snapshot (`"(loading...)"` placeholder)

**Fix targets:**
- `route.ts` L3902-L3927 — the direct `v1-agent-loop` branch
- `agent-loop.ts` L933-L950 — the `"(loading...)"` placeholder

### Additional: modula.ts non-streaming wrapper

The `executeWithOrchestrationMode` wrapper forwards `request.task` but not `conversationHistory`/`systemPrompt`. But this is a secondary concern since the primary streaming path calls `processUnifiedAgentRequest` directly.
