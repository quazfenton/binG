// packages/shared/cli/lib/local-history-manager.ts
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export class LocalHistoryProvider {
  private historyDir: string;

  constructor(workspacePath: string) {
    const hash = Buffer.from(path.resolve(workspacePath)).toString('base64').slice(0, 12);
    this.historyDir = path.join(os.homedir(), '.quaz', 'chat-history', hash);
    fs.ensureDirSync(this.historyDir);
  }

  async saveInteraction(interaction: { user: string, assistant: string, timestamp: number }) {
    const filePath = path.join(this.historyDir, `history-${new Date().toISOString().split('T')[0]}.json`);
    let history: any[] = [];
    if (fs.existsSync(filePath)) {
        history = await fs.readJson(filePath);
    }
    history.push(interaction);
    await fs.writeJson(filePath, history, { spaces: 2 });
  }

  async pruneHistory(days: number) {
    const files = await fs.readdir(this.historyDir);
    const now = Date.now();
    for (const file of files) {
        const filePath = path.join(this.historyDir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > days * 24 * 60 * 60 * 1000) {
            await fs.remove(filePath);
        }
    }
  }
}
