/**
 * Git-VFS Sync
 *
 * Synchronizes VFS state with git repository in OPFS
 * Provides git-backed version control for VFS files
 *
 * Features:
 * - Auto-commit VFS changes to git
 * - Restore VFS from git commits
 * - Branch-based VFS snapshots
 * - Diff between VFS and git state
 */

'use client';

import type { OPFSGitIntegration, GitStatusResult, GitCommit } from './opfs-git';
import { getOPFSGit } from './opfs-git';
import type { OPFSCore } from './opfs-core';
import { opfsCore } from './opfs-core';
import type { VirtualFile } from '../filesystem-types';

// Lazy import virtualFilesystem to avoid bundling node:fs in client
let _virtualFilesystemModule: typeof import('../virtual-filesystem-service').virtualFilesystem | null = null;

async function getVirtualFilesystem() {
  if (!_virtualFilesystemModule) {
    try {
      const mod = await import('../virtual-filesystem-service');
      _virtualFilesystemModule = mod.virtualFilesystem;
    } catch {
      _virtualFilesystemModule = null;
    }
  }
  return _virtualFilesystemModule;
}

export interface GitVFSSyncOptions {
  workspaceId: string;
  ownerId: string;
  gitdir?: string;
  autoCommit?: boolean;
  commitMessage?: string;
  branch?: string;
}

export interface GitVFSCommitResult {
  success: boolean;
  commitId?: string;
  filesCommitted: number;
  diff?: string;
  error?: string;
}

export interface GitVFSRestoreResult {
  success: boolean;
  filesRestored: number;
  error?: string;
}

export interface GitVFSStatus {
  gitStatus: GitStatusResult;
  vfsVersion: number;
  isSynced: boolean;
  pendingChanges: number;
}

/**
 * Git-VFS Sync Manager
 * 
 * Bridges VFS and git operations for version-controlled workspace
 */
export class GitVFSSync {
  private git: OPFSGitIntegration;
  private core: OPFSCore;
  private options: Required<GitVFSSyncOptions>;
  private initialized = false;

  constructor(options: GitVFSSyncOptions) {
    this.git = getOPFSGit(options.workspaceId, { gitdir: options.gitdir });
    this.core = opfsCore;
    this.options = {
      workspaceId: options.workspaceId,
      ownerId: options.ownerId,
      gitdir: options.gitdir || '.git',
      autoCommit: options.autoCommit ?? false,
      commitMessage: options.commitMessage || 'VFS sync',
      branch: options.branch || 'main',
    };
  }

  /**
   * Initialize git-VFS sync
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.core.initialize(this.options.workspaceId);
    
    // Initialize git repo if it doesn't exist
    const exists = await this.git.repoExists();
    if (!exists) {
      await this.git.initRepo();
    }

    this.initialized = true;
    console.log('[Git-VFS] Initialized for workspace:', this.options.workspaceId);
  }

  /**
   * Sync VFS state to git commit
   * 
   * Creates a git commit with all current VFS files
   */
  async syncToGit(): Promise<GitVFSCommitResult> {
    await this.initialize();

    try {
      // Get VFS snapshot
      const vfs = await getVirtualFilesystem();
      if (!vfs) {
        return {
          success: false,
          filesCommitted: 0,
          error: 'Server VFS not available',
        };
      }
      const snapshot = await vfs.exportWorkspace(this.options.ownerId);
      
      if (snapshot.files.length === 0) {
        return {
          success: true,
          filesCommitted: 0,
        };
      }

      // Write all files to OPFS (git working directory)
      for (const file of snapshot.files) {
        await this.core.writeFile(
          `${this.options.workspaceId}/${file.path}`,
          file.content
        );
      }

      // Add all files to git staging
      await this.git.add('.');

      // Check if there are changes
      const status = await this.git.status();
      if (status.isClean) {
        return {
          success: true,
          filesCommitted: 0,
        };
      }

      // Create commit
      const commitId = await this.git.commit(
        `${this.options.commitMessage} - ${snapshot.files.length} files`,
        {
          authorName: 'VFS Sync',
          authorEmail: 'vfs@local',
        }
      );

      // Generate diff
      const diff = await this.git.diffText({ ref: 'HEAD~1' });

      console.log('[Git-VFS] Synced to git:', commitId, snapshot.files.length, 'files');

      return {
        success: true,
        commitId,
        filesCommitted: snapshot.files.length,
        diff,
      };
    } catch (error: any) {
      console.error('[Git-VFS] Sync to git failed:', error.message);
      return {
        success: false,
        filesCommitted: 0,
        error: error.message,
      };
    }
  }

  /**
   * Sync git state to VFS
   * 
   * Restores VFS files from git working directory
   */
  async syncFromGit(): Promise<GitVFSRestoreResult> {
    await this.initialize();

    try {
      // Get git status to find all tracked files
      const status = await this.git.status();
      
      let filesRestored = 0;

      // Read all files from OPFS and write to VFS
      const files = status.files.filter(f => f.status !== 'deleted');

      const vfs = await getVirtualFilesystem();
      if (!vfs) {
        return {
          success: false,
          filesRestored: 0,
          error: 'Server VFS not available',
        };
      }

      for (const file of files) {
        try {
          const opfsFile = await this.core.readFile(
            `${this.options.workspaceId}/${file.path}`
          );

          await vfs.writeFile(
            this.options.ownerId,
            file.path,
            opfsFile.content
          );

          filesRestored++;
        } catch (error: any) {
          console.warn('[Git-VFS] Failed to restore file:', file.path, error.message);
        }
      }

      console.log('[Git-VFS] Synced from git:', filesRestored, 'files');

      return {
        success: true,
        filesRestored,
      };
    } catch (error: any) {
      console.error('[Git-VFS] Sync from git failed:', error.message);
      return {
        success: false,
        filesRestored: 0,
        error: error.message,
      };
    }
  }

  /**
   * Create VFS snapshot as git commit
   * 
   * Similar to syncToGit but with custom message and metadata
   */
  async snapshotAsCommit(message: string): Promise<GitVFSCommitResult> {
    const originalMessage = this.options.commitMessage;
    this.options.commitMessage = message;
    
    const result = await this.syncToGit();
    
    this.options.commitMessage = originalMessage;
    
    return result;
  }

  /**
   * Restore VFS from git commit
   * 
   * Checks out a specific commit and restores VFS
   */
  async restoreFromCommit(commitId: string): Promise<GitVFSRestoreResult> {
    await this.initialize();

    try {
      // Checkout the commit
      await this.git.checkout(commitId);

      // Sync to VFS
      return await this.syncFromGit();
    } catch (error: any) {
      console.error('[Git-VFS] Restore from commit failed:', error.message);
      return {
        success: false,
        filesRestored: 0,
        error: error.message,
      };
    }
  }

  /**
   * Restore VFS from git branch
   */
  async restoreFromBranch(branch: string): Promise<GitVFSRestoreResult> {
    await this.initialize();

    try {
      // Checkout the branch
      await this.git.checkout(branch);

      // Sync to VFS
      return await this.syncFromGit();
    } catch (error: any) {
      console.error('[Git-VFS] Restore from branch failed:', error.message);
      return {
        success: false,
        filesRestored: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get combined git + VFS status
   */
  async getStatus(): Promise<GitVFSStatus> {
    await this.initialize();

    const gitStatus = await this.git.status();
    
    // Get VFS version
    let vfsVersion = 0;
    try {
      const vfs = await getVirtualFilesystem();
      if (vfs) {
        const snapshot = await vfs.exportWorkspace(this.options.ownerId);
        vfsVersion = snapshot.version;
      }
    } catch {
      vfsVersion = 0;
    }

    // Check if synced
    const isSynced = gitStatus.isClean;
    const pendingChanges = gitStatus.files.length;

    return {
      gitStatus,
      vfsVersion,
      isSynced,
      pendingChanges,
    };
  }

  /**
   * Get commit history
   */
  async getHistory(depth: number = 10): Promise<Array<{
    commitId: string;
    message: string;
    author: string;
    timestamp: Date;
    filesChanged?: number;
  }>> {
    await this.initialize();

    try {
      const log = await this.git.log('HEAD', depth);

      return log.map(entry => ({
        commitId: entry.oid,
        message: entry.commit.message,
        author: `${entry.commit.author.name} <${entry.commit.author.email}>`,
        timestamp: new Date(entry.commit.author.timestamp * 1000),
      }));
    } catch (error: any) {
      console.error('[Git-VFS] Get history failed:', error.message);
      return [];
    }
  }

  /**
   * Create new branch from current state
   */
  async createBranch(branch: string, checkout: boolean = false): Promise<void> {
    await this.initialize();
    await this.git.createBranch(branch, checkout);
  }

  /**
   * Switch to branch
   */
  async switchBranch(branch: string): Promise<void> {
    await this.initialize();
    await this.git.checkout(branch);
  }

  /**
   * List branches
   */
  async listBranches(): Promise<Array<{ name: string; current: boolean }>> {
    await this.initialize();
    return await this.git.listBranches();
  }

  /**
   * Get diff between VFS and git HEAD
   */
  async getDiff(): Promise<string> {
    await this.initialize();
    return await this.git.diffText();
  }

  /**
   * Auto-commit enabled check
   */
  isAutoCommitEnabled(): boolean {
    return this.options.autoCommit;
  }

  /**
   * Enable/disable auto-commit
   */
  setAutoCommit(enabled: boolean): void {
    this.options.autoCommit = enabled;
    console.log('[Git-VFS] Auto-commit', enabled ? 'enabled' : 'disabled');
  }
}

// Singleton factory
const syncInstances = new Map<string, GitVFSSync>();

export function getGitVFSSync(
  workspaceId: string,
  ownerId: string,
  options?: Partial<GitVFSSyncOptions>
): GitVFSSync {
  const key = `${workspaceId}:${ownerId}`;
  
  if (!syncInstances.has(key)) {
    syncInstances.set(key, new GitVFSSync({ workspaceId, ownerId, ...options }));
  }
  
  return syncInstances.get(key)!;
}

export const gitVFSSync = getGitVFSSync('default', 'default');
