/**
 * Trigger.dev Shared Utilities
 *
 * Common utilities used across all Trigger.dev task wrappers.
 *
 * v4 SDK note: @trigger.dev/sdk@4.x still exposes the v3 API
 * at the /v3 subpath for backwards compatibility.
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
 * Invoke a registered Trigger.dev task by ID.
 *
 * Uses the Trigger.dev management API to dispatch the task to the
 * Trigger.dev worker. This requires:
 *   - TRIGGER_SECRET_KEY env var set
 *   - TRIGGER_API_URL env var set (defaults to https://api.trigger.dev)
 *
 * Falls back to local execution if the management API is unavailable.
 *
 * @param taskId - The task id (e.g. 'agent-loop')
 * @param payload - Task payload matching the task's input type
 */
export async function invokeTriggerTask<TPayload = any, TResult = any>(
  taskId: string,
  payload: TPayload
): Promise<TResult> {
  const secretKey = process.env.TRIGGER_SECRET_KEY;

  if (!secretKey) {
    // No secret key — fall back to local execution via the caller's fallback
    throw new Error('TRIGGER_SECRET_KEY not set — cannot invoke Trigger.dev task');
  }

  const apiUrl = process.env.TRIGGER_API_URL || 'https://api.trigger.dev';

  // Use the management API to trigger the task
  const response = await fetch(`${apiUrl}/api/v1/tasks/${taskId}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify({ payload }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Trigger.dev task invocation failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  // Management API returns { id: runId, ... } — the task runs asynchronously
  // We return the run handle; the caller can poll for completion if needed
  return { runId: result.id, status: result.status } as unknown as TResult;
}

/**
 * Execute with Trigger.dev or fallback to local
 *
 * Now uses invokeTriggerTask() to dispatch to registered tasks
 * instead of raw invoke(). The triggerExecute callback receives
 * a taskId string — it should call invokeTriggerTask(taskId, payload).
 *
 * @param triggerExecute - Function that invokes a registered task
 * @param localExecute - Function to execute locally
 * @param taskName - Task name for logging
 * @returns Result from either execution path
 */
export async function executeWithFallback<TPayload, TResult>(
  triggerExecute: (taskId: string) => Promise<TResult>,
  localExecute: (payload: TPayload) => Promise<TResult>,
  taskName: string,
  payload: TPayload
): Promise<TResult> {
  const available = await isTriggerAvailable();

  if (available) {
    logger.info(`Executing ${taskName} via Trigger.dev`);
    try {
      return await triggerExecute(taskName);
    } catch (error: any) {
      logger.warn(`Trigger.dev execution failed, falling back to local: ${error.message}`);
      return await localExecute(payload);
    }
  } else {
    logger.info(`Executing ${taskName} locally (Trigger.dev not available)`);
    return await localExecute(payload);
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
