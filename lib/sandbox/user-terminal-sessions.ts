/**
 * Per-User Terminal Session Isolation
 * 
 * Provides user-scoped terminal session management with:
 * - User-namespaced sessions (prevents cross-user access)
 * - Auto-snapshot on disconnect (for supporting providers)
 * - Session restoration from snapshots
 * - VFS sync-back on restore
 * 
 * This module is ADDITIVE - it doesn't break existing terminal-manager.ts
 * Use this for new features while legacy code continues to work.
 * 
 * @see lib/sandbox/terminal-manager.ts - Legacy global session store
 * @see lib/sandbox/terminal-session-store.ts - SQLite persistence layer
 */

import { getSessionsByUserId, saveTerminalSession, getTerminalSession, updateTerminalSession, deleteTerminalSession, type TerminalSessionState } from './terminal-session-store';
import { getSandboxProvider, type SandboxProviderType } from './providers';
import { quotaManager } from '../services/quota-manager';
import type { SandboxHandle } from './providers/sandbox-provider';

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
export class UserTerminalSessionManager {
  /** In-memory cache of active sessions */
  private activeSessions = new Map<string, UserTerminalSession>();
  
  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): UserTerminalSession[] {
    const sessions = getSessionsByUserId(userId);
    return sessions.map(s => ({
      ...s,
      userId,
      providerType: this.inferProviderType(s.sandboxId),
    })) as UserTerminalSession[];
  }
  
  /**
   * Get active session by ID
   */
  getActiveSession(sessionId: string): UserTerminalSession | undefined {
    return this.activeSessions.get(sessionId);
  }
  
  /**
   * Create a new terminal session for user
   * 
   * If restoreFromSnapshot is true and user has previous snapshots,
   * will restore from the most recent snapshot instead of creating fresh sandbox.
   */
  async createSession(options: CreateSessionOptions): Promise<UserTerminalSession> {
    const {
      userId,
      providerType = 'daytona',
      autoSnapshot = false,
      restoreFromSnapshot = false,
      snapshotId,
      cols = 120,
      rows = 30,
      cwd = '/workspace',
    } = options;
    
    // Check quota before creating
    const quotaCheck = quotaManager.checkQuota(providerType);
    if (!quotaCheck.allowed) {
      // Try fallback providers
      const fallbackChain = quotaManager.getSandboxProviderChain(providerType);
      let fallbackProvider: SandboxProviderType | null = null;
      
      for (const provider of fallbackChain) {
        if (provider !== providerType && quotaManager.isAvailable(provider)) {
          fallbackProvider = provider as SandboxProviderType;
          break;
        }
      }
      
      if (!fallbackProvider) {
        throw new Error(
          `No sandbox providers available. ${providerType} quota exceeded ` +
          `(${quotaCheck.remaining} remaining). Quota resets on ${new Date().toISOString()}`
        );
      }
      
      console.log(`[UserTerminalSession] ${providerType} over quota, falling back to ${fallbackProvider}`);
    }
    
    // Try to restore from snapshot if requested
    if (restoreFromSnapshot) {
      const restoreResult = await this.restoreFromSnapshot(userId, snapshotId);
      if (restoreResult.success && restoreResult.session) {
        console.log(`[UserTerminalSession] Restored session ${restoreResult.session.sessionId} from snapshot for user ${userId}`);
        return restoreResult.session;
      }
    }
    
    // Create fresh sandbox session
    const provider = await getSandboxProvider(providerType);
    const handle = await provider.createSandbox({
      language: 'typescript',
      autoStopInterval: 60,
      resources: { cpu: 1, memory: 2 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
      },
      labels: { userId },
    });
    
    // Record quota usage
    quotaManager.recordUsage(providerType);
    
    // Create session record
    const sessionId = `user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: UserTerminalSession = {
      sessionId,
      sandboxId: handle.id,
      ptySessionId: sessionId,
      userId,
      providerType,
      mode: 'pty',
      cwd,
      cols,
      rows,
      lastActive: Date.now(),
      history: [],
      metadata: {
        autoSnapshotEnabled: autoSnapshot,
        restoredFromSnapshot: false,
      },
    };
    
    // Save to persistence layer
    saveTerminalSession(session);
    this.activeSessions.set(session.sessionId, session);
    
    console.log(`[UserTerminalSession] Created new session ${session.sessionId} for user ${userId} on ${providerType}`);
    
    return session;
  }
  
  /**
   * Disconnect session with optional auto-snapshot
   * 
   * For providers that support snapshots (Sprites, CodeSandbox),
   * will create a checkpoint before disconnecting if createSnapshot is true.
   */
  async disconnectSession(
    sessionId: string,
    options: DisconnectSessionOptions = {}
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    const {
      createSnapshot = false,
      reason = 'user_request',
      snapshotName,
    } = options;
    
    const session = this.getActiveSession(sessionId) || 
                    this.getUserSessions(sessionId.split('-')[1] || 'unknown')[0];
    
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    let snapshotId: string | undefined;
    
    // Create snapshot before disconnect if requested and provider supports it
    if (createSnapshot) {
      try {
        snapshotId = await this.createSessionSnapshot(sessionId, snapshotName, reason);
        console.log(`[UserTerminalSession] Created snapshot ${snapshotId} for session ${sessionId}`);
      } catch (error: any) {
        console.warn(`[UserTerminalSession] Snapshot creation failed:`, error?.message || error);
        // Continue with disconnect even if snapshot fails
      }
    }
    
    // Disconnect terminal (using legacy terminal-manager for compatibility)
    const { terminalManager } = await import('./terminal-manager');
    try {
      await terminalManager.disconnectTerminal(sessionId);
    } catch (error: any) {
      console.warn(`[UserTerminalSession] Terminal disconnect failed:`, error?.message || error);
    }
    
    // Update session metadata
    updateTerminalSession(sessionId, {
      lastActive: Date.now(),
      lastSnapshotId: snapshotId,
      lastSnapshotAt: snapshotId ? Date.now() : undefined,
      metadata: {
        ...session.metadata,
        lastSnapshotReason: reason,
      },
    });
    
    // Remove from active cache
    this.activeSessions.delete(sessionId);
    
    console.log(`[UserTerminalSession] Disconnected session ${sessionId}${snapshotId ? ' with snapshot' : ''}`);
    
    return { success: true, snapshotId };
  }
  
  /**
   * Create snapshot of session state
   * 
   * Works with providers that support checkpoints:
   * - Sprites: createCheckpoint()
   * - CodeSandbox: createSnapshot()
   * - E2B: Not supported (stateless by design)
   * - Daytona: Not supported
   */
  async createSessionSnapshot(
    sessionId: string,
    name?: string,
    reason: 'user_request' | 'auto_disconnect' | 'idle_timeout' | 'manual' = 'user_request'
  ): Promise<string> {
    const session = this.getActiveSession(sessionId) || 
                    this.getUserSessions(sessionId.split('-')[1] || 'unknown')[0];
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const provider = await getSandboxProvider(session.providerType);
    const handle = await provider.getSandbox(session.sandboxId);
    
    // Check if provider supports snapshots
    if (!handle.createCheckpoint && !handle.createSnapshot) {
      throw new Error(
        `Provider ${session.providerType} does not support snapshots. ` +
        `Supported providers: sprites, codesandbox`
      );
    }
    
    // Create snapshot/checkpoint
    let snapshotId: string;
    const snapshotName = name || `snapshot-${sessionId}-${Date.now()}`;
    
    if (handle.createCheckpoint) {
      // Sprites-style checkpoint
      const checkpoint = await handle.createCheckpoint(snapshotName);
      snapshotId = checkpoint.id;
    } else if (handle.createSnapshot) {
      // CodeSandbox-style snapshot
      const snapshot = await handle.createSnapshot(snapshotName);
      snapshotId = snapshot.id || snapshot.snapshotId;
    } else {
      throw new Error('No snapshot method available');
    }
    
    // Update session with snapshot info
    updateTerminalSession(sessionId, {
      lastSnapshotId: snapshotId,
      lastSnapshotAt: Date.now(),
      metadata: {
        ...session.metadata,
        lastSnapshotReason: reason,
      },
    });
    
    return snapshotId;
  }
  
  /**
   * Restore user's session from snapshot
   * 
   * If snapshotId is provided, restores from that specific snapshot.
   * Otherwise, restores from user's most recent snapshot.
   */
  async restoreFromSnapshot(
    userId: string,
    snapshotId?: string
  ): Promise<RestoreResult> {
    // Get user's sessions to find snapshots
    const userSessions = this.getUserSessions(userId);
    
    if (userSessions.length === 0 && !snapshotId) {
      return {
        success: false,
        sandboxId: '',
        error: 'No previous sessions found for user',
      };
    }
    
    // Find session with snapshot
    let targetSession: UserTerminalSession | undefined;
    let targetSnapshotId: string | undefined;
    
    if (snapshotId) {
      // Restore from specific snapshot
      targetSession = userSessions.find(s => s.lastSnapshotId === snapshotId);
      targetSnapshotId = snapshotId;
    } else {
      // Find most recent snapshot
      const sessionsWithSnapshots = userSessions.filter(s => s.lastSnapshotId);
      targetSession = sessionsWithSnapshots.sort(
        (a, b) => (b.lastSnapshotAt || 0) - (a.lastSnapshotAt || 0)
      )[0];
      targetSnapshotId = targetSession?.lastSnapshotId;
    }
    
    if (!targetSession || !targetSnapshotId) {
      return {
        success: false,
        sandboxId: '',
        error: 'No snapshot found for restoration',
      };
    }
    
    try {
      // Get provider and handle
      const provider = await getSandboxProvider(targetSession.providerType);
      const handle = await provider.getSandbox(targetSession.sandboxId);
      
      // Restore checkpoint if provider supports it
      if (handle.restoreCheckpoint && targetSession.lastSnapshotId) {
        await handle.restoreCheckpoint(targetSnapshotId);
        console.log(`[UserTerminalSession] Restored checkpoint ${targetSnapshotId}`);
      }
      
      // Create new session record for restored state
      const restoredSession: UserTerminalSession = {
        ...targetSession,
        sessionId: `user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lastActive: Date.now(),
        metadata: {
          ...targetSession.metadata,
          restoredFromSnapshot: true,
          restoredSnapshotId: targetSnapshotId,
        },
      };
      
      // Save restored session
      saveTerminalSession(restoredSession);
      this.activeSessions.set(restoredSession.sessionId, restoredSession);
      
      console.log(`[UserTerminalSession] Restored session ${restoredSession.sessionId} from snapshot ${targetSnapshotId}`);
      
      return {
        success: true,
        session: restoredSession,
        sandboxId: handle.id,
        snapshotRestored: true,
      };
    } catch (error: any) {
      console.error(`[UserTerminalSession] Restoration failed:`, error?.message || error);
      return {
        success: false,
        sandboxId: targetSession.sandboxId,
        error: error?.message || 'Failed to restore from snapshot',
      };
    }
  }
  
  /**
   * Sync sandbox files back to VFS after snapshot restore
   * 
   * This ensures the virtual filesystem matches the restored sandbox state.
   */
  async syncSandboxToVFS(
    sessionId: string,
    vfsSyncFn: (files: Array<{ path: string; content: string }>) => Promise<void>
  ): Promise<{ success: boolean; filesSynced: number; error?: string }> {
    const session = this.getActiveSession(sessionId);
    
    if (!session) {
      return { success: false, filesSynced: 0, error: 'Session not found' };
    }
    
    try {
      const provider = await getSandboxProvider(session.providerType);
      const handle = await provider.getSandbox(session.sandboxId);
      
      // List files in sandbox workspace
      const listResult = await handle.listDirectory(session.cwd || '/workspace');
      
      if (!listResult.success) {
        return {
          success: false,
          filesSynced: 0,
          error: listResult.output || 'Failed to list directory',
        };
      }
      
      // Parse file list and sync each file
      const files: Array<{ path: string; content: string }> = [];
      const fileLines = listResult.output.split('\n').filter(line => line.trim());
      
      for (const line of fileLines) {
        // Parse ls -la output format: "-rw-r--r-- 1 user user 1234 Jan 1 12:00 filename"
        const parts = line.trim().split(/\s+/);
        const fileName = parts[parts.length - 1];
        
        if (fileName === '.' || fileName === '..') continue;
        
        // Read file content
        const readResult = await handle.readFile(fileName);
        if (readResult.success && readResult.output) {
          files.push({
            path: `${session.cwd || '/workspace'}/${fileName}`,
            content: readResult.output,
          });
        }
      }
      
      // Sync to VFS
      if (files.length > 0) {
        await vfsSyncFn(files);
        console.log(`[UserTerminalSession] Synced ${files.length} files to VFS for session ${sessionId}`);
      }
      
      return {
        success: true,
        filesSynced: files.length,
      };
    } catch (error: any) {
      console.error(`[UserTerminalSession] VFS sync failed:`, error?.message || error);
      return {
        success: false,
        filesSynced: 0,
        error: error?.message || 'VFS sync failed',
      };
    }
  }
  
  /**
   * Get session statistics for user
   */
  getUserSessionStats(userId: string): {
    totalSessions: number;
    activeSessions: number;
    sessionsWithSnapshots: number;
    totalSnapshots: number;
    providerBreakdown: Record<string, number>;
  } {
    const sessions = this.getUserSessions(userId);
    
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => this.activeSessions.has(s.sessionId)).length,
      sessionsWithSnapshots: sessions.filter(s => s.lastSnapshotId).length,
      totalSnapshots: sessions.filter(s => s.lastSnapshotId).length,
      providerBreakdown: sessions.reduce((acc, s) => {
        acc[s.providerType] = (acc[s.providerType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }
  
  /**
   * Clean up old sessions (optional maintenance)
   */
  cleanupOldSessions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    let cleaned = 0;
    
    for (const session of this.activeSessions.values()) {
      if (session.lastActive < cutoff) {
        this.activeSessions.delete(session.sessionId);
        deleteTerminalSession(session.sessionId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[UserTerminalSession] Cleaned up ${cleaned} old sessions`);
    }
    
    return cleaned;
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    // E2B new format: some IDs don't have the 'e2b-' prefix (e.g., 'ii8938a6cyxwggwamxh1k')
    const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId);
    if (isE2BFormat) return 'e2b';
    
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp';
    if (sandboxId.startsWith('blaxel-')) return 'blaxel';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem';
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn';
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter';
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent';
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    return 'daytona'; // Default
  }
}

/**
 * Singleton instance for convenience
 */
export const userTerminalSessionManager = new UserTerminalSessionManager();
