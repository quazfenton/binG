/**
 * Virtual Filesystem Module
 * 
 * Provides virtual filesystem capabilities for agent workspaces.
 */

export { virtualFilesystem, VirtualFilesystemService } from './virtual-filesystem-service';
export type { VirtualFile, VirtualWorkspaceSnapshot, FilesystemChangeEvent } from './virtual-filesystem-service';

export { diffTracker, FilesystemDiffTracker } from './filesystem-diffs';
export type { FileDiff, DiffHunk, FileDiffHistory } from './filesystem-diffs';

export { filesystemEditSessionService } from './filesystem-edit-session-service';
export type { FilesystemEditSession, EditSessionResult } from './filesystem-edit-session-service';

export { resolveFilesystemOwner } from './resolve-filesystem-owner';

// Batch operations
export {
  VFSBatchOperations,
  createVFSBatchOperations,
  quickBatchWrite,
  type BatchFileOperation,
  type BatchOperationResult,
  type SearchReplaceConfig,
  type SearchReplaceResult,
} from './vfs-batch-operations';

// File watcher
export {
  VFSFileWatcher,
  createFileWatcher,
  watchFiles,
  type FileEvent,
  type FileEventType,
  type WatchConfig,
  type FileWatcherHandle,
} from './vfs-file-watcher';
