/**
 * Reflection Task - Trigger.dev Integration
 *
 * Wraps existing reflection-engine.ts with Trigger.dev for post-execution analysis.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/orchestra/reflection-engine.ts - Core reflection engine
 */

import { createLogger } from '@/lib/utils/logger';
import { reflectionEngine } from '@/lib/orchestra/reflection-engine';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:Reflection');

export interface ReflectionTaskPayload {
  executionId: string;
  result: any;
  error?: string;
  history?: Array<{
    action: string;
    result: any;
    timestamp: number;
  }>;
  enableLLM?: boolean;
}

export interface ReflectionTaskResult {
  analysis: string;
  improvements: string[];
  overallScore: number;
  confidenceLevel: number;
  timestamp: number;
}

/**
 * Execute reflection task with Trigger.dev (when available) or fallback to local
 */
export async function executeReflectionTask(
  payload: ReflectionTaskPayload
): Promise<ReflectionTaskResult> {
  return executeWithFallback<ReflectionTaskPayload, ReflectionTaskResult>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'reflection',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: ReflectionTaskPayload
): Promise<ReflectionTaskResult> {
  const content = JSON.stringify({
    result: payload.result,
    error: payload.error,
    history: payload.history?.slice(-10),
  }, null, 2);

  const reflections = await reflectionEngine.reflect(content);
  const summary = reflectionEngine.synthesizeReflections(reflections);

  return {
    analysis: summary.overallScore > 0.8
      ? 'Execution successful, minor improvements possible'
      : payload.error
      ? `Error analysis: ${payload.error}`
      : 'Execution needs improvement',
    improvements: summary.prioritizedImprovements || [],
    overallScore: summary.overallScore,
    confidenceLevel: summary.confidenceLevel,
    timestamp: Date.now(),
  };
}

/**
 * Schedule automatic reflection after task execution
 */
export async function scheduleReflection(
  payload: Omit<ReflectionTaskPayload, 'executionId'> & {
    triggerEventId: string;
    delayMs?: number;
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    return scheduleWithTrigger(
      async () => {
        const { invokeTriggerTask } = await import('./utils');
        const result = await invokeTriggerTask('reflection-task', payload);
        return { scheduled: true, jobId: (result as any).runId };
      },
      'reflection'
    );
  }

  logger.warn('Reflection scheduling not yet available - Trigger.dev configuration required');
  return { scheduled: false };
}
