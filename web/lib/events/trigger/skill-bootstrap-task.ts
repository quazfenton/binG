/**
 * Skill Bootstrap Task - Trigger.dev Integration
 *
 * Wraps existing skill extraction logic with Trigger.dev for durable skill creation.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/events/handlers/bing-handlers.ts:handleSkillBootstrap - Core skill extraction
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:SkillBootstrap');

export interface SkillBootstrapTaskPayload {
  successfulRun: {
    steps: Array<{
      action: string;
      result: any;
      success: boolean;
    }>;
    totalDuration: number;
    userId: string;
  };
  abstractionLevel?: 'simple' | 'moderate' | 'complex';
  model?: string;
  storeSkill?: boolean;
}

export interface ExtractedSkill {
  name: string;
  description: string;
  parameters: Record<string, any>;
  implementation: string;
  category: string;
  tags: string[];
}

export interface SkillBootstrapTaskResult {
  success: boolean;
  skillId?: string;
  skill: ExtractedSkill;
  abstractionLevel: string;
}

/**
 * Execute skill bootstrap task with Trigger.dev (when available) or fallback to local
 */
export async function executeSkillBootstrapTask(
  payload: SkillBootstrapTaskPayload
): Promise<SkillBootstrapTaskResult> {
  return executeWithFallback<SkillBootstrapTaskPayload, SkillBootstrapTaskResult>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'skill bootstrap',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: SkillBootstrapTaskPayload
): Promise<SkillBootstrapTaskResult> {
  const { handleSkillBootstrap } = await import('@/lib/events/handlers/bing-handlers');

  const mockEvent = {
    id: `skill-${Date.now()}`,
    type: 'SKILL_BOOTSTRAP' as const,
    userId: payload.successfulRun.userId,
    payload: {
      successfulRun: payload.successfulRun,
      model: payload.model,
    },
    createdAt: Date.now().toString(),
    status: 'pending' as const,
    retryCount: 0,
  };

  const result = await handleSkillBootstrap(mockEvent);

  return {
    success: result.success,
    skillId: result.skillId,
    skill: result.skill,
    abstractionLevel: payload.abstractionLevel || 'moderate',
  };
}

/**
 * Schedule automatic skill extraction after successful task
 */
export async function scheduleSkillBootstrap(
  payload: {
    successfulRun: SkillBootstrapTaskPayload['successfulRun'];
    triggerEventId: string;
    model?: string;
    delayMs?: number;
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    return scheduleWithTrigger(
      async () => {
        const { invokeTriggerTask } = await import('./utils');
        const result = await invokeTriggerTask('skill-bootstrap', payload);
        return { scheduled: true, jobId: (result as any).runId };
      },
      'skill bootstrap'
    );
  }

  // Fallback: use the internal event bus
  try {
    const { emitEvent } = await import('@/lib/events/bus');

    const result = await emitEvent({
      type: 'SKILL_BOOTSTRAP',
      userId: payload.successfulRun.userId,
      payload: {
        successfulRun: payload.successfulRun,
        model: payload.model,
        storeSkill: true,
        scheduled: true,
        sourceEventId: payload.triggerEventId,
      },
    }, payload.successfulRun.userId);

    logger.info('Skill bootstrap scheduled via event system', {
      eventId: result.eventId,
      triggerEventId: payload.triggerEventId,
    });

    return { scheduled: true, jobId: result.eventId };
  } catch (error: any) {
    logger.error('Failed to schedule skill bootstrap', { error: error.message });
    return { scheduled: false };
  }
}
