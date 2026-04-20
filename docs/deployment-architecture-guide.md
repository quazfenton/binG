---
id: deployment-architecture-guide
title: Deployment Architecture Guide
aliases:
  - DEPLOYMENT_ARCHITECTURE
  - DEPLOYMENT_ARCHITECTURE.md
  - deployment-architecture-guide
  - deployment-architecture-guide.md
tags:
  - guide
  - architecture
layer: core
summary: "# Deployment Architecture Guide\r\n\r\n## Overview\r\n\r\nThis document explains **which files run where** in the distributed binG architecture, how components communicate across container boundaries, and provides an updated Docker Compose configuration.\r\n\r\n---\r\n\r\n## Architecture Layers\r\n\r\n```\r\n┌───────────"
anchors:
  - Overview
  - Architecture Layers
  - File Execution Map
  - "\U0001F7E2 NEXTJS CONTAINER (Port 3000)"
  - "\U0001F535 GATEWAY CONTAINER (Separate Service)"
  - "\U0001F7E1 WORKER CONTAINER (Separate Service)"
  - "\U0001F7E0 NULLCLAW CONTAINER (Separate Service)"
  - "\U0001F7E3 SANDBOX CONTAINERS (Ephemeral)"
  - Communication Patterns
  - 1. Chat Request Flow
  - 2. Event Streaming Flow
  - 3. Sandbox Creation Flow
  - Updated Docker Compose Configuration
  - Key Changes for Distributed Architecture
  - Environment Variables by Service
  - Next.js App
  - Agent Gateway
  - Agent Worker
  - Nullclaw
  - Scaling Considerations
  - Horizontal Scaling
  - Resource Allocation
  - Security Considerations
  - Container Isolation
  - Docker Socket Security
  - Monitoring & Observability
  - Metrics Collection
  - Tracing
  - Deployment Modes
  - Development Mode
  - Production Mode
  - V2 Agent Mode
  - Multi-Agent Mode
  - Related Documentation
---
# Deployment Architecture Guide

## Overview

This document explains **which files run where** in the distributed binG architecture, how components communicate across container boundaries, and provides an updated Docker Compose configuration.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXTJS CONTAINER                          │
│  Port: 3000 (HTTP), 8080 (WebSocket)                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Frontend (Browser)                                       │  │
│  │  - conversation-interface.tsx                             │  │
│  │  - experimental-workspace-panel.tsx                       │  │
│  │  - code-preview-panel.tsx                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  API Routes (Next.js App Router)                          │  │
│  │  - /api/chat/route.ts          ← Chat orchestration       │  │
│  │  - /api/chat-with-context/     ← Context-aware chat       │  │
│  │  - /api/filesystem/*           ← VFS operations           │  │
│  │  - /api/sandbox/*              ← Sandbox management       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Core Logic (Runs in Next.js Container)                   │  │
│  │  - lib/session/session-manager.ts    ← Session lifecycle  │  │
│  │  - lib/virtual-filesystem/*          ← VFS operations     │  │
│  │  - lib/management/*                  ← Quota, Health      │  │
│  │  - lib/tools/*                       ← Tool definitions   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Internal Calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     GATEWAY/WORKER CONTAINERS                    │
│  (Separate Services - Can Scale Independently)                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Agent Gateway (agent-gateway service)                    │  │
│  │  - lib/agent/services/agent-gateway/                      │  │
│  │  - Session management                                     │  │
│  │  - SSE streaming                                          │  │
│  │  - Job queue management                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Agent Workers (agent-worker service)                     │  │
│  │  - lib/agent/services/agent-worker/                       │  │
│  │  - OpenCode engine loop                                   │  │
│  │  - Tool execution                                         │  │
│  │  - Git-backed VFS                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Nullclaw Service (nullclaw service)                      │  │
│  │  - lib/agent/nullclaw-integration.ts                      │  │
│  │  - Messaging (Discord, Telegram)                          │  │
│  │  - Web browsing                                           │  │
│  │  - Non-coding agency                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Docker API / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SANDBOX CONTAINERS                           │
│  (Ephemeral - Created Per Task/Session)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Microsandbox (microsandbox service)                      │  │
│  │  - Local sandbox provider                                 │  │
│  │  - Docker-in-Docker                                       │  │
│  │  - Port: 5555                                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Cloud Sandboxes (External Providers)                     │  │
│  │  - E2B, Daytona, Blaxel, CodeSandbox                      │  │
│  │  - Created on-demand via API                              │  │
│  │  - Auto-destroyed after idle timeout                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Execution Map

### 🟢 NEXTJS CONTAINER (Port 3000)

**Runs in Next.js process:**

| Category | Files | Purpose |
|----------|-------|---------|
| **UI Components** | `components/*.tsx` | Browser-rendered React components |
| **API Routes** | `app/api/*/route.ts` | HTTP endpoints for chat, filesystem, sandbox |
| **Session Management** | `lib/session/session-manager.ts` | Creates/manages user sessions |
| **Virtual Filesystem** | `lib/virtual-filesystem/*.ts` | VFS operations, context packing |
| **Management** | `lib/management/*.ts` | Quota tracking, health checks |
| **Tool Definitions** | `lib/tools/*.ts` | Tool schemas and handlers |
| **Preview System** | `lib/previews/*.ts` | Framework detection, offloading |
| **Orchestra** | `lib/orchestra/stateful-agent/*.ts` | Plan-Act-Verify agent loop |
| **Agent Loop** | `lib/orchestra/agent-loop.ts` | Main agent execution loop |

**Communication:**
- **Inbound:** Browser HTTP/WebSocket connections
- **Outbound:** Calls to Gateway/Worker services via HTTP/Redis

---

### 🔵 GATEWAY CONTAINER (Separate Service)

**Runs agent-gateway process:**

| Category | Files | Purpose |
|----------|-------|---------|
| **Gateway Service** | `lib/agent/services/agent-gateway/*.ts` | Session orchestration |
| **Job Queue** | `lib/redis/agent-service.ts` | Redis-based job management |
| **SSE Streaming** | `lib/agent/services/agent-gateway/src/index-enhanced.ts` | Real-time event streaming |

**Communication:**
- **Inbound:** HTTP from Next.js, SSE from Workers
- **Outbound:** Redis queue, Worker HTTP calls

---

### 🟡 WORKER CONTAINER (Separate Service)

**Runs agent-worker process:**

| Category | Files | Purpose |
|----------|-------|---------|
| **Worker Loop** | `lib/agent/services/agent-worker/src/index.ts` | Job processing loop |
| **OpenCode Engine** | `lib/agent/services/agent-worker/src/opencode-engine.ts` | Persistent OpenCode runtime |
| **Checkpoint Manager** | `lib/agent/services/agent-worker/src/checkpoint-manager.ts` | Crash recovery |
| **Task Router** | `lib/agent/task-router.ts` | Routes tasks to appropriate executors |
| **V2 Executor** | `lib/agent/v2-executor.ts` | Executes V2 tasks |
| **Enhanced Background Jobs** | `lib/agent/enhanced-background-jobs.ts` | Recurring job execution |
| **Loop Detection** | `lib/agent/loop-detection.ts` | Prevents infinite loops |
| **Multi-Agent** | `lib/agent/multi-agent-collaboration.ts` | Coordinates multiple agents |
| **Mastra Integration** | `lib/agent/mastra-workflow-integration.ts` | Mastra workflow execution |
| **Workflow Templates** | `lib/agent/workflow-templates.ts` | Pre-built workflow templates |

**Communication:**
- **Inbound:** Redis queue (jobs), HTTP from Gateway
- **Outbound:** Tool calls, Sandbox API, Redis pub/sub (events)

---

### 🟠 NULLCLAW CONTAINER (Separate Service)

**Runs Nullclaw process:**

| Category | Files | Purpose |
|----------|-------|---------|
| **Nullclaw Integration** | `lib/agent/nullclaw-integration.ts` | Non-coding agency |
| **Messaging** | Built-in Nullclaw | Discord, Telegram bots |
| **Browsing** | Built-in Nullclaw | Web automation |
| **Task Execution** | Built-in Nullclaw | External API calls |

**Communication:**
- **Inbound:** HTTP from Workers (task execution)
- **Outbound:** External APIs (Discord, Telegram, Web)

---

### 🟣 SANDBOX CONTAINERS (Ephemeral)

**Created per task/session:**

| Type | Files | Purpose |
|------|-------|---------|
| **Microsandbox** | `lib/sandbox/providers/microsandbox-provider.ts` | Local Docker containers |
| **Cloud Providers** | `lib/sandbox/providers/*.ts` | E2B, Daytona, Blaxel, etc. |
| **Spawn Services** | `lib/sandbox/spawn/*.ts` | E2B Amp, Codex services |

**Communication:**
- **Inbound:** Docker API (Microsandbox), HTTP (Cloud)
- **Outbound:** None (isolated execution)

---

## Communication Patterns

### 1. Chat Request Flow

```
User → Next.js (/api/chat)
          ↓
    sessionManager.getOrCreateSession()
          ↓
    agent-gateway.createJob()
          ↓
    Redis Queue (agent:jobs)
          ↓
    agent-worker.pop()
          ↓
    OpenCode Engine Loop
          ↓
    Tool Router
          ↓
    ┌──────────┬──────────┬──────────┐
    │          │          │          │
    ▼          ▼          ▼
  MCP      Nullclaw   Sandbox
Tools      Service   Provider
```

### 2. Event Streaming Flow

```
Worker Execution
       ↓
Redis Pub/Sub (agent:events:{sessionId})
       ↓
Agent Gateway (subscribed)
       ↓
SSE Stream
       ↓
Next.js API Route
       ↓
Browser EventSource
```

### 3. Sandbox Creation Flow

```
Worker needs sandbox
       ↓
Sandbox Orchestrator
       ↓
┌──────────────────┬──────────────────┐
│                  │                  │
▼                  ▼                  ▼
Microsandbox    E2B            Daytona
(Docker API)   (HTTP API)      (HTTP API)
```

---

## Updated Docker Compose Configuration

### Key Changes for Distributed Architecture

```yaml
services:
  # Next.js App (UI + API orchestration)
  app:
    ports: ["3000:3000", "8080:8080"]
    depends_on: [agent-gateway, redis, postgres]
    environment:
      - AGENT_GATEWAY_URL=http://agent-gateway:3002
      - REDIS_URL=redis://redis:6379

  # Agent Gateway (Session management + SSE)
  agent-gateway:
    build:
      context: .
      dockerfile: Dockerfile.gateway
    ports: ["3002:3002"]
    depends_on: [redis, agent-worker]
    environment:
      - REDIS_URL=redis://redis:6379
      - WORKER_URL=http://agent-worker:3003

  # Agent Workers (OpenCode engine + Tool execution)
  agent-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    deploy:
      replicas: 3  # Scale horizontally
    depends_on: [redis, nullclaw, microsandbox]
    environment:
      - REDIS_URL=redis://redis:6379
      - NULLCLAW_URL=http://nullclaw:3000
      - MICROSANDBOX_URL=http://microsandbox:5555

  # Nullclaw (Non-coding agency)
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    ports: ["3001:3000"]
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com

  # Microsandbox (Local sandbox provider)
  microsandbox:
    image: node:20-alpine
    ports: ["5555:5555"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # ⚠️ Security risk!
    command: msb server start --prod --port 5555

  # Redis (Job queue + Pub/Sub)
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis-data:/data

  # PostgreSQL (Persistence)
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

---

## Environment Variables by Service

### Next.js App
```bash
# Gateway Connection
AGENT_GATEWAY_URL=http://agent-gateway:3002

# Redis
REDIS_URL=redis://redis:6379

# Database
DATABASE_URL=postgresql://user:pass@postgres:5432/bing

# Feature Flags
ENABLE_MULTI_AGENT=true
USE_LANGGRAPH=false
```

### Agent Gateway
```bash
# Redis
REDIS_URL=redis://redis:6379

# Worker Connection
WORKER_URL=http://agent-worker:3003

# Session Settings
SESSION_TTL_MINUTES=30
MAX_CONCURRENT_JOBS=100
```

### Agent Worker
```bash
# Redis
REDIS_URL=redis://redis:6379

# Tool Services
NULLCLAW_URL=http://nullclaw:3000
MICROSANDBOX_URL=http://microsandbox:5555

# OpenCode Settings
OPENCODE_MODEL=claude-3-5-sonnet
OPENCODE_MAX_STEPS=15
```

### Nullclaw
```bash
NULLCLAW_TIMEOUT=3600
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com
NULLCLAW_MODE=shared
```

---

## Scaling Considerations

### Horizontal Scaling

| Service | Scale Strategy | Notes |
|---------|---------------|-------|
| **Next.js App** | 2-3 replicas | Statelessness required |
| **Agent Gateway** | 2-5 replicas | Sticky sessions for SSE |
| **Agent Workers** | 3-10 replicas | Most scalable component |
| **Nullclaw** | 1-2 replicas | Stateful, limited scaling |
| **Redis** | Master-Replica | Use Redis Cluster for HA |
| **Postgres** | Master-Replica | Use connection pooling |

### Resource Allocation

| Service | CPU | Memory | Notes |
|---------|-----|--------|-------|
| **Next.js App** | 2-4 cores | 2-4 GB | Depends on concurrent users |
| **Agent Gateway** | 1-2 cores | 1-2 GB | Lightweight, I/O bound |
| **Agent Worker** | 2-4 cores | 4-8 GB | CPU-intensive (LLM) |
| **Nullclaw** | 1-2 cores | 1-2 GB | Network-bound |
| **Redis** | 1-2 cores | 2-4 GB | Memory-bound |
| **Postgres** | 2-4 cores | 4-8 GB | I/O bound |

---

## Security Considerations

### Container Isolation

1. **Next.js App**: No direct sandbox access
2. **Gateway/Workers**: Communicate via Redis only
3. **Sandboxes**: Fully isolated, ephemeral
4. **Nullclaw**: Network-restricted (allowed domains only)

### Docker Socket Security

⚠️ **CRITICAL**: Microsandbox requires Docker socket access

**Mitigations:**
1. Use Docker socket proxy with limited permissions
2. Run in isolated network segment
3. Apply AppArmor/SELinux profiles
4. Use rootless Docker
5. Restrict to development environments

**Production Alternative:**
```yaml
# Use socket proxy instead of direct mount
docker-socket-proxy:
  image: tecnativa/docker-socket-proxy
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  environment:
    - CONTAINERS=1  # Allow container management
    - IMAGES=0      # Block image management
    - NETWORKS=0    # Block network management
```

---

## Monitoring & Observability

### Metrics Collection

```yaml
prometheus:
  image: prom/prometheus:latest
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  scrape_configs:
    - job_name: 'nextjs'
      static_configs: [{ targets: ['app:3000'] }]
    - job_name: 'gateway'
      static_configs: [{ targets: ['agent-gateway:3002'] }]
    - job_name: 'workers'
      static_configs: [{ targets: ['agent-worker:3003'] }]
```

### Tracing

Use OpenTelemetry for distributed tracing:
```
User Request → Next.js → Gateway → Worker → Tools → Sandbox
     ↓            ↓         ↓        ↓       ↓        ↓
  Trace ID   Span 1     Span 2   Span 3  Span 4  Span 5
```

---

## Deployment Modes

### Development Mode
```bash
# Single machine, all services
docker-compose -f docker-compose.dev.yml up
```

### Production Mode
```bash
# Scaled services, external dependencies
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

### V2 Agent Mode
```bash
# OpenCode V2 containerized execution
docker-compose -f docker-compose.v2.yml up
```

### Multi-Agent Mode
```bash
# CrewAI, Mastra, LangGraph support
docker-compose -f docker-compose.modes.yml up
```

---

## Related Documentation

- [architectureUpdate.md](./architectureUpdate.md) - Full architecture analysis
- [ENHANCED_AGENT_INTEGRATION.md](./ENHANCED_AGENT_INTEGRATION.md) - Agent integration guide
- [COMPLETE_ORCHESTRATION_GUIDE.md](./COMPLETE_ORCHESTRATION_GUIDE.md) - Orchestration reference
- [CODE_REVIEW_VIOLATIONS_FIXED.md](./CODE_REVIEW_VIOLATIONS_FIXED.md) - Security fixes
