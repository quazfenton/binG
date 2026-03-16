/**
 * Auto-Snapshot Service for Sandbox Sessions
 * 
 * Automatically creates snapshots of sandbox state on:
 * - User disconnect
 * - Idle timeout
 * - Before destructive operations
 * - Periodic intervals (configurable)
 * 
 * Supported Providers:
 * - Sprites: createCheckpoint() - Full VM state
 * - CodeSandbox: createSnapshot() - Hibernation-based
 * 
 * Not Supported (stateless by design):
 * - E2B, Daytona, MicroSandbox, etc.
 * 
 * This service is OPT-IN and doesn't affect existing behavior.
 * Enable via environment variable or explicit API call.
 * 
 * @example
 * ```typescript
 * // Enable auto-snapshot for session
 * await autoSnapshotService.enableForSession(sessionId, {
 *   onDisconnect: true,
 *   onIdleTimeout: true,
 *   periodicInterval: 30 * 60 * 1000, // 30 minutes
 * });
 * 
 * // Manually create snapshot
 * await autoSnapshotService.createSnapshot(sessionId, 'before-deploy');
 * 
 * // Restore from snapshot
 * await autoSnapshotService.restoreSnapshot(snapshotId);
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from '../../sandbox/providers';
import type { SandboxHandle, CheckpointInfo } from './providers/sandbox-provider';
import { getTerminalSession, updateTerminalSession, type TerminalSessionState } from '../../terminal/session/terminal-session-store';
import { userTerminalSessionManager, type UserTerminalSession } from '../../terminal/session/user-terminal-sessions';

/**
 * Snapshot metadata
 */
export interface SnapshotMetadata {
  /** Unique snapshot ID */
  id: string;
  
  /** Session ID this snapshot belongs to */
  sessionId: string;
  
  /** Sandbox ID */
  sandboxId: string;
  
  /** User ID */
  userId: string;
  
  /** Provider type */
  providerType: SandboxProviderType;
  
  /** Snapshot name/label */
  name?: string;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Reason for snapshot */
  reason: 'user_request' | 'auto_disconnect' | 'idle_timeout' | 'periodic' | 'before_destructive';
  
  /** File count at time of snapshot */
  fileCount?: number;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Auto-snapshot configuration
 */
export interface AutoSnapshotConfig {
  /** Create snapshot on user disconnect */
  onDisconnect?: boolean;
  
  /** Create snapshot on idle timeout */
  onIdleTimeout?: boolean;
  
  /** Create periodic snapshots (interval in ms) */
  periodicInterval?: number;
  
  /** Create snapshot before destructive operations */
  beforeDestructive?: boolean;
  
  /** Maximum snapshots to keep per session */
  maxSnapshots?: number;
  
  /** Snapshot name prefix */
  namePrefix?: string;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AutoSnapshotConfig = {
  onDisconnect: true,
  onIdleTimeout: true,
  periodicInterval: 0, // Disabled by default
  beforeDestructive: false,
  maxSnapshots: 10,
  namePrefix: 'auto',
};

/**
 * Providers that support snapshots
 */
const SNAPSHOT_SUPPORTED_PROVIDERS: SandboxProviderType[] = ['sprites', 'codesandbox'];

/**
 * Auto-Snapshot Service
 */
export class AutoSnapshotService {
  /** Active auto-snapshot configurations */
  private activeConfigs = new Map<string, AutoSnapshotConfig>();
  
  /** Periodic snapshot timers */
  private periodicTimers = new Map<string, NodeJS.Timeout>();
  
  /** Snapshot history per session */
  private snapshotHistory = new Map<string, SnapshotMetadata[]>();
  
  /**
   * Check if provider supports snapshots
   */
  isSnapshotSupported(providerType: SandboxProviderType): boolean {
    return SNAPSHOT_SUPPORTED_PROVIDERS.includes(providerType);
  }
  
  /**
   * Enable auto-snapshot for a session
   */
  async enableForSession(
    sessionId: string,
    config: AutoSnapshotConfig = {}
  ): Promise<{ success: boolean; error?: string }> {
    const session = getTerminalSession(sessionId);
    
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    const providerType = this.inferProviderType(session.sandboxId);
    
    // Check if provider supports snapshots
    if (!this.isSnapshotSupported(providerType)) {
      return {
        success: false,
        error: `Provider ${providerType} does not support snapshots. Supported: ${SNAPSHOT_SUPPORTED_PROVIDERS.join(', ')}`,
      };
    }
    
    // Merge with defaults
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    this.activeConfigs.set(sessionId, mergedConfig);
    
    // Start periodic snapshots if configured
    if (mergedConfig.periodicInterval && mergedConfig.periodicInterval > 0) {
      this.startPeriodicSnapshot(sessionId, mergedConfig.periodicInterval);
    }
    
    console.log(`[AutoSnapshot] Enabled for session ${sessionId} with config:`, mergedConfig);
    
    return { success: true };
  }
  
  /**
   * Disable auto-snapshot for a session
   */
  disableForSession(sessionId: string): void {
    // Stop periodic timer
    const timer = this.periodicTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.periodicTimers.delete(sessionId);
    }
    
    // Remove config
    this.activeConfigs.delete(sessionId);
    
    console.log(`[AutoSnapshot] Disabled for session ${sessionId}`);
  }
  
  /**
   * Create snapshot manually
   */
  async createSnapshot(
    sessionId: string,
    name?: string,
    reason: SnapshotMetadata['reason'] = 'user_request'
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    const session = getTerminalSession(sessionId);
    
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    try {
      const provider = await getSandboxProvider(this.inferProviderType(session.sandboxId));
      const handle = await provider.getSandbox(session.sandboxId);
      
      // Create snapshot
      const snapshotId = await this.doCreateSnapshot(handle, sessionId, name, reason);
      
      // Track in history
      this.trackSnapshot({
        id: snapshotId,
        sessionId,
        sandboxId: session.sandboxId,
        userId: session.userId,
        providerType: this.inferProviderType(session.sandboxId),
        name,
        createdAt: Date.now(),
        reason,
      });
      
      // Update session with latest snapshot info
      updateTerminalSession(sessionId, {
        lastSnapshotId: snapshotId,
        lastSnapshotAt: Date.now(),
      });
      
      // Enforce max snapshots
      await this.enforceMaxSnapshots(sessionId);
      
      return { success: true, snapshotId };
    } catch (error: any) {
      console.error(`[AutoSnapshot] Failed to create snapshot:`, error?.message || error);
      return {
        success: false,
        error: error?.message || 'Failed to create snapshot',
      };
    }
  }
  
  /**
   * Restore from snapshot
   */
  async restoreSnapshot(
    snapshotId: string,
    sessionId?: string
  ): Promise<{ success: boolean; session?: UserTerminalSession; error?: string }> {
    // Find session for this snapshot
    let session: TerminalSessionState | undefined;
    
    if (sessionId) {
      session = getTerminalSession(sessionId);
    } else {
      // Search all sessions for this snapshot
      const allSessions = userTerminalSessionManager.getUserSessions('*');
      session = allSessions.find(s => s.lastSnapshotId === snapshotId);
    }
    
    if (!session) {
      return { success: false, error: 'Session not found for snapshot' };
    }
    
    try {
      const provider = await getSandboxProvider(this.inferProviderType(session.sandboxId));
      const handle = await provider.getSandbox(session.sandboxId);
      
      // Restore checkpoint
      if (handle.restoreCheckpoint) {
        await handle.restoreCheckpoint(snapshotId);
        console.log(`[AutoSnapshot] Restored checkpoint ${snapshotId}`);
      } else {
        return { success: false, error: 'Provider does not support checkpoint restoration' };
      }
      
      return { success: true };
    } catch (error: any) {
      console.error(`[AutoSnapshot] Restoration failed:`, error?.message || error);
      return {
        success: false,
        error: error?.message || 'Failed to restore snapshot',
      };
    }
  }
  
  /**
   * List snapshots for session
   */
  listSnapshots(sessionId: string): SnapshotMetadata[] {
    return this.snapshotHistory.get(sessionId) || [];
  }
  
  /**
   * Get latest snapshot for session
   */
  getLatestSnapshot(sessionId: string): SnapshotMetadata | undefined {
    const history = this.snapshotHistory.get(sessionId);
    if (!history || history.length === 0) return undefined;
    
    return history.sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  
  /**
   * Delete snapshot
   */
  async deleteSnapshot(
    snapshotId: string,
    sessionId?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Find session
    let session: TerminalSessionState | undefined;
    
    if (sessionId) {
      session = getTerminalSession(sessionId);
    }
    
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    try {
      const provider = await getSandboxProvider(this.inferProviderType(session.sandboxId));
      const handle = await provider.getSandbox(session.sandboxId);
      
      // Delete if provider supports it
      if (handle.deleteSnapshot) {
        await handle.deleteSnapshot(snapshotId);
      } else {
        console.warn(`[AutoSnapshot] Provider does not support snapshot deletion`);
      }
      
      // Remove from history
      const history = this.snapshotHistory.get(sessionId || '*');
      if (history) {
        const index = history.findIndex(s => s.id === snapshotId);
        if (index >= 0) {
          history.splice(index, 1);
        }
      }
      
      return { success: true };
    } catch (error: any) {
      console.error(`[AutoSnapshot] Deletion failed:`, error?.message || error);
      return {
        success: false,
        error: error?.message || 'Failed to delete snapshot',
      };
    }
  }
  
  /**
   * Handle session disconnect (auto-snapshot if configured)
   */
  async handleDisconnect(
    sessionId: string,
    reason: 'user_request' | 'idle_timeout' | 'error' = 'user_request'
  ): Promise<{ success: boolean; snapshotId?: string }> {
    const config = this.activeConfigs.get(sessionId);
    
    if (!config) {
      return { success: false };
    }
    
    // Check if should snapshot on this reason
    const shouldSnapshot = 
      (reason === 'user_request' && config.onDisconnect) ||
      (reason === 'idle_timeout' && config.onIdleTimeout);
    
    if (!shouldSnapshot) {
      return { success: false };
    }
    
    // Create snapshot
    const name = `${config.namePrefix || 'auto'}-${reason}-${Date.now()}`;
    const result = await this.createSnapshot(sessionId, name, reason);
    
    // Disable after disconnect
    this.disableForSession(sessionId);
    
    return result;
  }
  
  /**
   * Start periodic snapshot timer
   */
  private startPeriodicSnapshot(sessionId: string, intervalMs: number): void {
    // Clear existing timer
    this.stopPeriodicSnapshot(sessionId);
    
    const timer = setInterval(async () => {
      const result = await this.createSnapshot(sessionId, undefined, 'periodic');
      if (result.success) {
        console.log(`[AutoSnapshot] Periodic snapshot created: ${result.snapshotId}`);
      }
    }, intervalMs);
    
    this.periodicTimers.set(sessionId, timer);
    console.log(`[AutoSnapshot] Started periodic snapshots every ${intervalMs}ms`);
  }
  
  /**
   * Stop periodic snapshot timer
   */
  private stopPeriodicSnapshot(sessionId: string): void {
    const timer = this.periodicTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.periodicTimers.delete(sessionId);
    }
  }
  
  /**
   * Create snapshot using provider's native method
   */
  private async doCreateSnapshot(
    handle: SandboxHandle,
    sessionId: string,
    name?: string,
    reason: SnapshotMetadata['reason'] = 'user_request'
  ): Promise<string> {
    const snapshotName = name || `${reason}-${Date.now()}`;
    
    if (handle.createCheckpoint) {
      // Sprites-style checkpoint
      const checkpoint = await handle.createCheckpoint(snapshotName);
      return checkpoint.id;
    } else if (handle.createSnapshot) {
      // CodeSandbox-style snapshot
      const snapshot = await handle.createSnapshot(snapshotName);
      return snapshot.id || snapshot.snapshotId;
    } else {
      throw new Error('Provider does not support snapshots');
    }
  }
  
  /**
   * Track snapshot in history
   */
  private trackSnapshot(snapshot: SnapshotMetadata): void {
    const history = this.snapshotHistory.get(snapshot.sessionId) || [];
    history.push(snapshot);
    this.snapshotHistory.set(snapshot.sessionId, history);
  }
  
  /**
   * Enforce max snapshots limit (delete oldest)
   */
  private async enforceMaxSnapshots(sessionId: string): Promise<void> {
    const config = this.activeConfigs.get(sessionId);
    const maxSnapshots = config?.maxSnapshots || DEFAULT_CONFIG.maxSnapshots!;
    
    const history = this.snapshotHistory.get(sessionId);
    if (!history || history.length <= maxSnapshots) return;
    
    // Sort by creation time, delete oldest
    const sorted = history.sort((a, b) => b.createdAt - a.createdAt);
    const toDelete = sorted.slice(maxSnapshots);
    
    for (const snapshot of toDelete) {
      await this.deleteSnapshot(snapshot.id, sessionId);
      console.log(`[AutoSnapshot] Deleted old snapshot ${snapshot.id} (max: ${maxSnapshots})`);
    }
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
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
    return 'daytona';
  }
}

/**
 * Singleton instance
 */
export const autoSnapshotService = new AutoSnapshotService();

/**
 * Convenience function: Enable auto-snapshot for session
 */
export async function enableAutoSnapshot(
  sessionId: string,
  config?: AutoSnapshotConfig
): Promise<{ success: boolean; error?: string }> {
  return autoSnapshotService.enableForSession(sessionId, config);
}

/**
 * Convenience function: Create manual snapshot
 */
export async function createSnapshot(
  sessionId: string,
  name?: string
): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
  return autoSnapshotService.createSnapshot(sessionId, name);
}
