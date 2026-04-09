/**
 * Local Folder Sync Service
 *
 * Enables bidirectional synchronization between local folders (via OPFS)
 * and the virtual filesystem. Provides VSCode.dev-style folder connection
 * with automatic sync and auto-save capabilities.
 *
 * Architecture:
 * - OPFS (Origin Private File System) for browser-local storage
 * - Bidirectional sync with VFS
 * - Auto-save with configurable intervals
 * - Conflict detection and resolution
 *
 * Browser Support:
 * - Chrome 119+ ✅ Full support
 * - Edge 119+ ✅ Full support
 * - Firefox 123+ ⚠️ Limited support
 * - Safari 17.4+ ⚠️ Partial support
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
 */

import { opfsCore } from '../opfs/opfs-core';
import { normalizeScopePath, resolveScopedPath } from '../scope-utils';
import { createLogger } from '@/lib/utils/logger';
import { buildApiHeaders } from '@/lib/utils';

// ============================================================================
// Comprehensive sync exclusion patterns — all languages
// ============================================================================
const SYNC_EXCLUDE_PATTERNS: RegExp[] = [
  /\/node_modules\//, /\/\.next\//, /\/\.nuxt\//, /\/\.cache\//,
  /\/\.parcel-cache\//, /\/\.turbo\//, /\/\.vite\//, /\/coverage\//,
  /\/__pycache__\//, /\/\.venv\//, /\/venv\//, /\/\.virtualenv\//,
  /\/site-packages\//, /\/\.eggs\//, /\/pip-selfcheck\.json/,
  /\/\.pytest_cache\//, /\/\.mypy_cache\//, /\/\.tox\//, /\/\.nox\//,
  /\/\.ruff_cache\//, /\/\.ipynb_checkpoints\//,
  /\/target\//, /\/\.gradle\//, /\/\.cargo\/registry\//,
  /\/vendor\//, /\/pkg\//, /\/bin\//, /\/obj\//, /\/\.nuget\//,
  /\/\.bundle\//, /\/\.gem\//,
  /\/dist\//, /\/build\//, /\/out\//, /\/\.idea\//,
  /\/Thumbs\.db/, /\/\.DS_Store/, /\.tmp$/, /\.bak$/, /\.swp$/, /\.swo$/, /~$/, /\.part$/,
];

function shouldExcludeFromSync(filePath: string): boolean {
  return SYNC_EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

// VFS API endpoints - used instead of importing server-only virtualFilesystem
const VFS_API_BASE = '/api/filesystem';

async function vfsReadFile(ownerId: string, path: string) {
  const response = await fetch(`${VFS_API_BASE}/read?path=${encodeURIComponent(path)}&ownerId=${encodeURIComponent(ownerId)}`, {
    headers: buildApiHeaders({ json: false }),
  });
  if (!response.ok) throw new Error(`Failed to read file: ${response.statusText}`);
  return response.json();
}

async function vfsWriteFile(ownerId: string, path: string, content: string, language?: string) {
  const response = await fetch(`${VFS_API_BASE}/write`, {
    method: 'POST',
    headers: buildApiHeaders(),
    body: JSON.stringify({ ownerId, path, content, language }),
  });
  if (!response.ok) throw new Error(`Failed to write file: ${response.statusText}`);
  return response.json();
}

async function vfsListDirectory(ownerId: string, path: string) {
  const response = await fetch(`${VFS_API_BASE}/list?path=${encodeURIComponent(path)}&ownerId=${encodeURIComponent(ownerId)}`, {
    headers: buildApiHeaders({ json: false }),
  });
  if (!response.ok) throw new Error(`Failed to list directory: ${response.statusText}`);
  return response.json();
}

const logger = createLogger('LocalFolderSync');

/**
 * Synced folder configuration and state
 */
export interface SyncedFolder {
  /** Unique identifier: {sessionId}:{folderName} */
  id: string;
  /** Owner ID for access control */
  ownerId: string;
  /** Session ID for scoping */
  sessionId: string;
  /** User-friendly folder name */
  name: string;
  /** Path in VFS (e.g., project/sessions/abc/synced/my-folder) */
  vfsPath: string;
  /** Root path in OPFS (e.g., /synced/my-folder) */
  opfsRoot: string;
  /** Auto-save enabled */
  autoSave: boolean;
  /** Last sync timestamp */
  lastSyncTime: number;
  /** Current sync status */
  status: 'connected' | 'syncing' | 'disconnected' | 'error' | 'conflict';
  /** Total files synced */
  fileCount: number;
  /** Last error message if any */
  lastError?: string;
}

/**
 * Sync operation result
 */
export interface SyncResult {
  synced: number;
  errors: string[];
  conflicts: Array<{
    path: string;
    vfsContent: string;
    opfsContent: string;
    vfsModified: number;
    opfsModified: number;
  }>;
}

/**
 * Local Folder Sync Service Class
 */
export class LocalFolderSyncService {
  private syncedFolders = new Map<string, SyncedFolder>();
  private syncIntervals = new Map<string, NodeJS.Timeout>();
  private readonly AUTO_SAVE_INTERVAL_MS = 2000; // 2 seconds
  private readonly SYNC_TIMEOUT_MS = 30000; // 30 seconds

  /**
   * Connect a local folder via OPFS
   * 
   * Note: Browser security requires user to grant permission via file picker.
   * In a real implementation, this would use showDirectoryPicker() API.
   * For now, we create an OPFS-backed virtual folder.
   * 
   * @param options - Folder connection options
   * @returns Connected SyncedFolder configuration
   */
  async connectFolder(options: {
    ownerId: string;
    sessionId: string;
    vfsDestinationPath: string;
    folderName: string;
  }): Promise<SyncedFolder> {
    const { ownerId, sessionId, vfsDestinationPath, folderName } = options;

    try {
      // Initialize OPFS for this workspace
      const workspaceId = `${ownerId}:${sessionId}`;
      await opfsCore.initialize(workspaceId);

      // Create OPFS root directory for synced folder
      // OPFS creates directories automatically when writing files
      const opfsRoot = `/synced/${folderName}`;
      
      // Create a marker file to ensure directory exists
      await opfsCore.writeFile(`${opfsRoot}/.directory`, '');

      // Create synced folder record
      const syncedFolder: SyncedFolder = {
        id: `${sessionId}:${folderName}`,
        ownerId,
        sessionId,
        name: folderName,
        vfsPath: vfsDestinationPath,
        opfsRoot,
        autoSave: false,
        lastSyncTime: Date.now(),
        status: 'connected',
        fileCount: 0,
      };

      this.syncedFolders.set(syncedFolder.id, syncedFolder);
      
      logger.info(`Connected folder: ${folderName} -> ${vfsDestinationPath}`, {
        opfsRoot,
        workspaceId,
      });

      // Initial sync from VFS to OPFS (if VFS has content)
      await this.syncFromVFS(syncedFolder.id);

      return syncedFolder;
    } catch (error) {
      logger.error(`Failed to connect folder ${folderName}:`, error);
      throw new Error(
        `Failed to connect folder: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync files from OPFS to VFS
   * 
   * Reads files from OPFS and writes them to the virtual filesystem.
   * Used when user modifies files in their local folder.
   */
  async syncToVFS(syncedFolderId: string): Promise<SyncResult> {
    const folder = this.syncedFolders.get(syncedFolderId);
    if (!folder) {
      throw new Error(`Synced folder not found: ${syncedFolderId}`);
    }

    folder.status = 'syncing';
    const synced: number = 0;
    const errors: string[] = [];
    const conflicts: SyncResult['conflicts'] = [];

    try {
      // List files in OPFS
      const entries = await opfsCore.listDirectory(folder.opfsRoot);
      
      for (const entry of entries) {
        if (entry.type === 'file') {
          // === EXCLUSION CHECK: Use relative path to prevent false matches ===
          // e.g., if opfsRoot is "/opfs/build" and entry.path is "/opfs/build/app.js",
          // we should match "app.js" not "/opfs/build/app.js" which could contain "build"
          const relativePath = entry.path.startsWith(folder.opfsRoot)
            ? entry.path.slice(folder.opfsRoot.length)
            : entry.path;
          if (shouldExcludeFromSync(relativePath)) {
            continue;
          }

          try {
            // Read from OPFS
            const file = await opfsCore.readFile(entry.path);
            
            // Map OPFS path to VFS path
            const vfsPath = entry.path.replace(folder.opfsRoot, folder.vfsPath);
            
            // Check for conflicts (file exists in VFS with different content)
            try {
              const vfsFile = await vfsReadFile(folder.ownerId, vfsPath);
              
              // Simple conflict detection: content differs and VFS is newer
              if (vfsFile.content !== file.content) {
                const vfsModified = new Date(vfsFile.lastModified).getTime();
                const opfsModified = entry.lastModified || Date.now();
                
                if (vfsModified > opfsModified) {
                  // VFS is newer - potential conflict
                  conflicts.push({
                    path: vfsPath,
                    vfsContent: vfsFile.content,
                    opfsContent: file.content,
                    vfsModified,
                    opfsModified,
                  });
                  continue; // Skip this file, let conflict resolution handle it
                }
              }
            } catch {
              // File doesn't exist in VFS, no conflict
            }
            
            // Write to VFS
            const language = this.detectLanguage(entry.name);
            await vfsWriteFile(folder.ownerId, vfsPath, file.content, language);
            
            logger.debug(`Synced to VFS: ${entry.path} -> ${vfsPath}`);
          } catch (error) {
            errors.push(`Failed to sync ${entry.path}: ${error instanceof Error ? error.message : String(error)}`);
            logger.error(`Failed to sync ${entry.path}:`, error);
          }
        }
      }

      // Update file count
      folder.fileCount = entries.filter(e => e.type === 'file').length;
      folder.lastSyncTime = Date.now();
      folder.status = 'connected';
      
      logger.info(`Synced ${synced} files to VFS for ${syncedFolderId}`);
    } catch (error) {
      folder.status = 'error';
      folder.lastError = error instanceof Error ? error.message : String(error);
      errors.push(`Sync failed: ${folder.lastError}`);
      logger.error(`Sync to VFS failed for ${syncedFolderId}:`, error);
    }

    return { synced, errors, conflicts };
  }

  /**
   * Sync files from VFS to OPFS
   * 
   * Reads files from VFS and writes them to OPFS.
   * Used for auto-save when user edits files in the app.
   */
  async syncFromVFS(syncedFolderId: string): Promise<SyncResult> {
    const folder = this.syncedFolders.get(syncedFolderId);
    if (!folder) {
      throw new Error(`Synced folder not found: ${syncedFolderId}`);
    }

    folder.status = 'syncing';
    const synced: number = 0;
    const errors: string[] = [];
    const conflicts: SyncResult['conflicts'] = [];

    try {
      // List files in VFS
      const listing = await vfsListDirectory(folder.ownerId, folder.vfsPath);
      
      for (const node of listing.data.nodes) {
        if (node.type === 'file') {
          // === EXCLUSION CHECK: Use relative VFS path to prevent false matches ===
          const relativePath = node.path.startsWith(folder.vfsPath)
            ? node.path.slice(folder.vfsPath.length)
            : node.path;
          if (shouldExcludeFromSync(relativePath)) {
            continue;
          }

          try {
            // Read from VFS
            const file = await vfsReadFile(folder.ownerId, node.path);
            
            // Map VFS path to OPFS path
            const opfsPath = node.path.replace(folder.vfsPath, folder.opfsRoot);

            // Write to OPFS (directories created automatically)
            await opfsCore.writeFile(opfsPath, file.content);
            
            logger.debug(`Synced from VFS: ${node.path} -> ${opfsPath}`);
          } catch (error) {
            errors.push(`Failed to sync ${node.path}: ${error instanceof Error ? error.message : String(error)}`);
            logger.error(`Failed to sync ${node.path}:`, error);
          }
        }
      }

      // Update file count
      folder.fileCount = listing.data.nodes.filter(n => n.type === 'file').length;
      folder.lastSyncTime = Date.now();
      folder.status = 'connected';
      
      logger.info(`Synced ${synced} files from VFS for ${syncedFolderId}`);
    } catch (error) {
      folder.status = 'error';
      folder.lastError = error instanceof Error ? error.message : String(error);
      errors.push(`Sync from VFS failed: ${folder.lastError}`);
      logger.error(`Sync from VFS failed for ${syncedFolderId}:`, error);
    }

    return { synced, errors, conflicts };
  }

  /**
   * Enable auto-save for a synced folder
   * 
   * Automatically syncs changes from VFS to OPFS at regular intervals.
   */
  startAutoSave(syncedFolderId: string): void {
    const folder = this.syncedFolders.get(syncedFolderId);
    if (!folder) return;

    if (this.syncIntervals.has(syncedFolderId)) {
      this.stopAutoSave(syncedFolderId);
    }

    folder.autoSave = true;
    logger.info(`Starting auto-save for ${syncedFolderId}`);

    // Sync every 2 seconds
    const interval = setInterval(async () => {
      try {
        await this.syncFromVFS(syncedFolderId);
      } catch (error) {
        logger.error(`Auto-save failed for ${syncedFolderId}:`, error);
      }
    }, this.AUTO_SAVE_INTERVAL_MS);

    this.syncIntervals.set(syncedFolderId, interval);
  }

  /**
   * Stop auto-save for a synced folder
   */
  stopAutoSave(syncedFolderId: string): void {
    const folder = this.syncedFolders.get(syncedFolderId);
    if (folder) {
      folder.autoSave = false;
    }

    const interval = this.syncIntervals.get(syncedFolderId);
    if (interval) {
      clearInterval(interval);
      this.syncIntervals.delete(syncedFolderId);
      logger.info(`Stopped auto-save for ${syncedFolderId}`);
    }
  }

  /**
   * Trigger manual sync in both directions
   */
  async syncNow(syncedFolderId: string): Promise<{ toVFS: SyncResult; fromVFS: SyncResult }> {
    const [toVFS, fromVFS] = await Promise.all([
      this.syncToVFS(syncedFolderId),
      this.syncFromVFS(syncedFolderId),
    ]);

    return { toVFS, fromVFS };
  }

  /**
   * Disconnect a synced folder
   * 
   * Stops auto-save and removes the folder from tracking.
   * Files remain in both VFS and OPFS.
   */
  async disconnectFolder(syncedFolderId: string): Promise<void> {
    this.stopAutoSave(syncedFolderId);
    this.syncedFolders.delete(syncedFolderId);
    logger.info(`Disconnected folder: ${syncedFolderId}`);
  }

  /**
   * Get all synced folders for a session
   */
  getSyncedFolders(sessionId: string): SyncedFolder[] {
    return Array.from(this.syncedFolders.values()).filter(f => f.sessionId === sessionId);
  }

  /**
   * Get a specific synced folder by ID
   */
  getFolder(syncedFolderId: string): SyncedFolder | undefined {
    return this.syncedFolders.get(syncedFolderId);
  }

  /**
   * Get sync status for all folders
   */
  getSyncStatus(sessionId: string): Array<{
    id: string;
    name: string;
    status: SyncedFolder['status'];
    lastSyncTime: number;
    autoSave: boolean;
    fileCount: number;
  }> {
    return this.getSyncedFolders(sessionId).map(f => ({
      id: f.id,
      name: f.name,
      status: f.status,
      lastSyncTime: f.lastSyncTime,
      autoSave: f.autoSave,
      fileCount: f.fileCount,
    }));
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase() || '';

    const languageMap: Record<string, string> = {
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
      xml: 'xml',
      sh: 'shell',
    };

    return languageMap[extension] || 'text';
  }
}

// Singleton instance
export const localFolderSyncService = new LocalFolderSyncService();
