# OPFS Integration - README

## Overview

The OPFS (Origin Private File System) integration provides client-side persistent storage with instant read/write operations and background server synchronization for the VFS (Virtual File System).

## Features

### Core Features
- ⚡ **Instant file operations** (1-10ms vs 50-200ms server)
- 💾 **Persistent storage** (survives browser restarts)
- 🔄 **Background sync** (automatic server synchronization)
- 🌐 **Offline support** (full functionality without network)
- 🔒 **Origin isolation** (secure by default)

### Advanced Features
- 📦 **Git integration** (clone, commit, push, pull in browser)
- 📝 **Terminal sync** (instant persistence for terminal edits)
- 👥 **Multi-tab sync** (real-time collaboration across tabs)
- 📜 **Shadow commits** (local commit history with rollback)
- 📊 **Enhanced diffs** (server vs local vs git comparisons)

## Quick Start

### 1. Enable OPFS in Components

```typescript
import { useVirtualFilesystem } from '@/hooks/use-virtual-filesystem';

function MyComponent() {
  const {
    readFile,
    writeFile,
    syncStatus,
  } = useVirtualFilesystem('project', {
    useOPFS: true,  // Enable OPFS caching
  });

  return (
    <div>
      {syncStatus.pendingChanges > 0 && (
        <span>{syncStatus.pendingChanges} files pending sync</span>
      )}
    </div>
  );
}
```

### 2. Add OPFS Status Indicator

```typescript
import { OPFSStatusIndicator } from '@/components/opfs-status-indicator';

function Header() {
  return (
    <header>
      <OPFSStatusIndicator 
        showDetails={true}
        enableSync={true}
      />
    </header>
  );
}
```

### 3. Use Git Integration

```typescript
import { getOPFSGit } from '@/lib/virtual-filesystem/opfs';

const git = getOPFSGit('my-workspace');
await git.initialize();

// Clone a repository
await git.cloneRepo('https://github.com/user/repo.git');

// Commit changes
await git.add('src/app.ts');
await git.commit('feat: add new feature');

// Push to remote
await git.push('origin', 'main');
```

## Configuration

### Runtime Configuration

```typescript
import { updateOPFSConfig } from '@/lib/virtual-filesystem/opfs';

// Update configuration
updateOPFSConfig({
  autoSync: true,
  syncInterval: 30000,  // 30 seconds
  maxQueueSize: 100,
  enableGit: true,
  enableMultiTabSync: true,
});
```

### Default Configuration

```typescript
import { DEFAULT_OPFS_CONFIG } from '@/lib/virtual-filesystem/opfs';

console.log(DEFAULT_OPFS_CONFIG);
// {
//   enabled: true,
//   autoSync: true,
//   syncInterval: 30000,
//   maxQueueSize: 100,
//   enableHandleCaching: true,
//   maxCacheSize: 1000,
//   enableMultiTabSync: true,
//   enableGit: true,
//   enableShadowCommits: true,
//   enableTerminalSync: true,
//   ...
// }
```

## API Reference

### Core Service

```typescript
import { opfsCore } from '@/lib/virtual-filesystem/opfs';

// Initialize
await opfsCore.initialize('workspace-id');

// Read file
const { content, size, lastModified } = await opfsCore.readFile('file.txt');

// Write file
await opfsCore.writeFile('file.txt', 'content');

// Delete file
await opfsCore.deleteFile('file.txt');

// List directory
const entries = await opfsCore.listDirectory('');

// Get stats
const stats = await opfsCore.getStats();
```

### Adapter

```typescript
import { opfsAdapter } from '@/lib/virtual-filesystem/opfs';

// Enable
await opfsAdapter.enable('user-id', 'workspace-id');

// Read with caching
const file = await opfsAdapter.readFile('user-id', 'file.txt');

// Write with queue
await opfsAdapter.writeFile('user-id', 'file.txt', 'content');

// Sync
await opfsAdapter.syncFromServer('user-id');
await opfsAdapter.syncToServer('user-id');

// Status
const status = opfsAdapter.getSyncStatus();
```

### React Hooks

```typescript
import { useOPFS, useOPFSStatus, useOPFSBroadcast } from '@/hooks';

// Main OPFS hook
const {
  isEnabled,
  readFile,
  writeFile,
  syncWithServer,
  stats,
} = useOPFS('user-id');

// Status hook
const {
  isOnline,
  pendingChanges,
  lastSyncTimeFormatted,
  tabCount,
} = useOPFSStatus();

// Multi-tab hook
const {
  broadcastFileChange,
  tabCount,
  isOnlyTab,
} = useOPFSBroadcast('workspace-id', 'user-id');
```

## Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 119+ | ✅ Full |
| Edge | 119+ | ✅ Full |
| Firefox | 123+ | ⚠️ Flag |
| Safari | 17.4+ | ⚠️ Limited |

## Performance

| Operation | Before | With OPFS | Improvement |
|-----------|--------|-----------|-------------|
| File Read | 50-200ms | 1-10ms | 10-20x ⚡ |
| File Write | 50-200ms | 1-10ms | 10-20x ⚡ |
| Directory List | 100-300ms | 5-20ms | 10-15x ⚡ |

## Troubleshooting

### OPFS Not Supported

```typescript
import { isOPFSAvailable, getOPFSSupportInfo } from '@/lib/virtual-filesystem/opfs';

if (!isOPFSAvailable()) {
  const info = getOPFSSupportInfo();
  console.log('OPFS not available:', info.details);
  // Fallback to server-only mode
}
```

### Sync Issues

```typescript
import { useOPFS } from '@/hooks';

function SyncButton() {
  const { syncWithServer, syncStatus } = useOPFS('user-id');

  return (
    <button
      onClick={() => syncWithServer()}
      disabled={syncStatus.isSyncing}
    >
      {syncStatus.isSyncing ? 'Syncing...' : 'Sync Now'}
    </button>
  );
}
```

### Quota Exceeded

```typescript
import { useOPFS } from '@/hooks';

function StorageStats() {
  const { stats } = useOPFS('user-id');

  if (stats && stats.quotaUsage > 90) {
    return (
      <div className="warning">
        Storage nearly full: {stats.quotaUsage.toFixed(1)}%
      </div>
    );
  }

  return null;
}
```

## Migration

### Migrate from Server VFS

```typescript
import { migrateFromServerVFS } from '@/lib/virtual-filesystem/opfs/migration';

const result = await migrateFromServerVFS({
  direction: 'server-to-opfs',
  ownerId: 'user-id',
  onProgress: (progress) => {
    console.log(`${progress.percentComplete.toFixed(0)}% complete`);
  },
  verifyAfter: true,
});

console.log(`Migrated ${result.filesMigrated} files`);
```

## Security

- **Origin Isolation**: OPFS is scoped to the origin (domain)
- **Path Traversal Protection**: All paths are validated
- **Quota Monitoring**: Storage usage is tracked
- **Error Handling**: No sensitive data in error messages

## License

MIT

## Support

For issues and questions, please refer to the documentation:
- `OPFS_FINAL_STATUS.md` - Complete status report
- `OPFS_FIXES_AND_IMPROVEMENTS.md` - Bug fixes
- `OPFS_PHASE2_COMPLETE.md` - Phase 2 summary
