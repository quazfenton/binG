'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Brain, Sparkles, Lightbulb, Target } from 'lucide-react';
import type { ReasoningChunk } from '@/hooks/use-reasoning-stream';

interface ReasoningDisplayProps {
  reasoningChunks: ReasoningChunk[];
  isStreaming: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  fullReasoning?: string;
}

/**
 * Reasoning/Thought Display Component
 * Shows the agent's inner monologue, planning, and reflection
 * with type-specific icons and styling
 */
export function ReasoningDisplay({
  reasoningChunks,
  isStreaming,
  isExpanded,
  onToggle,
  fullReasoning,
}: ReasoningDisplayProps) {
  if (!reasoningChunks || reasoningChunks.length === 0) {
    return null;
  }

  const getTypeIcon = (type: ReasoningChunk['type']) => {
    switch (type) {
      case 'thought':
        return <Brain className="h-3 w-3" />;
      case 'reasoning':
        return <Sparkles className="h-3 w-3" />;
      case 'plan':
        return <Target className="h-3 w-3" />;
      case 'reflection':
        return <Lightbulb className="h-3 w-3" />;
    }
  };

  const getTypeLabel = (type: ReasoningChunk['type']) => {
    switch (type) {
      case 'thought':
        return 'Thought';
      case 'reasoning':
        return 'Reasoning';
      case 'plan':
        return 'Plan';
      case 'reflection':
        return 'Reflection';
    }
  };

  const getTypeColor = (type: ReasoningChunk['type']) => {
    switch (type) {
      case 'thought':
        return 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800';
      case 'reasoning':
        return 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800';
      case 'plan':
        return 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800';
      case 'reflection':
        return 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800';
    }
  };

  return (
    <div className="mb-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className={`h-4 w-4 ${isStreaming ? 'animate-pulse' : ''} text-blue-600 dark:text-blue-400`} />
          <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
            {isStreaming ? 'Thinking...' : 'Agent Reasoning'}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-blue-500 dark:text-blue-400 animate-pulse">
              {reasoningChunks.length} chunk{reasoningChunks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {reasoningChunks.map((chunk, index) => (
            <div
              key={chunk.id}
              className={`rounded border p-2 ${getTypeColor(chunk.type)}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {getTypeIcon(chunk.type)}
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                  {getTypeLabel(chunk.type)}
                </span>
                {chunk.isComplete ? (
                  <span className="text-[9px] opacity-50 ml-auto">✓</span>
                ) : (
                  <span className="text-[9px] opacity-50 ml-auto animate-pulse">⋯</span>
                )}
              </div>
              <pre className="whitespace-pre-wrap text-xs font-mono opacity-90 leading-relaxed">
                {chunk.content}
              </pre>
            </div>
          ))}
          
          {isStreaming && (
            <div className="text-[10px] text-blue-500 dark:text-blue-400 text-center py-1 animate-pulse">
              Agent is thinking...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact Reasoning Summary
 * Shows a collapsed summary with expand option
 */
export function ReasoningSummary({
  fullReasoning,
  isStreaming,
  onExpand,
}: {
  fullReasoning: string;
  isStreaming: boolean;
  onExpand: () => void;
}) {
  if (!fullReasoning) return null;

  const previewLength = 150;
  const preview = fullReasoning.length > previewLength
    ? fullReasoning.slice(0, previewLength) + '...'
    : fullReasoning;

  return (
    <button
      onClick={onExpand}
      className="w-full mb-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 px-3 py-2 text-left hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
    >
      <div className="flex items-center gap-2">
        <Brain className={`h-4 w-4 ${isStreaming ? 'animate-pulse' : ''} text-blue-600 dark:text-blue-400`} />
        <span className="text-xs text-blue-700 dark:text-blue-300">
          {isStreaming ? 'Agent is thinking...' : 'View agent reasoning'}
        </span>
        <ChevronDown className="h-3 w-3 text-blue-600 dark:text-blue-400 ml-auto" />
      </div>
      <p className="mt-1 text-[11px] text-blue-600/80 dark:text-blue-400/80 font-mono line-clamp-2">
        {preview}
      </p>
    </button>
  );
}
