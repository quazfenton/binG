# WebSocket Terminal Integration Guide

## Overview

The WebSocket terminal is now available as the **DEFAULT** terminal connection method, replacing the event-based system.

## What Changed

### Backend (`lib/backend/websocket-terminal.ts`)
- ✅ JWT authentication required for all connections
- ✅ PTY resize support (SIGWINCH signals)
- ✅ Session management with limits
- ✅ Idle timeout cleanup

### Frontend Hook (`hooks/use-websocket-terminal.ts`)
- ✅ Auto-reconnection with exponential backoff
- ✅ JWT token authentication
- ✅ PTY resize commands
- ✅ Connection state management

## Integration into TerminalPanel.tsx

### Step 1: Import the Hook

```typescript
import { useWebSocketTerminal } from '@/hooks/use-websocket-terminal';
```

### Step 2: Replace Event-Based with WebSocket

**OLD (Event-Based):**
```typescript
// Send command via event
window.dispatchEvent(new CustomEvent('terminal-run-command', {
  detail: { command: 'ls -la' }
}));
```

**NEW (WebSocket - DEFAULT):**
```typescript
const { connect, disconnect, send, resize, state } = useWebSocketTerminal({
  sandboxId: activeSandboxId,
  autoConnect: true,
  onOutput: (data) => {
    terminalRef.current?.write(data);
  },
  onError: (error) => {
    toast.error(`Terminal error: ${error.message}`);
  },
});

// Send command
send('ls -la\n');

// Resize terminal
resize(80, 24);
```

### Step 3: Handle PTY Resize

```typescript
// When terminal resizes (window resize or manual)
const handleResize = useCallback((cols: number, rows: number) => {
  resize(cols, rows);
}, [resize]);

// Attach to xterm.js fit addon
fitAddon.on('resize', ({ cols, rows }) => {
  handleResize(cols, rows);
});
```

### Step 4: Connection UI

```typescript
// Show connection status
{state.connecting && (
  <div className="terminal-connecting">
    <Loader2 className="animate-spin" />
    Connecting to sandbox...
  </div>
)}

{state.connected && (
  <div className="terminal-connected">
    <Wifi className="text-green-500" />
    Connected
  </div>
)}

{!state.connected && !state.connecting && (
  <Button onClick={connect}>Reconnect</Button>
)}
```

## Migration Path

### Phase 1: Dual Support (Current)
- Keep event-based as fallback
- Try WebSocket first, fall back to events if unavailable
- Feature flag to toggle: `NEXT_PUBLIC_TERMINAL_MODE=websocket|event`

### Phase 2: WebSocket Default (Recommended)
```typescript
const terminalMode = process.env.NEXT_PUBLIC_TERMINAL_MODE || 'websocket';

if (terminalMode === 'websocket') {
  // Use WebSocket hook
  const { send, resize } = useWebSocketTerminal({ ... });
} else {
  // Fall back to event-based
  window.dispatchEvent(...);
}
```

### Phase 3: WebSocket Only (Future)
- Remove event-based code entirely
- Full PTY support
- Interactive apps (vim, nano, htop)

## Benefits

| Feature | Event-Based | WebSocket |
|---------|-------------|-----------|
| Real-time streaming | ❌ No | ✅ Yes |
| Interactive apps | ❌ Broken | ✅ Full support |
| PTY resize | ❌ No | ✅ Yes |
| Authentication | ⚠️ Headers | ✅ Built-in |
| Reconnection | ❌ Manual | ✅ Auto |
| Session persistence | ❌ No | ✅ Yes |

## Testing

```bash
# Start backend
npm run dev

# Open terminal in UI
# Should automatically connect via WebSocket

# Test interactive apps
vim test.txt  # Should work now!
nano test.txt  # Should work now!
htop  # Should work now!

# Test resize
# Resize browser window - terminal should adapt
```

## Troubleshooting

### Connection Fails
- Check WebSocket server is running: `lsof -i :8080`
- Verify JWT token in localStorage
- Check browser console for errors

### PTY Resize Not Working
- Ensure xterm.js fit addon is installed
- Check `resize()` is called on window resize
- Verify backend receives resize commands

### Authentication Fails
- Ensure token is valid JWT
- Check token expiration
- Verify token in localStorage: `localStorage.getItem('token')`

## Environment Variables

```bash
# WebSocket server port
WEBSOCKET_PORT=8080

# Frontend WebSocket URL (optional, defaults to localhost:8080)
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080

# Terminal mode (websocket|event)
NEXT_PUBLIC_TERMINAL_MODE=websocket
```

## Next Steps

1. ✅ **DONE:** Backend WebSocket server with auth
2. ✅ **DONE:** Frontend hook with reconnection
3. ⏳ **TODO:** Integrate into TerminalPanel.tsx
4. ⏳ **TODO:** Add connection status UI
5. ⏳ **TODO:** Test interactive apps (vim, nano)
6. ⏳ **TODO:** Add session persistence (localStorage)

---

**Status:** Backend + Hook Complete, Integration Pending
