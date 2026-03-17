/**
 * VFS Sync-Back Service for Snapshot Restoration
 *
 * Syncs sandbox filesystem state back to the virtual filesystem (VFS)
 * after snapshot restoration or on-demand.
 *
 * Use Cases:
 * - After restoring from snapshot, sync files back to VFS
 * - Periodic sync of sandbox → VFS for backup
 * - On-demand sync before session transfer
 * - Cross-provider migration (export from one, import to another)
 *
 * This module is ADDITIVE - doesn't affect existing VFS sync logic.
 *
 * @see lib/virtual-filesystem/virtual-filesystem-service.ts - Main VFS implementation
 * @see lib/sandbox/auto-snapshot-service.ts - Auto-snapshot service
 * @see lib/sandbox/user-terminal-sessions.ts - User session management
 *
 * @example
 * ```typescript
 * // After snapshot restoration
 * await vfsSyncBackService.syncSandboxToVFS(sessionId, {
 *   vfsScopePath: 'project',
 *   syncMode: 'full',  // or 'incremental'
 * });
 *
 * // Get sync status
 * const status = await vfsSyncBackService.getSyncStatus(sessionId);
 * console.log(`Files synced: ${status.filesSynced}`);
 * ```
 */

// Re-export types from separate file to avoid pulling in server modules for client components
export type { VFSFileEntry, SyncMode, VFSyncConfig, VFSyncResult, VFSyncStatus } from './vfs-sync-back.types';

// Dynamic import to prevent bundling in client components
import type { SandboxProviderType } from '../../sandbox/providers';
import { getTerminalSession } from '../../terminal/session/terminal-session-store';
import { createLogger } from '../../utils/logger';

const logger = createLogger('VFS:SyncBack');

/**
 * Sync mode options
 */
export type SyncMode = 'full' | 'incremental' | 'changed-only';

/**
 * Sync configuration
 */
export interface VFSyncConfig {
  /** VFS scope path (e.g., 'project') */
  vfsScopePath: string;
  
  /** Sync mode */
  syncMode?: SyncMode;
  
  /** File patterns to include (glob) */
  includePatterns?: string[];
  
  /** File patterns to exclude (glob) */
  excludePatterns?: string[];
  
  /** Max file size to sync (bytes) */
  maxFileSize?: number;
  
  /** Timeout per file (ms) */
  fileTimeout?: number;
}

/**
 * Sync result
 */
export interface VFSyncResult {
  success: boolean;
  filesSynced: number;
  bytesSynced: number;
  duration: number;
  errors?: Array<{ path: string; error: string }>;
  metadata?: {
    totalFiles: number;
    skippedFiles: number;
    failedFiles: number;
  };
}

/**
 * Sync status
 */
export interface VFSyncStatus {
  sessionId: string;
  lastSyncAt?: number;
  lastSyncDuration?: number;
  lastSyncFiles?: number;
  isSyncing: boolean;
  progress?: {
    currentFile: number;
    totalFiles: number;
    currentPath?: string;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Partial<VFSyncConfig> = {
  syncMode: 'full',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  fileTimeout: 30000, // 30 seconds
};

/**
 * VFS Sync-Back Service
 */
export class VFSyncBackService {
  /** Active sync operations */
  private activeSyncs = new Map<string, VFSyncStatus>();
  
  /** File hash cache for incremental sync */
  private fileHashCache = new Map<string, { hash: string; mtime: number }>();
  
  /**
   * Sync sandbox filesystem to VFS
   */
  async syncSandboxToVFS(
    sessionId: string,
    config: VFSyncConfig
  ): Promise<VFSyncResult> {
    const session = getTerminalSession(sessionId);
    
    if (!session) {
      return {
        success: false,
        filesSynced: 0,
        bytesSynced: 0,
        duration: 0,
        errors: [{ path: '', error: 'Session not found' }],
      };
    }
    
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize sync status
    const status: VFSyncStatus = {
      sessionId,
      isSyncing: true,
    };
    this.activeSyncs.set(sessionId, status);
    
    try {
      // Dynamic import to prevent bundling in client components
      const { getSandboxProvider } = await import('../../sandbox/providers');
      const provider = await getSandboxProvider(this.inferProviderType(session.sandboxId));
      const handle = await provider.getSandbox(session.sandboxId);
      
      // List files in sandbox workspace
      const listResult = await handle.listDirectory(session.cwd || '/workspace');
      
      if (!listResult.success) {
        throw new Error(listResult.output || 'Failed to list directory');
      }
      
      // Parse file list
      const files = await this.parseFileList(listResult.output, session.cwd || '/workspace', handle);
      
      // Filter files by patterns
      const filteredFiles = this.filterFiles(files, mergedConfig.includePatterns, mergedConfig.excludePatterns);
      
      // Update status
      status.progress = {
        currentFile: 0,
        totalFiles: filteredFiles.length,
      };
      
      // Sync files
      const result = await this.syncFiles(filteredFiles, mergedConfig, status, session.userId)
      result.duration = Date.now() - startTime
      
      // Update final status
      status.isSyncing = false;
      status.lastSyncAt = Date.now();
      status.lastSyncDuration = result.duration;
      status.lastSyncFiles = result.filesSynced;
      status.progress = undefined;
      
      logger.info(`Synced ${result.filesSynced} files (${result.bytesSynced} bytes) in ${result.duration}ms`);
      
      return result;
    } catch (error: any) {
      logger.error('Sync failed:', error);
      
      status.isSyncing = false;
      this.activeSyncs.delete(sessionId);
      
      return {
        success: false,
        filesSynced: 0,
        bytesSynced: 0,
        duration: Date.now() - startTime,
        errors: [{ path: '', error: error?.message || 'Sync failed' }],
      };
    }
  }
  
  /**
   * Get sync status for session
   */
  getSyncStatus(sessionId: string): VFSyncStatus | undefined {
    return this.activeSyncs.get(sessionId);
  }
  
  /**
   * Cancel active sync operation
   */
  cancelSync(sessionId: string): boolean {
    const status = this.activeSyncs.get(sessionId);
    if (!status || !status.isSyncing) {
      return false;
    }
    
    status.isSyncing = false;
    logger.info(`Cancelled sync for session ${sessionId}`);
    return true;
  }
  
  /**
   * Get sync history for session
   */
  getSyncHistory(sessionId: string): VFSyncStatus | undefined {
    return this.activeSyncs.get(sessionId);
  }
  
  /**
   * Clear sync history
   */
  clearSyncHistory(sessionId?: string): void {
    if (sessionId) {
      this.activeSyncs.delete(sessionId);
    } else {
      this.activeSyncs.clear();
    }
  }
  
  /**
   * Parse file list from ls -la output
   */
  private async parseFileList(
    output: string,
    cwd: string,
    handle: any
  ): Promise<VFSFileEntry[]> {
    const files: VFSFileEntry[] = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // Parse ls -la format: "-rw-r--r-- 1 user user 1234 Jan 1 12:00 filename"
      const parts = line.trim().split(/\s+/);
      
      if (parts.length < 9) continue;
      
      const permissions = parts[0];
      const size = parseInt(parts[4], 10);
      const fileName = parts.slice(8).join(' '); // Handle filenames with spaces
      
      // Skip . and ..
      if (fileName === '.' || fileName === '..') continue;
      
      // Skip directories
      if (permissions.startsWith('d')) continue;
      
      // Read file content
      try {
        const filePath = `${cwd}/${fileName}`
        const readResult = await handle.readFile(filePath)
        
        if (readResult.success && readResult.output !== undefined) {
          files.push({
            path: filePath,
            content: readResult.output,
            lastModified: Date.now(),
            size: size || readResult.output.length,
          });
        }
      } catch (error: any) {
        logger.warn(`Failed to read file ${fileName}:`, error?.message);
      }
    }
    
    return files;
  }
  
  /**
   * Filter files by include/exclude patterns
   */
  private filterFiles(
    files: VFSFileEntry[],
    includePatterns?: string[],
    excludePatterns?: string[]
  ): VFSFileEntry[] {
    let filtered = files;
    
    // Apply include patterns
    if (includePatterns && includePatterns.length > 0) {
      filtered = filtered.filter(f =>
        includePatterns.some(pattern => this.matchGlob(f.path, pattern))
      );
    }
    
    // Apply exclude patterns
    if (excludePatterns && excludePatterns.length > 0) {
      filtered = filtered.filter(f =>
        !excludePatterns.some(pattern => this.matchGlob(f.path, pattern))
      );
    }
    
    return filtered;
  }
  
  /**
   * Sync files to VFS
   */
  private async syncFiles(
    files: VFSFileEntry[],
    config: VFSyncConfig,
    status: VFSyncStatus,
    ownerId: string
  ): Promise<VFSyncResult> {
    const errors: Array<{ path: string; error: string }> = [];
    let filesSynced = 0;
    let bytesSynced = 0;
    let skippedFiles = 0;
    let failedFiles = 0;
    
    // Get VFS write function
    const { virtualFilesystem } = await import('..');
    const vfs = virtualFilesystem;
    
    for (const file of files) {
      if (!status.isSyncing) {
        // Sync was cancelled
        break;
      }
      
      // Update progress
      if (status.progress) {
        status.progress.currentFile = filesSynced + skippedFiles + failedFiles;
        status.progress.currentPath = file.path;
      }
      
      // Check file size
      if (config.maxFileSize && file.size > config.maxFileSize) {
        logger.debug(`Skipping large file: ${file.path} (${file.size} bytes)`);
        skippedFiles++;
        continue;
      }
      
      // Check if file changed (incremental mode)
      if (config.syncMode === 'incremental' || config.syncMode === 'changed-only') {
        const hash = await this.hashFile(file.content);
        const cached = this.fileHashCache.get(file.path);
        
        if (cached && cached.hash === hash && cached.mtime === file.lastModified) {
          logger.debug(`Skipping unchanged file: ${file.path}`);
          skippedFiles++;
          continue;
        }
        
        // Update cache
        this.fileHashCache.set(file.path, { hash, mtime: file.lastModified });
      }
      
      // Write to VFS
      try {
        // Convert path to VFS scope
        const vfsPath = this.convertToVFSPath(file.path, config.vfsScopePath);
        
        // Use VFS writeFile
        await vfs.writeFile(ownerId, vfsPath, file.content);
        
        filesSynced++;
        bytesSynced += file.content.length;
        
        logger.debug(`Synced: ${file.path} → ${vfsPath}`);
      } catch (error: any) {
        failedFiles++;
        errors.push({
          path: file.path,
          error: error?.message || 'Failed to write to VFS',
        });
        logger.warn(`Failed to sync ${file.path}:`, error?.message);
      }
    }
    
    return {
      success: errors.length === 0,
      filesSynced,
      bytesSynced,
      duration: 0, // Will be set by caller
      errors: errors.length > 0 ? errors : undefined,
      metadata: {
        totalFiles: files.length,
        skippedFiles,
        failedFiles,
      },
    };
  }
  
  /**
   * Convert sandbox path to VFS path
   */
  private convertToVFSPath(sandboxPath: string, vfsScopePath: string): string {
    // Remove workspace prefix
    const relativePath = sandboxPath.replace(/^\/workspace\//, '').replace(/^\/home\/[^/]+\/workspace\//, '');
    
    // Add VFS scope prefix
    return `${vfsScopePath}/${relativePath}`;
  }
  
  /**
   * Simple hash function for file content
   */
  private async hashFile(content: string): Promise<string> {
    // Simple hash - in production, use proper crypto hash
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Simple glob pattern matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp';
    if (sandboxId.startsWith('blaxel-')) return 'blaxel';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem';
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn';
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter';
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent';
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    return 'daytona';
  }
}

/**
 * Singleton instance
 */
export const vfsSyncBackService = new VFSyncBackService();

/**
 * Convenience function: Sync sandbox to VFS
 */
export async function syncSandboxToVFS(
  sessionId: string,
  vfsScopePath: string,
  options?: Partial<VFSyncConfig>
): Promise<VFSyncResult> {
  return vfsSyncBackService.syncSandboxToVFS(sessionId, {
    vfsScopePath,
    ...options,
  });
}
