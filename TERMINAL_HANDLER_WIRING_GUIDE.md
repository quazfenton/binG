# Terminal Handler Migration Guide

## Overview

All TerminalPanel.tsx functionality has been extracted into reusable handlers. This guide shows how to wire them up.

---

## 📦 New Handler Files Created

| Handler | File | Lines | Features |
|---------|------|-------|----------|
| `LocalCommandExecutor` | `local-filesystem-executor.ts` | 400+ | 40+ shell commands |
| `TerminalLocalFSHandler` | `terminal-local-fs-handler.ts` | 200+ | Path handling, VFS sync |
| `TerminalInputHandler` | `terminal-input-handler.ts` | 250+ | Line editing, history, tab completion |
| `TerminalEditorHandler` | `terminal-editor-handler.ts` | 487 | Nano/vim editor |
| `SandboxConnectionManager` | `sandbox-connection-manager.ts` | 647 | WebSocket/SSE connection |
| `TerminalInputBatcher` | `terminal-input-batcher.ts` | 50 | Input batching, resize |
| `TerminalHealthMonitor` | `terminal-health-monitor.ts` | 50 | Health checks |
| `TerminalStateManager` | `terminal-state-manager.ts` | 60 | State persistence |

**Total:** 2,184 lines of reusable, testable code

---

## 🔧 Wiring Guide

### Step 1: Create Handlers in `createTerminal()`

```typescript
// TerminalPanel.tsx - In createTerminal() callback

// Create terminal instance
const id = generateSecureId('terminal')
const newTerminal: TerminalInstance = { ... }

// Set default cwd
localShellCwdRef.current[id] = filesystemScopePathRef.current || 'project'

// CREATE HANDLERS
const handlers = {
  // Local filesystem handler
  localFS: createTerminalLocalFSHandler({
    terminalId: id,
    filesystemScopePath: filesystemScopePathRef.current,
    syncToVFS: syncFileToVFS,
    getLocalFileSystem: () => localFileSystemRef.current,
    setLocalFileSystem: (fs) => { localFileSystemRef.current = fs },
  }),

  // Input handler
  input: createTerminalInputHandler({
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
  }),

  // Editor handler
  editor: createTerminalEditorHandler({
    terminalId: id,
    filePath: '',
    content: '',
    write: (text) => term.terminal?.write(text),
    writeLine: (text) => term.terminal?.write(text + '\r\n'),
    getPrompt: (cwd) => getPrompt('editor', cwd),
    syncToVFS: syncFileToVFS,
    updateTerminalState: (updates) => updateTerminalState(id, updates),
    getCwd: () => localShellCwdRef.current[id] || 'project',
    getFileSystem: () => localFileSystemRef.current,
    setFileSystem: (fs) => { localFileSystemRef.current = fs },
  }),

  // Connection manager
  connection: createSandboxConnectionManager({
    terminalId: id,
    write: (text) => term.terminal?.write(text),
    writeLine: (text) => term.terminal?.write(text + '\r\n'),
    updateTerminalState: (updates) => updateTerminalState(id, updates),
    sendResize: sendResize,
    sendInput: sendInput,
    getPrompt: getPrompt,
    getCwd: () => localShellCwdRef.current[id] || 'project',
    setCwd: (cwd) => { localShellCwdRef.current[id] = cwd },
    getAuthToken: getAuthToken,
    getAuthHeaders: getAuthHeaders,
    toSandboxScopedPath: toSandboxScopedPath,
    filesystemScopePath: filesystemScopePathRef.current,
    getAnonymousSessionId: getAnonymousSessionId,
  }),

  // Input batcher
  batcher: createTerminalInputBatcher({
    terminalId: id,
    sendInput: sendInput,
    sendResize: sendResize,
  }),

  // Health monitor
  health: createTerminalHealthMonitor({
    getTerminals: () => terminalsRef.current,
    updateTerminalState: (terminalId, updates) => updateTerminalState(terminalId, updates),
    writeLine: (terminalId, text) => {
      const t = terminalsRef.current.find(t => t.id === terminalId)
      t?.terminal?.write(text + '\r\n')
    },
  }),

  // State manager
  state: createTerminalStateManager({
    getCommandHistory: () => commandHistoryRef.current,
    getSandboxStatus: () => sandboxStatus,
    restoreCommandHistory: (history) => { commandHistoryRef.current = history },
    restoreSandboxStatus: (status) => { setSandboxStatus(status) },
  }),
}

// Store handlers
terminalHandlersRef.current[id] = handlers

// Setup auto-save
const cleanupAutoSave = handlers.state.setupAutoSave()
terminalHandlersRef.current[id].cleanupAutoSave = cleanupAutoSave
```

---

### Step 2: Wire Up in `initXterm()`

```typescript
// TerminalPanel.tsx - In initXterm() onData callback

terminal.onData((data: string) => {
  // Update idle timeout
  updateActivity()

  const term = terminalsRef.current.find(t => t.id === terminalId)
  if (!term) return

  // Get handlers
  const handlers = terminalHandlersRef.current[terminalId]
  if (!handlers) return

  // PTY mode: forward to connection manager
  if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
    if (term.sandboxInfo.status === 'active') {
      handlers.batcher.batch(data)
    } else {
      // Queue for later
      commandQueueRef.current[terminalId] = [
        ...(commandQueueRef.current[terminalId] || []),
        data
      ]
    }
    return
  }

  // Sandbox command-mode
  if (term.mode === 'sandbox-cmd' && term.sandboxInfo.sessionId) {
    handleSandboxCmdInput(terminalId, data, term)
    return
  }

  // Editor mode
  const editorSession = handlers.editor.getSession()
  if (editorSession) {
    handlers.editor.handleInput(data)
    return
  }

  // Local mode - use input handler
  handlers.input.handleInput(data)
})
```

---

### Step 3: Wire Up `executeLocalShellCommand`

```typescript
// TerminalPanel.tsx - Replace executeLocalShellCommand

const executeLocalShellCommand = useCallback(async (
  terminalId: string,
  command: string,
  write: (text: string) => void,
  isPtyMode: boolean = false,
  mode: TerminalMode = 'local'
): Promise<boolean> => {
  // Get handler
  const handler = terminalHandlersRef.current[terminalId]?.localFS
  if (!handler) {
    write('Error: Filesystem handler not initialized\r\n')
    return true
  }

  // Execute via handler
  return handler.executeCommand(command, {
    isPtyMode,
    terminalMode: mode,
  })
}, [])
```

---

### Step 4: Wire Up `connectTerminal`

```typescript
// TerminalPanel.tsx - Replace connectTerminal

const connectTerminal = useCallback(async (terminalId: string) => {
  // Get handler
  const handler = terminalHandlersRef.current[terminalId]?.connection
  if (!handler) {
    logger.error('Connection handler not found')
    return
  }

  // Connect via handler
  await handler.connect()
}, [])
```

---

### Step 5: Wire Up `handleEditorInput`

```typescript
// TerminalPanel.tsx - Replace handleEditorInput

const handleEditorInput = useCallback((
  terminalId: string,
  input: string,
  write: (text: string) => void
) => {
  // Get handler
  const handler = terminalHandlersRef.current[terminalId]?.editor
  if (!handler) return

  // Handle via handler
  handler.handleInput(input)
}, [])
```

---

### Step 6: Wire Up `sendInput` and `sendResize`

```typescript
// TerminalPanel.tsx - Replace sendInput

const sendInput = useCallback(async (sessionId: string, data: string) => {
  // Find terminal for session
  const term = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId)
  if (!term) return

  // Get batcher
  const batcher = terminalHandlersRef.current[term.id]?.batcher
  if (batcher) {
    batcher.batch(data)
  } else {
    // Fallback to direct send
    // ... existing WebSocket/SSE logic
  }
}, [])

// Replace sendResize
const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
  // Find terminal for session
  const term = terminalsRef.current.find(t => t.sandboxInfo.sessionId === sessionId)
  if (!term) return

  // Get batcher
  const batcher = terminalHandlersRef.current[term.id]?.batcher
  if (batcher) {
    batcher.sendResize(cols, rows)
  } else {
    // Fallback to direct send
    // ... existing WebSocket/SSE logic
  }
}, [])
```

---

### Step 7: Start Health Monitor

```typescript
// TerminalPanel.tsx - Add useEffect

useEffect(() => {
  // Start health monitoring
  const healthMonitor = terminalHandlersRef.current[activeTerminalId]?.health
  if (healthMonitor) {
    healthMonitor.start()
  }

  return () => {
    // Stop health monitoring
    if (healthMonitor) {
      healthMonitor.stop()
    }
  }
}, [activeTerminalId])
```

---

### Step 8: Save/Restore State

```typescript
// TerminalPanel.tsx - Add useEffect for restore

useEffect(() => {
  // Restore state on mount
  const handler = terminalHandlersRef.current[activeTerminalId]?.state
  if (handler) {
    handler.restore()
  }
}, [])

// Add save on unmount
useEffect(() => {
  return () => {
    // Save state on unmount
    const handler = terminalHandlersRef.current[activeTerminalId]?.state
    if (handler) {
      handler.save()
    }
  }
}, [activeTerminalId])
```

---

### Step 9: Cleanup on Close

```typescript
// TerminalPanel.tsx - In closeTerminal()

const closeTerminal = useCallback((terminalId: string) => {
  const terminal = terminalsRef.current.find(t => t.id === terminalId)
  if (terminal) {
    // Cleanup handlers
    const handlers = terminalHandlersRef.current[terminalId]
    if (handlers) {
      // Stop health monitor
      handlers.health?.stop()

      // Flush input batcher
      handlers.batcher?.flush()

      // Disconnect connection manager
      handlers.connection?.disconnect()

      // Cleanup auto-save
      if (handlers.cleanupAutoSave) {
        handlers.cleanupAutoSave()
      }
    }

    // Delete handlers
    delete terminalHandlersRef.current[terminalId]

    // ... existing cleanup
  }

  // ... existing close logic
}, [])
```

---

## 📊 Deletable Code After Wiring

After all handlers are wired up, delete these from TerminalPanel.tsx:

| Section | Lines | Delete To |
|---------|-------|-----------|
| `executeLocalShellCommand` switch | 1186-2102 | Replace with handler call |
| `handleEditorInput` | 2106-2593 | Replace with handler call |
| `connectTerminal` | 3267-3914 | Replace with handler call |
| Input handling in `initXterm` | 2790-2970 | Replace with handler call |
| `sendInput` batching | 2595-2641 | Use batcher |
| `sendResize` | 2643-2668 | Use batcher |
| Health check useEffect | 3916-3956 | Use health monitor |
| State persistence useEffect | 476-534 | Use state manager |

**Total deletable:** ~2,420 lines (53.3% reduction)

---

## ✅ Testing Checklist

After wiring:

- [ ] All 40+ shell commands work (ls, cd, mkdir, touch, rm, cp, mv, echo, etc.)
- [ ] Line editing works (arrows, backspace, tab, Ctrl+R, Ctrl+U, Ctrl+K)
- [ ] Command history works (up/down arrows)
- [ ] Tab completion works
- [ ] Nano editor works (^G, ^O, ^X, ^K, ^U)
- [ ] Vim editor works (:q, :w, :wq, :x)
- [ ] Sandbox connection works (WebSocket and SSE)
- [ ] Reconnection works with exponential backoff
- [ ] Health checks run every 30 seconds
- [ ] State persists across page reloads
- [ ] VFS sync works (mkdir, touch, echo, nano save)
- [ ] Cross-panel sync works (filesystem-updated events)

---

## 🎯 Benefits

### Before (Monolithic):
- 4,543 lines in single file
- Hard to test
- Hard to maintain
- Duplicated logic

### After (Modular):
- ~2,100 lines in TerminalPanel (UI only)
- 2,184 lines in reusable handlers
- Each handler independently testable
- Clear separation of concerns
- Easy to maintain and extend

---

## 📁 Final File Structure

```
lib/sandbox/
├── local-filesystem-executor.ts      # 400+ lines - Shell commands
├── terminal-local-fs-handler.ts      # 200+ lines - Path/VFS
├── terminal-input-handler.ts         # 250+ lines - Line editing
├── terminal-editor-handler.ts        # 487 lines - Nano/vim
├── sandbox-connection-manager.ts     # 647 lines - WebSocket/SSE
├── terminal-input-batcher.ts         # 50 lines - Batching
├── terminal-health-monitor.ts        # 50 lines - Health checks
├── terminal-state-manager.ts         # 60 lines - Persistence
└── index.ts                          # Exports all handlers

components/terminal/
└── TerminalPanel.tsx                 # ~2,100 lines (after cleanup)
    └── Uses all handlers above
```

---

## 🚀 Next Steps

1. Wire up all handlers in TerminalPanel.tsx
2. Test all functionality
3. Delete inline code (2,420 lines)
4. Write unit tests for each handler
5. Document handler APIs

**Estimated time:** 4-6 hours for complete migration
