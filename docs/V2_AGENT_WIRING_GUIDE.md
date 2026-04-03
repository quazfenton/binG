# V2 Agent System - Complete Wiring Guide

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   NextJS App    │────▶│  Agent Gateway  │────▶│   Redis Queue   │
│  (UI + API)     │HTTP │  (Fastify)      │PubSub│  (Jobs + Events)│
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         │ Pull Jobs
                                                         ▼
                                                ┌─────────────────┐
                                                │  Agent Worker   │
                                                │ (OpenCode Engine)│
                                                └────────┬────────┘
                                                         │
                              ┌──────────────────────────┼──────────────────────────┐
                              │                          │                          │
                              ▼                          ▼                          ▼
                     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
                     │  Git-Backed VFS │     │   MCP Server    │     │   Nullclaw      │
                     │ (Auto-Commits)  │     │  (Tools @8888)  │     │ (Automation)    │
                     └────────┬────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Shadow Commit   │
                     │ (Audit Trail)   │
                     └─────────────────┘
```

---

## Data Flow

### 1. User Creates Job

```
POST /api/chat (NextJS)
  ↓
POST http://gateway:3002/jobs (Agent Gateway)
  ↓
LPUSH agent:jobs (Redis Queue)
  ↓
PUBLISH agent:events "job:ready"
```

### 2. Worker Processes Job

```
Worker polls Redis Queue
  ↓
BRPOP agent:jobs (blocking pop)
  ↓
Initialize Git-Backed VFS
  ↓
Run OpenCode Engine
  ↓
For each tool call:
  - Execute via MCP
  - Write to Git-Backed VFS (auto-commit)
  - Publish event via Redis PubSub
```

### 3. Events Stream to Client

```
Worker → PUBLISH agent:events (Redis)
  ↓
Gateway subscribes via PSUBSCRIBE
  ↓
Gateway → SSE Stream (text/event-stream)
  ↓
Client receives: init, token, tool:start, tool:result, git:commit, done
```

---

## Component Wiring

### Agent Gateway (`lib/agent/services/agent-gateway/src/index.ts`)

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/jobs` | POST | Create new agent job |
| `/stream/:sessionId` | GET | SSE event stream |
| `/jobs/:jobId` | GET | Get job status |
| `/sessions/:sessionId` | GET | Get session info |
| `/git/:sessionId/versions` | GET | List git versions |
| `/git/:sessionId/rollback` | POST | Rollback to version |
| `/git/:sessionId/diff` | GET | Get diff between versions |
| `/checkpoints/:sessionId` | GET | Get checkpoint |

**Redis Keys:**
- `agent:jobs` - Job queue (LIST)
- `agent:events` - PubSub channel
- `agent:sessions:*` - Session metadata (HASH)
- `agent:checkpoint:*` - Checkpoints (HASH)
- `agent:events:stream` - Event stream (STREAM)

---

### Agent Worker (`lib/agent/services/agent-worker/src/index.ts`)

**Job Processing Loop:**

```typescript
while (true) {
  // 1. Poll for jobs
  const [queue, jobJson] = await redis.brpop(JOB_QUEUE, 0);
  const job = JSON.parse(jobJson);

  // 2. Initialize Git-Backed VFS
  const gitVFS = virtualFilesystem.getGitBackedVFS(job.userId, {
    autoCommit: true,
    sessionId: job.sessionId,
  });

  // 3. Run OpenCode engine
  await opencodeEngine.run({
    sessionId: job.sessionId,
    prompt: job.prompt,
    onEvent: async (event) => {
      if (event.type === 'tool') {
        // Execute tool
        const result = await executeTool(event.data.tool, event.data.args);
        
        // Track file changes
        if (event.data.tool.includes('write')) {
          await gitVFS.writeFile(job.userId, event.data.args.path, event.data.args.content);
        }
      }
      
      // Publish event to gateway
      await publishEvent({
        type: event.type,
        sessionId: job.sessionId,
        data: event.data,
      });
    },
  });

  // 4. Commit all changes
  await gitVFS.commitChanges(job.userId, 'Agent completed');
}
```

**Environment Variables:**
```bash
REDIS_URL=redis://redis:6379
MCP_SERVER_URL=http://mcp:8888
NULLCLAW_URL=http://nullclaw:3000
OPENCODE_MODEL=opencode/minimax-m2.5-free
OPENCODE_MAX_STEPS=15
WORKER_CONCURRENCY=4
GIT_VFS_AUTO_COMMIT=true
```

---

### Git-Backed VFS (`lib/virtual-filesystem/git-backed-vfs.ts`)

**Integration Points:**

```typescript
// In worker
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: true,
  sessionId,
  enableShadowCommits: true,
});

// Every write automatically creates shadow commit
await gitVFS.writeFile(userId, 'src/index.ts', 'export const x = 1');

// Rollback on error
try {
  await agent.execute(task);
} catch (error) {
  await gitVFS.rollback(userId, previousVersion);
}

// Get diff
const diff = await gitVFS.getDiff(userId, fromVersion);
```

---

## Event Types

### Gateway → Worker (via Redis Queue)

| Event | Data |
|-------|------|
| `job:ready` | `{ jobId, sessionId, userId, prompt }` |
| `job:cancel` | `{ jobId }` |

### Worker → Gateway (via Redis PubSub)

| Event | Data | Client SSE Event |
|-------|------|-----------------|
| `init` | `{ agent, sessionId }` | `init` |
| `token` | `{ content, timestamp }` | `token` |
| `tool:start` | `{ tool, args }` | `tool_invocation` (call) |
| `tool:result` | `{ tool, args, result }` | `tool_invocation` (result) |
| `git:commit` | `{ filesChanged, paths }` | `git:commit` |
| `git:rollback` | `{ version }` | `git:rollback` |
| `done` | `{ response, filesChanged }` | `done` |
| `error` | `{ error }` | `error` |

---

## Usage Examples

### 1. Create Agent Job

```typescript
// NextJS API route
const response = await fetch('http://gateway:3002/jobs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user_123',
    conversationId: 'conv_456',
    prompt: 'Create a Next.js authentication system',
    context: 'Use NextAuth with GitHub provider',
  }),
});

const { jobId, sessionId } = await response.json();
```

### 2. Stream Events

```typescript
// Client-side SSE
const eventSource = new EventSource(
  `http://gateway:3002/stream/${sessionId}`
);

eventSource.addEventListener('init', (e) => {
  console.log('Agent initialized:', JSON.parse(e.data));
});

eventSource.addEventListener('token', (e) => {
  const { content } = JSON.parse(e.data);
  appendToChat(content);
});

eventSource.addEventListener('tool_invocation', (e) => {
  const { toolName, args, state } = JSON.parse(e.data);
  showToolProgress(toolName, args, state);
});

eventSource.addEventListener('git:commit', (e) => {
  const { filesChanged, paths } = JSON.parse(e.data);
  showGitCommit(paths);
});

eventSource.addEventListener('done', (e) => {
  const { response, filesChanged } = JSON.parse(e.data);
  showFinalResponse(response);
});
```

### 3. Rollback to Previous Version

```typescript
// Get version history
const versionsResponse = await fetch(
  `http://gateway:3002/git/${sessionId}/versions?limit=10`
);
const { versions } = await versionsResponse.json();

// Rollback to version 2
await fetch(`http://gateway:3002/git/${sessionId}/rollback`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ version: 2 }),
});

// Listen for rollback event
eventSource.addEventListener('git:rollback', (e) => {
  const { version, success } = JSON.parse(e.data);
  console.log(`Rolled back to version ${version}`);
});
```

### 4. Get Diff Between Versions

```typescript
const diffResponse = await fetch(
  `http://gateway:3002/git/${sessionId}/diff?fromVersion=1&toVersion=3`
);
const diff = await diffResponse.json();
console.log(diff);
```

---

## Docker Compose Wiring

```yaml
services:
  gateway:
    build:
      context: .
      dockerfile: Dockerfile.agent
      args:
        SERVICE_NAME: gateway
    environment:
      - REDIS_URL=redis://redis:6379
      - PORT=3002
    depends_on:
      - redis

  worker:
    build:
      context: .
      dockerfile: Dockerfile.agent
      args:
        SERVICE_NAME: worker
    environment:
      - REDIS_URL=redis://redis:6379
      - MCP_SERVER_URL=http://mcp:8888
      - GIT_VFS_AUTO_COMMIT=true
    depends_on:
      - redis
      - mcp

  mcp:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    environment:
      - MCP_PORT=8888
      - WORKSPACE_ROOT=/workspace

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
```

---

## Checkpoint & Recovery

### Save Checkpoint

```typescript
// In worker, during execution
await checkpointManager.save({
  jobId,
  sessionId,
  step: currentStep,
  prompt,
  messages: conversationHistory,
  toolCalls: executedTools,
});
```

### Resume from Checkpoint

```typescript
// On worker restart
const checkpoint = await checkpointManager.resume(sessionId);
if (checkpoint) {
  // Resume from last known state
  await opencodeEngine.run({
    sessionId,
    prompt: checkpoint.prompt,
    context: checkpoint.context,
    messages: checkpoint.messages,
  });
}
```

---

## Error Handling

### Worker Crash Recovery

```typescript
// Worker startup
const incompleteJobs = await redis.lrange(JOB_QUEUE, 0, -1);
for (const jobJson of incompleteJobs) {
  const job = JSON.parse(jobJson);
  const checkpoint = await checkpointManager.get(job.sessionId);
  
  if (checkpoint) {
    // Resume from checkpoint
    await resumeJob(checkpoint);
  } else {
    // Re-queue job
    await redis.lpush(JOB_QUEUE, jobJson);
  }
}
```

### Git Rollback on Error

```typescript
try {
  await agent.execute(task);
} catch (error) {
  // Automatic rollback
  const state = await gitVFS.getState(userId);
  await gitVFS.rollback(userId, state.version - 1);
  
  // Notify client
  await publishEvent({
    type: 'error',
    sessionId,
    data: { 
      error: error.message,
      rolledBack: true,
      version: state.version - 1,
    },
  });
}
```

---

## Scaling

### Horizontal Worker Scaling

```yaml
worker:
  deploy:
    replicas: 5  # Run 5 workers
  environment:
    - WORKER_CONCURRENCY=4  # Each handles 4 jobs
```

### Redis Cluster

```bash
# For high availability
redis-cluster:
  image: redis:7-alpine
  command: redis-server --cluster-enabled yes
  replicas: 6  # 3 masters + 3 slaves
```

---

## Monitoring

### Health Checks

```bash
# Gateway health
curl http://gateway:3002/health

# Worker health (via Redis)
redis-cli GET agent:worker:heartbeat

# Git-VFS status
curl http://gateway:3002/git/session-123/versions
```

### Metrics to Track

| Metric | Source | Purpose |
|--------|--------|---------|
| `jobs.processed` | Worker | Throughput |
| `jobs.failed` | Worker | Error rate |
| `git.commits` | Git-VFS | Version tracking |
| `git.rollbacks` | Git-VFS | Error recovery |
| `events.published` | Gateway | Event volume |
| `checkpoint.saved` | Worker | Recovery points |

---

## Security Considerations

### 1. Workspace Isolation

```typescript
// Each user gets isolated workspace
const workspaceDir = `/workspace/users/${userId}/sessions/${conversationId}`;

// Prevent path traversal
const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
```

### 2. Git Commit Signing

```typescript
// Shadow commits include user attribution
await shadowCommitManager.createCommit({
  sessionId,
  message,
  author: userId,  // Track who made changes
  source: 'agent-loop',
});
```

### 3. Rate Limiting

```typescript
// In gateway
const RATE_LIMIT = 100; // requests per minute
const userRequests = await redis.incr(`ratelimit:${userId}`);
if (userRequests > RATE_LIMIT) {
  return reply.status(429).send({ error: 'Rate limit exceeded' });
}
```

---

## Troubleshooting

### Worker Not Processing Jobs

```bash
# Check Redis queue
redis-cli LLEN agent:jobs

# Check worker logs
docker-compose logs worker

# Verify Redis connection
redis-cli PING
```

### Git-VFS Not Committing

```bash
# Check if auto-commit enabled
echo $GIT_VFS_AUTO_COMMIT

# Check VFS initialization
docker-compose logs worker | grep "Git-backed VFS"

# Manually trigger commit
curl -X POST http://gateway:3002/git/session-123/commit
```

### Events Not Streaming

```bash
# Check PubSub subscription
redis-cli PSUBSCRIBE agent:events:*

# Check gateway logs
docker-compose logs gateway | grep "Stream"

# Verify SSE connection
curl -N http://gateway:3002/stream/session-123
```

---

## Performance Optimization

### 1. Batch Git Commits

```typescript
// Instead of commit per file
for (const file of files) {
  await gitVFS.writeFile(userId, file.path, file.content);
  await gitVFS.commitChanges(userId);  // ❌ Too many commits
}

// Batch all files, single commit
for (const file of files) {
  await gitVFS.writeFile(userId, file.path, file.content);
}
await gitVFS.commitChanges(userId, 'Batch update');  // ✅ Single commit
```

### 2. Redis Pipeline

```typescript
// Instead of individual commands
await redis.publish(channel, event1);
await redis.publish(channel, event2);
await redis.publish(channel, event3);

// Use pipeline
const pipeline = redis.pipeline();
pipeline.publish(channel, event1);
pipeline.publish(channel, event2);
pipeline.publish(channel, event3);
await pipeline.exec();
```

### 3. Connection Pooling

```typescript
// Create Redis pool
const pool = new Redis.Pool({
  max: 10,
  min: 5,
  acquireTimeoutMillis: 30000,
});

// Use pooled connection
const client = await pool.acquire();
await client.publish(channel, event);
pool.release(client);
```

---

## Complete Example: End-to-End Flow

```typescript
// 1. NextJS API route creates job
// app/api/chat/route.ts
export async function POST(request: Request) {
  const { userId, conversationId, messages } = await request.json();
  
  const response = await fetch('http://gateway:3002/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      conversationId,
      prompt: messages[messages.length - 1].content,
      context: messages.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n'),
    }),
  });
  
  const { jobId, sessionId } = await response.json();
  
  return Response.json({ jobId, sessionId });
}

// 2. Client streams events
// components/chat-interface.tsx
function ChatInterface({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    const eventSource = new EventSource(`/api/stream/${sessionId}`);
    
    eventSource.addEventListener('token', (e) => {
      const { content } = JSON.parse(e.data);
      setMessages(prev => [...prev, { role: 'assistant', content }]);
    });
    
    eventSource.addEventListener('git:commit', (e) => {
      const { paths } = JSON.parse(e.data);
      setFileChanges(prev => [...prev, ...paths]);
    });
    
    return () => eventSource.close();
  }, [sessionId]);
  
  return <div>...</div>;
}

// 3. Worker processes with git-backed VFS
// lib/agent/services/agent-worker/src/index.ts
const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: true,
  sessionId,
});

await opencodeEngine.run({
  sessionId,
  prompt,
  onEvent: async (event) => {
    if (event.type === 'tool' && event.data.tool.includes('write')) {
      await gitVFS.writeFile(userId, event.data.args.path, event.data.args.content);
    }
    await publishEvent({ type: event.type, sessionId, data: event.data });
  },
});

await gitVFS.commitChanges(userId, 'Agent completed');
```

---

This completes the V2 agent system wiring with Git-Backed VFS, Redis queue, and gateway communication!
