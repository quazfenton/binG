# Corrected Deployment Architecture

## OpenSandbox Setup (Correct Approach)

Based on the official OpenSandbox documentation in `docs/sdk/opensandbox/`, here's the correct way to set up sandbox execution:

### Option 1: Use OpenSandbox Server (Recommended)

**OpenSandbox Server** is a production-grade, FastAPI-based service for managing containerized sandboxes.

#### Installation

```bash
# Install from PyPI
uv pip install opensandbox-server

# Or from source
cd docs/sdk/opensandbox/server
uv sync
```

#### Configuration

Create `~/.sandbox.toml`:

```toml
[server]
host = "0.0.0.0"
port = 8080
log_level = "INFO"
api_key = "your-secret-api-key"

[runtime]
type = "docker"
execd_image = "opensandbox/execd:v1.0.6"

[docker]
network_mode = "bridge"  # or "host" for single-instance
```

#### Run OpenSandbox Server

```bash
opensandbox-server --config ~/.sandbox.toml
```

#### Use from binG

In your binG application, use the OpenSandbox SDK:

```typescript
import { OpenSandboxProvider } from './lib/sandbox/providers/opensandbox-provider';

const provider = new OpenSandboxProvider({
  serverUrl: 'http://localhost:8080',
  apiKey: 'your-secret-api-key',
});

// Create sandbox
const sandbox = await provider.createSandbox({
  image: 'python:3.11-slim',
  entrypoint: ['python', '-m', 'http.server', '8000'],
  timeout: 3600,
});

// Execute code
const result = await sandbox.executeCode('python', 'print("Hello World")');
```

---

### Option 2: Use Existing Dockerfile.sandbox

The existing `Dockerfile.sandbox` is already configured correctly:

```dockerfile
# Dockerfile for Sandbox Pool Service
FROM node:20-alpine

RUN apk add --no-cache \
    docker \
    docker-cli-compose \
    git \
    python3 \
    py3-pip \
    build-base \
    linux-headers

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY lib/sandbox/ ./lib/sandbox/
COPY services/sandbox-pool/ ./services/sandbox-pool/

ENV NODE_ENV=production
ENV PORT=3005

EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:3005/health || exit 1

CMD ["node", "services/sandbox-pool/index.js"]
```

**Usage in docker-compose.yml:**

```yaml
sandbox-pool:
  build:
    context: .
    dockerfile: Dockerfile.sandbox
  container_name: bing-sandbox-pool
  restart: unless-stopped
  ports:
    - "3005:3005"
  environment:
    - NODE_ENV=production
    - PORT=3005
    - SANDBOX_PROVIDER=${SANDBOX_PROVIDER:-docker}
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock  # For Docker-in-Docker
  networks:
    - bing-network
```

---

## Nullclaw Setup

Nullclaw is a separate service for non-coding agency (messaging, browsing, automation).

### Option 1: Use External Nullclaw Service (Production)

Set environment variables:

```bash
NULLCLAW_URL=https://your-nullclaw-instance.com
NULLCLAW_API_KEY=your-api-key
NULLCLAW_MODE=url
```

### Option 2: Self-Host Nullclaw

Clone and deploy Nullclaw:

```bash
git clone https://github.com/nullclaw/nullclaw.git
cd nullclaw
docker-compose up -d
```

Then configure binG:

```bash
NULLCLAW_URL=http://nullclaw:3000
NULLCLAW_MODE=shared
NULLCLAW_POOL_SIZE=2
```

---

## Corrected docker-compose.yml

```yaml
version: '3.8'

services:
  # Next.js Application
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runner
    container_name: bing-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - AGENT_GATEWAY_URL=http://agent-gateway:3002
      - OPEN_SANDBOX_SERVER_URL=http://opensandbox-server:8080
      - NULLCLAW_URL=http://nullclaw:3000
    depends_on:
      - opensandbox-server
      - nullclaw
    networks:
      - bing-network

  # OpenSandbox Server (Official)
  opensandbox-server:
    image: opensandbox/server:latest
    container_name: bing-opensandbox-server
    restart: unless-stopped
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

  # Nullclaw Service
  nullclaw:
    image: ghcr.io/nullclaw/nullclaw:latest
    container_name: bing-nullclaw
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NULLCLAW_TIMEOUT=3600
      - NULLCLAW_ALLOWED_DOMAINS=openrouter.ai,api.discord.com,api.telegram.org
    networks:
      - bing-network

  # Redis (for job queue)
  redis:
    image: redis:7-alpine
    container_name: bing-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - bing-network

  # PostgreSQL (for persistence)
  postgres:
    image: postgres:16-alpine
    container_name: bing-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=bing
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-change-me}
      - POSTGRES_DB=bing
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - bing-network

networks:
  bing-network:
    driver: bridge

volumes:
  opensandbox-config:
  redis-data:
  postgres-data:
```

---

## Key Points

1. **Don't create custom Dockerfiles for OpenSandbox** - Use the official `opensandbox-server` package
2. **OpenSandbox handles execd injection automatically** - No need to manually inject execution daemons
3. **Nullclaw is a separate service** - Either self-host or use external instance
4. **Use existing Dockerfile.sandbox** - Already configured correctly for sandbox pool

---

## References

- [OpenSandbox Architecture](./docs/sdk/opensandbox/opensandbox-architecture.md)
- [OpenSandbox Server](./docs/sdk/opensandbox/opensandbox-server.md)
- [OpenSandbox Specs](./docs/sdk/opensandbox/opensandbox-specs.md)
- [Dockerfile.sandbox](./Dockerfile.sandbox) - Existing correct implementation
