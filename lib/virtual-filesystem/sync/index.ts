/**
 * Virtual Filesystem Sync Module
 *
 * Synchronization between virtual filesystem and sandbox environments
 */

// Sync events
export {
  FILESYSTEM_UPDATED_EVENT,
  emitFilesystemUpdated,
  onFilesystemUpdated,
} from './sync-events';
export type { FilesystemUpdatedDetail } from './sync-events';

// Auto snapshot service
export { autoSnapshotService } from './auto-snapshot-service';
export type { SnapshotMetadata, AutoSnapshotConfig } from './auto-snapshot-service';

// Sandbox filesystem sync
export { sandboxFilesystemSync } from './sandbox-filesystem-sync';

// VFS sync back
export { vfsSyncBackService, syncSandboxToVFS } from './vfs-sync-back';
export type { VFSFileEntry, SyncMode, VFSyncConfig, VFSyncResult, VFSyncStatus } from './vfs-sync-back.types';

// Tar pipe sync - re-export from tar-pipe-sync
export { syncVFSToSandbox, syncSandboxToVFS as syncSandboxToVFSTarPipe } from './tar-pipe-sync';
export type { TarPipeSyncOptions, TarPipeSyncResult } from './tar-pipe-sync';

// Universal VFS sync
export { UniversalVfsSync as universalVFSSync } from './universal-vfs-sync';
