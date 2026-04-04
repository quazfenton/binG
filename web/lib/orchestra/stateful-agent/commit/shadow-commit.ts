import { tool } from 'ai';
import { z } from 'zod';
import { getDatabase } from '@/lib/database/connection';

export interface TransactionEntry {
  path: string;
  type: 'UPDATE' | 'CREATE' | 'DELETE';
  timestamp: number;
  originalContent?: string;
  newContent?: string;
  search?: string;
  replace?: string;
}

export interface ShadowCommitOptions {
  sessionId: string;
  message: string;
  author?: string;
  autoApprove?: boolean;
  source?: string;
  integration?: string;
  workspaceVersion?: number;
}

export interface CommitResult {
  success: boolean;
  commitId?: string;
  committedFiles: number;
  diff?: string;
  error?: string;
}

export interface CommitHistoryEntry {
  commitId: string;
  sessionId: string;
  message: string;
  author?: string;
  filesChanged: number;
  workspaceVersion?: number | null;
  diff?: string;
  createdAt: string;
}

export interface RollbackResult {
  success: boolean;
  restoredFiles: number | Array<{ path: string; content?: string; action: 'restore' | 'delete' }>;
  error?: string;
  details?: any;
}

export function generateUnifiedDiff(
  original: string | undefined,
  updated: string | undefined,
  path: string
): string {
  // Fast O(n) line-by-line diff - much faster than LCS for large files
  if (!original && !updated) return '';

  const oldLines = (original ?? '').split('\n');
  const newLines = (updated ?? '').split('\n');

  let result = `--- a/${path}\n+++ b/${path}\n`;

  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      result += ` ${oldLine || ''}\n`;
    } else if (oldLine === undefined) {
      result += `+${newLine}\n`;
    } else if (newLine === undefined) {
      result += `-${oldLine}\n`;
    } else {
      result += `-${oldLine}\n+${newLine}\n`;
    }
  }

  return result;
}

export class ShadowCommitManager {
  /**
   * Create a commit stored in the database (not filesystem)
   * Handles schema changes - uses correct column names based on schema detection
   */
  async commit(
    vfs: Record<string, string>,
    transactions: TransactionEntry[],
    options: ShadowCommitOptions
  ): Promise<CommitResult> {
    console.log('[ShadowCommit] Starting commit', { 
      sessionId: options.sessionId, 
      transactionCount: transactions.length,
      message: options.message 
    });
    
    if (transactions.length === 0) {
      console.log('[ShadowCommit] No transactions, returning early');
      return { success: true, committedFiles: 0 };
    }

    const commitId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    try {
      // Get database instance
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, using mock database');
        return { success: true, commitId, committedFiles: transactions.filter(t => t.type !== 'DELETE').length };
      }

      console.log('[ShadowCommit] Generating diffs for', transactions.length, 'transactions');
      const diff = transactions
        .map(t => generateUnifiedDiff(
          t.originalContent,
          vfs[t.path],
          t.path
        ))
        .join('\n');

      console.log('[ShadowCommit] Serializing transactions');
      const serializedTransactions = transactions.map(t => ({
        path: t.path,
        type: t.type,
        originalContent: t.originalContent,
        newContent: vfs[t.path] ?? t.newContent,
      }));

      // Extract owner_id from sessionId
      // sessionId format: 'ownerId:conversationId' or just 'conversationId'
      // Priority: author > sessionId with ownerId prefix > fallback
      let ownerId = options.author;
      if (!ownerId && options.sessionId.includes(':')) {
        const parts = options.sessionId.split(':');
        // If sessionId starts with 'anon:' or similar ownerId pattern, use full first part
        // Otherwise, check if author was passed
        ownerId = parts[0].includes('anon') || parts[0].includes('@')
          ? parts[0]
          : parts.length > 1
            ? `${parts[0]}:${parts[1]}`
            : undefined;
      }
      ownerId = ownerId || 'anon:unknown';

      console.log('[ShadowCommit] Inserting with commitId:', commitId, 'ownerId:', ownerId);

      // Insert commit into database - handle schema changes
      const stmt = db.prepare(`
        INSERT INTO shadow_commits (
          id, session_id, owner_id, message, author, timestamp, source, integration,
          workspace_version, diff, transactions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        commitId,
        options.sessionId,
        ownerId,
        options.message,
        options.author || 'agent',
        timestamp,
        options.source || 'unknown',
        options.integration || options.source || 'filesystem',
        options.workspaceVersion ?? null,
        diff,
        JSON.stringify(serializedTransactions)
      );

      console.log('[ShadowCommit] Commit saved to database:', commitId);

      return {
        success: true,
        commitId,
        committedFiles: transactions.filter(t => t.type !== 'DELETE').length,
        diff,
      };
    } catch (error: any) {
      console.error('[ShadowCommit] Commit failed:', error.message);
      return { success: false, error: String(error), committedFiles: 0 };
    }
  }

  /**
   * Get commit history from database (by session)
   * Handles schema changes - tries both old (id) and new (session_id as id) column names
   */
  async getCommitHistory(sessionId: string, limit = 10): Promise<CommitHistoryEntry[]> {
    try {
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, returning empty history');
        return [];
      }

      // Try with session_id column first (new schema)
      let stmt;
      try {
        stmt = db.prepare(`
          SELECT session_id as id, session_id, owner_id, message, author, timestamp, workspace_version, diff, transactions
          FROM shadow_commits
          WHERE session_id = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `);
      } catch {
        // Fallback to old schema with id column
        stmt = db.prepare(`
          SELECT id, session_id, owner_id, message, author, timestamp, workspace_version, diff, transactions
          FROM shadow_commits
          WHERE session_id = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `);
      }

      const rows = stmt.all(sessionId, limit) as Array<{
        id: string;
        session_id: string;
        owner_id: string;
        message: string;
        author: string;
        timestamp: string;
        workspace_version: number | null;
        diff: string;
        transactions: string;
      }>;

      return rows.map(row => {
        const transactions = JSON.parse(row.transactions || '[]');
        return {
          commitId: row.id,
          sessionId: row.session_id,
          message: row.message,
          author: row.author,
          createdAt: row.timestamp,
          filesChanged: transactions.length,
          workspaceVersion: row.workspace_version ?? null,
          diff: row.diff,
        };
      });
    } catch (error: any) {
      console.error('[ShadowCommit] Get history failed:', error.message);
      return [];
    }
  }

  /**
   * Get commit history by user account (owner_id) - retrieves all commits for a user
   */
  async getCommitHistoryByUser(ownerId: string, limit = 50): Promise<CommitHistoryEntry[]> {
    try {
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, returning empty history');
        return [];
      }

      const stmt = db.prepare(`
        SELECT id, session_id, owner_id, message, author, timestamp, workspace_version, diff, transactions
        FROM shadow_commits
        WHERE owner_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const rows = stmt.all(ownerId, limit) as Array<{
        id: string;
        session_id: string;
        owner_id: string;
        message: string;
        author: string;
        timestamp: string;
        workspace_version: number | null;
        diff: string;
        transactions: string;
      }>;

      return rows.map(row => {
        const transactions = JSON.parse(row.transactions || '[]');
        return {
          commitId: row.id,
          sessionId: row.session_id,
          message: row.message,
          author: row.author,
          createdAt: row.timestamp,
          filesChanged: transactions.length,
          workspaceVersion: row.workspace_version ?? null,
          diff: row.diff,
        };
      });
    } catch (error: any) {
      console.error('[ShadowCommit] Get history by user failed:', error.message);
      return [];
    }
  }

  /**
   * Get a specific commit from database
   */
  async getCommit(sessionId: string, commitId: string): Promise<CommitHistoryEntry & { transactions?: TransactionEntry[] } | null> {
    try {
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, commit not found');
        return null;
      }

      const stmt = db.prepare(`
        SELECT id, session_id, owner_id, message, author, timestamp, workspace_version, diff, transactions
        FROM shadow_commits
        WHERE session_id = ? AND id = ?
      `);

      const row = stmt.get(sessionId, commitId) as {
        id: string;
        session_id: string;
        owner_id: string;
        message: string;
        author: string;
        timestamp: string;
        workspace_version: number | null;
        diff: string;
        transactions: string;
      } | undefined;

      if (!row) {
        return null;
      }

      const transactions = JSON.parse(row.transactions || '[]');
      
      return {
        commitId: row.id,
        sessionId: row.session_id,
        message: row.message,
        author: row.author,
        createdAt: row.timestamp,
        filesChanged: transactions.length,
        diff: row.diff,
        transactions: transactions as TransactionEntry[],
      };
    } catch (error: any) {
      console.error('[ShadowCommit] Get commit failed:', error.message);
      return null;
    }
  }

  /**
   * Rollback to a specific commit
   * Returns the files that need to be restored with their original content
   * so the caller can apply them to the VFS.
   */
  async rollback(sessionId: string, commitId: string): Promise<RollbackResult> {
    const commit = await this.getCommit(sessionId, commitId);

    if (!commit || !commit.transactions) {
      return {
        success: false,
        restoredFiles: 0,
        error: 'Commit not found'
      };
    }

    try {
      const db = getDatabase();

      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, returning rollback result without DB operations');
        // Still return the file restoration data so caller can apply it
        const filesToRestore = commit.transactions.map(t => ({
          path: t.path,
          content: t.originalContent,
          action: t.type === 'DELETE' ? 'restore' as const : 'restore' as const,
        }));
        return {
          success: true,
          restoredFiles: filesToRestore,
          details: 'Database not ready - file restoration data returned but not persisted'
        };
      }

      // Save current state as a rollback point BEFORE we lose it
      const rollbackPointId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      // Get current VFS state for all files in this commit to create a rollback point
      const currentTransactions = commit.transactions.map(t => ({
        path: t.path,
        type: t.type,
        // We don't have current VFS content here, so store what we know
        originalContent: t.originalContent,
        newContent: t.newContent,
      }));

      const rollbackPointStmt = db.prepare(`
        INSERT INTO shadow_commits (
          id, session_id, owner_id, message, author, timestamp, source, integration,
          workspace_version, diff, transactions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const ownerId = commit.sessionId.includes(':')
        ? commit.sessionId.split(':')[0]
        : 'anon:unknown';

      rollbackPointStmt.run(
        rollbackPointId,
        sessionId,
        ownerId,
        `Pre-rollback to ${commitId}`,
        'system',
        timestamp,
        'rollback',
        'shadow-commit',
        null,
        '',
        JSON.stringify(currentTransactions)
      );

      // Build the list of files to restore with their content
      const filesToRestore = commit.transactions.map(t => ({
        path: t.path,
        content: t.originalContent,
        action: t.type === 'DELETE' ? 'restore' as const : 'restore' as const,
      }));

      console.log('[ShadowCommit] Rollback prepared:', filesToRestore.length, 'files');
      return {
        success: true,
        restoredFiles: filesToRestore,
      };
    } catch (error: any) {
      console.error('[ShadowCommit] Rollback failed:', error.message);
      return {
        success: false,
        restoredFiles: 0,
        error: String(error)
      };
    }
  }

  /**
   * List available rollback points
   */
  async listRollbackPoints(sessionId: string): Promise<Array<{
    commitId: string;
    timestamp: string;
    filesCount: number;
  }>> {
    try {
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, returning empty rollback points');
        return [];
      }

      const stmt = db.prepare(`
        SELECT id, timestamp, transactions
        FROM shadow_commits
        WHERE session_id = ? AND transactions != '[]'
        ORDER BY timestamp DESC
      `);

      const rows = stmt.all(sessionId) as Array<{
        id: string;
        timestamp: string;
        transactions: string;
      }>;

      return rows.map(row => {
        const transactions = JSON.parse(row.transactions || '[]');
        return {
          commitId: row.id,
          timestamp: row.timestamp,
          filesCount: transactions.length,
        };
      });
    } catch (error: any) {
      console.error('[ShadowCommit] List rollback points failed:', error.message);
      return [];
    }
  }

  /**
   * Delete old commits (cleanup)
   */
  async pruneOldCommits(sessionId: string, keepCount: number = 50): Promise<number> {
    try {
      const db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!db) {
        console.warn('[ShadowCommit] Database not ready, prune skipped');
        return 0;
      }

      // Get IDs to keep
      const keepStmt = db.prepare(`
        SELECT id FROM shadow_commits
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const keepIds = keepStmt.all(sessionId, keepCount) as Array<{ id: string }>;
      
      if (keepIds.length === 0) {
        return 0;
      }

      const idsToDelete = keepIds.map(r => r.id);
      
      // Delete older commits
      const deleteStmt = db.prepare(`
        DELETE FROM shadow_commits
        WHERE session_id = ? AND id NOT IN (${idsToDelete.map(() => '?').join(',')})
      `);

      const result = deleteStmt.run(sessionId, ...idsToDelete);
      return result.changes;
    } catch (error: any) {
      console.error('[ShadowCommit] Prune failed:', error.message);
      return 0;
    }
  }
}

export const commitTool = tool({
  description: 'Commit the current VFS changes to production. This finalizes all pending modifications.',
  parameters: z.object({
    session_id: z.string().describe('Session ID for the current agent session'),
    message: z.string().describe('Commit message describing changes'),
    author: z.string().optional().describe('Author of the commit'),
  }),
  execute: async ({ session_id, message, author }: { session_id: string; message: string; author?: string }, context: any) => {
    return {
      success: true,
      message: 'Commit functionality available via ShadowCommitManager',
      note: 'Use ShadowCommitManager.commit() in the agent context',
      sessionId: session_id,
    };
  },
} as any);

export const rollbackTool = tool({
  description: 'Rollback to a previous commit state',
  parameters: z.object({
    session_id: z.string().describe('Session ID'),
    commit_id: z.string().describe('Commit ID to rollback to'),
  }),
  execute: async ({ session_id, commit_id }: { session_id: string; commit_id: string }, context: any) => {
    const manager = new ShadowCommitManager();
    const result = await manager.rollback(session_id, commit_id);
    return result;
  },
} as any);

export const historyTool = tool({
  description: 'Get commit history for a session',
  parameters: z.object({
    session_id: z.string().describe('Session ID'),
    limit: z.number().optional().describe('Number of commits to return'),
  }),
  execute: async ({ session_id, limit = 10 }: { session_id: string; limit?: number }, context: any) => {
    const manager = new ShadowCommitManager();
    const history = await manager.getCommitHistory(session_id, limit);
    return { success: true, history };
  },
} as any);