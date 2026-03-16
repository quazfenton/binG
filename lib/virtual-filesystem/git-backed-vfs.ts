/**
 * Git-Backed VFS Wrapper
 * 
 * Wraps VirtualFilesystemService to automatically create git commits
 * for every filesystem operation, enabling rollbacks and state tracking.
 * 
 * Features:
 * - Auto-commit on every VFS write/delete
 * - Shadow commit integration for audit trail
 * - Rollback to any previous state
 * - Branch-based VFS snapshots
 * - Diff tracking between versions
 */

import { VirtualFilesystemService, type FilesystemChangeEvent } from './virtual-filesystem-service';
import type { VirtualFile } from './filesystem-types';
import { ShadowCommitManager, type CommitResult, type TransactionEntry } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('GitVFS');

export interface GitVFSOptions {
  autoCommit?: boolean;
  commitMessage?: string;
  sessionId?: string;
  enableShadowCommits?: boolean;
}

export interface GitVFSChange {
  path: string;
  type: 'create' | 'update' | 'delete';
  version: number;
  previousContent?: string;
  newContent?: string;
  timestamp: string;
}

export interface GitVFSRollbackResult {
  success: boolean;
  filesRestored: number;
  version: number;
  error?: string;
}

export interface GitVFSState {
  version: number;
  lastCommitId?: string;
  pendingChanges: number;
  isClean: boolean;
}

/**
 * Git-backed VFS wrapper class
 */
export class GitBackedVFS {
  private vfs: VirtualFilesystemService;
  private shadowCommitManager: ShadowCommitManager;
  private options: Required<GitVFSOptions>;
  private changeBuffer: GitVFSChange[] = [];
  private transactionLog: Map<string, TransactionEntry[]> = new Map();

  constructor(vfs: VirtualFilesystemService, options: GitVFSOptions = {}) {
    this.vfs = vfs;
    this.shadowCommitManager = new ShadowCommitManager();
    this.options = {
      autoCommit: options.autoCommit ?? true,
      commitMessage: options.commitMessage ?? 'VFS auto-commit',
      sessionId: options.sessionId ?? 'default',
      enableShadowCommits: options.enableShadowCommits ?? true,
    };

    // Subscribe to VFS changes
    this.vfs.onFileChange(this.handleFileChange.bind(this));
  }

  /**
   * Handle VFS file change events
   */
  private handleFileChange(event: FilesystemChangeEvent): void {
    if (!this.options.autoCommit) return;

    const change: GitVFSChange = {
      path: event.path,
      type: event.type,
      version: event.version,
      timestamp: new Date().toISOString(),
    };

    this.changeBuffer.push(change);
    logger.debug(`[GitVFS] Buffered change: ${event.type} ${event.path} v${event.version}`);
  }

  /**
   * Write file with automatic git commit
   */
  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean }
  ): Promise<VirtualFile> {
    // Get previous content for diff tracking
    let previousContent: string | undefined;
    try {
      const previous = await this.vfs.readFile(ownerId, filePath);
      previousContent = previous.content;
    } catch {
      // File doesn't exist, this is a create operation
    }

    // Write to VFS
    const file = await this.vfs.writeFile(ownerId, filePath, content, language, options);

    // Track transaction
    this.trackTransaction(ownerId, {
      path: filePath,
      type: previousContent ? 'UPDATE' : 'CREATE',
      timestamp: Date.now(),
      originalContent: previousContent,
      newContent: content,
    });

    // Auto-commit if enabled
    if (this.options.autoCommit) {
      await this.commitChanges(ownerId, `Write ${filePath}`);
    }

    return file;
  }

  /**
   * Delete file with automatic git commit
   */
  async deleteFile(ownerId: string, filePath: string): Promise<void> {
    // Get content before deletion for rollback
    let previousContent: string | undefined;
    try {
      const previous = await this.vfs.readFile(ownerId, filePath);
      previousContent = previous.content;
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    // Delete from VFS
    await this.vfs.deleteFile(ownerId, filePath);

    // Track transaction
    this.trackTransaction(ownerId, {
      path: filePath,
      type: 'DELETE',
      timestamp: Date.now(),
      originalContent: previousContent,
    });

    // Auto-commit if enabled
    if (this.options.autoCommit) {
      await this.commitChanges(ownerId, `Delete ${filePath}`);
    }
  }

  /**
   * Batch write multiple files with single commit
   */
  async batchWrite(
    ownerId: string,
    files: Array<{ path: string; content: string; language?: string }>
  ): Promise<void> {
    const transactionId = `batch-${Date.now()}`;
    this.transactionLog.set(transactionId, []);

    for (const file of files) {
      let previousContent: string | undefined;
      try {
        const previous = await this.vfs.readFile(ownerId, file.path);
        previousContent = previous.content;
      } catch {
        // File doesn't exist
      }

      await this.vfs.writeFile(ownerId, file.path, file.content, file.language);

      this.trackTransaction(ownerId, {
        path: file.path,
        type: previousContent ? 'UPDATE' : 'CREATE',
        timestamp: Date.now(),
        originalContent: previousContent,
        newContent: file.content,
      });
    }

    // Single commit for all changes
    if (this.options.autoCommit) {
      await this.commitChanges(ownerId, `Batch write ${files.length} files`, transactionId);
    }
  }

  /**
   * Track transaction entry
   */
  private trackTransaction(ownerId: string, entry: TransactionEntry): void {
    if (!this.transactionLog.has(ownerId)) {
      this.transactionLog.set(ownerId, []);
    }
    this.transactionLog.get(ownerId)!.push(entry);
  }

  /**
   * Commit buffered changes to shadow commit
   */
  async commitChanges(
    ownerId: string,
    message?: string,
    transactionId?: string
  ): Promise<CommitResult> {
    if (this.changeBuffer.length === 0 && !transactionId) {
      return { success: true, committedFiles: 0 };
    }

    const transactions = transactionId
      ? this.transactionLog.get(transactionId) || []
      : this.transactionLog.get(ownerId) || [];

    if (transactions.length === 0 && this.changeBuffer.length === 0) {
      return { success: true, committedFiles: 0 };
    }

    try {
      // Create shadow commit with all changes
      const result = await this.shadowCommitManager.createCommit({
        sessionId: this.options.sessionId,
        message: message || this.options.commitMessage,
        autoApprove: true,
        source: 'git-vfs',
        integration: 'vfs-auto-commit',
      });

      // Clear buffers after successful commit
      this.changeBuffer = [];
      if (transactionId) {
        this.transactionLog.delete(transactionId);
      } else {
        this.transactionLog.delete(ownerId);
      }

      logger.info(`[GitVFS] Committed ${result.committedFiles} files: ${message}`);

      return result;
    } catch (error: any) {
      logger.error(`[GitVFS] Commit failed: ${error.message}`);
      return {
        success: false,
        committedFiles: 0,
        error: error.message,
      };
    }
  }

  /**
   * Rollback to specific version
   */
  async rollback(
    ownerId: string,
    targetVersion: number
  ): Promise<GitVFSRollbackResult> {
    try {
      // Get shadow commit history
      const history = await this.shadowCommitManager.getHistory(this.options.sessionId, 100);
      
      // Find commit at target version
      const targetCommit = history.find(c => {
        // Match by version or commit metadata
        return c.filesChanged === targetVersion || 
               c.message.includes(`v${targetVersion}`);
      });

      if (!targetCommit) {
        return {
          success: false,
          filesRestored: 0,
          version: targetVersion,
          error: `Version ${targetVersion} not found`,
        };
      }

      // Rollback to commit
      const result = await this.shadowCommitManager.rollback(targetCommit.commitId);

      if (result.success) {
        // Restore files in VFS from shadow commit data
        const commitData = await this.shadowCommitManager.getCommit(targetCommit.commitId);
        
        if (commitData && commitData.transactionLog) {
          for (const entry of commitData.transactionLog) {
            if (entry.originalContent && entry.type !== 'DELETE') {
              // Restore original content
              await this.vfs.writeFile(ownerId, entry.path, entry.originalContent);
            } else if (entry.type === 'DELETE' && entry.originalContent) {
              // Recreate deleted file
              await this.vfs.writeFile(ownerId, entry.path, entry.originalContent);
            }
          }
        }
      }

      logger.info(`[GitVFS] Rolled back to version ${targetVersion}`);

      return {
        success: result.success,
        filesRestored: result.restoredFiles,
        version: targetVersion,
      };
    } catch (error: any) {
      logger.error(`[GitVFS] Rollback failed: ${error.message}`);
      return {
        success: false,
        filesRestored: 0,
        version: targetVersion,
        error: error.message,
      };
    }
  }

  /**
   * Get current VFS state with git info
   */
  async getState(ownerId: string): Promise<GitVFSState> {
    const history = await this.shadowCommitManager.getHistory(this.options.sessionId, 1);
    const lastCommit = history[0];

    return {
      version: this.changeBuffer.length > 0 
        ? Math.max(...this.changeBuffer.map(c => c.version))
        : 0,
      lastCommitId: lastCommit?.commitId,
      pendingChanges: this.changeBuffer.length,
      isClean: this.changeBuffer.length === 0,
    };
  }

  /**
   * Get diff between current state and previous version
   */
  async getDiff(ownerId: string, targetVersion?: number): Promise<string> {
    const changes = targetVersion
      ? this.changeBuffer.filter(c => c.version >= targetVersion)
      : this.changeBuffer;

    const diff = changes.map(change => {
      const header = `--- ${change.path} (v${change.version - 1})\n+++ ${change.path} (v${change.version})`;
      
      if (change.type === 'delete') {
        return `${header}\n-${change.previousContent}`;
      } else if (change.type === 'create') {
        return `${header}\n+${change.newContent}`;
      } else {
        // Update - show unified diff
        const oldLines = (change.previousContent || '').split('\n');
        const newLines = (change.newContent || '').split('\n');
        
        let diffContent = `${header}\n`;
        const maxLen = Math.max(oldLines.length, newLines.length);
        
        for (let i = 0; i < maxLen; i++) {
          const oldLine = oldLines[i];
          const newLine = newLines[i];
          
          if (oldLine === newLine) {
            diffContent += ` ${oldLine || ''}\n`;
          } else if (oldLine === undefined) {
            diffContent += `+${newLine}\n`;
          } else if (newLine === undefined) {
            diffContent += `-${oldLine}\n`;
          } else {
            diffContent += `-${oldLine}\n+${newLine}\n`;
          }
        }
        
        return diffContent;
      }
    }).join('\n');

    return diff || 'No changes';
  }

  /**
   * List all versions/commits
   */
  async listVersions(limit: number = 20) {
    const history = await this.shadowCommitManager.getHistory(this.options.sessionId, limit);
    
    return history.map(commit => ({
      commitId: commit.commitId,
      version: commit.filesChanged,
      message: commit.message,
      author: commit.author,
      timestamp: commit.createdAt,
      filesChanged: commit.filesChanged,
    }));
  }

  /**
   * Enable/disable auto-commit
   */
  setAutoCommit(enabled: boolean): void {
    this.options.autoCommit = enabled;
    logger.info(`[GitVFS] Auto-commit ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Flush all pending changes without committing
   */
  flushChanges(): void {
    this.changeBuffer = [];
    logger.debug('[GitVFS] Flushed pending changes');
  }
}

/**
 * Factory function to create Git-backed VFS instance
 */
export function createGitBackedVFS(
  vfs: VirtualFilesystemService,
  options?: GitVFSOptions
): GitBackedVFS {
  return new GitBackedVFS(vfs, options);
}

// Singleton instances per owner
const gitVFSInstances = new Map<string, GitBackedVFS>();

/**
 * Get or create Git-backed VFS for owner
 */
export function getGitBackedVFSForOwner(
  ownerId: string,
  vfs: VirtualFilesystemService,
  options?: GitVFSOptions
): GitBackedVFS {
  if (!gitVFSInstances.has(ownerId)) {
    gitVFSInstances.set(ownerId, createGitBackedVFS(vfs, {
      ...options,
      sessionId: ownerId,
    }));
  }
  return gitVFSInstances.get(ownerId)!;
}
