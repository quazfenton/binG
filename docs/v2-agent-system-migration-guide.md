---
id: v2-agent-system-migration-guide
title: V2 Agent System Migration Guide
aliases:
  - MIGRATION_GUIDE_V2
  - MIGRATION_GUIDE_V2.md
  - v2-agent-system-migration-guide
  - v2-agent-system-migration-guide.md
tags:
  - agent
  - spawn
  - v2
  - guide
layer: core
summary: "# V2 Agent System Migration Guide\r\n\r\n## Overview\r\n\r\nThis guide covers migrating from the existing V1 agent system to the new V2 architecture with:\r\n- Agent Gateway + Worker separation\r\n- Redis queue for job management\r\n- Git-Backed VFS for automatic commits and rollbacks\r\n- SSE streaming for real-ti"
anchors:
  - Overview
  - Migration Phases
  - 'Phase 1: Infrastructure Setup (Week 1)'
  - 1.1 Deploy New Services
  - 1.2 Configure Environment
  - 1.3 Database Migration
  - 'Phase 2: Application Integration (Week 2)'
  - 2.1 Update API Routes
  - 2.2 Update Client-Side Streaming
  - 2.3 Enable Git-Backed VFS
  - 'Phase 3: Testing & Validation (Week 3)'
  - 3.1 Run Integration Tests
  - 3.2 Validate Event Streaming
  - 3.3 Test Rollback Functionality
  - 'Phase 4: Production Deployment (Week 4)'
  - 4.1 Scale Workers
  - 4.2 Configure Monitoring
  - 4.3 Set Up Alerts
  - Rollback Plan
  - 1. Disable V2 Gateway
  - 2. Stop V2 Services
  - 3. Restore V1 Configuration
  - Troubleshooting
  - 'Issue: Jobs Not Processing'
  - 'Issue: Git Commits Not Created'
  - 'Issue: SSE Events Not Streaming'
  - 'Issue: Rollback Fails'
  - Performance Benchmarks
  - Before Migration (V1)
  - After Migration (V2)
  - Post-Migration Checklist
  - Support
  - 'Appendix: Environment Variable Mapping'
---
# V2 Agent System Migration Guide

## Overview

This guide covers migrating from the existing V1 agent system to the new V2 architecture with:
- Agent Gateway + Worker separation
- Redis queue for job management
- Git-Backed VFS for automatic commits and rollbacks
- SSE streaming for real-time events

---

## Migration Phases

### Phase 1: Infrastructure Setup (Week 1)

#### 1.1 Deploy New Services

```bash
# Start V2 services alongside existing V1
docker-compose -f docker-compose.v2.yml up -d \
  redis \
  gateway \
  worker \
  mcp \
  sandbox

# Verify services are healthy
curl http://localhost:3002/health  # Gateway
curl http://localhost:3003/health  # Worker (via gateway)
```

#### 1.2 Configure Environment

Add to your `.env` file:

```bash
# V2 Agent Services
V2_GATEWAY_ENABLED=true
V2_GATEWAY_URL=http://gateway:3002
V2_WORKER_ENABLED=true
WORKER_CONCURRENCY=4
WORKER_REPLICAS=3

# Git-Backed VFS
GIT_VFS_AUTO_COMMIT=true
GIT_VFS_ENABLE_SHADOW_COMMITS=true
ROLLBACK_ON_ERROR=true

# Redis Configuration
REDIS_URL=redis://redis:6379
REDIS_STREAM_KEY=agent:events
```

#### 1.3 Database Migration

The V2 system uses Redis for job queue and checkpoints. No database schema changes required.

```bash
# Verify Redis is accessible
docker-compose -f docker-compose.v2.yml exec redis redis-cli ping
# Should return: PONG
```

---

### Phase 2: Application Integration (Week 2)

#### 2.1 Update API Routes

**Before (V1 - Direct OpenCode):**
```typescript
// app/api/chat/route.ts (OLD)
import { executeV2Task } from '@bing/shared/agent/v2-executor';

const result = await executeV2Task({
  userId,
  conversationId,
  task: prompt,
});
```

**After (V2 - Via Gateway):**
```typescript
// app/api/chat/route.ts (NEW)
const response = await fetch(`${process.env.V2_GATEWAY_URL}/jobs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId,
    conversationId,
    prompt,
    context: messages.slice(0, -1).map(m => `${m.role}: ${m.content}`).join('\n'),
  }),
});

const { jobId, sessionId } = await response.json();

// Stream events via SSE
return new Response(streamEvents(sessionId), {
  headers: { 'Content-Type': 'text/event-stream' },
});
```

#### 2.2 Update Client-Side Streaming

**Before (V1 - Direct SSE):**
```typescript
const eventSource = new EventSource('/api/chat/stream');
```

**After (V2 - Gateway SSE):**
```typescript
const response = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ prompt }) });
const { sessionId } = await response.json();

const eventSource = new EventSource(`/api/stream/${sessionId}`);

eventSource.addEventListener('token', (e) => {
  const { content } = JSON.parse(e.data);
  appendToChat(content);
});

eventSource.addEventListener('git:commit', (e) => {
  const { filesChanged, paths } = JSON.parse(e.data);
  showFileChanges(paths);
});
```

#### 2.3 Enable Git-Backed VFS

```typescript
// In your VFS initialization
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: true,
  sessionId: conversationId,
  enableShadowCommits: true,
});

// All writes are now automatically committed
await gitVFS.writeFile(userId, 'src/index.ts', 'export const app = 1;');
```

---

### Phase 3: Testing & Validation (Week 3)

#### 3.1 Run Integration Tests

```bash
# Run V2 agent tests
pnpm test:v2

# Run git-backed VFS tests
pnpm test __tests__/v2-git-backed-vfs.test.ts

# Run gateway tests
pnpm test __tests__/v2-agent-gateway.test.ts
```

#### 3.2 Validate Event Streaming

```bash
# Create a test job
curl -X POST http://localhost:3002/jobs \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","conversationId":"test","prompt":"Hello"}'

# Subscribe to events (in another terminal)
curl -N http://localhost:3002/stream/session-test-123
```

Expected events:
```
event: connected
event: init
event: token
event: tool:start
event: tool:result
event: git:commit
event: done
```

#### 3.3 Test Rollback Functionality

```bash
# Get version history
curl http://localhost:3002/git/session-123/versions

# Rollback to version 2
curl -X POST http://localhost:3002/git/session-123/rollback \
  -H "Content-Type: application/json" \
  -d '{"version": 2}'

# Verify rollback via SSE
# Should receive: event: git:rollback
```

---

### Phase 4: Production Deployment (Week 4)

#### 4.1 Scale Workers

```yaml
# docker-compose.v2.prod.yml
worker:
  deploy:
    replicas: 5  # Scale based on load
  environment:
    - WORKER_CONCURRENCY=4
```

#### 4.2 Configure Monitoring

```bash
# Add Prometheus scraping
docker-compose -f docker-compose.monitoring.yml up -d prometheus grafana

# Access Grafana at http://localhost:3000
# Default credentials: admin / admin
```

#### 4.3 Set Up Alerts

Configure alerts for:
- Worker queue depth > 100
- Job failure rate > 10%
- Git commit failures
- Redis connection errors

---

## Rollback Plan

If issues occur, revert to V1:

### 1. Disable V2 Gateway

```typescript
// app/api/chat/route.ts
const useV2 = process.env.V2_GATEWAY_ENABLED === 'true';

if (!useV2) {
  // Fall back to V1
  return executeV1Task({ userId, conversationId, task: prompt });
}
```

### 2. Stop V2 Services

```bash
docker-compose -f docker-compose.v2.yml down
```

### 3. Restore V1 Configuration

```bash
# Restore original .env
cp .env.v1-backup .env

# Restart V1 services
docker-compose up -d app
```

---

## Troubleshooting

### Issue: Jobs Not Processing

```bash
# Check queue depth
docker-compose -f docker-compose.v2.yml exec redis redis-cli LLEN agent:jobs

# Check worker logs
docker-compose -f docker-compose.v2.yml logs worker

# Verify Redis connection
docker-compose -f docker-compose.v2.yml exec redis redis-cli ping
```

### Issue: Git Commits Not Created

```bash
# Check if auto-commit enabled
echo $GIT_VFS_AUTO_COMMIT

# Check worker logs for git errors
docker-compose -f docker-compose.v2.yml logs worker | grep "git"

# Manually trigger commit
curl -X POST http://localhost:3002/git/session-123/commit
```

### Issue: SSE Events Not Streaming

```bash
# Check gateway logs
docker-compose -f docker-compose.v2.yml logs gateway | grep "Stream"

# Verify PubSub subscription
docker-compose -f docker-compose.v2.yml exec redis redis-cli PSUBSCRIBE agent:events:*

# Test SSE endpoint directly
curl -N http://localhost:3002/stream/session-test
```

### Issue: Rollback Fails

```bash
# Check available versions
curl http://localhost:3002/git/session-123/versions

# Check checkpoint data
docker-compose -f docker-compose.v2.yml exec redis redis-cli HGETALL agent:checkpoint:session-123

# Verify shadow commit storage
docker-compose -f docker-compose.v2.yml exec postgres psql -U postgres -d binG -c "SELECT * FROM shadow_commits WHERE session_id = 'session-123'"
```

---

## Performance Benchmarks

### Before Migration (V1)

| Metric | Value |
|--------|-------|
| Job Processing | Sequential |
| Sandbox Creation | 30-60s (cold start) |
| File Versioning | Manual |
| Rollback | Not available |
| Event Streaming | Basic |

### After Migration (V2)

| Metric | Value |
|--------|-------|
| Job Processing | Parallel (3 workers × 4 concurrency) |
| Sandbox Creation | <1s (pre-warmed pool) |
| File Versioning | Automatic (git-backed) |
| Rollback | Full version history |
| Event Streaming | Real-time SSE + Redis Streams |

---

## Post-Migration Checklist

- [ ] All V2 services healthy
- [ ] Jobs processing successfully
- [ ] SSE events streaming to clients
- [ ] Git commits created on file writes
- [ ] Rollback functionality tested
- [ ] Monitoring dashboards configured
- [ ] Alerts set up for critical metrics
- [ ] Documentation updated
- [ ] Team trained on new system
- [ ] V1 services decommissioned (optional)

---

## Support

For migration issues:
1. Check logs: `docker-compose -f docker-compose.v2.yml logs -f`
2. Review `V2_AGENT_WIRING_GUIDE.md`
3. Check `V2_REVIEW_AND_FIXES.md` for known issues
4. Contact: #v2-agent-support (internal)

---

## Appendix: Environment Variable Mapping

| V1 Variable | V2 Equivalent | Notes |
|-------------|---------------|-------|
| `OPENCODE_MODEL` | `OPENCODE_MODEL` | Same |
| `OPENCODE_MAX_STEPS` | `OPENCODE_MAX_STEPS` | Same |
| N/A | `V2_GATEWAY_URL` | New |
| N/A | `WORKER_CONCURRENCY` | New |
| N/A | `GIT_VFS_AUTO_COMMIT` | New |
| N/A | `REDIS_URL` | New (required) |
| `MCP_CLI_PORT` | `MCP_SERVER_URL` | Updated format |
