// packages/shared/cli/lib/local-history-manager.ts
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB per file
const MAX_ENTRIES_PER_FILE = 1000; // Safety limit

export class LocalHistoryProvider {
  private historyDir: string;

  constructor(workspacePath: string) {
    const hash = Buffer.from(path.resolve(workspacePath)).toString('base64').slice(0, 12);
    this.historyDir = path.join(os.homedir(), '.quaz', 'chat-history', hash);
    fs.ensureDirSync(this.historyDir);
  }

  private getHistoryFilePath(): string {
    return path.join(this.historyDir, `history-${new Date().toISOString().split('T')[0]}.json`);
  }

  async saveInteraction(interaction: { user: string, assistant: string, timestamp: number }) {
    let filePath = this.getHistoryFilePath();
    let history: any[] = [];
    
    // Check if current file needs rotation
    if (fs.existsSync(filePath)) {
      const stats = await fs.stat(filePath);
      
      // Rotate if file is too large or has too many entries
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        // Archive current file with timestamp
        const archivePath = path.join(
          this.historyDir, 
          `history-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`
        );
        await fs.move(filePath, archivePath);
        console.log(`[History] Rotated large file to ${archivePath}`);
      } else {
        // Check entry count
        try {
          const content = await fs.readJson(filePath);
          if (Array.isArray(content) && content.length >= MAX_ENTRIES_PER_FILE) {
            // Archive current file
            const archivePath = path.join(
              this.historyDir, 
              `history-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`
            );
            await fs.move(filePath, archivePath);
            console.log(`[History] Rotated full file to ${archivePath}`);
          } else {
            history = content;
          }
        } catch {
          // File corrupted or invalid JSON — start fresh
          history = [];
        }
      }
    }
    
    history.push(interaction);
    await fs.writeJson(filePath, history, { spaces: 2 });
  }

  async pruneHistory(days: number) {
    const files = await fs.readdir(this.historyDir);
    const now = Date.now();
    const cutoffTime = now - (days * 24 * 60 * 60 * 1000);
    
    for (const file of files) {
      // Only prune history files, not archive files
      if (!file.startsWith('history-')) continue;
      
      const filePath = path.join(this.historyDir, file);
      const stats = await fs.stat(filePath);
      
      // Prune files older than cutoff
      if (stats.mtimeMs < cutoffTime) {
        await fs.remove(filePath);
        console.log(`[History] Pruned ${file}`);
      }
    }
  }

  async getHistory(day?: string): Promise<any[]> {
    const date = day || new Date().toISOString().split('T')[0];
    const files = (await fs.readdir(this.historyDir))
      .filter((file) => file.startsWith(`history-${date}`) && file.endsWith('.json'))
      .sort();
    
    if (files.length === 0) {
      return [];
    }
    
    try {
      const histories = await Promise.all(
        files.map(async (file) => {
          const content = await fs.readJson(path.join(this.historyDir, file));
          return Array.isArray(content) ? content : [];
        })
      );
      return histories.flat();
    } catch {
      return [];
    }
  }
}