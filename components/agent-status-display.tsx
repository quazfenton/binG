'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, Terminal, CheckCircle, Loader2, Users, User, Sparkles, Zap, Clock, AlertCircle } from 'lucide-react';
import { ToolInvocation } from '@/lib/types/tool-invocation';

export type AgentType = 'planner' | 'executor' | 'background' | 'single';
export type AgentStatus = 'idle' | 'thinking' | 'planning' | 'executing' | 'completed' | 'error';

export interface AgentStatusDisplayProps {
  agentType?: AgentType;
  status?: AgentStatus;
  currentAction?: string;
  toolInvocations?: ToolInvocation[];
  processingSteps?: Array<{
    step: string;
    status: 'started' | 'completed' | 'failed';
    timestamp: number;
  }>;
  isVisible?: boolean;
  compact?: boolean;
}

/**
 * Agent Status Display
 * Shows real-time agent state with type-specific indicators
 */
export function AgentStatusDisplay({
  agentType = 'single',
  status = 'idle',
  currentAction,
  toolInvocations,
  processingSteps,
  isVisible = true,
  compact = false,
}: AgentStatusDisplayProps) {
  const [displayStatus, setDisplayStatus] = useState<AgentStatus>(status);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    setDisplayStatus(status);
  }, [status]);

  useEffect(() => {
    if (status === 'thinking' || status === 'planning' || status === 'executing') {
      setElapsedTime(0);
      const timer = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [status]);

  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getStatusConfig = () => {
    switch (displayStatus) {
      case 'thinking':
      case 'planning':
        return {
          icon: <Brain className="h-4 w-4 animate-pulse" />,
          label: agentType === 'planner' ? 'Planning...' : 'Thinking...',
          color: 'text-purple-600 dark:text-purple-400',
          bg: 'bg-purple-50 dark:bg-purple-950/20',
          border: 'border-purple-200 dark:border-purple-800',
          pulse: true,
        };
      case 'executing':
        return {
          icon: <Terminal className="h-4 w-4" />,
          label: currentAction || 'Executing...',
          color: 'text-blue-600 dark:text-blue-400',
          bg: 'bg-blue-50 dark:bg-blue-950/20',
          border: 'border-blue-200 dark:border-blue-800',
          pulse: true,
        };
      case 'completed':
        return {
          icon: <CheckCircle className="h-4 w-4" />,
          label: 'Completed',
          color: 'text-emerald-600 dark:text-emerald-400',
          bg: 'bg-emerald-50 dark:bg-emerald-950/20',
          border: 'border-emerald-200 dark:border-emerald-800',
          pulse: false,
        };
      case 'error':
        return {
          icon: <AlertCircle className="h-4 w-4" />,
          label: 'Error occurred',
          color: 'text-red-600 dark:text-red-400',
          bg: 'bg-red-50 dark:bg-red-950/20',
          border: 'border-red-200 dark:border-red-800',
          pulse: false,
        };
      default:
        return {
          icon: <Sparkles className="h-4 w-4" />,
          label: 'Ready',
          color: 'text-gray-600 dark:text-gray-400',
          bg: 'bg-gray-50 dark:bg-gray-950/20',
          border: 'border-gray-200 dark:border-gray-800',
          pulse: false,
        };
    }
  };

  const getAgentTypeConfig = () => {
    switch (agentType) {
      case 'planner':
        return {
          icon: <Brain className="h-3 w-3" />,
          label: 'Planner',
          color: 'text-purple-600 dark:text-purple-400',
          description: 'Breaking down tasks...',
        };
      case 'executor':
        return {
          icon: <Terminal className="h-3 w-3" />,
          label: 'Executor',
          color: 'text-blue-600 dark:text-blue-400',
          description: 'Executing tasks...',
        };
      case 'background':
        return {
          icon: <Zap className="h-3 w-3" />,
          label: 'Background',
          color: 'text-amber-600 dark:text-amber-400',
          description: 'Working in background...',
        };
      default:
        return {
          icon: <User className="h-3 w-3" />,
          label: 'Agent',
          color: 'text-blue-600 dark:text-blue-400',
          description: 'Processing...',
        };
    }
  };

  if (!isVisible) {
    return null;
  }

  const statusConfig = getStatusConfig();
  const agentTypeConfig = getAgentTypeConfig();

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${statusConfig.bg} ${statusConfig.border}`}>
        <span className={statusConfig.color}>{statusConfig.icon}</span>
        <span className={`text-xs font-medium ${statusConfig.color}`}>
          {statusConfig.label}
        </span>
        {elapsedTime > 0 && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatElapsed(elapsedTime)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${statusConfig.bg} ${statusConfig.border} overflow-hidden`}>
      {/* Main Status Bar */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={statusConfig.color}>{statusConfig.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${statusConfig.color} uppercase tracking-wider`}>
                  {agentTypeConfig.label}
                </span>
                {agentType !== 'single' && (
                  <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">
                    {agentType}
                  </span>
                )}
              </div>
              <p className={`text-xs ${statusConfig.color} ${statusConfig.pulse ? 'animate-pulse' : ''}`}>
                {statusConfig.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {elapsedTime > 0 && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatElapsed(elapsedTime)}
              </span>
            )}
            {toolInvocations && toolInvocations.length > 0 && (
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">
                {toolInvocations.filter(t => t.state === 'result').length}/{toolInvocations.length} tools
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Current Action */}
      {currentAction && displayStatus === 'executing' && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Terminal className="h-3 w-3 text-blue-500" />
            <span className="text-xs text-gray-700 dark:text-gray-300 font-mono">
              {currentAction}
            </span>
          </div>
        </div>
      )}

      {/* Processing Steps */}
      {processingSteps && processingSteps.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-1 mb-2">
            <Users className="h-3 w-3 text-gray-500" />
            <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Steps
            </span>
          </div>
          <div className="space-y-1">
            {processingSteps.map((step, index) => (
              <div
                key={index}
                className="flex items-center gap-2 text-xs"
              >
                {step.status === 'completed' ? (
                  <CheckCircle className="h-3 w-3 text-emerald-500" />
                ) : step.status === 'failed' ? (
                  <AlertCircle className="h-3 w-3 text-red-500" />
                ) : (
                  <Loader2 className="h-3 w-3 text-blue-500 animate-pulse" />
                )}
                <span className={
                  step.status === 'completed'
                    ? 'text-gray-600 dark:text-gray-400 line-through'
                    : step.status === 'failed'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-800 dark:text-gray-200'
                }>
                  {step.step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Tools */}
      {toolInvocations && toolInvocations.some(t => t.state === 'call') && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1 mb-2">
            <Terminal className="h-3 w-3 text-gray-500" />
            <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Active Tools
            </span>
          </div>
          <div className="space-y-1">
            {toolInvocations
              .filter(t => t.state === 'call')
              .map((tool, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-950/20 rounded px-2 py-1"
                >
                  <Loader2 className="h-3 w-3 text-blue-500 animate-pulse" />
                  <span className="font-mono text-blue-700 dark:text-blue-300">
                    {tool.toolName}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Multi-Agent Status Display
 * Shows status for multiple agents (planner + executor)
 */
export function MultiAgentStatusDisplay({
  plannerStatus,
  executorStatus,
  currentAction,
  toolInvocations,
  processingSteps,
}: {
  plannerStatus?: AgentStatus;
  executorStatus?: AgentStatus;
  currentAction?: string;
  toolInvocations?: ToolInvocation[];
  processingSteps?: Array<{
    step: string;
    status: 'started' | 'completed' | 'failed';
    timestamp: number;
  }>;
}) {
  const hasPlanner = plannerStatus && plannerStatus !== 'idle';
  const hasExecutor = executorStatus && executorStatus !== 'idle';

  if (!hasPlanner && !hasExecutor) {
    return null;
  }

  return (
    <div className="space-y-2">
      {hasPlanner && (
        <AgentStatusDisplay
          agentType="planner"
          status={plannerStatus}
          isVisible={true}
          compact
        />
      )}
      {hasExecutor && (
        <AgentStatusDisplay
          agentType="executor"
          status={executorStatus}
          currentAction={currentAction}
          toolInvocations={toolInvocations}
          processingSteps={processingSteps}
          isVisible={true}
        />
      )}
    </div>
  );
}

/**
 * Agent Status Hook
 * Manages agent status state based on streaming events
 */
export function useAgentStatus() {
  const [agentType, setAgentType] = useState<AgentType>('single');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [currentAction, setCurrentAction] = useState<string | undefined>();

  const updateFromEvent = useCallback((eventType: string, eventData: any) => {
    switch (eventType) {
      case 'init':
        setStatus('thinking');
        if (eventData.agent === 'planner') setAgentType('planner');
        else if (eventData.agent === 'executor') setAgentType('executor');
        break;
      case 'step':
        if (eventData.status === 'started') {
          setStatus('executing');
          setCurrentAction(eventData.step);
        } else if (eventData.status === 'completed') {
          setCurrentAction(undefined);
        }
        break;
      case 'tool_invocation':
        if (eventData.state === 'call') {
          setStatus('executing');
        }
        break;
      case 'done':
        setStatus('completed');
        break;
      case 'error':
        setStatus('error');
        break;
    }
  }, []);

  const reset = useCallback(() => {
    setAgentType('single');
    setStatus('idle');
    setCurrentAction(undefined);
  }, []);

  return {
    agentType,
    status,
    currentAction,
    updateFromEvent,
    reset,
  };
}
