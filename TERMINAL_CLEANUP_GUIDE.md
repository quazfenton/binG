# TerminalPanel.tsx Cleanup Guide

**Date:** 2026-03-10
**Target File:** `components/terminal/TerminalPanel.tsx`
**Current Lines:** 4,668
**Target Lines:** ~1,900
**Reduction:** 58%

---

## ⚠️ IMPORTANT: Read Before Proceeding

This cleanup removes **2,701 lines** of inline code that has been migrated to handlers. The handlers are already wired up and working, so this cleanup is **safe** but should be done carefully.

### Pre-Cleanup Checklist

- [ ] All handlers created and exported from `lib/sandbox/index.ts`
- [ ] Handlers wired in `TerminalPanel.tsx` via `wireTerminalHandlers()`
- [ ] Terminal basic functionality tested (commands, line editing, connection)
- [ ] Git commit created before cleanup (for easy rollback)

---

## Phase 1: Delete handleEditorInput (478 lines)

**Lines:** 2212-2690
**Replacement:** Comment pointing to handler

### Before:
```typescript
// Line 2211
}, [resolveLocalPath, userId, updateTerminalState, syncFileToVFS]);

const handleEditorInput = useCallback((
  terminalId: string,
  input: string,
  write: (text: string) => void
) => {
  // ... 478 lines of nano/vim editor logic ...
}, [updateTerminalState, syncFileToVFS]);

// Line 2691
const sendInput = useCallback(async (sessionId: string, data: string) => {
```

### After:
```typescript
// Line 2211
}, [resolveLocalPath, userId, updateTerminalState, syncFileToVFS]);

// handleEditorInput migrated to TerminalEditorHandler
// See: lib/sandbox/terminal-editor-handler.ts (529 lines)
// Wired in: initXterm() onData callback → handlers.editor.handleInput()

// Line 2214
const sendInput = useCallback(async (sessionId: string, data: string) => {
```

**Verification:**
- Editor still works via `handlers.editor.handleInput()` in `initXterm()`
- Nano keybindings (^G, ^O, ^X, ^K, ^U) work
- Vim keybindings (:q, :w, :wq) work

---

## Phase 2: Delete Inline Input Handling in initXterm() (353 lines)

**Lines:** 2847-3200
**Replacement:** Handler delegation (already wired)

### Current State (lines 2847-2870):
```typescript
terminal.onData((data: string) => {
  updateActivity();

  const term = terminalsRef.current.find(t => t.id === terminalId);
  if (!term) return;

  const handlers = terminalHandlersRef.current[terminalId];

  // PTY mode: forward to connection manager
  if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
    if (term.sandboxInfo.status === 'active') {
      if (handlers) {
        handlers.batcher.batch(data);
      } else {
        void sendInput(term.sandboxInfo.sessionId, data);
      }
    } else {
      commandQueueRef.current[terminalId] = [
        ...(commandQueueRef.current[terminalId] || []),
        data
      ];
    }
    return;
  }

  // Sandbox command-mode
  if (term.mode === 'sandbox-cmd' && term.sandboxInfo.sessionId) {
    handleSandboxCmdInput(terminalId, data, term);
    return;
  }

  // Editor mode - use handler
  const session = editorSessionRef.current[terminalId];
  if (session) {
    if (handlers) {
      handlers.editor.handleInput(data);
    } else {
      handleEditorInput(terminalId, data, (text) => term.terminal?.write(text));
    }
    return;
  }

  // Local mode - use input handler
  if (handlers) {
    handlers.input.handleInput(data);
    return;
  }

  // FALLBACK: Inline input handling (to be removed)
  // Use ref for lineBuffer and cursor position to survive reconnects
  let lineBuffer = lineBufferRef.current[terminalId] || '';
  let cursorPos = cursorPosRef.current[terminalId] ?? lineBuffer.length;

  if (data === '\u001b[H') {
    // Home key - move cursor to start
    cursorPos = 0;
    cursorPosRef.current[terminalId] = 0;
    const prompt = getPrompt(term.mode, localShellCwdRef.current[terminalId] || 'project');
    term.terminal?.write(`\r${prompt}${lineBuffer}\x1b[${prompt.length + 1}G`);
    return;
  }

  // ... 300+ more lines of inline input handling ...
});
```

### After Cleanup:
```typescript
terminal.onData((data: string) => {
  updateActivity();

  const term = terminalsRef.current.find(t => t.id === terminalId);
  if (!term) return;

  const handlers = terminalHandlersRef.current[terminalId];

  // PTY mode: forward to connection manager
  if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
    if (term.sandboxInfo.status === 'active') {
      handlers?.batcher.batch(data);
    } else {
      commandQueueRef.current[terminalId] = [
        ...(commandQueueRef.current[terminalId] || []),
        data
      ];
    }
    return;
  }

  // Sandbox command-mode
  if (term.mode === 'sandbox-cmd' && term.sandboxInfo.sessionId) {
    handleSandboxCmdInput(terminalId, data, term);
    return;
  }

  // Editor mode - use handler
  const session = editorSessionRef.current[terminalId];
  if (session) {
    handlers?.editor.handleInput(data);
    return;
  }

  // Local mode - use input handler
  handlers?.input.handleInput(data);
});
```

**Verification:**
- Line editing works (arrows, backspace, tab)
- History navigation works (up/down arrows)
- Tab completion works
- Ctrl+R history search works
- Ctrl+U/K line clearing works

---

## Phase 3: Simplify executeLocalShellCommand (967 lines)

**Lines:** 1230-2197
**Replacement:** Handler delegation

### Before:
```typescript
const executeLocalShellCommand = useCallback(async (
  terminalId: string,
  command: string,
  write: (text: string) => void,
  isPtyMode: boolean = false,
  mode: TerminalMode = 'local'
): Promise<boolean> => {
  // Security checks
  if (!isPtyMode) {
    const securityResult = checkCommandSecurity(command);
    if (!securityResult.allowed) {
      write(formatSecurityWarning(securityResult));
      return true;
    }
  }

  const trimmed = command.trim();
  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  const args = trimmed.split(/\s+/).slice(1);
  const arg1 = args[0] || '';
  const arg2 = args[1] || '';
  const allArgs = args.join(' ');
  const cwd = localShellCwdRef.current[terminalId] || 'project';
  const fs = localFileSystemRef.current;

  const writeLine = (text: string) => {
    write(text + '\r\n');
    return true;
  };

  const writeError = (text: string) => {
    write(`\x1b[31m${text}\x1b[0m\r\n`);
    return true;
  };

  // 900+ lines of switch-case for 40+ commands...
  switch (cmd) {
    case 'help': {
      // ...
    }
    case 'ls': {
      // ...
    }
    // ... 38 more cases
  }
}, [resolveLocalPath, userId, updateTerminalState, syncFileToVFS]);
```

### After:
```typescript
const executeLocalShellCommand = useCallback(async (
  terminalId: string,
  command: string,
  write: (text: string) => void,
  isPtyMode: boolean = false,
  mode: TerminalMode = 'local'
): Promise<boolean> => {
  const handler = terminalHandlersRef.current[terminalId]?.localFS;
  if (!handler) {
    write('Error: Filesystem handler not initialized\r\n');
    return true;
  }

  return handler.executeCommand(command, {
    isPtyMode,
    terminalMode: mode,
  });
}, [terminalHandlersRef]);
```

**Verification:**
- All 40+ commands still work (ls, cd, mkdir, touch, rm, cp, mv, echo, etc.)
- Security checks still block dangerous commands
- VFS sync still works on file create/modify
- Command history still tracked

---

## Phase 4: Simplify connectTerminal (733 lines)

**Lines:** 3310-4043
**Replacement:** Handler delegation

### Before:
```typescript
const connectTerminal = useCallback(async (terminalId: string) => {
  const term = terminalsRef.current.find(t => t.id === terminalId);
  if (!term) return;

  // Check reconnection cooldown
  const reconnectAllowedAt = reconnectCooldownUntilRef.current[terminalId] || 0;
  if (Date.now() < reconnectAllowedAt) {
    const remaining = Math.ceil((reconnectAllowedAt - Date.now()) / 1000);
    term.terminal?.writeln(`\x1b[33mReconnect cooldown: ${remaining}s remaining.\x1b[0m`);
    return;
  }

  // Abort any existing connection
  connectAbortRef.current[terminalId]?.abort();
  const abortController = new AbortController();
  connectAbortRef.current[terminalId] = abortController;

  updateTerminalState(terminalId, { mode: 'connecting' });

  // Show spinner
  const spinnerInterval = setInterval(() => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const frame = frames[Math.floor(Date.now() / 100) % frames.length];
    term.terminal?.write(`\r${frame} Connecting to sandbox...`);
  }, 100);

  // 600+ more lines of connection logic...
}, [updateTerminalState, sendResize, sendInput]);
```

### After:
```typescript
const connectTerminal = useCallback(async (terminalId: string) => {
  const handler = terminalHandlersRef.current[terminalId]?.connection;
  if (!handler) {
    logger.error('Connection handler not found');
    return;
  }

  await handler.connect();
}, [terminalHandlersRef]);
```

**Verification:**
- WebSocket connection works
- SSE fallback works
- Reconnection with exponential backoff works
- Connection timeout works
- Spinner animation shows during connection

---

## Phase 5: Delete Duplicate Path Helpers (163 lines)

**Lines:** 1065-1228
**Replacement:** Use handler's methods

### Functions to Delete:

1. **resolveLocalPath** (lines 1065-1097, 33 lines)
```typescript
const resolveLocalPath = useCallback((cwd: string, input: string): string => {
  // ... path resolution logic ...
}, []);
```

2. **ensureProjectRootExists** (lines 1114-1126, 13 lines)
```typescript
const ensureProjectRootExists = useCallback(() => {
  // ... project root initialization ...
}, []);
```

3. **getParentPath** (lines 1191-1203, 13 lines)
```typescript
const getParentPath = (path: string): string => {
  // ... parent path extraction ...
};
```

4. **listLocalDirectory** (lines 1205-1228, 24 lines)
```typescript
const listLocalDirectory = (dirPath: string): string[] => {
  // ... directory listing ...
};
```

### Replacement:
All path operations now handled by `TerminalLocalFSHandler.resolvePath()`

**Note:** Update any remaining references to use handler methods:
- `resolveLocalPath(cwd, input)` → `handler.localFS.resolvePath(input)`
- `listLocalDirectory(path)` → `handler.localFS.listDirectory(path)`

---

## Post-Cleanup Verification

### Run These Commands in Terminal:

```bash
# 1. Basic commands
ls -la
mkdir test-dir
cd test-dir
touch test.txt
echo "hello world" > greeting.txt
cat greeting.txt
cd ..
rm -rf test-dir

# 2. Line editing
# Type: ls -la (use left arrow to move cursor, backspace to delete)
# Type: mkdir test (use up arrow to recall from history)
# Type: cd (press tab for completion)

# 3. Editor
nano test.txt
# Press ^G for help
# Press ^X to exit

# 4. Connection
connect
# Should show connection spinner and connect to sandbox

# 5. Security (should be blocked)
rm -rf /etc/passwd
```

### Expected Results:
- ✅ All commands execute successfully
- ✅ Line editing works smoothly
- ✅ Editor opens and responds to keybindings
- ✅ Connection shows spinner and connects (or falls back to command-mode)
- ✅ Dangerous commands blocked with security warning

---

## Rollback Instructions

If cleanup breaks functionality:

```bash
# 1. Revert to pre-cleanup commit
git checkout <commit-hash-before-cleanup> -- components/terminal/TerminalPanel.tsx

# 2. Verify functionality restored
npm run dev
# Test terminal in browser

# 3. Debug handler wiring if needed
# Check that handlers are created in createTerminal()
# Check that handlers are called in initXterm() onData
```

---

## Cleanup Script (Automated)

For automated cleanup, run:

```bash
# Create backup first
cp components/terminal/TerminalPanel.tsx components/terminal/TerminalPanel.tsx.backup

# Run cleanup script (to be created)
node scripts/cleanup-terminal-panel.js

# Verify line count
wc -l components/terminal/TerminalPanel.tsx
# Should show ~1,900 lines (down from 4,668)
```

---

## Summary

| Phase | Lines Deleted | Function | Replacement |
|-------|---------------|----------|-------------|
| 1 | 478 | handleEditorInput | TerminalEditorHandler |
| 2 | 353 | initXterm input handling | TerminalInputHandler |
| 3 | 967 | executeLocalShellCommand | LocalCommandExecutor |
| 4 | 733 | connectTerminal | SandboxConnectionManager |
| 5 | 163 | Path helpers | TerminalLocalFSHandler |
| **Total** | **2,694** | **Inline code** | **9 handlers** |

**Result:** TerminalPanel.tsx reduced from 4,668 → ~1,974 lines (58% reduction)
