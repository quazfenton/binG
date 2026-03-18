/**
 * VFS Sync-Back Types
 * 
 * Shared types for VFS sync-back functionality.
 * Separated to allow type-only imports without pulling in server modules.
 */

/**
 * File entry for VFS sync
 */
export interface VFSFileEntry {
  path: string;
  content: string;
  lastModified: number;
  size: number;
}

/**
 * Sync mode options
 */
export type SyncMode = 'full' | 'incremental' | 'changed-only';

/**
 * Sync configuration
 */
export interface VFSyncConfig {
  /** VFS scope path (e.g., 'project') */
  vfsScopePath: string;

  /** Sync mode */
  syncMode?: SyncMode;

  /** File patterns to include (glob) */
  includePatterns?: string[];

  /** File patterns to exclude (glob) */
  excludePatterns?: string[];

  /** Max file size to sync (bytes) */
  maxFileSize?: number;

  /** Timeout per file (ms) */
  fileTimeout?: number;
}

/**
 * Sync result
 */
export interface VFSyncResult {
  success: boolean;
  filesSynced: number;
  bytesSynced: number;
  duration: number;
  errors?: Array<{ path: string; error: string }>;
  metadata?: {
    totalFiles: number;
    skippedFiles: number;
    failedFiles: number;
  };
}

/**
 * Sync status
 */
export interface VFSyncStatus {
  sessionId: string;
  lastSyncAt?: number;
  lastSyncDuration?: number;
  lastSyncFiles?: number;
  isSyncing: boolean;
  progress?: {
    currentFile: number;
    totalFiles: number;
    currentPath?: string;
  };
}
