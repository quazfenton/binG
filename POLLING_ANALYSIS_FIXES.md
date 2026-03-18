# Excessive Polling & Endpoint Call Analysis

## Summary

Analysis of the logs reveals **severe polling issues** with the VFS (Virtual File System) endpoints, particularly:
- `/api/filesystem/list` - 7+ requests in ~1.4 seconds
- `/api/filesystem/snapshot` - 7+ requests in ~1.4 seconds
- `/api/providers` - 6 rapid consecutive calls

**Root causes identified:**
1. Multiple components independently polling without coordination
2. Inefficient cache invalidation causing cache stampedes
3. Event-driven refresh schedulers triggering redundant calls
4. No debouncing/throttling on initial component mounts
5. Heavy snapshot operations being called too frequently

---

## Issues Identified

### 🔴 CRITICAL: `/api/filesystem/snapshot` Endpoint

**Location:** `app/api/filesystem/snapshot/route.ts`

**Problems:**

1. **No caching on server-side** - Every request calls `virtualFilesystem.exportWorkspace()` which is expensive (899ms in logs)
2. **Polling detection is passive** - Only logs warnings, doesn't prevent the polling
3. **Client-side cache TTL too short** (5 seconds) in `use-virtual-filesystem.ts`
4. **Multiple components calling simultaneously:**
   - `TerminalPanel.tsx` - line 214, 378
   - `CodePreviewPanel.tsx` - line 1122, 1211, 1679
   - `experimental-workspace-panel.tsx` - line 344

**Log Evidence:**
```
[VFS SNAPSHOT WARN] POLLING DETECTED: 7 requests in 1388ms for path "project"
[VFS SNAPSHOT WARN] [7qqbcd] SLOW OPERATION: exportWorkspace took 899ms for "project"
GET /api/filesystem/snapshot?path=project 200 in 1292ms
```

---

### 🔴 CRITICAL: `/api/filesystem/list` Endpoint

**Location:** `app/api/filesystem/list/route.ts`

**Problems:**

1. **Same polling detection issue** - Logs but doesn't prevent
2. **Multiple components calling:**
   - `interaction-panel.tsx` - lines 902, 1899, 1909, 1944
   - `experimental-workspace-panel.tsx` - lines 734, 756
3. **Called on every navigation/folder expansion** without debouncing

**Log Evidence:**
```
[VFS LIST WARN] POLLING DETECTED: 7 requests in 1386ms for path "project"
[VFS LIST WARN] [0onj6e] SLOW OPERATION: listDirectory took 958ms for "project"
GET /api/filesystem/list?path=project 200 in 1282ms
```

---

### 🟡 HIGH: `/api/providers` Endpoint

**Problems:**

1. **6 consecutive calls in rapid succession** (11-17ms each after first 1735ms compile)
2. **Likely multiple components fetching provider list independently**
3. **No shared cache between components**

**Log Evidence:**
```
GET /api/providers 200 in 1735ms (compile: 1715ms, proxy.ts: 15ms, render: 5ms)
GET /api/providers 200 in 14ms
GET /api/providers 200 in 18ms
GET /api/providers 200 in 14ms
GET /api/providers 200 in 11ms
GET /api/providers 200 in 11ms
GET /api/providers 200 in 11ms
```

---

### 🟡 HIGH: `use-virtual-filesystem.ts` Hook

**Location:** `hooks/use-virtual-filesystem.ts`

**Problems:**

1. **Cache TTL too aggressive** (5 seconds - line 91)
   ```typescript
   const SNAPSHOT_CACHE_TTL_MS = 5000; // 5 seconds cache TTL
   ```

2. **Cache invalidation too broad** - `invalidateSnapshotCache()` called on every write/delete clears ALL caches

3. **No request deduplication** - Multiple simultaneous calls to `getSnapshot()` all trigger API requests

4. **No exponential backoff** for polling scenarios

---

### 🟡 HIGH: `TerminalPanel.tsx`

**Location:** `components/terminal/TerminalPanel.tsx`

**Problems:**

1. **Multiple useEffect hooks calling snapshot** without coordination:
   - Line 204-319: Initial sync on mount
   - Line 431-457: Event-driven refresh via `createRefreshScheduler`

2. **Refresh scheduler configured with 1-3 second intervals** (line 449):
   ```typescript
   const scheduler = createRefreshScheduler(refresh, { minIntervalMs: 1000, maxDelayMs: 3000 });
   ```

3. **No memoization of refresh function** causing re-subscription on every render

---

### 🟡 HIGH: `CodePreviewPanel.tsx`

**Location:** `components/code-preview-panel.tsx`

**Problems:**

1. **Same refresh scheduler issue** (line 1278):
   ```typescript
   const scheduler = createRefreshScheduler(refresh, { minIntervalMs: 1000, maxDelayMs: 3000 });
   ```

2. **Multiple snapshot calls in different useEffects:**
   - Line 1122: Initial load
   - Line 1211: Manual preview refresh
   - Line 1679: Additional refresh

3. **No coordination with TerminalPanel** - both poll independently

---

### 🟡 MEDIUM: `createRefreshScheduler`

**Location:** `lib/virtual-filesystem/refresh-scheduler.ts`

**Problems:**

1. **Min interval of 1000ms is too aggressive** for expensive operations like snapshots
2. **No maximum retry limit** - can schedule indefinitely
3. **No awareness of other schedulers** - multiple instances can run simultaneously

---

### 🟡 MEDIUM: `conversation-interface.tsx`

**Location:** `components/conversation-interface.tsx`

**Problems:**

1. **15-second interval polling** (line 1180):
   ```typescript
   const interval = setInterval(() => {
     scheduleAttachmentRefresh('interval');
   }, 15000);
   ```

2. **Polling diffs system** that triggers toast notifications (line 387)

---

## Recommended Fixes

### 1. **Server-Side Caching** (CRITICAL)

**File:** `app/api/filesystem/snapshot/route.ts`

```typescript
// Add LRU cache with proper invalidation
const snapshotCache = new Map<string, {
  data: any;
  timestamp: number;
  etag: string;
}>();

const CACHE_TTL_MS = 30000; // 30 seconds instead of 5

export async function GET(req: NextRequest) {
  const cacheKey = `${owner.ownerId}:${pathFilter}`;
  const cached = snapshotCache.get(cacheKey);
  
  // Return cached response if fresh
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    // Check If-None-Match header for conditional request
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch === cached.etag) {
      return new NextResponse(null, { status: 304 });
    }
    
    return NextResponse.json({
      success: true,
      data: cached.data,
      cached: true,
    });
  }
  
  // Generate new snapshot
  const snapshot = await virtualFilesystem.exportWorkspace(owner.ownerId);
  // ... rest of logic
  
  // Cache with ETag
  const etag = `"${snapshot.version}-${snapshot.updatedAt}"`;
  snapshotCache.set(cacheKey, {
    data: { /* ... */ },
    timestamp: Date.now(),
    etag,
  });
  
  response.headers.set('etag', etag);
  response.headers.set('cache-control', 'public, max-age=30');
}
```

---

### 2. **Client-Side Request Deduplication** (CRITICAL)

**File:** `hooks/use-virtual-filesystem.ts`

```typescript
// Track in-flight requests
const inFlightRequests = useRef<Map<string, Promise<any>>>(new Map());

const getSnapshot = useCallback(async (pathForSnapshot?: string) => {
  const targetPath = pathForSnapshot || currentPathRef.current;
  const ownerId = getOrCreateAnonymousSessionId();
  const cacheKey = `${ownerId}:${targetPath}`;

  // Check shared cache first
  const cached = getCachedSnapshot(targetPath, ownerId);
  if (cached) {
    return cached.snapshot;
  }

  // Check if request is already in-flight
  const existingRequest = inFlightRequests.current.get(cacheKey);
  if (existingRequest) {
    vfsLogger.log(`getSnapshot: joining in-flight request for "${targetPath}"`);
    return existingRequest;
  }

  vfsLogger.log(`getSnapshot: cache miss for "${targetPath}", fetching from API`);

  const requestPromise = request<{ /* ... */ }>(
    `/api/filesystem/snapshot?path=${encodeURIComponent(targetPath)}`,
    { method: 'GET', includeJsonContentType: false },
  )
    .then((data) => {
      setCachedSnapshot(targetPath, ownerId, data);
      return data;
    })
    .finally(() => {
      inFlightRequests.current.delete(cacheKey);
    });

  inFlightRequests.current.set(cacheKey, requestPromise);
  return requestPromise;
}, [request]);
```

---

### 3. **Increase Cache TTLs** (HIGH)

**File:** `hooks/use-virtual-filesystem.ts`

```typescript
// Increase cache TTL based on operation type
const SNAPSHOT_CACHE_TTL_MS = 30000; // 30 seconds for snapshots
const LIST_CACHE_TTL_MS = 10000;     // 10 seconds for directory listings
const SNAPSHOT_CACHE_MAX_ENTRIES = 50; // Increase max entries
```

---

### 4. **Add Debouncing to Component Mounts** (HIGH)

**File:** `components/terminal/TerminalPanel.tsx`, `components/code-preview-panel.tsx`

```typescript
// Add debounced initial load
useEffect(() => {
  if (!isOpen) return;
  
  const timeoutId = setTimeout(() => {
    syncVfsToLocal();
  }, 500); // 500ms debounce on mount
  
  return () => clearTimeout(timeoutId);
}, [isOpen]);
```

---

### 5. **Coordinate Between Components** (HIGH)

Create a shared VFS sync manager:

**File:** `lib/virtual-filesystem/vfs-sync-manager.ts` (NEW)

```typescript
import { EventEmitter } from 'events';

class VfsSyncManager extends EventEmitter {
  private static instance: VfsSyncManager;
  private subscribers = new Map<string, Set<() => void>>();
  private lastSyncTime = new Map<string, number>();
  private syncInProgress = new Map<string, boolean>();
  
  private constructor() {
    super();
  }
  
  static getInstance(): VfsSyncManager {
    if (!VfsSyncManager.instance) {
      VfsSyncManager.instance = new VfsSyncManager();
    }
    return VfsSyncManager.instance;
  }
  
  async requestSync(
    path: string,
    syncFn: () => Promise<void>,
    options: { minIntervalMs?: number; priority?: 'low' | 'normal' | 'high' } = {}
  ): Promise<void> {
    const { minIntervalMs = 5000, priority = 'normal' } = options;
    const now = Date.now();
    const lastSync = this.lastSyncTime.get(path) || 0;
    
    // Skip if synced recently (unless high priority)
    if (priority !== 'high' && now - lastSync < minIntervalMs) {
      return;
    }
    
    // Skip if sync in progress
    if (this.syncInProgress.get(path)) {
      return new Promise((resolve) => {
        const onComplete = () => {
          this.off('sync-complete', onComplete);
          resolve();
        };
        this.on('sync-complete', onComplete);
      });
    }
    
    this.syncInProgress.set(path, true);
    
    try {
      await syncFn();
      this.lastSyncTime.set(path, Date.now());
      this.emit('sync-complete', { path, timestamp: Date.now() });
    } finally {
      this.syncInProgress.set(path, false);
    }
  }
  
  invalidate(path: string): void {
    this.lastSyncTime.delete(path);
    this.emit('invalidated', { path });
  }
}

export const vfsSyncManager = VfsSyncManager.getInstance();
```

---

### 6. **Fix Refresh Scheduler Configuration** (MEDIUM)

**File:** `components/terminal/TerminalPanel.tsx`, `components/code-preview-panel.tsx`

```typescript
// Increase intervals for expensive operations
const scheduler = createRefreshScheduler(refresh, { 
  minIntervalMs: 5000,  // Was 1000ms
  maxDelayMs: 10000,    // Was 3000ms
});
```

---

### 7. **Add HTTP Conditional Requests** (MEDIUM)

**File:** `hooks/use-virtual-filesystem.ts`

```typescript
const getSnapshot = useCallback(async (pathForSnapshot?: string) => {
  // ... existing cache logic ...
  
  const cached = getCachedSnapshot(targetPath, ownerId);
  const headers: HeadersInit = {};
  
  if (cached?.snapshot) {
    headers['if-none-match'] = `"${cached.snapshot.version}"`;
    headers['if-modified-since'] = cached.snapshot.updatedAt;
  }
  
  const data = await request(..., { 
    method: 'GET', 
    headers,
    includeJsonContentType: false 
  });
  
  return data;
}, [request]);
```

---

### 8. **Consolidate /api/providers Calls** (MEDIUM)

**File:** Create shared provider cache

```typescript
// lib/providers/provider-cache.ts
const providerCache = {
  data: null as any,
  promise: null as Promise<any> | null,
  timestamp: 0,
  TTL_MS: 60000, // 1 minute
};

export async function getProviders(): Promise<any> {
  const now = Date.now();
  
  // Return cached if fresh
  if (providerCache.data && now - providerCache.timestamp < providerCache.TTL_MS) {
    return providerCache.data;
  }
  
  // Return in-flight promise if exists
  if (providerCache.promise) {
    return providerCache.promise;
  }
  
  providerCache.promise = fetch('/api/providers')
    .then(res => res.json())
    .then(data => {
      providerCache.data = data;
      providerCache.timestamp = now;
      return data;
    })
    .finally(() => {
      providerCache.promise = null;
    });
    
  return providerCache.promise;
}
```

---

## Priority Order

1. **Server-side caching** for `/api/filesystem/snapshot` - Reduces 899ms operations
2. **Request deduplication** in `use-virtual-filesystem.ts` - Prevents stampedes
3. **Increase cache TTLs** - Reduces frequency of calls
4. **Component coordination** via VFS sync manager - Eliminates redundant polling
5. **Debouncing on mounts** - Prevents initial flood of requests
6. **Refresh scheduler tuning** - Reduces event-driven polling
7. **HTTP conditional requests** - Enables 304 Not Modified responses
8. **Provider cache consolidation** - Stops /api/providers spam

---

## Expected Impact

| Fix | Estimated Reduction |
|-----|---------------------|
| Server-side caching | 70-80% fewer snapshot API calls |
| Request deduplication | 50-60% fewer concurrent calls |
| Increased cache TTLs | 40-50% fewer total calls |
| Component coordination | 60-70% fewer redundant calls |
| **Combined** | **90-95% reduction** in VFS endpoint calls |

---

## Testing Recommendations

1. **Load testing** with multiple tabs/components open
2. **Network tab monitoring** for duplicate requests
3. **Performance profiling** of snapshot operations
4. **Cache hit rate monitoring** after deployment
