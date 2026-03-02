'use client';

import { useEffect, useState } from 'react';
import { 
  Search, 
  FileText, 
  Code, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  RotateCcw,
  Clock,
  GitBranch
} from 'lucide-react';

export type AgentPhase = 'idle' | 'discovering' | 'planning' | 'editing' | 'verifying' | 'committing' | 'error';

interface AgentStatusProps {
  phase: AgentPhase;
  steps: number;
  currentFile?: string;
  errors?: Array<{ message: string; path?: string }>;
  transactionCount?: number;
  retryCount?: number;
}

const phaseConfig: Record<AgentPhase, {
  label: string;
  color: string;
  icon: React.ElementType;
  description: string;
}> = {
  idle: {
    label: 'Idle',
    color: 'bg-gray-400',
    icon: Clock,
    description: 'Waiting for task',
  },
  discovering: {
    label: 'Discovering',
    color: 'bg-blue-500',
    icon: Search,
    description: 'Analyzing project files',
  },
  planning: {
    label: 'Planning',
    color: 'bg-purple-500',
    icon: FileText,
    description: 'Creating modification plan',
  },
  editing: {
    label: 'Editing',
    color: 'bg-orange-500',
    icon: Code,
    description: 'Applying changes',
  },
  verifying: {
    label: 'Verifying',
    color: 'bg-yellow-500',
    icon: CheckCircle,
    description: 'Validating changes',
  },
  committing: {
    label: 'Committing',
    color: 'bg-green-500',
    icon: GitBranch,
    description: 'Saving changes',
  },
  error: {
    label: 'Error',
    color: 'bg-red-500',
    icon: AlertCircle,
    description: 'Action failed',
  },
};

export function AgentStatus({ 
  phase, 
  steps, 
  currentFile,
  errors = [],
  transactionCount = 0,
  retryCount = 0 
}: AgentStatusProps) {
  const config = phaseConfig[phase];
  const Icon = config.icon;
  const isRunning = ['discovering', 'planning', 'editing', 'verifying', 'committing'].includes(phase);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.color} ${isRunning ? 'animate-pulse' : ''}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{config.label}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{config.description}</p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{steps}</div>
          <div className="text-xs text-gray-500">steps</div>
        </div>
      </div>

      {currentFile && (
        <div className="flex items-center gap-2 text-sm">
          <Code className="w-4 h-4 text-gray-400" />
          <span className="text-gray-600 dark:text-gray-300 truncate">{currentFile}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="bg-gray-50 dark:bg-gray-700 rounded px-3 py-2">
          <div className="text-gray-500 dark:text-gray-400 text-xs">Transactions</div>
          <div className="font-semibold">{transactionCount}</div>
        </div>
        {retryCount > 0 && (
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded px-3 py-2">
            <div className="text-orange-600 dark:text-orange-400 text-xs">Retries</div>
            <div className="font-semibold text-orange-600">{retryCount}</div>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <div className="flex items-center gap-2 text-sm text-red-600 mb-2">
            <AlertCircle className="w-4 h-4" />
            <span className="font-medium">{errors.length} error{errors.length > 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-auto">
            {errors.slice(0, 3).map((err, i) => (
              <div key={i} className="text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded text-red-700 dark:text-red-300">
                {err.path && <span className="font-mono">{err.path}: </span>}
                {err.message}
              </div>
            ))}
            {errors.length > 3 && (
              <div className="text-xs text-gray-500">+{errors.length - 3} more errors</div>
            )}
          </div>
        </div>
      )}

      {isRunning && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Processing...</span>
        </div>
      )}
    </div>
  );
}

export function PhaseIndicator({ 
  currentPhase,
  completedPhases = []
}: { 
  currentPhase: AgentPhase;
  completedPhases?: AgentPhase[];
}) {
  const phases: AgentPhase[] = ['discovering', 'planning', 'editing', 'verifying', 'committing'];
  const currentIndex = phases.indexOf(currentPhase);

  return (
    <div className="flex items-center gap-1">
      {phases.map((phase, index) => {
        const isCompleted = completedPhases.includes(phase);
        const isCurrent = phase === currentPhase;
        const isPending = index > currentIndex && !isCompleted;

        return (
          <div key={phase} className="flex items-center">
            <div 
              className={`
                w-3 h-3 rounded-full transition-all
                ${isCompleted ? 'bg-green-500' : ''}
                ${isCurrent ? 'bg-blue-500 animate-pulse' : ''}
                ${isPending ? 'bg-gray-300 dark:bg-gray-600' : ''}
              `}
              title={phaseConfig[phase].label}
            />
            {index < phases.length - 1 && (
              <div 
                className={`
                  w-4 h-0.5 
                  ${isCompleted ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
