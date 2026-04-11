/**
 * Sandbox Snapshot Manager
 *
 * High-level snapshot/restore for fast sandbox startup.
 * Wraps the checkpoint system with named environment snapshots
 * so pre-configured environments (npm install, pip install, etc.)
 * can be restored in seconds instead of minutes.
 *
 * Features:
 * - Named snapshots (e.g. "node18-base", "python3-ml")
 * - Metadata tracking (creation time, size estimate, labels)
 * - LRU eviction when snapshot limit is reached
 * - Restore from snapshot to new sandbox handle
 * - Integrates with CheckpointSystem for provider-level persistence
 */

import { createLogger } from '../utils/logger';
import { CheckpointSystem } from './checkpoint-system';
import { secureRandomId } from '../utils/crypto-random';
import type { SandboxHandle, CheckpointInfo } from './providers/sandbox-provider';

const logger = createLogger('Sandbox:SnapshotManager');

export interface SnapshotInfo {
  /** Unique snapshot ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what's pre-installed */
  description?: string;
  /** Labels for filtering */
  labels: Record<string, string>;
  /** Source sandbox ID */
  sourceSandboxId: string;
  /** Underlying checkpoint ID from provider */
  checkpointId: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last restored timestamp */
  lastRestoredAt?: number;
  /** Number of times restored */
  restoreCount: number;
  /** Estimated size in MB */
  estimatedSizeMb?: number;
}

export interface SnapshotManagerConfig {
  /** Maximum number of snapshots to retain (default: 50) */
  maxSnapshots: number;
  /** Auto-evict least-recently-used snapshots when limit reached (default: true) */
  autoEvict: boolean;
}

const DEFAULT_CONFIG: SnapshotManagerConfig = {
  maxSnapshots: 50,
  autoEvict: true,
};

/**
 * Sandbox Snapshot Manager
 */
export class SnapshotManager {
  private snapshots = new Map<string, SnapshotInfo>();
  private config: SnapshotManagerConfig;

  constructor(config?: Partial<SnapshotManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a snapshot from an existing sandbox.
   *
   * The sandbox should already be configured (deps installed, env set up).
   * The snapshot captures the filesystem state so it can be restored later.
   */
  async createSnapshot(
    handle: SandboxHandle,
    name: string,
    options?: {
      description?: string;
      labels?: Record<string, string>;
      estimatedSizeMb?: number;
    },
  ): Promise<SnapshotInfo> {
    // Evict if at capacity
    if (this.snapshots.size >= this.config.maxSnapshots) {
      if (this.config.autoEvict) {
        this.evictLRU();
      } else {
        throw new Error(
          `Snapshot limit reached (${this.config.maxSnapshots}). Delete old snapshots or enable autoEvict.`
        );
      }
    }

    logger.info('Creating snapshot', { sandboxId: handle.id, name });

    // Delegate to checkpoint system for provider-level persistence
    const checkpoint = await CheckpointSystem.create(handle, name, options?.description);

    const snapshotId = `snap-${Date.now()}-${secureRandomId()}`;
    const snapshot: SnapshotInfo = {
      id: snapshotId,
      name,
      description: options?.description,
      labels: options?.labels ?? {},
      sourceSandboxId: handle.id,
      checkpointId: checkpoint.id,
      createdAt: Date.now(),
      restoreCount: 0,
      estimatedSizeMb: options?.estimatedSizeMb,
    };

    this.snapshots.set(snapshotId, snapshot);

    logger.info('Snapshot created', {
      snapshotId,
      name,
      checkpointId: checkpoint.id,
      sourceSandboxId: handle.id,
    });

    return snapshot;
  }

  /**
   * Restore a sandbox from a snapshot.
   *
   * Returns the same handle after restoring its state from the checkpoint.
   */
  async restoreSnapshot(
    handle: SandboxHandle,
    snapshotId: string,
  ): Promise<SandboxHandle> {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    logger.info('Restoring snapshot', {
      snapshotId,
      name: snapshot.name,
      checkpointId: snapshot.checkpointId,
      targetSandboxId: handle.id,
    });

    await CheckpointSystem.restore(handle, snapshot.checkpointId);

    // Update usage metadata
    snapshot.lastRestoredAt = Date.now();
    snapshot.restoreCount++;

    logger.info('Snapshot restored', {
      snapshotId,
      name: snapshot.name,
      restoreCount: snapshot.restoreCount,
    });

    return handle;
  }

  /**
   * List all snapshots, optionally filtered by label
   */
  listSnapshots(labelFilter?: Record<string, string>): SnapshotInfo[] {
    let results = Array.from(this.snapshots.values());

    if (labelFilter) {
      results = results.filter(snap =>
        Object.entries(labelFilter).every(
          ([key, value]) => snap.labels[key] === value
        )
      );
    }

    // Sort by most recently created
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a snapshot by ID
   */
  getSnapshot(snapshotId: string): SnapshotInfo | null {
    return this.snapshots.get(snapshotId) ?? null;
  }

  /**
   * Find a snapshot by name
   */
  findByName(name: string): SnapshotInfo | null {
    for (const snap of this.snapshots.values()) {
      if (snap.name === name) return snap;
    }
    return null;
  }

  /**
   * Delete a snapshot
   */
  deleteSnapshot(snapshotId: string): boolean {
    const deleted = this.snapshots.delete(snapshotId);
    if (deleted) {
      logger.info('Snapshot deleted', { snapshotId });
    }
    return deleted;
  }

  /**
   * Evict the least-recently-used snapshot
   */
  private evictLRU(): void {
    let oldest: SnapshotInfo | null = null;
    let oldestTime = Infinity;

    for (const snap of this.snapshots.values()) {
      const lastUsed = snap.lastRestoredAt ?? snap.createdAt;
      if (lastUsed < oldestTime) {
        oldestTime = lastUsed;
        oldest = snap;
      }
    }

    if (oldest) {
      this.snapshots.delete(oldest.id);
      logger.info('Evicted LRU snapshot', {
        snapshotId: oldest.id,
        name: oldest.name,
        lastUsed: new Date(oldestTime).toISOString(),
      });
    }
  }

  /**
   * Get snapshot statistics
   */
  getStats(): {
    totalSnapshots: number;
    totalRestores: number;
    totalEstimatedSizeMb: number;
    mostUsed: { name: string; restoreCount: number } | null;
  } {
    const all = Array.from(this.snapshots.values());
    const totalRestores = all.reduce((sum, s) => sum + s.restoreCount, 0);
    const totalSize = all.reduce((sum, s) => sum + (s.estimatedSizeMb ?? 0), 0);

    let mostUsed: { name: string; restoreCount: number } | null = null;
    for (const snap of all) {
      if (!mostUsed || snap.restoreCount > mostUsed.restoreCount) {
        mostUsed = { name: snap.name, restoreCount: snap.restoreCount };
      }
    }

    return {
      totalSnapshots: all.length,
      totalRestores,
      totalEstimatedSizeMb: totalSize,
      mostUsed,
    };
  }
}

// Singleton instance
export const snapshotManager = new SnapshotManager();
