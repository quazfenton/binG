/**
 * Virtual Filesystem Module
 *
 * Provides virtual filesystem capabilities for agent workspaces.
 * Git-backed by default for automatic commits, version tracking, and rollbacks.
 * 
 * CLIENT-SAFE EXPORTS: This file only exports types and utilities that work in both
 * server and browser environments. Server-only exports are in ./index.server.ts
 */

// Core filesystem types - safe for client
export type {
  VirtualFile,
  VirtualFilesystemNode,
  VirtualFilesystemDirectoryListing,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from './filesystem-types';

// Batch operations type exports - safe for client
export type {
  BatchFileOperation,
  BatchOperationResult,
  SearchReplaceConfig,
  SearchReplaceResult,
} from './vfs-batch-operations';

// File watcher type exports - safe for client
export type {
  FileEvent,
  FileEventType,
  WatchConfig,
  FileWatcherHandle,
} from './vfs-file-watcher';

// Diff tracker types - safe for client
export type { FileDiff, DiffHunk, FileDiffHistory } from './filesystem-diffs';

// Git VFS types - safe for client
export type { GitVFSOptions, GitVFSChange, GitVFSRollbackResult, GitVFSState } from './git-backed-vfs';

// Edit session types - safe for client
export type {
  FilesystemEditTransaction as FilesystemEditSession,
  FilesystemEditDenialRecord as EditSessionResult,
} from './filesystem-edit-session-service';

// Change/Conflict event types - safe for client
export type {
  FilesystemChangeEvent,
  ConflictEvent,
} from './virtual-filesystem-service';

/**
 * Server-only VFS exports - use dynamic import to access these
 * Example: const { virtualFilesystem } = await import('@/lib/virtual-filesystem/index.server');
 */
export const __VFS_SERVER_EXPORTS = [
  'virtualFilesystem',
  'VirtualFilesystemService', 
  'filesystemEditSessionService',
  'diffTracker',
  'FilesystemDiffTracker',
  'resolveFilesystemOwner',
  'withAnonSessionCookie',
  'createGitBackedVFS',
  'getGitBackedVFSForOwner',
  'GitBackedVFS',
  'VFSBatchOperations',
  'createVFSBatchOperations',
  'quickBatchWrite',
  'VFSFileWatcher',
  'createFileWatcher',
  'watchFiles',
];

// Re-export virtualFilesystem for backward compatibility
export { virtualFilesystem } from './virtual-filesystem-service';
