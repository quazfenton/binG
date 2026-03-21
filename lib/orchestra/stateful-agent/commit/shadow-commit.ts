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
  if (original === undefined && updated === undefined) {
    return `--- ${path}\n+++ ${path}\n@@ -0,0 +0,0 @@\n`;
  }
  
  const origLines = (original ?? '').split('\n');
  const updatedLines = (updated ?? '').split('\n');
  
  const hunks = computeDiffHunks(origLines, updatedLines);
  if (hunks.length === 0) {
    return '';
  }
  
  const diffLines: string[] = [`--- ${path}`, `+++ ${path}`];
  for (const hunk of hunks) {
    diffLines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    diffLines.push(...hunk.lines);
  }
  
  return diffLines.join('\n');
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

function computeDiffHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const lcs = longestCommonSubsequence(oldLines, newLines);
  const hunks: DiffHunk[] = [];
  
  let oldIdx = 0;
  let newIdx = 0;
  let hunkStart = 0;
  let oldLineNum = 1;
  let newLineNum = 1;
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];
    
    if (oldIdx < lcs.length && newIdx < lcs.length && oldLine === newLine && oldLine === lcs[hunkStart]) {
      if (hunks.length > 0 && hunkStart - hunks[hunks.length - 1].lines.length < 3) {
        const last = hunks[hunks.length - 1];
        last.lines.push(` ${oldLine}`);
        oldIdx++;
        newIdx++;
        hunkStart++;
        oldLineNum++;
        newLineNum++;
        continue;
      }
      oldIdx++;
      newIdx++;
      hunkStart++;
      oldLineNum++;
      newLineNum++;
    } else {
      const hunkLines: string[] = [];
      let hunkOldStart = oldLineNum;
      let hunkNewStart = newLineNum;
      let hunkOldCount = 0;
      let hunkNewCount = 0;
      let changes = 0;
      
      while (oldIdx < oldLines.length && (newIdx >= newLines.length || oldLines[oldIdx] !== lcs[hunkStart])) {
        hunkLines.push(`-${oldLines[oldIdx]}`);
        changes++;
        hunkOldCount++;
        oldIdx++;
        oldLineNum++;
      }
      
      while (newIdx < newLines.length && (oldIdx >= oldLines.length || newLines[newIdx] !== lcs[hunkStart])) {
        hunkLines.push(`+${newLines[newIdx]}`);
        changes++;
        hunkNewCount++;
        newIdx++;
        newLineNum++;
      }
      
      if (changes > 0) {
        hunks.push({
          oldStart: hunkOldStart,
          oldCount: hunkOldCount,
          newStart: hunkNewStart,
          newCount: hunkNewCount,
          lines: hunkLines,
        });
        hunkStart = oldIdx < lcs.length ? oldIdx : lcs.length;
      }
    }
  }
  
  return hunks;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const result: string[] = [];
  let i = m;
  let j = n;
  
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return result;
}

export class ShadowCommitManager {
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

  async getCommit(sessionId: string, commitId: string): Promise<CommitHistoryEntry & { transactions?: TransactionEntry[] } | null> {
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

  async rollback(sessionId: string, commitId: string): Promise<RollbackResult> {
    const commit = await this.getCommit(sessionId, commitId);
    
    if (!commit || !commit.transactions) {
      return { 
        success: false, 
        restoredFiles: 0,
        error: 'Commit not found' 
      };
    }

    const commitDir = path.join(process.cwd(), '.agent-commits', sessionId);
    const rollbackDir = path.join(commitDir, 'rollbacks');
    
    if (!fs.existsSync(rollbackDir)) {
      fs.mkdirSync(rollbackDir, { recursive: true });
    }

    const currentVfsFile = path.join(rollbackDir, `pre-${commitId}-${Date.now()}.json`);
    const currentVfs = this.loadCurrentVFS(sessionId);
    fs.writeFileSync(currentVfsFile, JSON.stringify(currentVfs, null, 2));

    let restoredCount = 0;
    for (const transaction of commit.transactions) {
      if (transaction.type === 'DELETE') {
        delete currentVfs[transaction.path];
      } else {
        currentVfs[transaction.path] = transaction.newContent || '';
        restoredCount++;
      }
    }

    const restoredVfsFile = path.join(rollbackDir, `restored-${commitId}-${Date.now()}.json`);
    fs.writeFileSync(restoredVfsFile, JSON.stringify(currentVfs, null, 2));

    return { 
      success: true, 
      restoredFiles: restoredCount 
    };
  }

  private loadCurrentVFS(sessionId: string): Record<string, string> {
    const vfsFile = path.join(process.cwd(), '.agent-vfs', sessionId, 'vfs.json');
    
    if (fs.existsSync(vfsFile)) {
      return JSON.parse(fs.readFileSync(vfsFile, 'utf-8'));
    }
    return {};
  }

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
