# Redis Integration for V2 Agent Architecture

**Location:** `lib/redis/agent-service.ts`

---

## 📊 Overview

This module provides comprehensive Redis integration for the V2 Agent Architecture defined in `docker-compose.v2.yml`.

### Features

- ✅ **Job Queue** - Push/pop agent jobs with blocking operations
- ✅ **PubSub Events** - Real-time event streaming for SSE
- ✅ **Event Persistence** - Redis Streams for event history
- ✅ **Session Management** - User sessions with TTL
- ✅ **Worker Coordination** - Worker registration and heartbeat
- ✅ **Health Monitoring** - Connection health checks

---

## 🏗️ Architecture Integration

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   NextJS    │────▶│Agent Gateway │────▶│  Redis Queue    │
│   (app)    │     │  (gateway)   │     │  (pubsub/jobs)  │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                          ┌────────────────────────┼────────────────┐
                          │                        │                │
                          ▼                        ▼                ▼
                   ┌─────────────┐         ┌─────────────┐ ┌─────────────┐
                   │Agent Workers│         │   Planner   │ │ Scheduler   │
                   │ (OpenCode)  │         │  (Planning) │ │  (Cron)     │
                   └─────────────┘         └─────────────┘ └─────────────┘
```

---

## 🔧 Usage

### Basic Usage

```typescript
import { redisAgentService, getRedisAgentService } from '@/lib/redis/agent-service';

// Get service instance (uses REDIS_URL from env)
const redis = getRedisAgentService();

// Wait for connection
await redis.waitForConnection();

// Push job to queue
await redis.pushJob({
  id: 'job_123',
  sessionId: 'session_456',
  userId: 'user_789',
  conversationId: 'conv_012',
  prompt: 'Create a React component',
  status: 'pending',
});

// Pop job from queue (blocking, 5 second timeout)
const job = await redis.popJob(5);

// Publish event
await redis.publishEvent({
  type: 'job:started',
  sessionId: 'session_456',
  jobId: 'job_123',
  data: { workerId: 'worker_1' },
  timestamp: Date.now(),
});
```

### With Custom Configuration

```typescript
import { initializeRedisAgentService } from '@/lib/redis/agent-service';

const redis = await initializeRedisAgentService({
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  jobQueue: 'agent:jobs',
  eventChannel: 'agent:events',
  eventStream: 'agent:events:stream',
  jobTTL: 3600,      // 1 hour
  sessionTTL: 7200,  // 2 hours
});
```

---

## 📚 API Reference

### Job Queue Operations

#### `pushJob(job: AgentJob): Promise<void>`
Push a job to the queue.

```typescript
await redis.pushJob({
  id: 'job_123',
  sessionId: 'session_456',
  userId: 'user_789',
  conversationId: 'conv_012',
  prompt: 'Build a todo app',
  status: 'pending',
  createdAt: Date.now(),
});
```

#### `popJob(timeout: number): Promise<AgentJob | null>`
Pop a job from the queue (blocking).

```typescript
const job = await redis.popJob(5); // 5 second timeout
if (job) {
  console.log(`Processing job ${job.id}`);
}
```

#### `getJob(jobId: string): Promise<AgentJob | null>`
Get job by ID.

```typescript
const job = await redis.getJob('job_123');
```

#### `updateJobStatus(jobId, status, updates): Promise<void>`
Update job status.

```typescript
await redis.updateJobStatus('job_123', 'processing', {
  workerId: 'worker_1',
  startedAt: Date.now(),
});
```

#### `getQueueLength(): Promise<number>`
Get number of jobs in queue.

```typescript
const queueLength = await redis.getQueueLength();
```

---

### PubSub Events

#### `publishEvent(event: AgentEvent): Promise<void>`
Publish event to PubSub channel and stream.

```typescript
await redis.publishEvent({
  type: 'token',
  sessionId: 'session_456',
  data: { content: 'Hello' },
  timestamp: Date.now(),
});
```

#### `subscribeEvents(callback, sessionId?): Promise<Redis>`
Subscribe to events.

```typescript
const subClient = await redis.subscribeEvents((event) => {
  console.log('Event received:', event);
}, 'session_456');
```

#### `getEventHistory(sessionId, limit): Promise<AgentEvent[]>`
Get event history from stream.

```typescript
const events = await redis.getEventHistory('session_456', 100);
```

---

### Session Management

#### `upsertSession(session: AgentSession): Promise<void>`
Create or update session.

```typescript
await redis.upsertSession({
  id: 'session_456',
  userId: 'user_789',
  conversationId: 'conv_012',
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
  status: 'active',
});
```

#### `getSession(sessionId: string): Promise<AgentSession | null>`
Get session by ID.

```typescript
const session = await redis.getSession('session_456');
```

#### `getUserSessions(userId: string): Promise<AgentSession[]>`
Get all sessions for user.

```typescript
const sessions = await redis.getUserSessions('user_789');
```

#### `touchSession(sessionId: string): Promise<void>`
Update session activity timestamp.

```typescript
await redis.touchSession('session_456');
```

#### `closeSession(sessionId: string): Promise<void>`
Mark session as completed.

```typescript
await redis.closeSession('session_456');
```

---

### Worker Coordination

#### `registerWorker(workerId, metadata): Promise<void>`
Register a worker.

```typescript
await redis.registerWorker('worker_1', {
  concurrency: 4,
  model: 'opencode/minimax-m2.5-free',
});
```

#### `workerHeartbeat(workerId, stats): Promise<void>`
Update worker heartbeat.

```typescript
await redis.workerHeartbeat('worker_1', {
  currentJobs: 2,
  memoryUsage: 512,
  cpuUsage: 45,
});
```

#### `getActiveWorkers(): Promise<Array<{id, metadata}>>`
Get active workers.

```typescript
const workers = await redis.getActiveWorkers();
```

---

### Health Check

#### `healthCheck(): Promise<HealthStatus>`
Check Redis health.

```typescript
const health = await redis.healthCheck();
console.log(health);
// {
//   connected: true,
//   queueLength: 5,
//   activeWorkers: 3,
//   latency: 2
// }
```

---

## 🔧 Environment Variables

```bash
# Redis connection
REDIS_URL=redis://redis:6379

# Optional overrides
REDIS_JOB_QUEUE=agent:jobs
REDIS_EVENT_CHANNEL=agent:events
REDIS_EVENT_STREAM=agent:events:stream
REDIS_SESSION_PREFIX=agent:session
REDIS_JOB_TTL=3600        # 1 hour
REDIS_SESSION_TTL=7200    # 2 hours
```

---

## 🐳 Docker Compose Integration

The service is designed to work with `docker-compose.v2.yml`:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  gateway:
    environment:
      - REDIS_URL=redis://redis:6379

  worker:
    environment:
      - REDIS_URL=redis://redis:6379
```

---

## 📊 Redis Data Structures

### Job Queue
```
Key: agent:jobs
Type: List
TTL: None (jobs have individual TTL)
```

### Job Storage
```
Key: agent:job:{jobId}
Type: String (JSON)
TTL: 1 hour (configurable)
```

### Event PubSub
```
Channel: agent:events
Type: PubSub
```

### Event Stream
```
Key: agent:events:stream
Type: Stream
MaxLen: ~10000 events
```

### Sessions
```
Key: agent:session:{sessionId}
Type: String (JSON)
TTL: 2 hours (configurable)

Key: agent:user:{userId}:sessions
Type: Set (session IDs)
```

### Workers
```
Key: agent:workers
Type: Hash (workerId -> JSON)
TTL: 1 hour
```

---

## 🚨 Error Handling

The service includes automatic retry and error handling:

```typescript
// Automatic reconnection with exponential backoff
retryStrategy: (times) => {
  if (times > 3) return null; // Give up after 3 retries
  return Math.min(times * 100, 3000);
}

// Health check before operations
await redis.waitForConnection(5000);
```

---

## 🔍 Monitoring

### Check Queue Status
```bash
docker-compose -f docker-compose.v2.yml exec redis redis-cli LLEN agent:jobs
```

### Check Active Workers
```bash
docker-compose -f docker-compose.v2.yml exec redis redis-cli HGETALL agent:workers
```

### Check Event Stream
```bash
docker-compose -f docker-compose.v2.yml exec redis redis-cli XLEN agent:events:stream
```

### Check PubSub Channels
```bash
docker-compose -f docker-compose.v2.yml exec redis redis-cli PUBSUB CHANNELS
```

---

## 📝 Examples

### Complete Job Flow

```typescript
import { redisAgentService } from '@/lib/redis/agent-service';

// 1. Create job
const job: AgentJob = {
  id: `job_${Date.now()}`,
  sessionId: 'session_123',
  userId: 'user_456',
  conversationId: 'conv_789',
  prompt: 'Create a login form',
  status: 'pending',
};

// 2. Push to queue
await redisAgentService.pushJob(job);

// 3. Subscribe to events
await redisAgentService.subscribeEvents((event) => {
  console.log(`${event.type}:`, event.data);
}, job.sessionId);

// 4. Worker pops job
const poppedJob = await redisAgentService.popJob(5);
if (poppedJob) {
  // 5. Update status
  await redisAgentService.updateJobStatus(poppedJob.id, 'processing', {
    workerId: 'worker_1',
  });
  
  // 6. Publish progress events
  await redisAgentService.publishEvent({
    type: 'job:progress',
    sessionId: poppedJob.sessionId,
    jobId: poppedJob.id,
    data: { step: 'Planning...' },
    timestamp: Date.now(),
  });
  
  // 7. Update final status
  await redisAgentService.updateJobStatus(poppedJob.id, 'completed');
}
```

---

*Created: March 2026*
*For use with docker-compose.v2.yml*
