/**
 * Spec Amplification Progress Display
 * 
 * Shows real-time progress of spec amplification with:
 * - Stage indicators
 * - DAG task visualization
 * - Progress bars
 * - Section refinement status
 */

"use client"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { 
  CheckCircle2, 
  Loader2, 
  Sparkles, 
  Zap,
  Layers,
  GitBranch,
  Clock,
  AlertCircle
} from "lucide-react"

interface SpecAmplificationProgressProps {
  stage?: 'started' | 'spec_generated' | 'refining' | 'complete' | 'error'
  fastModel?: string
  specScore?: number
  sectionsGenerated?: number
  currentIteration?: number
  totalIterations?: number
  currentSection?: string
  error?: string
  timestamp?: number
}

export function SpecAmplificationProgress({
  stage = 'started',
  fastModel,
  specScore,
  sectionsGenerated = 0,
  currentIteration = 0,
  totalIterations = 0,
  currentSection,
  error,
  timestamp
}: SpecAmplificationProgressProps) {
  const progress = totalIterations > 0 
    ? Math.round((currentIteration / totalIterations) * 100) 
    : 0

  const stageConfig = {
    started: {
      icon: Sparkles,
      title: 'Generating Improvement Spec',
      description: 'Fast model analyzing request...',
      color: 'text-purple-400'
    },
    spec_generated: {
      icon: Layers,
      title: 'Spec Generated',
      description: `${sectionsGenerated} section(s) created`,
      color: 'text-blue-400'
    },
    refining: {
      icon: Zap,
      title: 'Refining Response',
      description: currentSection || `Section ${currentIteration}/${totalIterations}`,
      color: 'text-amber-400'
    },
    complete: {
      icon: CheckCircle2,
      title: 'Refinement Complete',
      description: specScore ? `Quality score: ${specScore}/10` : 'All sections refined',
      color: 'text-green-400'
    },
    error: {
      icon: AlertCircle,
      title: 'Refinement Error',
      description: error || 'An error occurred',
      color: 'text-red-400'
    }
  }

  const config = stageConfig[stage]
  const Icon = config.icon

  return (
    <div className="w-full space-y-3 p-3 rounded-lg border border-white/10 bg-white/5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${config.color}`} />
        <span className="text-sm font-medium text-white">{config.title}</span>
        {stage === 'refining' && (
          <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-white/60">{config.description}</p>

      {/* Progress Bar */}
      {stage === 'refining' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-white/40">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-3 text-xs">
        {sectionsGenerated > 0 && (
          <div className="flex items-center gap-1 text-white/60">
            <Layers className="w-3 h-3" />
            <span>{sectionsGenerated} sections</span>
          </div>
        )}
        {specScore && (
          <div className="flex items-center gap-1 text-white/60">
            <Sparkles className="w-3 h-3" />
            <span>Score: {specScore}/10</span>
          </div>
        )}
        {fastModel && (
          <div className="flex items-center gap-1 text-white/60">
            <Zap className="w-3 h-3" />
            <span className="truncate max-w-[100px]">{fastModel}</span>
          </div>
        )}
      </div>

      {/* Timestamp */}
      {timestamp && (
        <div className="flex items-center gap-1 text-xs text-white/40">
          <Clock className="w-3 h-3" />
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  )
}

interface DAGTask {
  taskId: string
  title: string
  status: 'pending' | 'running' | 'complete' | 'error'
  dependencies: string[]
  error?: string
  startedAt?: number
  completedAt?: number
}

interface DAGProgressDisplayProps {
  tasks: DAGTask[]
  overallProgress: number
  activeTasks: string[]
  timestamp?: number
}

export function DAGProgressDisplay({
  tasks,
  overallProgress,
  activeTasks,
  timestamp
}: DAGProgressDisplayProps) {
  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const runningTasks = tasks.filter(t => t.status === 'running')
  const completedTasks = tasks.filter(t => t.status === 'complete')
  const failedTasks = tasks.filter(t => t.status === 'error')

  return (
    <div className="w-full space-y-3 p-3 rounded-lg border border-white/10 bg-white/5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">Parallel Execution</span>
        </div>
        <Badge variant="outline" className="text-xs border-cyan-400/50 text-cyan-400">
          {overallProgress}%
        </Badge>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <Progress value={overallProgress} className="h-2" />
      </div>

      {/* Task Grid */}
      <div className="grid grid-cols-2 gap-2">
        {tasks.slice(0, 6).map(task => (
          <div
            key={task.taskId}
            className={`
              flex items-center gap-2 p-2 rounded text-xs
              ${task.status === 'complete' ? 'bg-green-500/10 text-green-400' : ''}
              ${task.status === 'running' ? 'bg-amber-500/10 text-amber-400' : ''}
              ${task.status === 'pending' ? 'bg-white/5 text-white/40' : ''}
              ${task.status === 'error' ? 'bg-red-500/10 text-red-400' : ''}
            `}
          >
            {task.status === 'complete' && <CheckCircle2 className="w-3 h-3" />}
            {task.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
            {task.status === 'pending' && <Clock className="w-3 h-3" />}
            {task.status === 'error' && <AlertCircle className="w-3 h-3" />}
            <span className="truncate">{task.title}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-xs text-white/60">
        <span>✓ {completedTasks.length} done</span>
        <span>⟳ {runningTasks.length} running</span>
        <span>○ {pendingTasks.length} pending</span>
        {failedTasks.length > 0 && (
          <span className="text-red-400">✗ {failedTasks.length} failed</span>
        )}
      </div>

      {/* Active Tasks */}
      {activeTasks.length > 0 && (
        <div className="text-xs text-white/40">
          Active: {activeTasks.join(', ')}
        </div>
      )}

      {/* Timestamp */}
      {timestamp && (
        <div className="flex items-center gap-1 text-xs text-white/40">
          <Clock className="w-3 h-3" />
          <span>{new Date(timestamp).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  )
}
