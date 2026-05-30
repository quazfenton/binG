'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Terminal, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';

import type { ToolInvocation } from '@/lib/types/tool-invocation';

interface ToolInvocationCardProps {
  tool: ToolInvocation;
  compact?: boolean;
}

/**
 * Enhanced Tool Invocation Card
 * - No yellow box for partial-call (subtle indicator only)
 * - Clean blue state for execution
 * - Clear success/error states for results
 * - Expandable details
 */
export function ToolInvocationCard({ tool, compact = false }: ToolInvocationCardProps) {
  const [expanded, setExpanded] = useState(!compact);

  const getStatusConfig = () => {
    switch (tool.state) {
      case 'partial-call':
        return {
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
          label: 'Preparing...',
          bg: 'bg-transparent',
          border: 'border-gray-200 dark:border-gray-700',
          text: 'text-gray-500',
          showProgress: false,
        };
      case 'call':
        return {
          icon: <Terminal className="h-3 w-3" />,
          label: 'Executing...',
          bg: 'bg-blue-50 dark:bg-blue-950/20',
          border: 'border-blue-200 dark:border-blue-800',
          text: 'text-blue-700 dark:text-blue-300',
          showProgress: true,
        };
      case 'result':
        const result = tool.result as Record<string, unknown>;
        if (typeof result?.error === 'string' || result?.error instanceof Error) {
          return {
            icon: <XCircle className="h-3 w-3" />,
            label: 'Failed',
            bg: 'bg-red-50 dark:bg-red-950/20',
            border: 'border-red-200 dark:border-red-800',
            text: 'text-red-700 dark:text-red-300',
            showProgress: false,
          };
        }
        return {
          icon: <CheckCircle className="h-3 w-3" />,
          label: 'Completed',
          bg: 'bg-emerald-50 dark:bg-emerald-950/20',
          border: 'border-emerald-200 dark:border-emerald-800',
          text: 'text-emerald-700 dark:text-emerald-300',
          showProgress: false,
        };
    }
  };

  const config = getStatusConfig();

  /**
   * Safely render result content with typeof guards for error/output fields.
   * Prevents runtime crashes from accessing `.error` or `.output` on non-object results
   * or rendering non-string values directly.
   */
  const renderResultContent = (result: unknown) => {
    const obj = result as Record<string, unknown>;
    const errorValue = obj?.error;
    const outputValue = obj?.output;
    const hasError = typeof errorValue === 'string' || errorValue instanceof Error;
    const errorText = typeof errorValue === 'string' ? errorValue : errorValue instanceof Error ? errorValue.message : '';
    const hasOutput = typeof outputValue === 'string';

    return hasError ? (
      <div className="mt-1 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-2">
        <div className="flex items-center gap-1 text-red-700 dark:text-red-300 text-xs font-medium mb-1">
          <AlertCircle className="h-3 w-3" />
          Execution Error
        </div>
        <pre className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400 font-mono">
          {errorText}
        </pre>
      </div>
    ) : (
      <div className="mt-1 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-2">
        <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 text-xs font-medium mb-1">
          <CheckCircle className="h-3 w-3" />
          Execution Success
        </div>
        {hasOutput ? (
          <pre className="whitespace-pre-wrap text-xs text-emerald-600 dark:text-emerald-400 font-mono">
            {outputValue}
          </pre>
        ) : (
          <pre className="whitespace-pre-wrap text-xs text-emerald-600 dark:text-emerald-400 font-mono">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    );
  };

  /**
   * Safely determine if the result contains an error, using typeof guards.
   * Used by the header status label to show "Error" vs "Success".
   */
  const getResultStatusLabel = (result: unknown): string => {
    const obj = result as Record<string, unknown>;
    const errorValue = obj?.error;
    return (typeof errorValue === 'string' || errorValue instanceof Error) ? 'Error' : 'Success';
  };

  const isToolCall = tool.toolName === 'execute_python' || tool.toolName === 'run_code';
  const isVFSTool = tool.toolName === 'write_file' || tool.toolName === 'read_file' || tool.toolName === 'apply_diff' || tool.toolName === 'delete_file' || tool.toolName === 'batch_write';
  // For VFS tools, extract path and content/diff; for code tools, extract code
  const codeContent = tool.args?.code as string | undefined;
  const pathContent = tool.args?.path as string | undefined;
  const contentPreview = tool.args?.content as string | undefined;
  const diffPreview = tool.args?.diff as string | undefined;

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${config.bg} ${config.border} ${
        tool.state === 'call' ? 'animate-pulse-subtle' : ''
      }`}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={config.text}>{config.icon}</span>
          <span className={`text-xs font-mono ${config.text}`}>
            {tool.toolName}
          </span>
          {config.showProgress && (
            <span className="text-[10px] uppercase tracking-wider opacity-60">
              {tool.state}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {tool.state === 'result' && (
            <span className="text-[10px] opacity-50">
              {getResultStatusLabel(tool.result)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-3 w-3 opacity-50" />
          ) : (
            <ChevronDown className="h-3 w-3 opacity-50" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Code/Arguments Display */}
          {(codeContent || pathContent) && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider opacity-60">
                  {isVFSTool ? 'File' : 'Code'}
                </span>
                {tool.state === 'partial-call' && (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 animate-pulse">
                    Streaming...
                  </span>
                )}
              </div>
              {pathContent && (
                <div className="text-xs font-mono text-gray-600 dark:text-gray-300 mb-1 truncate">
                  {pathContent}
                </div>
              )}
              <pre className="max-h-64 overflow-auto rounded bg-black/90 p-3 text-xs font-mono text-gray-100">
                <code>{codeContent || contentPreview || diffPreview}</code>
              </pre>
            </div>
          )}

          {/* Other Arguments */}
          {tool.args && !codeContent && Object.keys(tool.args).length > 0 && (
            <div>
              <span className="text-[10px] uppercase tracking-wider opacity-60">
                Arguments
              </span>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/10 dark:bg-black/30 p-2 text-[11px] font-mono">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result Display */}
          {tool.state === 'result' && tool.result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider opacity-60">
                Result
              </span>
              {renderResultContent(tool.result)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Batch Tool Invocations Display
 * Renders multiple tool invocations with proper spacing
 */
export function ToolInvocationsList({
  toolInvocations,
  compact = false,
}: {
  toolInvocations: ToolInvocation[];
  compact?: boolean;
}) {
  if (!toolInvocations || toolInvocations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {toolInvocations.map((tool) => (
        <ToolInvocationCard
          key={tool.toolCallId}
          tool={tool}
          compact={compact}
        />
      ))}
    </div>
  );
}
