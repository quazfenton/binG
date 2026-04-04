/**
 * @deprecated Use lib/session/session-manager.ts instead
 * 
 * This file is kept for backward compatibility only.
 * All new code should use sessionManager from lib/session/session-manager.
 * 
 * Migration guide:
 * - import { agentSessionManager } from '../../packages/shared/agent/agent-session-manager'
 * + import { sessionManager } from '@/lib/session/session-manager'
 * 
 * @see lib/session/session-manager.ts - Consolidated session manager
 */

import { v4 as uuidv4 } from 'uuid';
import { getSandboxProvider, getSandboxProviderWithFallback } from '../../sandbox/providers';
import type { SandboxHandle, SandboxCreateConfig } from '../../sandbox/providers/sandbox-provider';
import { createLogger } from '../../utils/logger';
import { sessionManager } from '../session-manager';
import type { ExecutionPolicy } from '../../sandbox/types';
import {
  getExecutionPolicyConfig,
  requiresCloudSandbox,
  allowsLocalFallback,
  getPreferredProviders,
} from '../../sandbox/types';

const logger = createLogger('Agent:SessionManager');

// Log deprecation warning on first import
if (typeof window === 'undefined') {
  console.warn('[DEPRECATED] agent-session-manager.ts is deprecated. Use lib/session/session-manager.ts instead.');
}

// Re-export types for backward compatibility
export type { AgentSession, AgentSessionConfig } from '../session-manager';

// ============================================================================
// DEPRECATED - Use sessionManager from lib/session/session-manager.ts
// ============================================================================
// This class is kept for backward compatibility only.
// All methods now delegate to the consolidated sessionManager.
// ============================================================================

class AgentSessionManager {
  /**
   * @deprecated Use sessionManager.getOrCreateSession()
   */
  async getOrCreateSession(
    userId: string,
    conversationId: string,
    config: any = {},
  ): Promise<any> {
    return sessionManager.getOrCreateSession(userId, conversationId, config);
  }

  /**
   * @deprecated Use sessionManager.getSession()
   */
  getSession(userId: string, conversationId: string): any {
    return sessionManager.getSession(userId, conversationId);
  }

  /**
   * @deprecated Use sessionManager.getSessionById()
   */
  getSessionById(sessionId: string): any {
    return sessionManager.getSessionById(sessionId);
  }

  /**
   * @deprecated Use sessionManager.updateActivity()
   */
  updateActivity(userId: string, conversationId: string): void {
    const session = sessionManager.getSession(userId, conversationId);
    if (session) {
      sessionManager.updateActivity(session.id);
    }
  }

  /**
   * @deprecated Use sessionManager.updateState()
   */
  setSessionState(
    userId: string,
    conversationId: string,
    state: any,
  ): void {
    const session = sessionManager.getSession(userId, conversationId);
    if (session) {
      sessionManager.updateState(session.id, state);
    }
  }

  /**
   * @deprecated Use sessionManager.destroySession()
   */
  async destroySession(userId: string, conversationId: string): Promise<void> {
    await sessionManager.destroySession(userId, conversationId);
  }

  /**
   * @deprecated Use sessionManager.getUserSessions()
   */
  getUserSessions(userId: string): any[] {
    return sessionManager.getUserSessions(userId);
  }

  /**
   * @deprecated Use sessionManager.getStats()
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    idleSessions: number;
    users: number;
  } {
    const stats = sessionManager.getStats();
    return {
      totalSessions: stats.totalSessions,
      activeSessions: stats.activeSessions,
      idleSessions: stats.idleSessions,
      users: stats.totalUsers,
    };
  }

  /**
   * @deprecated Use sessionManager.getSessionStatus()
   */
  getSessionStatus(userId: string, conversationId: string): any {
    const session = sessionManager.getSession(userId, conversationId);
    if (!session) {
      return undefined;
    }
    return {
      agentState: session.state,
      v2State: session.status,
      quota: session.quota,
      workspacePath: session.workspacePath,
    };
  }

  /**
   * @deprecated Use sessionManager.shutdown()
   */
  async shutdown(): Promise<void> {
    await sessionManager.shutdown();
  }
}

// Singleton instance (deprecated)
export const agentSessionManager = new AgentSessionManager();

// Export for testing (deprecated)
export { AgentSessionManager };
