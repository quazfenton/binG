/**
 * Desktop VFS Service
 *
 * Bridges the Virtual Filesystem (VFS) with the real local filesystem
 * for Tauri desktop mode. VFS remains the source of truth for agent
 * operations (git-backed checkpoints and rollback), while local filesystem
 * reflects the synced state.
 *
 * Flow:
 *   Agent writes → VFS (versioned) → sync to local FS
 *   User edits locally → detected on next read → imported into VFS
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VirtualFilesystemService } from './virtual-filesystem-service';
import type { VirtualFile } from './filesystem-types';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopVFS');

export interface DesktopVFSConfig {
  /** Local directory to sync VFS files to */
  localRoot: string;
  /** If true, auto-sync VFS writes to local FS (default: true) */
  autoSync?: boolean;
  /** If true, import local edits on read (default: true) */
  importLocalEdits?: boolean;
}

export class DesktopVFSService {
  private vfs: VirtualFilesystemService;
  private localRoot: string;
  private autoSync: boolean;
  private importLocalEdits: boolean;
  /** Track hashes of files we last synced to detect external edits */
  private syncedHashes = new Map<string, string>();

  constructor(vfs: VirtualFilesystemService, config: DesktopVFSConfig) {
    this.vfs = vfs;
    this.localRoot = config.localRoot;
    this.autoSync = config.autoSync !== false;
    this.importLocalEdits = config.importLocalEdits !== false;
  }

  /**
   * Get the underlying VFS instance
   */
  get underlying(): VirtualFilesystemService {
    return this.vfs;
  }

  /**
   * Write a file to VFS and optionally sync to local filesystem
   */
  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
  ): Promise<VirtualFile> {
    // Write to VFS (versioned, git-backed)
    const file = await this.vfs.writeFile(ownerId, filePath, content, language);

    // Sync to local filesystem
    if (this.autoSync) {
      await this.syncToLocal(filePath, content);
    }

    return file;
  }

  /**
   * Read a file, checking local filesystem for external edits first
   */
  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    if (this.importLocalEdits) {
      await this.importLocalIfChanged(ownerId, filePath);
    }
    return this.vfs.readFile(ownerId, filePath);
  }

  /**
   * Delete a file from VFS and local filesystem
   */
  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    const result = await this.vfs.deletePath(ownerId, targetPath);
    if (this.autoSync) {
      const localPath = path.join(this.localRoot, targetPath);
      try {
        await fs.rm(localPath, { recursive: true, force: true });
      } catch {
        // Local file may not exist
      }
    }

    // Clean up hash cache for deleted path and its children
    const prefix = `${targetPath.replace(/\/+$/, '')}/`;
    for (const key of Array.from(this.syncedHashes.keys())) {
      if (key === targetPath || key.startsWith(prefix)) {
        this.syncedHashes.delete(key);
      }
    }

    return result;
  }

  /**
   * Create a directory in VFS and on local filesystem
   */
  async createDirectory(ownerId: string, dirPath: string): Promise<{ path: string; createdAt: string }> {
    const result = await this.vfs.createDirectory(ownerId, dirPath);
    if (this.autoSync) {
      const localPath = path.join(this.localRoot, dirPath);
      await fs.mkdir(localPath, { recursive: true });
    }
    return result;
  }

  /**
   * Sync a single file from VFS to local filesystem
   */
  async syncToLocal(filePath: string, content: string): Promise<void> {
    const localPath = path.join(this.localRoot, filePath);
    try {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content, 'utf-8');
      this.syncedHashes.set(filePath, this.hashContent(content));
      log.debug('Synced to local', { filePath });
    } catch (err: any) {
      log.warn('Failed to sync to local', { filePath, error: err.message });
    }
  }

  /**
   * Sync entire VFS workspace to local filesystem
   */
  async syncAllToLocal(ownerId: string): Promise<{ synced: number; errors: number }> {
    const snapshot = await this.vfs.exportWorkspace(ownerId);
    let synced = 0;
    let errors = 0;

    for (const file of snapshot.files) {
      try {
        await this.syncToLocal(file.path, file.content);
        synced++;
      } catch {
        errors++;
      }
    }

    log.info('Full sync to local', { synced, errors });
    return { synced, errors };
  }

  /**
   * Import a local file into VFS if it was externally modified
   */
  private async importLocalIfChanged(ownerId: string, filePath: string): Promise<boolean> {
    const localPath = path.join(this.localRoot, filePath);
    try {
      const localContent = await fs.readFile(localPath, 'utf-8');
      const localHash = this.hashContent(localContent);
      const lastSyncedHash = this.syncedHashes.get(filePath);

      // If local file hash differs from what we last synced, import it
      if (lastSyncedHash && localHash !== lastSyncedHash) {
        log.info('Local edit detected, importing to VFS', { filePath });
        await this.vfs.writeFile(ownerId, filePath, localContent);
        this.syncedHashes.set(filePath, localHash);
        return true;
      }

      // If we haven't synced this file yet, check against VFS content
      if (!lastSyncedHash) {
        try {
          const vfsFile = await this.vfs.readFile(ownerId, filePath);
          const vfsHash = this.hashContent(vfsFile.content);
          if (localHash !== vfsHash) {
            log.info('Local file differs from VFS, importing', { filePath });
            await this.vfs.writeFile(ownerId, filePath, localContent);
          }
          this.syncedHashes.set(filePath, localHash);
        } catch (vfsError: any) {
          // FIX: Non-ENOENT VFS read errors are real failures - don't treat as missing-file import
          if (vfsError?.code !== 'ENOENT') {
            log.error('Error reading VFS file during import - skipping import', { filePath, error: vfsError.message });
            return false;
          }
          // VFS file doesn't exist, import from local
          await this.vfs.writeFile(ownerId, filePath, localContent);
          this.syncedHashes.set(filePath, localHash);
          return true;
        }
      }
    } catch (error: any) {
      // Only ignore missing local file (ENOENT), rethrow other errors
      if (error?.code !== 'ENOENT') {
        log.error('Error importing local file', { filePath, error: error.message });
        throw error;
      }
    }
    return false;
  }

  /**
   * Import all files from a local directory into VFS
   */
  async importFromLocal(ownerId: string, localDir?: string): Promise<{ imported: number }> {
    const dir = localDir || this.localRoot;
    let imported = 0;

    const walk = async (currentDir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch (err: any) {
        // Skip directories that can't be read (permission errors, broken symlinks)
        log.warn('Cannot read directory during import', { currentDir, error: err.message });
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativePath = path.relative(dir, fullPath).replace(/\\/g, '/');

        // Skip hidden/system dirs
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        // Use lstat to detect symlinks - isDirectory() returns false for symlinks to dirs
        let fileStats: fs.Stats;
        try {
          fileStats = await fs.lstat(fullPath);
        } catch (err: any) {
          // Broken symlink - skip
          if (err.code === 'ENOENT') continue;
          log.warn('Cannot stat file during import', { fullPath, error: err.message });
          continue;
        }

        // Skip symlinks to avoid importing files outside the import directory
        if (fileStats.isSymbolicLink()) {
          log.debug('Skipping symlink during import', { fullPath, target: fileStats });
          continue;
        }

        if (fileStats.isDirectory()) {
          await walk(fullPath);
        } else {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            await this.vfs.writeFile(ownerId, relativePath, content);
            this.syncedHashes.set(relativePath, this.hashContent(content));
            imported++;
          } catch (err: any) {
            // Skip binary or unreadable files, but log unexpected errors
            if (err.code !== 'ENOENT' && err.code !== 'EISDIR') {
              log.warn('Failed to import file', { fullPath, error: err.message });
            }
          }
        }
      }
    };

    await walk(dir);
    log.info('Imported from local', { imported, dir });
    return { imported };
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  // Delegate remaining VFS methods
  listDirectory(ownerId: string, directoryPath?: string) {
    return this.vfs.listDirectory(ownerId, directoryPath);
  }

  search(ownerId: string, query: string, options?: { path?: string; limit?: number }) {
    return this.vfs.search(ownerId, query, options);
  }

  getWorkspaceVersion(ownerId: string) {
    return this.vfs.getWorkspaceVersion(ownerId);
  }

  exportWorkspace(ownerId: string) {
    return this.vfs.exportWorkspace(ownerId);
  }

  getGitBackedVFS(ownerId: string) {
    return this.vfs.getGitBackedVFS(ownerId);
  }

  getDiffSummary(ownerId: string, maxDiffs?: number) {
    return this.vfs.getDiffSummary(ownerId, maxDiffs);
  }

  rollbackToVersion(ownerId: string, targetVersion: number) {
    return this.vfs.rollbackToVersion(ownerId, targetVersion);
  }
}
