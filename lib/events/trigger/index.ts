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
  const mode = await getExecutionMode();

  console.log(`[Trigger] Executing ${taskType} in ${mode} mode`);

  switch (taskType) {
    case 'agent-loop':
      return executeAgentLoopTask(payload as any) as any;
    case 'consensus':
      return executeConsensusTask(payload as any) as any;
    case 'research':
      return executeResearchTask(payload as any) as any;
    case 'reflection':
      return executeReflectionTask(payload as any) as any;
    case 'dag':
      return executeDAGTask(payload as any) as any;
    case 'skill-bootstrap':
      return executeSkillBootstrapTask(payload as any) as any;
    default:
      throw new Error(`Unknown task type: ${taskType}`);
  }
}
