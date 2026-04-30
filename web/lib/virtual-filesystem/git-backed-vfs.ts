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
  private transactionLog: Map<string, TransactionEntry[]> = new Map<string, TransactionEntry[]>();
  // FIX: Track the owner this instance belongs to — prevents duplicate handling
  // when multiple GitVFS instances exist (one per owner+session composite key).
  // Without this, every instance's listener fires for ALL file change events.
  private readonly ownerId: string;

  constructor(vfs: VirtualFilesystemService, options: GitVFSOptions = {}, ownerId?: string) {
    this.vfs = vfs;
    this.ownerId = ownerId || options.sessionId || 'default';
    this.shadowCommitManager = new ShadowCommitManager();
    this.options = {
      autoCommit: options.autoCommit ?? true,  // Enabled by default for immediate feedback
      commitMessage: options.commitMessage ?? 'VFS auto-commit',
      sessionId: options.sessionId ?? 'default',
      enableShadowCommits: options.enableShadowCommits ?? true,
    };

    // Subscribe to VFS changes
    this.vfs.onFileChange(this.handleFileChange.bind(this));
  }

  // Track if we're currently in a persist operation to avoid commit loops
  private isPersisting = false;

  /**
   * Handle VFS file change events
   * FIX: Only process events for this instance's owner — prevents N instances
   * from all buffering the same change when N GitBackedVFS instances exist.
   */
  private handleFileChange(event: FilesystemChangeEvent): void {
    // SECURITY FIX: Proper owner ID matching to prevent cross-session data leaks
    // Previously used startsWith() which could allow spoofing:
    // - Owner "user" would match "user-extra" (incorrect)
    // - Owner "1$session" would match "1$session-extra" (incorrect)
    // Now using explicit composite key matching with delimiter validation
    
    const isExactMatch = event.ownerId === this.ownerId;
    
    // For composite keys, only match if:
    // 1. Event has no delimiter (root owner)
    // 2. This instance is for that root owner
    // 3. Delimiter immediately follows
    const isRootToComposite = () => {
      if (event.ownerId.includes('$') || event.ownerId.includes(':')) return false;
      if (!this.ownerId.includes('$') && !this.ownerId.includes(':')) return false;
      
      const delim = this.ownerId.includes('$') ? '$' : ':';
      const expectedPrefix = event.ownerId + delim;
      return this.ownerId.startsWith(expectedPrefix) && this.ownerId.length > expectedPrefix.length;
    };
    
    if (!isExactMatch && !isRootToComposite()) return;
    if (!this.options.autoCommit || this.isPersisting) return;

    // Deduplicate: skip if this path is already buffered at same or newer version
    const existingIdx = this.changeBuffer.findIndex(c => c.path === event.path);
    if (existingIdx !== -1) {
      const existing = this.changeBuffer[existingIdx];
      if (event.version <= existing.version) return; // Already have same or newer
      this.changeBuffer.splice(existingIdx, 1); // Replace stale entry
    }

    const change: GitVFSChange = {
      path: event.path,
      type: event.type,
      version: event.version,
      timestamp: new Date().toISOString(),
    };

    this.changeBuffer.push(change);
    logger.debug(`[GitVFS] Buffered change: ${event.type} ${event.path} v${event.version} (owner: ${this.ownerId.substring(0, 30)})`);
  }

  /**
   * Temporarily disable auto-commit during bulk operations
   * Call before bulk writes, then call enableAutoCommit when done
   */
  disableAutoCommit(): void {
    this.isPersisting = true;
  }

  /**
   * Re-enable auto-commit and commit any buffered changes
   */
  async enableAutoCommit(ownerId: string): Promise<CommitResult> {
    this.isPersisting = false;
    if (this.changeBuffer.length > 0) {
      return this.commitChanges(ownerId, 'Bulk write complete');
    }
    return { success: true, committedFiles: 0 };
  }

  // Batch mode: temporarily disable auto-commit for bulk operations
  private batchModeEnabled = false;
  private batchModeOwnerId: string | null = null;
  private originalAutoCommit: boolean = true; // Store original state for restore

  /**
   * Enable batch mode - disables auto-commit until flushBatch is called
   * Use this for bulk operations like refinement file writes
   */
  enableBatchMode(ownerId: string): void {
    // Store original state to restore after flush
    this.originalAutoCommit = this.options.autoCommit;
    this.batchModeEnabled = true;
    this.batchModeOwnerId = ownerId;
    this.options.autoCommit = false;
  }

  /**
   * Flush batch mode - commit all pending changes and re-enable auto-commit
   * 
   * IMPORTANT: Only exits batch mode on success. If commit fails, batch mode
   * remains active so callers can retry or handle the error appropriately.
   */
  async flushBatch(): Promise<CommitResult> {
    if (!this.batchModeEnabled || !this.batchModeOwnerId) {
      return { success: true, committedFiles: 0 };
    }

    const result = await this.commitChanges(this.batchModeOwnerId, 'Batch write');

    // Only restore auto-commit state after a successful flush
    // On failure, keep batch mode active so callers can retry or handle the error
    if (result.success) {
      this.options.autoCommit = this.originalAutoCommit;
      this.batchModeEnabled = false;
      this.batchModeOwnerId = null;
    }

    return result;
  }

  /**
   * Check if batch mode is active
   */
  isBatchMode(): boolean {
    return this.batchModeEnabled;
  }

  /**
   * Disable batch mode without committing (for error recovery)
   */
  disableBatchMode(): void {
    if (this.batchModeEnabled) {
      this.options.autoCommit = this.originalAutoCommit;
      this.batchModeEnabled = false;
      this.batchModeOwnerId = null;
    }
  }

  /**
   * Write file with automatic git commit
   * In batch mode, only tracks changes without committing
   */
  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean; append?: boolean }
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

    // Track transaction with the ACTUAL final content (important for append mode)
    // In append mode, VFS combines previous + new content, so we use file.content
    this.trackTransaction(ownerId, {
      path: filePath,
      type: previousContent ? 'UPDATE' : 'CREATE',
      timestamp: Date.now(),
      originalContent: previousContent,
      newContent: file.content, // Use actual stored content, not input parameter
    });

    // Auto-commit if enabled AND NOT in batch mode AND NOT persisting
    // In batch mode or during persist, skip individual commits - will commit all at once via flushBatch()
    if (this.options.autoCommit && !this.batchModeEnabled && !this.isPersisting) {
      await this.commitChanges(ownerId, `Write ${filePath}`);
    }

    return file;
  }

  /**
   * Delete file with automatic git commit
   * In batch mode, only tracks changes without committing
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

    // Auto-commit if enabled AND NOT in batch mode AND NOT persisting
    if (this.options.autoCommit && !this.batchModeEnabled && !this.isPersisting) {
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
   * Deduplicates entries by path — only the latest transaction per path is kept.
   */
  trackTransaction(ownerId: string, entry: TransactionEntry, transactionId?: string): void {
    const key = transactionId || ownerId;
    if (!this.transactionLog.has(key)) {
      this.transactionLog.set(key, []);
    }
    const txList = this.transactionLog.get(key)!;

    // Deduplicate: remove existing entry for same path, keep the latest
    const existingIdx = txList.findIndex(tx => tx.path === entry.path);
    if (existingIdx !== -1) {
      txList.splice(existingIdx, 1);
    }
    txList.push(entry);
  }

  /**
   * Commit buffered changes to shadow commit
   *
   * DESKTOP MODE: Skips building the full VFS snapshot since content is
   * stripped by ShadowCommitManager anyway. Only transaction metadata
   * (paths, types) are persisted as an audit trail.
   */
  async commitChanges(
    ownerId: string,
    message?: string,
    transactionId?: string
  ): Promise<CommitResult> {
    // Get transactions - use transactionId for batch operations, ownerId for single ops
    const key = transactionId || ownerId;
    const transactions = this.transactionLog.get(key) || [];

    // FIX: Only use transactionLog for shadow commits — do NOT include changeBuffer.
    // changeBuffer is populated by handleFileChange() which fires for EVERY VFS event
    // across ALL GitBackedVFS instances, causing duplicate entries when multiple
    // instances exist for the same owner. The transactionLog is the authoritative
    // source since trackTransaction() is called explicitly by writeFile/deleteFile.
    const changesToCommit = transactions;

    if (changesToCommit.length === 0) {
      return { success: true, committedFiles: 0 };
    }

    try {
      // DESKTOP MODE: Skip building full VFS snapshot — content is stripped by
      // ShadowCommitManager anyway. Just pass empty vfs to save memory.
      const desktopMode = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
      const vfs: Record<string, string> = desktopMode
        ? {} // Content not stored in desktop mode — only metadata persisted
        : Object.fromEntries(
            changesToCommit
              .filter(tx => tx.type !== 'DELETE' && tx.newContent)
              .map(tx => [tx.path, tx.newContent])
          );

      // FIX: Get current workspace version from the VFS and pass it to shadow commit
      let workspaceVersion: number | undefined;
      try {
        workspaceVersion = await this.vfs.getWorkspaceVersion(ownerId);
      } catch {
        // Version not available — shadow commit will store null
      }

      // Create shadow commit with all changes
      const result = await this.shadowCommitManager.commit(vfs, changesToCommit, {
        sessionId: this.options.sessionId,
        message: message || this.options.commitMessage,
        author: ownerId,
        source: 'git-vfs',
        integration: 'vfs-auto-commit',
        workspaceVersion,
      });

      // FIX: Clear buffers on SUCCESS to prevent data loss on commit failure
      // AND clear changeBuffer to prevent stale entries from being re-committed
      if (result.success) {
        this.changeBuffer = [];
        if (transactionId) {
          this.transactionLog.delete(transactionId);
        } else {
          this.transactionLog.delete(ownerId);
        }
        logger.info(`[GitVFS] Committed ${result.committedFiles} files: ${message}`);
      } else {
        logger.warn(`[GitVFS] Commit failed, preserving pending changes: ${result.error}`);
      }

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
        // Deduplicate by path - only process the last transaction for each file
        const lastTransactionByPath = new Map<string, TransactionEntry>();
        for (const tx of filteredTransactions) {
          lastTransactionByPath.set(tx.path, tx);
        }
        
        for (const tx of lastTransactionByPath.values()) {
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
      const rollbackResult = await this.shadowCommitManager.rollback(this.options.sessionId, targetCommit.commitId) as any;
      if (!rollbackResult?.success) {
        logger.error(`[GitVFS] Rollback to version ${targetVersion} failed: ${rollbackResult?.error}`);
        return {
          success: false,
          filesRestored: rollbackResult?.restoredFiles ?? 0,
          version: targetVersion,
          error: rollbackResult?.error,
        };
      }
      logger.info(`[GitVFS] Rolled back to version ${targetVersion}`);
      return {
        success: true,
        filesRestored: rollbackResult?.restoredFiles ?? 0,
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

// Export batch mode helpers for use in chat route
export function enableVFSBatchMode(ownerId: string) {
  const { virtualFilesystem } = require('./virtual-filesystem-service');
  virtualFilesystem.enableBatchMode(ownerId);
}

export async function flushVFSBatchMode(ownerId: string) {
  const { virtualFilesystem } = require('./virtual-filesystem-service');
  return await virtualFilesystem.flushBatchMode(ownerId);
}

export function disableVFSBatchMode(ownerId: string) {
  const { virtualFilesystem } = require('./virtual-filesystem-service');
  virtualFilesystem.disableBatchMode(ownerId);
}

/**
 * Factory function to create Git-backed VFS instance
 */
export function createGitBackedVFS(
  vfs: VirtualFilesystemService,
  options?: GitVFSOptions,
  ownerId?: string
): GitBackedVFS {
  return new GitBackedVFS(vfs, options, ownerId);
}

// Singleton instances per owner+session composite key
// Key format: ownerId$sessionId for proper commit tracking
// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading in dev mode
declare global {
  // eslint-disable-next-line no-var
  var __gitVFSInstances__: Map<string, GitBackedVFS> | undefined;
}

const gitVFSInstances = globalThis.__gitVFSInstances__ ?? (globalThis.__gitVFSInstances__ = new Map<string, GitBackedVFS>());

/**
 * Get or create Git-backed VFS for owner
 *
 * CRITICAL FIX: Now properly handles composite ownerId$sessionId format.
 * The sessionId passed to GitVFS must include the full composite format
 * so that ShadowCommit queries work correctly (rollback uses scopedSessionId).
 *
 * @param ownerId - The owner ID (e.g., "1" for authenticated, "anon$timestamp_random" for anonymous)
 * @param vfs - The VFS service instance (should be the singleton)
 * @param options - Optional configuration, including optional sessionId for composite format
 */
export function getGitBackedVFSForOwner(
  ownerId: string,
  vfs: VirtualFilesystemService,
  options?: GitVFSOptions
): GitBackedVFS {
  // Determine the correct sessionId to use:
  // - If options.sessionId is already scoped (contains '$'), use it as-is
  // - Otherwise, create composite key as ownerId$sessionId
  // - If no sessionId provided, use ownerId directly (for backward compatibility)
  const sessionId = options?.sessionId;
  const compositeKey = sessionId && sessionId.includes('$')
    ? sessionId  // Already scoped (e.g., from rollback route)
    : sessionId
      ? `${ownerId}$${sessionId}`  // Needs scoping
      : ownerId;  // No sessionId provided - use ownerId as sessionId

  if (!gitVFSInstances.has(compositeKey)) {
    // Pass the composite sessionId AND ownerId so ShadowCommit uses correct format
    // and handleFileChange only processes events for this owner
    gitVFSInstances.set(compositeKey, createGitBackedVFS(vfs, {
      ...options,
      // Always use compositeKey as sessionId to ensure consistent ShadowCommit queries
      sessionId: compositeKey,
    }, ownerId));
  }
  return gitVFSInstances.get(compositeKey)!;
}
