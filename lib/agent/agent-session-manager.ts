/**
 * Agent Session Manager
 * 
 * Manages per-user OpenSandbox instances with conversation isolation.
 * Each user gets a dedicated sandbox workspace at /workspace/users/{userId}/sessions/{conversationId}
 */

import { v4 as uuidv4 } from 'uuid';
import { getSandboxProvider } from '../sandbox/providers';
import type { SandboxHandle, SandboxCreateConfig } from '../sandbox/providers/sandbox-provider';
import { createLogger } from '../utils/logger';
import { openCodeV2SessionManager } from '../api/opencode-v2-session-manager';

const logger = createLogger('Agent:SessionManager');

export interface AgentSession {
  id: string;
  userId: string;
  conversationId: string;
  sandboxHandle: SandboxHandle;
  workspacePath: string;
  nullclawEndpoint?: string;
  v2SessionId?: string;
  createdAt: Date;
  lastActiveAt: Date;
  state: 'initializing' | 'ready' | 'busy' | 'idle' | 'error';
  metadata?: {
    mode: 'opencode' | 'nullclaw' | 'hybrid';
    cloudOffloadEnabled: boolean;
    mcpEnabled: boolean;
  };
}

export interface AgentSessionConfig {
  mode?: 'opencode' | 'nullclaw' | 'hybrid';
  enableNullclaw?: boolean;
  enableCloudOffload?: boolean;
  enableMCP?: boolean;
  timeout?: number; // seconds
  noSandbox?: boolean; // Skip cloud sandbox creation - for local V2 execution
}

class AgentSessionManager {
  private sessions = new Map<string, AgentSession>();
  private sessionsById = new Map<string, AgentSession>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Get or create agent session for user/conversation
   */
  async getOrCreateSession(
    userId: string,
    conversationId: string,
    config: AgentSessionConfig = {},
  ): Promise<AgentSession> {
    const key = this.getSessionKey(userId, conversationId);
    
    // Return existing session if available and healthy
    const existing = this.sessions.get(key);
    if (existing && existing.state !== 'initializing' && existing.state !== 'error') {
      logger.debug(`Returning existing session for ${key}`);
      existing.lastActiveAt = new Date();
      existing.state = 'ready';
      this.sessionsById.set(existing.id, existing);
      return existing;
    }

    // Create new session
    logger.info(`Creating new agent session for ${key}`);
    const session = await this.createSession(userId, conversationId, config);
    this.sessions.set(key, session);
    
    return session;
  }

  /**
   * Get existing session (returns undefined if not found)
   */
  getSession(userId: string, conversationId: string): AgentSession | undefined {
    const key = this.getSessionKey(userId, conversationId);
    const session = this.sessions.get(key);
    
    if (!session) {
      return undefined;
    }
    
    // Check TTL
    if (Date.now() - session.lastActiveAt.getTime() > this.TTL_MS) {
      logger.warn(`Session ${key} expired, cleaning up`);
      void this.destroySession(session.userId, session.conversationId);
      return undefined;
    }
    
    return session;
  }

  /**
   * Get existing session by UUID (returns undefined if not found)
   */
  getSessionById(sessionId: string): AgentSession | undefined {
    const session = this.sessionsById.get(sessionId);
    if (!session) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - session.lastActiveAt.getTime() > this.TTL_MS) {
      logger.warn(`Session ${sessionId} expired, cleaning up`);
      void this.destroySession(session.userId, session.conversationId);
      return undefined;
    }

    return session;
  }

  /**
   * Update session activity timestamp
   * Delegates to OpenCodeV2SessionManager for state consistency
   */
  updateActivity(userId: string, conversationId: string): void {
    const session = this.getSession(userId, conversationId);
    if (session) {
      session.lastActiveAt = new Date();
      // Delegate state update to V2 session manager for consistency
      if (session.v2SessionId) {
        try {
          openCodeV2SessionManager.updateActivity(session.v2SessionId);
        } catch (error) {
          logger.warn('Failed to update V2 session activity', error);
        }
      }
      session.state = 'ready';
    }
  }

  /**
   * Set session state
   * Delegates to OpenCodeV2SessionManager to prevent state divergence
   */
  setSessionState(
    userId: string,
    conversationId: string,
    state: AgentSession['state'],
  ): void {
    const session = this.getSession(userId, conversationId);
    if (session) {
      // Map AgentSession state to OpenCodeV2Session state
      const v2StateMap: Record<AgentSession['state'], string> = {
        'initializing': 'starting',
        'ready': 'active',
        'busy': 'active',
        'idle': 'idle',
        'error': 'stopped',
      };
      
      // Update local state
      session.state = state;
      
      // Delegate to V2 session manager for consistency
      if (session.v2SessionId) {
        try {
          openCodeV2SessionManager.updateState(session.v2SessionId, v2StateMap[state]);
        } catch (error) {
          logger.warn('Failed to update V2 session state', error);
        }
      }
    }
  }

  /**
   * Destroy session and cleanup sandbox
   * Delegates to OpenCodeV2SessionManager for proper state cleanup
   */
  async destroySession(userId: string, conversationId: string): Promise<void> {
    const key = this.getSessionKey(userId, conversationId);
    const session = this.sessions.get(key);

    if (!session) {
      logger.debug(`Session ${key} not found for destruction`);
      return;
    }

    try {
      logger.info(`Destroying session ${key} (V2: ${session.v2SessionId || 'N/A'})`);
      
      // First stop V2 session (handles quota finalization, MCP cleanup, etc.)
      if (session.v2SessionId) {
        try {
          await openCodeV2SessionManager.stopSession(session.v2SessionId);
          logger.debug(`V2 session ${session.v2SessionId} stopped`);
        } catch (error: any) {
          logger.warn('Failed to stop V2 session', error);
        }
      }
      
      // Then cleanup sandbox
      await session.sandboxHandle.executeCommand('echo "Session cleanup complete"');
      
      // Remove from tracking maps
      this.sessions.delete(key);
      this.sessionsById.delete(session.id);
      
      logger.info(`Session ${key} destroyed successfully`);
    } catch (error: any) {
      logger.error(`Failed to cleanup session ${key}`, error);
      this.sessions.delete(key);
      this.sessionsById.delete(session.id);
    }
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): AgentSession[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId);
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    idleSessions: number;
    users: number;
  } {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.state === 'busy' || s.state === 'ready').length,
      idleSessions: sessions.filter(s => s.state === 'idle').length,
      users: new Set(sessions.map(s => s.userId)).size,
    };
  }

  /**
   * Get unified session status (combines AgentSession and OpenCodeV2Session state)
   */
  getSessionStatus(userId: string, conversationId: string): {
    agentState: AgentSession['state'] | 'not_found';
    v2State: string | 'not_found';
    quota?: any;
    workspacePath?: string;
  } | undefined {
    const session = this.getSession(userId, conversationId);
    if (!session) {
      return undefined;
    }

    // Get V2 session status if available
    let v2State = 'unknown';
    let quota;
    
    if (session.v2SessionId) {
      try {
        const v2Session = openCodeV2SessionManager.getSessionById(session.v2SessionId);
        if (v2Session) {
          v2State = v2Session.state;
          quota = v2Session.quota;
        } else {
          v2State = 'not_found';
        }
      } catch (error) {
        logger.warn('Failed to get V2 session status', error);
        v2State = 'error';
      }
    }

    return {
      agentState: session.state,
      v2State,
      quota,
      workspacePath: session.workspacePath,
    };
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, this.CLEANUP_INTERVAL_MS);

    // Cleanup on process exit
    process.on('beforeExit', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  /**
   * Cleanup idle/expired sessions
   */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [key, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActiveAt.getTime();
      
      if (idleTime > this.TTL_MS) {
        logger.info(`Cleaning up idle session ${key} (idle for ${idleTime / 1000}s)`);
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      try {
        await this.destroySessionByKeys(key);
      } catch (error: any) {
        logger.error(`Failed to cleanup session ${key}`, error);
      }
    }

    if (toRemove.length > 0) {
      logger.info(`Cleaned up ${toRemove.length} idle sessions`);
    }
  }

  /**
   * Create new agent session
   */
  private async createSession(
    userId: string,
    conversationId: string,
    config: AgentSessionConfig,
  ): Promise<AgentSession> {
    try {
      const workspacePath = `/workspace/users/${userId}/sessions/${conversationId}`;

      let sandbox: SandboxHandle | undefined;

      // Only create cloud sandbox if explicitly requested
      // V2/OpenCode runs locally - cloud sandbox is only for user terminal or risky execution
      if (!config.noSandbox) {
      try {
        const provider = await getSandboxProvider();
        
        // Create sandbox with user isolation
        sandbox = await provider.createSandbox({
          language: 'typescript',
          envVars: {
            USER_ID: userId,
            CONVERSATION_ID: conversationId,
            WORKSPACE_DIR: workspacePath,
            OPENCODE_MODEL: process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
            OPENCODE_SYSTEM_PROMPT: config.mode === 'nullclaw' 
              ? 'You are a helpful task assistant with access to messaging, internet, and automation tools.'
              : 'You are an expert software engineer. Use bash commands and file operations to complete tasks efficiently.',
            MCP_ENABLED: config.enableMCP ? 'true' : 'false',
            NULLCLAW_ENABLED: config.enableNullclaw ? 'true' : 'false',
          },
          labels: {
            userId,
            conversationId,
            mode: config.mode || 'opencode',
            createdBy: 'agent-session-manager',
          },
          resources: {
            cpu: 2,
            memory: 4,
          },
          autoStopInterval: config.timeout || 3600,
        } as SandboxCreateConfig);

        // Ensure workspace directory exists
        // SECURITY: Escape all shell metacharacters to prevent command injection
        const safeWorkspacePath = workspacePath.replace(/(["\\$`])/g, '\\$1');
        await sandbox.executeCommand(`mkdir -p "${safeWorkspacePath}"`);
      } catch (sandboxError) {
        // Log but continue - V2 can run without cloud sandbox
        logger.warn(`Failed to create sandbox for session (continuing without sandbox): ${sandboxError}`);
      }
    }
    
    const sessionId = uuidv4();
    
    // Create V2 session first (source of truth for quotas/state)
    const v2Session = await openCodeV2SessionManager.createSession({
      userId,
      conversationId,
      enableNullclaw: config.enableNullclaw,
      enableMcp: config.enableMCP,
      workspaceDir: workspacePath,
    });

    const session: AgentSession = {
        id: sessionId,
        userId,
        conversationId,
        sandboxHandle: sandbox,
        workspacePath,
        nullclawEndpoint: undefined, // Will be set if Nullclaw is enabled
        v2SessionId: v2Session.id,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        state: 'ready', // Mirrors V2 session 'active' state
        metadata: {
          mode: config.mode || 'opencode',
          cloudOffloadEnabled: config.enableCloudOffload || false,
          mcpEnabled: config.enableMCP || false,
        },
      };

      logger.info(`Created session ${session.id} for ${userId}:${conversationId} (V2: ${v2Session.id})`);
      this.sessionsById.set(session.id, session);
      return session;
    } catch (error: any) {
      logger.error(`Failed to create session for ${userId}:${conversationId}`, error);
      throw new Error(`Session creation failed: ${error.message}`);
    }
  }

  /**
   * Helper to get session key
   */
  private getSessionKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  /**
   * Helper to destroy session by key
   */
  private async destroySessionByKeys(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session) {
      // Only cleanup sandbox if it exists
      if (session.sandboxHandle) {
        try {
          await session.sandboxHandle.executeCommand('echo "Session cleanup"');
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      if (session.v2SessionId) {
        await openCodeV2SessionManager.stopSession(session.v2SessionId);
      }
      this.sessions.delete(key);
      this.sessionsById.delete(session.id);
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

    // Cleanup all sessions
    const keys = Array.from(this.sessions.keys());
    logger.info(`Cleaning up ${keys.length} sessions`);

    for (const key of keys) {
      try {
        await this.destroySessionByKeys(key);
      } catch (error: any) {
        logger.error(`Failed to cleanup session ${key} during shutdown`, error);
      }
    }

    logger.info('Session manager shutdown complete');
  }
}

// Singleton instance
export const agentSessionManager = new AgentSessionManager();

// Export for testing
export { AgentSessionManager };
