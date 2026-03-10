# Phase 1 Quick Start Guide

## 5-Minute Integration

### 1. Basic User Session with Auto-Snapshot

```typescript
import { phase1 } from '@/lib/sandbox';

// In your chat/terminal component
async function handleNewSession(userId: string) {
  const session = await phase1.createUserSession(userId, {
    providerType: 'sprites',  // Supports snapshots
    autoSnapshot: true,
  });
  
  console.log(`Session created: ${session.sessionId}`);
  console.log(`Sandbox ID: ${session.sandboxId}`);
}
```

### 2. Disconnect with Auto-Snapshot

```typescript
async function handleDisconnect(sessionId: string) {
  const result = await phase1.disconnectSession(sessionId, {
    createSnapshot: true,  // Auto-save state
    reason: 'user_request',
  });
  
  if (result.snapshotId) {
    console.log(`Snapshot created: ${result.snapshotId}`);
  }
}
```

### 3. Restore from Snapshot

```typescript
async function handleRestore(userId: string) {
  const result = await phase1.restoreAndSync(userId, undefined, {
    vfsScopePath: 'project',
    syncMode: 'full',
  });
  
  if (result.session) {
    console.log(`Restored session: ${result.session.sessionId}`);
    console.log(`Files synced: ${result.syncResult?.filesSynced}`);
  }
}
```

### 4. Use Provider MCP Tools

```typescript
import { phase1 } from '@/lib/sandbox';

// Get available tools
const tools = phase1.getProviderMCPTools();
console.log(`Available: ${tools.length} tools`);

// Run E2B AMP Agent (if E2B_API_KEY + AMP_API_KEY set)
const ampResult = await phase1.callProviderTool('e2b_runAmpAgent', {
  prompt: 'Fix all bugs in the codebase',
  workingDir: '/home/user',
});

if (ampResult.success) {
  console.log(`AMP result: ${ampResult.output}`);
} else {
  console.error(`AMP failed: ${ampResult.error}`);
}

// Take Daytona screenshot (if DAYTONA_API_KEY set)
const screenshotResult = await phase1.callProviderTool('daytona_takeScreenshot', {
  sandboxId: 'daytona-abc123',
});

if (screenshotResult.success) {
  console.log(`Screenshot: ${screenshotResult.metadata?.imageUrl}`);
}
```

---

## Common Patterns

### Pattern 1: Session Lifecycle with Auto-Snapshot

```typescript
import { phase1 } from '@/lib/sandbox';

class TerminalSessionManager {
  private session?: UserTerminalSession;
  
  async start(userId: string) {
    this.session = await phase1.createUserSession(userId, {
      providerType: 'sprites',
      autoSnapshot: true,
      restoreFromSnapshot: true,  // Auto-restore if exists
    });
    
    await phase1.enableAutoSnapshot(this.session.sessionId, {
      onDisconnect: true,
      onIdleTimeout: true,
      periodicInterval: 30 * 60 * 1000,  // 30 min
    });
  }
  
  async stop() {
    if (this.session) {
      await phase1.disconnectSession(this.session.sessionId, {
        createSnapshot: true,
      });
    }
  }
  
  async restore(userId: string) {
    const result = await phase1.restoreAndSync(userId, undefined, {
      vfsScopePath: 'project',
    });
    
    if (result.session) {
      this.session = result.session;
    }
  }
}
```

### Pattern 2: Provider Fallback on Quota Exceeded

```typescript
import { userTerminalSessionManager } from '@/lib/sandbox';

async function createSessionWithFallback(userId: string) {
  try {
    // Try preferred provider first
    return await userTerminalSessionManager.createSession({
      userId,
      providerType: 'sprites',
    });
  } catch (error: any) {
    if (error.message.includes('quota')) {
      // Automatically falls back to next available provider
      console.log('Sprites over quota, trying fallback...');
      
      return await userTerminalSessionManager.createSession({
        userId,
        providerType: 'codesandbox',  // Next in chain
      });
    }
    throw error;
  }
}
```

### Pattern 3: Incremental VFS Sync

```typescript
import { vfsSyncBackService } from '@/lib/sandbox';

async function syncChangedFilesOnly(sessionId: string) {
  const result = await vfsSyncBackService.syncSandboxToVFS(sessionId, {
    vfsScopePath: 'project',
    syncMode: 'incremental',  // Only changed files
    includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js'],
    excludePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.test.ts',
    ],
    maxFileSize: 5 * 1024 * 1024,  // 5MB
  });
  
  console.log(`Synced: ${result.filesSynced} files`);
  console.log(`Skipped: ${result.metadata?.skippedFiles} unchanged`);
  console.log(`Failed: ${result.metadata?.failedFiles}`);
}
```

### Pattern 4: Batch Execution with CodeSandbox

```typescript
import { phase1 } from '@/lib/sandbox';

async function runParallelTests(files: Array<{path: string; content: string}>) {
  const tasks = files.map((file, i) => ({
    id: `test-${i}`,
    command: `npm test -- ${file.path}`,
    files: [file],
  }));
  
  const result = await phase1.callProviderTool('codesandbox_runBatchJob', {
    tasks,
    maxConcurrent: 10,
    timeout: 300000,
  });
  
  if (result.success) {
    const output = JSON.parse(result.output);
    console.log(`Total: ${output.totalTasks}`);
    console.log(`Passed: ${output.successfulTasks}`);
    console.log(`Failed: ${output.failedTasks}`);
  }
}
```

---

## Environment Setup

### Minimal (User Sessions + Auto-Snapshot)

```bash
# .env.local
SPRITES_TOKEN=your_sprites_token  # For snapshot support
```

### Full (All Provider Tools)

```bash
# .env.local
# E2B Agent Offloading
E2B_API_KEY=your_e2b_key
AMP_API_KEY=your_anthropic_key  # For AMP (Anthropic)
CODEX_API_KEY=your_openai_key   # For Codex (OpenAI)

# Daytona Computer Use
DAYTONA_API_KEY=your_daytona_key

# CodeSandbox Batch
CSB_API_KEY=your_csb_key

# Sprites Checkpoints
SPRITES_TOKEN=your_sprites_token
```

---

## API Reference

### UserTerminalSessionManager

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `createSession` | `CreateSessionOptions` | `Promise<UserTerminalSession>` | Create user-scoped session |
| `disconnectSession` | `sessionId, DisconnectSessionOptions` | `Promise<{success, snapshotId?}>` | Disconnect with optional snapshot |
| `restoreFromSnapshot` | `userId, snapshotId?` | `Promise<RestoreResult>` | Restore from latest/specific snapshot |
| `getUserSessions` | `userId` | `UserTerminalSession[]` | Get all user sessions |
| `createSessionSnapshot` | `sessionId, name?, reason` | `Promise<string>` | Create manual snapshot |
| `syncSandboxToVFS` | `sessionId, vfsSyncFn` | `Promise<{success, filesSynced}>` | Sync sandbox → VFS |

### AutoSnapshotService

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `enableForSession` | `sessionId, AutoSnapshotConfig` | `Promise<{success, error?}>` | Enable auto-snapshot |
| `disableForSession` | `sessionId` | `void` | Disable auto-snapshot |
| `createSnapshot` | `sessionId, name?, reason` | `Promise<{success, snapshotId?}>` | Create manual snapshot |
| `restoreSnapshot` | `snapshotId, sessionId?` | `Promise<{success, error?}>` | Restore from snapshot |
| `listSnapshots` | `sessionId` | `SnapshotMetadata[]` | List session snapshots |
| `isSnapshotSupported` | `providerType` | `boolean` | Check provider support |

### VFSyncBackService

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `syncSandboxToVFS` | `sessionId, VFSyncConfig` | `Promise<VFSyncResult>` | Sync sandbox → VFS |
| `getSyncStatus` | `sessionId` | `VFSyncStatus?` | Get sync progress |
| `cancelSync` | `sessionId` | `boolean` | Cancel active sync |
| `clearSyncHistory` | `sessionId?` | `void` | Clear sync history |

### Phase1Integration (Singleton: `phase1`)

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `createUserSession` | `userId, options?` | `Promise<UserTerminalSession>` | Create session |
| `disconnectSession` | `sessionId, options?` | `Promise<{success, snapshotId?}>` | Disconnect |
| `enableAutoSnapshot` | `sessionId, config?` | `Promise<{success, error?}>` | Enable snapshots |
| `createSnapshot` | `sessionId, name?` | `Promise<{success, snapshotId?}>` | Create snapshot |
| `restoreAndSync` | `userId, snapshotId?, vfsConfig?` | `Promise<{session?, syncResult?, error?}>` | Restore + sync |
| `syncToVFS` | `sessionId, vfsScopePath, config?` | `Promise<VFSyncResult>` | Sync to VFS |
| `getProviderMCPTools` | - | `ProviderToolDefinition[]` | Get provider tools |
| `callProviderTool` | `toolName, args` | `Promise<{success, output, error?}>` | Call tool |
| `getUserSessionStats` | `userId` | `UserSessionStats` | Get user stats |

---

## Troubleshooting

### "Provider does not support snapshots"

**Cause:** Trying to snapshot with E2B, Daytona, or other stateless provider.

**Solution:** Use Sprites or CodeSandbox for snapshot support:
```typescript
await phase1.createUserSession(userId, {
  providerType: 'sprites',  // or 'codesandbox'
  autoSnapshot: true,
});
```

### "Quota exceeded"

**Cause:** Provider monthly limit reached.

**Solution:** Automatic fallback to next provider in chain, or:
```typescript
// Manually specify fallback
await phase1.createUserSession(userId, {
  providerType: 'microsandbox',  // Fallback provider
});
```

### "Provider tool not found"

**Cause:** API key not configured for that provider.

**Solution:** Set required env vars:
```bash
# For E2B tools
E2B_API_KEY=xxx
AMP_API_KEY=xxx  # or CODEX_API_KEY=xxx

# For Daytona tools
DAYTONA_API_KEY=xxx
```

### "VFS sync failed"

**Cause:** File too large or path not writable.

**Solution:** Adjust sync config:
```typescript
await phase1.syncToVFS(sessionId, 'project', {
  maxFileSize: 10 * 1024 * 1024,  // Increase limit
  excludePatterns: ['**/large-file.bin'],
});
```

---

## Examples

### Example 1: Chat Integration

```typescript
// components/chat/ChatWithTerminal.tsx
import { phase1 } from '@/lib/sandbox';

export function ChatWithTerminal({ userId }: { userId: string }) {
  const [session, setSession] = useState<UserTerminalSession | null>(null);
  
  useEffect(() => {
    // Auto-restore on mount
    phase1.restoreAndSync(userId, undefined, {
      vfsScopePath: 'project',
    }).then(result => {
      if (result.session) {
        setSession(result.session);
      }
    });
  }, [userId]);
  
  const handleDisconnect = async () => {
    if (session) {
      await phase1.disconnectSession(session.sessionId, {
        createSnapshot: true,
      });
      setSession(null);
    }
  };
  
  return (
    <div>
      {session ? (
        <>
          <TerminalPanel sessionId={session.sessionId} />
          <Button onClick={handleDisconnect}>Save & Disconnect</Button>
        </>
      ) : (
        <Button onClick={() => {
          phase1.createUserSession(userId, {
            providerType: 'sprites',
            autoSnapshot: true,
          }).then(setSession);
        }}>
          Start Session
        </Button>
      )}
    </div>
  );
}
```

### Example 2: Agent Task with Fallback

```typescript
// lib/agent/task-runner.ts
import { phase1 } from '@/lib/sandbox';

export async function runAgentTask(
  userId: string,
  prompt: string,
  useAgent: 'amp' | 'codex' | 'local'
) {
  // Create session
  const session = await phase1.createUserSession(userId, {
    providerType: 'e2b',  // Required for AMP/Codex
  });
  
  try {
    // Run agent
    const toolName = useAgent === 'amp' ? 'e2b_runAmpAgent' : 'e2b_runCodexAgent';
    const result = await phase1.callProviderTool(toolName, {
      prompt,
      workingDir: '/home/user',
    });
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // Sync results to VFS
    await phase1.syncToVFS(session.sessionId, 'project');
    
    return result.output;
  } finally {
    // Disconnect with snapshot
    await phase1.disconnectSession(session.sessionId, {
      createSnapshot: true,
    });
  }
}
```

### Example 3: CI/CD Batch Testing

```typescript
// lib/ci/batch-tester.ts
import { phase1 } from '@/lib/sandbox';

export async function runBatchTests(files: string[]) {
  const tasks = files.map(file => ({
    id: file,
    command: `npm test -- ${file}`,
  }));
  
  const result = await phase1.callProviderTool('codesandbox_runBatchJob', {
    tasks,
    maxConcurrent: 20,
    timeout: 600000,
  });
  
  if (!result.success) {
    throw new Error(result.error);
  }
  
  const output = JSON.parse(result.output);
  return {
    total: output.totalTasks,
    passed: output.successfulTasks,
    failed: output.failedTasks,
    duration: output.totalDuration,
  };
}
```

---

## More Examples

See `PHASE_1_IMPLEMENTATION_SUMMARY.md` for detailed usage patterns and `COMPREHENSIVE_SANDBOX_TERMINAL_MCP_REVIEW.md` for architectural context.
