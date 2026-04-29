# Codebase Review: Worker Implementations Comparison

## Overview
The codebase contains multiple "worker" implementations, each serving a distinct part of the agentic ecosystem. These implementations vary significantly in their technical stack, reliability, and architectural role.

## Worker Comparison Table

| Worker | Location | Stack | Purpose | Reliability |
| :--- | :--- | :--- | :--- | :--- |
| **Mastra Worker** | `packages/shared/worker` | BullMQ + Mastra | Executes complex, multi-step Mastra workflows. | **High** (BullMQ retries) |
| **Agent Worker** | `packages/shared/agent/services/agent-worker` | BullMQ + OpenCode | Executes core agent loops (OpenCode engine). | **High** (BullMQ + reliability improvements) |
| **Background Worker** | `packages/shared/services/background-worker` | Chokidar + Qdrant | Daemon for file indexing and embeddings. | **High** (Daemon) |
| **Planner Worker** | `packages/shared/services/planner-worker` | BullMQ + Qdrant | Decomposes prompts into task dependency graphs. | **High** (ExecutionPolicy enforced) |
| **Trigger.dev** | `web/trigger` | Trigger.dev v3 SDK | Durable, long-running background tasks. | **Very High** (Durable) |

## Findings & Analysis

### 1. Technical Fragmentation ✅ FIXED
- **Previous Issue**: Agent Worker used manual Redis list loop (`BRPOP`), which is susceptible to job loss if the worker process crashes after popping a job but before completion.
- **Solution Implemented**: 
  - Migrated Agent Worker to use BullMQ for reliable queue management with automatic retries
  - Added configurable job timeouts and retry logic
  - Implemented race condition guards and job locks
  - Graceful shutdown with proper cleanup

### 2. Redundancy and Overlap ✅ VERIFIED & ADDRESSED
- **Job Execution**: Both the `Agent Worker` and `Trigger.dev` can execute agent loops. Now both use BullMQ internally for consistency.
- **Search Context**: Both the `Background Worker` and `Planner Worker` interact with Qdrant for code search. Clean separation maintained:
  - `Background Worker` handles *ingestion* (indexing)
  - `Planner Worker` handles *retrieval* (search)

### 3. Shared Schemas & Consistency ✅ FIXED
- **Previous Issue**: No shared job type definitions, leading to inconsistency across workers
- **Solution Implemented**:
  - Created `packages/shared/lib/worker-schemas.ts` with unified type definitions
  - Defines shared types: `AgentTaskJob`, `WorkflowJob`, `BatchJob`, `BackgroundIndexJob`, `PlanningJob`
  - Standardized job metadata, execution policies, and timeout configurations
  - All workers now reference the same schema types

### 4. ExecutionPolicy Enforcement ✅ FIXED
- **Previous Issue**: No systematic enforcement of ExecutionPolicy across workers
- **Solution Implemented**:
  - Agent Worker: Validates and applies ExecutionPolicy for each job
  - Planner Worker: Enforces ExecutionPolicy constraints for task generation
    - Read-only tasks (search) always use `local-safe` policy
    - File modifications and command execution respect parent policy
    - Feature flag `ENFORCE_EXECUTION_POLICY` for gradual rollout
  - Comprehensive logging of policy violations

### 5. Missing Integration Tests ✅ FIXED
- **Previous Issue**: Agent Worker lacked comprehensive integration test suite
- **Solution Implemented**:
  - Created `packages/shared/agent/services/agent-worker/__tests__/worker.integration.test.ts`
  - Tests cover:
    - Job queue reliability and data preservation
    - Concurrent job processing
    - Priority-based job ordering
    - Automatic retry logic and attempt tracking
    - Job cancellation and session-level cancellation
    - Queue statistics and monitoring
    - Event streaming and sequence preservation
    - Session isolation and context tracking
    - ExecutionPolicy validation and enforcement
    - Health checks

### 6. Race Condition Protection ✅ FIXED
- **Previous Issue**: No guards against concurrent execution of same job
- **Solution Implemented**:
  - Added job lock mechanism to prevent duplicate processing
  - Implemented activeJobIds tracking
  - Lock acquisition/release protocol with promise-based waits
  - BullMQ handles automatic lock renewal during long operations
  - Stalled job detection and requeue logic

### 7. Error Recovery & Graceful Shutdown ✅ FIXED
- **Previous Issue**: No graceful shutdown mechanism
- **Solution Implemented**:
  - Added timeout-based graceful shutdown (default 30 seconds)
  - BullMQ worker closes with pending job cleanup
  - OpenCode engine shutdown before Redis connections close
  - Proper signal handling for SIGTERM and SIGINT
  - Health check endpoint (`/health`) reports worker status
  - Ready endpoint (`/ready`) for Kubernetes readiness probes

## Implementation Details

### Agent Worker Migration (BullMQ)
**File**: `packages/shared/agent/services/agent-worker/src/index.ts`

Changes:
- Replaced BRPOP loop with BullMQ Worker
- Uses `bullmq` library for reliable job processing
- Job processing with progress tracking (5%, 15%, 30%, 50%, 85%, 100%)
- Configurable concurrency via `WORKER_CONCURRENCY` env var
- Lock renewal every 30 seconds for long-running jobs
- Max stalled count set to 2 before requeue

**Configuration**:
- `JOB_TIMEOUT_MS`: Max execution time (default: 1 hour)
- `MAX_RETRIES`: Automatic retry count (default: 2)
- `WORKER_CONCURRENCY`: Parallel job processing (default: 4)
- `SHUTDOWN_TIMEOUT_MS`: Graceful shutdown timeout (default: 30s)

### Shared Schemas
**File**: `packages/shared/lib/worker-schemas.ts`

Types exported:
- `AgentTaskJob`: For agent execution tasks
- `WorkflowJob`: For Mastra workflow execution
- `BatchJob`: For batch item processing
- `BackgroundIndexJob`: For indexing tasks
- `PlanningJob`: For task decomposition

Utilities:
- Type guards: `isAgentTaskJob()`, `isWorkflowJob()`, etc.
- Default timeouts by job type
- Default retry counts by job type
- `getJobTimeout()` and `getMaxRetries()` helpers

### ExecutionPolicy Enforcement
**Agent Worker**:
- Validates policy against task requirements (bash, file write, backend, GUI, long-running)
- Selects provider based on policy
- Logs all policy decisions

**Planner Worker**:
- Each task inherits or respects parent execution policy
- Search tasks always use `local-safe` (read-only)
- Command execution blocked if policy forbids it
- Feature flag `ENFORCE_EXECUTION_POLICY` (default: true)

### Integration Tests
**File**: `packages/shared/agent/services/agent-worker/__tests__/worker.integration.test.ts`

Test categories:
- Job Queue Reliability (5 tests)
- Job Retry Logic (2 tests)
- Job Cancellation (2 tests)
- Queue Statistics (2 tests)
- Event Stream (2 tests)
- Session Isolation (2 tests)
- Health Checks (1 test)
- ExecutionPolicy Enforcement (2 tests)

**Total**: 18 comprehensive integration tests

### Package.json Updates
**File**: `packages/shared/agent/services/agent-worker/package.json`

Dependencies added:
- `bullmq: ^5.0.0` - For reliable job queue processing

### Vitest Configuration
**File**: `vitest.config.ts`

Updated to include `**/__tests__/**/*.test.ts` pattern for discovering tests in package-level test directories

## Testing & Validation

### To run Agent Worker tests:
```bash
# From repository root
pnpm test packages/shared/agent/services/agent-worker/__tests__

# Or run all worker-related tests
pnpm test worker.integration
```

### To test in production deployment:
```bash
# Check worker health
curl http://localhost:3003/health

# Verify worker readiness
curl http://localhost:3003/ready
```

## Migration Path

### For Existing Deployments:
1. Update `packages/shared/agent/services/agent-worker` dependencies
2. Redeploy Agent Worker with new BullMQ-based implementation
3. Old BRPOP jobs in queue will be lost (consider draining queue first)
4. Monitor health endpoint during rollout

### Environment Variables:
```bash
# Existing (still supported)
REDIS_URL=redis://localhost:6379
WORKER_CONCURRENCY=4

# New
JOB_TIMEOUT_MS=3600000
MAX_RETRIES=2
SHUTDOWN_TIMEOUT_MS=30000
ENFORCE_EXECUTION_POLICY=true
```

## Security Considerations

1. **ExecutionPolicy**: All job execution is now constrained by policy
2. **Race Conditions**: Job locks prevent duplicate execution
3. **Resource Limits**: Timeouts prevent runaway processes
4. **Graceful Degradation**: Worker can be safely killed during shutdown

## Next Steps

1. ✅ Migrate Agent Worker to BullMQ
2. ✅ Create shared job schemas
3. ✅ Add integration tests
4. ✅ Enforce ExecutionPolicy
5. ✅ Add race condition guards
6. Potential: Consider consolidating periodic Background Worker tasks to Trigger.dev for better observability
7. Potential: Add distributed tracing across workers
8. Potential: Implement worker pool management for horizontal scaling

## Status: ✅ COMPLETED

All identified issues have been addressed:
- Agent Worker now uses BullMQ instead of BRPOP ✅
- Shared job schemas created ✅
- Integration tests added ✅
- ExecutionPolicy enforcement implemented ✅
- Race condition protection added ✅
- Graceful shutdown implemented ✅
- Health monitoring endpoints added ✅
