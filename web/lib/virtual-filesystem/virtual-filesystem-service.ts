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
import { stripWorkspacePrefixes, resolveScopePathFromOwnerId, resolveFilePathScopeFromOwnerId} from './scope-utils';
import { reconcileScopePathWithSessionId, DETECTION_TERMS, withDetectionTerms } from './session-path-guard';
// Bug #72 review fix: removed dead assertScopePathMatchesSessionId import
// (both call sites in this file now use the recovery variant).
import { getSnapshotBroadcaster } from './snapshot-broadcaster';
import { VFSBatchOperations } from './vfs-batch-operations';
import { createGitBackedVFS, getGitBackedVFSForOwner, type GitBackedVFS, type GitVFSOptions } from './git-backed-vfs';
import { getDatabase } from '@/lib/database/connection-shim';
import { compress, decompress, isCompressed } from '@/lib/utils/compression';
import { getContentAddressableStorage } from '@/lib/storage/content-addressable-storage';
// Bug #10/#25: import the shared error classes directly. Previously these
// were pulled in via `require('@/lib/vfs/transactional-vfs')` which created
// a circular import; the errors now live in `@/lib/vfs/errors.ts` and can be
// statically imported.
import {
  VersionMismatchError,
  ConcurrentModificationError,
} from '@/lib/vfs/errors';
// Caching for repeated directory listings (used by smart-context)
import { toolResultCache, toolCacheKey } from '@/lib/utils/cache';
// import { emitFilesystemUpdated } from './sync/sync-events'; // Imported but not used - central emit deferred for now

// Default configuration - use DESKTOP_WORKSPACE_ROOT for desktop mode
// Priority: window.__SIDECAR_CONFIG__ (Tauri) > DESKTOP_WORKSPACE_ROOT > INITIAL_CWD > 'workspace'
import { getDesktopWorkspaceDir } from '@/lib/utils/desktop-env';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VFS:Service');
const DEFAULT_WORKSPACE_ROOT = getDesktopWorkspaceDir();
const MAX_PATH_LENGTH = 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_WORKSPACE_SIZE = 500 * 1024 * 1024; // 500MB total workspace
const MAX_FILES_PER_WORKSPACE = 10000;
const MAX_SEARCH_LIMIT = 100;

// Phase 5 (CAS) threshold: files larger than this get stored in content-addressable store
// instead of inline in the SQL database. This deduplicates content and enables cheap snapshots.
// Configurable via CAS_INLINE_THRESHOLD_BYTES env var (default: 4096 = 4KB).
// Set to 0 to always use CAS; set to a very large value to never use CAS.
const CAS_STORAGE_THRESHOLD = (() => {
  const raw = process.env.CAS_INLINE_THRESHOLD_BYTES;
  if (raw === undefined || raw === '') return 4096;
  const val = parseInt(raw, 10);
  return isNaN(val) || val < 0 ? 4096 : val;
})();

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
 * Base threshold for detecting concurrent modifications (in milliseconds).
 *
 * The effective production threshold is `CONCURRENT_MODIFICATION_THRESHOLD_MS *
 * <multiplier>`, where the multiplier is read from
 * `VFS_CONCURRENT_MODIFICATION_MULTIPLIER` (default 2 → 200ms in production,
 * 50ms in test). Bug #95 (Pass-7 audit): the previous default multiplier of
 * 10 produced a 1000ms threshold which fired a false-positive on every
 * normal 250-300ms SQLite + Node.js fs write latency. 200ms is high enough
 * to skip normal latency but low enough to catch true race conditions
 * (typically <50ms).
 */
const CONCURRENT_MODIFICATION_THRESHOLD_MS = process.env.NODE_ENV === 'test' ? 50 : 100;

/**
 * Multiplier applied to the base concurrent-modification threshold in
 * production. Override via the `VFS_CONCURRENT_MODIFICATION_MULTIPLIER` env
 * var for emergency tuning (must be a positive integer; invalid values
 * fall back to the default). See Bug #95 (Pass-7).
 */
const CONCURRENT_MODIFICATION_MULTIPLIER = (() => {
  const raw = process.env.VFS_CONCURRENT_MODIFICATION_MULTIPLIER;
  if (raw === undefined || raw === '') return 2;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 1) return 2;
  return parsed;
})();

export class VirtualFilesystemService {
  private readonly workspaceRoot: string;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly events = new EventEmitter();
  private batchManager: Map<string, VFSBatchOperations> = new Map<string, VFSBatchOperations>();

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
    // Bug #16 (audit) — multi-worker caveat. The local in-process
    // `onSnapshotChange` listener only fires within this Node process.
    // In a multi-worker Next.js deployment, worker A's write would never
    // notify worker B. Broadcast the same event over Redis pub/sub
    // (fire-and-forget, contract: never throws) so every worker can
    // update its own `latestSeenVersion` and invalidate its own cache
    // entries. If Redis is unavailable, this call is a silent no-op
    // and the single-process path still works.
    getSnapshotBroadcaster().publish(ownerId, version);
  }

  constructor(options: { workspaceRoot?: string } = {}) {
    // Initialize FS Bridge for desktop mode - set flag BEFORE async call to prevent race condition
    if (isDesktopMode()) {
      // Mark as attempting initialization to prevent race condition
      (this as any)._fsBridgeInitializing = true;
      this.initializeFSBridge().catch(err => {
        logger.warn('[VFS] FS Bridge initialization deferred:', err.message);
      }).finally(() => {
        (this as any)._fsBridgeInitializing = false;
      });
    }

    this.workspaceRoot = (options.workspaceRoot || DEFAULT_WORKSPACE_ROOT).replace(/\/+$/g, '') || DEFAULT_WORKSPACE_ROOT;
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
      
      logger.info('[VFS] FS Bridge initialized for desktop mode');
    } catch (err: any) {
      logger.warn('[VFS] FS Bridge initialization failed:', err.message);
    }
  }
  
  /**
   * Register handler for external file watcher events
   * When files change externally (e.g., in another app), emit global sync events for UI refresh
   */
  private registerWatchEventHandler(): void {
    const watchHandler = (event: FileSystemWatchEvent) => {
      logger.info('[VFS] External file change event received', { 
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
    // Bug #26: verify the file path is consistent with the ownerId's
    // session. Catches the path-drift case where workspace/sessions/001 was
    // renamed to workspace/sessions/ai_terminal but the ownerId still
    // encodes "001" — the read would otherwise silently resolve to the wrong
    // folder. The check is a no-op for non-session paths (workspace root
    // reads, etc.) so it doesn't affect existing non-session workflows.
    const resolvedFilePath = resolveFilePathScopeFromOwnerId(ownerId, filePath);
      // Bug #72: rebind ownerId to the scopePath-derived value when a
      // path-drift mismatch is detected, so the actual read targets the
      // correct session folder. The recovery is logged at WARN level
      // by reconcileScopePathWithSessionId itself (includes the original
      // ownerId in the log payload for traceability).
      ownerId = reconcileScopePathWithSessionId(ownerId, resolvedFilePath).ownerId;

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
    
    logger.info('[VFS] readFile called', { ownerId, filePath });
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const file = workspace.files.get(normalizedPath);

    if (!file) {
      // SECURITY: Even if file doesn't exist, throw generic 'File not found'
      // to avoid leaking information about whether files exist in other workspaces
      throw new Error(`File not found: ${normalizedPath}`);
    }

    // SECURITY: Unconditional ownership verification.
    // Every file MUST track its owner. Files loaded from DB before the ownership
    // tracking fix (pre-ownerId field) will have undefined ownerId — these are
    // treated as unverifiable and rejected. Each file is stored with its ownerId
    // on write (see writeFile). If a file exists in the workspace but belongs to
    // a different owner, we must reject the access.
    if (!file.ownerId) {
      logger.error(`[VFS] SECURITY: File has no ownerId — rejecting access to prevent cross-workspace data leakage`, {
        requestingOwner: ownerId,
        path: normalizedPath
      });
      throw new Error(`File not found: ${normalizedPath}`);
    }
    if (file.ownerId !== ownerId) {
      logger.warn(`[VFS] SECURITY: Cross-workspace access blocked`, {
        requestingOwner: ownerId,
        fileOwner: file.ownerId,
        path: normalizedPath
      });
      throw new Error(`File not found: ${normalizedPath}`);
    }

    return file;
  }

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean; append?: boolean; bypassSync?: boolean; expectedVersion?: number; strictConcurrency?: boolean },
    _sessionId?: string // optional: for GitBackedVFS session scoping (unused in base VFS)
  ): Promise<VirtualFile> {
    // Bug #26: verify the file path is consistent with the ownerId's
    // session. Same rationale as readFile above — catch path drift before
    // we silently write to the wrong folder.
    const resolvedFilePath = resolveFilePathScopeFromOwnerId(ownerId, filePath);
      // Bug #72: rebind ownerId to the scopePath-derived value when a
      // path-drift mismatch is detected, so the actual read targets the
      // correct session folder. The recovery is logged at WARN level
      // by reconcileScopePathWithSessionId itself (includes the original
      // ownerId in the log payload for traceability).
      ownerId = reconcileScopePathWithSessionId(ownerId, resolvedFilePath).ownerId;

    // Desktop mode: Use local filesystem instead of VFS
    if (isDesktopMode() && isUsingLocalFS()) {
      try {
        // Check if file already exists to determine change type
        const existingFile = await fsBridge.exists(ownerId, filePath).catch(() => false);
        const changeType: FilesystemChangeType = existingFile ? 'update' : 'create';
        
        const file = await fsBridge.writeFile(ownerId, filePath, content, language);
        
        // Emit filesystem change event for UI updates
        const version = await fsBridge.getVersion(ownerId);
        
        if (!options?.bypassSync) {
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
        }
        
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
    
    logger.info('[VFS] writeFile called', { ownerId, filePath, contentLength: content?.length, append: options?.append });
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();
    
    // Handle append mode
    let normalizedContent = typeof content === 'string' ? content : String(content ?? '');
    if (options?.append && previous) {
      normalizedContent = (previous.content || '') + normalizedContent;
    }

    // Check failIfExists before checking content changes
    if (previous && options?.failIfExists && !options?.append) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }

    // FIX: Skip write if content hasn't changed — prevents unnecessary version inflation
    // This happens when spec amplification or other processes re-write the same file
    if (previous && previous.content === normalizedContent) {
      return previous; // Return existing file without incrementing version
    }

    // Check for concurrent modification (conflict detection)
    // Only warn if time since last write is below threshold (indicates potential race condition)
    if (previous) {
      const timeSinceLastWrite = Date.now() - new Date(previous.lastModified).getTime();

      // Skip conflict detection in test environment for rapid sequential writes
      // Real concurrent modifications (from different async operations) will still be caught
      const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
      // Bug #95 (Pass-7 audit): the previous inline multiplier of *10 produced
      // a 1000ms production threshold, which fired on every normal 250-300ms
      // write latency (SQLite + Node.js fs latency). The multiplier is now a
      // module-level constant (default 2 → 200ms in production) that still
      // catches true race conditions (typically <50ms) but skips normal
      // write latency. Override via VFS_CONCURRENT_MODIFICATION_MULTIPLIER
      // env var (must be a positive integer) for emergency tuning.
      const threshold = isTestEnvironment
        ? CONCURRENT_MODIFICATION_THRESHOLD_MS
        : CONCURRENT_MODIFICATION_THRESHOLD_MS * CONCURRENT_MODIFICATION_MULTIPLIER;

      if (timeSinceLastWrite < threshold && timeSinceLastWrite >= 0) {
        // File was modified very recently - potential conflict
        // In tests: only warn if < 50ms (likely race condition)
        // In production: warn if < 200ms (potential concurrent writes; bypass
        // normal 250-300ms SQLite write latency). Bug #95 (Pass-7): was 1000ms
        // which produced a false positive on every normal write.
        logger.warn(withDetectionTerms('[VFS] Potential concurrent modification', DETECTION_TERMS.drift, DETECTION_TERMS.mismatch), { filePath,
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

        // Bug #25: in strict-concurrency mode (set by the transactional layer),
        // throw instead of just logging. The default mode preserves the legacy
        // behavior so existing callers see no change.
        if (options?.strictConcurrency) {
          throw new ConcurrentModificationError(
            filePath,
            timeSinceLastWrite,
            threshold,
            previous.version,
          );
        }
      }
    }

    // Bug #10: optimistic-concurrency check. When the caller passes
    // `expectedVersion` and the file's current version doesn't match, throw
    // VersionMismatchError so the transactional layer can re-run its diff.
    if (
      typeof options?.expectedVersion === 'number' &&
      previous &&
      previous.version !== options.expectedVersion
    ) {
      throw new VersionMismatchError(
        filePath,
        options.expectedVersion,
        previous.version,
        1,
      );
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
      ownerId: this.sanitizeOwnerId(ownerId), // CRITICAL: Track ownership for security
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
    //   sessionId: normalizedPath.match(/^workspace\/sessions\/([^/]+)/)?.[1],  // Extract from path, not ownerId
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
        // Virtual VFS paths like "workspace/sessions" don't exist on the real
        // filesystem in desktop mode. Return an empty listing instead of
        // propagating the ENOENT error — the UI handles empty workspaces
        // gracefully, but an unhandled exception breaks the sidebar.
        if (error?.code === 'ENOENT' || /ENOENT|no such file|not found/i.test(error?.message || '')) {
          return {
            path: directoryPath || this.workspaceRoot,
            nodes: [],
          };
        }
        throw new Error(`Failed to list directory from local filesystem: ${error?.message || error}`);
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
        // Virtual VFS paths don't exist on the real filesystem in desktop mode.
        // Return empty results instead of propagating ENOENT.
        if (error?.code === 'ENOENT' || /ENOENT|no such file|not found/i.test(error?.message || '')) {
          return { files: [] };
        }
        throw new Error(`Failed to search local filesystem: ${error?.message || error}`);
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
    logger.info('[VFS] getWorkspaceVersion called', { ownerId });
    const workspace = await this.ensureWorkspace(ownerId);
    return workspace.version;
  }

  /**
   * Synchronous, in-memory workspace version getter.
   *
   * Bug #16 (audit hot-fix) — `getCurrentVersionSync` is the source of
   * truth for read-after-write staleness. The `workspaces` Map is updated
   * synchronously at the START of every write (before `await persistWorkspace`),
   * so this getter sees the in-flight version even before the persistence
   * completes and the `onSnapshotChange` listener fires.
   *
   * Returns 0 if the workspace has never been loaded — semantically
   * equivalent to "no writes have happened yet" (a fresh workspace starts
   * at version 0). A cached snapshot with version 0 should be treated as
   * "stale" if a write has happened in this process.
   *
   * The previous read-path check used `latestSeenVersion` (set by the
   * `onSnapshotChange` listener) which fires AFTER `await persistWorkspace`
   * completes. This left a race window: a read that started before the
   * write's listener fired would see the OLD `latestSeenVersion` and return
   * the cached entry, even though the in-memory workspace was already at
   * the new version. The sync getter eliminates the race because it reads
   * the authoritative in-memory state.
   *
   * Note: this only covers single-process correctness. For multi-process
   * invalidation (Next.js workers, multiple replicas), the listener-based
   * `latestSeenVersion` is still consulted as a cross-process fallback.
   *
   * @param ownerId  VFS owner id
   * @returns  Current in-memory workspace version (0 if not loaded)
   */
  getCurrentVersionSync(ownerId: string): number {
    return this.workspaces.get(ownerId)?.version ?? 0;
  }

  async exportWorkspace(ownerId: string): Promise<VirtualWorkspaceSnapshot & { structure?: Record<string, string[]> }> {
    if (isDesktopMode() && isUsingLocalFS()) {
      const snapshot = await fsBridge.exportWorkspace(ownerId);
      const files: VirtualFile[] = snapshot.files
        .map((file) => ({
          path: file.path,
          content: file.content,
          language: file.language || 'text',
          size: file.size ?? 0,
          version: (file as any).version ?? 1,
          lastModified: file.lastModified ?? new Date().toISOString(),
          createdAt: file.createdAt ?? new Date().toISOString(),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));

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
        root: snapshot.root,
        version: snapshot.version,
        updatedAt: new Date().toISOString(),
        exportedAt: new Date().toISOString(),
        files,
        structure,
      };
    }

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
    // When given the root path or empty, return the workspace root.
    // For desktop mode, this is the real filesystem path (e.g. /opt/bing/web).
    // For web mode, this should be a virtual path (e.g. 'workspace' or
    // 'workspace/sessions') — the getDefaultWorkspaceRoot() in env.ts handles
    // this distinction (returns process.cwd() for desktop, 'workspace/sessions'
    // for web). If workspaceRoot is still a real filesystem path on web
    // (legacy), fall back to 'workspace' to avoid leaking server paths.
    if (!rawPath || rawPath === '/') {
      // Safety: if workspaceRoot looks like an absolute filesystem path but
      // we're NOT in desktop mode, use a virtual fallback.
      // Matches the 'workspace/sessions' default from getDefaultWorkspaceRoot().
      if (!isDesktopMode() && (this.workspaceRoot.startsWith('/') || this.workspaceRoot.includes('\\'))) {
        return 'workspace/sessions';
      }
      return this.workspaceRoot;
    }

    let strippedPath = stripWorkspacePrefixes(rawPath);

    if (!strippedPath || strippedPath === '/') {
      return this.workspaceRoot;
    }

    const parts = strippedPath.split('/');
    const safeParts: string[] = [];
    const workspaceRootParts = this.workspaceRoot.split('/').filter(Boolean);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '.') {
        continue;
      }
      if (trimmed === '..') {
        // Reject .. if safeParts is empty (would escape root)
        if (safeParts.length === 0) {
          throw new Error(`Path traversal is not allowed: ${inputPath}`);
        }
        // Allow .. to navigate above workspace root (e.g. workspace/sessions/001 -> workspace)
        // but prevent escaping workspace root entirely
        if (safeParts.length <= 1) {
          throw new Error(`Path traversal is not allowed: ${inputPath}`);
        }
        safeParts.pop();
        continue;
      }
      if (trimmed.includes('\0')) {
        throw new Error(`Invalid path segment: ${inputPath}`);
      }
      safeParts.push(trimmed);
    }

    if (safeParts.length === 0) {
      return this.workspaceRoot;
    }    const normalizedPath = safeParts.join('/');

    // VFS scoped paths (workspace/...) bypass workspaceRoot validation
    // These are virtual session namespaces, not filesystem paths relative to workspaceRoot
    if (normalizedPath.startsWith('workspace/') || normalizedPath === 'workspace') {
      return normalizedPath;
    }

    // FIX: Also allow VFS session paths that start with "sessions/" after stripping.
    // When stripWorkspacePrefixes removes "workspace/" prefix, paths like
    // "workspace/sessions/002/portfolio-app" become "sessions/002/portfolio-app".
    // These are valid VFS session paths and should be allowed.
    if (normalizedPath.startsWith('sessions/') || normalizedPath === 'sessions') {
      return normalizedPath;
    }

    const workspacePrefix = workspaceRootParts.join('/');

    // FIX: When workspaceRoot is a session ID like "002" (not a full path),
    // relative paths like "portfolio-app" should be allowed. Only validate
    // against workspacePrefix if it looks like a real filesystem path (contains '/').
    // Session IDs alone (no '/') are namespace identifiers, not path validators.
    const isSessionRoot = !workspacePrefix.includes('/') && workspacePrefix.length > 0;
    
    // If workspacePrefix is a simple session ID (no slashes), allow any relative path
    // This allows paths like "portfolio-app" when workspaceRoot is "002"
    if (isSessionRoot) {
      logger.info('[VFS normalizePath] Session root mode - allowing relative path:', normalizedPath);
      return normalizedPath;
    }

    // FIX: Desktop/CLI mode — workspaceRoot is an absolute filesystem path (e.g. /opt/bing/web).
    // Relative paths (e.g. "frontend/Dockerfile") are valid children of the filesystem root.
    // They are NOT traversal because they don't escape the workspaceRoot.
    // Note: workspacePrefix has leading '/' stripped by .split().filter(Boolean).join('/'),
    // so we check this.workspaceRoot (which preserves the leading '/') instead.
    if (this.workspaceRoot.startsWith('/') &&
        !normalizedPath.startsWith('workspace/') &&
        !normalizedPath.startsWith('sessions/')) {
      return normalizedPath;
    }

    logger.info('[VFS normalizePath] inputPath/workspaceRoot/normalizedPath/workspacePrefix', { inputPath, workspaceRoot: this.workspaceRoot, normalizedPath, workspacePrefix });

    // Verify the normalized path is within or an ancestor of the workspace root
    // When workspacePrefix is empty (no workspace root set), any non-empty relative path is valid
    const isWithin = workspacePrefix === ''
      ? true
      : normalizedPath.startsWith(workspacePrefix + '/') || normalizedPath === workspacePrefix;
    const isAncestor = workspacePrefix.startsWith(normalizedPath + '/');
    if (!isWithin && !isAncestor) {
      // Pass-5 #62 (audit): surface enough context in the rejection log for
      // operators (and the meta-monitor) to understand why an LLM-emitted
      // path was rejected. The plain `Path traversal beyond workspace root:
      // <path>` error was uninformative; the structured log now includes the
      // raw input, the normalized form, the expected workspace root, and a
      // canonical session-scope hint so the LLM's next attempt can self-correct.
      //
      // Hot-path throttling: `normalizePath` is called on every read/write/list.
      // If the LLM loops on a bad path, the warn would fire N times and drown
      // the audit signal. Use a per-process throttled counter (60s window
      // per unique input path) so the FIRST occurrence is always logged with
      // full context, and subsequent occurrences within the window are
      // suppressed in favor of a periodic summary log. Persisted on
      // globalThis so Next.js hot-reload preserves the counters.
      const throttleKey = `__vfsNormalizePathReject__:${inputPath}`;
      const now = Date.now();
      const throttleState = (globalThis as any)[throttleKey] as
        | { firstSeenAt: number; lastLoggedAt: number; count: number }
        | undefined;
      // Bug #4 fix: When the path is a bare filename (no workspace/ prefix),
      // log at DEBUG level instead of WARN since the caller will prepend scopePath.
      // The warn was misleading - writes succeed because scopePath is prepended
      // client-side, making the "out of scope" log noise rather than a real error.
      const isBareRelativePath = !inputPath.includes('/') ||
        (/^[^/]+$/.test(inputPath)) ||
        (/^(src|lib|app|components|pages|public|tests?|docs?|scripts?|config)\//i.test(inputPath));

      if (isBareRelativePath && workspacePrefix?.startsWith('workspace/sessions/')) {
        // Log at debug - this is expected when LLM writes to relative paths
        // The scopePath will be prepended by the caller
        logger.debug('[VFS normalizePath] bare relative path detected - scopePath should be prepended by caller', {
          inputPath,
          expectedScope: workspacePrefix,
          hint: `Use canonical path like '${workspacePrefix}/${inputPath}' or let the tool layer prepend scopePath.`,
        });
        if (normalizedPath.length > MAX_PATH_LENGTH) {
          throw new Error(`Path exceeds max length (${MAX_PATH_LENGTH})`);
        }
        return normalizedPath; // Allow bare relative paths
      }

      if (!throttleState) {
        (globalThis as any)[throttleKey] = { firstSeenAt: now, lastLoggedAt: now, count: 1 };
        logger.warn(withDetectionTerms(
          '[VFS normalizePath] path rejected: out of scope',
          DETECTION_TERMS.mismatch,
        ), {
          inputPath,
          normalizedPath,
          workspacePrefix,
          expectedScopeHint: workspacePrefix
            ? `Paths must be under '${workspacePrefix}/...' — use a relative path like 'src/app.tsx' or the canonical session-scope '${workspacePrefix}/<sessionId>/...'.`
            : 'No workspace root set; pass a path that is within the active workspace.',
          isWithin,
          isAncestor,
          rejectionCount: 1,
        });
      } else {
        throttleState.count += 1;
        if (now - throttleState.lastLoggedAt > 60_000) {
          throttleState.lastLoggedAt = now;
          logger.warn(withDetectionTerms(
            '[VFS normalizePath] path rejected: out of scope (throttled summary)',
            DETECTION_TERMS.mismatch,
          ), {
            inputPath,
            normalizedPath,
            workspacePrefix,
            isWithin,
            isAncestor,
            rejectionCount: throttleState.count,
            windowMs: now - throttleState.firstSeenAt,
          });
        }
      }
      throw new Error(
        `Path traversal beyond workspace root: ${inputPath}. ` +
        `Expected scope: ${workspacePrefix || this.workspaceRoot}/... ` +
        `(use a relative path within the active session workspace, not an absolute or parent-relative one).`,
      );
    }
    
    const sessionsMatch = normalizedPath.match(/^workspace\/sessions\/([^/]+)/i);
    if (sessionsMatch) {
      const sessionSegment = sessionsMatch[1];
      if (sessionSegment.includes('//') || sessionSegment.includes('..')) {
         throw new Error(`Invalid session folder: "${sessionSegment}"`);
      }
    }

    if (normalizedPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path exceeds max length (${MAX_PATH_LENGTH})`);
    }

    return normalizedPath;
  }

  private sanitizeOwnerId(ownerId: string): string {
    const trimmed = (ownerId || '').trim();
    if (!trimmed) {
      // SECURITY: Throw instead of falling back to a shared workspace.
      // The shared 'anon:public' fallback was the root cause of cross-user
      // data leakage (user-a writes, user-b reads the same file). Callers
      // MUST provide a valid ownerId via resolveFilesystemOwner().
      throw new Error(
        'VFS ownerId is required. ' +
        'Use resolveFilesystemOwner() at the API route level to provide a valid ownerId.'
      );
    }
    if (trimmed.length > 256) return trimmed.slice(0, 256);
    return trimmed;
  }

  /**
   * Load workspace from SQLite database.
   *
   * Phase 5 (CAS): File content may be stored either:
   *   1. Inline in `content` column (legacy, or small files)
   *   2. In the content-addressable store via `blob_hash` column
   *
   * CAS content is fetched on first access and cached in the workspace Map.
   * Subsequent reads serve from memory without CAS lookup.
   */
  // Bug #14 (audit) follow-up — `ensureWorkspace` is now public so the
  // snapshot gateway can eagerly initialize a workspace BEFORE returning
  // WORKSPACE_NOT_READY. Without this, an anonymous user's first snapshot
  // read returns 202 WORKSPACE_NOT_READY, the client throws, the LLM never
  // writes, and the workspace stays uninitialized forever — every subsequent
  // snapshot repeats the same loop. With this, the gateway initializes the
  // workspace (creating an empty WorkspaceState in the map + DB) and the
  // NEXT read sees success with 0 files, breaking the loop.
  public async ensureWorkspace(ownerId: string): Promise<WorkspaceState> {
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
          'SELECT path, content, blob_hash, is_compressed, language, size, version, created_at, updated_at FROM vfs_workspace_files WHERE owner_id = ? ORDER BY path'
        ).all(normalizedOwnerId) as Array<{
          path: string;
          content: string;
          blob_hash: string | null;
          is_compressed: number;
          language: string;
          size: number;
          version: number;
          created_at: string;
          updated_at: string;
        }>;          if (rows.length > 0 || meta) {
          workspace.files = new Map(rows.map(row => {
            // FIX: Normalize backslashes to forward slashes when loading from DB.
            // Stale entries from Windows may contain backslashes that break path matching.
            const normalizedPath = row.path.replace(/\\/g, '/');

            // Phase 5 (CAS): Resolve content from blob_hash if content is not stored inline
            let content = row.content;
            if (!content && row.blob_hash) {
              content = ''; // Placeholder — will be hydrated via casPromises loop below
            } else if (content) {
              // Always check gzip magic bytes for inline content — handles both legacy
              // compressed rows (pre-migration) and new rows with is_compressed=1.
              const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
              if (isCompressed(contentBuffer)) {
                content = decompress(contentBuffer).toString('utf-8');
              }
            }

            return [normalizedPath, {
              path: normalizedPath,
              content: content || '',
              language: row.language,
              size: row.size,
              version: row.version,
              lastModified: row.updated_at,
              createdAt: row.created_at,
              isDirectoryMarker: normalizedPath.endsWith('/.directory'),
              ownerId: normalizedOwnerId, // SECURITY: Track ownership for DB-loaded files
            } as VirtualFile];
          }));

          // Phase 5 (CAS): Fetch all CAS blobs eagerly before returning
          // This ensures the workspace is fully hydrated on first access.
          // Uses a separate pending list instead of polluting VirtualFile with transient _blobHash.
          const casPromises: Promise<void>[] = [];
          for (const row of rows) {
            if (!row.content && row.blob_hash) {
              const normalizedPath = row.path.replace(/\\/g, '/');
              const file = workspace.files.get(normalizedPath);
              if (file) {
                casPromises.push(
                  getContentAddressableStorage().retrieve(row.blob_hash).then(buf => {
                    if (buf) {
                      file.content = buf.toString('utf-8');
                    }
                  }).catch(err => {
                    logger.warn('[VFS] Failed to fetch CAS blob on load', { hash: row.blob_hash, path: normalizedPath, error: err.message });
                  })
                );
              }
            }
          }
          if (casPromises.length > 0) {
            await Promise.all(casPromises);
          }

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
          logger.warn(`[VFS] Failed to load workspace for ${normalizedOwnerId}:`, msg);
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
      const backslashRow = (db.prepare(
        "SELECT COUNT(*) as cnt FROM vfs_workspace_files WHERE owner_id = ? AND path LIKE '%\\\\%'"
      ).get(normalizedOwnerId)) as { cnt: number } | null;
      const backslashCount = backslashRow?.cnt ?? 0;
      if (backslashCount > 0) {
        const normalizePaths = db.prepare(
          "UPDATE vfs_workspace_files SET path = REPLACE(path, '\\\\', '/') WHERE owner_id = ? AND path LIKE '%\\\\%'"
        );
        normalizePaths.run(normalizedOwnerId);
        logger.info(`[VFS] Normalized ${backslashCount} backslash path(s) for owner ${normalizedOwnerId}`);
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
         (id, owner_id, path, content, blob_hash, is_compressed, language, size, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

          // Phase 5 (CAS): Store large files in content-addressable store
          // Small files stay inline for fast access (synchronous).
          // CAS store is async for initial R2 write but synchronous for local cache + hash.
          // Compute content to store (inline or CAS hash reference)
          const { contentToStore, blobHash, isCompressedFlag } = (() => {
            if (file.content.length >= CAS_STORAGE_THRESHOLD) {
              // Use synchronous store to write to local cache + get hash
              const hash = getContentAddressableStorage().storeSync(file.content);
              // Don't store content inline when using CAS — saves SQL space
              return { contentToStore: '', blobHash: hash, isCompressedFlag: 0 };
            }
            // Compress small files inline (backward compatible path)
            const compressed = compress(file.content);
            if (compressed.length < file.content.length) {
              return { contentToStore: compressed, blobHash: null, isCompressedFlag: 1 };
            }
            return { contentToStore: file.content, blobHash: null, isCompressedFlag: 0 };
          })();

          upsertFile.run(
            id, normalizedOwnerId, filePath,
            contentToStore, blobHash, isCompressedFlag,
            file.language, file.size, file.version,
            file.createdAt || now, now
          );
        }
      });

      persistTx();

      // Re-enable auto-commit after persist completes
      await this.flushBatchMode(normalizedOwnerId);
    } catch (error: any) {
      logger.error('[VFS] DB persist failed:', {
        ownerId: normalizedOwnerId,
        error: error.message,
      });
      // Re-enable auto-commit even on error
      await this.flushBatchMode(normalizedOwnerId);
      throw error;
    }
  }

  /**
   * Apply a batch of write/delete mutations to the workspace IN MEMORY (no
   * per-mutation persistWorkspace call), then run ONE shared persistWorkspace
   * which internally wraps everything in a single better-sqlite3
   * `db.transaction(() => { ... })` call. Net effect: N sqlite commits
   * collapse into 1 commit, so the SQLite writes actually run in series
   * without each branch re-acquiring the event-loop mutex (`better-sqlite3`
   * is synchronous and holds the V8 loop while the transaction body runs).
   *
   * Audit context (NEW Meta-coalesce, 2026-06-20): Promise.all over 10
   * `writeFile`/`deletePath` calls previously serialized through better-sqlite3's
   * `db.transaction` synchronous body — each parallel branch blocked the
   * event loop while its own transaction committed. Coalescing into ONE
   * transaction saves N-1 fsyncs (~5-20ms each on plan flash storage).
   *
   * Design decisions (opts already applied to base virtual-filesystem-service):
   *   1. **Partial-success semantics** (NOT atomic). Each mutation is
   *      validated independently; failures are collected into the result's
   *      `processed` array without aborting the rest. This preserves the
   *      existing `Promise.allSettled` semantics used by callers like
   *      `vfs-batch-operations.ts:batchWriteIncremental`.
   *   2. **Events emit AFTER the single persist**. If events fired mid-batch,
   *      listeners (snapshot broadcasters, filesystem-updated event handlers)
   *      could read stale DB state. Aggregating events and firing post-persist
   *      is cheap and avoids the read-after-write race in `getSnapshotBroadcaster`.
   *   3. **Per-mutation validation** delegates to the existing
   *      `writeFile`/`deletePath` validation logic via the helper
   *      `_writeFileToMemory` and `_deletePathToMemory` (extracted below).
   *      No DRY violation: callers compute the workspace Map mutation +
   *      validation outcome in one shot, persist writes to disk once.
   *   4. **Concurrent-modification check** still fires per-write (200ms window
   *      in production). If a batch writes to the same path twice, the second
   *      write sees the first's just-emitted version and may trip the
   *      conflict-warn (or `strictConcurrency` throw). Callers should
   *      dedupe path-mutations before submitting to this API.
   *   5. **`expectedVersion` / `strictConcurrency` are NOT YET supported.**
   *      Bug #10 (#25)'s per-call optimistic-concurrency checks are intentionally
   *      omitted because (a) batch callers don't currently pass them, and (b)
   *      implementing them across N mutations adds non-trivial branching — the
   *      CAS sequence per file is part of `writeFile`'s atom semantics, not the
   *      batch path. If a future caller passes either, drop them silently and
   *      consider opening a follow-up to implement.
   *
   * @param ownerId  VFS owner.
   * @param mutations Array of mutations to apply (in order — last write wins per path).
   * @returns Aggregate stats: per-path success/failure plus totals + duration.
   */
  async applyBatchMutations(
    ownerId: string,
    mutations: Array<{
      type: 'write' | 'delete';
      path: string;
      content?: string;
      language?: string;
      options?: { failIfExists?: boolean; append?: boolean };
    }>,
  ): Promise<{
    success: boolean;
    successful: number;
    failed: number;
    processed: Array<{ path: string; success: boolean; error?: string }>;
    duration: number;
  }> {
    const startTime = Date.now();
    const processed: Array<{ path: string; success: boolean; error?: string }> = [];
    let successful = 0;
    let failed = 0;

    if (mutations.length === 0) {
      return { success: true, successful: 0, failed: 0, processed, duration: 0 };
    }

    const workspace = await this.ensureWorkspace(ownerId);

    // Aggregate events for post-persist emission (decision #2 above).
    const pendingEvents: Array<{ path: string; type: FilesystemChangeType; version: number }> = [];

    for (const mutation of mutations) {
      try {
        if (mutation.type === 'delete') {
          this._deletePathToMemory(ownerId, mutation.path, workspace, pendingEvents);
        } else {
          this._writeFileToMemory(
            ownerId,
            mutation.path,
            mutation.content ?? '',
            mutation.language,
            mutation.options ?? {},
            workspace,
            pendingEvents,
          );
        }
        processed.push({ path: mutation.path, success: true });
        successful += 1;
      } catch (error: any) {
        // Partial-success: record error, skip this mutation, continue with the rest.
        processed.push({ path: mutation.path, success: false, error: error?.message ?? String(error) });
        failed += 1;
      }
    }

    if (pendingEvents.length > 0) {
      await this.persistWorkspace(ownerId, workspace);
      // Emit ALL fileChange events AFTER successful persist (decision #2).
      const snapshotVersion = workspace.version;
      for (const evt of pendingEvents) {          this.emitFileChange(ownerId, evt.path, evt.type, evt.version);
      }
      // Single snapshotChange covers the whole batch (cheaper than N emits).
      this.emitSnapshotChange(ownerId, snapshotVersion);
    }

    return {
      success: failed === 0,
      successful,
      failed,
      processed,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Write a file to the workspace Map WITHOUT calling persistWorkspace.
   * Mirrors the in-memory portion of `writeFile` (path normalize, content
   * validation, size/quota checks, version bump) but skips the DB commit +
   * event emit so a batch caller can coalesce N writes into one persist.
   *
   * Returns the new VirtualFile object so the caller can track version
   * bumps. Throws on validation failures (the caller catches these for
   * partial-success semantics in `applyBatchMutations`).
   *
   * @param workspace The already-loaded workspace object — caller passes it
   *   in to avoid re-loading.
   * @param pendingEvents Array to append the file-change event metadata
   *   into; the caller emits them AFTER the coalesced persistWorkspace.
   */
  private _writeFileToMemory(
    ownerId: string,
    filePath: string,
    content: string,
    language: string | undefined,
    options: { failIfExists?: boolean; append?: boolean },
    workspace: WorkspaceState,
    pendingEvents: Array<{ path: string; type: FilesystemChangeType; version: number }>,
  ): VirtualFile {
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();

    let normalizedContent = typeof content === 'string' ? content : String(content ?? '');
    if (options?.append && previous) {
      normalizedContent = (previous.content || '') + normalizedContent;
    }
    if (previous && options?.failIfExists && !options?.append) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }
    if (previous && previous.content === normalizedContent) {
      // No-op: same content passes through without a version bump.
      return previous;
    }

    const fileSize = Buffer.byteLength(normalizedContent, 'utf8');
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds limit: ${this.formatFileSize(fileSize)} > ${this.formatFileSize(MAX_FILE_SIZE)}`,
      );
    }
    const currentTotalSize = Array.from(workspace.files.values())
      .reduce((sum, file) => sum + file.size, 0);
    const newTotalSize = currentTotalSize - (previous?.size || 0) + fileSize;
    if (newTotalSize > MAX_TOTAL_WORKSPACE_SIZE) {
      throw new Error(
        `Workspace quota exceeded: ${this.formatFileSize(newTotalSize)} > ${this.formatFileSize(MAX_TOTAL_WORKSPACE_SIZE)}.`,
      );
    }
    if (!previous && workspace.files.size >= MAX_FILES_PER_WORKSPACE) {
      throw new Error(
        `Maximum file count exceeded: ${workspace.files.size} >= ${MAX_FILES_PER_WORKSPACE}`,
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
      ownerId: this.sanitizeOwnerId(ownerId),
    };
    workspace.files.set(normalizedPath, file);
    workspace.version += 1;
    workspace.updatedAt = now;

    const changeType: FilesystemChangeType = previous ? 'update' : 'create';
    diffTracker.trackChange(file, ownerId, previous?.content);
    pendingEvents.push({ path: normalizedPath, type: changeType, version: workspace.version });
    return file;
  }

  /**
   * Delete a path from the workspace Map WITHOUT calling persistWorkspace.
   * Mirror of `deletePath`'s in-memory half (collect targets, remove from
   * Map, increment version) but skips the persist + events so a batch
   * caller can coalesce N deletes into one persist.
   *
   * Returns the count of files removed (may include nested prefix-deleted files).
   */
  private _deletePathToMemory(
    ownerId: string,
    targetPath: string,
    workspace: WorkspaceState,
    pendingEvents: Array<{ path: string; type: FilesystemChangeType; version: number }>,
  ): { deletedCount: number } {
    const normalizedPath = this.normalizePath(targetPath);
    const normalizedPrefix = `${normalizedPath}/`;

    const toDelete: string[] = [];
    for (const existingPath of Array.from(workspace.files.keys())) {
      if (existingPath === normalizedPath || existingPath.startsWith(normalizedPrefix)) {
        toDelete.push(existingPath);
      }
    }

    let deletedCount = 0;
    if (toDelete.length > 0) {
      workspace.version += 1;
      workspace.updatedAt = new Date().toISOString();
      for (const existingPath of toDelete) {
        const deletedFile = workspace.files.get(existingPath);
        workspace.files.delete(existingPath);
        deletedCount += 1;
        if (deletedFile) {
          diffTracker.trackDeletion(existingPath, ownerId, deletedFile.content);
        }
        pendingEvents.push({ path: existingPath, type: 'delete', version: workspace.version });
      }
    }
    return { deletedCount };
  }

  /**
   * Get diff summary for LLM context
   * Returns a human-readable summary of all file changes
   */
  getDiffSummary(ownerId: string, maxDiffs: number = 100): string {
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
   * Find all distinct anonymous ownerIds currently in the VFS.
   *
   * Used by the auth transfer flow as a safety net: if the cookie-derived
   * ownerId doesn't match anything in the DB (e.g. the anon cookie was
   * rotated between write and transfer, or was set in a format that
   * doesn't round-trip through the sanitizer), the transfer can still
   * find and move the user's anonymous workspace.
   *
   * SECURITY: This returns ownerIds from ALL anonymous users in the DB.
   * Callers MUST scope the result to a single user before transferring
   * (the cookie-derived ownerId is the only authoritative per-browser
   * handle). Used only as a last-resort fallback in the auth flow, and
   * bounded by `maxAgeHours` so stale data from previous visitors is
   * ignored.
   *
   * Errors are PROPAGATED to the caller (not swallowed) so the auth
   * flow can distinguish "no anon files" from "scan failed" and react
   * accordingly. The caller in `transfer-anon-vfs.ts` wraps the call
   * in its own error handling.
   *
   * @param maxAgeHours - Optional cutoff. When set, only returns
   *   ownerIds whose files have been updated within this window.
   *   Defaults to 7 days. Clamped to a minimum of 1 hour to prevent a
   *   typo (e.g. `0`) from accidentally disabling the bound. Pass a
   *   negative value to throw.
   */
  async findAnonOwnerIds(maxAgeHours: number = 24 * 7): Promise<string[]> {
    if (maxAgeHours < 0) {
      throw new Error(
        `findAnonOwnerIds: maxAgeHours must be >= 0 (got ${maxAgeHours})`
      );
    }
    try {
    const db = getDatabase();
    let rows: Array<{ owner_id: string }>;
    if (maxAgeHours > 0) {
      const cutoffIso = new Date(
        Date.now() - maxAgeHours * 60 * 60 * 1000
      ).toISOString();
      rows = db
        .prepare(
          `SELECT DISTINCT owner_id
           FROM vfs_workspace_files
           WHERE owner_id LIKE 'anon:%'
             AND updated_at >= ?
           ORDER BY owner_id`
        )
        .all(cutoffIso) as Array<{ owner_id: string }>;
    } else {
      // Caller explicitly passed 0 \u2014 allow it but log a warn so the
      // un-scoped scan is visible in the logs.
      logger.warn(
        '[VFS] findAnonOwnerIds called with maxAgeHours=0; scanning ALL anon ownerIds with no time bound'
      );
      rows = db
        .prepare(
          `SELECT DISTINCT owner_id
           FROM vfs_workspace_files
           WHERE owner_id LIKE 'anon:%'
           ORDER BY owner_id`
        )
        .all() as Array<{ owner_id: string }>;
    }
    return rows.map((r) => r.owner_id);
    } catch (err) {
      // Bug #85 (Pass-6 audit) — return [] instead of letting the error
      // propagate. The old code returned undefined on DB failure, which
      // crashed transfer-anon-vfs.ts with "Cannot read properties of
      // null (reading 'cnt')". Returning [] makes the fallback a clean
      // no-op.
      logger.warn(
        '[VFS] findAnonOwnerIds: DB unavailable, returning empty array',
        { error: err instanceof Error ? err.message : String(err) }
      );
      return [];
    }
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

    // Bug #112/#85: Guard against null result from db.prepare().get().
    // When the DB is transiently unavailable or the row doesn't exist,
    // .get() returns null instead of {cnt: 0}, and accessing .cnt
    // throws "Cannot read properties of null (reading 'cnt')".
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM vfs_workspace_files WHERE owner_id = ?').get(normalizedFrom) as { cnt: number } | null;
    const fileCount = countRow?.cnt ?? 0;
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
         (id, owner_id, path, content, blob_hash, is_compressed, language, size, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // 3. Transfer meta if target has none
      const targetHasMeta = db.prepare(
        'SELECT owner_id FROM vfs_workspace_meta WHERE owner_id = ?'
      ).get(normalizedTo);

      let transferredCount = 0;

      // Get all source files
      const sourceFiles = db.prepare(
        'SELECT path, content, blob_hash, is_compressed, language, size, version, created_at, updated_at FROM vfs_workspace_files WHERE owner_id = ?'
      ).all(normalizedFrom) as Array<{
        path: string; content: string; blob_hash: string | null; is_compressed: number; language: string; size: number; version: number; created_at: string; updated_at: string;
      }>;

      for (const file of sourceFiles) {
        if (!existingPaths.has(file.path)) {
          const id = `${normalizedTo}:${file.path}`;
          // Compute content to store (inline or CAS hash reference)
          const { contentToStore, blobHash, isCompressedFlag } = (() => {
            if (file.content && !file.blob_hash && file.content.length >= CAS_STORAGE_THRESHOLD) {
              const hash = getContentAddressableStorage().storeSync(file.content);
              return { contentToStore: '', blobHash: hash, isCompressedFlag: 0 };
            }
            if (file.content && !file.blob_hash) {
              const compressed = compress(file.content);
              if (compressed.length < file.content.length) {
                return { contentToStore: compressed, blobHash: null, isCompressedFlag: 1 };
              }
            }
            return { contentToStore: file.content, blobHash: file.blob_hash, isCompressedFlag: file.is_compressed };
          })();

          transferFile.run(id, normalizedTo, file.path, contentToStore, blobHash, isCompressedFlag, file.language, file.size, file.version, file.created_at, now);
          transferredCount++;
        }
      }

      // 4. Transfer meta: workspace_version ALWAYS transfers so the new
      // owner picks up the source's version history.
      //
      // Concurrency: this runs inside a better-sqlite3 `db.transaction()`
      // which serializes reads/writes within ONE process. However, the
      // VFS can run in multi-worker Next.js (and across replicas), so
      // a SELECT-then-UPDATE on `vfs_workspace_meta` has a race window
      // where another worker can write between our read and our write.
      // We close that window with a single atomic statement per case:
      //   - Target row exists: `UPDATE ... SET version = MAX(...)` does
      //     the merge in SQL. The CASE expression on updated_at picks
      //     the more recent of the two timestamps without a read.
      //   - Target row missing: `INSERT ... ON CONFLICT DO NOTHING`
      //     makes the insert itself race-safe — if another worker
      //     inserts the same owner_id between our EXISTS check and our
      //     INSERT, we don't fail and we don't clobber.
      //
      // The fresh-target INSERT preserves `sourceMeta.updated_at`
      // (not the transfer `now`) so downstream "is this workspace
      // stale?" checks that compare `updated_at` to a wall-clock
      // threshold still see the real last-modified time of the source.
      // The `root` field stays on the target — the target's working
      // directory configuration is what the user has actually set up.
      const sourceMeta = db.prepare(
        'SELECT version, root, updated_at FROM vfs_workspace_meta WHERE owner_id = ?'
      ).get(normalizedFrom) as { version: number; root: string; updated_at: string } | undefined;
      if (sourceMeta) {
        // COALESCE guards against the (theoretical) case where
        // sourceMeta.updated_at is NULL — the schema default is
        // CURRENT_TIMESTAMP so this should never happen, but a missing
        // value would silently get swallowed by the CASE WHEN.
        const sourceUpdatedAt = sourceMeta.updated_at ?? now;
        if (targetHasMeta) {
          // Atomic merge: version = MAX(ours, theirs),
          // updated_at = whichever ISO-8601 string sorts later.
          // ISO-8601 sorts lexically by recency, so a single CASE
          // expression replaces the read-compare-write round-trip.
          db.prepare(
            `UPDATE vfs_workspace_meta
             SET version = MAX(version, ?),
                 updated_at = CASE
                   WHEN julianday(?) > julianday(updated_at) THEN ?
                   ELSE updated_at
                 END
             WHERE owner_id = ?`
          ).run(
            sourceMeta.version,
            sourceUpdatedAt,
            sourceUpdatedAt,
            normalizedTo,
          );
        } else {
          // Fully atomic insert-or-merge: `ON CONFLICT DO UPDATE SET`
          // collapses the (EXISTS-check, INSERT, followup UPDATE)
          // sequence into a single statement that the SQLite engine
          // serializes. If another worker has just inserted the same
          // `owner_id` between our `targetHasMeta` check and now, we
          // merge our higher version into that row instead of silently
          // dropping the version transfer. `excluded.<col>` refers to
          // the values we tried to insert.
          db.prepare(
            `INSERT INTO vfs_workspace_meta (owner_id, version, root, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(owner_id) DO UPDATE SET
               version = MAX(version, excluded.version),
               updated_at = CASE
                 WHEN julianday(excluded.updated_at) > julianday(updated_at)
                   THEN excluded.updated_at
                   ELSE updated_at
                 END`
          ).run(
            normalizedTo,
            sourceMeta.version,
            sourceMeta.root,
            sourceUpdatedAt,
          );
        }
      }

      // 5. Transfer shadow_commits (the persisted git-style commit
      // history used for rollback/audit) to the new owner. The `id` is
      // preserved (commit ids are globally unique ULIDs/UUIDs in this
      // codebase) and only `owner_id` is rewritten. INSERT OR IGNORE
      // protects against an unlikely PK collision with an existing
      // target commit. `session_id` is preserved as-is because it
      // encodes the historical session that produced the commit — the
      // anon user's session is still a valid provenance marker even
      // after the workspace moves to the authenticated user.
      const sourceCommits = db.prepare(
        `SELECT id, session_id, message, author, timestamp, source, integration,
                workspace_version, diff, transactions, created_at
         FROM shadow_commits WHERE owner_id = ?`
      ).all(normalizedFrom) as Array<{
        id: string;
        session_id: string;
        message: string;
        author: string | null;
        timestamp: string;
        source: string | null;
        integration: string | null;
        workspace_version: number | null;
        diff: string;
        transactions: string;
        created_at: string;
      }>;
      if (sourceCommits.length > 0) {
        const transferCommit = db.prepare(
          `INSERT OR IGNORE INTO shadow_commits
           (id, session_id, owner_id, message, author, timestamp, source, integration,
            workspace_version, diff, transactions, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const commit of sourceCommits) {
          transferCommit.run(
            commit.id,
            commit.session_id,
            normalizedTo,
            commit.message,
            commit.author,
            commit.timestamp,
            commit.source,
            commit.integration,
            commit.workspace_version,
            commit.diff,
            commit.transactions,
            commit.created_at,
          );
        }
      }

      // 6. Delete source data
      db.prepare('DELETE FROM vfs_workspace_files WHERE owner_id = ?').run(normalizedFrom);
      db.prepare('DELETE FROM vfs_workspace_meta WHERE owner_id = ?').run(normalizedFrom);
      db.prepare('DELETE FROM shadow_commits WHERE owner_id = ?').run(normalizedFrom);

      // 7. Clean up in-memory state
      this.workspaces.delete(normalizedFrom);
      diffTracker.clear(normalizedFrom);

      // 8. Invalidate target's in-memory cache so it reloads from DB
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
    options?: { failIfExists?: boolean; append?: boolean; bypassSync?: boolean; expectedVersion?: number; strictConcurrency?: boolean },
    sessionId?: string // optional: for GitBackedVFS session scoping
  ): Promise<VirtualFile> {
    // #10/#18/#25 fix: the `strictConcurrency` option is propagated
    // through `options` to gitVFS.writeFile → this.vfs.writeFile (the
    // primary writeFile method at line ~301), which already checks
    // `options?.strictConcurrency` and throws ConcurrentModificationError
    // when the time-since-last-write threshold is exceeded. No additional
    // pre-check is needed here — the downstream check uses the correct
    // time-based semantic (we don't want to block legitimate sequential
    // edits where the file already exists).
    const gitVFS = this.vfs.getGitBackedVFS(ownerId, sessionId ? { sessionId } : undefined);
    if (typeof gitVFS?.writeFile !== 'function') {
      // SEV-7 — fall through to base VFS writeFile when gitVFS is unhealthy.
      // The file is still persisted to SQLite (base VFS); we lose git commit
      // tracking but the user's write succeeds.
      this.noteProxyGuardFired('writeFile');
      return this.vfs.writeFile(ownerId, filePath, content, language, options, sessionId);
    }
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
    
    // Record deletions (best-effort; tracked via single canTrackTransaction hoist — SEV-7)
    const canTrackTransaction = typeof gitVFS?.trackTransaction === 'function';
    if (!canTrackTransaction) this.noteProxyGuardFired('deletePath:trackTransaction');
    for (const node of listing.nodes) {
      if (node.type === 'file') {
        try {
          const file = await this.vfs.readFile(ownerId, node.path);
          if (canTrackTransaction) gitVFS.trackTransaction(ownerId, {
            path: node.path,
            type: 'DELETE',
            timestamp: Date.now(),
            originalContent: file.content,
          });
        } catch (err: any) {
          // File may not exist or read may fail — log warning so we know if originalContent is missing from the git commit
          logger.warn('[VFS] Could not read file content before DELETE for git tracking', { path: node.path, error: err?.message || String(err) });
        }
      }
    }
    
    const result = await this.vfs.deletePath(ownerId, targetPath);

    // Commit the deletion (guarded — SEV-7).
    if (result !== null && result !== undefined && typeof result === 'object' && result.deletedCount > 0) {
      if (typeof gitVFS?.commitChanges === 'function') {
        try { await gitVFS.commitChanges(ownerId, `Delete ${targetPath}`); } catch { /* heal-on-miss noise */ }
      } else {
        this.noteProxyGuardFired('deletePath:commitChanges');
      }
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

  /**
   * Synchronous, in-memory workspace version getter.
   *
   * @see VirtualFilesystemService.getCurrentVersionSync — the canonical
   * implementation. This is a thin proxy that delegates to it.
   *
   * Bug #16 (audit) — read-after-write staleness. This proxy preserves
   * the synchronous read path so the snapshot gateway can use the
   * authoritative in-memory version instead of the (racy) listener-tracked
   * `latestSeenVersion`.
   */
  getCurrentVersionSync(ownerId: string): number {
    return this.vfs.getCurrentVersionSync(ownerId);
  }

  async exportWorkspace(ownerId: string): Promise<import('./filesystem-types').VirtualWorkspaceSnapshot> {
    return this.vfs.exportWorkspace(ownerId);
  }

  async createDirectory(
    ownerId: string,
    dirPath: string
  ): Promise<{ path: string; createdAt: string }> {
    const result = await this.vfs.createDirectory(ownerId, dirPath);

    // Track directory creation in git — best-effort (SEV-7).
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    if (typeof gitVFS?.trackTransaction === 'function' && typeof gitVFS?.commitChanges === 'function') {
      gitVFS.trackTransaction(ownerId, {
        path: dirPath,
        type: 'CREATE',
        timestamp: Date.now(),
        newContent: '',
      });
      try { await gitVFS.commitChanges(ownerId, `Create directory ${dirPath}`); } catch { /* heal-on-miss noise */ }
    } else {
      this.noteProxyGuardFired('createDirectory');
    }

    return result;
  }

  // Batch mode methods for bulk operations (used by refinement and bulk file writes)

  /**
   * Enable batch mode - disables auto-commit until flushBatchMode is called
   *
   * SEV-7 (audit) — defensive guard. `getGitBackedVFS` returns the cached
   * GitBackedVFS instance, which under Next.js HMR / module-resolution races
   * can transiently resolve to `undefined` or an instance whose prototype
   * chain was severed (the `isHealthyGitVFS` check in
   * `getGitBackedVFSForOwner` heals on miss but the heal is process-local,
   * so during a hot-reload window the returned value can still be invalid).
   * Without this guard the call throws
   * `Cannot read properties of undefined (reading 'enableBatchMode')` —
   * the exact phrase in the 8 occurrence Chat:Logger warn entries.
   * Pattern mirrors the guard in lib/vfs/transactional-vfs.ts.
   */
  /**
   * SEV-7 (audit) — one-time HMR correlation warn. Persisted on globalThis
   * so the message fires at most ONCE per process. The tripped-methods Set
   * tallies every distinct proxy method that hit this guard during the
   * current process so the first warn line carries the full affected
   * surface, not just the method that happened to fire first. Subsequent
   * calls within the same process are silent (dedup).
   */
  private noteProxyGuardFired(methodName: string): void {
    const tallyState = globalThis as unknown as {
      __vfsProxyGuardFiredMethods__?: Set<string>;
      __vfsProxyGuardFiredWarned__?: boolean;
    };
    if (!tallyState.__vfsProxyGuardFiredMethods__) {
      tallyState.__vfsProxyGuardFiredMethods__ = new Set<string>();
    }
    tallyState.__vfsProxyGuardFiredMethods__.add(methodName);
    if (tallyState.__vfsProxyGuardFiredWarned__ === true) return;
    tallyState.__vfsProxyGuardFiredWarned__ = true;
    const distinct = (tallyState.__vfsProxyGuardFiredMethods__).size;
    const list = Array.from(tallyState.__vfsProxyGuardFiredMethods__).sort().join(', ');
    logger.warn(
      `[VFS Proxy] ${methodName} guard fired — gitVFS unavailable (HMR re-init in flight). Distinct methods tripped in this process: ${list} (${distinct} total). Subsequent calls will silently no-op until next module reload.`,
    );
  }

  enableBatchMode(ownerId: string): void {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    if (typeof gitVFS?.enableBatchMode !== 'function') {
      this.noteProxyGuardFired('enableBatchMode');
      return;
    }
    gitVFS.enableBatchMode(ownerId);
  }

  /**
   * Flush batch mode - commit all pending changes and re-enable auto-commit
   *
   * SEV-7 — same defensive guard as enableBatchMode. Returns a defensive
   * failure-shape when the inner gitVFS is unhealthy so callers can react
   * without throwing out of an async context.
   */
  async flushBatchMode(ownerId: string): Promise<{ success: boolean; committedFiles: number; error?: string }> {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    if (typeof gitVFS?.flushBatch !== 'function') {
      this.noteProxyGuardFired('flushBatchMode');
      return { success: false, committedFiles: 0, error: 'gitVFS unavailable (HMR re-init in flight)' };
    }
    return await gitVFS.flushBatch();
  }

  /**
   * Disable batch mode without committing (for error recovery)
   *
   * SEV-7 — same defensive guard.
   */
  disableBatchMode(ownerId: string): void {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    if (typeof gitVFS?.disableBatchMode !== 'function') {
      this.noteProxyGuardFired('disableBatchMode');
      return;
    }
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

  /**
   * Find all distinct anonymous ownerIds currently in the VFS,
   * bounded by `maxAgeHours` to limit blast radius. Delegates to the
   * underlying VFS service. See VirtualFilesystemService.findAnonOwnerIds.
   */
  async findAnonOwnerIds(maxAgeHours: number = 24 * 7): Promise<string[]> {
    return this.vfs.findAnonOwnerIds(maxAgeHours);
  }

  // NEW Meta-coalesce follow-up: passthrough to the base service's
  // applyBatchMutations so the typed `virtualFilesystem` export (this
  // proxy, not the base class) can exercise the batch-coalesced persist
  // path. Git-tracking is intentionally omitted for the initial pass —
  // layer it into the gitVFS.writeFile delegation if a future caller
  // needs git-tracked batch writes.
  async applyBatchMutations(
    ownerId: string,
    mutations: Array<{
      type: 'write' | 'delete';
      path: string;
      content?: string;
      language?: string;
      options?: { failIfExists?: boolean; append?: boolean };
    }>,
  ): Promise<{
    success: boolean;
    successful: number;
    failed: number;
    processed: Array<{ path: string; success: boolean; error?: string }>;
    duration: number;
  }> {
    return this.vfs.applyBatchMutations(ownerId, mutations);
  }
}

// Export singleton instance with Git-backed proxy
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading in dev mode
// Without this, each module reload creates a new instance with empty workspaces
declare global {
    
   var __vfsSingleton__: GitBackedVFSProxy | undefined;
}

let _vfsInstanceCache: GitBackedVFSProxy | undefined;

export const getVirtualFilesystem = (): GitBackedVFSProxy => {
  if (_vfsInstanceCache) return _vfsInstanceCache;
  _vfsInstanceCache = globalThis.__vfsSingleton__ ?? (globalThis.__vfsSingleton__ = new GitBackedVFSProxy(new VirtualFilesystemService()));
  return _vfsInstanceCache;
};

export const virtualFilesystem: GitBackedVFSProxy = new Proxy({} as any, {
  get: (target, prop) => {
    const vfs = getVirtualFilesystem();
    return (vfs as any)[prop];
  }
});

// Bug #36 (audit) — startup fingerprint. The snapshot gateway calls
// `virtualFilesystem.getCurrentVersionSync(ownerId)` as the primary
// staleness check for read-after-write correctness (Bug #16 fix). If
// the deployed build predates the patch, the method is missing and
// every snapshot request fails with `... is not a function` (95
// occurrences in run.log with the `__TURBOPACK__imported__module__`
// prefix confirming a stale Turbopack module cache). Print a
// one-line fingerprint at module load so the regression is visible
// immediately in the next run.log without code-reading.
{
  const hasGetCurrentVersionSync = typeof (virtualFilesystem as any).getCurrentVersionSync === 'function';
  const hasForOwner = typeof (virtualFilesystem as any).forOwner === 'function';
  const hasUnderlying = typeof (virtualFilesystem as any).underlying === 'function';
  const proxyClassName = (virtualFilesystem as any)?.constructor?.name ?? 'unknown';
  logger.info('[VFS Startup Fingerprint]', {
    buildArtifact: 'virtualFilesystemService',
    proxyClass: proxyClassName,
    hasGetCurrentVersionSync,
    hasForOwner,
    hasUnderlying,
    pid: typeof process !== 'undefined' ? process.pid : 'n/a',
    nodeEnv: process.env.NODE_ENV ?? 'undefined',
  });
  if (!hasGetCurrentVersionSync) {
    logger.warn('[VFS Startup Fingerprint] virtualFilesystem.getCurrentVersionSync is MISSING — snapshot gateway will fall back to listener-tracked latestSeenVersion. Restart the dev server to flush the stale Turbopack module cache.');
  }
}
