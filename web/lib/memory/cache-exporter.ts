/**
 * cache-exporter.ts — Cache Export/Persistence Layer
 * 
 * Provides semi-persistent export of in-memory caches that are expiring past TTL.
 * This is an ADDITIVE layer to existing cache and Mem0 implementations.
 * 
 * Features:
 * - Export in-memory caches before TTL expiration for persistence
 * - Restore caches from disk on startup
 * - Support for multiple cache types: response, auth, tab memories, powers, tasks, plans
 * - Works with both browser (localStorage) and CLI (file system) backends
 * - Configurable TTL thresholds for export timing
 * - Merge strategy for restoring (keep newer, preserve hot entries)
 * 
 * Architecture:
 * - CacheExportManager: Main orchestrator for all cache exports
 * - CacheExportAdapter: Generic interface for different cache types
 * - FileSystemExportBackend: Node.js file export (stores in ~/.quaz/cache-exports/)
 * - LocalStorageExportBackend: Browser localStorage export
 * 
 * This enables:
 * - Data that may be important or reused survives TTL expiration
 * - Skills/powers cache preservation between sessions
 * - Plans/steps persistence for mid-range memory
 * - Tab memories survival across browser refreshes
 */

import { createLogger } from '@/lib/utils/logger';
import type { Task } from './task-persistence';

const log = createLogger('CacheExporter');

// ============================================================================
// Types
// ============================================================================

/**
 * Cache export entry with metadata for restoration
 */
export interface CacheExportEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  /** Whether this entry was explicitly marked as important */
  important?: boolean;
  /** Optional metadata for display purposes */
  metadata?: Record<string, unknown>;
}

/**
 * Export metadata for a cache type
 */
export interface CacheExportMetadata {
  cacheType: string;
  exportedAt: number;
  entryCount: number;
  totalSize: number;
  version: string;
}

/**
 * Export options for fine-tuning behavior
 */
export interface ExportOptions {
  /** Minimum access count to consider for export */
  minAccessCount?: number;
  /** Maximum age in ms before forcing export */
  maxAgeBeforeExport?: number;
  /** Custom TTL overrides per cache type */
  ttlOverrides?: Record<string, number>;
  /** Include entries marked as important */
  includeImportant?: boolean;
  /** Merge strategy for restoration */
  mergeStrategy?: 'keep-newer' | 'keep-older' | 'keep-hotter' | 'replace';
}

/**
 * Cache type identifiers
 */
export type CacheType = 
  | 'response' 
  | 'auth' 
  | 'tab-memory' 
  | 'powers-registry'
  | 'tasks'
  | 'plans'
  | 'custom';

/**
 * Interface for cache adapters that can export/restore cache entries
 */
export interface CacheAdapter<T = unknown> {
  /** Unique identifier for this cache type */
  type: CacheType;
  
  /** Human-readable name */
  name: string;
  
  /** Get all current entries from the cache */
  getEntries(): CacheExportEntry<T>[] | Promise<CacheExportEntry<T>[]>;
  
  /** Set a single entry in the cache (for restoration) */
  setEntry(key: string, entry: CacheExportEntry<T>): void | Promise<void>;
  
  /** Delete an entry from the cache */
  deleteEntry(key: string): void | Promise<void>;
  
  /** Clear all entries in the cache */
  clear(): void;
  
  /** Get statistics about the cache */
  getStats(): {
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    hotEntries: number;
  } | Promise<{
    size: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    hotEntries: number;
  }>;
}

// ============================================================================
// Storage Backends
// ============================================================================

/**
 * Storage backend interface for cache exports
 */
interface StorageBackend {
  /** Check if backend is available */
  isAvailable(): boolean;
  
  /** Save export data */
  save(key: string, data: CacheExportMetadata & { entries: CacheExportEntry[] }): void | Promise<void>;
  
  /** Load export data */
  load(key: string): (CacheExportMetadata & { entries: CacheExportEntry[] }) | null | Promise<(CacheExportMetadata & { entries: CacheExportEntry[] }) | null>;
  
  /** Delete export data */
  delete(key: string): void | Promise<void>;
  
  /** List all available exports */
  list(): string[] | Promise<string[]>;
  
  /** Get storage path for display/debugging */
  getStoragePath(): string;
}

// FileSystem backend for Node.js/CLI
class FileSystemExportBackend implements StorageBackend {
  private basePath: string;
  private fs: typeof import('fs') | null = null;
  private path: typeof import('path') | null = null;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const configDir = process.env.QUAZ_CONFIG_DIR || `${homeDir}/.quaz`;
    this.basePath = `${configDir}/cache-exports`;
  }

  private ensureFs(): void {
    if (!this.fs) {
      this.fs = require('fs');
      this.path = require('path');
      // Ensure directory exists - use sync version
      try {
        this.fs.mkdirSync(this.basePath, { recursive: true });
      } catch {
        // Directory may already exist
      }
    }
  }

  isAvailable(): boolean {
    return typeof process !== 'undefined' && process.versions?.node != null;
  }

  async save(key: string, data: CacheExportMetadata & { entries: CacheExportEntry[] }): Promise<void> {
    await this.ensureFs();
    if (!this.fs || !this.path) return;

    const filePath = this.path.join(this.basePath, `${key}.json`);
    await this.fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.debug(`Cache export saved: ${key}`, { entryCount: data.entryCount, size: data.totalSize });
  }

  async load(key: string): Promise<(CacheExportMetadata & { entries: CacheExportEntry[] }) | null> {
    await this.ensureFs();
    if (!this.fs || !this.path) return null;

    try {
      const filePath = this.path.join(this.basePath, `${key}.json`);
      const content = await this.fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureFs();
    if (!this.fs || !this.path) return;

    try {
      const filePath = this.path.join(this.basePath, `${key}.json`);
      await this.fs.promises.unlink(filePath);
    } catch {
      // File may not exist
    }
  }

  async list(): Promise<string[]> {
    await this.ensureFs();
    if (!this.fs || !this.path) return [];

    try {
      const files = await this.fs.promises.readdir(this.basePath);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  getStoragePath(): string {
    return this.basePath;
  }
}

// LocalStorage backend for browser
class LocalStorageExportBackend implements StorageBackend {
  private readonly prefix = 'quaz_cache_export_';

  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  async save(key: string, data: CacheExportMetadata & { entries: CacheExportEntry[] }): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(data));
      log.debug(`Cache export saved to localStorage: ${key}`);
    } catch (error: any) {
      log.warn(`Failed to save cache export to localStorage: ${error.message}`);
    }
  }

  async load(key: string): Promise<(CacheExportMetadata & { entries: CacheExportEntry[] }) | null> {
    if (!this.isAvailable()) return null;

    try {
      const content = localStorage.getItem(this.prefix + key);
      return content ? JSON.parse(content) : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isAvailable()) return;
    localStorage.removeItem(this.prefix + key);
  }

  async list(): Promise<string[]> {
    if (!this.isAvailable()) return [];

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        keys.push(key.replace(this.prefix, ''));
      }
    }
    return keys;
  }

  getStoragePath(): string {
    return `localStorage['${this.prefix}*']`;
  }
}

// ============================================================================
// Cache Adapters
// ============================================================================

// Response Cache Adapter (web/lib/cache.ts)
interface ResponseCacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

interface ResponseCache {
  cache: Map<string, ResponseCacheEntry>;
}

const responseCacheAdapter: CacheAdapter = {
  type: 'response',
  name: 'Response Cache',
  getEntries(): CacheExportEntry[] {
    try {
      // Access the exported singleton from cache.ts
      const { responseCache } = require('../cache');
      const cache = (responseCache as ResponseCache).cache;
      const now = Date.now();
      
      return Array.from(cache.entries()).map(([key, entry]) => ({
        key,
        value: entry.data,
        createdAt: entry.timestamp,
        lastAccessedAt: entry.timestamp,
        accessCount: 1,
        metadata: { ttl: entry.ttl, age: now - entry.timestamp },
      }));
    } catch {
      return [];
    }
  },
  setEntry(key: string, entry: CacheExportEntry): void {
    try {
      const { responseCache } = require('../cache');
      responseCache.set(key, entry.value, (entry.metadata as any)?.ttl ?? 5 * 60 * 1000);
    } catch {
      // Cache not available
    }
  },
  deleteEntry(key: string): void {
    try {
      const { responseCache } = require('../cache');
      responseCache.delete(key);
    } catch {
      // Cache not available
    }
  },
  clear(): void {
    try {
      const { responseCache } = require('../cache');
      responseCache.clear();
    } catch {
      // Cache not available
    }
  },
  getStats() {
    try {
      const { responseCache } = require('../cache');
      const stats = responseCache.getStats();
      return { ...stats, oldestEntry: null, newestEntry: null, hotEntries: 0 };
    } catch {
      return { size: 0, oldestEntry: null, newestEntry: null, hotEntries: 0 };
    }
  },
};

// Auth Cache Adapter (web/lib/auth/auth-cache.ts)
interface AuthCacheEntry {
  result: { success: boolean; userId?: string; source?: string };
  expires: number;
}

interface AuthCache {
  cache: Map<string, AuthCacheEntry>;
}

const authCacheAdapter: CacheAdapter = {
  type: 'auth',
  name: 'Auth Cache',
  getEntries(): CacheExportEntry[] {
    try {
      const { authCache } = require('../auth/auth-cache');
      const cache = (authCache as AuthCache).cache;
      
      return Array.from(cache.entries()).map(([key, entry]) => ({
        key,
        value: entry.result,
        createdAt: entry.expires - 5 * 60 * 1000, // Approximate created time
        lastAccessedAt: entry.expires,
        accessCount: 1,
        metadata: { expiresAt: entry.expires },
      }));
    } catch {
      return [];
    }
  },
  setEntry(key: string, entry: CacheExportEntry): void {
    try {
      const { authCache } = require('../auth/auth-cache');
      const metadata = entry.metadata as any;
      authCache.set(key, entry.value as any, {
        sessionExpiresAt: metadata?.sessionExpiresAt,
        jti: metadata?.jti,
        jwtExpiresAt: metadata?.jwtExpiresAt,
      });
    } catch {
      // Cache not available
    }
  },
  deleteEntry(key: string): void {
    try {
      const { authCache } = require('../auth/auth-cache');
      authCache.delete(key);
    } catch {
      // Cache not available
    }
  },
  clear(): void {
    try {
      const { authCache } = require('../auth/auth-cache');
      authCache.clear();
    } catch {
      // Cache not available
    }
  },
  getStats() {
    try {
      const { authCache } = require('../auth/auth-cache');
      return authCache.getStats();
    } catch {
      return { size: 0, oldestEntry: null, newestEntry: null, hotEntries: 0 };
    }
  },
};

// Tab Memory Adapter (web/lib/retrieval/search.ts)
interface TabMemoryEntry {
  tabId: string;
  projectId: string;
  openFiles: Set<string>;
  recentSymbols: string[];
  lastQueries: string[];
}

const tabMemoryAdapter: CacheAdapter<TabMemoryEntry> = {
  type: 'tab-memory',
  name: 'Tab Memory',
  getEntries(): CacheExportEntry<TabMemoryEntry>[] {
    try {
      const { getAllTabMemories } = require('../retrieval/search');
      const memories = getAllTabMemories();
      
      return memories.map((mem: TabMemoryEntry) => ({
        key: mem.tabId,
        value: mem,
        createdAt: Date.now(), // Tab memories don't track creation time
        lastAccessedAt: mem.lastQueries.length > 0 ? Date.now() : Date.now() - 60000,
        accessCount: mem.lastQueries.length + 1,
        important: mem.recentSymbols.length > 0 || mem.lastQueries.length > 0,
        metadata: {
          projectId: mem.projectId,
          symbolCount: mem.recentSymbols.length,
          queryCount: mem.lastQueries.length,
          fileCount: mem.openFiles.size,
        },
      }));
    } catch (error: any) {
      log.warn(`Tab memory export failed: ${error.message}`);
      return [];
    }
  },
  setEntry(key: string, entry: CacheExportEntry<TabMemoryEntry>): void {
    try {
      const { setTabMemory } = require('../retrieval/search');
      // Convert Set to proper format for search.ts
      setTabMemory(entry.key, {
        tabId: entry.key,
        projectId: entry.value.projectId,
        openFiles: new Set(entry.value.openFiles),
        recentSymbols: entry.value.recentSymbols,
        lastQueries: entry.value.lastQueries,
      });
      log.debug(`Tab memory restored: ${entry.key}`);
    } catch (error: any) {
      log.warn(`Tab memory restoration failed: ${error.message}`);
    }
  },
  deleteEntry(key: string): void {
    try {
      const { deleteTabMemory } = require('../retrieval/search');
      deleteTabMemory(key);
    } catch {
      // Tab memory may not exist
    }
  },
  clear(): void {
    try {
      const { clearAllTabMemories } = require('../retrieval/search');
      clearAllTabMemories();
      log.info('All tab memories cleared via cache export');
    } catch {
      // Tab memory module may not be available
    }
  },
  getStats() {
    try {
      const { getTabMemoryStats } = require('../retrieval/search');
      const stats = getTabMemoryStats();
      return {
        size: stats.count,
        oldestEntry: stats.oldestEntry || null,
        newestEntry: stats.newestEntry || null,
        hotEntries: stats.count, // All are "hot" if they have recent activity
      };
    } catch {
      return { size: 0, oldestEntry: null, newestEntry: null, hotEntries: 0 };
    }
  },
};

// Task Persistence Adapter (web/lib/memory/task-persistence.ts)
const taskAdapter: CacheAdapter<Task> = {
  type: 'tasks',
  name: 'Task Persistence',
   getEntries(): CacheExportEntry<Task>[] {
     try {
       const { getTaskStore } = require('./task-persistence');
       const store = getTaskStore();
       const tasks = store.getAll();
       
       return tasks.map(task => ({
         key: task.id,
         value: task,
         createdAt: task.createdAt,
         lastAccessedAt: task.lastAccessedAt ?? task.updatedAt,
         accessCount: task.progress > 0 ? Math.ceil(task.progress / 10) : 1,
         important: task.retention !== 'scratch' || task.status === 'in_progress',
         metadata: {
           retention: task.retention,
           status: task.status,
           priority: task.priority,
           tags: task.tags,
           progress: task.progress,
           stepCount: task.steps?.length ?? 0,
         },
       }));
     } catch {
       return [];
     }
   },
   async setEntry(key: string, entry: CacheExportEntry<Task>): Promise<void> {
     try {
       const { getTaskStore } = require('./task-persistence');
       const store = getTaskStore();
       await store.restoreTask(entry.value);
     } catch (error: any) {
       log.warn(`Failed to restore task ${key}: ${error.message}`);
     }
   },
   async deleteEntry(key: string): Promise<void> {
     try {
       const { getTaskStore } = require('./task-persistence');
       const store = getTaskStore();
       await store.delete(key);
     } catch {
       // Task may not exist
     }
   },
   clear(): void {
     // Dangerous - don't clear all tasks
     log.warn('Clearing all tasks via cache export is not allowed');
   },
  getStats() {
    try {
      const { getTaskStore } = require('./task-persistence');
      const store = getTaskStore();
      const stats = store.getStats();
      return {
        size: stats.totalTasks,
        oldestEntry: null,
        newestEntry: null,
        hotEntries: stats.byStatus['in_progress'] ?? 0,
      };
    } catch {
      return { size: 0, oldestEntry: null, newestEntry: null, hotEntries: 0 };
    }
  },
};

// Powers Registry Adapter (web/lib/powers/index.ts)
const powersAdapter: CacheAdapter = {
  type: 'powers-registry',
  name: 'Powers Registry',
   getEntries(): CacheExportEntry[] {
     try {
       const { powersRegistry } = require('../powers');
       const powers = powersRegistry.getActive();
       
       return powers.map(power => ({
         key: power.id,
         value: {
           id: power.id,
           name: power.name,
           version: power.version,
           description: power.description,
           actions: power.actions.length,
           enabled: power.enabled,
           source: power.source,
         },
         createdAt: power.installedAt ?? Date.now(),
         lastAccessedAt: Date.now(),
         accessCount: 1,
         important: power.source === 'core',
         metadata: {
           source: power.source,
           actionCount: power.actions.length,
           triggers: power.triggers,
         },
       }));
     } catch {
       return [];
     }
   },
  setEntry(): void {
    // Powers are registered, not set - skip
    log.debug('Powers adapter: skipping setEntry (use register instead)');
  },
  deleteEntry(key: string): void {
    try {
      const { powersRegistry } = require('../powers');
      powersRegistry.remove(key);
    } catch {
      // Power may not exist
    }
  },
  clear(): void {
    log.warn('Clearing all powers via cache export is not allowed');
  },
  getStats() {
    try {
      const { powersRegistry } = require('../powers');
      return powersRegistry.getStats();
    } catch {
      return { total: 0, enabled: 0, bySource: {}, tags: 0, actions: 0 } as any;
    }
  },
};

// ============================================================================
// Cache Export Manager
// ============================================================================

const EXPORT_VERSION = '1.0.0';
const DEFAULT_MAX_AGE_BEFORE_EXPORT = 15 * 60 * 1000; // 15 minutes before TTL
const DEFAULT_MIN_ACCESS_COUNT = 1;

/**
 * Main orchestrator for cache export/persistence
 */
export class CacheExportManager {
  private adapters: Map<CacheType, CacheAdapter> = new Map();
  private backend: StorageBackend;
  private exportTimers: Map<CacheType, NodeJS.Timeout> = new Map();
  private autoExportInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor() {
    // Select appropriate backend
    if (typeof window !== 'undefined') {
      this.backend = new LocalStorageExportBackend();
    } else {
      this.backend = new FileSystemExportBackend();
    }

    // Register default adapters
    this.registerAdapter(responseCacheAdapter);
    this.registerAdapter(authCacheAdapter);
    this.registerAdapter(tabMemoryAdapter);
    this.registerAdapter(taskAdapter);
    this.registerAdapter(powersAdapter);
  }

  /**
   * Register a custom cache adapter
   */
  registerAdapter(adapter: CacheAdapter): void {
    this.adapters.set(adapter.type, adapter);
    log.info(`Cache adapter registered: ${adapter.name} (${adapter.type})`);
  }

  /**
   * Initialize the export manager - restore caches from disk
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.backend.isAvailable()) {
      log.warn('Cache export backend not available, exports will be disabled');
      return;
    }

    // Restore each cache type
    const cacheTypes = await this.backend.list();
    
    for (const cacheType of cacheTypes) {
      await this.restore(cacheType as CacheType);
    }

    this.isInitialized = true;
    log.info('Cache export manager initialized', {
      backend: this.backend.getStoragePath(),
      restoredCaches: cacheTypes.length,
    });
  }

  /**
   * Export a specific cache type to persistent storage
   */
   async export(cacheType: CacheType, options?: ExportOptions): Promise<CacheExportMetadata | null> {
     const adapter = this.adapters.get(cacheType);
     if (!adapter) {
       log.warn(`No adapter registered for cache type: ${cacheType}`);
       return null;
     }

     try {
       const entriesResult = adapter.getEntries();
       // Handle both sync and async getEntries
       const entries = entriesResult instanceof Promise ? await entriesResult : entriesResult;
      const now = Date.now();

      // Filter entries based on options
      const filteredEntries = entries.filter(entry => {
        // Skip if too new (no need to export fresh entries)
        const age = now - entry.createdAt;
        const maxAge = options?.maxAgeBeforeExport ?? DEFAULT_MAX_AGE_BEFORE_EXPORT;
        if (age < maxAge && !options?.includeImportant) return false;

        // Skip if access count too low
        const minAccess = options?.minAccessCount ?? DEFAULT_MIN_ACCESS_COUNT;
        if (entry.accessCount < minAccess && !entry.important) return false;

        return true;
      });

      if (filteredEntries.length === 0) {
        log.debug(`No entries to export for cache type: ${cacheType}`);
        return null;
      }

      const metadata: CacheExportMetadata = {
        cacheType,
        exportedAt: now,
        entryCount: filteredEntries.length,
        totalSize: JSON.stringify(filteredEntries).length,
        version: EXPORT_VERSION,
      };

      await this.backend.save(cacheType, { ...metadata, entries: filteredEntries });

      log.info(`Cache exported: ${cacheType}`, {
        entryCount: filteredEntries.length,
        totalSize: metadata.totalSize,
      });

      return metadata;
    } catch (error: any) {
      log.error(`Failed to export cache ${cacheType}: ${error.message}`);
      return null;
    }
  }

  /**
   * Restore a cache type from persistent storage
   */
  async restore(cacheType: CacheType, options?: ExportOptions): Promise<number> {
    const adapter = this.adapters.get(cacheType);
    if (!adapter) {
      log.warn(`No adapter registered for cache type: ${cacheType}`);
      return 0;
    }

    try {
      const data = await this.backend.load(cacheType);
      if (!data || !data.entries) {
        return 0;
      }

      const mergeStrategy = options?.mergeStrategy ?? 'keep-newer';
      let restored = 0;

       for (const entry of data.entries) {
         // Apply merge strategy
         if (mergeStrategy === 'keep-newer') {
           // Only restore if the cached entry is newer than any existing
           const existingEntriesResult = adapter.getEntries();
           const existingEntries = existingEntriesResult instanceof Promise ? await existingEntriesResult : existingEntriesResult;
           const existing = existingEntries.find(e => e.key === entry.key);
           if (existing && existing.lastAccessedAt > entry.lastAccessedAt) {
             continue; // Skip, existing is newer
           }
         }

         // Set the entry (may be merged or replaced based on adapter)
         adapter.setEntry(entry.key, entry);
         restored++;
       }

      log.info(`Cache restored: ${cacheType}`, {
        entryCount: data.entries.length,
        restored,
        strategy: mergeStrategy,
      });

      return restored;
    } catch (error: any) {
      log.error(`Failed to restore cache ${cacheType}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Export all registered cache types
   */
   async exportAll(options?: ExportOptions): Promise<Record<CacheType, CacheExportMetadata | null>> {
     const results: Record<string, CacheExportMetadata | null> = {};

     for (const [cacheType] of this.adapters) {
       results[cacheType] = await this.export(cacheType as CacheType, options);
     }

     return results as Record<CacheType, CacheExportMetadata | null>;
   }

  /**
   * Restore all cached exports
   */
  async restoreAll(options?: ExportOptions): Promise<Record<CacheType, number>> {
    const results: Record<string, number> = {};

    for (const [cacheType] of this.adapters) {
      results[cacheType] = await this.restore(cacheType as CacheType, options);
    }

    return results as Record<CacheType, number>;
  }

  /**
   * Start automatic export interval for a cache type
   */
  startAutoExport(
    cacheType: CacheType,
    intervalMs: number = 5 * 60 * 1000,
    options?: ExportOptions
  ): void {
    // Clear existing timer if any
    this.stopAutoExport(cacheType);

    const timer = setInterval(async () => {
      await this.export(cacheType, options);
    }, intervalMs);

    this.exportTimers.set(cacheType, timer);
    log.info(`Auto-export started for ${cacheType}`, { intervalMs });
  }

  /**
   * Stop automatic export for a cache type
   */
  stopAutoExport(cacheType: CacheType): void {
    const timer = this.exportTimers.get(cacheType);
    if (timer) {
      clearInterval(timer);
      this.exportTimers.delete(cacheType);
      log.info(`Auto-export stopped for ${cacheType}`);
    }
  }

  /**
   * Start automatic export for all cache types
   */
  startAutoExportAll(
    intervalMs: number = 5 * 60 * 1000,
    options?: ExportOptions
  ): void {
    // Clear existing interval
    if (this.autoExportInterval) {
      clearInterval(this.autoExportInterval);
    }

    this.autoExportInterval = setInterval(async () => {
      await this.exportAll(options);
    }, intervalMs);

    log.info('Auto-export started for all cache types', { intervalMs });
  }

  /**
   * Stop all automatic exports
   */
  stopAutoExportAll(): void {
    if (this.autoExportInterval) {
      clearInterval(this.autoExportInterval);
      this.autoExportInterval = undefined;
    }

    for (const [cacheType] of this.exportTimers) {
      this.stopAutoExport(cacheType);
    }

    log.info('All auto-exports stopped');
  }

  /**
   * Get statistics for all cache types
   */
  getAllStats(): Record<CacheType, ReturnType<CacheAdapter['getStats']>> {
    const stats: Record<string, unknown> = {};

    for (const [cacheType, adapter] of this.adapters) {
      stats[cacheType] = adapter.getStats();
    }

    return stats as Record<CacheType, ReturnType<CacheAdapter['getStats']>>;
  }

  /**
   * Delete an export for a cache type
   */
  async deleteExport(cacheType: CacheType): Promise<void> {
    await this.backend.delete(cacheType);
    log.info(`Export deleted for cache type: ${cacheType}`);
  }

  /**
   * List all available exports
   */
  async listExports(): Promise<string[]> {
    return this.backend.list();
  }

  /**
   * Get the storage backend path
   */
  getStoragePath(): string {
    return this.backend.getStoragePath();
  }

  /**
   * Shutdown the export manager
   */
  async shutdown(): Promise<void> {
    // Final export before shutdown
    await this.exportAll();

    // Stop all timers
    this.stopAutoExportAll();

    this.isInitialized = false;
    log.info('Cache export manager shut down');
  }
}

// Singleton instance
let cacheExportManager: CacheExportManager | null = null;

export function getCacheExportManager(): CacheExportManager {
  if (!cacheExportManager) {
    cacheExportManager = new CacheExportManager();
  }
  return cacheExportManager;
}

export function resetCacheExportManager(): void {
  if (cacheExportManager) {
    cacheExportManager.shutdown();
  }
  cacheExportManager = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick export of a specific cache type
 */
export async function exportCache(
  cacheType: CacheType,
  options?: ExportOptions
): Promise<CacheExportMetadata | null> {
  return getCacheExportManager().export(cacheType, options);
}

/**
 * Quick restore of a specific cache type
 */
export async function restoreCache(
  cacheType: CacheType,
  options?: ExportOptions
): Promise<number> {
  return getCacheExportManager().restore(cacheType, options);
}

/**
 * Export all caches (good for shutdown hooks)
 */
export async function exportAllCaches(options?: ExportOptions): Promise<void> {
  await getCacheExportManager().exportAll(options);
}

/**
 * Restore all caches (good for startup)
 */
export async function restoreAllCaches(options?: ExportOptions): Promise<Record<CacheType, number>> {
  return getCacheExportManager().restoreAll(options);
}

/**
 * Export tasks specifically (integrates with task-persistence.ts)
 */
export async function exportTasks(options?: ExportOptions): Promise<CacheExportMetadata | null> {
  return getCacheExportManager().export('tasks', options);
}

/**
 * Export powers registry specifically
 */
export async function exportPowers(options?: ExportOptions): CacheExportMetadata | null {
  return getCacheExportManager().export('powers-registry', options);
}

/**
 * Export response cache specifically
 */
export async function exportResponseCache(options?: ExportOptions): CacheExportMetadata | null {
  return getCacheExportManager().export('response', options);
}

// ============================================================================
// Shutdown Hook Integration
// ============================================================================

// Track shutdown handlers for cleanup
const shutdownHandlers: Map<string, () => void> = new Map();
let shutdownHookRegistered = false;

/**
 * Register cache export shutdown hook with process signals.
 * Call this during app initialization to ensure caches are exported on shutdown.
 * Can be called multiple times safely - only registers once.
 * 
 * @param options Export options for the shutdown export
 * @param signals Which signals to listen for (default: SIGTERM, SIGINT, beforeExit)
 */
export function registerShutdownHook(
  options?: ExportOptions,
  signals: (NodeJS.Signals | 'beforeExit')[] = ['SIGTERM', 'SIGINT', 'beforeExit']
): void {
  // Prevent duplicate registration
  if (shutdownHookRegistered) {
    log.debug('Shutdown hook already registered, skipping');
    return;
  }
  
  const manager = getCacheExportManager();
  
  const performShutdown = async () => {
    log.info('Cache export shutdown hook triggered');
    try {
      await manager.exportAll(options);
      log.info('Cache export shutdown completed successfully');
    } catch (error: any) {
      log.error(`Cache export shutdown failed: ${error.message}`);
    }
  };
  
  // Register for each signal and store handlers for cleanup
  for (const signal of signals) {
    process.on(signal, performShutdown);
    shutdownHandlers.set(signal, performShutdown);
    log.debug(`Shutdown hook registered for ${signal}`);
  }
  
  shutdownHookRegistered = true;
  log.info('Cache export shutdown hook registered', { signals });
}

/**
 * Unregister cache export shutdown hooks.
 * Removes all registered signal listeners and stops auto-exports.
 */
export function unregisterShutdownHook(): void {
  const manager = getCacheExportManager();
  
  // Remove signal listeners
  for (const [signal, handler] of shutdownHandlers) {
    process.off(signal, handler);
    log.debug(`Shutdown hook unregistered for ${signal}`);
  }
  
  shutdownHandlers.clear();
  shutdownHookRegistered = false;
  
  // Stop auto-exports
  manager.stopAutoExportAll();
  
  log.info('Cache export shutdown hooks unregistered');
}

/**
 * Perform a manual shutdown export (for testing or manual trigger)
 */
export async function manualShutdownExport(options?: ExportOptions): void {
  const manager = getCacheExportManager();
  await manager.exportAll(options);
  await manager.shutdown();
  log.info('Manual cache export shutdown completed');
}

/**
 * Get the intermittent re-context supplement for unfinished tasks.
 * This can be called periodically to remind agents about pending work.
 */
export function getRecontextSupplement(
  options?: {
    maxAge?: number; // minimum age in ms
    limit?: number;  // max tasks to include
  }
): string {
  try {
    const { getTaskStore } = require('./task-persistence');
    const store = getTaskStore();
    const unfinished = store.getUnfinishedTasks({
      minAge: options?.maxAge ?? 60 * 60 * 1000, // default: tasks older than 1 hour
      limit: options?.limit ?? 5,
    });
    
    if (unfinished.length === 0) return '';
    
    const sections = unfinished.map((task, idx) => {
      const ageHours = Math.round((Date.now() - task.updatedAt) / (60 * 60 * 1000));
      const status = task.status === 'in_progress' ? '🔄' : 
                     task.status === 'blocked' ? '⛔' : '📋';
      
      return `${status} [${ageHours}h ago] ${task.title}`;
    });
    
    return `\n## Pending Tasks (Intermittent Re-context)\n${sections.join('\n')}\n`;
  } catch {
    return '';
  }
}

/**
 * Mark unfinished tasks for re-context (refreshes their lastAccessedAt)
 */
export function markTasksForRecontext(taskIds?: string[]): void {
  try {
    const { getTaskStore } = require('./task-persistence');
    const store = getTaskStore();
    
    if (taskIds) {
      for (const id of taskIds) {
        store.markForRecontext(id);
      }
    } else {
      // Mark all unfinished tasks
      const unfinished = store.getUnfinishedTasks({ limit: 50 });
      for (const task of unfinished) {
        store.markForRecontext(task.id);
      }
    }
    
    log.debug('Tasks marked for re-context', { count: taskIds?.length ?? 'all' });
  } catch {
    // Store may not be available
  }
}
