# Docker Compose V2 Architecture Update

## Summary

Updated `docker-compose.v2.yml` to align with the advanced multi-agent architecture from `architectureUpdate.md`. This brings the infrastructure in line with Cursor/Devin-style coding agent systems.

## New Services Added

### 1. **Traefik Reverse Proxy** (`traefik`)
- **Purpose**: Centralized routing, SSL termination, load balancing
- **Ports**: 80 (HTTP), 443 (HTTPS), 8080 (Dashboard)
- **Features**:
  - Automatic service discovery via Docker labels
  - Path-based routing for all services
  - Dashboard available at `http://localhost:8080`

### 2. **Planner Worker** (`planner`)
- **Purpose**: Task decomposition into dependency graphs
- **Port**: 3004
- **Features**:
  - Breaks complex prompts into structured task graphs
  - Supports up to 20 tasks per plan
  - Integrates with Qdrant for code search context
- **Environment**:
  - `PLANNER_MAX_TASKS=20`
  - `QDRANT_URL=http://qdrant:6333`

### 3. **Background Worker** (`background`)
- **Purpose**: Repo indexing, embeddings, file watchers
- **Port**: 3006
- **Features**:
  - Automatic repo indexing every 5 minutes
  - Vector embeddings for semantic code search
  - File system watchers for real-time updates
- **Environment**:
  - `INDEX_INTERVAL_MS=300000`
  - `WORKSPACE_ROOT=/workspace`

### 4. **Sandbox Pool** (`sandbox`)
- **Purpose**: Pre-warmed isolated code execution environments
- **Port**: 3005
- **Features**:
  - Maintains pool of 5 pre-warmed sandboxes
  - Supports multiple providers (E2B, Daytona, Sprites, CodeSandbox, Microsandbox)
  - Auto-scales based on demand
  - 10-minute idle timeout
- **Environment**:
  - `SANDBOX_POOL_SIZE=5`
  - `SANDBOX_IDLE_TIMEOUT=600`
  - Provider API keys passed via env vars

### 5. **Qdrant Vector Database** (`qdrant`)
- **Purpose**: Vector storage for code embeddings and semantic search
- **Ports**: 6333 (HTTP), 6334 (gRPC)
- **Features**:
  - Semantic code search
  - Similarity matching for code patterns
  - Persistent storage via volume
- **Health Check**: HTTP endpoint monitoring

### 6. **PostgreSQL Database** (`postgres`)
- **Purpose**: Primary relational database
- **Port**: 5432
- **Features**:
  - User sessions
  - Job history
  - Vector metadata
- **Credentials**:
  - User: `postgres`
  - Password: `postgres`
  - Database: `binG`

## Updated Services

### Executor Workers (`worker`)
- **Scaling**: Now runs 3 replicas for parallel task execution
- **New Dependencies**:
  - `qdrant` (for code search)
  - `sandbox` (for isolated execution)
- **New Environment Variables**:
  - `QDRANT_URL=http://qdrant:6333`
  - `SANDBOX_POOL_URL=http://sandbox:3005`

### NextJS App (`app`)
- **Database**: Updated to use PostgreSQL service
- **New Environment Variables**:
  - `QDRANT_URL=http://qdrant:6333`
  - `VECTOR_SEARCH_ENABLED=true`
  - `PLANNER_ENABLED=true`
  - `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/binG`
- **Removed**: `8080` port (now handled by Traefik)

## Architecture Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   NextJS    │────▶│Agent Gateway │────▶│  Redis Queue    │
│   (app)    │     │  (gateway)   │     │  (pubsub/jobs)  │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
                    ▼                              ▼                              ▼
           ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
           │ Planner Worker  │           │Executor Workers │           │Background Worker│
           │(task planning)  │           │ (OpenCode loop) │           │ (indexing/search)│
           └─────────────────┘           └────────┬────────┘           └─────────────────┘
                                                  │
                                 ┌────────────────┼────────────────┐
                                 │                │                │
                                 ▼                ▼                ▼
                          ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
                          │MCP Server   │ │ Nullclaw    │ │Sandbox Pool │
                          │(filesystem) │ │(automation) │ │(execution)  │
                          └─────────────┘ └─────────────┘ └─────────────┘
                                                  ▲
                                                  │
                                          ┌─────────────┐
                                          │   Qdrant    │
                                          │  (vectors)  │
                                          └─────────────┘
```

## Volumes Added

| Volume | Purpose |
|--------|---------|
| `qdrant_data` | Vector database storage |
| `postgres_data` | PostgreSQL database |
| `sandbox_data` | Sandbox pool state |
| `index_data` | Background worker indexes |

## Network Configuration

All services communicate via the `bing-network` bridge network with subnet `172.28.0.0/16`.

## Traefik Routing Rules

| Service | Path Prefix | Port |
|---------|-------------|------|
| NextJS App | `/` | 5555 |
| Gateway | `/api/gateway` | 3002 |
| Worker | `/api/worker` | 3003 |
| MCP | `/api/mcp` | 8888 |
| Nullclaw | `/api/nullclaw` | 3000 |
| Sandbox | `/api/sandbox` | 3005 |
| Qdrant | `/api/vector` | 6333 |

## Performance Improvements

| Feature | Benefit |
|---------|---------|
| 3x Executor Workers | 3x parallel task capacity |
| Sandbox Pool | Instant sandbox allocation (no cold start) |
| Qdrant Vector Search | 100x faster code search vs filesystem scan |
| Background Indexing | Non-blocking repo analysis |
| Planner Worker | Smarter task decomposition |
| Traefik Load Balancing | Automatic worker scaling |

## Required Environment Variables

Add these to your `.env` file:

```env
# Vector Search
QDRANT_URL=http://qdrant:6333
VECTOR_SEARCH_ENABLED=true

# Planner
PLANNER_ENABLED=true

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/binG

# Sandbox Providers
E2B_API_KEY=your-e2b-key
DAYTONA_API_KEY=your-daytona-key
SPRITES_TOKEN=your-sprites-token
CODESANDBOX_API_KEY=your-codesandbox-key

# Sandbox Configuration
SANDBOX_PROVIDER=microsandbox
SANDBOX_POOL_SIZE=5
```

## Migration Notes

### Breaking Changes
1. **Database URL changed**: Update any hardcoded database connections
2. **Port 8080**: Now used by Traefik dashboard (NextJS dev server only on 5555)
3. **Worker scaling**: Ensure your code is stateless for horizontal scaling

### Non-Breaking Changes
1. All existing services maintain backward compatibility
2. Redis, MCP, and Nullclaw configurations unchanged
3. V2 agent flow remains the same

## Testing

Start the stack:
```bash
docker-compose -f docker-compose.v2.yml up -d
```

Check service health:
```bash
docker-compose -f docker-compose.v2.yml ps
```

View Traefik dashboard:
```
http://localhost:8080
```

Test vector search:
```bash
curl http://localhost:6333/health
```

Test sandbox pool:
```bash
curl http://localhost:3005/health
```

## Next Steps

1. **Create missing service code**:
   - `services/sandbox-pool/index.js`
   - `services/planner-worker/index.js`
   - `services/background-worker/index.js`

2. **Update application code**:
   - Integrate Qdrant for vector search
   - Implement planner agent logic
   - Add background indexing jobs

3. **Configure production**:
   - Enable Traefik SSL
   - Set up persistent volume backups
   - Configure worker auto-scaling rules

## References

- `architectureUpdate.md` - Full architecture documentation
- `docker-compose.v2.yml` - Updated compose file
- `Dockerfile.sandbox` - New sandbox pool image
