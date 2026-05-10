---
id: sdk-terminal-and-sandbox-integration-review-technical-plan
title: Terminal & Sandbox Integration Review - Technical Plan
aliases:
  - TERMINAL_INTEGRATION_REVIEW
  - TERMINAL_INTEGRATION_REVIEW.md
  - terminal-and-sandbox-integration-review-technical-plan
  - terminal-and-sandbox-integration-review-technical-plan.md
tags:
  - terminal
  - review
layer: core
summary: "# Terminal & Sandbox Integration Review - Technical Plan\r\n\r\n## Executive Summary\r\n\r\nThis document details findings from a thorough review of the Terminal panel and sandbox integration, identifying UX flaws, backend issues, and missing seamless fallback functionality between PTY and non-PTY modes."
anchors:
  - Executive Summary
  - 1. CRITICAL ISSUES FOUND
  - 1.1 Missing sandbox-cmd Mode Implementation
  - 1.2 PTY Failure Doesn't Fall Back to Command-Mode
  - 1.3 Auto-Connect Race Condition
  - 1.4 Input Handling Issues
  - 1.5 Reconnection Cooldown Too Long
  - 2. BACKEND ISSUES
  - 2.1 Terminal Manager Command Mode Not Fully Integrated
  - 2.2 No Seamless Mode Switching
  - 2.3 EventSource Connection Error Handling
  - 3. UX FLAWS
  - 3.1 Local Shell Usable Before PTY Loads
  - 3.2 No Mode Indicator
  - 3.3 Connection Status Unclear
  - 3.4 Error Messages Not User-Friendly
  - 4. SECURITY CONCERNS
  - 4.1 Security Checks Disabled in PTY Mode
  - 4.2 No Input Validation in Command Mode
  - 5. PROPOSED FIXES
  - 5.1 Implement sandbox-cmd Mode
  - 5.2 Fix Fallback to Command-Mode
  - 5.3 Add Command-Mode Input Handler
  - 5.4 Add Mode Indicator to UI
  - 5.5 Reduce Reconnection Cooldown
  - 5.6 Fix Input Batching
  - 5.7 Add Proper Security in PTY Mode
  - 5.8 Add Local Shell Indicator Banner
  - 6. FILES TO MODIFY
  - 7. TESTING CHECKLIST
relations:
  - type: implements
    id: technical-review-terminalpanel-and-sandbox-integration
    title: 'Technical Review: TerminalPanel & Sandbox Integration'
    path: technical-review-terminalpanel-and-sandbox-integration.md
    confidence: 0.319
    classified_score: 0.297
    auto_generated: true
    generator: apply-classified-suggestions
---
# Terminal & Sandbox Integration Review - Technical Plan

## Executive Summary

This document details findings from a thorough review of the Terminal panel and sandbox integration, identifying UX flaws, backend issues, and missing seamless fallback functionality between PTY and non-PTY modes.

---

## 1. CRITICAL ISSUES FOUND

### 1.1 Missing sandbox-cmd Mode Implementation

**Issue**: TerminalPanel defines `'sandbox-cmd'` in TerminalMode type (line 34) but NEVER uses it.

```typescript
// Defined at line 34 but never set anywhere in the code
type TerminalMode = 'local' | 'connecting' | 'pty' | 'sandbox-cmd' | 'editor';
```

**Impact**: When PTY fails, TerminalPanel falls back to LOCAL browser simulation instead of using sandbox command-mode (line-based execution via TerminalManager).

**Evidence**:
- `terminal-manager.ts` lines 138-155: Command-mode fallback exists and sends message
- `TerminalPanel.tsx` line 1514-1534: On error, sets `mode: 'local'` instead of `'sandbox-cmd'`

### 1.2 PTY Failure Doesn't Fall Back to Command-Mode

**Current Behavior**:
1. User types "connect"
2. PTY connection fails OR provider doesn't support PTY
3. TerminalPanel sets mode to 'local' (browser simulation)
4. User loses access to actual sandbox

**Expected Behavior**:
1. User types "connect"
2. PTY connection fails OR provider doesn't support PTY
3. TerminalPanel switches to 'sandbox-cmd' mode
4. User gets line-based sandbox execution

### 1.3 Auto-Connect Race Condition

**Issue** (TerminalPanel.tsx line 267):
```typescript
setTimeout(() => connectTerminal(id), 500);
```

**Problems**:
- 500ms may not be enough for xterm initialization
- If connectTerminal fails, user is left in undefined state
- No visual feedback during auto-connect attempt

### 1.4 Input Handling Issues

**Issue** (TerminalPanel.tsx lines 1306-1334):
```typescript
// Flush after 16ms (one frame)
inputFlushRef.current[sessionId] = setTimeout(async () => {...}, 16);
```

**Problems**:
- 16ms is too fast for network latency
- Batching can cause keystroke lag perception
- No buffer overflow protection

### 1.5 Reconnection Cooldown Too Long

**Issue** (TerminalPanel.tsx line 1529):
```typescript
reconnectCooldownUntilRef.current[terminalId] = Date.now() + 30000;
```

**Problem**: 30-second cooldown is excessive for transient failures

---

## 2. BACKEND ISSUES

### 2.1 Terminal Manager Command Mode Not Fully Integrated

**Location**: `lib/sandbox/terminal-manager.ts` lines 138-155

The command-mode fallback sends a message but TerminalPanel doesn't recognize this mode.

### 2.2 No Seamless Mode Switching

The backend can detect when PTY isn't supported:
```typescript
// terminal-manager.ts line 138-156
if (!handle.createPty) {
  // Falls back to command mode but TerminalPanel doesn't know
}
```

### 2.3 EventSource Connection Error Handling

**Location**: `TerminalPanel.tsx` lines 1543-1548

```typescript
eventSource.onerror = () => {
  const currentTerm = terminalsRef.current.find(t => t.id === terminalId);
  if (currentTerm?.isConnected) {
    currentTerm.terminal?.writeln('\x1b[31m⚠ Connection lost. Reconnecting...\x1b[0m');
  }
};
```

**Issue**: Only reconnects if was previously connected, doesn't handle initial connection failures properly.

---

## 3. UX FLAWS

### 3.1 Local Shell Usable Before PTY Loads

**Current**: Local shell works immediately, but auto-connect can override it

**Fix Needed**: 
- Local shell should ALWAYS be usable
- PTY should overlay when ready
- Seamless switch between modes

### 3.2 No Mode Indicator

**Issue**: User can't tell if they're in local, pty, or command mode

**Fix**: Add mode indicator in terminal header

### 3.3 Connection Status Unclear

**Issue**: During "connecting" phase, user doesn't know what's happening

**Current Messages** (TerminalPanel.tsx lines 1368-1371):
```typescript
term.terminal?.writeln('');
term.terminal?.writeln('\x1b[33m⟳ Connecting to sandbox...\x1b[0m');
term.terminal?.writeln('\x1b[90mThis may take a moment on first connection.\x1b[0m');
```

**Problem**: Messages are overwritten by subsequent operations

### 3.4 Error Messages Not User-Friendly

**Current** (line 1583):
```typescript
term.terminal?.writeln(`\x1b[31m✗ Failed to connect: ${errMsg}\x1b[0m`);
```

**Problem**: Technical errors leak to users

---

## 4. SECURITY CONCERNS

### 4.1 Security Checks Disabled in PTY Mode

**Issue** (TerminalPanel.tsx lines 417-450):
```typescript
if (!isPtyMode) {
  const securityResult = checkCommandSecurity(trimmed);
  // ... security checks
}
```

**Problem**: When in PTY mode, all security checks are bypassed. Assumes PTY = sandbox = safe, but that's not always true.

### 4.2 No Input Validation in Command Mode

**Location**: `terminal-manager.ts` lines 296-330

The command-mode input handling doesn't validate commands before execution.

---

## 5. PROPOSED FIXES

### 5.1 Implement sandbox-cmd Mode

**Add to TerminalPanel.tsx**:

```typescript
// In terminal mode handling (around line 1150)
if (term.mode === 'sandbox-cmd' && term.sandboxInfo.sessionId) {
  // Forward to command-mode handler
  handleCommandModeInput(terminalId, data, term);
  return;
}
```

### 5.2 Fix Fallback to Command-Mode

**Replace lines 1514-1534 in TerminalPanel.tsx**:

```typescript
case 'error':
  currentTerm.terminal.writeln(`\x1b[31m${msg.data}\x1b[0m`);
  
  // Instead of falling back to local, try command-mode
  if (!currentTerm.isConnected) {
    // Attempt command-mode connection
    updateTerminalState(terminalId, {
      sandboxInfo: { sessionId, sandboxId, status: 'active' },
      isConnected: true,
      mode: 'sandbox-cmd',  // Changed from 'local'
    });
    
    const termMut = terminalsRef.current.find(t => t.id === terminalId);
    if (termMut) {
      termMut.sandboxInfo = { sessionId, sandboxId, status: 'active' };
      termMut.isConnected = true;
      termMut.mode = 'sandbox-cmd';
    }
    
    currentTerm.eventSource?.close();
    reconnectCooldownUntilRef.current[terminalId] = Date.now() + 5000; // Reduced to 5s
    
    currentTerm.terminal.writeln('\x1b[33m⚠ PTY unavailable. Falling back to command mode.\x1b[0m');
    currentTerm.terminal.writeln('\x1b[90mType "connect" to retry PTY.\x1b[0m');
    
    const cwd = localShellCwdRef.current[terminalId] || '/workspace';
    currentTerm.terminal.write(`\x1b[1;32m${cwd}$\x1b0m `);
  }
  break;
```

### 5.3 Add Command-Mode Input Handler

**Add new function in TerminalPanel.tsx**:

```typescript
const handleCommandModeInput = useCallback((
  terminalId: string,
  data: string,
  term: TerminalInstance
) => {
  let lineBuffer = lineBufferRef.current[terminalId] || '';
  
  if (data === '\r' || data === '\n') {
    term.terminal?.write('\r\n');
    const command = lineBuffer.trim();
    lineBufferRef.current[terminalId] = '';
    
    if (command) {
      // Queue command for execution via API
      commandQueueRef.current[terminalId] = [
        ...(commandQueueRef.current[terminalId] || []),
        command
      ];
      processCommandQueue(terminalId);
    }
    
    const cwd = term.sandboxInfo.sessionId || '/workspace';
    term.terminal?.write(`\x1b[1;32m${cwd}$\x1b[0m `);
    return;
  }
  
  if (data === '\u007f') { // Backspace
    if (lineBuffer.length > 0) {
      lineBufferRef.current[terminalId] = lineBuffer.slice(0, -1);
      term.terminal?.write('\b \b');
    }
    return;
  }
  
  if (data >= ' ') {
    lineBufferRef.current[terminalId] = lineBuffer + data;
    term.terminal?.write(data);
  }
}, []);
```

### 5.4 Add Mode Indicator to UI

**In terminal header section** (around line 80 in JSX):

```typescript
const getModeIndicator = () => {
  switch (terminal.mode) {
    case 'pty': return { icon: <TerminalIcon />, text: 'Sandbox (PTY)', color: 'text-green-500' };
    case 'sandbox-cmd': return { icon: <TerminalIcon />, text: 'Sandbox (CMD)', color: 'text-yellow-500' };
    case 'connecting': return { icon: <WifiOff />, text: 'Connecting...', color: 'text-yellow-500' };
    case 'local': return { icon: <TerminalIcon />, text: 'Local', color: 'text-gray-500' };
    default: return null;
  }
};
```

### 5.5 Reduce Reconnection Cooldown

**Change line 1529**:
```typescript
// From: 30000
// To: 5000 (5 seconds)
reconnectCooldownUntilRef.current[terminalId] = Date.now() + 5000;
```

### 5.6 Fix Input Batching

**Increase flush interval** (line 1316):
```typescript
// From: 16ms
// To: 50ms for better batching
inputFlushRef.current[sessionId] = setTimeout(async () => {...}, 50);
```

### 5.7 Add Proper Security in PTY Mode

**Enhance security check** (around line 1149):

```typescript
// PTY mode: forward raw bytes to sandbox, but still validate connection
if (term.mode === 'pty' && term.sandboxInfo.sessionId) {
  // Only forward if sandbox is verified active
  if (term.sandboxInfo.status === 'active') {
    void sendInput(term.sandboxInfo.sessionId, data);
  } else {
    // Buffer input until connected
    commandQueueRef.current[terminalId] = [
      ...(commandQueueRef.current[terminalId] || []),
      data
    ];
  }
  return;
}
```

### 5.8 Add Local Shell Indicator Banner

**Add at top of terminal when in local mode**:

```typescript
{activeTerminal?.mode === 'local' && (
  <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-3 py-1 text-xs text-yellow-500">
    ⚠ Local mode - Type "connect" for sandbox access
  </div>
)}
```

---

## 6. FILES TO MODIFY

1. **components/terminal/TerminalPanel.tsx**
   - Add sandbox-cmd mode handling
   - Fix fallback logic
   - Improve mode indicators
   - Reduce reconnection cooldown
   - Fix input batching

2. **lib/sandbox/terminal-manager.ts**
   - Add command-mode status reporting
   - Improve error messages

3. **app/api/sandbox/terminal/stream/route.ts**
   - Better error handling for PTY creation failures

---

## 7. TESTING CHECKLIST

- [ ] Local shell works immediately on terminal open
- [ ] Auto-connect attempts but doesn't block local shell
- [ ] When PTY fails, falls back to command-mode (not local)
- [ ] Command-mode executes actual sandbox commands
- [ ] Seamless switch between local/PTY/command modes
- [ ] Mode indicator shows current state
- [ ] Reconnection works after failures
- [ ] Security checks work in all modes
