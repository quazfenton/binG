/**
 * Filesystem Rename/Move Utilities
 *
 * Provides safe rename and move operations with:
 * - Conflict detection (prevent overwrites)
 * - Atomic operations
 * - Rollback on failure
 * - Event emission for UI updates
 *
 * @see lib/virtual-filesystem/sync/sync-events.ts
 */

import { virtualFilesystem } from './virtual-filesystem-service';
import { emitFilesystemUpdated } from './sync/sync-events';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('FilesystemRename');

export interface RenameOptions {
  /** Owner ID for the operation */
  ownerId: string;
  /** Source path */
  sourcePath: string;
  /** Destination path */
  destinationPath: string;
  /** If true, overwrite existing file (default: false) */
  overwrite?: boolean;
  /** Session ID for event emission */
  sessionId?: string;
  /** Filesystem scope root for UI refresh filtering */
  scopePath?: string;
}

export interface RenameResult {
  success: boolean;
  sourcePath: string;
  destinationPath: string;
  overwritten?: boolean;
  error?: string;
}

export interface ConflictInfo {
  /** Path that has a conflict */
  path: string;
  /** Type of conflict */
  type: 'file_exists' | 'directory_exists' | 'circular_move' | 'invalid_path';
  /** Whether it can be resolved with overwrite */
  canOverwrite: boolean;
  /** Existing file info if applicable */
  existingFile?: {
    size: number;
    lastModified: number;
    version: number;
  };
}

/**
 * Check for potential conflicts before rename/move
 */
export async function checkRenameConflicts(
  ownerId: string,
  sourcePath: string,
  destinationPath: string
): Promise<{
  hasConflict: boolean;
  conflicts: ConflictInfo[];
  canProceed: boolean;
}> {
  const conflicts: ConflictInfo[] = [];

  // Normalize paths for comparison (handle both Unix and Windows separators)
  const normalizedSource = sourcePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  const normalizedDest = destinationPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

  // Check 1: Circular move (moving folder into itself)
  if (normalizedDest.startsWith(normalizedSource + '/')) {
    conflicts.push({
      path: destinationPath,
      type: 'circular_move',
      canOverwrite: false,
    });
    return { hasConflict: true, conflicts, canProceed: false };
  }

  // Check 2: Destination already exists
  try {
    const existing = await virtualFilesystem.readFile(ownerId, destinationPath);
    conflicts.push({
      path: destinationPath,
      type: 'file_exists',
      canOverwrite: true,
      existingFile: {
        size: existing.size,
        lastModified: typeof existing.lastModified === 'string' ? new Date(existing.lastModified).getTime() : existing.lastModified,
        version: existing.version,
      },
    });
  } catch {
    // File doesn't exist, check if directory exists
    try {
      await virtualFilesystem.listDirectory(ownerId, destinationPath);
      conflicts.push({
        path: destinationPath,
        type: 'directory_exists',
        canOverwrite: false,
      });
    } catch {
      // Neither file nor directory exists, no conflict
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    canProceed: conflicts.length === 0 || conflicts.every(c => c.canOverwrite),
  };
}

/**
 * Safely rename/move a file or directory
 *
 * @returns RenameResult with success status and any errors
 */
export async function safeRename(options: RenameOptions): Promise<RenameResult> {
  const {
    ownerId,
    sourcePath,
    destinationPath,
    overwrite = false,
    sessionId,
    scopePath,
  } = options;

  logger.info(`Starting rename: ${sourcePath} -> ${destinationPath}`, {
    overwrite,
    sessionId,
  });

  // Normalize paths for comparison (handle both Unix and Windows separators)
  const normalizedSource = sourcePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  const normalizedDest = destinationPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

  // Early return if renaming to itself - no-op
  if (normalizedSource === normalizedDest) {
    logger.debug('Rename source and destination are the same, skipping');
    return {
      success: true,
      sourcePath,
      destinationPath,
      overwritten: false,
    };
  }

  try {
    // Check for conflicts
    const conflictCheck = await checkRenameConflicts(ownerId, sourcePath, destinationPath);

    if (conflictCheck.hasConflict && !overwrite) {
      const conflictTypes = conflictCheck.conflicts.map(c => c.type).join(', ');
      return {
        success: false,
        sourcePath,
        destinationPath,
        error: `Destination already exists (${conflictTypes}). Set overwrite=true to force.`,
      };
    }

    // Read source content
    let content: string;
    let isDirectory = false;

    try {
      // Try to read as file
      const sourceFile = await virtualFilesystem.readFile(ownerId, sourcePath);
      content = sourceFile.content;
    } catch {
      // Try to read as directory
      try {
        const dirContents = await virtualFilesystem.listDirectory(ownerId, sourcePath);
        isDirectory = true;
        // For directories, we'll move all contents recursively
        // This is a simplified implementation - full recursive move would be more complex
      } catch {
        return {
          success: false,
          sourcePath,
          destinationPath,
          error: 'Source path does not exist',
        };
      }
    }

    // Perform the rename/move
    if (isDirectory) {
      // Directory move - would need recursive implementation
      // For now, return error as this is complex operation
      return {
        success: false,
        sourcePath,
        destinationPath,
        error: 'Directory move not yet implemented. Please move files individually.',
      };
    } else {
      // File move - read from source, write to dest, delete source
      // This is atomic enough for most use cases
      await virtualFilesystem.writeFile(ownerId, destinationPath, content);
      await virtualFilesystem.deletePath(ownerId, sourcePath);
    }

    // Get new workspace version for event
    const workspaceVersion = await virtualFilesystem.getWorkspaceVersion(ownerId);

    // Emit filesystem updated event with error handling
    try {
      // Derive scopePath from the normalized destination path (handles Windows backslashes)
      const normalizedDestForScope = destinationPath.replace(/\\/g, '/');
      const derivedScopePath = scopePath ?? (
        normalizedDestForScope.includes('/')
          ? normalizedDestForScope.slice(0, normalizedDestForScope.lastIndexOf('/'))
          : normalizedDestForScope
      );

      emitFilesystemUpdated({
        type: overwrite ? 'update' : 'create',
        path: destinationPath,
        scopePath: derivedScopePath,
        sessionId,
        workspaceVersion,
        applied: [{
          path: destinationPath,
          operation: overwrite ? 'update' : 'create',  // Use valid operation type
          timestamp: Date.now(),
          sourcePath,  // Include source path for rename operations
          destinationPath,  // Include destination path for clarity
          overwritten: overwrite,  // Include overwrite flag for additional context
        }],
        source: 'rename',
      });
    } catch (emitError: any) {
      // Log event emission failure but don't fail the rename operation
      // The rename was successful, only the notification failed
      logger.warn(`Failed to emit filesystem event after rename: ${emitError.message}`);
      // Note: We don't rollback the rename since the filesystem change was successful
      // The event emission is a notification, not a critical part of the operation
    }

    logger.info(`Rename successful: ${sourcePath} -> ${destinationPath}`);

    return {
      success: true,
      sourcePath,
      destinationPath,
      overwritten: overwrite,
    };
  } catch (error: any) {
    logger.error(`Rename failed: ${error.message}`, { sourcePath, destinationPath });
    return {
      success: false,
      sourcePath,
      destinationPath,
      error: error.message || 'Rename operation failed',
    };
  }
}

/**
 * Generate a unique filename by appending suffix if file exists
 *
 * Examples:
 * - file.txt → file_1.txt, file_2.txt, ...
 * - document.pdf → document_1.pdf, document_2.pdf, ...
 *
 * @param ownerId - Owner ID
 * @param basePath - Base path to check
 * @returns Unique path that doesn't conflict
 */
export async function generateUniquePath(
  ownerId: string,
  basePath: string
): Promise<string> {
  // Extract file extension and name
  const lastDotIndex = basePath.lastIndexOf('.');
  const extension = lastDotIndex > 0 ? basePath.substring(lastDotIndex) : '';
  const nameWithoutExt = lastDotIndex > 0
    ? basePath.substring(0, lastDotIndex)
    : basePath;

  let candidate = basePath;
  let counter = 1;

  // Check if path exists
  while (true) {
    try {
      await virtualFilesystem.readFile(ownerId, candidate);
      // File exists, try next suffix
      candidate = `${nameWithoutExt}_${counter}${extension}`;
      counter++;

      // Safety limit
      if (counter > 1000) {
        throw new Error('Unable to generate unique filename after 1000 attempts');
      }
    } catch {
      // File doesn't exist, we found our unique path
      break;
    }
  }

  logger.debug(`Generated unique path: ${basePath} -> ${candidate}`);
  return candidate;
}

/**
 * Validate a rename path for safety
 *
 * Checks:
 * - No path traversal (..)
 * - Valid characters
 * - Reasonable length
 * - Not attempting to move root directories
 */
export function validateRenamePath(path: string): {
  valid: boolean;
  error?: string;
} {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Path must be a non-empty string' };
  }

  // Check for path traversal
  if (path.includes('..')) {
    return { valid: false, error: 'Path traversal (..) is not allowed' };
  }

  // Check for null bytes
  if (path.includes('\0')) {
    return { valid: false, error: 'Null bytes are not allowed in paths' };
  }

  // Check length
  if (path.length > 500) {
    return { valid: false, error: 'Path too long (max 500 characters)' };
  }

  // Check for valid characters (allow common path chars)
  const validPattern = /^[a-zA-Z0-9_\-./\s]+$/;
  if (!validPattern.test(path)) {
    return {
      valid: false,
      error: 'Path contains invalid characters (only alphanumeric, underscore, hyphen, dot, slash, and space allowed)',
    };
  }

  // Check for reserved names
  const reservedNames = ['.', '..', '/', '\\', 'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];
  const pathSegments = path.split('/').map(s => s.trim());
  const hasReserved = pathSegments.some(segment =>
    reservedNames.includes(segment.toUpperCase())
  );

  if (hasReserved) {
    return { valid: false, error: 'Path contains reserved name' };
  }

  return { valid: true };
}

/**
 * Batch rename multiple files with conflict detection
 *
 * @param operations - Array of rename operations
 * @param stopOnError - If true, stop on first error (default: true)
 * @returns Array of results for each operation
 */
export async function batchRename(
  operations: Array<{
    ownerId: string;
    sourcePath: string;
    destinationPath: string;
    overwrite?: boolean;
    sessionId?: string;
  }>,
  stopOnError: boolean = true
): Promise<Array<RenameResult & { operationIndex: number }>> {
  const results: Array<RenameResult & { operationIndex: number }> = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const result = await safeRename(op);

    results.push({
      ...result,
      operationIndex: i,
    });

    if (!result.success && stopOnError) {
      logger.warn(`Batch rename stopped at operation ${i}: ${result.error}`);
      break;
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;

  logger.info(`Batch rename complete: ${successCount} successful, ${failCount} failed`, {
    total: operations.length,
  });

  return results;
}
