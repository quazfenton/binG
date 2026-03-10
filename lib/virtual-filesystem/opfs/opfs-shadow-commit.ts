/**
 * OPFS Shadow Commit Manager
 * 
 * Enhanced shadow commit system using OPFS for local commit storage
 * Provides instant commits with background server sync
 * 
 * Features:
 * - Local commits in OPFS (instant)
 * - Background sync to server
 * - Full git-like history in OPFS
 * - Rollback to any local commit
 * - Conflict detection with server
 */

import { opfsCore } from './opfs-core';
import { opfsAdapter } from './opfs-adapter';
import { virtualFilesystem } from '../virtual-filesystem-service';
import { generateUnifiedDiff } from '../stateful-agent/commit/shadow-commit';

// Generate UUID for commit IDs
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface OPFSTransactionEntry {
  path: string;
  type: 'UPDATE' | 'CREATE' | 'DELETE';
  timestamp: number;
  originalContent?: string;
  newContent?: string;
  search?: string;
  replace?: string;
}

export interface OPFSCommitOptions {
  workspaceId: string;
  ownerId: string;
  message: string;
  author?: string;
  autoSync?: boolean;
}

export interface OPFSCommitResult {
  success: boolean;
  commitId?: string;
  committedFiles: number;
  diff?: string;
  error?: string;
  timestamp: string;
}

export interface OPFSCommitEntry {
  commitId: string;
  workspaceId: string;
  ownerId: string;
  message: string;
  author: string;
  filesChanged: number;
  diff?: string;
  timestamp: string;
  synced: boolean;
}

export interface OPFSRollbackResult {
  success: boolean;
  restoredFiles: number;
  error?: string;
}

const METADATA_FILE = '.opfs-commits-metadata.json';

interface CommitMetadata {
  commits: OPFSCommitEntry[];
  lastSyncTime: number;
}

/**
 * OPFS Shadow Commit Manager
 */
export class OPFSShadowCommitManager {
  private core = opfsCore;
  private adapter = opfsAdapter;
  private workspaceId: string | null = null;
  private ownerId: string | null = null;
  private metadata: CommitMetadata = { commits: [], lastSyncTime: 0 };
  private initialized = false;

  constructor() {}

  /**
   * Initialize for a workspace
   */
  async initialize(workspaceId: string, ownerId: string): Promise<void> {
    if (this.initialized && this.workspaceId === workspaceId) {
      return;
    }

    await this.core.initialize(workspaceId);
    this.workspaceId = workspaceId;
    this.ownerId = ownerId;

    // Load metadata
    await this.loadMetadata();

    this.initialized = true;
    console.log('[OPFS ShadowCommit] Initialized for workspace:', workspaceId);
  }

  /**
   * Load commit metadata from OPFS
   */
  private async loadMetadata(): Promise<void> {
    try {
      const file = await this.core.readFile(METADATA_FILE);
      this.metadata = JSON.parse(file.content);
    } catch {
      this.metadata = { commits: [], lastSyncTime: 0 };
    }
  }

  /**
   * Save commit metadata to OPFS
   */
  private async saveMetadata(): Promise<void> {
    await this.core.writeFile(METADATA_FILE, JSON.stringify(this.metadata, null, 2));
  }

  /**
   * Create a commit in OPFS (instant)
   */
  async commitLocal(
    transactions: OPFSTransactionEntry[],
    options: OPFSCommitOptions
  ): Promise<OPFSCommitResult> {
    if (!this.initialized) {
      await this.initialize(options.workspaceId, options.ownerId);
    }

    if (transactions.length === 0) {
      return {
        success: true,
        committedFiles: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const commitId = generateUUID();
    const timestamp = new Date().toISOString();

    try {
      // Get current VFS state
      const vfs = await virtualFilesystem.exportWorkspace(options.ownerId);
      const vfsRecord: Record<string, string> = {};
      
      for (const file of vfs.files) {
        vfsRecord[file.path] = file.content;
      }

      // Generate diff for all transactions
      let totalDiff = '';
      let filesChanged = 0;

      for (const tx of transactions) {
        const originalContent = tx.originalContent || '';
        const newContent = tx.newContent || vfsRecord[tx.path] || '';

        const fileDiff = generateUnifiedDiff(originalContent, newContent, tx.path);
        if (fileDiff) {
          totalDiff += fileDiff + '\n';
          filesChanged++;
        }

        // Write file to OPFS commit storage
        const commitPath = `.opfs-commits/${commitId}/${tx.path}`;
        await this.core.writeFile(commitPath, newContent);
      }

      // Create commit entry
      const commitEntry: OPFSCommitEntry = {
        commitId,
        workspaceId: options.workspaceId,
        ownerId: options.ownerId,
        message: options.message,
        author: options.author || 'unknown',
        filesChanged,
        diff: totalDiff || undefined,
        timestamp,
        synced: false,
      };

      // Add to metadata
      this.metadata.commits.unshift(commitEntry);
      
      // Keep only last 100 commits
      if (this.metadata.commits.length > 100) {
        this.metadata.commits = this.metadata.commits.slice(0, 100);
      }

      await this.saveMetadata();

      console.log('[OPFS ShadowCommit] Created commit:', commitId, filesChanged, 'files');

      // Auto-sync to server if enabled
      if (options.autoSync) {
        this.syncCommitToServer(commitId).catch(err => {
          console.warn('[OPFS ShadowCommit] Auto-sync failed:', err);
        });
      }

      return {
        success: true,
        commitId,
        committedFiles: filesChanged,
        diff: totalDiff || undefined,
        timestamp,
      };
    } catch (error: any) {
      console.error('[OPFS ShadowCommit] Commit failed:', error.message);
      return {
        success: false,
        committedFiles: 0,
        error: error.message,
        timestamp,
      };
    }
  }

  /**
   * Sync local commit to server
   */
  async syncCommitToServer(commitId: string): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    const commitIndex = this.metadata.commits.findIndex(c => c.commitId === commitId);
    if (commitIndex === -1) {
      return false;
    }

    try {
      // Get all files from commit
      const commit = this.metadata.commits[commitIndex];
      const commitPath = `.opfs-commits/${commitId}`;
      
      const entries = await this.core.listDirectory(commitPath);
      
      for (const entry of entries) {
        if (entry.type === 'file') {
          const file = await this.core.readFile(`${commitPath}/${entry.name}`);
          
          // Write to server VFS
          await virtualFilesystem.writeFile(this.ownerId!, entry.name, file.content);
        }
      }

      // Update metadata
      this.metadata.commits[commitIndex].synced = true;
      this.metadata.lastSyncTime = Date.now();
      await this.saveMetadata();

      console.log('[OPFS ShadowCommit] Synced commit to server:', commitId);

      return true;
    } catch (error: any) {
      console.error('[OPFS ShadowCommit] Sync failed:', error.message);
      return false;
    }
  }

  /**
   * Restore from local commit (instant)
   */
  async restoreLocal(commitId: string): Promise<OPFSRollbackResult> {
    if (!this.initialized) {
      return { success: false, restoredFiles: 0, error: 'Not initialized' };
    }

    const commit = this.metadata.commits.find(c => c.commitId === commitId);
    if (!commit) {
      return { success: false, restoredFiles: 0, error: 'Commit not found' };
    }

    try {
      const commitPath = `.opfs-commits/${commitId}`;
      const entries = await this.core.listDirectory(commitPath);
      let restoredFiles = 0;

      for (const entry of entries) {
        if (entry.type === 'file') {
          try {
            const file = await this.core.readFile(`${commitPath}/${entry.name}`);
            
            // Restore to VFS
            await virtualFilesystem.writeFile(this.ownerId!, entry.name, file.content);
            
            restoredFiles++;
          } catch (error: any) {
            console.warn('[OPFS ShadowCommit] Failed to restore file:', entry.name, error.message);
          }
        }
      }

      console.log('[OPFS ShadowCommit] Restored commit:', commitId, restoredFiles, 'files');

      return {
        success: true,
        restoredFiles,
      };
    } catch (error: any) {
      console.error('[OPFS ShadowCommit] Restore failed:', error.message);
      return {
        success: false,
        restoredFiles: 0,
        error: error.message,
      };
    }
  }

  /**
   * Get local commit history
   */
  async getLocalHistory(limit: number = 20): Promise<OPFSCommitEntry[]> {
    if (!this.initialized) {
      return [];
    }

    return this.metadata.commits.slice(0, limit);
  }

  /**
   * Get commit details
   */
  async getCommitDetails(commitId: string): Promise<OPFSCommitEntry | null> {
    if (!this.initialized) {
      return null;
    }

    return this.metadata.commits.find(c => c.commitId === commitId) || null;
  }

  /**
   * Delete local commit
   */
  async deleteCommit(commitId: string): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    const commitIndex = this.metadata.commits.findIndex(c => c.commitId === commitId);
    if (commitIndex === -1) {
      return false;
    }

    try {
      // Delete commit files
      const commitPath = `.opfs-commits/${commitId}`;
      await this.core.deleteDirectory(commitPath, { recursive: true });

      // Remove from metadata
      this.metadata.commits.splice(commitIndex, 1);
      await this.saveMetadata();

      console.log('[OPFS ShadowCommit] Deleted commit:', commitId);

      return true;
    } catch (error: any) {
      console.error('[OPFS ShadowCommit] Delete failed:', error.message);
      return false;
    }
  }

  /**
   * Get unsynced commits
   */
  getUnsyncedCommits(): OPFSCommitEntry[] {
    return this.metadata.commits.filter(c => !c.synced);
  }

  /**
   * Sync all unsynced commits
   */
  async syncAllUnsynced(): Promise<{ success: number; failed: number }> {
    const unsynced = this.getUnsyncedCommits();
    let success = 0;
    let failed = 0;

    for (const commit of unsynced) {
      const result = await this.syncCommitToServer(commit.commitId);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Get commit count
   */
  getCommitCount(): number {
    return this.metadata.commits.length;
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): number {
    return this.metadata.lastSyncTime;
  }

  /**
   * Clear all local commits
   */
  async clearAll(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      await this.core.deleteDirectory('.opfs-commits', { recursive: true });
      this.metadata = { commits: [], lastSyncTime: 0 };
      await this.saveMetadata();

      console.log('[OPFS ShadowCommit] Cleared all commits');
    } catch (error: any) {
      console.error('[OPFS ShadowCommit] Clear failed:', error.message);
    }
  }
}

// Singleton instance
let opfsShadowCommitInstance: OPFSShadowCommitManager | null = null;

export function getOPFSShadowCommitManager(): OPFSShadowCommitManager {
  if (!opfsShadowCommitInstance) {
    opfsShadowCommitInstance = new OPFSShadowCommitManager();
  }
  return opfsShadowCommitInstance;
}

export const opfsShadowCommit = getOPFSShadowCommitManager();
