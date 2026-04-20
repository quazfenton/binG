---
id: architecture-improvement-plan
title: Architecture Improvement Plan
aliases:
  - ARCHITECTURE_IMPROVEMENT_PLAN
  - ARCHITECTURE_IMPROVEMENT_PLAN.md
  - architecture-improvement-plan
  - architecture-improvement-plan.md
tags:
  - architecture
layer: core
summary: "# Architecture Improvement Plan\r\n\r\n## What I Reviewed\r\n\r\n- `000.md`\r\n- `lib/agent/task-router.ts`\r\n- `lib/agent/v2-executor.ts`\r\n- `lib/agent/simulated-orchestration.ts`\r\n- `lib/agent/services/agent-worker/src/index.ts`\r\n- `lib/agent/services/agent-gateway/src/index.ts`\r\n- `lib/session/session-manag"
anchors:
  - What I Reviewed
  - Concrete Problems Found
  - Changes Implemented
  - 1. Event delivery wiring
  - 2. Worker execution consolidation
  - 3. Session lookup fix
  - 4. Sandbox orchestrator stabilization
  - 5. Simulated orchestration metadata
  - Recommended Next Changes
  - High priority
  - Medium priority
  - Suggested Wiring Direction
  - Files Changed In This Pass
---
# Architecture Improvement Plan

## What I Reviewed

- `000.md`
- `lib/agent/task-router.ts`
- `lib/agent/v2-executor.ts`
- `lib/agent/simulated-orchestration.ts`
- `lib/agent/services/agent-worker/src/index.ts`
- `lib/agent/services/agent-gateway/src/index.ts`
- `lib/session/session-manager.ts`
- `lib/sandbox/provider-router.ts`
- `lib/sandbox/sandbox-orchestrator.ts`
- `lib/orchestra/*` entrypoints and workflow wiring

## Concrete Problems Found

1. `lib/sandbox/sandbox-orchestrator.ts` could not execute or migrate anything because `getSession()` always returned `null`.
2. `lib/agent/services/agent-gateway/src/index.ts` subscribed to session-scoped channels that were never published by either the gateway or worker, so SSE delivery was incomplete.
3. `lib/agent/services/agent-worker/src/index.ts` duplicated routing/execution behavior instead of using the shared `lib/agent/v2-executor.ts` path.
4. `lib/session/session-manager.ts` stored user session membership by session ID but attempted to read those sessions from the `userId:conversationId` map, which broke `getUserSessions()`.
5. `lib/agent/simulated-orchestration.ts` was useful as a workflow stub but lacked assignment/retry/execution metadata, making it hard to bridge into the rest of the orchestration stack.

## Changes Implemented

### 1. Event delivery wiring

- Gateway and worker now publish both:
  - `agent:events`
  - `agent:events:{sessionId}` when a session ID exists
- Gateway session streaming now subscribes to:
  - `agent:events`
  - `agent:events:{sessionId}`

Result: `/stream/:sessionId` can receive the worker events it was designed to surface.

### 2. Worker execution consolidation

- Worker job execution now routes through `executeV2Task()` from `lib/agent/v2-executor.ts`.
- The worker still uses `taskRouter.analyzeTask()` for target selection and telemetry, but actual execution is centralized.

Result: shared execution semantics across direct V2 usage and background worker usage.

### 3. Session lookup fix

- `sessionManager.getUserSessions()` now resolves session membership through `sessionsById`, which matches how the IDs are stored.

Result: orchestration/session statistics and any user-scoped session listing logic now see real sessions.

### 4. Sandbox orchestrator stabilization

- Added in-memory orchestrator session tracking.
- Replaced the `getSession()` stub with real lookup and idle cleanup behavior.
- Added direct provider-backed sandbox creation for warm-pool replenishment and provider migration.
- Normalized `local-safe` to `sandbox-preferred` when the caller explicitly asks for sandbox orchestration.

Result: `sandboxOrchestrator` can now return real sessions and perform actual replacement-handle migration.

### 5. Simulated orchestration metadata

- Added worker assignment fields.
- Added retry counts.
- Added execution metadata for start/completion/error tracking.
- Added `failTask()` and `startExecutionWithWorker()` helpers.

Result: the MVP orchestrator is still lightweight, but it is now compatible with worker-aware orchestration flows.

## Recommended Next Changes

### High priority

1. Add focused tests for:
   - gateway PubSub event delivery
   - `sessionManager.getUserSessions()`
   - `sandboxOrchestrator` session lifecycle and migration
2. Push provider/task-context mapping into a shared helper so worker and sandbox orchestrator stop encoding parallel heuristics.
3. Expose routing/provider/execution-policy metadata in gateway job APIs for easier operational debugging.

### Medium priority

1. Move the warm-pool behavior into a dedicated module instead of keeping it embedded in `sandbox-orchestrator.ts`.
2. Bridge `simulated-orchestration.ts` into `lib/agent/execution-graph.ts` so retries and worker assignment become queryable.
3. Add backpressure and retry policy to Redis job handling in the worker.

## Suggested Wiring Direction

```ts
User/API Request
  -> gateway
  -> taskRouter.analyzeTask()
  -> providerRouter.selectWithServices()
  -> executeV2Task()
  -> sessionManager / sandbox provider
  -> Redis session-scoped events
  -> SSE client
```

## Files Changed In This Pass

- `lib/agent/services/agent-gateway/src/index.ts`
- `lib/agent/services/agent-worker/src/index.ts`
- `lib/agent/simulated-orchestration.ts`
- `lib/session/session-manager.ts`
- `lib/sandbox/sandbox-orchestrator.ts`
- `ARCHITECTURE_IMPROVEMENT_PLAN.md`
