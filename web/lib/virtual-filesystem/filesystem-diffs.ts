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
  ownerId: string;
  oldContent: string;
  newContent: string;
  timestamp: string;
  version: number;
  changeType: 'create' | 'update' | 'delete';
  hunks?: DiffHunk[];
}

export interface FileDiffHistory {
  path: string;
  ownerId: string;
  diffs: FileDiff[];
  currentVersion: number;
}

export class FilesystemDiffTracker {
  private histories = new Map<string, FileDiffHistory>();
  private previousContents = new Map<string, string>();

  private getHistoryKey(ownerId: string, path: string): string {
    return `${ownerId}:${path}`;
  }

  trackChange(file: VirtualFile, ownerIdOrPreviousContent?: string, previousContent?: string): FileDiff {
    // Handle overloaded signature using arguments.length:
    // trackChange(file) - 1 arg - default ownerId, no previous content
    // trackChange(file, previousContent) - 2 args, second is long/code - default ownerId, explicit previous content  
    // trackChange(file, ownerId) - 2 args, second is short - explicit ownerId, no previous content
    // trackChange(file, ownerId, previousContent) - 3 args - explicit ownerId and previous content
    let ownerId: string = 'default';
    let oldContent: string | undefined;
    
    if (arguments.length >= 3) {
      // Three-argument call: trackChange(file, ownerId, previousContent)
      ownerId = ownerIdOrPreviousContent ?? 'default';
      oldContent = previousContent;
    } else if (arguments.length === 2 && ownerIdOrPreviousContent !== undefined) {
      // Two-argument call - need to distinguish between ownerId and previousContent
      // Heuristic: ownerId is typically short (< 50 chars) and doesn't contain code-like characters
      const isOwnerId = ownerIdOrPreviousContent.length < 50 && !/[\n{}();=]/.test(ownerIdOrPreviousContent);
      if (isOwnerId) {
        ownerId = ownerIdOrPreviousContent;
      } else {
        oldContent = ownerIdOrPreviousContent;
      }
    }
    
    // Get stored previous content if no explicit one provided
    if (oldContent === undefined) {
      const key = this.getHistoryKey(ownerId, file.path);
      oldContent = this.previousContents.get(key);
    }
    
    const effectiveOldContent = oldContent ?? '';
    
    // A change is a create only if it truly didn't exist before (no history and no explicit previous content)
    const history = this.histories.get(this.getHistoryKey(ownerId, file.path));
    const isCreate = !history && oldContent === undefined;
    const changeType: FileDiff['changeType'] = isCreate ? 'create' : 'update';

    const hunks = this.computeHunks(effectiveOldContent, file.content || '');

    const diff: FileDiff = {
      path: file.path,
      ownerId,
      oldContent: effectiveOldContent,
      newContent: file.content || '',
      timestamp: file.lastModified || new Date().toISOString(),
      version: file.version,
      changeType,
      hunks: hunks.length > 0 ? hunks : undefined,
    };

    if (history) {
      history.diffs.push(diff);
      history.currentVersion = file.version;
    } else {
      this.histories.set(this.getHistoryKey(ownerId, file.path), {
        path: file.path,
        ownerId,
        diffs: [diff],
        currentVersion: file.version,
      });
    }

    this.previousContents.set(this.getHistoryKey(ownerId, file.path), file.content || '');

    return diff;
  }

  trackDeletion(path: string, previousContent: string = '', ownerId: string = 'default'): FileDiff {
    const key = this.getHistoryKey(ownerId, path);
    const hunks = this.computeHunks(previousContent, '');
    const history = this.histories.get(key);
    const version = history ? history.currentVersion + 1 : 1;

    const diff: FileDiff = {
      path,
      ownerId,
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
      this.histories.set(key, {
        path,
        ownerId,
        diffs: [diff],
        currentVersion: version,
      });
    }

    this.previousContents.delete(key);

    return diff;
  }

  getDiffSummary(ownerId: string = 'default', maxDiffs = 10): { changedFiles: string[]; totalChanges: number; creates: number; updates: number; deletes: number } {
    const latestDiffs: FileDiff[] = [];

    for (const history of this.histories.values()) {
      if (history.ownerId === ownerId && history.diffs.length > 0) {
        latestDiffs.push(history.diffs[history.diffs.length - 1]);
      }
    }

    if (latestDiffs.length === 0) {
      return { changedFiles: [], totalChanges: 0, creates: 0, updates: 0, deletes: 0 };
    }

    latestDiffs.sort((a, b) => b.version - a.version);

    const creates = latestDiffs.filter(d => d.changeType === 'create').length;
    const updates = latestDiffs.filter(d => d.changeType === 'update').length;
    const deletes = latestDiffs.filter(d => d.changeType === 'delete').length;

    return {
      changedFiles: latestDiffs.map(d => d.path),
      totalChanges: latestDiffs.length,
      creates,
      updates,
      deletes,
    };
  }

  getFilesAtVersion(ownerId: string = 'default', targetVersion: number): Map<string, string> {
    const filesAtVersion = new Map<string, string>();

    for (const history of this.histories.values()) {
      if (history.ownerId !== ownerId) continue;

      let content: string | null = null;
      let found = false;

      for (const diff of history.diffs) {
        if (diff.version <= targetVersion) {
          found = true;
          content = diff.changeType === 'delete' ? null : diff.newContent;
        } else {
          break;
        }
      }

      if (found && content !== null) {
        // Prepend workspace root for consistency with virtual filesystem paths
        const fullPath = history.path.startsWith('project/') ? history.path : `project/${history.path}`;
        filesAtVersion.set(fullPath, content);
      }
    }

    return filesAtVersion;
  }

  getRollbackOperations(ownerId: string = 'default', targetVersion: number): Array<{
    path: string;
    operation: 'restore' | 'delete';
    content?: string;
    currentVersion: number;
    targetVersion: number;
  }> {
    const operations: any[] = [];

    for (const history of this.histories.values()) {
      if (history.ownerId !== ownerId) continue;
      if (history.currentVersion <= targetVersion) continue;

      let contentAtTarget: string | null = null;
      let foundAtTarget = false;
      let fileExistedAtTarget = false;

      for (const diff of history.diffs) {
        if (diff.version <= targetVersion) {
          foundAtTarget = true;
          fileExistedAtTarget = true;
          contentAtTarget = diff.changeType === 'delete' ? null : diff.newContent;
        } else {
          break;
        }
      }

      if (!fileExistedAtTarget) {
        // If file didn't exist at target version, it should be deleted to rollback
        operations.push({
          path: history.path,
          operation: 'delete',
          currentVersion: history.currentVersion,
          targetVersion,
        });
      } else {
        operations.push({
          path: history.path,
          operation: contentAtTarget === null ? 'delete' : 'restore',
          content: contentAtTarget !== null ? contentAtTarget : undefined,
          currentVersion: history.currentVersion,
          targetVersion,
        });
      }
    }

    return operations;
  }

  clear(ownerId?: string): void {
    if (ownerId) {
      for (const [key, history] of this.histories.entries()) {
        if (history.ownerId === ownerId) {
          this.histories.delete(key);
          this.previousContents.delete(key);
        }
      }
    } else {
      this.histories.clear();
      this.previousContents.clear();
    }
  }

  /**
   * Get the full history for a specific file path
   */
  getHistory(path: string, ownerId: string = 'default'): FileDiffHistory | undefined {
    const key = this.getHistoryKey(ownerId, path);
    return this.histories.get(key);
  }

  /**
   * Get the latest diff for a specific file path
   */
  getLatestDiff(path: string, ownerId: string = 'default'): FileDiff | undefined {
    const history = this.getHistory(path, ownerId);
    if (!history || history.diffs.length === 0) {
      return undefined;
    }
    return history.diffs[history.diffs.length - 1];
  }

  /**
   * Get all latest diffs for a context (owner), sorted by version descending
   */
  getAllDiffsForContext(maxDiffs?: number, ownerId?: string): FileDiff[] {
    const effectiveOwnerId = ownerId ?? 'default';
    const latestDiffs: FileDiff[] = [];

    for (const history of this.histories.values()) {
      if (history.ownerId === effectiveOwnerId && history.diffs.length > 0) {
        latestDiffs.push(history.diffs[history.diffs.length - 1]);
      }
    }

    // Sort by version descending
    latestDiffs.sort((a, b) => b.version - a.version);

    // Apply max limit if specified
    if (maxDiffs !== undefined && maxDiffs > 0) {
      return latestDiffs.slice(0, maxDiffs);
    }

    return latestDiffs;
  }

  getDiffHistory(ownerId: string = 'default', path?: string): FileDiffHistory | undefined {
    if (path) {
      return this.histories.get(this.getHistoryKey(ownerId, path));
    }
    // Return undefined if no path provided (test expects this behavior)
    return undefined;
  }

  /**
   * Get structured diff output for client sync
   * Returns files with path and unified diff format for efficient transfer
   */
  getChangedFilesForSync(ownerId: string = 'default', maxFiles = 50): Array<{
    path: string;
    diff: string;
    changeType: 'create' | 'update' | 'delete';
  }> {
    const latestDiffs = this.getAllDiffsForContext(maxFiles, ownerId);
    
    return latestDiffs.map(diff => {
      let diffText = '';
      
      if (diff.changeType === 'delete') {
        diffText = `--- a/${diff.path}\n+++ /dev/null`;
        if (diff.hunks && diff.hunks.length > 0) {
          for (const hunk of diff.hunks) {
            diffText += `\n@@ -${hunk.oldStart},${hunk.oldLines} +0,0 @@`;
            for (const line of hunk.lines) diffText += `\n${line}`;
          }
        } else {
          diffText += `\n${diff.oldContent.split('\n').map(l => `-${l}`).join('\n')}`;
        }
      } else {
        diffText = `--- a/${diff.path}\n+++ b/${diff.path}`;
        if (diff.hunks && diff.hunks.length > 0) {
          for (const hunk of diff.hunks) {
            diffText += `\n@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
            for (const line of hunk.lines) diffText += `\n${line}`;
          }
        } else if (diff.changeType === 'create') {
          diffText += `\n${diff.newContent.split('\n').map(l => `+${l}`).join('\n')}`;
        } else if (diff.changeType === 'update' && (!diff.hunks || diff.hunks.length === 0)) {
          // Update with no hunks - show full new content
          diffText += `\n${diff.newContent.split('\n').map(l => `+${l}`).join('\n')}`;
        }
      }
      
      return { path: diff.path, diff: diffText, changeType: diff.changeType };
    });
  }

  private computeHunks(oldContent: string | undefined, newContent: string | undefined): DiffHunk[] {
    const oc = oldContent || '';
    const nc = newContent || '';
    const oldLines = oc === '' ? [] : oc.split('\n');
    const newLines = nc === '' ? [] : nc.split('\n');
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
        if (c < oldLines.length) lines.push(` ${oldLines[c]}`);
      }

      while (i < maxLen) {
        if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) break;
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
        if (c < oldLines.length) lines.push(` ${oldLines[c]}`);
        else if (c < newLines.length) lines.push(` ${newLines[c]}`);
      }

      hunks.push({
        oldStart: hunkOldStart,
        oldLines: lines.filter(l => l.startsWith('-')).length,
        newStart: hunkNewStart,
        newLines: lines.filter(l => l.startsWith('+')).length,
        lines,
      });
    }
    return hunks;
  }
}

// CRITICAL FIX: Use globalThis to survive Next.js hot-reloading
// Without this, all diff/rollback history is lost on hot-reload
declare global {
  // eslint-disable-next-line no-var
  var __diffTracker__: FilesystemDiffTracker | undefined;
}

export const diffTracker = globalThis.__diffTracker__ ?? (globalThis.__diffTracker__ = new FilesystemDiffTracker());
