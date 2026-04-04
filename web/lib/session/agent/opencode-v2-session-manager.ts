/**
 * @deprecated Use lib/session/session-manager.ts instead
 * 
 * This file is kept for backward compatibility only.
 * All new code should use sessionManager from lib/session/session-manager.
 * 
 * Migration guide:
 * - import { openCodeV2SessionManager } from '@/lib/api/opencode-v2-session-manager'
 * + import { sessionManager } from '@/lib/session/session-manager'
 * 
 * @see lib/session/session-manager.ts - Consolidated session manager
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../utils/logger';
import { sessionManager } from '../session-manager';

const logger = createLogger('OpenCode:V2SessionManager');

// Log deprecation warning on first import
if (typeof window === 'undefined') {
  console.warn('[DEPRECATED] opencode-v2-session-manager.ts is deprecated. Use lib/session/session-manager.ts instead.');
}

// Re-export types for backward compatibility
export type { Session as OpenCodeV2Session, SessionConfig as V2SessionConfig, SessionQuota as V2SessionQuota } from '../session-manager';

// ============================================================================
// DEPRECATED - Use sessionManager from lib/session/session-manager.ts
// ============================================================================
// This object is kept for backward compatibility only.
// All methods now delegate to the consolidated sessionManager.
// ============================================================================

export const openCodeV2SessionManager = {
  /**
   * @deprecated Use sessionManager.getOrCreateSession()
   */
  createSession: async (config: any) => {
    return sessionManager.getOrCreateSession(config.userId, config.conversationId, config);
  },

  /**
   * @deprecated Use sessionManager.getSessionById()
   */
  getSession: (sessionId: string) => sessionManager.getSessionById(sessionId),

  /**
   * @deprecated Use sessionManager.getSessionById()
   */
  getSessionById: sessionManager.getSessionById.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.getSession()
   */
  findSessionByConversation: (userId: string, conversationId: string) => {
    return sessionManager.getSession(userId, conversationId);
  },

  /**
   * @deprecated Use sessionManager.getUserSessions()
   */
  getUserSessions: sessionManager.getUserSessions.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.updateActivity()
   */
  updateActivity: sessionManager.updateActivity.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.updateState()
   */
  updateState: sessionManager.updateState.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.setSandbox()
   */
  setSandbox: sessionManager.setSandbox.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.setNullclawAvailable()
   */
  setNullclawAvailable: sessionManager.setNullclawAvailable.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.setMcpServerUrl()
   */
  setMcpServerUrl: sessionManager.setMcpServerUrl.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.recordMetrics()
   */
  recordMetrics: sessionManager.recordMetrics.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.checkQuota()
   */
  checkQuota: sessionManager.checkQuota.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.createCheckpoint()
   */
  createCheckpoint: sessionManager.createCheckpoint.bind(sessionManager),

  /**
   * @deprecated Use sessionManager.destroySession()
   */
  stopSession: async (sessionId: string) => {
    const session = sessionManager.getSessionById(sessionId);
    if (session) {
      await sessionManager.destroySession(session.userId, session.conversationId);
    }
  },

  /**
   * @deprecated Use sessionManager.getStats()
   */
  getStats: () => sessionManager.getStats(),
};

// Type exports are re-exported from session-manager.ts for backward compatibility
// No need to duplicate type definitions here

