import type { VirtualFile } from './filesystem-types';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  timestamp: string;
  version: number;
  changeType: 'create' | 'update' | 'delete';
  hunks?: DiffHunk[];
}

export interface FileDiffHistory {
  path: string;
  diffs: FileDiff[];
  currentVersion: number;
}

export class FilesystemDiffTracker {
  private histories = new Map<string, FileDiffHistory>();
  private previousContents = new Map<string, string>();

  trackChange(file: VirtualFile, previousContent?: string): FileDiff {
    const oldContent = previousContent ?? this.previousContents.get(file.path) ?? '';
    const isCreate = oldContent === '' && !this.previousContents.has(file.path) && previousContent === undefined;
    const changeType: FileDiff['changeType'] = isCreate ? 'create' : 'update';

    const hunks = this.computeHunks(oldContent, file.content);

    const diff: FileDiff = {
      path: file.path,
      oldContent,
      newContent: file.content,
      timestamp: file.lastModified,
      version: file.version,
      changeType,
      hunks: hunks.length > 0 ? hunks : undefined,
    };

    const history = this.histories.get(file.path);
    if (history) {
      history.diffs.push(diff);
      history.currentVersion = file.version;
    } else {
      this.histories.set(file.path, {
        path: file.path,
        diffs: [diff],
        currentVersion: file.version,
      });
    }

    this.previousContents.set(file.path, file.content);

    return diff;
  }

  trackDeletion(path: string, previousContent: string): FileDiff {
    const hunks = this.computeHunks(previousContent, '');
    const history = this.histories.get(path);
    const version = history ? history.currentVersion + 1 : 1;

    const diff: FileDiff = {
      path,
      oldContent: previousContent,
      newContent: '',
      timestamp: new Date().toISOString(),
      version,
      changeType: 'delete',
      hunks: hunks.length > 0 ? hunks : undefined,
    };

    if (history) {
      history.diffs.push(diff);
      history.currentVersion = version;
    } else {
      this.histories.set(path, {
        path,
        diffs: [diff],
        currentVersion: version,
      });
    }

    this.previousContents.delete(path);

    return diff;
  }

  getHistory(path: string): FileDiffHistory | undefined {
    return this.histories.get(path);
  }

  getLatestDiff(path: string): FileDiff | undefined {
    const history = this.histories.get(path);
    if (!history || history.diffs.length === 0) return undefined;
    return history.diffs[history.diffs.length - 1];
  }

  getAllDiffsForContext(maxDiffs = 10): FileDiff[] {
    const latestDiffs: FileDiff[] = [];

    for (const history of this.histories.values()) {
      if (history.diffs.length > 0) {
        latestDiffs.push(history.diffs[history.diffs.length - 1]);
      }
    }

    latestDiffs.sort((a, b) => b.version - a.version);

    return latestDiffs.slice(0, maxDiffs);
  }

  /**
   * Get diff summary for LLM context
   * Returns a human-readable summary of all changes
   */
  getDiffSummary(maxDiffs = 10, ownerId?: string): string {
    const diffs = this.getAllDiffsForContext(maxDiffs);
    
    if (diffs.length === 0) {
      return 'No file changes detected.';
    }

    const summary: string[] = [
      `## File Changes Summary (${diffs.length} files modified)\n`,
    ];

    for (const diff of diffs) {
      const action = diff.changeType === 'create' ? '📄 Created' 
        : diff.changeType === 'delete' ? '🗑️ Deleted' 
        : '✏️ Modified';
      
      summary.push(`### ${action}: ${diff.path}`);
      summary.push(`Version: ${diff.version} | Timestamp: ${diff.timestamp}\n`);

      if (diff.changeType === 'delete') {
        summary.push('**File was deleted**\n');
      } else if (diff.hunks && diff.hunks.length > 0) {
        summary.push('**Changes:**\n```diff');
        for (const hunk of diff.hunks) {
          summary.push(...hunk.lines);
        }
        summary.push('```\n');
      } else if (diff.changeType === 'create') {
        const preview = diff.newContent.slice(0, 200);
        summary.push(`**New file content (preview):**\n\`\`\`\n${preview}${diff.newContent.length > 200 ? '...' : ''}\n\`\`\`\n`);
      }
    }

    return summary.join('\n');
  }

  /**
   * Get files at a specific version
   * Returns a map of file paths to their content at that version
   */
  getFilesAtVersion(targetVersion: number): Map<string, string> {
    const filesAtVersion = new Map<string, string>();

    for (const [path, history] of this.histories.entries()) {
      // Find the diff at or before the target version
      let content: string | null = null;
      
      for (const diff of history.diffs) {
        if (diff.version <= targetVersion) {
          if (diff.changeType === 'delete') {
            content = null; // File was deleted
          } else {
            content = diff.newContent;
          }
        } else {
          break; // Stop at first diff after target version
        }
      }

      if (content !== null) {
        filesAtVersion.set(path, content);
      }
    }

    return filesAtVersion;
  }

  /**
   * Get rollback commands for a specific version
   * Returns array of operations needed to rollback
   */
  getRollbackOperations(targetVersion: number): Array<{
    path: string;
    operation: 'restore' | 'delete';
    content?: string;
    currentVersion: number;
    targetVersion: number;
  }> {
    const operations: Array<{
      path: string;
      operation: 'restore' | 'delete';
      content?: string;
      currentVersion: number;
      targetVersion: number;
    }> = [];

    for (const [path, history] of this.histories.entries()) {
      const currentVersion = history.currentVersion;
      if (currentVersion <= targetVersion) continue; // No rollback needed

      // Find content at target version
      let content: string | null = null;
      
      for (const diff of history.diffs) {
        if (diff.version <= targetVersion) {
          if (diff.changeType === 'delete') {
            content = null;
          } else {
            content = diff.newContent;
          }
        }
      }

      operations.push({
        path,
        operation: content === null ? 'delete' : 'restore',
        content: content || undefined,
        currentVersion,
        targetVersion,
      });
    }

    return operations;
  }

  /**
   * Clear diff history
   */
  clear(): void {
    this.histories.clear();
    this.previousContents.clear();
  }

  private computeHunks(oldContent: string, newContent: string): DiffHunk[] {
    const oldLines = oldContent === '' ? [] : oldContent.split('\n');
    const newLines = newContent === '' ? [] : newContent.split('\n');
    const maxLen = Math.max(oldLines.length, newLines.length);
    const hunks: DiffHunk[] = [];

    let i = 0;
    while (i < maxLen) {
      if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
        i++;
        continue;
      }

      const hunkOldStart = i + 1;
      const hunkNewStart = i + 1;
      const lines: string[] = [];

      const contextBefore = Math.max(0, i - 3);
      for (let c = contextBefore; c < i; c++) {
        if (c < oldLines.length) {
          lines.push(` ${oldLines[c]}`);
        }
      }

      while (i < maxLen) {
        if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
          break;
        }

        if (i < oldLines.length && i < newLines.length) {
          lines.push(`-${oldLines[i]}`);
          lines.push(`+${newLines[i]}`);
        } else if (i < oldLines.length) {
          lines.push(`-${oldLines[i]}`);
        } else {
          lines.push(`+${newLines[i]}`);
        }

        i++;
      }

      const contextAfter = Math.min(maxLen, i + 3);
      for (let c = i; c < contextAfter; c++) {
        if (c < oldLines.length) {
          lines.push(` ${oldLines[c]}`);
        } else if (c < newLines.length) {
          lines.push(` ${newLines[c]}`);
        }
      }

      const removals = lines.filter((l) => l.startsWith('-')).length;
      const additions = lines.filter((l) => l.startsWith('+')).length;

      hunks.push({
        oldStart: Math.max(1, hunkOldStart - (i - hunkOldStart > 0 ? i - contextBefore - hunkOldStart : 0)),
        oldLines: removals,
        newStart: Math.max(1, hunkNewStart - (i - hunkNewStart > 0 ? i - contextBefore - hunkNewStart : 0)),
        newLines: additions,
        lines,
      });
    }

    return hunks;
  }
}

export const diffTracker = new FilesystemDiffTracker();
