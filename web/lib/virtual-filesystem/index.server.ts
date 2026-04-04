/**
 * Server-only Virtual Filesystem Module
 * 
 * This file exports server-only modules that use Node.js APIs (fs, child_process, etc.)
 * and should only be imported in API routes or server components.
 * 
 * Usage:
 *   // In API routes / server components:
 *   import { virtualFilesystem } from '@/lib/virtual-filesystem/index.server';
 */
import 'server-only';

// Re-export all server-only functionality
export { virtualFilesystem, VirtualFilesystemService } from './virtual-filesystem-service';
export type {
  FilesystemChangeEvent,
  ConflictEvent,
} from './virtual-filesystem-service';

// Diff tracker
export { diffTracker, FilesystemDiffTracker } from './filesystem-diffs';

// Edit session service
export { filesystemEditSessionService } from './filesystem-edit-session-service';
export type {
  FilesystemEditTransaction,
  FilesystemEditDenialRecord,
  FilesystemEditOperationType,
  FilesystemEditTransactionStatus,
  FilesystemEditOperationRecord,
  DenyFilesystemEditResult,
} from './filesystem-edit-session-service';

// Resolve filesystem owner (API route helper)
export { resolveFilesystemOwner, withAnonSessionCookie } from './resolve-filesystem-owner';

// Git-backed VFS
export {
  createGitBackedVFS,
  getGitBackedVFSForOwner,
  GitBackedVFS,
} from './git-backed-vfs';

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
