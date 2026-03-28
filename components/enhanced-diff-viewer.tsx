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
 * - Sleek futuristic design with semitransparent black theme
 */

'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { useOPFS } from '@/hooks/use-opfs';
import { Plus, Minus, FileDiff, AlertCircle, Cloud, HardDrive, GitBranch, ChevronDown } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

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
  /** Server version content (can be diff format or full content) */
  serverContent: string;
  /** Local (OPFS) version content (optional) */
  localContent?: string;
  /** Git commit content (optional) */
  gitContent?: string;
  /** Maximum lines to show initially (expandable) - increased default */
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
  /** Treat serverContent as full file content (not diff) */
  isFullContent?: boolean;
  /** Language for syntax highlighting (auto-detected from path if not provided) */
  language?: string;
  /** Enable drag-to-scroll for better UX */
  enableDragScroll?: boolean;
  /** Initial height in pixels (default: auto-expand) */
  initialHeight?: number;
  /** Maximum height before requiring expand (default: much larger) */
  maxHeight?: number;
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
 * Diff Section Component - Sleek Futuristic Design with Syntax Highlighting
 */
function DiffHunk({ hunk, showLineNumbers = true, language }: { hunk: DiffSection[]; showLineNumbers?: boolean; language?: string }) {
  return (
    <div className="diff-hunk">
      {hunk.map((section, idx) => (
        <div
          key={idx}
          className={`
            flex px-4 py-0.5 font-mono text-sm transition-all duration-200
            ${section.type === 'add'
              ? 'bg-emerald-500/10 border-l-2 border-emerald-500/50 hover:bg-emerald-500/15'
              : ''}
            ${section.type === 'remove'
              ? 'bg-rose-500/10 border-l-2 border-rose-500/50 hover:bg-rose-500/15'
              : ''}
            ${section.type === 'context'
              ? 'bg-transparent hover:bg-white/5 border-l-2 border-transparent'
              : ''}
          `}
        >
          {showLineNumbers && (
            <span className="w-12 text-right pr-4 text-gray-500 dark:text-gray-600 select-none">
              {section.lineNumber || ''}
            </span>
          )}
          <span className="w-6 select-none flex-shrink-0">
            {section.type === 'add' && <Plus className="w-4 h-4 text-emerald-400" />}
            {section.type === 'remove' && <Minus className="w-4 h-4 text-rose-400" />}
            {section.type === 'context' && ' '}
          </span>
          <span className="flex-1 min-w-0">
            {language ? (
              <SyntaxHighlighter
                language={language}
                style={oneDark}
                customStyle={{
                  background: 'transparent',
                  padding: '0',
                  margin: '0',
                  fontSize: '0.875rem',
                }}
                showLineNumbers={false}
                wrapLines={true}
                wrapLongLines={true}
              >
                {section.content}
              </SyntaxHighlighter>
            ) : (
              <span className="whitespace-pre-wrap break-all text-gray-300">
                {section.content}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Check if content looks like a unified diff (has proper diff markers)
 * Requires actual unified-diff structure: ---/+++ headers and optionally @@ hunk markers
 */
function isDiffFormat(content: string): boolean {
  const lines = content.split('\n');
  // Must have at least the --- and +++ headers to be considered a unified diff
  let hasHeader = false;
  let hasDiffContent = false;
  
  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      hasHeader = true;
    }
    if (line.startsWith('@@')) {
      hasDiffContent = true;
    }
    // Count diff content lines (must be more than just headers)
    if (hasHeader && /^[\+\-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---')) {
      hasDiffContent = true;
    }
  }
  
  // Both header and diff content must be present
  return hasHeader && hasDiffContent;
}

/**
 * Enhanced Diff Viewer Component - Sleek Futuristic Design
 * 
 * IMPROVED: Larger default size, drag-to-scroll, better UX
 */
export function EnhancedDiffViewer({
  path,
  serverContent,
  localContent,
  gitContent,
  maxLines = 2000, // Increased from 500 to 2000
  compareWithLocal = true,
  compareWithGit = false,
  showUnsynced = true,
  onAcceptLocal,
  onAcceptServer,
  isFullContent: forceFullContent = false,
  language: explicitLanguage,
  enableDragScroll = true,
  maxHeight = 800, // Increased from 384px (max-h-96) to 800px
}: EnhancedDiffViewerProps) {
  const [activeTab, setActiveTab] = useState<'server-local' | 'server-git' | 'local-git'>('server-local');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [scrollStart, setScrollStart] = useState(0);
  const contentRef = React.useRef<HTMLDivElement>(null);

  const {
    readFile: readOPFSFile,
    isEnabled: isOPFSEnabled,
    syncStatus
  } = useOPFS('current-user', { autoEnable: true });

  // Auto-detect language from file path
  const detectedLanguage = useMemo(() => {
    if (explicitLanguage) return explicitLanguage;
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      fish: 'bash',
      sql: 'sql',
      graphql: 'graphql',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      toml: 'toml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      md: 'markdown',
      mdx: 'mdx',
      vue: 'vue',
      svelte: 'svelte',
      ex: 'elixir',
      exs: 'elixir',
      erl: 'erlang',
      hs: 'haskell',
      clj: 'clojure',
      r: 'r',
      R: 'r',
      ml: 'ocaml',
      lua: 'lua',
      pl: 'perl',
      pm: 'perl',
    };
    return ext ? languageMap[ext] : undefined;
  }, [path, explicitLanguage]);

  // Auto-detect if content is diff format
  const contentIsDiff = useMemo(() => !forceFullContent && isDiffFormat(serverContent), [serverContent, forceFullContent]);

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
    return !isExpanded && totalLines > maxLines;
  }, [activeDiff, maxLines, isExpanded]);

  // Get displayed lines based on expanded state
  const displayedLines = isExpanded ? Infinity : maxLines;

  // Drag-to-scroll handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!enableDragScroll || !contentRef.current) return;
    setIsDragging(true);
    setDragStartY(e.clientY);
    setScrollStart(contentRef.current.scrollTop);
    contentRef.current.style.cursor = 'grabbing';
    e.preventDefault();
  }, [enableDragScroll]);

  const handleDragEnd = useCallback(() => {
    if (!contentRef.current) return;
    setIsDragging(false);
    contentRef.current.style.cursor = 'grab';
  }, []);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !contentRef.current) return;
    const deltaY = dragStartY - e.clientY;
    contentRef.current.scrollTop = scrollStart + deltaY;
  }, [isDragging, dragStartY, scrollStart]);

  // Add global mouse move/up listeners when dragging
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  return (
    <div className="bg-black/40 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-white/5 to-transparent border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
              <FileDiff className="w-4 h-4 text-cyan-400" />
            </div>
            <code className="text-sm font-mono text-gray-200">
              {path}
            </code>
          </div>

          {/* Unsynced changes indicator */}
          {hasUnsyncedChanges && isOPFSEnabled && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full text-xs backdrop-blur-sm">
              <AlertCircle className="w-3.5 h-3.5" />
              <span className="font-medium">Unsynced changes</span>
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
                  px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                  flex items-center gap-1.5
                  ${activeTab === 'server-local'
                    ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 shadow-lg shadow-cyan-500/10'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
                  }
                `}
              >
                <Cloud className="w-3.5 h-3.5" />
                Server vs Local
              </button>
            )}
            {compareWithGit && (
              <>
                <button
                  onClick={() => setActiveTab('server-git')}
                  className={`
                    px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                    flex items-center gap-1.5
                    ${activeTab === 'server-git'
                      ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 shadow-lg shadow-cyan-500/10'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
                    }
                  `}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  Server vs Git
                </button>
                {localContent && (
                  <button
                    onClick={() => setActiveTab('local-git')}
                    className={`
                      px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                      flex items-center gap-1.5
                      ${activeTab === 'local-git'
                        ? 'bg-violet-500/20 border border-violet-500/30 text-violet-300 shadow-lg shadow-violet-500/10'
                        : 'text-gray-400 hover:bg-white/5 hover:text-gray-200 border border-transparent'
                      }
                    `}
                  >
                    <HardDrive className="w-3.5 h-3.5" />
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
            <span className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full">
              <Plus className="w-3.5 h-3.5" />
              <span className="font-medium">{stats.additions}</span> additions
            </span>
            <span className="flex items-center gap-1.5 px-2 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-full">
              <Minus className="w-3.5 h-3.5" />
              <span className="font-medium">{stats.deletions}</span> deletions
            </span>
            {isTruncated && (
              <button
                onClick={() => setIsExpanded(true)}
                className="ml-auto px-2 py-1 bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 hover:text-white rounded-full transition-all duration-200 flex items-center gap-1"
              >
                <span>Show all {activeDiff.hunks.flat().length} lines</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
            {isExpanded && (
              <button
                onClick={() => setIsExpanded(false)}
                className="ml-auto px-2 py-1 bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 hover:text-white rounded-full transition-all duration-200 flex items-center gap-1"
              >
                <span>Collapse</span>
                <ChevronDown className="w-3.5 h-3.5 rotate-180" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Diff content - Removed internal scroll, content flows naturally */}
      <div 
        ref={contentRef}
        className={`
          scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent
          ${enableDragScroll ? 'cursor-grab active:cursor-grabbing' : ''}
        `}
        style={{ 
          maxHeight: isExpanded ? 'none' : `${maxHeight}px`,
          overflowY: 'auto',
        }}
        onMouseDown={enableDragScroll ? handleDragStart : undefined}
      >
        {activeDiff ? (
          <div className="divide-y divide-white/5">
            {activeDiff.hunks.slice(0, displayedLines).map((hunk, idx) => (
              <DiffHunk key={idx} hunk={hunk} language={detectedLanguage} />
            ))}
            {isTruncated && (
              <div className="p-4 text-center sticky bottom-0 bg-black/80 backdrop-blur-sm border-t border-white/10">
                <button
                  onClick={() => setIsExpanded(true)}
                  className="px-6 py-3 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-300 hover:from-cyan-500/30 hover:to-blue-500/30 rounded-lg transition-all duration-200 flex items-center gap-2 mx-auto shadow-lg shadow-cyan-500/10"
                >
                  <ChevronDown className="w-5 h-5" />
                  <span className="font-medium">Show all {activeDiff.hunks.flat().length} lines</span>
                </button>
              </div>
            )}
          </div>
        ) : contentIsDiff ? (
          <div className="p-8 text-center text-gray-500">
            {compareWithLocal && !localContent
              ? 'No local version available'
              : compareWithGit && !gitContent
              ? 'No git version available'
              : 'No changes detected'}
          </div>
        ) : (
          /* Show full content when not in diff format */
          <div className="p-4 text-sm">
            {detectedLanguage ? (
              <SyntaxHighlighter
                language={detectedLanguage}
                style={oneDark}
                customStyle={{
                  background: 'transparent',
                  padding: '0',
                  margin: '0',
                  fontSize: '0.875rem',
                }}
                showLineNumbers={true}
                wrapLines={true}
                wrapLongLines={true}
              >
                {serverContent.slice(0, maxLines * 100)}
              </SyntaxHighlighter>
            ) : (
              <pre className="whitespace-pre-wrap break-all text-gray-300 font-mono">
                {serverContent.slice(0, maxLines * 100)}
              </pre>
            )}
            {serverContent.length > maxLines * 100 && (
              <div className="text-xs text-gray-500 text-center py-2">
                ... {serverContent.length - maxLines * 100} more characters
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drag-to-scroll hint */}
      {enableDragScroll && !isExpanded && activeDiff && (
        <div className="px-4 py-2 bg-gradient-to-r from-transparent via-white/5 to-transparent border-t border-white/10 text-center">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-2">
            <span>💡</span>
            <span>Drag to scroll • Click "Show all" to expand</span>
          </p>
        </div>
      )}

      {/* Action buttons */}
      {hasUnsyncedChanges && (onAcceptLocal || onAcceptServer) && (
        <div className="px-4 py-3 bg-gradient-to-r from-white/5 to-transparent border-t border-white/10 flex justify-end gap-2">
          {onAcceptServer && (
            <button
              onClick={onAcceptServer}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200 border border-white/10"
            >
              Keep Server Version
            </button>
          )}
          {onAcceptLocal && (
            <button
              onClick={onAcceptLocal}
              className="px-4 py-2 text-sm bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 rounded-lg transition-all duration-200 shadow-lg shadow-cyan-500/25 border border-cyan-500/30"
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
 * OPFS Sync Status Badge Component - Sleek Design
 */
export function OPFSSyncStatusBadge({ path }: { path: string }) {
  const { syncStatus, isEnabled } = useOPFS('current-user', { autoEnable: true });

  if (!isEnabled) {
    return null;
  }

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs backdrop-blur-sm transition-all duration-200
        ${syncStatus.pendingChanges > 0
          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
          : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
        }
      `}
      title={`${syncStatus.pendingChanges} pending changes`}
    >
      {syncStatus.pendingChanges > 0 ? (
        <AlertCircle className="w-3 h-3" />
      ) : (
        <Cloud className="w-3 h-3" />
      )}
      <span className="font-medium">{syncStatus.pendingChanges > 0 ? 'Pending' : 'Synced'}</span>
    </div>
  );
}

export default EnhancedDiffViewer;
