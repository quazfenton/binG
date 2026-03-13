/**
 * OpenCode V2 Session Manager
 * 
 * Per-user session isolation with:
 * - User-specific filesystem workspaces
 * - Quota tracking per user
 * - Session persistence and checkpointing
 * - Nullclaw integration per session
 * 
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │              OpenCodeV2SessionManager                  │
 * │  ┌─────────────────────────────────────────────────┐   │
 * │  │  User Session Pool                              │   │
 * │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │   │
 * │  │  │ User A   │ │ User B   │ │ User C   │  ...   │   │
 * │  │  │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │        │   │
 * │  │  │ │Conv 1│ │ │ │Conv 1│ │ │ │Conv 1│ │        │   │
 * │  │  │ │Conv 2│ │ │ │Conv 2│ │ │ │Conv 2│ │        │   │
 * │  │  │ └──────┘ │ │ └──────┘ │ │ └──────┘ │        │   │
 * │  │  │          │ │          │ │          │        │   │
 * │  │  │ nullclaw │ │ nullclaw │ │ nullclaw │        │   │
 * │  │  │ endpoint │ │ endpoint │ │ endpoint │        │   │
 * │  │  └──────────┘ └──────────┘ └──────────┘        │   │
 * │  └─────────────────────────────────────────────────┘   │
 * │  ┌─────────────────────────────────────────────────┐   │
 * │  │  Quota Manager                                   │   │
 * │  │  - Compute minutes per user                     │   │
 * │  │  - Storage bytes per user                        │   │
 * │  │  - API calls per user                            │   │
 * │  └─────────────────────────────────────────────────┘   │
 * └─────────────────────────────────────────────────────────┘
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const logger = createLogger('OpenCode:V2SessionManager');

export interface V2SessionQuota {
  computeMinutes: number;
  computeUsed: number;
  storageBytes: number;
  storageUsed: number;
  apiCalls: number;
  apiCallsUsed: number;
}

export interface V2SessionConfig {
  userId: string;
  conversationId: string;
  model?: string;
  maxSteps?: number;
  timeout?: number;
  enableNullclaw?: boolean;
  enableMcp?: boolean;
  cloudFsProvider?: 'sprites' | 'e2b' | 'daytona' | 'local';
  workspaceDir?: string;
  quota?: Partial<V2SessionQuota>;
}

export interface OpenCodeV2Session {
  id: string;
  userId: string;
  conversationId: string;
  createdAt: number;
  lastActivity: number;
  status: 'starting' | 'active' | 'idle' | 'stopping' | 'stopped';
  
  // Sandbox info
  sandboxId?: string;
  sandboxProvider?: string;
  workspaceDir: string;
  
  // Nullclaw integration
  nullclawEnabled: boolean;
  nullclawEndpoint?: string;
  
  // MCP integration
  mcpEnabled: boolean;
  mcpServerUrl?: string;
  
  // Quota tracking
  quota: V2SessionQuota;
  
  // Metrics
  totalSteps: number;
  totalBashCommands: number;
  totalFileChanges: number;
  totalCost?: number;
  
  // Checkpointing
  lastCheckpoint?: number;
  checkpointCount: number;
}

interface SessionMetrics {
  steps: number;
  bashCommands: number;
  fileChanges: number;
  computeTimeMs: number;
  apiCalls: number;
  storageBytes: number;
}

const DEFAULT_QUOTA: V2SessionQuota = {
  computeMinutes: 60,
  computeUsed: 0,
  storageBytes: 500 * 1024 * 1024, // 500MB
  storageUsed: 0,
  apiCalls: 1000,
  apiCallsUsed: 0,
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes idle

class OpenCodeV2SessionManager {
  private sessions = new Map<string, OpenCodeV2Session>();
  private userSessions = new Map<string, Set<string>>(); // userId -> sessionIds
  private sessionMetrics = new Map<string, SessionMetrics>();
  private globalQuota: V2SessionQuota = { ...DEFAULT_QUOTA };
  
  // Configuration
  private readonly maxSessionsPerUser: number;
  private readonly defaultTimeout: number;
  private readonly enableQuotaEnforcement: boolean;

  constructor() {
    this.maxSessionsPerUser = parseInt(process.env.OPENCODE_MAX_SESSIONS_PER_USER || '10', 10);
    this.defaultTimeout = parseInt(process.env.OPENCODE_DEFAULT_TIMEOUT || '300000', 10);
    this.enableQuotaEnforcement = process.env.OPENCODE_ENFORCE_QUOTA === 'true';
    
    // Start cleanup interval
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Create a new V2 session for a user/conversation
   */
  async createSession(config: V2SessionConfig): Promise<OpenCodeV2Session> {
    const { userId, conversationId } = config;
    
    // Check existing sessions for this conversation
    const existingSession = this.findSessionByConversation(userId, conversationId);
    if (existingSession) {
      logger.debug(`Found existing session for conversation ${conversationId}, returning it`);
      this.updateActivity(existingSession.id);
      return existingSession;
    }

    // Check per-user session limit
    const userSessionIds = this.userSessions.get(userId);
    if (userSessionIds && userSessionIds.size >= this.maxSessionsPerUser) {
      // Clean up oldest idle sessions
      await this.cleanupUserIdleSessions(userId);
      
      if ((this.userSessions.get(userId)?.size || 0) >= this.maxSessionsPerUser) {
        throw new Error(`Maximum sessions (${this.maxSessionsPerUser}) reached for user ${userId}`);
      }
    }

    // Check global quota
    if (this.enableQuotaEnforcement && this.globalQuota.computeUsed >= this.globalQuota.computeMinutes) {
      throw new Error('Global compute quota exhausted');
    }

    const sessionId = `v2-${uuidv4()}`;
    const workspaceDir = config.workspaceDir || `/workspace/users/${userId}/sessions/${conversationId}`;
    
    const session: OpenCodeV2Session = {
      id: sessionId,
      userId,
      conversationId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'starting',
      workspaceDir,
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
    };

    // Track session
    this.sessions.set(sessionId, session);
    
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

    logger.info(`Created V2 session ${sessionId} for user ${userId}, conversation ${conversationId}`);
    
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): OpenCodeV2Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    // Check TTL
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      this.stopSession(sessionId);
      return undefined;
    }
    
    return session;
  }

  /**
   * Get session by user and conversation
   */
  findSessionByConversation(userId: string, conversationId: string): OpenCodeV2Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.conversationId === conversationId) {
        if (Date.now() - session.lastActivity <= SESSION_TTL_MS) {
          return session;
        }
      }
    }
    return undefined;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): OpenCodeV2Session[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) return [];
    
    const sessions: OpenCodeV2Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session && Date.now() - session.lastActivity <= SESSION_TTL_MS) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Update session sandbox info
   */
  setSandbox(sessionId: string, sandboxId: string, provider: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sandboxId = sandboxId;
      session.sandboxProvider = provider;
      session.status = 'active';
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session Nullclaw availability
   */
  setNullclawAvailable(sessionId: string, available: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.nullclawEnabled = available;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update session MCP server URL
   */
  setMcpServerUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.mcpServerUrl = url;
      this.updateActivity(sessionId);
    }
  }

  /**
   * Update activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
      }
    }
  }

  /**
   * Update session state
   */
  updateState(sessionId: string, state: OpenCodeV2Session['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = state;
      if (state === 'active') {
        session.lastActivity = Date.now();
      }
    }
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: string): OpenCodeV2Session | undefined {
    return this.sessions.get(sessionId);
  }

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
    const session = this.sessions.get(sessionId);
    
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
      const computeDeltaMinutes = computeTimeMs / 60000; // Convert to minutes
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

    const session = this.sessions.get(sessionId);
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

  /**
   * Create checkpoint for session
   */
  async createCheckpoint(sessionId: string, label?: string): Promise<{
    checkpointId: string;
    timestamp: number;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const checkpointId = `cp-${uuidv4()}`;
    const timestamp = Date.now();
    
    session.lastCheckpoint = timestamp;
    session.checkpointCount++;
    
    logger.info(`Created checkpoint ${checkpointId} for session ${sessionId}`);
    
    return { checkpointId, timestamp };
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'stopping';
    
    // TODO: Stop sandbox if exists
    // TODO: Stop Nullclaw if running
    
    session.status = 'stopped';
    session.lastActivity = Date.now();

    this.sessions.delete(sessionId);
    this.sessionMetrics.delete(sessionId);
    const userSessionIds = this.userSessions.get(session.userId);
    if (userSessionIds) {
      userSessionIds.delete(sessionId);
      if (userSessionIds.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    logger.info(`Stopped session ${sessionId}`);
  }

  /**
   * Cleanup idle sessions
   */
  private async cleanupUserIdleSessions(userId: string): Promise<void> {
    const sessions = this.getUserSessions(userId);
    const idleSessions = sessions
      .filter(s => Date.now() - s.lastActivity > IDLE_THRESHOLD_MS)
      .sort((a, b) => a.lastActivity - b.lastActivity);

    for (const session of idleSessions.slice(0, 2)) {
      await this.stopSession(session.id);
    }
  }

  /**
   * Periodic cleanup of expired sessions
   */
  cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.stopSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.debug(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  /**
   * Get manager statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    idleSessions: number;
    totalUsers: number;
    globalQuota: V2SessionQuota;
  } {
    let active = 0;
    let idle = 0;

    for (const session of this.sessions.values()) {
      if (session.status === 'active') active++;
      if (session.status === 'idle') idle++;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      idleSessions: idle,
      totalUsers: this.userSessions.size,
      globalQuota: this.globalQuota,
    };
  }
}

export const openCodeV2SessionManager = new OpenCodeV2SessionManager();

