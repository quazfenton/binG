/**
 * Workspace Manager
 * 
 * Manages desktop workspace initialization and boundary settings.
 * Enables users to:
 * - Initialize a workspace folder for their projects
 * - Configure boundary limits for LLM file access
 * - Switch between local filesystem and sandbox modes
 * 
 * Per-user workspaces:
 * - Each user gets their own isolated workspace directory
 * - Workspace root: {defaultRoot}/users/{userId}/
 * - Sessions are created as subdirectories within user's workspace
 */

import { createFileSystem, type IFileSystem, type WorkspaceConfig, type FSStats, type FileWatcherCallback, type FileSystemWatchEvent, type DesktopFileChangeEvent, type DesktopFileChangeHandler } from './index';
import { isDesktopMode, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';

// Lazy crypto - avoids bundling Node.js 'crypto' in client bundle
function generateShortId(): string {
  if (typeof require !== 'undefined') {
    try {
      return require('crypto').randomUUID().slice(0, 8);
    } catch { /* fall through */ }
  }
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

const log = createLogger('WorkspaceManager');

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceInfo {
  id: string;
  root: string;
  userId: string;
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
  private fileChangeHandlers = new Set<DesktopFileChangeHandler>();

  /**
   * Initialize a new workspace
   */
  async initializeWorkspace(options: WorkspaceInitOptions): Promise<WorkspaceInfo> {
    if (!isDesktopMode()) {
      log.warn('Workspace manager called in non-desktop mode - workspace initialization skipped');
      throw new Error('Workspace initialization only available in desktop mode');
    }

    const workspaceId = options.sessionId || generateShortId();
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

    // Build per-user workspace path: {root}/users/{userId}/{sessionId}
    const userWorkspaceRoot = `${root}/users/${options.userId}`;
    const workspaceRoot = options.sessionId 
      ? `${userWorkspaceRoot}/${options.sessionId}` 
      : userWorkspaceRoot;

    const workspace: WorkspaceInfo = {
      id: workspaceId,
      root: workspaceRoot,
      userId: options.userId,
      boundaryPath: options.boundaryEnabled ? `${workspaceRoot}` : null,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      fileSystem,
    };

    this.workspaces.set(workspaceId, workspace);
    
    // Set as active workspace
    this.activeWorkspace = workspace;

    // Register file watcher for external change detection and event emission
    await this.registerFileWatcher(workspace, fileSystem);

    log.info('Workspace initialized successfully', { workspaceId, root: workspace.root, userId: options.userId });

    return workspace;
  }

  /**
   * Register file watcher to emit desktop filesystem change events
   * This enables UI updates when files change externally
   */
  private async registerFileWatcher(workspace: WorkspaceInfo, fileSystem: IFileSystem): Promise<void> {
    if (typeof fileSystem.startWatching !== 'function') {
      log.debug('Filesystem does not support watching, skipping event registration');
      return;
    }

    const watchCallback: FileWatcherCallback = (event: FileSystemWatchEvent) => {
      const changeEvent: DesktopFileChangeEvent = {
        type: event.type === 'create' ? 'create' : 
              event.type === 'delete' ? 'delete' : 'update',
        path: event.paths[0] || '',
        paths: event.paths,
        workspaceId: workspace.id,
        userId: workspace.userId,
        timestamp: Date.now(),
      };

      // Emit to all registered handlers
      for (const handler of this.fileChangeHandlers) {
        try {
          handler(changeEvent);
        } catch (err) {
          log.error('File change handler error:', err);
        }
      }
    };

    await fileSystem.startWatching(watchCallback);
    log.info('File watcher registered for workspace', { workspaceId: workspace.id });
  }

  /**
   * Register a handler for desktop file change events
   * Use this to receive real-time notifications of filesystem changes
   */
  onFileChange(handler: DesktopFileChangeHandler): () => void {
    this.fileChangeHandlers.add(handler);
    log.debug('Registered file change handler', { totalHandlers: this.fileChangeHandlers.size });
    
    // Return unsubscribe function
    return () => {
      this.fileChangeHandlers.delete(handler);
      log.debug('Unregistered file change handler', { remainingHandlers: this.fileChangeHandlers.size });
    };
  }

  /**
   * Emit a file change event to all handlers
   * Used by external systems to trigger UI updates
   */
  emitFileChange(event: Omit<DesktopFileChangeEvent, 'timestamp'>): void {
    const fullEvent: DesktopFileChangeEvent = {
      ...event,
      timestamp: Date.now(),
    };

    for (const handler of this.fileChangeHandlers) {
      try {
        handler(fullEvent);
      } catch (err) {
        log.error('Error emitting file change:', err);
      }
    }
  }

  /**
   * Get all registered file change handlers
   */
  getFileChangeHandlerCount(): number {
    return this.fileChangeHandlers.size;
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
