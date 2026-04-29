# Codebase Review: Redis Usage

## Overview
Redis is a central component of the binG architecture, serving as a job queue, a real-time event bus (PubSub), and a state cache. It is primarily utilized by the **Agent Gateway** and **Agent Worker** services.

## Key Modules
- `packages/shared/agent/services/agent-gateway`: HTTP API for job submission and status tracking.
- `packages/shared/agent/services/agent-worker`: Background worker that executes agent tasks.
- `packages/shared/agent/orchestration`: (Mentioned in docs, uses Redis for checkpointing).

## Findings

### 1. Architectural Patterns
- **Job Queue**: Implemented using basic Redis Lists (`LPUSH` and `BRPOP`).
  - **Risk**: *At-most-once* delivery. If a worker crashes while processing a job, the job is lost because `BRPOP` removes it from the queue immediately.
  - **Recommendation**: Migrate to a reliable queue pattern (e.g., `RPOPLPUSH` or `BRPOPLPUSH`) or use a library like **BullMQ**.
- **Event Bus**: Uses Redis PubSub for real-time streaming to frontend clients via SSE.
  - **Scalability**: Every SSE connection in the Gateway creates a **new** Redis connection for subscription. High traffic could lead to connection exhaustion.
  - **Recommendation**: Use a single subscription connection in the Gateway that multiplexes session events to the appropriate SSE streams.
- **State & Checkpoints**: Checkpoints are stored in Redis Hashes (`agent:checkpoint:${sessionId}`).
  - **Persistence**: Checkpoints do not have an expiration time (`EXPIRE`), which may lead to unbounded memory growth over time.
  - **Recommendation**: Implement a TTL for checkpoints based on session activity.

### 2. Security & Reliability
- **Path Traversal**: The worker uses `normalizeSessionId` to sanitize `conversationId` before using it in file paths. This is a good security measure.
- **Connection Management**: Basic `ioredis` configuration. No explicit retry strategies or circuit breakers for Redis connectivity are evident in the main service files.
- **Redis Commands**: The Gateway uses `KEYS agent:sessions:*` in the `/sessions` endpoint.
  - **CRITICAL**: `KEYS` is an $O(N)$ operation that can block the Redis event loop in production.
  - **Recommendation**: Replace `KEYS` with `SCAN`.

### 3. Consistency
- The `Agent Gateway` and `Agent Worker` share a common understanding of job and session schemas, but these interfaces are duplicated across files rather than shared from a common package.
- **Redis URL**: Hardcoded defaults (`redis://localhost:6379`) are consistent across services.

## Summary of Risks
| Risk | Severity | Description |
| :--- | :--- | :--- |
| **Job Loss** | High | Workers use `BRPOP`, making job delivery unreliable during crashes. |
| **Performance (Blocked Redis)** | High | Use of `KEYS` command in API endpoints. |
| **Connection Exhaustion** | Medium | New Redis connection per SSE stream. |
| **Unbounded Memory** | Medium | Checkpoints lack expiration TTLs. |

## Recommended Actions
1. Replace `redis.keys()` with `redis.scanStream()` or `redis.scan()`.
2. Refactor SSE subscription logic to use a shared connection.
3. Add TTLs to checkpoint keys.
4. (Longer term) Evaluate `BullMQ` for more robust job management.

---

**Status:** 🟡 **PARTIALLY REMEDIATED** — KEYS→SCAN, SSE multiplexing, checkpoint TTLs verified 2026-04-30. BullMQ already in use for worker.

---

## Remediation Log

### HIGH: Replace `KEYS` with `SCAN` — **FIXED** ✅
- **File:** `packages/shared/agent/services/agent-gateway/src/index.ts`
- **Fix:** Replaced `redis.keys()` in `/sessions` endpoint with `redis.scanStream({ match, count: 100 })` using async iteration. SCAN is O(1) per call (vs O(N) for KEYS) and doesn't block the Redis event loop.

### MED: SSE Connection Exhaustion — **FIXED** ✅
- **File:** `packages/shared/agent/services/agent-gateway/src/index.ts`
- **Fix:** Replaced per-SSE-stream Redis subscriber connections with a single shared subscriber that multiplexes events to the correct SSE client by sessionId. `registerSSEClient()` adds callbacks to a routing map; `unregister()` removes them and unsubscribes when the last client for a session disconnects. Eliminates one Redis connection per SSE stream.

### MED: Checkpoint TTL — **ALREADY IMPLEMENTED** ✅
- **File:** `packages/shared/agent/services/agent-worker/src/checkpoint-manager.ts`
- **Note:** Checkpoint manager already sets `CHECKPOINT_TTL = 86400 * 7` (7 days) via `redis.expire()` after each `save()`. Session keys in gateway also have `SESSION_TIMEOUT_MS` TTL. No fix needed.

### HIGH: Job Loss on Worker Crash — **ALREADY ADDRESSED** ✅
- **Note:** The worker already uses BullMQ (at-least-once delivery with automatic job re-queue on worker crash). BullMQ's `lockDuration`, `lockRenewTime`, and `maxStalledCount` settings handle this. The BRPOP concern was about legacy code no longer in use.
