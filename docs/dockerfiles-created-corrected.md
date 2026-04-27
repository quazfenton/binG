---
id: dockerfiles-created-corrected
title: Dockerfiles Created - Corrected
aliases:
  - DOCKERFILES_RECREATED
  - DOCKERFILES_RECREATED.md
  - dockerfiles-created-corrected
  - dockerfiles-created-corrected.md
tags: []
layer: core
summary: "# Dockerfiles Created - Corrected\r\n\r\n## Overview\r\n\r\nCreated 4 new Dockerfiles based on the existing `Dockerfile.agent` pattern and official OpenSandbox documentation.\r\n\r\n---\r\n\r\n## Files Created\r\n\r\n### 1. ✅ Dockerfile.gateway\r\n\r\n**Service:** Agent Gateway  \r\n**Port:** 3002  \r\n**Purpose:** Session orc"
anchors:
  - Overview
  - Files Created
  - 1. ✅ Dockerfile.gateway
  - 2. ✅ Dockerfile.worker
  - 3. ✅ Dockerfile.nullclaw
  - 4. ✅ Dockerfile.opensandbox
  - Build Commands
  - Build All Images
  - Build Individual Images
  - Usage in docker-compose.yml
  - Key Differences from Previous Attempt
  - ❌ Previous (Incorrect)
  - ✅ Current (Correct)
  - Production Deployment Notes
  - For Nullclaw
  - For OpenSandbox
  - Testing
  - Test Gateway Build
  - Test Worker Build
  - Related Documentation
  - Summary
---
# Dockerfiles Created - Corrected

## Overview

Created 4 new Dockerfiles based on the existing `Dockerfile.agent` pattern and official OpenSandbox documentation.

---

## Files Created

### 1. ✅ Dockerfile.gateway

**Service:** Agent Gateway  
**Port:** 3002  
**Purpose:** Session orchestration, SSE streaming, job queue management  
**Base:** `Dockerfile.agent` pattern

**Key Features:**
- Uses existing pnpm dependency management
- Copies only necessary libraries (agent, redis, session, utils, types, management)
- Gateway service entry point: `services/agent-gateway/index.js`
- Health check on port 3002

**Files Included:**
```
lib/agent/
lib/redis/
lib/session/
lib/utils/
lib/types/
lib/management/
services/agent-gateway/
```

---

### 2. ✅ Dockerfile.worker

**Service:** Agent Workers  
**Port:** 3003  
**Purpose:** OpenCode engine loops, tool execution, background jobs  
**Base:** `Dockerfile.agent` pattern

**Key Features:**
- Includes git for repository operations
- Copies all agent-related libraries
- Worker service entry point: `services/agent-worker/index.js`
- Health check on port 3003
- Default WORKER_CONCURRENCY=4

**Files Included:**
```
lib/agent/
lib/orchestra/
lib/session/
lib/redis/
lib/utils/
lib/types/
lib/management/
lib/tools/
lib/sandbox/
lib/virtual-filesystem/
lib/previews/
lib/opencode/
services/agent-worker/
```

---

### 3. ✅ Dockerfile.nullclaw

**Service:** Nullclaw  
**Port:** 3000  
**Purpose:** Non-coding agency (messaging, browsing, automation)

**Key Features:**
- Reference implementation for Nullclaw integration
- **IMPORTANT:** For production, use official image: `ghcr.io/nullclaw/nullclaw:latest`
- Includes alternative configuration in comments

**Files Included:**
```
lib/agent/nullclaw-integration.ts
lib/utils/
lib/types/
services/nullclaw/ (if exists)
```

**Production Recommendation:**
```yaml
nullclaw:
  image: ghcr.io/nullclaw/nullclaw:latest
  ports:
    - "3000:3000"
  environment:
    - NULLCLAW_TIMEOUT=3600
    - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com
```

---

### 4. ✅ Dockerfile.opensandbox

**Service:** OpenSandbox  
**Port:** 3004  
**Purpose:** Isolated code execution environments

**Key Features:**
- Based on official OpenSandbox documentation (`docs/sdk/opensandbox/`)
- Includes Docker for container management
- **IMPORTANT:** For production, use official `opensandbox-server` package
- Includes alternative configuration in comments

**Files Included:**
```
lib/sandbox/providers/opensandbox-provider.ts
lib/sandbox/spawn/
lib/utils/
lib/types/
services/opensandbox/
```

**Production Recommendation:**
```yaml
opensandbox-server:
  image: opensandbox/server:latest
  ports:
    - "8080:8080"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - opensandbox-config:/root/.opensandbox
  environment:
    - OPEN_SANDBOX_API_KEY=your-api-key
    - OPEN_SANDBOX_NETWORK_MODE=bridge
```

---

## Build Commands

### Build All Images

```bash
docker-compose build
```

### Build Individual Images

```bash
# Gateway
docker build -f Dockerfile.gateway -t bing-agent-gateway .

# Worker
docker build -f Dockerfile.worker -t bing-agent-worker .

# Nullclaw (reference only - use official image in production)
docker build -f Dockerfile.nullclaw -t bing-nullclaw .

# OpenSandbox (reference only - use official server in production)
docker build -f Dockerfile.opensandbox -t bing-opensandbox .
```

---

## Usage in docker-compose.yml

```yaml
services:
  # Agent Gateway
  agent-gateway:
    build:
      context: .
      dockerfile: Dockerfile.gateway
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - PORT=3002
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    networks:
      - bing-network

  # Agent Workers
  agent-worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    ports:
      - "3003:3003"
    environment:
      - NODE_ENV=production
      - PORT=3003
      - WORKER_CONCURRENCY=4
    deploy:
      replicas: 3
    depends_on:
      - redis
      - opensandbox-server
      - nullclaw
    networks:
      - bing-network

  # Nullclaw (use official image)
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    ports:
      - "3000:3000"
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
    networks:
      - bing-network

  # OpenSandbox Server (use official image)
  opensandbox-server:
    image: opensandbox/server:latest
    ports:
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - opensandbox-config:/root/.opensandbox
    environment:
      - OPEN_SANDBOX_API_KEY=${OPEN_SANDBOX_API_KEY:-change-me}
      - OPEN_SANDBOX_NETWORK_MODE=bridge
    networks:
      - bing-network
```

---

## Key Differences from Previous Attempt

### ❌ Previous (Incorrect)
- Multi-stage builds with complex TypeScript compilation
- Tried to copy individual files selectively
- Didn't follow existing project patterns
- Ignored official OpenSandbox server package

### ✅ Current (Correct)
- Follows existing `Dockerfile.agent` pattern
- Uses pnpm for dependency management (consistent with project)
- Copies entire library directories
- References official OpenSandbox and Nullclaw images for production
- Includes clear documentation about production alternatives

---

## Production Deployment Notes

### For Nullclaw

**Option 1: Official Image (Recommended)**
```yaml
nullclaw:
  image: ghcr.io/nullclaw/nullclaw:latest
```

**Option 2: External Service**
```bash
NULLCLAW_URL=https://your-nullclaw-instance.com
NULLCLAW_API_KEY=your-api-key
NULLCLAW_MODE=url
```

### For OpenSandbox

**Option 1: Official Server Package (Recommended)**
```bash
uv pip install opensandbox-server
opensandbox-server init-config ~/.sandbox.toml
opensandbox-server --config ~/.sandbox.toml
```

**Option 2: Official Docker Image**
```yaml
opensandbox-server:
  image: opensandbox/server:latest
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

**Option 3: Custom Integration (Development)**
```yaml
opensandbox:
  build:
    context: .
    dockerfile: Dockerfile.opensandbox
```

---

## Testing

### Test Gateway Build
```bash
docker build -f Dockerfile.gateway -t test-gateway .
docker run --rm -p 3002:3002 test-gateway
curl http://localhost:3002/health
```

### Test Worker Build
```bash
docker build -f Dockerfile.worker -t test-worker .
docker run --rm -p 3003:3003 test-worker
curl http://localhost:3003/health
```

---

## Related Documentation

- [CORRECTED_DEPLOYMENT.md](./CORRECTED_DEPLOYMENT.md) - Corrected deployment approach
- [docs/sdk/opensandbox/opensandbox-architecture.md](./docs/sdk/opensandbox/opensandbox-architecture.md) - Official OpenSandbox docs
- [docs/sdk/opensandbox/opensandbox-server.md](./docs/sdk/opensandbox/opensandbox-server.md) - OpenSandbox server guide
- [Dockerfile.agent](./Dockerfile.agent) - Base pattern used
- [Dockerfile.sandbox](./Dockerfile.sandbox) - Existing sandbox implementation

---

## Summary

✅ **4 Dockerfiles created** following existing project patterns  
✅ **Production alternatives documented** for Nullclaw and OpenSandbox  
✅ **Consistent with existing** `Dockerfile.agent` approach  
✅ **Uses pnpm** for dependency management (project standard)  
✅ **Clear documentation** on when to use official images vs custom builds  

The Dockerfiles are now ready for testing and can be used for development. For production, prefer the official Nullclaw and OpenSandbox images/packages as documented.
