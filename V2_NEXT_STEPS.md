# V2 Multi-Agent Architecture - Next Steps

## ✅ Completed

### Services Created
- [x] `services/sandbox-pool/index.ts` - Pre-warmed sandbox pool
- [x] `services/planner-worker/index.ts` - Task decomposition
- [x] `services/background-worker/index.ts` - Repo indexing
- [x] `services/mcp-server/index.ts` - MCP tool server
- [x] `Dockerfile.sandbox` - Sandbox pool container
- [x] `Dockerfile.agent` - Multi-service agent container
- [x] `Dockerfile.mcp` - MCP server container

### Configuration
- [x] `docker-compose.v2.yml` - Updated with all services
- [x] `env.example` - Added 200+ new variables
- [x] Fixed Redis imports (use `ioredis` consistently)

### Documentation
- [x] `V2_IMPLEMENTATION_SUMMARY.md` - Complete implementation guide
- [x] `V2_REVIEW_AND_FIXES.md` - Review with fixes
- [x] `DOCKER_COMPOSE_UPDATE.md` - Migration guide

---

## 📋 Immediate Next Steps

### 1. Install Missing Dependencies

```bash
cd C:\Users\ceclabs\Downloads\binG

# Install required packages
pnpm install chokidar @qdrant/js-client-rest simple-git

# Verify installations
pnpm list chokidar @qdrant/js-client-rest simple-git ioredis
```

### 2. Create Service Directories

```bash
# Create service directories (if not exist)
mkdir -p services/sandbox-pool
mkdir -p services/planner-worker
mkdir -p services/background-worker
mkdir -p services/mcp-server

# Move service files if needed
# (Files already created in correct locations)
```

### 3. Add Package.json Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "dev:v2": "docker-compose -f docker-compose.v2.yml up -d",
    "dev:v2:logs": "docker-compose -f docker-compose.v2.yml logs -f",
    "dev:v2:down": "docker-compose -f docker-compose.v2.yml down",
    "build:v2": "docker-compose -f docker-compose.v2.yml build",
    "service:sandbox-pool": "tsx services/sandbox-pool/index.ts",
    "service:planner": "tsx services/planner-worker/index.ts",
    "service:background": "tsx services/background-worker/index.ts",
    "service:mcp": "tsx services/mcp-server/index.ts",
    "test:v2": "vitest run __tests__/v2-*.test.ts"
  }
}
```

### 4. Create Test Files

```typescript
// __tests__/v2-sandbox-pool.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('SandboxPool', () => {
  it('should initialize with pre-warmed sandboxes', async () => {
    // Test implementation
  });

  it('should acquire and release sandboxes', async () => {
    // Test implementation
  });

  it('should handle idle timeout', async () => {
    // Test implementation
  });
});

// __tests__/v2-planner-worker.test.ts
describe('PlannerWorker', () => {
  it('should decompose prompt into tasks', async () => {
    const response = await fetch('http://localhost:3004/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Build a Next.js authentication system',
      }),
    });
    const graph = await response.json();
    expect(graph.tasks).toBeDefined();
    expect(graph.tasks.length).toBeGreaterThan(0);
  });

  it('should handle task dependencies', async () => {
    // Test implementation
  });
});

// __tests__/v2-background-worker.test.ts
describe('BackgroundWorker', () => {
  it('should index workspace files', async () => {
    // Test implementation
  });

  it('should search code', async () => {
    const response = await fetch(
      'http://localhost:3006/search?q=authentication&limit=5'
    );
    const { results } = await response.json();
    expect(results).toBeInstanceOf(Array);
  });
});
```

### 5. Build and Test Locally

```bash
# Build Docker images
docker-compose -f docker-compose.v2.yml build

# Start services
docker-compose -f docker-compose.v2.yml up -d

# Check service health
curl http://localhost:3002/health  # Gateway
curl http://localhost:3003/health  # Worker
curl http://localhost:3004/health  # Planner
curl http://localhost:3005/health  # Sandbox Pool
curl http://localhost:3006/health  # Background Worker
curl http://localhost:8888/health  # MCP Server
curl http://localhost:6333/        # Qdrant

# View logs
docker-compose -f docker-compose.v2.yml logs -f sandbox-pool
docker-compose -f docker-compose.v2.yml logs -f planner
docker-compose -f docker-compose.v2.yml logs -f background

# Test task decomposition
curl -X POST http://localhost:3004/decompose \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a REST API with Express and MongoDB"}'

# Test code search
curl "http://localhost:3006/search?q=database+connection&limit=5"

# Stop services
docker-compose -f docker-compose.v2.yml down
```

### 6. Configure Environment

Create `.env` file:

```bash
# Copy from example
cp env.example .env

# Edit with your values
# Required for production:
# - E2B_API_KEY or DAYTONA_API_KEY (sandbox provider)
# - OPENROUTER_API_KEY (LLM access)
# - REDIS_URL (already configured)
# - QDRANT_URL (already configured)
```

### 7. Test Execution Policies

```typescript
// Test different execution policies
const policies = [
  'local-safe',
  'sandbox-required',
  'sandbox-preferred',
  'sandbox-heavy',
  'persistent-sandbox',
  'desktop-required',
];

for (const policy of policies) {
  const response = await fetch('http://localhost:3004/decompose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Build a full-stack app with database',
      context: { executionPolicy: policy },
    }),
  });
  const graph = await response.json();
  console.log(`Policy ${policy}: ${graph.tasks.length} tasks`);
}
```

---

## 🚀 Production Deployment

### 1. Update Docker Compose for Production

```yaml
# docker-compose.v2.prod.yml
version: '3.8'

services:
  traefik:
    # Add SSL configuration
    command:
      - "--certificatesresolvers.myresolver.acme.tlschallenge=true"
      - "--certificatesresolvers.myresolver.acme.email=your@email.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"

  app:
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G

  worker:
    deploy:
      replicas: 5  # Scale based on load
      resources:
        limits:
          cpus: '2'
          memory: 4G

  # Add monitoring
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=secure_password

volumes:
  prometheus_data:
  grafana_data:
```

### 2. Add Monitoring

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'v2-services'
    static_configs:
      - targets:
          - 'gateway:3002'
          - 'worker:3003'
          - 'planner:3004'
          - 'sandbox-pool:3005'
          - 'background-worker:3006'
          - 'mcp:8888'
```

### 3. Set Up Logging

```bash
# Install logging stack
docker-compose -f docker-compose.logging.yml up -d

# docker-compose.logging.yml
version: '3.8'
services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    ports:
      - "9200:9200"

  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./logstash/pipeline:/usr/share/logstash/pipeline
    ports:
      - "5000:5000"

  kibana:
    image: docker.elastic.co/kibana/kibana:8.11.0
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

volumes:
  elasticsearch_data:
```

### 4. Configure CI/CD

```yaml
# .github/workflows/v2-deploy.yml
name: Deploy V2 Services

on:
  push:
    branches: [main]
    paths:
      - 'services/**'
      - 'docker-compose.v2.yml'
      - 'Dockerfile.*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build images
        run: docker-compose -f docker-compose.v2.yml build

      - name: Run tests
        run: pnpm test:v2

      - name: Push to registry
        run: |
          docker tag bing-gateway:latest registry.example.com/bing-gateway:${{ github.sha }}
          docker push registry.example.com/bing-gateway:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to production
        run: |
          ssh deploy@server "cd /opt/bing && docker-compose -f docker-compose.v2.yml pull && docker-compose -f docker-compose.v2.yml up -d"
```

---

## 📊 Performance Benchmarks

### Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Sandbox Creation | 30-60s | <1s | 30-60x faster |
| Code Search | 2-5s | <100ms | 20-50x faster |
| Parallel Tasks | 1 | 3 concurrent | 3x throughput |
| Task Planning | Manual | Automatic | Smarter execution |
| Resource Usage | Unmonitored | Real-time | Proactive scaling |

### Benchmarking Script

```bash
#!/bin/bash
# benchmarks/v2-benchmarks.sh

echo "=== V2 Architecture Benchmarks ==="

# Sandbox pool warmup time
echo "1. Sandbox Pool Warmup..."
START=$(date +%s%N)
curl -s http://localhost:3005/health > /dev/null
END=$(date +%s%N)
echo "   Health check: $((($END - $START) / 1000000))ms"

# Task decomposition
echo "2. Task Decomposition..."
START=$(date +%s%N)
curl -s -X POST http://localhost:3004/decompose \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Build a REST API"}' > /dev/null
END=$(date +%s%N)
echo "   Decomposition: $((($END - $START) / 1000000))ms"

# Code search
echo "3. Code Search..."
START=$(date +%s%N)
curl -s "http://localhost:3006/search?q=auth&limit=10" > /dev/null
END=$(date +%s%N)
echo "   Search: $((($END - $START) / 1000000))ms"

# Sandbox acquisition
echo "4. Sandbox Acquisition..."
START=$(date +%s%N)
curl -s -X POST http://localhost:3005/acquire > /dev/null
END=$(date +%s%N)
echo "   Acquisition: $((($END - $START) / 1000000))ms"

echo "=== Benchmarks Complete ==="
```

---

## 🔧 Troubleshooting

### Common Issues

**1. Services Won't Start**
```bash
# Check logs
docker-compose -f docker-compose.v2.yml logs sandbox-pool

# Common fixes:
# - Missing dependencies: pnpm install
# - Port conflicts: Change PORT in .env
# - Redis connection: Check REDIS_URL
```

**2. Qdrant Connection Failed**
```bash
# Verify Qdrant is running
docker-compose -f docker-compose.v2.yml ps qdrant

# Test connection
curl http://localhost:6333/

# Check logs
docker-compose -f docker-compose.v2.yml logs qdrant
```

**3. Sandbox Pool Empty**
```bash
# Check provider API keys
echo $E2B_API_KEY
echo $DAYTONA_API_KEY

# View pool stats
curl http://localhost:3005/stats

# Check logs for errors
docker-compose -f docker-compose.v2.yml logs sandbox-pool | grep "Failed"
```

**4. Task Decomposition Returns Empty**
```bash
# Check planner logs
docker-compose -f docker-compose.v2.yml logs planner

# Verify task router
curl http://localhost:3004/stats

# Test with simple prompt
curl -X POST http://localhost:3004/decompose \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello"}'
```

---

## 📚 Additional Resources

### Documentation to Create

1. **API Reference** (`docs/api/v2-services.md`)
   - OpenAPI/Swagger specification
   - Request/response examples
   - Error codes

2. **Architecture Deep Dive** (`docs/architecture/v2-deep-dive.md`)
   - Service communication patterns
   - Data flow diagrams
   - Scaling strategies

3. **Operations Guide** (`docs/operations/v2-ops.md`)
   - Deployment checklist
   - Monitoring setup
   - Backup procedures

4. **Developer Guide** (`docs/development/v2-dev.md`)
   - Local development setup
   - Testing strategies
   - Debugging tips

### Monitoring Dashboards

Create Grafana dashboards for:
- Service health overview
- Task execution metrics
- Sandbox pool utilization
- Vector search performance
- Resource usage by service

---

## ✅ Final Checklist

Before marking as complete:

- [ ] All services start without errors
- [ ] Health endpoints return 200
- [ ] Task decomposition works
- [ ] Code search returns results
- [ ] Sandbox pool pre-warms successfully
- [ ] Execution policies are respected
- [ ] Redis connection works
- [ ] Qdrant vector search works
- [ ] Docker Compose starts all services
- [ ] Tests pass
- [ ] Documentation is complete
- [ ] Performance benchmarks meet targets

---

## Contact & Support

For issues or questions:
1. Check `V2_REVIEW_AND_FIXES.md` for known issues
2. Review service logs: `docker-compose logs -f <service>`
3. Check architecture docs: `architectureUpdate.md`
4. Review implementation: `V2_IMPLEMENTATION_SUMMARY.md`
