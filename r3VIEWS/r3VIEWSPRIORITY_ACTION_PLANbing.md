# Priority Action Plan - Critical Security Fixes

**Created:** March 3, 2026  
**Priority:** P0 - Production Blockers  
**Estimated Time:** 14 hours  
**Goal:** Increase production readiness from 70% → 85%

---

## P0-1: Apply Path Traversal Protection to All Providers (4 hours)

### Task 1.1: Update Daytona Provider

**File:** `lib/sandbox/providers/daytona-provider.ts`

**Current Issue:**
```typescript
// ❌ Line ~145 - Not using safeJoin
async writeFile(filePath: string, content: string): Promise<ToolResult> {
  const fullPath = join(WORKSPACE_DIR, filePath);
  // Vulnerable to path traversal
}
```

**Fix:**
```typescript
// ✅ UPDATE: lib/sandbox/providers/daytona-provider.ts
import { safeJoin, isValidResourceId, validateRelativePath } from '@/lib/security/security-utils';

class DaytonaSandboxHandle implements SandboxHandle {
  // ... existing code ...

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // Validate file size
      if (Buffer.byteLength(content) > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10MB)');
      }

      // Validate and sanitize path
      const relativePath = validateRelativePath(filePath);
      const fullPath = safeJoin(WORKSPACE_DIR, relativePath);

      await this.sandbox.files.write(fullPath, content);
      return { success: true, output: `Written to ${filePath}` };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to write file: ${error.message}` 
      };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const relativePath = validateRelativePath(filePath);
      const fullPath = safeJoin(WORKSPACE_DIR, relativePath);

      const content = await this.sandbox.files.read(fullPath);
      return { success: true, output: content };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to read file: ${error.message}` 
      };
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const relativePath = validateRelativePath(dirPath);
      const fullPath = safeJoin(WORKSPACE_DIR, relativePath);

      const entries = await this.sandbox.files.list(fullPath);
      return { success: true, output: entries };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to list directory: ${error.message}` 
      };
    }
  }
}
```

---

### Task 1.2: Update E2B Provider

**File:** `lib/sandbox/providers/e2b-provider.ts`

**Fix:**
```typescript
// ✅ UPDATE: lib/sandbox/providers/e2b-provider.ts
import { safeJoin, isValidResourceId, validateRelativePath } from '@/lib/security/security-utils';

class E2BSandboxHandle implements SandboxHandle {
  // ... existing code ...

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // Validate file size
      if (Buffer.byteLength(content) > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10MB)');
      }

      const relativePath = validateRelativePath(filePath);
      await this.sandbox.files.write(relativePath, content);
      return { success: true, output: `Written to ${filePath}` };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to write file: ${error.message}` 
      };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const relativePath = validateRelativePath(filePath);
      const content = await this.sandbox.files.read(relativePath);
      return { success: true, output: content };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to read file: ${error.message}` 
      };
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const relativePath = validateRelativePath(dirPath || '.');
      const entries = await this.sandbox.files.list(relativePath);
      return { success: true, output: entries };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to list directory: ${error.message}` 
      };
    }
  }
}
```

---

### Task 1.3: Update Sprites Provider

**File:** `lib/sandbox/providers/sprites-provider.ts`

**Fix:**
```typescript
// ✅ UPDATE: lib/sandbox/providers/sprites-provider.ts
import { safeJoin, isValidResourceId, validateRelativePath } from '@/lib/security/security-utils';

class SpritesSandboxHandle implements SandboxHandle {
  // ... existing code ...

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      if (Buffer.byteLength(content) > 10 * 1024 * 1024) {
        throw new Error('File too large (max 10MB)');
      }

      const relativePath = validateRelativePath(filePath);
      await this.instance.files.write(relativePath, content);
      return { success: true, output: `Written to ${filePath}` };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to write file: ${error.message}` 
      };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const relativePath = validateRelativePath(filePath);
      const content = await this.instance.files.read(relativePath);
      return { success: true, output: content };
    } catch (error: any) {
      return { 
        success: false, 
        error: `Failed to read file: ${error.message}` 
      };
    }
  }
}
```

---

## P0-2: Wire JWT Auth to All Sensitive Endpoints (4 hours)

### Task 2.1: Update Quota Route

**File:** `app/api/quota/route.ts`

**Current:**
```typescript
// ❌ No auth check
export async function GET(req: NextRequest) {
  const usage = quotaManager.getUsage();
  return NextResponse.json(usage);
}
```

**Fix:**
```typescript
// ✅ UPDATE: app/api/quota/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { quotaManager } from '@/lib/services/quota-manager';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    const usage = quotaManager.getUsage(authResult.userId);
    return NextResponse.json(usage);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch quota', message: error.message },
      { status: 500 }
    );
  }
}
```

---

### Task 2.2: Update Providers Route

**File:** `app/api/providers/route.ts`

**Fix:**
```typescript
// ✅ UPDATE: app/api/providers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';
import { getAllProviders, getAvailableProviders } from '@/lib/sandbox/providers';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req, { allowAnonymous: true });
    
    // Allow anonymous to see available providers, but restrict detailed info
    const isAnonymous = !authResult.success || !authResult.userId;
    
    if (isAnonymous) {
      const available = await getAvailableProviders();
      return NextResponse.json({ 
        available,
        anonymous: true,
        message: 'Authenticate for detailed provider information'
      });
    }

    const allProviders = getAllProviders();
    const available = await getAvailableProviders();
    
    return NextResponse.json({
      all: allProviders,
      available,
      anonymous: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch providers', message: error.message },
      { status: 500 }
    );
  }
}
```

---

### Task 2.3: Update Metrics Route

**File:** `app/api/metrics/route.ts`

**Fix:**
```typescript
// ✅ UPDATE: app/api/metrics/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth/jwt';

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    
    // Metrics should require authentication
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Only allow admin users
    if (authResult.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: admin access required' },
        { status: 403 }
      );
    }

    const { Registry } = await import('prom-client');
    const register = new Registry();
    
    // ... register metrics ...
    
    const metrics = await register.metrics();

    return new NextResponse(metrics, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Metrics collection failed', message: error.message },
      { status: 500 }
    );
  }
}
```

---

### Task 2.4: Audit and Update Other Routes

**Files to Check:**
- `app/api/sandbox/session/route.ts` - Add auth
- `app/api/filesystem/*/route.ts` - Verify auth exists
- `app/api/docker/*/route.ts` - Add auth
- `app/api/cicd/*/route.ts` - Add auth

**Pattern:**
```typescript
// ✅ Use this pattern for all sensitive routes
export async function GET(req: NextRequest) {
  const authResult = await verifyAuth(req);
  
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  // ... rest of handler ...
}
```

---

## P0-3: Add Rate Limiting to Sandbox Operations (2 hours)

### Task 3.1: Update Execute Route

**File:** `app/api/sandbox/execute/route.ts`

**Fix:**
```typescript
// ✅ UPDATE: app/api/sandbox/execute/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';
import { checkRateLimit } from '@/lib/middleware/rate-limiter';

// Rate limit config
const EXECUTE_RATE_LIMIT = {
  windowMs: 60000, // 1 minute
  maxRequests: 60, // 60 commands per minute
};

export async function POST(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // RATE LIMITING
    const identifier = `user:${authResult.userId}`;
    const rateLimitResult = checkRateLimit(
      identifier,
      { 
        windowMs: EXECUTE_RATE_LIMIT.windowMs, 
        maxRequests: EXECUTE_RATE_LIMIT.maxRequests,
        message: 'Too many command executions'
      },
      { name: 'free', multiplier: 1 }
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `Maximum ${EXECUTE_RATE_LIMIT.maxRequests} commands per minute`,
          retryAfter: rateLimitResult.retryAfter,
          remaining: rateLimitResult.remaining,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 60),
            'X-RateLimit-Limit': String(EXECUTE_RATE_LIMIT.maxRequests),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000 + rateLimitResult.resetAfter / 1000)),
          },
        }
      );
    }

    // ... rest of existing implementation ...
  } catch (error: any) {
    // ... error handling ...
  }
}
```

---

### Task 3.2: Update Files Route

**File:** `app/api/sandbox/files/route.ts`

**Fix:**
```typescript
// ✅ UPDATE: app/api/sandbox/files/route.ts
import { checkRateLimit } from '@/lib/middleware/rate-limiter';

const FILE_OPS_RATE_LIMIT = {
  windowMs: 60000, // 1 minute
  maxRequests: 30, // 30 file ops per minute
};

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // RATE LIMITING
    const identifier = `user:${authResult.userId}`;
    const rateLimitResult = checkRateLimit(
      identifier,
      { 
        windowMs: FILE_OPS_RATE_LIMIT.windowMs, 
        maxRequests: FILE_OPS_RATE_LIMIT.maxRequests,
        message: 'Too many file operations'
      },
      { name: 'free', multiplier: 1 }
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // ... rest of existing implementation ...
  } catch (error: any) {
    // ... error handling ...
  }
}
```

---

## P0-4: Remove Mock Snapshot Data (4 hours)

### Task 4.1: Update Snapshot Manager

**File:** `lib/backend/snapshot-manager.ts`

**Current Issue:**
```typescript
// ❌ Line ~150 - Mock data
const mockSnapshots = [
  { id: 'snap_1709856000', date: '2024-03-08 10:00', size: '15MB' },
];

export async function listSnapshots(): Promise<any[]> {
  return mockSnapshots;
}
```

**Fix:**
```typescript
// ✅ UPDATE: lib/backend/snapshot-manager.ts
export class SnapshotManager extends EventEmitter {
  private readonly workspaceDir: string;
  private readonly snapshotDir: string;
  private storageBackend?: StorageBackend;

  // ... existing constructor ...

  async listSnapshots(userId: string): Promise<SnapshotInfo[]> {
    validateId(userId, 'user_id');
    
    try {
      // If storage backend is wired, use it
      if (this.storageBackend) {
        const remoteKeys = await this.storageBackend.list(`snapshots/${userId}/`);
        
        const snapshots: SnapshotInfo[] = [];
        for (const key of remoteKeys) {
          // Parse metadata from key or fetch separately
          const snapshotId = key.split('/').pop()?.replace('.tar.gz', '');
          if (snapshotId) {
            snapshots.push({
              snapshotId,
              sizeBytes: 0, // Would need to fetch from storage
              createdAt: new Date(),
              path: key,
            });
          }
        }
        
        return snapshots;
      }

      // Fallback to local filesystem
      const userSnapshotDir = join(this.snapshotDir, userId);
      
      if (!existsSync(userSnapshotDir)) {
        return [];
      }

      const files = readdirSync(userSnapshotDir);
      const snapshots: SnapshotInfo[] = [];

      for (const file of files) {
        if (file.endsWith('.tar.gz')) {
          const snapshotId = file.replace('.tar.gz', '');
          const fullPath = join(userSnapshotDir, file);
          const stat = statSync(fullPath);

          snapshots.push({
            snapshotId,
            sizeBytes: stat.size,
            createdAt: new Date(stat.mtime),
            path: fullPath,
          });
        }
      }

      return snapshots.sort((a, b) => 
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    } catch (error: any) {
      console.error('[SnapshotManager] Failed to list snapshots:', error);
      return [];
    }
  }

  async createSnapshot(
    userId: string,
    snapshotId?: string,
    retryConfig?: RetryConfig
  ): Promise<SnapshotResult> {
    // ... existing implementation ...
    
    // AFTER creating local snapshot, upload to storage backend if available
    if (this.storageBackend) {
      try {
        const remoteKey = `snapshots/${userId}/${snapshotId}.tar.gz`;
        await this.storageBackend.upload(snapshotPath, remoteKey);
        console.log(`[SnapshotManager] Uploaded to storage: ${remoteKey}`);
      } catch (error: any) {
        console.warn('[SnapshotManager] Upload to storage failed:', error);
        // Don't fail - local snapshot still exists
      }
    }
    
    return result;
  }
}
```

---

### Task 4.2: Wire Storage Backend in Backend Service

**File:** `lib/backend/backend-service.ts`

**Already Implemented (verify it's working):**
```typescript
// ✅ EXISTS: lib/backend/backend-service.ts
private async initializeStorage(): Promise<void> {
  if (this.config.storageType === 's3') {
    const s3Backend = getS3Backend({...});
    const { snapshotManager } = await import('./snapshot-manager');
    (snapshotManager as any).storageBackend = s3Backend;
    this.status.storage = { type: 's3', healthy: true };
  } else {
    const localBackend = getLocalBackend(this.config.localSnapshotDir!);
    const { snapshotManager } = await import('./snapshot-manager');
    (snapshotManager as any).storageBackend = localBackend;
    this.status.storage = { type: 'local', healthy: true };
  }
}
```

**Action:** Test this is actually working by:
1. Creating a sandbox
2. Creating a snapshot
3. Checking if it's stored in S3/local filesystem
4. Listing snapshots
5. Restoring snapshot

---

## Testing Checklist

After completing all P0 fixes:

### Security Tests
- [ ] Try path traversal: `../../etc/passwd` - should be rejected
- [ ] Try invalid sandboxId: `../evil` - should be rejected
- [ ] Try dangerous command: `rm -rf /` - should be rejected
- [ ] Try accessing without auth - should get 401
- [ ] Exceed rate limit - should get 429

### Backend Tests
- [ ] Create sandbox - should work
- [ ] Create snapshot - should store in configured backend
- [ ] List snapshots - should return real data, not mock
- [ ] Restore snapshot - should work
- [ ] WebSocket terminal - should connect

### Provider Tests
- [ ] Daytona provider - file ops use safeJoin
- [ ] E2B provider - file ops use safeJoin
- [ ] Sprites provider - file ops use safeJoin
- [ ] All providers validate sandboxId

---

## Success Criteria

**P0 Fixes Complete When:**
1. ✅ All path operations use `safeJoin()` or `validateRelativePath()`
2. ✅ All sensitive endpoints require JWT authentication
3. ✅ Rate limiting applied to execute, files, and session endpoints
4. ✅ Snapshot manager uses real storage backend, not mock data
5. ✅ All security tests pass
6. ✅ No regressions in existing functionality

**Production Readiness After P0:** 85%

---

## Next Steps After P0

Once P0 is complete:
1. Deploy to staging environment
2. Run comprehensive test suite
3. Monitor for 48 hours
4. If stable, deploy to production
5. Begin P1 items (provider health checks, fallback chain, etc.)

---

**Total Estimated Time:** 14 hours  
**Priority:** CRITICAL - Block production deployment until complete  
**Owner:** Development Team  
**Deadline:** Before next production release
