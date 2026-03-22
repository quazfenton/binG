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

    // Delete from VFS (use deletePath which is the correct method)
    await this.vfs.deletePath(ownerId, filePath);

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
      }, transactionId);
    }

    // Single commit for all changes
    if (this.options.autoCommit) {
      await this.commitChanges(ownerId, `Batch write ${files.length} files`, transactionId);
    }
  }

  /**
   * Track transaction entry (public method for proxy access)
   */
  trackTransaction(ownerId: string, entry: TransactionEntry, transactionId?: string): void {
    const key = transactionId || ownerId;
    if (!this.transactionLog.has(key)) {
      this.transactionLog.set(key, []);
    }
    this.transactionLog.get(key)!.push(entry);
  }

  /**
   * Commit buffered changes to shadow commit
   */
  async commitChanges(
    ownerId: string,
    message?: string,
    transactionId?: string
  ): Promise<CommitResult> {
    // Get transactions - use transactionId for batch operations, ownerId for single ops
    const key = transactionId || ownerId;
    const transactions = this.transactionLog.get(key) || [];
    
    // Also include any changes from changeBuffer that aren't in transactions
    const bufferedChanges = this.changeBuffer.filter(change => 
      !transactions.some(tx => tx.path === change.path)
    );

    if (transactions.length === 0 && bufferedChanges.length === 0) {
      return { success: true, committedFiles: 0 };
    }

    try {
      // Build VFS state from transactions
      const vfs: Record<string, string> = {};
      for (const tx of transactions) {
        if (tx.type !== 'DELETE' && tx.newContent) {
          vfs[tx.path] = tx.newContent;
        }
      }

      // Create shadow commit with all changes
      const result = await this.shadowCommitManager.commit(vfs, transactions, {
        sessionId: this.options.sessionId,
        message: message || this.options.commitMessage,
        author: ownerId,
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
   * 
   * @param ownerId - Owner ID
   * @param targetVersion - Version to rollback to
   * @param targetFiles - Optional array of specific files to rollback (partial rollback)
   */
  async rollback(
    ownerId: string,
    targetVersion: number,
    targetFiles?: string[]
  ): Promise<GitVFSRollbackResult> {
    try {
      // Get shadow commit history
      const history = await this.shadowCommitManager.getCommitHistory(this.options.sessionId, 100);

      // Find commit at target version - match by workspaceVersion or fall back to commit message
      const targetCommit = history.find(c =>
        c.workspaceVersion === targetVersion ||
        (c.workspaceVersion === null && new RegExp(`\\bv${targetVersion}\\b`).test(c.message ?? ''))
      );

      if (!targetCommit) {
        return {
          success: false,
          filesRestored: 0,
          version: targetVersion,
          error: `Version ${targetVersion} not found`,
        };
      }

      // If partial rollback requested, filter files from commit
      if (targetFiles && targetFiles.length > 0) {
        // Fetch full commit data to get transactions array
        // Note: getCommitHistory() only returns diff text, not full transaction data
        const fullCommit = await this.shadowCommitManager.getCommit(this.options.sessionId, targetCommit.commitId);
        const allTransactions = fullCommit?.transactions || [];

        // Filter transactions to only include target files
        const filteredTransactions = allTransactions.filter(tx => 
          targetFiles.includes(tx.path)
        );

        if (filteredTransactions.length === 0) {
          return {
            success: false,
            filesRestored: 0,
            version: targetVersion,
            error: `None of the specified files were found in version ${targetVersion}. Files in version: ${allTransactions.map(t => t.path).join(', ')}`,
          };
        }

        // Build VFS state with only filtered files
        const vfs: Record<string, string> = {};
        for (const tx of filteredTransactions) {
          if (tx.type !== 'DELETE' && tx.newContent) {
            vfs[tx.path] = tx.newContent;
          }
        }

        // Restore filtered files using existing VFS instance (not a new one)
        let restoredCount = 0;

        for (const [filePath, content] of Object.entries(vfs)) {
          try {
            await this.vfs.writeFile(ownerId, filePath, content);
            restoredCount++;
          } catch (error: any) {
            return {
              success: false,
              filesRestored: restoredCount,
              version: targetVersion,
              error: `Failed to restore ${filePath}: ${error.message}`,
            };
          }
        }

        // Handle DELETE transactions for target files
        for (const tx of filteredTransactions) {
          if (tx.type === 'DELETE') {
            try {
              await this.vfs.deletePath(ownerId, tx.path);
              restoredCount++;
            } catch (error: any) {
              // Ignore errors for already-deleted files
              if (!error.message?.includes('not found') && !error.message?.includes('ENOENT')) {
                return {
                  success: false,
                  filesRestored: restoredCount,
                  version: targetVersion,
                  error: `Failed to delete ${tx.path}: ${error.message}`,
                };
              }
              restoredCount++;
            }
          }
        }

        logger.info(`[GitVFS] Partial rollback successful: ${restoredCount}/${targetFiles.length} files`);
        return {
          success: true,
          filesRestored: restoredCount,
          version: targetVersion,
        };
      }

      // Full rollback - use standard ShadowCommitManager.rollback
      const result = await this.shadowCommitManager.rollback(this.options.sessionId, targetCommit.commitId);
      if (!result.success) {
        logger.error(`[GitVFS] Rollback to version ${targetVersion} failed: ${result.error}`);
        return {
          success: false,
          filesRestored: result.restoredFiles ?? 0,
          version: targetVersion,
          error: result.error,
        };
      }
      logger.info(`[GitVFS] Rolled back to version ${targetVersion}`);
      return {
        success: true,
        filesRestored: result.restoredFiles ?? 0,
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
    const history = await this.shadowCommitManager.getCommitHistory(this.options.sessionId, 1);
    const lastCommit = history[0];

    // Use workspaceVersion from last commit (reliable version tracking)
    // NOT filesChanged which is just a count of changed files
    return {
      version: lastCommit?.workspaceVersion ?? (
        this.changeBuffer.length > 0
          ? Math.max(...this.changeBuffer.map(c => c.version))
          : 0
      ),
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
    const history = await this.shadowCommitManager.getCommitHistory(this.options.sessionId, limit);

    return history.map(commit => ({
      commitId: commit.commitId,
      version: commit.workspaceVersion ?? commit.filesChanged, // Use workspaceVersion when available
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
