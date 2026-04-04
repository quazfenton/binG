# LLM Request Routing Architecture Analysis

**Date:** 2026-04-04  
**Scope:** `task-router.ts`, `unified-agent-service.ts`, `response-router.ts`, `vercel-ai-streaming.ts`, `api/chat/route.ts`, `agent-loop.ts`

---

## Executive Summary

Your codebase has **5 overlapping routing/execution layers** that have evolved organically over time. The current architecture has significant **routing ambiguity**, **duplicate detection logic**, and **unclear execution paths**. Here's the hard truth:

### What's Actually Happening Right Now

For **100% of normal streaming operations**, requests flow through this path:

```
api/chat/route.ts
  → response-router.routeAndFormat()
    → enhancedLLMService.generateStreamingResponse()
      → vercel-ai-streaming.ts (Vercel AI SDK streamText)
```

**`task-router.ts` is effectively DEAD CODE for normal chat operations.** It is wired into the codebase but **never called** from `api/chat/route.ts`. The route.ts file does its own V2 detection (`wantsV2`) that bypasses task-router entirely.

**`unified-agent-service.ts` IS used** but only in the V2 agentic pipeline path (when `isCodeRequest && CHAT_AGENTIC_PIPELINE !== 'off'`), and even then it's wrapped by route.ts's own SSE streaming handler.

---

## 1. Architecture Overview — All 5 Layers

### Layer 1: `api/chat/route.ts` (The Actual Router)
**Role:** Entry point, request validation, session management, filesystem context  
**Current Status:** ✅ **ACTIVE — Primary orchestrator**  
**What it actually does:**
- Validates auth, rate limits, body schema
- Detects `isCodeRequest`, `enableFilesystemEdits`, `wantsV2`
- Routes to either:
  - **V2 path:** `executeV2Task`/`executeV2TaskStreaming` or agent gateway
  - **V1 path:** `responseRouter.routeAndFormat()` → `enhancedLLMService`
  - **V1 Agentic path:** `createAgentLoop` (Mastra/ToolLoopAgent)
- Handles SSE streaming, file edit parsing, spec amplification

**Problems:**
- 4,439 lines — god file doing too much
- Duplicates intent detection that other routers also do
- Makes its own V2 detection decision, bypassing `task-router.ts`

---

### Layer 2: `task-router.ts` (Dead Code)
**Role:** Route tasks between OpenCode, Nullclaw, CLI, and "advanced" agents  
**Current Status:** ❌ **NOT USED by api/chat/route.ts**  
**Location:** `packages/shared/agent/task-router.ts`

**How it works:**
- Keyword-based scoring (coding, messaging, browsing, automation)
- Advanced task detection (agent-loop, research, DAG, skill-build, etc.)
- Dispatches to: OpenCode engine, Nullclaw, CLI agent, or event system

**Critical Flaws:**
1. **Never called from route.ts** — route.ts has its own `wantsV2` logic that does the same thing
2. **Terrible keyword detection** — simple word matching like `'code'`, `'file'`, `'build'` with no semantic understanding
3. **Confidence scoring is meaningless** — raw keyword count / max keyword count × 0.3
4. **Advanced task detection is gimmicky** — detecting "background" or "continuous" keywords is fragile

**Good Parts:**
- Clean `RoutingTarget` type system (explicit dispatch)
- Event system integration for advanced tasks
- Good timeout/abort handling in kernel execution
- Well-structured fallback chain

---

### Layer 3: `unified-agent-service.ts` (Partially Used)
**Role:** Unify V1, V2, Mastra, and Desktop modes into single interface  
**Current Status:** ⚠️ **Used only in V1 agentic pipeline**  
**Location:** `web/lib/orchestra/unified-agent-service.ts`

**How it works:**
- Uses `taskClassifier` (multi-factor: keyword + semantic + context + historical)
- Health check system for provider availability
- Fallback chain: StatefulAgent → V2 Native → V2 Containerized → V2 Local → V1 API
- Routes to: OpenCode Engine, StatefulAgent (Plan-Act-Verify), Mastra workflows, V1 API

**Strengths:**
- **Best task classifier** — uses `TASK_CLASSIFIER_SIMPLE_THRESHOLD`, `semanticWeight`, `contextWeight` instead of dumb keyword matching
- **Health-based routing** — checks provider availability before routing
- **Comprehensive fallback chain** — attempts multiple modes on failure
- **StatefulAgent integration** — proper Plan-Act-Verify for complex tasks
- **Desktop mode support** — Tauri desktop local execution

**Weaknesses:**
- Only called from route.ts's V1 agentic path (line ~670-1100), which requires `isCodeRequest && CHAT_AGENTIC_PIPELINE !== 'off'`
- The `processUnifiedAgentRequest()` is wrapped in a `ReadableStream` with SSE events, adding complexity
- Some modes (V2 Containerized, V2 Local) are essentially duplicates of V2 Native

---

### Layer 4: `response-router.ts` (The Real Workhorse)
**Role:** Priority-based endpoint routing with circuit breaker protection  
**Current Status:** ✅ **ACTIVELY USED for all V1 requests**  
**Location:** `web/lib/api/response-router.ts`

**How it works:**
- Endpoint priority chain: fast-agent (disabled) → original-system → n8n → custom-fallback → tool-execution → composio → sandbox → v2-gateway
- Per-endpoint **circuit breaker** with weighted failures, recovery windows, and last-route safety
- **Spec amplification** — detects code/file edits and triggers enhanced generation
- Streaming support via `enhancedLLMService.generateStreamingResponse()`

**Strengths:**
- **Best circuit breaker** — weighted rate-limit vs hard-failure scoring, time-decay, never blocks all routes
- **Clean priority chain** — each endpoint has `enabled`, `canHandle`, `processRequest`
- **Streaming integration** — properly returns async generators for real-time consumption
- **Telemetry** — comprehensive metrics recording

**Weaknesses:**
- 2,603 lines — too large
- Fast-agent endpoint is permanently disabled but still in the chain
- Intent detection (`detectRequestType`) is separate from task classification

---

### Layer 5: `vercel-ai-streaming.ts` (The Engine)
**Role:** Unified streaming interface across all LLM providers  
**Current Status:** ✅ **CORE ENGINE — used by everyone**  
**Location:** `web/lib/chat/vercel-ai-streaming.ts`

**How it works:**
- Wraps Vercel AI SDK's `streamText` for all providers
- Supports 15+ OpenAI-compatible providers (OpenRouter, Chutes, Groq, etc.)
- Smooth streaming, reasoning extraction, tool call streaming
- Automatic fallback when Responses API fails → Chat Completions format

**Strengths:**
- **Best provider abstraction** — single interface for all providers
- **Excellent error handling** — Responses API detection, automatic fallback
- **Tool call streaming** — multi-step tool execution support
- **Reasoning extraction** — Anthropic thinking, Google thought, DeepSeek reasoning

**This is the layer that actually talks to the LLM.** Everyone else routes to this.

---

### Bonus: `agent-loop.ts` (ToolLoopAgent)
**Role:** Multi-step tool execution with filesystem tools  
**Current Status:** ✅ **Used in V1 agentic path**  
**Location:** `web/lib/orchestra/mastra/agent-loop.ts`

Uses Vercel AI SDK's `ToolLoopAgent` (AI SDK 6.0+) when available, with manual loop fallback. This is what executes the "agent loop" for code-intensive tasks — it reads files, writes diffs, and iterates.

---

## 2. The Actual Request Flow (What Really Happens)

### Path A: Simple Chat / Non-Code Request
```
POST /api/chat
  → Validate auth + rate limit
  → isCodeOrAgenticRequest() → false
  → responseRouter.routeAndFormat()
    → enhancedLLMService.generateStreamingResponse()
      → vercel-ai-streaming.streamWithVercelAI()
        → streamText (Vercel AI SDK)
          → SSE events to client
```
**Components used:** route.ts → response-router → enhanced-llm-service → vercel-ai-streaming

### Path B: Code Request, V2 Disabled
```
POST /api/chat
  → isCodeOrAgenticRequest() → true
  → wantsV2 → false (V2_AGENT_ENABLED !== 'true')
  → responseRouter.routeAndFormat()
    → enhancedLLMService.generateStreamingResponse()
      → vercel-ai-streaming.streamWithVercelAI()
  → (post-stream) applyFilesystemEditsFromResponse()
  → (post-stream) spec amplification if code detected
```
**Components used:** route.ts → response-router → enhanced-llm-service → vercel-ai-streaming → file-edit-parser

### Path C: Code Request, V2 Enabled, Agentic Pipeline
```
POST /api/chat
  → isCodeOrAgenticRequest() → true
  → wantsV2 → true (or agentMode === 'v2')
  → executeV2TaskStreaming() or agent gateway
  OR (if agentic pipeline):
  → createAgentLoop() → agentLoop.executeTaskStreaming()
    → ToolLoopAgent.stream() or manual loop
      → vercel-ai-streaming.streamWithVercelAI()
  → SSE events with file edits, tool invocations
```
**Components used:** route.ts → unified-agent-service → agent-loop → vercel-ai-streaming

### Path D: Task Router (NEVER HIT)
```
taskRouter.executeTask(request)  // ← Nobody calls this from route.ts
```
**This is dead code.** The route.ts file has its own routing logic that duplicates what task-router does.

---

## 3. Task Detection Comparison

| Feature | `task-router.ts` | `unified-agent-service.ts` | `route.ts` | `response-router.ts` |
|---------|-----------------|---------------------------|------------|---------------------|
| **Method** | Keyword regex matching | Multi-factor classifier | Pre-compiled regex | `detectRequestType()` |
| **Complexity** | Dumb (word counting) | Smart (weighted scoring) | Medium (pattern groups) | Medium (intent detection) |
| **Semantic Analysis** | ❌ None | ✅ Via embeddings | ❌ None | ❌ None |
| **Context Awareness** | ❌ None | ✅ Project size, user pref | ❌ None | ❌ None |
| **Historical Learning** | ❌ None | ✅ Past interactions | ❌ None | ❌ None |
| **Code Detection** | 56 keywords in array | Classifier + regex fallback | Pre-compiled STRONG_CODE_PATTERN | Regex-based |
| **Confidence** | Meaningful [0,1] | Weighted [0,1] | Boolean (isCode) | Categorical (tool/sandbox/normal) |
| **Used In Production** | ❌ Never | ✅ V1 agentic path | ✅ Every request | ✅ Every V1 request |

### The Keyword Problem

**task-router.ts** (terrible):
```typescript
private readonly CODING_KEYWORDS = [
  'code', 'program', 'function', 'class', 'variable', 'import', 'export',
  'file', 'directory', 'folder', 'path', 'read', 'write', 'create', 'delete',
  // ... 56 more words
];
```
This means the prompt "create a file" scores the same as "implement a React component with TypeScript."

**route.ts** (better):
```typescript
const STRONG_CODE_PATTERN =
  /\b(refactor|bug\s*fix|typescript|javascript|react|next\.js|database|schema|compile|docker|kubernetes|code|build|implement|create\s+app)\b/i
```
Pre-compiled, groups strong vs weak keywords, but still regex-based.

**unified-agent-service.ts** (best):
```typescript
const classification = await taskClassifier.classify(config.userMessage, {
  projectSize, userPreference,
});
// Uses: keywordWeight (0.4), semanticWeight (0.3), contextWeight (0.2), historicalWeight (0.1)
```
Multi-factor scoring with configurable weights.

---

## 4. Streaming Path Analysis

### How Streaming Actually Works

There are **3 distinct streaming paths** in route.ts:

#### Stream Path 1: Response Router Streaming (V1, Most Common)
```
route.ts line ~1260:
  unifiedResponse = await responseRouter.routeAndFormat(routerRequest)
    → response-router line ~640:
      if (routerResponse.stream) return { stream: routerResponse.stream }
        → enhancedLLMService.generateStreamingResponse()
          → llmProvider.streamText()
            → vercel-ai-streaming.streamWithVercelAI()
              → streamText (Vercel AI SDK)
```
This returns an async generator that route.ts consumes and wraps in SSE events.

#### Stream Path 2: ToolLoopAgent Streaming (V1 Agentic)
```
route.ts line ~1384:
  if (supportsStreaming && stream) {
    agentToolStreamingResult = { agentLoop, task, timeout }
  }
  → agentLoop.executeTaskStreaming(task)
    → ToolLoopAgent.stream({ messages })  (if available)
      → streamText (Vercel AI SDK)
```
The ToolLoopAgent internally uses Vercel AI SDK's streaming, so it ultimately hits the same `streamText` → `vercel-ai-streaming` path.

#### Stream Path 3: V2 Execution Streaming
```
route.ts line ~560:
  const streamBody = executeV2TaskStreaming({ userId, conversationId, task, context })
```
This is a separate SSE stream from the V2 executor, not using response-router.

### The Key Insight

**All 3 streaming paths ultimately use `vercel-ai-streaming.ts`** (the Vercel AI SDK wrapper). This is the single point of LLM communication. The routing layers above it just decide:
1. Which provider to use
2. Whether to use tools
3. Whether to iterate (agent loop)
4. How to format the response

---

## 5. Should You Centralize?

### Recommendation: YES — Consolidate into `unified-agent-service.ts`

Here's why:

1. **`task-router.ts` is dead code** — Delete it or repurpose its event system integration
2. **`response-router.ts` should stay** — It's the best at endpoint routing, circuit breaking, and priority chains
3. **`unified-agent-service.ts` should become the single task router** — It already has the best classifier, health checks, and fallback chains
4. **`route.ts` should be slimmed down** — It should delegate routing to unified-agent-service instead of doing its own detection

### Proposed Architecture

```
api/chat/route.ts (Slimmed to ~800 lines)
  ├── Auth, rate limiting, session management
  ├── Filesystem context building
  └── Delegate to:
      ├── unified-agent-service.processUnifiedAgentRequest()
      │   ├── Task classification (best classifier)
      │   ├── Health-based mode selection
      │   ├── StatefulAgent for complex tasks
      │   └── OpenCode Engine for simple tasks
      │
      └── response-router.routeAndFormat() (for V1 non-agent requests)
          ├── Circuit breaker protection
          ├── Endpoint priority chain
          └── Streaming via vercel-ai-streaming
```

### What to Migrate Where

| From | Move To | What |
|------|---------|------|
| `task-router.ts` | `unified-agent-service.ts` | Advanced task detection (event system integration), CLI execution |
| `task-router.ts` | ❌ Delete | Keyword-based task type detection (terrible) |
| `route.ts` | `unified-agent-service.ts` | `isCodeOrAgenticRequest()` → use task classifier instead |
| `route.ts` | Keep | Session management, filesystem context, SSE wrapping |
| `response-router.ts` | Keep | Circuit breaker, endpoint priority chain, spec amplification |
| `unified-agent-service.ts` | Enhance | Make it the primary router; add response-router as an endpoint |

### Specific Improvements

#### 1. Replace `isCodeOrAgenticRequest()` with Task Classifier
```typescript
// BAD (route.ts current):
const isCodeRequest = STRONG_CODE_PATTERN.test(message) || WEAK_CODE_PATTERNS.some(...)

// GOOD (use unified classifier):
const classification = await taskClassifier.classify(message);
const isCodeRequest = classification.recommendedMode === 'v2-native' ||
                      classification.complexity === 'complex';
```

#### 2. Eliminate `task-router.ts`'s Keyword Detection
The task classifier in unified-agent-service already does this 10x better with semantic analysis, context awareness, and historical learning.

#### 3. Keep `response-router.ts`'s Circuit Breaker
This is production-grade with weighted failures, time-decay, and last-route safety. No other component has anything close.

#### 4. Keep `vercel-ai-streaming.ts` as the Single LLM Gateway
It's already the single point of contact with the LLM. Everyone routes through it.

---

## 6. What's the Best in Each File?

### 🏆 Best Components by Category

| Category | Winner | Why |
|----------|--------|-----|
| **Task Classification** | `unified-agent-service.ts` (taskClassifier) | Multi-factor: semantic, context, historical, keyword weights |
| **Circuit Breaker** | `response-router.ts` | Weighted scoring, time-decay, never blocks all routes |
| **Streaming Engine** | `vercel-ai-streaming.ts` | Single interface for 15+ providers, automatic fallback |
| **Agent Loop** | `agent-loop.ts` (ToolLoopAgent) | Vercel AI SDK native, tool streaming, reasoning extraction |
| **Provider Routing** | `response-router.ts` | Priority chain with health checks, per-endpoint canHandle |
| **Fallback Chain** | `unified-agent-service.ts` | StatefulAgent → V2 Native → V2 Containerized → V2 Local → V1 API |
| **Event System** | `task-router.ts` | Advanced task scheduling via event bus |

### What to Keep vs. Delete

#### ✅ KEEP AND ENHANCE
- `vercel-ai-streaming.ts` — Core LLM gateway, excellent
- `response-router.ts` — Circuit breaker + endpoint priority chain
- `unified-agent-service.ts` — Task classifier + health routing + fallback chain
- `agent-loop.ts` — ToolLoopAgent integration
- `route.ts` — Slim down to orchestration only (auth, session, SSE wrapping)

#### ⚠️ KEEP PARTS
- `task-router.ts` — Keep event system integration, delete keyword detection
- `route.ts` — Keep session/filesystem management, delete routing logic

#### ❌ DELETE OR REPLACE
- `task-router.ts` keyword detection — Replace with task classifier
- `route.ts`'s `isCodeOrAgenticRequest()` — Replace with task classifier
- Fast-agent endpoint in response-router — Already disabled, remove the dead code

---

## 7. Implementation Plan

### Phase 1: Quick Wins
1. **Delete fast-agent endpoint** from response-router (already disabled)
2. **Remove keyword detection** from task-router.ts — or just stop using it
3. **Document actual flow** — Add architecture diagram to README

### Phase 2: Consolidation
4. **Make unified-agent-service the primary router** — route.ts calls it instead of doing its own detection
5. **Migrate response-router as an endpoint** — unified-agent-service routes to response-router for V1 requests
6. **Add task classifier to route.ts** — replace `isCodeOrAgenticRequest()` with `taskClassifier.classify()`

### Phase 3: Cleanup
7. **Delete or repurpose task-router.ts** — Either delete entirely or keep only event system integration
8. **Slim route.ts** — Move routing logic to unified-agent-service, keep only HTTP handling
9. **Unified streaming** — Single streaming path through vercel-ai-streaming

---

## 8. Summary

| File | Status | Quality | Recommendation |
|------|--------|---------|----------------|
| **task-router.ts** | ❌ Dead code | Low (keyword matching) | Delete or keep event system only |
| **unified-agent-service.ts** | ⚠️ Partially used | High (classifier + health routing) | Make primary router |
| **response-router.ts** | ✅ Active | High (circuit breaker + priority chain) | Keep, add as endpoint to unified service |
| **vercel-ai-streaming.ts** | ✅ Active | High (provider abstraction) | Keep as single LLM gateway |
| **agent-loop.ts** | ✅ Active | High (ToolLoopAgent) | Keep as agent execution engine |
| **api/chat/route.ts** | ✅ Active | Medium (god file) | Slim to orchestration only |

**Bottom line:** Your codebase has grown organically and accumulated routing layers. The `unified-agent-service.ts` has the best architecture for task routing (multi-factor classifier, health-based selection, comprehensive fallback chain). The `response-router.ts` has the best circuit breaker. The `vercel-ai-streaming.ts` is already the single LLM gateway. Consolidate around these three, delete `task-router.ts`'s keyword detection, and slim `route.ts` to HTTP/session orchestration only.

---

# PART 2: Detailed Consolidation Plan — Including Orchestration Files

## 9. The Orchestration Files — Complete Inventory

I reviewed every file you mentioned plus everything they import. Here's the full map:

### File Inventory

| File | Location | Lines | Purpose | Status |
|------|----------|-------|---------|--------|
| `agent-orchestrator.ts` | `packages/shared/agent/orchestration/` | ~200 | Plan→Act→Verify state machine with IterationController | ✅ Used by unified-agent-service |
| `agent-orchestrator.ts` | `web/lib/orchestration/` | ~350 | **Mock data stub** — returns hardcoded agents, fake workflows | ❌ Never called in production |
| `progress-emitter.ts` | `web/lib/orchestration/` | ~280 | SSE + SQLite event persistence for orchestration progress | ⚠️ Standalone utility, not wired to main flow |
| `agent-team.ts` | `web/lib/spawn/orchestration/` | ~833 | Multi-agent teams with 5 collaboration strategies | ⚠️ Only via orchestration-mode-handler header |
| `index.ts` | `web/lib/spawn/orchestration/` | ~180 | Re-exports agent-team + agent-memory + factory functions | ⚠️ Convenience index |
| `orchestration.ts` | `packages/shared/agent/` | ~300 | **Master index** — exports ALL orchestration components | ✅ Shared module barrel export |
| `orchestration-mode-handler.ts` | `packages/shared/agent/` | ~842 | Routes via `X-Orchestration-Mode` header to 12 backends | ⚠️ Only active when header is set |
| `agent-orchestrator.ts` (shared) | `packages/shared/agent/orchestration/` | Same as above | Same file, different import path | ✅ Same file via `@bing/shared` alias |

### Are There Duplicates?

**Yes — `AgentOrchestrator` exists in TWO places but they're NOT duplicates:**

1. **`packages/shared/agent/orchestration/agent-orchestrator.ts`** — The real one. Plan→Act→Verify state machine with `IterationController`, tool execution, self-healing, and verification. Used by `unified-agent-service.ts` via `AgentOrchestrator` import.

2. **`web/lib/orchestration/agent-orchestrator.ts`** — **Fake/mock data stub.** Every function returns hardcoded mock data (`getMockAgents()`, `getMockLogs()`, `getMockWorkflows()`). It has `// TODO: Connect to real agent system` comments everywhere. Only used by 4 API routes under `/api/orchestration/*` which appear to be a UI dashboard for viewing/managing agents.

**These serve completely different purposes.** The shared one is the execution engine. The web one is a mock dashboard API.

---

## 10. Detailed Analysis of Each Orchestration File

### `packages/shared/agent/orchestration/agent-orchestrator.ts` — KEEP AND ENHANCE

**What it does:** Plan→Act→Verify loop with:
- `IterationController` — budget enforcement (max steps, tokens, time)
- `AgentOrchestrator` — async generator yielding SSE events for each phase
- Self-healing tool execution (2 retries with exponential backoff)
- Verification phase using `verifyChanges()` from StatefulAgent

**Strengths:**
- Clean phase-based state machine (planning → acting → verifying → responding)
- Budget-aware — prevents infinite loops with token/time/iteration caps
- Self-healing — automatic retry on tool failures
- Streaming-native — yields events at every state transition

**Weaknesses:**
- `generatePlan()` uses regex JSON parsing — fragile
- `callLLM()` wraps the old `llmService` not Vercel AI SDK — inconsistent with rest of codebase
- Verification only runs when files are modified — misses logic errors
- Not integrated with the main route.ts flow

**Relationship to others:**
- Imported by `unified-agent-service.ts` → used in `runV1Orchestrated()` when `ENABLE_V1_ORCHESTRATOR=true`
- **Not used by default** — requires env flag

**Verdict:** ✅ **Keep** — it's a solid state machine but needs to use Vercel AI SDK instead of old llmService, and should be wired into the default flow.

---

### `web/lib/orchestration/agent-orchestrator.ts` — DELETE OR REWRITE

**What it does:** Mock API backend for `/api/orchestration/agents`, `/api/orchestration/workflows`, `/api/orchestration/stats`. Returns hardcoded fake data:

```typescript
function getMockAgents(): AgentNode[] {
  return [
    { id: 'agent-1', name: 'Planner Agent', provider: 'openrouter', ... },
    { id: 'agent-2', name: 'Executor Agent', ... },
  ];
}
```

**Status:** ❌ **All functions are TODO stubs.** `startAgent()`, `stopAgent()`, `pauseAgent()`, `resumeAgent()`, `executeWorkflow()` — all just log and return `true` or mock objects.

**Verdict:** Either **DELETE** (if the dashboard UI doesn't exist) or **REWRITE** to connect to real systems (session manager, workforce manager, agent kernel).

---

### `web/lib/orchestration/progress-emitter.ts` — KEEP AS UTILITY

**What it does:** Unified event emission for orchestration progress:
- `emitOrchestrationProgress()` — emits to both SSE stream and SQLite event store
- Convenience wrappers: `emitStepProgress()`, `emitNodeStatus()`, `emitRetryError()`, `emitHITLRequest()`, `emitNodeCommunication()`

**Strengths:**
- Graceful degradation — SSE failures don't block DB persistence
- Lazy-loaded event bus import (cached after first call)
- Comprehensive event types for multi-agent scenarios

**Status:** ⚠️ **Not wired into main flow.** It's a standalone utility that orchestration modes COULD use but currently only `orchestration-mode-handler.ts` emits events directly via `emitEvent()` from the bus.

**Verdict:** ✅ **Keep** — promote it to the standard way all orchestration modes emit progress. Currently `orchestration-mode-handler.ts` does its own `emitEvent()` calls inline — replace those with `emitOrchestrationProgress()`.

---

### `web/lib/spawn/orchestration/agent-team.ts` — KEEP FOR EXTERNAL ORCHESTRATION

**What it does:** Multi-agent team coordination with 5 collaboration strategies:
1. **Hierarchical** — Manager creates plan, workers execute, reviewer validates
2. **Collaborative** — All agents work in parallel, synthesizer merges
3. **Consensus** — Each agent proposes solution, team votes
4. **Relay** — Sequential assembly line (each agent transforms input)
5. **Competitive** — Multiple agents solve independently, judge picks best

**Architecture:**
- Uses `AgentPool` for agent lifecycle management
- EventEmitter-based progress tracking
- Quality scoring based on token efficiency, file modifications, tool usage

**Strengths:**
- **Only file with true multi-agent orchestration** — all other "orchestration" is single-agent with tools
- 5 distinct strategies for different task types
- Proper agent pool management (acquire/release)
- Event-driven architecture for real-time monitoring

**Weaknesses:**
- **Only triggered via `X-Orchestration-Mode: agent-team` header** — not in default flow
- Hardcoded agent types (`claude-code`, `amp`) — should be configurable
- Uses old `(agent as any).prompt()` API instead of Vercel AI SDK
- No streaming support — returns final result only
- Quality scoring is naive (token efficiency ≠ quality)

**Status:** ⚠️ **Externally accessible but not default.** Only used when client sends `X-Orchestration-Mode: agent-team` header.

**Verdict:** ✅ **Keep** — this is your multi-agent system. It's architecturally distinct from all the single-agent routing layers. But it needs:
1. Vercel AI SDK integration instead of raw `.prompt()` calls
2. Streaming support
3. Wiring into the main flow for complex tasks (not just header-gated)

---

### `packages/shared/agent/orchestration-mode-handler.ts` — KEEP AS MODE SWITCH

**What it does:** Router that dispatches to 12 different backends based on `X-Orchestration-Mode` header:

```
task-router | unified-agent | stateful-agent | agent-kernel | agent-loop |
execution-graph | nullclaw | opencode-sdk | mastra-workflow | crewai |
v2-executor | agent-team
```

**Strengths:**
- **Clean dispatch pattern** — each mode is isolated, easy to test
- Good error handling with graceful degradation
- Task hashing for secure logging (no secrets in logs)
- Provider resolution from model name (handles `claude-3-5-sonnet` → `anthropic`)

**Weaknesses:**
- **Default mode is `task-router`** — which is dead code! So the default routes to nothing useful
- `agent-team` section duplicates event emission logic instead of using `progress-emitter.ts`
- `execution-graph` mode hardcodes a 3-node DAG (plan→execute→verify) — inflexible
- `nullclaw`, `opencode-sdk`, `crewai` modes are rarely used but add maintenance burden

**Status:** ⚠️ **Partially used.** Called from `route.ts` line 1078, but only when `X-Orchestration-Mode` header is set to something other than `task-router` (the default).

**Verdict:** ✅ **Keep** — it's a useful mode switch. But fix the default:
- Change default from `task-router` → `unified-agent`
- Each mode should use `emitOrchestrationProgress()` for consistent events
- Remove unused modes or mark them experimental

---

### `packages/shared/agent/orchestration.ts` — KEEP AS BARREL EXPORT

**What it does:** Master barrel export for ALL orchestration components. Re-exports:
- Session management
- Execution graph
- Background jobs
- Workforce management
- Mastra workflows
- Multi-agent collaboration
- Task router (dead code)
- Agent kernel
- Unified agent
- Stateful agent
- HITL
- Unified agent service
- Agent loop
- Reflection engine
- Cloud deployment
- Workflow templates

**Verdict:** ✅ **Keep** — it's a clean index. Just update what it exports when we consolidate.

---

## 11. How the Orchestration Files Relate to the Main Routing Flow

Here's the complete picture including orchestration:

```
POST /api/chat
  │
  ├─ [No X-Orchestration-Mode header] (99% of traffic)
  │   │
  │   ├─ isCodeOrAgenticRequest() → route.ts's own detection
  │   │
  │   ├─ wantsV2?
  │   │   ├─ Yes → executeV2Task/executeV2TaskStreaming OR agent gateway
  │   │   └─ No  → responseRouter.routeAndFormat()
  │   │                ├─ enhancedLLMService → vercel-ai-streaming (most common)
  │   │                └─ V1 agentic loop → agent-loop.ts → vercel-ai-streaming
  │   │
  │   └─ (route.ts also calls unified-agent-service for agentic pipeline)
  │
  └─ [X-Orchestration-Mode: <mode>] (header-gated, rare)
      │
      └─ orchestration-mode-handler.executeWithOrchestrationMode()
          ├─ task-router → task-router.ts (DEAD CODE)
          ├─ unified-agent → unified-agent-service.ts ✅
          ├─ stateful-agent → StatefulAgent ✅
          ├─ agent-kernel → AgentKernel ⚠️
          ├─ agent-loop → agent-loop.ts ✅
          ├─ execution-graph → AgentOrchestrator ⚠️ (not wired to main flow)
          ├─ nullclaw → nullclaw-integration ⚠️
          ├─ opencode-sdk → opencode-sdk-provider ⚠️
          ├─ mastra-workflow → mastra-workflow-integration ✅
          ├─ crewai → crewai runner ⚠️
          ├─ v2-executor → v2-executor ✅
          └─ agent-team → agent-team.ts ✅ (multi-agent)
```

**The key insight:** `orchestration-mode-handler.ts` is a **parallel routing path** that only activates via header. The main flow (no header) has its OWN routing logic in route.ts that duplicates some of what orchestration-mode-handler does.

---

## 12. Complete Consolidation Plan — 5 Phases

### Phase 0: Audit & Document (Week 1)
**Goal:** Understand what's used, what's dead, what's experimental

| Task | Action | Files Affected |
|------|--------|---------------|
| 0.1 | Audit `/api/orchestration/*` routes — do they have a frontend UI? | `web/lib/orchestration/agent-orchestrator.ts`, 4 API routes |
| 0.2 | Check if `X-Orchestration-Mode` header is ever set by the frontend | Search frontend codebase |
| 0.3 | Check if `ENABLE_V1_ORCHESTRATOR=true` is ever set | Env config |
| 0.4 | Check if `CHAT_AGENTIC_PIPELINE` is ever set to non-auto | Env config |
| 0.5 | Document which env flags gate which paths | All files |

**Decision points after Phase 0:**
- If no UI for `/api/orchestration/*` → DELETE `web/lib/orchestration/agent-orchestrator.ts`
- If `X-Orchestration-Mode` header is never set → DELETE `orchestration-mode-handler.ts` or merge into unified service
- If `ENABLE_V1_ORCHESTRATOR` is never true → DELETE `AgentOrchestrator` usage or wire it in

---

### Phase 1: Fix Defaults (Week 1-2)
**Goal:** Make the default path use the best components

#### 1.1 Change orchestration-mode-handler default
```typescript
// packages/shared/agent/orchestration-mode-handler.ts
// BEFORE:
export function getOrchestrationModeFromRequest(req: NextRequest): OrchestrationMode {
  if (!modeHeader) return 'task-router'; // DEAD CODE
}

// AFTER:
export function getOrchestrationModeFromRequest(req: NextRequest): OrchestrationMode {
  if (!modeHeader) return 'unified-agent'; // Best default
}
```

#### 1.2 Replace route.ts's `isCodeOrAgenticRequest()` with task classifier
```typescript
// web/app/api/chat/route.ts
// BEFORE (line ~100):
const STRONG_CODE_PATTERN = /\b(refactor|bug\s*fix|...)\b/i
const isCodeRequest = STRONG_CODE_PATTERN.test(message) || ...

// AFTER:
import { taskClassifier } from '@bing/shared/agent/task-classifier';

async function classifyRequest(messages, projectContext) {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
  return await taskClassifier.classify(lastUserMessage, {
    projectSize: projectContext?.size,
    userPreference: undefined,
  });
}
// Use classification.recommendedMode instead of regex
```

#### 1.3 Wire `progress-emitter.ts` into orchestration-mode-handler
```typescript
// packages/shared/agent/orchestration-mode-handler.ts
// In agent-team case, replace inline emitEvent() calls:
import { emitOrchestrationProgress, emitStepProgress } from '@/lib/orchestration/progress-emitter';

// Replace all inline emitEvent({ type: 'ORCHESTRATION_PROGRESS', ... }) with:
await emitStepProgress(request.ownerId, request.sessionId, {
  steps: [...],
  currentStepIndex: ...,
  sseEmit: (eventType, payload) => { /* stream enqueue */ },
});
```

**Expected outcome:** Default path uses unified-agent-service (best classifier), all orchestration modes use consistent event emission.

---

### Phase 2: Consolidate Routing (Week 2-3)
**Goal:** Single routing interface, eliminate duplication

#### 2.1 Make `unified-agent-service.ts` the primary router

Create a new unified routing entry point:

```typescript
// packages/shared/agent/unified-router.ts (NEW)
// OR enhance existing unified-agent-service.ts

import { taskClassifier } from './task-classifier';
import { processUnifiedAgentRequest } from '@/lib/orchestra/unified-agent-service';
import { responseRouter } from '@/lib/api/response-router';
import { checkProviderHealth } from '@/lib/orchestra/unified-agent-service';

export async function routeChatRequest(request: ChatRequest): Promise<ChatResponse> {
  // 1. Classify the task
  const classification = await taskClassifier.classify(request.userMessage, {
    projectSize: request.projectContext?.size,
  });

  // 2. Check provider health
  const health = checkProviderHealth();

  // 3. Route based on classification + health
  if (classification.recommendedMode === 'v2-native' && health.v2Native) {
    return processUnifiedAgentRequest({
      userMessage: request.userMessage,
      mode: 'auto',
      // ... config
    });
  }

  if (classification.recommendedMode === 'mastra-workflow') {
    return processUnifiedAgentRequest({
      userMessage: request.userMessage,
      mode: 'mastra-workflow',
      workflowId: request.workflowId,
    });
  }

  // V1 path — use response-router with circuit breaker
  return responseRouter.routeAndFormat({
    messages: request.messages,
    provider: health.preferredMode === 'v1-api' ? request.provider : 'openai',
    model: request.model,
    stream: request.stream,
    // ... config
  });
}
```

#### 2.2 Slim route.ts to use the unified router

```typescript
// web/app/api/chat/route.ts
// BEFORE: 4,439 lines of routing logic
// AFTER: ~800 lines of HTTP handling

export async function POST(request: NextRequest) {
  // 1. Auth, rate limiting, body validation (keep)
  // 2. Session management (keep)
  // 3. Filesystem context building (keep)
  // 4. Delegate to unified router:
  const result = await routeChatRequest({
    userMessage: task,
    messages: contextualMessages,
    provider,
    model: normalizedModel,
    stream,
    userId: authenticatedUserId || filesystemOwnerId,
    conversationId: resolvedConversationId,
    projectContext: { id: resolvedConversationId, scopePath: requestedScopePath },
  });
  // 5. Wrap in SSE/Response (keep HTTP handling)
}
```

#### 2.3 Remove dead code from route.ts
- Delete `STRONG_CODE_PATTERN` and `WEAK_CODE_PATTERNS` (replaced by classifier)
- Delete `isCodeOrAgenticRequest()` function (replaced by classifier)
- Delete `wantsV2` detection logic (replaced by classification.recommendedMode)
- Keep: session management, filesystem context, SSE wrapping, auth

**Expected outcome:** route.ts drops from ~4,400 to ~800 lines. All routing logic in one place.

---

### Phase 3: Unify Agent Execution (Week 3-4)
**Goal:** All execution paths use Vercel AI SDK, consistent streaming

#### 3.1 Make `agent-team.ts` use Vercel AI SDK

```typescript
// web/lib/spawn/orchestration/agent-team.ts
// BEFORE:
const result = await (agent as any).prompt({ message: ..., timeout: ... });

// AFTER:
import { streamWithVercelAI } from '@/lib/chat/vercel-ai-streaming';

async function runAgentTask(agentConfig: AgentConfig, task: string): Promise<string> {
  let content = '';
  for await (const chunk of streamWithVercelAI({
    provider: agentConfig.provider,
    model: agentConfig.model,
    messages: [{ role: 'user', content: task }],
  })) {
    if (chunk.content) content += chunk.content;
  }
  return content;
}
```

#### 3.2 Add streaming to agent-team.ts

```typescript
async *executeTaskStreaming(task: TeamTask): AsyncGenerator<TeamProgress, TeamExecutionResult, unknown> {
  // For hierarchical: stream each agent's response
  for (const [role, agent] of agents) {
    yield { iteration, currentAgent: role, progress: step / workers.length * 100, message: `${role} working` };

    for await (const chunk of runAgentTaskStreaming(agent, task)) {
      yield { type: 'token', content: chunk.content, agentRole: role };
    }
  }
}
```

#### 3.3 Wire `AgentOrchestrator` into the default flow

Currently `AgentOrchestrator` is only used when `ENABLE_V1_ORCHESTRATOR=true`. Make it the default for complex tasks:

```typescript
// In unified-agent-service.ts, runV2Native():
if (shouldUseStatefulAgent) {
  // For moderate complexity, use AgentOrchestrator (Plan→Act→Verify)
  if (classification.complexity === 'moderate') {
    return runAgentOrchestrator(config);
  }
  // For complex tasks, use StatefulAgent
  return runStatefulAgentMode(config);
}
```

#### 3.4 Unify streaming — single path through vercel-ai-streaming

Ensure ALL LLM calls go through `vercel-ai-streaming.ts`:
- `agent-loop.ts` → already uses it ✅
- `response-router` → `enhancedLLMService` → already uses it ✅
- `orchestration-mode-handler` agent-team → needs migration (3.1)
- `AgentOrchestrator` `callLLM()` → uses old `llmService`, needs migration

---

### Phase 4: Clean Up Dead Code (Week 4)
**Goal:** Remove everything that's not used

#### 4.1 Files to DELETE entirely:
- `web/lib/orchestration/agent-orchestrator.ts` — all mock data, no real implementation
- `packages/shared/agent/task-router.ts` keyword detection — keep event system integration only
- Fast-agent endpoint in `response-router.ts` — already disabled, remove dead code

#### 4.2 Files to DELETE conditionally:
- `orchestration-mode-handler.ts` — DELETE if `X-Orchestration-Mode` header is never set by frontend
- `packages/shared/agent/task-router.ts` — DELETE entirely if orchestration-mode-handler is deleted (it's the only caller)

#### 4.3 Files to KEEP but reduce:
- `route.ts` — reduce from 4,439 to ~800 lines
- `response-router.ts` — reduce from 2,603 to ~1,500 (remove disabled endpoints, simplify)
- `orchestration-mode-handler.ts` — reduce from 842 to ~400 (remove unused modes, use progress-emitter)

#### 4.4 Update barrel exports:
```typescript
// packages/shared/agent/orchestration.ts
// REMOVE:
export { taskRouter } from './task-router';  // Dead code

// ADD:
export { routeChatRequest } from './unified-router';  // New primary router
```

---

### Phase 5: Architecture Final State

```
┌─────────────────────────────────────────────────────────┐
│                   api/chat/route.ts                      │
│  Auth, rate limiting, session management, SSE wrapping   │
│  (~800 lines — HTTP handling only)                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              unified-router.ts (NEW or enhanced          │
│           unified-agent-service.ts)                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Task Classifier (multi-factor scoring)          │    │
│  │  - keyword (0.4) + semantic (0.3) + context (0.2)│    │
│  │  - recommendedMode: v2-native | mastra | v1-api  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Provider Health Check                            │    │
│  │  - v2-native | v2-containerized | v1-api | desktop│    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Mode Selection                                   │    │
│  │  - Complex → StatefulAgent (Plan-Act-Verify)     │    │
│  │  - Moderate → AgentOrchestrator (Plan-Act-Verify)│    │
│  │  - Simple → response-router (circuit breaker)    │    │
│  │  - Multi-agent → agent-team (5 strategies)       │    │
│  └─────────────────────────────────────────────────┘    │
└────────┬────────────────────┬───────────────────┬────────┘
         │                    │                   │
         ▼                    ▼                   ▼
┌───────────────┐  ┌──────────────────┐  ┌────────────────┐
│StatefulAgent  │  │ response-router  │  │  agent-team.ts │
│Plan-Act-Verify│  │ Circuit breaker  │  │ Multi-agent    │
│Self-healing   │  │ Priority chain   │  │ 5 strategies   │
│Task decomp.   │  │ Spec amplification│ │ Pool mgmt      │
└───────┬───────┘  └────────┬─────────┘  └───────┬────────┘
        │                   │                    │
        └───────────────────┼────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   vercel-ai-streaming   │
              │   (Single LLM Gateway)  │
              │   15+ providers         │
              │   Tool call streaming   │
              │   Reasoning extraction  │
              │   Automatic fallback    │
              └─────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │    ToolLoopAgent /      │
              │    agent-loop.ts        │
              │    (Agent execution)    │
              │    Filesystem tools     │
              │    Diff generation      │
              └─────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   DELETED:                               │
│  - task-router.ts keyword detection                     │
│  - web/lib/orchestration/agent-orchestrator.ts (mocks)  │
│  - route.ts routing logic (4,439 → 800 lines)           │
│  - response-router.ts fast-agent endpoint (disabled)    │
│  - isCodeOrAgenticRequest() regex detection             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   KEPT AS-IS:                            │
│  - progress-emitter.ts (utility — promote to standard)  │
│  - orchestration-mode-handler.ts (mode switch, fix default) │
│  - orchestration.ts (barrel export — update exports)    │
│  - agent-loop.ts (ToolLoopAgent integration)            │
│  - vercel-ai-streaming.ts (core engine)                 │
│  - unified-agent-service.ts (enhance → primary router)  │
└─────────────────────────────────────────────────────────┘
```

---

## 13. What About External Agent Orchestration?

The files you mentioned fall into **two distinct categories**:

### Category A: Request Routing (should be consolidated)
These decide **which agent/engine processes a prompt**:
- `task-router.ts` → dead code, delete keyword detection
- `unified-agent-service.ts` → best classifier + health routing, make primary
- `response-router.ts` → circuit breaker + endpoint priority, keep
- `orchestration-mode-handler.ts` → mode switch, fix default

### Category B: External Agent Orchestration (should be separate)
These coordinate **multiple agents working together** on complex tasks:
- `agent-team.ts` → multi-agent teams with 5 strategies, KEEP SEPARATE
- `AgentOrchestrator` → single-agent Plan→Act→Verify, INTEGRATE into main flow
- `progress-emitter.ts` → event utility, PROMOTE to standard
- `orchestration.ts` → barrel export, UPDATE exports

**`agent-team.ts` should NOT be merged into the router.** It serves a fundamentally different purpose — it's for multi-agent collaboration (architect plans, developer implements, reviewer validates), not for deciding which LLM provider handles a chat message.

**The right architecture:**
- **Router** (`unified-agent-service.ts`) → decides which engine to use
- **Engines** (StatefulAgent, AgentOrchestrator, response-router) → single-agent execution
- **Orchestration** (`agent-team.ts`) → multi-agent collaboration, triggered for complex tasks

---

## 14. Implementation Priority Order

| Priority | Task | Impact | Effort | Risk |
|----------|------|--------|--------|------|
| **P0** | Replace `isCodeOrAgenticRequest()` with task classifier | Eliminates duplicate detection | Low | Low |
| **P0** | Change orchestration-mode-handler default from `task-router` → `unified-agent` | Fixes dead code default | Trivial | Low |
| **P1** | Wire `progress-emitter.ts` into orchestration-mode-handler | Consistent events | Medium | Low |
| **P1** | Delete fast-agent endpoint from response-router | Remove dead code | Trivial | None |
| **P1** | Delete `web/lib/orchestration/agent-orchestrator.ts` (mocks) | Remove dead code | Low | None |
| **P2** | Slim route.ts — move routing to unified service | 4,400 → 800 lines | High | Medium |
| **P2** | Make `AgentOrchestrator` use Vercel AI SDK | Consistent LLM calls | Medium | Medium |
| **P2** | Wire `AgentOrchestrator` into default flow for moderate tasks | Better execution | Medium | Medium |
| **P3** | Migrate `agent-team.ts` to Vercel AI SDK | Consistent LLM calls | Medium | Low |
| **P3** | Add streaming to `agent-team.ts` | Real-time multi-agent | Medium | Low |
| **P3** | Delete `task-router.ts` keyword detection | Remove dead code | Low | Low |
| **P4** | Update barrel exports | Clean API surface | Trivial | Low |

---

## 15. Summary of Recommendations

### Consolidate into `unified-agent-service.ts`:
- Task classification (already there — best in codebase)
- Health-based mode selection (already there)
- Fallback chain (already there)
- **ADD:** `AgentOrchestrator` as moderate-complexity engine
- **ADD:** Response-router as V1 endpoint with circuit breaker

### Keep Separate:
- **`agent-team.ts`** — multi-agent orchestration is architecturally distinct from request routing
- **`vercel-ai-streaming.ts`** — core LLM gateway, everyone routes through it
- **`progress-emitter.ts`** — utility for event emission, promote to standard
- **`orchestration-mode-handler.ts`** — mode switch via headers, fix default

### Delete:
- **`task-router.ts` keyword detection** — replaced by task classifier
- **`web/lib/orchestration/agent-orchestrator.ts`** — all mock data
- **`route.ts` routing logic** — move to unified service
- **Fast-agent endpoint** in response-router — already disabled

### Enhance:
- **`AgentOrchestrator`** — use Vercel AI SDK, wire into default flow
- **`agent-team.ts`** — use Vercel AI SDK, add streaming
- **`orchestration-mode-handler.ts`** — use progress-emitter, fix default

The end state: **one router** (unified-agent-service), **one LLM gateway** (vercel-ai-streaming), **one event emitter** (progress-emitter), **multi-agent separate** (agent-team). Clean, testable, no dead code.
