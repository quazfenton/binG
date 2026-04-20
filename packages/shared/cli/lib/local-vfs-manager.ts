// packages/shared/cli/lib/local-vfs-manager.ts
import { SimpleGit, simpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

export class LocalVFSManager {
  private workspacePath: string;
  private historyPath: string;
  private git: SimpleGit;

  constructor(workspacePath: string) {
    this.workspacePath = path.resolve(workspacePath);
    // Unique history path based on workspace path hash to avoid conflicts
    const hash = Buffer.from(this.workspacePath).toString('base64').slice(0, 12);
    this.historyPath = path.join(os.homedir(), '.quaz', 'workspace-history', hash);
    fs.ensureDirSync(this.historyPath);
    
    this.git = simpleGit(this.historyPath);
    this.initRepo();
  }

  private async initRepo() {
    if (!fs.existsSync(path.join(this.historyPath, '.git'))) {
      await this.git.init();
    }
  }

  // Filesystem edit: Write to local FS, then commit to ~/.quaz/ history
  async commitFile(filePath: string, content: string) {
    const targetPath = path.join(this.workspacePath, filePath);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);

    // Sync to hidden git history
    const historyFile = path.join(this.historyPath, filePath);
    await fs.ensureDir(path.dirname(historyFile));
    await fs.writeFile(historyFile, content);
    
    await this.git.add(filePath);
    await this.git.commit(`Update ${filePath}`);
    
    // Squash if > 20 commits
    const log = await this.git.log();
    if (log.total > 20) {
      await this.git.reset(['--soft', 'HEAD~20']);
      await this.git.commit('Squashed history');
    }
  }

  async revertFile(filePath: string) {
    const historyFile = path.join(this.historyPath, filePath);
    const targetPath = path.join(this.workspacePath, filePath);
    
    if (fs.existsSync(historyFile)) {
        const content = await fs.readFile(historyFile, 'utf-8');
        await fs.writeFile(targetPath, content);
        return true;
    }
    return false;
  }
}
