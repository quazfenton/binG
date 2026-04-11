/**
 * VFS Workspace Materializer
 *
 * Materializes VFS database files to a real filesystem directory for the local PTY,
 * and watches for file changes made by the shell to sync back to the VFS database.
 *
 * Security:
 * - Each user session gets an isolated directory at: <os.tmpdir>/vfs-workspace/<normalizedOwnerId>/
 * - Path traversal is prevented — all paths are validated to stay within the workspace
 * - Symlinks are not followed — symlinked files/dirs are ignored
 * - File size is limited to prevent memory exhaustion
 *
 * Each user session gets an isolated real directory at:
 *   <os.tmpdir>/vfs-workspace/<normalizedOwnerId>/
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VFSWorkspace');

// Maximum file size to sync to VFS (5 MB) — prevents memory exhaustion
const MAX_SYNC_FILE_SIZE = 5 * 1024 * 1024;

// Database access — uses the same SQLite connection as the VFS service
function getDb() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDatabase } = require('@/lib/database/connection');
  return getDatabase();
}

/**
 * Normalize owner ID the same way the VFS service does.
 * Removes 'anon:' prefix for consistent storage.
 * Sanitizes the ID to prevent directory traversal.
 */
function normalizeOwnerId(userId: string): string {
  // Strip anon: prefix
  let id = userId.replace(/^anon:/, '');
  // Remove any path traversal characters
  id = id.replace(/\.\./g, '');
  // Remove path separators and null bytes
  id = id.replace(/[\\/ \0]/g, '_');
  // Limit length to prevent filesystem issues
  return id.substring(0, 255) || '_default';
}

/**
 * Validate that a resolved path is safely inside the workspace directory.
 * Prevents path traversal attacks via symlinks or relative paths.
 */
function isPathInsideWorkspace(workspaceDir: string, fullPath: string): boolean {
  const resolvedWorkspace = fs.realpathSync.native(workspaceDir);
  const resolvedPath = fs.realpathSync.native(fullPath);
  return resolvedPath.startsWith(resolvedWorkspace + path.sep) || resolvedPath === resolvedWorkspace;
}

/**
 * Validate that a VFS path from the database is safe to materialize.
 * Prevents path traversal via malicious database entries.
 */
function isValidVfsPath(vfsPath: string): boolean {
  if (!vfsPath || vfsPath.trim().length === 0) return false;
  // Reject absolute paths
  if (path.isAbsolute(vfsPath)) return false;
  // Reject paths with traversal sequences
  const normalized = path.normalize(vfsPath);
  if (normalized.startsWith('..') || normalized.startsWith('/') || normalized.includes('\0')) return false;
  // Limit path length
  if (vfsPath.length > 1024) return false;
  return true;
}

/**
 * Get the real filesystem workspace directory for a user.
 * Creates the directory if it doesn't exist.
 */
export function getWorkspaceDir(userId: string): string {
  const normalizedId = normalizeOwnerId(userId);
  const workspaceRoot = path.join(os.tmpdir(), 'vfs-workspace');
  const userDir = path.join(workspaceRoot, normalizedId);

  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
  }

  return userDir;
}

/**
 * Materialize all VFS files from the database to the real filesystem directory.
 * Overwrites existing files on disk with the database version.
 */
export async function materializeWorkspace(userId: string): Promise<string> {
  const normalizedId = normalizeOwnerId(userId);
  const workspaceDir = getWorkspaceDir(userId);

  logger.info('Materializing VFS workspace', { userId: normalizedId, workspaceDir });

  try {
    const db = getDb();

    // Load all files for this owner from the VFS database table
    const rows = db.prepare(
      `SELECT path, content, language, size, version, created_at, updated_at
       FROM vfs_workspace_files
       WHERE owner_id = ?
       ORDER BY path`
    ).all(normalizedId) as Array<{
      path: string;
      content: string;
      language: string;
      size: number;
      version: number;
      created_at: string;
      updated_at: string;
    }>;

    // Clean the workspace directory — remove stale files
    cleanWorkspaceDir(workspaceDir, rows.map(r => r.path));

    // Write all VFS files to the real filesystem
    let fileCount = 0;
    for (const row of rows) {
      // Skip directory markers
      if (row.path.endsWith('/.directory')) continue;

      // SECURITY: Validate the VFS path before materializing
      if (!isValidVfsPath(row.path)) {
        logger.warn('Skipping invalid VFS path during materialization', { path: row.path });
        continue;
      }

      const fullPath = path.join(workspaceDir, row.path);

      // SECURITY: Ensure the resolved path is inside the workspace
      try {
        if (!isPathInsideWorkspace(workspaceDir, fullPath)) {
          logger.warn('Path traversal detected during materialization', { path: row.path, fullPath });
          continue;
        }
      } catch {
        // realpathSync.native can fail if the path doesn't exist yet — that's OK
        // since we're about to create it. Just verify the parent directory is safe.
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        // After creating parent, verify again
        if (!isPathInsideWorkspace(workspaceDir, fullPath)) {
          logger.warn('Path traversal detected during materialization (post-create check)', { path: row.path });
          continue;
        }
      }

      fs.writeFileSync(fullPath, row.content, 'utf-8');
      fileCount++;
    }

    logger.info('VFS workspace materialized', {
      userId: normalizedId,
      workspaceDir,
      fileCount,
      totalFilesInDb: rows.length,
    });

    return workspaceDir;
  } catch (error: any) {
    // If VFS tables don't exist yet (migration hasn't run), just return the empty workspace dir
    if (error.message?.includes('no such table') || error.message?.includes('SQLITE_ERROR')) {
      logger.warn('VFS workspace tables not yet available — using empty workspace', {
        userId: normalizedId,
      });
      return workspaceDir;
    }
    throw error;
  }
}

/**
 * Clean the workspace directory by removing files that no longer exist in the VFS.
 */
function cleanWorkspaceDir(workspaceDir: string, vfsPaths: string[]): void {
  const vfsPathSet = new Set(vfsPaths);

  function walkAndClean(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkAndClean(fullPath);
        // Remove empty directories
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) {
            fs.rmdirSync(fullPath);
          }
        } catch {
          // Ignore — directory not empty or access denied
        }
      } else if (entry.isFile()) {
        const relativePath = path.relative(workspaceDir, fullPath);
        if (!vfsPathSet.has(relativePath)) {
          fs.unlinkSync(fullPath);
          logger.debug('Removed stale file from workspace', { path: relativePath });
        }
      }
    }
  }

  walkAndClean(workspaceDir);
}

/**
 * Sync a file change from the real filesystem back to the VFS database.
 * Called by the file watcher when a file is created, modified, or deleted in the workspace.
 */
export async function syncFileToVfs(
  userId: string,
  filePath: string,
  operation: 'create' | 'update' | 'delete'
): Promise<void> {
  const normalizedId = normalizeOwnerId(userId);
  const workspaceDir = getWorkspaceDir(userId);

  // SECURITY: Validate the file path to prevent traversal
  if (!isValidVfsPath(filePath)) {
    logger.warn('Ignoring invalid file path in VFS sync', { path: filePath });
    return;
  }

  const fullPath = path.join(workspaceDir, filePath);

  // SECURITY: Ensure the file is actually inside the workspace (symlink protection)
  try {
    if (!fs.existsSync(fullPath) && operation !== 'delete') return;
    if (fs.existsSync(fullPath) && !isPathInsideWorkspace(workspaceDir, fullPath)) {
      logger.warn('Path traversal detected in VFS sync — file is outside workspace', {
        path: filePath,
        fullPath,
      });
      return;
    }
  } catch {
    // realpathSync can fail on deleted files — that's OK
    return;
  }

  try {
    const db = getDb();

    if (operation === 'delete') {
      db.prepare(
        `DELETE FROM vfs_workspace_files WHERE owner_id = ? AND path = ?`
      ).run(normalizedId, filePath);
      logger.debug('Synced file deletion to VFS', { userId: normalizedId, path: filePath });
      return;
    }

    // SECURITY: Skip symlinks — don't expose system files through VFS
    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        logger.debug('Skipping symlink in VFS sync', { path: filePath });
        return;
      }
      if (!stat.isFile()) return;

      // SECURITY: Limit file size to prevent memory exhaustion
      if (stat.size > MAX_SYNC_FILE_SIZE) {
        logger.warn('Skipping large file in VFS sync (size limit)', {
          path: filePath,
          size: stat.size,
          limit: MAX_SYNC_FILE_SIZE,
        });
        return;
      }
    } catch {
      return; // File disappeared between check and read
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const stat = fs.statSync(fullPath);

    // Determine language from file extension
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
      '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
      '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown',
      '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
      '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell',
      '.sql': 'sql', '.java': 'java', '.cpp': 'cpp', '.c': 'c',
      '.cs': 'csharp', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
    };
    const language = languageMap[ext] || 'plaintext';

    db.prepare(
      `INSERT OR REPLACE INTO vfs_workspace_files
       (owner_id, path, content, language, size, version, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(
         (SELECT version FROM vfs_workspace_files WHERE owner_id = ? AND path = ?) + 1,
         1
       ), datetime('now'))`
    ).run(normalizedId, filePath, content, language, stat.size, normalizedId, filePath);

    // Update the workspace meta version
    db.prepare(
      `INSERT OR REPLACE INTO vfs_workspace_meta (owner_id, version, root, updated_at)
       VALUES (?, COALESCE((SELECT version FROM vfs_workspace_meta WHERE owner_id = ?) + 1, 1), ?, datetime('now'))`
    ).run(normalizedId, normalizedId, workspaceDir);

    logger.debug('Synced file change to VFS', {
      userId: normalizedId,
      path: filePath,
      operation,
      size: stat.size,
      language,
    });
  } catch (error: any) {
    // Tolerate VFS sync failures — don't crash the PTY
    if (error.message?.includes('no such table')) {
      // VFS tables not ready yet — silently skip
      return;
    }
    logger.error('Failed to sync file change to VFS', {
      userId: normalizedId,
      path: filePath,
      error: error.message,
    });
  }
}

/**
 * Watch a workspace directory for file changes and sync them to the VFS.
 * Returns a stop function to cancel the watcher.
 */
export function watchWorkspaceForChanges(userId: string): { stop: () => void } {
  const workspaceDir = getWorkspaceDir(userId);
  let stopped = false;

  // Use a simple polling-based file watcher (no native dependencies)
  const POLL_INTERVAL_MS = 1000; // Check every second
  const fileState = new Map<string, { mtime: number; size: number }>();

  // Initialize file state snapshot
  function snapshotFileState(): void {
    function walk(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // SECURITY: Skip symlinks entirely — don't follow or track them
        if (entry.isSymbolicLink()) continue;

        // SECURITY: Verify the path is inside the workspace
        try {
          if (!isPathInsideWorkspace(workspaceDir, fullPath)) continue;
        } catch { continue; }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // SECURITY: Limit tracked file size
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_SYNC_FILE_SIZE) continue;
            const relativePath = path.relative(workspaceDir, fullPath);
            fileState.set(relativePath, { mtime: stat.mtimeMs, size: stat.size });
          } catch { /* stat failed — skip */ }
        }
      }
    }
    walk(workspaceDir);
  }

  // Check for changes against the snapshot
  async function checkForChanges(): Promise<void> {
    if (stopped) return;

    const currentFiles = new Map<string, { mtime: number; size: number }>();
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];

    // Walk the filesystem synchronously to collect current state
    function walkCurrent(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // SECURITY: Skip symlinks entirely
        if (entry.isSymbolicLink()) continue;

        // SECURITY: Verify the path is inside the workspace
        try {
          if (!isPathInsideWorkspace(workspaceDir, fullPath)) continue;
        } catch { continue; }

        if (entry.isDirectory()) {
          walkCurrent(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            // SECURITY: Skip large files
            if (stat.size > MAX_SYNC_FILE_SIZE) continue;
            const relativePath = path.relative(workspaceDir, fullPath);
            currentFiles.set(relativePath, { mtime: stat.mtimeMs, size: stat.size });

            const prevState = fileState.get(relativePath);
            if (!prevState) {
              newFiles.push(relativePath);
            } else if (stat.mtimeMs > prevState.mtime || stat.size !== prevState.size) {
              modifiedFiles.push(relativePath);
            }
          } catch { /* stat failed — skip */ }
        }
      }
    }

    walkCurrent(workspaceDir);

    // Sync new and modified files to VFS (async, but outside the walk)
    for (const filePath of newFiles) {
      logger.debug('New file detected in workspace', { path: filePath });
      await syncFileToVfs(userId, filePath, 'create');
      const stat = currentFiles.get(filePath)!;
      fileState.set(filePath, stat);
    }
    for (const filePath of modifiedFiles) {
      await syncFileToVfs(userId, filePath, 'update');
      const stat = currentFiles.get(filePath)!;
      fileState.set(filePath, stat);
    }

    // Check for deleted files
    for (const [filePath] of fileState) {
      if (!currentFiles.has(filePath)) {
        await syncFileToVfs(userId, filePath, 'delete');
        fileState.delete(filePath);
      }
    }
  }

  // Initial snapshot
  snapshotFileState();

  // Start polling
  const interval = setInterval(() => {
    checkForChanges().catch(err => {
      logger.error('File watcher error', { error: err.message });
    });
  }, POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      logger.info('Workspace file watcher stopped', { workspaceDir });
    },
  };
}
