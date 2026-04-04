/**
 * Agent Loop Task - Trigger.dev Integration
 *
 * Wraps existing agent-loop.ts with Trigger.dev for persistence and scheduling.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/orchestra/agent-loop.ts - Core agent loop implementation
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback, scheduleWithTrigger } from './utils';

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
  return executeWithFallback(
    () => executeWithTrigger(payload),
    () => executeLocally(payload),
    'agent loop'
  );
}

/**
 * Execute with Trigger.dev SDK
 */
async function executeWithTrigger(
  payload: AgentLoopTaskPayload
): Promise<AgentLoopTaskResult> {
  // For now, execute locally - Trigger.dev v3 SDK integration requires task registration
  logger.warn('Trigger.dev execution requested but not fully configured, using local execution');
  return executeLocally(payload);
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
 */
export async function scheduleAgentLoop(
  payload: Omit<AgentLoopTaskPayload, 'userMessage'> & {
    goal: string;
    schedule: {
      type: 'cron' | 'interval';
      expression: string; // cron expression or interval in ms
    };
  }
): Promise<{ scheduled: boolean; jobId?: string }> {
  // Scheduling requires Trigger.dev to be configured
  logger.warn('Agent loop scheduling not yet available - Trigger.dev configuration required');
  return { scheduled: false };
}
