/**
 * Filesystem Abstraction Layer
 * 
 * Provides a unified interface for file operations that switches between:
 * - Local filesystem (desktop mode): Direct access to user's files via Tauri FS API
 * - Virtual filesystem (web mode): Simulated sandboxed storage
 * 
 * This abstraction enables the LLM agent to read/write/search files identically
 * regardless of the underlying storage mechanism.
 */

import { isDesktopMode, isTauriRuntime, getPlatform, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { randomUUID } from 'crypto';

// ============================================================================
// Tauri FS API Types
// ============================================================================

interface TauriFsModule {
  readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
  writeTextFile(path: string, contents: string, options?: { baseDir?: number }): Promise<void>;
  readDir(path: string, options?: { baseDir?: number }): Promise<Array<{ name: string; isDirectory: boolean; isFile?: boolean; children?: any[] }>>;
  mkdir(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { baseDir?: number; recursive?: boolean }): Promise<void>;
  exists(path: string, options?: { baseDir?: number }): Promise<boolean>;
  stat(path: string, options?: { baseDir?: number }): Promise<{ size: number; mtime: number; isDirectory: boolean; isFile: boolean }>;
  copyFile(src: string, dest: string, options?: { baseDir?: number }): Promise<void>;
}

// Tauri FS Watch types
interface TauriFsWatchModule {
  watch(
    path: string | string[],
    callback: (event: { type: string; paths: string[] }) => void,
    options?: { baseDir?: number; recursive?: boolean }
  ): Promise<{ close: () => Promise<void> }>;
}

// File system change event types
export type FileSystemChangeType = 'create' | 'modify' | 'delete' | 'rename';

export interface FileSystemWatchEvent {
  type: FileSystemChangeType;
  paths: string[];
  timestamp: number;
}

// ============================================================================
// Types
// ============================================================================

export interface FSFile {
  path: string;
  content: string;
  language?: string;
  lastModified: string;
  createdAt: string;
  size: number;
}

export interface FSDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface FSDirectoryListing {
  path: string;
  nodes: FSDirectoryEntry[];
}

export interface FSSearchResult {
  path: string;
  name: string;
  language?: string;
  score: number;
  snippet: string;
  lastModified: string;
}

export interface FSStats {
  totalSize: number;
  totalSizeFormatted: string;
  fileCount: number;
  largestFile?: { path: string; size: number; sizeFormatted: string };
  quotaUsage: { sizePercent: number; fileCountPercent: number };
}

export interface WorkspaceConfig {
  root: string;
  userId: string;
  sessionId?: string;
  boundaryEnabled: boolean;
}

export interface FSToolResult {
  success: boolean;
  output?: string;
  content?: string;
  error?: string;
  blocked?: boolean;
}

// File watcher callback type
export type FileWatcherCallback = (event: FileSystemWatchEvent) => void;

// ============================================================================
// Desktop Events
// ============================================================================

/**
 * Desktop file change event emitted when files change externally
 * Enables UI updates in desktop mode when files are modified outside the app
 */
export interface DesktopFileChangeEvent {
  type: 'create' | 'update' | 'delete';
  path: string;
  paths: string[];
  workspaceId: string;
  userId: string;
  timestamp: number;
}

/**
 * Handler function for desktop file change events
 */
export type DesktopFileChangeHandler = (event: DesktopFileChangeEvent) => void;

// ============================================================================
// Abstract Filesystem Interface
// ============================================================================

export interface IFileSystem {
  readonly id: string;
  readonly name: string;
  readonly isDesktop: boolean;
  initialize(config: WorkspaceConfig): Promise<void>;
  readFile(path: string): Promise<FSFile>;
  writeFile(path: string, content: string, language?: string): Promise<FSFile>;
  deletePath(path: string): Promise<{ deletedCount: number }>;
  listDirectory(path?: string): Promise<FSDirectoryListing>;
  search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]>;
  getStats(): Promise<FSStats>;
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<{ path: string; createdAt: string }>;
  getVersion(): Promise<number>;
  exportWorkspace(): Promise<{ root: string; version: number; files: FSFile[] }>;
  destroy(): Promise<void>;
  startWatching(callback?: FileWatcherCallback): Promise<void>;
  stopWatching(): Promise<void>;
}

// ============================================================================
// Desktop Filesystem Adapter (Tauri FS)
// ============================================================================

export class DesktopFileSystem implements IFileSystem {
  readonly id: string;
  readonly name = 'desktop';
  readonly isDesktop = true;
  
  private workspaceRoot: string = '';
  private boundaryPath: string | null = null;
  private userId: string = '';
  private version: number = 0;
  private tauriFs: TauriFsModule | null = null;
  private tauriWatch: TauriFsWatchModule | null = null;
  private baseDir: number = 0; // BaseDirectory.Home = 0
  private watcher: { close: () => Promise<void> } | null = null;
  private watcherCallbacks: Set<FileWatcherCallback> = new Set();
  private isWatching: boolean = false;
  
  // Poll-based fallback for file watching
  private pollWatcher: NodeJS.Timeout | null = null;
  private pollIntervalMs: number = 3000; // Default 3 seconds
  private fileStates: Map<string, { mtime: number; size: number }> = new Map();
  private usePollFallback: boolean = false;
  
  constructor() {
    this.id = `desktop-${randomUUID().slice(0, 8)}`;
  }
  
  /**
   * Initialize the desktop filesystem with Tauri FS API
   * Uses the user's home directory as the base for file operations
   */
  async initialize(config: WorkspaceConfig): Promise<void> {
    // Import Tauri FS plugin
    try {
      const tauriFs = await import('@tauri-apps/plugin-fs');
      this.tauriFs = tauriFs as unknown as TauriFsModule;
    } catch (error) {
      console.error('[DesktopFS] Failed to import Tauri FS plugin:', error);
      throw new Error('Tauri FS plugin not available. Running in web mode?');
    }
    
    this.userId = config.userId;
    
    // Use config root or fall back to default workspace folder name
    // For Tauri, the workspace is relative to the home directory
    this.workspaceRoot = config.root || 'opencode-workspaces';
    
    if (!this.workspaceRoot) {
      throw new Error('Cannot determine workspace root for desktop mode');
    }
    
    // Create workspace directory using Tauri FS with baseDir
    await this.ensureDirectory(this.workspaceRoot);
    
    // Set up boundary path if session-based isolation is enabled
    if (config.boundaryEnabled && config.sessionId) {
      this.boundaryPath = `${this.workspaceRoot}/${config.sessionId}`;
      await this.ensureDirectory(this.boundaryPath);
    }
    
    // Import Tauri FS watch module and check availability
    try {
      const tauriPluginFs = await import('@tauri-apps/plugin-fs');
      // Check if watch function exists at runtime
      if (typeof (tauriPluginFs as any).watch === 'function') {
        this.tauriWatch = tauriPluginFs as unknown as TauriFsWatchModule;
      } else {
        console.warn('[DesktopFS] Tauri FS watch function not available at runtime - will use poll fallback');
        this.usePollFallback = true;
      }
    } catch (error) {
      console.warn('[DesktopFS] File watcher not available - will use poll fallback:', error);
      this.usePollFallback = true;
    }
    
    // Allow configurable poll interval via environment
    const envPollInterval = process.env.DESKTOP_FS_POLL_INTERVAL;
    if (envPollInterval) {
      const parsed = parseInt(envPollInterval, 10);
      if (!isNaN(parsed) && parsed >= 1000) {
        this.pollIntervalMs = Math.min(parsed, 30000); // Cap at 30 seconds
      }
    }
    
    console.log('[DesktopFS] Initialized with Tauri FS', { 
      workspaceRoot: this.workspaceRoot, 
      boundaryPath: this.boundaryPath,
      baseDir: 'Home',
      watcherAvailable: !!this.tauriWatch
    });
  }
  
  /**
   * Start watching the workspace for file changes
   * Enables auto-refresh when external changes occur
   * Uses Tauri watch API if available, falls back to poll-based watching
   */
  async startWatching(callback?: FileWatcherCallback): Promise<void> {
    // Add callback first regardless of watch availability
    if (callback) {
      this.watcherCallbacks.add(callback);
    }
    
    if (this.isWatching) {
      return;
    }
    
    const watchPath = this.boundaryPath || this.workspaceRoot;
    
    // Try Tauri watch API first
    if (this.tauriWatch && typeof (this.tauriWatch as any).watch === 'function') {
      try {
        this.watcher = await this.tauriWatch.watch(
        watchPath,
        (event) => {
          // Convert Tauri event types to our types
          let changeType: FileSystemChangeType = 'modify';
          
          if (event.type === 'create' || event.type === 'CREATE') {
            changeType = 'create';
          } else if (event.type === 'modify' || event.type === 'MODIFY') {
            changeType = 'modify';
          } else if (event.type === 'remove' || event.type === 'REMOVE' || event.type === 'delete' || event.type === 'DELETE') {
            changeType = 'delete';
          } else if (event.type === 'rename' || event.type === 'RENAME') {
            changeType = 'rename';
          }
          
          // Normalize paths relative to workspace
          const normalizedPaths = event.paths.map(p => this.normalizePath(p));
          
          const watchEvent: FileSystemWatchEvent = {
            type: changeType,
            paths: normalizedPaths,
            timestamp: Date.now()
          };
          
          // Increment version on any change
          this.version++;
          
          // Notify all callbacks
          this.watcherCallbacks.forEach(cb => {
            try {
              cb(watchEvent);
            } catch (err) {
              console.error('[DesktopFS] Watch callback error:', err);
            }
          });
        },
        { 
          baseDir: this.baseDir, 
          recursive: true 
        }
      );
      
      this.isWatching = true;
      console.log('[DesktopFS] Started native file watcher:', watchPath);
      return;
      } catch (error) {
        console.warn('[DesktopFS] Native watch failed, falling back to poll:', error);
        this.usePollFallback = true;
      }
    } else {
      console.log('[DesktopFS] Native watch not available, using poll fallback');
      this.usePollFallback = true;
    }
    
    // Fallback to poll-based watching
    if (this.usePollFallback) {
      await this.startPollWatcher(watchPath);
    }
  }
  
  /**
   * Start poll-based file watcher as fallback
   * Periodically scans the workspace for file changes
   */
  private async startPollWatcher(watchPath: string): Promise<void> {
    console.log('[DesktopFS] Starting poll-based watcher with interval:', this.pollIntervalMs, 'ms');
    
    // Initialize file states
    await this.scanAndCacheFileStates(watchPath);
    
    this.pollWatcher = setInterval(async () => {
      try {
        const changes = await this.detectFileChanges(watchPath);
        
        if (changes.length > 0) {
          this.version++;
          
          for (const change of changes) {
            const watchEvent: FileSystemWatchEvent = {
              type: change.type,
              paths: [change.path],
              timestamp: Date.now()
            };
            
            this.watcherCallbacks.forEach(cb => {
              try {
                cb(watchEvent);
              } catch (err) {
                console.error('[DesktopFS] Poll watch callback error:', err);
              }
            });
          }
          
          console.log('[DesktopFS] Poll detected changes:', changes.map(c => `${c.type}:${c.path}`).join(', '));
        }
      } catch (error) {
        console.error('[DesktopFS] Poll watcher error:', error);
      }
    }, this.pollIntervalMs);
    
    this.isWatching = true;
  }
  
  /**
   * Scan workspace and cache file states (mtime, size)
   */
  private async scanAndCacheFileStates(dirPath: string): Promise<void> {
    if (!this.tauriFs) return;
    
    try {
      const entries = await this.tauriFs.readDir(dirPath, { baseDir: this.baseDir });
      
      for (const entry of entries) {
        if (entry.name?.startsWith('.')) continue;
        
        const entryPath = `${dirPath}/${entry.name}`;
        
        if (entry.isDirectory) {
          await this.scanAndCacheFileStates(entryPath);
        } else {
          try {
            const stat = await this.tauriFs.stat(entryPath, { baseDir: this.baseDir });
            this.fileStates.set(this.normalizePath(entryPath), {
              mtime: stat.mtime,
              size: stat.size
            });
          } catch {
            // Skip files that can't be accessed
          }
        }
      }
    } catch {
      // Directory may not exist - ignore
    }
  }
  
  /**
   * Detect file changes by comparing current state to cached state
   * Recursively scans all subdirectories
   */
  private async detectFileChanges(dirPath: string): Promise<Array<{ path: string; type: FileSystemChangeType }>> {
    if (!this.tauriFs) return [];
    
    const changes: Array<{ path: string; type: FileSystemChangeType }> = [];
    const currentFiles = new Map<string, { mtime: number; size: number }>();
    const dirBasePath = this.normalizePath(dirPath);
    
    try {
      const entries = await this.tauriFs.readDir(dirPath, { baseDir: this.baseDir });
      
      for (const entry of entries) {
        if (entry.name?.startsWith('.')) continue;
        
        const entryPath = `${dirPath}/${entry.name}`;
        const normalizedPath = this.normalizePath(entryPath);
        
        if (entry.isDirectory) {
          // Check for new directories
          if (!this.fileStates.has(normalizedPath)) {
            changes.push({ path: normalizedPath, type: 'create' });
          }
          // Recursively check subdirectories
          const subChanges = await this.detectFileChanges(entryPath);
          changes.push(...subChanges);
        } else {
          try {
            const stat = await this.tauriFs.stat(entryPath, { baseDir: this.baseDir });
            currentFiles.set(normalizedPath, { mtime: stat.mtime, size: stat.size });
            
            const previousState = this.fileStates.get(normalizedPath);
            
            if (!previousState) {
              // New file
              changes.push({ path: normalizedPath, type: 'create' });
            } else if (stat.mtime !== previousState.mtime || stat.size !== previousState.size) {
              // Modified file
              changes.push({ path: normalizedPath, type: 'modify' });
            }
          } catch {
            // File may have been deleted or is inaccessible
          }
        }
      }
      
      // Check for deleted files - only check files within this directory tree
      for (const [cachedPath] of this.fileStates) {
        // Check if cached path is within this directory
        if (cachedPath.startsWith(dirBasePath + '/') || cachedPath === dirBasePath) {
          if (!currentFiles.has(cachedPath)) {
            changes.push({ path: cachedPath, type: 'delete' });
          }
        }
      }
      
      // Merge current files into global state
      for (const [path, state] of currentFiles) {
        this.fileStates.set(path, state);
      }
      
    } catch {
      // Directory may not exist - ignore
    }
    
    return changes;
  }
  
  /**
   * Stop watching the workspace for file changes
   */
  async stopWatching(): Promise<void> {
    // Stop native watcher
    if (this.watcher) {
      try {
        await this.watcher.close();
        this.watcher = null;
      } catch (error) {
        console.error('[DesktopFS] Error stopping native watcher:', error);
      }
    }
    
    // Stop poll watcher
    if (this.pollWatcher) {
      clearInterval(this.pollWatcher);
      this.pollWatcher = null;
      this.fileStates.clear(); // Clear to prevent memory leaks
      console.log('[DesktopFS] Stopped poll watcher');
    }
    
    // Reset poll fallback state
    this.usePollFallback = false;
    
    this.isWatching = false;
    this.watcherCallbacks.clear();
    console.log('[DesktopFS] Stopped watching');
  }
  
  /**
   * Add a callback for file change events
   */
  addWatchListener(callback: FileWatcherCallback): void {
    this.watcherCallbacks.add(callback);
  }
  
  /**
   * Remove a callback for file change events
   */
  removeWatchListener(callback: FileWatcherCallback): void {
    this.watcherCallbacks.delete(callback);
  }
  
  /**
   * Ensure a directory exists using Tauri FS with baseDir
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    const exists = await this.tauriFs.exists(dirPath, { baseDir: this.baseDir });
    if (!exists) {
      await this.tauriFs.mkdir(dirPath, { baseDir: this.baseDir, recursive: true });
    }
  }
  
  /**
   * Resolve a relative path to an absolute path within the workspace boundary
   * Includes path traversal protection
   */
  private resolvePath(relativePath: string): string {
    const basePath = this.boundaryPath || this.workspaceRoot;
    
    // Normalize the path to prevent traversal attacks
    const normalized = relativePath
      .replace(/\/\.\//g, '/')
      .replace(/^\.\/+/, '')
      .replace(/\/\.\.\//g, '/');
    
    // Build the full path
    const fullPath = basePath ? `${basePath}/${normalized}` : normalized;
    
    // Verify the resolved path is within the boundary
    const baseResolved = basePath || '';
    if (baseResolved && !fullPath.startsWith(baseResolved + '/') && fullPath !== baseResolved) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    
    return fullPath;
  }
  
  /**
   * Normalize a path to be relative to the workspace root
   */
  private normalizePath(absolutePath: string): string {
    const base = this.workspaceRoot || '';
    const boundary = this.boundaryPath || '';
    
    if (boundary && absolutePath.startsWith(boundary)) {
      return absolutePath.substring(boundary.length + 1);
    }
    if (base && absolutePath.startsWith(base)) {
      return absolutePath.substring(base.length + 1);
    }
    
    return absolutePath;
  }
  
  /**
   * Read a file from the local filesystem using Tauri FS API with baseDir
   */
  async readFile(path: string): Promise<FSFile> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const fullPath = this.resolvePath(path);
    
    // Check if it's a directory
    const stat = await this.tauriFs.stat(fullPath, { baseDir: this.baseDir }).catch(() => null);
    if (stat?.isDirectory) throw new Error(`Cannot read directory: ${path}`);
    
    // Read file content with baseDir option
    const content = await this.tauriFs.readTextFile(fullPath, { baseDir: this.baseDir });
    this.version++;
    
    const fileStat = await this.tauriFs.stat(fullPath, { baseDir: this.baseDir });
    
    return { 
      path: this.normalizePath(fullPath), 
      content, 
      language: this.getLanguage(path), 
      lastModified: new Date(fileStat.mtime).toISOString(), 
      createdAt: new Date(fileStat.mtime).toISOString(), 
      size: fileStat.size 
    };
  }
  
  /**
   * Write a file to the local filesystem using Tauri FS API with baseDir
   */
  async writeFile(path: string, content: string, language?: string): Promise<FSFile> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const fullPath = this.resolvePath(path);
    
    // Ensure parent directory exists
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (parentDir) {
      await this.ensureDirectory(parentDir);
    }
    
    // Write file using Tauri FS with baseDir option
    await this.tauriFs.writeTextFile(fullPath, content, { baseDir: this.baseDir });
    this.version++;
    
    const stat = await this.tauriFs.stat(fullPath, { baseDir: this.baseDir });
    
    return { 
      path: this.normalizePath(fullPath), 
      content, 
      language: language || this.getLanguage(path), 
      lastModified: new Date().toISOString(), 
      createdAt: new Date().toISOString(), 
      size: stat.size 
    };
  }
  
  /**
   * Delete a file or directory using Tauri FS API with baseDir
   */
  async deletePath(path: string): Promise<{ deletedCount: number }> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const fullPath = this.resolvePath(path);
    
    // Check if it's a directory or file
    const stat = await this.tauriFs.stat(fullPath, { baseDir: this.baseDir }).catch(() => null);
    if (!stat) {
      throw new Error(`Path does not exist: ${path}`);
    }
    
    // Remove using Tauri FS with baseDir option
    await this.tauriFs.remove(fullPath, { baseDir: this.baseDir, recursive: stat.isDirectory });
    this.version++;
    
    return { deletedCount: 1 };
  }
  
  /**
   * List directory contents using Tauri FS API with baseDir
   */
  async listDirectory(dirPath?: string): Promise<FSDirectoryListing> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const fullPath = dirPath ? this.resolvePath(dirPath) : (this.boundaryPath || this.workspaceRoot);
    
    // Read directory using Tauri FS with baseDir option
    const entries = await this.tauriFs.readDir(fullPath, { baseDir: this.baseDir });
    
    const nodes: FSDirectoryEntry[] = [];
    for (const entry of entries) {
      if (entry.name?.startsWith('.')) continue;
      
      const entryPath = `${fullPath}/${entry.name}`;
      let size: number | undefined;
      
      try {
        const stat = await this.tauriFs.stat(entryPath, { baseDir: this.baseDir });
        size = stat.isFile ? stat.size : undefined;
      } catch {
        // Entry may not be accessible
      }
      
      nodes.push({ 
        name: entry.name!, 
        path: this.normalizePath(entryPath), 
        type: entry.isDirectory ? 'directory' : 'file', 
        size 
      });
    }
    
    nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    
    return { path: dirPath || '.', nodes };
  }
  
  /**
   * Search for files matching a query using Tauri FS API with baseDir
   */
  async search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const results: FSSearchResult[] = [];
    const searchPath = options?.path ? this.resolvePath(options.path) : (this.boundaryPath || this.workspaceRoot);
    const limit = Math.min(options?.limit || 25, 100);
    
    await this.searchRecursive(searchPath, query.toLowerCase(), results, limit);
    
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  
  /**
   * Recursive search implementation using Tauri FS with baseDir
   */
  private async searchRecursive(dirPath: string, query: string, results: FSSearchResult[], limit: number): Promise<void> {
    if (results.length >= limit) return;
    if (!this.tauriFs) return;
    
    try {
      const entries = await this.tauriFs.readDir(dirPath, { baseDir: this.baseDir });
      
      for (const entry of entries) {
        if (results.length >= limit) break;
        if (entry.name?.startsWith('.')) continue;
        
        const entryPath = `${dirPath}/${entry.name}`;
        
        if (entry.isDirectory) {
          await this.searchRecursive(entryPath, query, results, limit);
        } else if (entry.isFile || entry.isDirectory === false) {
          try {
            const stat = await this.tauriFs.stat(entryPath, { baseDir: this.baseDir });
            if (stat.size > 1024 * 1024) continue;
            
            const fileName = entry.name!.toLowerCase();
            const shouldSearchContent = this.shouldSearchContent(entry.name!);
            
            if (fileName.includes(query)) {
              results.push({
                path: this.normalizePath(entryPath),
                name: entry.name!,
                language: this.getLanguage(entry.name!),
                score: 80,
                snippet: `File: ${entry.name}`,
                lastModified: new Date(stat.mtime).toISOString()
              });
            } else if (shouldSearchContent) {
              try {
                const content = await this.tauriFs.readTextFile(entryPath, { baseDir: this.baseDir });
                const idx = content.toLowerCase().indexOf(query);
                
                if (idx !== -1) {
                  const start = Math.max(0, idx - 60);
                  results.push({
                    path: this.normalizePath(entryPath),
                    name: entry.name!,
                    language: this.getLanguage(entry.name!),
                    score: 20,
                    snippet: content.slice(start, idx + query.length + 60) + (idx + query.length + 60 < content.length ? '...' : ''),
                    lastModified: new Date(stat.mtime).toISOString()
                  });
                }
              } catch {
                // Skip files that can't be read
              }
            }
          } catch {
            // Skip entries that can't be accessed
          }
        }
      }
    } catch {
      // Directory may not exist or be accessible - ignore
    }
  }
  
  private shouldSearchContent(fileName: string): boolean {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs'].includes(ext);
  }
  
  async getStats(): Promise<FSStats> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    let totalSize = 0;
    let fileCount = 0;
    let largestFile: { path: string; size: number; sizeFormatted: string } | undefined;
    
    const rootPath = this.boundaryPath || this.workspaceRoot;
    await this.walkDirectoryForStats(rootPath, async (filePath, size) => {
      fileCount++;
      totalSize += size;
      if (!largestFile || size > largestFile.size) {
        largestFile = { 
          path: this.normalizePath(filePath), 
          size, 
          sizeFormatted: this.formatSize(size) 
        };
      }
    });
    
    return { 
      totalSize, 
      totalSizeFormatted: this.formatSize(totalSize), 
      fileCount, 
      largestFile,
      quotaUsage: { sizePercent: 0, fileCountPercent: 0 }
    };
  }
  
  private async walkDirectoryForStats(dirPath: string, callback: (path: string, size: number) => Promise<void>): Promise<void> {
    if (!this.tauriFs) return;
    
    try {
      const entries = await this.tauriFs.readDir(dirPath, { baseDir: this.baseDir });
      
      for (const entry of entries) {
        if (entry.name?.startsWith('.')) continue;
        
        const entryPath = `${dirPath}/${entry.name}`;
        
        if (entry.isDirectory) {
          await this.walkDirectoryForStats(entryPath, callback);
        } else {
          try {
            const stat = await this.tauriFs.stat(entryPath, { baseDir: this.baseDir });
            if (stat.isFile) {
              await callback(entryPath, stat.size);
            }
          } catch {
            // Skip files that can't be accessed
          }
        }
      }
    } catch {
      // Directory may not exist - ignore
    }
  }
  
  async exists(path: string): Promise<boolean> {
    if (!this.tauriFs) return false;
    try {
      return await this.tauriFs.exists(this.resolvePath(path), { baseDir: this.baseDir });
    } catch {
      return false;
    }
  }
  
  async createDirectory(path: string): Promise<{ path: string; createdAt: string }> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const fullPath = this.resolvePath(path);
    await this.ensureDirectory(fullPath);
    this.version++;
    
    return { path: this.normalizePath(fullPath), createdAt: new Date().toISOString() };
  }
  
  async getVersion(): Promise<number> {
    return this.version;
  }
  
  async exportWorkspace(): Promise<{ root: string; version: number; files: FSFile[] }> {
    if (!this.tauriFs) throw new Error('Tauri FS not initialized');
    
    const files: FSFile[] = [];
    const rootPath = this.boundaryPath || this.workspaceRoot;
    
    await this.walkDirectoryForStats(rootPath, async (filePath, size) => {
      try {
        const content = await this.tauriFs!.readTextFile(filePath, { baseDir: this.baseDir });
        const stat = await this.tauriFs!.stat(filePath, { baseDir: this.baseDir });
        
        files.push({
          path: this.normalizePath(filePath),
          content,
          language: this.getLanguage(filePath),
          lastModified: new Date(stat.mtime).toISOString(),
          createdAt: new Date(stat.mtime).toISOString(),
          size
        });
      } catch {
        // Skip files that can't be read
      }
    });
    
    return { root: this.workspaceRoot, version: this.version, files };
  }
  
  async destroy(): Promise<void> {
    await this.stopWatching();
    this.workspaceRoot = '';
    this.boundaryPath = null;
    this.version = 0;
    this.tauriFs = null;
    this.tauriWatch = null;
  }
  
  isWatchingEnabled(): boolean {
    return this.isWatching;
  }
  
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
  
  getBoundaryPath(): string | null {
    return this.boundaryPath;
  }
  
  private getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const m: Record<string, string> = { 
      ts: 'typescript', 
      tsx: 'tsx', 
      js: 'javascript', 
      jsx: 'jsx', 
      py: 'python', 
      go: 'go', 
      rs: 'rust', 
      json: 'json', 
      md: 'markdown', 
      html: 'html', 
      css: 'css' 
    };
    return m[ext] || 'text';
  }
  
  private formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// ============================================================================
// Virtual Filesystem Adapter (Web Mode)
// ============================================================================

export class VirtualFileSystem implements IFileSystem {
  readonly id: string;
  readonly name = 'virtual';
  readonly isDesktop = false;
  private vfs: any = null;
  private ownerId: string = '';
  private initialized = false;
  private isWatching: boolean = false;
  private watcherCallbacks: Set<FileWatcherCallback> = new Set();
  
  constructor() { this.id = `virtual-${randomUUID().slice(0, 8)}`; }
  
  async initialize(config: WorkspaceConfig): Promise<void> {
    try { const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service'); this.vfs = virtualFilesystem; this.ownerId = config.userId; this.initialized = true; } catch { throw new Error('Virtual filesystem not available'); }
  }
  async readFile(path: string): Promise<FSFile> { if (!this.initialized) throw new Error('Not initialized'); const f = await this.vfs.readFile(this.ownerId, path); return { path: f.path, content: f.content, language: f.language, lastModified: f.lastModified, createdAt: f.createdAt, size: f.size }; }
  async writeFile(path: string, content: string, language?: string): Promise<FSFile> { if (!this.initialized) throw new Error('Not initialized'); const f = await this.vfs.writeFile(this.ownerId, path, content, language); return { path: f.path, content: f.content, language: f.language, lastModified: f.lastModified, createdAt: f.createdAt, size: f.size }; }
  async deletePath(path: string): Promise<{ deletedCount: number }> { if (!this.initialized) throw new Error('Not initialized'); return this.vfs.deletePath(this.ownerId, path); }
  async listDirectory(path?: string): Promise<FSDirectoryListing> { if (!this.initialized) throw new Error('Not initialized'); const l = await this.vfs.listDirectory(this.ownerId, path); return { path: l.path, nodes: l.nodes.map((n: any) => ({ name: n.name, path: n.path, type: n.type, size: n.size })) }; }
  async search(query: string, options?: { path?: string; limit?: number }): Promise<FSSearchResult[]> { if (!this.initialized) throw new Error('Not initialized'); const r = await this.vfs.search(this.ownerId, query, options); return Array.isArray(r) ? r : r.files; }
  async getStats(): Promise<FSStats> { if (!this.initialized) throw new Error('Not initialized'); return this.vfs.getWorkspaceStats(this.ownerId); }
  async exists(path: string): Promise<boolean> { if (!this.initialized) return false; try { await this.vfs.readFile(this.ownerId, path); return true; } catch { return false; } }
  async createDirectory(path: string): Promise<{ path: string; createdAt: string }> { if (!this.initialized) throw new Error('Not initialized'); return this.vfs.createDirectory(this.ownerId, path); }
  async getVersion(): Promise<number> { if (!this.initialized) return 0; return this.vfs.getWorkspaceVersion(this.ownerId); }
  async exportWorkspace(): Promise<{ root: string; version: number; files: FSFile[] }> { if (!this.initialized) throw new Error('Not initialized'); const s = await this.vfs.exportWorkspace(this.ownerId); return { root: s.root, version: s.version, files: s.files }; }
  async destroy(): Promise<void> {
    await this.stopWatching();
    this.initialized = false;
  }
  
  async startWatching(callback?: FileWatcherCallback): Promise<void> {
    // Virtual filesystem doesn't support native watching
    // Events are handled through VFS service internally
    if (callback) {
      this.watcherCallbacks.add(callback);
    }
    this.isWatching = true;
  }
  
  async stopWatching(): Promise<void> {
    this.watcherCallbacks.clear();
    this.isWatching = false;
  }
  
  addWatchListener(callback: FileWatcherCallback): void {
    this.watcherCallbacks.add(callback);
  }
  
  removeWatchListener(callback: FileWatcherCallback): void {
    this.watcherCallbacks.delete(callback);
  }
  
  isWatchingEnabled(): boolean {
    return this.isWatching;
  }
}

// ============================================================================
// Factory & Utilities
// ============================================================================

export function createFileSystem(): IFileSystem { return isDesktopMode() ? new DesktopFileSystem() : new VirtualFileSystem(); }
export function getFileSystemPlatform(): 'desktop' | 'web' { return getPlatform(); }
export function isLocalFSAvailable(): boolean { return isDesktopMode() || isTauriRuntime(); }
export type { WorkspaceConfig as FSWorkspaceConfig };