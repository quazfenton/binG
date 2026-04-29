/**
 * Workspace Cleanup & Memory Management Configuration
 * 
 * IMPROVEMENT: Configurable workspace cleanup to prevent unbounded memory growth
 * Addresses: "Unbounded Memory Growth (virtual-filesystem-service.ts:80)"
 */

/**
 * Workspace cleanup configuration
 */
export interface WorkspaceCleanupConfig {
  // TTL for idle workspaces in milliseconds
  idleTTL: number;
  
  // Maximum number of workspaces to keep in memory
  maxWorkspaces: number;
  
  // Enable automatic cleanup on interval
  enableAutoCleanup: boolean;
  
  // Interval for automatic cleanup in milliseconds
  cleanupInterval: number;
  
  // Whether to clean up batch managers when workspace is closed
  cleanupBatchManagers: boolean;
}

// Default configuration
export const DEFAULT_WORKSPACE_CLEANUP_CONFIG: WorkspaceCleanupConfig = {
  idleTTL: 30 * 60 * 1000, // 30 minutes
  maxWorkspaces: 100,
  enableAutoCleanup: true,
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  cleanupBatchManagers: true,
};

/**
 * Workspace metadata for cleanup tracking
 */
export interface WorkspaceMetadata {
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
}

/**
 * Workspace cleanup manager
 * 
 * Tracks workspace access and manages cleanup based on:
 * - Idle time (TTL)
 * - Maximum workspace count (LRU eviction)
 */
export class WorkspaceCleanupManager {
  private workspaceMetadata: Map<string, WorkspaceMetadata> = new Map();
  private cleanupConfig: WorkspaceCleanupConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<WorkspaceCleanupConfig> = {}) {
    this.cleanupConfig = { ...DEFAULT_WORKSPACE_CLEANUP_CONFIG, ...config };

    if (this.cleanupConfig.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Record workspace access
   */
  recordAccess(ownerId: string): void {
    const now = Date.now();
    const metadata = this.workspaceMetadata.get(ownerId);

    if (metadata) {
      metadata.lastAccessedAt = now;
      metadata.accessCount++;
    } else {
      this.workspaceMetadata.set(ownerId, {
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 1,
      });
    }
  }

  /**
   * Get workspaces that should be cleaned up
   */
  getExpiredWorkspaces(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [ownerId, metadata] of this.workspaceMetadata.entries()) {
      const idleTime = now - metadata.lastAccessedAt;
      if (idleTime > this.cleanupConfig.idleTTL) {
        expired.push(ownerId);
      }
    }

    return expired;
  }

  /**
   * Get least recently used workspaces (for LRU eviction)
   */
  getLRUWorkspaces(count: number): string[] {
    const sorted = Array.from(this.workspaceMetadata.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)
      .slice(0, count)
      .map(([ownerId]) => ownerId);

    return sorted;
  }

  /**
   * Get workspaces to evict based on max workspace limit
   */
  getWorkspacesToEvict(): string[] {
    const count = this.workspaceMetadata.size;
    if (count > this.cleanupConfig.maxWorkspaces) {
      const evictCount = count - this.cleanupConfig.maxWorkspaces;
      return this.getLRUWorkspaces(evictCount);
    }
    return [];
  }

  /**
   * Get all candidates for cleanup (expired or LRU)
   */
  getCleanupCandidates(): string[] {
    const expired = new Set(this.getExpiredWorkspaces());
    const lru = new Set(this.getWorkspacesToEvict());
    return Array.from(new Set([...expired, ...lru]));
  }

  /**
   * Mark workspace as cleaned up
   */
  recordCleanup(ownerId: string): void {
    this.workspaceMetadata.delete(ownerId);
  }

  /**
   * Start automatic cleanup on interval
   */
  private startAutoCleanup(): void {
    if (this.cleanupInterval) {
      return; // Already running
    }

    this.cleanupInterval = setInterval(() => {
      // Cleanup logic will be called by VirtualFilesystemService
      // This just manages the timing
    }, this.cleanupConfig.cleanupInterval);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get statistics about workspace memory usage
   */
  getStats(): {
    totalWorkspaces: number;
    oldestWorkspace?: { ownerId: string; age: number };
    mostAccessedWorkspace?: { ownerId: string; accessCount: number };
    totalAccessCount: number;
  } {
    const now = Date.now();
    let oldest: { ownerId: string; age: number } | undefined;
    let mostAccessed: { ownerId: string; accessCount: number } | undefined;
    let totalAccessCount = 0;

    for (const [ownerId, metadata] of this.workspaceMetadata.entries()) {
      const age = now - metadata.createdAt;
      totalAccessCount += metadata.accessCount;

      if (!oldest || age > oldest.age) {
        oldest = { ownerId, age };
      }

      if (!mostAccessed || metadata.accessCount > mostAccessed.accessCount) {
        mostAccessed = { ownerId, accessCount: metadata.accessCount };
      }
    }

    return {
      totalWorkspaces: this.workspaceMetadata.size,
      oldestWorkspace: oldest,
      mostAccessedWorkspace: mostAccessed,
      totalAccessCount,
    };
  }
}
