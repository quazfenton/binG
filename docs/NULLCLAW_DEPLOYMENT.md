# Nullclaw Deployment Guide

## Overview

Nullclaw provides non-coding agency for:
- Discord/Telegram messaging
- Internet browsing and data extraction  
- Server automation
- API integrations
- Scheduled tasks

## Deployment Modes

### Mode 1: URL Mode (Production - Recommended)

Use an external Nullclaw service running as a separate container or cloud service.

**Architecture:**
```
┌─────────────┐     HTTP      ┌─────────────┐
│  binG App   │ ◄──────────►  │  Nullclaw   │
│  Container  │  Internal URL │  Container  │
└─────────────┘               └─────────────┘
```

**docker-compose.yml Configuration:**
```yaml
services:
  app:
    environment:
      - NULLCLAW_ENABLED=true
      - NULLCLAW_URL=http://nullclaw:3000  # Internal service URL
      - NULLCLAW_API_KEY=your-api-key  # Optional

  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
    networks:
      - bing-network
    # Exposed internally only (no host port mapping needed)
```

**Environment Variables (.env):**
```bash
NULLCLAW_ENABLED=true
NULLCLAW_URL=http://nullclaw:3000
NULLCLAW_API_KEY=your-api-key  # Optional
NULLCLAW_TIMEOUT=300000
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
```

**Benefits:**
- ✅ Production-ready
- ✅ Centralized service management
- ✅ Better resource utilization
- ✅ Easier scaling (add more Nullclaw instances behind load balancer)
- ✅ No Docker socket required in app container

---

### Mode 2: Container Pool Mode (Development)

App spawns a pool of Nullclaw containers dynamically.

**Architecture:**
```
┌─────────────┐
│  binG App   │
│  Container  │
└──────┬──────┘
       │ Docker API
       │
       ├─────────────┐
       │             │
       ▼             ▼
┌──────────┐  ┌──────────┐
│Nullclaw 1│  │Nullclaw 2│
│Container │  │Container │
└──────────┘  └──────────┘
```

**docker-compose.yml Configuration:**
```yaml
services:
  app:
    environment:
      - NULLCLAW_ENABLED=true
      - NULLCLAW_URL=  # Leave empty for container mode
      - NULLCLAW_MODE=shared
      - NULLCLAW_POOL_SIZE=2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock  # Required for spawning

  # Nullclaw service NOT included - app spawns containers dynamically
```

**Environment Variables (.env):**
```bash
NULLCLAW_ENABLED=true
NULLCLAW_URL=  # Empty = container mode
NULLCLAW_MODE=shared
NULLCLAW_POOL_SIZE=2
NULLCLAW_MAX_CONTAINERS=4
NULLCLAW_PORT=3001
NULLCLAW_IMAGE=ghcr.io/nullclaw/nullclaw:latest
NULLCLAW_TIMEOUT=300000
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
```

**Benefits:**
- ✅ Development-friendly
- ✅ No separate service management
- ✅ Automatic container lifecycle

**Requirements:**
- ⚠️ Docker socket mount required in app container
- ⚠️ Not recommended for production (security)

---

### Mode 3: Per-Session Mode (Isolated Development)

App spawns dedicated Nullclaw container for each user session.

**Architecture:**
```
┌─────────────┐
│  binG App   │
└──────┬──────┘
       │
       ├─────────────┐
       │             │
       ▼             ▼
┌──────────┐  ┌──────────┐
│ Session 1│  │ Session 2│
│Nullclaw  │  │Nullclaw  │
└──────────┘  └──────────┘
```

**Environment Variables (.env):**
```bash
NULLCLAW_ENABLED=true
NULLCLAW_URL=  # Empty = container mode
NULLCLAW_MODE=per-session
NULLCLAW_MAX_CONTAINERS=4
NULLCLAW_PORT=3001
```

**Benefits:**
- ✅ Maximum isolation between sessions
- ✅ Per-session configuration
- ✅ Clean separation of concerns

**Trade-offs:**
- ⚠️ Higher resource usage
- ⚠️ Slower startup (container spawn time)
- ⚠️ Limited by Docker resources

---

## Production Deployment (Recommended)

### Single Instance Setup

```yaml
# docker-compose.prod.yml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw:3000
  
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
    networks:
      - bing-network
    # No host port exposure - internal only
```

### Load Balanced Setup (High Concurrency)

```yaml
# docker-compose.prod.yml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw-lb:80
  
  nullclaw-lb:
    image: nginx:alpine
    ports:
      - "3001:80"
    volumes:
      - ./nginx-nullclaw.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - nullclaw-1
      - nullclaw-2
      - nullclaw-3
    networks:
      - bing-network

  nullclaw-1:
    image: ghcr.io/nullclaw/nullclaw:latest
    networks:
      - bing-network

  nullclaw-2:
    image: ghcr.io/nullclaw/nullclaw:latest
    networks:
      - bing-network

  nullclaw-3:
    image: ghcr.io/nullclaw/nullclaw:latest
    networks:
      - bing-network
```

**nginx-nullclaw.conf:**
```nginx
upstream nullclaw_backend {
    server nullclaw-1:3000;
    server nullclaw-2:3000;
    server nullclaw-3:3000;
}

server {
    listen 80;
    
    location / {
        proxy_pass http://nullclaw_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Development Setup

### Quick Start (Container Pool)

```bash
# .env
NULLCLAW_ENABLED=true
NULLCLAW_URL=
NULLCLAW_MODE=shared
NULLCLAW_POOL_SIZE=2

# Start services
docker compose -f docker-compose.dev.yml up -d

# Check status
docker compose ps nullclaw
```

### Per-Session Isolation

```bash
# .env
NULLCLAW_ENABLED=true
NULLCLAW_URL=
NULLCLAW_MODE=per-session
NULLCLAW_MAX_CONTAINERS=4

# Start services
docker compose up -d
```

---

## Environment Variables Reference

| Variable | Description | Default | Mode |
|----------|-------------|---------|------|
| `NULLCLAW_ENABLED` | Enable Nullclaw integration | `true` | All |
| `NULLCLAW_URL` | External service URL | - | URL |
| `NULLCLAW_API_KEY` | API key for authentication | - | URL |
| `NULLCLAW_MODE` | Container mode: `shared` or `per-session` | `shared` | Container |
| `NULLCLAW_POOL_SIZE` | Container pool size | `2` | Shared |
| `NULLCLAW_MAX_CONTAINERS` | Max concurrent containers | `4` | Per-Session |
| `NULLCLAW_PORT` | Starting port for containers | `3001` | Container |
| `NULLCLAW_IMAGE` | Docker image | `ghcr.io/nullclaw/nullclaw:latest` | Container |
| `NULLCLAW_TIMEOUT` | Request timeout (ms) | `300000` | All |
| `NULLCLAW_ALLOWED_DOMAINS` | Allowed domains (comma-separated) | `openrouter.ai,api.discord.com,api.telegram.org` | Container |
| `NULLCLAW_HEALTH_TIMEOUT` | Health check timeout (ms) | `30000` | Container |
| `NULLCLAW_NETWORK` | Docker network | `bing-network` | Container |
| `NULLCLAW_EXTERNAL_PORT` | Host port for Nullclaw service | `3001` | URL |

---

## Security Considerations

### URL Mode (Production)
- ✅ No Docker socket required
- ✅ Service isolation
- ✅ Network segmentation possible
- ✅ Standard HTTP authentication

### Container Mode (Development Only)
- ⚠️ Requires Docker socket mount
- ⚠️ Container escape risk
- ⚠️ Host compromise possible

**Production Mitigation:**
1. Use URL mode with external service
2. If container mode required:
   - Use Docker socket proxy with limited permissions
   - Implement rootless Docker
   - Apply AppArmor/SELinux profiles
   - Run in isolated network segment

---

## Troubleshooting

### Nullclaw Not Available

**URL Mode:**
```bash
# Check service is running
docker compose ps nullclaw

# Test connectivity
curl http://nullclaw:3000/health

# Check logs
docker compose logs nullclaw
```

**Container Mode:**
```bash
# Check app can access Docker socket
docker compose exec app docker ps

# Check spawned containers
docker ps | grep nullclaw

# Check app logs for spawn errors
docker compose logs app | grep Nullclaw
```

### Container Spawn Fails

```bash
# Verify Docker socket mount
docker compose exec app ls -la /var/run/docker.sock

# Check Docker permissions
docker compose exec app docker info

# Verify image available
docker compose exec app docker pull ghcr.io/nullclaw/nullclaw:latest
```

### Health Check Fails

```bash
# Check Nullclaw logs
docker compose logs nullclaw

# Test health endpoint manually
curl http://localhost:3001/health

# Increase health timeout
NULLCLAW_HEALTH_TIMEOUT=60000
```

---

## Migration Guide

### From Container Mode to URL Mode

1. **Update .env:**
   ```bash
   # Before (Container Mode)
   NULLCLAW_URL=
   NULLCLAW_MODE=shared
   
   # After (URL Mode)
   NULLCLAW_URL=http://nullclaw:3000
   ```

2. **Update docker-compose.yml:**
   ```yaml
   # Add Nullclaw service
   services:
     nullclaw:
       image: ghcr.io/nullclaw/nullclaw:latest
       networks:
         - bing-network
   ```

3. **Remove Docker socket mount from app:**
   ```yaml
   # Remove this line from app service
   # - /var/run/docker.sock:/var/run/docker.sock
   ```

4. **Restart services:**
   ```bash
   docker compose down
   docker compose up -d
   ```

---

## Performance Tuning

### URL Mode Scaling

**Horizontal Scaling:**
```yaml
# Add multiple Nullclaw instances behind load balancer
nullclaw-1: ...
nullclaw-2: ...
nullclaw-3: ...

nullclaw-lb:
  image: nginx:alpine
  # Load balance configuration
```

**Resource Limits:**
```yaml
nullclaw:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G
```

### Container Mode Tuning

**Pool Size:**
```bash
# Increase for higher concurrency
NULLCLAW_POOL_SIZE=4

# Decrease for resource conservation
NULLCLAW_POOL_SIZE=1
```

**Per-Session Limits:**
```bash
# Limit max concurrent containers
NULLCLAW_MAX_CONTAINERS=2
```

---

## Best Practices

### Production
1. ✅ Use URL mode with external service
2. ✅ Implement load balancing for >100 concurrent users
3. ✅ Set appropriate timeouts
4. ✅ Monitor health endpoints
5. ✅ Use API key authentication
6. ✅ Isolate Nullclaw network

### Development
1. ✅ Use container pool mode (shared)
2. ✅ Keep pool size small (1-2)
3. ✅ Enable verbose logging
4. ✅ Use local Nullclaw instance

### Security
1. ✅ Never expose Nullclaw to public internet without authentication
2. ✅ Use API keys in production
3. ✅ Restrict allowed domains
4. ✅ Monitor resource usage
5. ✅ Implement rate limiting

---

## Examples

### Example 1: Small Production Setup (< 100 users)

```yaml
# docker-compose.prod.yml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw:3000
      - NULLCLAW_API_KEY=prod-key-xyz
  
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
```

### Example 2: Large Production Setup (> 100 users)

```yaml
# docker-compose.prod.yml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw-lb:80
  
  nullclaw-lb:
    image: nginx:alpine
  
  nullclaw-1:
    image: ghcr.io/nullclaw/nullclaw:latest
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
  
  nullclaw-2:
    image: ghcr.io/nullclaw/nullclaw:latest
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

### Example 3: Development Setup

```yaml
# docker-compose.dev.yml
services:
  app:
    environment:
      - NULLCLAW_URL=
      - NULLCLAW_MODE=shared
      - NULLCLAW_POOL_SIZE=2
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
  
  # No Nullclaw service - app spawns dynamically
```
