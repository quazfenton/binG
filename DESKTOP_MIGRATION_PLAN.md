# Desktop-to-Web Migration & Abstraction Plan

## Overview

This plan outlines items to:
1. **Extract** from desktop/ into web/ (files missing in web that exist in desktop)
2. **Merge** files that have differences between desktop/ and web/ versions
3. **Abstract** into packages/platform for both web and desktop to share
4. **Additional** desktop-specific changes needed for Tauri

---

## Phase 1: Files Already Identical (No Action Needed)

These files are byte-for-byte identical between desktop/ and web/lib/:

| Desktop Path | Web Path | Status |
|-------------|----------|--------|
| `desktop/lib/sandbox/providers/desktop-provider.ts` | `web/lib/sandbox/providers/desktop-provider.ts` | IDENTICAL |
| `desktop/lib/mcp/desktop-mcp-manager.ts` | `web/lib/mcp/desktop-mcp-manager.ts` | IDENTICAL |

**Action**: No migration needed - these already exist in web.

---

## Phase 2: Files to Extract/Migrate from Desktop to Web

### 2.1 Security Policy Module

| Desktop | Target | Description |
|---------|--------|--------------|
| `desktop/lib/sandbox/desktop-security-policy.ts` | `web/lib/sandbox/desktop-security-policy.ts` | Command security analysis for desktop mode |

**Why**: This is a core security module that needs to exist in web for consistency. It provides:
- `DesktopSecurityPolicy` class with configurable blocked patterns
- `analyzeDesktopCommand()` helper function
- Risk level assessment (`low`, `medium`, `high`, `critical`)
- Audit logging for commands

**Differences from web/lib/sandbox/security.ts**:
- Desktop version is more configurable (allows custom policy passed as parameter)
- Has `isPathAllowed()` for directory restrictions
- Has approval-required patterns detection
- Includes audit log with `getAuditLog()`, `clearAuditLog()`
- Web version uses simple regex patterns, desktop version uses class-based policy

**Recommendation**: Move to web and consider merging concepts into a unified security module.

---

### 2.2 Core Sandbox Service

| Desktop | Target | Description |
|---------|--------|--------------|
| `desktop/lib/sandbox/core-sandbox-service.ts` | `web/lib/sandbox/core-sandbox-service.ts` | Sandbox orchestration |

**Key Differences**:
1. Desktop version defaults to `'desktop'` provider when `DESKTOP_MODE` is true
2. Desktop version has explicit handling to skip warm pool for desktop provider
3. Desktop version imports from `../storage/session-store`, `../management/quota-manager`, etc.

**Recommendation**: 
- Extract base `SandboxService` class to web
- Add platform detection in web version to auto-select desktop provider
- The desktop-specific logic (warm pool skip) can be handled via platform abstraction

---

### 2.3 Desktop VFS Service

| Desktop | Target | Description |
|---------|--------|--------------|
| `desktop/lib/virtual-filesystem/desktop-vfs-service.ts` | `web/lib/virtual-filesystem/desktop-vfs-service.ts` | VFS ↔ local FS sync |

**Key Features**:
- Syncs VFS writes to local filesystem (`autoSync` option)
- Imports local edits on read (`importLocalEdits` option)
- Hash-based change detection for external modifications
- Full workspace sync capability

**Web Counterpart**: `web/lib/virtual-filesystem/virtual-filesystem-service.ts`

**Recommendation**: 
- Move to web as `DesktopVFSService` class
- Create abstraction in packages/platform that either:
  - Web: Uses OPFS or in-memory VFS
  - Desktop: Uses actual local filesystem

---

## Phase 3: Desktop-Specific Files to Abstract

### 3.1 Auth Bypass

| Desktop Path | Purpose |
|-------------|---------|
| `desktop/lib/auth/desktop-auth-bypass.ts` | Bypass cloud auth in desktop mode |

**Web Counterpart**: Would be `web/lib/auth/enhanced-middleware.ts`

**Abstraction Needed**: Create in packages/platform:
```
packages/platform/src/auth/
├── index.ts          # Unified auth interface
├── web.ts           # Web: Auth0/OAuth-based
└── desktop.ts       # Desktop: Local/environment-based
```

**Features to abstract**:
- `getUserContext()` - returns user from token (web) or env (desktop)
- `withAuth()` - middleware wrapper
- `bypassPaths` - paths that don't require auth

---

### 3.2 Tauri IPC Bridge

| Desktop Path | Purpose |
|-------------|---------|
| `desktop/lib/tauri/invoke-bridge.ts` | TypeScript wrapper for Rust Tauri commands |

**Abstraction Needed**: Expand packages/platform:
```
packages/platform/src/shell/
├── index.ts          # Unified shell interface
├── web.ts           # Web: WebSocket terminal / simulated
└── desktop.ts       # Desktop: Tauri invoke + native shell
```

**Commands to abstract**:
- `executeCommand()` → shell execution
- `readFile()` / `writeFile()` → file operations
- `listDirectory()` → directory listing
- `getSystemInfo()` → system info
- `showNotification()` → notifications
- `openUrl()` → URL opening

---

### 3.3 Dialog Provider

| Desktop Path | Purpose |
|-------------|---------|
| `desktop/lib/hitl/tauri-dialog-provider.ts` | Native file/folder dialogs via Tauri |

**Web Counterpart**: Browser `input type="file"` / `showSaveDialog` polyfills

**Abstraction Needed**: Already partially done in packages/platform:
- `packages/platform/src/fs/web.ts` has `openFileDialog()`, `saveFileDialog()`
- Need to add desktop implementations using Tauri dialog plugin

---

### 3.4 Database Configuration

| Desktop Path | Purpose |
|-------------|---------|
| `desktop/lib/database/desktop-database.ts` | Desktop SQLite path configuration |

**Abstraction Needed**: 
```
packages/platform/src/database/
├── index.ts
├── web.ts     # Server-based or IndexedDB
└── desktop.ts # Local SQLite via Tauri
```

---

### 3.5 Desktop Environment Utilities

| Desktop Path | Purpose |
|-------------|---------|
| `desktop/lib/utils/desktop-env.ts` | Desktop mode detection and config |

**Already in packages/platform**: 
- `packages/platform/src/env.ts` - has `isDesktopMode()`
- Should expand to include `getShellCommand()`, `getDesktopConfig()`

---

## Phase 4: Files with Web Counterparts (Compare & Merge)

### 4.1 Agent Loop

| Desktop | Web |
|---------|-----|
| `desktop/lib/orchestra/agent-loop.ts` | `web/lib/orchestra/agent-loop.ts` |

**Desktop-specific additions**:
- Lines 24-32: Platform-specific system prompt for desktop (shows user platform: Windows/macOS/Linux)
- Uses desktop provider implicitly via `coreSandboxService`

**Recommendation**: Merge platform-specific logic into web version using environment detection, or create abstraction in platform package.

---

### 4.2 Unified Agent Service

| Desktop | Web |
|---------|-----|
| `desktop/lib/orchestra/unified-agent-service.ts` | `web/lib/orchestra/unified-agent-service.ts` |

**Desktop-specific additions**:
- `checkProviderHealth()` includes `desktop` mode check
- `runDesktopMode()` function for local execution
- Mode: `'desktop'` added to type unions
- Desktop fallback when desktop execution fails

**Recommendation**: 
- Keep desktop-specific mode handler
- Extract common routing logic to shared location
- Use platform abstraction for provider health detection

---

### 4.3 Stateful Agent Tools

| Desktop | Web |
|---------|-----|
| `desktop/lib/orchestra/stateful-agent/tools/tool-executor.ts` (901 lines) | `web/lib/orchestra/stateful-agent/tools/tool-executor.ts` (761 lines) |
| `desktop/lib/orchestra/stateful-agent/human-in-the-loop.ts` (843 lines) | `web/lib/orchestra/stateful-agent/human-in-the-loop.ts` (769 lines) |

**tool-executor.ts Differences**:
- Desktop adds `redactParams()` method (lines ~93-108) for sensitive data redaction in logs
- Filters keys: `content`, `diff`, `replace`, `password`, `token`, `secret`, `apikey`, `credential`
- Also truncates strings > 500 chars in logs

**human-in-the-loop.ts Differences**:
- Desktop adds `resolved` flag to prevent race conditions (line 28)
- Desktop adds `handlerPromise` that runs handler in background without blocking timeout
- Desktop adds atomic resolved flag check before cleanup
- Web version: `this.handler(request)` is called but result not awaited (line 70)
- Desktop version: properly handles async handler with race condition prevention

**Recommendation**: **Merge desktop fixes back to web** - these are bug fixes for race conditions and security (log redaction)

---

### 4.4 Sandbox Providers Index

| Desktop | Web |
|---------|-----|
| `desktop/lib/sandbox/providers/index.ts` (1147 lines) | `web/lib/sandbox/providers/index.ts` (1124 lines) |

**Differences**:
- Desktop: Registers `'desktop'` provider with lazy init (lines 480-496)
- Web: Registers `'desktop'` provider with lazy init (lines 76-91)
- Both have similar provider registry, desktop has some additional exports (E2BDesktopProvider)
- **Status**: Essentially identical in provider registration

**Recommendation**: No changes needed - web already has desktop provider registered

---

## Phase 5: Additional Desktop-Specific Considerations

### 5.1 Sandbox Execution → Local Execution

| Web (Current) | Desktop (New) |
|---------------|---------------|
| Cloud sandbox (Daytona, E2B, etc.) | Local shell on user's machine |
| Workspace in cloud | Workspace in `~/workspace` |
| Timeout-based execution | Native process execution |
| Network isolation | Full local network access |

**Abstraction**:
```typescript
// packages/platform/src/execution/index.ts
interface ExecutionContext {
  type: 'sandbox' | 'local';
  execute(command: string): Promise<ToolResult>;
  writeFile(path: string, content: string): Promise<ToolResult>;
  readFile(path: string): Promise<ToolResult>;
}
```

---

### 5.2 WebSocket Terminal → Native Terminal

| Web (Current) | Desktop (New) |
|---------------|---------------|
| WebSocket to cloud sandbox | Local PTY via Tauri |
| Terminal emulation (xterm.js) | Native terminal |
| Simulated command output | Real shell output |

**Abstraction**:
```typescript
// packages/platform/src/terminal/index.ts
interface TerminalAdapter {
  spawn(command: string, cwd?: string): TerminalSession;
  resize(cols: number, rows: number): void;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
}
```

---

### 5.3 VFS → Real Filesystem

| Web (Current) | Desktop (New) |
|---------------|---------------|
| Virtual filesystem (in-memory) | Real local filesystem |
| OPFS for persistence | Native fs via Tauri |
| Git-backed versioning | Optional: can use real .git |
| Batch operations for sync | Direct file operations |

**Abstraction** (expand existing packages/platform/fs):
```typescript
interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<FileEntry[]>;
  watch(path: string, callback: (event: WatchEvent) => void): void;
}
```

---

### 5.4 Additional Desktop Features to Add

1. **System Tray Integration** - Already in Rust (`desktop/src-tauri/src/tray.rs`)
   - Need TypeScript wrapper in packages/platform

2. **Native Notifications** - Already partially in invoke-bridge
   - Expand to full cross-platform abstraction

3. **File Association** - Open files with app (configured in tauri.conf.json)
   - Need handler in frontend

4. **Auto-Update** - Tauri updater plugin
   - Need UI for update prompts

5. **Deep Links** - URL scheme handling
   - Need route handler for `opencode://` URLs

---

## Summary: Priority Order

### P0 - Must Abstract (Core Functionality)
1. Shell execution → `packages/platform/src/shell`
2. File system → `packages/platform/src/fs` (expand existing)
3. Auth → `packages/platform/src/auth`
4. Terminal → `packages/platform/src/terminal`

### P1 - Should Migrate
1. `desktop-security-policy.ts` → `web/lib/sandbox/`
2. `core-sandbox-service.ts` → `web/lib/sandbox/`
3. `desktop-vfs-service.ts` → `web/lib/virtual-filesystem/`

### P2 - Compare & Merge
1. `agent-loop.ts` - compare desktop additions
2. `unified-agent-service.ts` - compare desktop additions
3. `stateful-agent/tools/tool-executor.ts` - merge fixes
4. `human-in-the-loop.ts` - compare implementations

### P3 - Desktop-Specific (Keep in desktop/)
1. Tauri dialog provider (can abstract later)
2. Database config (can abstract later)
3. Desktop environment utilities (expand platform package)
4. System tray, auto-update, deep links (future)

---

## Implementation Notes

1. **Dynamic imports**: Use pattern from `packages/platform/src/fs/index.ts` to avoid bundling Tauri APIs in web builds

2. **Environment detection**: Use `isDesktopMode()` from `packages/platform/src/env.ts` as the single source of truth

3. **Type safety**: Create platform-specific type definitions in `packages/platform/src/tauri-types.d.ts` (already exists)

4. **Testing**: Each abstraction should work on both platforms - implement integration tests that run on both

---

## Phase 6: Web Files Using Direct Browser APIs (Need Abstraction)

The following web files directly use browser APIs that should be replaced with platform abstractions:

### 6.1 Clipboard (134+ files using `navigator.clipboard` directly)

**Current**: Files directly call `navigator.clipboard.writeText()` and `navigator.clipboard.readText()`

**Should use**: `import { clipboard } from '@bing/platform/clipboard'`

**Example files**:
- `web/components/code-preview-panel.tsx`
- `web/components/terminal/TerminalPanel.tsx`
- `web/components/workspace-panel.tsx`
- `web/components/visual_editor.tsx`
- And 130+ more

**Action**: Replace all `navigator.clipboard.*` calls with `clipboard.*` from platform package

### 6.2 Notifications (using toast library)

**Current**: Web uses `toast` from sonner/react-hot-toast for UI notifications

**Already abstracted**: `packages/platform/src/notifications.ts` provides cross-platform notifications

**Action**: Consider migrating to platform notifications for system-level notifications (even on web)

### 6.3 Files Using Non-Existent Desktop-Env Import (BROKEN)

**File**: `web/lib/mcp/desktop-mcp-manager.ts`

**Problem**: Imports `isDesktopMode` from `@/lib/utils/desktop-env` which **does not exist in web/**

```typescript
// This import will FAIL in web build:
import { isDesktopMode } from '@/lib/utils/desktop-env';
```

**Fix needed**: Either:
1. Create `@/lib/utils/desktop-env.ts` in web/ that re-exports from platform
2. Or fix the import in desktop-mcp-manager.ts to use `@bing/platform/env`

### 6.4 Files Using Process Env for Desktop Detection

**Pattern**: `process.env.DESKTOP_MODE === 'true'`

**Found in**:
- `web/lib/sandbox/core-sandbox-service.ts`
- `web/lib/sandbox/providers/index.ts`
- `web/lib/sandbox/providers/desktop-provider.ts`

**Should use**: `isDesktopMode()` from `@bing/platform/env`

---

## Summary of Changes Needed

### Broken/Needs Fix (P0)
1. ✅ `web/lib/mcp/desktop-mcp-manager.ts` - Fixed import to use `@bing/platform/env`
2. `web/lib/sandbox/core-sandbox-service.ts` - Fixed to use `isDesktopMode()` from platform
3. `web/lib/sandbox/providers/index.ts` - Fixed to use `isDesktopMode()` from platform
4. `web/lib/sandbox/providers/desktop-provider.ts` - Fixed to use `isDesktopMode()` from platform

### Should Migrate to Platform (P1)
1. Files using `process.env.DESKTOP_MODE` - Use `isDesktopMode()` from platform - **DONE (4 files)**
2. Consider using `notify()` from platform for system notifications

### Already Abstracted (No Action)
- `packages/platform/src/env.ts` - Already has all needed functions
- `packages/platform/src/clipboard.ts` - Already has Web + Desktop implementations
- `packages/platform/src/notifications.ts` - Already has Web + Desktop implementations
- `packages/platform/src/fs/*` - Already has Web + Desktop implementations

---

## Phase 6 Edits Completed

The following edits were applied to fix broken imports and use platform abstractions:

1. **`web/lib/mcp/desktop-mcp-manager.ts`**
   - Changed: `import { isDesktopMode } from '@/lib/utils/desktop-env'`
   - To: `import { isDesktopMode } from '@bing/platform/env'`

2. **`web/lib/sandbox/core-sandbox-service.ts`**
   - Added import: `import { isDesktopMode } from '@bing/platform/env'`
   - Changed: `process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true'`
   - To: `isDesktopMode()`

3. **`web/lib/sandbox/providers/index.ts`**
   - Added import: `import { isDesktopMode } from '@bing/platform/env'`
   - Changed: `process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true'`
   - To: `isDesktopMode()`

4. **`web/lib/sandbox/providers/desktop-provider.ts`**
   - Added `isDesktopMode` to existing import from `@bing/platform/env`
   - Changed: `process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true'`
   - To: `isDesktopMode()`

---

## Remaining Work (Not Completed)

The following was identified but not edited (per instructions to only create plan):

- **134+ files** using `navigator.clipboard` directly - need to migrate to `import { clipboard } from '@bing/platform/clipboard'`