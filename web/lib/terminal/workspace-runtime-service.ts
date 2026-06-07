/**
 * Workspace Runtime Service
 *
 * Unified service that owns all workspace runtime state:
 * processes, services, ports, and environment variables.
 *
 * Wraps the three existing registries (VirtualPidRegistry,
 * WorkspaceServiceManager, WorkspacePreviewRegistry) and adds
 * DB persistence for workspace_env (env vars).
 *
 * Usage:
 *   import { getWorkspaceRuntime } from '@/lib/terminal/workspace-runtime-service';
 *
 *   const runtime = getWorkspaceRuntime('ws-abc', 'user-123');
 *   const state = runtime.getWorkspaceState();  // full aggregate
 *   runtime.setEnv('FOO', 'bar');
 *   runtime.buildShellEnv();  // ['export FOO=bar', ...]
 *
 * @see lib/terminal/virtual-pid-registry.ts — Process registry (has its own DB sync)
 * @see lib/terminal/workspace-service-manager.ts — Service manager (DB sync added via rehydrate)
 * @see lib/terminal/workspace-preview-registry.ts — Preview registry (DB sync added via rehydrate)
 */

import { createLogger } from '@/lib/utils/logger';
import { EventEmitter } from 'events';
import { getDatabase } from '@/lib/database/connection';
import { virtualPidRegistry } from './virtual-pid-registry';
import { workspaceServiceManager, type WorkspaceService, type ServiceStatus } from './workspace-service-manager';
import { workspacePreviewRegistry, type WorkspacePreview, type PreviewStatus } from './workspace-preview-registry';
import type { PidMapping } from './virtual-pid-registry';
import { getSecretBroker } from '@/lib/sandbox/secret-broker';
import { workspaceJobManager } from './workspace-job-manager';

const logger = createLogger('WorkspaceRuntime');

// ============================================================================
// Types
// ============================================================================

/** Full aggregate state of a workspace — primary AI agent query API */
export interface WorkspaceRuntimeState {
  workspaceId: string;
  userId: string;
  processes: PidMapping[];
  services: WorkspaceService[];
  previews: WorkspacePreview[];
  env: Record<string, string>;
  stats: {
    processCount: number;
    serviceCount: number;
    runningCount: number;
    previewCount: number;
  };
}

// ============================================================================
// Workspace Runtime Service
// ============================================================================

export class WorkspaceRuntimeService extends EventEmitter {
  readonly workspaceId: string;
  readonly userId: string;

  /** Virtual PID registry (delegated — already has its own DB sync) */
  readonly pids: typeof virtualPidRegistry;

  /** Service manager (delegated — DB sync added here) */
  readonly services: typeof workspaceServiceManager;

  /** Preview registry (delegated — DB sync added here) */
  readonly previews: typeof workspacePreviewRegistry;

  /** In-memory env cache (backed by workspace_env table) */
  private envCache = new Map<string, string>();

  /** Whether this instance has been hydrated from DB */
  private hydrated = false;

  constructor(workspaceId: string, userId: string) {
    super();
    this.workspaceId = workspaceId;
    this.userId = userId;
    this.pids = virtualPidRegistry;
    this.services = workspaceServiceManager;
    this.previews = workspacePreviewRegistry;
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  /**
   * Rehydrate all state from DB.
   * Idempotent — safe to call multiple times.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;

    try {
      // VirtualPidRegistry auto-hydrates on first getProcessList() call
      // WorkspaceServiceManager needs explicit rehydrate call (new method added)
      // WorkspacePreviewRegistry needs explicit rehydrate call (new method added)
      this.services.rehydrate(this.workspaceId);
      this.previews.rehydrate(this.workspaceId);
      this.loadEnvFromDb();
      // Rehydrate background jobs (fire-and-forget, logged internally)
      workspaceJobManager.rehydrate(this.workspaceId).catch((err: any) => {
        logger.warn('Job rehydration failed for workspace', {
          workspaceId: this.workspaceId.slice(0, 16),
          error: err.message,
        });
      });
      this.hydrated = true;
      this.emit('workspace:hydrated', {
        workspaceId: this.workspaceId,
        userId: this.userId,
      });
      this.notifyGraphChanged();
      logger.debug('Workspace runtime hydrated', {
        workspaceId: this.workspaceId.slice(0, 16),
        services: this.services.listServices(this.workspaceId).length,
        previews: this.previews.getWorkspacePreviews(this.workspaceId).length,
        envVars: this.envCache.size,
      });
    } catch (error: any) {
      logger.warn('Workspace runtime hydration failed', {
        workspaceId: this.workspaceId.slice(0, 16),
        error: error.message,
      });
    }
  }

  // ========================================================================
  // Aggregate — getWorkspaceState()  (PRIMARY AI AGENT API)
  // ========================================================================

  /** Get the full runtime state of this workspace. */
  getWorkspaceState(): WorkspaceRuntimeState {
    const services = this.services.listServices(this.workspaceId);
    const previews = this.previews.getWorkspacePreviews(this.workspaceId);
    const processes = this.pids.getProcessList(this.workspaceId);

    return {
      workspaceId: this.workspaceId,
      userId: this.userId,
      processes,
      services,
      previews,
      env: Object.fromEntries(this.envCache),
      stats: {
        processCount: processes.length,
        serviceCount: services.length,
        runningCount: services.filter(s => s.status === 'running').length,
        previewCount: this.previews.getActivePreviews(this.workspaceId).length,
      },
    };
  }

  // ========================================================================
  // Environment Variables — workspace_env table
  // ========================================================================

  /** Set a workspace-scoped environment variable. Persists to DB. */
  setEnv(key: string, value: string): void {
    this.envCache.set(key, value);
    this.syncEnvToDb(key, value, false);
    this.emit('workspace:env:set', {
      workspaceId: this.workspaceId,
      key,
      isSecret: false,
    });
    this.notifyGraphChanged();
  }

  /**
   * Set a workspace-scoped secret environment variable.
   * The value is encrypted in the SecretBroker and a placeholder reference
   * is stored in the env cache. The real value never appears in:
   * - Sandbox env vars (replaced by __SB__KEY__ placeholder)
   * - Log output
   * - Error messages
   * - Shell $env introspection inside the sandbox
   */
  async setSecret(key: string, value: string): Promise<void> {
    const broker = getSecretBroker();
    await broker.setSecret(key, value, { ownerId: this.userId });
    // Store the placeholder reference in the env cache
    this.envCache.set(key, `__SB__${key}__`);
    this.syncEnvToDb(key, `__SB__${key}__`, true);
    this.emit('workspace:env:set', {
      workspaceId: this.workspaceId,
      key,
      isSecret: true,
    });
    this.notifyGraphChanged();
    logger.debug('Secret env var stored via SecretBroker', { key });
  }

  /** Get a workspace-scoped environment variable. */
  getEnv(key: string): string | undefined {
    return this.envCache.get(key);
  }

  /** Get all workspace-scoped environment variables. */
  getAllEnv(): Record<string, string> {
    return Object.fromEntries(this.envCache);
  }

  /** Remove a workspace-scoped environment variable. */
  unsetEnv(key: string): void {
    this.envCache.delete(key);
    this.deleteEnvFromDb(key);
    this.emit('workspace:env:unset', {
      workspaceId: this.workspaceId,
      key,
    });
    this.notifyGraphChanged();
  }

  /**
   * Environment variables that should NOT be overridable via workspace_env.
   * These are critical for shell operation and security.
   */
  private static readonly CRITICAL_ENV_VARS = new Set([
    'PATH',
    'HOME',
    'SHELL',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'PWD',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
  ]);

  /**
   * Build environment variable declarations for shell injection.
   * Returns an array of `export KEY=VALUE` lines.
   * Skips critical shell variables (PATH, HOME, SHELL, etc.) for security.
   */
  buildShellEnv(): string[] {
    return Array.from(this.envCache.entries())
      .filter(([k]) => !WorkspaceRuntimeService.CRITICAL_ENV_VARS.has(k))
      .map(([k, v]) => {
        // Shell-escape the value using single quotes
        const escaped = v.replace(/'/g, "'\\''");
        return `export ${k}='${escaped}'`;
      });
  }

  /**
   * Build a shell init script that sets all workspace env vars.
   * This can be sourced in a new PTY session to rehydrate env.
   */
  buildShellInitScript(): string {
    const lines = this.buildShellEnv();
    if (lines.length === 0) return '';
    // Use a header comment to indicate these are workspace-scoped env vars
    return '# Workspace environment variables\n' + lines.join('\n') + '\n';
  }

  /**
   * Notify the workspace graph that runtime state has changed.
   * Uses lazy import to avoid circular dependencies.
   */
  private notifyGraphChanged(): void {
    import('@/lib/workspace/workspace-graph-service')
      .then(({ workspaceGraphService }) => workspaceGraphService.notifyGraphChanged(this.workspaceId))
      .catch(() => { /* Best-effort */ });
  }

  /**
   * Dispose of this runtime instance — clears in-memory cache
   * and cleans up PID registry entries for the workspace.
   */
  dispose(): void {
    // Clean up PID registry entries for this workspace
    try {
      // Copy the list before iterating — unregisterProcess mutates the registry
      const processes = [...this.pids.getProcessList(this.workspaceId)];
      for (const p of processes) {
        try {
          this.pids.unregisterProcess(this.workspaceId, p.vPid);
        } catch {
          // Best-effort — some entries may already be removed
        }
      }
    } catch {
      // PID registry cleanup is best-effort
    }

    this.envCache.clear();
    this.emit('workspace:disposed', {
      workspaceId: this.workspaceId,
      userId: this.userId,
    });
    this.notifyGraphChanged();
    this.removeAllListeners();
  }

  // ========================================================================
  // DB persistence — Environment Variables
  // ========================================================================

  private syncEnvToDb(key: string, value: string, isSecret: boolean = false): void {
    try {
      const db = getDatabase();
      if (!db) return;
      db.prepare(`
        INSERT OR REPLACE INTO workspace_env (workspace_id, key, value, is_secret, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(this.workspaceId, key, value, isSecret ? 1 : 0, Date.now());
    } catch (error: any) {
      logger.warn('Failed to sync env to DB', {
        key,
        error: error.message,
      });
    }
  }

  private deleteEnvFromDb(key: string): void {
    try {
      const db = getDatabase();
      if (!db) return;
      db.prepare(
        'DELETE FROM workspace_env WHERE workspace_id = ? AND key = ?'
      ).run(this.workspaceId, key);
    } catch (error: any) {
      logger.warn('Failed to delete env from DB', {
        key,
        error: error.message,
      });
    }
  }

  private loadEnvFromDb(): void {
    try {
      const db = getDatabase();
      if (!db) return;
      const rows = db.prepare(
        'SELECT key, value FROM workspace_env WHERE workspace_id = ?'
      ).all(this.workspaceId) as Array<{ key: string; value: string }>;

      for (const row of rows) {
        this.envCache.set(row.key, row.value);
      }
    } catch (error: any) {
      logger.warn('Failed to load env from DB', {
        workspaceId: this.workspaceId.slice(0, 16),
        error: error.message,
      });
    }
  }
}

// ============================================================================
// Singleton factory — one runtime per workspace
// ============================================================================

const runtimeInstances = new Map<string, WorkspaceRuntimeService>();

/**
 * Get or create the WorkspaceRuntimeService for a given workspace+user.
 * Automatically hydrates on first access.
 *
 * @param workspaceId - Uniquely identifies the workspace (e.g., `${userId}:${sessionId}`)
 * @param userId - The user who owns the workspace
 */
export function getWorkspaceRuntime(
  workspaceId: string,
  userId: string,
): WorkspaceRuntimeService {
  let runtime = runtimeInstances.get(workspaceId);
  if (!runtime) {
    runtime = new WorkspaceRuntimeService(workspaceId, userId);
    runtimeInstances.set(workspaceId, runtime);

    // Auto-hydrate on first access (non-blocking)
    runtime.hydrate().catch(err => {
      logger.warn('Auto-hydration failed for workspace runtime', {
        workspaceId: workspaceId.slice(0, 16),
        error: err.message,
      });
    });
  }
  return runtime;
}

/**
 * Clear a runtime instance from the singleton cache (for cleanup).
 */
export function clearWorkspaceRuntime(workspaceId: string): void {
  const runtime = runtimeInstances.get(workspaceId);
  if (runtime) {
    runtime.dispose();
    runtimeInstances.delete(workspaceId);
  }
}

/**
 * Clean up workspace runtime state (services, previews, env) for a workspace.
 * This removes all DB rows and in-memory state for the given workspace.
 */
export async function cleanupWorkspaceRuntimeState(workspaceId: string, userId: string): Promise<void> {
  const runtime = runtimeInstances.get(workspaceId);
  if (runtime) {
    try {
      runtime.services.clearWorkspace(workspaceId);
      runtime.previews.clearWorkspace(workspaceId);
      await workspaceJobManager.clearWorkspace(workspaceId);

      // Clear workspace_env from DB
      const db = (await import('@/lib/database/connection')).getDatabase();
      if (db) {
        db.prepare('DELETE FROM workspace_env WHERE workspace_id = ?').run(workspaceId);
        db.prepare('DELETE FROM workspace_processes WHERE workspace_id = ?').run(workspaceId);
      }
    } catch (error: any) {
      logger.warn('Failed to clean up workspace runtime state', {
        workspaceId: workspaceId.slice(0, 16),
        error: error.message,
      });
    }

    clearWorkspaceRuntime(workspaceId);
  }
}
