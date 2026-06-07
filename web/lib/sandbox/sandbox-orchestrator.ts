/**
 * Sandbox Orchestrator - Coordination Layer
 *
 * Coordinates existing sandbox components for unified lifecycle management.
 * DOES NOT replace existing components - orchestrates them.
 */

import { ESCALATION_PROFILES } from '@bing/shared/agent/timeout-escalation';
import { createLogger } from '../utils/logger';
import { providerRouter, type TaskContext } from './provider-router';
import { sessionManager } from '../session/session-manager';
import { resourceMonitor, type ResourceMetrics } from '../management/resource-monitor';
import { taskRouter } from '@bing/shared/agent/task-router';
import {
  assessRisk,
  type ExecutionPolicy,
  type RiskAssessment,
  getExecutionPolicyConfig,
  getPreferredProviders,
} from './types';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';
import type { SandboxHandle } from './providers/sandbox-provider';
import { getSandboxProvider, type SandboxProviderType } from './providers';
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';
import { workspaceFSSnapshotService } from './workspacefs-snapshot-service';
import { getWorkspaceRuntime } from '@/lib/terminal/workspace-runtime-service';
import { getSecretBroker } from './secret-broker';

const logger = createLogger('Sandbox:Orchestrator');

export interface OrchestratorSession {
  sessionId: string; // Handle-based ID (may change on migration)
  logicalId: string; // Stable logical ID for identification across migrations
  userId: string;
  conversationId: string;
  handle: SandboxHandle;
  provider: SandboxProviderType;
  policy: ExecutionPolicy;
  taskType: 'coding' | 'browsing' | 'automation' | 'general' | 'messaging' | 'api' | 'unknown' | 'advanced' | 'code-interpreter' | 'agent' | 'fullstack-app' | 'frontend-app' | 'batch-job' | 'computer-use' | 'lsp-intelligence' | 'persistent-service' | 'ci-cd' | 'ml-training'; // Persisted task type for migration
  riskAssessment?: RiskAssessment;
  createdAt: number;
  lastActivityAt: number;
  migrationCount: number;
  isWarm: boolean;
}

export interface MigrationResult {
  success: boolean;
  fromProvider: SandboxProviderType | 'unknown';
  toProvider: SandboxProviderType | 'unknown';
  reason: string;
  duration: number;
  error?: string;
}

// === Workspace Affinity Types ===

/**
 * An affinity binding keeps a workspace pinned to a specific sandbox provider.
 * This preserves cache warmth (node_modules, pip cache, venvs) across commands.
 */
export interface AffinityBinding {
  /** Workspace identifier (typically userId + workspace path) */
  workspaceId: string;
  /** The provider this workspace is bound to */
  provider: SandboxProviderType;
  /** The sandbox handle ID currently serving this workspace */
  sandboxId: string;
  /** The workspace directory path on the provider */
  workspaceDir: string;
  /** When the binding was created */
  boundAt: number;
  /** Last time the binding was used */
  lastUsedAt: number;
  /** How long the binding is valid after last use (ms) */
  ttl: number;
  /** Number of commands executed under this affinity */
  commandCount: number;
}

export class SandboxOrchestrator {
  private warmPool = new Map<SandboxProviderType, SandboxHandle[]>();
  private sessions = new Map<string, OrchestratorSession>();

  // === Workspace Affinity ===
  /** Maps workspaceId → provider/sandbox binding for cache warmth */
  private affinityBindings = new Map<string, AffinityBinding>();
  /** How long an affinity binding is valid after last use (default: 10 min) */
  private readonly AFFINITY_TTL_MS = parseInt(process.env.SANDBOX_AFFINITY_TTL_MS || '600000', 10);
  /** Whether workspace affinity is enabled */
  private readonly AFFINITY_ENABLED = process.env.SANDBOX_AFFINITY_ENABLED !== 'false';
  private readonly WARM_POOL_SIZE = 3;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  /** Warm pool sandboxes idle longer than this are destroyed to save costs (default: 15 min) */
  private readonly WARM_POOL_IDLE_TIMEOUT_MS = parseInt(process.env.WARM_POOL_IDLE_TIMEOUT_MS || '900000', 10);
  /** Tracks when each warm sandbox was created (handle.id → timestamp) for idle eviction */
  private warmPoolTimestamps = new Map<string, number>();
  private readonly MIGRATION_CPU_THRESHOLD = 80;
  private readonly MIGRATION_MEMORY_THRESHOLD = 90;

  constructor() {
    void this.initializeWarmPool();
    this.startIdleCleanup();
    this.startAffinityCleanup();
    this.startWarmPoolCleanup();
  }

  async getSandbox(options: {
    userId: string;
    conversationId: string;
    task: string;
    policy?: ExecutionPolicy;
  }): Promise<OrchestratorSession> {
    const { userId, conversationId, task, policy: explicitPolicy } = options;

    const risk = assessRisk(task);
    if (risk.shouldBlock) {
      throw new Error(risk.blockReason);
    }

    const existingSession = Array.from(this.sessions.values()).find(
      (session) =>
        session.userId === userId &&
        session.conversationId === conversationId &&
        Date.now() - session.lastActivityAt < this.IDLE_TIMEOUT_MS,
    );
    if (existingSession) {
      existingSession.lastActivityAt = Date.now();
      return existingSession;
    }

    const routing = await taskRouter.analyzeTask(task);
    const policy = this.normalizePolicyForSandbox(explicitPolicy || risk.recommendedPolicy);
    const providerContext = this.buildTaskContext(routing.type, policy);

    // === Workspace Affinity: check for existing provider binding ===
    const affinityWorkspaceId = `${userId}:${conversationId}`;
    let affinity: AffinityBinding | null = null;
    let provider: SandboxProviderType;

    if (this.AFFINITY_ENABLED) {
      affinity = this.getAffinity(affinityWorkspaceId);
      if (affinity) {
        provider = affinity.provider;
        logger.info('Using affinity-bound provider', {
          workspaceId: affinityWorkspaceId,
          provider,
          commandCount: affinity.commandCount,
          age: Date.now() - affinity.boundAt,
        });
      } else {
        provider = await providerRouter.selectOptimalProvider(providerContext);
      }
    } else {
      provider = await providerRouter.selectOptimalProvider(providerContext);
    }

    const warmSandbox = await this.getFromWarmPool(provider);

    let handle: SandboxHandle;
    if (warmSandbox) {
      logger.info('Using warm sandbox from pool', { provider });
      handle = warmSandbox;
    } else {
      logger.info('Creating new session via session-manager', { provider, policy });
      const session = await sessionManager.getOrCreateSession(userId, conversationId, {
        executionPolicy: policy,
        userId,
        conversationId,
      });

      if (!session.sandboxHandle) {
        // If affinity is active, reuse the same workspace directory so caches stay warm
        const affinityWorkspaceDir = this.AFFINITY_ENABLED
          ? affinity?.workspaceDir
          : undefined;

        try {
          handle = await this.createSandboxHandle(
            userId, conversationId, provider, policy,
            affinityWorkspaceDir,
          );
        } catch (err: any) {
          // If affinity-bound provider fails, evict the binding and fall back
          if (this.AFFINITY_ENABLED && affinityWorkspaceDir) {
            logger.warn('Affinity-bound provider failed, evicting and retrying', {
              provider,
              error: err.message,
            });
            this.evictAffinity(affinityWorkspaceId);
            const fallbackProvider = await providerRouter.selectOptimalProvider(providerContext);
            handle = await this.createSandboxHandle(
              userId, conversationId, fallbackProvider, policy,
            );
            provider = fallbackProvider;
          } else {
            throw err;
          }
        }
      } else {
        handle = session.sandboxHandle;
      }
    }

    const orchestratorSession: OrchestratorSession = {
      sessionId: handle.id,
      logicalId: `${userId}-${conversationId}`, // Stable logical ID across migrations
      userId,
      conversationId,
      handle,
      provider,
      policy,
      taskType: routing.type, // Persist analyzed task type for migration
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      riskAssessment: risk,
      migrationCount: 0,
      isWarm: !!warmSandbox,
    };

    this.sessions.set(orchestratorSession.logicalId, orchestratorSession);
    resourceMonitor.startMonitoring(handle.id, provider);
    void this.replenishWarmPool(provider);

    // === Phase 7: Restore workspace FS snapshot if available ===
    // When a workspace re-binds after affinity expiry, restore cached
    // dependencies (node_modules, venvs, etc.) from the previous snapshot.
    if (this.AFFINITY_ENABLED && workspaceFSSnapshotService.hasSnapshot(affinityWorkspaceId)) {
      try {
        const restoreResult = await workspaceFSSnapshotService.restoreSnapshot(
          affinityWorkspaceId,
          handle,
          userId,
        );
        if (restoreResult.restored) {
          logger.info('Workspace FS snapshot restored on re-bind', {
            workspaceId: affinityWorkspaceId,
            cacheRestored: restoreResult.cacheRestored,
          });
        }
      } catch (err: any) {
        logger.warn('Failed to restore workspace FS snapshot', {
          workspaceId: affinityWorkspaceId,
          error: err.message,
        });
      }
    }

    // === Update workspace affinity ===
    if (this.AFFINITY_ENABLED) {
      this.setAffinity(affinityWorkspaceId, provider, handle.id, handle.workspaceDir);
    }

    logger.info('Sandbox session created', {
      sessionId: orchestratorSession.sessionId,
      provider,
      policy,
      riskLevel: risk.level,
      affinity: this.AFFINITY_ENABLED ? 'active' : 'disabled',
    });

    return orchestratorSession;
  }

  async executeInSandbox(
    sessionId: string,
    command: string,
    options?: {
      timeout?: number;
      onProgress?: (progress: ResourceMetrics) => void;
    }
  ): Promise<{ output: string; exitCode: number; duration: number }> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.lastActivityAt = Date.now();

    // Resolve __SB__ placeholders in the command so sandbox-scoped secrets
    // (like API keys injected via SecretBroker) are available at execution time.
    try {
      const broker = getSecretBroker();
      command = await broker.resolvePlaceholders(command, `sandbox:${session.sessionId}`);
    } catch {
      // Best-effort — if placeholder resolution fails, proceed with original command
    }

    // === Touch workspace affinity to extend its TTL ===
    if (this.AFFINITY_ENABLED) {
      const affinityWorkspaceId = `${session.userId}:${session.conversationId}`;
      this.touchAffinity(affinityWorkspaceId);
    }

    const risk = assessRisk(command);
    if (risk.shouldBlock) {
      throw new Error(risk.blockReason);
    }

    const metrics = await resourceMonitor.getResourceUsage(session.handle.id);
    if (this.shouldMigrate(metrics)) {
      logger.warn('Resource threshold exceeded, migrating before execution', {
        sessionId,
        cpu: metrics.cpuUsage,
        memory: metrics.memoryUsage,
      });
      await this.migrateSession(sessionId, 'resource_threshold');
    }

    const startTime = Date.now();
    const timeout = options?.timeout || 60000;

    const escalation = timeout <= 15000
      ? ESCALATION_PROFILES.quick
      : timeout <= 60000
        ? ESCALATION_PROFILES.standard
        : ESCALATION_PROFILES.thorough;

    const escalationResult = await escalation.executeWithEscalation(
      sessionId,
      () => session.handle.executeCommand(command, undefined, timeout),
      (ctx) => {
        logger.warn('Sandbox execution escalation', {
          sessionId,
          action: ctx.action,
          elapsedMs: ctx.elapsedMs,
          stage: ctx.stageIndex + 1,
        });
      },
    );

    if (!escalationResult.success) {
      throw new Error(escalationResult.error || 'Command execution failed');
    }

    const result = escalationResult.result!;

    const duration = Date.now() - startTime;

    if (options?.onProgress) {
      const updatedMetrics = await resourceMonitor.getResourceUsage(session.handle.id);
      options.onProgress(updatedMetrics);
    }

    return {
      output: result.output || '',
      exitCode: result.exitCode ?? (result.success ? 0 : 1),
      duration,
    };
  }

  async migrateSession(
    sessionId: string,
    reason: 'resource_threshold' | 'provider_failure' | 'policy_change'
  ): Promise<MigrationResult> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        fromProvider: 'unknown',
        toProvider: 'unknown',
        reason,
        duration: 0,
        error: 'Session not found',
      };
    }

    const startTime = Date.now();
    const fromProvider = session.provider;

    try {
      const recommendations = await providerRouter.getRecommendations(this.buildTaskContext(session.taskType, session.policy));
      const toProvider = [recommendations.primary, ...recommendations.alternatives.map((alt) => alt.provider)]
        .find((candidate) => candidate !== fromProvider);

      if (!toProvider) {
        return {
          success: false,
          fromProvider,
          toProvider: fromProvider,
          reason,
          duration: Date.now() - startTime,
          error: 'No alternative provider available',
        };
      }

      logger.info('Starting sandbox migration', {
        sessionId,
        fromProvider,
        toProvider,
        reason,
      });

      const newHandle = await this.createSandboxHandle(session.userId, session.conversationId, toProvider, session.policy);
      resourceMonitor.stopMonitoring(session.handle.id);
      resourceMonitor.startMonitoring(newHandle.id, toProvider);

      const oldSessionId = session.sessionId;
      session.handle = newHandle;
      session.provider = toProvider;
      session.sessionId = newHandle.id;
      session.migrationCount++;
      session.lastActivityAt = Date.now();

      this.sessions.delete(oldSessionId);
      this.sessions.set(session.logicalId, session);

      const duration = Date.now() - startTime;

      logger.info('Sandbox migration completed', {
        sessionId,
        fromProvider,
        toProvider,
        duration,
      });

      return {
        success: true,
        fromProvider,
        toProvider,
        reason,
        duration,
      };
    } catch (error: any) {
      logger.error('Sandbox migration failed', {
        sessionId,
        fromProvider,
        error: error.message,
      });

      return {
        success: false,
        fromProvider,
        toProvider: 'unknown',
        reason,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async getSession(identifier: string): Promise<OrchestratorSession | null> {
    let session = this.sessions.get(identifier);
    if (!session) {
      session = Array.from(this.sessions.values()).find(
        s => s.sessionId === identifier || s.logicalId === identifier
      );
    }
    if (!session) {
      return null;
    }

    if (Date.now() - session.lastActivityAt > this.IDLE_TIMEOUT_MS) {
      this.evictSession(session);
      return null;
    }

    return session;
  }

  private async evictSession(session: OrchestratorSession): Promise<void> {
    logger.info('Evicting idle session', {
      sessionId: session.sessionId,
      logicalId: session.logicalId,
      lastActivity: new Date(session.lastActivityAt).toISOString(),
    });

    this.sessions.delete(session.logicalId);
    resourceMonitor.stopMonitoring(session.handle.id);

    if (session.isWarm) {
      try {
        await session.handle.executeCommand('echo "warm_sandbox_evicted"');
      } catch {
        logger.debug('Warm sandbox already terminated');
      }
    }
  }

  private async getFromWarmPool(provider: SandboxProviderType): Promise<SandboxHandle | null> {
    const pool = this.warmPool.get(provider);
    if (!pool || pool.length === 0) {
      return null;
    }

    const handle = pool.pop()!;
    this.warmPoolTimestamps.delete(handle.id);
    try {
      await handle.executeCommand('echo health_check');
      return handle;
    } catch {
      logger.warn('Warm sandbox unhealthy, discarding', { provider });
      return this.getFromWarmPool(provider);
    }
  }

  private async initializeWarmPool(): Promise<void> {
    logger.info('Initializing warm sandbox pool');

    const providers: SandboxProviderType[] = ['daytona', 'e2b', 'sprites', 'firecracker'];

    for (const provider of providers) {
      this.warmPool.set(provider, []);
      await this.replenishWarmPool(provider);
    }
  }

  private async replenishWarmPool(provider: SandboxProviderType): Promise<void> {
    const pool = this.warmPool.get(provider) || [];

    while (pool.length < this.WARM_POOL_SIZE) {
      try {
        const handle = await this.createSandboxHandle(
          'warm-pool',
          `warm-${provider}-${Date.now()}`,
          provider,
          'sandbox-preferred',
        );
        pool.push(handle);
        this.warmPoolTimestamps.set(handle.id, Date.now());
        logger.debug('Added warm sandbox', { provider, sandboxId: handle.id, poolSize: pool.length });
      } catch (error: any) {
        logger.warn('Failed to create warm sandbox', { provider, error: error.message });
        break;
      }
    }

    this.warmPool.set(provider, pool);
  }

  /**
   * Periodically evict idle warm pool sandboxes and destroy them to save costs.
   * Warm sandboxes that haven't been claimed within WARM_POOL_IDLE_TIMEOUT_MS
   * are destroyed via the provider (e.g. E2B API kill) and removed from the pool.
   * Any lingering VFS sync intervals are also stopped.
   */
  private startWarmPoolCleanup(): void {
    setInterval(async () => {
      const cutoff = Date.now() - this.WARM_POOL_IDLE_TIMEOUT_MS;

      for (const [providerType, pool] of this.warmPool.entries()) {
        if (pool.length === 0) continue;

        // Find handles that have been idle beyond the timeout
        const stale: SandboxHandle[] = [];
        for (const handle of pool) {
          const created = this.warmPoolTimestamps.get(handle.id);
          if (created !== undefined && created < cutoff) {
            stale.push(handle);
          }
        }

        if (stale.length === 0) continue;

        logger.info('Evicting idle warm sandboxes', {
          provider: providerType,
          count: stale.length,
          poolSize: pool.length,
        });

        // Remove stale handles from the pool in reverse order (safe splice from end)
        const staleIds = new Set(stale.map(h => h.id));
        for (let i = pool.length - 1; i >= 0; i--) {
          if (staleIds.has(pool[i].id)) {
            pool.splice(i, 1);
          }
        }

        // Stop sync intervals and destroy each stale sandbox
        // Uses best-effort — if destroy fails (e.g. sandbox already dead), just log and continue.
        const provider = await getSandboxProvider(providerType).catch(() => null);
        for (const handle of stale) {
          // Capture age before deleting timestamp
          const createdAt = this.warmPoolTimestamps.get(handle.id);
          this.warmPoolTimestamps.delete(handle.id);

          try {
            sandboxFilesystemSync.stopSync(handle.id);
          } catch {
            // Best-effort — may already be stopped
          }

          if (provider) {
            try {
              await provider.destroySandbox(handle.id);
              logger.info('Destroyed idle warm sandbox', {
                provider: providerType,
                sandboxId: handle.id,
                ageMs: Date.now() - (createdAt || Date.now()),
              });
            } catch (err: any) {
              logger.warn('Failed to destroy idle warm sandbox (may already be dead)', {
                provider: providerType,
                sandboxId: handle.id,
                error: err.message,
              });
            }
          }
        }
      }
    }, 300000); // Check every 5 minutes
  }

  private shouldMigrate(metrics: ResourceMetrics): boolean {
    const memoryPercent = metrics.memoryLimit > 0
      ? (metrics.memoryUsage / metrics.memoryLimit) * 100
      : metrics.memoryUsage;

    return (
      metrics.cpuUsage > this.MIGRATION_CPU_THRESHOLD ||
      memoryPercent > this.MIGRATION_MEMORY_THRESHOLD
    );
  }

  private startIdleCleanup(): void {
    setInterval(async () => {
      const cutoff = Date.now() - this.IDLE_TIMEOUT_MS;
      for (const [logicalId, session] of this.sessions.entries()) {
        if (session.lastActivityAt < cutoff) {
          await this.evictSession(session);
        }
      }
    }, 60000);
  }

  private normalizePolicyForSandbox(policy: ExecutionPolicy): ExecutionPolicy {
    return policy === 'local-safe' ? 'sandbox-preferred' : policy;
  }

  private buildTaskContext(
    taskType: 'coding' | 'browsing' | 'automation' | 'general' | 'messaging' | 'api' | 'unknown' | 'advanced' | 'code-interpreter' | 'agent' | 'fullstack-app' | 'frontend-app' | 'batch-job' | 'computer-use' | 'lsp-intelligence' | 'persistent-service' | 'ci-cd' | 'ml-training',
    policy: ExecutionPolicy,
  ): TaskContext {
    switch (policy) {
      case 'desktop-required':
        return { type: 'computer-use', needsServices: ['desktop'], performancePriority: 'latency' };
      case 'persistent-sandbox':
        return { type: 'persistent-service', requiresPersistence: true, needsServices: ['pty', 'snapshot'], performancePriority: 'balanced' };
      case 'sandbox-heavy':
      case 'cloud-sandbox':
        return { type: 'fullstack-app', requiresBackend: true, needsServices: ['pty', 'preview'], performancePriority: 'throughput' };
      case 'isolated-code-exec':
        return { type: 'code-interpreter', needsServices: ['pty'], performancePriority: 'latency' };
      default:
        if (taskType === 'browsing' || taskType === 'automation') {
          return { type: 'general', needsServices: ['pty'], performancePriority: 'latency' };
        }
        return { type: 'agent', needsServices: ['pty'], performancePriority: 'latency' };
    }
  }

  // ==========================================================================
  // Workspace Affinity Methods
  // ==========================================================================

  /**
   * Get the affinity binding for a workspace, if still valid.
   * Returns null if no binding exists or the binding has expired.
   */
  getAffinity(workspaceId: string): AffinityBinding | null {
    const binding = this.affinityBindings.get(workspaceId);
    if (!binding) return null;

    const now = Date.now();
    if (now - binding.lastUsedAt > binding.ttl) {
      // Binding expired — evict it
      logger.info('Affinity binding expired', {
        workspaceId,
        provider: binding.provider,
        age: now - binding.boundAt,
        idleMs: now - binding.lastUsedAt,
      });
      this.affinityBindings.delete(workspaceId);
      return null;
    }

    return binding;
  }

  /**
   * Create or update an affinity binding for a workspace.
   * Subsequent commands for the same workspace will prefer this provider.
   */
  setAffinity(
    workspaceId: string,
    provider: SandboxProviderType,
    sandboxId: string,
    workspaceDir: string,
  ): void {
    const existing = this.affinityBindings.get(workspaceId);
    const commandCount = existing ? existing.commandCount + 1 : 1;

    this.affinityBindings.set(workspaceId, {
      workspaceId,
      provider,
      sandboxId,
      workspaceDir,
      boundAt: existing?.boundAt ?? Date.now(),
      lastUsedAt: Date.now(),
      ttl: this.AFFINITY_TTL_MS,
      commandCount,
    });

    logger.debug('Affinity binding set', {
      workspaceId,
      provider,
      commandCount,
    });
  }

  /**
   * Touch an existing affinity binding to extend its TTL.
   * Called on each command execution under an active binding.
   */
  touchAffinity(workspaceId: string): void {
    const binding = this.affinityBindings.get(workspaceId);
    if (binding) {
      binding.lastUsedAt = Date.now();
      binding.commandCount++;
    }
  }

  /**
   * Remove an affinity binding.
   */
  evictAffinity(workspaceId: string): void {
    const existed = this.affinityBindings.delete(workspaceId);
    if (existed) {
      logger.info('Affinity binding evicted', { workspaceId });
    }
  }

  /**
   * Find an orchestrator session that matches the given workspaceId.
   * Used during affinity cleanup to locate the user/session for snapshot creation.
   */
  private findSessionByWorkspaceId(workspaceId: string): OrchestratorSession | null {
    // workspaceId format is "userId:conversationId"
    const [userId, conversationId] = workspaceId.split(':');
    if (!userId || !conversationId) return null;

    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.conversationId === conversationId) {
        return session;
      }
    }
    return null;
  }

  /**
   * Get affinity statistics for monitoring.
   */
  getAffinityStats(): {
    activeBindings: number;
    providers: Record<string, number>;
    totalCommands: number;
  } {
    const now = Date.now();
    const active = Array.from(this.affinityBindings.values())
      .filter(b => now - b.lastUsedAt <= b.ttl);

    const providerCounts: Record<string, number> = {};
    let totalCommands = 0;
    for (const b of active) {
      providerCounts[b.provider] = (providerCounts[b.provider] || 0) + 1;
      totalCommands += b.commandCount;
    }

    return {
      activeBindings: active.length,
      providers: providerCounts,
      totalCommands,
    };
  }

  /**
   * Get affinity configuration for monitoring.
   */
  getAffinityConfig(): {
    enabled: boolean;
    ttlMs: number;
  } {
    return {
      enabled: this.AFFINITY_ENABLED,
      ttlMs: this.AFFINITY_TTL_MS,
    };
  }

  // ==========================================================================
  // Affinity-aware idle cleanup
  // ==========================================================================

  /**
   * Start periodic cleanup of expired affinity bindings.
   * Before evicting a binding, snapshots the workspace filesystem
   * so caches can be restored when the workspace re-binds later.
   */
  private startAffinityCleanup(): void {
    setInterval(async () => {
      const now = Date.now();
      for (const [workspaceId, binding] of this.affinityBindings.entries()) {
        if (now - binding.lastUsedAt > binding.ttl) {
          // Phase 7: Snapshot workspace filesystem before evicting affinity.
          // This captures caches (node_modules, venvs, pip cache) so they can
          // be restored when the workspace re-binds to a new provider later.
          if (!workspaceFSSnapshotService.hasSnapshot(workspaceId)) {
            const session = this.findSessionByWorkspaceId(workspaceId);
            const userId = session?.userId || workspaceId.split(':')[0] || 'unknown';
            try {
              await workspaceFSSnapshotService.createSnapshot(
                workspaceId,
                userId,
                binding.sandboxId,
                binding.provider,
                binding.workspaceDir,
              );
            } catch (err: any) {
              logger.debug('Workspace FS snapshot skipped (best-effort)', {
                workspaceId,
                error: err.message,
              });
            }
          }

          this.evictAffinity(workspaceId);
        }
      }
    }, 60000); // Check every minute
  }

  private async createSandboxHandle(
    userId: string,
    conversationId: string,
    providerType: SandboxProviderType,
    policy: ExecutionPolicy,
    workspaceDirOverride?: string,
  ): Promise<SandboxHandle> {
    const provider = await getSandboxProvider(providerType);
    const policyConfig = getExecutionPolicyConfig(policy);
    const preferredProviders = getPreferredProviders(policy);

    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    // Use override if provided (affinity reuse) or generate fresh path
    const simpleSessionId = normalizeSessionId(conversationId) || conversationId;
    const safeConvId = simpleSessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const workspaceDir = workspaceDirOverride || `/workspace/users/${safeUserId}/sessions/${safeConvId}`;

    // Load workspace-scoped environment variables and merge into sandbox env.
    // Skip for warm pool sessions to avoid memory leaks and unnecessary DB queries.
    let workspaceEnv: Record<string, string> = {};
    if (userId !== 'warm-pool') {
      try {
        const workspaceId = `${userId}:${conversationId}`;
        const runtime = getWorkspaceRuntime(workspaceId, userId);
        await runtime.hydrate();
        workspaceEnv = runtime.getAllEnv();
      } catch {
        // Best-effort — workspace env may not be available
      }
    }

    // Phase 9 (SecretBroker): Virtualize env vars before passing to sandbox.
    // Real API keys and tokens are replaced with __SB__KEY__ placeholders
    // that are resolved on-demand at the point of use. This prevents secret
    // leakage through logs, error messages, or $env introspection.
    const secretBroker = getSecretBroker();
    const virtualEnv = secretBroker.virtualizeEnvVars(workspaceEnv, { ownerId: userId });

    const handle = await provider.createSandbox({
      workspaceDir,
      language: 'typescript',
      autoStopInterval: 3600,
      envVars: {
        // Virtualized workspace env (secrets replaced with placeholders)
        ...virtualEnv,
        USER_ID: userId,
        CONVERSATION_ID: conversationId,
        EXECUTION_POLICY: policy,
        PREFERRED_PROVIDERS: preferredProviders.join(','),
      },
      labels: {
        userId,
        conversationId,
        executionPolicy: policy,
        createdBy: 'sandbox-orchestrator',
      },
      resources: {
        cpu: policyConfig.resources?.cpu || 1,
        memory: policyConfig.resources?.memory || 2,
      },
    });

    await handle.executeCommand(`mkdir -p "${workspaceDir.replace(/(["\\$`])/g, '\\$1')}"`);

    // Start VFS sync for bidirectional file sync between VFS database and sandbox
    // Skip for warm pool sandboxes — they have no user data to sync and would
    // create perpetual 10s polling intervals that keep sandboxes alive indefinitely.
    if (userId !== 'warm-pool') {
      try {
        sandboxFilesystemSync.startSync(handle.id, userId);
        logger.info('VFS sync started for orchestrator sandbox', { sandboxId: handle.id, userId });
      } catch (syncErr: any) {
        logger.warn('Failed to start VFS sync for orchestrator sandbox:', syncErr.message);
      }
    }

    return handle;
  }
}

export const sandboxOrchestrator = new SandboxOrchestrator();
