/**
 * Workspace Control Plane — Unified 10-Phase Lifecycle API
 *
 * The WorkspaceControlPlane wraps all 10 workstation architecture phases
 * into a single facade that exposes workspaces as first-class objects with
 * clear lifecycle methods:
 *
 *   create → bind → restore → start → destroy
 *
 * Instead of ad-hoc imports scattered across the codebase, the control plane
 * provides the canonical entry point for workspace orchestration.
 *
 * Phase mapping:
 *   Phase 1  — Shared-VM Hardening     (applied at PTY level, not per-workspace)
 *   Phase 2  — Runtime Service         (WorkspaceRuntimeService)
 *   Phase 3  — Virtual PID Registry    (virtualPidRegistry)
 *   Phase 4  — Services from Processes (WorkspaceServiceManager)
 *   Phase 5  — R2 + CAS Storage        (ContentAddressableStorage)
 *   Phase 6  — Runtime Affinity        (SandboxOrchestrator affinity)
 *   Phase 7  — Environment Images      (WorkspaceImageRegistry + WorkspaceFSSnapshot)
 *   Phase 8  — Runtime Broker          (RuntimeBroker + SandboxOrchestrator)
 *   Phase 9  — WorkspaceFS             (VirtualFilesystemService)
 *   Phase 10 — AI-Native Workspace Graph (WorkspaceGraphService)
 *
 * Usage:
 *   import { workspaceControlPlane } from '@/lib/workspace/workspace-control-plane';
 *
 *   const handle = await workspaceControlPlane.create('ws-123', 'user-456');
 *   const graph = handle.getGraph();
 *   await handle.startService('npm run dev', '/workspace/app');
 *   await handle.destroy();
 *
 * @see lib/sandbox/sandbox-orchestrator.ts — Provider binding & execution
 * @see lib/terminal/workspace-runtime-service.ts — Runtime state aggregation
 * @see lib/workspace/workspace-graph-service.ts — Graph queries
 * @see lib/sandbox/workspacefs-snapshot-service.ts — Snapshot persistence
 */

import { EventEmitter } from 'events';
import { createLogger } from '@/lib/utils/logger';

// Phase 2: Runtime Service
import {
  getWorkspaceRuntime,
  cleanupWorkspaceRuntimeState,
  type WorkspaceRuntimeState,
} from '@/lib/terminal/workspace-runtime-service';

// Phase 4: Service Manager
import {
  workspaceServiceManager,
  type WorkspaceService,
} from '@/lib/terminal/workspace-service-manager';

// Phase 6: Affinity + Orchestration
import {
  sandboxOrchestrator,
  type OrchestratorSession,
  type MigrationResult,
} from '@/lib/sandbox/sandbox-orchestrator';

// Phase 7: Snapshot Service
import {
  workspaceFSSnapshotService,
  type WorkspaceFSSnapshot,
} from '@/lib/sandbox/workspacefs-snapshot-service';

// Phase 8: Runtime Broker (lazy-imported in initialize(), not at top level)

// Phase 9: VFS
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync';

// Phase 10: Workspace Graph
import { workspaceGraphService, type WorkspaceGraph } from './workspace-graph-service';

// Session Graph
import { workspaceSessionGraph } from './workspace-session-graph';

// Types
import type { SandboxProviderType } from '@/lib/sandbox/providers';
import type { AffinityBinding } from '@/lib/sandbox/sandbox-orchestrator';
import type { ExecutionPolicy } from '@/lib/sandbox/types';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';

const logger = createLogger('WorkspaceControlPlane');

// ============================================================================
// Types
// ============================================================================

/** Workspace lifecycle phase */
export type LifecyclePhase =
  | 'created'
  | 'binding'
  | 'bound'
  | 'restoring'
  | 'ready'
  | 'migrating'
  | 'snapshotting'
  | 'destroying'
  | 'destroyed'
  | 'error';

/** Options for creating a new workspace */
export interface WorkspaceCreateOptions {
  /** Phase 6: Override the provider selection (bypasses runtime broker) */
  provider?: SandboxProviderType;
  /** Phase 7: Named environment image to restore */
  image?: string;
  /** Phase 2: Initial environment variables */
  env?: Record<string, string>;
  /** Phase 9: Template workspace to clone VFS from */
  template?: string;
  /** Phase 7: Snapshot ID to restore from */
  restoreSnapshot?: string;
  /** Phase 8: Execution policy for the workspace */
  policy?: ExecutionPolicy;
  /** Conversation ID for sandbox orchestration */
  conversationId?: string;
}

/** Handle returned after workspace creation — the primary interaction point */
export interface WorkspaceHandle {
  /** Unique workspace identifier */
  readonly workspaceId: string;
  /** Owning user ID */
  readonly userId: string;
  /** Current lifecycle phase */
  readonly phase: LifecyclePhase;

  // === Phase 6: Provider binding ===
  /** The provider currently serving this workspace */
  readonly provider: SandboxProviderType | null;
  /** The sandbox ID on the current provider */
  readonly sandboxId: string | null;
  /** The workspace directory on the provider */
  readonly workspaceDir: string | null;

  // === Phase 2: Runtime state ===
  /** Get full runtime state (processes, services, previews, env) */
  getState(): WorkspaceRuntimeState;
  /** Get or set a workspace-scoped env var */
  getEnv(key: string): string | undefined;
  setEnv(key: string, value: string): void;
  /** Build shell env export lines for PTY injection */
  buildShellEnv(): string[];

  // === Phase 10: Graph ===
  /** Get the full workspace graph (AI-native state view) */
  getGraph(): WorkspaceGraph;

  // === Phase 4: Services ===
  /** Start a long-running service (npm run dev, python server.py, etc.) */
  startService(command: string, workingDir: string): WorkspaceService;
  /** List all workspace services */
  listServices(): WorkspaceService[];

  // === Phase 6: Affinity ===
  /** Get the current affinity binding, if active */
  getAffinity(): AffinityBinding | null;

  // === Phase 7: VFS Owner Resolution ===
  /**
   * True if this handle was constructed with an authoritative
   * FilesystemOwnerResolution captured at handle creation time
   * (from an API route caller that had a NextRequest in scope).
   * When false, the handle will fall back to the session lookup
   * for the ownerId when _ensureSession() is invoked.
   */
  hasOwnerResolution(): boolean;

  // === Phase 8: Snapshots ===
  /** Create a workspace filesystem snapshot */
  snapshot(): Promise<WorkspaceFSSnapshot | null>;
  /** Check if a snapshot exists for this workspace */
  hasSnapshot(): boolean;

  // === Phase 8: Execution ===
  /** Execute a command in the bound sandbox */
  execute(
    command: string,
    options?: { timeout?: number },
  ): Promise<{ output: string; exitCode: number; duration: number }>;

  // === Lifecycle ===
  /** Migrate the workspace to the optimal alternative provider */
  migrate(): Promise<MigrationResult>;
  /** Destroy the workspace and release all resources */
  destroy(): Promise<void>;
}

/** State of the control plane overall */
export interface ControlPlaneState {
  /** Number of active workspace handles */
  activeWorkspaces: number;
  /** Workspace IDs currently managed */
  workspaceIds: string[];
  /** Affinity statistics */
  affinity: ReturnType<typeof sandboxOrchestrator.getAffinityStats>;
  /** Snapshot statistics */
  snapshots: ReturnType<typeof workspaceFSSnapshotService.getStats>;
  /** Initialized phase services */
  phases: {
    affinity: boolean;
    snapshots: boolean;
    broker: boolean;
    vfs: boolean;
    graph: boolean;
  };
}

// ============================================================================
// WorkspaceHandle Implementation
// ============================================================================

class WorkspaceHandleImpl implements WorkspaceHandle {
  readonly workspaceId: string;
  readonly userId: string;
  phase: LifecyclePhase = 'created';

  // Package-private: accessible by WorkspaceControlPlane for lifecycle management.
  // Not exposed on the public WorkspaceHandle interface.
  /** @internal */ _provider: SandboxProviderType | null = null;
  /** @internal */ _sandboxId: string | null = null;
  /** @internal */ _workspaceDir: string | null = null;
  /** @internal */ _orchestratorSession: OrchestratorSession | null = null;
  /**
   * Pre-resolved FilesystemOwnerResolution from the API route caller,
   * threaded through create() and stored on the handle so the lazy
   * `_ensureSession()` call can pass it to the orchestrator. Captured
   * at handle creation (when request context is available) and used
   * for the lifetime of the handle.
   */
  private readonly ownerResolution: FilesystemOwnerResolution | undefined;

  constructor(
    workspaceId: string,
    userId: string,
    private readonly parent: WorkspaceControlPlane,
    ownerResolution?: FilesystemOwnerResolution,
  ) {
    this.workspaceId = workspaceId;
    this.userId = userId;
    this.ownerResolution = ownerResolution;
  }

  // ========================================================================
  // Getters
  // ========================================================================

  get provider(): SandboxProviderType | null { return this._provider; }
  get sandboxId(): string | null { return this._sandboxId; }
  get workspaceDir(): string | null { return this._workspaceDir; }

  // ========================================================================
  // Phase 2: Runtime State
  // ========================================================================

  getState(): WorkspaceRuntimeState {
    const runtime = getWorkspaceRuntime(this.workspaceId, this.userId);
    return runtime.getWorkspaceState();
  }

  getEnv(key: string): string | undefined {
    const runtime = getWorkspaceRuntime(this.workspaceId, this.userId);
    return runtime.getEnv(key);
  }

  setEnv(key: string, value: string): void {
    const runtime = getWorkspaceRuntime(this.workspaceId, this.userId);
    runtime.setEnv(key, value);
  }

  buildShellEnv(): string[] {
    const runtime = getWorkspaceRuntime(this.workspaceId, this.userId);
    return runtime.buildShellEnv();
  }

  // ========================================================================
  // Phase 10: Workspace Graph
  // ========================================================================

  getGraph(): WorkspaceGraph {
    return workspaceGraphService.getWorkspaceGraph(this.workspaceId);
  }

  // ========================================================================
  // Phase 4: Services
  // ========================================================================

  startService(command: string, workingDir: string): WorkspaceService {
    return workspaceServiceManager.createService(
      this.workspaceId,
      this.userId,
      command,
      workingDir,
    );
  }

  listServices(): WorkspaceService[] {
    return workspaceServiceManager.listServices(this.workspaceId);
  }

  // ========================================================================
  // Phase 6: Affinity
  // ========================================================================

  getAffinity(): AffinityBinding | null {
    return sandboxOrchestrator.getAffinity(this.workspaceId);
  }

  // ========================================================================
  // Phase 7: VFS Owner Resolution
  // ========================================================================

  hasOwnerResolution(): boolean {
    return !!this.ownerResolution;
  }

  // ========================================================================
  // Phase 8: Snapshots
  // ========================================================================

  async snapshot(): Promise<WorkspaceFSSnapshot | null> {
    return workspaceFSSnapshotService.createSnapshot(
      this.workspaceId,
      this.userId,
      this._sandboxId || this.workspaceId,
      this._provider || 'daytona',
      this._workspaceDir || `/workspace/users/${this.userId}/workspaces/${this.workspaceId}`,
    );
  }

  hasSnapshot(): boolean {
    return workspaceFSSnapshotService.hasSnapshot(this.workspaceId);
  }

  // ========================================================================
  // Phase 9: Execution
  // ========================================================================

  async execute(
    command: string,
    options?: { timeout?: number },
  ): Promise<{ output: string; exitCode: number; duration: number }> {
    // Phase 8: Use the orchestrator for execution (it handles affinity,
    // resource thresholds, escalation, and workspace replay automatically)
    const session = await this._ensureSession();
    return sandboxOrchestrator.executeInSandbox(session.sessionId, command, options);
  }

  // ========================================================================
  // Lifecycle: Migration
  // ========================================================================

  async migrate(): Promise<MigrationResult> {
    this.phase = 'migrating';
    logger.info('Workspace migration initiated', {
      workspaceId: this.workspaceId,
      fromProvider: this._provider,
    });

    try {
      // sandboxOrchestrator.migrateSession() handles snapshotting internally —
      // it snapshots the workspace FS from the old provider, creates a new
      // sandbox on the optimal target provider, restores the snapshot, and
      // restarts running services. No manual snapshot needed here.
      const result = await sandboxOrchestrator.migrateSession(
        this._orchestratorSession?.logicalId || this.workspaceId,
        'policy_change',
      );

      if (result.success) {
        // Update our state to reflect the new provider
        const newSession = await sandboxOrchestrator.getSession(
          this._orchestratorSession?.logicalId || this.workspaceId,
        );
        if (newSession) {
          this._orchestratorSession = newSession;
          this._provider = result.toProvider as SandboxProviderType;
          this._sandboxId = newSession.sessionId;
          this._workspaceDir = newSession.handle.workspaceDir;
        }

        // Rehydrate runtime state on the new provider
        const runtime = getWorkspaceRuntime(this.workspaceId, this.userId);
        await runtime.hydrate();
      }

      this.phase = 'ready';
      logger.info('Workspace migration completed', {
        workspaceId: this.workspaceId,
        success: result.success,
        duration: result.duration,
      });

      return result;
    } catch (err: any) {
      this.phase = 'error';
      logger.error('Workspace migration failed', {
        workspaceId: this.workspaceId,
        error: err.message,
      });
      return {
        success: false,
        fromProvider: this._provider || 'unknown',
        toProvider: 'unknown',
        reason: 'policy_change',
        duration: 0,
        error: err.message,
      };
    }
  }

  // ========================================================================
  // Lifecycle: Destroy
  // ========================================================================

  async destroy(): Promise<void> {
    this.phase = 'destroying';
    logger.info('Destroying workspace', {
      workspaceId: this.workspaceId,
      userId: this.userId,
    });

    const errors: string[] = [];

    // Phase 6: Evict affinity binding so the workspace is no longer
    // pinned to a provider. Must happen before sandbox teardown.
    try {
      sandboxOrchestrator.evictAffinity(this.workspaceId);
    } catch (err: any) {
      errors.push(`Affinity eviction: ${err.message}`);
    }

    // Phase 9: Stop VFS→sandbox sync for the active sandbox
    try {
      if (this._sandboxId) {
        sandboxFilesystemSync.stopSync(this._sandboxId);
      }
    } catch (err: any) {
      errors.push(`VFS sync stop: ${err.message}`);
    }

    // Phase 4: Stop all services (clears registries, health monitors, previews)
    try {
      workspaceServiceManager.clearWorkspace(this.workspaceId);
    } catch (err: any) {
      errors.push(`Service cleanup: ${err.message}`);
    }

    // Phase 7: Delete any snapshots (in-memory + DB)
    try {
      workspaceFSSnapshotService.deleteSnapshot(this.workspaceId);
    } catch (err: any) {
      errors.push(`Snapshot cleanup: ${err.message}`);
    }

    // Phase 2: Clear runtime state (env vars, processes, jobs from DB)
    try {
      await cleanupWorkspaceRuntimeState(this.workspaceId, this.userId);
    } catch (err: any) {
      errors.push(`Runtime cleanup: ${err.message}`);
    }

    // Phase 10: Close all session graph entries for this workspace
    try {
      workspaceSessionGraph.closeWorkspaceSessions(this.workspaceId);
    } catch (err: any) {
      errors.push(`Session graph cleanup: ${err.message}`);
    }

    if (errors.length > 0) {
      logger.warn('Workspace destruction completed with errors', {
        workspaceId: this.workspaceId,
        errors,
      });
    } else {
      logger.info('Workspace destroyed successfully', {
        workspaceId: this.workspaceId,
      });
    }

    this.phase = 'destroyed';
    this.parent._removeHandle(this.workspaceId);
  }

  // ========================================================================
  // Internal: Session Management
  // ========================================================================

  /**
   * Ensure we have an active orchestrator session for this workspace.
   * Creates one lazily if needed.
   */
  private async _ensureSession(): Promise<OrchestratorSession> {
    if (this._orchestratorSession) {
      return this._orchestratorSession;
    }

    this._orchestratorSession = await sandboxOrchestrator.getSandbox({
      userId: this.userId,
      conversationId: this.workspaceId,
      task: 'general',
      policy: 'sandbox-preferred',
      ownerResolution: this.ownerResolution,
    });

    this._provider = this._orchestratorSession.provider;
    this._sandboxId = this._orchestratorSession.sessionId;
    this._workspaceDir = this._orchestratorSession.handle.workspaceDir;

    return this._orchestratorSession;
  }
}

// ============================================================================
// WorkspaceControlPlane
// ============================================================================

export class WorkspaceControlPlane extends EventEmitter {
  /** Active workspace handles, keyed by workspaceId */
  private handles = new Map<string, WorkspaceHandleImpl>();
  /** Whether the control plane has been initialized */
  private initialized = false;

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the control plane and all underlying phase services.
   * Idempotent — safe to call multiple times.
   *
   * Called once at application startup. Ensures all singletons are
   * constructed and background timers (cleanup, health, sync) are running.
   */
  async initialize(): Promise<ControlPlaneState> {
    if (this.initialized) {
      return this.getState();
    }

    logger.info('Initializing WorkspaceControlPlane');

    const errors: string[] = [];

    // Phase 5 (CAS): Initialize content-addressable storage
    try {
      const { getContentAddressableStorage } = await import(
        '@/lib/storage/content-addressable-storage'
      );
      await getContentAddressableStorage().initialize();
      logger.info('Phase 5 initialized: Content-Addressable Storage');
    } catch (err: any) {
      errors.push(`Phase 5: ${err.message}`);
      logger.warn('Phase 5 initialization deferred', err.message);
    }

    // Phase 8 (Runtime Broker): Initialize the cost/latency/capacity-aware scheduler
    try {
      const { getRuntimeBroker } = await import('@/lib/sandbox/runtime-broker');
      await getRuntimeBroker().initialize();
      logger.info('Phase 8 initialized: Runtime Broker');
    } catch (err: any) {
      errors.push(`Phase 8: ${err.message}`);
      logger.warn('Phase 8 initialization deferred', err.message);
    }

    // Phase 7 (Environment Images): Pre-build cached images
    try {
      const { workspaceImageRegistry } = await import(
        '@/lib/sandbox/workspace-image-registry'
      );
      logger.info('Phase 7 initialized: Environment Images', {
        enabled: workspaceImageRegistry.isEnabled(),
      });
    } catch (err: any) {
      errors.push(`Phase 7: ${err.message}`);
    }

    // Phase 6 (Affinity): Affinity cleanup timer starts on orchestrator construction
    // The SandboxOrchestrator singleton is already created via import at module level
    try {
      const config = sandboxOrchestrator.getAffinityConfig();
      logger.info('Phase 6 initialized: Workspace Affinity', {
        enabled: config.enabled,
        ttlMs: config.ttlMs,
      });
    } catch (err: any) {
      errors.push(`Phase 6: ${err.message}`);
    }

    // Phase 9 (WorkspaceFS): R2 + VFS + sandbox sync layer
    try {
      const { workspaceFSSyncService } = await import(
        '@/lib/sandbox/workspacefs-sync-service'
      );
      const r2Status = workspaceFSSyncService.getR2Status();
      logger.info('Phase 9 initialized: WorkspaceFS Sync', {
        enabled: workspaceFSSyncService.getConfig().enabled,
        r2Configured: r2Status.configured,
      });
    } catch (err: any) {
      errors.push(`Phase 9: ${err.message}`);
      logger.warn('Phase 9 initialization deferred', err.message);
    }

    // Phase 10 (Graph): Workspace graph service (history recording timers)
    // Already constructed as a singleton — warm it up
    workspaceGraphService.getWorkspaceGraph('__control_plane_init__');
    logger.info('Phase 10 initialized: Workspace Graph');

    if (errors.length > 0) {
      logger.warn('WorkspaceControlPlane initialized with errors', { errors });
    } else {
      logger.info('WorkspaceControlPlane initialized successfully — all phases online');
    }

    this.initialized = true;
    this.emit('control-plane:initialized', this.getState());
    return this.getState();
  }

  // ==========================================================================
  // Primary API: Create Workspace
  // ==========================================================================

  /**
   * Create and bind a new workspace, progressing through all phases:
   *
   *   1. Phase 9: Materialize VFS workspace scope
   *   2. Phase 2: Initialize runtime service (env vars)
   *   3. Phase 6: Bind to optimal provider (via runtime broker)
   *   4. Phase 7: Restore environment image if available
   *   5. Phase 10: Push initial graph update
   *
   * Returns a WorkspaceHandle for subsequent operations.
   */
  async create(
    workspaceId: string,
    userId: string,
    options?: WorkspaceCreateOptions,
    ownerResolution?: FilesystemOwnerResolution,
  ): Promise<WorkspaceHandle> {
    logger.info('Creating workspace', {
      workspaceId,
      userId,
      hasProvider: !!options?.provider,
      hasImage: !!options?.image,
      hasTemplate: !!options?.template,
    });

    const handle = new WorkspaceHandleImpl(workspaceId, userId, this, ownerResolution);

    try {
      // === Phase 9: VFS workspace scope ===
      // The workspace scope is created implicitly when the first file is written
      // to VFS (via scope-utils). No explicit materialization needed — VFS uses
      // lazy workspace creation on first write.
      handle.phase = 'created';
      logger.info('Phase 9: VFS workspace scope ready (lazy)', { workspaceId });

      // === Phase 2: Initialize runtime + env ===
      const runtime = getWorkspaceRuntime(workspaceId, userId);
      await runtime.hydrate();

      if (options?.env) {
        for (const [key, value] of Object.entries(options.env)) {
          runtime.setEnv(key, value);
        }
        logger.info('Phase 2: Workspace runtime initialized with env', {
          workspaceId,
          envCount: Object.keys(options.env).length,
        });
      } else {
        logger.info('Phase 2: Workspace runtime initialized', { workspaceId });
      }

      // === Phase 6: Bind to provider ===
      handle.phase = 'binding';
      const session = await sandboxOrchestrator.getSandbox({
        userId,
        conversationId: workspaceId,
        task: 'general',
        policy: options?.policy || 'sandbox-preferred',
        ownerResolution,
      });

      handle._orchestratorSession = session;
      handle._provider = session.provider;
      handle._sandboxId = session.sessionId;
      handle._workspaceDir = session.handle.workspaceDir;
      handle.phase = 'bound';
      logger.info('Phase 6: Workspace bound to provider', {
        workspaceId,
        provider: session.provider,
        sandboxId: session.sessionId,
      });

      // === Phase 7: Restore environment image ===
      handle.phase = 'restoring';
      try {
        if (workspaceFSSnapshotService.hasSnapshot(workspaceId)) {
          await workspaceFSSnapshotService.restoreSnapshot(
            workspaceId,
            session.handle,
            userId,
          );
          logger.info('Phase 7: Environment snapshot restored', { workspaceId });
        }
      } catch (err: any) {
        logger.warn('Phase 7: Snapshot restore deferred', err.message);
      }

      // === Phase 10: Push initial graph ===
      workspaceGraphService.notifyGraphChanged(workspaceId);
      logger.info('Phase 10: Initial graph push complete', { workspaceId });

      handle.phase = 'ready';
      this.handles.set(workspaceId, handle);
      logger.info('Workspace ready', {
        workspaceId,
        provider: handle._provider,
        sandboxId: handle._sandboxId,
      });

      this.emit('workspace:created', handle);
    } catch (err: any) {
      handle.phase = 'error';
      logger.error('Workspace creation failed', {
        workspaceId,
        error: err.message,
      });
      throw err;
    }

    return handle;
  }

  /**
   * Get an existing workspace handle.
   * Returns null if the workspace is not managed by this control plane.
   */
  get(workspaceId: string): WorkspaceHandle | null {
    return this.handles.get(workspaceId) || null;
  }

  /**
   * List all active workspace IDs managed by this control plane.
   */
  list(): string[] {
    return Array.from(this.handles.keys());
  }

  /**
   * Get the control plane state for monitoring.
   */
  getState(): ControlPlaneState {
    return {
      activeWorkspaces: this.handles.size,
      workspaceIds: this.list(),
      affinity: sandboxOrchestrator.getAffinityStats(),
      snapshots: workspaceFSSnapshotService.getStats(),
      phases: {
        affinity: sandboxOrchestrator.getAffinityConfig().enabled,
        snapshots: workspaceFSSnapshotService.getConfig().enabled,
        broker: true,
        vfs: true,
        graph: true,
      },
    };
  }

  /**
   * Register an already-created workspace with the control plane.
   *
   * Use this when another system (e.g., session-manager) has already created
   * the sandbox and runtime — the control plane just needs to track it so
   * get(), list(), and destroy() work correctly.
   *
   * This is a lightweight operation — no sandbox creation, no hydration.
   * Just creates a handle with the given provider/sandbox/dir info and
   * stores it in the registry.
   */
  register(
    workspaceId: string,
    userId: string,
    info: {
      provider?: SandboxProviderType;
      sandboxId?: string;
      workspaceDir?: string;
    },
    /**
     * Optional authoritative owner resolution captured at registration time
     * (e.g. when the caller is an API route that has a NextRequest in scope).
     * Threaded into the handle for consistency with `create()` — `register()`
     * itself does NOT create a sandbox/affinity binding, but a future change
     * to add one won't require re-plumbing this param through every caller.
     * Falls back to the session lookup if omitted.
     */
    ownerResolution?: FilesystemOwnerResolution,
  ): WorkspaceHandle {
    // Return existing handle if already registered
    const existing = this.handles.get(workspaceId);
    if (existing) {
      // Update with latest info if provided
      if (info.provider) existing._provider = info.provider;
      if (info.sandboxId) existing._sandboxId = info.sandboxId;
      if (info.workspaceDir) existing._workspaceDir = info.workspaceDir;
      existing.phase = 'ready';
      // If a fresh ownerResolution is passed on re-registration, it is
      // intentionally NOT swapped onto the existing handle — re-registering
      // should not silently change ownership mid-flight. Log at debug so
      // operators can see when a caller is passing it (and notice if they
      // expected a swap).
      if (ownerResolution) {
        logger.debug('register() called on existing handle; ownerResolution is not swapped', {
          workspaceId,
          newHasOwnerResolution: true,
          existingHasOwnerResolution: existing.hasOwnerResolution(),
        });
      }
      return existing;
    }

    // register() is a lightweight tracking operation (no sandbox creation).
    // ownerResolution is still threaded through to the handle so that if a
    // registered handle later calls _ensureSession(), the binding carries
    // the authoritative ownerId captured at registration time (instead of
    // relying on the session lookup fallback).
    const handle = new WorkspaceHandleImpl(workspaceId, userId, this, ownerResolution);
    handle._provider = info.provider || null;
    handle._sandboxId = info.sandboxId || null;
    handle._workspaceDir = info.workspaceDir || null;
    handle.phase = 'ready';

    this.handles.set(workspaceId, handle);
    logger.info('Workspace registered in control plane', {
      workspaceId,
      provider: info.provider,
      sandboxId: info.sandboxId,
      hasOwnerResolution: !!ownerResolution,
    });

    this.emit('workspace:registered', handle);
    return handle;
  }

  /**
   * Destroy a workspace tracked by the control plane.
   * Best-effort — if the workspace isn't tracked, this is a no-op.
   */
  async destroy(workspaceId: string): Promise<void> {
    const handle = this.handles.get(workspaceId);
    if (!handle) return;
    await handle.destroy();
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  /** Remove a destroyed handle from the registry. Called by WorkspaceHandleImpl.destroy(). */
  _removeHandle(workspaceId: string): void {
    this.handles.delete(workspaceId);
    this.emit('workspace:destroyed', workspaceId);
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceControlPlane = new WorkspaceControlPlane();
