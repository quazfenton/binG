/**
 * Enhanced Diff Viewer with OPFS Local Comparisons
 * 
 * Extends the existing DiffViewer to show:
 * - Server vs Local (OPFS) differences
 * - Unsynced local changes
 * - Multi-version comparisons
 * 
 * Features:
 * - Side-by-side server vs local diff
 * - Unsynced changes indicator
 * - Version comparison
 * - Real-time diff updates
 */

'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useOPFS } from '@/hooks/use-opfs';
import { Plus, Minus, FileDiff, AlertCircle, Cloud, HardDrive, GitBranch } from 'lucide-react';

export interface DiffSection {
  type: 'context' | 'add' | 'remove';
  content: string;
  lineNumber?: number;
}

export interface ParsedDiff {
  hunks: DiffSection[][];
  additions: number;
  deletions: number;
}

export interface EnhancedDiffViewerProps {
  /** Path to the file being compared */
  path: string;
  /** Server version content */
  serverContent: string;
  /** Local (OPFS) version content (optional) */
  localContent?: string;
  /** Git commit content (optional) */
  gitContent?: string;
  /** Maximum lines to display */
  maxLines?: number;
  /** Enable local comparison */
  compareWithLocal?: boolean;
  /** Enable git comparison */
  compareWithGit?: boolean;
  /** Show unsynced changes */
  showUnsynced?: boolean;
  /** On accept local changes */
  onAcceptLocal?: () => void;
  /** On accept server changes */
  onAcceptServer?: () => void;
}

/**
 * Parse unified diff into sections
 */
function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  const hunks: DiffSection[][] = [];
  let currentHunk: DiffSection[] = [];
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }

    if (line.startsWith('@@')) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk);
      }
      currentHunk = [];
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.push({ type: 'add', content: line.slice(1) });
      additions++;
    } else if (line.startsWith('-')) {
      currentHunk.push({ type: 'remove', content: line.slice(1) });
      deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.push({ type: 'context', content: line.slice(1) });
    }
  }

  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  return { hunks, additions, deletions };
}

/**
 * Generate unified diff between two contents
 */
function generateDiff(original: string, updated: string, path: string): string {
  const oldLines = original.split('\n');
  const newLines = updated.split('\n');
  
  let result = `--- a/${path}\n+++ b/${path}\n`;
  
  // Simple diff algorithm (for demonstration)
  // In production, use a proper diff library like 'diff'
  const maxLen = Math.max(oldLines.length, newLines.length);
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    
    if (oldLine === newLine) {
      result += ` ${oldLine || ''}\n`;
    } else {
      if (oldLine !== undefined) {
        result += `-${oldLine}\n`;
      }
      if (newLine !== undefined) {
        result += `+${newLine}\n`;
      }
    }
  }
  
  return result;
}

/**
 * Diff Section Component
 */
function DiffHunk({ hunk, showLineNumbers = true }: { hunk: DiffSection[]; showLineNumbers?: boolean }) {
  return (
    <div className="diff-hunk">
      {hunk.map((section, idx) => (
        <div
          key={idx}
          className={`
            flex px-4 py-0.5 font-mono text-sm
            ${section.type === 'add' ? 'bg-green-50 dark:bg-green-900/20' : ''}
            ${section.type === 'remove' ? 'bg-red-50 dark:bg-red-900/20' : ''}
            ${section.type === 'context' ? 'bg-white dark:bg-gray-900' : ''}
          `}
        >
          {showLineNumbers && (
            <span className="w-12 text-right pr-4 text-gray-400 select-none">
              {section.lineNumber || ''}
            </span>
          )}
          <span className="w-6 select-none">
            {section.type === 'add' && <Plus className="w-4 h-4 text-green-600" />}
            {section.type === 'remove' && <Minus className="w-4 h-4 text-red-600" />}
            {section.type === 'context' && ' '}
          </span>
          <span className="flex-1 whitespace-pre-wrap break-all">
            {section.content}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Enhanced Diff Viewer Component
 */
export function EnhancedDiffViewer({
  path,
  serverContent,
  localContent,
  gitContent,
  maxLines = 500,
  compareWithLocal = true,
  compareWithGit = false,
  showUnsynced = true,
  onAcceptLocal,
  onAcceptServer,
}: EnhancedDiffViewerProps) {
  const [activeTab, setActiveTab] = useState<'server-local' | 'server-git' | 'local-git'>('server-local');
  
  const { 
    readFile: readOPFSFile, 
    isEnabled: isOPFSEnabled,
    syncStatus 
  } = useOPFS('current-user', { autoEnable: true });

  // Parse diffs
  const serverLocalDiff = useMemo(() => {
    if (!localContent || !compareWithLocal) return null;
    const diff = generateDiff(serverContent, localContent, path);
    return parseUnifiedDiff(diff);
  }, [serverContent, localContent, path, compareWithLocal]);

  const serverGitDiff = useMemo(() => {
    if (!gitContent || !compareWithGit) return null;
    const diff = generateDiff(serverContent, gitContent, path);
    return parseUnifiedDiff(diff);
  }, [serverContent, gitContent, path, compareWithGit]);

  const localGitDiff = useMemo(() => {
    if (!localContent || !gitContent || !compareWithGit) return null;
    const diff = generateDiff(localContent, gitContent, path);
    return parseUnifiedDiff(diff);
  }, [localContent, gitContent, path, compareWithGit]);

  // Determine if there are unsynced changes
  const hasUnsyncedChanges = useMemo(() => {
    if (!localContent || !showUnsynced) return false;
    return serverContent !== localContent;
  }, [serverContent, localContent, showUnsynced]);

  // Get active diff
  const activeDiff = useMemo(() => {
    switch (activeTab) {
      case 'server-local':
        return serverLocalDiff;
      case 'server-git':
        return serverGitDiff;
      case 'local-git':
        return localGitDiff;
      default:
        return serverLocalDiff;
    }
  }, [activeTab, serverLocalDiff, serverGitDiff, localGitDiff]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!activeDiff) return { additions: 0, deletions: 0 };
    return {
      additions: activeDiff.additions,
      deletions: activeDiff.deletions,
    };
  }, [activeDiff]);

  // Check if content is truncated
  const isTruncated = useMemo(() => {
    if (!activeDiff) return false;
    const totalLines = activeDiff.hunks.flat().length;
    return totalLines > maxLines;
  }, [activeDiff, maxLines]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileDiff className="w-5 h-5 text-gray-500" />
            <code className="text-sm font-mono text-gray-700 dark:text-gray-300">
              {path}
            </code>
          </div>
          
          {/* Unsynced changes indicator */}
          {hasUnsyncedChanges && isOPFSEnabled && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 rounded text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Unsynced changes</span>
            </div>
          )}
        </div>

        {/* Tab selection */}
        {(compareWithLocal || compareWithGit) && (
          <div className="flex gap-2">
            {compareWithLocal && (
              <button
                onClick={() => setActiveTab('server-local')}
                className={`
                  px-3 py-1.5 text-xs font-medium rounded transition-colors
                  ${activeTab === 'server-local'
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }
                `}
              >
                <Cloud className="w-3.5 h-3.5 inline mr-1.5" />
                Server vs Local
              </button>
            )}
            {compareWithGit && (
              <>
                <button
                  onClick={() => setActiveTab('server-git')}
                  className={`
                    px-3 py-1.5 text-xs font-medium rounded transition-colors
                    ${activeTab === 'server-git'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }
                  `}
                >
                  <Cloud className="w-3.5 h-3.5 inline mr-1.5" />
                  Server vs Git
                </button>
                {localContent && (
                  <button
                    onClick={() => setActiveTab('local-git')}
                    className={`
                      px-3 py-1.5 text-xs font-medium rounded transition-colors
                      ${activeTab === 'local-git'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }
                    `}
                  >
                    <HardDrive className="w-3.5 h-3.5 inline mr-1.5" />
                    Local vs Git
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Stats */}
        {activeDiff && (
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <Plus className="w-3.5 h-3.5" />
              {stats.additions} additions
            </span>
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <Minus className="w-3.5 h-3.5" />
              {stats.deletions} deletions
            </span>
            {isTruncated && (
              <span className="text-gray-500">
                (showing first {maxLines} lines)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Diff content */}
      <div className="max-h-96 overflow-y-auto">
        {activeDiff ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {activeDiff.hunks.slice(0, maxLines).map((hunk, idx) => (
              <DiffHunk key={idx} hunk={hunk} />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            {compareWithLocal && !localContent
              ? 'No local version available'
              : compareWithGit && !gitContent
              ? 'No git version available'
              : 'No changes detected'}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {hasUnsyncedChanges && (onAcceptLocal || onAcceptServer) && (
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-t flex justify-end gap-2">
          {onAcceptServer && (
            <button
              onClick={onAcceptServer}
              className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            >
              Keep Server Version
            </button>
          )}
          {onAcceptLocal && (
            <button
              onClick={onAcceptLocal}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors"
            >
              Keep Local Version
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * OPFS Sync Status Badge Component
 */
export function OPFSSyncStatusBadge({ path }: { path: string }) {
  const { syncStatus, isEnabled } = useOPFS('current-user', { autoEnable: true });
  
  if (!isEnabled) {
    return null;
  }

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2 py-0.5 rounded text-xs
        ${syncStatus.pendingChanges > 0
          ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400'
          : 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
        }
      `}
      title={`${syncStatus.pendingChanges} pending changes`}
    >
      {syncStatus.pendingChanges > 0 ? (
        <AlertCircle className="w-3 h-3" />
      ) : (
        <Cloud className="w-3 h-3" />
      )}
      {syncStatus.pendingChanges > 0 ? 'Pending' : 'Synced'}
    </div>
  );
}

export default EnhancedDiffViewer;
