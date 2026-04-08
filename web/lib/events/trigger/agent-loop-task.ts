/**
 * Agent Loop Task - Trigger.dev Integration
 *
 * Wraps existing agent-loop.ts with Trigger.dev for persistence and scheduling.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/orchestra/agent-loop.ts - Core agent loop implementation
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:AgentLoop');

export interface AgentLoopTaskPayload {
  agentId: string;
  userMessage: string;
  sandboxId: string;
  userId?: string;
  conversationHistory?: any[];
  maxSteps?: number;
  checkpointInterval?: number;
}

export interface AgentLoopTaskResult {
  response: string;
  totalSteps: number;
  steps: Array<{ toolName: string; args: any; result: any }>;
}

/**
 * Execute agent loop with Trigger.dev (when available) or fallback to local
 */
export async function executeAgentLoopTask(
  payload: AgentLoopTaskPayload
): Promise<AgentLoopTaskResult> {
  return executeWithFallback<AgentLoopTaskPayload, AgentLoopTaskResult>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'agent-loop',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: AgentLoopTaskPayload
): Promise<AgentLoopTaskResult> {
  const { runAgentLoop } = await import('@/lib/orchestra/agent-loop');

  return await runAgentLoop({
    userMessage: payload.userMessage,
    sandboxId: payload.sandboxId,
    userId: payload.userId,
    conversationHistory: payload.conversationHistory,
  });
}

/**
 * Schedule recurring agent loop (for persistent cognition)
 * Falls back to local scheduling via the event store when Trigger.dev is unavailable.
 */
export async function scheduleAgentLoop(
  payload: Omit<AgentLoopTaskPayload, 'userMessage'> & {
    goal: string;
    schedule: {
      type: 'cron' | 'interval';
      expression: string;
    };
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    // Trigger.dev v3 doesn't expose programmatic scheduling via SDK.
    // Use invoke to dispatch the task once; for true recurring schedules,
    // configure the schedule in the Trigger.dev dashboard or trigger.config.ts.
    return scheduleWithTrigger(
      async () => {
        const { invokeTriggerTask } = await import('./utils');
        const result = await invokeTriggerTask('agent-loop', {
          ...payload,
          userMessage: payload.goal,
        });
        return { scheduled: true, jobId: (result as any).runId };
      },
      'agent loop'
    );
  }

  // Fallback: use local scheduler via the event store
  logger.info('Scheduling agent loop locally (Trigger.dev not available)', {
    scheduleType: payload.schedule.type,
    expression: payload.schedule.expression,
  });

  try {
    const { createEvent } = await import('../store');
    const event = await createEvent({
      type: 'SCHEDULED_TASK',
      taskType: 'CUSTOM',
      userId: payload.userId || 'system',
      payload: {
        taskId: 'agent-loop',
        goal: payload.goal,
        agentId: payload.agentId,
        schedule: payload.schedule,
      },
    });

    return { scheduled: true, jobId: event.id };
  } catch (error: any) {
    logger.error('Failed to schedule agent loop locally', error);
    return { scheduled: false };
  }
}
