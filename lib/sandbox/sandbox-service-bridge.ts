/**
 * Sandbox Service Bridge
 * Wraps the dayTona sandbox module for use within binG0.
 * Provides sandbox lifecycle, command execution, and file operations.
 */

// Import types from canonical source to avoid duplication
import type { WorkspaceSession, SandboxConfig } from './types';
import {
  getSession as storeGetSession,
  getSessionByUserId as storeGetSessionByUserId,
  getAllActiveSessions,
} from './session-store';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

// Track pending session creations to prevent race conditions
const pendingCreations = new Map<string, Promise<WorkspaceSession>>();

export class SandboxServiceBridge {
  private initialized = false;
  private sandboxService: any = null;
  private mountedFilesystemVersionBySandbox = new Map<string, number>();

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

  private async ensureVirtualFilesystemMounted(sandboxId: string): Promise<void> {
    const session = this.getSessionBySandboxId(sandboxId);
    if (!session?.userId) {
      return;
    }

    try {
      const currentVersion = await virtualFilesystem.getWorkspaceVersion(session.userId);
      const mountedVersion = this.mountedFilesystemVersionBySandbox.get(sandboxId);

      if (mountedVersion === currentVersion) {
        return;
      }

      const snapshot = await virtualFilesystem.exportWorkspace(session.userId);
      for (const file of snapshot.files) {
        await this.writeFile(sandboxId, file.path, file.content);
      }

      this.mountedFilesystemVersionBySandbox.set(sandboxId, currentVersion);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown mount error';
      console.warn(`[SandboxBridge] Failed to mount virtual filesystem to sandbox ${sandboxId}: ${message}`);
    }
  }
}

export const sandboxBridge = new SandboxServiceBridge();
