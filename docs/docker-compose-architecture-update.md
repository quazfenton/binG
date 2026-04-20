---
id: docker-compose-architecture-update
title: Docker Compose Architecture Update
aliases:
  - DOCKER_COMPOSE_UPDATE
  - DOCKER_COMPOSE_UPDATE.md
  - docker-compose-architecture-update
  - docker-compose-architecture-update.md
tags:
  - architecture
layer: core
summary: "# Docker Compose Architecture Update\r\n\r\n## Summary\r\n\r\nUpdated Docker Compose configuration to properly separate concerns between Next.js, Agent Gateway, Agent Workers, and Nullclaw services according to the architecture documented in `architectureUpdate.md`.\r\n\r\n---\r\n\r\n## Key Changes\r\n\r\n### 1. ✅ Adde"
anchors:
  - Summary
  - Key Changes
  - 1. ✅ Added Agent Gateway Service
  - 2. ✅ Added Agent Workers Service
  - 3. ✅ Updated Next.js App Service
  - 4. ✅ Nullclaw Service Configuration
  - 5. ✅ Microsandbox Service
  - Communication Flow
  - Request Flow
  - Event Streaming Flow
  - Environment Variables
  - Required for All Services
  - Next.js App
  - Agent Gateway
  - Agent Workers
  - Scaling Configuration
  - Horizontal Scaling
  - Resource Allocation
  - Health Checks
  - Deployment Commands
  - Development
  - Production
  - Scale Workers
  - Security Considerations
  - Docker Socket Access
  - Network Isolation
  - Monitoring
  - Prometheus Targets
  - Metrics Exposed
  - Files Requiring Updates
  - Dockerfile.gateway (NEW)
  - Dockerfile.worker (NEW)
  - Related Documentation
  - Next Steps
  - Migration Guide
  - From Old Architecture
  - Breaking Changes
  - Configuration Changes
  - Troubleshooting
  - Gateway Not Connecting to Workers
  - Workers Not Processing Jobs
  - High Latency
  - Conclusion
---
# Docker Compose Architecture Update

## Summary

Updated Docker Compose configuration to properly separate concerns between Next.js, Agent Gateway, Agent Workers, and Nullclaw services according to the architecture documented in `architectureUpdate.md`.

---

## Key Changes

### 1. ✅ Added Agent Gateway Service

**New Service:** `agent-gateway` (Port 3002)

**Purpose:**
- Session orchestration
- SSE event streaming
- Job queue management
- Gateway between Next.js and Workers

**Files Running in Gateway Container:**
```
lib/agent/services/agent-gateway/src/index-enhanced.ts
lib/redis/agent-service.ts
```

**Why Separate:**
- Horizontal scaling independent of Next.js
- Dedicated SSE streaming without blocking app server
- Centralized session management

---

### 2. ✅ Added Agent Workers Service

**New Service:** `agent-worker` (Port 3003)

**Purpose:**
- OpenCode engine loop execution
- Tool execution
- Background jobs
- Multi-agent coordination

**Files Running in Worker Container:**
```
lib/agent/services/agent-worker/src/index.ts
lib/agent/services/agent-worker/src/opencode-engine.ts
lib/agent/v2-executor.ts
lib/agent/task-router.ts
lib/agent/enhanced-background-jobs.ts
lib/agent/loop-detection.ts
lib/agent/multi-agent-collaboration.ts
lib/agent/mastra-workflow-integration.ts
lib/agent/workflow-templates.ts
```

**Why Separate:**
- CPU-intensive operations isolated from web server
- Horizontal scaling (default 3 replicas)
- Independent resource allocation
- Failure isolation

---

### 3. ✅ Updated Next.js App Service

**Changes:**
- Removed direct agent loop execution
- Now calls Agent Gateway for job creation
- Lightweight orchestration only

**Files Running in Next.js Container:**
```
app/api/chat/route.ts              ← Calls gateway, doesn't execute agents
app/api/chat-with-context/route.ts ← Calls gateway
app/api/filesystem/*               ← VFS operations
components/*.tsx                    ← Browser UI
lib/session/session-manager.ts     ← Session lifecycle
lib/virtual-filesystem/*.ts        ← VFS operations
lib/orchestra/stateful-agent/*.ts  ← Plan-Act-Verify (optional)
```

**Why Changed:**
- Next.js no longer blocks on agent execution
- Can scale web tier independently
- Cleaner separation of concerns

---

### 4. ✅ Nullclaw Service Configuration

**Existing Service:** `nullclaw` (Port 3000 internal)

**Purpose:**
- Non-coding agency (messaging, browsing)
- External API integrations

**Files:**
```
lib/agent/nullclaw-integration.ts  ← Calls Nullclaw service
```

**Communication:**
- Workers → Nullclaw (HTTP)
- Nullclaw → External APIs (Discord, Telegram, Web)

---

### 5. ✅ Microsandbox Service

**Existing Service:** `microsandbox` (Port 5555)

**Purpose:**
- Local sandbox provider
- Docker-in-Docker for code execution

**Communication:**
- Workers → Microsandbox (HTTP + Docker API)
- Sandboxes are ephemeral, created per task

---

## Communication Flow

### Request Flow

```
User Browser
     ↓ (HTTP)
Next.js App (:3000)
     ↓ (HTTP)
Agent Gateway (:3002)
     ↓ (Redis Queue)
Agent Workers (:3003)
     ↓ (HTTP/Docker API)
┌──────────┬──────────┬──────────┐
│          │          │          │
▼          ▼          ▼
Nullclaw  Microsandbox  Cloud
(:3000)   (:5555)      Providers
```

### Event Streaming Flow

```
Agent Worker
     ↓ (Redis Pub/Sub)
Agent Gateway (subscribed)
     ↓ (SSE)
Next.js App
     ↓ (Server-Sent Events)
User Browser
```

---

## Environment Variables

### Required for All Services
```bash
# Database
DATABASE_URL=postgresql://bing:bing_secure_password@postgres:5432/bing

# Redis
REDIS_URL=redis://redis:6379

# JWT Secret
JWT_SECRET=<generate-with-openssl-rand-hex-32>
```

### Next.js App
```bash
AGENT_GATEWAY_URL=http://agent-gateway:3002
REDIS_URL=redis://redis:6379
```

### Agent Gateway
```bash
REDIS_URL=redis://redis:6379
WORKER_URL=http://agent-worker:3003
JWT_SECRET=<same-as-app>
```

### Agent Workers
```bash
REDIS_URL=redis://redis:6379
NULLCLAW_URL=http://nullclaw:3000
MICROSANDBOX_URL=http://microsandbox:5555
MISTRAL_API_KEY=<your-key>
OPENAI_API_KEY=<your-key>
```

---

## Scaling Configuration

### Horizontal Scaling

```yaml
# Agent Workers - Scale based on load
agent-worker:
  deploy:
    replicas: ${WORKER_REPLICAS:-3}  # Default 3, adjust based on demand
```

### Resource Allocation

| Service | CPU | Memory | Replicas |
|---------|-----|--------|----------|
| **Next.js App** | 4 cores | 4 GB | 1-2 |
| **Agent Gateway** | 2 cores | 2 GB | 2-5 |
| **Agent Workers** | 4 cores | 4 GB | 3-10 |
| **Nullclaw** | 1 core | 1 GB | 1-2 |
| **Microsandbox** | 2 cores | 2 GB | 1 |

---

## Health Checks

All services now have health checks:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:<PORT>/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30-40s
```

---

## Deployment Commands

### Development
```bash
docker-compose -f docker-compose.dev.yml up
```

### Production
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

### Scale Workers
```bash
docker-compose up -d --scale agent-worker=5
```

---

## Security Considerations

### Docker Socket Access

⚠️ **CRITICAL**: Microsandbox requires Docker socket access

**Current Configuration:**
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

**Production Mitigation:**
1. Use Docker socket proxy
2. Apply AppArmor/SELinux profiles
3. Isolate network segment
4. Restrict to specific operations

### Network Isolation

All services run on `bing-network`:
```yaml
networks:
  bing-network:
    name: bing-network
```

External access only through:
- Next.js App (3000, 8080)
- Agent Gateway (3002)
- Agent Workers (3003)

Internal services (Nullclaw, Microsandbox, Redis, Postgres) are NOT exposed externally.

---

## Monitoring

### Prometheus Targets

```yaml
scrape_configs:
  - job_name: 'nextjs'
    static_configs: [{ targets: ['app:3000'] }]
  - job_name: 'gateway'
    static_configs: [{ targets: ['agent-gateway:3002'] }]
  - job_name: 'workers'
    static_configs: [{ targets: ['agent-worker:3003'] }]
```

### Metrics Exposed

- Request latency
- Job queue depth
- Worker utilization
- Sandbox creation time
- Tool execution time
- Error rates

---

## Files Requiring Updates

### Dockerfile.gateway (NEW)
```dockerfile
FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY lib/agent/services/agent-gateway ./lib/agent/services/agent-gateway
COPY lib/redis ./lib/redis
CMD ["node", "lib/agent/services/agent-gateway/src/index-enhanced.ts"]
```

### Dockerfile.worker (NEW)
```dockerfile
FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY lib/agent/services/agent-worker ./lib/agent/services/agent-worker
COPY lib/agent/*.ts ./lib/agent/
CMD ["node", "lib/agent/services/agent-worker/src/index.ts"]
```

---

## Related Documentation

- [DEPLOYMENT_ARCHITECTURE.md](./DEPLOYMENT_ARCHITECTURE.md) - Full deployment guide
- [architectureUpdate.md](./architectureUpdate.md) - Architecture analysis
- [ENHANCED_AGENT_INTEGRATION.md](./ENHANCED_AGENT_INTEGRATION.md) - Agent integration
- [COMPLETE_ORCHESTRATION_GUIDE.md](./COMPLETE_ORCHESTRATION_GUIDE.md) - Orchestration reference

---

## Next Steps

1. **Create Dockerfile.gateway** - Build image for gateway service
2. **Create Dockerfile.worker** - Build image for worker service
3. **Update CI/CD** - Add build steps for new services
4. **Configure Redis** - Set up Redis cluster for production
5. **Set up Monitoring** - Configure Prometheus/Grafana dashboards
6. **Load Testing** - Test scaling under load
7. **Security Audit** - Review Docker socket access

---

## Migration Guide

### From Old Architecture

**Before:**
```
Next.js App does everything:
- UI rendering
- API routes
- Agent loops
- Tool execution
- Sandbox management
```

**After:**
```
Next.js App:
- UI rendering ✓
- API orchestration ✓
- Session management (via Gateway) ✓

Agent Gateway:
- Session orchestration
- Event streaming
- Job queue management

Agent Workers:
- Agent loops
- Tool execution
- Background jobs
```

### Breaking Changes

None - backward compatible with existing API routes.

### Configuration Changes

Update `.env`:
```bash
# Add these
AGENT_GATEWAY_URL=http://agent-gateway:3002
REDIS_URL=redis://redis:6379
WORKER_REPLICAS=3
```

---

## Troubleshooting

### Gateway Not Connecting to Workers

Check network connectivity:
```bash
docker network inspect bing-network
docker exec -it bing-agent-gateway ping agent-worker
```

### Workers Not Processing Jobs

Check Redis connection:
```bash
docker exec -it bing-agent-worker redis-cli -h redis ping
```

### High Latency

Scale workers:
```bash
docker-compose up -d --scale agent-worker=5
```

---

## Conclusion

The updated Docker Compose configuration properly separates concerns according to modern agent architecture best practices:

- ✅ Next.js handles UI and orchestration only
- ✅ Gateway manages sessions and streaming
- ✅ Workers execute agent loops
- ✅ Nullclaw handles non-coding agency
- ✅ Sandboxes provide isolated execution
- ✅ All services can scale independently
- ✅ Proper health checks and monitoring
- ✅ Production-ready security considerations
