/**
 * OPFS Adapter
 *
 * OPFS backend for client-side file operations
 * Provides instant file operations using Origin Private File System
 * Server sync via API endpoints with proper authentication
 *
 * Features:
 * - OPFS-first read/write for instant operations
 * - Queue management for pending operations
 * - Conflict detection and resolution
 * - Offline mode support
 * - Version tracking
 */

'use client';

import { OPFSCore, OPFSError, opfsCore } from './opfs-core';
import { IndexedDBBackend, indexedDBBackend } from '../indexeddb-backend';
import type { VirtualFile } from '../filesystem-types';
import {
  fetchFileFromServer,
  writeFileToServer,
  getWorkspaceSnapshot,
} from './opfs-api-client';

export interface SyncOptions {
  direction?: 'to-opfs' | 'to-server' | 'bidirectional';
  includePatterns?: string[];
  excludePatterns?: string[];
  force?: boolean;
}

export interface SyncResult {
  success: boolean;
  filesSynced: number;
  bytesTransferred: number;
  conflicts: ConflictInfo[];
  errors: string[];
  duration: number;
}

export interface ConflictInfo {
  path: string;
  opfsVersion: number;
  serverVersion: number;
  resolution: 'opfs' | 'server' | 'manual';
}

export interface QueuedWrite {
  id: string;
  path: string;
  content: string;
  timestamp: number;
  synced: boolean;
  ownerId: string;
  version: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncTime: number | null;
  isOnline: boolean;
  hasConflicts: boolean;
  opfsSupported: boolean;
}

export interface OPFSAdapterOptions {
  autoSync?: boolean;
  autoSyncInterval?: number;
  maxQueueSize?: number;
}

/**
 * OPFS Adapter Class
 * 
 * Provides a seamless bridge between the server-side VFS and client-side OPFS.
 * Uses an OPFS-first strategy for instant read/write operations with 
 * background synchronization to the server.
 */
export class OPFSAdapter {
  private core: OPFSCore;
  private fallbackBackend: IndexedDBBackend | null = null;
  private usingFallback = false;
  private writeQueue: QueuedWrite[] = [];
  private syncInProgress = false;
  private lastSyncTime: Map<string, number> = new Map();
  private fileVersions: Map<string, { opfs: number; server: number }> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private enabled = false;
  private ownerId: string | null = null;
  private options: Required<OPFSAdapterOptions>;
  private onlineHandler: (() => void) | null = null;
  // Reference count to track multiple enable/disable calls from different components
  private enableCount = 0;
  private currentWorkspaceId: string | null = null;

  constructor(options: OPFSAdapterOptions = {}) {
    this.core = opfsCore;
    this.fallbackBackend = indexedDBBackend;
    this.options = {
      autoSync: true,
      autoSyncInterval: 30000, // 30 seconds
      maxQueueSize: 100,
      ...options,
    };
  }

  /**
   * Check if OPFS is supported in current environment
   */
  static isSupported(): boolean {
    return OPFSCore.isSupported();
  }

  /**
   * Enable OPFS for a workspace (with IndexedDB fallback)
   *
   * @param ownerId - Owner/session identifier
   * @param workspaceId - Workspace identifier (defaults to ownerId)
   */
  private pendingEnablePromise: Promise<void> | null = null;

  async enable(ownerId: string, workspaceId?: string): Promise<void> {
    const wsId = workspaceId || ownerId;

    // If already enabled for the same workspace, just increment reference count
    if (this.enabled && this.currentWorkspaceId === wsId) {
      this.enableCount++;
      console.log('[OPFS] Already enabled for workspace, incrementing ref count to:', this.enableCount);
      return Promise.resolve();
    }

    // If another enable() is in progress, wait for it to complete
    if (this.pendingEnablePromise) {
      return this.pendingEnablePromise.then(() => {
        // After waiting, check again in case it completed for the same workspace
        if (this.enabled && this.currentWorkspaceId === wsId) {
          this.enableCount++;
          console.log('[OPFS] Concurrent enable completed, incrementing ref count to:', this.enableCount);
          return;
        }
        // Otherwise, start a new enable for this workspace
        return this.enable(ownerId, wsId);
      });
    }

    // Mark that we're in the process of enabling
    this.enableCount = 1;
    this.pendingEnablePromise = this.performEnable(ownerId, wsId).finally(() => {
      this.pendingEnablePromise = null;
    });
    
    return this.pendingEnablePromise;
  }

  /**
   * Internal enable implementation
   */
  private async performEnable(ownerId: string, workspaceId: string): Promise<void> {
    try {
      // Try OPFS first
      if (OPFSCore.isSupported()) {
        try {
          // If enabled for a different workspace, we need to reinitialize
          if (this.enabled && this.currentWorkspaceId !== workspaceId) {
            console.log('[OPFS] Switching workspace from', this.currentWorkspaceId, 'to', workspaceId);
            await this.core.close();
          }

          await this.core.initialize(workspaceId);
          this.enabled = true;
          this.usingFallback = false;
          this.ownerId = ownerId;
          this.currentWorkspaceId = workspaceId;
          console.log('[OPFS] Enabled with OPFS backend for workspace:', workspaceId);
        } catch (opfsError) {
          // OPFS failed, fall back to IndexedDB
          console.warn('[OPFS] Initialization failed, falling back to IndexedDB:', opfsError);
          await this.enableFallback(ownerId, workspaceId);
        }
      } else {
        // OPFS not supported, use IndexedDB
        console.log('[OPFS] Not supported, using IndexedDB fallback');
        await this.enableFallback(ownerId, workspaceId);
      }
    } catch (enableError) {
      this.enableCount = 0;
      this.enabled = false;
      this.pendingEnablePromise = null;
      throw enableError;
    }

    // Set up online/offline handler
    if (typeof window !== 'undefined') {
      this.onlineHandler = () => {
        if (navigator.onLine && this.options.autoSync) {
          this.flushWriteQueue(this.ownerId!).catch(console.error);
        }
      };

      window.addEventListener('online', this.onlineHandler);
    }

    // Start background sync if enabled
    this.startBackgroundSyncLoop();

    // Initial sync from server (non-blocking)
    this.syncFromServer(this.ownerId!).catch(err => {
      console.warn('[OPFS] Initial sync failed:', err);
    });

    console.log('[OPFS] Enabled for owner:', ownerId, '(fallback:', this.usingFallback + ')');
  }

  /**
   * Enable IndexedDB fallback backend
   */
  private async enableFallback(ownerId: string, workspaceId: string): Promise<void> {
    try {
      if (!IndexedDBBackend.isSupported()) {
        throw new Error('IndexedDB not supported');
      }

      await this.fallbackBackend!.initialize(ownerId);
      this.enabled = true;
      this.usingFallback = true;
      this.ownerId = ownerId;
      this.currentWorkspaceId = workspaceId;
      console.log('[OPFS] Enabled with IndexedDB fallback for workspace:', workspaceId);
    } catch (fallbackError) {
      console.error('[OPFS] Fallback to IndexedDB failed:', fallbackError);
      throw new Error(
        `Failed to enable storage backend: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if using fallback backend
   */
  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Start background sync if enabled
   */
  private startBackgroundSyncLoop(): void {
    if (this.options.autoSync && !this.syncInterval) {
      this.syncInterval = setInterval(() => {
        if (this.enabled && this.ownerId) {
          this.syncFromServer(this.ownerId).catch(console.warn);
        }
      }, this.options.autoSyncInterval);
    }
  }

  /**
   * Stop background sync
   */
  private stopBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Disable OPFS for current workspace
   * Uses reference counting - only truly disables when all components have called disable()
   */
  async disable(): Promise<void> {
    // If enable() is still in progress, wait for it to complete before disabling
    if (this.pendingEnablePromise) {
      await this.pendingEnablePromise;
    }

    // Guard against negative reference count
    if (this.enableCount <= 0) {
      if (this.enabled) {
        console.log('[OPFS] disable() called with ref count', this.enableCount, 'but still enabled - forcing disable');
        // Force disable since we're in inconsistent state
        this.performDisable();
      } else {
        console.log('[OPFS] disable() called with non-positive ref count, ignoring');
      }
      return;
    }

    this.enableCount--;

    // Only disable if all components have called disable
    if (this.enableCount > 0) {
      console.log('[OPFS] Postponing disable, ref count now:', this.enableCount);
      return;
    }

    this.performDisable();
  }

  /**
   * Internal disable implementation
   */
  private performDisable(): void {
    this.enabled = false;
    this.ownerId = null;
    this.currentWorkspaceId = null;
    this.enableCount = 0; // Reset to 0
    this.stopBackgroundSync();

    // Remove event listeners
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }

    // Close OPFS core (non-blocking)
    this.core.close().catch(err => {
      console.warn('[OPFS] Failed to close core:', err);
    });
    
    console.log('[OPFS] Disabled');
  }

  /**
   * Check if OPFS is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.core.isInitialized();
  }

  /**
   * Read file with OPFS cache
   * 
   * Strategy:
   * 1. Try OPFS first (instant)
   * 2. Fallback to server if not in OPFS
   * 3. Cache server response in OPFS
   *
   * @param ownerId - Owner identifier
   * @param path - File path
   * @returns VirtualFile with content
   */
  async readFile(ownerId: string, path: string): Promise<VirtualFile> {
    if (!this.enabled) {
      // Fallback to server via API
      const file = await fetchFileFromServer(path);
      if (!file) throw new OPFSError('Failed to read file from server');
      return file;
    }

    try {
      // Try OPFS first (instant read)
      const opfsFile = await this.core.readFile(path);

      // Get version from tracking
      const versions = this.fileVersions.get(path);

      console.log('[OPFS] Read cache hit:', path);

      return {
        path,
        content: opfsFile.content,
        language: this.detectLanguage(path),
        lastModified: new Date(opfsFile.lastModified).toISOString(),
        createdAt: new Date(opfsFile.lastModified).toISOString(), // Use lastModified as fallback
        version: versions?.opfs || 1,
        size: opfsFile.size,
      };
    } catch (error) {
      // Fallback to server via API
      console.log('[OPFS] Read cache miss, fetching from server:', path);
      const serverFile = await fetchFileFromServer(path);
      
      if (!serverFile) {
        throw new OPFSError('File not found in OPFS or server');
      }

      // Cache in OPFS for next time (non-blocking)
      this.cacheInOPFS(path, serverFile.content).catch(err => {
        console.warn('[OPFS] Failed to cache file:', path, err);
      });

      return serverFile;
    }
  }

  /**
   * Write file with OPFS-first strategy
   * 
   * Strategy:
   * 1. Write to OPFS instantly (1-10ms)
   * 2. Queue server sync (background)
   * 3. Update local state immediately
   * 
   * @param ownerId - Owner identifier
   * @param path - File path
   * @param content - File content
   * @param language - Optional language hint
   * @returns VirtualFile with updated metadata
   */
  async writeFile(
    ownerId: string,
    path: string,
    content: string,
    language?: string
  ): Promise<VirtualFile> {
    if (!this.enabled) {
      // Write directly to server via API
      const success = await writeFileToServer(path, content, language);
      if (!success) throw new OPFSError('Failed to write file to server');
      
      return {
        path,
        content,
        language: language || this.detectLanguage(path),
        lastModified: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        version: 1,
        size: content.length,
      };
    }

    // Write to OPFS instantly
    const opfsResult = await this.core.writeFile(path, content);

    // Update version tracking
    const versions = this.fileVersions.get(path) || { opfs: 0, server: 0 };
    versions.opfs++;
    this.fileVersions.set(path, versions);

    // Queue server sync
    this.queueWrite(ownerId, path, content, versions.opfs);

    console.log('[OPFS] Write complete:', path, 'version:', versions.opfs);

    return {
      path,
      content,
      language: language || this.detectLanguage(path),
      lastModified: new Date(opfsResult.lastModified).toISOString(),
      createdAt: new Date(opfsResult.lastModified).toISOString(),
      version: versions.opfs,
      size: opfsResult.size,
    };
  }

  /**
   * Delete file from OPFS
   *
   * @param ownerId - Owner identifier
   * @param path - File path
   */
  async deleteFile(ownerId: string, path: string): Promise<void> {
    if (!this.enabled) {
      throw new OPFSError('Delete requires OPFS to be enabled');
    }

    // Delete from OPFS
    await this.core.deleteFile(path);

    // Clear version tracking
    this.fileVersions.delete(path);
  }

  /**
   * Create directory in OPFS
   *
   * @param path - Directory path
   * @param options - Directory creation options
   */
  async createDirectory(
    path: string,
    options: { recursive?: boolean } = {}
  ): Promise<void> {
    if (!this.enabled) {
      console.warn('[OPFS] createDirectory called but OPFS not enabled');
      return;
    }

    try {
      await this.core.createDirectory(path, options);
    } catch (error: any) {
      console.error('[OPFS] createDirectory failed for path:', path, error);
      throw error;
    }
  }

  /**
   * List directory contents from OPFS
   *
   * @param path - Directory path
   * @returns Array of directory entries
   */
  async listDirectory(path: string): Promise<OPFSDirectoryEntry[]> {
    if (!this.enabled) {
      console.warn('[OPFS] listDirectory called but OPFS not enabled - returning empty array');
      return [];
    }

    try {
      return await this.core.listDirectory(path);
    } catch (error: any) {
      console.error('[OPFS] listDirectory failed for path:', path, error);
      // Re-throw to let caller handle (use-opfs.ts logs and returns empty array)
      throw error;
    }
  }

  /**
   * Sync from server to OPFS
   *
   * Downloads all files from server VFS to OPFS cache.
   * Used for initial sync and refresh operations.
   *
   * @param ownerId - Owner identifier
   * @param options - Sync options
   * @returns Sync result with statistics
   */
  async syncFromServer(ownerId: string, options?: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let filesSynced = 0;
    let bytesTransferred = 0;

    try {
      // FIX: Check if using IndexedDB fallback or if OPFS is not initialized
      if (this.usingFallback) {
        console.log('[OPFS] Skipping sync - using IndexedDB fallback');
        return {
          success: true,
          filesSynced: 0,
          bytesTransferred: 0,
          conflicts: [],
          errors: [],
          duration: Date.now() - startTime,
        };
      }

      // CRITICAL FIX: Initialize OPFS core if not already initialized (prevents "OPFS not initialized" errors)
      if (!this.core.isInitialized()) {
        console.log('[OPFS] OPFS core not initialized, initializing before sync...');
        try {
          // Use the ownerId as workspaceId for initialization
          await this.core.initialize(ownerId);
          console.log('[OPFS] Core initialization successful');
        } catch (initError: any) {
          console.warn('[OPFS] Core initialization failed, enabling IndexedDB fallback:', initError.message);
          // TRULY enable fallback by calling enableFallback to initialize IndexedDB backend
          try {
            await this.enableFallback(ownerId, ownerId);
            console.log('[OPFS] IndexedDB fallback enabled successfully');
          } catch (fallbackError: any) {
            console.error('[OPFS] Failed to enable IndexedDB fallback:', fallbackError.message);
            return {
              success: false,
              filesSynced: 0,
              bytesTransferred: 0,
              conflicts: [],
              errors: [
                `OPFS initialization failed: ${initError.message}`,
                `Fallback initialization failed: ${fallbackError.message}`,
              ],
              duration: Date.now() - startTime,
            };
          }
        }
      }

      // Get server snapshot via API
      const snapshot = await getWorkspaceSnapshot();

      if (!snapshot) {
        return {
          success: false,
          filesSynced: 0,
          bytesTransferred: 0,
          conflicts: [],
          errors: ['Failed to fetch snapshot from server'],
          duration: Date.now() - startTime,
        };
      }

      console.log('[OPFS] Syncing from server:', snapshot.files.length, 'files');

      // Sync files from snapshot to OPFS
      for (const file of snapshot.files) {
        // Check for version conflicts
        const versions = this.fileVersions.get(file.path);
        if (versions && versions.opfs > (file.version || 1)) {
          conflicts.push({
            path: file.path,
            serverVersion: file.version || 1,
            opfsVersion: versions.opfs,
            resolution: 'manual',
          });
          continue;
        }

        // Write to OPFS
        await this.core.writeFile(file.path, file.content);
        filesSynced++;
        bytesTransferred += file.size || 0;

        // Update version tracking
        this.fileVersions.set(file.path, {
          opfs: file.version || 1,
          server: file.version || 1,
        });
      }

      return {
        success: true,
        filesSynced,
        bytesTransferred,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      errors.push(error.message);
      console.error('[OPFS] Sync from server failed:', error);

      return {
        success: false,
        filesSynced: 0,
        bytesTransferred: 0,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sync from OPFS to server
   * 
   * Uploads all pending changes from OPFS to server VFS.
   * Primarily used for manual sync triggers.
   * 
   * @param ownerId - Owner identifier
   * @param options - Sync options
   * @returns Sync result with statistics
   */
  async syncToServer(ownerId: string, options?: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let filesSynced = 0;
    let bytesTransferred = 0;

    try {
      // Flush write queue first
      await this.flushWriteQueue(ownerId);

      // Get OPFS stats
      const stats = await this.core.getStats();

      console.log('[OPFS] Syncing to server. Stats:', stats);

      // Walk OPFS tree and sync files that differ from server
      await this.syncOPFSToServerRecursive(
        ownerId,
        '',
        options,
        errors,
        conflicts,
        { filesSynced, bytesTransferred }
      );

      console.log('[OPFS] Sync to server complete:', filesSynced, 'files');

      return {
        success: errors.length === 0 && conflicts.length === 0,
        filesSynced,
        bytesTransferred,
        conflicts,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      errors.push(error.message);
      console.error('[OPFS] Sync to server failed:', error);
      
      return {
        success: false,
        filesSynced: 0,
        bytesTransferred: 0,
        conflicts: [],
        errors,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Queue a write for background server sync
   */
  queueWrite(ownerId: string, path: string, content: string, version: number): void {
    // Check queue size limit
    if (this.writeQueue.length >= this.options.maxQueueSize) {
      // Remove oldest entry
      this.writeQueue.shift();
    }

    this.writeQueue.push({
      id: `write_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      path,
      content,
      timestamp: Date.now(),
      synced: false,
      ownerId,
      version,
    });

    console.log('[OPFS] Queued write:', path, 'queue size:', this.writeQueue.length);

    // Trigger immediate sync if queue is small
    if (this.writeQueue.length <= 5) {
      this.flushWriteQueue(ownerId).catch(console.error);
    }
  }

  /**
   * Flush write queue to server
   */
  async flushWriteQueue(ownerId: string): Promise<void> {
    if (this.syncInProgress || this.writeQueue.length === 0) {
      return;
    }

    this.syncInProgress = true;

    try {
      const pendingWrites = this.writeQueue.filter(w => !w.synced);

      console.log('[OPFS] Flushing', pendingWrites.length, 'pending writes to server');

      for (const write of pendingWrites) {
        try {
          const success = await writeFileToServer(write.path, write.content);

          if (success) {
            // Update version tracking (server caught up)
            const versions = this.fileVersions.get(write.path) || { opfs: 0, server: 0 };
            versions.server = versions.opfs;
            this.fileVersions.set(write.path, versions);

            write.synced = true;

            console.log('[OPFS] Synced to server:', write.path);
          }
        } catch (error: any) {
          console.error('[OPFS] Failed to sync to server:', write.path, error);
        }
      }

      // Remove synced writes from queue
      this.writeQueue = this.writeQueue.filter(w => !w.synced);

      // Update last sync time
      this.lastSyncTime.set(ownerId, Date.now());
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get pending changes count
   */
  getPendingChangesCount(): number {
    return this.writeQueue.filter(w => !w.synced).length;
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncStatus {
    const lastSync = this.lastSyncTime.values().next().value || null;
    
    return {
      isSyncing: this.syncInProgress,
      pendingChanges: this.getPendingChangesCount(),
      lastSyncTime: lastSync,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      hasConflicts: false, // Would need to track conflicts separately
      opfsSupported: OPFSCore.isSupported(),
    };
  }

  /**
   * Get file version info
   */
  getFileVersions(path: string): { opfs: number; server: number } | null {
    return this.fileVersions.get(path) || null;
  }

  /**
   * Clear all version tracking
   */
  clearVersionTracking(): void {
    this.fileVersions.clear();
  }

  // ========== Private Methods ==========

  private startBackgroundSync(): void {
    this.stopBackgroundSync(); // Clear any existing interval

    this.syncInterval = setInterval(() => {
      if (navigator.onLine && this.writeQueue.length > 0 && this.ownerId) {
        this.flushWriteQueue(this.ownerId).catch(console.error);
      }
    }, this.options.autoSyncInterval);

    console.log('[OPFS] Background sync started (interval:', this.options.autoSyncInterval, 'ms)');
  }

  private async cacheInOPFS(path: string, content: string): Promise<void> {
    try {
      await this.core.writeFile(path, content);
    } catch (error) {
      console.warn('[OPFS] Failed to cache file:', path, error);
    }
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'bash',
      sql: 'sql',
    };
    return languageMap[ext || ''] || 'text';
  }

  private shouldIncludeFile(
    path: string,
    options?: SyncOptions
  ): boolean {
    if (!options) return true;

    // Check exclude patterns first
    if (options.excludePatterns) {
      for (const pattern of options.excludePatterns) {
        if (this.matchesPattern(path, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (options.includePatterns) {
      for (const pattern of options.includePatterns) {
        if (this.matchesPattern(path, pattern)) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  private async syncOPFSToServerRecursive(
    ownerId: string,
    path: string,
    options: SyncOptions | undefined,
    errors: string[],
    conflicts: ConflictInfo[],
    stats: { filesSynced: number; bytesTransferred: number }
  ): Promise<void> {
    try {
      const entries = await this.core.listDirectory(path || '.');

      for (const entry of entries) {
        if (entry.type === 'file') {
          // Check include/exclude patterns
          if (!this.shouldIncludeFile(entry.path, options)) {
            continue;
          }

          // Check version tracking
          const versions = this.fileVersions.get(entry.path);
          if (versions && versions.opfs <= versions.server) {
            // Already in sync
            continue;
          }

          // Read from OPFS and write to server via API
          const opfsFile = await this.core.readFile(entry.path);

          try {
            const success = await writeFileToServer(entry.path, opfsFile.content);

            if (success) {
              // Update version tracking
              if (versions) {
                versions.server = versions.opfs;
                this.fileVersions.set(entry.path, versions);
              }

              stats.filesSynced++;
              stats.bytesTransferred += opfsFile.size;

              console.log('[OPFS] Synced to server:', entry.path);
            }
          } catch (error: any) {
            errors.push(`Failed to sync ${entry.path}: ${error.message}`);
          }
        } else if (entry.type === 'directory') {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) {
            await this.syncOPFSToServerRecursive(
              ownerId,
              entry.path,
              options,
              errors,
              conflicts,
              stats
            );
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'NotFoundError') {
        errors.push(`Failed to list directory ${path}: ${error.message}`);
      }
    }
  }
}

// Type export for directory entries
export interface OPFSDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: number;
}

// Singleton instance
export const opfsAdapter = new OPFSAdapter();
