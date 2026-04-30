/**
 * local-experience-storage.ts — Local Persistence for Agent Experiences
 * 
 * Provides semi-persistence for agent experiences in desktop and CLI environments.
 * Similar to how chat history is stored locally in ~/.quaz config folder rather than
 * server-side database.
 * 
 * Features:
 * - Browser: Uses localStorage with automatic save/load
 * - Node.js/CLI: Uses file system in ~/.quaz folder
 * - Hybrid: Can store locally AND sync to Mem0 cloud when available
 * - Graceful degradation when Mem0 is unavailable
 * 
 * This enables offline-first experience storage for desktop/CLI users.
 */

import { createLogger } from '@/lib/utils/logger';
import type { AgentExperience } from './agent-experience';

const log = createLogger('LocalExperienceStorage');

// ============================================================================
// Storage Backend Abstraction
// ============================================================================

interface StorageBackend {
  /** Save experiences to storage */
  save(experiences: AgentExperience[]): Promise<void>;
  /** Load experiences from storage */
  load(): Promise<AgentExperience[]>;
  /** Get the storage location path (for debugging) */
  getLocation(): string;
  /** Check if storage is available */
  isAvailable(): boolean;
}

/**
 * Browser localStorage backend
 */
class LocalStorageBackend implements StorageBackend {
  private key: string;
  private location: string;

  constructor(key = 'agent_experiences') {
    this.key = key;
    this.location = `localStorage['${key}']`;
  }

  isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem('_test', 'test');
      localStorage.removeItem('_test');
      return true;
    } catch {
      return false;
    }
  }

  getLocation(): string {
    return this.location;
  }

  async save(experiences: AgentExperience[]): Promise<void> {
    if (!this.isAvailable()) {
      log.warn('[LocalStorageBackend] localStorage not available, skipping save');
      return;
    }
    try {
      const data = JSON.stringify(experiences);
      localStorage.setItem(this.key, data);
      log.debug('[LocalStorageBackend] Saved', { count: experiences.length });
    } catch (err) {
      log.error('[LocalStorageBackend] Failed to save:', err);
    }
  }

  async load(): Promise<AgentExperience[]> {
    if (!this.isAvailable()) {
      log.warn('[LocalStorageBackend] localStorage not available, returning empty');
      return [];
    }
    try {
      const data = localStorage.getItem(this.key);
      if (!data) return [];
      const experiences = JSON.parse(data) as AgentExperience[];
      log.debug('[LocalStorageBackend] Loaded', { count: experiences.length });
      return experiences;
    } catch (err) {
      log.error('[LocalStorageBackend] Failed to load:', err);
      return [];
    }
  }
}

/**
 * Node.js file system backend for CLI/desktop
 * Stores in ~/.quaz/experiences.json
 */
class FileSystemBackend implements StorageBackend {
  private filePath: string;
  private location: string;

  constructor() {
    // Use ~/.quaz for config directory (not XDG to match user expectation)
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const configDir = process.env.QUAZ_CONFIG_DIR || `${homeDir}/.quaz`;
    this.filePath = `${configDir}/experiences.json`;
    this.location = this.filePath;
  }

  isAvailable(): boolean {
    // Check if we're in Node.js environment (not browser)
    // In ES modules, we simply check if window is undefined
    if (typeof window !== 'undefined') return false;
    // In Node.js, process and globalThis are available
    return typeof globalThis !== 'undefined' && typeof process !== 'undefined';
  }

  getLocation(): string {
    return this.location;
  }

  private async ensureDirectory(): Promise<void> {
    if (typeof window !== 'undefined') return;
    const fs = await import('fs/promises');
    const path = await import('path');
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  async save(experiences: AgentExperience[]): Promise<void> {
    try {
      if (typeof window !== 'undefined') return;
      await this.ensureDirectory();
      const fs = await import('fs/promises');
      const data = JSON.stringify(experiences, null, 2);
      await fs.writeFile(this.filePath, data, 'utf-8');
      log.debug('[FileSystemBackend] Saved', { count: experiences.length, path: this.filePath });
    } catch (err) {
      log.error('[FileSystemBackend] Failed to save:', err);
    }
  }

  async load(): Promise<AgentExperience[]> {
    try {
      if (typeof window !== 'undefined') return [];
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.filePath, 'utf-8');
      const experiences = JSON.parse(data) as AgentExperience[];
      log.debug('[FileSystemBackend] Loaded', { count: experiences.length, path: this.filePath });
      return experiences;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        log.debug('[FileSystemBackend] No file found, returning empty');
        return [];
      }
      log.error('[FileSystemBackend] Failed to load:', err);
      return [];
    }
  }
}

// ============================================================================
// Local Experience Storage Manager
// ============================================================================

const LOCAL_STORAGE_KEY = 'agent_experiences';

/**
 * Local experience storage that persists experiences to local storage
 * and optionally syncs to Mem0 cloud when available.
 */
export class LocalExperienceStorage {
  private backend: StorageBackend;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private saveDebounceMs = 1000; // Debounce saves by 1 second
  private isDirty = false;
  private pendingResolve: (() => void) | null = null;

  constructor(options?: { backend?: StorageBackend }) {
    this.backend = options?.backend || this.createDefaultBackend();
    log.info('[LocalExperienceStorage] Initialized', { location: this.backend.getLocation() });
  }

  /**
   * Create appropriate backend based on environment
   */
  private createDefaultBackend(): StorageBackend {
    if (typeof window !== 'undefined') {
      return new LocalStorageBackend(LOCAL_STORAGE_KEY);
    }
    return new FileSystemBackend();
  }

  /**
   * Check if storage is available
   */
  isAvailable(): boolean {
    return this.backend.isAvailable();
  }

  /**
   * Get storage location for debugging
   */
  getLocation(): string {
    return this.backend.getLocation();
  }

  /**
   * Save experiences to local storage (debounced)
   */
  async save(experiences: AgentExperience[]): Promise<void> {
    this.isDirty = true;
    
    // Clear existing timer and pending resolve
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (this.pendingResolve) {
      this.pendingResolve();
      this.pendingResolve = null;
    }

    // Debounce the actual save
    return new Promise<void>((resolve) => {
      this.pendingResolve = resolve;
      this.saveDebounceTimer = setTimeout(async () => {
        this.pendingResolve = null;
        await this.backend.save(experiences);
        this.isDirty = false;
        resolve();
      }, this.saveDebounceMs);
    });
  }

  /**
   * Immediately save without debouncing (for critical operations)
   * Call this on app shutdown to ensure all changes are persisted.
   */
  async saveImmediately(experiences: AgentExperience[]): Promise<void> {
    // Clear any pending debounced save
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    // Resolve any pending promise
    if (this.pendingResolve) {
      this.pendingResolve();
      this.pendingResolve = null;
    }
    this.isDirty = false;
    await this.backend.save(experiences);
  }

  /**
   * Clean up timers without saving.
   * Call this on app exit after persistCacheToLocalStorage() is called.
   */
  shutdown(): void {
    log.info('[LocalExperienceStorage] Cleaning up');
    // Clear any pending debounced save timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    // Resolve any pending promise to prevent hanging
    if (this.pendingResolve) {
      this.pendingResolve();
      this.pendingResolve = null;
    }
  }

  /**
   * Load experiences from local storage
   */
  async load(): Promise<AgentExperience[]> {
    const experiences = await this.backend.load();
    this.isDirty = false;
    return experiences;
  }

  /**
   * Clear local storage
   */
  async clear(): Promise<void> {
    await this.backend.save([]);
    this.isDirty = false;
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  /**
   * Export experiences as JSON string (for backup/export)
   */
  async exportAsJson(): Promise<string> {
    const experiences = await this.load();
    return JSON.stringify(experiences, null, 2);
  }

  /**
   * Import experiences from JSON string (for restore/import)
   */
  async importFromJson(json: string): Promise<AgentExperience[]> {
    try {
      const experiences = JSON.parse(json) as AgentExperience[];
      await this.saveImmediately(experiences);
      return experiences;
    } catch (err) {
      log.error('[LocalExperienceStorage] Failed to import:', err);
      throw new Error('Invalid JSON format for experience import');
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    location: string;
    available: boolean;
    experienceCount: number;
    storageSizeBytes: number;
  }> {
    const experiences = await this.load();
    const jsonStr = JSON.stringify(experiences);
    return {
      location: this.getLocation(),
      available: this.isAvailable(),
      experienceCount: experiences.length,
      storageSizeBytes: new Blob([jsonStr]).size,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let localStorageInstance: LocalExperienceStorage | null = null;

/**
 * Get or create the local experience storage singleton
 */
export function getLocalExperienceStorage(): LocalExperienceStorage {
  if (!localStorageInstance) {
    localStorageInstance = new LocalExperienceStorage();
  }
  return localStorageInstance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetLocalExperienceStorage(): void {
  localStorageInstance = null;
}

// ============================================================================
// Integration Helper for AgentExperienceCache
// ============================================================================

/**
 * Options for local storage integration
 */
export interface LocalStorageOptions {
  /** Load from local storage on initialization (default: true) */
  loadOnInit?: boolean;
  /** Save to local storage when cache changes (default: true) */
  saveOnChange?: boolean;
  /** Sync to Mem0 cloud when available (default: true) */
  syncToMem0?: boolean;
}

/**
 * Integrate local storage with the experience cache.
 * Call this during app initialization.
 */
export async function initLocalExperiencePersistence(
  cache: {
    export(): AgentExperience[];
    import(experiences: AgentExperience[]): number;
  },
  options: LocalStorageOptions = {}
): Promise<{
  loaded: number;
  storageLocation: string;
}> {
  const storage = getLocalExperienceStorage();
  const { loadOnInit = true, saveOnChange = true } = options;

  let loaded = 0;

  if (loadOnInit && storage.isAvailable()) {
    try {
      const localExperiences = await storage.load();
      if (localExperiences.length > 0) {
        loaded = cache.import(localExperiences);
        log.info('[LocalExperiencePersistence] Loaded experiences from local storage', {
          loaded,
          total: localExperiences.length,
          location: storage.getLocation(),
        });
      }
    } catch (err) {
      log.error('[LocalExperiencePersistence] Failed to load from local storage:', err);
    }
  }

  return {
    loaded,
    storageLocation: storage.getLocation(),
  };
}

/**
 * Save current cache state to local storage.
 * Call this periodically or on app shutdown.
 */
export async function persistCacheToLocalStorage(
  cache: {
    export(): AgentExperience[];
  }
): Promise<void> {
  const storage = getLocalExperienceStorage();
  if (!storage.isAvailable()) {
    log.debug('[LocalExperiencePersistence] Storage not available, skipping save');
    return;
  }

  try {
    const experiences = cache.export();
    await storage.saveImmediately(experiences);
    log.debug('[LocalExperiencePersistence] Saved experiences to local storage', {
      count: experiences.length,
    });
  } catch (err) {
    log.error('[LocalExperiencePersistence] Failed to save to local storage:', err);
  }
}

// ============================================================================
// Default Storage Paths
// ============================================================================

/**
 * Get the default storage path for the current environment
 */
export function getDefaultStoragePath(): string {
  if (typeof window !== 'undefined') {
    return `localStorage['${LOCAL_STORAGE_KEY}']`;
  }
  
  // Use ~/.quaz or QUAZ_CONFIG_DIR environment variable
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  const configDir = process.env.QUAZ_CONFIG_DIR || `${homeDir}/.quaz`;
  return `${configDir}/experiences.json`;
}

/**
 * Check if we're in a desktop/CLI environment (vs browser)
 */
export function isDesktopOrCLI(): boolean {
  return typeof window === 'undefined';
}