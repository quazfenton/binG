/**
 * DAG Executor Task - Trigger.dev Integration
 *
 * Wraps existing bash/dag-executor.ts with Trigger.dev for durable workflow execution.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/bash/dag-executor.ts - Core DAG executor
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, invokeTriggerTask, scheduleWithTrigger } from './utils';

const logger = createLogger('Trigger:DAG');

export interface DAGTaskPayload {
  dag: {
    nodes: Array<{
      id: string;
      type: 'bash' | 'tool' | 'container';
      command?: string;
      dependsOn: string[];
      outputs?: string[];
      metadata?: any;
    }>;
    edges: Array<{
      from: string;
      to: string;
    }>;
  };
  agentId: string;
  workingDir: string;
  env?: Record<string, string>;
  maxRetries?: number;
  healOnFailure?: boolean;
  parallel?: boolean;
}

export interface DAGTaskResult {
  success: boolean;
  nodeResults: Record<string, any>;
  outputs: Record<string, string>;
  duration: number;
  errors: Array<{ nodeId: string; error: string; attempt: number }>;
}

/**
 * Execute DAG task with Trigger.dev (when available) or fallback to local
 */
export async function executeDAGTask(
  payload: DAGTaskPayload
): Promise<DAGTaskResult> {
  return executeWithFallback<DAGTaskPayload, DAGTaskResult>(
    async (taskId) => invokeTriggerTask(taskId, payload),
    (p) => executeLocally(p),
    'DAG',
    payload
  );
}

/**
 * Execute locally (fallback)
 */
async function executeLocally(
  payload: DAGTaskPayload
): Promise<DAGTaskResult> {
  const { executeDAGSmart, executeDAGWithRetry } = await import('@/lib/bash/dag-executor');

  const ctx = {
    agentId: payload.agentId,
    workingDir: payload.workingDir,
    env: payload.env,
    results: {},
    optimize: true,
    parallel: payload.parallel !== false,
  };

  let result: any;
  if (payload.maxRetries && payload.maxRetries > 0) {
    result = await executeDAGWithRetry(payload.dag, ctx, payload.maxRetries);
  } else {
    result = await executeDAGSmart(payload.dag, ctx);
  }

  return {
    success: result.success ?? true,
    nodeResults: result.nodeResults || {},
    outputs: result.outputs || {},
    duration: result.duration || 0,
    errors: result.errors || [],
  };
}

/**
 * Schedule recurring DAG execution (for periodic workflows)
 */
export async function scheduleDAGExecution(
  payload: Omit<DAGTaskPayload, 'agentId' | 'workingDir'> & {
    agentId: string;
    workingDir: string;
    schedule: {
      type: 'cron' | 'interval';
      expression: string;
    };
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  const available = await import('./utils').then(m => m.isTriggerAvailable());

  if (available) {
    return scheduleWithTrigger(
      async () => {
        const { invokeTriggerTask } = await import('./utils');
        const result = await invokeTriggerTask('dag-task', payload);
        return { scheduled: true, jobId: (result as any).runId };
      },
      'DAG execution'
    );
  }

  logger.warn('DAG execution scheduling not yet available - Trigger.dev configuration required');
  return { scheduled: false };
}
