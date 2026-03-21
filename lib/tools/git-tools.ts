/**
 * Git Tools for AI SDK
 * 
 * Wraps existing GitManager and git-VFS sync for AI agent usage.
 * Provides git operations as callable tools.
 * 
 * Features:
 * - Git status, commit, branch operations
 * - VFS sync with git
 * - Shadow commit integration
 * - Works with sandboxed or local git
 */

import { tool } from 'ai';
import { z } from 'zod';
import { GitManager, type GitStatusResult } from '@/lib/agent/git-manager';
import type { SandboxHandle } from '@/lib/sandbox/providers';
import { getGitVFSSync, type GitVFSStatus } from '@/lib/virtual-filesystem/opfs/git-vfs-sync';
import { ShadowCommitManager, type CommitResult, type CommitHistoryEntry, type TransactionEntry } from '@/lib/orchestra/stateful-agent/commit/shadow-commit';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('GitTools');

/**
 * Create git tools for a sandbox handle
 */
export function createGitTools(handle: SandboxHandle) {
  const gitManager = new GitManager(handle);
  const shadowCommitManager = new ShadowCommitManager();

  return {
    /**
     * Get git status
     */
    git_status: tool({
      description: 'Get git repository status including branch, changes, and untracked files',
      parameters: z.object({
        repoPath: z.string().optional().describe('Path to git repository (default: workspace root)'),
      }),
      execute: async ({ repoPath = '.' }) => {
        try {
          if (repoPath !== '.') {
            await handle.executeCommand(`cd ${repoPath}`);
          }

          const status = await gitManager.status();

          return {
            success: true,
            status: {
              branch: status.branch,
              isClean: status.isClean,
              ahead: status.ahead,
              behind: status.behind,
              files: status.files.map(f => ({
                path: f.path,
                status: f.status,
                staged: f.staged,
              })),
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git status failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Initialize git repository
     */
    git_init: tool({
      description: 'Initialize a new git repository',
      parameters: z.object({
        repoPath: z.string().optional().describe('Path to initialize (default: workspace root)'),
      }),
      execute: async ({ repoPath = '.' }) => {
        try {
          await gitManager.init();
          return {
            success: true,
            message: `Git repository initialized at ${repoPath}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git init failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Clone a repository
     */
    git_clone: tool({
      description: 'Clone a git repository',
      parameters: z.object({
        url: z.string().describe('Repository URL to clone'),
        path: z.string().optional().describe('Destination path (default: current directory)'),
      }),
      execute: async ({ url, path = '.' }) => {
        try {
          await gitManager.clone(url, path);
          return {
            success: true,
            message: `Cloned ${url} to ${path}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git clone failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Add files to staging
     */
    git_add: tool({
      description: 'Add files to git staging area',
      parameters: z.object({
        files: z.array(z.string()).describe('Files or patterns to add (use "." for all)'),
      }),
      execute: async ({ files }) => {
        try {
          for (const file of files) {
            await gitManager.add(file);
          }
          return {
            success: true,
            message: `Added ${files.length} file(s) to staging`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git add failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Create a commit
     */
    git_commit: tool({
      description: 'Create a git commit with staged changes',
      parameters: z.object({
        message: z.string().describe('Commit message'),
        files: z.array(z.string()).optional().describe('Specific files to commit (optional, uses staging if not provided)'),
      }),
      execute: async ({ message, files }) => {
        try {
          // Add specific files if provided
          if (files && files.length > 0) {
            for (const file of files) {
              await gitManager.add(file);
            }
          }

          await gitManager.commit(message);

          // Create shadow commit for audit trail
          // Requires vfs state and transaction log from context
          let shadowResult: CommitResult = {
            success: false,
            committedFiles: 0,
            error: 'Shadow commit requires vfs and transactions context',
          };

          try {
            // Get VFS and transactions from tool context if available
            const shadowCommitManager = new ShadowCommitManager();
            
            // Build VFS state from current files
            const vfsState: Record<string, string> = {};
            const transactions: TransactionEntry[] = [];
            
            // Get staged files
            const status = await gitManager.status();
            const stagedFiles = status.files.filter(f => f.staged).map(f => f.path);
            
            // Read each staged file and add to VFS state
            for (const filePath of stagedFiles) {
              try {
                const result = await handle.readFile(filePath);
                if (result.success && result.content) {
                  vfsState[filePath] = result.content;
                  transactions.push({
                    path: filePath,
                    type: 'UPDATE',
                    timestamp: Date.now(),
                    newContent: result.content,
                  });
                }
              } catch (error: any) {
                log.warn(`Failed to read staged file ${filePath}: ${error.message}`);
              }
            }

            // Create shadow commit with VFS state and transactions
            if (Object.keys(vfsState).length > 0) {
              shadowResult = await shadowCommitManager.commit(vfsState, transactions, {
                sessionId: handle.id,
                message,
                author: 'git-tools',
                source: 'git-commit',
              });
            }
          } catch (shadowError: any) {
            log.warn('Shadow commit failed (continuing without audit trail):', shadowError.message);
          }

          return {
            success: true,
            message: `Committed: ${message}`,
            shadowCommitId: shadowResult.commitId,
            shadowSuccess: shadowResult.success,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git commit failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Create branch
     */
    git_branch: tool({
      description: 'Create or list git branches',
      parameters: z.object({
        action: z.enum(['create', 'list', 'delete']).describe('Action to perform'),
        branchName: z.string().optional().describe('Branch name (required for create/delete)'),
      }),
      execute: async ({ action, branchName }) => {
        try {
          if (action === 'list') {
            const result = await handle.executeCommand('git branch -a');
            return {
              success: true,
              branches: result.output.split('\n').map(b => b.trim()).filter(Boolean),
            };
          }

          if (action === 'create' && branchName) {
            await gitManager.checkout(branchName, true);
            return {
              success: true,
              message: `Created and switched to branch ${branchName}`,
            };
          }

          if (action === 'delete' && branchName) {
            await handle.executeCommand(`git branch -d ${branchName}`);
            return {
              success: true,
              message: `Deleted branch ${branchName}`,
            };
          }

          return {
            success: false,
            error: 'Invalid parameters',
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git branch failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Switch branch
     */
    git_checkout: tool({
      description: 'Switch to a git branch or commit',
      parameters: z.object({
        target: z.string().describe('Branch name or commit hash to checkout'),
      }),
      execute: async ({ target }) => {
        try {
          await gitManager.checkout(target);
          return {
            success: true,
            message: `Switched to ${target}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git checkout failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Push to remote
     */
    git_push: tool({
      description: 'Push commits to remote repository',
      parameters: z.object({
        remote: z.string().optional().describe('Remote name (default: origin)'),
        branch: z.string().optional().describe('Branch to push (default: current branch)'),
      }),
      execute: async ({ remote = 'origin', branch }) => {
        try {
          await gitManager.push(remote, branch);
          return {
            success: true,
            message: `Pushed to ${remote}${branch ? `/${branch}` : ''}`,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git push failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Get commit history
     */
    git_log: tool({
      description: 'Get git commit history',
      parameters: z.object({
        limit: z.number().optional().describe('Number of commits to retrieve (default: 10)'),
        branch: z.string().optional().describe('Branch to get history from (default: current)'),
      }),
      execute: async ({ limit = 10, branch }) => {
        try {
          const result = await handle.executeCommand(
            `git log -n ${limit} --pretty=format:"%H|%an|%ae|%ad|%s" ${branch || ''}`
          );

          const commits = result.output.split('\n').filter(Boolean).map(line => {
            const [hash, author, email, date, message] = line.split('|');
            return { hash, author, email, date, message };
          });

          return {
            success: true,
            commits,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git log failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Get diff
     */
    git_diff: tool({
      description: 'Get git diff between commits, branches, or working directory',
      parameters: z.object({
        target: z.string().optional().describe('Target to compare with (default: HEAD)'),
        files: z.array(z.string()).optional().describe('Specific files to diff'),
      }),
      execute: async ({ target = 'HEAD', files }) => {
        try {
          const fileArgs = files?.join(' ') || '';
          const result = await handle.executeCommand(`git diff ${target} ${fileArgs}`);

          return {
            success: true,
            diff: result.output,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git diff failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Sync VFS to git commit
     */
    git_vfs_sync: tool({
      description: 'Synchronize virtual filesystem to git as a commit',
      parameters: z.object({
        workspaceId: z.string().describe('Workspace ID to sync'),
        ownerId: z.string().describe('Owner ID of the workspace'),
        message: z.string().describe('Commit message'),
      }),
      execute: async ({ workspaceId, ownerId, message }) => {
        try {
          const gitVFS = getGitVFSSync(workspaceId, ownerId, {
            commitMessage: message,
            autoCommit: true,
          });

          await gitVFS.initialize();
          const result = await gitVFS.syncToGit();

          return {
            success: result.success,
            commitId: result.commitId,
            filesCommitted: result.filesCommitted,
            error: result.error,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git-VFS sync failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Restore VFS from git
     */
    git_vfs_restore: tool({
      description: 'Restore virtual filesystem from git commit or branch',
      parameters: z.object({
        workspaceId: z.string().describe('Workspace ID to restore'),
        ownerId: z.string().describe('Owner ID of the workspace'),
        target: z.string().describe('Commit hash or branch to restore from'),
      }),
      execute: async ({ workspaceId, ownerId, target }) => {
        try {
          const gitVFS = getGitVFSSync(workspaceId, ownerId);
          await gitVFS.initialize();

          // Check if target is a commit or branch
          const isCommit = /^[0-9a-f]{7,40}$/.test(target);
          const result = isCommit
            ? await gitVFS.restoreFromCommit(target)
            : await gitVFS.restoreFromBranch(target);

          return {
            success: result.success,
            filesRestored: result.filesRestored,
            error: result.error,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git-VFS restore failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Get git-VFS status
     */
    git_vfs_status: tool({
      description: 'Get combined git and VFS synchronization status',
      parameters: z.object({
        workspaceId: z.string().describe('Workspace ID'),
        ownerId: z.string().describe('Owner ID'),
      }),
      execute: async ({ workspaceId, ownerId }) => {
        try {
          const gitVFS = getGitVFSSync(workspaceId, ownerId);
          await gitVFS.initialize();
          const status = await gitVFS.getStatus();

          return {
            success: true,
            status: {
              branch: status.gitStatus.branch,
              isClean: status.gitStatus.isClean,
              isSynced: status.isSynced,
              vfsVersion: status.vfsVersion,
              pendingChanges: status.pendingChanges,
              files: status.gitStatus.files,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Git-VFS status failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Get shadow commit history
     */
    git_shadow_history: tool({
      description: 'Get shadow commit history for audit trail',
      parameters: z.object({
        sessionId: z.string().optional().describe('Filter by session ID'),
        limit: z.number().optional().describe('Number of commits to retrieve (default: 20)'),
      }),
      execute: async ({ sessionId, limit = 20 }) => {
        try {
          const history = await shadowCommitManager.getCommitHistory(sessionId, limit);

          return {
            success: true,
            commits: history.map((c: CommitHistoryEntry) => ({
              commitId: c.commitId,
              sessionId: c.sessionId,
              message: c.message,
              author: c.author,
              filesChanged: c.filesChanged,
              createdAt: c.createdAt,
            })),
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Shadow commit history failed: ${error.message}`,
          };
        }
      },
    } as any),

    /**
     * Rollback to shadow commit
     */
    git_shadow_rollback: tool({
      description: 'Rollback workspace to a shadow commit',
      parameters: z.object({
        sessionId: z.string().regex(/^[A-Za-z0-9:_-]+$/).describe('Session ID for tracking'),
        commitId: z.string().regex(/^[A-Za-z0-9-]+$/).describe('Shadow commit ID to rollback to'),
      }),
      execute: async ({ sessionId, commitId }) => {
        try {
          // Rollback requires sessionId and commitId
          const result = await shadowCommitManager.rollback(sessionId, commitId);

          return {
            success: result.success,
            filesRestored: result.restoredFiles,
            error: result.error,
          };
        } catch (error: any) {
          return {
            success: false,
            error: `Shadow rollback failed: ${error.message}`,
          };
        }
      },
    } as any),
  };
}

/**
 * Standalone git tools (for use without sandbox handle)
 * Uses shadow commit manager only
 */
export const standaloneGitTools = {
  git_shadow_commit: tool({
    description: 'Create a shadow commit for audit trail (no git repo required)',
    parameters: z.object({
      sessionId: z.string().describe('Session ID for tracking'),
      message: z.string().describe('Commit message'),
      files: z.array(z.object({
        path: z.string(),
        content: z.string(),
        originalContent: z.string().optional(),
      })).describe('Files to commit'),
      author: z.string().optional().describe('Author name'),
    }),
      execute: async ({ sessionId, message, files, author }) => {
        try {
          const shadowCommitManager = new ShadowCommitManager();
          
          // Track files in vfs
          const transactions = files.map(f => ({
            path: f.path,
            type: 'CREATE' as const,
            timestamp: Date.now(),
            newContent: f.content,
            originalContent: f.originalContent,
          }));
          
          // Create shadow commit with tracked files
          const vfsState: Record<string, string> = {};
          for (const tx of transactions) {
            if (tx.newContent !== undefined) {
              vfsState[tx.path] = tx.newContent;
            }
          }
          
          const result = await shadowCommitManager.commit(vfsState, transactions, {
            sessionId,
            message,
            author: author || 'standalone',
            source: 'standalone-git-tools',
          });

          return {
            success: result.success,
            commitId: result.commitId,
            committedFiles: result.committedFiles,
          error: result.error,
        };
      } catch (error: any) {
        return {
          success: false,
          error: `Shadow commit failed: ${error.message}`,
        };
      }
    },
  } as any),
};

/**
 * Export all git tools for combined usage
 */
export type GitTools = ReturnType<typeof createGitTools>;
export type StandaloneGitTools = typeof standaloneGitTools;

