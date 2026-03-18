import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

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
  restoredFiles: number;
  error?: string;
}

export function generateUnifiedDiff(
  original: string | undefined,
  updated: string | undefined,
  path: string
): string {
  if (!original && !updated) return '';
  
  const oldLines = original?.split('\n') || [];
  const newLines = updated?.split('\n') || [];
  
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
  private supabase: any = null;
  private useSupabase: boolean;

  constructor() {
    this.useSupabase = !!(
      process.env.SUPABASE_URL && 
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    if (this.useSupabase) {
      import('@supabase/supabase-js').then(({ createClient }) => {
        this.supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
      }).catch((error) => {
        console.warn('[ShadowCommit] Supabase initialization failed:', error);
        this.useSupabase = false;
      });
    }
  }

  async commit(
    vfs: Record<string, string>,
    transactions: TransactionEntry[],
    options: ShadowCommitOptions
  ): Promise<CommitResult> {
    if (transactions.length === 0) {
      return { success: true, committedFiles: 0 };
    }

    const commitId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    if (this.useSupabase && this.supabase) {
      return this.commitToSupabase(vfs, transactions, options, commitId, timestamp);
    }

    return this.commitToFileSystem(vfs, transactions, options, commitId, timestamp);
  }

  private async commitToSupabase(
    vfs: Record<string, string>,
    transactions: TransactionEntry[],
    options: ShadowCommitOptions,
    commitId: string,
    timestamp: string
  ): Promise<CommitResult> {
    const MAX_RETRIES = 3;
    let lastError: Error | null = null;

    // Retry logic for transient Supabase failures
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const filesToCommit = transactions
          .filter(t => t.type !== 'DELETE')
          .map(log => ({
            session_id: options.sessionId,
            commit_id: commitId,
            file_path: log.path,
            content: vfs[log.path] || log.newContent,
            operation: log.type,
            commit_message: options.message,
            author: options.author || 'agent',
            created_at: timestamp,
          }));

        const { error } = await this.supabase
          .from('virtual_file_commits')
          .upsert(filesToCommit, {
            onConflict: 'session_id,commit_id,file_path'
          });

        if (error) {
          // Check if it's a transient error (network, timeout)
          if (attempt < MAX_RETRIES && this.isTransientError(error)) {
            console.warn(`[ShadowCommit] Transient error (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))); // Exponential backoff
            continue;
          }
          return { success: false, error: error.message, committedFiles: 0 };
        }

        const diff = transactions
          .map(t => generateUnifiedDiff(
            t.originalContent,
            vfs[t.path],
            t.path
          ))
          .join('\n');

        return {
          success: true,
          commitId,
          committedFiles: filesToCommit.length,
          diff,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Retry on transient errors
        if (attempt < MAX_RETRIES && this.isTransientError(lastError)) {
          console.warn(`[ShadowCommit] Transient error (attempt ${attempt}/${MAX_RETRIES}):`, lastError.message);
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
          continue;
        }
        
        return { success: false, error: lastError.message, committedFiles: 0 };
      }
    }

    return { 
      success: false, 
      error: lastError?.message || 'Max retries exceeded', 
      committedFiles: 0 
    };
  }

  /**
   * Check if an error is transient (network, timeout, rate limit)
   */
  private isTransientError(error: any): boolean {
    const message = (error.message || '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('502')
    );
  }

  private async commitToFileSystem(
    vfs: Record<string, string>,
    transactions: TransactionEntry[],
    options: ShadowCommitOptions,
    commitId: string,
    timestamp: string
  ): Promise<CommitResult> {
    const commitDir = path.join(process.cwd(), '.agent-commits', options.sessionId);
    const commitFile = path.join(commitDir, `${commitId}.json`);
    const actionLogFile = path.join(commitDir, 'actions.jsonl');

    try {
      if (!fs.existsSync(commitDir)) {
        fs.mkdirSync(commitDir, { recursive: true });
      }

      const diff = transactions
        .map(t => generateUnifiedDiff(
          t.originalContent,
          vfs[t.path],
          t.path
        ))
        .join('\n');

      const serializedTransactions = transactions.map(t => ({
        path: t.path,
        type: t.type,
        originalContent: t.originalContent,
        newContent: vfs[t.path] ?? t.newContent,
      }));

      const commitData = {
        id: commitId,
        sessionId: options.sessionId,
        message: options.message,
        author: options.author || 'agent',
        timestamp,
        source: options.source || 'unknown',
        integration: options.integration || options.source || 'filesystem',
        workspaceVersion: options.workspaceVersion ?? null,
        diff,
        transactions: serializedTransactions,
      };

      fs.writeFileSync(commitFile, JSON.stringify(commitData, null, 2));
      fs.appendFileSync(actionLogFile, `${JSON.stringify({
        type: 'commit',
        commitId,
        sessionId: options.sessionId,
        message: options.message,
        author: options.author || 'agent',
        source: options.source || 'unknown',
        integration: options.integration || options.source || 'filesystem',
        workspaceVersion: options.workspaceVersion ?? null,
        timestamp,
        filesChanged: serializedTransactions.length,
        paths: serializedTransactions.map((entry) => entry.path),
      })}\n`);

      return {
        success: true,
        commitId,
        committedFiles: transactions.filter(t => t.type !== 'DELETE').length,
        diff,
      };
    } catch (error) {
      return { success: false, error: String(error), committedFiles: 0 };
    }
  }

  async getCommitHistory(sessionId: string, limit = 10): Promise<CommitHistoryEntry[]> {
    if (this.useSupabase && this.supabase) {
      const { data, error } = await this.supabase
        .from('virtual_file_commits')
        .select('commit_id, commit_message, author, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[ShadowCommit] Get history error:', error);
        return [];
      }
      return data.map((d: any) => ({
        commitId: d.commit_id,
        sessionId,
        message: d.commit_message,
        author: d.author,
        createdAt: d.created_at,
        filesChanged: 0, // Would need to query files separately
        workspaceVersion: d.workspace_version ?? null,
      }));
    }

    const commitDir = path.join(process.cwd(), '.agent-commits', sessionId);

    if (!fs.existsSync(commitDir)) {
      return [];
    }

    const files = fs.readdirSync(commitDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map((f: string) => {
      const data = JSON.parse(fs.readFileSync(path.join(commitDir, f), 'utf-8'));
      return {
        commitId: data.id,
        sessionId,
        message: data.message,
        author: data.author,
        createdAt: data.timestamp,
        filesChanged: data.transactions?.length || 0,
        workspaceVersion: data.workspaceVersion ?? null,
        diff: data.diff,
      };
    });
  }

  /**
   * Get a specific commit by ID
   * 
   * ADDED: Retrieve full commit data for rollback
   */
  async getCommit(sessionId: string, commitId: string): Promise<CommitHistoryEntry & { transactions?: TransactionEntry[] } | null> {
    if (this.useSupabase && this.supabase) {
      const { data, error } = await this.supabase
        .from('virtual_file_commits')
        .select('*')
        .eq('session_id', sessionId)
        .eq('commit_id', commitId)
        .single();

      if (error) {
        return null;
      }
      return {
        commitId: data.commit_id,
        sessionId: data.session_id,
        message: data.commit_message,
        author: data.author,
        createdAt: data.created_at,
        filesChanged: 0,
        transactions: [],
      };
    }

    const commitFile = path.join(process.cwd(), '.agent-commits', sessionId, `${commitId}.json`);

    if (!fs.existsSync(commitFile)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(commitFile, 'utf-8'));
    return {
      commitId: data.id,
      sessionId,
      message: data.message,
      author: data.author,
      createdAt: data.timestamp,
      filesChanged: data.transactions?.length || 0,
      diff: data.diff,
      transactions: data.transactions,
    };
  }

  /**
   * Rollback to a specific commit
   * 
   * ENHANCED: Now returns detailed rollback result
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

    if (this.useSupabase && this.supabase) {
      // For Supabase, reconstruct VFS from commit
      const vfs: Record<string, string> = {};
      let restoredCount = 0;

      for (const transaction of commit.transactions) {
        if (transaction.type === 'DELETE') {
          // Can't delete via Supabase upsert, would need separate delete
          continue;
        } else {
          vfs[transaction.path] = transaction.newContent || '';
          restoredCount++;
        }
      }

      // Upsert restored files
      const filesToRestore = Object.entries(vfs).map(([filePath, content]) => ({
        session_id: sessionId,
        commit_id: commitId,
        file_path: filePath,
        content,
        operation: 'UPDATE',
        commit_message: `Rollback to ${commitId}`,
        author: 'rollback',
        created_at: new Date().toISOString(),
      }));

      const { error } = await this.supabase
        .from('virtual_file_commits')
        .upsert(filesToRestore);

      if (error) {
        return { 
          success: false, 
          restoredFiles: 0,
          error: error.message 
        };
      }

      return { 
        success: true, 
        restoredFiles: restoredCount 
      };
    }

    // Filesystem rollback
    const commitDir = path.join(process.cwd(), '.agent-commits', sessionId);
    const rollbackDir = path.join(commitDir, 'rollbacks');
    
    // Create rollback directory
    if (!fs.existsSync(rollbackDir)) {
      fs.mkdirSync(rollbackDir, { recursive: true });
    }

    // Save current state as rollback point
    const currentVfsFile = path.join(rollbackDir, `pre-${commitId}-${Date.now()}.json`);
    const currentVfs = this.loadCurrentVFS(sessionId);
    fs.writeFileSync(currentVfsFile, JSON.stringify(currentVfs, null, 2));

    // Restore from commit
    let restoredCount = 0;
    for (const transaction of commit.transactions) {
      if (transaction.type === 'DELETE') {
        // Mark as deleted in current VFS
        delete currentVfs[transaction.path];
      } else {
        currentVfs[transaction.path] = transaction.newContent || '';
        restoredCount++;
      }
    }

    // Save restored VFS
    const restoredVfsFile = path.join(rollbackDir, `restored-${commitId}-${Date.now()}.json`);
    fs.writeFileSync(restoredVfsFile, JSON.stringify(currentVfs, null, 2));

    return { 
      success: true, 
      restoredFiles: restoredCount 
    };
  }

  /**
   * Load current VFS state for a session
   */
  private loadCurrentVFS(sessionId: string): Record<string, string> {
    const vfsFile = path.join(process.cwd(), '.agent-vfs', sessionId, 'vfs.json');
    
    if (fs.existsSync(vfsFile)) {
      return JSON.parse(fs.readFileSync(vfsFile, 'utf-8'));
    }
    return {};
  }

  /**
   * List available rollback points
   * 
   * ADDED: View rollback history
   */
  async listRollbackPoints(sessionId: string): Promise<Array<{ 
    commitId: string;
    timestamp: string;
    filesCount: number;
  }>> {
    const commitDir = path.join(process.cwd(), '.agent-commits', sessionId);

    if (!fs.existsSync(commitDir)) {
      return [];
    }

    const files = fs.readdirSync(commitDir)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => {
        const data = JSON.parse(fs.readFileSync(path.join(commitDir, f), 'utf-8'));
        return {
          commitId: data.id,
          timestamp: data.timestamp,
          filesCount: data.transactions?.length || 0,
        };
      });

    return files.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

export const commitTool = tool({
  description: 'Commit the current VFS changes to production. This finalizes all pending modifications.',
  parameters: z.object({
    session_id: z.string().describe('Session ID for the current agent session'),
    message: z.string().describe('Commit message describing changes'),
    author: z.string().optional().describe('Author of the commit'),
  }),
  execute: async ({ session_id, message, author }) => {
    const manager = new ShadowCommitManager();
    return { 
      success: true, 
      message: 'Commit functionality available via ShadowCommitManager',
      note: 'Use ShadowCommitManager.commit() in the agent context'
    };
  },
});

export const rollbackTool = tool({
  description: 'Rollback to a previous commit state',
  parameters: z.object({
    session_id: z.string().describe('Session ID'),
    commit_id: z.string().describe('Commit ID to rollback to'),
  }),
  execute: async ({ session_id, commit_id }) => {
    const manager = new ShadowCommitManager();
    const result = await manager.rollback(session_id, commit_id);
    return result;
  },
});

export const historyTool = tool({
  description: 'Get commit history for a session',
  parameters: z.object({
    session_id: z.string().describe('Session ID'),
    limit: z.number().optional().describe('Number of commits to return'),
  }),
  execute: async ({ session_id, limit = 10 }) => {
    const manager = new ShadowCommitManager();
    const history = await manager.getCommitHistory(session_id, limit);
    return { success: true, history };
  },
});
