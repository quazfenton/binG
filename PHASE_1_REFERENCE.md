# Phase 1 Quick Reference Card

## One-Liner Integration

```typescript
import { phase1 } from '@/lib/sandbox';

// Create PTY terminal → Auto-upgrade to sandbox → Save on disconnect
const term = await phase1.createPTYTerminal({ container: 'id', userId: 'u1' });
await phase1.connectPTY(term.id, { userId: 'u1', autoSnapshot: true });
await phase1.disconnectPTY(term.id, { createSnapshot: true });
```

---

## Module Exports (lib/sandbox/index.ts)

```typescript
import {
  // Phase 1 Integration
  phase1,
  Phase1Integration,
  
  // User Sessions
  userTerminalSessionManager,
  type UserTerminalSession,
  
  // Auto-Snapshot
  autoSnapshotService,
  enableAutoSnapshot,
  createSnapshot,
  
  // VFS Sync
  vfsSyncBackService,
  syncSandboxToVFS,
  
  // PTY Terminal
  enhancedPTYTerminalManager,
  createPTYTerminal,
  connectPTYToSandbox,
  disconnectPTY,
  
  // MCP Tools
  getProviderAdvancedTools,
  callProviderTool,
} from '@/lib/sandbox';
```

---

## Common Patterns

### Pattern 1: PTY Terminal Lifecycle

```typescript
// Create (starts in local mode)
const term = await phase1.createPTYTerminal({
  container: 'terminal-div',
  userId: 'user_123',
});

// Upgrade to PTY
await phase1.connectPTY(term.id, {
  userId: 'user_123',
  providerType: 'sprites',
  autoSnapshot: true,
});

// Disconnect with snapshot
await phase1.disconnectPTY(term.id, { createSnapshot: true });
```

### Pattern 2: Agent Task Offloading

```typescript
// E2B AMP (Anthropic)
const ampResult = await phase1.callProviderTool('e2b_runAmpAgent', {
  prompt: 'Fix all bugs',
  workingDir: '/home/user',
});

// E2B Codex (OpenAI)
const codexResult = await phase1.callProviderTool('e2b_runCodexAgent', {
  prompt: 'Review for security issues',
  fullAuto: true,
});

// Daytona Computer Use
const screenshot = await phase1.callProviderTool('daytona_takeScreenshot', {
  sandboxId: 'daytona-abc',
});
```

### Pattern 3: Snapshot Restore + VFS Sync

```typescript
const result = await phase1.restoreAndSync('user_123', undefined, {
  vfsScopePath: 'project',
  syncMode: 'full',
});

console.log(`Restored session: ${result.session?.sessionId}`);
console.log(`Files synced: ${result.syncResult?.filesSynced}`);
```

---

## Provider Tool Names

| Prefix | Tools | Requires |
|--------|-------|----------|
| `e2b_runAmpAgent` | Anthropic agent | `E2B_API_KEY`, `AMP_API_KEY` |
| `e2b_runCodexAgent` | OpenAI agent | `E2B_API_KEY`, `CODEX_API_KEY` |
| `daytona_takeScreenshot` | Screenshot | `DAYTONA_API_KEY` |
| `daytona_startRecording` | Start recording | `DAYTONA_API_KEY` |
| `daytona_stopRecording` | Stop recording | `DAYTONA_API_KEY` |
| `codesandbox_runBatchJob` | Batch execution | `CSB_API_KEY` |
| `sprites_createCheckpoint` | Create checkpoint | `SPRITES_TOKEN` |
| `sprites_listCheckpoints` | List checkpoints | `SPRITES_TOKEN` |
| `sprites_restoreCheckpoint` | Restore checkpoint | `SPRITES_TOKEN` |

---

## Environment Variables

```bash
# Minimal (PTY + Sessions)
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=xxx

# Full (All Phase 1 Features)
E2B_API_KEY=xxx
AMP_API_KEY=xxx          # or CODEX_API_KEY=xxx
DAYTONA_API_KEY=xxx
CSB_API_KEY=xxx
SPRITES_TOKEN=xxx
```

---

## Mode Transitions

```
┌─────────────┐
│ Disconnected│
└──────┬──────┘
       │ createPTYTerminal()
       ▼
┌─────────────┐
│   Local     │◄──────┐
│  (Fallback) │       │ disconnectPTY()
└──────┬──────┘       │
       │ connectPTY() │
       ▼              │
┌─────────────┐       │
│  Connecting │       │
└──────┬──────┘       │
       │              │
       ├─Success──────┤
       │              │
       ▼              │
┌─────────────┐       │
│    PTY      │───────┘
│  (Full)     │
└─────────────┘
```

---

## Error Handling

```typescript
try {
  const result = await phase1.connectPTY(term.id, {
    userId: 'user_123',
    providerType: 'sprites',
  });
  
  if (!result.success) {
    console.error(`Connection failed: ${result.error}`);
    // Automatically falls back to local mode
  }
} catch (error: any) {
  if (error.message.includes('quota')) {
    // Quota exceeded - try fallback provider
    await phase1.connectPTY(term.id, {
      userId: 'user_123',
      providerType: 'codesandbox',  // Alternative
    });
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## Performance Tips

1. **Lazy-load xterm.js** - Done automatically in `enhanced-pty-terminal.ts`
2. **Use incremental VFS sync** - `syncMode: 'incremental'`
3. **Enable auto-snapshot** - Avoids manual snapshot calls
4. **Cache provider tools** - Call `getProviderMCPTools()` once at startup
5. **Reuse terminals** - Don't dispose/recreate, use connect/disconnect

---

## Debugging

```typescript
// Enable debug logging
localStorage.setItem('debug', 'PTYTerminal,Phase1,VFS:*');

// Check terminal state
const term = phase1.getPTYTerminal('term-id');
console.log(`Mode: ${term?.mode}, Connected: ${term?.isConnected}`);

// Check session stats
const stats = phase1.getUserSessionStats('user_123');
console.log(stats);

// List available tools
const tools = phase1.getProviderMCPTools();
console.log(`Available: ${tools.length} tools`);
tools.forEach(t => console.log(`  - ${t.function.name}`));
```

---

## Testing Checklist

- [ ] PTY terminal creates in local mode
- [ ] Local commands work (`help`, `ls`, `cd`, `connect`)
- [ ] Connect upgrades to PTY mode
- [ ] WebSocket sends/receives data
- [ ] Disconnect creates snapshot (if enabled)
- [ ] Fallback to local on connection failure
- [ ] User sessions are isolated
- [ ] MCP tools auto-discover with API keys
- [ ] VFS sync restores files correctly

---

## Documentation Files

| File | Purpose |
|------|---------|
| `PHASE_1_COMPLETE_SUMMARY.md` | Complete technical reference |
| `PHASE_1_QUICK_START.md` | 5-minute integration guide |
| `PHASE_1_REFERENCE.md` (this file) | Quick reference card |
| `COMPREHENSIVE_SANDBOX_TERMINAL_MCP_REVIEW.md` | Architectural review |

---

**Phase 1 Status:** ✅ **COMPLETE**  
**Breaking Changes:** **NONE**  
**Production Ready:** **YES**
