/**
 * FS Bridge - Wires local filesystem into the VFS layer
 * 
 * This bridge allows the existing VFS infrastructure to use
 * the local filesystem when running in desktop mode, providing
 * seamless fallback for agents that expect VFS operations.
 */

import { isDesktopMode, getPlatform, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { workspaceManager } from './workspace-manager';
import { createFileSystem, type IFileSystem, type FSFile, type FSDirectoryListing, type FSSearchResult, type FSStats, type FileWatcherCallback, type FileSystemWatchEvent } from './index';
import { createLogger } from '@/lib/utils/logger';

// Import Tauri event listening for Rust file change events
let tauriListen: typeof import('@tauri-apps/api/event').listen | null = null;
let tauriUnlisten: import('@tauri-apps/api/event').UnlistenFn | null = null;

try {
  if (typeof window !== 'undefined') {
    import('@tauri-apps/api/event').then((eventModule) => {
      tauriListen = eventModule.listen;
    }).catch(() => {
      tauriListen = null;
    });
  }
} catch {
  tauriListen = null;
}

const log = createLogger('FSBridge');

// ============================================================================
// Types
// ============================================================================

export interface FSBridgeConfig {
  userId: string;
  workspaceRoot?: string;
  boundaryEnabled?: boolean;
  sessionId?: string;
}

export interface RustFileChangeEvent {
  path: string;
  change_type: string; // "create" | "update" | "delete"
  timestamp: string;
}

export interface FSBridgeStats {
  platform: 'desktop' | 'web';
  workspaceRoot: string | null;
  boundaryEnabled: boolean;
  version: number;
}

// ============================================================================
// FS Bridge
// ============================================================================

class FSBridge {
  private fs: IFileSystem | null = null;
  private initialized: boolean = false;
  private initializing: boolean = false; // Track if initialization has started
  private config: FSBridgeConfig | null = null;
  private version: number = 0;
  private watchCallback: FileWatcherCallback | null = null;
  private externalWatchHandlers: Array<(event: FileSystemWatchEvent) => void> = [];
  private rustFileChangeUnlisten: import('@tauri-apps/api/event').UnlistenFn | null = null;

  /**
   * Initialize the FS bridge
   * In desktop mode: uses local filesystem
   * In web mode: delegates to VFS (no-op bridge)
   */
  async initialize(config: FSBridgeConfig): Promise<void> {
    this.config = config;
    this.initializing = true;
    
    if (isDesktopMode()) {
      log.info('Initializing FS Bridge in desktop mode', { 
        userId: config.userId,
        workspaceRoot: config.workspaceRoot 
      });

      try {
        // Try to use workspace manager first
        const workspace = await workspaceManager.initializeWorkspace({
          userId: config.userId,
          root: config.workspaceRoot,
          boundaryEnabled: config.boundaryEnabled,
          sessionId: config.sessionId,
        });
        
        this.fs = workspace.fileSystem;
        this.initialized = true;
        
        // Start file watcher for auto-refresh when external changes occur
        await this.startFileWatcher();

        // Start listening for file change events from Rust commands
        await this.startRustFileChangeListener();

        log.info('FS Bridge initialized with workspace manager', {
          workspaceId: workspace.id
        });
        this.initializing = false;
      } catch (err) {
        this.initializing = false;
        log.warn('Workspace manager failed, using direct FS', { error: err });
        
        // Fallback to direct filesystem
        this.fs = createFileSystem();
        await this.fs.initialize({
          root: config.workspaceRoot || getDefaultWorkspaceRoot() || '',
          userId: config.userId,
          sessionId: config.sessionId,
          boundaryEnabled: config.boundaryEnabled || false,
        });
        this.initialized = true;
        
        // Start file watcher for auto-refresh when external changes occur
        await this.startFileWatcher();

        // Start listening for file change events from Rust commands
        await this.startRustFileChangeListener();

        this.initializing = false;
      }
    } else {
      // Web mode - no local FS needed
      log.info('FS Bridge initialized in web mode (passthrough)');
      this.initialized = true;
      this.initializing = false;
    }
  }

  /**
   * Check if bridge is in desktop mode and ready
   * Returns true during initialization too to prevent race condition
   */
  isDesktopMode(): boolean {
    // Return true if in desktop mode AND (initialized OR initializing)
    // This prevents race condition where isUsingLocalFS returns false
    // during the brief window while initialization is in progress
    return isDesktopMode() && (this.initialized || this.initializing);
  }

  /**
   * Check if bridge is fully initialized (not just initializing)
   */
  isReady(): boolean {
    return isDesktopMode() && this.initialized;
  }

  /**
   * Read a file (VFS-style API)
   */
  async readFile(ownerId: string, filePath: string): Promise<FSFile> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized. Please wait for initialization to complete.');
    }
    
    // In desktop mode, use local FS
    if (this.isDesktopMode()) {
      return this.fs.readFile(filePath);
    }
    
    // In web mode, would need to delegate to VFS
    throw new Error('File read not available in web mode - use VFS directly');
  }

  /**
   * Write a file (VFS-style API)
   */
  async writeFile(
    ownerId: string, 
    filePath: string, 
    content: string, 
    language?: string
  ): Promise<FSFile> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      const result = await this.fs.writeFile(filePath, content, language);
      this.version++;
      return result;
    }
    
    throw new Error('File write not available in web mode - use VFS directly');
  }

  /**
   * Delete a path (VFS-style API)
   */
  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      const result = await this.fs.deletePath(targetPath);
      this.version++;
      return result;
    }
    
    throw new Error('Delete not available in web mode - use VFS directly');
  }

  /**
   * List directory (VFS-style API)
   */
  async listDirectory(ownerId: string, directoryPath?: string): Promise<FSDirectoryListing> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      return this.fs.listDirectory(directoryPath);
    }
    
    throw new Error('List directory not available in web mode - use VFS directly');
  }

  /**
   * Search files (VFS-style API)
   */
  async search(
    ownerId: string, 
    query: string, 
    options?: { path?: string; limit?: number }
  ): Promise<FSSearchResult[]> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      return this.fs.search(query, options);
    }
    
    throw new Error('Search not available in web mode - use VFS directly');
  }

  /**
   * Get workspace stats
   */
  async getStats(ownerId: string): Promise<FSStats> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      return this.fs.getStats();
    }
    
    throw new Error('Stats not available in web mode - use VFS directly');
  }

  /**
   * Check if file exists
   */
  async exists(ownerId: string, path: string): Promise<boolean> {
    if (!this.fs) {
      return false;
    }
    
    if (this.isDesktopMode()) {
      return this.fs.exists(path);
    }
    
    return false;
  }

  /**
   * Create directory
   */
  async createDirectory(ownerId: string, dirPath: string): Promise<{ path: string; createdAt: string }> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      const result = await this.fs.createDirectory(dirPath);
      this.version++;
      return result;
    }
    
    throw new Error('Create directory not available in web mode - use VFS directly');
  }

  /**
   * Get workspace version
   */
  async getVersion(ownerId: string): Promise<number> {
    if (!this.fs) {
      return 0;
    }
    
    if (this.isDesktopMode()) {
      return this.fs.getVersion();
    }
    
    return this.version;
  }

  /**
   * Export workspace snapshot
   */
  async exportWorkspace(ownerId: string): Promise<{ root: string; version: number; files: FSFile[] }> {
    if (!this.fs) {
      throw new Error('FS Bridge not initialized');
    }
    
    if (this.isDesktopMode()) {
      return this.fs.exportWorkspace();
    }
    
    throw new Error('Export not available in web mode - use VFS directly');
  }

  /**
   * Start file watcher for external change detection
   * When files change externally (e.g., in another app), emit events for UI refresh
   */
  private async startFileWatcher(): Promise<void> {
    if (!this.fs) return;
    
    // Create callback to handle external file changes
    this.watchCallback = (event: FileSystemWatchEvent) => {
      log.info('External file change detected', { 
        type: event.type, 
        paths: event.paths 
      });
      
      // Increment version to trigger UI refresh
      this.version++;
      
      // Notify external handlers (VFS service will register for UI updates)
      for (const handler of this.externalWatchHandlers) {
        try {
          handler(event);
        } catch (err) {
          log.error('Watch handler error:', err);
        }
      }
    };
    
    // Start watching - this requires the fs to support it
    if (typeof this.fs.startWatching === 'function') {
      await this.fs.startWatching(this.watchCallback);
      log.info('File watcher started for external change detection');
    }
  }
  
  /**
   * Register a handler for external file watch events
   * Used by VFS service to emit global sync events for UI refresh
   */
  onWatchEvent(handler: (event: FileSystemWatchEvent) => void): void {
    this.externalWatchHandlers.push(handler);
    log.info('Registered external watch event handler');
  }
  
  /**
   * Remove a watch event handler
   */
  offWatchEvent(handler: (event: FileSystemWatchEvent) => void): void {
    const idx = this.externalWatchHandlers.indexOf(handler);
    if (idx !== -1) {
      this.externalWatchHandlers.splice(idx, 1);
    }
  }
  
  /**
   * Check if file watcher is active
   */
  isWatching(): boolean {
    if (this.fs && typeof (this.fs as any).isWatchingEnabled === 'function') {
      return (this.fs as any).isWatchingEnabled();
    }
    return false;
  }
  
  /**
   * Get bridge statistics
   */
  getBridgeStats(): FSBridgeStats {
    return {
      platform: getPlatform(),
      workspaceRoot: this.config?.workspaceRoot || null,
      boundaryEnabled: this.config?.boundaryEnabled || false,
      version: this.version,
    };
  }

  /**
   * Get the filesystem instance directly
   */
  getFileSystem(): IFileSystem | null {
    return this.fs;
  }

  /**
   * Start listening for file change events emitted by Rust commands
   * When Rust write_file is called, it emits a 'file-change' event
   * This allows the TypeScript VFS layer to create shadow commits
   */
  private async startRustFileChangeListener(): Promise<void> {
    if (!tauriListen) {
      log.debug('Tauri event listening not available, skipping Rust file change listener');
      return;
    }

    try {
      this.rustFileChangeUnlisten = await tauriListen<RustFileChangeEvent>('file-change', (event) => {
        log.info('Rust file change event received', {
          path: event.payload.path,
          changeType: event.payload.change_type,
          timestamp: event.payload.timestamp,
        });

        // Increment version
        this.version++;

        // Convert to FileSystemWatchEvent and notify handlers
        const watchEvent: FileSystemWatchEvent = {
          type: event.payload.change_type as FileSystemWatchEvent['type'],
          paths: [event.payload.path],
          timestamp: new Date(event.payload.timestamp).getTime(),
        };

        // Notify external handlers (VFS service will register for UI updates)
        for (const handler of this.externalWatchHandlers) {
          try {
            handler(watchEvent);
          } catch (err) {
            log.error('Rust file change handler error:', err);
          }
        }
      });

      log.info('Rust file change listener started');
    } catch (err) {
      log.warn('Failed to start Rust file change listener:', err);
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    // Stop Rust file change listener
    if (this.rustFileChangeUnlisten) {
      this.rustFileChangeUnlisten();
      this.rustFileChangeUnlisten = null;
    }

    // Stop watching first
    if (this.fs && typeof this.fs.stopWatching === 'function') {
      await this.fs.stopWatching();
    }
    this.watchCallback = null;

    if (this.fs) {
      await this.fs.destroy();
      this.fs = null;
    }
    this.initialized = false;
    this.config = null;
    log.info('FS Bridge destroyed');
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const fsBridge = new FSBridge();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick initialize for a user
 */
export async function initializeFSBridge(userId: string, options?: Partial<FSBridgeConfig>): Promise<void> {
  await fsBridge.initialize({
    userId,
    workspaceRoot: options?.workspaceRoot,
    boundaryEnabled: options?.boundaryEnabled,
    sessionId: options?.sessionId,
  });
}

/**
 * Get the active filesystem for direct operations
 */
export function getDirectFileSystem(): IFileSystem | null {
  return fsBridge.getFileSystem();
}

/**
 * Check if local filesystem is being used
 */
export function isUsingLocalFS(): boolean {
  return fsBridge.isDesktopMode();
}