/**
 * File Explorer Operations Hook
 *
 * Provides Windows Explorer-like functionality for file/folder operations:
 * - Rename with conflict detection
 * - Move with confirmation dialogs
 * - Copy/Paste with overwrite protection
 * - Delete with confirmation
 * - Batch operations
 *
 * All operations emit filesystem-updated events for UI sync.
 *
 * @example
 * ```typescript
 * const { rename, move, copy, delete: deletePath, pendingConflict } = useFileExplorer();
 *
 * // Rename with conflict handling
 * const result = await rename({ oldPath: '/old.txt', newPath: '/new.txt' });
 *
 * // Handle conflict dialog
 * if (pendingConflict) {
 *   return <ConflictDialog onResolve={resolveConflict} />;
 * }
 * ```
 */

'use client';

import { useState, useCallback } from 'react';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { buildApiHeaders } from '@/lib/utils';

export interface FileOperationResult {
  success: boolean;
  error?: string;
  path?: string;
}

export interface ConflictInfo {
  exists: boolean;
  path: string;
  canOverwrite: boolean;
}

export interface RenameOptions {
  oldPath: string;
  newPath: string;
  overwrite?: boolean;
}

export interface MoveOptions {
  sourcePath: string;
  targetPath: string;
  overwrite?: boolean;
}

export interface DeleteOptions {
  path: string;
  recursive?: boolean;
}

interface PendingConflict {
  type: 'rename' | 'move' | 'copy';
  sourcePath: string;
  targetPath: string;
  resolve: (overwrite: boolean) => void;
}

export function useFileExplorer() {
  const [isOperating, setIsOperating] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);

  /**
   * Check if a path exists (conflict detection)
   */
  const checkPathExists = useCallback(async (path: string): Promise<ConflictInfo> => {
    try {
      // First, check if the path is an existing file via the read endpoint
      // (returns 404 for non-existent files)
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path }),
      });

      if (readResponse.ok) {
        return { exists: true, path, canOverwrite: true };
      }

      // Not a file — check if it's a non-empty directory via list endpoint
      const listResponse = await fetch(`/api/filesystem/list?path=${encodeURIComponent(path)}`, {
        method: 'GET',
        headers: buildApiHeaders(),
      });

      if (listResponse.ok) {
        const payload = await listResponse.json().catch(() => null);
        // Only treat as existing if the directory has contents
        // (listDirectory always returns success:true even for non-existent paths)
        const exists = payload?.success === true && payload?.data?.nodes?.length > 0;
        return { exists, path, canOverwrite: true };
      }

      // Neither file nor directory — path doesn't exist
      return { exists: false, path, canOverwrite: false };
    } catch (error) {
      console.error('Failed to check path:', error);
      return { exists: false, path, canOverwrite: false };
    }
  }, []);

  /**
   * Show conflict resolution dialog
   */
  const showConflictDialog = useCallback((
    type: 'rename' | 'move' | 'copy',
    sourcePath: string,
    targetPath: string
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingConflict((current) => {
        // Cancel any existing conflict
        if (current) {
          current.resolve(false);
        }
        return { type, sourcePath, targetPath, resolve };
      });
    });
  }, []);

  /**
   * Rename a file/folder with conflict detection
   */
  const rename = useCallback(async (options: RenameOptions): Promise<FileOperationResult> => {
    const { oldPath, newPath, overwrite = false } = options;

    if (!oldPath || !newPath) {
      return { success: false, error: 'Invalid paths' };
    }

    if (oldPath === newPath) {
      return { success: true, path: newPath }; // No-op
    }

    setIsOperating(true);

    try {
      // Check for conflicts
      const conflict = await checkPathExists(newPath);

      let shouldOverwrite = overwrite;
      if (conflict.exists && !shouldOverwrite) {
        // Ask user for confirmation
        shouldOverwrite = await showConflictDialog('rename', oldPath, newPath);
        if (!shouldOverwrite) {
          return { success: false, error: 'Operation cancelled by user' };
        }
      }

      // Perform rename via dedicated server-side endpoint
      const renameResponse = await fetch('/api/filesystem/rename', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ oldPath, newPath, overwrite: shouldOverwrite }),
      });

      if (!renameResponse.ok) {
        const errorData = await renameResponse.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to rename');
      }

      // Emit event for UI update
      emitFilesystemUpdated({
        type: 'update',
        path: newPath,
        applied: [{
          path: newPath,
          operation: 'write',
          timestamp: Date.now(),
        }],
        source: 'client-rename',
      });

      return { success: true, path: newPath };
    } catch (error: any) {
      console.error('Rename failed:', error);
      return { success: false, error: error.message };
    } finally {
      setIsOperating(false);
    }
  }, [checkPathExists, showConflictDialog]);

  /**
   * Move a file/folder with conflict detection
   */
  const move = useCallback(async (options: MoveOptions): Promise<FileOperationResult> => {
    const { sourcePath, targetPath, overwrite = false } = options;

    if (!sourcePath || !targetPath) {
      return { success: false, error: 'Invalid paths' };
    }

    if (sourcePath === targetPath) {
      return { success: true, path: targetPath }; // No-op
    }

    // Check for circular move (moving folder into itself)
    if (targetPath.startsWith(sourcePath + '/')) {
      return { success: false, error: 'Cannot move folder into itself' };
    }

    setIsOperating(true);

    try {
      // Check for conflicts
      const conflict = await checkPathExists(targetPath);

      let shouldOverwrite = overwrite;
      if (conflict.exists && !shouldOverwrite) {
        shouldOverwrite = await showConflictDialog('move', sourcePath, targetPath);
        if (!shouldOverwrite) {
          return { success: false, error: 'Operation cancelled by user' };
        }
      }

      // Perform move via dedicated server-side endpoint
      const moveResponse = await fetch('/api/filesystem/move', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ sourcePath, targetPath, overwrite: shouldOverwrite }),
      });

      if (!moveResponse.ok) {
        const errorData = await moveResponse.json().catch(() => null);
        throw new Error(errorData?.error || 'Failed to move');
      }

      // Emit event for UI update
      emitFilesystemUpdated({
        type: 'create',
        path: targetPath,
        applied: [{
          path: targetPath,
          operation: 'write',
          timestamp: Date.now(),
        }],
        source: 'client-move',
      });

      return { success: true, path: targetPath };
    } catch (error: any) {
      console.error('Move failed:', error);
      return { success: false, error: error.message };
    } finally {
      setIsOperating(false);
    }
  }, [checkPathExists, showConflictDialog]);

  /**
   * Copy a file/folder with conflict detection
   */
  const copy = useCallback(async (options: MoveOptions): Promise<FileOperationResult> => {
    const { sourcePath, targetPath, overwrite = false } = options;

    if (!sourcePath || !targetPath) {
      return { success: false, error: 'Invalid paths' };
    }

    if (sourcePath === targetPath) {
      return { success: true, path: targetPath }; // No-op
    }

    setIsOperating(true);

    try {
      // Check for conflicts
      const conflict = await checkPathExists(targetPath);

      if (conflict.exists && !overwrite) {
        const shouldOverwrite = await showConflictDialog('copy', sourcePath, targetPath);
        if (!shouldOverwrite) {
          return { success: false, error: 'Operation cancelled by user' };
        }
      }

      // Read source
      const readResponse = await fetch('/api/filesystem/read', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: sourcePath }),
      });

      if (!readResponse.ok) {
        throw new Error('Failed to read source file');
      }

      const readPayload = await readResponse.json().catch(() => null);
      const content = readPayload?.data?.content || '';

      // Write to target (copy)
      const writeResponse = await fetch('/api/filesystem/write', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path: targetPath, content }),
      });

      if (!writeResponse.ok) {
        throw new Error('Failed to write copy');
      }

      // Emit event for UI update
      emitFilesystemUpdated({
        type: 'create',
        path: targetPath,
        applied: [{
          path: targetPath,
          operation: 'write',
          timestamp: Date.now(),
        }],
        source: 'client-copy',
      });

      return { success: true, path: targetPath };
    } catch (error: any) {
      console.error('Copy failed:', error);
      return { success: false, error: error.message };
    } finally {
      setIsOperating(false);
    }
  }, [checkPathExists, showConflictDialog]);

  /**
   * Delete a file/folder
   */
  const deletePath = useCallback(async (options: DeleteOptions): Promise<FileOperationResult> => {
    const { path, recursive = false } = options;

    if (!path) {
      return { success: false, error: 'Invalid path' };
    }

    setIsOperating(true);

    try {
      const deleteResponse = await fetch('/api/filesystem/delete', {
        method: 'POST',
        headers: buildApiHeaders(),
        body: JSON.stringify({ path, recursive }),
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => null);
        throw new Error(errorData?.error || 'Delete failed');
      }

      // Emit event for UI update
      emitFilesystemUpdated({
        type: 'delete',
        path,
        applied: [{
          path,
          operation: 'delete',
          timestamp: Date.now(),
        }],
        source: 'client-delete',
      });

      return { success: true, path };
    } catch (error: any) {
      console.error('Delete failed:', error);
      return { success: false, error: error.message };
    } finally {
      setIsOperating(false);
    }
  }, []);

  /**
   * Batch delete multiple files/folders
   */
  const batchDelete = useCallback(async (paths: string[]): Promise<FileOperationResult[]> => {
    const results: FileOperationResult[] = [];

    for (const path of paths) {
      const result = await deletePath({ path });
      results.push(result);
    }

    return results;
  }, [deletePath]);

  return {
    // Operations
    rename,
    move,
    copy,
    delete: deletePath,
    batchDelete,

    // Conflict dialog state
    pendingConflict,
    
    // Resolve conflict dialog (call with true to overwrite, false to cancel)
    resolveConflict: useCallback((overwrite: boolean) => {
      setPendingConflict(prev => {
        if (prev) {
          prev.resolve(overwrite);
        }
        return null;
      });
    }, []),
    
    // Cancel conflict dialog (equivalent to resolveConflict(false))
    cancelConflict: useCallback(() => {
      setPendingConflict(prev => {
        if (prev) {
          prev.resolve(false);
        }
        return null;
      });
    }, []),

    // Operation state
    isOperating,
  };
}
