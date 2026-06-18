/**
 * Phase 7: WorkspaceFS Snapshot Service
 *
 * Snapshots the workspace filesystem on affinity expiry so caches
 * (node_modules, venvs, pip cache, etc.) can be restored when the
 * workspace is re-bound to a new provider later.
 *
 * Strategy:
 *   1. Provider-level checkpoints (Sprites, Daytona) — capture the ENTIRE
 *      filesystem including caches. Fastest restore.
 *   2. VFS export fallback — captures source files + lock file metadata.
 *      On restore, re-runs install commands (npm install, pip install) to
 *      rebuild caches.
 *
 * Integration points:
 *   - SandboxOrchestrator.startAffinityCleanup(): snapshot before evictAffinity
 *   - SandboxOrchestrator.getSandbox(): restore snapshot on re-bind
 */

import { createLogger } from '../utils/logger';
import { sandboxBridge } from './sandbox-service-bridge';
import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { getDatabase } from '@/lib/database/connection-shim';
import type { SandboxProviderType } from './providers';
import type { SandboxHandle } from './providers/sandbox-provider';

const logger = createLogger('Phase7:WorkspaceFSSnapshot');

// ============================================================================
// Types
// ============================================================================

/**
 * A workspace filesystem snapshot captured when affinity expires.
 * Stored in memory so it can be restored when the workspace is re-bound.
 */
export interface WorkspaceFSSnapshot {
  /** Workspace identifier (matches affinity workspaceId) */
  workspaceId: string;
  /** User ID */
  userId: string;
  /** The provider that hosted the workspace when snapshot was taken */
  sourceProvider: SandboxProviderType;
  /** The sandbox ID at snapshot time */
  sourceSandboxId: string;
  /** The workspace directory path */
  workspaceDir: string;
  /** When the snapshot was created */
  createdAt: number;

  /**
   * Provider checkpoint ID — only set if the provider supports
   * native checkpoints (Sprites, Daytona). This captures the full
   * filesystem including all cache directories.
   */
  checkpointId?: string;

  /**
   * VFS files from the workspace — source files that were synced to VFS.
   * These are always available since sandboxFilesystemSync pushes to VFS.
   */
  vfsVersion: number;
  fileCount: number;

  /**
   * Lock files detected in the workspace — used to reinstall caches
   * when a provider checkpoint is not available.
   */
  lockFiles: WorkspaceLockFiles;

  /** Total estimated cache size (for monitoring) */
  estimatedCacheSizeBytes?: number;

  /**
   * Workspace environment variables at time of snapshot.
   * Captured so they can be restored alongside the filesystem
   * when the workspace re-binds to a new provider.
   */
  envVars?: Record<string, string>;
}

/**
 * Detected lock files that indicate what package managers to re-run.
 */
export interface WorkspaceLockFiles {
  /** package-lock.json, yarn.lock, pnpm-lock.yaml, etc. */
  node?: string[];
  /** requirements.txt, Pipfile, Pipfile.lock, pyproject.toml */
  python?: string[];
  /** Gemfile, Gemfile.lock */
  ruby?: string[];
  /** go.sum */
  go?: string[];
  /** composer.lock */
  php?: string[];
  /** Cargo.lock */
  rust?: string[];
}

// ============================================================================
// Lock file detection patterns
// ============================================================================

const LOCK_FILE_PATTERNS: Record<string, { lang: keyof WorkspaceLockFiles; name: string }> = {
  'package-lock.json': { lang: 'node', name: 'npm' },
  'yarn.lock': { lang: 'node', name: 'yarn' },
  'pnpm-lock.yaml': { lang: 'node', name: 'pnpm' },
  'bun.lockb': { lang: 'node', name: 'bun' },
  'requirements.txt': { lang: 'python', name: 'pip' },
  'Pipfile': { lang: 'python', name: 'pipenv' },
  'Pipfile.lock': { lang: 'python', name: 'pipenv' },
  'pyproject.toml': { lang: 'python', name: 'poetry/pip' },
  'setup.py': { lang: 'python', name: 'setuptools' },
  'setup.cfg': { lang: 'python', name: 'setuptools' },
  'environment.yml': { lang: 'python', name: 'conda' },
  'Gemfile': { lang: 'ruby', name: 'bundler' },
  'Gemfile.lock': { lang: 'ruby', name: 'bundler' },
  'go.sum': { lang: 'go', name: 'go modules' },
  'composer.lock': { lang: 'php', name: 'composer' },
  'Cargo.lock': { lang: 'rust', name: 'cargo' },
};

// ============================================================================
// Install commands for cache restoration
// ============================================================================

const CACHE_INSTALL_COMMANDS: Record<string, string[]> = {
  npm: ['npm install --prefer-offline'],
  yarn: ['yarn install --prefer-offline'],
  pnpm: ['pnpm install --prefer-offline'],
  bun: ['bun install'],
  pip: ['pip install -r requirements.txt'],
  pipenv: ['pipenv install --deploy'],
  'poetry/pip': ['pip install -e . 2>/dev/null; pip install -r requirements.txt 2>/dev/null; true'],
  setuptools: ['pip install -e . 2>/dev/null; true'],
  conda: ['conda env update -f environment.yml --prune 2>/dev/null; true'],
  bundler: ['bundle install --local'],
  'go modules': ['go mod download'],
  composer: ['composer install --prefer-dist'],
  cargo: ['cargo fetch'],
};

// ============================================================================
// WorkspaceFS Snapshot Service
// ============================================================================

export class WorkspaceFSSnapshotService {
  /** In-memory snapshot store keyed by workspaceId */
  private snapshots = new Map<string, WorkspaceFSSnapshot>();

  /** How long snapshots are retained after creation (default: 30 min) */
  private readonly SNAPSHOT_TTL_MS = parseInt(
    process.env.WORKSPACEFS_SNAPSHOT_TTL_MS || '1800000',
    10,
  );

  /** Timeout for cache reinstall commands (default: 5 min) */
  private readonly INSTALL_TIMEOUT_MS = parseInt(
    process.env.WORKSPACEFS_INSTALL_TIMEOUT_MS || '300000',
    10,
  );

  /** Whether workspace FS snapshots are enabled */
  private readonly ENABLED = process.env.WORKSPACEFS_SNAPSHOT_ENABLED !== 'false';

  /** Track in-flight snapshot creations to prevent duplicate attempts */
  private pendingSnapshots = new Set<string>();

  constructor() {
    // Rehydrate snapshots from DB on startup (best-effort, non-blocking)
    this.rehydrateFromDB().catch(err => {
      logger.warn('Failed to rehydrate snapshots from DB on startup', { error: err.message });
    });

    // Start periodic cleanup of expired snapshots (unref'd so it doesn't prevent exit)
    const cleanupInterval = setInterval(() => this.cleanupExpiredSnapshots(), 120_000);
    cleanupInterval.unref?.();
  }

  // ==========================================================================
  // Snapshot Creation
  // ==========================================================================

  /**
   * Create a workspace filesystem snapshot before affinity expires.
   *
   * Tries provider-level checkpoint first (captures everything including caches).
   * Falls back to VFS metadata snapshot (source files + lock file detection).
   *
   * Returns the snapshot if successful, null if snapshotting is disabled or fails.
   */
  async createSnapshot(
    workspaceId: string,
    userId: string,
    sandboxId: string,
    provider: SandboxProviderType,
    workspaceDir: string,
  ): Promise<WorkspaceFSSnapshot | null> {
    if (!this.ENABLED) {
      return null;
    }

    // Prevent duplicate snapshot creation for the same workspace
    if (this.pendingSnapshots.has(workspaceId)) {
      logger.debug('Snapshot creation already in progress', { workspaceId });
      return null;
    }
    this.pendingSnapshots.add(workspaceId);

    try {
      return await this._createSnapshotUnsafe(
        workspaceId, userId, sandboxId, provider, workspaceDir,
      );
    } finally {
      this.pendingSnapshots.delete(workspaceId);
    }
  }

  /**
   * Internal snapshot creation without race-condition guard.
   * Callers should use createSnapshot() which handles dedup.
   */
  private async _createSnapshotUnsafe(
    workspaceId: string,
    userId: string,
    sandboxId: string,
    provider: SandboxProviderType,
    workspaceDir: string,
  ): Promise<WorkspaceFSSnapshot | null> {
    logger.info('Creating workspace FS snapshot', {
      workspaceId,
      provider,
      sandboxId,
    });

    let checkpointId: string | undefined;
    let lockFiles: WorkspaceLockFiles = {};
    let vfsVersion = 0;
    let fileCount = 0;

    // Step 1: Try provider checkpoint (captures full filesystem including caches)
    try {
      const providerObj = await this.getProviderForSandbox(sandboxId);
      if (providerObj) {
        const handle = await providerObj.getSandbox(sandboxId);
        if (handle?.createCheckpoint) {
          const checkpoint = await handle.createCheckpoint(
            `workspacefs-${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          );
          checkpointId = checkpoint?.id;
          logger.info('Provider checkpoint created for workspace snapshot', {
            workspaceId,
            provider,
            checkpointId,
          });
        }
      }
    } catch (err: any) {
      // Provider checkpoints are best-effort — sandbox may already be gone
      logger.debug('Provider checkpoint unavailable for snapshot', {
        workspaceId,
        provider,
        error: err.message,
      });
    }

    // Step 2: Get VFS state (always available — sandboxFilesystemSync pushes here)
    try {
      const vfsSnapshot = await virtualFilesystem.exportWorkspace(userId);
      vfsVersion = vfsSnapshot.version;
      fileCount = vfsSnapshot.files.length;

      // Detect lock files from VFS
      lockFiles = this.detectLockFiles(vfsSnapshot.files.map(f => f.path));
    } catch (err: any) {
      logger.warn('VFS export failed for workspace snapshot', {
        workspaceId,
        error: err.message,
      });
    }

    // Step 3: Try to get cache size estimate from sandbox
    let estimatedCacheSizeBytes: number | undefined;
    try {
      const providerObj = await this.getProviderForSandbox(sandboxId);
      if (providerObj) {
        const handle = await providerObj.getSandbox(sandboxId);
        estimatedCacheSizeBytes = await this.estimateCacheSize(handle, workspaceDir);
      }
    } catch {
      // Best-effort
    }

    // Step 4: Snapshot workspace environment variables
    // Captures env vars so they survive provider migrations and workspace re-binds.
    let envVars: Record<string, string> | undefined;
    try {
      const { getWorkspaceRuntime } = await import('@/lib/terminal/workspace-runtime-service');
      const runtime = getWorkspaceRuntime(workspaceId, userId);
      await runtime.hydrate();
      envVars = runtime.getAllEnv();
      if (Object.keys(envVars).length > 0) {
        logger.debug('Workspace env vars captured in snapshot', {
          workspaceId,
          envCount: Object.keys(envVars).length,
        });
      }
    } catch (err: any) {
      logger.debug('Workspace env vars snapshot skipped (best-effort)', {
        workspaceId,
        error: err.message,
      });
    }

    const snapshot: WorkspaceFSSnapshot = {
      workspaceId,
      userId,
      sourceProvider: provider,
      sourceSandboxId: sandboxId,
      workspaceDir,
      createdAt: Date.now(),
      checkpointId,
      vfsVersion,
      fileCount,
      lockFiles,
      estimatedCacheSizeBytes,
      envVars,
    };

    this.snapshots.set(workspaceId, snapshot);

    // Persist to DB for durability across process restarts
    this.persistSnapshotToDB(snapshot);

    logger.info('Workspace FS snapshot created', {
      workspaceId,
      hasCheckpoint: !!checkpointId,
      vfsVersion,
      fileCount,
      lockFileCount: Object.values(lockFiles).flat().length,
      estimatedCacheMb: estimatedCacheSizeBytes
        ? Math.round(estimatedCacheSizeBytes / (1024 * 1024))
        : undefined,
      envVarCount: Object.keys(envVars || {}).length,
    });

    return snapshot;
  }

  // ==========================================================================
  // Snapshot Restoration
  // ==========================================================================

  /**
   * Restore a workspace filesystem snapshot to a newly-created sandbox.
   *
   * Called when a workspace is re-bound after affinity expiry.
   * 1. If provider checkpoint exists and new provider supports restore: restore it
   * 2. Otherwise: reinstall caches from lock file metadata
   *
   * Returns true if any restoration was performed.
   */
  async restoreSnapshot(
    workspaceId: string,
    handle: SandboxHandle,
    userId: string,
  ): Promise<{ restored: boolean; cacheRestored: boolean }> {
    const snapshot = this.snapshots.get(workspaceId);
    if (!snapshot) {
      return { restored: false, cacheRestored: false };
    }

    logger.info('Restoring workspace FS snapshot', {
      workspaceId,
      snapshotAge: Date.now() - snapshot.createdAt,
      hasCheckpoint: !!snapshot.checkpointId,
      lockFiles: Object.values(snapshot.lockFiles).flat(),
    });

    let cacheRestored = false;

    // Strategy 1: Restore from provider checkpoint (if available and compatible)
    if (snapshot.checkpointId) {
      try {
        if (handle.restoreCheckpoint) {
          await handle.restoreCheckpoint(snapshot.checkpointId);
          cacheRestored = true;
          logger.info('Workspace cache restored via provider checkpoint', {
            workspaceId,
            checkpointId: snapshot.checkpointId,
          });
        }
      } catch (err: any) {
        logger.warn('Provider checkpoint restore failed, falling back to reinstall', {
          workspaceId,
          error: err.message,
        });
      }
    }

    // Strategy 2: Reinstall caches from lock file metadata
    // VFS sync already pushed source files to the sandbox (via sandboxFilesystemSync),
    // so we just need to run install commands to rebuild caches.
    if (!cacheRestored) {
      cacheRestored = await this.reinstallCaches(handle, snapshot);
    }

    // Clean up the snapshot after restoration (one-time use)
    this.snapshots.delete(workspaceId);
    this.deleteSnapshotFromDB(workspaceId);

    // Restore workspace environment variables from snapshot
    if (snapshot.envVars && Object.keys(snapshot.envVars).length > 0) {
      try {
        const { getWorkspaceRuntime } = await import('@/lib/terminal/workspace-runtime-service');
        const runtime = getWorkspaceRuntime(workspaceId, userId);
        await runtime.hydrate();
        for (const [key, value] of Object.entries(snapshot.envVars)) {
          runtime.setEnv(key, value);
        }
        logger.info('Workspace env vars restored from snapshot', {
          workspaceId,
          envCount: Object.keys(snapshot.envVars).length,
        });
      } catch (err: any) {
        logger.warn('Failed to restore workspace env vars from snapshot', {
          workspaceId,
          error: err.message,
        });
      }
    }

    return { restored: true, cacheRestored };
  }

  /**
   * Reinstall caches by running package manager install commands
   * based on detected lock files.
   */
  private async reinstallCaches(
    handle: SandboxHandle,
    snapshot: WorkspaceFSSnapshot,
  ): Promise<boolean> {
    const commands = this.buildInstallCommands(snapshot.lockFiles);
    if (commands.length === 0) {
      logger.debug('No install commands to run for cache restoration', {
        workspaceId: snapshot.workspaceId,
      });
      return false;
    }

    logger.info('Rebuilding caches from lock files', {
      workspaceId: snapshot.workspaceId,
      commands,
    });

    let anySuccess = false;

    for (const cmd of commands) {
      try {          // Run in the workspace directory with a configurable timeout for installs
          const result = await handle.executeCommand(
            cmd,
            snapshot.workspaceDir,
            this.INSTALL_TIMEOUT_MS,
          );

        if (          result.exitCode === 0) {
          logger.info('Cache reinstall succeeded', {
            workspaceId: snapshot.workspaceId,
            command: cmd.slice(0, 60),
          });
          anySuccess = true;
        } else {
          logger.warn('Cache reinstall command had non-zero exit', {
            workspaceId: snapshot.workspaceId,
            command: cmd.slice(0, 60),
            exitCode: result.exitCode,
          });
        }
      } catch (err: any) {
        logger.warn('Cache reinstall command failed', {
          workspaceId: snapshot.workspaceId,
          command: cmd.slice(0, 60),
          error: err.message,
        });
      }
    }

    return anySuccess;
  }

  /**
   * Build ordered install commands from detected lock files.
   * Python first (pip install), then Node (npm install), then others.
   */
  private buildInstallCommands(lockFiles: WorkspaceLockFiles): string[] {
    const commands: string[] = [];
    const used = new Set<string>();

    for (const [lang, toolNames] of Object.entries(lockFiles) as [string, string[]][]) {
      for (const toolName of toolNames) {
        const toolCommands = CACHE_INSTALL_COMMANDS[toolName];
        if (toolCommands && !used.has(toolName)) {
          commands.push(...toolCommands);
          used.add(toolName);
        }
      }
    }

    // Order: pip/conda first (independent of node_modules),
    // then Node (can be largest), then others.
    // All install to separate directories so ordering only affects parallelism, not correctness.
    const pythonCmds = commands.filter(c => c.includes('pip') || c.includes('pipenv'));
    const nodeCmds = commands.filter(c => c.includes('npm') || c.includes('yarn') || c.includes('pnpm') || c.includes('bun'));
    const otherCmds = commands.filter(c => !pythonCmds.includes(c) && !nodeCmds.includes(c));

    return [...pythonCmds, ...nodeCmds, ...otherCmds];
  }

  // ==========================================================================
  // Snapshot Queries
  // ==========================================================================

  /**
   * Check if a workspace has an active snapshot.
   */
  hasSnapshot(workspaceId: string): boolean {
    const snapshot = this.snapshots.get(workspaceId);
    if (!snapshot) return false;
    if (Date.now() - snapshot.createdAt > this.SNAPSHOT_TTL_MS) {
      this.snapshots.delete(workspaceId);
      return false;
    }
    return true;
  }

  /**
   * Get a workspace snapshot if it exists and hasn't expired.
   */
  getSnapshot(workspaceId: string): WorkspaceFSSnapshot | null {
    const snapshot = this.snapshots.get(workspaceId);
    if (!snapshot) return null;
    if (Date.now() - snapshot.createdAt > this.SNAPSHOT_TTL_MS) {
      this.snapshots.delete(workspaceId);
      return null;
    }
    return snapshot;
  }

  /**
   * Delete a workspace snapshot.
   */
  deleteSnapshot(workspaceId: string): void {
    this.snapshots.delete(workspaceId);
    this.deleteSnapshotFromDB(workspaceId);
  }

  /**
   * Get snapshot statistics for monitoring.
   */
  getStats(): {
    activeSnapshots: number;
    withCheckpoints: number;
    totalEstimatedCacheMb: number;
  } {
    let withCheckpoints = 0;
    let totalCacheBytes = 0;

    for (const snapshot of this.snapshots.values()) {
      if (snapshot.checkpointId) withCheckpoints++;
      totalCacheBytes += snapshot.estimatedCacheSizeBytes ?? 0;
    }

    return {
      activeSnapshots: this.snapshots.size,
      withCheckpoints,
      totalEstimatedCacheMb: Math.round(totalCacheBytes / (1024 * 1024)),
    };
  }

  /**
   * Get snapshot configuration for monitoring.
   */
  getConfig(): {
    enabled: boolean;
    ttlMs: number;
    installTimeoutMs: number;
  } {
    return {
      enabled: this.ENABLED,
      ttlMs: this.SNAPSHOT_TTL_MS,
      installTimeoutMs: this.INSTALL_TIMEOUT_MS,
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Detect lock files from a list of file paths.
   */
  private detectLockFiles(paths: string[]): WorkspaceLockFiles {
    const lockFiles: WorkspaceLockFiles = {};

    for (const path of paths) {
      const fileName = path.split('/').pop() || '';
      const match = LOCK_FILE_PATTERNS[fileName];
      if (match) {
        if (!lockFiles[match.lang]) {
          lockFiles[match.lang] = [];
        }
        if (!lockFiles[match.lang]!.includes(match.name)) {
          lockFiles[match.lang]!.push(match.name);
        }
      }
    }

    return lockFiles;
  }

  /**
   * Get provider object for a sandbox ID.
   */
  private async getProviderForSandbox(sandboxId: string): Promise<any> {
    try {
      const providerType = sandboxBridge.inferProviderFromSandboxId(sandboxId);
      if (!providerType) return null;
      return await sandboxBridge.getProvider(providerType);
    } catch {
      return null;
    }
  }

  /**
   * Estimate cache size by running `du` on common cache directories.
   */
  private async estimateCacheSize(
    handle: SandboxHandle,
    workspaceDir: string,
  ): Promise<number | undefined> {
    const cacheDirs = [
      'node_modules',
      '.venv',
      'venv',
      '__pycache__',
      '.cache',
      'vendor',
      'target',
    ];

    const dirList = cacheDirs.map(d => `${workspaceDir}/${d}`).join(' ');

    try {
      const result = await handle.executeCommand(
        `du -sb ${dirList} 2>/dev/null | awk '{sum+=$1} END {print sum+0}'`,
        workspaceDir,
        10_000,
      );

      const bytes = parseInt(result.output?.trim() || '0', 10);
      return bytes > 0 ? bytes : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Periodically clean up expired snapshots to prevent memory leaks.
   * Also prunes expired rows from the DB.
   */
  private cleanupExpiredSnapshots(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [workspaceId, snapshot] of this.snapshots.entries()) {
      if (now - snapshot.createdAt > this.SNAPSHOT_TTL_MS) {
        this.snapshots.delete(workspaceId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired workspace snapshots', { cleaned });
    }

    // Also prune expired snapshots from the DB
    this.pruneExpiredSnapshotsFromDB();
  }

  // ==========================================================================
  // DB Persistence (Migration 025: workspace_snapshots table)
  // ==========================================================================

  /**
   * Rehydrate snapshots from DB on startup.
   * Best-effort — silently skips if the table doesn't exist yet or the DB
   * is unavailable.
   */
  private async rehydrateFromDB(): Promise<void> {
    try {
      const db = getDatabase();
      if (!db) return;

      const now = Date.now();
      const rows = db.prepare(
        `SELECT workspace_id, user_id, source_provider, source_sandbox_id,
                workspace_dir, created_at, checkpoint_id, vfs_version,
                file_count, lock_files_json, estimated_cache_bytes, env_vars_json
         FROM workspace_snapshots
         WHERE expires_at > ?`
      ).all(now) as Array<{
        workspace_id: string;
        user_id: string;
        source_provider: string;
        source_sandbox_id: string;
        workspace_dir: string;
        created_at: number;
        checkpoint_id: string | null;
        vfs_version: number;
        file_count: number;
        lock_files_json: string;
        estimated_cache_bytes: number | null;
        env_vars_json: string | null;
      }>;

      for (const row of rows) {
        let lockFiles: WorkspaceLockFiles = {};
        try { lockFiles = JSON.parse(row.lock_files_json); } catch { /* default */ }

        let envVars: Record<string, string> | undefined;
        try { envVars = row.env_vars_json ? JSON.parse(row.env_vars_json) : undefined; } catch { /* default */ }

        const snapshot: WorkspaceFSSnapshot = {
          workspaceId: row.workspace_id,
          userId: row.user_id,
          sourceProvider: row.source_provider as SandboxProviderType,
          sourceSandboxId: row.source_sandbox_id,
          workspaceDir: row.workspace_dir,
          createdAt: row.created_at,
          checkpointId: row.checkpoint_id ?? undefined,
          vfsVersion: row.vfs_version,
          fileCount: row.file_count,
          lockFiles,
          estimatedCacheSizeBytes: row.estimated_cache_bytes ?? undefined,
          envVars,
        };

        this.snapshots.set(snapshot.workspaceId, snapshot);
      }

      if (rows.length > 0) {
        logger.info('Rehydrated workspace snapshots from DB', { count: rows.length });
      }
    } catch (err: any) {
      // Table may not exist yet (migration not yet run) — silent skip
      if (!err.message?.includes('no such table')) {
        logger.warn('Failed to rehydrate snapshots from DB', { error: err.message });
      }
    }
  }

  /**
   * Persist a snapshot to the workspace_snapshots DB table.
   * Best-effort — non-critical for operation.
   */
  private persistSnapshotToDB(snapshot: WorkspaceFSSnapshot): void {
    try {
      const db = getDatabase();
      if (!db) return;

      const expiresAt = snapshot.createdAt + this.SNAPSHOT_TTL_MS;

      db.prepare(`
        INSERT OR REPLACE INTO workspace_snapshots
          (workspace_id, user_id, source_provider, source_sandbox_id,
           workspace_dir, created_at, checkpoint_id, vfs_version,
           file_count, lock_files_json, estimated_cache_bytes, env_vars_json, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.workspaceId,
        snapshot.userId,
        snapshot.sourceProvider,
        snapshot.sourceSandboxId,
        snapshot.workspaceDir,
        snapshot.createdAt,
        snapshot.checkpointId ?? null,
        snapshot.vfsVersion,
        snapshot.fileCount,
        JSON.stringify(snapshot.lockFiles),
        snapshot.estimatedCacheSizeBytes ?? null,
        snapshot.envVars ? JSON.stringify(snapshot.envVars) : null,
        expiresAt,
      );
    } catch (err: any) {
      if (err.message?.includes('no such table')) return;
      logger.warn('Failed to persist snapshot to DB', {
        workspaceId: snapshot.workspaceId,
        error: err.message,
      });
    }
  }

  /**
   * Delete a snapshot from the DB.
   */
  private deleteSnapshotFromDB(workspaceId: string): void {
    try {
      const db = getDatabase();
      if (!db) return;
      db.prepare('DELETE FROM workspace_snapshots WHERE workspace_id = ?').run(workspaceId);
    } catch {
      // Best-effort
    }
  }

  /**
   * Prune expired snapshots from the DB.
   */
  private pruneExpiredSnapshotsFromDB(): void {
    try {
      const db = getDatabase();
      if (!db) return;
      const result = db.prepare(
        'DELETE FROM workspace_snapshots WHERE expires_at <= ?'
      ).run(Date.now());
      if (result.changes > 0) {
        logger.debug('Pruned expired snapshots from DB', { count: result.changes });
      }
    } catch {
      // Best-effort
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceFSSnapshotService = new WorkspaceFSSnapshotService();
