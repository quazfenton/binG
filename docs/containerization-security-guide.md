---
id: containerization-security-guide
title: Containerization Security Guide
aliases:
  - CONTAINERIZATION_SECURITY
  - CONTAINERIZATION_SECURITY.md
  - containerization-security-guide
  - containerization-security-guide.md
tags:
  - guide
layer: core
summary: "# Containerization Security Guide\r\n\r\n## Cache Volumes Security Analysis\r\n\r\n### Current Setup (Development)\r\n\r\n```yaml\r\nvolumes:\r\n  - pnpm_store:/root/.local/share/pnpm/store    # ✅ Safe\r\n  - pip_cache:/root/.cache/pip                   # ✅ Safe\r\n  - npm_global:/root/.npm                        # ✅ S"
anchors:
  - Cache Volumes Security Analysis
  - Current Setup (Development)
  - Risk Assessment
  - Production Recommendations
  - 1. Remove Docker Socket Mount
  - 2. Use Secrets Management
  - 3. Network Isolation
  - 4. Read-Only Filesystem
  - 5. Drop Capabilities
  - Port Sharing Architecture
  - Can Services Share Ports?
  - '❌ No: Direct Port Sharing'
  - '✅ Yes: Reverse Proxy'
  - '✅ Yes: Path-Based Routing'
  - Production Docker Compose
  - Single Entry Point (Recommended)
  - Security Checklist
  - Development ✅
  - Production ✅
  - Performance vs Security Trade-offs
---
# Containerization Security Guide

## Cache Volumes Security Analysis

### Current Setup (Development)

```yaml
volumes:
  - pnpm_store:/root/.local/share/pnpm/store    # ✅ Safe
  - pip_cache:/root/.cache/pip                   # ✅ Safe
  - npm_global:/root/.npm                        # ✅ Safe
  - opencode_data:/root/.opencode               # ⚠️ Review
  - nullclaw_data:/root/.nullclaw               # ⚠️ Review
  - /var/run/docker.sock:/var/run/docker.sock   # 🔴 High Risk
```

### Risk Assessment

| Volume | Risk | Reason | Mitigation |
|--------|------|--------|------------|
| **pnpm_store** | ✅ Low | Read-only packages | None needed |
| **pip_cache** | ✅ Low | Read-only wheels | None needed |
| **npm_global** | ✅ Low | Read-only packages | None needed |
| **opencode_data** | ⚠️ Medium | May contain API keys | Encrypt secrets |
| **nullclaw_data** | ⚠️ Medium | May contain credentials | Encrypt secrets |
| **docker.sock** | 🔴 High | Full Docker control | Remove in production |

---

## Production Recommendations

### 1. Remove Docker Socket Mount

**Development (Required):**
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock  # Allow app to manage Nullclaw
```

**Production (Remove):**
```yaml
# Don't mount docker socket
# Use Kubernetes or Docker Swarm for container orchestration instead
```

### 2. Use Secrets Management

**Development:**
```yaml
environment:
  - NULLCLAW_API_KEY=my-secret-key  # ❌ In plain text
```

**Production:**
```yaml
secrets:
  - nullclaw_api_key

services:
  app:
    secrets:
      - nullclaw_api_key
```

### 3. Network Isolation

**Development:**
```yaml
networks:
  bing-network:
    driver: bridge  # ✅ Isolated
```

**Production:**
```yaml
networks:
  bing-network:
    driver: overlay
    internal: true  # ✅ No direct external access
  
  proxy-network:
    driver: overlay  # Only proxy exposed
```

### 4. Read-Only Filesystem

**Production:**
```yaml
services:
  app:
    read_only: true  # ✅ Immutable container
    tmpfs:
      - /tmp
      - /root/.cache
    volumes:
      - workspace_data:/workspace:rw  # Only workspace is writable
```

### 5. Drop Capabilities

**Production:**
```yaml
services:
  app:
    cap_drop:
      - ALL  # Drop all Linux capabilities
    cap_add:
      - NET_BIND_SERVICE  # Only add what's needed
    security_opt:
      - no-new-privileges:true
```

---

## Port Sharing Architecture

### Can Services Share Ports?

#### ❌ No: Direct Port Sharing
```
Port 3000: Next.js HTTP server
Port 3000: Nullclaw HTTP server  # CONFLICT!
```

#### ✅ Yes: Reverse Proxy
```
Port 80: Traefik Reverse Proxy
  ├─ /          → Next.js (internal:3000)
  ├─ /api/agent → OpenCode (internal:4000)
  ├─ /nullclaw  → Nullclaw (internal:3001)
  └─ /pty       → WebSocket (internal:8080)
```

#### ✅ Yes: Path-Based Routing
```yaml
# traefik.yml
http:
  routers:
    app-router:
      rule: "Host(`example.com`) && PathPrefix(`/`)"
      service: app-service
    
    nullclaw-router:
      rule: "Host(`example.com`) && PathPrefix(`/nullclaw`)"
      service: nullclaw-service
```

---

## Production Docker Compose

### Single Entry Point (Recommended)

```yaml
version: '3.8'

services:
  # Reverse Proxy (Port 80/443)
  proxy:
    image: traefik:v2.10
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # Read-only!
    
  # Next.js App (Internal Only)
  app:
    build: .
    networks:
      - internal-network
    # No ports exposed - only via proxy
  
  # Nullclaw (Internal Only)
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    networks:
      - internal-network
    # No ports exposed - only via app service
  
  # WebSocket PTY (Internal Only)
  pty:
    build: .
    command: ["node", "server.ts"]
    networks:
      - internal-network
    # No ports exposed - WebSocket via app

networks:
  internal-network:
    internal: true  # ✅ No direct external access
```

---

## Security Checklist

### Development ✅
- [x] Named volumes (not bind mounts)
- [x] Network isolation
- [x] Non-root user
- [ ] Docker socket mount (required for Nullclaw management)

### Production ✅
- [ ] Remove Docker socket mount
- [ ] Use secrets management
- [ ] Read-only filesystem
- [ ] Drop all capabilities
- [ ] Internal network only
- [ ] Reverse proxy for all access
- [ ] HTTPS/TLS termination
- [ ] Rate limiting
- [ ] Audit logging

---

## Performance vs Security Trade-offs

| Feature | Performance | Security | Recommendation |
|---------|-------------|----------|----------------|
| **Cache Volumes** | ✅ Faster builds | ⚠️ Persistent data | ✅ Keep for dev, review for prod |
| **Docker Socket** | ✅ Easy management | 🔴 Full control | ❌ Remove in production |
| **Reverse Proxy** | ⚠️ Slight latency | ✅ Single entry point | ✅ Use in production |
| **Internal Network** | ✅ Fast internal comms | ✅ No external access | ✅ Use in production |

---

**Verdict:** Cache volumes are safe for development. For production, remove Docker socket mount and use proper secrets management.
