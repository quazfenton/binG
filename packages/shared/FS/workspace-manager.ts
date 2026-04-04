/**
 * Workspace Manager
 * 
 * Manages desktop workspace initialization and boundary settings.
 * Enables users to:
 * - Initialize a workspace folder for their projects
 * - Configure boundary limits for LLM file access
 * - Switch between local filesystem and sandbox modes
 */

import { createFileSystem, type IFileSystem, type WorkspaceConfig, type FSStats } from './index';
import { isDesktopMode, getDefaultWorkspaceRoot } from '../platform/env';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';

const log = createLogger('WorkspaceManager');

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceInfo {
  id: string;
  root: string;
  boundaryPath: string | null;
  createdAt: string;
  lastAccessed: string;
  fileSystem: IFileSystem;
}

export interface WorkspaceInitOptions {
  /** Custom workspace root (default: ~/opencode-workspaces) */
  root?: string;
  /** Enable boundary mode to limit LLM access */
  boundaryEnabled?: boolean;
  /** Custom session/workspace ID */
  sessionId?: string;
  /** User identifier */
  userId: string;
}

export interface WorkspaceStats {
  workspaceId: string;
  root: string;
  boundaryPath: string | null;
  stats: FSStats;
  platform: 'desktop' | 'web';
}

// ============================================================================
// Workspace Manager
// ============================================================================

class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();
  private activeWorkspace: WorkspaceInfo | null = null;
  private defaultRoot: string | null = null;

  /**
   * Initialize a new workspace
   */
  async initializeWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceInfo> {
    if (!isDesktopMode()) {
      log.warn('Workspace manager called in non-desktop mode - workspace initialization skipped');
      throw new Error('Workspace initialization only available in desktop mode');
    }

    const workspaceId = options.sessionId || randomUUID().slice(0, 8);
    const root = options.root || getDefaultWorkspaceRoot();

    if (!root) {
      throw new Error('Cannot determine workspace root. Please provide a custom root path.');
    }

    log.info('Initializing workspace', { workspaceId, root, boundaryEnabled: options.boundaryEnabled });

    // Create and initialize filesystem
    const fileSystem = createFileSystem();
    
    const config: WorkspaceConfig = {
      root,
      userId: options.userId,
      sessionId: workspaceId,
      boundaryEnabled: options.boundaryEnabled || false,
    };

    await fileSystem.initialize(config);

    const workspace: WorkspaceInfo = {
      id: workspaceId,
      root,
      boundaryPath: options.boundaryEnabled ? `${root}/${workspaceId}` : null,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      fileSystem,
    };

    this.workspaces.set(workspaceId, workspace);
    
    // Set as active workspace
    this.activeWorkspace = workspace;

    log.info('Workspace initialized successfully', { workspaceId, root: workspace.root });

    return workspace;
  }

  /**
   * Get workspace by ID
   */
  getWorkspace(workspaceId: string): WorkspaceInfo | undefined {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) {
      workspace.lastAccessed = new Date().toISOString();
    }
    return workspace;
  }

  /**
   * Get the active workspace
   */
  getActiveWorkspace(): WorkspaceInfo | null {
    if (this.activeWorkspace) {
      this.activeWorkspace.lastAccessed = new Date().toISOString();
    }
    return this.activeWorkspace;
  }

  /**
   * Set active workspace
   */
  setActiveWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      log.warn('Workspace not found', { workspaceId });
      return false;
    }
    this.activeWorkspace = workspace;
    workspace.lastAccessed = new Date().toISOString();
    return true;
  }

  /**
   * List all workspaces
   */
  listWorkspaces(): WorkspaceInfo[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Get workspace statistics
   */
  async getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return null;
    }

    const stats = await workspace.fileSystem.getStats();

    return {
      workspaceId: workspace.id,
      root: workspace.root,
      boundaryPath: workspace.boundaryPath,
      stats,
      platform: 'desktop',
    };
  }

  /**
   * Get active workspace statistics
   */
  async getActiveWorkspaceStats(): Promise<WorkspaceStats | null> {
    if (!this.activeWorkspace) {
      return null;
    }
    return this.getWorkspaceStats(this.activeWorkspace.id);
  }

  /**
   * Update workspace boundary
   */
  async updateBoundary(workspaceId: string, enabled: boolean): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return false;
    }

    // Note: In a full implementation, this would reinitialize the filesystem
    // with the new boundary setting. For now, we just update the metadata.
    workspace.boundaryPath = enabled ? `${workspace.root}/${workspaceId}` : null;
    
    log.info('Workspace boundary updated', { workspaceId, enabled });
    return true;
  }

  /**
   * Destroy a workspace
   */
  async destroyWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      return false;
    }

    await workspace.fileSystem.destroy();
    this.workspaces.delete(workspaceId);

    if (this.activeWorkspace?.id === workspaceId) {
      this.activeWorkspace = null;
    }

    log.info('Workspace destroyed', { workspaceId });
    return true;
  }

  /**
   * Clear all workspaces
   */
  async clearAllWorkspaces(): Promise<void> {
    for (const [id] of this.workspaces) {
      await this.destroyWorkspace(id);
    }
    this.activeWorkspace = null;
    log.info('All workspaces cleared');
  }

  /**
   * Check if workspace exists
   */
  hasWorkspace(workspaceId: string): boolean {
    return this.workspaces.has(workspaceId);
  }

  /**
   * Get workspace count
   */
  getWorkspaceCount(): number {
    return this.workspaces.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceManager = new WorkspaceManager();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick initialize a workspace for the current user
 */
export async function initWorkspace(userId: string, options?: Partial<WorkspaceInitOptions>): Promise<WorkspaceInfo> {
  return workspaceManager.initializeWorkspace({
    userId,
    root: options?.root,
    boundaryEnabled: options?.boundaryEnabled,
    sessionId: options?.sessionId,
  });
}

/**
 * Get the active filesystem instance
 */
export function getActiveFileSystem(): IFileSystem | null {
  const workspace = workspaceManager.getActiveWorkspace();
  return workspace?.fileSystem || null;
}

/**
 * Check if desktop mode is active
 */
export function isDesktopWorkspaceActive(): boolean {
  return isDesktopMode() && workspaceManager.getActiveWorkspace() !== null;
}