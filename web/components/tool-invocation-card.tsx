'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Terminal, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';

import type { ToolInvocation } from '@/lib/types/tool-invocation';

interface ToolInvocationCardProps {
  tool: ToolInvocation;
  compact?: boolean;
}

export function ToolInvocationCard({ tool, compact = false }: ToolInvocationCardProps) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const getStatusConfig = () => {
    switch (tool.state) {
      case 'partial-call':
        return {
          icon: <Loader2 className="h-3 w-3 animate-spin" />,
          label: 'Preparing...',
          bg: 'bg-black/30 backdrop-blur-sm',
          border: 'border-white/10',
          text: 'text-white/50',
        };
      case 'call':
        return {
          icon: <Terminal className="h-3 w-3" />,
          label: 'Executing...',
          bg: 'bg-black/30 backdrop-blur-sm',
          border: 'border-white/10',
          text: 'text-white/60',
        };
      case 'result':
        const result = tool.result as Record<string, unknown>;
        if (typeof result?.error === 'string' || result?.error instanceof Error) {
          return {
            icon: <XCircle className="h-3 w-3" />,
            label: 'Failed',
            bg: 'bg-black/30 backdrop-blur-sm',
            border: 'border-red-900/60',
            text: 'text-red-400/90',
          };
        }
        return {
          icon: <CheckCircle className="h-3 w-3" />,
          label: 'Completed',
          bg: 'bg-black/30 backdrop-blur-sm',
          border: 'border-white/10',
          text: 'text-white/50',
        };
    }
  };

  const config = getStatusConfig();

  const isToolCall = tool.toolName === 'execute_python' || tool.toolName === 'run_code';
  const isVFSTool = tool.toolName === 'write_file' || tool.toolName === 'read_file' || tool.toolName === 'apply_diff' || tool.toolName === 'delete_file' || tool.toolName === 'batch_write';

  const codeContent = tool.args?.code as string | undefined;
  const pathContent = tool.args?.path as string | undefined;
  const contentPreview = tool.args?.content as string | undefined;
  const diffPreview = tool.args?.diff as string | undefined;

  const hasCodeBlock = !!(codeContent || contentPreview || diffPreview);
  const hasDetails = !!(
    (tool.args && Object.keys(tool.args).length > 0 && !hasCodeBlock) ||
    (tool.state === 'result' && tool.result)
  );

  const renderResultContent = (result: unknown) => {
    if (result === null || result === undefined) {
      return (
        <div className="mt-1 rounded border border-white/5 bg-black/20 p-2">
          <div className="flex items-center gap-1 text-white/50 text-xs font-medium mb-1">
            <CheckCircle className="h-3 w-3" />
            Execution Success
          </div>
          <pre className="whitespace-pre-wrap text-xs text-white/30 font-mono">No result returned</pre>
        </div>
      );
    }

    if (typeof result !== 'object') {
      return (
        <div className="mt-1 rounded border border-white/5 bg-black/20 p-2">
          <div className="flex items-center gap-1 text-white/50 text-xs font-medium mb-1">
            <CheckCircle className="h-3 w-3" />
            Execution Success
          </div>
          <pre className="whitespace-pre-wrap text-xs text-white/60 font-mono">{String(result)}</pre>
        </div>
      );
    }

    const obj = result as Record<string, unknown>;
    const errorValue = obj?.error;
    const outputValue = obj?.output;
    const hasError = typeof errorValue === 'string' || errorValue instanceof Error;
    const errorText = typeof errorValue === 'string' ? errorValue : errorValue instanceof Error ? errorValue.message : '';
    const hasOutput = typeof outputValue === 'string';

    let serialized: string;
    try {
      serialized = JSON.stringify(result, null, 2);
    } catch {
      serialized = '[Unable to serialize result]';
    }

    if (hasError) {
      return (
        <div className="mt-1 rounded border border-red-900/40 bg-red-950/30 p-2">
          <div className="flex items-center gap-1 text-red-400/80 text-xs font-medium mb-1">
            <AlertCircle className="h-3 w-3" />
            Execution Error
          </div>
          <pre className="whitespace-pre-wrap text-xs text-red-400/70 font-mono">{errorText}</pre>
        </div>
      );
    }

    return (
      <div className="mt-1 rounded border border-white/5 bg-black/20 p-2">
        <div className="flex items-center gap-1 text-white/50 text-xs font-medium mb-1">
          <CheckCircle className="h-3 w-3" />
          Execution Success
        </div>
        <pre className="whitespace-pre-wrap text-xs text-white/60 font-mono">
          {hasOutput ? outputValue : serialized}
        </pre>
      </div>
    );
  };

  return (
    <div className={`rounded-lg border backdrop-blur-lg transition-all duration-200 ${config.bg} ${config.border} ${tool.state === 'call' ? 'animate-pulse-subtle' : ''}`}>
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className={config.text}>{config.icon}</span>
            <span className={`text-xs font-mono ${config.text} shrink-0`}>{tool.toolName}</span>
            {pathContent && (
              <span className="text-xs font-mono text-white/40 truncate">{pathContent}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] ${config.text}`}>{config.label}</span>
            {hasDetails && (
              <button
                onClick={() => setDetailsExpanded(!detailsExpanded)}
                className="hover:bg-white/10 rounded p-0.5 transition-colors"
              >
                {detailsExpanded ? <ChevronUp className="h-3 w-3 opacity-50" /> : <ChevronDown className="h-3 w-3 opacity-50" />}
              </button>
            )}
          </div>
        </div>

        {hasCodeBlock && (
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
              {isVFSTool ? 'File' : 'Code'}
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-black/40 p-3 text-xs font-mono text-white/80 whitespace-pre-wrap">
              {codeContent || contentPreview || diffPreview}
            </pre>
          </div>
        )}

        {detailsExpanded && (
          <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
            {tool.args && Object.keys(tool.args).length > 0 && !hasCodeBlock && (
              <div>
                <span className="text-[10px] uppercase tracking-wider opacity-60">Arguments</span>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[11px] font-mono text-white/60 whitespace-pre-wrap">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              </div>
            )}

            {tool.state === 'result' && tool.result && (
              <div>
                <span className="text-[10px] uppercase tracking-wider opacity-60">Result</span>
                {renderResultContent(tool.result)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolInvocationsList({
  toolInvocations,
  compact = false,
}: {
  toolInvocations: ToolInvocation[];
  compact?: boolean;
}) {
  if (!toolInvocations || toolInvocations.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {toolInvocations.map((tool) => (
        <ToolInvocationCard key={tool.toolCallId} tool={tool} compact={compact} />
      ))}
    </div>
  );
}