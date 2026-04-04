/**
 * Git Manager for Structured Agent Operations
 * 
 * Provides a high-level API for Git operations within a sandbox environment.
 * - Parsed status results
 * - Branch management
 * - Secure commit/push
 */

import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';

export interface GitFileInfo {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied';
  staged: boolean;
}

export interface GitStatusResult {
  branch: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  files: GitFileInfo[];
}

export class GitManager {
  private handle: SandboxHandle;

  constructor(handle: SandboxHandle) {
    this.handle = handle;
  }

  /**
   * Initialize a new Git repository
   */
  async init(): Promise<void> {
    await this.handle.executeCommand('git init');
  }

  /**
   * Clone a repository
   */
  async clone(url: string, path: string = '.'): Promise<void> {
    const escapedUrl = url.replace(/'/g, "'\\''");
    const escapedPath = path.replace(/'/g, "'\\''");
    await this.handle.executeCommand(`git clone '${escapedUrl}' '${escapedPath}'`);
  }

  /**
   * Get parsed Git status
   */
  async status(): Promise<GitStatusResult> {
    const result = await this.handle.executeCommand('git status --porcelain -b');
    if (!result.success) {
      throw new Error(`Git status failed: ${result.output}`);
    }

    const lines = result.output.split('\n');
    const branchLine = lines[0].replace('## ', '');
    const files: GitFileInfo[] = [];

    // Parse branch info
    let branch = 'unknown';
    let ahead = 0;
    let behind = 0;

    const branchMatch = branchLine.match(/^([^.]+)/);
    if (branchMatch) branch = branchMatch[1];

    const aheadBehindMatch = branchLine.match(/\[ahead (\d+)(?:, behind (\d+))?\]/);
    if (aheadBehindMatch) {
      ahead = parseInt(aheadBehindMatch[1], 10);
      behind = aheadBehindMatch[2] ? parseInt(aheadBehindMatch[2], 10) : 0;
    }

    // Parse file changes
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      
      const statusChar = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      
      let status: GitFileInfo['status'] = 'modified';
      if (statusChar.includes('?')) status = 'untracked';
      else if (statusChar.includes('A')) status = 'added';
      else if (statusChar.includes('D')) status = 'deleted';
      else if (statusChar.includes('R')) status = 'renamed';
      else if (statusChar.includes('C')) status = 'copied';

      files.push({
        path: filePath,
        status,
        staged: statusChar[0] !== ' ' && statusChar[0] !== '?',
      });
    }

    return {
      branch,
      isClean: files.length === 0,
      ahead,
      behind,
      files,
    };
  }

  /**
   * Add files to staging
   */
  async add(path: string = '.'): Promise<void> {
    await this.handle.executeCommand(`git add '${path}'`);
  }

  /**
   * Create a commit
   */
  async commit(message: string): Promise<void> {
    const escapedMessage = message.replace(/'/g, "'\\''");
    await this.handle.executeCommand(`git commit -m '${escapedMessage}'`);
  }

  /**
   * Push to remote
   */
  async push(remote: string = 'origin', branch?: string): Promise<void> {
    const target = branch ? ` '${branch}'` : '';
    await this.handle.executeCommand(`git push '${remote}'${target}`);
  }

  /**
   * Create or switch branch
   */
  async checkout(branch: string, create: boolean = false): Promise<void> {
    const flag = create ? '-b ' : '';
    await this.handle.executeCommand(`git checkout ${flag}'${branch}'`);
  }
}
