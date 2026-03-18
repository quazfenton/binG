/**
 * OPFS Git Integration
 * 
 * Enables git operations directly in browser using OPFS as working directory
 * Uses isomorphic-git for pure JavaScript git implementation
 * 
 * Features:
 * - Clone repositories into OPFS
 * - Commit changes with git history in OPFS
 * - Push/pull from remote repositories
 * - Branch management
 * - Diff viewing
 * - Works offline with local commits
 * 
 * @see https://isomorphic-git.org/
 */

import type { OPFSCore } from './opfs-core';
import { opfsCore } from './opfs-core';

// isomorphic-git types
declare module 'isomorphic-git' {
  export interface GitFsClient {
    promises: {
      readFile(filepath: string): Promise<Buffer>;
      writeFile(filepath: string, contents: any): Promise<void>;
      unlink(filepath: string): Promise<void>;
      readdir(filepath: string): Promise<string[]>;
      mkdir(filepath: string): Promise<void>;
      rmdir(filepath: string): Promise<void>;
      stat(filepath: string): Promise<{
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
      }>;
      lstat(filepath: string): Promise<{
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
      }>;
      readlink(filepath: string): Promise<string>;
      symlink(target: string, filepath: string): Promise<void>;
    };
  }
}

export interface GitConfig {
  fs: any;
  dir: string;
  gitdir?: string;
  corsProxy?: string;
}

export interface GitStatusFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked' | 'renamed' | 'copied';
  staged: boolean;
}

export interface GitStatusResult {
  branch: string;
  isClean: boolean;
  files: GitStatusFile[];
  ahead?: number;
  behind?: number;
}

export interface GitCommit {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset?: number;
  };
  committer: {
    name: string;
    email: string;
    timestamp: number;
    timezoneOffset?: number;
  };
  tree: string;
  parent: string[];
}

export interface GitLogEntry {
  oid: string;
  commit: GitCommit;
  payload: string;
}

export interface GitRemoteInfo {
  remote: string;
  url: string;
  fetch?: string;
  push?: string;
}

export interface GitCloneResult {
  success: boolean;
  dir: string;
  defaultBranch: string;
  commits?: number;
  error?: string;
}

export interface GitPushResult {
  success: boolean;
  remote: string;
  branch: string;
  commitsPushed?: number;
  error?: string;
}

export interface GitPullResult {
  success: boolean;
  commitsPulled?: number;
  filesChanged?: number;
  error?: string;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  upstream?: string;
}

export interface GitDiffEntry {
  path: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  oldPath?: string;
  oid?: string;
  oldOid?: string;
}

export interface OPFSGitOptions {
  workspaceId: string;
  gitdir?: string;  // Defaults to '.git'
  authorName?: string;
  authorEmail?: string;
  corsProxy?: string;  // For browser git operations
}

/**
 * Create OPFS-compatible fs client for isomorphic-git
 */
function createOPFSFsClient(core: OPFSCore): any {
  return {
    promises: {
      async readFile(filepath: string): Promise<Buffer> {
        const file = await core.readFile(filepath);
        return Buffer.from(file.content, 'utf8');
      },

      async writeFile(filepath: string, contents: any): Promise<void> {
        const content = typeof contents === 'string' ? contents : contents.toString('utf8');
        await core.writeFile(filepath, content);
      },

      async unlink(filepath: string): Promise<void> {
        await core.deleteFile(filepath);
      },

      async readdir(filepath: string): Promise<string[]> {
        const entries = await core.listDirectory(filepath || '.');
        return entries.map(e => e.name);
      },

      async mkdir(filepath: string): Promise<void> {
        await core.createDirectory(filepath, { recursive: true });
      },

      async rmdir(filepath: string): Promise<void> {
        await core.deleteDirectory(filepath, { recursive: true });
      },

      async stat(filepath: string): Promise<any> {
        try {
          const info = await core.getFileInfo(filepath);
          return {
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
            size: info.size,
            mtimeMs: info.lastModified,
          };
        } catch (error: any) {
          if (error.message?.includes('directory')) {
            return {
              isFile: () => false,
              isDirectory: () => true,
              isSymbolicLink: () => false,
            };
          }
          throw error;
        }
      },

      async lstat(filepath: string): Promise<any> {
        return this.stat(filepath);
      },

      async readlink(filepath: string): Promise<string> {
        throw new Error('Symlinks not supported in OPFS');
      },

      async symlink(target: string, filepath: string): Promise<void> {
        throw new Error('Symlinks not supported in OPFS');
      },
    },
  };
}

/**
 * OPFS Git Integration Class
 * 
 * Provides full git functionality using OPFS as the working directory.
 * All git operations are performed locally in the browser.
 */
export class OPFSGitIntegration {
  private core: OPFSCore;
  private fs: any;
  private options: Required<OPFSGitOptions>;
  private initialized = false;
  private gitdir: string;

  constructor(options: OPFSGitOptions) {
    this.core = opfsCore;
    this.options = {
      workspaceId: options.workspaceId,
      gitdir: options.gitdir || '.git',
      authorName: options.authorName || 'User',
      authorEmail: options.authorEmail || 'user@example.com',
      corsProxy: options.corsProxy || '',
    };
    this.gitdir = this.options.gitdir;
  }

  /**
   * Initialize git integration
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize OPFS
    await this.core.initialize(this.options.workspaceId);

    // Create fs client
    this.fs = createOPFSFsClient(this.core);

    this.initialized = true;
    console.log('[OPFS Git] Initialized for workspace:', this.options.workspaceId);
  }

  /**
   * Ensure git is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Initialize a new git repository in OPFS
   */
  async initRepo(): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    await git.init({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
    });

    console.log('[OPFS Git] Repository initialized');
  }

  /**
   * Clone a repository into OPFS
   * 
   * @param url - Repository URL
   * @param depth - Shallow clone depth (1 for fastest)
   * @param singleBranch - Clone only the default branch
   * @returns Clone result
   */
  async cloneRepo(
    url: string,
    depth: number = 1,
    singleBranch: boolean = true
  ): Promise<GitCloneResult> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      let defaultBranch = 'main';

      await git.clone({
        fs: this.fs,
        http: await this.getHttpClient(),
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        url,
        depth,
        singleBranch,
        corsProxy: this.options.corsProxy || undefined,
        onMessage: (message) => {
          console.log('[OPFS Git] Clone:', message);
        },
        onProgress: (progress) => {
          if (progress.phase === 'Receiving objects:') {
            console.log('[OPFS Git] Clone progress:', progress.loaded, '/', progress.total);
          }
        },
      });

      // Get default branch
      try {
        const symbolicRef = await this.fs.promises.readFile(
          `${this.options.workspaceId}/${this.gitdir}/HEAD`
        );
        const match = symbolicRef.toString().match(/ref: refs\/heads\/(.+)/);
        if (match) {
          defaultBranch = match[1];
        }
      } catch {
        // Keep default
      }

      // Count commits
      let commits = 0;
      try {
        const log = await git.log({
          fs: this.fs,
          dir: this.options.workspaceId,
          gitdir: `${this.options.workspaceId}/${this.gitdir}`,
          depth: 1000,
        });
        commits = log.length;
      } catch {
        // Ignore
      }

      console.log('[OPFS Git] Clone complete:', defaultBranch, commits, 'commits');

      return {
        success: true,
        dir: this.options.workspaceId,
        defaultBranch,
        commits,
      };
    } catch (error: any) {
      console.error('[OPFS Git] Clone failed:', error.message);
      return {
        success: false,
        dir: this.options.workspaceId,
        defaultBranch: 'main',
        error: error.message,
      };
    }
  }

  /**
   * Get git status
   */
  async status(): Promise<GitStatusResult> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      // Get current branch
      let branch = 'HEAD';
      try {
        branch = await git.currentBranch({
          fs: this.fs,
          dir: this.options.workspaceId,
          gitdir: `${this.options.workspaceId}/${this.gitdir}`,
          fullname: false,
        }) || 'HEAD';
      } catch {
        // Detached HEAD or no commits yet
      }

      // Get status matrix
      const matrix = await git.statusMatrix({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      });

      const files: GitStatusFile[] = [];

      for (const [filepath, head, worktree, staged] of matrix) {
        let status: GitStatusFile['status'] = 'modified';
        let stagedStatus = false;

        // Determine status
        if (head === 0 && worktree === 1) {
          status = 'untracked';
        } else if (head === 0 && worktree === 2) {
          status = 'added';
          stagedStatus = true;
        } else if (head === 1 && worktree === 0) {
          status = 'deleted';
          stagedStatus = true;
        } else if (head === 1 && worktree === 2) {
          status = 'modified';
          stagedStatus = true;
        } else if (head === 1 && worktree === 3) {
          status = 'modified';
        } else if (head === 2 && worktree === 3) {
          status = 'deleted';
        } else {
          continue; // No changes
        }

        files.push({
          path: filepath,
          status,
          staged: stagedStatus,
        });
      }

      // Get ahead/behind count
      let ahead = 0;
      let behind = 0;

      try {
        const oid = await git.resolveRef({
          fs: this.fs,
          dir: this.options.workspaceId,
          gitdir: `${this.options.workspaceId}/${this.gitdir}`,
          ref: branch,
        });

        const remoteOid = await git.resolveRef({
          fs: this.fs,
          dir: this.options.workspaceId,
          gitdir: `${this.options.workspaceId}/${this.gitdir}`,
          ref: `refs/remotes/origin/${branch}`,
        }).catch(() => null);

        if (remoteOid) {
          ahead = (await git.log({
            fs: this.fs,
            dir: this.options.workspaceId,
            gitdir: `${this.options.workspaceId}/${this.gitdir}`,
            ref: branch,
            depth: 1000,
          })).length;

          behind = (await git.log({
            fs: this.fs,
            dir: this.options.workspaceId,
            gitdir: `${this.options.workspaceId}/${this.gitdir}`,
            ref: `refs/remotes/origin/${branch}`,
            depth: 1000,
          })).length;
        }
      } catch {
        // Ignore ahead/behind errors
      }

      return {
        branch,
        isClean: files.length === 0,
        files,
        ahead,
        behind,
      };
    } catch (error: any) {
      console.error('[OPFS Git] Status failed:', error.message);
      return {
        branch: 'unknown',
        isClean: true,
        files: [],
      };
    }
  }

  /**
   * Add files to staging
   */
  async add(paths: string | string[]): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');
    const pathList = Array.isArray(paths) ? paths : [paths];

    for (const path of pathList) {
      await git.add({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        filepath: path,
      });
    }

    console.log('[OPFS Git] Added:', pathList);
  }

  /**
   * Remove files from staging/working directory
   */
  async remove(paths: string | string[]): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');
    const pathList = Array.isArray(paths) ? paths : [paths];

    for (const path of pathList) {
      await git.remove({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        filepath: path,
      });
    }

    console.log('[OPFS Git] Removed:', pathList);
  }

  /**
   * Create a commit
   */
  async commit(
    message: string,
    options: {
      authorName?: string;
      authorEmail?: string;
      parent?: string[];
    } = {}
  ): Promise<string> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    const oid = await git.commit({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      message,
      author: {
        name: options.authorName || this.options.authorName,
        email: options.authorEmail || this.options.authorEmail,
      },
      parent: options.parent,
    });

    console.log('[OPFS Git] Committed:', oid, message);

    return oid;
  }

  /**
   * Push to remote repository
   */
  async push(
    remote: string = 'origin',
    branch?: string,
    force: boolean = false
  ): Promise<GitPushResult> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    // Get current branch if not specified
    if (!branch) {
      branch = await git.currentBranch({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        fullname: false,
      }) || 'main';
    }

    try {
      await git.push({
        fs: this.fs,
        http: await this.getHttpClient(),
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        remote,
        ref: branch,
        corsProxy: this.options.corsProxy || undefined,
        force,
        onMessage: (message) => {
          console.log('[OPFS Git] Push:', message);
        },
      });

      console.log('[OPFS Git] Push complete to', remote, branch);

      return {
        success: true,
        remote,
        branch,
      };
    } catch (error: any) {
      console.error('[OPFS Git] Push failed:', error.message);
      return {
        success: false,
        remote,
        branch: branch || 'main',
        error: error.message,
      };
    }
  }

  /**
   * Pull from remote repository
   */
  async pull(
    remote: string = 'origin',
    branch?: string,
    singleBranch: boolean = true
  ): Promise<GitPullResult> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    // Get current branch if not specified
    if (!branch) {
      branch = await git.currentBranch({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        fullname: false,
      }) || 'main';
    }

    try {
      const result = await git.pull({
        fs: this.fs,
        http: await this.getHttpClient(),
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        remote,
        ref: branch,
        singleBranch,
        corsProxy: this.options.corsProxy || undefined,
        onMessage: (message) => {
          console.log('[OPFS Git] Pull:', message);
        },
      });

      console.log('[OPFS Git] Pull complete');

      return {
        success: true,
        commitsPulled: result.oid ? 1 : 0,
      };
    } catch (error: any) {
      console.error('[OPFS Git] Pull failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get commit log
   */
  async log(
    ref: string = 'HEAD',
    depth: number = 10
  ): Promise<GitLogEntry[]> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      const log = await git.log({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        ref,
        depth,
      });

      return log.map(entry => ({
        oid: entry.oid,
        commit: entry.commit,
        payload: entry.payload,
      }));
    } catch (error: any) {
      console.error('[OPFS Git] Log failed:', error.message);
      return [];
    }
  }

  /**
   * Create branch
   */
  async createBranch(branch: string, checkout: boolean = false): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    await git.branch({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      ref: branch,
      checkout,
    });

    console.log('[OPFS Git] Created branch:', branch);
  }

  /**
   * Delete branch
   */
  async deleteBranch(branch: string): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    await git.deleteBranch({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      ref: branch,
    });

    console.log('[OPFS Git] Deleted branch:', branch);
  }

  /**
   * List branches
   */
  async listBranches(remote?: string): Promise<GitBranchInfo[]> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');
    const currentBranch = await git.currentBranch({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      fullname: false,
    }).catch(() => null);

    try {
      const branches = remote
        ? await git.listBranches({
            fs: this.fs,
            dir: this.options.workspaceId,
            gitdir: `${this.options.workspaceId}/${this.gitdir}`,
            remote,
          })
        : await git.listBranches({
            fs: this.fs,
            dir: this.options.workspaceId,
            gitdir: `${this.options.workspaceId}/${this.gitdir}`,
          });

      return branches.map(name => ({
        name,
        current: name === currentBranch,
      }));
    } catch (error: any) {
      console.error('[OPFS Git] List branches failed:', error.message);
      return [];
    }
  }

  /**
   * Get diff between commits or working directory
   */
  async diff(options: {
    ref?: string;
    oldRef?: string;
    path?: string;
  } = {}): Promise<GitDiffEntry[]> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      const diffResult = await git.walk({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        trees: options.ref
          ? [await git.TREE(options.ref), await git.WORKDIR()]
          : [await git.HEAD(), await git.WORKDIR()],
        map: async (filepath, [oldTree, newTree]) => {
          if (options.path && filepath !== options.path) {
            return null;
          }

          const oldOid = oldTree?.oid;
          const newOid = newTree?.oid;

          if (oldOid && !newOid) {
            return { path: filepath, type: 'delete' as const, oldOid };
          } else if (!oldOid && newOid) {
            return { path: filepath, type: 'add' as const, oid: newOid };
          } else if (oldOid !== newOid) {
            return { path: filepath, type: 'modify' as const, oid: newOid, oldOid };
          }

          return null;
        },
      });

      return diffResult.filter(Boolean) as GitDiffEntry[];
    } catch (error: any) {
      console.error('[OPFS Git] Diff failed:', error.message);
      return [];
    }
  }

  /**
   * Get diff as unified diff string
   */
  async diffText(options: {
    ref?: string;
    path?: string;
  } = {}): Promise<string> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      const diffResult = await git.diff({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
        ref: options.ref,
        path: options.path,
      });

      return new TextDecoder().decode(diffResult);
    } catch (error: any) {
      console.error('[OPFS Git] Diff text failed:', error.message);
      return '';
    }
  }

  /**
   * Checkout branch or commit
   */
  async checkout(ref: string): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    await git.checkout({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      ref,
    });

    console.log('[OPFS Git] Checkout:', ref);
  }

  /**
   * Add remote
   */
  async addRemote(name: string, url: string): Promise<void> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    await git.addRemote({
      fs: this.fs,
      dir: this.options.workspaceId,
      gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      remote: name,
      url,
    });

    console.log('[OPFS Git] Added remote:', name, url);
  }

  /**
   * Get remotes
   */
  async listRemotes(): Promise<GitRemoteInfo[]> {
    await this.ensureInitialized();

    const git = await import('isomorphic-git');

    try {
      const remotes = await git.listRemotes({
        fs: this.fs,
        dir: this.options.workspaceId,
        gitdir: `${this.options.workspaceId}/${this.gitdir}`,
      });

      return remotes;
    } catch (error: any) {
      console.error('[OPFS Git] List remotes failed:', error.message);
      return [];
    }
  }

  /**
   * Get HTTP client for isomorphic-git
   */
  private async getHttpClient(): Promise<any> {
    const http = await import('isomorphic-git/http/web');
    return http.default;
  }

  /**
   * Check if repository exists
   */
  async repoExists(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return await this.core.directoryExists(`${this.options.workspaceId}/${this.gitdir}`);
    } catch {
      return false;
    }
  }

  /**
   * Get repository info
   */
  async getRepoInfo(): Promise<{
    exists: boolean;
    branch?: string;
    remotes?: GitRemoteInfo[];
    commitCount?: number;
  }> {
    const exists = await this.repoExists();

    if (!exists) {
      return { exists: false };
    }

    const branch = await this.core
      .readFile(`${this.options.workspaceId}/${this.gitdir}/HEAD`)
      .then(f => {
        const match = f.content.match(/ref: refs\/heads\/(.+)/);
        return match ? match[1] : 'HEAD';
      })
      .catch(() => 'unknown');

    const remotes = await this.listRemotes();

    let commitCount = 0;
    try {
      const log = await this.log('HEAD', 1000);
      commitCount = log.length;
    } catch {
      // Ignore
    }

    return {
      exists: true,
      branch,
      remotes,
      commitCount,
    };
  }
}

// Singleton factory
const gitInstances = new Map<string, OPFSGitIntegration>();

export function getOPFSGit(workspaceId: string, options?: Partial<OPFSGitOptions>): OPFSGitIntegration {
  if (!gitInstances.has(workspaceId)) {
    gitInstances.set(workspaceId, new OPFSGitIntegration({ workspaceId, ...options }));
  }
  return gitInstances.get(workspaceId)!;
}

export const opfsGit = getOPFSGit('default');
