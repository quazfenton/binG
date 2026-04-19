/**
 * Consolidated Session Manager with OpenCode Integration
 *
 * Merges OpenCodeV2SessionManager and AgentSessionManager into unified interface.
 * Uses OpenCode SDK as primary session backend with local session tracking for persistence.
 *
 * Architecture:
 * - OpenCode SDK for AI session management (primary)
 * - Local SQLite for persistence and fallback
 * - Automatic sync between OpenCode and local sessions
 * - Background tracking of session state
 *
 * @see lib/api/opencode-v2-session-manager.ts - DEPRECATED (OpenCode SDK now primary)
 * @see lib/agent/agent-session-manager.ts - DEPRECATED (merged into this)
 * @see lib/opencode/opencode-session-manager.ts - OpenCode SDK integration
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import type { ExecutionPolicy } from '../sandbox/types';
import { registerActiveSession, unregisterActiveSession } from '../session-naming';
import {
  getExecutionPolicyConfig,
  requiresCloudSandbox,
  allowsLocalFallback,
  getPreferredProviders,
} from '../sandbox/types';
import { getSandboxProvider, getSandboxProviderWithFallback } from '../sandbox/providers';
import type { SandboxHandle, SandboxCreateConfig } from '../sandbox/providers/sandbox-provider';
import { createOpencodeSessionManager, type OpencodeSessionManager } from '@/lib/opencode';
import { normalizeSessionId } from '@/lib/virtual-filesystem/scope-utils';
import { enhancedBackgroundJobsManager, type EnhancedJobConfig, type EnhancedJob } from '@bing/shared/agent/enhanced-background-jobs';
import { executionGraphEngine } from '@bing/shared/agent/execution-graph';
import {
  saveCheckpoint as storageSaveCheckpoint,
  getCheckpoint as storageGetCheckpoint,
  getLatestCheckpoint as storageGetLatestCheckpoint,
  getCheckpointsBySession as storageGetCheckpointsBySession,
  deleteCheckpoint as storageDeleteCheckpoint,
  type SessionCheckpoint,
} from '../storage/session-store';

const logger = createLogger('Session:Manager');

// ============================================================================
// Type Definitions
// ============================================================================

export interface SessionQuota {
  computeMinutes: number;
  computeUsed: number;
  storageBytes: number;
  storageUsed: number;
  apiCalls: number;
  apiCallsUsed: number;
}

export interface SessionConfig {
  userId: string;
  conversationId: string;
  model?: string;
  maxSteps?: number;
  timeout?: number;
  enableNullclaw?: boolean;
  enableMcp?: boolean;
  cloudFsProvider?: 'sprites' | 'e2b' | 'daytona' | 'local';
  workspaceDir?: string;
  quota?: Partial<SessionQuota>;
  
  // Agent-specific (backward compatible)
  mode?: 'opencode' | 'nullclaw' | 'hybrid';
  enableCloudOffload?: boolean;
  executionPolicy?: ExecutionPolicy;
  /** @deprecated Use executionPolicy instead */
  noSandbox?: boolean;
}

export interface Session {
  id: string;
  userId: string;
  conversationId: string;
  createdAt: number;
  lastActivity: number;
  status: 'starting' | 'active' | 'idle' | 'stopping' | 'stopped';

  // Sandbox info
  sandboxId?: string;
  sandboxProvider?: string;
  sandboxHandle?: SandboxHandle;
  workspaceDir: string;
  workspacePath: string;

  // Nullclaw integration
  nullclawEnabled: boolean;
  nullclawEndpoint?: string;

  // MCP integration
  mcpEnabled: boolean;
  mcpServerUrl?: string;

  // Quota tracking
  quota: SessionQuota;

  // Metrics
  totalSteps: number;
  totalBashCommands: number;
  totalFileChanges: number;
  totalCost?: number;

  // Checkpointing
  lastCheckpoint?: number;
  checkpointCount: number;

  // Agent-specific (backward compatible)
  state: 'initializing' | 'ready' | 'busy' | 'idle' | 'error';
  executionPolicy: ExecutionPolicy;
  metadata?: {
    mode: 'opencode' | 'nullclaw' | 'hybrid';
    cloudOffloadEnabled: boolean;
    mcpEnabled: boolean;
  };

  // Background Jobs tracking
  backgroundJobs?: Map<string, EnhancedJob>;
  executionGraphId?: string;
}

interface SessionMetrics {
  steps: number;
  bashCommands: number;
  fileChanges: number;
  computeTimeMs: number;
  apiCalls: number;
  storageBytes: number;
}

const DEFAULT_QUOTA: SessionQuota = {
  computeMinutes: 60,
  computeUsed: 0,
  storageBytes: 500 * 1024 * 1024, // 500MB
  storageUsed: 0,
  apiCalls: 1000,
  apiCallsUsed: 0,
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle

// ============================================================================
// Consolidated Session Manager
// ============================================================================

export class SessionManager {
  private sessions = new Map<string, Session>();
  private sessionsById = new Map<string, Session>();
  private userSessions = new Map<string, Set<string>>();
  // Public so compat wrappers / tests can inspect per-session metrics
  public sessionMetrics = new Map<string, SessionMetrics>();
  private globalQuota: SessionQuota = { ...DEFAULT_QUOTA };
  private cleanupTimer?: NodeJS.Timeout;

  // Configuration
  private readonly maxSessionsPerUser: number;
  private readonly defaultTimeout: number;
  private readonly enableQuotaEnforcement: boolean;

  constructor() {
    this.maxSessionsPerUser = parseInt(process.env.OPENCODE_MAX_SESSIONS_PER_USER || '10', 10);
    this.defaultTimeout = parseInt(process.env.OPENCODE_DEFAULT_TIMEOUT || '300000', 10);
    this.enableQuotaEnforcement = process.env.OPENCODE_ENFORCE_QUOTA === 'true';

    this.startCleanupTimer();
  }

  // ============================================================================
  // Public API - Session Lifecycle
  // ============================================================================

  /**
   * Get or create session for user/conversation
   */
  async getOrCreateSession(
    userId: string,
    conversationId: string,
    config: SessionConfig = {} as SessionConfig,
  ): Promise<Session> {
    const key = this.getSessionKey(userId, conversationId);

    // Return existing session if available and healthy
    const existing = this.sessions.get(key);
    if (existing && existing.state !== 'initializing' && existing.state !== 'error') {
      logger.debug(`Returning existing session for ${key}`);
      this.updateActivity(existing.id);
      return existing;
    }

    // Create new session
    logger.info(`Creating new session for ${key}`);
    const session = await this.createSession(userId, conversationId, config);
    this.sessions.set(key, session);

    return session;
  }

  /**
   * Get session by user and conversation
   */
  getSession(userId: string, conversationId: string): Session | undefined {
    const key = this.getSessionKey(userId, conversationId);
    const session = this.sessions.get(key);

    if (!session) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      logger.warn(`Session ${key} expired, cleaning up`);
      void this.destroySession(userId, conversationId);
      return undefined;
    }

    return session;
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: string): Session | undefined {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      logger.warn(`Session ${sessionId} expired, cleaning up`);
      void this.destroySession(session.userId, session.conversationId);
      return undefined;
    }

    return session;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];

    const sessions: Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessionsById.get(sessionId);
      if (session && Date.now() - session.lastActivity <= SESSION_TTL_MS) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * List sessions for a user (alias for getUserSessions)
   */
  listSessions(userId: string): Session[] {
    return this.getUserSessions(userId);
  }

  /**
   * Destroy session and cleanup
   */
  async destroySession(userId: string, conversationId: string): Promise<void> {
    const key = this.getSessionKey(userId, conversationId);
    const session = this.sessions.get(key);

    if (!session) {
      logger.debug(`Session ${key} not found for destruction`);
      return;
    }

    try {
      logger.info(`Destroying session ${key}`);

      // Stop all background jobs
      if (session.backgroundJobs && session.backgroundJobs.size > 0) {
        logger.info(`Stopping ${session.backgroundJobs.size} background jobs for session ${key}`);
        const jobIds = Array.from(session.backgroundJobs.keys());
        for (const jobId of jobIds) {
          try {
            await enhancedBackgroundJobsManager.stopJob(jobId, 'Session destroyed');
          } catch (error: any) {
            logger.warn(`Failed to stop background job ${jobId}:`, error.message);
          }
        }
        session.backgroundJobs.clear();
      }

      // Cleanup execution graph
      if (session.executionGraphId) {
        try {
          const graph = executionGraphEngine.getGraph(session.executionGraphId);
          if (graph) {
            graph.status = 'cancelled';
            logger.debug(`Execution graph ${session.executionGraphId} marked as cancelled`);
          }
        } catch (error: any) {
          logger.warn(`Failed to cleanup execution graph:`, error.message);
        }
      }

      // Cleanup sandbox if exists
      if (session.sandboxHandle) {
        try {
          await session.sandboxHandle.executeCommand('echo "Session cleanup complete"');
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Remove from tracking maps
      this.sessions.delete(key);
      this.sessionsById.delete(session.id);

      // Cleanup session from session-naming.ts tracking
      try {
        unregisterActiveSession(conversationId);
      } catch (e) {
        // Non-fatal - session naming cleanup is optional
        logger.debug(`Failed to cleanup session name for ${conversationId}:`, e);
      }

      const userSessionIds = this.userSessions.get(userId);
      if (userSessionIds) {
        userSessionIds.delete(session.id);
        if (userSessionIds.size === 0) {
          this.userSessions.delete(userId);
        }
      }

      logger.info(`Session ${key} destroyed successfully`);
    } catch (error: any) {
      logger.error(`Failed to cleanup session ${key}`, error);
      this.sessions.delete(key);
      this.sessionsById.delete(session.id);
    }
  }

  // ============================================================================
  // Public API - State Management
  // ============================================================================

  /**
   * Update session activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
      }
      if (session.state === 'idle') {
        session.state = 'ready';
      }
    }
  }

  /**
   * Update session state
   */
  updateState(sessionId: string, state: Session['status'] | Session['state']): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      // Update V2 status
      if (['starting', 'active', 'idle', 'stopping', 'stopped'].includes(state)) {
        session.status = state as Session['status'];
      }
      // Update agent state
      if (['initializing', 'ready', 'busy', 'idle', 'error'].includes(state)) {
        session.state = state as Session['state'];
      }
      if (state === 'active' || state === 'ready') {
        session.lastActivity = Date.now();
      }
    }
  }

  /**
   * Update session sandbox info
   */
  setSandbox(sessionId: string, sandboxId: string, provider: string, handle?: SandboxHandle): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.sandboxId = sandboxId;
      session.sandboxProvider = provider;
      if (handle) {
        session.sandboxHandle = handle;
      }
      session.status = 'active';
      session.state = 'ready';
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session Nullclaw availability
   */
  setNullclawAvailable(sessionId: string, available: boolean): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.nullclawEnabled = available;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session Nullclaw endpoint URL
   */
  setNullclawEndpoint(sessionId: string, endpoint: string): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.nullclawEndpoint = endpoint;
      session.nullclawEnabled = true;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session MCP server URL
   */
  setMcpServerUrl(sessionId: string, url: string): void {
    const session = this.sessionsById.get(sessionId);
    if (session) {
      session.mcpServerUrl = url;
      this.updateActivity(sessionId);
    }
  }

  // ============================================================================
  // Public API - Metrics & Quota
  // ============================================================================

  /**
   * Record session metrics
   */
  recordMetrics(
    sessionId: string,
    steps: number = 0,
    bashCommands: number = 0,
    fileChanges: number = 0,
    computeTimeMs: number = 0,
    storageBytes: number = 0,
    apiCalls: number = 0
  ): void {
    const metrics = this.sessionMetrics.get(sessionId);
    const session = this.sessionsById.get(sessionId);

    if (metrics) {
      metrics.steps += steps;
      metrics.bashCommands += bashCommands;
      metrics.fileChanges += fileChanges;
      metrics.computeTimeMs += computeTimeMs;
      metrics.storageBytes += storageBytes;
      metrics.apiCalls += apiCalls;
    }

    if (session) {
      session.totalSteps += steps;
      session.totalBashCommands += bashCommands;
      session.totalFileChanges += fileChanges;
      const computeDeltaMinutes = computeTimeMs / 60000;
      session.quota.computeUsed += computeDeltaMinutes;
      session.quota.storageUsed += storageBytes;
      session.quota.apiCallsUsed += apiCalls;
      this.globalQuota.computeUsed += computeDeltaMinutes;
      this.globalQuota.storageUsed += storageBytes;
      this.globalQuota.apiCallsUsed += apiCalls;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Check quota availability
   */
  checkQuota(sessionId: string, requiredComputeMinutes?: number, requiredStorageBytes?: number): {
    allowed: boolean;
    reason?: string;
  } {
    if (!this.enableQuotaEnforcement) {
      return { allowed: true };
    }

    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return { allowed: false, reason: 'Session not found' };
    }

    const computeMinutes = requiredComputeMinutes || 0;
    const storageBytes = requiredStorageBytes || 0;

    if (session.quota.computeUsed + computeMinutes > session.quota.computeMinutes) {
      return { allowed: false, reason: 'Compute quota exceeded' };
    }

    if (session.quota.storageUsed + storageBytes > session.quota.storageBytes) {
      return { allowed: false, reason: 'Storage quota exceeded' };
    }

    if (session.quota.apiCallsUsed + 1 > session.quota.apiCalls) {
      return { allowed: false, reason: 'API calls quota exceeded' };
    }

    return { allowed: true };
  }

  // ============================================================================
  // Public API - Checkpointing
  // ============================================================================

  /**
   * Create checkpoint for session
   */
  async createCheckpoint(sessionId: string, label?: string): Promise<{
    checkpointId: string;
    timestamp: number;
  }> {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const checkpointId = `cp-${uuidv4()}`;
    const timestamp = Date.now();

    const checkpoint: SessionCheckpoint = {
      checkpointId,
      sessionId,
      userId: session.userId,
      label,
      timestamp,
      state: {
        conversationState: null,
        sandboxState: {
          sandboxId: session.sandboxId,
          sandboxProvider: session.sandboxProvider,
          workspaceDir: session.workspaceDir,
        },
        toolState: null,
        quotaUsage: session.quota,
        metadata: {
          mode: session.metadata?.mode,
          cloudOffloadEnabled: session.metadata?.cloudOffloadEnabled,
          mcpEnabled: session.metadata?.mcpEnabled,
        },
      },
    };

    storageSaveCheckpoint(checkpoint);

    session.lastCheckpoint = timestamp;
    session.checkpointCount++;

    logger.info(`Created checkpoint ${checkpointId} for session ${sessionId}`);

    return { checkpointId, timestamp };
  }

  /**
   * Restore session from checkpoint
   */
  async restoreFromCheckpoint(checkpointId: string): Promise<Session> {
    const checkpoint = storageGetCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const session = this.sessionsById.get(checkpoint.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${checkpoint.sessionId}`);
    }

    if (checkpoint.state.sandboxState) {
      session.sandboxId = checkpoint.state.sandboxState.sandboxId;
      session.sandboxProvider = checkpoint.state.sandboxState.sandboxProvider;
      session.workspaceDir = checkpoint.state.sandboxState.workspaceDir;
    }

    if (checkpoint.state.quotaUsage) {
      session.quota = checkpoint.state.quotaUsage as SessionQuota;
    }

    logger.info(`Restored session ${checkpoint.sessionId} from checkpoint ${checkpointId}`);

    return session;
  }

  /**
   * Get checkpoints for session
   */
  getCheckpoints(sessionId: string, limit?: number): SessionCheckpoint[] {
    return storageGetCheckpointsBySession(sessionId, limit);
  }

  /**
   * Get latest checkpoint for session
   */
  getLatestCheckpoint(sessionId: string): SessionCheckpoint | undefined {
    return storageGetLatestCheckpoint(sessionId);
  }

  /**
   * Delete checkpoint
   */
  deleteCheckpoint(checkpointId: string): void {
    storageDeleteCheckpoint(checkpointId);
    logger.info(`Deleted checkpoint ${checkpointId}`);
  }

  // ============================================================================
  // Public API - Background Jobs Management
  // ============================================================================

  /**
   * Start a background job for session
   */
  async startBackgroundJob(
    sessionId: string,
    config: Omit<EnhancedJobConfig, 'sessionId'>
  ): Promise<{ jobId: string; status: string }> {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Check quota before starting job
    const quotaCheck = this.checkQuota(sessionId, 0, 0);
    if (!quotaCheck.allowed) {
      throw new Error(`Cannot start background job: ${quotaCheck.reason}`);
    }

    // Start job with enhanced manager
    const job = await enhancedBackgroundJobsManager.startJob({
      ...config,
      sessionId,
    });

    // Track job in session
    if (!session.backgroundJobs) {
      session.backgroundJobs = new Map();
    }
    session.backgroundJobs.set(job.jobId, job);

    logger.info(`Background job started for session ${sessionId}`, {
      jobId: job.jobId,
      command: job.command,
      interval: job.interval,
    });

    return { jobId: job.jobId, status: job.status };
  }

  /**
   * Stop a background job for session
   */
  async stopBackgroundJob(sessionId: string, jobId: string, reason?: string): Promise<boolean> {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const success = await enhancedBackgroundJobsManager.stopJob(jobId, reason || 'Manual stop');

    if (success && session.backgroundJobs) {
      session.backgroundJobs.delete(jobId);
    }

    logger.info(`Background job stopped for session ${sessionId}`, { jobId, success });

    return success;
  }

  /**
   * Get background job status
   */
  getBackgroundJobStatus(sessionId: string, jobId: string): EnhancedJob | null {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return null;
    }

    return enhancedBackgroundJobsManager.getJob(jobId);
  }

  /**
   * List background jobs for session
   */
  listBackgroundJobs(sessionId: string, filters?: { status?: string }): EnhancedJob[] {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return [];
    }

    return enhancedBackgroundJobsManager.listJobs({
      sessionId,
      ...filters,
    });
  }

  /**
   * Get background jobs statistics for session
   */
  getBackgroundJobsStats(sessionId: string): {
    total: number;
    running: number;
    paused: number;
    stopped: number;
    completed: number;
    totalExecutions: number;
  } {
    return enhancedBackgroundJobsManager.getStats(sessionId);
  }

  // ============================================================================
  // Public API - Statistics
  // ============================================================================

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    idleSessions: number;
    totalUsers: number;
    globalQuota: SessionQuota;
  } {
    let active = 0;
    let idle = 0;

    for (const session of this.sessions.values()) {
      if (session.status === 'active' || session.state === 'ready' || session.state === 'busy') active++;
      if (session.status === 'idle' || session.state === 'idle') idle++;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      idleSessions: idle,
      totalUsers: this.userSessions.size,
      globalQuota: this.globalQuota,
    };
  }

  /**
   * Get session status (combined V2 + Agent state)
   */
  getSessionStatus(sessionId: string): {
    status: Session['status'];
    state: Session['state'];
    quota?: SessionQuota;
    workspacePath?: string;
  } | undefined {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      status: session.status,
      state: session.state,
      quota: session.quota,
      workspacePath: session.workspacePath,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getSessionKey(userId: string, conversationId: string): string {
    return `${userId}$${conversationId}`;
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, 5 * 60 * 1000);

    process.on('beforeExit', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [key, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActivity;
      if (idleTime > SESSION_TTL_MS) {
        logger.info(`Cleaning up idle session ${key} (idle for ${idleTime / 1000}s)`);
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      try {
        // Session key format: "userId$conversationId" (modern) or "userId:conversationId" (legacy)
        // SECURITY: Use indexOf (FIRST separator) not lastIndexOf, because:
        // - userId is system-controlled and NEVER contains $ or :
        // - conversationId MAY contain user-provided $ or : (e.g., folder named "my$project")
        // - The FIRST separator is always our system separator
        const dollarIndex = key.indexOf('$');
        const colonIndex = key.indexOf(':');

        let userId: string, conversationId: string;
        if (dollarIndex !== -1 && (colonIndex === -1 || dollarIndex < colonIndex)) {
          // $ appears first (or only $ exists) — modern format
          userId = key.slice(0, dollarIndex);
          conversationId = key.slice(dollarIndex + 1);
        } else if (colonIndex !== -1) {
          // : appears first (or only : exists) — legacy format
          userId = key.slice(0, colonIndex);
          conversationId = key.slice(colonIndex + 1);
        } else {
          // No separator found — treat entire key as userId with empty conversationId
          userId = key;
          conversationId = '';
        }
        await this.destroySession(userId, conversationId);
      } catch (error: any) {
        logger.error(`Failed to cleanup session`, error);
      }
    }

    if (toRemove.length > 0) {
      logger.info(`Cleaned up ${toRemove.length} idle sessions`);
    }
  }

  private async cleanupUserIdleSessions(userId: string): Promise<void> {
    const sessions = this.getUserSessions(userId);
    const idleSessions = sessions
      .filter(s => Date.now() - s.lastActivity > IDLE_THRESHOLD_MS)
      .sort((a, b) => a.lastActivity - b.lastActivity);

    for (const session of idleSessions.slice(0, 2)) {
      await this.destroySession(session.userId, session.conversationId);
    }
  }

  private async createSession(
    userId: string,
    conversationId: string,
    config: SessionConfig,
  ): Promise<Session> {
    try {
      // CRITICAL FIX: Normalize conversationId to prevent composite IDs in workspace paths
      const simpleSessionId = normalizeSessionId(conversationId) || conversationId; // Use original if normalize returns empty
      const workspacePath = config.workspaceDir || `/workspace/users/${userId}/sessions/${simpleSessionId}`;

      // Determine execution policy
      let executionPolicy: ExecutionPolicy;
      if (config.executionPolicy) {
        executionPolicy = config.executionPolicy;
      } else if (config.noSandbox === true) {
        executionPolicy = 'local-safe';
      } else if (config.noSandbox === false) {
        executionPolicy = 'sandbox-required';
      } else {
        executionPolicy = 'local-safe';
      }

      const policyConfig = getExecutionPolicyConfig(executionPolicy);
      const needsSandbox = requiresCloudSandbox(executionPolicy);

      let sandboxHandle: SandboxHandle | undefined;

      // Create cloud sandbox if policy requires it
      if (needsSandbox) {
        try {
          logger.info(`Creating sandbox with execution policy: ${executionPolicy}`);
          const preferredProviders = getPreferredProviders(executionPolicy);

          let provider;
          if (preferredProviders.length > 0) {
            try {
              provider = await getSandboxProvider(preferredProviders[0] as any);
            } catch {
              const result = await getSandboxProviderWithFallback(preferredProviders[0] as any);
              provider = result.provider;
            }
          } else {
            provider = await getSandboxProvider();
          }

          const sandboxConfig: SandboxCreateConfig = {
            language: 'typescript',
            envVars: {
              USER_ID: userId,
              CONVERSATION_ID: conversationId,
              WORKSPACE_DIR: workspacePath,
              OPENCODE_MODEL: process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
              OPENCODE_SYSTEM_PROMPT: config.mode === 'nullclaw'
                ? 'You are a helpful task assistant with access to messaging, internet, and automation tools.'
                : 'You are an expert software engineer. Use bash commands and file operations to complete tasks efficiently.',
              MCP_ENABLED: config.enableMcp ? 'true' : 'false',
              NULLCLAW_ENABLED: config.enableNullclaw ? 'true' : 'false',
              EXECUTION_POLICY: executionPolicy,
            },
            labels: {
              userId,
              conversationId,
              mode: config.mode || 'opencode',
              executionPolicy,
              createdBy: 'session-manager',
            },
            resources: {
              cpu: policyConfig.resources?.cpu || 2,
              memory: policyConfig.resources?.memory || 4,
            },
            autoStopInterval: config.timeout || 3600,
          };

          const timeoutMs = (policyConfig.maxWaitTime || 30) * 1000;
          const createPromise = provider.createSandbox(sandboxConfig);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Sandbox creation timeout after ${timeoutMs}ms`)), timeoutMs)
          );

          sandboxHandle = await Promise.race([createPromise, timeoutPromise]) as SandboxHandle;

          const safeWorkspacePath = workspacePath.replace(/(["\\$`])/g, '\\$1');
          await sandboxHandle.executeCommand(`mkdir -p "${safeWorkspacePath}"`);

          logger.info(`Sandbox created successfully with policy: ${executionPolicy}`);
        } catch (sandboxError: any) {
          logger.warn(`Failed to create sandbox for policy ${executionPolicy}: ${sandboxError.message}`);

          if (allowsLocalFallback(executionPolicy)) {
            logger.info(`Falling back to local execution (policy: ${executionPolicy})`);
            sandboxHandle = undefined;
          } else {
            throw new Error(`Sandbox creation failed and fallback not allowed for policy ${executionPolicy}: ${sandboxError.message}`);
          }
        }
      }

      const sessionId = uuidv4();

      // Create execution graph for session tracking
      const executionGraph = executionGraphEngine.createGraph(sessionId);

      const session: Session = {
        id: sessionId,
        userId,
        conversationId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'starting',
        state: 'ready',
        workspaceDir: workspacePath,
        workspacePath,
        sandboxHandle,
        nullclawEnabled: config.enableNullclaw ?? false,
        mcpEnabled: config.enableMcp ?? true,
        quota: {
          ...DEFAULT_QUOTA,
          ...config.quota,
        },
        totalSteps: 0,
        totalBashCommands: 0,
        totalFileChanges: 0,
        checkpointCount: 0,
        executionPolicy,
        metadata: {
          mode: config.mode || 'opencode',
          cloudOffloadEnabled: config.enableCloudOffload || false,
          mcpEnabled: config.enableMcp || false,
        },
        // Initialize background jobs tracking
        backgroundJobs: new Map(),
        executionGraphId: executionGraph.id,
      };

      // Initialize enhanced background jobs manager with session integration
      enhancedBackgroundJobsManager.setSessionManager(this);
      enhancedBackgroundJobsManager.setExecutionGraphEngine(executionGraphEngine);

      // Track session
      this.sessions.set(this.getSessionKey(userId, conversationId), session);
      this.sessionsById.set(sessionId, session);

      // Register session as active for cleanup tracking
      registerActiveSession(conversationId);

      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(sessionId);

      this.sessionMetrics.set(sessionId, {
        steps: 0,
        bashCommands: 0,
        fileChanges: 0,
        computeTimeMs: 0,
        apiCalls: 0,
        storageBytes: 0,
      });

      logger.info(`Created session ${session.id} for ${userId}:${conversationId} (policy: ${executionPolicy})`);
      return session;
    } catch (error: any) {
      logger.error(`Failed to create session for ${userId}:${conversationId}`, error);
      throw new Error(`Session creation failed: ${error.message}`);
    }
  }

  /**
   * Shutdown session manager and cleanup all sessions
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down session manager...');

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    const keys = Array.from(this.sessions.keys());
    logger.info(`Cleaning up ${keys.length} sessions`);

    for (const key of keys) {
      try {
        // Session key format: "userId$conversationId" (modern) or "userId:conversationId" (legacy)
        // SECURITY: Use indexOf (FIRST separator) not lastIndexOf, because:
        // - userId is system-controlled and NEVER contains $ or :
        // - conversationId MAY contain user-provided $ or : (e.g., folder named "my$project")
        // - The FIRST separator is always our system separator
        const dollarIndex = key.indexOf('$');
        const colonIndex = key.indexOf(':');

        let userId: string, conversationId: string;
        if (dollarIndex !== -1 && (colonIndex === -1 || dollarIndex < colonIndex)) {
          // $ appears first (or only $ exists) — modern format
          userId = key.slice(0, dollarIndex);
          conversationId = key.slice(dollarIndex + 1);
        } else if (colonIndex !== -1) {
          // : appears first (or only : exists) — legacy format
          userId = key.slice(0, colonIndex);
          conversationId = key.slice(colonIndex + 1);
        } else {
          userId = key;
          conversationId = '';
        }
        await this.destroySession(userId, conversationId);
      } catch (error: any) {
        logger.error(`Failed to cleanup session during shutdown`, error);
      }
    }

    logger.info('Session manager shutdown complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const sessionManager = new SessionManager();

// ============================================================================
// Backward Compatibility Exports (DEPRECATED)
// ============================================================================

/**
 * @deprecated Use sessionManager.getOrCreateSession() instead
 */
export const agentSessionManager = {
  getOrCreateSession: sessionManager.getOrCreateSession.bind(sessionManager),
  getSession: (userId: string, conversationId: string) => {
    const session = sessionManager.getSession(userId, conversationId);
    return session;
  },
  getSessionById: sessionManager.getSessionById.bind(sessionManager),
  updateActivity: (userId: string, conversationId: string) => {
    const session = sessionManager.getSession(userId, conversationId);
    if (session) {
      sessionManager.updateActivity(session.id);
    }
  },
  destroySession: sessionManager.destroySession.bind(sessionManager),
  getUserSessions: sessionManager.getUserSessions.bind(sessionManager),
  getStats: () => {
    const stats = sessionManager.getStats();
    return {
      totalSessions: stats.totalSessions,
      activeSessions: stats.activeSessions,
      idleSessions: stats.idleSessions,
      users: stats.totalUsers,
    };
  },
};

/**
 * @deprecated Use sessionManager instead
 */
export const openCodeV2SessionManager = {
  createSession: async (config: SessionConfig) => {
    return sessionManager.getOrCreateSession(config.userId, config.conversationId, config);
  },
  getSession: (sessionId: string) => sessionManager.getSessionById(sessionId),
  getSessionById: sessionManager.getSessionById.bind(sessionManager),
  findSessionByConversation: (userId: string, conversationId: string) => {
    return sessionManager.getSession(userId, conversationId);
  },
  getUserSessions: sessionManager.getUserSessions.bind(sessionManager),
  updateActivity: sessionManager.updateActivity.bind(sessionManager),
  updateState: sessionManager.updateState.bind(sessionManager),
  setSandbox: sessionManager.setSandbox.bind(sessionManager),
  setNullclawAvailable: sessionManager.setNullclawAvailable.bind(sessionManager),
  setNullclawEndpoint: sessionManager.setNullclawEndpoint.bind(sessionManager),
  setMcpServerUrl: sessionManager.setMcpServerUrl.bind(sessionManager),
  recordMetrics: sessionManager.recordMetrics.bind(sessionManager),
  checkQuota: sessionManager.checkQuota.bind(sessionManager),
  createCheckpoint: sessionManager.createCheckpoint.bind(sessionManager),
  stopSession: async (sessionId: string) => {
    const session = sessionManager.getSessionById(sessionId);
    if (session) {
      await sessionManager.destroySession(session.userId, session.conversationId);
    }
  },
  getStats: () => sessionManager.getStats(),
  // Expose sessionMetrics map so tests can inspect per-session metrics directly
  get sessionMetrics() {
    return sessionManager.sessionMetrics;
  },
};

// Type exports for backward compatibility
export type { Session as AgentSession, SessionConfig as AgentSessionConfig };
export type { Session as OpenCodeV2Session, SessionConfig as V2SessionConfig, SessionQuota as V2SessionQuota };
