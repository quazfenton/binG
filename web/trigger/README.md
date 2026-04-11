# Trigger.dev Tasks (v3/v4)

This directory contains registered Trigger.dev task definitions that run on the Trigger.dev worker infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js App (web/)                                         │
│                                                             │
│  Callers:                                                   │
│    lib/events/trigger/*.ts          ← Task wrappers         │
│      executeAgentLoopTask()                                 │
│      executeConsensusTask()                                 │
│      executeDAGTask()                                       │
│      executeReflectionTask()                                │
│      executeResearchTask()                                  │
│      executeSkillBootstrapTask()                            │
│                                                             │
│    lib/events/trigger/utils.ts       ← Utilities            │
│      invokeTriggerTask()              ← dispatches to v3    │
│      executeWithFallback()           ← trigger→local        │
│      isTriggerAvailable()            ← SDK detection        │
└──────────┬──────────────────────────────────────────────────┘
           │ tasks.invoke(taskId, payload)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Trigger.dev Worker (cloud or self-hosted)                  │
│                                                             │
│  Registered Tasks:                                          │
│    trigger/agent-loop.ts       → runAgentLoop()             │
│    trigger/consensus.ts        → createAgentTeam().execute()│
│    trigger/dag-task.ts         → executeDAGSmart()          │
│    trigger/reflection-task.ts  → reflectionEngine.reflect() │
│    trigger/research-task.ts    → /api/news research         │
│    trigger/skill-bootstrap.ts  → handleSkillBootstrap()     │
│                                                             │
│  Each task has:                                             │
│    - maxDuration (up to 1 hour)                             │
│    - retry with exponential backoff                         │
│    - durable execution (survives restarts)                  │
└─────────────────────────────────────────────────────────────┘
```

## Task Registry

| File | Task ID | Max Duration | Retries | Purpose |
|------|---------|-------------|---------|---------|
| `agent-loop.ts` | `agent-loop` | 3600s | 3 | Multi-step AI agent conversation |
| `consensus.ts` | `consensus-task` | 3600s | 3 | Multi-agent deliberation |
| `dag-task.ts` | `dag-task` | 3600s | 3 | Bash/tool DAG execution |
| `reflection-task.ts` | `reflection-task` | 300s | 2 | Post-execution analysis |
| `research-task.ts` | `research-task` | 3600s | 3 | Long-running research |
| `skill-bootstrap.ts` | `skill-bootstrap` | 300s | 3 | Skill extraction from runs |

## How It Works

1. **Caller** imports a wrapper (e.g., `executeAgentLoopTask`) and calls it with a payload
2. **Wrapper** checks if Trigger.dev SDK is available via `isTriggerAvailable()`
3. **If available**: calls `invokeTriggerTask(taskId, payload)` → dispatches to registered task
4. **If not available**: executes locally as fallback
5. **Trigger.dev worker** runs the registered `task()` with durable execution and retries

## Adding a New Task

1. Create `trigger/my-new-task.ts` with a `task()` definition:
   ```ts
   import { task } from "@trigger.dev/sdk/v3";

   export const myNewTask = task({
     id: "my-new-task",
     maxDuration: 300,
     retry: { maxAttempts: 3 },
     run: async (payload: { query: string }) => {
       // ... do work
       return { result: "done" };
     },
   });
   ```

2. Create a wrapper in `lib/events/trigger/my-new-task.ts`:
   ```ts
   import { executeWithFallback, invokeTriggerTask } from './utils';

   export async function executeMyNewTask(payload: MyPayload) {
     return executeWithFallback<MyPayload, MyResult>(
       async (taskId) => invokeTriggerTask(taskId, payload),
       (p) => executeLocally(p),
       'my-new-task',
       payload
     );
   }
   ```

3. Export from `lib/events/trigger/index.ts`

## Configuration

See `trigger.config.ts` for project settings, retry defaults, and build configuration.

## Environment Variables

- `TRIGGER_API_URL` — Trigger.dev API URL (set by CLI)
- `TRIGGER_SECRET_KEY` — API key for authentication
