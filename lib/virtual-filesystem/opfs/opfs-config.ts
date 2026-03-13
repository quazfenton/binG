/**
 * OPFS Configuration
 * 
 * Centralized configuration for OPFS features
 * Allows runtime configuration and feature flags
 */

export interface OPFSConfig {
  /** Enable/disable OPFS entirely */
  enabled: boolean;
  
  /** Enable auto-sync to server */
  autoSync: boolean;
  
  /** Auto-sync interval in milliseconds */
  syncInterval: number;
  
  /** Max queue size for pending writes */
  maxQueueSize: number;
  
  /** Enable handle caching */
  enableHandleCaching: boolean;
  
  /** Max cache size for file handles */
  maxCacheSize: number;
  
  /** Enable multi-tab sync */
  enableMultiTabSync: boolean;
  
  /** Multi-tab presence interval */
  presenceInterval: number;
  
  /** Enable git integration */
  enableGit: boolean;
  
  /** Default git author name */
  gitAuthorName: string;
  
  /** Default git author email */
  gitAuthorEmail: string;
  
  /** Enable shadow commits */
  enableShadowCommits: boolean;
  
  /** Max shadow commits to keep */
  maxShadowCommits: number;
  
  /** Enable terminal sync */
  enableTerminalSync: boolean;
  
  /** Terminal sync debounce delay */
  terminalSyncDelay: number;
  
  /** Exclude patterns for sync */
  excludePatterns: string[];
  
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default OPFS configuration
 */
export const DEFAULT_OPFS_CONFIG: OPFSConfig = {
  enabled: true,
  autoSync: true,
  syncInterval: 30000, // 30 seconds
  maxQueueSize: 100,
  enableHandleCaching: true,
  maxCacheSize: 1000,
  enableMultiTabSync: true,
  presenceInterval: 5000,
  enableGit: true,
  gitAuthorName: 'User',
  gitAuthorEmail: 'user@local',
  enableShadowCommits: true,
  maxShadowCommits: 100,
  enableTerminalSync: true,
  terminalSyncDelay: 500,
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    '.next/**',
    'dist/**',
    'build/**',
    '*.log',
    '.env*',
  ],
  debug: false,
};

/**
 * OPFS Configuration Manager
 * 
 * Manages runtime configuration with localStorage persistence
 */
class OPFSConfigManager {
  private config: OPFSConfig = { ...DEFAULT_OPFS_CONFIG };
  private storageKey = 'opfs-config';
  private listeners: Set<(config: OPFSConfig) => void> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Get current configuration
   */
  getConfig(): OPFSConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<OPFSConfig>): void {
    this.config = { ...this.config, ...updates };
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_OPFS_CONFIG };
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Subscribe to configuration changes
   */
  subscribe(listener: (config: OPFSConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof OPFSConfig): boolean {
    const value = this.config[feature];
    return typeof value === 'boolean' ? value : false;
  }

  /**
   * Enable/disable OPFS
   */
  setEnabled(enabled: boolean): void {
    this.updateConfig({ enabled });
  }

  /**
   * Check if OPFS is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set debug mode
   */
  setDebug(debug: boolean): void {
    this.updateConfig({ debug });
  }

  /**
   * Check if debug mode is enabled
   */
  isDebug(): boolean {
    return this.config.debug;
  }

  /**
   * Get configuration as JSON
   */
  toJSON(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Load configuration from JSON
   */
  fromJSON(json: string): void {
    try {
      const parsed = JSON.parse(json);
      this.updateConfig(parsed);
    } catch (error) {
      console.error('[OPFS Config] Failed to parse JSON:', error);
    }
  }

  /**
   * Load configuration from localStorage
   */
  private loadFromStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.config = { ...DEFAULT_OPFS_CONFIG, ...parsed };
      }
    } catch (error) {
      console.error('[OPFS Config] Failed to load from storage:', error);
    }
  }

  /**
   * Save configuration to localStorage
   */
  private saveToStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (error) {
      console.error('[OPFS Config] Failed to save to storage:', error);
    }
  }

  /**
   * Notify listeners of configuration change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (error) {
        console.error('[OPFS Config] Listener error:', error);
      }
    }
  }

  /**
   * Export configuration for backup
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from backup
   */
  importConfig(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      this.config = { ...DEFAULT_OPFS_CONFIG, ...parsed };
      this.saveToStorage();
      this.notifyListeners();
      return true;
    } catch (error) {
      console.error('[OPFS Config] Import failed:', error);
      return false;
    }
  }
}

// Singleton instance
export const opfsConfigManager = new OPFSConfigManager();

/**
 * Get current OPFS configuration
 */
export function getOPFSConfig(): OPFSConfig {
  return opfsConfigManager.getConfig();
}

/**
 * Update OPFS configuration
 */
export function updateOPFSConfig(updates: Partial<OPFSConfig>): void {
  opfsConfigManager.updateConfig(updates);
}

/**
 * Subscribe to OPFS configuration changes
 */
export function subscribeOPFSConfig(listener: (config: OPFSConfig) => void): () => void {
  return opfsConfigManager.subscribe(listener);
}
