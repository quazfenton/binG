/**
 * Sandbox Service Bridge
 * Wraps the dayTona sandbox module for use within binG0.
 * Provides sandbox lifecycle, command execution, and file operations.
 * 
 * Features:
 * - Automatic tar-pipe sync for Sprites provider (10x faster for 10+ files)
 * - Incremental sync with file hashing
 * - Provider-aware filesystem mounting
 * - Standardized snapshotting and rollback
 */

import type { WorkspaceSession, SandboxConfig } from './types';
import {
  getSession as storeGetSession,
  getSessionByUserId as storeGetSessionByUserId,
  getAllActiveSessions,
  deleteSession as deleteSessionFromStore,
  clearUserSessions as clearUserSessionsFromStore,
  clearStaleSessions as clearStaleSessionsFromStore,
} from '../storage/session-store';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { sandboxFilesystemSync } from '../virtual-filesystem/sync/sandbox-filesystem-sync';
import { sandboxPersistenceManager } from '../storage/persistence-manager';
import { DaemonManager } from './daemon-manager';
import { getPreviewManager, PreviewManager } from './preview-manager';

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SandboxBridge');

// Track pending session creations to prevent race conditions
const pendingCreations = new Map<string, Promise<WorkspaceSession>>();

export class SandboxServiceBridge {
  private initialized = false;
  private sandboxService: any = null;
  private mountedFilesystemVersionBySandbox = new Map<string, number>();
  private tarPipeThreshold = parseInt(process.env.SPRITES_TAR_PIPE_THRESHOLD || '10', 10);
  // Singleton instances for daemon and preview management
  private _daemonManager = new DaemonManager();
  private _previewManager = getPreviewManager();

  /** Get the daemon manager for background process management */
  get daemonManager(): DaemonManager {
    return this._daemonManager;
  }

  /** Get the preview manager for preview URL management */
  get previewManager(): PreviewManager {
    return this._previewManager;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    try {
      // Dynamic import to avoid build errors when sandbox deps aren't installed
      const mod = await import('./core-sandbox-service');
      this.sandboxService = new mod.SandboxService();
      this.initialized = true;
    } catch (err) {
      console.warn('[SandboxBridge] Sandbox module not available:', (err as Error).message);
      throw new Error('Sandbox module is not configured. Set SANDBOX_PROVIDER and install required SDK.');
    }
  }

  async createWorkspace(userId: string, config?: SandboxConfig): Promise<WorkspaceSession> {
    await this.ensureInitialized();
    const session = await this.sandboxService.createWorkspace(userId, config);
    sandboxFilesystemSync.startSync(session.sandboxId, userId);
    return session;
  }

  async getOrCreateSession(userId: string, config?: SandboxConfig): Promise<WorkspaceSession> {
    // Check for existing active session
    const existing = storeGetSessionByUserId(userId);
    if (existing) {
      // FIX: Verify the sandbox is still alive before returning cached session
      const isAlive = await this.verifySandboxAlive(existing.sandboxId);
      if (isAlive) {
        logger.debug('Returning existing live session', { sandboxId: existing.sandboxId });
        return existing;
      }
      // Sandbox is dead - clean up stale session and create fresh one
      logger.warn('Stale session detected (sandbox dead), creating new one', {
        sandboxId: existing.sandboxId,
        sessionId: existing.sessionId,
      });
      deleteSessionFromStore(existing.sessionId);
    }

    // Check if a session is already being created for this user (prevent race condition)
    const pendingKey = `user:${userId}`;
    const pendingCreation = pendingCreations.get(pendingKey);
    if (pendingCreation) {
      return pendingCreation;
    }

    // Create a new workspace and track it as pending
    const creationPromise = this.createWorkspace(userId, config)
      .then((session) => {
        pendingCreations.delete(pendingKey);
        return session;
      })
      .catch((error) => {
        pendingCreations.delete(pendingKey);
        throw error;
      });

    pendingCreations.set(pendingKey, creationPromise);
    return creationPromise;
  }

  /**
   * Verify that a sandbox is still alive/accessible.
   * Returns false if the sandbox has been terminated or is unreachable.
   */
  async verifySandboxAlive(sandboxId: string): Promise<boolean> {
    if (!sandboxId) return false;
    try {
      const provider = this.inferProviderFromSandboxId(sandboxId);
      if (!provider) return false;
      const providerObj = await this.getProvider(provider);
      const handle = await providerObj.getSandbox(sandboxId);
      // Quick liveness check: execute a trivial command
      if (handle.executeCommand) {
        const result = await handle.executeCommand('true', '/workspace', 5000);
        return result.success === true;
      }
      // If no executeCommand, assume alive if getSandbox succeeded
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup: Destroy sandbox and clear session (called on disconnect/idle).
   */
  async cleanupSession(sessionId: string, sandboxId: string): Promise<void> {
    try {
      logger.info('Cleaning up sandbox session', { sessionId, sandboxId });
      await this.destroyWorkspace(sessionId, sandboxId);
      deleteSessionFromStore(sessionId);
      logger.info('Sandbox session cleaned up', { sessionId });
    } catch (error: any) {
      logger.error('Failed to cleanup sandbox session', {
        sessionId, sandboxId, error: error.message
      });
      // Still remove from store even if destroy fails
      deleteSessionFromStore(sessionId);
    }
  }

  /**
   * Suspend sandbox: Save state and stop without destroying.
   * Uses auto-suspend service for state preservation.
   */
  async suspendSession(sandboxId: string, reason: string = 'idle'): Promise<boolean> {
    try {
      const { AutoSuspendService } = await import('./auto-suspend-service');
      const autoSuspend = AutoSuspendService.getInstance();
      // Register all available providers with the suspend service
      const { getSandboxProvider } = await import('./providers');
      const providerTypes: string[] = ['daytona', 'e2b', 'codesandbox', 'blaxel', 'runloop', 'modal', 'mistral', 'agentfs', 'terminaluse', 'desktop'];
      for (const pt of providerTypes) {
        try {
          const p = await getSandboxProvider(pt as any);
          autoSuspend.registerProvider(pt, p);
        } catch { /* provider not configured */ }
      }

      autoSuspend.trackActivity(sandboxId);
      return autoSuspend.suspendSandbox(sandboxId, reason as any);
    } catch (error: any) {
      logger.warn('Failed to suspend sandbox', { sandboxId, error: error.message });
      return false;
    }
  }

  /**
   * Resume sandbox: Restore from suspended state.
   */
  async resumeSession(sandboxId: string): Promise<boolean> {
    try {
      const { AutoSuspendService } = await import('./auto-suspend-service');
      return AutoSuspendService.getInstance().resumeSandbox(sandboxId);
    } catch (error: any) {
      logger.warn('Failed to resume sandbox', { sandboxId, error: error.message });
      return false;
    }
  }

  async executeCommand(sandboxId: string, command: string, cwd?: string) {
    await this.ensureVirtualFilesystemMounted(sandboxId);
    await this.ensureInitialized();
    return this.sandboxService.executeCommand(sandboxId, command, cwd);
  }

  async writeFile(sandboxId: string, filePath: string, content: string) {
    await this.ensureInitialized();
    return this.sandboxService.writeFile(sandboxId, filePath, content);
  }

  async readFile(sandboxId: string, filePath: string) {
    await this.ensureInitialized();
    return this.sandboxService.readFile(sandboxId, filePath);
  }

  async listDirectory(sandboxId: string, dirPath?: string) {
    await this.ensureInitialized();
    return this.sandboxService.listDirectory(sandboxId, dirPath);
  }

  async destroyWorkspace(sessionId: string, sandboxId: string): Promise<void> {
    await this.ensureInitialized();
    // Stop filesystem sync
    sandboxFilesystemSync.stopSync(sandboxId);
    // Stop all daemons for this session
    try {
      const provider = this.inferProviderFromSandboxId(sandboxId);
      const providerObj = await this.getProvider(provider);
      const handle = await providerObj.getSandbox(sandboxId);
      await this._daemonManager.stopAllDaemons(handle, sessionId);
    } catch (e) {
      logger.warn('Failed to stop daemons during destroy', { sandboxId, error: e });
    }
    // Clear preview cache
    this._previewManager.clearCacheForSandbox(sandboxId);
    // Destroy the workspace
    await this.sandboxService.destroyWorkspace(sessionId, sandboxId);
    this.mountedFilesystemVersionBySandbox.delete(sandboxId);
  }

  // ---------------------------------------------------------------------------
  // Daemon management helpers
  // ---------------------------------------------------------------------------

  async startDaemon(sandboxId: string, sessionId: string, command: string, options?: { port?: number }) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return this._daemonManager.startDaemon(handle, sessionId, command, options);
  }

  async stopDaemon(sandboxId: string, sessionId: string, daemonId: string) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return this._daemonManager.stopDaemon(handle, sessionId, daemonId);
  }

  async listDaemons(sandboxId: string, sessionId: string) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return this._daemonManager.listDaemons(handle, sessionId);
  }

  async getDaemonLogs(sandboxId: string, daemonId: string, tailLines?: number) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return this._daemonManager.getDaemonLogs(handle, daemonId, tailLines);
  }

  getSession(sessionId: string): WorkspaceSession | undefined {
    return storeGetSession(sessionId);
  }

  getSessionByUserId(userId: string): WorkspaceSession | undefined {
    return storeGetSessionByUserId(userId);
  }

  getSessionBySandboxId(sandboxId: string): WorkspaceSession | undefined {
    return getAllActiveSessions().find((session) => session.sandboxId === sandboxId);
  }

  /**
   * Create a state snapshot of the sandbox
   */
  async createSnapshot(sandboxId: string, label?: string) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return sandboxPersistenceManager.createSnapshot(handle, label);
  }

  /**
   * Rollback sandbox to a specific snapshot
   */
  async rollback(sandboxId: string, snapshotId: string) {
    const provider = this.inferProviderFromSandboxId(sandboxId);
    const providerObj = await this.getProvider(provider);
    const handle = await providerObj.getSandbox(sandboxId);
    return sandboxPersistenceManager.rollback(handle, snapshotId);
  }

  /**
   * Infer provider type from sandbox ID
   * P1 FIX: Extended to include all providers and return null for unknown
   *
   * Provider ID patterns observed from actual sandbox creation:
   * - Daytona: UUID format (8-4-4-4-12) or 'daytona-' prefix
   * - E2B: 21-char alphanumeric or 'e2b-' prefix
   * - CodeSandbox: 6-char code or 'csb-' prefix
   * - Blaxel: 6-char code or 'blaxel-' prefix
   * - Runloop: 6-char code or 'runloop-' prefix
   * - Modal: 'modal-{timestamp}-{random}'
   * - Mistral: 6-char code or 'mistral-' prefix
   * - AgentFS: 'agentfs-{timestamp}'
   * - TerminalUse: 'local-{timestamp}'
   * - Desktop: 'desktop-{hash}'
   * - WebContainer: 'webcontainer-' prefix
   * - OpenSandbox: 'opensandbox-' prefix
   * - MicroSandbox: 'microsandbox-' prefix
   * - Sprites: 'sprite-' or 'bing-' prefix
   * - Vercel: 'vercel-' prefix
   */
  inferProviderFromSandboxId(sandboxId: string): string | null {
    if (!sandboxId || typeof sandboxId !== 'string') return null;

    // Explicit prefix matches first (highest priority)
    if (sandboxId.startsWith('daytona-')) return 'daytona';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    if (sandboxId.startsWith('csb-')) return 'codesandbox';
    if (sandboxId.startsWith('blaxel-') || sandboxId.startsWith('blaxel-mcp-')) return 'blaxel';
    if (sandboxId.startsWith('runloop-')) return 'runloop';
    if (sandboxId.startsWith('modal-')) return 'modal';
    if (sandboxId.startsWith('mistral-agent-')) return 'mistral-agent';
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('agentfs-')) return 'agentfs';
    if (sandboxId.startsWith('local-')) return 'terminaluse'; // TerminalUse uses local-{timestamp}
    if (sandboxId.startsWith('desktop-')) return 'desktop';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox';
    if (sandboxId.startsWith('microsandbox-') || sandboxId.startsWith('micro-')) return 'microsandbox';
    if (sandboxId.startsWith('vercel-')) return 'vercel';
    if (sandboxId.startsWith('codespace-')) return 'codespaces';

    // Pattern-based detection (lower priority, after explicit prefixes)
    // E2B: 18-25 char alphanumeric (no hyphens)
    if (/^[a-z0-9]{18,25}$/i.test(sandboxId)) return 'e2b';

    // CodeSandbox: exactly 6-char alphanumeric
    if (/^[a-z0-9]{6}$/i.test(sandboxId)) return 'codesandbox';

    // Blaxel/Runloop/Mistral/TerminalUse: short codes (5-7 chars)
    // These are ambiguous - default to most likely based on length
    if (/^[a-z0-9]{5,7}$/i.test(sandboxId)) {
      // Could be blaxel, runloop, mistral, or terminaluse
      // Default to blaxel as it's the most common short-code provider
      return 'blaxel';
    }

    // UUID format (Daytona)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sandboxId)) {
      return 'daytona';
    }

    // P1 FIX: Return null instead of defaulting to e2b - let caller decide how to handle unknown
    return null;
  }

  async getProvider(name: string | null) {
    const { getSandboxProvider } = await import('./providers');
    // P1 FIX: Don't silently default to e2b - throw error for unknown providers
    if (!name) {
      throw new Error('Cannot determine sandbox provider: sandbox ID format not recognized');
    }
    return getSandboxProvider(name as any);
  }

  /**
   * Delete a session from the store
   */
  deleteSession(sessionId: string): void {
    deleteSessionFromStore(sessionId);
  }

  /**
   * Clear all sessions for a user (e.g., to recover from failures)
   */
  clearUserSessions(userId: string): void {
    clearUserSessionsFromStore(userId);
  }

  /**
   * Clear stale sessions (expired or stuck in 'creating' status)
   */
  clearStaleSessions(): void {
    clearStaleSessionsFromStore();
  }

  /**
   * Mount virtual filesystem to sandbox with provider-specific optimization
   */
  private async ensureVirtualFilesystemMounted(sandboxId: string): Promise<void> {
    const session = this.getSessionBySandboxId(sandboxId);
    if (!session?.userId) {
      return;
    }

    const currentVersion = await virtualFilesystem.getWorkspaceVersion(session.userId);
    const mountedVersion = this.mountedFilesystemVersionBySandbox.get(sandboxId);

    if (mountedVersion === currentVersion) {
      return;
    }

    try {
      const snapshot = await virtualFilesystem.exportWorkspace(session.userId);
      const provider = this.inferProviderFromSandboxId(sandboxId);
      const providerObj = await this.getProvider(provider);
      const handle = await providerObj.getSandbox(sandboxId);

      // Attempt incremental sync first for efficiency
      const syncResult = await sandboxPersistenceManager.syncIncremental(handle, snapshot.files);
      logger.info(`Incremental sync to ${provider}: ${syncResult.synced} written, ${syncResult.skipped} skipped in ${syncResult.duration}ms`);

      this.mountedFilesystemVersionBySandbox.set(sandboxId, currentVersion);
    } catch (error: any) {
      logger.error(`Mounting virtual filesystem failed for sandbox ${sandboxId}: ${error.message}`, {
        sandboxId,
        userId: session.userId,
        currentVersion,
        mountedVersion,
        error: error.stack,
      });
      // Re-throw so callers know the mount failed and can handle appropriately
      throw new Error(`Failed to mount virtual filesystem: ${error.message}`, { cause: error });
    }
  }

  /**
   * Execute a tool with user isolation
   * Gets the user's session and executes the tool within their sandbox
   */
  async executeToolWithIsolation(userId: string, toolName: string, args: Record<string, any>) {
    const session = this.getSessionByUserId(userId);
    if (!session) {
      throw new Error(`No active session for user: ${userId}`);
    }

    // Execute based on tool name
    switch (toolName) {
      case 'executeCommand':
        return this.executeCommand(session.sandboxId, args.command, args.cwd);
      case 'writeFile':
        return this.writeFile(session.sandboxId, args.path, args.content);
      case 'readFile':
        return this.readFile(session.sandboxId, args.path);
      case 'listDirectory':
        return this.listDirectory(session.sandboxId, args.path);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

export const sandboxBridge = new SandboxServiceBridge();

// ---------------------------------------------------------------------------
// Auto-start auto-suspend service for idle sandbox detection
// ---------------------------------------------------------------------------
(async function startAutoSuspend() {
  try {
    const { AutoSuspendService } = await import('./auto-suspend-service');
    const service = AutoSuspendService.getInstance({
      idleTimeout: parseInt(process.env.SANDBOX_IDLE_TIMEOUT_MS || '1800000', 10), // 30 min default
      checkInterval: parseInt(process.env.SANDBOX_CHECK_INTERVAL_MS || '300000', 10), // 5 min default
      preserveState: process.env.SANDBOX_PRESERVE_STATE !== 'false',
      restoreState: process.env.SANDBOX_RESTORE_STATE !== 'false',
    });

    // Register all providers
    const { getSandboxProvider } = await import('./providers');
    const providerTypes: string[] = ['daytona', 'e2b', 'codesandbox', 'blaxel', 'runloop', 'modal', 'mistral', 'agentfs', 'terminaluse', 'desktop'];
    for (const pt of providerTypes) {
      try {
        const p = await getSandboxProvider(pt as any);
        service.registerProvider(pt, p);
      } catch { /* provider not configured */ }
    }

    service.start();
    logger.info('Auto-suspend service started', {
      idleTimeout: service['config'].idleTimeout / 60000 + 'min',
    });
  } catch (error: any) {
    logger.warn('Failed to start auto-suspend service', { error: error.message });
  }
})();

/**
 * Standalone helper so route handlers can destructure:
 *   const { executeToolWithIsolation } = await import(...)
 */
export async function executeToolWithIsolation(
  userId: string,
  toolName: string,
  args: Record<string, any>,
) {
  return sandboxBridge.executeToolWithIsolation(userId, toolName, args);
}
