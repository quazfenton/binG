---
id: filesystem-hooks-and-services-analysis
title: Filesystem Hooks & Services Analysis
aliases:
  - filesystem-hooks-analysis
  - filesystem-hooks-analysis.md
  - filesystem-hooks-and-services-analysis
  - filesystem-hooks-and-services-analysis.md
tags: []
layer: core
summary: "# Filesystem Hooks & Services Analysis\r\n\r\n## Executive Summary\r\n\r\nAnalysis of three related filesystem modules:\r\n1. `hooks/use-virtual-filesystem.ts` - VFS state management\r\n2. `hooks/use-filesystem-operations.ts` - File operations (orphaned)\r\n3. `lib/virtual-filesystem/filesystem-edit-session-servi"
anchors:
  - Executive Summary
  - 1. Hook Comparison
  - '`use-virtual-filesystem.ts` ✅ Active'
  - '`use-filesystem-operations.ts` ⚠️ Orphaned'
  - Integration Plan
  - 2. Filesystem Edit Session Service Review
  - Architecture
  - Usage Flow
  - Integration Points
  - Code Quality Assessment
  - ✅ Strengths
  - ⚠️ Issues Found
  - Recommended Improvements
  - 3. Action Items
  - High Priority
  - Medium Priority
  - Low Priority
  - 4. Module Relationships
  - 5. Conclusion
---
# Filesystem Hooks & Services Analysis

## Executive Summary

Analysis of three related filesystem modules:
1. `hooks/use-virtual-filesystem.ts` - VFS state management
2. `hooks/use-filesystem-operations.ts` - File operations (orphaned)
3. `lib/virtual-filesystem/filesystem-edit-session-service.ts` - AI edit transactions

---

## 1. Hook Comparison

### `use-virtual-filesystem.ts` ✅ Active

**Purpose:** Core VFS state management and caching layer

**Key Features:**
- Directory listing with caching (3s TTL)
- File read/write with OPFS integration
- Snapshot caching (5s TTL)
- Filesystem event subscription
- Sync status tracking
- Attached files management

**Used By:**
- `components/workspace-panel.tsx` (line 568)
- `components/code-preview-panel.tsx` (line 215)
- Other panels needing VFS access

**API Endpoints:**
- `GET /api/filesystem/list` - Directory listing
- `POST /api/filesystem/read` - Read file
- `POST /api/filesystem/write` - Write file

---

### `use-filesystem-operations.ts` ⚠️ Orphaned

**Purpose:** Windows Explorer-like file operations with conflict resolution

**Key Features:**
- Rename with conflict detection
- Move with confirmation dialogs
- Copy with overwrite protection
- Delete with confirmation
- Batch operations
- Pending conflict dialog state

**Used By:** **NOWHERE** - Not imported in any component

**API Endpoints:**
- `POST /api/filesystem/rename` - Rename file/folder
- `POST /api/filesystem/move` - Move file/folder
- `POST /api/filesystem/delete` - Delete file/folder
- `POST /api/filesystem/read` - Read (for copy operation)
- `POST /api/filesystem/write` - Write (for copy operation)

**Recommendation:** **Integrate into workspace-panel.tsx**

### Integration Plan

```typescript
// In workspace-panel.tsx
import { useFilesystemOperations } from '@/hooks/use-filesystem-operations';

export function WorkspacePanel() {
  const { listDirectory, nodes } = useVirtualFilesystem({ initialPath: '/workspace' });
  const { rename, move, copy, delete: deletePath, pendingConflict } = useFilesystemOperations();
  
  // Context menu handler
  const handleRename = async (oldPath: string) => {
    const newPath = prompt('New name:');
    if (newPath) {
      const result = await rename({ oldPath, newPath: newPath });
      if (result.success) {
        await listDirectory(currentPath); // Refresh
      }
    }
  };
  
  // Handle conflict dialog
  if (pendingConflict) {
    return (
      <ConflictDialog
        type={pendingConflict.type}
        sourcePath={pendingConflict.sourcePath}
        targetPath={pendingConflict.targetPath}
        onResolve={(overwrite) => resolveConflict(overwrite)}
      />
    );
  }
}
```

---

## 2. Filesystem Edit Session Service Review

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              FilesystemEditSessionService                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Transaction Lifecycle:                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │   Create     │ → │   Record     │ → │   Accept     │    │
│  │ Transaction  │   │ Operations   │   │  (Commit)    │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
│                            │                                 │
│                            ↓                                 │
│                     ┌──────────────┐                        │
│                     │    Deny      │                        │
│                     │  (Rollback)  │                        │
│                     └──────────────┘                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Storage Layers:                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │ In-Memory Map   │ ←→ │  SQLite (24h)   │                │
│  │ (fast access)   │    │ (crash recovery)│                │
│  └─────────────────┘    └─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### Usage Flow

```typescript
// 1. Create transaction (app/api/chat/route.ts:2709)
const transaction = filesystemEditSessionService.createTransaction({
  ownerId: userId,
  conversationId: 'conv_123',
  requestId: 'req_456',
});

// 2. Record operations (app/api/chat/route.ts:2763)
filesystemEditSessionService.recordOperation(transaction.id, {
  path: '/app/main.py',
  operation: 'write',
  newVersion: 5,
  previousVersion: 4,
  previousContent: originalContent,
  existedBefore: true,
});

// 3a. Accept (app/api/filesystem/edits/accept/route.ts:51)
const accepted = filesystemEditSessionService.acceptTransaction(txId);

// 3b. Deny (app/api/filesystem/edits/deny/route.ts:54)
const result = await filesystemEditSessionService.denyTransaction({
  transactionId: txId,
  reason: 'User rejected changes',
});
// result.conflicts = files modified during edit session
```

### Integration Points

| Module | Usage |
|--------|-------|
| `app/api/chat/route.ts` | Creates transactions for AI file edits |
| `app/api/filesystem/apply-refinement-edits/route.ts` | Auto-applies refinement edits |
| `app/api/filesystem/edits/accept/route.ts` | User accepts pending edits |
| `app/api/filesystem/edits/deny/route.ts` | User rejects pending edits |
| `__tests__/filesystem-persistence.test.ts` | 40+ tests for transaction lifecycle |

### Code Quality Assessment

#### ✅ Strengths

1. **Well-Structured** - Clear separation of concerns
2. **Persistence** - SQLite backup with graceful degradation
3. **Comprehensive Tracking** - Records all operations with before/after state
4. **Conflict Detection** - Identifies concurrent modifications
5. **Denial History** - Remembers rejected edits per conversation

#### ⚠️ Issues Found

**1. Missing Type Safety** (Lines 145-160)
```typescript
// BEFORE
const rows = stmt.all() as any[]; // ❌ Loses type safety

// AFTER
interface TransactionRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  request_id: string;
  created_at: string;
  status: string;
  operations_json: string;
  errors_json: string;
  denied_reason: string | null;
}
const rows = stmt.all() as TransactionRow[];
```

**2. No Memory Cleanup**
```typescript
// Issue: Old transactions never purged from Map
this.transactions.set(id, tx); // Grows indefinitely

// Fix: Add cleanup on accept/deny
acceptTransaction(transactionId: string) {
  const tx = this.transactions.get(transactionId);
  if (!tx) return { success: false };
  
  tx.status = 'accepted';
  this.persistTransaction(tx);
  
  // ✅ Clean up after 1 hour
  setTimeout(() => {
    this.transactions.delete(transactionId);
  }, 60 * 60 * 1000);
  
  return { success: true };
}
```

**3. Race Condition** (Concurrent accept/deny)
```typescript
// Issue: No locking mechanism
acceptTransaction(txId); // Thread 1
denyTransaction(txId);   // Thread 2 - both may succeed

// Fix: Add status check with atomic update
acceptTransaction(transactionId: string) {
  const tx = this.transactions.get(transactionId);
  if (!tx) return { success: false };
  
  // ✅ Prevent concurrent modifications
  if (tx.status !== 'auto_applied') {
    return { success: false, error: 'Transaction already finalized' };
  }
  
  tx.status = 'accepted';
  // ... rest of logic
}
```

**4. Missing Validation**
```typescript
// Issue: Doesn't verify transaction exists
recordOperation(transactionId, operation) {
  const tx = this.transactions.get(transactionId);
  // ❌ Continues even if tx is undefined
  
  // Fix: Add validation
  if (!tx) {
    throw new Error(`Transaction ${transactionId} not found`);
  }
  // ... rest of logic
}
```

### Recommended Improvements

```typescript
// Add to filesystem-edit-session-service.ts

/**
 * Cleanup old transactions (call periodically or on init)
 */
cleanupOldTransactions(maxAgeHours = 24): number {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  let cleaned = 0;
  
  for (const [id, tx] of this.transactions.entries()) {
    const txTime = new Date(tx.createdAt).getTime();
    if (txTime < cutoff) {
      this.transactions.delete(id);
      cleaned++;
    }
  }
  
  logger.info(`Cleaned up ${cleaned} old transactions`);
  return cleaned;
}

/**
 * Get transaction with validation
 */
getTransaction(transactionId: string): FilesystemEditTransaction | null {
  const tx = this.transactions.get(transactionId);
  if (!tx) {
    logger.warn(`Transaction not found: ${transactionId}`);
    return null;
  }
  return tx;
}

/**
 * Check if transaction can be modified
 */
private canModifyTransaction(tx: FilesystemEditTransaction): boolean {
  return tx.status === 'auto_applied';
}
```

---

## 3. Action Items

### High Priority

1. **Integrate `useFilesystemOperations` into workspace-panel**
   - Add to context menu handlers
   - Add conflict dialog UI component
   - Test rename/move/copy/delete flows

2. **Fix Edit Session Service Issues**
   - Add type safety to DB queries
   - Add memory cleanup mechanism
   - Add race condition protection
   - Add transaction validation

### Medium Priority

3. **Add Cleanup Cron** - Periodic transaction cleanup (hourly)
4. **Add Metrics** - Track accept/deny rates, conflict frequency
5. **Add Tests** - Test race conditions, cleanup, validation

### Low Priority

6. **UI Polish** - Better conflict dialog UX
7. **Documentation** - Add JSDoc comments to public methods

---

## 4. Module Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Hooks                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  use-virtual-filesystem.ts                                   │
│  ├─ Manages VFS state & caching                              │
│  ├─ Subscribes to filesystem-updated events                  │
│  └─ Used by: workspace-panel, code-preview-panel             │
│                                                              │
│  use-filesystem-operations.ts (ORPHANED)                     │
│  ├─ Provides rename/move/copy/delete operations              │
│  ├─ Handles conflict resolution dialogs                      │
│  └─ Should be used by: workspace-panel context menu          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    emitFilesystemUpdated()
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Backend Services                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  filesystem-edit-session-service.ts                          │
│  ├─ Tracks AI-driven file edits as transactions              │
│  ├─ Supports accept (commit) or deny (rollback)              │
│  ├─ Detects conflicts from concurrent modifications          │
│  └─ Used by: /api/chat, /api/filesystem/edits/*              │
│                                                              │
│  virtual-filesystem-service.ts                               │
│  ├─ Core VFS operations (read/write/list)                    │
│  ├─ Git-backed with automatic commits                        │
│  └─ Used by: All filesystem API routes                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Conclusion

**All three modules serve distinct purposes:**

1. **`use-virtual-filesystem`** - Core VFS state management (✅ Active)
2. **`use-filesystem-operations`** - Explorer-like operations (⚠️ Needs integration)
3. **`filesystem-edit-session-service`** - AI edit transaction tracking (✅ Active, needs improvements)

**Key Actions:**
- Integrate orphaned hook into workspace panel
- Fix identified issues in edit session service
- Add cleanup and monitoring
