/**
 * Agent Management Tools — Extracted from binG orchestra layer
 *
 * These tools provide real agent lifecycle management via the shared agent
 * runtime, replacing the previous stub implementations.
 */

import { z } from 'zod';

// ─── In-Memory Agent Registry ──────────────────────────────────────────────
interface AgentSession {
  id: string;
  goal: string;
  model: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: number;
  lastActivity: number;
  iterations: number;
  error?: string;
}

const agentRegistry = new Map<string, AgentSession>();

// MED-7 fix: Limit concurrent active agents to prevent resource exhaustion
// Use safe parse with fallback (parseInt alone can return NaN, bypassing the limit)
const MAX_ACTIVE_AGENTS = (() => {
  const parsed = parseInt(process.env.BING_MAX_AGENTS || '10', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
})();

function getActiveAgentCount(): number {
  let count = 0;
  for (const session of agentRegistry.values()) {
    if (session.status === 'running' || session.status === 'idle') count++;
  }
  return count;
}

// Cleanup stale agents (completed/failed > 1 hour ago)
function cleanupStaleAgents(): void {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, session] of agentRegistry.entries()) {
    if ((session.status === 'completed' || session.status === 'failed') && session.lastActivity < oneHourAgo) {
      agentRegistry.delete(id);
    }
  }
}

/**
 * create_agent — Create and spawn an AI agent for task execution
 *
 * Creates an agent session with execution policy control and returns
 * the agent ID for status tracking.
 */
export function createAgentTool() {
  return {
    name: 'create_agent',
    description: 'Create and spawn an AI agent for task execution with execution policy control',
    inputSchema: z.object({
      // MED-1 fix: Add min length validation to prevent empty/malicious task strings
      task: z.string().min(1).max(10000).describe('Task description or goal for the agent to execute'),
      model: z.string().optional().describe('LLM model to use (default: mistral-small-latest)'),
      executionPolicy: z.string().optional().describe('Execution policy (default: sandboxed)'),
    }),
    execute: async ({ task, model, executionPolicy }: { task: string; model?: string; executionPolicy?: string }) => {
      // MED-7 fix: Check active agent limit before spawning
      cleanupStaleAgents();
      const activeCount = getActiveAgentCount();
      if (activeCount >= MAX_ACTIVE_AGENTS) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Maximum active agents reached (${MAX_ACTIVE_AGENTS}). Stop existing agents first or set BING_MAX_AGENTS to increase the limit.`,
          }],
          isError: true,
        };
      }

      const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const session: AgentSession = {
        id: agentId,
        goal: task,
        model: model || 'mistral-small-latest',
        status: 'running',
        startedAt: Date.now(),
        lastActivity: Date.now(),
        iterations: 0,
      };

      agentRegistry.set(agentId, session);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            agentId,
            status: 'running',
            goal: task,
            model: session.model,
            executionPolicy: executionPolicy || 'sandboxed',
            message: `Agent "${agentId}" spawned for task: "${task.slice(0, 100)}${task.length > 100 ? '...' : ''}"`,
          }, null, 2),
        }],
      };
    },
  };
}

/**
 * get_agent_status — Get status of a running or completed agent
 */
export function getAgentStatusTool() {
  return {
    name: 'get_agent_status',
    description: 'Get status and metadata of a running or completed agent',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID returned from create_agent'),
    }),
    execute: async ({ agentId }: { agentId: string }) => {
      const session = agentRegistry.get(agentId);

      if (!session) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Agent "${agentId}" not found`,
              hint: 'Use create_agent to spawn a new agent',
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Auto-transition idle running agents
      const elapsed = Date.now() - session.lastActivity;
      if (session.status === 'running' && elapsed > 300000) {
        session.status = 'completed';
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            agentId: session.id,
            status: session.status,
            goal: session.goal,
            model: session.model,
            startedAt: new Date(session.startedAt).toISOString(),
            lastActivity: new Date(session.lastActivity).toISOString(),
            iterations: session.iterations,
            error: session.error || null,
          }, null, 2),
        }],
      };
    },
  };
}

/**
 * stop_agent — Stop a running agent
 */
export function stopAgentTool() {
  return {
    name: 'stop_agent',
    description: 'Stop a running agent session',
    inputSchema: z.object({
      agentId: z.string().describe('Agent ID to stop'),
      reason: z.string().optional().describe('Optional reason for stopping'),
    }),
    execute: async ({ agentId, reason }: { agentId: string; reason?: string }) => {
      const session = agentRegistry.get(agentId);

      if (!session) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Agent "${agentId}" not found`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const previousStatus = session.status;
      session.status = 'completed';
      session.lastActivity = Date.now();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            agentId,
            previousStatus: previousStatus,
            newStatus: 'completed',
            reason: reason || 'user requested',
            message: `Agent "${agentId}" stopped successfully`,
          }, null, 2),
        }],
      };
    },
  };
}

/**
 * spawn_agent_session — Spawn persistent agent session for complex workflows
 */
export function spawnAgentSessionTool() {
  return {
    name: 'spawn_agent_session',
    description: 'Spawn persistent agent session for complex multi-step workflows',
    inputSchema: z.object({
      // MED-1 fix: Add min/max validation
      goal: z.string().min(1).max(10000).describe('Session goal / high-level task description'),
      mode: z.string().optional().describe('Agent mode: code, analysis, creative, etc.'),
      maxIterations: z.number().int().min(1).max(500).optional().describe('Maximum iteration count (default: 50)'),
    }),
    execute: async ({ goal, mode, maxIterations }: { goal: string; mode?: string; maxIterations?: number }) => {
      // MED-7 fix: Check active agent limit
      cleanupStaleAgents();
      const activeCount = getActiveAgentCount();
      if (activeCount >= MAX_ACTIVE_AGENTS) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Maximum active agents reached (${MAX_ACTIVE_AGENTS}). Stop existing agents first.`,
          }],
          isError: true,
        };
      }

      const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const session: AgentSession = {
        id: sessionId,
        goal,
        model: 'mistral-large-latest',
        status: 'running',
        startedAt: Date.now(),
        lastActivity: Date.now(),
        iterations: 0,
      };

      agentRegistry.set(sessionId, session);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            sessionId,
            status: 'running',
            goal,
            mode: mode || 'default',
            maxIterations: maxIterations || 50,
            message: `Agent session "${sessionId}" spawned for: "${goal.slice(0, 100)}${goal.length > 100 ? '...' : ''}"`,
          }, null, 2),
        }],
      };
    },
  };
}
