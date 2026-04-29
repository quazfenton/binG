# Codebase Review: Worker Implementations Comparison

## Overview
The codebase contains multiple "worker" implementations, each serving a distinct part of the agentic ecosystem. These implementations vary significantly in their technical stack, reliability, and architectural role.

## Worker Comparison Table

| Worker | Location | Stack | Purpose | Reliability |
| :--- | :--- | :--- | :--- | :--- |
| **Mastra Worker** | `packages/shared/worker` | BullMQ + Mastra | Executes complex, multi-step Mastra workflows. | **High** (BullMQ retries) |
| **Agent Worker** | `packages/shared/agent/services/agent-worker` | Custom Redis `BRPOP` | Executes core agent loops (OpenCode engine). | **Low** (At-most-once) |
| **Background Worker** | `packages/shared/services/background-worker` | Chokidar + Qdrant | Daemon for file indexing and embeddings. | **High** (Daemon) |
| **Planner Worker** | `packages/shared/services/planner-worker` | Custom Graph + Qdrant | Decomposes prompts into task dependency graphs. | **Medium** |
| **Trigger.dev** | `web/trigger` | Trigger.dev v3 SDK | Durable, long-running background tasks. | **Very High** (Durable) |

## Findings & Analysis

### 1. Technical Fragmentation
There is a clear divide between the **standardized** (Mastra/Trigger.dev) and **custom** (Agent Worker/Planner) implementations. 
- The `Agent Worker` uses a manual Redis list loop (`BRPOP`), which is susceptible to job loss if the worker process crashes after popping a job but before completion.
- The `Mastra Worker` uses `BullMQ`, which is the industry standard for reliable Redis-based task queues in Node.js.

### 2. Redundancy and Overlap
- **Job Execution**: Both the `Agent Worker` and `Trigger.dev` can execute agent loops. The documentation suggests `Trigger.dev` is the preferred path for production, while `Agent Worker` might be a more lightweight or legacy alternative.
- **Search Context**: Both the `Background Worker` and `Planner Worker` interact with Qdrant for code search. The `Background Worker` handles the *ingestion* (indexing), while the `Planner Worker` handles the *retrieval* (search). This is a clean separation of concerns.

### 3. Missing Integration Tests
The `Agent Worker` lacks a comprehensive integration test suite for its Redis loop. Given its custom nature, this is a risk for race conditions or unhandled error states.

### 4. Scalability
- **Concurrency**: Most workers have configurable concurrency (e.g., `WORKER_CONCURRENCY` in Agent Worker, `MASTRA_WORKER_CONCURRENCY` in Mastra).
- **Rate Limiting**: Only the `Mastra Worker` (via BullMQ) and `Background Worker` (manual `setTimeout` in loops) have explicit rate-limiting logic.

## Logic Trace: Complex Task Flow
1.  **Planner Worker**: Receives a prompt and generates a `TaskGraph`.
2.  **Agent Gateway**: Submits jobs to the `agent:jobs` queue.
3.  **Agent Worker**: Picks up a job and calls `executeV2Task`.
4.  **Mastra Worker** (if applicable): Executes a workflow sub-task via the `mastra-agent` queue.
5.  **Background Worker**: Periodically updates the Qdrant index so the Planner has fresh context.

## Recommended Actions
1.  **Unify Queue Libraries**: Transition the `Agent Worker` to use `BullMQ` instead of raw `BRPOP` for better reliability and monitoring.
2.  **Consolidate background logic**: Evaluate if some of the periodic tasks in `Background Worker` should be `Trigger.dev` scheduled tasks for better visibility.
3.  **Shared Schemas**: Create a shared package for job and result types to ensure consistency across the different workers.
4.  **Security Audit**: Ensure that the `Planner Worker` and `Agent Worker` both strictly enforce the `ExecutionPolicy` to prevent unauthorized local command execution.
