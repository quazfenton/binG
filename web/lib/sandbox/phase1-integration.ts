/**
 * Phase 1 Integration Module
 * 
 * Exports all Phase 1 modules with convenience functions for easy integration.
 * 
 * Modules included:
 * - Per-user terminal session isolation
 * - Auto-snapshot service (Sprites/CodeSandbox)
 * - Provider-specific advanced MCP tools
 * - VFS sync-back for snapshot restoration
 * 
 * All modules are ADDITIVE and don't break existing functionality.
 * 
 * @example
 * ```typescript
 * // Quick integration in your code
 * import { phase1 } from '@/lib/sandbox/phase1-integration';
 * 
 * // Create user session with auto-snapshot
 * const session = await phase1.createUserSession({
 *   userId: 'user_123',
 *   autoSnapshot: true,
 * });
 * 
 * // Enable provider MCP tools
 * const tools = phase1.getProviderMCPTools();
 * 
 * // Sync sandbox to VFS after restore
 * await phase1.syncToVFS(session.sessionId, 'project');
 * ```
 */

// ==================== User Terminal Sessions ====================
export {
  UserTerminalSessionManager,
  userTerminalSessionManager,
  type UserTerminalSession,
  type CreateSessionOptions,
  type DisconnectSessionOptions,
  type RestoreResult,
} from '../terminal/session/user-terminal-sessions';

// ==================== Auto-Snapshot Service ====================
export {
  AutoSnapshotService,
  autoSnapshotService,
  enableAutoSnapshot,
  createSnapshot,
  type AutoSnapshotConfig,
  type SnapshotMetadata,
} from '../virtual-filesystem/sync/auto-snapshot-service';

// ==================== VFS Sync-Back ====================
export {
  VFSyncBackService,
  vfsSyncBackService,
  syncSandboxToVFS,
  type VFSFileEntry,
  type VFSyncConfig,
  type VFSyncResult,
  type VFSyncStatus,
} from '../virtual-filesystem/sync/vfs-sync-back';

// ==================== Provider Advanced MCP Tools ====================
export {
  getAllProviderAdvancedTools as getProviderAdvancedTools,
  callProviderTool,
  getE2BAmpToolDefinitions,
  getE2BCodexToolDefinitions,
  getDaytonaComputerUseToolDefinitions,
  getCodesandboxBatchToolDefinitions,
  getSpritesCheckpointToolDefinitions,
  executeE2BAmpAgent,
  executeE2BCodexAgent,
  executeDaytonaScreenshot,
  executeDaytonaStartRecording,
  executeDaytonaStopRecording,
  executeCodesandboxBatch,
  executeSpritesCreateCheckpoint,
  executeSpritesListCheckpoints,
  executeSpritesRestoreCheckpoint,
  type ProviderToolDefinition,
  type ProviderToolResult,
} from '../mcp/provider-advanced-tools';

// ==================== Enhanced PTY Terminal ====================
export {
  EnhancedPTYTerminalManager,
  enhancedPTYTerminalManager,
  createPTYTerminal,
  getPTYTerminal,
  connectPTYToSandbox,
  disconnectPTY,
  type PTYMode,
  type PTYTerminalConfig,
  type PTYConnectOptions,
  type PTYDisconnectOptions,
  type PTYTerminalInstance,
} from '../terminal/enhanced-pty-terminal';

// ==================== Convenience Integration Class ====================

import { userTerminalSessionManager, type UserTerminalSession, type CreateSessionOptions } from '../terminal/session/user-terminal-sessions';
import { autoSnapshotService, type AutoSnapshotConfig } from '../virtual-filesystem/sync/auto-snapshot-service';
import { vfsSyncBackService, type VFSyncConfig, type VFSyncResult } from '../virtual-filesystem/sync/vfs-sync-back';
import { getAllProviderAdvancedTools, callProviderTool } from '../mcp/provider-advanced-tools';
import { enhancedPTYTerminalManager, type PTYConnectOptions, type PTYDisconnectOptions, type PTYTerminalConfig, type PTYTerminalInstance } from '../terminal/enhanced-pty-terminal';
import type { ProviderToolDefinition } from '../mcp/provider-advanced-tools';
import type { SandboxProviderType } from './providers';

/**
 * Phase 1 Integration Helper
 * 
 * Unified API for all Phase 1 features.
 */
export class Phase1Integration {
  /**
   * Create PTY terminal with local fallback
   */
  async createPTYTerminal(config: PTYTerminalConfig): Promise<PTYTerminalInstance> {
    return enhancedPTYTerminalManager.createPTYTerminal(config);
  }
  
  /**
   * Connect PTY terminal to sandbox
   */
  async connectPTY(terminalId: string, options: PTYConnectOptions): Promise<{ success: boolean; error?: string }> {
    return enhancedPTYTerminalManager.connectToSandbox(terminalId, options);
  }
  
  /**
   * Disconnect PTY terminal with optional snapshot
   */
  async disconnectPTY(terminalId: string, options?: PTYDisconnectOptions): Promise<{ success: boolean; snapshotId?: string }> {
    return enhancedPTYTerminalManager.disconnect(terminalId, options);
  }
  
  /**
   * Create user-scoped terminal session with optional auto-snapshot
   */
  async createUserSession(
    userId: string,
    options?: {
      providerType?: SandboxProviderType;
      autoSnapshot?: boolean;
      restoreFromSnapshot?: boolean;
    }
  ): Promise<UserTerminalSession> {
    return userTerminalSessionManager.createSession({
      userId,
      providerType: options?.providerType,
      autoSnapshot: options?.autoSnapshot ?? false,
      restoreFromSnapshot: options?.restoreFromSnapshot ?? false,
    });
  }
  
  /**
   * Disconnect session with auto-snapshot
   */
  async disconnectSession(
    sessionId: string,
    options?: {
      createSnapshot?: boolean;
      reason?: 'user_request' | 'idle_timeout' | 'error';
    }
  ): Promise<{ success: boolean; snapshotId?: string }> {
    return userTerminalSessionManager.disconnectSession(sessionId, {
      createSnapshot: options?.createSnapshot ?? false,
      reason: options?.reason,
    });
  }
  
  /**
   * Enable auto-snapshot for session
   */
  async enableAutoSnapshot(
    sessionId: string,
    config?: AutoSnapshotConfig
  ): Promise<{ success: boolean; error?: string }> {
    return autoSnapshotService.enableForSession(sessionId, config);
  }
  
  /**
   * Create manual snapshot
   */
  async createSnapshot(
    sessionId: string,
    name?: string
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    return autoSnapshotService.createSnapshot(sessionId, name);
  }
  
  /**
   * Restore from snapshot and sync to VFS
   */
  async restoreAndSync(
    userId: string,
    snapshotId?: string,
    vfsConfig?: VFSyncConfig
  ): Promise<{
    session?: UserTerminalSession;
    syncResult?: VFSyncResult;
    error?: string;
  }> {
    // Restore from snapshot
    const restoreResult = await userTerminalSessionManager.restoreFromSnapshot(userId, snapshotId);
    
    if (!restoreResult.success || !restoreResult.session) {
      return { error: restoreResult.error || 'Restore failed' };
    }
    
    // Sync to VFS if config provided
    if (vfsConfig) {
      const syncResult = await vfsSyncBackService.syncSandboxToVFS(
        restoreResult.session.sessionId,
        vfsConfig
      );
      
      return {
        session: restoreResult.session,
        syncResult,
      };
    }
    
    return { session: restoreResult.session };
  }
  
  /**
   * Sync sandbox to VFS
   */
  async syncToVFS(
    sessionId: string,
    vfsScopePath: string,
    config?: Partial<VFSyncConfig>
  ): Promise<VFSyncResult> {
    return vfsSyncBackService.syncSandboxToVFS(sessionId, {
      vfsScopePath,
      ...config,
    });
  }
  
  /**
   * Get all provider-specific MCP tools
   */
  getProviderMCPTools(): ProviderToolDefinition[] {
    return getAllProviderAdvancedTools();
  }
  
  /**
   * Call provider-specific MCP tool
   */
  async callProviderTool(
    toolName: string,
    args: Record<string, any>
  ): Promise<{ success: boolean; output: string; error?: string }> {
    return callProviderTool(toolName, args);
  }
  
  /**
   * Check if provider supports snapshots
   */
  isSnapshotSupported(providerType: SandboxProviderType): boolean {
    return autoSnapshotService.isSnapshotSupported(providerType);
  }
  
  /**
   * Get user session statistics
   */
  getUserSessionStats(userId: string): {
    totalSessions: number;
    activeSessions: number;
    sessionsWithSnapshots: number;
    providerBreakdown: Record<string, number>;
  } {
    return userTerminalSessionManager.getUserSessionStats(userId);
  }
}

/**
 * Singleton instance for convenience
 */
export const phase1 = new Phase1Integration();

/**
 * Quick integration helper: Create session and enable auto-snapshot
 */
export async function createSessionWithAutoSnapshot(
  userId: string,
  providerType?: SandboxProviderType
): Promise<UserTerminalSession> {
  const session = await userTerminalSessionManager.createSession({
    userId,
    providerType,
    autoSnapshot: true,
  });
  
  await autoSnapshotService.enableForSession(session.sessionId, {
    onDisconnect: true,
    onIdleTimeout: true,
  });
  
  return session;
}

/**
 * Quick integration helper: Restore from latest snapshot and sync to VFS
 */
export async function restoreLatestAndSync(
  userId: string,
  vfsScopePath: string = 'project'
): Promise<{
  session?: UserTerminalSession;
  syncResult?: VFSyncResult;
  error?: string;
}> {
  return phase1.restoreAndSync(userId, undefined, { vfsScopePath });
}
