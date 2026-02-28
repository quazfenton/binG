# TerminalPanel.tsx & Sandbox Integration Review

## Implementation Status: FIXED (v2)

The following issues have been addressed in the latest implementation:

### ✓ Fixed Issues

1. **Keystroke Buffering** - Now buffers locally, sends complete command on Enter
2. **Command History** - Up/Down arrow navigation with storage
3. **Expanded Local Commands** - mkdir, mv, rm, cp, touch, echo, rmdir, etc.
4. **Text Editors** - nano/vim/vi simulated editors
5. **Mode Indicators** - Visual status for local/connecting/PTY/editor modes
6. **Reconnection Queue** - Commands queued during reconnection
7. **Better Layout** - Improved status bar and command visibility

---

## Issue 1: Frontend Input Sends Every Keystroke to Backend (CRITICAL)

### Location: `TerminalPanel.tsx:458-460`

```typescript
if (term.sandboxInfo.sessionId) {
  sendInput(term.sandboxInfo.sessionId, data);
}
```

### Problem
When the sandbox is connected (PTY mode), **every single keystroke** is sent immediately to the backend via `sendInput()`. This is wrong because:

1. The terminal shows "project$ " prompt but users can't type a full command
2. Each character triggers a separate API call to `/api/sandbox/terminal/input`
3. The user sees the prompt but typing produces no visible feedback because input goes to the backend PTY, not the local display

### Why It Appears to Work Sometimes
The code does have local line-editor logic (lines 414-454) that handles the `status === 'none'` or `!isConnected` case. However, once connected:
- All keystrokes go to the PTY
- The PTY may not echo back characters properly
- The user experience is broken

### Fix Required
1. Buffer keystrokes locally and only send to PTY when Enter is pressed
2. OR: Always use local line editing and send complete commands to backend for execution
3. Add visual indicator when in PTY mode vs local mode

---

## Issue 2: No Proper Fallback Chain with User Feedback

### Problem
The backend has fallback logic (`core-sandbox-service.ts:149-191`) that tries multiple providers:

```typescript
for (const providerType of candidateTypes) {
  try {
    handle = await this.createSandboxWithProvider(providerType, userId, config)
    // ...
  } catch (providerError) {
    // Try next
  }
}
```

**But the frontend UX doesn't communicate this to users:**

1. No visible progress when Daytona is being created
2. No indication that fallback to Microsandbox is happening
3. No clear error messages when all providers fail
4. Silent failures - errors go to console, not UI

### Fix Required
1. Add progress states: "Connecting to Daytona..." → "Daytona unavailable, trying Microsandbox..." → "Using local fallback"
2. Show clear error messages in terminal when providers fail
3. Implement the nonPTY command mode earlier - don't wait for PTY to fail

---

## Issue 3: Microsandbox Daemon Not Running (Port 5555)

### Location: `microsandbox-daemon.ts:4`

```typescript
const DEFAULT_SERVER_URL = process.env.MSB_SERVER_URL || 'http://127.0.0.1:5555'
```

### Problem
The Microsandbox provider expects a daemon running on port 5555:

```typescript
// microsandbox-provider.ts:45
await ensureMicrosandboxDaemonRunning()
```

**When the daemon isn't running:**
- The code has a local fallback (`LocalSandboxHandle` in `microsandbox-provider.ts:305-421`)
- But `ensureMicrosandboxDaemonRunning()` throws before the fallback can be used
- The local fallback is NOT sandboxed - it's dangerous for production

### Fix Required
1. Fix `ensureMicrosandboxDaemonRunning()` to properly handle the case when daemon can't start
2. Don't expose `LocalSandboxHandle` as a fallback - it defeats the purpose of sandboxing
3. Document that Microsandbox requires `msb server start --dev` to be run

---

## Issue 4: Daytona Provider Timeouts

### Location: `daytona-provider.ts:68-71`

```typescript
const sandbox = await this.client.create(createParams)

await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
return new DaytonaSandboxHandle(sandbox, this.client)
```

### Problem
After creating the sandbox, the code immediately runs `executeCommand` synchronously. This can timeout because:
1. Sandbox may not be fully initialized
2. Network latency
3. No retry logic

### Fix Required
1. Add retry logic with exponential backoff
2. Wait for sandbox to be fully ready before running commands
3. Increase timeout or make it configurable

---

## Issue 5: Command History Not Visible

### Location: `TerminalPanel.tsx` (status bar at line 1081-1087)

```typescript
<span>
  {activeTerminal.isConnected
    ? `PTY ${activeTerminal.terminal?.cols || 0}×${activeTerminal.terminal?.rows || 0}`
    : 'Local shell mode (sandbox reconnecting)'
  }
</span>
```

### Problem
1. The terminal has scrollback configured (`scrollback: 10000` at line 363)
2. But there's no Up/Down arrow key handling for command history
3. The storage layer has `addCommandToHistory()` but it's never called from the terminal component
4. Users can't see previous commands

### Fix Required
1. Add Up/Down arrow key handling to navigate command history
2. Store commands in history when executed
3. Display command history indicator

---

## Issue 6: NonPTY Command Mode is Hidden/Broken

### Location: `terminal-manager.ts:119-137`

```typescript
if (!handle.createPty) {
  commandModeConnections.set(sessionId, { ... })
  onData('\r\n\x1b[33m[command-mode] PTY unavailable, using line-based execution.\x1b[0m\r\n')
  onData(`${handle.workspaceDir || '/workspace'} $ `)
  return 'command-mode'
}
```

### Problem
When PTY is unavailable (e.g., Microsandbox doesn't support PTY), the code falls back to command mode, BUT:

1. The frontend code at line 133-134 sends prompt to terminal but doesn't indicate how to use it
2. The terminal may already be showing "project$ " from local shell mode
3. Users are confused about which prompt to use
4. Command mode buffer handling may conflict with local shell buffer

### Fix Required
1. Always use local line editing until sandbox is confirmed ready
2. Show clear message when switching to command mode
3. Don't show multiple conflicting prompts

---

## Issue 7: Reconnection Logic Has Race Conditions

### Location: `TerminalPanel.tsx:406-456`

```typescript
if (term.sandboxInfo.status === 'none' || !term.isConnected) {
  const reconnectAllowedAt = reconnectCooldownUntilRef.current[terminalId] || 0;
  if (term.sandboxInfo.status !== 'creating' && Date.now() >= reconnectAllowedAt) {
    connectTerminal(terminalId);
  }
  // Local line-editor mode...
}
```

### Problems
1. **Race condition**: If user types while reconnection happens, input may be lost
2. **No queue**: Commands typed during reconnection aren't queued for execution after connection
3. **5-second cooldown** (`reconnectCooldownUntilRef`): Too aggressive, leaves users waiting
4. **No max retries**: Infinite reconnection attempts

### Fix Required
1. Queue commands during reconnection
2. Implement exponential backoff for retries
3. Add max retry limit with clear error after exhaustion

---

## Issue 8: Layout & UX Problems

### Location: `TerminalPanel.tsx:909-911`

```typescript
className={`fixed bottom-0 left-0 right-0 z-50 bg-black/95 border-t border-white/10 backdrop-blur-sm flex flex-col ${
  isExpanded ? 'h-[80vh]' : 'h-[55vh] sm:h-[400px]'
}`}
```

### Problems
1. **Terminal at bottom**: Input line is often below the fold
2. **No scroll indicator**: Users don't know they can scroll up
3. **Status bar at very bottom**: Takes up space when terminal is small
4. **Hidden tabs on mobile**: Terminal tabs are `hidden sm:flex`

### Fix Required
1. Move input area to top or make terminal height auto-expand when typing
2. Add scroll-to-bottom indicator
3. Show command history count/position

---

## Issue 9: Type Safety Issues

### Location: Multiple files

```typescript
// TerminalPanel.tsx:38-40
terminal: any | null;      // xterm Terminal instance
fitAddon: any | null;       // FitAddon instance
```

```typescript
// microsandbox-provider.ts:66
const createOptions: any = {
```

### Fix Required
1. Add proper xterm.js type imports
2. Remove `any` types and use proper interfaces

---

## Issue 10: Missing Error Boundaries

### Problem
The terminal component has no error boundary. If xterm.js fails to load or render, the entire panel crashes.

### Fix Required
1. Add React error boundary around terminal initialization
2. Show recovery UI when errors occur

---

## Recommendations Summary

### Priority 1 (Critical - Breaks Core Functionality)
1. **Fix keystroke sending**: Buffer input locally, send on Enter only
2. **Add proper fallback UX**: Show clear messages when providers fail
3. **Fix Microsandbox daemon**: Don't crash when daemon unavailable

### Priority 2 (Major UX Issues)
4. **Add command history**: Up/Down arrow navigation
5. **Fix command mode visibility**: Make it clear and usable
6. **Improve reconnection**: Queue commands, add backoff

### Priority 3 (Polish)
7. **Fix layout**: Better input visibility
8. **Add error boundaries**: Crash recovery
9. **Type safety**: Remove `any` types

---

## Proposed Architecture Fix

```
┌─────────────────────────────────────────────────────────────────┐
│                     TerminalPanel.tsx                           │
├─────────────────────────────────────────────────────────────────┤
│  State: mode = 'local' | 'connecting' | 'pty' | 'command-mode' │
│                                                                  │
│  local (default):                                               │
│    - Buffer keystrokes in preConnectLineBufferRef              │
│    - Show "project$ " prompt                                    │
│    - On Enter: executeLocalShellCommand() or queue for PTY     │
│                                                                  │
│  connecting (sandbox being created):                            │
│    - Show progress message                                      │
│    - Continue buffering local input                             │
│                                                                  │
│  pty (PTY connected):                                           │
│    - Buffer locally, send full command on Enter                │
│    - Show connected indicator                                   │
│                                                                  │
│  command-mode (PTY unavailable):                               │
│    - Buffer locally, send full command on Enter                │
│    - Show "command-mode" indicator                              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Changes Needed

1. **Frontend**: Always buffer input locally, only send complete commands
2. **Frontend**: Add explicit mode states and UI indicators
3. **Frontend**: Add command history with arrow keys
4. **Backend**: Make provider fallback more robust
5. **Backend**: Handle Microsandbox daemon unavailability gracefully

---

## Security Considerations

The local shell simulation includes a "First Line of Defense" security layer that blocks obviously malicious commands.

### Blocked Patterns

**File Destruction:**
- `rm -rf /` - Root filesystem deletion
- `rm -rf ./*` - Recursive delete in current directory
- `format C:` - Windows drive format

**Privilege Escalation:**
- `sudo`, `su root`, `chown root:`
- `chmod 777`

**Network Exfiltration:**
- `nc -e`, `ncat -e` - Netcat with execute
- `curl ... | bash` - Download and execute
- `/dev/tcp/` - Raw TCP access

**Credential Theft:**
- `cat /etc/passwd`, `cat /etc/shadow`
- `.ssh/id_rsa` - SSH key access
- `printenv` - Environment dump

**Shell Escapes:**
- `vim -c '!/bin/sh'`, `less !`
- `awk 'system()'`, `sed ... /bin/`

**Python Sandbox Escapes:**
- `eval()`, `exec()`, `compile()`
- `import os`, `__import__('os')`
- `__builtins__`, `__subclasses__()`
- Base64 encoded payloads

### Important Notes

1. **This is NOT foolproof** - Sophisticated attackers can bypass word-based blocks using obfuscation
2. **Real security comes from OS-level isolation**:
   - Use E2B, Firecracker MicroVM, or similar sandboxing solutions
   - Set up network egress filtering (sandbox can only talk to your server)
   - Mount filesystem as Read-Only except for `/workspace`
   - Never pass host environment variables to sandbox

### Files

- `lib/terminal/terminal-security.ts` - Security blocklist module
- `components/terminal/TerminalPanel.tsx` - Integrated security checks
