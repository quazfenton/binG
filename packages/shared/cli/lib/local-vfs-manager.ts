// packages/shared/cli/lib/local-vfs-manager.ts
import { SimpleGit, simpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';

export interface FileVersion {
  hash: string;
  message: string;
  date: string;
  content: string;
}

export interface FileHistoryEntry {
  path: string;
  versions: FileVersion[];
}

export class LocalVFSManager {
  private workspacePath: string;
  private historyPath: string;
  private git: SimpleGit;
  private initialized: Promise<void>;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
    // Unique history path based on workspace path hash to avoid conflicts
    // This is SEPARATE from the user's project git repo — no interference
    const hash = Buffer.from(this.workspacePath).toString('base64').slice(0, 12);
    this.historyPath = path.join(os.homedir(), '.quaz', 'workspace-history', hash);
    fs.ensureDirSync(this.historyPath);

    this.git = simpleGit(this.historyPath);
    // Lazy async init — all public methods await this to ensure repo is ready
    this.initialized = this.initRepo();
  }

  /**
   * Static async factory — preferred when you can await construction.
   */
  static async create(workspacePath: string): Promise<LocalVFSManager> {
    const instance = new LocalVFSManager(workspacePath);
    await instance.initialized;
    return instance;
  }

  private async initRepo() {
    if (!fs.existsSync(path.join(this.historyPath, '.git'))) {
      await this.git.init();
      // Set a local config so commits have an author
      await this.git.addConfig('user.email', 'cli@bing.local');
      await this.git.addConfig('user.name', 'binG CLI');
    }
  }

  /**
   * Ensure the repo is initialized before any operation.
   * Called at the start of every public async method.
   */
  private async ensureInit(): Promise<void> {
    await this.initialized;
  }

  /**
   * Get the history repo path (for external consumers like commit-tui)
   */
  getHistoryPath(): string {
    return this.historyPath;
  }

  /**
   * Write a file to both the user's workspace AND the history repo,
   * then commit in the history repo to create a rollback point.
   */
  async commitFile(filePath: string, content: string): Promise<string | null> {
    await this.ensureInit();
    const targetPath = path.join(this.workspacePath, filePath);

    // Path traversal protection: ensure the resolved path stays within workspace
    const resolvedPath = path.resolve(targetPath);
    const resolvedRoot = path.resolve(this.workspacePath);
    // Use resolved paths to ensure consistent separators on Windows
    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      return null;
    }

    // Write to user's actual workspace
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);

    // Mirror to history repo and commit
    return this.commitToHistory(filePath, content);
  }

  /**
   * Only mirror + commit to history repo (no workspace write).
   * Use when the workspace file already exists and you just want a snapshot.
   */
  async commitToHistory(filePath: string, content: string): Promise<string | null> {
    await this.ensureInit();
    const historyFile = path.join(this.historyPath, filePath);
    await fs.ensureDir(path.dirname(historyFile));
    await fs.writeFile(historyFile, content);

    try {
      await this.git.add(filePath);
      const result = await this.git.commit(`Update ${filePath}`);
      const commitHash: string | null = (result as any).commit?.hash ?? null;

      // Squash if > 50 commits to prevent unbounded growth
      const log = await this.git.log();
      if (log.total > 50) {
        // Soft reset to last 20 commits and squash
        await this.git.reset(['--soft', `HEAD~20`]);
        await this.git.commit('Squashed history');
      }

      return commitHash;
    } catch (err: any) {
      // git commit may fail if nothing changed — that's OK
      return null;
    }
  }

  /**
   * Take a snapshot of the current workspace state into history.
   * Useful for creating a rollback point before batch operations.
   */
  async snapshotWorkspace(message: string = 'Workspace snapshot'): Promise<string | null> {
    await this.ensureInit();
    // Walk the workspace and mirror everything to history
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(this.workspacePath, fullPath);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const historyFile = path.join(this.historyPath, relPath);
            await fs.ensureDir(path.dirname(historyFile));
            await fs.writeFile(historyFile, content);
          } catch {
            // Binary file or permission error — skip
          }
        }
      }
    };

    await walk(this.workspacePath);

    try {
      await this.git.add('-A');
      const result = await this.git.commit(message);
      return (result as any).commit?.hash ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Revert a specific file to its previous version in the history repo,
   * then copy the reverted content back to the user's workspace.
   */
  async revertFile(filePath: string): Promise<boolean> {
    await this.ensureInit();
    try {
      // Get the previous commit for this file
      const log = await this.git.log(['-2', '--', filePath]);
      if (log.all.length < 2) {
        // Only one or zero commits for this file — no previous version
        return false;
      }

      // The second-to-last entry is the previous version
      const prevHash = log.all[1].hash;

      // Get the file content at that commit
      const content = await this.git.show([`${prevHash}:${filePath}`]);

      // Write reverted content to user's workspace
      const targetPath = path.join(this.workspacePath, filePath);

      // Path traversal protection: ensure the resolved path stays within workspace
      const resolvedPath = path.resolve(targetPath);
      if (!resolvedPath.startsWith(this.workspacePath + path.sep) && resolvedPath !== this.workspacePath) {
        return false;
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, content);

      // Also update the history repo to reflect the revert
      const historyFile = path.join(this.historyPath, filePath);
      await fs.ensureDir(path.dirname(historyFile));
      await fs.writeFile(historyFile, content);
      await this.git.add(filePath);
      await this.git.commit(`Revert ${filePath} to ${prevHash.slice(0, 8)}`);

      return true;
    } catch (err: any) {
      return false;
    }
  }

  /**
   * Revert a file to a specific commit hash.
   */
  async rollbackFileToVersion(filePath: string, commitHash: string): Promise<boolean> {
    await this.ensureInit();
    try {
      const content = await this.git.show([`${commitHash}:${filePath}`]);

      // Write to user's workspace
      const targetPath = path.join(this.workspacePath, filePath);

      // Path traversal protection: ensure the resolved path stays within workspace
      const resolvedPath = path.resolve(targetPath);
      if (!resolvedPath.startsWith(this.workspacePath + path.sep) && resolvedPath !== this.workspacePath) {
        return false;
      }

      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, content);

      // Update history repo
      const historyFile = path.join(this.historyPath, filePath);
      await fs.ensureDir(path.dirname(historyFile));
      await fs.writeFile(historyFile, content);
      await this.git.add(filePath);
      await this.git.commit(`Rollback ${filePath} to ${commitHash.slice(0, 8)}`);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the version history for a specific file.
   */
  async getFileHistory(filePath: string, limit: number = 20): Promise<FileVersion[]> {
    await this.ensureInit();
    try {
      const log = await this.git.log(['-n', String(limit), '--', filePath]);

      const versions: FileVersion[] = [];
      for (const entry of log.all) {
        try {
          const content = await this.git.show([`${entry.hash}:${filePath}`]);
          versions.push({
            hash: entry.hash,
            message: entry.message,
            date: entry.date,
            content,
          });
        } catch {
          // File didn't exist at this commit — skip
        }
      }
      return versions;
    } catch {
      return [];
    }
  }

  /**
   * Get the full commit log for the history repo.
   */
  async getCommitLog(limit: number = 20): Promise<Array<{
    hash: string;
    message: string;
    date: string;
    files: string[];
  }>> {
    await this.ensureInit();
    try {
      const log = await this.git.log(['-n', String(limit)]);
      return log.all.map(entry => ({
        hash: entry.hash,
        message: entry.message,
        date: entry.date,
        files: [], // Populated on demand via getFileHistory
      }));
    } catch {
      return [];
    }
  }

  /**
   * Read a file from the user's workspace.
   */
  async readWorkspaceFile(filePath: string): Promise<string | null> {
    const targetPath = path.join(this.workspacePath, filePath);

    // Path traversal protection: ensure the resolved path stays within workspace
    const resolvedPath = path.resolve(targetPath);
    const resolvedRoot = path.resolve(this.workspacePath);
    // Use resolved paths to ensure consistent separators on Windows
    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      return null;
    }

    try {
      return await fs.readFile(targetPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Delete a file from both workspace and history.
   */
  async deleteFile(filePath: string): Promise<boolean> {
    await this.ensureInit();

    // Path traversal protection for workspace path
    const targetPath = path.join(this.workspacePath, filePath);
    const resolvedPath = path.resolve(targetPath);
    if (!resolvedPath.startsWith(this.workspacePath + path.sep) && resolvedPath !== this.workspacePath) {
      return false;
    }

    const historyFile = path.join(this.historyPath, filePath);

    let workspaceDeleted = false;
    let historyDeleted = false;

    try {
      await fs.unlink(targetPath);
      workspaceDeleted = true;
    } catch {
      // File may not exist in workspace
    }

    try {
      await fs.unlink(historyFile);
      historyDeleted = true;
      await this.git.add(filePath);
      await this.git.commit(`Delete ${filePath}`);
    } catch {
      // History file may not exist
    }

    return workspaceDeleted || historyDeleted;
  }

  /**
   * List files in the workspace.
   */
  async listWorkspaceFiles(dirPath: string = ''): Promise<Array<{ path: string; isDirectory: boolean; size: number }>> {
    const targetDir = path.join(this.workspacePath, dirPath);
    const resolvedPath = path.resolve(targetDir);
    
    if (!resolvedPath.startsWith(this.workspacePath + path.sep) && resolvedPath !== this.workspacePath) {
      return [];
    }

    if (!await fs.pathExists(targetDir)) {
      return [];
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const result: Array<{ path: string; isDirectory: boolean; size: number }> = [];
    
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.next') continue;
      const fullPath = path.join(targetDir, entry.name);
      let size = 0;
      if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        size = stats.size;
      }
      result.push({
        path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
        isDirectory: entry.isDirectory(),
        size,
      });
    }
    
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Get the workspace root path.
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }
}
