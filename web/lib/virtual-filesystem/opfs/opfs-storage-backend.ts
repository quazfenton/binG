/**
 * OPFS Storage Backend
 * 
 * Implements VFS persistence interface using OPFS
 * Allows VirtualFilesystemService to use OPFS as storage backend
 * Falls back to IndexedDB when OPFS is unavailable or fails.
 * Uses a sticky mechanism to remember the last successful backend
 * per workspace and avoid data loss from backend flapping.
 */

import { opfsCore, type OPFSCore } from './opfs-core';
import { indexedDBBackend, IndexedDBBackend } from '../indexeddb-backend';
import type { VirtualFile } from '../filesystem-types';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('VFS:OPFSStorage');

type BackendType = 'opfs' | 'indexeddb';

const STICKY_KEY_PREFIX = 'vfs-active-backend:';

function getStickyBackend(ownerId: string): BackendType | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(STICKY_KEY_PREFIX + ownerId) as BackendType | null;
  } catch {
    return null;
  }
}

function setStickyBackend(ownerId: string, backend: BackendType): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STICKY_KEY_PREFIX + ownerId, backend);
  } catch {
    // Ignore storage errors
  }
}

export interface WorkspaceState {
  files: Map<string, VirtualFile>;
  version: number;
  updatedAt: string;
  loaded: boolean;
}

export interface VFSStorageBackend {
  loadWorkspace(ownerId: string): Promise<WorkspaceState>;
  saveWorkspace(ownerId: string, state: WorkspaceState): Promise<void>;
  deleteWorkspace(ownerId: string): Promise<void>;
  workspaceExists(ownerId: string): Promise<boolean>;
  listWorkspaces(): Promise<string[]>;
}

/**
 * OPFS Storage Backend Implementation
 * 
 * Uses OPFS as the primary storage mechanism for VFS data.
 * Provides fast local persistence with optional server sync.
 */
export class OPFSStorageBackend implements VFSStorageBackend {
  private core: OPFSCore;
  private idbBackend: IndexedDBBackend;
  private initializedWorkspaces = new Set<string>();
  private failedWorkspaces = new Set<string>();
  private metadataFile = '.vfs-metadata.json';

  constructor(core?: OPFSCore, idbBackend?: IndexedDBBackend) {
    this.core = core || opfsCore;
    this.idbBackend = idbBackend || indexedDBBackend;
  }

  /**
   * Determine which backend to use. Sticks to the last successful one.
   * Order of preference:
   * 1. Last successful backend for this owner (sticky)
   * 2. IDB if it has stored files and OPFS is not preferred
   * 3. OPFS if available
   * 4. IDB as a guaranteed fallback
   */
  private selectBackend(ownerId: string): BackendType {
    // 1. Check sticky memory
    const sticky = getStickyBackend(ownerId);
    if (sticky === 'indexeddb' && this.failedWorkspaces.has(ownerId)) {
      return 'indexeddb';
    }
    if (sticky === 'opfs' && !this.failedWorkspaces.has(ownerId) && OPFSStorageBackend.isSupported()) {
      return 'opfs';
    }

    // 2. If OPFS is not supported at all, use IDB
    if (!OPFSStorageBackend.isSupported()) {
      return 'indexeddb';
    }

    // 3. If OPFS previously failed for this owner, use IDB
    if (this.failedWorkspaces.has(ownerId)) {
      return 'indexeddb';
    }

    // 4. Default to OPFS
    return 'opfs';
  }

  private shouldUseFallback(ownerId: string): boolean {
    return this.selectBackend(ownerId) === 'indexeddb';
  }

  private markFailed(ownerId: string): void {
    this.failedWorkspaces.add(ownerId);
    this.initializedWorkspaces.delete(ownerId);
    logger.warn(`[VFS Storage] OPFS failed for workspace ${ownerId}, falling back to IndexedDB.`);
  }

  /**
   * Load workspace state from OPFS or IndexedDB fallback.
   * Sticks to the chosen backend to prevent data loss from flapping.
   * On first load (no sticky key), probes BOTH backends and merges.
   */
  async loadWorkspace(ownerId: string): Promise<WorkspaceState> {
    const backend = this.selectBackend(ownerId);

    if (backend === 'indexeddb') {
      setStickyBackend(ownerId, 'indexeddb');
      const idbState = await this.loadWorkspaceFromIDB(ownerId);
      // Probe OPFS too in case the user has orphaned files there
      return this.maybeMergeFromOtherBackend(ownerId, idbState, 'opfs');
    }

    try {
      // Initialize OPFS for this workspace
      await this.core.initialize(ownerId);
      this.initializedWorkspaces.add(ownerId);
      setStickyBackend(ownerId, 'opfs');

      const files = new Map<string, VirtualFile>();
      let version = 0;
      let updatedAt = new Date().toISOString();

      // Try to load metadata
      try {
        const metadataContent = await this.core.readFile(this.metadataFile);
        const metadata = JSON.parse(metadataContent.content);
        version = metadata.version || 0;
        updatedAt = metadata.updatedAt || updatedAt;
      } catch {
        // No metadata file, start fresh
      }

      // Walk directory tree and load all files
      await this.loadFilesRecursive('', files);

      logger.info('[OPFS Storage] Loaded workspace:', ownerId, 'files:', files.size, 'version:', version);

      const opfsState: WorkspaceState = {
        files,
        version,
        updatedAt,
        loaded: true,
      };
      // Probe IDB in case the user has orphaned files there
      return this.maybeMergeFromOtherBackend(ownerId, opfsState, 'indexeddb');
    } catch (error) {
      logger.error('[OPFS Storage] Failed to load workspace:', error);
      this.markFailed(ownerId);
      setStickyBackend(ownerId, 'indexeddb');
      const idbState = await this.loadWorkspaceFromIDB(ownerId);
      return this.maybeMergeFromOtherBackend(ownerId, idbState, 'opfs');
    }
  }

  /**
   * Probes the other backend and merges any unique files into the active state.
   * This handles the "new device" case where localStorage was wiped but
   * the browser still has the same IndexedDB or OPFS data.
   *
   * Merge rules (file-level):
   *  - If a path exists in `primary`, keep the entry with the newer
   *    `lastModified` timestamp (ties broken in favor of `primary`).
   *  - If a path exists only in `other`, copy it to `primary`.
   *
   * Trigger rules (workspace-level):
   *  - Probe the other backend ONLY when the primary is empty. Sticky
   *    is NOT a gate here: a sticky key on a brand-new install does
   *    not mean "the other backend is empty" — it just means "we
   *    have a default for next time". Skipping the probe when
   *    sticky is set was a bug that caused data loss on first
   *    load of an OPFS-primary user who also has IDB orphans.
   *  - When the primary is non-empty we trust it: the user has
   *    made progress here, the orphans (if any) are stale.
   *
   * After a successful merge, the merged state is persisted to the
   * active backend so the orphan copy can be safely ignored on the
   * next load.
   */
  private async maybeMergeFromOtherBackend(
    ownerId: string,
    primary: WorkspaceState,
    other: BackendType
  ): Promise<WorkspaceState> {
    try {
      if (primary.files.size > 0) {
        return primary; // Trust the active workspace; orphans are stale.
      }

      let otherState: WorkspaceState;
      if (other === 'opfs') {
        if (!OPFSStorageBackend.isSupported()) return primary;
        try {
          otherState = await this.loadWorkspaceFromOPFSInternal(ownerId);
        } catch {
          return primary;
        }
      } else {
        otherState = await this.loadWorkspaceFromIDB(ownerId);
      }

      if (otherState.files.size === 0) {
        return primary;
      }

      // Merge: for each file in 'other', add it to 'primary' if not
      // already present, or replace with the newer version.
      let mergedCount = 0;
      for (const [path, file] of otherState.files.entries()) {
        const existing = primary.files.get(path);
        if (!existing) {
          primary.files.set(path, file);
          mergedCount++;
          continue;
        }
        // Compare timestamps defensively (parse to numbers; bad
        // values fall back to 0 and we keep `existing`).
        const otherTime = Date.parse(file.lastModified) || 0;
        const existingTime = Date.parse(existing.lastModified) || 0;
        if (otherTime > existingTime) {
          primary.files.set(path, file);
          mergedCount++;
        }
      }

      if (mergedCount > 0) {
        logger.info(`[VFS Storage] Merged ${mergedCount} orphaned files from ${other} into active workspace.`);
        // Persist the merged state to the primary backend
        if (primary.files.size > 0) {
          await this.saveWorkspace(ownerId, primary);
        }
      }
      return primary;
    } catch (e) {
      logger.warn('[VFS Storage] Merge from other backend failed:', e);
      return primary;
    }
  }

  /**
   * Internal: Load from OPFS without sticky logic (for probing).
   */
  private async loadWorkspaceFromOPFSInternal(ownerId: string): Promise<WorkspaceState> {
    await this.core.initialize(ownerId);
    const files = new Map<string, VirtualFile>();
    let version = 0;
    let updatedAt = new Date().toISOString();
    try {
      const metadataContent = await this.core.readFile(this.metadataFile);
      const metadata = JSON.parse(metadataContent.content);
      version = metadata.version || 0;
      updatedAt = metadata.updatedAt || updatedAt;
    } catch {
      // No metadata
    }
    await this.loadFilesRecursive('', files);
    return { files, version, updatedAt, loaded: true };
  }

  /**
   * Loads the workspace using the IndexedDB backend.
   */
  private async loadWorkspaceFromIDB(ownerId: string): Promise<WorkspaceState> {
    try {
      if (!this.idbBackend.isInitialized()) {
        await this.idbBackend.initialize(ownerId);
      }
      const idbFiles = await this.idbBackend.listDirectory(ownerId, '');
      const files = new Map<string, VirtualFile>();
      let version = 0;

      for (const file of idbFiles) {
        if (file.path === this.metadataFile) continue;
        // Load content individually to get full data
        try {
          const fullFile = await this.idbBackend.readFile(ownerId, file.path);
          files.set(file.path, fullFile);
          version = Math.max(version, fullFile.version);
        } catch (e) {
          // Skip files that fail to read
        }
      }

      logger.info('[VFS Storage] Loaded workspace from IDB:', ownerId, 'files:', files.size);
      return {
        files,
        version,
        updatedAt: new Date().toISOString(),
        loaded: true,
      };
    } catch (error) {
      logger.error('[VFS Storage] IDB fallback load failed:', error);
      return {
        files: new Map(),
        version: 0,
        updatedAt: new Date().toISOString(),
        loaded: false,
      };
    }
  }

  /**
   * Save workspace state to OPFS or IndexedDB fallback.
   * Sticks to the chosen backend to prevent data loss from flapping.
   */
  async saveWorkspace(ownerId: string, state: WorkspaceState): Promise<void> {
    const backend = this.selectBackend(ownerId);

    if (backend === 'indexeddb') {
      setStickyBackend(ownerId, 'indexeddb');
      return this.saveWorkspaceToIDB(ownerId, state);
    }

    try {
      // Initialize OPFS for this workspace if not already done
      if (!this.initializedWorkspaces.has(ownerId)) {
        await this.core.initialize(ownerId);
        this.initializedWorkspaces.add(ownerId);
      }

      // Save metadata
      const metadata = {
        version: state.version,
        updatedAt: state.updatedAt,
        fileCount: state.files.size,
      };
      await this.core.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));

      // Save all files
      for (const [path, file] of state.files.entries()) {
        if (!file.isDirectoryMarker) {
          await this.core.writeFile(path, file.content);
        }
      }

      setStickyBackend(ownerId, 'opfs');
      logger.info('[OPFS Storage] Saved workspace:', ownerId, 'files:', state.files.size);
    } catch (error) {
      logger.error('[OPFS Storage] Failed to save workspace:', error);
      this.markFailed(ownerId);
      setStickyBackend(ownerId, 'indexeddb');
      return this.saveWorkspaceToIDB(ownerId, state);
    }
  }

  /**
   * Saves the workspace using the IndexedDB backend.
   */
  private async saveWorkspaceToIDB(ownerId: string, state: WorkspaceState): Promise<void> {
    try {
      if (!this.idbBackend.isInitialized()) {
        await this.idbBackend.initialize(ownerId);
      }
      for (const [path, file] of state.files.entries()) {
        if (!file.isDirectoryMarker) {
          await this.idbBackend.writeFile(ownerId, path, file.content, {
            version: file.version,
            language: file.language,
          });
        }
      }
      logger.info('[VFS Storage] Saved workspace to IDB:', ownerId, 'files:', state.files.size);
    } catch (error) {
      logger.error('[VFS Storage] IDB fallback save failed:', error);
      throw error;
    }
  }

  /**
   * Delete workspace from BOTH backends to avoid leaving orphans on
   * a non-sticky backend that the user may have used previously.
   *
   * Previously this only cleared OPFS, which silently lost data when
   * the sticky backend was IDB. The sticky key is also cleared so the
   * next `loadWorkspace` call can re-probe both backends from scratch.
   */
  async deleteWorkspace(ownerId: string): Promise<void> {
    const errors: Error[] = [];

    // Clear OPFS first (most common case).
    try {
      await this.core.clear();
      this.initializedWorkspaces.delete(ownerId);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }

    // Always also clear IDB to prevent orphan data when the active
    // backend was IDB. We intentionally don't gate this on the sticky
    // key because the user requested a hard delete.
    try {
      if (!this.idbBackend.isInitialized()) {
        await this.idbBackend.initialize(ownerId);
      }
      await this.idbBackend.clear(ownerId);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }

    // Forget the sticky choice so the next load re-probes both backends.
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STICKY_KEY_PREFIX + ownerId);
      }
    } catch {
      // Ignore storage errors
    }
    this.failedWorkspaces.delete(ownerId);

    if (errors.length > 0) {
      logger.error('[OPFS Storage] Delete had partial failures:', errors);
      throw new AggregateError(errors, 'Failed to delete workspace from one or more backends');
    }
    logger.info('[OPFS Storage] Deleted workspace from all backends:', ownerId);
  }

  /**
   * Check if workspace exists
   */
  async workspaceExists(ownerId: string): Promise<boolean> {
    if (this.shouldUseFallback(ownerId)) {
      try {
        if (!this.idbBackend.isInitialized()) {
          await this.idbBackend.initialize(ownerId);
        }
        const files = await this.idbBackend.listDirectory(ownerId, '');
        return files.length > 0;
      } catch {
        return false;
      }
    }
    try {
      await this.core.initialize(ownerId);
      return await this.core.fileExists(this.metadataFile);
    } catch (error) {
      this.markFailed(ownerId);
      // Recurse exactly once, with the (now) sticky IDB backend.
      // Guarded by `shouldUseFallback` to prevent unbounded recursion
      // if the IDB backend itself fails (e.g. quota exceeded).
      if (this.shouldUseFallback(ownerId)) {
        return this.workspaceExists(ownerId);
      }
      return false;
    }
  }

  /**
   * List all workspaces.
   *
   * Note: this is limited in OPFS as we can't enumerate root
   * directories from JS. We currently return only the workspaces
   * initialised in this session; a future improvement is to scan the
   * IDB `ownerId` index for workspaces initialised in a prior session.
   */
  async listWorkspaces(): Promise<string[]> {
    return Array.from(this.initializedWorkspaces);
  }

  /**
   * Check if OPFS is supported
   */
  static isSupported(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const nav = navigator as any;
    return 'storage' in nav && nav.storage != null && 'getDirectory' in nav.storage;
  }

  // ========== Private Methods ==========

  private async loadFilesRecursive(
    path: string,
    files: Map<string, VirtualFile>
  ): Promise<void> {
    try {
      const entries = await this.core.listDirectory(path || '.');
      
      for (const entry of entries) {
        // Skip metadata file
        if (entry.name === this.metadataFile) {
          continue;
        }

        if (entry.type === 'file') {
          try {
            const fileData = await this.core.readFile(entry.path);
            
            files.set(entry.path, {
              path: entry.path,
              content: fileData.content,
              language: this.detectLanguage(entry.path),
              lastModified: new Date(entry.lastModified || Date.now()).toISOString(),
              createdAt: new Date(entry.lastModified || Date.now()).toISOString(),
              version: 1,
              size: fileData.size,
            });
          } catch (error) {
            logger.warn('[OPFS Storage] Failed to load file:', entry.path, error);
          }
        } else if (entry.type === 'directory' && !entry.name.startsWith('.')) {
          await this.loadFilesRecursive(entry.path, files);
        }
      }
    } catch (error: any) {
      if (error.name !== 'NotFoundError') {
        logger.warn('[OPFS Storage] Failed to list directory:', path, error);
      }
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
}

// Singleton instance
export const opfsStorageBackend = new OPFSStorageBackend();
