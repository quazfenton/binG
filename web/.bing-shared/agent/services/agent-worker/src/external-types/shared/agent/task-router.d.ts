/**
 * Type declarations for @bing/shared/agent/task-router
 * Stub for agent-worker — mirrors real exports from packages/shared/agent/task-router.ts
 *
 * ⚠️ KEEP IN SYNC: If the real module's exports change, this stub must be updated
 * to match. Otherwise TS errors will silently disappear while runtime breaks.
 */

export type TaskType = 'coding' | 'automation' | 'messaging' | 'advanced' | 'unknown' | 'browsing' | 'api';

export type AdvancedTaskType =
  | 'agent-loop' | 'research' | 'dag-workflow' | 'skill-build'
  | 'consensus' | 'reflection' | 'tool-discover' | 'cross-agent';

export type RoutingTarget = 'opencode' | 'nullclaw' | 'chat' | 'advanced' | 'cli';

export interface TaskRequest {
  task: string;
  userId: string;
  conversationId: string;
  executionPolicy?: string;
  [key: string]: any;
}

export interface TaskRoutingResult {
  type: TaskType;
  target: RoutingTarget;
  confidence: number;
  reasoning: string;
  intentMatch?: any;
}

declare class TaskRouter {
  analyzeTask(task: string): Promise<TaskRoutingResult>;
  analyzeAdvancedTask(task: string): Promise<AdvancedTaskType | null>;
  isSimpleQuery(task: string): boolean;
  executeTask(request: TaskRequest): Promise<any>;
}

export const taskRouter: TaskRouter;
