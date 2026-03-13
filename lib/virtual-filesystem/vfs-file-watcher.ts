/**
 * Virtual Filesystem File Watcher
 * 
 * Watches for file changes in the virtual filesystem.
 * Provides real-time notifications for file modifications.
 * 
 * @see {@link ../virtual-filesystem-service} Base VFS service
 */

import { EventEmitter } from 'events';
import type { VirtualFile } from './filesystem-types';
import { virtualFilesystem } from './virtual-filesystem-service';
import { generateSecureId } from '@/lib/utils';

/**
 * File event types
 */
export type FileEventType = 'create' | 'update' | 'delete';

/**
 * File event
 */
export interface FileEvent {
  /**
   * Event type
   */
  type: FileEventType;
  
  /**
   * File path
   */
  path: string;
  
  /**
   * File content (for create/update events)
   */
  content?: string;
  
  /**
   * Previous content (for update/delete events)
   */
  previousContent?: string;
  
  /**
   * Event timestamp
   */
  timestamp: number;
}

/**
 * Watch configuration
 */
export interface WatchConfig {
  /**
   * Patterns to include
   */
  include?: string[];
  
  /**
   * Patterns to exclude
   */
  exclude?: string[];
  
  /**
   * Whether to watch recursively
   * @default true
   */
  recursive?: boolean;
  
  /**
   * Debounce interval in ms
   * @default 100
   */
  debounceMs?: number;
}

/**
 * File watcher handle
 */
export interface FileWatcherHandle {
  /**
   * Close the watcher
   */
  close: () => void;
  
  /**
   * Watcher ID
   */
  id: string;
}

/**
 * VFS File Watcher
 * 
 * Watches for file changes and emits events.
 */
export class VFSFileWatcher extends EventEmitter {
  private ownerId: string;
  private config: WatchConfig;
  private fileSnapshots: Map<string, string> = new Map();
  private watchInterval: NodeJS.Timeout | null = null;
  private readonly WATCH_INTERVAL_MS = 500;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private id: string;

  constructor(ownerId: string, config: WatchConfig = {}) {
    super();
    this.ownerId = ownerId;
    this.config = {
      recursive: true,
      debounceMs: 100,
      ...config,
    };
    this.id = generateSecureId('watcher');
  }

  /**
   * Start watching
   */
  start(): FileWatcherHandle {
    // Take initial snapshot
    this.takeSnapshot();

    // Start polling
    this.watchInterval = setInterval(() => {
      this.checkForChanges();
    }, this.WATCH_INTERVAL_MS);

    return {
      close: () => this.stop(),
      id: this.id,
    };
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Take snapshot of current state
   */
  private async takeSnapshot(): Promise<void> {
    try {
      const listing = await virtualFilesystem.listDirectory(this.ownerId);
      const files = listing.nodes.filter(node => node.type === 'file');

      for (const file of files) {
        if (this.shouldWatch(file.path)) {
          try {
            const fileData = await virtualFilesystem.readFile(this.ownerId, file.path);
            this.fileSnapshots.set(file.path, fileData.content);
          } catch {
            // Skip files that can't be read
          }
        }
      }
    } catch (error: any) {
      console.error('[VFSFileWatcher] Failed to take snapshot:', error.message);
    }
  }

  /**
   * Check for changes
   */
  private async checkForChanges(): Promise<void> {
    try {
      const listing = await virtualFilesystem.listDirectory(this.ownerId);
      const files = listing.nodes.filter(node => node.type === 'file');
      const currentPaths = new Set<string>();

      for (const file of files) {
        if (!this.shouldWatch(file.path)) {
          continue;
        }

        currentPaths.add(file.path);

        try {
          const fileData = await virtualFilesystem.readFile(this.ownerId, file.path);
          const previousContent = this.fileSnapshots.get(file.path);
          const currentContent = fileData.content;

          if (previousContent === undefined) {
            // New file
            this.emitFileEvent('create', file.path, currentContent);
          } else if (previousContent !== currentContent) {
            // Modified file
            this.emitFileEvent('update', file.path, currentContent, previousContent);
          }

          this.fileSnapshots.set(file.path, currentContent);
        } catch (error: any) {
          // File may have been deleted
        }
      }

      // Check for deleted files
      for (const [path] of this.fileSnapshots.entries()) {
        if (!currentPaths.has(path)) {
          const previousContent = this.fileSnapshots.get(path);
          this.emitFileEvent('delete', path, undefined, previousContent);
          this.fileSnapshots.delete(path);
        }
      }
    } catch (error: any) {
      console.error('[VFSFileWatcher] Failed to check for changes:', error.message);
    }
  }

  /**
   * Emit file event with debouncing
   */
  private emitFileEvent(
    type: FileEventType,
    path: string,
    content?: string,
    previousContent?: string
  ): void {
    const debounceMs = this.config.debounceMs || 100;

    // Clear existing timer
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      const event: FileEvent = {
        type,
        path,
        content,
        previousContent,
        timestamp: Date.now(),
      };

      this.emit('change', event);
      this.emit(type, event);
      this.debounceTimers.delete(path);
    }, debounceMs);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Check if path should be watched
   */
  private shouldWatch(path: string): boolean {
    if (this.config.include) {
      if (!this.matchesPatterns(path, this.config.include)) {
        return false;
      }
    }

    if (this.config.exclude) {
      if (this.matchesPatterns(path, this.config.exclude)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if path matches any pattern
   */
  private matchesPatterns(path: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    });
  }

  /**
   * Get watcher ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get watched file count
   */
  getWatchedFileCount(): number {
    return this.fileSnapshots.size;
  }
}

/**
 * Create file watcher for owner
 * 
 * @param ownerId - Owner ID
 * @param config - Watch configuration
 * @returns File watcher
 */
export function createFileWatcher(ownerId: string, config?: WatchConfig): VFSFileWatcher {
  return new VFSFileWatcher(ownerId, config);
}

/**
 * Watch files with callback
 * 
 * @param ownerId - Owner ID
 * @param callback - Change callback
 * @param config - Watch configuration
 * @returns Watcher handle
 */
export function watchFiles(
  ownerId: string,
  callback: (event: FileEvent) => void,
  config?: WatchConfig
): FileWatcherHandle {
  const watcher = createFileWatcher(ownerId, config);
  watcher.on('change', callback);
  return watcher.start();
}
