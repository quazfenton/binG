/**
 * Sandbox Orchestrator - Coordination Layer
 *
 * Coordinates existing sandbox components for unified lifecycle management.
 * DOES NOT replace existing components - orchestrates them.
 *
 * Components coordinated:
 * - provider-router.ts: Provider selection with latency tracking
 * - session-manager.ts: Session lifecycle management
 * - resource-monitor.ts: Resource monitoring and alerts
 * - task-router.ts: Task routing (OpenCode vs Nullclaw)
 *
 * NEW features added:
 * - Warm pool management (pre-warmed sandboxes)
 * - Auto-migration coordination
 * - Risk-based execution blocking
 * - Unified API for sandbox access
 *
 * @see EXECUTION_POLICY_AUDIT.md for integration strategy
 */

import { createLogger } from '../utils/logger';
import { providerRouter, type TaskContext } from './provider-router';
import { sessionManager } from '../session/session-manager';
import { resourceMonitor, type ResourceMetrics } from '../management/resource-monitor';
import { taskRouter } from '../agent/task-router';
import {
  assessRisk,
  type ExecutionPolicy,
  type RiskAssessment,
} from './types';
import type { SandboxHandle } from './providers/sandbox-provider';
import type { SandboxProviderType } from './providers';

const logger = createLogger('Sandbox:Orchestrator');

/**
 * Sandbox session metadata (extends existing Session)
 */
export interface OrchestratorSession {
  sessionId: string;
  userId: string;
  conversationId: string;
  handle: SandboxHandle;
  provider: SandboxProviderType;
  policy: ExecutionPolicy;
  riskAssessment?: RiskAssessment;
  createdAt: number;
  lastActivityAt: number;
  migrationCount: number;
  isWarm: boolean;
}

/**
 * Sandbox migration result
 */
export interface MigrationResult {
  success: boolean;
  fromProvider: SandboxProviderType | 'unknown';
  toProvider: SandboxProviderType | 'unknown';
  reason: string;
  duration: number;
  error?: string;
}

/**
 * Sandbox Orchestrator Class
 *
 * Coordinates existing components - does NOT replace them.
 */
export class SandboxOrchestrator {
  private warmPool = new Map<SandboxProviderType, SandboxHandle[]>();
  private readonly WARM_POOL_SIZE = 3;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MIGRATION_CPU_THRESHOLD = 80; // 80% CPU
  private readonly MIGRATION_MEMORY_THRESHOLD = 90; // 90% memory

  constructor() {
    this.initializeWarmPool();
    this.startIdleCleanup();
  }

  /**
   * Get or create sandbox session
   *
   * Coordinates:
   * 1. task-router.ts for task analysis
   * 2. assessRisk() for security check
   * 3. provider-router.ts for provider selection
   * 4. session-manager.ts for session creation
   * 5. Warm pool for fast startup
   */
  async getSandbox(options: {
    userId: string;
    conversationId: string;
    task: string;
    policy?: ExecutionPolicy;
  }): Promise<OrchestratorSession> {
    const { userId, conversationId, task, policy: explicitPolicy } = options;

    // Step 1: Risk assessment (NEW - security check)
    const risk = assessRisk(task);
    if (risk.shouldBlock) {
      throw new Error(risk.blockReason);
    }

    // Step 2: Task routing (existing component)
    const routing = taskRouter.analyzeTask(task);

    // Step 3: Determine execution policy
    const policy = explicitPolicy || risk.recommendedPolicy;

    // Step 4: Select provider using existing provider-router
    const provider = await providerRouter.selectOptimalProvider({
      type: routing.type as any,
      executionPolicy: policy,
    } as TaskContext);

    // Step 5: Try warm pool first (NEW - performance)
    const warmSandbox = await this.getFromWarmPool(provider);

    let handle: SandboxHandle;
    if (warmSandbox) {
      logger.info('Using warm sandbox from pool', { provider });
      handle = warmSandbox;
    } else {
      // Step 6: Create session using existing session-manager
      logger.info('Creating new session via session-manager', { provider, policy });
      const session = await sessionManager.getOrCreateSession(userId, conversationId, {
        executionPolicy: policy,
        userId,
        conversationId,
      });

      handle = session.sandboxHandle!;
    }

    // Create orchestrator session
    const orchestratorSession: OrchestratorSession = {
      sessionId: handle.id,
      userId,
      conversationId,
      handle,
      provider,
      policy,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      riskAssessment: risk,
      migrationCount: 0,
      isWarm: !!warmSandbox,
    };

    // Replenish warm pool
    this.replenishWarmPool(provider);

    logger.info('Sandbox session created', {
      sessionId: orchestratorSession.sessionId,
      provider,
      policy,
      riskLevel: risk.level,
    });

    return orchestratorSession;
  }

  /**
   * Execute command in sandbox with monitoring
   *
   * Coordinates:
   * - resource-monitor.ts for resource tracking
   * - Auto-migration if thresholds exceeded
   */
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

    // Update activity
    session.lastActivityAt = Date.now();

    // Assess command risk
    const risk = assessRisk(command);
    if (risk.shouldBlock) {
      throw new Error(risk.blockReason);
    }

    // Check if migration needed before execution
    const metrics = await resourceMonitor.getResourceUsage(sessionId);
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

    try {
      // Execute command using handle's executeCommand method
      const result = await Promise.race([
        session.handle.executeCommand(command, undefined, timeout),
        new Promise<{ success: boolean; output?: string; error?: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Command timeout')), timeout)
        ),
      ]);

      const duration = Date.now() - startTime;

      // Report progress if callback provided
      if (options?.onProgress) {
        const updatedMetrics = await resourceMonitor.getResourceUsage(sessionId);
        options.onProgress(updatedMetrics);
      }

      return { 
        output: result.output || '', 
        exitCode: 'exitCode' in result ? (result.exitCode ?? (result.success ? 0 : 1)) : (result.success ? 0 : 1), 
        duration 
      };
    } catch (error: any) {
      logger.error('Command execution failed', {
        sessionId,
        command: command.substring(0, 100),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Migrate session to different provider
   *
   * Coordinates:
   * - provider-router.ts for new provider selection
   * - session-manager.ts for session transfer
   */
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
      // Select new provider using existing provider-router
      const toProvider = await providerRouter.selectOptimalProvider({
        type: 'general',
        executionPolicy: session.policy,
      } as TaskContext);

      if (toProvider === fromProvider) {
        return {
          success: false,
          fromProvider,
          toProvider,
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

      // Create new session using session-manager
      const newSession = await sessionManager.getOrCreateSession(
        session.userId,
        session.conversationId,
        { 
          executionPolicy: session.policy,
          userId: session.userId,
          conversationId: session.conversationId,
        }
      );

      // Update orchestrator session
      session.handle = newSession.sandboxHandle!;
      session.provider = toProvider;
      session.migrationCount++;
      session.lastActivityAt = Date.now();

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

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<OrchestratorSession | null> {
    // This would need to track sessions - for now returns null
    // In production, would integrate with session-manager
    return null;
  }

  // ========== Private Methods ==========

  private async getFromWarmPool(provider: SandboxProviderType): Promise<SandboxHandle | null> {
    const pool = this.warmPool.get(provider);
    if (!pool || pool.length === 0) {
      return null;
    }

    const handle = pool.pop()!;

    // Verify sandbox is still healthy
    try {
      await handle.executeCommand('echo health_check');
      return handle;
    } catch {
      // Sandbox unhealthy, discard and try next
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
        // Create sandbox using session-manager
        const session = await sessionManager.getOrCreateSession(
          'warm-pool',
          `warm-${provider}-${Date.now()}`,
          { 
            executionPolicy: 'sandbox-preferred',
            userId: 'warm-pool',
            conversationId: `warm-${provider}-${Date.now()}`,
          }
        );

        pool.push(session.sandboxHandle!);
        logger.debug('Added warm sandbox', { provider, poolSize: pool.length });
      } catch (error: any) {
        logger.warn('Failed to create warm sandbox', { provider, error: error.message });
        break;
      }
    }

    this.warmPool.set(provider, pool);
  }

  private shouldMigrate(metrics: ResourceMetrics): boolean {
    return (
      metrics.cpuUsage > this.MIGRATION_CPU_THRESHOLD ||
      metrics.memoryUsage > this.MIGRATION_MEMORY_THRESHOLD
    );
  }

  private startIdleCleanup(): void {
    setInterval(async () => {
      // Would integrate with session-manager for actual cleanup
      // This is a placeholder for the coordination logic
    }, 60000); // Check every minute
  }
}

// Singleton instance
export const sandboxOrchestrator = new SandboxOrchestrator();
