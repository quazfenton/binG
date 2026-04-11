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
import type { Dirent, Stats } from 'fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { VirtualFilesystemService } from './virtual-filesystem-service';
import type { VirtualFile } from './filesystem-types';
import { emitFileEvent } from './file-events';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('DesktopVFS');

// === MULTI-SUBDIRECTORY DELETE DETECTION ===
// Track multiple subdirectories in local root for comprehensive delete detection

/**
 * Get all potential workspace subdirectories to track
 * These are dynamically discovered from the actual filesystem
 */
async function getLocalSubdirectories(localRoot: string): Promise<string[]> {
  const subdirs: string[] = [localRoot];  // Always include root
  
  try {
    const entries = await fs.readdir(localRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        subdirs.push(path.join(localRoot, entry.name));
      }
    }
  } catch {
    // Local root might not exist yet - that's OK
  }
  
  return subdirs;
}

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
  
  // === IMPROVEMENT 1: Per-session debounce queues ===
  // Each PTY session gets its own debounce queue instead of global
  private sessionDebounceQueues: Map<string, NodeJS.Timeout> = new Map();
  private pendingSessionSyncs: Map<string, Set<string>> = new Map();  // ownerId -> set of paths to sync
  private readonly DEBOUNCE_DELAY_MS = 300;  // Debounce delay per session
  
  // === IMPROVEMENT 2: Dedup deletes ===
  // Track recently deleted files to prevent duplicate delete events
  private recentlyDeletedFiles: Map<string, number> = new Map();  // path -> timestamp
  private readonly DELETE_DEDUP_WINDOW_MS = 2000;  // Window to dedup delete events
  private knownFiles: Map<string, Set<string>> = new Map();  // Track known files per owner for delete detection
  
  // === IMPROVEMENT 3: File sync coalescing ===
  // Merge multiple changes to same file within coalescing window
  private pendingFileChanges: Map<string, { content: string; timestamp: number }> = new Map();  // path -> {content, timestamp}
  private coalescingTimer: NodeJS.Timeout | null = null;
  private readonly COALESCING_WINDOW_MS = 500;  // Window to coalesce changes

  constructor(vfs: VirtualFilesystemService, config: DesktopVFSConfig) {
    this.vfs = vfs;
    this.localRoot = config.localRoot;
    this.autoSync = config.autoSync !== false;
    this.importLocalEdits = config.importLocalEdits !== false;
    
    // Start coalescing timer (IMPROVEMENT 3)
    this.startCoalescingTimer();
  }
  
  /**
   * Start the coalescing timer that flushes pending changes periodically
   */
  private startCoalescingTimer(): void {
    this.coalescingTimer = setInterval(() => {
      this.flushCoalescedChanges();
    }, this.COALESCING_WINDOW_MS);
    this.coalescingTimer.unref?.();
  }
  
  /**
   * Flush all coalesced file changes to local filesystem (IMPROVEMENT 3)
   */
  private async flushCoalescedChanges(): Promise<void> {
    if (this.pendingFileChanges.size === 0) return;
    
    const changes = new Map(this.pendingFileChanges);
    this.pendingFileChanges.clear();
    
    for (const [path, { content }] of changes) {
      try {
        await this.syncToLocal(path, content);
        log.debug('Coalesced sync to local', { path });
      } catch (err: any) {
        log.warn('Failed to flush coalesced change', { path, error: err.message });
      }
    }
    
    log.info(`Flushed ${changes.size} coalesced file changes to local FS`);
  }
  
  /**
   * Queue a file change for coalescing (IMPROVEMENT 3)
   * Multiple changes to same file within coalescing window are merged
   */
  private queueFileChange(path: string, content: string): void {
    this.pendingFileChanges.set(path, { content, timestamp: Date.now() });
  }
  
  /**
   * Check and track deleted files for dedup (IMPROVEMENT 2)
   * Returns true if this delete should be skipped (duplicate)
   */
  private shouldSkipDuplicateDelete(path: string): boolean {
    // Cleanup old entries periodically to prevent memory leak
    const now = Date.now();
    for (const [p, time] of this.recentlyDeletedFiles) {
      if (now - time > this.DELETE_DEDUP_WINDOW_MS) {
        this.recentlyDeletedFiles.delete(p);
      }
    }
    
    const lastDelete = this.recentlyDeletedFiles.get(path);
    if (lastDelete && now - lastDelete < this.DELETE_DEDUP_WINDOW_MS) {
      log.debug('Dedup: Skipping duplicate delete', { path });
      return true;
    }
    this.recentlyDeletedFiles.set(path, now);
    return false;
  }
  
  /**
   * Track a file deletion (IMPROVEMENT 2)
   */
  private trackFileDeleted(path: string): void {
    this.recentlyDeletedFiles.set(path, Date.now());
  }
  
  /**
   * Queue a sync for a specific session with per-session debouncing (IMPROVEMENT 1)
   */
  private queueSessionSync(ownerId: string, paths: string[]): void {
    // Add paths to pending set
    if (!this.pendingSessionSyncs.has(ownerId)) {
      this.pendingSessionSyncs.set(ownerId, new Set());
    }
    const pending = this.pendingSessionSyncs.get(ownerId)!;
    paths.forEach(p => pending.add(p));
    
    // Clear existing debounce timer for this session
    const existingTimer = this.sessionDebounceQueues.get(ownerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new debounce timer
    const timer = setTimeout(async () => {
      const sessionPaths = this.pendingSessionSyncs.get(ownerId);
      if (sessionPaths && sessionPaths.size > 0) {
        log.debug(`Session ${ownerId} debounce fired for ${sessionPaths.size} paths`);
        // Process the queued paths - sync each to local
        for (const path of sessionPaths) {
          try {
            const file = await this.vfs.readFile(ownerId, path);
            await this.syncToLocal(path, file.content);
          } catch (err: any) {
            log.warn('Failed to sync queued path', { path, error: err.message });
          }
        }
        this.pendingSessionSyncs.delete(ownerId);
      }
      this.sessionDebounceQueues.delete(ownerId);
    }, this.DEBOUNCE_DELAY_MS);
    
    this.sessionDebounceQueues.set(ownerId, timer);
  }

  /**
   * Get the underlying VFS instance
   */
  get underlying(): VirtualFilesystemService {
    return this.vfs;
  }

  /**
   * Write a file to VFS and optionally sync to local filesystem (with coalescing - IMPROVEMENT 3)
   * @param sessionId Optional session ID for file tracking in smart-context
   */
  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    sessionId?: string,
  ): Promise<VirtualFile> {
    // Check if file exists to determine event type
    let existed = false;
    try {
      await this.vfs.readFile(ownerId, filePath);
      existed = true;
    } catch {
      // File doesn't exist, this is a create
    }

    // Write to VFS (versioned, git-backed)
    const file = await this.vfs.writeFile(ownerId, filePath, content, language);

    // Sync to local filesystem using coalescing (IMPROVEMENT 3)
    if (this.autoSync) {
      this.queueFileChange(filePath, content);
    }

    // Emit file event for UI updates and session tracking
    await emitFileEvent({
      userId: ownerId,
      sessionId,
      path: filePath,
      type: existed ? 'update' : 'create',
      content,
      source: 'desktop-vfs',
    });

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
   * Delete a file from VFS and local filesystem (with dedup - IMPROVEMENT 2)
   * @param sessionId Optional session ID for file tracking in smart-context
   */
  async deletePath(ownerId: string, targetPath: string, sessionId?: string): Promise<{ deletedCount: number }> {
    // Check for duplicate delete
    if (this.shouldSkipDuplicateDelete(targetPath)) {
      log.debug('Skipping duplicate delete', { targetPath });
      return { deletedCount: 0 };
    }
    
    const result = await this.vfs.deletePath(ownerId, targetPath);
    if (this.autoSync) {
      const localPath = path.join(this.localRoot, targetPath);
      try {
        await fs.rm(localPath, { recursive: true, force: true });
      } catch {
        // Local file may not exist
      }
    }

    // Track this deletion for dedup
    this.trackFileDeleted(targetPath);

    // Emit delete event with session ID for tracking
    await emitFileEvent({
      userId: ownerId,
      sessionId,
      path: targetPath,
      type: 'delete',
      source: 'desktop-vfs',
    });
    
    // Clean up hash cache for deleted path and its children
    const prefix = `${targetPath.replace(/\/+$/, '')}/`;
    for (const key of Array.from(this.syncedHashes.keys())) {
      if (key === targetPath || key.startsWith(prefix)) {
        this.syncedHashes.delete(key);
      }
    }
    
    // Clean up known files tracking
    this.knownFiles.delete(ownerId);

    return result;
  }

  /**
   * Create a directory in VFS and on local filesystem
   * @param sessionId Optional session ID for file tracking in smart-context
   */
  async createDirectory(ownerId: string, dirPath: string, sessionId?: string): Promise<{ path: string; createdAt: string }> {
    const result = await this.vfs.createDirectory(ownerId, dirPath);
    if (this.autoSync) {
      const localPath = path.join(this.localRoot, dirPath);
      await fs.mkdir(localPath, { recursive: true });
    }

    // Emit create event for directory with session ID for tracking
    await emitFileEvent({
      userId: ownerId,
      sessionId,
      path: dirPath,
      type: 'create',
      source: 'desktop-vfs-directory',
    });

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
   * Sync entire VFS workspace to local filesystem (with multi-subdirectory delete detection)
   */
  async syncAllToLocal(ownerId: string): Promise<{ synced: number; errors: number }> {
    const snapshot = await this.vfs.exportWorkspace(ownerId);
    let synced = 0;
    let errors = 0;

    // === MULTI-SUBDIRECTORY DELETE DETECTION ===
    // Get all subdirectories to track
    const localSubdirs = await getLocalSubdirectories(this.localRoot);
    
    // Track files across VFS and ALL subdirectories for comprehensive delete detection
    const currentFiles = new Set(snapshot.files.map(f => f.path));
    
    // Track per-owner known files
    const knownFilesKey = ownerId;
    const previouslyKnown = this.knownFiles.get(knownFilesKey) || new Set<string>();
    
    // Also track across all subdirs using special key
    const allSubdirsKey = `subdirs:${ownerId}`;
    const previouslyKnownAllSubdirs = this.knownFiles.get(allSubdirsKey) || new Set<string>();
    
    // Use Set for O(1) duplicate checking
    const deletedFilesSet = new Set<string>();
    
    // Find deleted files from main tracking
    for (const known of previouslyKnown) {
      if (!currentFiles.has(known)) {
        deletedFilesSet.add(known);
        this.trackFileDeleted(known);
      }
    }
    
    // Check cross-subdirectory deletions (files that moved between subdirs or were deleted)
    for (const known of previouslyKnownAllSubdirs) {
      // Check if this file exists in any subdirectory by checking if it's a basename match
      // or a relative path match within current VFS files
      let foundInSubdir = false;
      const knownBasename = path.basename(known);
      
      // Check if the basename exists in current VFS files
      if (currentFiles.has(knownBasename)) {
        foundInSubdir = true;
      } else {
        // Check if known path relative to any subdir is in current files
        for (const subdir of localSubdirs) {
          const relativePath = path.relative(subdir, known);
          // If path doesn't go up (doesn't start with ..), it's within this subdir
          if (!relativePath.startsWith('..')) {
            if (currentFiles.has(relativePath)) {
              foundInSubdir = true;
              break;
            }
          }
        }
      }
      
      // If not found in any subdir, it's a deletion
      if (!foundInSubdir && !currentFiles.has(knownBasename)) {
        deletedFilesSet.add(knownBasename);
        this.trackFileDeleted(knownBasename);
      }
    }
    
    // Update known files - track both main and all subdirs
    this.knownFiles.set(knownFilesKey, currentFiles);
    
    // Track files in all subdirectories
    const allSubdirFiles = new Set<string>();
    for (const file of snapshot.files) {
      allSubdirFiles.add(path.join(this.localRoot, file.path));
      // Also add basename for easier matching
      allSubdirFiles.add(file.path);
    }
    this.knownFiles.set(allSubdirsKey, allSubdirFiles);
    
    const finalDeletedFiles = Array.from(deletedFilesSet);
    if (finalDeletedFiles.length > 0) {
      log.info('Detected deleted files in VFS (multi-subdir)', { count: finalDeletedFiles.length, files: finalDeletedFiles, subdirs: localSubdirs.length });
    }

    // Use per-session debounce for syncing (IMPROVEMENT 1)
    const paths = snapshot.files.map(f => f.path);
    this.queueSessionSync(ownerId, paths);
    
    // For now, do immediate sync for full sync (could change to queued)
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
   * Stop all sync operations and clean up (for shutdown)
   */
  stopAll(): void {
    // Clear coalescing timer
    if (this.coalescingTimer) {
      clearInterval(this.coalescingTimer);
      this.coalescingTimer = null;
    }
    
    // Clear all session debounce queues
    for (const [, timer] of this.sessionDebounceQueues) {
      clearTimeout(timer);
    }
    this.sessionDebounceQueues.clear();
    this.pendingSessionSyncs.clear();
    
    // Clear all tracking maps
    this.recentlyDeletedFiles.clear();
    this.knownFiles.clear();
    this.pendingFileChanges.clear();
    
    log.info('DesktopVFS service stopped, all timers and maps cleaned up');
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
      let entries: Dirent[];
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
        let fileStats: Stats;
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
