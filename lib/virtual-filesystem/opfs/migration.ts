/**
 * OPFS Migration Utilities
 *
 * Tools to migrate data between server VFS and OPFS
 * Supports bidirectional migration with progress tracking via API
 */

'use client';

import { opfsCore, type OPFSStats } from './opfs-core';
import { opfsAdapter } from './opfs-adapter';
import { getWorkspaceSnapshot, writeFileToServer } from './opfs-api-client';

export interface MigrationResult {
  success: boolean;
  filesMigrated: number;
  totalSize: number;
  errors: string[];
  duration: number;
  workspaceId: string;
}

export interface MigrationProgress {
  currentFile: number;
  totalFiles: number;
  currentPath: string;
  bytesTransferred: number;
  percentComplete: number;
}

export type MigrationDirection = 'server-to-opfs' | 'opfs-to-server';

export interface MigrationOptions {
  direction: MigrationDirection;
  ownerId: string;
  workspaceId?: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  onProgress?: (progress: MigrationProgress) => void;
  verifyAfter?: boolean;
}

/**
 * Migrate from server VFS to OPFS
 * 
 * @param options - Migration options
 * @returns Migration result with statistics
 */
export async function migrateFromServerVFS(options: MigrationOptions): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesMigrated = 0;
  let totalSize = 0;

  const { ownerId, direction, onProgress } = options;
  const workspaceId = options.workspaceId || ownerId;

  if (direction !== 'server-to-opfs') {
    throw new Error('Invalid migration direction');
  }

  try {
    // Initialize OPFS
    await opfsCore.initialize(workspaceId);

    // Get server snapshot via API
    const snapshot = await getWorkspaceSnapshot(ownerId);
    if (!snapshot) {
      return {
        success: false,
        filesMigrated: 0,
        totalSize: 0,
        errors: ['Failed to fetch snapshot from server'],
        duration: Date.now() - startTime,
        workspaceId,
      };
    }
    const files = filterFiles(snapshot.files, options);

    console.log(`[OPFS Migration] Starting server → OPFS migration: ${files.length} files`);

    // Migrate each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        // Write to OPFS
        await opfsCore.writeFile(file.path, file.content);

        filesMigrated++;
        totalSize += file.size;

        // Report progress
        if (onProgress) {
          onProgress({
            currentFile: i + 1,
            totalFiles: files.length,
            currentPath: file.path,
            bytesTransferred: totalSize,
            percentComplete: ((i + 1) / files.length) * 100,
          });
        }
      } catch (error: any) {
        errors.push(`Failed to migrate ${file.path}: ${error.message}`);
        console.error('[OPFS Migration] File error:', file.path, error);
      }
    }

    // Verify migration if requested
    if (options.verifyAfter) {
      await verifyMigration('server-to-opfs', ownerId, workspaceId, errors);
    }

    const duration = Date.now() - startTime;

    console.log(`[OPFS Migration] Complete: ${filesMigrated} files in ${duration}ms`);

    return {
      success: errors.length === 0,
      filesMigrated,
      totalSize,
      errors,
      duration,
      workspaceId,
    };
  } catch (error: any) {
    errors.push(`Migration failed: ${error.message}`);
    
    return {
      success: false,
      filesMigrated: 0,
      totalSize: 0,
      errors,
      duration: Date.now() - startTime,
      workspaceId,
    };
  }
}

/**
 * Migrate from OPFS to server VFS
 * 
 * @param options - Migration options
 * @returns Migration result with statistics
 */
export async function migrateToServerVFS(options: MigrationOptions): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let filesMigrated = 0;
  let totalSize = 0;

  const { ownerId, direction, onProgress } = options;
  const workspaceId = options.workspaceId || ownerId;

  if (direction !== 'opfs-to-server') {
    throw new Error('Invalid migration direction');
  }

  try {
    // Initialize OPFS
    await opfsCore.initialize(workspaceId);

    // Get OPFS stats
    const stats = await opfsCore.getStats();

    console.log(`[OPFS Migration] Starting OPFS → server migration`);

    // Walk OPFS tree and migrate files
    await migrateOPFSToServerRecursive(
      ownerId,
      '',
      options,
      errors,
      { filesMigrated, totalSize },
      onProgress
    );

    // Verify migration if requested
    if (options.verifyAfter) {
      await verifyMigration('opfs-to-server', ownerId, workspaceId, errors);
    }

    const duration = Date.now() - startTime;

    console.log(`[OPFS Migration] Complete: ${filesMigrated} files in ${duration}ms`);

    return {
      success: errors.length === 0,
      filesMigrated,
      totalSize,
      errors,
      duration,
      workspaceId,
    };
  } catch (error: any) {
    errors.push(`Migration failed: ${error.message}`);
    
    return {
      success: false,
      filesMigrated: 0,
      totalSize: 0,
      errors,
      duration: Date.now() - startTime,
      workspaceId,
    };
  }
}

/**
 * Quick sync (bidirectional, no verification)
 * 
 * @param ownerId - Owner identifier
 * @param workspaceId - Optional workspace identifier
 * @returns Migration result
 */
export async function quickSync(ownerId: string, workspaceId?: string): Promise<MigrationResult> {
  const wsId = workspaceId || ownerId;
  
  try {
    // Enable OPFS adapter (handles bidirectional sync)
    await opfsAdapter.enable(ownerId, wsId);
    
    // Sync from server to OPFS
    const result = await opfsAdapter.syncFromServer(ownerId);
    
    return {
      success: result.success,
      filesMigrated: result.filesSynced,
      totalSize: result.bytesTransferred,
      errors: result.errors,
      duration: result.duration,
      workspaceId: wsId,
    };
  } catch (error: any) {
    return {
      success: false,
      filesMigrated: 0,
      totalSize: 0,
      errors: [error.message],
      duration: 0,
      workspaceId: wsId,
    };
  }
}

/**
 * Check migration status
 * 
 * @param ownerId - Owner identifier
 * @param workspaceId - Optional workspace identifier
 * @returns Migration status information
 */
export async function getMigrationStatus(
  ownerId: string,
  workspaceId?: string
): Promise<{
  serverFileCount: number;
  opfsFileCount: number;
  serverTotalSize: number;
  opfsTotalSize: number;
  isInSync: boolean;
  differences: string[];
}> {
  const wsId = workspaceId || ownerId;

  try {
    // Get server snapshot via API
    const snapshot = await getWorkspaceSnapshot(ownerId);
    if (!snapshot) {
      return {
        serverFileCount: 0,
        opfsFileCount: 0,
        serverTotalSize: 0,
        opfsTotalSize: 0,
        isInSync: false,
        differences: ['Failed to fetch snapshot from server'],
      };
    }
    const serverFiles = snapshot.files;
    const serverTotalSize = serverFiles.reduce((sum, f) => sum + f.size, 0);

    // Get OPFS stats
    await opfsCore.initialize(wsId);
    const opfsStats = await opfsCore.getStats();

    // Compare file counts
    const differences: string[] = [];
    let isInSync = true;

    if (serverFiles.length !== opfsStats.totalFiles) {
      differences.push(`File count mismatch: server=${serverFiles.length}, opfs=${opfsStats.totalFiles}`);
      isInSync = false;
    }

    if (serverTotalSize !== opfsStats.totalSize) {
      differences.push(`Size mismatch: server=${serverTotalSize}, opfs=${opfsStats.totalSize}`);
      isInSync = false;
    }

    return {
      serverFileCount: serverFiles.length,
      opfsFileCount: opfsStats.totalFiles,
      serverTotalSize,
      opfsTotalSize: opfsStats.totalSize,
      isInSync,
      differences,
    };
  } catch (error: any) {
    return {
      serverFileCount: 0,
      opfsFileCount: 0,
      serverTotalSize: 0,
      opfsTotalSize: 0,
      isInSync: false,
      differences: [error.message],
    };
  }
}

// ========== Private Helper Functions ==========

async function migrateOPFSToServerRecursive(
  ownerId: string,
  path: string,
  options: MigrationOptions,
  errors: string[],
  stats: { filesMigrated: number; totalSize: number },
  onProgress?: (progress: MigrationProgress) => void
): Promise<void> {
  try {
    const entries = await opfsCore.listDirectory(path || '.');

    for (const entry of entries) {
      // Skip hidden directories
      if (entry.type === 'directory' && !entry.name.startsWith('.')) {
        await migrateOPFSToServerRecursive(
          ownerId,
          entry.path,
          options,
          errors,
          stats,
          onProgress
        );
      } else if (entry.type === 'file') {
        // Check include/exclude patterns
        if (!shouldIncludeFile(entry.path, options)) {
          continue;
        }

        try {
          // Read from OPFS
          const opfsFile = await opfsCore.readFile(entry.path);

          // Write to server VFS via API
          const success = await writeFileToServer(ownerId, entry.path, opfsFile.content);
          
          if (success) {
            stats.filesMigrated++;
            stats.totalSize += opfsFile.size;
          } else {
            errors.push(`Failed to write ${entry.path} to server`);
          }

          // Report progress
          if (onProgress) {
            onProgress({
              currentFile: stats.filesMigrated,
              totalFiles: -1, // Unknown total
              currentPath: entry.path,
              bytesTransferred: stats.totalSize,
              percentComplete: 0, // Unknown
            });
          }
        } catch (error: any) {
          errors.push(`Failed to migrate ${entry.path}: ${error.message}`);
        }
      }
    }
  } catch (error: any) {
    if (error.name !== 'NotFoundError') {
      errors.push(`Failed to list directory ${path}: ${error.message}`);
    }
  }
}

async function verifyMigration(
  direction: MigrationDirection,
  ownerId: string,
  workspaceId: string,
  errors: string[]
): Promise<void> {
  console.log(`[OPFS Migration] Verifying ${direction} migration...`);

  try {
    if (direction === 'server-to-opfs') {
      // Verify server files exist in OPFS
      const snapshot = await getWorkspaceSnapshot(ownerId);
      if (!snapshot) {
        errors.push('Failed to fetch snapshot from server for verification');
        return;
      }

      for (const file of snapshot.files) {
        try {
          const opfsFile = await opfsCore.readFile(file.path);

          if (opfsFile.content !== file.content) {
            errors.push(`Verification failed: ${file.path} content mismatch`);
          }
        } catch (error: any) {
          errors.push(`Verification failed: ${file.path} not found in OPFS`);
        }
      }
    } else {
      // Verify OPFS files exist on server
      // This would require walking OPFS tree and comparing
      // Simplified version: just check file counts
      const opfsStats = await opfsCore.getStats();
      const snapshot = await getWorkspaceSnapshot(ownerId);
      if (!snapshot) {
        errors.push('Failed to fetch snapshot from server for verification');
        return;
      }
      
      if (opfsStats.totalFiles !== snapshot.files.length) {
        errors.push(`Verification failed: file count mismatch`);
      }
    }
  } catch (error: any) {
    errors.push(`Verification error: ${error.message}`);
  }
}

function filterFiles(
  files: Array<{ path: string; size: number; content: string }>,
  options: MigrationOptions
): Array<{ path: string; size: number; content: string }> {
  if (!options.includePatterns && !options.excludePatterns) {
    return files;
  }

  return files.filter(file => shouldIncludeFile(file.path, options));
}

function shouldIncludeFile(path: string, options: MigrationOptions): boolean {
  // Check exclude patterns first
  if (options.excludePatterns) {
    for (const pattern of options.excludePatterns) {
      if (matchesPattern(path, pattern)) {
        return false;
      }
    }
  }

  // Check include patterns
  if (options.includePatterns) {
    for (const pattern of options.includePatterns) {
      if (matchesPattern(path, pattern)) {
        return true;
      }
    }
    return false;
  }

  return true;
}

function matchesPattern(path: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

/**
 * Rollback migration (delete migrated files)
 */
export async function rollbackMigration(
  direction: MigrationDirection,
  ownerId: string,
  workspaceId?: string
): Promise<{ success: boolean; filesDeleted: number; errors: string[] }> {
  const wsId = workspaceId || ownerId;
  const errors: string[] = [];
  let filesDeleted = 0;

  try {
    await opfsCore.initialize(wsId);

    if (direction === 'server-to-opfs') {
      // Clear OPFS workspace
      await opfsCore.clear();
      filesDeleted = 1; // Clear counts as 1 operation
    } else {
      // Can't easily rollback server changes without tracking
      errors.push('Rollback not supported for opfs-to-server direction');
    }

    return {
      success: errors.length === 0,
      filesDeleted,
      errors,
    };
  } catch (error: any) {
    errors.push(error.message);
    return {
      success: false,
      filesDeleted: 0,
      errors,
    };
  }
}
