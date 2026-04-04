/**
 * Sandbox Orchestrator - Coordination Layer
 *
 * Coordinates existing sandbox components for unified lifecycle management.
 * DOES NOT replace existing components - orchestrates them.
 */

import { ESCALATION_PROFILES } from '../../packages/shared/agent/timeout-escalation';
import { createLogger } from '../utils/logger';
import { providerRouter, type TaskContext } from './provider-router';
import { sessionManager } from '../session/session-manager';
import { resourceMonitor, type ResourceMetrics } from '../management/resource-monitor';
import { taskRouter } from '../../packages/shared/agent/task-router';
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

export class SandboxOrchestrator {
  private warmPool = new Map<SandboxProviderType, SandboxHandle[]>();
  private sessions = new Map<string, OrchestratorSession>();
  private readonly WARM_POOL_SIZE = 3;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  private readonly MIGRATION_CPU_THRESHOLD = 80;
  private readonly MIGRATION_MEMORY_THRESHOLD = 90;

  constructor() {
    void this.initializeWarmPool();
    this.startIdleCleanup();
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

    const routing = taskRouter.analyzeTask(task);
    const policy = this.normalizePolicyForSandbox(explicitPolicy || risk.recommendedPolicy);
    const providerContext = this.buildTaskContext(routing.type, policy);
    const provider = await providerRouter.selectOptimalProvider(providerContext);

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
        handle = await this.createSandboxHandle(userId, conversationId, provider, policy);
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

    logger.info('Sandbox session created', {
      sessionId: orchestratorSession.sessionId,
      provider,
      policy,
      riskLevel: risk.level,
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

    const providers: SandboxProviderType[] = ['daytona', 'e2b', 'sprites'];

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
        logger.debug('Added warm sandbox', { provider, poolSize: pool.length });
      } catch (error: any) {
        logger.warn('Failed to create warm sandbox', { provider, error: error.message });
        break;
      }
    }

    this.warmPool.set(provider, pool);
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

  private async createSandboxHandle(
    userId: string,
    conversationId: string,
    providerType: SandboxProviderType,
    policy: ExecutionPolicy,
  ): Promise<SandboxHandle> {
    const provider = await getSandboxProvider(providerType);
    const policyConfig = getExecutionPolicyConfig(policy);
    const preferredProviders = getPreferredProviders(policy);

    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    // CRITICAL FIX: Normalize conversationId before sanitizing for workspace path
    const simpleSessionId = normalizeSessionId(conversationId) || conversationId; // Use original if normalize returns empty
    const safeConvId = simpleSessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const workspaceDir = `/workspace/users/${safeUserId}/sessions/${safeConvId}`;
    const handle = await provider.createSandbox({
      language: 'typescript',
      autoStopInterval: 3600,
      envVars: {
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
    return handle;
  }
}

export const sandboxOrchestrator = new SandboxOrchestrator();
