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

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SandboxBridge');

// Track pending session creations to prevent race conditions
const pendingCreations = new Map<string, Promise<WorkspaceSession>>();

export class SandboxServiceBridge {
  private initialized = false;
  private sandboxService: any = null;
  private mountedFilesystemVersionBySandbox = new Map<string, number>();
  private tarPipeThreshold = parseInt(process.env.SPRITES_TAR_PIPE_THRESHOLD || '10', 10);

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
    if (existing) return existing;

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
    sandboxFilesystemSync.stopSync(sandboxId);
    await this.sandboxService.destroyWorkspace(sessionId, sandboxId);
    this.mountedFilesystemVersionBySandbox.delete(sandboxId);
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
   * P1 FIX: Extended to include more providers and return null for unknown instead of defaulting to e2b
   */
  inferProviderFromSandboxId(sandboxId: string): string | null {
    // E2B new format: some IDs don't have the 'e2b-' prefix (e.g., 'ii8938a6cyxwggwamxh1k')
    // These are alphanumeric strings, typically 18-20 chars
    const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId);
    if (isE2BFormat) return 'e2b';
    
    if (sandboxId.startsWith('blaxel-') || sandboxId.startsWith('blaxel-mcp-')) return 'blaxel';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('mistral-agent-')) return 'mistral-agent';
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    if (sandboxId.startsWith('daytona-')) return 'daytona';
    if (sandboxId.startsWith('runloop-')) return 'runloop';
    if (sandboxId.startsWith('microsandbox-')) return 'microsandbox';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('opensandbox-')) return 'opensandbox';
    if (sandboxId.startsWith('vercel-')) return 'vercel';
    if (sandboxId.startsWith('codespace-')) return 'codespaces';
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
