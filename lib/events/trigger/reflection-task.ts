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
  return executeWithFallback(
    () => executeWithTrigger(payload),
    () => executeLocally(payload),
    'reflection'
  );
}

/**
 * Execute with Trigger.dev SDK
 */
async function executeWithTrigger(
  payload: ReflectionTaskPayload
): Promise<ReflectionTaskResult> {
  // For now, execute locally - Trigger.dev v3 SDK integration requires task registration
  logger.warn('Trigger.dev execution requested but not fully configured, using local execution');
  return executeLocally(payload);
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: ReflectionTaskPayload
): Promise<ReflectionTaskResult> {
  // Build content to reflect on
  const content = JSON.stringify({
    result: payload.result,
    error: payload.error,
    history: payload.history?.slice(-10),
  }, null, 2);

  // Perform reflection
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
  // Scheduling requires Trigger.dev to be configured
  logger.warn('Reflection scheduling not yet available - Trigger.dev configuration required');
  return { scheduled: false };
}
