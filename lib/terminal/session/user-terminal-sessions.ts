/**
 * @deprecated Use lib/terminal/session/terminal-session-manager.ts instead
 * 
 * This file is kept for backward compatibility only.
 * All new code should use terminalSessionManager from terminal-session-manager.
 * 
 * Migration guide:
 * - import { userTerminalSessionManager } from '@/lib/terminal/session/user-terminal-sessions'
 * + import { terminalSessionManager } from '@/lib/terminal/session/terminal-session-manager'
 * 
 * @see lib/terminal/session/terminal-session-manager.ts - Consolidated terminal session manager
 */

import { terminalSessionManager, type TerminalSessionState } from './terminal-session-manager'
import type { SandboxProviderType } from '../../sandbox/providers'

// Log deprecation warning on first import
console.warn('[DEPRECATED] user-terminal-sessions.ts is deprecated. Use terminal-session-manager.ts instead.')

// Re-export types for backward compatibility
export type { TerminalSessionState as UserTerminalSession }
export type { CreateSessionOptions, DisconnectSessionOptions, RestoreResult }

// ============================================================================
// DEPRECATED - Use terminalSessionManager from terminal-session-manager.ts
// ============================================================================
// This class is kept for backward compatibility only.
// All methods now delegate to the consolidated terminalSessionManager.
// ============================================================================

export class UserTerminalSessionManager {
  /**
   * @deprecated Use terminalSessionManager.getSessionsByUserId()
   */
  getUserSessions(userId: string): any[] {
    return terminalSessionManager.getSessionsByUserId(userId).map(s => ({
      ...s,
      userId,
      providerType: this.inferProviderType(s.sandboxId),
    }))
  }

  /**
   * @deprecated Use terminalSessionManager.getActiveSession()
   */
  getActiveSession(sessionId: string): any {
    return terminalSessionManager.getActiveSession(sessionId)
  }

  /**
   * @deprecated Use terminalSessionManager.createSession()
   */
  async createSession(options: any): Promise<any> {
    return terminalSessionManager.createSession(options)
  }

  /**
   * @deprecated Use terminalSessionManager.disconnectSession()
   */
  async disconnectSession(sessionId: string, options: any = {}): Promise<any> {
    return terminalSessionManager.disconnectSession(sessionId, options)
  }

  /**
   * @deprecated Use terminalSessionManager.createSessionSnapshot()
   */
  async createSessionSnapshot(sessionId: string, name?: string, reason?: any): Promise<string> {
    return terminalSessionManager.createSessionSnapshot(sessionId, name, reason)
  }

  /**
   * @deprecated Use terminalSessionManager.restoreFromSnapshot()
   */
  async restoreFromSnapshot(userId: string, snapshotId?: string): Promise<any> {
    return terminalSessionManager.restoreFromSnapshot(userId, snapshotId)
  }

  /**
   * @deprecated Use terminalSessionManager.getUserSessionStats()
   */
  getUserSessionStats(userId: string): any {
    return terminalSessionManager.getUserSessionStats(userId)
  }

  /**
   * @deprecated Use terminalSessionManager.cleanupOldSessions()
   */
  cleanupOldSessions(maxAgeMs?: number): number {
    return terminalSessionManager.cleanupOldSessions(maxAgeMs)
  }

  /**
   * Infer provider type from sandbox ID (kept for backward compatibility)
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId)
    if (isE2BFormat) return 'e2b'

    if (sandboxId.startsWith('mistral-')) return 'mistral'
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp'
    if (sandboxId.startsWith('blaxel-')) return 'blaxel'
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites'
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer'
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem'
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn'
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter'
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent'
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox'
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox'
    if (sandboxId.startsWith('e2b-')) return 'e2b'
    return 'daytona'
  }
}

/**
 * @deprecated Use terminalSessionManager instead
 */
export const userTerminalSessionManager = new UserTerminalSessionManager()

/**
 * User-scoped terminal session with snapshot metadata
 */
export interface UserTerminalSession extends TerminalSessionState {
  /** User ID for namespace isolation */
  userId: string;
  
  /** Auto-generated snapshot ID on last disconnect */
  lastSnapshotId?: string;
  
  /** Snapshot creation timestamp */
  lastSnapshotAt?: number;
  
  /** Provider type used for this session */
  providerType: SandboxProviderType;
  
  /** Session metadata */
  metadata?: {
    /** Was this session restored from snapshot? */
    restoredFromSnapshot?: boolean;
    /** Snapshot ID restored from */
    restoredSnapshotId?: string;
    /** Auto-snapshot enabled for this session */
    autoSnapshotEnabled?: boolean;
    /** Reason for last snapshot */
    lastSnapshotReason?: 'user_request' | 'auto_disconnect' | 'idle_timeout' | 'manual' | 'error';
  };
}

/**
 * Session creation options
 */
export interface CreateSessionOptions {
  /** User ID (required for isolation) */
  userId: string;
  
  /** Preferred sandbox provider */
  providerType?: SandboxProviderType;
  
  /** Enable auto-snapshot on disconnect */
  autoSnapshot?: boolean;
  
  /** Restore from existing snapshot if available */
  restoreFromSnapshot?: boolean;
  
  /** Snapshot ID to restore from (optional) */
  snapshotId?: string;
  
  /** Terminal dimensions */
  cols?: number;
  rows?: number;
  
  /** Working directory */
  cwd?: string;
}

/**
 * Session disconnection options
 */
export interface DisconnectSessionOptions {
  /** Create snapshot before disconnecting */
  createSnapshot?: boolean;
  
  /** Reason for disconnect (for metadata) */
  reason?: 'user_request' | 'idle_timeout' | 'error' | 'manual';
  
  /** Snapshot name/label (optional) */
  snapshotName?: string;
}

/**
 * Session restoration result
 */
export interface RestoreResult {
  success: boolean;
  session?: UserTerminalSession;
  sandboxId: string;
  snapshotRestored?: boolean;
  filesSynced?: number;
  error?: string;
}

/**
 * Per-User Terminal Session Manager
 * 
 * Usage:
 * ```typescript
 * const manager = new UserTerminalSessionManager();
 * 
 * // Create new session for user
 * const session = await manager.createSession({
 *   userId: 'user_123',
 *   providerType: 'sprites',
 *   autoSnapshot: true,
 * });
 * 
 * // Disconnect with auto-snapshot
 * await manager.disconnectSession(session.sessionId, {
 *   createSnapshot: true,
 *   reason: 'user_request',
 * });
 * 
 * // Restore from snapshot
 * const restored = await manager.restoreFromSnapshot('user_123');
 * ```
 */
