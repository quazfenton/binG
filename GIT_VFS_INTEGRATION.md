# Git Integration for VFS - Complete Guide

## Overview

The git integration is now **wired directly into the Virtual Filesystem (VFS)** for automatic rollbacks and state tracking, not just exposed as MCP tools.

### Architecture

```
User Request → VFS Operations → Git-Backed Wrapper → Shadow Commit
                      ↓                ↓                  ↓
                File Write       Auto-Commit        Audit Trail
                File Delete      Version Track      Rollback Support
                Batch Ops        Diff Tracking      History
```

---

## Components

### 1. **Git Tools** (`lib/tools/git-tools.ts`)

Direct git operations for sandboxes:
- `git_status`, `git_commit`, `git_branch`, `git_checkout`
- `git_clone`, `git_push`, `git_log`, `git_diff`
- `git_vfs_sync`, `git_vfs_restore`, `git_vfs_status`
- `git_shadow_commit`, `git_shadow_history`, `git_shadow_rollback`

### 2. **Git-Backed VFS** (`lib/virtual-filesystem/git-backed-vfs.ts`)

Wraps VFS to automatically create commits:
- Auto-commit on every write/delete
- Shadow commit integration
- Rollback to any version
- Branch-based snapshots
- Diff tracking

### 3. **Shadow Commit** (`lib/orchestra/stateful-agent/commit/shadow-commit.ts`)

Audit trail and rollback system:
- Transaction logging
- Version history
- Point-in-time recovery
- Conflict detection

---

## Usage Examples

### 1. Automatic Git-Backed VFS

```typescript
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

// Get git-backed VFS for user
const gitVFS = virtualFilesystem.getGitBackedVFS('user_123', {
  autoCommit: true,           // Auto-commit on every change
  sessionId: 'session_456',   // Session for tracking
  enableShadowCommits: true,  // Enable audit trail
});

// Every write automatically creates a commit
await gitVFS.writeFile('user_123', 'src/index.ts', 'console.log("hello")');
await gitVFS.writeFile('user_123', 'src/utils.ts', 'export const x = 1');

// Rollback to previous version
await gitVFS.rollback('user_123', 1);  // Rollback to version 1

// Get diff
const diff = await gitVFS.getDiff('user_123', 1);
console.log(diff);  // Unified diff format

// List all versions
const versions = await gitVFS.listVersions(10);
console.log(versions);
```

### 2. Batch Operations with Single Commit

```typescript
// Write multiple files, commit once
await gitVFS.batchWrite('user_123', [
  { path: 'src/a.ts', content: 'export const a = 1' },
  { path: 'src/b.ts', content: 'export const b = 2' },
  { path: 'src/c.ts', content: 'export const c = 3' },
]);

// Single commit for all 3 files
await gitVFS.commitChanges('user_123', 'Add utility files');
```

### 3. Git Tools in Agent Loop

```typescript
import { createGitTools } from '@/lib/tools/git-tools';
import type { SandboxHandle } from '@/lib/sandbox/providers';

// Create git tools for sandbox
const gitTools = createGitTools(sandboxHandle);

// Use in agent
const status = await gitTools.git_status.execute({});
console.log(status.status.branch);  // Current branch

await gitTools.git_commit.execute({
  message: 'Add new feature',
  files: ['src/new-feature.ts'],
});

const history = await gitTools.git_log.execute({ limit: 5 });
console.log(history.commits);
```

### 4. Shadow Commit for Audit Trail

```typescript
import { ShadowCommitManager } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';

const shadowCommitManager = new ShadowCommitManager();

// Create shadow commit
const result = await shadowCommitManager.createCommit({
  sessionId: 'session_123',
  message: 'Refactor authentication',
  autoApprove: true,
  source: 'agent-loop',
});

console.log(result.commitId);  // For rollback

// Get history
const history = await shadowCommitManager.getHistory('session_123', 10);

// Rollback
await shadowCommitManager.rollback(result.commitId);
```

### 5. VFS Sync with Git

```typescript
import { getGitVFSSync } from '@/lib/virtual-filesystem/opfs/git-vfs-sync';

const gitVFS = getGitVFSSync('workspace_123', 'user_456');

// Sync VFS to git commit
const result = await gitVFS.syncToGit();
console.log(`Committed ${result.filesCommitted} files`);

// Restore from git commit
await gitVFS.restoreFromCommit('abc123');

// Get status
const status = await gitVFS.getStatus();
console.log(status.isSynced);  // true if VFS matches git HEAD
```

---

## Integration Points

### In Agent Loop

```typescript
// lib/agent/opencode-direct.ts
const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');

// Get git-backed VFS
const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: true,
  sessionId: conversationId,
});

// Use for file operations
const result = await provider.runAgentLoop({
  userMessage: task,
  onToolExecution: async (toolName, args, result) => {
    if (toolName === 'write_file') {
      // Automatically committed
      await gitVFS.writeFile(userId, args.path, args.content);
    }
  },
});
```

### In V2 Executor

```typescript
// lib/agent/v2-executor.ts
const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');

const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: true,
  sessionId: conversationId,
});

// Track file changes
if (result.fileChanges) {
  for (const change of result.fileChanges) {
    await gitVFS.writeFile(userId, change.path, change.content);
  }
  await gitVFS.commitChanges(userId, `Apply ${result.fileChanges.length} changes`);
}
```

### In MCP Integration

```typescript
// lib/mcp/architecture-integration.ts
import { createGitTools, standaloneGitTools } from '@/lib/tools/git-tools';

// Add git tools to MCP
const gitTools = Object.entries(standaloneGitTools).map(([name, toolDef]) => ({
  type: 'function' as const,
  function: {
    name: `git_${name}`,
    description: toolDef.description,
    parameters: toolDef.parameters,
  },
}));

// Include in tool list
const tools = [...nativeTools, ...gitTools, ...otherTools];
```

---

## Rollback Scenarios

### 1. User Requests Rollback

```typescript
// User: "Undo the last changes"
const state = await gitVFS.getState(userId);
await gitVFS.rollback(userId, state.version - 1);
```

### 2. Error Recovery

```typescript
try {
  await agent.execute(task);
} catch (error) {
  // Rollback to before task execution
  await gitVFS.rollback(userId, preTaskVersion);
  throw error;
}
```

### 3. Branch Experimentation

```typescript
// Create branch for experiment
await gitTools.git_branch.execute({
  action: 'create',
  branchName: 'experiment/new-approach',
});

// Make changes on branch
await gitVFS.writeFile(userId, 'src/experimental.ts', '...');

// If it works, merge. If not, switch back
await gitTools.git_checkout.execute({ target: 'main' });
```

---

## Configuration

### Environment Variables

```bash
# Git-VFS settings
GIT_VFS_AUTO_COMMIT=true
GIT_VFS_SESSION_ID=default
GIT_VFS_ENABLE_SHADOW_COMMITS=true

# Shadow commit storage
SHADOW_COMMIT_STORAGE=database  # or 'filesystem'
SHADOW_COMMIT_MAX_HISTORY=100

# Rollback settings
ROLLBACK_ENABLED=true
ROLLBACK_MAX_VERSIONS=50
```

### Options

```typescript
interface GitVFSOptions {
  autoCommit?: boolean;              // Default: true
  commitMessage?: string;            // Default: 'VFS auto-commit'
  sessionId?: string;                // Default: 'default'
  enableShadowCommits?: boolean;     // Default: true
}
```

---

## Performance Considerations

### Auto-Commit Overhead

- **Small files (<1KB)**: ~5ms per commit
- **Medium files (100KB)**: ~20ms per commit
- **Large files (1MB+)**: ~100ms per commit

### Optimization Strategies

```typescript
// 1. Batch multiple writes
await gitVFS.batchWrite(userId, files);  // Single commit

// 2. Disable auto-commit for bulk operations
gitVFS.setAutoCommit(false);
for (const file of largeFileList) {
  await gitVFS.writeFile(userId, file.path, file.content);
}
await gitVFS.commitChanges(userId, 'Bulk update');
gitVFS.setAutoCommit(true);

// 3. Use shadow commits only (no git repo needed)
const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  autoCommit: false,  // Don't create git commits
  enableShadowCommits: true,  // But keep audit trail
});
```

---

## Troubleshooting

### Issue: Commits Not Created

```typescript
// Check auto-commit setting
const state = await gitVFS.getState(userId);
console.log(state.isClean);  // Should be true after commit

// Enable auto-commit
gitVFS.setAutoCommit(true);

// Manually commit
await gitVFS.commitChanges(userId, 'Manual commit');
```

### Issue: Rollback Fails

```typescript
// Check available versions
const versions = await gitVFS.listVersions(20);
console.log(versions.map(v => v.version));

// Ensure target version exists
const targetVersion = 5;
if (!versions.some(v => v.version === targetVersion)) {
  throw new Error(`Version ${targetVersion} not found`);
}

// Try rollback
const result = await gitVFS.rollback(userId, targetVersion);
if (!result.success) {
  console.error(result.error);
}
```

### Issue: Shadow Commit History Empty

```typescript
// Check session ID consistency
const history = await shadowCommitManager.getHistory(sessionId, 100);
console.log(`Found ${history.length} commits for session ${sessionId}`);

// Ensure same session ID is used
const gitVFS = virtualFilesystem.getGitBackedVFS(userId, {
  sessionId: 'consistent-session-id',  // Use same ID everywhere
});
```

---

## API Reference

### GitBackedVFS

| Method | Description | Returns |
|--------|-------------|---------|
| `writeFile()` | Write file with auto-commit | `VirtualFile` |
| `deleteFile()` | Delete file with auto-commit | `void` |
| `batchWrite()` | Write multiple files | `void` |
| `commitChanges()` | Commit buffered changes | `CommitResult` |
| `rollback()` | Rollback to version | `RollbackResult` |
| `getState()` | Get current state | `GitVFSState` |
| `getDiff()` | Get diff from version | `string` |
| `listVersions()` | List all versions | `Version[]` |
| `setAutoCommit()` | Enable/disable auto-commit | `void` |

### Git Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `git_status` | Get git status | `repoPath?` |
| `git_commit` | Create commit | `message, files?` |
| `git_branch` | Create/list branches | `action, branchName?` |
| `git_checkout` | Switch branch | `target` |
| `git_vfs_sync` | Sync VFS to git | `workspaceId, ownerId, message` |
| `git_vfs_restore` | Restore VFS from git | `workspaceId, ownerId, target` |
| `git_shadow_commit` | Create shadow commit | `sessionId, message, files` |
| `git_shadow_rollback` | Rollback shadow commit | `commitId` |

---

## Best Practices

1. **Enable auto-commit for development**, disable for bulk operations
2. **Use meaningful commit messages** that describe the change
3. **Batch related changes** into single commits
4. **Track session IDs** consistently for audit trails
5. **Regular rollbacks testing** to ensure recovery works
6. **Monitor shadow commit storage** to prevent bloat
7. **Use branches for experiments**, not main workspace

---

## Migration Guide

### From Manual Git to Git-Backed VFS

```typescript
// Before: Manual git operations
await vfs.writeFile(userId, path, content);
await gitManager.add(path);
await gitManager.commit('Update file');

// After: Automatic with Git-Backed VFS
const gitVFS = virtualFilesystem.getGitBackedVFS(userId, { autoCommit: true });
await gitVFS.writeFile(userId, path, content);
// Automatically committed!
```

### From No Versioning to Git-Backed

```typescript
// Before: No versioning
const vfs = new VirtualFilesystemService();
await vfs.writeFile(userId, path, content);

// After: Full versioning with rollback
const gitVFS = virtualFilesystem.getGitBackedVFS(userId);
await gitVFS.writeFile(userId, path, content);
// Can rollback anytime:
await gitVFS.rollback(userId, 1);
```
