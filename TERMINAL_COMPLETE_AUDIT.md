# TerminalPanel.tsx - Complete Functionality Audit

## Executive Summary

**Total Lines:** 4,543  
**Analyzed:** 100%  
**Critical Missing Functionality Identified:** ✅

---

## 🚨 CRITICAL: What You're Right About - I Was Missing

### **1. Editor Session Management** (Lines 2106-2593) - 487 lines
**COMPLETE nano/vim editor implementation:**

```typescript
interface EditorSession {
  type: 'nano' | 'vim' | 'vi'
  filePath: string
  content: string
  cursor: number
  lines: string[]
  cursorLine: number
  cursorCol: number
  originalContent: string
  clipboard: string
}
```

**Features:**
- ✅ **Nano keybindings:**
  - `^G` - Help
  - `^O` - Save (WriteOut)
  - `^X` - Exit
  - `^K` - Cut line
  - `^U` - Paste (Uncut)
  - `^Y` - Previous page
  - `^C` - Show cursor position
  - `^F` - Search
  - `^R` - Insert file
  - `^W` - Where is (search)
  - `^Q` - Quit
  - `^S` - Save

- ✅ **Vim keybindings:**
  - NORMAL mode
  - Insert mode
  - `:q` - Quit
  - `:w` - Write
  - `:wq` / `:x` - Write and quit
  - `:wq!` - Force write and quit

- ✅ **Editor features:**
  - Line-by-line editing with cursor
  - Scroll offset for long files
  - Display 15 lines at a time
  - Status bar with line/col info
  - Modified buffer detection
  - Save confirmation on exit (`^X` when modified)
  - Clipboard operations (cut/paste)
  - File insertion (`^R`)

**This is NOT in any handler!**

---

### **2. Sandbox Connection Logic** (Lines 3267-3914) - 647 lines
**COMPLETE connection management:**

**Features:**
- ✅ **Connection throttling** (5 second cooldown between attempts)
- ✅ **Abort controller** for cancellation
- ✅ **Spinner animation** during connection
- ✅ **Connection timeout** (10 seconds, then fallback)
- ✅ **Session creation** (`POST /api/sandbox/terminal`)
- ✅ **Token retrieval** (`POST /api/sandbox/terminal/stream`)
- ✅ **WebSocket connection** with full message handling:
  - `connected` - Sandbox ready
  - `pty` - Terminal output
  - `agent:tool_start` - Agent tool execution
  - `agent:tool_result` - Tool execution result
  - `agent:complete` - Agent finished
  - `port_detected` - Preview URL available
  - `ping` - Keepalive
  - `error` - Connection error

- ✅ **Reconnection logic** with exponential backoff:
  - 5 max reconnection attempts
  - Initial delay: 1 second
  - Exponential: 1s, 2s, 4s, 8s, 16s
  - Tracks if connection was ever successful (`wsWasOpen`)
  - Immediate fallback if never connected

- ✅ **SSE fallback** when WebSocket unavailable
- ✅ **Auto-cd to workspace** on connection
- ✅ **Command queue** for buffered input during connection
- ✅ **Auth handling** (JWT token, anonymous session)
- ✅ **Error handling** with proper cleanup

**Message handlers for:**
- Agent tool execution display
- Port detection with toast notifications
- Preview URL display
- Ping/pong keepalive

**This is NOT in any handler!**

---

### **3. Input Batching for WebSocket** (Lines 2595-2641)
**Optimized input sending:**

```typescript
const sendInput = useCallback(async (sessionId: string, data: string) => {
  // Batch input to reduce HTTP overhead
  inputBatchRef.current[terminalId] += data
  
  // Debounce sending
  if (inputFlushRef.current[terminalId]) {
    clearTimeout(inputFlushRef.current[terminalId])
  }
  
  inputFlushRef.current[terminalId] = setTimeout(() => {
    const batch = inputBatchRef.current[terminalId]
    if (batch && term.websocket) {
      term.websocket.send(JSON.stringify({ type: 'input', data: batch }))
    }
    inputBatchRef.current[terminalId] = ''
  }, 16) // ~60fps
}, [])
```

**This is NOT in any handler!**

---

### **4. Resize Handling** (Lines 2643-2668)
**Terminal resize with sandbox sync:**

```typescript
const sendResize = useCallback((sessionId: string, cols: number, rows: number) => {
  // Send resize to sandbox via WebSocket or API
  if (term.websocket) {
    term.websocket.send(JSON.stringify({ type: 'resize', cols, rows }))
  } else {
    fetch(`/api/sandbox/terminal/resize`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, cols, rows })
    })
  }
}, [])
```

**This is NOT in any handler!**

---

### **5. xterm.js Full Initialization** (Lines 2670-3195) - 525 lines
**COMPLETE terminal setup:**

**Features:**
- ✅ **Dynamic imports:**
  - `@xterm/xterm` - Terminal core
  - `@xterm/addon-fit` - Auto-fit to container
  - `@xterm/addon-web-links` - Clickable URLs
  - `@xterm/addon-search` - Search functionality

- ✅ **Theme configuration:**
  - 16 ANSI colors (black, red, green, yellow, blue, magenta, cyan, white)
  - Bright variants
  - Custom cursor color
  - Selection background

- ✅ **Terminal configuration:**
  - `cursorBlink: true`
  - `fontSize: 13`
  - `fontFamily: "Cascadia Code", "Fira Code", "JetBrains Mono", ...`
  - `scrollback: 10000`
  - `convertEol: true`
  - `allowProposedApi: true`

- ✅ **Event handlers:**
  - `onData()` - All input processing (lines 2790-2970)
  - `onResize()` - Send resize to sandbox
  - `attachCustomKeyEventHandler()` - Intercept special keys

- ✅ **Custom key event handler:**
  - Suppress Ctrl combinations in editor mode
  - Allow arrow keys to pass through
  - Editor mode detection

- ✅ **Welcome message:**
  - "Terminal Ready"
  - "Initializing workspace..."
  - "Type 'connect' to connect to sandbox"

**This is PARTIALLY in TerminalUIManager (needs completion)**

---

### **6. Sandbox Command-Mode Input** (Lines 3197-3238)
**Line-based execution for sandbox-cmd mode:**

```typescript
const handleSandboxCmdInput = useCallback((
  terminalId: string,
  data: string,
  term: TerminalInstance
) => {
  // Line buffer for command-mode
  const lineBuffer = lineBufferRef.current[terminalId] || ''
  
  if (data === '\r' || data === '\n') {
    // Execute command via API
    sendInput(term.sandboxInfo.sessionId, command + '\n')
  }
  
  // Handle backspace, tab, Ctrl+C
  // History navigation (up/down arrows)
}, [])
```

**This is NOT in any handler!**

---

### **7. Terminal Lifecycle Management** (Lines 4005-4129)
**Complete terminal operations:**

- ✅ `clearTerminal()` - Clear terminal output
- ✅ `copyOutput()` - Copy selection or full buffer
- ✅ `pasteFromClipboard()` - Paste from clipboard
- ✅ `selectAll()` - Select all visible content
- ✅ `killTerminal()` - Kill sandbox and close terminal
- ✅ `killAllTerminals()` - Close all terminals
- ✅ `toggleSplitView()` - Enable/disable split view

**This is NOT in any handler!**

---

### **8. Context Menu & UI** (Lines 4068-4214)
**Terminal UI features:**

- ✅ Context menu (right-click)
- ✅ Selection mode toggle
- ✅ Mode indicator (Local, Connecting, Connected, Command Mode, Editor)
- ✅ Terminal tabs with status indicators
- ✅ Tab close buttons
- ✅ Keyboard shortcuts

**This is UI - should stay in TerminalPanel**

---

### **9. Health Checks** (Lines 3916-3956)
**Periodic connection monitoring:**

```typescript
useEffect(() => {
  const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
  
  const healthCheckInterval = setInterval(() => {
    terminalsRef.current.forEach(term => {
      if (term.mode === 'pty' && term.isConnected && term.websocket) {
        if (term.websocket.readyState === WebSocket.CLOSED) {
          // Trigger reconnection
          logger.warn('Terminal health check: WebSocket closed')
        }
      }
    })
  }, HEALTH_CHECK_INTERVAL)
  
  return () => clearInterval(healthCheckInterval)
}, [])
```

**This is NOT in any handler!**

---

### **10. Terminal State Persistence** (Lines 476-534)
**localStorage persistence:**

```typescript
// Save terminal state on unmount
useEffect(() => {
  const saveState = () => {
    const state = {
      commandHistory: commandHistoryRef.current,
      sandboxConnected: sandboxStatus === 'connected',
      timestamp: Date.now(),
    }
    localStorage.setItem('terminal-state', JSON.stringify(state))
  }
  
  window.addEventListener('beforeunload', saveState)
  return () => window.removeEventListener('beforeunload', saveState)
}, [])
```

**Features:**
- Command history persistence
- Sandbox connection state
- Auto-restore on page reload

**This is NOT in any handler!**

---

## 📊 Complete Functionality Breakdown

| Feature | Lines | Status | In Handler? |
|---------|-------|--------|-------------|
| **Local Shell Commands** | 993 | ✅ Working | ✅ LocalCommandExecutor |
| **Path Resolution** | 150 | ✅ Working | ✅ TerminalLocalFSHandler |
| **Line Input Editing** | 180 | ✅ Working | ✅ TerminalInputHandler |
| **Editor (nano/vim)** | 487 | ✅ Working | ❌ NOT MIGRATED |
| **Sandbox Connection** | 647 | ✅ Working | ❌ NOT MIGRATED |
| **xterm.js Init** | 525 | ✅ Working | ⚠️ PARTIAL |
| **Input Batching** | 50 | ✅ Working | ❌ NOT MIGRATED |
| **Resize Handling** | 30 | ✅ Working | ❌ NOT MIGRATED |
| **Command-Mode Input** | 50 | ✅ Working | ❌ NOT MIGRATED |
| **Health Checks** | 50 | ✅ Working | ❌ NOT MIGRATED |
| **State Persistence** | 60 | ✅ Working | ❌ NOT MIGRATED |
| **Terminal Lifecycle** | 150 | ✅ Working | ❌ NOT MIGRATED |
| **UI & Context Menu** | 200 | ✅ Working | N/A (UI) |
| **VFS Sync** | 100 | ✅ Working | ✅ In handlers |
| **Security Checks** | 50 | ✅ Working | ✅ In handlers |

---

## ✅ What's Been Migrated

| Handler | File | Lines | Features |
|---------|------|-------|----------|
| `LocalCommandExecutor` | `local-filesystem-executor.ts` | 400+ | 40+ shell commands |
| `TerminalLocalFSHandler` | `terminal-local-fs-handler.ts` | 200+ | Path handling, VFS sync |
| `TerminalInputHandler` | `terminal-input-handler.ts` | 250+ | Line editing, history |

**Total Migrated:** 850 lines (18.7%)

---

## ❌ What Still Needs Migration

| Handler | File | Lines | Features |
|---------|------|-------|----------|
| `TerminalEditorHandler` | **CREATE** | 487 | Nano/vim editor |
| `SandboxConnectionManager` | **CREATE** | 647 | WebSocket/SSE connection |
| `TerminalInputBatcher` | **CREATE** | 50 | Input batching, resize |
| `TerminalHealthMonitor` | **CREATE** | 50 | Health checks |
| `TerminalStateManager` | **CREATE** | 60 | State persistence |
| `TerminalUIManager` | **EXPAND** | 300+ | xterm.js init, lifecycle |

**Total To Migrate:** 1,587 lines (34.9%)

---

## 🎯 Recommended Handler Structure

```typescript
// lib/sandbox/terminal-editor-handler.ts
export class TerminalEditorHandler {
  open(filePath: string): void
  handleInput(input: string): void
  save(): void
  exit(): void
  // ... all nano/vim keybindings
}

// lib/sandbox/sandbox-connection-manager.ts
export class SandboxConnectionManager {
  connect(terminalId: string): Promise<void>
  disconnect(terminalId: string): void
  reconnect(terminalId: string): void
  sendInput(sessionId: string, data: string): void
  sendResize(sessionId: string, cols: number, rows: number): void
  // ... WebSocket/SSE handling
}

// lib/sandbox/terminal-input-batcher.ts
export class TerminalInputBatcher {
  batch(terminalId: string, data: string): void
  flush(terminalId: string): void
  // ... debounced sending
}

// lib/sandbox/terminal-health-monitor.ts
export class TerminalHealthMonitor {
  start(): void
  stop(): void
  check(terminalId: string): void
  // ... periodic health checks
}

// lib/sandbox/terminal-state-manager.ts
export class TerminalStateManager {
  save(): void
  restore(): void
  // ... localStorage persistence
}
```

---

## 📋 Migration Priority

### CRITICAL (Must Have):
1. ✅ `LocalCommandExecutor` - DONE
2. ✅ `TerminalLocalFSHandler` - DONE
3. ✅ `TerminalInputHandler` - DONE
4. ❌ `TerminalEditorHandler` - 487 lines
5. ❌ `SandboxConnectionManager` - 647 lines

### HIGH (Should Have):
6. ❌ `TerminalInputBatcher` - 50 lines
7. ❌ `TerminalUIManager` (expand) - 300 lines

### MEDIUM (Nice to Have):
8. ❌ `TerminalHealthMonitor` - 50 lines
9. ❌ `TerminalStateManager` - 60 lines

### LOW (Can Stay in TerminalPanel):
- UI rendering (context menu, tabs, indicators)
- Lifecycle operations (clear, copy, paste, kill)

---

## 🔧 What Can Be Deleted After Migration

After all handlers are created and wired:

1. **Lines 1186-2102** - Command switch (916 lines) → `LocalCommandExecutor`
2. **Lines 2106-2593** - Editor handling (487 lines) → `TerminalEditorHandler`
3. **Lines 2790-2970** - Input handling (180 lines) → `TerminalInputHandler`
4. **Lines 3267-3914** - Connection logic (647 lines) → `SandboxConnectionManager`
5. **Lines 2595-2668** - Batching/resize (80 lines) → `TerminalInputBatcher`
6. **Lines 3916-3956** - Health checks (50 lines) → `TerminalHealthMonitor`
7. **Lines 476-534** - State persistence (60 lines) → `TerminalStateManager`

**Total Deletable:** 2,420 lines (53.3% reduction)

**Remaining:** 2,123 lines (mostly UI, which is appropriate for a component)

---

## 📁 Final Architecture

```
TerminalPanel.tsx (2,123 lines)
├── UI Rendering (tabs, context menu, indicators)
├── Lifecycle (clear, copy, paste, kill)
└── Handler Orchestration
    ├── TerminalInputHandler (line editing)
    ├── LocalCommandExecutor (shell commands)
    ├── TerminalLocalFSHandler (path/VFS)
    ├── TerminalEditorHandler (nano/vim) ← TO CREATE
    ├── SandboxConnectionManager (connection) ← TO CREATE
    ├── TerminalInputBatcher (batching) ← TO CREATE
    ├── TerminalHealthMonitor (health) ← TO CREATE
    └── TerminalStateManager (persistence) ← TO CREATE
```

---

## ✅ Summary

**You were absolutely right.** I was missing:

1. **Editor handling** (487 lines) - Complete nano/vim implementation
2. **Connection management** (647 lines) - WebSocket/SSE with reconnection
3. **Input batching** (50 lines) - Optimized sending
4. **Resize handling** (30 lines) - Terminal resize sync
5. **Health monitoring** (50 lines) - Periodic connection checks
6. **State persistence** (60 lines) - localStorage save/restore
7. **Command-mode input** (50 lines) - Line-based sandbox execution
8. **xterm.js full init** (525 lines) - Complete terminal setup

**Total missing:** 1,899 lines of critical functionality

These need to be extracted into handlers before the migration is complete.
