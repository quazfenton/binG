# Filesystem Layer Consolidation Analysis

**Date:** 2026-05-05  
**Status:** 🔍 Analysis in Progress

## Overview

There are **4 different filesystem abstraction layers** in the codebase, each with different purposes and capabilities. This document analyzes their differences, overlaps, and whether consolidation is needed.

---

## The Four Filesystem Layers

### 1. `packages/platform/src/fs/index.ts`

**Purpose:** Platform-agnostic file operations (client-side)  
**Scope:** File dialogs, drag-and-drop, basic read/write  
**Used By:** UI components, file upload/download

**Key Features:**
- ✅ File dialog (open/save)
- ✅ Drag-and-drop support
- ✅ Read file (from File object or path)
- ✅ Write file (desktop only)
- ✅ Binary file support
- ❌ No search
- ❌ No directory listing
- ❌ No VFS integration

**Architecture:**
```typescript
packages/platform/src/fs/
├── index.ts       // Main export, platform detection
├── desktop.ts     // Tauri FS API wrapper
└── web.ts         // Browser File API wrapper
```

**Mode Detection:**
```typescript
isDesktopMode() 
  ? import('./desktop').then(m => m.fs)
  : import('./web').then(m => m.fs)
```

**Use Case:** UI file operations (open dialog, save dialog, drag-and-drop)

---

### 2. `packages/shared/FS/index.ts`

**Purpose:** Server-side filesystem abstraction for agents  
**Scope:** Full filesystem operations with workspace boundaries  
**Used By:** Agent execution, VFS bridge, workspace manager

**Key Features:**
- ✅ Full CRUD operations (read, write, delete, mkdir)
- ✅ Directory listing (recursive)
- ✅ Search (simple string matching)
- ✅ File watching
- ✅ Workspace boundaries
- ✅ Version tracking
- ✅ VFS integration via fs-bridge
- ❌ No ripgrep integration

**Architecture:**
```typescript
packages/shared/FS/
├── index.ts           // Main IFileSystem interface + implementations
├── fs-bridge.ts       // Bridges VFS to local FS in desktop mode
└── workspace-manager.ts // Workspace boundary enforcement
```

**Mode Detection:**
```typescript
// In fs-bridge.ts
if (isDesktopMode()) {
  // Use Tauri FS API directly (via @tauri-apps/api/fs)
  this.fs = createFileSystem(config);
} else {
  // Delegate to VFS
  this.fs = null; // VFS handles web mode
}
```

**Search Implementation:**
```typescript
// Simple string matching, NOT using ripgrep
async search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]> {
  // Recursively walks directories
  // Checks if filename.includes(query)
  // Reads file content if shouldSearchContent()
  // Returns scored results
}
```

**Use Case:** Agent filesystem operations with workspace boundaries

---

### 3. `web/lib/agent-bins/agent-filesystem.ts`

**Purpose:** Unified agent filesystem with mode detection  
**Scope:** Centralized desktop/web/remote mode handling  
**Used By:** Agent services, CLI tools

**Key Features:**
- ✅ Mode detection (local/vfs/mcp/remote)
- ✅ Full CRUD operations
- ✅ Directory listing
- ✅ Search (delegates to backend)
- ✅ Path normalization
- ✅ Security filtering
- ❌ No ripgrep integration

**Architecture:**
```typescript
web/lib/agent-bins/
└── agent-filesystem.ts  // Single file with multiple implementations
```

**Mode Detection:**
```typescript
export function detectDefaultFsMode(): AgentFsMode {
  if (isDesktopMode() || isLocalExecution()) {
    return 'local';  // Node.js fs/promises
  }
  return 'vfs';  // VFS via MCP tools
}
```

**Implementations:**
- **LocalFilesystem:** Uses Node.js `fs/promises` directly
- **VFSFilesystem:** Uses `virtualFilesystem` service
- **MCPFilesystem:** Uses MCP tools (write_file, read_file, etc.)
- **RemoteFilesystem:** HTTP proxy to remote agent server

**Search Implementation:**
```typescript
// Delegates to VFS search (simple string matching)
async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
  const results = await this.vfs.search(this.userId, query, options);
  return results.files.map(f => ({ ... }));
}
```

**Use Case:** Agent services that need unified FS access

---

### 4. `web/lib/virtual-filesystem/desktop-vfs-service.ts`

**Purpose:** Desktop VFS sync layer  
**Scope:** Bridges VFS (versioned) with local filesystem  
**Used By:** Desktop mode VFS operations

**Key Features:**
- ✅ VFS ↔ Local FS sync
- ✅ Git-backed versioning
- ✅ External edit detection
- ✅ Debounced sync
- ✅ Delete detection
- ✅ File coalescing
- ❌ No search (delegates to VFS)

**Architecture:**
```typescript
web/lib/virtual-filesystem/
├── virtual-filesystem-service.ts  // Main VFS
└── desktop-vfs-service.ts         // Desktop sync layer
```

**Flow:**
```
Agent writes → VFS (versioned) → sync to local FS
User edits locally → detected on next read → imported into VFS
```

**Use Case:** Desktop mode VFS with local filesystem sync

---

## Comparison Matrix

| Feature | platform/fs | shared/FS | agent-filesystem | desktop-vfs-service |
|---------|-------------|-----------|------------------|---------------------|
| **Purpose** | UI file ops | Agent FS | Unified agent FS | VFS sync |
| **Client/Server** | Client | Server | Server | Server |
| **Desktop Mode** | Tauri FS API | Tauri FS API | Node.js fs | VFS + Local FS |
| **Web Mode** | Browser File API | VFS delegate | VFS | N/A |
| **File Dialog** | ✅ | ❌ | ❌ | ❌ |
| **Drag-and-Drop** | ✅ | ❌ | ❌ | ❌ |
| **Read/Write** | ✅ | ✅ | ✅ | ✅ (via VFS) |
| **Directory List** | ✅ | ✅ | ✅ | ✅ (via VFS) |
| **Search** | ❌ | ✅ (string) | ✅ (delegates) | ❌ |
| **Ripgrep** | ❌ | ❌ | ❌ | ❌ |
| **File Watch** | ❌ | ✅ | ❌ | ✅ |
| **Versioning** | ❌ | ✅ | ❌ | ✅ (via VFS) |
| **Workspace Boundary** | ❌ | ✅ | ✅ | ✅ (via VFS) |
| **VFS Integration** | ❌ | ✅ (via bridge) | ✅ | ✅ (is VFS) |
| **Used By** | UI components | Agents, VFS | Agent services | Desktop VFS |

---

## How They Interact

### Desktop Mode Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM Agent / User                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐
    │   UI Operations   │   │  Agent Operations │
    │                   │   │                   │
    │  platform/fs      │   │  agent-filesystem │
    │  (Tauri FS API)   │   │  or shared/FS     │
    └─────────┬─────────┘   └─────────┬─────────┘
              │                       │
              ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐
    │  User's Local FS  │   │  VFS Service      │
    │  (direct access)  │   │  (versioned)      │
    └───────────────────┘   └─────────┬─────────┘
                                      │
                                      ▼
                            ┌───────────────────┐
                            │ desktop-vfs-service│
                            │ (sync to local FS) │
                            └─────────┬─────────┘
                                      │
                                      ▼
                            ┌───────────────────┐
                            │  User's Local FS  │
                            │  (synced copy)    │
                            └───────────────────┘
```

### Web Mode Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM Agent / User                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐
    │   UI Operations   │   │  Agent Operations │
    │                   │   │                   │
    │  platform/fs      │   │  agent-filesystem │
    │  (Browser API)    │   │  or shared/FS     │
    └─────────┬─────────┘   └─────────┬─────────┘
              │                       │
              ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐
    │  Browser Storage  │   │  VFS Service      │
    │  (IndexedDB)      │   │  (in-memory +     │
    └───────────────────┘   │   SQLite)         │
                            └───────────────────┘
```

---

## Sidecar vs API Routes

### Question: Does Desktop Bypass VFS API Routes?

**Answer:** Partially, but adapters still work.

### Desktop Sidecar Architecture

```
Desktop App (Tauri)
├── Frontend (React)
│   └── Uses platform/fs for UI operations
│
└── Sidecar (Next.js Server)
    ├── Runs on localhost:PORT
    ├── Handles agent operations
    ├── Uses shared/FS or agent-filesystem
    └── VFS operations go through:
        ├── Direct function calls (NOT HTTP routes)
        └── fs-bridge → Tauri FS API
```

**Key Points:**

1. **UI Operations** (file dialogs, drag-and-drop):
   - Use `platform/fs` → Tauri FS API directly
   - Bypass VFS entirely
   - Direct IPC to Rust commands

2. **Agent Operations** (write_file, read_file, grep_code):
   - Use `vfs-mcp-tools` → `virtualFilesystem` service
   - VFS detects desktop mode: `isDesktopMode() && isUsingLocalFS()`
   - Delegates to `fsBridge` → Tauri FS API
   - **NOT** HTTP routes, direct function calls

3. **grep_code Specifically**:
   - Uses `ripgrep-vfs-adapter`
   - Detects desktop mode
   - Spawns native `rg` binary via Node.js `child_process`
   - Searches user's local filesystem directly
   - **Does NOT** use Tauri invoke
   - **Does NOT** use HTTP routes

### Does invoke-bridge.ts Get Used?

**Answer:** Only for specific Tauri commands, NOT for filesystem operations.

**invoke-bridge.ts is used for:**
- ✅ PTY operations (terminal)
- ✅ Desktop automation (window management, clipboard)
- ✅ System info
- ✅ Notifications
- ❌ NOT for file operations (uses Tauri FS API directly)
- ❌ NOT for grep_code (uses Node.js child_process)

---

## Search Implementation Comparison

### Current Search Methods

| Layer | Method | Performance | Ripgrep? |
|-------|--------|-------------|----------|
| `shared/FS` | String matching | Slow | ❌ |
| `agent-filesystem` | Delegates to VFS | Slow | ❌ |
| `grep_code tool` | ripgrep-vfs-adapter | Fast | ✅ |

### shared/FS Search (Current)

```typescript
// packages/shared/FS/index.ts
async search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]> {
  // Recursively walks directories
  // Simple string matching: fileName.includes(query)
  // Reads file content if text file
  // Returns scored results
}
```

**Problems:**
- ❌ Slow (walks entire tree)
- ❌ No regex support
- ❌ No glob patterns
- ❌ No context lines
- ❌ Doesn't use ripgrep

### grep_code Tool (New)

```typescript
// web/lib/mcp/vfs-mcp-tools.ts
export const grepCodeTool = tool({
  execute: async (args) => {
    const { ripgrepVFS } = await import('../search/ripgrep-vfs-adapter');
    return await ripgrepVFS({
      query: args.query,
      ownerId,
      glob: args.glob,
      caseInsensitive: args.caseInsensitive,
      contextLines: args.contextLines,
      ...
    });
  }
});
```

**Benefits:**
- ✅ Fast (native ripgrep on desktop)
- ✅ Regex support
- ✅ Glob patterns
- ✅ Context lines
- ✅ Uses ripgrep

---

## Recommendations

### 1. Keep All Four Layers (Different Purposes)

**Rationale:** Each layer serves a distinct purpose and has different use cases.

| Layer | Keep? | Reason |
|-------|-------|--------|
| `platform/fs` | ✅ YES | UI file operations (dialogs, drag-and-drop) |
| `shared/FS` | ✅ YES | Agent filesystem with workspace boundaries |
| `agent-filesystem` | ✅ YES | Unified agent FS with mode detection |
| `desktop-vfs-service` | ✅ YES | VFS sync layer for desktop |

### 2. Remove Simple Search from shared/FS

**Recommendation:** ❌ Remove or deprecate the simple string search in `shared/FS/index.ts`

**Rationale:**
- Slow and limited (no regex, no glob)
- Duplicates functionality now provided by `grep_code`
- LLM should use `grep_code` tool instead

**Action:**
```typescript
// packages/shared/FS/index.ts
async search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]> {
  // DEPRECATED: Use grep_code tool instead for better performance and features
  console.warn('[FS] search() is deprecated. Use grep_code tool for code search.');
  
  // Keep minimal implementation for backward compatibility
  // Or throw error to force migration
  throw new Error('search() is deprecated. Use grep_code tool instead.');
}
```

### 3. Update agent-filesystem to Use grep_code

**Recommendation:** Update `agent-filesystem.ts` search to delegate to `grep_code` tool

**Current:**
```typescript
// web/lib/agent-bins/agent-filesystem.ts
async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
  // Currently delegates to VFS simple search
  const results = await this.vfs.search(this.userId, query, options);
  return results.files.map(f => ({ ... }));
}
```

**Proposed:**
```typescript
// web/lib/agent-bins/agent-filesystem.ts
async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
  // Use ripgrep-vfs-adapter for better performance
  const { ripgrepVFS } = await import('@/lib/search/ripgrep-vfs-adapter');
  
  const result = await ripgrepVFS({
    query,
    ownerId: this.userId,
    path: options?.path,
    maxResults: options?.limit,
  });
  
  // Convert to DirEntry format
  return result.matches.map(m => ({
    name: path.basename(m.path),
    path: m.path,
    type: 'file' as const,
  }));
}
```

### 4. Document the Architecture

**Recommendation:** Create clear documentation showing when to use each layer

**Documentation Needed:**
- When to use `platform/fs` vs `shared/FS` vs `agent-filesystem`
- How desktop sidecar bypasses HTTP routes
- How grep_code integrates with all layers
- Migration guide from simple search to grep_code

---

## Summary

### ✅ Keep All Four Layers

Each serves a distinct purpose:
1. **platform/fs** - UI file operations
2. **shared/FS** - Agent FS with boundaries
3. **agent-filesystem** - Unified agent FS
4. **desktop-vfs-service** - VFS sync

### ❌ Remove Simple Search

- Deprecate `search()` in `shared/FS/index.ts`
- Update `agent-filesystem` to use `grep_code`
- Force migration to ripgrep-based search

### ✅ Adapters Still Work

- Desktop sidecar uses direct function calls (not HTTP routes)
- VFS adapters detect desktop mode and delegate correctly
- grep_code works through ripgrep-vfs-adapter
- No Tauri invoke needed for grep_code

### 📝 Action Items

1. ✅ grep_code already integrated (DONE)
2. ⏳ Deprecate simple search in shared/FS
3. ⏳ Update agent-filesystem to use grep_code
4. ⏳ Document architecture clearly
5. ⏳ Add migration guide

---

**Status:** Analysis Complete  
**Next Step:** Implement deprecation and updates
