# Desktop & CLI Integration Plan

## Overview

This document maps the relationships between desktop (Tauri), web, and shared packages/abstractions, identifies integration gaps, and provides actionable items for unifying the architecture.

---

## Current Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Frontend                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Components │  │  Hooks/      │  │  Tools/               │  │
│  │            │  │  Contexts    │  │  Bootstrap            │  │
│  └─────┬─────┘  └──────┬───────┘  └──────────┬─────────────┘  │
│        │               │                     │                  │
│        └───────────────┴─────────┬───────────┘                  │
│                                │                              │
│  ┌─────────────────────────────┴─────────────────────────────┐│
│  │  lib/tauri-api-adapter.ts  (Fetch interceptor)                ││
│  │  - Routes API calls → Tauri invoke OR Sidecar HTTP          ││
│  └─────────────────────────────┬─────────────────────────────┘│
└────────────────────────────────┼──────────────────────────────┘
                                 │
          ┌────────────────────────┼────────────────────────┐
          │                      │                        │
          ▼                      ▼                        ▼
   ┌──────────────┐      ┌──────────────┐         ┌──────────────┐
   │  Tauri v2    │      │  Sidecar    │         │  Web API     │
   │  invoke()    │      │  (Node.js)  │         │  Fallback   │
   └──────┬───────┘      └──────┬─────┘         └──────────────┘
          │                     │
          │                     ▼
          │              ┌──────────────┐
          │              │  Next.js    │
          │              │  Server     │
          │              └──────────────┘
          │
          ▼
   ┌──────────────────────────────────────┐
   │       Desktop / src-tauri /            │
   │       ┌─────────────────────────┐    │
   │       │  commands.rs           │    │  ← Rust backend
   │       │  lib.rs (NextServer)    │    │    (workspace boundary,
   │       │  api-routes.rs          │    │    PTY, checkpoints)
   │       └─────────────────────────┘    │
   └──────────────────────────────────────┘
```

---

## Key Abstractions & Adapters

### 1. Tauri API Adapter (`web/lib/tauri-api-adapter.ts`)

**Purpose:** Fetch interceptor that routes API calls to either Tauri `invoke()` or the sidecar HTTP server.

**Routes:**
- `TAURI_ROUTES` - Direct Tauri commands (filesystem, health, desktop)
- `SIDECAR_ROUTES` - Node.js sidecar (chat, agent, sandbox, MCP)

**Integration Status:** ✅ **INTEGRATED**

**Notes:**
- Well-structured routing layer
- Handles both direct commands and HTTP proxy
- Falls back gracefully

---

### 2. Invoke Bridge (`web/lib/tauri/invoke-bridge.ts`)

**Purpose:** Typed wrapper around Tauri `invoke()` for calling Rust commands.

**Commands exposed:**
- `read_file`, `write_file`, `list_directory`
- `execute_command`
- `create_checkpoint`, `restore_checkpoint`, `list_checkpoints`
- `create_pty_session`, `write_pty_input`, `resize_pty`, `close_pty_session`
- `get_system_info`, `get_resource_usage`
- `open_url`, `show_notification`

**Integration Status:** ✅ **INTEGRATED**

**Notes:**
- Comprehensive coverage
- TypeScript types match Rust responses
- Used by `bootstrap-tauri.ts` for tool registration

---

### 3. FS Bridge (`packages/shared/FS/fs-bridge.ts`)

**Purpose:** Wires local filesystem into the VFS layer for desktop mode.

**Features:**
- Local FS operations when `isDesktopMode()`
- Workspace manager integration
- File watcher for external change detection
- Rust file change event listener

**Integration Status:** ⚠️ **PARTIAL**

**Gap:**
- `startRustFileChangeListener()` uses Tauri events but may have race conditions on initialization
- File watcher lazy imports may fail silently

---

### 4. FS Abstraction Layer (`packages/shared/FS/index.ts`)

**Purpose:** Unified interface for file operations (local vs VFS).

**Modes:**
- Desktop: Direct access via Tauri FS API
- Web: Simulated sandboxed VFS storage

**Integration Status:** ⚠️ **NEEDS REVIEW**

**Gap:**
- Tauri FS types defined inline but should align with Rust API

---

### 5. Agent FS Bridge (`packages/shared/agent/agent-fs-bridge.ts`)

**Purpose:** VFS ↔ Sandbox bidirectional sync.

**Features:**
- `syncToSandbox()`, `syncFromSandbox()`, `syncBidirectional()`
- Path sanitization and validation
- Filesystem update events for UI refresh

**Integration Status:** ✅ **INTEGRATED**

**Notes:**
- Designed for sandbox environments
- Not directly used by desktop Tauri backend

---

### 6. Desktop MCP Manager (`web/lib/mcp/desktop-mcp-manager.ts`)

**Purpose:** Spawns MCP servers as local processes in desktop mode.

**Features:**
- Process management per server
- Log file generation
- Graceful restart on crash

**Integration Status:** ⚠️ **STANDALONE**

**Gap:**
- Desktop MCP tools not yet integrated with Rust backend
- No connection to Tauri sidecar

---

### 7. MCP Server Service (`packages/shared/services/mcp-server/index.ts`)

**Purpose:** HTTP+MCP bridge service.

**Features:**
- HTTP server with health, tools, execute endpoints
- SSE for tool events
- Tool routing to Nullclaw, Blaxel, Arcade

**Integration Status:** ⚠️ **STANDALONE**

**Gap:**
- Imports from `web/lib/mcp/architecture-integration` via relative path
- May have build issues in shared context
- No Tauri-sidecar integration

---

### 8. Bootstrap Tauri Tools (`web/lib/tools/bootstrap/bootstrap-tauri.ts`)

**Purpose:** Registers native Tauri invoke tools in the tool registry.

**Tools registered:**
- `tauri:file.read`, `tauri:file.write`, `tauri:file.list`, `tauri:file.delete`, `tauri:file.search`
- `tauri:sandbox.shell`, `tauri:sandbox.execute`
- `tauri:system.info`, `tauri:system.resources`

**Integration Status:** ✅ **INTEGRATED**

**Notes:**
- Uses `tauriInvoke` wrapper
- Wraps command outputs for capability system

---

## Gaps & Integration Items

### High Priority

| # | Gap | Files | Action |
|---|-----|-------|--------|
| 1 | **MCP Sidecar Connection** | `desktop/src-tauri/src/`, `web/lib/mcp/` | Wire Tauri sidecar port to `desktop-mcp-manager.ts` |
| 2 | **Rust → TypeScript Events** | `desktop/src-tauri/src/commands.rs` | Verify `file-change` event emission after every write |
| 3 | **FS Bridge Watcher Race** | `packages/shared/FS/fs-bridge.ts:419-428` | Add retry loop for Tauri event listener import |
| 4 | **Health Check Endpoint** | `desktop/src-tauri/src/api-routes.rs` | Add `/api/health` that returns `{ version, mode }` |

### Medium Priority

| # | Gap | Files | Action |
|---|-----|-------|--------|
| 5 | **Checkpoint Backend** | `desktop/src-tauri/src/commands.rs` | Verify all checkpoint commands are wired |
| 6 | **PTY Session Management** | `invoke-bridge.ts`, `commands.rs` | Verify PTY lifecycle in desktop mode |
| 7 | **Settings Persistence** | `commands.rs`, `invoke-bridge.ts` | Verify `save_settings`/`load_settings` work |
| 8 | **MCP Tools Export** | `packages/shared/mcp/` | Clean up relative imports that may break builds |

### Low Priority / Cleanup

| # | Gap | Files | Action |
|---|-----|-------|--------|
| 9 | **Dedup Type Definitions** | `invoke-bridge.ts`, `packages/shared/` | Consolidate `DirectoryEntry`, `CheckpointInfo` types |
| 10 | **Agent FS → Desktop** | `packages/shared/agent/agent-fs-bridge.ts` | Consider adding desktop mode support |

---

## File Mapping

### Web → Desktop

| Web Layer | Desktop Backend | Protocol |
|----------|------------------|----------|
| `invoke-bridge.ts` | `commands.rs` | Tauri invoke |
| `tauri-api-adapter.ts` | `api-routes.rs` | Fetch → invoke proxy |
| `bootstrap-tauri.ts` | `commands.rs` | Tool registration |
| `desktop-mcp-manager.ts` | (standalone) | child_process |

### Shared Packages

| Package | Uses | Purpose |
|---------|------|---------|
| `packages/shared/FS/` | Tauri FS API, workspace manager | Local FS layer |
| `packages/shared/agent/` | VFS, sandbox | Agent FS sync |
| `packages/shared/services/mcp-server/` | Web MCP | MCP HTTP service |

### Desktop Backend

| File | Exports | Purpose |
|------|---------|---------|
| `src-tauri/src/commands.rs` | File ops, PTY, checkpoints | Main command handlers |
| `src-tauri/src/lib.rs` | NextServer spawn, IPC | Sidecar management |
| `src-tauri/src/api-routes.rs` | API route handler | Fetch proxy |
| `desktop/mcp-server/index.js` | MCP bridge tools | Desktop MCP server |
| `desktop/static/index.html` | Loader page | Startup validation |

---

## Next Steps Checklist

- [ ] **Verify** `/api/health` returns `{ version, mode: "desktop" }`
- [ ] **Wire** Tauri sidecar port to `desktop-mcp-manager.ts`
- [ ] **Fix** Tauri event listener race in `fs-bridge.ts`
- [ ] **Test** checkpoint create/restore flow end-to-end
- [ ] **Test** PTY session create/write/resize/close lifecycle
- [ ] **Verify** `save_settings`/`load_settings` persistence
- [ ] **Build** `packages/shared/services/mcp-server/` in isolation
- [ ] **Add** desktop mode support to agent-fs-bridge (optional)

---

## Appendix: Key Constants

| Constant | Value | Source |
|----------|-------|--------|
| Tauri Bridge WS | `ws://127.0.0.1:3718` | `desktop/mcp-server/index.js` |
| NextServer Default Port | `3000` | `desktop/src-tauri/static/index.html` |
| MCP Server Default Port | `8888` | `packages/shared/services/mcp-server/index.ts` |
| Sidecar Config Global | `window.__SIDECAR_CONFIG__` | Injected by Tauri |
| File Change Event | `file-change` | `commands.rs` → TypeScript |
| Workspace Boundary | `validate_workspace_path()` | `commands.rs:13-53` |

---

## CLI Architecture (`packages/shared/cli/`)

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    binG CLI (bin.ts)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Chat Loop  │  │  File Cmds   │  │  Sandbox Cmds       │  │
│  │  SSE Stream │  │  VFS Tools   │  │  Execute/Destroy   │  │
│  └────────────┘  └──────┬───────┘  └────────────────────┘  │
│                         │                                      │
│  ┌──────────────────────┴────────────────────────────────────┐ │
│  │  Local VFS Manager (lib/local-vfs-manager.ts)              │ │
│  │  - Git-based history (~/.quaz/workspace-history/)       │ │
│  │  - Path traversal protection                            │ │
│  │  - Snapshot, revert, rollback                        │ │
│  └─────────────────────────────────┬────────────────────────┘ │
└───────────────────────────────────┼──────────────────────────┘
                                    │
          ┌─────────────────────────┼────────────────────────┐
          │                         │                        │
          ▼                         ▼                        ▼
   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
   │  Local FS     │        │  Web API     │        │  Sandbox     │
   │  (fs-extra)  │        │  (axios)    │        │  Providers  │
   └──────────────┘        └──────────────┘        └──────────────┘
```

---

## CLI vs Desktop Differences

### Common Patterns (Shared)

| Pattern | Desktop (`web/`) | CLI (`packages/shared/cli/`) |
|---------|------------------|---------------------------|
| Mode Detection | `process.env.DESKTOP_MODE` | `process.env.DESKTOP_MODE` |
| Workspace Root | `DESKTOP_WORKSPACE_ROOT`, `WORKSPACE_ROOT` | `INITIAL_CWD`, `DESKTOP_WORKSPACE_ROOT` |
| API Base | `localhost:3000/api` | `localhost:3000/api` |
| VFS Tools | MCP-based (`web/lib/mcp/vfs-mcp-tools.ts`) | Dynamic import |
| File History | VFS + Rust events | Git-based (`~/.quaz/`) |

### Key Differences

| Aspect | Desktop | CLI |
|--------|---------|--------|
| **Runtime** | Tauri webview + Rust | Node.js standalone |
| **File Operations** | Tauri `invoke()` → Rust | `fs-extra` direct |
| **Workspace Boundary** | `validate_workspace_path()` in Rust | Path traversal checks in LocalVFSManager |
| **History** | VFS + Rust events | Git in `~/.quaz/workspace-history/` |
| **Sidecar** | NextServer via Tauri sidecar | Direct API calls to server |
| **MCP Tools** | DesktopMCPManager (child_process) | Dynamic import from web/ |
| **Events** | Tauri event listener | SSE streaming |

---

## CLI-Specific Abstractions

### 1. Local VFS Manager (`packages/shared/cli/lib/local-vfs-manager.ts`)

**Purpose:** Git-based version control for CLI-only usage (no Rust backend).

**Features:**
- `commitFile()` - Write + commit to history
- `commitToHistory()` - Snapshot only
- `snapshotWorkspace()` - Full workspace backup
- `revertFile()` - Single file rollback
- `rollbackFileToVersion()` - Specific commit rollback
- `getFileHistory()` - Version history
- `readWorkspaceFile()` - Safe read with boundary check
- `deleteFile()` - Delete with history

**Path Traversal Protection:**
```typescript
const resolvedPath = path.resolve(targetPath);
if (!resolvedPath.startsWith(this.workspacePath + path.sep) && 
    resolvedPath !== this.workspacePath) {
  return null; // Blocked
}
```

**Integration Status:** ✅ **INTEGRATED**

**Gap:**
- No sync with Rust backend events (desktop/CLI standalone)
- Separate history location (`~/.quaz/` vs VFS)

---

### 2. CLI VFS MCP Tools (`web/lib/mcp/vfs-mcp-tools.ts`)

**Purpose:** Dynamic import into CLI for MCP-capable models.

```typescript
// Line 217-234 in bin.ts
const MCP_TOOLS_PATH = path.join(__dirname, '..', '..', '..', 'web', 'lib', 'mcp', 'vfs-mcp-tools.ts');
await initializeVFSMCP(userId, sessionId);
```

**Integration Status:** ⚠️ **PATH RELATIVE**

**Gap:**
- Relative path from `packages/shared/cli/` to `web/` may break in builds
- No fallback if import fails

---

### 3. bin-enhanced.ts (Extended CLI)

**Purpose:** Enhanced CLI with WebSocket, Mastra/n8n, OAuth.

**Features:**
- WebSocket terminal support
- Workflow execution
- Git operations
- Cloud storage management
- OAuth integrations (stubbed in enhanced version)

**Integration Status:** ✅ **INTEGRATED**

**Gap:**
- OAuth handler stubbed (not fully implemented)
- WebSocket terminal not integrated with desktop

---

## CLI Integration Gaps

### High Priority

| # | Gap | CLI File | Action |
|---|-----|--------|--------|
| 11 | **VFS MCP Path** | `bin.ts:217` | Use package alias instead of relative path |
| 12 | **Desktop Boundary Sync** | `bin.ts:856-862` | Align with Rust `validate_workspace_path()` |
| 13 | **CLI → Rust Events** | `bin.ts:244-280` | No event emission when desktop is running |

### Medium Priority

| # | Gap | CLI File | Action |
|---|-----|--------|--------|
| 14 | **SSE Event Alignment** | `bin.ts:317-350` | SSE types may differ from desktop VFS events |
| 15 | **OAuth Completion** | `bin-enhanced.ts` | OAuth stub → real handler |
| 16 | **WebSocket → Tauri** | `bin-enhanced.ts` | No Tauri WS bridge for terminal |

### Low Priority / Cleanup

| # | Gap | CLI File | Action |
|---|-----|--------|--------|
| 17 | **History Dedup** | `lib/local-vfs-manager.ts` | Deduplicate if CLI and desktop both run |
| 18 | **Local Bundle Manager** | `lib/local-bundle-manager.ts` | Review for CLI-only mode |

---

## Unified Next Steps

- [x] Desktop `/api/health` returns `{ version, mode }`
- [ ] **CLI VFS MCP Path** → use `@/lib/mcp/vfs-mcp-tools` alias
- [ ] **CLI boundary checks** → reuse `validate_workspace_path()` logic
- [ ] **CLI ↔ Desktop events** → WebSocket bridge or shared event bus
- [ ] **OAuth completion** in bin-enhanced.ts
- [ ] **WebSocket terminal** → Tauri WS integration
- [ ] **History deduplication** if both run in same workspace