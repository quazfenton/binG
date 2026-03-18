# V2 Implementation Review - Fixes & Missing Features

## Critical Fixes Required

### 1. **Redis Import Compatibility** ⚠️

**Issue**: Existing codebase uses `ioredis`, new services use `redis` package.

**Location**: 
- `services/sandbox-pool/index.ts:61`
- `services/planner-worker/index.ts:65`
- `services/background-worker/index.ts:78`

**Fix**: Use `ioredis` for consistency with existing code:

```typescript
// Replace in all three service files
import Redis from 'ioredis';

// In initialize():
this.redisClient = new Redis(REDIS_URL);
```

**Why**: The codebase already has `ioredis` installed and configured in:
- `lib/agent/services/agent-worker/src/index.ts`
- `lib/agent/services/agent-gateway/src/index.ts`
- `infra/queue.ts`

---

### 2. **Missing Git Tools Integration** ⚠️

**Issue**: Architecture doc mentions `git.*` tools but no implementation exists.

**Missing Files**:
- `lib/tools/git-tools.ts` - Git operations (commit, branch, diff)
- `lib/stateful-agent/tools/git-tools.ts` - Stateful git operations

**Fix**: Create git tools file:

```typescript
// lib/tools/git-tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import { simpleGit, SimpleGit } from 'simple-git'; // Need to install

export const gitTools = {
  git_status: tool({
    description: 'Get git repository status',
    parameters: z.object({
      repoPath: z.string().describe('Path to git repository'),
    }),
    execute: async ({ repoPath }) => {
      const git = simpleGit(repoPath);
      const status = await git.status();
      return {
        success: true,
        status: {
          current: status.current,
          staged: status.staged,
          not_staged: status.not_staged,
          not_added: status.not_added,
        },
      };
    },
  }),

  git_commit: tool({
    description: 'Commit changes to git repository',
    parameters: z.object({
      repoPath: z.string(),
      message: z.string(),
      files: z.array(z.string()).optional(),
    }),
    execute: async ({ repoPath, message, files }) => {
      const git = simpleGit(repoPath);
      if (files) {
        await git.add(files);
      }
      await git.commit(message);
      return { success: true, message };
    },
  }),

  git_diff: tool({
    description: 'Get git diff for repository',
    parameters: z.object({
      repoPath: z.string(),
      files: z.array(z.string()).optional(),
    }),
    execute: async ({ repoPath, files }) => {
      const git = simpleGit(repoPath);
      const diff = files 
        ? await git.diff(files)
        : await git.diff();
      return { success: true, diff };
    },
  }),

  git_branch: tool({
    description: 'Create or switch git branches',
    parameters: z.object({
      repoPath: z.string(),
      branchName: z.string(),
      action: z.enum(['create', 'switch', 'list']),
    }),
    execute: async ({ repoPath, branchName, action }) => {
      const git = simpleGit(repoPath);
      if (action === 'list') {
        const branches = await git.branchLocal();
        return { success: true, branches };
      }
      if (action === 'create') {
        await git.checkoutBranch(branchName, 'HEAD');
      } else {
        await git.checkout(branchName);
      }
      return { success: true, branch: branchName };
    },
  }),
};
```

**Add to package.json**:
```json
"simple-git": "^3.27.0"
```

---

### 3. **Missing Package Dependencies** ⚠️

**Required packages not in package.json**:

```json
{
  "dependencies": {
    "ioredis": "^5.4.1",           // Already installed, use instead of redis
    "chokidar": "^3.6.0",          // File watching (background worker)
    "@qdrant/js-client-rest": "^1.7.0",  // Qdrant vector DB
    "simple-git": "^3.27.0",       // Git operations
    "tar-stream": "^3.1.7"         // Already installed
  }
}
```

**Install Command**:
```bash
pnpm install chokidar @qdrant/js-client-rest simple-git
```

---

### 4. **Missing MCP Server Export** ⚠️

**Issue**: `Dockerfile.mcp` referenced but may not exist.

**Check**:
```bash
ls -la Dockerfile.mcp
```

**Create if missing**:
```dockerfile
# Dockerfile.mcp
FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY lib/mcp/ ./lib/mcp/
COPY services/mcp-server/ ./services/mcp-server/

ENV MCP_PORT=8888
EXPOSE 8888

CMD ["node", "services/mcp-server/index.js"]
```

---

### 5. **Missing Agent Gateway Service** ⚠️

**Issue**: `Dockerfile.agent` referenced for gateway/worker/planner/background but may not exist.

**Create**:
```dockerfile
# Dockerfile.agent
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    docker \
    git \
    python3 \
    build-base

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Copy shared libraries
COPY lib/ ./lib/

# Service-specific entry point (set via TARGETPLATFORM or build arg)
ARG SERVICE_NAME=worker
COPY services/${SERVICE_NAME}/ ./services/${SERVICE_NAME}/

ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE_NAME}

EXPOSE 3002 3003 3004 3005 3006

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "services/${SERVICE_NAME}/index.js"]
```

---

## Missing Features from Architecture Doc

### 6. **Memory System** 🔶

**Architecture Reference**: Section 12 - Long-term memory with entities, relations, observations

**Status**: Partially implemented in MCP memory tools

**Enhancement Needed**: Add dedicated memory service:

```typescript
// services/memory-service/index.ts
import { createServer } from 'http';
import { createLogger } from '../../lib/utils/logger';

interface MemoryEntity {
  id: string;
  type: 'concept' | 'file' | 'pattern' | 'decision';
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
}

interface MemoryRelation {
  from: string;
  to: string;
  type: 'depends_on' | 'related_to' | 'implements' | 'uses';
}

class MemoryService {
  private entities: Map<string, MemoryEntity> = new Map();
  private relations: MemoryRelation[] = [];

  async addEntity(entity: Omit<MemoryEntity, 'id' | 'createdAt'>): Promise<MemoryEntity> {
    const entityWithMeta = {
      ...entity,
      id: `entity-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      createdAt: Date.now(),
    };
    this.entities.set(entityWithMeta.id, entityWithMeta);
    return entityWithMeta;
  }

  async addRelation(relation: MemoryRelation): Promise<void> {
    this.relations.push(relation);
  }

  async search(query: string, limit: number = 10): Promise<MemoryEntity[]> {
    // Simple text search - enhance with vector search
    return Array.from(this.entities.values())
      .filter(e => e.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
  }

  async getRelated(entityId: string): Promise<MemoryEntity[]> {
    const relatedIds = this.relations
      .filter(r => r.from === entityId || r.to === entityId)
      .map(r => r.from === entityId ? r.to : r.from);
    
    return relatedIds
      .map(id => this.entities.get(id))
      .filter((e): e is MemoryEntity => e !== undefined);
  }
}

const memoryService = new MemoryService();
// ... HTTP server setup
```

---

### 7. **Human-in-the-Loop (HITL) Workflow** 🔶

**Architecture Reference**: Section on approval workflows

**Status**: Basic HITL exists but needs worker integration

**Enhancement**: Add HITL endpoints to planner worker:

```typescript
// Add to planner-worker/index.ts

interface HITLApproval {
  taskId: string;
  type: 'file_write' | 'command_exec' | 'api_call';
  details: any;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: number;
  respondedAt?: number;
  responderId?: string;
}

class PlannerService {
  private pendingApprovals: Map<string, HITLApproval> = new Map();

  async requestApproval(taskId: string, type: HITLApproval['type'], details: any): Promise<string> {
    const approvalId = `approval-${Date.now()}`;
    const approval: HITLApproval = {
      taskId,
      type,
      details,
      status: 'pending',
      requestedAt: Date.now(),
    };
    this.pendingApprovals.set(approvalId, approval);
    
    // Notify via Redis PubSub
    if (this.redisClient) {
      await this.redisClient.publish('hitl:approvals', JSON.stringify(approval));
    }
    
    return approvalId;
  }

  async respondToApproval(approvalId: string, approved: boolean, responderId: string): Promise<void> {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) throw new Error('Approval not found');
    
    approval.status = approved ? 'approved' : 'rejected';
    approval.respondedAt = Date.now();
    approval.responderId = responderId;
    
    // Notify waiting task via Redis
    if (this.redisClient) {
      await this.redisClient.publish(`hitl:response:${approvalId}`, JSON.stringify({ approved }));
    }
  }

  async waitForApproval(approvalId: string, timeoutMs: number = 300000): Promise<boolean> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        const approval = this.pendingApprovals.get(approvalId);
        if (!approval) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }
        if (approval.status === 'approved') {
          clearInterval(checkInterval);
          resolve(true);
        } else if (approval.status === 'rejected') {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 1000);

      // Timeout
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, timeoutMs);
    });
  }
}
```

---

### 8. **Observability Integration** 🔶

**Architecture Reference**: Section 15 - OpenTelemetry, Langfuse, Helicone

**Status**: Not implemented

**Add to env.example** (already partially there):
```bash
# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=bing-agent
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production

# Langfuse
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# Helicone
HELICONE_API_KEY=sk-helicone-...
HELICONE_CACHE_ENABLED=true
```

**Create observability wrapper**:
```typescript
// lib/observability/index.ts
import { trace, context, propagation } from '@opentelemetry/api';

export const tracer = trace.getTracer('bing-agent');

export async function traceAsync<T>(
  name: string,
  fn: (span: any) => Promise<T>,
  attributes?: Record<string, string>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }
      const result = await fn(span);
      span.setStatus({ code: 2 }); // OK
      return result;
    } catch (error: any) {
      span.setStatus({ code: 4, message: error.message }); // ERROR
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

---

### 9. **Task Priority Queue** 🔶

**Issue**: No priority handling for urgent tasks

**Add to planner-worker**:
```typescript
interface TaskWithPriority extends Task {
  priority: 'critical' | 'high' | 'normal' | 'low';
  scheduledAt?: number;
}

class TaskQueue {
  private queues: Record<string, TaskWithPriority[]> = {
    critical: [],
    high: [],
    normal: [],
    low: [],
  };

  enqueue(task: TaskWithPriority): void {
    const priority = task.priority || 'normal';
    this.queues[priority].push(task);
  }

  dequeue(): TaskWithPriority | null {
    // Process by priority order
    for (const priority of ['critical', 'high', 'normal', 'low']) {
      if (this.queues[priority].length > 0) {
        return this.queues[priority].shift()!;
      }
    }
    return null;
  }

  // Add delayed task support
  schedule(task: TaskWithPriority, delayMs: number): void {
    task.scheduledAt = Date.now() + delayMs;
    setTimeout(() => {
      delete task.scheduledAt;
      this.enqueue(task);
    }, delayMs);
  }
}
```

---

### 10. **Service Discovery** 🔶

**Issue**: Services hardcode URLs instead of using service discovery

**Add Redis-based service discovery**:
```typescript
// lib/service-discovery/index.ts
import Redis from 'ioredis';

class ServiceDiscovery {
  private redis: Redis;
  private serviceCache: Map<string, { url: string; healthy: boolean; lastSeen: number }> = new Map();

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.startHealthCheck();
  }

  async register(serviceName: string, url: string, ttlSeconds: number = 30): Promise<void> {
    const key = `service:${serviceName}`;
    await this.redis.set(key, url, 'EX', ttlSeconds);
    
    // Also add to service set for discovery
    await this.redis.sadd('services:all', serviceName);
  }

  async discover(serviceName: string): Promise<string | null> {
    // Check cache first
    const cached = this.serviceCache.get(serviceName);
    if (cached && cached.healthy && Date.now() - cached.lastSeen < 10000) {
      return cached.url;
    }

    // Query Redis
    const url = await this.redis.get(`service:${serviceName}`);
    if (url) {
      this.serviceCache.set(serviceName, {
        url,
        healthy: true,
        lastSeen: Date.now(),
      });
      return url;
    }

    return null;
  }

  private startHealthCheck(): void {
    setInterval(async () => {
      const services = await this.redis.smembers('services:all');
      for (const service of services) {
        const url = await this.redis.get(`service:${service}`);
        if (!url) {
          this.serviceCache.delete(service);
          continue;
        }

        // Check health endpoint
        try {
          const response = await fetch(`${url}/health`);
          this.serviceCache.set(service, {
            url,
            healthy: response.ok,
            lastSeen: Date.now(),
          });
        } catch {
          this.serviceCache.set(service, {
            url,
            healthy: false,
            lastSeen: Date.now(),
          });
        }
      }
    }, 5000);
  }
}
```

---

## Testing Checklist

### Unit Tests Needed

```typescript
// __tests__/sandbox-pool.test.ts
describe('SandboxPool', () => {
  it('should pre-warm sandboxes on initialization');
  it('should acquire sandbox from pool');
  it('should release sandbox back to pool');
  it('should handle idle timeout');
  it('should monitor resources');
});

// __tests__/planner-worker.test.ts
describe('PlannerWorker', () => {
  it('should decompose prompt into tasks');
  it('should handle task dependencies');
  it('should assign execution policies');
  it('should track task progress');
});

// __tests__/background-worker.test.ts
describe('BackgroundWorker', () => {
  it('should index workspace files');
  it('should watch for file changes');
  it('should search code with vectors');
  it('should handle Qdrant fallback');
});
```

---

## Documentation Updates Needed

1. **Add API documentation** for new services (OpenAPI/Swagger)
2. **Create runbook** for production deployment
3. **Add monitoring dashboard** configuration (Grafana/Datadog)
4. **Document scaling strategy** for each service
5. **Create troubleshooting guide** for common issues

---

## Priority Order

### Critical (Before Production)
1. ✅ Fix Redis import compatibility
2. ✅ Add missing package dependencies
3. ✅ Create Dockerfile.agent and Dockerfile.mcp
4. ⚠️ Implement git tools

### High Priority
5. ⚠️ Add memory service
6. ⚠️ Implement HITL workflow
7. ⚠️ Add service discovery

### Medium Priority
8. 🔶 Observability integration
9. 🔶 Task priority queue
10. 🔶 Comprehensive testing

---

## Summary

**Implemented**: ✅
- Service entry points (sandbox-pool, planner-worker, background-worker)
- Execution policies
- Docker Compose configuration
- Environment variables

**Needs Fixes**: ⚠️
- Redis import (use ioredis)
- Git tools missing
- Package dependencies
- Dockerfiles

**Missing Features**: 🔶
- Memory service
- Enhanced HITL
- Observability
- Priority queue
- Service discovery

**Total Completion**: ~70%
