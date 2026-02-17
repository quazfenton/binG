/**
 * Sandbox Service Bridge
 * Wraps the dayTona sandbox module for use within binG0.
 * Provides sandbox lifecycle, command execution, and file operations.
 */

// Re-use types locally to avoid deep import chains
export interface WorkspaceSession {
  sessionId: string;
  sandboxId: string;
  userId: string;
  cwd: string;
  createdAt: string;
  lastActive: string;
  status: 'creating' | 'active' | 'snapshotting' | 'destroyed';
}

export interface SandboxConfig {
  language?: string;
  autoStopInterval?: number;
  resources?: { cpu?: number; memory?: number };
  envVars?: Record<string, string>;
}

// In-memory session store for sandbox sessions
const sandboxSessions = new Map<string, WorkspaceSession>();

export class SandboxServiceBridge {
  private initialized = false;
  private sandboxService: any = null;

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
    sandboxSessions.set(session.sessionId, session);
    return session;
  }

  async getOrCreateSession(userId: string, config?: SandboxConfig): Promise<WorkspaceSession> {
    // Check for existing active session
    for (const session of sandboxSessions.values()) {
      if (session.userId === userId && session.status === 'active') {
        return session;
      }
    }
    return this.createWorkspace(userId, config);
  }

  async executeCommand(sandboxId: string, command: string, cwd?: string) {
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
    sandboxSessions.delete(sessionId);
  }

  getSession(sessionId: string): WorkspaceSession | undefined {
    return sandboxSessions.get(sessionId);
  }

  getSessionByUserId(userId: string): WorkspaceSession | undefined {
    for (const session of sandboxSessions.values()) {
      if (session.userId === userId && session.status === 'active') {
        return session;
      }
    }
    return undefined;
  }
}

export const sandboxBridge = new SandboxServiceBridge();
