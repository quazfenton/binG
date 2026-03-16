# V2 Agent System Deployment Checklist

## Pre-Deployment

### Infrastructure

- [ ] Docker and Docker Compose installed
- [ ] Sufficient disk space (minimum 50GB for workspace + sandboxes)
- [ ] Network ports available: 3002 (gateway), 3003 (worker), 6379 (redis), 8888 (mcp)
- [ ] Docker socket access for sandbox operations
- [ ] Volume mounts configured for persistence

### Environment Configuration

- [ ] Copy `.env.example` to `.env`
- [ ] Set `REDIS_URL` (default: `redis://redis:6379`)
- [ ] Set `V2_GATEWAY_URL` (default: `http://gateway:3002`)
- [ ] Configure `OPENCODE_MODEL` for your provider
- [ ] Set `GIT_VFS_AUTO_COMMIT=true` for automatic versioning
- [ ] Configure sandbox provider API keys (E2B, Daytona, Sprites, etc.)
- [ ] Set `WORKER_REPLICAS` based on expected load

### Dependencies

- [ ] Run `pnpm install` to install all dependencies
- [ ] Verify `chokidar`, `@qdrant/js-client-rest`, `simple-git` installed
- [ ] Check Node.js version (minimum v20)
- [ ] Verify Docker images build successfully

---

## Deployment Steps

### 1. Start Core Services

```bash
# Start Redis first (required by all services)
docker-compose -f docker-compose.v2.yml up -d redis

# Wait for Redis to be healthy
docker-compose -f docker-compose.v2.yml exec redis redis-cli ping
# Expected: PONG

# Start MCP server
docker-compose -f docker-compose.v2.yml up -d mcp

# Verify MCP is running
curl http://localhost:8888/health
```

### 2. Start Agent Services

```bash
# Start gateway
docker-compose -f docker-compose.v2.yml up -d gateway

# Start workers (scaled)
docker-compose -f docker-compose.v2.yml up -d --scale worker=3 worker

# Start supporting services
docker-compose -f docker-compose.v2.yml up -d planner background sandbox
```

### 3. Verify Health

```bash
# Gateway health
curl http://localhost:3002/health
# Expected: {"status":"ok","redis":"PONG",...}

# Gateway ready
curl http://localhost:3002/ready
# Expected: {"ready":true}

# Worker status (via gateway)
curl http://localhost:3002/jobs
# Expected: {"count":0,"jobs":[]}

# Redis streams
curl http://localhost:3002/streams
# Expected: {"key":"agent:events","length":0}
```

### 4. Test Job Processing

```bash
# Create test job
JOB_RESPONSE=$(curl -X POST http://localhost:3002/jobs \
  -H "Content-Type: application/json" \
  -d '{"userId":"deploy-test","conversationId":"test-1","prompt":"Say hello"}')

echo $JOB_RESPONSE
# Expected: {"jobId":"job-...","sessionId":"session-...","status":"pending"}

# Extract session ID
SESSION_ID=$(echo $JOB_RESPONSE | jq -r '.sessionId')

# Stream events (timeout after 10 seconds)
timeout 10 curl -N http://localhost:3002/stream/$SESSION_ID
# Expected events: connected, init, token, done
```

### 5. Test Git-Backed VFS

```bash
# Get versions (should be empty initially)
curl http://localhost:3002/git/$SESSION_ID/versions

# Trigger file write via agent
curl -X POST http://localhost:3002/jobs \
  -H "Content-Type: application/json" \
  -d '{"userId":"deploy-test","conversationId":"test-2","prompt":"Create a file src/test.ts with export const x = 1"}'

# Wait for job to complete, then check versions
sleep 5
curl http://localhost:3002/git/$SESSION_ID/versions
# Expected: At least one version with commit message
```

### 6. Test Rollback

```bash
# Get current version
VERSIONS=$(curl http://localhost:3002/git/$SESSION_ID/versions)
echo $VERSIONS | jq '.versions[0].version'

# Rollback to version 1
curl -X POST http://localhost:3002/git/$SESSION_ID/rollback \
  -H "Content-Type: application/json" \
  -d '{"version": 1}'

# Verify rollback via SSE or logs
docker-compose -f docker-compose.v2.yml logs worker | grep "Rolled back"
```

---

## Post-Deployment

### Monitoring Setup

- [ ] Access Grafana at http://localhost:3000 (if monitoring enabled)
- [ ] Configure Prometheus scraping targets
- [ ] Set up alerts for:
  - Worker queue depth > 100
  - Job failure rate > 10%
  - Redis connection errors
  - Git commit failures

### Performance Tuning

- [ ] Adjust `WORKER_CONCURRENCY` based on CPU usage
- [ ] Scale `WORKER_REPLICAS` based on queue depth
- [ ] Configure `SANDBOX_POOL_SIZE` based on demand
- [ ] Set `CACHE_TTL_MS` for optimal caching

### Security Hardening

- [ ] Set `REDIS_PASSWORD` in production
- [ ] Enable CORS restrictions (`CORS_ORIGINS`)
- [ ] Configure rate limiting (`RATE_LIMIT_MAX_REQUESTS`)
- [ ] Enable Helmet security headers (`HELMET_ENABLED=true`)
- [ ] Set up SSL/TLS for gateway (`TRAEFIK_SSL_ENABLED=true`)

---

## Validation Tests

### Automated Tests

```bash
# Run all V2 tests
pnpm test:v2

# Run gateway tests
pnpm test __tests__/v2-agent-gateway.test.ts

# Run worker tests
pnpm test __tests__/v2-agent-worker.test.ts

# Run git-backed VFS tests
pnpm test __tests__/v2-git-backed-vfs.test.ts
```

### Manual Tests

- [ ] Create job via API
- [ ] Verify SSE streaming works
- [ ] Check git commits created
- [ ] Test rollback functionality
- [ ] Verify checkpoint persistence
- [ ] Test concurrent job processing
- [ ] Validate error handling

---

## Troubleshooting

### Common Issues

**Redis Connection Failed**
```bash
# Check Redis is running
docker-compose -f docker-compose.v2.yml ps redis

# Check Redis logs
docker-compose -f docker-compose.v2.yml logs redis

# Test connection
docker-compose -f docker-compose.v2.yml exec redis redis-cli ping
```

**Workers Not Processing Jobs**
```bash
# Check queue depth
docker-compose -f docker-compose.v2.yml exec redis redis-cli LLEN agent:jobs

# Check worker logs
docker-compose -f docker-compose.v2.yml logs worker

# Restart workers
docker-compose -f docker-compose.v2.yml restart worker
```

**Git Commits Not Created**
```bash
# Check GIT_VFS_AUTO_COMMIT
docker-compose -f docker-compose.v2.yml exec worker env | grep GIT_VFS

# Check worker logs for git errors
docker-compose -f docker-compose.v2.yml logs worker | grep -i "git"

# Verify shadow commit storage
docker-compose -f docker-compose.v2.yml exec postgres psql -U postgres -d binG -c "SELECT COUNT(*) FROM shadow_commits"
```

**SSE Events Not Streaming**
```bash
# Check gateway logs
docker-compose -f docker-compose.v2.yml logs gateway | grep -i "stream"

# Test SSE directly
curl -N http://localhost:3002/stream/test-session

# Check Redis PubSub
docker-compose -f docker-compose.v2.yml exec redis redis-cli PUBSUB CHANNELS
```

---

## Scaling Guide

### Horizontal Scaling

```yaml
# docker-compose.v2.prod.yml
worker:
  deploy:
    replicas: 10  # Scale based on load
  environment:
    - WORKER_CONCURRENCY=4
```

### Vertical Scaling

```yaml
worker:
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 8G
      reservations:
        cpus: '2'
        memory: 4G
```

### Redis Cluster

```yaml
# For high availability
redis-cluster:
  image: redis:7-alpine
  command: redis-server --cluster-enabled yes
  deploy:
    replicas: 6  # 3 masters + 3 slaves
```

---

## Rollback Procedure

If deployment fails:

### 1. Stop V2 Services

```bash
docker-compose -f docker-compose.v2.yml down
```

### 2. Restore V1 Configuration

```bash
# Restore backup
cp .env.v1-backup .env

# Restart V1 services
docker-compose up -d app
```

### 3. Verify V1 Functionality

```bash
# Test original chat endpoint
curl -X POST http://localhost:5555/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"provider":"openrouter","model":"test"}'
```

---

## Success Criteria

Deployment is successful when:

- [ ] All services report healthy status
- [ ] Jobs process within 30 seconds
- [ ] SSE events stream without interruption
- [ ] Git commits created for file changes
- [ ] Rollback completes successfully
- [ ] No errors in service logs
- [ ] Monitoring dashboards show green status
- [ ] All automated tests pass

---

## Support Contacts

- **Technical Issues**: #v2-agent-support (internal)
- **Documentation**: See `V2_AGENT_WIRING_GUIDE.md`
- **Known Issues**: See `V2_REVIEW_AND_FIXES.md`
- **Architecture**: See `architectureUpdate.md`

---

## Sign-Off

- [ ] Infrastructure verified
- [ ] Services deployed and healthy
- [ ] Tests passing
- [ ] Monitoring configured
- [ ] Team trained
- [ ] Documentation updated
- [ ] Rollback plan tested

**Deployment Date**: _______________
**Deployed By**: _______________
**Approved By**: _______________
