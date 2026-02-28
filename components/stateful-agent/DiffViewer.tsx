'use client';

import { useMemo } from 'react';
import { Plus, Minus, ArrowRight } from 'lucide-react';

interface DiffLine {
  type: 'context' | 'added' | 'removed';
  content: string;
  lineNumber?: number;
}

interface FileDiff {
  path: string;
  originalContent: string;
  newContent: string;
}

interface DiffViewerProps {
  diff: FileDiff;
  maxLines?: number;
}

function parseDiff(original: string, newContent: string): DiffLine[] {
  const originalLines = original.split('\n');
  const newLines = newContent.split('\n');
  const result: DiffLine[] = [];
  
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < originalLines.length || newIdx < newLines.length) {
    const oldLine = originalLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldLine === newLine) {
      result.push({ type: 'context', content: oldLine, lineNumber: oldIdx + 1 });
      oldIdx++;
      newIdx++;
    } else if (oldLine !== undefined && newLine !== undefined && !originalLines.includes(newLine)) {
      result.push({ type: 'added', content: newLine, lineNumber: newIdx + 1 });
      newIdx++;
    } else if (oldLine !== undefined) {
      result.push({ type: 'removed', content: oldLine, lineNumber: oldIdx + 1 });
      oldIdx++;
    } else if (newLine !== undefined) {
      result.push({ type: 'added', content: newLine, lineNumber: newIdx + 1 });
      newIdx++;
    }
  }

  return result;
}

export function DiffViewer({ diff, maxLines = 100 }: DiffViewerProps) {
  const parsedDiff = useMemo(() => 
    parseDiff(diff.originalContent, diff.newContent),
    [diff.originalContent, diff.newContent]
  );

  const displayDiff = useMemo(() => {
    if (parsedDiff.length <= maxLines) return parsedDiff;
    return parsedDiff.slice(0, maxLines);
  }, [parsedDiff, maxLines]);

  const stats = useMemo(() => {
    const added = parsedDiff.filter(d => d.type === 'added').length;
    const removed = parsedDiff.filter(d => d.type === 'removed').length;
    return { added, removed };
  }, [parsedDiff]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <code className="text-sm font-mono text-gray-700 dark:text-gray-300">{diff.path}</code>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-green-600">
            <Plus className="w-3 h-3" />
            {stats.added}
          </span>
          <span className="flex items-center gap-1 text-red-600">
            <Minus className="w-3 h-3" />
            {stats.removed}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <pre className="text-xs font-mono p-4">
          {displayDiff.map((line, idx) => (
            <div 
              key={idx} 
              className={`
                flex items-center gap-2 px-2 py-0.5
                ${line.type === 'added' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : ''}
                ${line.type === 'removed' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : ''}
                ${line.type === 'context' ? 'text-gray-600 dark:text-gray-400' : ''}
              `}
            >
              <span className="w-8 text-gray-400 text-right select-none">
                {line.lineNumber}
              </span>
              <span className="w-4 text-center">
                {line.type === 'added' && <Plus className="w-3 h-3" />}
                {line.type === 'removed' && <Minus className="w-3 h-3" />}
                {line.type === 'context' && <ArrowRight className="w-3 h-3 opacity-30" />}
              </span>
              <span className="whitespace-pre-wrap">{line.content}</span>
            </div>
          ))}
          {parsedDiff.length > maxLines && (
            <div className="text-gray-400 text-center py-2">
              ... {parsedDiff.length - maxLines} more lines
            </div>
          )}
        </pre>
      </div>
    </div>
  );
}

export function DiffSummary({ 
  transactions 
}: { 
  transactions: Array<{
    path: string;
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    originalContent?: string;
    newContent?: string;
  }> 
}) {
  const stats = useMemo(() => {
    const created = transactions.filter(t => t.type === 'CREATE').length;
    const updated = transactions.filter(t => t.type === 'UPDATE').length;
    const deleted = transactions.filter(t => t.type === 'DELETE').length;
    return { created, updated, deleted, total: transactions.length };
  }, [transactions]);

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1">
        <Plus className="w-4 h-4 text-green-500" />
        <span>{stats.created} created</span>
      </div>
      <div className="flex items-center gap-1">
        <ArrowRight className="w-4 h-4 text-blue-500" />
        <span>{stats.updated} updated</span>
      </div>
      <div className="flex items-center gap-1">
        <Minus className="w-4 h-4 text-red-500" />
        <span>{stats.deleted} deleted</span>
      </div>
      <div className="text-gray-400">
        ({stats.total} total)
      </div>
    </div>
  );
}
