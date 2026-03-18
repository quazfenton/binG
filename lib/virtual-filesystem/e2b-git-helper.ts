/**
 * E2B Git Integration Helpers
 * 
 * Provides Git operations for E2B sandboxes.
 * Simplifies cloning, committing, pushing, and branch management.
 * 
 * @see https://e2b.dev/docs/sandbox/git-integration E2B Git Integration
 */

import type { SandboxHandle } from '../sandbox/providers/sandbox-provider';

/**
 * Git clone options
 */
export interface GitCloneOptions {
  /**
   * Repository URL
   */
  url: string;
  
  /**
   * Clone destination path
   */
  path?: string;
  
  /**
   * Git username (for auth)
   */
  username?: string;
  
  /**
   * Git password/token (for auth)
   */
  password?: string;
  
  /**
   * Branch to checkout
   */
  branch?: string;
  
  /**
   * Clone depth (for shallow clones)
   */
  depth?: number;
  
  /**
   * Whether to clone recursively (submodules)
   */
  recursive?: boolean;
}

/**
 * Git commit options
 */
export interface GitCommitOptions {
  /**
   * Commit message
   */
  message: string;
  
  /**
   * Author name
   */
  authorName?: string;
  
  /**
   * Author email
   */
  authorEmail?: string;
  
  /**
   * Files to commit (or all staged)
   */
  files?: string[];
}

/**
 * Git push options
 */
export interface GitPushOptions {
  /**
   * Remote name
   */
  remote?: string;
  
  /**
   * Branch name
   */
  branch?: string;
  
  /**
   * Git username (for auth)
   */
  username?: string;
  
  /**
   * Git password/token (for auth)
   */
  password?: string;
  
  /**
   * Force push
   */
  force?: boolean;
}

/**
 * Git branch info
 */
export interface GitBranchInfo {
  /**
   * Branch name
   */
  name: string;
  
  /**
   * Whether this is the current branch
   */
  isCurrent: boolean;
  
  /**
   * Last commit hash
   */
  lastCommit?: string;
  
  /**
   * Last commit message
   */
  lastCommitMessage?: string;
}

/**
 * Git status info
 */
export interface GitStatusInfo {
  /**
   * Current branch
   */
  branch: string;
  
  /**
   * Staged files
   */
  staged: Array<{
    path: string;
    status: string;
  }>;
  
  /**
   * Unstaged files
   */
  unstaged: Array<{
    path: string;
    status: string;
  }>;
  
  /**
   * Untracked files
   */
  untracked: string[];
}

/**
 * E2B Git Helper
 * 
 * Manages Git operations in sandbox.
 */
export class E2BGitHelper {
  private sandbox: SandboxHandle;

  constructor(sandbox: SandboxHandle) {
    this.sandbox = sandbox;
  }

  /**
   * Clone repository
   * 
   * @param options - Clone options
   * @returns Clone result
   * 
   * @example
   * ```typescript
   * await git.clone({
   *   url: 'https://github.com/org/repo.git',
   *   path: '/home/user/repo',
   *   username: 'x-access-token',
   *   password: process.env.GITHUB_TOKEN,
   *   depth: 1,
   * });
   * ```
   */
  async clone(options: GitCloneOptions): Promise<{
    success: boolean;
    path: string;
    error?: string;
  }> {
    const path = options.path || '/home/user/repo';
    
    try {
      // Build clone command
      let cmd = 'git clone';
      
      if (options.depth) {
        cmd += ` --depth ${options.depth}`;
      }
      
      if (options.branch) {
        cmd += ` --branch ${options.branch}`;
      }
      
      if (options.recursive) {
        cmd += ' --recursive';
      }
      
      // Add auth if provided
      let url = options.url;
      if (options.username && options.password) {
        const authUrl = options.url.replace('https://', `https://${options.username}:${options.password}@`);
        url = authUrl;
      }
      
      cmd += ` ${url} ${path}`;
      
      const result = await this.sandbox.executeCommand(cmd);
      
      if (result.success) {
        return {
          success: true,
          path,
        };
      } else {
        return {
          success: false,
          path,
          error: result.output || 'Clone failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        path,
        error: error.message,
      };
    }
  }

  /**
   * Configure Git user
   * 
   * @param name - User name
   * @param email - User email
   * @returns Whether configuration succeeded
   */
  async configureUser(name: string, email: string): Promise<boolean> {
    try {
      await this.sandbox.executeCommand(`git config --global user.name "${name}"`);
      await this.sandbox.executeCommand(`git config --global user.email "${email}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current status
   * 
   * @param cwd - Working directory
   * @returns Git status
   */
  async getStatus(cwd?: string): Promise<GitStatusInfo> {
    try {
      // Get current branch
      const branchResult = await this.sandbox.executeCommand(
        'git rev-parse --abbrev-ref HEAD',
        cwd
      );
      const branch = branchResult.output?.trim() || 'main';
      
      // Get status
      const statusResult = await this.sandbox.executeCommand(
        'git status --porcelain',
        cwd
      );
      
      const staged: GitStatusInfo['staged'] = [];
      const unstaged: GitStatusInfo['unstaged'] = [];
      const untracked: string[] = [];
      
      const lines = (statusResult.output || '').split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const status = line.slice(0, 2);
        const path = line.slice(3).trim();
        
        if (status[0] !== ' ' && status[0] !== '?') {
          staged.push({ path, status: status[0] });
        }
        if (status[1] !== ' ' && status[1] !== '?') {
          unstaged.push({ path, status: status[1] });
        }
        if (status === '??') {
          untracked.push(path);
        }
      }
      
      return {
        branch,
        staged,
        unstaged,
        untracked,
      };
    } catch (error: any) {
      return {
        branch: 'main',
        staged: [],
        unstaged: [],
        untracked: [],
      };
    }
  }

  /**
   * Stage files
   * 
   * @param files - Files to stage (or '.' for all)
   * @param cwd - Working directory
   * @returns Whether staging succeeded
   */
  async stage(files: string | string[], cwd?: string): Promise<boolean> {
    try {
      const fileArg = Array.isArray(files) ? files.join(' ') : files;
      const result = await this.sandbox.executeCommand(
        `git add ${fileArg}`,
        cwd
      );
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Commit changes
   * 
   * @param options - Commit options
   * @param cwd - Working directory
   * @returns Commit result
   */
  async commit(options: GitCommitOptions, cwd?: string): Promise<{
    success: boolean;
    hash?: string;
    error?: string;
  }> {
    try {
      // Stage files if specified
      if (options.files) {
        await this.stage(options.files, cwd);
      }
      
      // Configure author if specified
      if (options.authorName) {
        await this.sandbox.executeCommand(
          `git config --global user.name "${options.authorName}"`,
          cwd
        );
      }
      if (options.authorEmail) {
        await this.sandbox.executeCommand(
          `git config --global user.email "${options.authorEmail}"`,
          cwd
        );
      }
      
      // Commit
      const result = await this.sandbox.executeCommand(
        `git commit -m "${options.message.replace(/"/g, '\\"')}"`,
        cwd
      );
      
      if (result.success) {
        // Get commit hash
        const hashResult = await this.sandbox.executeCommand(
          'git rev-parse HEAD',
          cwd
        );
        
        return {
          success: true,
          hash: hashResult.output?.trim(),
        };
      } else {
        return {
          success: false,
          error: result.output || 'Commit failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Push changes
   * 
   * @param options - Push options
   * @param cwd - Working directory
   * @returns Push result
   */
  async push(options: GitPushOptions = {}, cwd?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const remote = options.remote || 'origin';
      const branch = options.branch || 'main';
      
      let cmd = `git push ${remote} ${branch}`;
      
      if (options.force) {
        cmd += ' --force';
      }
      
      // Add auth if provided
      if (options.username && options.password) {
        const authUrl = `https://${options.username}:${options.password}@github.com`;
        await this.sandbox.executeCommand(
          `git remote set-url ${remote} ${authUrl}/$(git remote get-url ${remote} | cut -d'/' -f4-)`,
          cwd
        );
      }
      
      const result = await this.sandbox.executeCommand(cmd, cwd);
      
      if (result.success) {
        return {
          success: true,
        };
      } else {
        return {
          success: false,
          error: result.output || 'Push failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create branch
   * 
   * @param name - Branch name
   * @param checkout - Whether to checkout the branch
   * @param cwd - Working directory
   * @returns Whether creation succeeded
   */
  async createBranch(name: string, checkout: boolean = false, cwd?: string): Promise<boolean> {
    try {
      const cmd = checkout ? `git checkout -b ${name}` : `git branch ${name}`;
      const result = await this.sandbox.executeCommand(cmd, cwd);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Checkout branch
   * 
   * @param name - Branch name
   * @param cwd - Working directory
   * @returns Whether checkout succeeded
   */
  async checkout(name: string, cwd?: string): Promise<boolean> {
    try {
      const result = await this.sandbox.executeCommand(`git checkout ${name}`, cwd);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * List branches
   * 
   * @param cwd - Working directory
   * @returns Array of branch info
   */
  async listBranches(cwd?: string): Promise<GitBranchInfo[]> {
    try {
      const result = await this.sandbox.executeCommand(
        'git branch -v',
        cwd
      );
      
      const branches: GitBranchInfo[] = [];
      const lines = (result.output || '').split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const match = line.match(/^[\*\s]?\s*(\S+)\s+([a-f0-9]+)\s+(.*)$/);
        if (match) {
          branches.push({
            name: match[1],
            isCurrent: line.startsWith('*'),
            lastCommit: match[2],
            lastCommitMessage: match[3],
          });
        }
      }
      
      return branches;
    } catch {
      return [];
    }
  }

  /**
   * Get current branch
   * 
   * @param cwd - Working directory
   * @returns Current branch name
   */
  async getCurrentBranch(cwd?: string): Promise<string> {
    try {
      const result = await this.sandbox.executeCommand(
        'git rev-parse --abbrev-ref HEAD',
        cwd
      );
      return result.output?.trim() || 'main';
    } catch {
      return 'main';
    }
  }

  /**
   * Pull changes
   * 
   * @param cwd - Working directory
   * @returns Whether pull succeeded
   */
  async pull(cwd?: string): Promise<boolean> {
    try {
      const result = await this.sandbox.executeCommand('git pull', cwd);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Merge branch
   * 
   * @param branch - Branch to merge
   * @param cwd - Working directory
   * @returns Whether merge succeeded
   */
  async merge(branch: string, cwd?: string): Promise<boolean> {
    try {
      const result = await this.sandbox.executeCommand(`git merge ${branch}`, cwd);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Get commit history
   * 
   * @param limit - Max commits
   * @param cwd - Working directory
   * @returns Array of commit info
   */
  async getHistory(limit: number = 10, cwd?: string): Promise<Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
  }>> {
    try {
      const result = await this.sandbox.executeCommand(
        `git log -${limit} --pretty=format:"%h|%an|%ad|%s" --date=short`,
        cwd
      );
      
      const commits: Array<{
        hash: string;
        author: string;
        date: string;
        message: string;
      }> = [];
      
      const lines = (result.output || '').split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 4) {
          commits.push({
            hash: parts[0],
            author: parts[1],
            date: parts[2],
            message: parts.slice(3).join('|'),
          });
        }
      }
      
      return commits;
    } catch {
      return [];
    }
  }
}

/**
 * Create Git helper for sandbox
 * 
 * @param sandbox - Sandbox handle
 * @returns Git helper
 */
export function createGitHelper(sandbox: SandboxHandle): E2BGitHelper {
  return new E2BGitHelper(sandbox);
}

/**
 * Quick clone helper
 * 
 * @param sandbox - Sandbox handle
 * @param url - Repository URL
 * @param options - Clone options
 * @returns Clone result
 */
export async function quickClone(
  sandbox: SandboxHandle,
  url: string,
  options?: Omit<GitCloneOptions, 'url'>
): Promise<{
  success: boolean;
  path: string;
  error?: string;
}> {
  const git = createGitHelper(sandbox);
  return await git.clone({ url, ...options });
}
