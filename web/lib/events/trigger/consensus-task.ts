/**
 * Multi-Agent Consensus Task - Trigger.dev Integration
 *
 * Wraps existing agent-team.ts consensus strategy with Trigger.dev for parallel execution.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/spawn/orchestration/agent-team.ts - Core multi-agent orchestration
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:Consensus');

export interface ConsensusTaskPayload {
  task: string;
  agents: Array<{
    id: string;
    role: string;
    type: string;
    model?: string;
    weight?: number;
  }>;
  workspaceDir: string;
  maxIterations?: number;
  timeout?: number;
  consensusThreshold?: number;
}

export interface ConsensusTaskResult {
  success: boolean;
  output: string;
  consensusScore: number;
  contributions: Array<{ agentId: string; contribution: string }>;
  votes?: Array<{ agentId: string; vote: string }>;
}

/**
 * Execute consensus task with Trigger.dev (when available) or fallback to local
 *
 * Note: When Trigger.dev is used, the task runs asynchronously and the
 * returned value is a run handle `{ runId, status }` rather than the
 * full ConsensusTaskResult. Use the run ID to poll for completion.
 */
export async function executeConsensusTask(
  payload: ConsensusTaskPayload
): Promise<ConsensusTaskResult | { runId: string; status: string }> {
  return executeWithFallback<ConsensusTaskPayload, ConsensusTaskResult | { runId: string; status: string }>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'consensus-task',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: ConsensusTaskPayload
): Promise<ConsensusTaskResult> {
  const { createAgentTeam } = await import('@/lib/spawn/orchestration/agent-team');

  const team = await createAgentTeam({
    name: 'Consensus Team',
    agents: payload.agents.map(a => ({
      role: a.role as any,
      type: a.type as any,
      model: a.model,
      weight: a.weight,
    })),
    workspaceDir: payload.workspaceDir,
    strategy: 'consensus',
    maxIterations: payload.maxIterations || 3,
    timeout: payload.timeout || 60000,
  });

  const result = await team.execute({
    task: payload.task,
  });

  const transformedContributions = (result.contributions || []).map(c => ({
    agentId: c.role || 'unknown',
    contribution: c.content || '',
  }));

  return {
    success: true,
    output: result.output,
    consensusScore: result.consensusScore || 0,
    contributions: transformedContributions,
  };
}

/**
 * Schedule recurring consensus task (for periodic multi-agent deliberation)
 *
 * Creates a recurring schedule via Trigger.dev's schedule API when available.
 */
export async function scheduleConsensusTask(
  payload: Omit<ConsensusTaskPayload, 'task'> & {
    task: string;
    schedule: { type: 'cron' | 'interval'; expression: string };
  }
): Promise<{ scheduled: boolean; scheduleId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    const secretKey = process.env.TRIGGER_SECRET_KEY;
    const apiUrl = process.env.TRIGGER_API_URL || 'https://api.trigger.dev';

    if (!secretKey) {
      logger.warn('Cannot schedule consensus task: TRIGGER_SECRET_KEY not set');
      return { scheduled: false };
    }

    try {
      const response = await fetch(`${apiUrl}/api/v1/tasks/consensus-task/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secretKey}`,
        },
        body: JSON.stringify({
          type: payload.schedule.type === 'cron' ? 'cron' : 'interval',
          cron: payload.schedule.type === 'cron' ? payload.schedule.expression : undefined,
          seconds: payload.schedule.type === 'interval' ? parseInt(payload.schedule.expression, 10) : undefined,
          payload,
        }),
      });

      if (!response.ok) {
        throw new Error(`Schedule creation failed: ${response.status}`);
      }

      const scheduleData = await response.json();
      logger.info('Consensus task scheduled', { scheduleId: scheduleData.id });
      return { scheduled: true, scheduleId: scheduleData.id };
    } catch (error: any) {
      logger.error('Failed to schedule consensus task', error);
      return { scheduled: false };
    }
  }

  logger.warn('Consensus scheduling not yet available - Trigger.dev configuration required', {
    schedule: payload.schedule,
  });
  return { scheduled: false };
}
