/**
 * Multi-Agent Consensus Task - Trigger.dev Integration
 *
 * Wraps existing agent-team.ts consensus strategy with Trigger.dev for parallel execution.
 * Falls back to local execution when Trigger.dev SDK is not available.
 *
 * @see lib/spawn/orchestration/agent-team.ts - Core multi-agent orchestration
 */

import { createLogger } from '@/lib/utils/logger';
import { executeWithFallback } from './utils';

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
 */
export async function executeConsensusTask(
  payload: ConsensusTaskPayload
): Promise<ConsensusTaskResult> {
  return executeWithFallback(
    () => executeWithTrigger(payload),
    () => executeLocally(payload),
    'consensus'
  );
}

/**
 * Execute with Trigger.dev SDK using parallel execution
 */
async function executeWithTrigger(
  payload: ConsensusTaskPayload
): Promise<ConsensusTaskResult> {
  // For now, execute locally - Trigger.dev v3 SDK integration requires task registration
  logger.warn('Trigger.dev execution requested but not fully configured, using local execution');
  return executeLocally(payload);
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

  return {
    success: true,
    output: result.output,
    consensusScore: result.consensusScore || 0,
    contributions: result.contributions || [],
    votes: result.votes,
  };
}
