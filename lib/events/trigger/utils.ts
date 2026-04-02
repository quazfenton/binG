/**
 * Trigger.dev Shared Utilities
 *
 * Common utilities used across all Trigger.dev task wrappers.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Trigger:Utils');

/**
 * Check if Trigger.dev SDK is available
 *
 * @returns true if @trigger.dev/sdk/v3 can be imported
 */
export async function isTriggerAvailable(): Promise<boolean> {
  try {
    await import('@trigger.dev/sdk/v3');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get execution mode (for logging/debugging)
 *
 * @returns 'trigger' if SDK available, 'local' otherwise
 */
export async function getExecutionMode(): Promise<'trigger' | 'local'> {
  const available = await isTriggerAvailable();
  return available ? 'trigger' : 'local';
}

/**
 * Execute with Trigger.dev or fallback to local
 *
 * @param triggerExecute - Function to execute with Trigger.dev
 * @param localExecute - Function to execute locally
 * @param taskName - Task name for logging
 * @returns Result from either execution path
 */
export async function executeWithFallback<TPayload, TResult>(
  triggerExecute: () => Promise<TResult>,
  localExecute: () => Promise<TResult>,
  taskName: string
): Promise<TResult> {
  const available = await isTriggerAvailable();

  if (available) {
    logger.info(`Executing ${taskName} via Trigger.dev`);
    try {
      return await triggerExecute();
    } catch (error: any) {
      logger.warn(`Trigger.dev execution failed, falling back to local: ${error.message}`);
      return await localExecute();
    }
  } else {
    logger.info(`Executing ${taskName} locally (Trigger.dev not available)`);
    return await localExecute();
  }
}

/**
 * Schedule with Trigger.dev (no fallback - scheduling requires Trigger.dev)
 *
 * @param scheduleExecute - Function to schedule the task
 * @param taskName - Task name for logging
 * @returns Scheduling result
 */
export async function scheduleWithTrigger<T>(
  scheduleExecute: () => Promise<T>,
  taskName: string
): Promise<T | { scheduled: false; jobId?: never }> {
  const available = await isTriggerAvailable();

  if (!available) {
    logger.warn(`Cannot schedule ${taskName} - Trigger.dev not available`);
    return { scheduled: false } as T;
  }

  try {
    logger.info(`Scheduling ${taskName} via Trigger.dev`);
    return await scheduleExecute();
  } catch (error: any) {
    logger.error(`Failed to schedule ${taskName}`, error);
    return { scheduled: false } as T;
  }
}
