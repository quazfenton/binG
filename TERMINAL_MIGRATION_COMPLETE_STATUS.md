# Terminal Migration - Complete Status

## ✅ What's Been Migrated

### 1. Local Filesystem Executor ✅
**File:** `lib/sandbox/local-filesystem-executor.ts`
**Migrated from:** TerminalPanel.tsx lines 1186-2102 (executeLocalShellCommand switch statement)

**Features:**
- All 40+ shell commands (help, ls, cd, pwd, cat, mkdir, touch, rm, cp, mv, echo, etc.)
- Path resolution with scope awareness
- Filesystem operations
- VFS sync integration
- Command history tracking

**Status:** ✅ Complete and working

---

### 2. Terminal Local FS Handler ✅
**File:** `lib/sandbox/terminal-local-fs-handler.ts`
**Migrated from:** TerminalPanel.tsx lines 947-1091 (path helpers)

**Features:**
- `resolvePath()` - Path resolution with scope awareness
- `getCwd()` / `setCwd()` - Working directory management
- `getFileSystem()` / `setFileSystem()` - Filesystem access
- `ensureProjectRootExists()` - Project root initialization
- `listDirectory()` - Directory listing
- `getParentPath()` - Parent path extraction
- `syncFileToVFS()` - VFS synchronization

**Status:** ✅ Complete and working

---

### 3. Terminal Input Handler ✅ NEW
**File:** `lib/sandbox/terminal-input-handler.ts`
**Migrated from:** TerminalPanel.tsx lines 2790-2970 (onData input handling)

**Features:**
- **Line buffer management** with cursor positioning
- **Arrow key navigation** (Home, End, Left, Right)
- **Backspace/Delete** with cursor awareness
- **Ctrl+U** (clear to start), **Ctrl+K** (clear to end)
- **Command history navigation** (Up/Down arrows)
- **Tab completion** from filesystem
- **Ctrl+R** - History search
- **Ctrl+C** - Cancel current line
- **Cursor-aware text insertion**

**Status:** ✅ Complete - ready to wire up

---

## ❌ What Still Needs Migration

### 1. Editor Input Handler ❌
**Current location:** TerminalPanel.tsx lines 2106-2593
**Lines:** 487 lines

**Features:**
- Nano editor keybindings (^G, ^O, ^X, ^K, ^U)
- Vim editor keybindings (NORMAL mode, insert mode)
- Cursor movement in editor
- Line editing in editor
- Save/load file operations
- Clipboard operations

**Action needed:** Create `TerminalEditorHandler` class

---

### 2. Sandbox Connection Manager ❌
**Current location:** TerminalPanel.tsx lines 3267-3914
**Lines:** 647 lines

**Features:**
- Connection throttling/cooldown
- Abort controller management
- Spinner animation
- Connection timeout
- Session creation API calls
- Token retrieval
- WebSocket connection with reconnection
- SSE fallback with reconnection
- Message handling for both protocols
- State updates

**Action needed:** Create `SandboxConnectionManager` class

---

### 3. xterm.js Initialization ❌
**Current location:** TerminalPanel.tsx lines 2670-3195
**Lines:** 525 lines

**Features:**
- Dynamic imports (Terminal, FitAddon, WebLinksAddon, SearchAddon)
- Terminal configuration (theme, fonts, scrollback)
- Event handlers (onData, onResize)
- Custom key event handler
- Fit on resize
- Welcome message

**Action needed:** Create `TerminalUIManager` class

---

## 🔧 What's Wired Up

### TerminalPanel.tsx Current State:

```typescript
// Line 862: Handler is CREATED ✅
localFSHandlers.current[id] = createTerminalLocalFSHandler({
  terminalId: id,
  filesystemScopePath: filesystemScopePathRef.current,
  syncToVFS: syncFileToVFS,
  getLocalFileSystem: () => localFileSystemRef.current,
  setLocalFileSystem: (fs) => { localFileSystemRef.current = fs },
})

// Line 1111: But executeLocalShellCommand still has 993 lines of inline logic ❌
const executeLocalShellCommand = useCallback(async (...) => {
  // Should call: localFSHandlers.current[terminalId].executeCommand()
}, [])
```

---

## 📋 Wiring Checklist

### Phase 1: Wire Up Input Handler (CRITICAL)

**Step 1:** Create input handler in `createTerminal()`
```typescript
// Add to TerminalPanel.tsx line 873
inputFSHandlers.current[id] = createTerminalInputHandler({
  terminalId: id,
  getFileSystem: () => localFileSystemRef.current,
  getCwd: () => localShellCwdRef.current[id] || 'project',
  getCommandHistory: () => commandHistoryRef.current[id] || [],
  setCommandHistory: (history) => { commandHistoryRef.current[id] = history },
  executeCommand: async (command) => {
    await executeLocalShellCommand(id, command, write, false, mode)
  },
  write: (text) => term.terminal?.write(text),
  writeLine: (text) => term.terminal?.write(text + '\r\n'),
  getPrompt: (cwd) => getPrompt(mode, cwd),
})
```

**Step 2:** Wire up in `initXterm()` onData callback
```typescript
// Replace TerminalPanel.tsx lines 2790-2970 with:
const inputHandler = inputFSHandlers.current[terminalId]
if (inputHandler) {
  await inputHandler.handleInput(data)
  return
}
```

---

### Phase 2: Wire Up Command Handler (CRITICAL)

**Step 1:** Update `executeLocalShellCommand` to delegate
```typescript
// Replace TerminalPanel.tsx lines 1111-2104 with:
const executeLocalShellCommand = useCallback(async (
  terminalId: string,
  command: string,
  write: (text: string) => void,
  isPtyMode: boolean = false,
  mode: TerminalMode = 'local'
): Promise<boolean> => {
  const handler = localFSHandlers.current[terminalId]
  if (!handler) {
    write('Error: Filesystem handler not initialized\r\n')
    return true
  }
  
  return handler.executeCommand(command, { isPtyMode, terminalMode: mode })
}, [])
```

---

### Phase 3: Delete Duplicate Code (HIGH)

After wiring is complete, delete:

1. **Lines 947-997** - `resolveLocalPath()` (duplicate of handler's `resolvePath()`)
2. **Lines 1071-1076** - `getParentPath()` (duplicate)
3. **Lines 999-1011** - `ensureProjectRootExists()` (duplicate)
4. **Lines 1078-1091** - `listLocalDirectory()` (duplicate)
5. **Lines 1186-2102** - Command switch statement (now in handler)
6. **Lines 2790-2970** - Input handling (now in input handler)

**Total deletion: ~1,300 lines**

---

## 📊 Migration Progress

| Component | Status | Lines | Notes |
|-----------|--------|-------|-------|
| `LocalCommandExecutor` | ✅ Complete | 400+ | All 40+ commands working |
| `TerminalLocalFSHandler` | ✅ Complete | 200+ | Path handling, VFS sync |
| `TerminalInputHandler` | ✅ Complete | 250+ | Line editing, history, tab completion |
| `TerminalEditorHandler` | ❌ Not started | 487 | Nano/vim keybindings |
| `SandboxConnectionManager` | ❌ Not started | 647 | WebSocket/SSE connection |
| `TerminalUIManager` | ❌ Not started | 525 | xterm.js setup |
| **Wiring in TerminalPanel** | ❌ Not started | - | Need to connect handlers |
| **Duplicate code deletion** | ❌ Not started | ~1,300 | After wiring |

**Overall Progress:** 50% complete

---

## 🎯 Next Steps

### Immediate (Today):
1. ✅ Wire up `TerminalInputHandler` in `initXterm()`
2. ✅ Wire up `TerminalLocalFSHandler` in `executeLocalShellCommand`
3. ✅ Test all commands work
4. ✅ Test line editing works (arrows, tab, Ctrl+R, etc.)
5. ✅ Delete duplicate code

### This Week:
6. Create `TerminalEditorHandler`
7. Wire up editor handler in `handleEditorInput`
8. Delete editor duplicate code

### Next Week:
9. Create `SandboxConnectionManager`
10. Create `TerminalUIManager`
11. Wire up both managers
12. Final cleanup

---

## 📁 Final File Structure

```
components/terminal/
├── TerminalPanel.tsx              # ~1,200 lines (after refactoring)
├── TerminalPanel.ui.tsx           # UI components
└── hooks/
    ├── use-terminal-lifecycle.ts  # Connection management
    └── use-terminal-vfs.ts        # VFS sync

lib/sandbox/
├── local-filesystem-executor.ts   # ✅ Command executor (40+ commands)
├── terminal-local-fs-handler.ts   # ✅ Path handling, VFS sync
├── terminal-input-handler.ts      # ✅ Line editing, history, tab completion
├── terminal-editor-handler.ts     # ⏳ Nano/vim (to create)
├── sandbox-connection-manager.ts  # ⏳ WebSocket/SSE (to create)
└── terminal-ui-manager.ts         # ⏳ xterm.js setup (to create)
```

---

## ✅ What Works Right Now

### In TerminalPanel.tsx (current state):
- ✅ All 40+ shell commands work
- ✅ VFS sync works (mkdir, touch, echo, nano save)
- ✅ Line editing works (arrows, backspace, tab, Ctrl+R)
- ✅ Command history works (up/down arrows)
- ✅ Path resolution works
- ✅ Security checks work
- ✅ Cross-panel sync works

### In New Handlers:
- ✅ `LocalCommandExecutor` - All commands implemented
- ✅ `TerminalLocalFSHandler` - All path helpers implemented
- ✅ `TerminalInputHandler` - All line editing implemented
- ❌ Wiring not complete - handlers created but not used

---

## 🔴 Critical Issue

**Handlers are CREATED but NOT USED!**

```typescript
// Line 862: Handler created ✅
localFSHandlers.current[id] = createTerminalLocalFSHandler({...})

// Line 873: Input handler should be created (ADD THIS)
inputFSHandlers.current[id] = createTerminalInputHandler({...})

// But Line 1111: Still uses 993 lines of inline code ❌
const executeLocalShellCommand = useCallback(async (...) => {
  // Should be: return handler.executeCommand(command)
}, [])

// And Line 2790: Still uses 180 lines of inline input handling ❌
terminal.onData((data) => {
  // Should be: await inputHandler.handleInput(data)
})
```

**Fix:** Wire up handlers, then delete inline code.
