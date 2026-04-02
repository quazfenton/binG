# Trigger.dev Integration Guide

## Overview

This integration provides **Trigger.dev** task execution with **automatic fallback** to local execution when the Trigger.dev SDK is not configured. This allows the system to work in both development and production environments seamlessly.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (agent-loop.ts, agent-team.ts, reflection-engine.ts, etc.) │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│              Trigger.dev Integration Layer                   │
│  lib/events/trigger/*.ts - Wrappers with fallback logic     │
│  - Checks if @trigger.dev/sdk is available                  │
│  - Uses Trigger.dev when available                          │
│  - Falls back to local execution when not                   │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│              Execution Backends                              │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │ Trigger.dev SDK │    │ Local Execution (Fallback)  │    │
│  │ - Persistent    │    │ - Direct function calls     │    │
│  │ - Durable       │    │ - In-process                │    │
│  │ - Distributed   │    │ - Development friendly      │    │
│  │ - Scheduled     │    │                             │    │
│  └─────────────────┘    └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Available Tasks

### 1. Agent Loop Task

**Purpose:** Persistent agent cognition loop with checkpointing

**File:** `lib/events/trigger/agent-loop-task.ts`

**Usage:**
```typescript
import { executeAgentLoopTask, scheduleAgentLoop } from '@/lib/events/trigger';

// Execute immediately
const result = await executeAgentLoopTask({
  agentId: 'agent-1',
  userMessage: 'Analyze this codebase',
  sandboxId: 'sandbox-123',
  userId: 'user-456',
  maxSteps: 15,
});

// Schedule recurring execution
const scheduled = await scheduleAgentLoop({
  agentId: 'agent-1',
  goal: 'Monitor repository for issues',
  schedule: {
    type: 'cron',
    expression: '*/30 * * * *', // Every 30 minutes
  },
});
```

**Fallback:** Uses `lib/orchestra/agent-loop.ts` directly

---

### 2. Multi-Agent Consensus Task

**Purpose:** Parallel agent execution with consensus voting

**File:** `lib/events/trigger/consensus-task.ts`

**Usage:**
```typescript
import { executeConsensusTask } from '@/lib/events/trigger';

const result = await executeConsensusTask({
  task: 'Design the system architecture',
  agents: [
    { id: 'architect', role: 'architect', type: 'claude-code', model: 'claude-opus', weight: 2 },
    { id: 'developer', role: 'developer', type: 'claude-code', model: 'claude-sonnet' },
    { id: 'reviewer', role: 'reviewer', type: 'amp', model: 'amp-coder' },
  ],
  workspaceDir: '/workspace/my-project',
  consensusThreshold: 0.7, // 70% agreement required
});
```

**Fallback:** Uses `lib/spawn/orchestration/agent-team.ts` directly

---

### 3. Research Agent Task

**Purpose:** Long-running research with parallel source exploration

**File:** `lib/events/trigger/research-task.ts`

**Usage:**
```typescript
import { executeResearchTask } from '@/lib/events/trigger';

const result = await executeResearchTask({
  query: 'What is quantum computing?',
  depth: 5, // levels of deep exploration
  sources: ['web', 'news', 'academic'],
  checkpointInterval: 3, // checkpoint every 3 iterations
});
```

**Fallback:** Uses feed API for research results

---

### 4. Reflection Task

**Purpose:** Post-execution analysis and self-improvement

**File:** `lib/events/trigger/reflection-task.ts`

**Usage:**
```typescript
import { executeReflectionTask, scheduleReflection } from '@/lib/events/trigger';

// Execute reflection
const result = await executeReflectionTask({
  executionId: 'exec-123',
  result: { /* execution result */ },
  error: undefined,
  history: [/* action history */],
});

// Schedule automatic reflection after task
const scheduled = await scheduleReflection({
  triggerEventId: 'exec-123',
  result: { /* ... */ },
  delayMs: 5000, // Reflect 5 seconds after execution
});
```

**Fallback:** Uses `lib/orchestra/reflection-engine.ts` directly

---

### 5. DAG Executor Task

**Purpose:** Durable workflow execution with self-healing

**File:** `lib/events/trigger/dag-task.ts`

**Usage:**
```typescript
import { executeDAGTask, scheduleDAGExecution } from '@/lib/events/trigger';

const result = await executeDAGTask({
  dag: {
    nodes: [
      { id: 'build', type: 'bash', command: 'npm run build', dependsOn: [] },
      { id: 'test', type: 'bash', command: 'npm test', dependsOn: ['build'] },
      { id: 'deploy', type: 'bash', command: 'npm run deploy', dependsOn: ['test'] },
    ],
    edges: [
      { from: 'build', to: 'test' },
      { from: 'test', to: 'deploy' },
    ],
  },
  agentId: 'agent-1',
  workingDir: '/workspace/my-project',
  maxRetries: 3,
  healOnFailure: true,
  parallel: true,
});

// Schedule recurring DAG execution
const scheduled = await scheduleDAGExecution({
  agentId: 'agent-1',
  workingDir: '/workspace/my-project',
  dag: { /* ... */ },
  schedule: {
    type: 'cron',
    expression: '0 2 * * *', // Daily at 2 AM
  },
});
```

**Fallback:** Uses `lib/bash/dag-executor.ts` directly

---

### 6. Skill Bootstrap Task

**Purpose:** Extract reusable skills from successful executions

**File:** `lib/events/trigger/skill-bootstrap-task.ts`

**Usage:**
```typescript
import { executeSkillBootstrapTask, scheduleSkillBootstrap } from '@/lib/events/trigger';

// Execute skill extraction
const result = await executeSkillBootstrapTask({
  successfulRun: {
    steps: [
      { action: 'read_file', result: { content: '...' }, success: true },
      { action: 'write_file', result: { path: 'src/app.ts' }, success: true },
      { action: 'exec_shell', result: { stdout: 'Build successful' }, success: true },
    ],
    totalDuration: 5420,
    userId: 'user-123',
  },
  abstractionLevel: 'moderate', // simple | moderate | complex
  model: 'claude-3-opus',
  storeSkill: true,
});

// Result contains extracted skill
console.log(result.skill);
// {
//   name: 'TypeScript Project Setup',
//   description: 'Sets up a TypeScript project with proper configuration',
//   parameters: { projectName: string, strict: boolean },
//   implementation: '...',
//   category: 'project-setup',
//   tags: ['typescript', 'setup', 'boilerplate']
// }

// Schedule automatic skill extraction after successful task
const scheduled = await scheduleSkillBootstrap({
  successfulRunId: 'run-123',
  triggerEventId: 'exec-456',
  abstractionLevel: 'moderate',
  delayMs: 3000, // Extract 3 seconds after execution
});
```

**Fallback:** Uses `lib/events/handlers/bing-handlers.ts:handleSkillBootstrap` directly

**Abstraction Levels:**
- `simple`: Direct pattern extraction (minimal generalization)
- `moderate`: Balanced abstraction (recommended)
- `complex`: Highly generalized skill (maximum reusability)

**Use Cases:**
- Extract patterns from successful code generation
- Learn from successful debugging sessions
- Capture workflow optimizations
- Build library of reusable agent skills

---

## Generic Execution API

For dynamic task execution:

```typescript
import { executeTask, getExecutionMode } from '@/lib/events/trigger';

// Check execution mode
const mode = await getExecutionMode(); // 'trigger' | 'local'

// Execute any task type
const result = await executeTask('agent-loop', {
  agentId: 'agent-1',
  userMessage: 'Hello',
  sandboxId: 'sandbox-123',
});

// Or with type safety
const result = await executeTask<'consensus', ConsensusTaskResult>(
  'consensus',
  { /* payload */ }
);
```

---

## API Endpoints

### POST /api/zine-display/trigger

**Actions:**

1. **Schedule a task:**
```json
{
  "action": "schedule",
  "taskId": "agent-loop",
  "payload": {
    "agentId": "agent-1",
    "goal": "Monitor repository"
  },
  "schedule": {
    "type": "cron",
    "expression": "*/30 * * * *"
  }
}
```

2. **Trigger immediately:**
```json
{
  "action": "trigger",
  "taskId": "research-agent",
  "payload": {
    "query": "What is TypeScript?",
    "depth": 3
  }
}
```

**Response:**
```json
{
  "success": true,
  "result": { /* task result */ },
  "executionMode": "trigger" // or "local"
}
```

---

## Configuration

### Environment Variables

```bash
# Trigger.dev (optional - system works without it)
TRIGGER_SECRET_KEY=tr_secret_xxx

# Fallback execution settings
FAST_AGENT_REFLECTION_ENABLED=true
FAST_AGENT_REFLECTION_THREADS=3
FAST_AGENT_REFLECTION_TIMEOUT=15000
```

### trigger.config.ts

Already configured at project root:

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "binG-agent-system",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600, // 1 hour
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
});
```

---

## Deployment

### Development (No Trigger.dev)

System works out of the box with local execution:

```bash
pnpm dev
# Tasks execute locally with automatic fallback
```

### Production (With Trigger.dev)

1. **Set up Trigger.dev:**
```bash
pnpm trigger.dev login
pnpm trigger.dev deploy
```

2. **Set environment variable:**
```bash
export TRIGGER_SECRET_KEY=tr_secret_xxx
```

3. **Tasks automatically use Trigger.dev:**
```typescript
// No code changes needed - automatic detection
const result = await executeAgentLoopTask({ /* ... */ });
// Executes via Trigger.dev in production
// Falls back to local in development
```

---

## Benefits

| Feature | Trigger.dev Mode | Local Mode |
|---------|-----------------|------------|
| **Persistence** | ✅ Survives restarts | ❌ In-memory only |
| **Durability** | ✅ Automatic retries | ⚠️ Manual retry logic |
| **Observability** | ✅ Dashboard + logs | ⚠️ Console logs only |
| **Scheduling** | ✅ Reliable cron | ⚠️ Custom scheduler |
| **Parallelism** | ✅ Distributed | ⚠️ Single process |
| **Checkpointing** | ✅ Built-in | ⚠️ Manual implementation |
| **Development** | ⚠️ Requires setup | ✅ Works immediately |

---

## Migration Path

### Phase 1: Development (Current)
- All tasks execute locally
- No Trigger.dev configuration needed
- Full functionality for testing

### Phase 2: Hybrid
- Trigger.dev configured for production
- Development still uses local fallback
- Same codebase, different execution backends

### Phase 3: Production
- All tasks execute via Trigger.dev
- Persistence, durability, scheduling enabled
- Dashboard for monitoring

---

## Troubleshooting

### "Task executed in local mode" in production

**Cause:** Trigger.dev SDK not found or not configured

**Fix:**
```bash
# Check if SDK is installed
pnpm list @trigger.dev/sdk

# Install if missing
pnpm add @trigger.dev/sdk

# Set environment variable
export TRIGGER_SECRET_KEY=tr_secret_xxx
```

### "Task failed" errors

**Check logs:**
```typescript
// Enable debug logging
import { createLogger } from '@/lib/utils/logger';
const logger = createLogger('Trigger:*');
```

**Check Trigger.dev dashboard:**
```
https://cloud.trigger.dev/projects/binG-agent-system
```

### Scheduling not working

**Verify cron expression:**
```typescript
// Valid examples:
'*/30 * * * *'  // Every 30 minutes
'0 2 * * *'     // Daily at 2 AM
'0 9 * * 1'     // Every Monday at 9 AM
```

---

## Testing

### Unit Tests

```bash
pnpm test __tests__/trigger/*.test.ts
```

### Integration Tests

```bash
# Test with local fallback
pnpm test __tests__/trigger-integration.test.ts

# Test with Trigger.dev (requires TRIGGER_SECRET_KEY)
TRIGGER_SECRET_KEY=tr_test_xxx pnpm test __tests__/trigger-integration.test.ts
```

### Manual Testing

```typescript
// Test execution mode detection
import { getExecutionMode } from '@/lib/events/trigger';
const mode = await getExecutionMode();
console.log(`Executing in ${mode} mode`);

// Test each task type
import { executeAgentLoopTask, executeConsensusTask } from '@/lib/events/trigger';

const agentResult = await executeAgentLoopTask({ /* ... */ });
const consensusResult = await executeConsensusTask({ /* ... */ });
```

---

## Future Enhancements

1. **Skill Bootstrapping Task** - Extract reusable skills from successful runs
2. **Tool Discovery Task** - Dynamic tool exploration and ranking
3. **Autonomous Debug Task** - Automatic error diagnosis and fixing
4. **Speculative Execution Task** - Parallel strategy execution with selection

---

## Related Files

- `lib/events/trigger/` - Task wrappers
- `lib/events/trigger/index.ts` - Main export
- `lib/events/trigger-dev-tasks.ts` - Task definitions
- `app/api/zine-display/trigger/route.ts` - API endpoints
- `trigger.config.ts` - Trigger.dev configuration
- `trigger/` - Trigger.dev task definitions (for production)
