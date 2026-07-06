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
// Pass-7 #92/#93: lifecycle observability — emits canonical [INITIALIZED]/
// [DESTROYED] and [OPERATION STARTED/COMPLETED/FAILED] log events so
// meta-monitoring can grep on a single vocabulary. The 1,885:0 init:teardown
// ratio in run.log was a silent leak; the 4:2 sandbox start:end ratio
// meant we couldn't tell when ops finished. Wire the markers at the
// authoritative create/destroy sites below.
import {
  markInitialized,
  markDestroyed,
  markReleased,
  trackOperation,
} from '../management/lifecycle';
import { taskRouter } from '@bing/shared/agent/task-router';
import {
  assessRisk,
  type ExecutionPolicy,
  type RiskAssessment,
  getExecutionPolicyConfig,
  getPreferredProviders,
} from './types';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';
import type { FilesystemOwnerResolution } from '../virtual-filesystem/resolve-filesystem-owner';
import type { SandboxHandle } from './providers/sandbox-provider';
import { getSandboxProvider, type SandboxProviderType } from './providers';
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';
import { workspaceFSSnapshotService } from './workspacefs-snapshot-service';
import { getWorkspaceRuntime } from '@/lib/terminal/workspace-runtime-service';
import { workspaceServiceManager } from '@/lib/terminal/workspace-service-manager';
import { workspaceReplayService } from '@/lib/workspace/workspace-replay-service';
import { getSecretBroker } from './secret-broker';
import { autoSuspendService } from './auto-suspend-service';

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
  /**
   * Pre-resolved FilesystemOwnerResolution captured at binding creation time
   * (when the request context is available). Used by startAffinityCleanup
   * to snapshot the workspace under the correct VFS ownerId without needing
   * a NextRequest — the cleanup runs in a setInterval that has no request
   * scope. Optional for backward compatibility: bindings created without
   * request context fall back to the orchestrator's session lookup.
   */
  ownerResolution?: FilesystemOwnerResolution;
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
  /** Maximum warm sandboxes per provider (overridable via SANDBOX_WARM_POOL_MAX env var). */
  private readonly WARM_POOL_MAX = parseInt(process.env.SANDBOX_WARM_POOL_MAX || '6', 10) || 6;
  /**
   * Dynamic warm pool size — scales with active sessions.
   * Starts at 0 (lazy), grows to ceil(activeSessions * 0.5), capped at WARM_POOL_MAX.
   * A session-only sandbox is created on first demand; warm pool pre-warms extras.
   */
  private get WARM_POOL_SIZE(): number {
    const active = this.sessions.size;
    return Math.min(this.WARM_POOL_MAX, Math.ceil(active * 0.5));
  }
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  /** Warm pool sandboxes idle longer than this are destroyed to save costs (default: 15 min) */
  private readonly WARM_POOL_IDLE_TIMEOUT_MS = parseInt(process.env.WARM_POOL_IDLE_TIMEOUT_MS || '900000', 10);
  /** Tracks when each warm sandbox was created (handle.id → timestamp) for idle eviction */
  private warmPoolTimestamps = new Map<string, number>();
  private readonly MIGRATION_CPU_THRESHOLD = 80;
  private readonly MIGRATION_MEMORY_THRESHOLD = 90;

  constructor() {
    // Note: HMR-survival is now handled at the export site (see the
    // `globalThis.__sandboxOrchestrator` hoisted export at the bottom of
    // this file) so the constructor runs exactly once per process boot —
    // the prior `__sandboxOrchestratorInited` boolean guard here was a
    // half-measure: it prevented the warm pool from re-initing on HMR but
    // ALSO left the freshly-constructed (empty) instance exported, so
    // every HMR cycle silently replaced the live orchestrator with a
    // broken empty object. The export-site check is the correct fix.
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
    /**
     * Pre-resolved FilesystemOwnerResolution from the caller (the API route
     * already ran `resolveFilesystemOwner(req)` for auth). Threaded through
     * to the affinity binding so the periodic cleanup tick (which has no
     * request context) can snapshot the workspace under the correct VFS
     * ownerId. Optional: callers that don't have a request context can
     * omit it; startAffinityCleanup will fall back to the orchestrator's
     * session lookup, which may evict the binding if no session is found.
     */
    ownerResolution?: FilesystemOwnerResolution;
  }): Promise<OrchestratorSession> {
    const { userId, conversationId, task, policy: explicitPolicy, ownerResolution } = options;

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

    // Always get or create a session so sandbox-file-sync-bridge can
    // find the active sandbox via sessionManager.getUserSessions().
    // Previously only created in the non-warm path, leaving warm sandbox
    // users with "No active sandbox for user, skipping file sync" on every file op.
    const session = await sessionManager.getOrCreateSession(userId, conversationId, {
      executionPolicy: policy,
      userId,
      conversationId,
    });

    let handle: SandboxHandle;
    if (warmSandbox) {
      logger.info('Using warm sandbox from pool', { provider });
      handle = warmSandbox;
    } else {
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

    // Link sandbox to user session so sandbox-file-sync-bridge can find it.
    // Without this, every file op (write_file, apply_diff) logs
    // "No active sandbox for user, skipping file sync" — the sandbox exists
    // but the session manager doesn't know about it.
    sessionManager.setSandbox(session.id, handle.id, provider, handle);

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
      this.setAffinity(affinityWorkspaceId, provider, handle.id, handle.workspaceDir, ownerResolution);
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

    // === Record command start for workspace replay ===
    const replayWorkspaceId = `${session.userId}:${session.conversationId}`;
    workspaceReplayService.recordCommandExecution({
      phase: 'started',
      workspaceId: replayWorkspaceId,
      sessionId: session.logicalId,
      userId: session.userId,
      command,
      sandboxId: session.handle.id,
      provider: session.provider,
    });

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

    // === Record command completion for workspace replay ===
    workspaceReplayService.recordCommandExecution({
      phase: 'completed',
      workspaceId: replayWorkspaceId,
      sessionId: session.logicalId,
      userId: session.userId,
      command,
      sandboxId: session.handle.id,
      provider: session.provider,
      exitCode: result.exitCode ?? (result.success ? 0 : 1),
      output: result.output || '',
      durationMs: duration,
    });

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

      // === Cross-Provider Affinity Migration: Snapshot workspace FS ===
      // Before abandoning the old sandbox, capture the workspace filesystem
      // so caches (node_modules, venvs, pip cache, etc.) can be restored on
      // the new provider. This preserves cache warmth across migrations.
      const affinityWorkspaceId = `${session.userId}:${session.conversationId}`;
      const workspaceDir = session.handle.workspaceDir;

      // Stop VFS sync on the old sandbox before migrating away
      try {
        sandboxFilesystemSync.stopSync(session.handle.id);
      } catch {
        // Best-effort — old sandbox may already be dead
      }

      // Snapshot the workspace FS from the current (old) sandbox before migration.
      // This is best-effort — if snapshot fails we still proceed with migration.
      try {
        await workspaceFSSnapshotService.createSnapshot(
          affinityWorkspaceId,
          session.userId,
          session.handle.id,
          fromProvider,
          workspaceDir,
        );
        logger.info('Workspace FS snapshot captured before cross-provider migration', {
          workspaceId: affinityWorkspaceId,
          fromProvider,
        });
      } catch (snapErr: any) {
        // Best-effort — migration proceeds even if snapshot fails
        logger.debug('Workspace FS snapshot before migration skipped', {
          workspaceId: affinityWorkspaceId,
          error: snapErr.message,
        });
      }

      const newHandle = await this.createSandboxHandle(session.userId, session.conversationId, toProvider, session.policy, workspaceDir);
      resourceMonitor.stopMonitoring(session.handle.id);
      resourceMonitor.startMonitoring(newHandle.id, toProvider);

      // === Cross-Provider Affinity Migration: Restore snapshot and update affinity ===
      // Restore the workspace FS snapshot to the new sandbox so caches are preserved.
      if (this.AFFINITY_ENABLED && workspaceFSSnapshotService.hasSnapshot(affinityWorkspaceId)) {
        try {
          const restoreResult = await workspaceFSSnapshotService.restoreSnapshot(
            affinityWorkspaceId,
            newHandle,
            session.userId,
          );
          if (restoreResult.restored) {
            logger.info('Workspace FS snapshot restored after cross-provider migration', {
              workspaceId: affinityWorkspaceId,
              fromProvider,
              toProvider,
              cacheRestored: restoreResult.cacheRestored,
            });
          }
        } catch (restoreErr: any) {
          // Best-effort — migration succeeded even if restore fails
          logger.warn('Workspace FS snapshot restore after migration failed (proceeding)', {
            workspaceId: affinityWorkspaceId,
            error: restoreErr.message,
          });
        }
      }

      // Update affinity binding to point to the new provider.
      // No need to pass ownerResolution explicitly — setAffinity preserves
      // the existing one on update (cross-provider migrations re-use the
      // same authenticated identity, so the ownerId doesn't change).
      if (this.AFFINITY_ENABLED) {
        this.setAffinity(affinityWorkspaceId, toProvider, newHandle.id, newHandle.workspaceDir);
        logger.debug('Affinity binding updated after cross-provider migration', {
          workspaceId: affinityWorkspaceId,
          fromProvider,
          toProvider,
        });
      }

      // === Phase 4: Migrate running services to the new provider ===
      // Restart all running workspace services (npm run dev, python server.py,
      // etc.) on the new sandbox so they survive the provider switch.
      const servicesToMigrate = workspaceServiceManager.prepareForMigration(
        affinityWorkspaceId,
        toProvider,
        newHandle.id,
      );

      if (servicesToMigrate.length > 0) {
        logger.info('Migrating running services to new provider', {
          workspaceId: affinityWorkspaceId,
          count: servicesToMigrate.length,
          fromProvider,
          toProvider,
        });

        for (const service of servicesToMigrate) {
          try {
            // Build the restart command: cd to working dir, export any
            // service-scoped env vars, then run the original command via nohup.
            // Use sh -c to ensure the $! capture targets the nohup'd process.
            const safeWorkDir = service.workingDir.replace(/(["\\$`])/g, '\\$1');

            // Inject service-scoped env vars (e.g. PORT=3001) so the restarted
            // service behaves identically to the original.
            let envExports = '';
            if (service.env && Object.keys(service.env).length > 0) {
              envExports = Object.entries(service.env)
                .map(([k, v]) => `export ${k.replace(/[^A-Za-z0-9_]/g, '')}="${v.replace(/(["\\$`])/g, '\\$1')}"`)
                .join('; ') + '; ';
            }

            const restartCmd = `sh -c 'cd "${safeWorkDir}" && ${envExports}nohup ${service.command} > /tmp/svc-${service.id}.log 2>&1 & echo $!'`;
            const result = await newHandle.executeCommand(restartCmd, undefined, 15000);
            const newPid = parseInt((result.output || '').trim(), 10);

            if (newPid && newPid > 0) {
              workspaceServiceManager.completeServiceMigration(
                service.id,
                affinityWorkspaceId,
                newPid,
              );

              // Re-detect ports from the new service's startup output.
              // Brief sleep + tail the log file to capture the startup banner
              // so port detection can fire and preview URLs get updated.
              try {
                const logResult = await newHandle.executeCommand(
                  `sleep 1 && cat /tmp/svc-${service.id}.log 2>/dev/null || true`,
                  undefined,
                  10000,
                );
                if (logResult.output) {
                  workspaceServiceManager.feedOutput(
                    service.id,
                    affinityWorkspaceId,
                    logResult.output,
                  );
                }
              } catch {
                // Best-effort — port detection will catch up on next output
              }

              logger.info('Service restarted on new provider', {
                serviceId: service.id,
                name: service.name,
                newPid,
                toProvider,
              });
            } else {
              workspaceServiceManager.completeServiceMigration(
                service.id,
                affinityWorkspaceId,
                undefined,
                `Could not parse PID from output: ${(result.output || '').slice(0, 100)}`,
              );
            }
          } catch (restartErr: any) {
            // Best-effort — log the failure but don't block migration
            workspaceServiceManager.completeServiceMigration(
              service.id,
              affinityWorkspaceId,
              undefined,
              restartErr.message,
            );
          }
        }

        logger.info('Service migration batch completed', {
          workspaceId: affinityWorkspaceId,
          total: servicesToMigrate.length,
          toProvider,
        });
      }

      const oldSessionId = session.sessionId;
      // Pass-7 #92 (review feedback) — emit [DESTROYED] for the old
      // handle BEFORE the reassignment so the lifecycle counter doesn't
      // leak the old id as 'initialized' forever. Without this, cross-
      // provider migrations would inflate the live-ids counter and the
      // init:teardown ratio. The teardown term is `destroyed` (not
      // `released`) because the old provider's sandbox is hard-killed
      // as part of the migration; the new one gets a fresh
      // [INITIALIZED] via createSandboxHandle's existing markInitialized.
      markDestroyed('sandbox', oldSessionId, {
        provider: fromProvider,
        userId: session.userId,
        conversationId: session.conversationId,
        teardown: 'migrated',
        toProvider,
      });
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
    resourceMonitor.stopMonitoring(session.handle.id);      // Pass-7 #92: emit [RELEASED] for the idle-eviction path.
      // markReleased (not markDestroyed) is the right term here because
      // the sandbox is being returned to idle — the resource isn't
      // necessarily gone, just no longer claimed. Operators grep
      // separately on [RELEASED] vs [DESTROYED] for distinct bucket
      // counts in the meta-monitor.
    markReleased('sandbox', session.handle.id, {
      provider: session.provider,
      userId: session.userId,
      conversationId: session.conversationId,
      idleMs: Date.now() - session.lastActivityAt,
      teardown: 'idle-evict',
    });

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
      // Track activity so auto-suspend knows this sandbox is still in use
      autoSuspendService.trackActivity(handle.id);
      return handle;
    } catch {
      logger.warn('Warm sandbox unhealthy, discarding', { provider });
      return this.getFromWarmPool(provider);
    }
  }

  private async initializeWarmPool(): Promise<void> {
    logger.info('Initializing warm sandbox pool (lazy — will scale on demand)');

    const providers: SandboxProviderType[] = ['daytona', 'e2b', 'sprites', 'firecracker'];

    for (const provider of providers) {
      this.warmPool.set(provider, []);
      // Clean up orphaned sandboxes from previous server instances
      await this.cleanupOrphanedWarmPool(provider);
      // Register provider with auto-suspend service so warm pool sandboxes
      // can be hibernated instead of destroyed when idle
      try {
        const prov = await getSandboxProvider(provider);
        autoSuspendService.registerProvider(provider, prov);
      } catch {
        // Best-effort — provider may not support this environment
      }
      // No eager creation — pool starts empty and scales on first getSandbox() call
    }
  }

  private async cleanupOrphanedWarmPool(provider: SandboxProviderType): Promise<void> {
    try {
      const prov = await getSandboxProvider(provider);
      if (!prov.listSandboxes) return;
      const sandboxes = await prov.listSandboxes();
      const orphaned = sandboxes.filter(
        (sbx) => sbx.labels?.createdBy === 'sandbox-orchestrator'
      );
      if (orphaned.length === 0) return;
      logger.info('Cleaning up orphaned sandboxes', { provider, count: orphaned.length });
      for (const sbx of orphaned) {
        try {
          await prov.destroySandbox(sbx.id);
        } catch {
          // Best-effort — sandbox may already be gone
        }
      }
    } catch {
      // Best-effort — provider may not support listing
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

          // Hibernate instead of destroy — preserves state via auto-suspend
          // so sandboxes can be quickly resumed when demand returns
          try {
            const suspended = await autoSuspendService.suspendSandbox(handle.id, 'idle');
            if (suspended) {
              // Pass-7 #92: emit [RELEASED] for hibernation (state preserved,
              // not fully destroyed). markDestroyed is reserved for hard-kill.
              markDestroyed('sandbox', handle.id, {
                provider: providerType,
                userId: 'warm-pool',
                ageMs: Date.now() - (createdAt || Date.now()),
                teardown: 'suspended',
              });
              logger.info('Hibernated idle warm sandbox (state preserved)', {
                provider: providerType,
                sandboxId: handle.id,
                ageMs: Date.now() - (createdAt || Date.now()),
              });
            } else if (provider) {
              // Fallback: provider doesn't support suspension, destroy instead
              await provider.destroySandbox(handle.id);
              markDestroyed('sandbox', handle.id, {
                provider: providerType,
                userId: 'warm-pool',
                ageMs: Date.now() - (createdAt || Date.now()),
                teardown: 'destroyed',
              });
              logger.info('Destroyed idle warm sandbox (hibernation not supported)', {
                provider: providerType,
                sandboxId: handle.id,
                ageMs: Date.now() - (createdAt || Date.now()),
              });
            }
          } catch (err: any) {
            // Last resort: destroy if hibernation fails
            logger.warn('Failed to hibernate idle warm sandbox, destroying', {
              provider: providerType,
              sandboxId: handle.id,
              error: err.message,
            });
            if (provider) {
              try {
                await provider.destroySandbox(handle.id);
                markDestroyed('sandbox', handle.id, {
                  provider: providerType,
                  userId: 'warm-pool',
                  ageMs: Date.now() - (createdAt || Date.now()),
                  teardown: 'destroyed-after-hibernate-failure',
                });
              } catch {
                // Sandbox may already be dead
              }
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
   *
   * @param ownerResolution Optional pre-resolved FilesystemOwnerResolution
   *   from the caller. Captured on the binding so startAffinityCleanup can
   *   snapshot the workspace under the correct VFS ownerId even though the
   *   cleanup tick has no request context. If the binding is updated and
   *   the new ownerResolution is omitted, the existing one is preserved
   *   (cross-provider migrations re-use the same identity).
   */
  setAffinity(
    workspaceId: string,
    provider: SandboxProviderType,
    sandboxId: string,
    workspaceDir: string,
    ownerResolution?: FilesystemOwnerResolution,
  ): void {
    const existing = this.affinityBindings.get(workspaceId);
    const commandCount = existing ? existing.commandCount + 1 : 1;
    // Preserve existing ownerResolution on update unless the caller
    // explicitly provides a new one. Migrations re-bind the same user.
    const capturedOwnerResolution = ownerResolution ?? existing?.ownerResolution;

    this.affinityBindings.set(workspaceId, {
      workspaceId,
      provider,
      sandboxId,
      workspaceDir,
      boundAt: existing?.boundAt ?? Date.now(),
      lastUsedAt: Date.now(),
      ttl: this.AFFINITY_TTL_MS,
      commandCount,
      ownerResolution: capturedOwnerResolution,
    });

    logger.debug('Affinity binding set', {
      workspaceId,
      provider,
      commandCount,
      hasOwnerResolution: !!capturedOwnerResolution,
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
    //
    // SAFETY (Pass-7): the previous code used `workspaceId.split(':')`
    // without validating the format. If the workspaceId was an
    // anonymous id like `anon:1781575460175_3ec237956ae556b95a`, the
    // split produced `['anon', '1781575460175_3ec237956ae556b95a']`
    // and the lookup compared `session.userId === 'anon'` — which
    // would never match a real session (sessions are keyed by
    // authenticated userId). The function returned `null` in that
    // case, which is the correct behavior, but the split was
    // fragile. Validate the format here and bail early if it doesn't
    // match the expected `userId:conversationId` shape.
    if (typeof workspaceId !== 'string') return null;
    const colonIdx = workspaceId.indexOf(':');
    if (colonIdx <= 0 || colonIdx === workspaceId.length - 1) return null;
    const userId = workspaceId.slice(0, colonIdx);
    const conversationId = workspaceId.slice(colonIdx + 1);
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
   *
   * userId resolution (Pass-7 follow-up): the cleanup tick runs in a
   * setInterval from the constructor and has NO NextRequest in scope, so
   * we cannot call `resolveFilesystemOwner(req)` here. Instead, we use the
   * FilesystemOwnerResolution that callers (e.g. getSandbox) capture on
   * the AffinityBinding at creation time and pass through setAffinity.
   * That is the authoritative ownerId (it came from resolveFilesystemOwner
   * at the API route), so the VFS snapshot is correctly attributed even
   * though we are no longer in request scope.
   *
   * If the binding has no captured ownerResolution (legacy binding, or
   * the caller omitted it), we fall back to the orchestrator's own
   * session lookup. This is safer than the previous workspaceId.split
   * fallback (which produced the literal string 'anon' or 'unknown' and
   * caused cross-session contamination), but it can still fail if the
   * session expired before the binding TTL. In that case we log loudly
   * and evict the binding — the same behavior as before this fix.
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
            // Bug fix (Pass-7): the previous code used `workspaceId.split(':')[0]`
            // which produced the literal string 'anon' when the workspaceId had
            // the anonymous format `anon:<sessionId>`, and 'unknown' when the
            // split failed. Both values then propagated as the VFS ownerId and
            // caused cross-session workspace contamination (visible as
            // `[VFS] getWorkspaceVersion called { ownerId: 'anon' }` in logs).
            //
            // Pass-7 follow-up: the cleanup tick cannot call
            // `resolveFilesystemOwner(req)` because it has no NextRequest.
            // Instead, callers thread a pre-resolved FilesystemOwnerResolution
            // through setAffinity (see AffinityBinding.ownerResolution), and
            // we use that here. This is the authoritative ownerId because it
            // came from the API route's auth resolution.
            //
            // Split per Pass-7 reviewer nit: validate userId outside the
            // try so a legitimate createSnapshot failure (network, timeout)
            // is NOT conflated with a userId resolution failure. The userId
            // check is a hard precondition; the snapshot is best-effort and
            // is already wrapped in its own try/catch.
            let userId: string | undefined = binding.ownerResolution?.ownerId;
            if (!userId) {
              // Fallback: session lookup. Same warning behavior as before,
              // but only triggered if the caller never threaded an
              // ownerResolution through (legacy binding or non-route caller).
              const session = this.findSessionByWorkspaceId(workspaceId);
              userId = session?.userId;
            }
            if (!userId) {
              logger.warn(
                '[sandbox-orchestrator] startAffinityCleanup: skipping binding due to userId resolution failure',
                {
                  workspaceId,
                  error:
                    `could not resolve userId for workspaceId=${workspaceId}; ` +
                    'neither the binding ownerResolution nor the orchestrator session lookup produced a userId. ' +
                    'Callers should pass the FilesystemOwnerResolution from resolveFilesystemOwner(req) into getSandbox() ' +
                    'so the cleanup tick can attribute the snapshot to the correct VFS owner.',
                },
              );
              // Evict the affinity binding so we don't loop on it.
              this.evictAffinity(workspaceId);
              continue;
            }
            try {
              await workspaceFSSnapshotService.createSnapshot(
                workspaceId,
                userId,
                binding.sandboxId,
                binding.provider,
                binding.workspaceDir,
              );
            } catch (err: any) {
              // Best-effort — snapshot failure should not block affinity
              // eviction. The workspace FS will be re-snapshotted on the
              // next re-bind.
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

    const handle = await trackOperation(
      'sandbox.create',
      { userId, conversationId, provider: providerType, policy },
      () => provider.createSandbox({
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
      }),
    );

    // Pass-7 #92: emit the canonical [INITIALIZED] event so meta-monitoring
    // can grep for it. Paired with markDestroyed in warm-pool-cleanup,
    // evictSession, and migrateSession so the init:teardown ratio is
    // visible in run.log.
    markInitialized('sandbox', handle.id, {
      provider: providerType,
      userId,
      conversationId,
    });

    const sandboxRoot = handle.workspaceDir || '/';
    const sandboxWorkspaceDir = workspaceDir.startsWith(sandboxRoot)
      ? workspaceDir
      : `${sandboxRoot.replace(/\/+$/, '')}${workspaceDir}`;
    await handle.executeCommand(`mkdir -p "${sandboxWorkspaceDir.replace(/(["\\$`])/g, '\\$1')}"`);

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

// ============================================================================
// HMR-safe singleton (matches the RuntimeBroker hoist pattern)
// ============================================================================
//
// Without this, every Next.js dev-mode HMR cycle re-evaluates this module,
// creating a fresh `new SandboxOrchestrator()` instance and exporting it.
// The new instance loses the warm pool, active sessions, affinity map, and
// cleanup timers — silently replacing the working orchestrator with a broken
// empty object. (The prior in-constructor `__sandboxOrchestratorInited`
// guard made this WORSE: it prevented the warm pool from re-initing but
// still exported the empty instance.)
//
// Type-safe globalThis augmentation (same shape as `__runtimeBroker`) keeps
// the property visible to TypeScript without `as any` casts at every call
// site.
declare global {
  // eslint-disable-next-line no-var
  var __sandboxOrchestrator: SandboxOrchestrator | undefined;
}

/**
 * The process-wide SandboxOrchestrator instance. Lives on `globalThis` so
 * it survives HMR module re-evaluation; the constructor runs exactly once
 * per process boot.
 */
export const sandboxOrchestrator: SandboxOrchestrator =
  globalThis.__sandboxOrchestrator ||
  (globalThis.__sandboxOrchestrator = new SandboxOrchestrator());
