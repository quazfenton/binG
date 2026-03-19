/**
 * Virtual Filesystem Module
 *
 * Provides virtual filesystem capabilities for agent workspaces.
 * Git-backed by default for automatic commits, version tracking, and rollbacks.
 */

export { virtualFilesystem, VirtualFilesystemService } from './virtual-filesystem-service';
export type { 
  FilesystemChangeEvent,
  ConflictEvent,
} from './virtual-filesystem-service';

// Core filesystem types
export type { 
  VirtualFile, 
  VirtualFilesystemNode,
  VirtualFilesystemDirectoryListing,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from './filesystem-types';

export { diffTracker, FilesystemDiffTracker } from './filesystem-diffs';
export type { FileDiff, DiffHunk, FileDiffHistory } from './filesystem-diffs';

export { filesystemEditSessionService } from './filesystem-edit-session-service';
export type { 
  FilesystemEditTransaction as FilesystemEditSession,
  FilesystemEditDenialRecord as EditSessionResult,
} from './filesystem-edit-session-service';

export { resolveFilesystemOwner, withAnonSessionCookie } from './resolve-filesystem-owner';

// Git-backed VFS (auto-enabled by default)
export {
  createGitBackedVFS,
  getGitBackedVFSForOwner,
  GitBackedVFS,
} from './git-backed-vfs';
export type { GitVFSOptions, GitVFSChange, GitVFSRollbackResult, GitVFSState } from './git-backed-vfs';

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
