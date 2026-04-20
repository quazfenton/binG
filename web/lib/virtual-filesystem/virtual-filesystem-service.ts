// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

import { isDesktopMode } from '@bing/platform/env';
import { fsBridge, isUsingLocalFS, initializeFSBridge } from '@bing/shared/FS/fs-bridge';
import type { FileSystemWatchEvent } from '@bing/shared/FS/index';
import { emitFilesystemUpdated } from './sync/sync-events';

import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type {
  VirtualFile,
  VirtualFilesystemDirectoryListing,
  VirtualFilesystemNode,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from './filesystem-types';
import { diffTracker } from './filesystem-diffs';
import { stripWorkspacePrefixes } from './scope-utils';
import { VFSBatchOperations } from './vfs-batch-operations';
import { createGitBackedVFS, getGitBackedVFSForOwner, type GitBackedVFS, type GitVFSOptions } from './git-backed-vfs';
import { getDatabase } from '@/lib/database/connection';
import { compress, decompress, isCompressed } from '@/lib/utils/compression';
// Caching for repeated directory listings (used by smart-context)
import { toolResultCache, toolCacheKey } from '@/lib/cache';
// import { emitFilesystemUpdated } from './sync/sync-events'; // Imported but not used - central emit deferred for now

// Default configuration
const DEFAULT_WORKSPACE_ROOT = process.env.DEFAULT_WORKSPACE_ROOT || 'project';
const MAX_PATH_LENGTH = 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_WORKSPACE_SIZE = 500 * 1024 * 1024; // 500MB total workspace
const MAX_FILES_PER_WORKSPACE = 10000;
const MAX_SEARCH_LIMIT = 100;

export type FilesystemChangeType = 'create' | 'update' | 'delete';

/**
 * Internal workspace state interface
 */
interface WorkspaceState {
  files: Map<string, VirtualFile>;
  version: number;
  updatedAt: string;
  loaded: boolean;
}

/**
 * Filesystem change event
 */
export interface FilesystemChangeEvent {
  path: string;
  type: FilesystemChangeType;
  ownerId: string;
  version: number;
}

/**
 * Conflict event emitted when potential concurrent modification is detected
 */
export interface ConflictEvent {
  path: string;
  previousContent: string;
  newContent: string;
  previousVersion: number;
  timestamp: string;
}

/**
 * Threshold for detecting concurrent modifications (in milliseconds)
 * Increased from 1000ms to 100ms to reduce false positives during rapid test execution
 * while still catching real concurrent modification conflicts in production
 */
const CONCURRENT_MODIFICATION_THRESHOLD_MS = process.env.NODE_ENV === 'test' ? 50 : 100;

export class VirtualFilesystemService {
  private readonly workspaceRoot: string;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly events = new EventEmitter();
  private batchManager: Map<string, VFSBatchOperations> = new Map();

  /**
   * Get batch operations manager for a specific owner
   */
  batch(ownerId: string): VFSBatchOperations {
    if (!this.batchManager.has(ownerId)) {
      this.batchManager.set(ownerId, new VFSBatchOperations(ownerId));
    }
    return this.batchManager.get(ownerId)!;
  }

  onFileChange(listener: (event: FilesystemChangeEvent) => void): () => void {
    this.events.on('fileChange', listener);
    return () => { this.events.off('fileChange', listener); };
  }

  onSnapshotChange(listener: (ownerId: string, version: number) => void): () => void {
    this.events.on('snapshotChange', listener);
    return () => { this.events.off('snapshotChange', listener); };
  }

  onConflict(listener: (event: ConflictEvent) => void): () => void {
    this.events.on('conflict', listener);
    return () => { this.events.off('conflict', listener); };
  }

  private emitFileChange(ownerId: string, filePath: string, type: FilesystemChangeType, version: number): void {
    this.events.emit('fileChange', { path: filePath, type, ownerId, version });
  }

  private emitSnapshotChange(ownerId: string, version: number): void {
    this.events.emit('snapshotChange', ownerId, version);
  }

  constructor(options: { workspaceRoot?: string } = {}) {
    // Initialize FS Bridge for desktop mode - set flag BEFORE async call to prevent race condition
    if (isDesktopMode()) {
      // Mark as attempting initialization to prevent race condition
      (this as any)._fsBridgeInitializing = true;
      this.initializeFSBridge().catch(err => {
        console.warn('[VFS] FS Bridge initialization deferred:', err.message);
      }).finally(() => {
        (this as any)._fsBridgeInitializing = false;
      });
    }

    this.workspaceRoot = (options.workspaceRoot || DEFAULT_WORKSPACE_ROOT).replace(/^\/+|\/+$/g, '') || DEFAULT_WORKSPACE_ROOT;
  }

  private async initializeFSBridge(): Promise<void> {
    try {
      // Use environment variable or default path for workspace root
      const workspaceRoot = process.env.DESKTOP_WORKSPACE_ROOT || undefined;
      
      // Read boundary settings from saved desktop settings (only in browser environment)
      let boundaryEnabled = false;
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
          const savedSettings = localStorage.getItem('desktop_settings');
          if (savedSettings) {
            const parsed = JSON.parse(savedSettings);
            boundaryEnabled = parsed.boundaryEnabled === true;
          }
        } catch (e) {
          // Use default (false) if settings can't be read
        }
      }
      
      await initializeFSBridge('desktop-user', { 
        boundaryEnabled,
        workspaceRoot 
      });
      
      // Register handler for external file watch events to emit global sync events
      this.registerWatchEventHandler();
      
      console.log('[VFS] FS Bridge initialized for desktop mode');
    } catch (err: any) {
      console.warn('[VFS] FS Bridge initialization failed:', err.message);
    }
  }
  
  /**
   * Register handler for external file watcher events
   * When files change externally (e.g., in another app), emit global sync events for UI refresh
   */
  private registerWatchEventHandler(): void {
    const watchHandler = (event: FileSystemWatchEvent) => {
      console.log('[VFS] External file change event received', { 
        type: event.type, 
        paths: event.paths 
      });
      
      // Get current version after the change
      const version = Date.now(); // Use timestamp as version for external changes
      
      // Emit global filesystem-updated event for cross-tab sync and real-time UI updates
      emitFilesystemUpdated({
        path: event.paths[0] || '',
        paths: event.paths,
        type: event.type === 'create' ? 'create' : 
              event.type === 'modify' ? 'update' : 
              event.type === 'delete' ? 'delete' : 'update',
        workspaceVersion: version,
        source: 'desktop-fs-external-watch',
        sessionId: 'desktop-user',
      });
      
      // Also emit internal events for local listeners
      for (const filePath of event.paths) {
        this.emitFileChange('desktop-user', filePath, event.type === 'delete' ? 'delete' : 'update', version);
      }
      this.emitSnapshotChange('desktop-user', version);
    };
    
    // Register the handler with fsBridge
    (fsBridge as any).onWatchEvent?.(watchHandler);
  }

  /**
   * Read a file from the virtual filesystem.
   * 
   * @param ownerId - The VFS owner identifier. This should be a composite session ID
   *   in the format "userId$sessionId" (e.g., "1$001", "anon:xyz$004") for proper
   *   session isolation. Use buildCompositeSessionId() from @/lib/identity to construct.
   *   For anonymous users, this will be "anon:timestamp$sessionId".
   * @param filePath - Path relative to the session workspace root (e.g., "src/App.tsx")
   * @returns The virtual file object with content and metadata
   */
  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        const file = await fsBridge.readFile(ownerId, filePath);
        return {
          path: file.path,
          content: file.content,
          language: file.language,
          lastModified: file.lastModified,
          createdAt: file.createdAt,
          size: file.size,
          version: 1,
        };
      } catch (error: any) {
        // In desktop mode, propagate error instead of falling back to VFS
        // VFS won't have user's files - better to fail explicitly
        throw new Error(`Failed to read file from local filesystem: ${error.message}`);
      }
    }
    
    console.log('[VFS] readFile called', { ownerId, filePath });
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const file = workspace.files.get(normalizedPath);

    if (!file) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    return file;
  }

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean; append?: boolean },
    _sessionId?: string // optional: for GitBackedVFS session scoping (unused in base VFS)
  ): Promise<VirtualFile> {
    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        // Check if file already exists to determine change type
        const existingFile = await fsBridge.exists(ownerId, filePath).catch(() => false);
        const changeType: FilesystemChangeType = existingFile ? 'update' : 'create';
        
        const file = await fsBridge.writeFile(ownerId, filePath, content, language);
        
        // Emit filesystem change event for UI updates
        const version = await fsBridge.getVersion(ownerId);
        this.emitFileChange(ownerId, file.path, changeType, version);
        this.emitSnapshotChange(ownerId, version);
        
        // Emit global filesystem-updated event for cross-tab sync and real-time UI updates
        emitFilesystemUpdated({
          path: file.path,
          paths: [file.path],
          type: changeType,
          workspaceVersion: version,
          source: changeType === 'update' ? 'desktop-fs-update' : 'desktop-fs-create',
          sessionId: ownerId,
        });
        
        return {
          path: file.path,
          content: file.content,
          language: file.language,
          lastModified: file.lastModified,
          createdAt: file.createdAt,
          size: file.size,
          version: version,
        };
      } catch (error: any) {
        // In desktop mode, propagate error instead of falling back to VFS
        throw new Error(`Failed to write file to local filesystem: ${error.message}`);
      }
    }
    
    console.log('[VFS] writeFile called', { ownerId, filePath, contentLength: content?.length, append: options?.append });
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();
    
    // Handle append mode
    let normalizedContent = typeof content === 'string' ? content : String(content ?? '');
    if (options?.append && previous) {
      normalizedContent = (previous.content || '') + normalizedContent;
    }

    // FIX: Skip write if content hasn't changed — prevents unnecessary version inflation
    // This happens when spec amplification or other processes re-write the same file
    if (previous && previous.content === normalizedContent) {
      return previous; // Return existing file without incrementing version
    }

    if (previous && options?.failIfExists && !options?.append) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }

    // Check for concurrent modification (conflict detection)
    // Only warn if time since last write is below threshold (indicates potential race condition)
    if (previous) {
      const timeSinceLastWrite = Date.now() - new Date(previous.lastModified).getTime();
      
      // Skip conflict detection in test environment for rapid sequential writes
      // Real concurrent modifications (from different async operations) will still be caught
      const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
      const threshold = isTestEnvironment ? CONCURRENT_MODIFICATION_THRESHOLD_MS : CONCURRENT_MODIFICATION_THRESHOLD_MS * 10;
      
      if (timeSinceLastWrite < threshold && timeSinceLastWrite >= 0) {
        // File was modified very recently - potential conflict
        // In tests: only warn if < 50ms (likely race condition)
        // In production: warn if < 1000ms (potential concurrent user edits)
        console.warn('[VFS] Potential concurrent modification:', filePath, {
          timeSinceLastWrite,
          previousVersion: previous.version,
          threshold,
          environment: isTestEnvironment ? 'test' : 'production',
        });

        // Emit conflict event for listeners to handle
        this.events.emit('conflict', {
          path: filePath,
          previousContent: previous.content,
          newContent: normalizedContent,
          previousVersion: previous.version,
          timestamp: now,
        });
      }
    }

    // Validate file size
    const fileSize = Buffer.byteLength(normalizedContent, 'utf8');
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds limit: ${this.formatFileSize(fileSize)} > ${this.formatFileSize(MAX_FILE_SIZE)}`
      );
    }

    // Validate total workspace size
    const currentTotalSize = Array.from(workspace.files.values())
      .reduce((sum, file) => sum + file.size, 0);
    const newTotalSize = currentTotalSize - (previous?.size || 0) + fileSize;

    if (newTotalSize > MAX_TOTAL_WORKSPACE_SIZE) {
      throw new Error(
        `Workspace quota exceeded: ${this.formatFileSize(newTotalSize)} > ${this.formatFileSize(MAX_TOTAL_WORKSPACE_SIZE)}. ` +
        `Consider deleting unused files.`
      );
    }

    // Validate file count
    if (!previous && workspace.files.size >= MAX_FILES_PER_WORKSPACE) {
      throw new Error(
        `Maximum file count exceeded: ${workspace.files.size} >= ${MAX_FILES_PER_WORKSPACE}`
      );
    }

    const file: VirtualFile = {
      path: normalizedPath,
      content: normalizedContent,
      language: language ?? this.getLanguageFromPath(normalizedPath),
      lastModified: now,
      createdAt: previous?.createdAt || now,
      version: (previous?.version || 0) + 1,
      size: fileSize,
    };

    workspace.files.set(normalizedPath, file);
    workspace.version += 1;
    workspace.updatedAt = now;

    // Invalidate directory listing cache and ALL parent paths up the hierarchy
    let currentPath = path.dirname(normalizedPath) || '.';
    while (currentPath !== '.' && currentPath !== '/') {
      toolResultCache.delete(`${ownerId}:${currentPath}`);
      currentPath = path.dirname(currentPath) || '.';
    }
    // Also invalidate root
    toolResultCache.delete(`${ownerId}:.`);
    toolResultCache.delete(`${ownerId}:/`);

    // Invalidate ALL search results when any file changes (search results may contain this file)
    // For more granular invalidation, we'd need to track which files are in each search result
    const searchPrefix = `search:${ownerId}:`;
    const allKeys = toolResultCache.keys ? toolResultCache.keys() : [];
    for (const key of allKeys) {
      if (key.startsWith(searchPrefix)) {
        toolResultCache.delete(key);
      }
    }

    const changeType: FilesystemChangeType = previous ? 'update' : 'create';
    diffTracker.trackChange(file, ownerId, previous?.content);

    // Persist workspace FIRST before emitting events
    // This ensures events only fire for successfully saved changes
    const persistedVersion = workspace.version;
    await this.persistWorkspace(ownerId, workspace);

    // Emit events AFTER successful persistence - use captured version to avoid race
    this.emitFileChange(ownerId, normalizedPath, changeType, persistedVersion);
    this.emitSnapshotChange(ownerId, persistedVersion);

    // NOTE: Central emitFilesystemUpdated() deferred - keeping existing per-component emit implementations
    // Future TODO: Centralize all emits here for consistency:
    // emitFilesystemUpdated({
    //   path: normalizedPath,
    //   paths: [normalizedPath],
    //   type: changeType,
    //   sessionId: normalizedPath.match(/^project\/sessions\/([^/]+)/)?.[1],  // Extract from path, not ownerId
    //   workspaceVersion: workspace.version,
    //   source: 'vfs-write',
    // });

    return file;
  }

  /**
   * Create a directory (ensures parent directories exist)
   * Directories are implicit in the VFS (created when files are written),
   * but this method allows explicit directory creation for empty folders.
   */
  async createDirectory(ownerId: string, dirPath: string): Promise<{ path: string; createdAt: string }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(dirPath);
    const now = new Date().toISOString();

    // Validate directory path
    if (!normalizedPath || normalizedPath === '.') {
      throw new Error('Directory path is required');
    }

    // Check if a file already exists at this path
    const existingFile = workspace.files.get(normalizedPath);
    if (existingFile) {
      throw new Error(`A file already exists at this path: ${normalizedPath}`);
    }

    // Check if directory already exists (by checking if any file has this as parent)
    const hasChildFiles = Array.from(workspace.files.keys()).some(
      filePath => filePath.startsWith(normalizedPath + '/')
    );

    // Create a marker file to represent the directory
    // Directories are implicit in VFS, but we create a .gitkeep-like marker for empty dirs
    const dirMarkerPath = `${normalizedPath}/.directory`;

    // FIX: Skip if directory marker already exists — prevent duplicate version increments
    if (workspace.files.has(dirMarkerPath)) {
      return { path: normalizedPath, createdAt: workspace.files.get(dirMarkerPath)!.createdAt || now };
    }

    const dirMarker: VirtualFile = {
      path: dirMarkerPath,
      content: '',
      language: 'markdown',
      lastModified: now,
      createdAt: now,
      version: 1,
      size: 0,
      isDirectoryMarker: true,
    };

    workspace.files.set(dirMarkerPath, dirMarker);
    // FIX: Don't increment version for directory marker — it's internal bookkeeping, not user content
    workspace.updatedAt = now;

    // Persist FIRST before emitting events
    await this.persistWorkspace(ownerId, workspace);

    // Emit events AFTER successful persistence
    this.emitFileChange(ownerId, normalizedPath, 'create', workspace.version);
    this.emitSnapshotChange(ownerId, workspace.version);

    return {
      path: normalizedPath,
      createdAt: now,
    };
  }

  /**
   * Format file size for human-readable error messages
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Get workspace size statistics
   */
  async getWorkspaceStats(ownerId: string): Promise<{
    totalSize: number;
    totalSizeFormatted: string;
    fileCount: number;
    largestFile?: { path: string; size: number; sizeFormatted: string };
    quotaUsage: {
      sizePercent: number;
      fileCountPercent: number;
    };
  }> {
    const workspace = await this.ensureWorkspace(ownerId);
    
    let totalSize = 0;
    let largestFile: { path: string; size: number } | undefined;
    
    for (const [filePath, file] of workspace.files.entries()) {
      totalSize += file.size;
      if (!largestFile || file.size > largestFile.size) {
        largestFile = { path: filePath, size: file.size };
      }
    }

    return {
      totalSize,
      totalSizeFormatted: this.formatFileSize(totalSize),
      fileCount: workspace.files.size,
      largestFile: largestFile ? {
        ...largestFile,
        sizeFormatted: this.formatFileSize(largestFile.size),
      } : undefined,
      quotaUsage: {
        sizePercent: (totalSize / MAX_TOTAL_WORKSPACE_SIZE) * 100,
        fileCountPercent: (workspace.files.size / MAX_FILES_PER_WORKSPACE) * 100,
      },
    };
  }

  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        const result = await fsBridge.deletePath(ownerId, targetPath);
        
        // Emit filesystem change event for UI updates
        const version = await fsBridge.getVersion(ownerId);
        this.emitFileChange(ownerId, targetPath, 'delete', version);
        this.emitSnapshotChange(ownerId, version);
        
        // Emit global filesystem-updated event for cross-tab sync and real-time UI updates
        emitFilesystemUpdated({
          path: targetPath,
          paths: [targetPath],
          type: 'delete',
          workspaceVersion: version,
          source: 'desktop-fs-delete',
          sessionId: ownerId,
        });
        
        return result;
      } catch (error: any) {
        throw new Error(`Failed to delete from local filesystem: ${error.message}`);
      }
    }

    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(targetPath);
    const normalizedPrefix = `${normalizedPath}/`;
    
    // Collect paths to delete first so we can increment version once
    const toDelete: string[] = [];
    for (const existingPath of Array.from(workspace.files.keys())) {
      if (existingPath === normalizedPath || existingPath.startsWith(normalizedPrefix)) {
        toDelete.push(existingPath);
      }
    }

    let deletedCount = 0;
    
    if (toDelete.length > 0) {
      // FIX: Increment version ONCE before emitting events so all events
      // carry the same correct post-deletion version number.
      workspace.version += 1;
      workspace.updatedAt = new Date().toISOString();

      for (const existingPath of toDelete) {
        const deletedFile = workspace.files.get(existingPath);
        workspace.files.delete(existingPath);
        deletedCount += 1;
        if (deletedFile) {
          diffTracker.trackDeletion(existingPath, ownerId, deletedFile.content);
        }
      }

      // Persist FIRST before emitting events
      await this.persistWorkspace(ownerId, workspace);

      // Emit events AFTER successful persistence
      for (const existingPath of toDelete) {
        this.emitFileChange(ownerId, existingPath, 'delete', workspace.version);

        // NOTE: Central emitFilesystemUpdated() deferred - keeping existing per-component emit implementations
        // Future TODO: Centralize all emits here for consistency:
        // emitFilesystemUpdated({
        //   path: existingPath,
        //   paths: [existingPath],
        //   type: 'delete',
        //   sessionId: ownerId.split(':').pop(),
        //   workspaceVersion: workspace.version,
        //   source: 'vfs-delete',
        // });
      }

      this.emitSnapshotChange(ownerId, workspace.version);
    }

    return { deletedCount };
  }

  async listDirectory(ownerId: string, directoryPath: string = this.workspaceRoot): Promise<VirtualFilesystemDirectoryListing> {
    // Try cache first for read-only operations
    const cacheKey = `${ownerId}:${directoryPath}`;
    const cached = toolResultCache.get(cacheKey);
    if (cached !== null) {
      return cached as VirtualFilesystemDirectoryListing;
    }

    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        const listing = await fsBridge.listDirectory(ownerId, directoryPath);
        return {
          path: listing.path,
          nodes: listing.nodes.map(node => ({
            type: node.type,
            name: node.name,
            path: node.path,
            language: node.type === 'file' ? this.getLanguageFromPath(node.name) : undefined,
            size: node.size,
            lastModified: new Date().toISOString(),
          })),
        };
      } catch (error: any) {
        throw new Error(`Failed to list directory from local filesystem: ${error.message}`);
      }
    }

    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedDirectoryPath = this.normalizePath(directoryPath);
    
    // CRITICAL FIX: If path is a file (not a directory), return empty listing
    // This prevents infinite loops when file paths are accidentally passed to listDirectory
    if (workspace.files.has(normalizedDirectoryPath)) {
      const file = workspace.files.get(normalizedDirectoryPath);
      if (file && !file.isDirectoryMarker) {
        // This is a file, not a directory - return empty listing
        return {
          path: normalizedDirectoryPath,
          nodes: [],
        };
      }
    }
    
    const directoryNodes = new Map<string, VirtualFilesystemNode>();
    const fileNodes: VirtualFilesystemNode[] = [];
    const directoryPrefix = `${normalizedDirectoryPath}/`;

    for (const file of workspace.files.values()) {
      // Skip .directory marker files (used to track empty directories)
      if (file.isDirectoryMarker || file.path.endsWith('/.directory')) {
        // But still use them to detect directory existence
        const dirPath = file.path.slice(0, -'/'.length - '.directory'.length);
        const dirName = path.posix.basename(dirPath);
        if (dirPath.startsWith(directoryPrefix) && !directoryNodes.has(dirName)) {
          directoryNodes.set(dirName, {
            type: 'directory',
            name: dirName,
            path: dirPath,
            isExplicit: true, // Mark as explicitly created directory
          });
        }
        continue;
      }

      // Skip files that don't start with the directory prefix
      if (!file.path.startsWith(directoryPrefix)) {
        continue;
      }

      const remainder = file.path.slice(directoryPrefix.length);
      if (!remainder) {
        continue;
      }

      const slashIndex = remainder.indexOf('/');
      if (slashIndex === -1) {
        fileNodes.push(this.toFileNode(file));
      } else {
        const directoryName = remainder.slice(0, slashIndex);
        if (!directoryNodes.has(directoryName)) {
          directoryNodes.set(directoryName, {
            type: 'directory',
            name: directoryName,
            path: `${normalizedDirectoryPath}/${directoryName}`,
            isExplicit: false, // Implicit directory from file paths
          });
        }
      }
    }

    const nodes = [
      ...Array.from(directoryNodes.values()).sort((a, b) => a.name.localeCompare(b.name)),
      ...fileNodes.sort((a, b) => a.name.localeCompare(b.name)),
    ];

    const listing = {
      path: normalizedDirectoryPath,
      nodes,
    };

    // Cache for 30s - invalidated on writes
    toolResultCache.set(cacheKey, listing, 60000);
    return listing;
  }

  async search(
    ownerId: string,
    query: string,
    options: {
      path?: string;
      pathPattern?: string;
      limit?: number;
      language?: string;
    } = {},
  ): Promise<{ files: VirtualFilesystemSearchResult[] }> {
    // Try cache first
    const searchCacheKey = `search:${ownerId}:${query}:${options.path || 'root'}`;
    const cachedSearch = toolResultCache.get(searchCacheKey);
    if (cachedSearch !== null) {
      return cachedSearch as { files: VirtualFilesystemSearchResult[] };
    }

    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        const results = await fsBridge.search(ownerId, query, { path: options.path, limit: options.limit });
        return {
          files: results.map(r => ({
            path: r.path,
            name: r.name,
            language: r.language,
            score: r.score,
            snippet: r.snippet,
            lastModified: r.lastModified,
          })),
        };
      } catch (error: any) {
        throw new Error(`Failed to search local filesystem: ${error.message}`);
      }
    }

    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return { files: [] };
    }

    const searchBasePath = this.normalizePath(options.path || this.workspaceRoot);
    const searchPrefix = `${searchBasePath}/`;
    const limit = Math.max(1, Math.min(options.limit || 25, MAX_SEARCH_LIMIT));
    const matches: VirtualFilesystemSearchResult[] = [];

    for (const file of workspace.files.values()) {
      if (file.path !== searchBasePath && !file.path.startsWith(searchPrefix)) {
        continue;
      }

      // Apply path pattern filter if provided
      if (options.pathPattern) {
        const pattern = options.pathPattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
        const regex = new RegExp(pattern);
        if (!regex.test(file.path)) {
          continue;
        }
      }

      // Apply language filter if provided
      if (options.language && file.language !== options.language) {
        continue;
      }

      const fileName = path.posix.basename(file.path).toLowerCase();
      const lowerPath = file.path.toLowerCase();
      const lowerContent = file.content.toLowerCase();
      const inName = fileName.includes(normalizedQuery);
      const inPath = lowerPath.includes(normalizedQuery);
      const inContent = lowerContent.includes(normalizedQuery);

      if (!inName && !inPath && !inContent) {
        continue;
      }

      let score = 0;
      if (fileName === normalizedQuery) score += 120;
      if (inName) score += 80;
      if (inPath) score += 40;
      if (inContent) score += 20;

      matches.push({
        path: file.path,
        name: path.posix.basename(file.path),
        language: file.language,
        score,
        snippet: this.createSnippet(file.content, normalizedQuery),
        lastModified: file.lastModified,
      });
    }

    const result = {
      files: matches
        .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
        .slice(0, limit)
    };

    // Cache search results for 60s - invalidated on file changes
    toolResultCache.set(searchCacheKey, result, 60000);
    return result;
  }

  async getWorkspaceVersion(ownerId: string): Promise<number> {
    console.log('[VFS] getWorkspaceVersion called', { ownerId });
    const workspace = await this.ensureWorkspace(ownerId);
    return workspace.version;
  }

  async exportWorkspace(ownerId: string): Promise<VirtualWorkspaceSnapshot & { structure?: Record<string, string[]> }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const files = Array.from(workspace.files.values())
      .map((file) => ({ ...file }))
      .sort((a, b) => a.path.localeCompare(b.path));

    // Build directory structure
    const structure: Record<string, string[]> = {};
    for (const file of files) {
      const parts = file.path.split('/');
      if (parts.length > 1) {
        const dir = parts.slice(0, -1).join('/');
        if (!structure[dir]) {
          structure[dir] = [];
        }
        structure[dir].push(parts[parts.length - 1]);
      }
    }

    return {
      root: this.workspaceRoot,
      version: workspace.version,
      updatedAt: workspace.updatedAt,
      exportedAt: new Date().toISOString(),
      files,
      structure,
    };
  }

  private toFileNode(file: VirtualFile): VirtualFilesystemNode {
    return {
      type: 'file',
      name: path.posix.basename(file.path),
      path: file.path,
      language: file.language,
      size: file.size,
      lastModified: file.lastModified,
    };
  }

  private createSnippet(content: string, query: string): string {
    const lowerContent = content.toLowerCase();
    const matchIndex = lowerContent.indexOf(query);

    if (matchIndex === -1) {
      return content.slice(0, 140);
    }

    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(content.length, matchIndex + query.length + 60);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < content.length ? '...' : '';
    return `${prefix}${content.slice(start, end)}${suffix}`;
  }

  private getLanguageFromPath(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const languageByExtension: Record<string, string> = {
      js: 'javascript',
      jsx: 'jsx',
      ts: 'typescript',
      tsx: 'tsx',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      md: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      dart: 'dart',
      vue: 'vue',
      svelte: 'svelte',
      sh: 'shell',
      bash: 'shell',
      txt: 'text',
    };

    return languageByExtension[extension || ''] || 'text';
  }

  private normalizePath(inputPath: string): string {
    const rawPath = (inputPath || '').replace(/\\/g, '/').trim();
    if (!rawPath || rawPath === '/') {
      return this.workspaceRoot;
    }

    // Strip common sandbox/workspace prefixes (single source of truth in scope-utils)
    // BUT preserve project/ prefix if it's already there - don't strip it away
    let strippedPath = stripWorkspacePrefixes(rawPath);

    // Only strip project/ if it's at the beginning AND the stripped path doesn't start with project
    // This ensures consistent path format: always starts with 'project/'
    if (!strippedPath.startsWith('project/') && !strippedPath.startsWith('project$')) {
      // Already stripped, now add project/ prefix back if needed
      if (!strippedPath.startsWith('project')) {
        strippedPath = strippedPath.replace(/^project\//, '');
      }
    }

    // Handle empty path after stripping
    if (!strippedPath) {
      return this.workspaceRoot;
    }

    // CRITICAL VALIDATION: Reject composite IDs in session folder position
    // This prevents paths like "project/sessions/1$004/file.ts" or legacy "project/sessions/anon:timestamp:001/file.ts"
    // Session folder names must be simple: "001", "alpha", "001-1", etc.
    const sessionsMatch = strippedPath.match(/^project\/sessions\/([^/]+)/i);
    if (sessionsMatch) {
      const sessionSegment = sessionsMatch[1];
      if (sessionSegment.includes('$') || sessionSegment.includes(':')) {
        throw new Error(
          `Invalid session folder in path: "${inputPath}". ` +
          `Session folder names must be simple (e.g., "001", "alpha"), ` +
          `not composite IDs like "${sessionSegment}". ` +
          `Use normalizeSessionId() to extract the simple session name.`
        );
      }
    }

    const parts = strippedPath.split('/');
    const safeParts: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '.') {
        continue;
      }
      if (trimmed === '..') {
        throw new Error(`Path traversal is not allowed: ${inputPath}`);
      }
      if (trimmed.includes('\0')) {
        throw new Error(`Invalid path segment: ${inputPath}`);
      }
      safeParts.push(trimmed);
    }

    if (safeParts.length === 0) {
      return this.workspaceRoot;
    }

    // Always ensure path starts with workspace root
    if (safeParts[0] !== this.workspaceRoot) {
      safeParts.unshift(this.workspaceRoot);
    }

    const normalizedPath = safeParts.join('/');
    if (normalizedPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path exceeds max length (${MAX_PATH_LENGTH})`);
    }

    // DEBUG: Log path normalization for troubleshooting
    if (rawPath !== normalizedPath) {
      console.log('[VFS] normalizePath:', rawPath, '->', normalizedPath);
    }

    return normalizedPath;
  }

  private sanitizeOwnerId(ownerId: string): string {
    const trimmed = (ownerId || '').trim();
    if (!trimmed) {
      // WARNING: Empty ownerId should never happen if callers use resolveFilesystemOwner()
      // Using generateSecureId would cause inconsistent workspace per-request
      // Caller MUST provide a valid ownerId via resolveFilesystemOwner()
      console.warn('[VFS] Empty ownerId - callers should use resolveFilesystemOwner()');
      return 'anon:public';
    }
    if (trimmed.length > 256) return trimmed.slice(0, 256);
    return trimmed;
  }

  /**
   * Load workspace from SQLite database.
   * All workspace file content is stored in the main SQLite database.
   */
  private async ensureWorkspace(ownerId: string): Promise<WorkspaceState> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    let workspace = this.workspaces.get(normalizedOwnerId);

    if (!workspace) {
      workspace = {
        files: new Map<string, VirtualFile>(),
        version: 0,
        updatedAt: new Date().toISOString(),
        loaded: false,
      };
      this.workspaces.set(normalizedOwnerId, workspace);
    }

    if (!workspace.loaded) {
      try {
        const db = getDatabase();

        // Load metadata
        const meta = db.prepare(
          'SELECT version, root, updated_at FROM vfs_workspace_meta WHERE owner_id = ?'
        ).get(normalizedOwnerId) as { version: number; root: string; updated_at: string } | undefined;

        // Load files
        const rows = db.prepare(
          'SELECT path, content, language, size, version, created_at, updated_at FROM vfs_workspace_files WHERE owner_id = ? ORDER BY path'
        ).all(normalizedOwnerId) as Array<{
          path: string;
          content: string;
          language: string;
          size: number;
          version: number;
          created_at: string;
          updated_at: string;
        }>;

        if (rows.length > 0 || meta) {
          workspace.files = new Map(rows.map(row => {
            // FIX: Normalize backslashes to forward slashes when loading from DB.
            // Stale entries from Windows may contain backslashes that break path matching.
            const normalizedPath = row.path.replace(/\\/g, '/');
            // Decompress content if stored compressed
            const contentBuffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content, 'utf-8')
            const decompressedContent = isCompressed(contentBuffer) ? decompress(contentBuffer).toString('utf-8') : row.content
            return [normalizedPath, {
              path: normalizedPath,
              content: decompressedContent,
              language: row.language,
              size: row.size,
              version: row.version,
              lastModified: row.updated_at,
              createdAt: row.created_at,
              isDirectoryMarker: normalizedPath.endsWith('/.directory'),
            } as VirtualFile];
          }));

          workspace.version = meta?.version ?? rows.length;
          workspace.updatedAt = meta?.updated_at ?? new Date().toISOString();
        }
        // If no data exists in DB, workspace stays empty — files will be created on first write
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // Table not yet created — migration hasn't run. Start empty, will populate on write.
        if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
          // No-op — workspace stays empty
        } else {
          console.warn(`[VFS] Failed to load workspace for ${normalizedOwnerId}:`, msg);
        }
      }
    }

    // BACKGROUND FIX: Normalize any stale backslash paths in the database.
    // Windows writes paths like `foo\bar`, but VFS expects `foo/bar`.
    // This one-time-per-owner fix updates any rows that still contain backslashes.
    try {
      const db = getDatabase();
      // In JS template literals, '\\\\' → regex literal '%\\%' matches a literal backslash
      // and REPLACE's '\\\\' → SQL literal '\\' → one literal backslash character
      const backslashCount = (db.prepare(
        "SELECT COUNT(*) as cnt FROM vfs_workspace_files WHERE owner_id = ? AND path LIKE '%\\\\%'"
      ).get(normalizedOwnerId) as { cnt: number }).cnt;
      if (backslashCount > 0) {
        const normalizePaths = db.prepare(
          "UPDATE vfs_workspace_files SET path = REPLACE(path, '\\\\', '/') WHERE owner_id = ? AND path LIKE '%\\\\%'"
        );
        normalizePaths.run(normalizedOwnerId);
        console.log(`[VFS] Normalized ${backslashCount} backslash path(s) for owner ${normalizedOwnerId}`);
        // Invalidate in-memory cache so reload picks up corrected paths
        this.workspaces.delete(normalizedOwnerId);
      }
    } catch (err) {
      // Non-fatal — stale paths will still be caught by load-time normalization
    }

    workspace.loaded = true;
    return workspace;
  }

  /**
   * Persist workspace to SQLite database.
   * All operations (metadata update, deletes, upserts) run in a single
   * transaction for atomicity — if any part fails, the workspace is unchanged.
   */
  private async persistWorkspace(ownerId: string, workspace: WorkspaceState): Promise<void> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    const db = getDatabase();

    // Get GitVFS instance and disable auto-commit during persist to prevent commit loops
    this.enableBatchMode(normalizedOwnerId);

    try {
      const now = new Date().toISOString();
      const currentPaths = new Set(workspace.files.keys());

      // Prepare statements once (reused across calls)
      const upsertMeta = db.prepare(
        `INSERT OR REPLACE INTO vfs_workspace_meta (owner_id, version, root, updated_at) VALUES (?, ?, ?, ?)`
      );
      const selectPaths = db.prepare(
        'SELECT path FROM vfs_workspace_files WHERE owner_id = ?'
      );
      const deleteFile = db.prepare(
        'DELETE FROM vfs_workspace_files WHERE owner_id = ? AND path = ?'
      );
      const upsertFile = db.prepare(
        `INSERT OR REPLACE INTO vfs_workspace_files
         (id, owner_id, path, content, language, size, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // Wrap everything in a single transaction for atomicity
      const persistTx = db.transaction(() => {
        // 1. Update metadata
        upsertMeta.run(normalizedOwnerId, workspace.version, this.workspaceRoot, workspace.updatedAt);

        // 2. Delete files that no longer exist
        const existingRows = selectPaths.all(normalizedOwnerId) as Array<{ path: string }>;
        for (const row of existingRows) {
          if (!currentPaths.has(row.path)) {
            deleteFile.run(normalizedOwnerId, row.path);
          }
        }

        // 3. Upsert all current files
        for (const [filePath, file] of workspace.files) {
          const id = `${normalizedOwnerId}:${filePath}`;
          // Compress content before storing
          const compressedContent = compress(file.content)
          const contentToStore = compressedContent.length < file.content.length ? compressedContent : file.content
          upsertFile.run(id, normalizedOwnerId, filePath, contentToStore, file.language, file.size, file.version, file.createdAt || now, now);
        }
      });

      persistTx();

      // Re-enable auto-commit after persist completes
      await this.flushBatchMode(normalizedOwnerId);
    } catch (error: any) {
      console.error('[VFS] DB persist failed:', {
        ownerId: normalizedOwnerId,
        error: error.message,
      });
      // Re-enable auto-commit even on error
      await this.flushBatchMode(normalizedOwnerId);
      throw error;
    }
  }

  /**
   * Get diff summary for LLM context
   * Returns a human-readable summary of all file changes
   */
  getDiffSummary(ownerId: string, maxDiffs = 10): string {
    const result = diffTracker.getDiffSummary(ownerId, maxDiffs);
    return JSON.stringify(result);
  }

  /**
   * Rollback workspace to a specific version
   * Restores all files to their state at the target version
   */
  async rollbackToVersion(ownerId: string, targetVersion: number): Promise<{
    success: boolean;
    restoredFiles: number;
    deletedFiles: number;
    errors: string[];
  }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const operations = diffTracker.getRollbackOperations(ownerId, targetVersion);
    
    const errors: string[] = [];
    let restoredFiles = 0;
    let deletedFiles = 0;

    for (const op of operations) {
      try {
        if (op.operation === 'delete') {
          await this.deletePath(ownerId, op.path);
          deletedFiles++;
        } else if (op.content !== undefined) {
          await this.writeFile(ownerId, op.path, op.content);
          restoredFiles++;
        }
      } catch (error: any) {
        errors.push(`Failed to ${op.operation} ${op.path}: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      restoredFiles,
      deletedFiles,
      errors,
    };
  }

  /**
   * Transfer all VFS data from one owner to another.
   * Used when an anonymous user creates an account — their anonymous
   * workspace files, conversations, etc. move to the new authenticated user.
   */
  async transferOwnership(fromOwnerId: string, toOwnerId: string): Promise<{ transferredFiles: number }> {
    const normalizedFrom = this.sanitizeOwnerId(fromOwnerId);
    const normalizedTo = this.sanitizeOwnerId(toOwnerId);

    if (normalizedFrom === normalizedTo) {
      return { transferredFiles: 0 };
    }

    const db = getDatabase();

    // Check if source has any data to transfer
    const fileCount = (db.prepare('SELECT COUNT(*) as cnt FROM vfs_workspace_files WHERE owner_id = ?').get(normalizedFrom) as { cnt: number }).cnt;
    if (fileCount === 0) {
      return { transferredFiles: 0 };
    }

    const now = new Date().toISOString();

    const transferTx = db.transaction(() => {
      // 1. If target already has data, merge (skip conflicts) or replace?
      // Strategy: overwrite — the authenticated user's new workspace takes precedence,
      // but anonymous data fills in any gaps. First check what target already has.
      const existingTargetPaths = db.prepare(
        'SELECT path FROM vfs_workspace_files WHERE owner_id = ?'
      ).all(normalizedTo) as Array<{ path: string }>;
      const existingPaths = new Set(existingTargetPaths.map(r => r.path));

      // 2. Transfer files that don't conflict - use INSERT with processed content
      const transferFile = db.prepare(
        `INSERT OR IGNORE INTO vfs_workspace_files
         (id, owner_id, path, content, language, size, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // 3. Transfer meta if target has none
      const targetHasMeta = db.prepare(
        'SELECT owner_id FROM vfs_workspace_meta WHERE owner_id = ?'
      ).get(normalizedTo);

      let transferredCount = 0;

      // Get all source files
      const sourceFiles = db.prepare(
        'SELECT path, content, language, size, version, created_at, updated_at FROM vfs_workspace_files WHERE owner_id = ?'
      ).all(normalizedFrom) as Array<{
        path: string; content: string; language: string; size: number; version: number; created_at: string; updated_at: string;
      }>;

      for (const file of sourceFiles) {
        if (!existingPaths.has(file.path)) {
          const id = `${normalizedTo}:${file.path}`;
          // Compress content during transfer if beneficial
          const compressedContent = compress(file.content)
          const contentToStore = compressedContent.length < file.content.length ? compressedContent : file.content
          transferFile.run(id, normalizedTo, file.path, contentToStore, file.language, file.size, file.version, file.created_at, now);
          transferredCount++;
        }
      }

      // 4. Transfer meta only if target has none and source has it
      if (!targetHasMeta) {
        const sourceMeta = db.prepare(
          'SELECT version, root, updated_at FROM vfs_workspace_meta WHERE owner_id = ?'
        ).get(normalizedFrom) as { version: number; root: string; updated_at: string } | undefined;
        if (sourceMeta) {
          db.prepare(
            'INSERT OR REPLACE INTO vfs_workspace_meta (owner_id, version, root, updated_at) VALUES (?, ?, ?, ?)'
          ).run(normalizedTo, sourceMeta.version, sourceMeta.root, now);
        }
      }

      // 5. Delete source data
      db.prepare('DELETE FROM vfs_workspace_files WHERE owner_id = ?').run(normalizedFrom);
      db.prepare('DELETE FROM vfs_workspace_meta WHERE owner_id = ?').run(normalizedFrom);

      // 6. Clean up in-memory state
      this.workspaces.delete(normalizedFrom);
      diffTracker.clear(normalizedFrom);

      // 7. Invalidate target's in-memory cache so it reloads from DB
      this.workspaces.delete(normalizedTo);

      return transferredCount;
    });

    const transferredCount = transferTx();

    return { transferredFiles: transferredCount };
  }

  /**
   * Clear workspace state (for tests)
   */
  async clearWorkspace(ownerId: string): Promise<void> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    this.workspaces.delete(normalizedOwnerId);
    diffTracker.clear(ownerId);

    // Also delete from database
    const db = getDatabase();
    db.prepare('DELETE FROM vfs_workspace_files WHERE owner_id = ?').run(normalizedOwnerId);
    db.prepare('DELETE FROM vfs_workspace_meta WHERE owner_id = ?').run(normalizedOwnerId);
  }

  /**
   * Get files at a specific version
   */
  getFilesAtVersion(ownerId: string, targetVersion: number): Map<string, string> {
    return diffTracker.getFilesAtVersion(ownerId, targetVersion);
  }

  /**
   * Get diff tracker instance for advanced operations
   */
  getDiffTracker() {
    return diffTracker;
  }

  /**
   * Get git-backed VFS wrapper for owner
   * Enables automatic commits, rollbacks, and version tracking
   */
  getGitBackedVFS(ownerId: string, options?: GitVFSOptions): GitBackedVFS {
    return getGitBackedVFSForOwner(ownerId, this, options);
  }

  // Batch mode helpers for preventing circular commits during bulk operations
  // Note: VirtualFilesystemService doesn't have Git integration, so these are no-ops
  enableBatchMode(ownerId: string): void {
    // No-op for non-Git-backed VFS
  }

  async flushBatchMode(ownerId: string): Promise<void> {
    // No-op for non-Git-backed VFS
  }

  disableBatchMode(ownerId: string): void {
    // No-op for non-Git-backed VFS
  }
}

// =============================================================================
// Git-Backed VFS Proxy
// =============================================================================
// The main export now automatically wraps VFS operations with Git-backed
// functionality for automatic commits, version tracking, and rollbacks.
// This ensures all file operations are tracked without requiring code changes.
// =============================================================================

/**
 * Git-backed VFS proxy that wraps VirtualFilesystemService methods
 * to automatically create git commits for every filesystem operation.
 */
class GitBackedVFSProxy {
  private vfs: VirtualFilesystemService;

  constructor(vfs: VirtualFilesystemService) {
    this.vfs = vfs;
  }

  /**
   * Get the underlying VFS instance (for advanced operations)
   */
  get underlying(): VirtualFilesystemService {
    return this.vfs;
  }

  /**
   * Get git-backed VFS for specific owner (full-featured wrapper)
   */
  forOwner(ownerId: string, options?: GitVFSOptions): GitBackedVFS {
    return this.vfs.getGitBackedVFS(ownerId, options);
  }

  // Delegate all VFS methods with automatic git tracking

  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    return this.vfs.readFile(ownerId, filePath);
  }

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean; append?: boolean },
    sessionId?: string // optional: for GitBackedVFS session scoping
  ): Promise<VirtualFile> {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId, sessionId ? { sessionId } : undefined);
    return gitVFS.writeFile(ownerId, filePath, content, language, options);
  }

  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        const result = await fsBridge.deletePath(ownerId, targetPath);

        // Emit filesystem change event for UI updates
        const version = await fsBridge.getVersion(ownerId);
        (this as any).emitFileChange(ownerId, targetPath, 'delete', version);
        (this as any).emitSnapshotChange(ownerId, version);

        return result;
      } catch (error: any) {
        throw new Error(`Failed to delete from local filesystem: ${error.message}`);
      }
    }

    // Track deletion in git
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    const listing = await this.vfs.listDirectory(ownerId, targetPath);
    
    // Record deletions
    for (const node of listing.nodes) {
      if (node.type === 'file') {
        try {
          const file = await this.vfs.readFile(ownerId, node.path);
          gitVFS.trackTransaction(ownerId, {
            path: node.path,
            type: 'DELETE',
            timestamp: Date.now(),
            originalContent: file.content,
          });
        } catch {
          // File may not exist
        }
      }
    }
    
    const result = await this.vfs.deletePath(ownerId, targetPath);

    // Commit the deletion
    if (result !== null && result !== undefined && typeof result === 'object' && result.deletedCount > 0) {
      await gitVFS.commitChanges(ownerId, `Delete ${targetPath}`);
    }

    const deletedCount = result === null || result === undefined
      ? 0
      : typeof result === 'object'
        ? result.deletedCount || 0
        : (result ? 1 : 0);
    return { deletedCount };
  }

  async listDirectory(
    ownerId: string,
    directoryPath?: string
  ): Promise<import('./filesystem-types').VirtualFilesystemDirectoryListing> {
    return this.vfs.listDirectory(ownerId, directoryPath);
  }

  async search(
    ownerId: string,
    query: string,
    options?: { path?: string; limit?: number }
  ): Promise<import('./filesystem-types').VirtualFilesystemSearchResult[]> {
    const result = await this.vfs.search(ownerId, query, options);
    // Handle both array and object return types
    return Array.isArray(result) ? result : (result.files || []);
  }

  async getWorkspaceVersion(ownerId: string): Promise<number> {
    return this.vfs.getWorkspaceVersion(ownerId);
  }

  async exportWorkspace(ownerId: string): Promise<import('./filesystem-types').VirtualWorkspaceSnapshot> {
    return this.vfs.exportWorkspace(ownerId);
  }

  async createDirectory(
    ownerId: string,
    dirPath: string
  ): Promise<{ path: string; createdAt: string }> {
    const result = await this.vfs.createDirectory(ownerId, dirPath);

    // Track directory creation in git
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    gitVFS.trackTransaction(ownerId, {
      path: dirPath,
      type: 'CREATE',
      timestamp: Date.now(),
      newContent: '',
    });
    await gitVFS.commitChanges(ownerId, `Create directory ${dirPath}`);

    return result;
  }

  // Batch mode methods for bulk operations (used by refinement and bulk file writes)

  /**
   * Enable batch mode - disables auto-commit until flushBatchMode is called
   */
  enableBatchMode(ownerId: string): void {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    gitVFS.enableBatchMode(ownerId);
  }

  /**
   * Flush batch mode - commit all pending changes and re-enable auto-commit
   */
  async flushBatchMode(ownerId: string): Promise<{ success: boolean; committedFiles: number }> {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    return await gitVFS.flushBatch();
  }

  /**
   * Disable batch mode without committing (for error recovery)
   */
  disableBatchMode(ownerId: string): void {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    gitVFS.disableBatchMode();
  }

  async getWorkspaceStats(ownerId: string): Promise<{
    totalSize: number;
    totalSizeFormatted: string;
    fileCount: number;
    largestFile?: { path: string; size: number; sizeFormatted: string };
    quotaUsage: {
      sizePercent: number;
      fileCountPercent: number;
    };
  }> {
    return this.vfs.getWorkspaceStats(ownerId);
  }

  batch(ownerId: string): import('./vfs-batch-operations').VFSBatchOperations {
    return this.vfs.batch(ownerId);
  }

  onFileChange(
    listener: (event: import('./virtual-filesystem-service').FilesystemChangeEvent) => void
  ): () => void {
    return this.vfs.onFileChange(listener);
  }

  onSnapshotChange(
    listener: (ownerId: string, version: number) => void
  ): () => void {
    return this.vfs.onSnapshotChange(listener);
  }

  onConflict(
    listener: (event: import('./virtual-filesystem-service').ConflictEvent) => void
  ): () => void {
    return this.vfs.onConflict(listener);
  }

  getDiffSummary(ownerId: string, maxDiffs?: number): string {
    return this.vfs.getDiffSummary(ownerId, maxDiffs);
  }

  async rollbackToVersion(
    ownerId: string,
    targetVersion: number
  ): Promise<{
    success: boolean;
    restoredFiles: number;
    deletedFiles: number;
    errors: string[];
  }> {
    return this.vfs.rollbackToVersion(ownerId, targetVersion);
  }

  getDiffTracker(): import('./filesystem-diffs').FilesystemDiffTracker {
    return this.vfs.getDiffTracker();
  }

  getFilesAtVersion(ownerId: string, targetVersion: number): Map<string, string> {
    return this.vfs.getFilesAtVersion(ownerId, targetVersion);
  }

  /**
   * Clear workspace (for testing)
   * FIX Bug 19: Delegate to real VFS clearWorkspace (not just deletePath)
   */
  async clearWorkspace(ownerId: string): Promise<void> {
    // Delegate to the proper clear (wipes in-memory map + diff tracker + disk file)
    await (this as any).vfs.clearWorkspace(ownerId);
  }

  /**
   * Transfer VFS ownership from one owner to another (e.g. anon → authenticated user)
   */
  async transferOwnership(fromOwnerId: string, toOwnerId: string): Promise<{ transferredFiles: number }> {
    return this.vfs.transferOwnership(fromOwnerId, toOwnerId);
  }
}

// Export singleton instance with Git-backed proxy
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading in dev mode
// Without this, each module reload creates a new instance with empty workspaces
declare global {
  // eslint-disable-next-line no-var
  var __vfsSingleton__: GitBackedVFSProxy | undefined;
}

export const virtualFilesystem = globalThis.__vfsSingleton__ ?? (globalThis.__vfsSingleton__ = new GitBackedVFSProxy(new VirtualFilesystemService()));
