# Nullclaw Integration Configuration

## Overview

Nullclaw provides non-coding agency for:
- Discord/Telegram messaging
- Internet browsing and data extraction
- Server automation
- API integrations
- Scheduled tasks

## Deployment Modes

### Mode 1: URL-based (Recommended for Production)

Use an external Nullclaw service (docker-compose, cloud service, etc.)

**Environment Variables:**
```bash
# Required: Base URL for Nullclaw service
NULLCLAW_URL=http://nullclaw:3000

# Optional: API key for authentication
NULLCLAW_API_KEY=your-api-key-here

# Optional: Request timeout in seconds (default: 300)
NULLCLAW_TIMEOUT=300

# Enable Nullclaw integration
NULLCLAW_ENABLED=true
```

**docker-compose.yml Example:**
```yaml
services:
  app:
    environment:
      - NULLCLAW_URL=http://nullclaw:3000
      - NULLCLAW_ENABLED=true
  
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    ports:
      - "3001:3000"
    environment:
      - NULLCLAW_ALLOWED_DOMAINS=api.discord.com,api.telegram.org
    networks:
      - bing-network

networks:
  bing-network:
    driver: bridge
```

### Mode 2: Shared Container Pool (Development/Local)

Spawn a pool of Nullclaw containers locally, shared across sessions.

**Environment Variables:**
```bash
# Container pool configuration
NULLCLAW_MODE=shared                    # Shared container pool
NULLCLAW_POOL_SIZE=2                    # Number of containers (default: 2, max: 4)
NULLCLAW_IMAGE=ghcr.io/nullclaw/nullclaw:latest
NULLCLAW_PORT=3001                      # Base port for containers
NULLCLAW_TIMEOUT=300                    # Request timeout in seconds
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
NULLCLAW_HEALTH_TIMEOUT=30000           # Health check timeout in ms
NULLCLAW_NETWORK=bing-network           # Docker network

# Enable Nullclaw integration
NULLCLAW_ENABLED=true
```

### Mode 3: Per-Session Containers (Isolated)

Spawn a dedicated Nullclaw container for each user session.

**Environment Variables:**
```bash
NULLCLAW_MODE=per-session               # One container per session
NULLCLAW_IMAGE=ghcr.io/nullclaw/nullclaw:latest
NULLCLAW_PORT=3001                      # Base port
NULLCLAW_MAX_CONTAINERS=4               # Max concurrent containers
NULLCLAW_PORT=3001                 # Starting port
NULLCLAW_TIMEOUT=300
NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org

# Enable Nullclaw integration
NULLCLAW_ENABLED=true
```

## Configuration Priority

1. **NULLCLAW_URL** - If set, use external service (Mode 1)
2. **NULLCLAW_MODE=shared** - Use container pool (Mode 2, default)
3. **NULLCLAW_MODE=per-session** - Use per-session containers (Mode 3)

## All Environment Variables

| Variable | Description | Default | Mode |
|----------|-------------|---------|------|
| `NULLCLAW_URL` | Base URL for Nullclaw service | - | URL |
| `NULLCLAW_API_KEY` | API key for authentication | - | URL |
| `NULLCLAW_ENABLED` | Enable Nullclaw integration | `false` | All |
| `NULLCLAW_MODE` | Container mode: `shared` or `per-session` | `shared` | Container |
| `NULLCLAW_POOL_SIZE` | Number of containers in pool | `2` | Shared |
| `NULLCLAW_IMAGE` | Docker image | `ghcr.io/nullclaw/nullclaw:latest` | Container |
| `NULLCLAW_PORT` | Base port for containers | `3001` | Container |
| `NULLCLAW_TIMEOUT` | Request timeout (seconds) | `300` | All |
| `NULLCLAW_ALLOWED_DOMAINS` | Comma-separated allowed domains | `openrouter.ai,api.discord.com,api.telegram.org` | Container |
| `NULLCLAW_HEALTH_TIMEOUT` | Health check timeout (ms) | `30000` | Container |
| `NULLCLAW_NETWORK` | Docker network name | `bing-network` | Container |
| `NULLCLAW_MAX_CONTAINERS` | Max concurrent containers | `4` | Per-session |
| `NULLCLAW_PORT` | Starting port for containers | `3001` | Per-session |

## Usage Examples

### Send Discord Message
```typescript
import { sendNullclawDiscordMessage } from '@bing/shared/agent/nullclaw-integration';

const task = await sendNullclawDiscordMessage(
  '123456789012345678',  // Channel ID
  'Hello from OpenCode!',
  userId,
  conversationId
);

console.log(`Task ${task.status}: ${task.result?.output}`);
```

### Browse URL
```typescript
import { browseNullclawUrl } from '@bing/shared/agent/nullclaw-integration';

const task = await browseNullclawUrl(
  'https://example.com',
  'extract main content',
  userId,
  conversationId
);
```

### Execute Automation
```typescript
import { automateNullclawTask } from '@bing/shared/agent/nullclaw-integration';

const task = await automateNullclawTask(
  ['npm install', 'npm run build'],
  'server-1',
  userId,
  conversationId
);
```

### Check Status
```typescript
import { getNullclawStatus, isNullclawAvailable } from '@bing/shared/agent/nullclaw-integration';

if (isNullclawAvailable()) {
  const status = getNullclawStatus();
  console.log(`Mode: ${status.mode}`);
  console.log(`Containers: ${status.containers.ready}/${status.containers.total} ready`);
  console.log(`Tasks: ${status.tasks.completed} completed, ${status.tasks.failed} failed`);
}
```

## Architecture

```
┌─────────────────┐     HTTP      ┌─────────────────┐
│  OpenCode Agent │ ◄──────────►  │  Nullclaw       │
│  (Sandbox A)    │   API Calls   │  Service (URL)  │
└─────────────────┘               └─────────────────┘
        │                               │
        │ (fallback)                    ▼
        │                        ┌─────────────────┐
        └───────────────────────►│  Nullclaw       │
          Docker Spawn           │  Container Pool │
                                 └────────┬────────┘
                                          │
                                          ▼
                                   ┌─────────────────┐
                                   │  External APIs  │
                                   │  - Discord      │
                                   │  - Telegram     │
                                   │  - Web Browsing │
                                   └─────────────────┘
```

## Troubleshooting

### Nullclaw not available
1. Check `NULLCLAW_URL` is set correctly
2. Verify Nullclaw service is running: `curl http://nullclaw:3000/health`
3. Check container logs: `docker logs nullclaw`

### Container spawn fails
1. Ensure Docker is running: `docker ps`
2. Check network exists: `docker network ls | grep bing-network`
3. Verify image is available: `docker pull ghcr.io/nullclaw/nullclaw:latest`

### Health check fails
1. Increase `NULLCLAW_HEALTH_TIMEOUT` (default: 30000ms)
2. Check container logs for startup errors
3. Verify port is not in use: `netstat -an | grep 3001`

### Task execution fails
1. Check `NULLCLAW_ALLOWED_DOMAINS` includes target domains
2. Verify API key is set if required: `NULLCLAW_API_KEY`
3. Check task logs: `getNullclawStatus().tasks`
