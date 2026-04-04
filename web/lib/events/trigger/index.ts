/**
 * Trigger.dev Integration Index
 *
 * Central export for all Trigger.dev task wrappers.
 * Each wrapper provides:
 * - Trigger.dev SDK execution when available
 * - Automatic fallback to local execution
 * - Scheduling capabilities for recurring tasks
 *
 * @module events/trigger
 */

// Agent Loop Task
export {
  executeAgentLoopTask,
  scheduleAgentLoop,
  type AgentLoopTaskPayload,
  type AgentLoopTaskResult,
} from './agent-loop-task';

// Multi-Agent Consensus Task
export {
  executeConsensusTask,
  type ConsensusTaskPayload,
  type ConsensusTaskResult,
} from './consensus-task';

// Research Agent Task
export {
  executeResearchTask,
  type ResearchTaskPayload,
  type ResearchTaskResult,
} from './research-task';

// Reflection Task
export {
  executeReflectionTask,
  scheduleReflection,
  type ReflectionTaskPayload,
  type ReflectionTaskResult,
} from './reflection-task';

// DAG Executor Task
export {
  executeDAGTask,
  scheduleDAGExecution,
  type DAGTaskPayload,
  type DAGTaskResult,
} from './dag-task';

// Skill Bootstrap Task
export {
  executeSkillBootstrapTask,
  scheduleSkillBootstrap,
  type SkillBootstrapTaskPayload,
  type SkillBootstrapTaskResult,
  type ExtractedSkill,
} from './skill-bootstrap-task';

// Utility: Check if Trigger.dev is available (re-export from utils)
export { isTriggerAvailable, getExecutionMode, executeWithFallback, scheduleWithTrigger } from './utils';

/**
 * Execute task with automatic Trigger.dev detection
 * Generic wrapper for any task type
 */
export async function executeTask<TPayload, TResult>(
  taskType: 'agent-loop' | 'consensus' | 'research' | 'reflection' | 'dag' | 'skill-bootstrap',
  payload: TPayload
): Promise<TResult> {
  // Dynamically import to avoid cascade errors from @trigger.dev dependencies
  const { getExecutionMode } = await import('./utils');
  const mode = await getExecutionMode();

  console.log(`[Trigger] Executing ${taskType} in ${mode} mode`);

  switch (taskType) {
    case 'agent-loop': {
      const { executeAgentLoopTask } = await import('./agent-loop-task');
      return executeAgentLoopTask(payload as any) as any;
    }
    case 'consensus': {
      const { executeConsensusTask } = await import('./consensus-task');
      return executeConsensusTask(payload as any) as any;
    }
    case 'research': {
      const { executeResearchTask } = await import('./research-task');
      return executeResearchTask(payload as any) as any;
    }
    case 'reflection': {
      const { executeReflectionTask } = await import('./reflection-task');
      return executeReflectionTask(payload as any) as any;
    }
    case 'dag': {
      const { executeDAGTask } = await import('./dag-task');
      return executeDAGTask(payload as any) as any;
    }
    case 'skill-bootstrap': {
      const { executeSkillBootstrapTask } = await import('./skill-bootstrap-task');
      return executeSkillBootstrapTask(payload as any) as any;
    }
    default:
      throw new Error(`Unknown task type: ${taskType}`);
  }
}
