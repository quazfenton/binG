/**
 * Phase 9: WorkspaceFS Sync Service
 *
 * Unified sync layer that coordinates R2 cloud storage, VFS database,
 * and sandbox filesystems. Handles conflict resolution with version tracking
 * and provides cross-provider migration support.
 *
 * Architecture:
 *   R2 (durable source of truth)
 *     ↕  syncToR2 / syncFromR2
 *   VFS (metadata index + local cache)
 *     ↕  sandboxFilesystemSync (bidirectional polling)
 *   Sandbox (live workspace)
 *
 * Key improvements over legacy sync:
 *   1. Conflict resolution — last-writer-wins with version tracking
 *   2. Cross-provider migration — coordinated VFS→sandbox push on migration
 *   3. R2 as source of truth — durable cloud backup for all workspace files
 *
 * @see lib/storage/cloud-storage.ts — R2/S3/MinIO storage backends
 * @see lib/virtual-filesystem/sync/sandbox-filesystem-sync.ts — VFS↔sandbox sync
 * @see lib/sandbox/workspacefs-snapshot-service.ts — Affinity snapshots
 * @see lib/sandbox/sandbox-orchestrator.ts — Session migration
 */

import { createLogger } from '../utils/logger';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { sandboxFilesystemSync } from '../virtual-filesystem/sync/sandbox-filesystem-sync';
import type { SandboxProviderType } from './providers';

const logger = createLogger('Phase9:WorkspaceFSSync');

// ============================================================================
// Types
// ============================================================================

/**
 * Sync state for a workspace — tracks what's been synced where.
 */
export interface WorkspaceSyncState {
  /** Workspace identifier (userId:conversationId) */
  workspaceId: string;
  /** User ID */
  userId: string;
  /** Current VFS version */
  vfsVersion: number;
  /** Last time VFS was synced to R2 */
  lastR2SyncAt: number;
  /** Last time full VFS→sandbox push completed */
  lastSandboxPushAt: number;
  /** Whether initial sync is complete */
  initialSyncComplete: boolean;
  /** Number of files tracked */
  fileCount: number;
  /** Total size in bytes */
  totalSizeBytes: number;
  /** Whether R2 sync is enabled */
  r2Enabled: boolean;
  /** R2 bucket name (if configured) */
  r2Bucket?: string;
  /** Pending conflicts that need resolution */
  pendingConflicts: number;
}

/**
 * Conflict resolution strategy.
 */
export type ConflictStrategy = 'last-writer-wins' | 'vfs-wins' | 'sandbox-wins' | 'manual';

/**
 * Sync operation result.
 */
export interface SyncResult {
  /** Whether the sync completed successfully */
  success: boolean;
  /** Number of files synced */
  filesSynced: number;
  /** Number of conflicts detected */
  conflictsDetected: number;
  /** Number of conflicts resolved */
  conflictsResolved: number;
  /** Errors encountered (non-fatal) */
  warnings: string[];
  /** Duration in ms */
  duration: number;
}

/**
 * Migration result — state after cross-provider migration.
 */
export interface MigrationSyncResult {
  /** Whether migration sync completed */
  success: boolean;
  /** Source provider */
  fromProvider: SandboxProviderType;
  /** Destination provider */
  toProvider: SandboxProviderType;
  /** Number of files synced to new sandbox */
  filesSynced: number;
  /** Number of files restored from R2 */
  filesRestoredFromR2: number;
  /** Errors encountered */
  errors: string[];
  /** Duration in ms */
  duration: number;
}

// ============================================================================
// R2 Sync Helper
// ============================================================================

interface R2SyncHelper {
  enabled: boolean;
  bucket?: string;
}

function getR2Config(): R2SyncHelper {
  return {
    enabled: process.env.R2_ACCESS_KEY_ID !== undefined
      && process.env.R2_SECRET_ACCESS_KEY !== undefined
      && process.env.R2_ENDPOINT !== undefined
      && process.env.R2_BUCKET !== undefined,
    bucket: process.env.R2_BUCKET,
  };
}

// ============================================================================
// WorkspaceFS Sync Service
// ============================================================================

export class WorkspaceFSSyncService {
  /** In-memory sync state per workspace */
  private syncStates = new Map<string, WorkspaceSyncState>();

  /** Default conflict strategy */
  private defaultConflictStrategy: ConflictStrategy = 'last-writer-wins';

  /** Whether the service is enabled */
  private readonly ENABLED = process.env.WORKSPACEFS_SYNC_ENABLED !== 'false';

  /** How long to retain sync state in memory after last activity */
  private readonly STATE_RETENTION_MS = 3600_000; // 1 hour

  /** Interval for background R2 sync (ms). Default: 5 minutes. */
  private readonly BACKGROUND_SYNC_INTERVAL_MS = parseInt(
    process.env.WORKSPACEFS_BACKGROUND_SYNC_INTERVAL_MS || '300000',
    10,
  );

  /** Whether background periodic sync to R2 is enabled. */
  private readonly BACKGROUND_SYNC_ENABLED =
    process.env.WORKSPACEFS_BACKGROUND_SYNC_ENABLED !== 'false';

  /** Timer handle for background sync. */
  private backgroundSyncTimer?: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup of stale sync states
    const cleanup = setInterval(() => this.cleanupStaleStates(), 300_000);
    cleanup.unref?.();

    // Start background R2 sync if configured
    if (this.BACKGROUND_SYNC_ENABLED && this.ENABLED) {
      this.startBackgroundSync();
    }
  }

  // ==========================================================================
  // Sync State Management
  // ==========================================================================

  /**
   * Get or initialize sync state for a workspace.
   */
  private async getOrCreateSyncState(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceSyncState> {
    const existing = this.syncStates.get(workspaceId);
    if (existing) return existing;

    const r2Config = getR2Config();
    let vfsVersion = 0;
    let fileCount = 0;

    try {
      vfsVersion = await virtualFilesystem.getWorkspaceVersion(userId);
      const workspace = await virtualFilesystem.exportWorkspace(userId);
      fileCount = workspace.files.length;
    } catch {
      // VFS may not be initialized yet
    }

    const state: WorkspaceSyncState = {
      workspaceId,
      userId,
      vfsVersion,
      lastR2SyncAt: 0,
      lastSandboxPushAt: 0,
      initialSyncComplete: false,
      fileCount,
      totalSizeBytes: 0,
      r2Enabled: r2Config.enabled,
      r2Bucket: r2Config.bucket,
      pendingConflicts: 0,
    };

    this.syncStates.set(workspaceId, state);
    return state;
  }

  /**
   * Update sync state after a successful operation.
   */
  private updateSyncState(
    workspaceId: string,
    updates: Partial<WorkspaceSyncState>,
  ): void {
    const state = this.syncStates.get(workspaceId);
    if (!state) return;
    Object.assign(state, updates);
  }

  // ==========================================================================
  // Core Sync Operations
  // ==========================================================================

  /**
   * Run a full sync cycle: VFS → R2, then VFS → sandbox (if handle provided).
   *
   * This is the primary sync method — called periodically or on-demand.
   */
  async fullSync(
    workspaceId: string,
    userId: string,
    sandboxId?: string,
  ): Promise<SyncResult> {
    if (!this.ENABLED) {
      return { success: true, filesSynced: 0, conflictsDetected: 0, conflictsResolved: 0, warnings: ['Sync disabled'], duration: 0 };
    }

    const startTime = Date.now();
    const warnings: string[] = [];
    let filesSynced = 0;
    let conflictsDetected = 0;
    let conflictsResolved = 0;

    const state = await this.getOrCreateSyncState(workspaceId, userId);

    // Step 1: Sync VFS → R2 (durable backup)
    if (state.r2Enabled) {
      try {
        const r2Result = await this.syncVFSToR2(workspaceId, userId, state);
        filesSynced += r2Result.filesSynced;
        warnings.push(...r2Result.warnings);
        this.updateSyncState(workspaceId, {
          lastR2SyncAt: Date.now(),
        });
      } catch (err: any) {
        warnings.push(`R2 sync failed: ${err.message}`);
      }
    }

    // Step 2: Sync VFS → sandbox (if sandbox is attached)
    if (sandboxId) {
      try {
        const sandboxResult = await this.pushVFSToSandbox(
          workspaceId, userId, sandboxId, state,
        );
        filesSynced += sandboxResult.filesSynced;
        conflictsDetected += sandboxResult.conflictsDetected;
        conflictsResolved += sandboxResult.conflictsResolved;
        warnings.push(...sandboxResult.warnings);
        this.updateSyncState(workspaceId, {
          lastSandboxPushAt: Date.now(),
          initialSyncComplete: true,
        });
      } catch (err: any) {
        warnings.push(`Sandbox sync failed: ${err.message}`);
      }
    }

    // Update VFS version
    try {
      state.vfsVersion = await virtualFilesystem.getWorkspaceVersion(userId);
    } catch {
      // Version check failed — will retry next cycle
    }

    const duration = Date.now() - startTime;

    logger.info('WorkspaceFS full sync complete', {
      workspaceId,
      filesSynced,
      conflictsDetected,
      conflictsResolved,
      duration,
    });

    return {
      success: true,
      filesSynced,
      conflictsDetected,
      conflictsResolved,
      warnings,
      duration,
    };
  }

  /**
   * Sync VFS contents to R2 for durable cloud storage.
   */
  private async syncVFSToR2(
    workspaceId: string,
    userId: string,
    state: WorkspaceSyncState,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const warnings: string[] = [];

    if (!state.r2Enabled) {
      return { success: true, filesSynced: 0, conflictsDetected: 0, conflictsResolved: 0, warnings: [], duration: 0 };
    }

    try {
      // Dynamically import R2 storage service
      const { createCloudStorageService } = await import('../storage/cloud-storage');

      // Get all VFS files
      const workspace = await virtualFilesystem.exportWorkspace(userId);
      let filesSynced = 0;

      for (const file of workspace.files) {
        try {
          const r2Path = `workspaces/${userId}/${workspaceId}/${file.path}`;

          // Upload to R2 — createCloudStorageService picks the configured provider
          // In production with R2_ACCESS_KEY_ID set, this will be R2
          const storage = createCloudStorageService();
          const contentBlob = new Blob([file.content], { type: 'text/plain' });
          await storage.upload(
            new File([contentBlob], file.path, { type: 'text/plain' }),
            r2Path,
            userId,
          );
          filesSynced++;
        } catch (fileErr: any) {
          warnings.push(`R2 upload failed for ${file.path}: ${fileErr.message}`);
        }
      }

      const duration = Date.now() - startTime;
      logger.debug('VFS→R2 sync complete', { workspaceId, filesSynced, duration });

      return {
        success: true,
        filesSynced,
        conflictsDetected: 0,
        conflictsResolved: 0,
        warnings,
        duration,
      };
    } catch (err: any) {
      return {
        success: false,
        filesSynced: 0,
        conflictsDetected: 0,
        conflictsResolved: 0,
        warnings: [`R2 sync error: ${err.message}`],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Push VFS files to a sandbox filesystem.
   * Handles conflict resolution when both sides have changes.
   */
  private async pushVFSToSandbox(
    workspaceId: string,
    userId: string,
    sandboxId: string,
    state: WorkspaceSyncState,
    strategy?: ConflictStrategy,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const resolution = strategy || this.defaultConflictStrategy;
    let filesSynced = 0;
    let conflictsDetected = 0;
    let conflictsResolved = 0;

    try {
      const sandboxBridge = (await import('./sandbox-service-bridge')).sandboxBridge;
      const workspace = await virtualFilesystem.exportWorkspace(userId);
      const workspaceDir = this.getWorkspaceDirForSandbox(sandboxId);

      for (const file of workspace.files) {
        const sandboxPath = `${workspaceDir}/${file.path}`;

        try {
          // Check if file exists in sandbox
          let sandboxContent: string | null = null;
          try {
            sandboxContent = await sandboxBridge.readFile(sandboxId, sandboxPath);
          } catch {
            // File doesn't exist in sandbox — clean write
          }

          if (sandboxContent !== null && sandboxContent !== file.content) {
            // Conflict detected — both sides have changes
            conflictsDetected++;

            switch (resolution) {
              case 'last-writer-wins':
                // VFS is the last writer (we just exported) — VFS wins
                if (file.lastModified && new Date(file.lastModified).getTime() > Date.now() - 60000) {
                  await sandboxBridge.writeFile(sandboxId, sandboxPath, file.content);
                  filesSynced++;
                  conflictsResolved++;
                }
                // Otherwise, keep sandbox version (it's likely newer)
                break;

              case 'vfs-wins':
                await sandboxBridge.writeFile(sandboxId, sandboxPath, file.content);
                filesSynced++;
                conflictsResolved++;
                break;

              case 'sandbox-wins':
                // Don't overwrite — sandbox keeps its version
                break;

              case 'manual':
                // Store conflict for later resolution
                this.updateSyncState(workspaceId, {
                  pendingConflicts: state.pendingConflicts + 1,
                });
                warnings.push(`Manual conflict: ${file.path}`);
                break;
            }
          } else if (sandboxContent === null) {
            // File doesn't exist in sandbox — write it
            await sandboxBridge.writeFile(sandboxId, sandboxPath, file.content);
            filesSynced++;
          }
          // If contents match, skip (already in sync)
        } catch (fileErr: any) {
          warnings.push(`Sandbox write failed for ${file.path}: ${fileErr.message}`);
        }
      }

      const duration = Date.now() - startTime;
      logger.debug('VFS→Sandbox push complete', {
        workspaceId,
        sandboxId,
        filesSynced,
        conflictsDetected,
        conflictsResolved,
        duration,
      });

      return {
        success: true,
        filesSynced,
        conflictsDetected,
        conflictsResolved,
        warnings,
        duration,
      };
    } catch (err: any) {
      return {
        success: false,
        filesSynced: 0,
        conflictsDetected: 0,
        conflictsResolved: 0,
        warnings: [`Sandbox sync error: ${err.message}`],
        duration: Date.now() - startTime,
      };
    }
  }

  // ==========================================================================
  // Cross-Provider Migration
  // ==========================================================================

  /**
   * Sync workspace state from one sandbox provider to another during migration.
   *
   * Called by SandboxOrchestrator when migrating a session between providers.
   * 1. Pull latest state from VFS (which was synced from source sandbox)
   * 2. Push all files to destination sandbox
   * 3. Optionally restore from R2 if VFS is incomplete
   */
  async syncForMigration(
    workspaceId: string,
    userId: string,
    fromProvider: SandboxProviderType,
    toProvider: SandboxProviderType,
    sourceSandboxId: string,
    destSandboxId: string,
  ): Promise<MigrationSyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesSynced = 0;
    let filesRestoredFromR2 = 0;

    logger.info('Starting cross-provider migration sync', {
      workspaceId,
      fromProvider,
      toProvider,
      sourceSandboxId,
      destSandboxId,
    });

    // Step 1: Ensure VFS has latest state from source sandbox
    try {
      // Force one final sync from source sandbox to VFS before migration
      await sandboxFilesystemSync.syncSandboxToVFS(sourceSandboxId, userId);
      logger.debug('Final VFS sync from source sandbox complete', {
        workspaceId,
        sourceSandboxId,
      });
    } catch (err: any) {
      errors.push(`Source sandbox sync failed: ${err.message}`);
      // Continue — VFS may already have the latest state
    }

    // Step 2: Get workspace state from VFS
    let workspace: { files: { path: string; content: string }[]; version: number };

    try {
      workspace = await virtualFilesystem.exportWorkspace(userId);
    } catch (err: any) {
      // VFS export failed — try R2 restore as fallback
      logger.warn('VFS export failed, trying R2 restore', {
        workspaceId,
        error: err.message,
      });

      const r2Result = await this.restoreFromR2(workspaceId, userId);
      if (r2Result.filesRestored > 0) {
        filesRestoredFromR2 = r2Result.filesRestored;
        workspace = r2Result.workspace;
      } else {
        return {
          success: false,
          fromProvider,
          toProvider,
          filesSynced: 0,
          filesRestoredFromR2: 0,
          errors: ['VFS export failed and R2 restore had no files'],
          duration: Date.now() - startTime,
        };
      }
    }

    // Step 3: Push all files to destination sandbox
    try {
      const sandboxBridge = (await import('./sandbox-service-bridge')).sandboxBridge;
      const workspaceDir = this.getWorkspaceDirForSandbox(destSandboxId);

      for (const file of workspace.files) {
        try {
          const sandboxPath = `${workspaceDir}/${file.path}`;
          await sandboxBridge.writeFile(destSandboxId, sandboxPath, file.content);
          filesSynced++;
        } catch (fileErr: any) {
          errors.push(`Migration write failed for ${file.path}: ${fileErr.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Destination sandbox push failed: ${err.message}`);
    }

    // Step 4: Update sync state
    this.updateSyncState(workspaceId, {
      initialSyncComplete: true,
      lastSandboxPushAt: Date.now(),
      fileCount: workspace.files.length,
    });

    const duration = Date.now() - startTime;

    logger.info('Cross-provider migration sync complete', {
      workspaceId,
      fromProvider,
      toProvider,
      filesSynced,
      filesRestoredFromR2,
      duration,
      errors: errors.length,
    });

    return {
      success: filesSynced > 0 || workspace.files.length === 0,
      fromProvider,
      toProvider,
      filesSynced,
      filesRestoredFromR2,
      errors,
      duration,
    };
  }

  /**
   * Restore workspace files from R2 when VFS is unavailable.
   */
  private async restoreFromR2(
    workspaceId: string,
    userId: string,
  ): Promise<{
    filesRestored: number;
    workspace: { files: { path: string; content: string }[]; version: number };
  }> {
    let filesRestored = 0;
    const files: { path: string; content: string }[] = [];

    try {
      const { createCloudStorageService } = await import('../storage/cloud-storage');
      const storage = createCloudStorageService();

      const prefix = `workspaces/${userId}/${workspaceId}/`;
      const r2Files = await storage.list(prefix, userId);

      for (const r2Path of r2Files) {
        try {
          const blob = await storage.download(prefix + r2Path, userId);
          const content = await blob.text();
          const filePath = r2Path.replace(prefix, '');

          files.push({ path: filePath, content });

          // Restore to VFS
          await virtualFilesystem.writeFile(userId, filePath, content);
          filesRestored++;
        } catch (fileErr: any) {
          logger.warn('R2 restore failed for file', { r2Path, error: fileErr.message });
        }
      }

      logger.info('R2 restore complete', { workspaceId, filesRestored });
    } catch (err: any) {
      logger.warn('R2 restore failed', { workspaceId, error: err.message });
    }

    return {
      filesRestored,
      workspace: { files, version: 0 },
    };
  }

  // ==========================================================================
  // Status and Monitoring
  // ==========================================================================

  /**
   * Get sync state for a workspace.
   */
  async getSyncState(workspaceId: string, userId: string): Promise<WorkspaceSyncState | null> {
    const state = this.syncStates.get(workspaceId);
    if (!state) {
      // Try to initialize from VFS
      return this.getOrCreateSyncState(workspaceId, userId);
    }
    return state;
  }

  /**
   * Check if R2 sync is configured and healthy.
   */
  getR2Status(): {
    configured: boolean;
    bucket?: string;
    endpoint?: string;
  } {
    const r2Config = getR2Config();
    return {
      configured: r2Config.enabled,
      bucket: r2Config.bucket,
      endpoint: process.env.R2_ENDPOINT,
    };
  }

  /**
   * Get aggregate sync statistics for monitoring.
   */
  getSyncStats(): {
    activeWorkspaces: number;
    initialSyncComplete: number;
    r2Enabled: number;
    totalPendingConflicts: number;
    totalFilesTracked: number;
  } {
    let initialSyncComplete = 0;
    let r2Enabled = 0;
    let totalPendingConflicts = 0;
    let totalFilesTracked = 0;

    for (const state of this.syncStates.values()) {
      if (state.initialSyncComplete) initialSyncComplete++;
      if (state.r2Enabled) r2Enabled++;
      totalPendingConflicts += state.pendingConflicts;
      totalFilesTracked += state.fileCount;
    }

    return {
      activeWorkspaces: this.syncStates.size,
      initialSyncComplete,
      r2Enabled,
      totalPendingConflicts,
      totalFilesTracked,
    };
  }

  /**
   * Get service configuration.
   */
  getConfig(): {
    enabled: boolean;
    defaultConflictStrategy: ConflictStrategy;
    r2Configured: boolean;
  } {
    return {
      enabled: this.ENABLED,
      defaultConflictStrategy: this.defaultConflictStrategy,
      r2Configured: getR2Config().enabled,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get the workspace directory for a sandbox (consistent with sandbox-filesystem-sync).
   */
  private getWorkspaceDirForSandbox(sandboxId: string): string {
    if (sandboxId.startsWith('e2b-')) return '/home/user';
    if (sandboxId.startsWith('daytona-')) return '/home/daytona/workspace';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return '/home/sprite/workspace';
    if (sandboxId.startsWith('csb-')) return '/workspace';
    if (sandboxId.startsWith('modal-')) return '/workspace';
    if (sandboxId.startsWith('local-') || sandboxId.startsWith('desktop-')) return '/workspace';
    return '/workspace';
  }

  /**
   * Clean up stale sync states to prevent memory leaks.
   */
  private cleanupStaleStates(): void {
    const cutoff = Date.now() - this.STATE_RETENTION_MS;
    for (const [workspaceId, state] of this.syncStates.entries()) {
      // Keep state if either R2 sync or sandbox push happened recently
      if (state.lastR2SyncAt < cutoff && state.lastSandboxPushAt < cutoff) {
        this.syncStates.delete(workspaceId);
      }
    }
  }

  // ==========================================================================
  // Background Sync (Periodic VFS → R2)
  // ==========================================================================

  /**
   * Start periodic background sync of all active workspaces to R2.
   *
   * This ensures durable cloud backups even when no explicit fullSync()
   * calls are triggered by migration or user action. The interval is
   * configurable via WORKSPACEFS_BACKGROUND_SYNC_INTERVAL_MS (default 5min).
   *
   * Each cycle syncs only workspaces with recent activity (last R2 sync
   * within the retention window) to avoid re-syncing stale workspaces.
   */
  private startBackgroundSync(): void {
    if (this.backgroundSyncTimer) return;

    logger.info('Starting background VFS→R2 sync', {
      intervalMs: this.BACKGROUND_SYNC_INTERVAL_MS,
    });

    // Run first sync after a short delay to let workspaces initialize,
    // then continue on the regular interval.
    setTimeout(() => {
      this.syncAllActiveWorkspaces().catch((err) => {
        logger.warn('Initial background sync cycle failed', { error: err.message });
      });
    }, 30_000);

    this.backgroundSyncTimer = setInterval(() => {
      this.syncAllActiveWorkspaces().catch((err) => {
        logger.warn('Background sync cycle failed', { error: err.message });
      });
    }, this.BACKGROUND_SYNC_INTERVAL_MS);

    // Allow the timer to not keep the process alive (unref for Node.js)
    this.backgroundSyncTimer.unref?.();
  }

  /**
   * Stop the background sync timer.
   */
  stopBackgroundSync(): void {
    if (this.backgroundSyncTimer) {
      clearInterval(this.backgroundSyncTimer);
      this.backgroundSyncTimer = undefined;
      logger.info('Background VFS→R2 sync stopped');
    }
  }

  /**
   * Sync all active workspaces to R2 in a single cycle.
   *
   * Only syncs workspaces that:
   *   1. Have R2 enabled
   *   2. Have had recent activity (within the retention window)
   *
   * Each workspace sync runs sequentially to avoid overwhelming
   * the R2 upload bandwidth with concurrent bulk uploads.
   */
  private async syncAllActiveWorkspaces(): Promise<void> {
    const r2Config = getR2Config();
    if (!r2Config.enabled) return;

    const cutoff = Date.now() - this.STATE_RETENTION_MS;
    const activeStates: WorkspaceSyncState[] = [];

    // Collect workspaces with recent activity
    for (const state of this.syncStates.values()) {
      if (
        state.r2Enabled &&
        (state.lastR2SyncAt >= cutoff || state.lastSandboxPushAt >= cutoff)
      ) {
        activeStates.push(state);
      }
    }

    if (activeStates.length === 0) return;

    const startTime = Date.now();
    let totalSynced = 0;
    let totalErrors = 0;

    // Sync sequentially to avoid overwhelming R2
    for (const state of activeStates) {
      try {
        const result = await this.syncVFSToR2(
          state.workspaceId,
          state.userId,
          state,
        );
        totalSynced += result.filesSynced;
        if (!result.success) totalErrors++;

        this.updateSyncState(state.workspaceId, {
          lastR2SyncAt: Date.now(),
        });
      } catch (err: any) {
        totalErrors++;
        logger.debug('Background R2 sync failed for workspace', {
          workspaceId: state.workspaceId.slice(0, 16),
          error: err.message,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info('Background VFS→R2 sync cycle complete', {
      workspaces: activeStates.length,
      filesSynced: totalSynced,
      errors: totalErrors,
      durationMs,
    });
  }

  /**
   * Check if background sync is running.
   */
  isBackgroundSyncRunning(): boolean {
    return !!this.backgroundSyncTimer;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceFSSyncService = new WorkspaceFSSyncService();
