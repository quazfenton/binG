/**
 * Git Diff Viewer Component
 * 
 * Shows unified/side-by-side diff for file changes.
 */

'use client';

import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Minus, FileDiff } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface GitDiffViewerProps {
  diffs: FileDiff[];
  onViewed?: (path: string, viewed: boolean) => void;
  onApply?: (path: string) => void;
}

export default function GitDiffViewer({ diffs, onViewed, onApply }: GitDiffViewerProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(diffs.map(d => d.path)));
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());

  const toggleExpanded = (path: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFiles(newExpanded);
  };

  const toggleViewed = (path: string) => {
    const newViewed = new Set(viewedFiles);
    if (newViewed.has(path)) {
      newViewed.delete(path);
    } else {
      newViewed.add(path);
    }
    setViewedFiles(newViewed);
    onViewed?.(path, !viewedFiles.has(path));
  };

  if (diffs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <FileDiff className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">No changes to display</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-800">
      {diffs.map((diff) => (
        <div key={diff.path} className={`bg-black/20 ${viewedFiles.has(diff.path) ? 'opacity-50' : ''}`}>
          {/* File Header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/50 border-b border-gray-800">
            <button
              onClick={() => toggleExpanded(diff.path)}
              className="p-1 hover:bg-gray-800 rounded"
            >
              {expandedFiles.has(diff.path) ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>
            
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <FileDiff className={`w-4 h-4 ${
                diff.status === 'added' ? 'text-green-400' :
                diff.status === 'deleted' ? 'text-red-400' :
                diff.status === 'renamed' ? 'text-blue-400' :
                'text-yellow-400'
              }`} />
              <span className="text-sm text-gray-300 truncate">{diff.path}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                diff.status === 'added' ? 'bg-green-500/20 text-green-400' :
                diff.status === 'deleted' ? 'bg-red-500/20 text-red-400' :
                diff.status === 'renamed' ? 'bg-blue-500/20 text-blue-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>
                {diff.status}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400">+{diff.additions}</span>
              <span className="text-red-400">-{diff.deletions}</span>
              
              <button
                onClick={() => toggleViewed(diff.path)}
                className={`px-3 py-1 rounded border ${
                  viewedFiles.has(diff.path)
                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                {viewedFiles.has(diff.path) ? '✓ Viewed' : 'Mark viewed'}
              </button>
              
              {onApply && (
                <button
                  onClick={() => onApply(diff.path)}
                  className="px-3 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-400 rounded hover:bg-blue-500/30"
                >
                  Apply
                </button>
              )}
            </div>
          </div>

          {/* Diff Content */}
          {expandedFiles.has(diff.path) && (
            <div className="max-h-96 overflow-y-auto font-mono text-sm">
              {diff.hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx} className="border-b border-gray-800">
                  {/* Hunk Header */}
                  <div className="px-4 py-1 bg-gray-900/30 text-gray-500 text-xs">
                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                  </div>
                  
                  {/* Hunk Lines */}
                  {(() => {
                    let oldLineNum = hunk.oldStart;
                    let newLineNum = hunk.newStart;
                    return hunk.lines.map((line, lineIdx) => {
                      const lineType = line.startsWith('+') && !line.startsWith('+++') ? 'add' :
                                      line.startsWith('-') && !line.startsWith('---') ? 'remove' : 'context';
                      
                      const displayOldLine = lineType === 'remove' ? oldLineNum++ : (lineType === 'context' ? oldLineNum++ : '');
                      const displayNewLine = lineType === 'add' ? newLineNum++ : (lineType === 'context' ? newLineNum++ : '');
                      
                      return (
                        <div
                          key={lineIdx}
                          className={`flex px-4 py-0.5 ${
                            lineType === 'add' ? 'bg-green-500/10' :
                            lineType === 'remove' ? 'bg-red-500/10' :
                            'bg-transparent'
                          }`}
                        >
                          <span className="w-12 text-right pr-4 text-gray-600 select-none text-xs">
                            {lineType === 'add' ? displayNewLine :
                             lineType === 'remove' ? displayOldLine : ''}
                          </span>
                          <span className={`w-4 select-none ${
                            lineType === 'add' ? 'text-green-400' :
                            lineType === 'remove' ? 'text-red-400' :
                            'text-gray-600'
                          }`}>
                            {lineType === 'add' ? '+' : lineType === 'remove' ? '-' : ' '}
                          </span>
                          <SyntaxHighlighter
                            language="typescript"
                            style={oneDark}
                            customStyle={{
                              background: 'transparent',
                              padding: '0',
                              margin: '0',
                              fontSize: '0.8125rem',
                            }}
                            showLineNumbers={false}
                            wrapLines={true}
                          >
                            {line.slice(1)}
                          </SyntaxHighlighter>
                        </div>
                      );
                    });
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Parse unified diff format into structured data
 */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diff.split('\n');
  
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // File header
    if (line.startsWith('diff --git')) {
      // Flush any active hunk before starting new file
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
      }
      
      const match = line.match(/diff --git a\/(.+?) b\/(.+)$/);
      if (match) {
        currentFile = {
          path: match[2],
          oldPath: match[1] !== match[2] ? match[1] : undefined,
          status: 'modified',
          hunks: [],
          additions: 0,
          deletions: 0,
        };
        currentHunk = null;
      }
    }
    
    // File status
    else if (line.startsWith('new file mode')) {
      if (currentFile) currentFile.status = 'added';
    }
    else if (line.startsWith('deleted file mode')) {
      if (currentFile) currentFile.status = 'deleted';
    }
    else if (line.startsWith('rename from')) {
      if (currentFile) currentFile.status = 'renamed';
    }
    
    // Hunk header
    else if (line.startsWith('@@')) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
      }
      
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentHunk = {
          oldStart: parseInt(match[1]),
          oldLines: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newLines: parseInt(match[4] || '1'),
          lines: [],
        };
      }
    }
    
    // Hunk lines
    else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.lines.push(line);
      
      if (currentFile) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentFile.additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentFile.deletions++;
        }
      }
    }
  }
  
  // Push last file and hunk
  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk);
  }
  if (currentFile) {
    files.push(currentFile);
  }
  
  return files;
}
