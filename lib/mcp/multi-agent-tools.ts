/**
 * Multi-Agent Orchestration MCP Tools
 *
 * MCP tools for coordinating multiple AI agents:
 * - Create agent sessions
 * - Coordinate agents
 * - Get agent results
 * - Multi-agent debate/consensus
 *
 * @module mcp/multi-agent-tools
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '@/lib/utils/logger';
import type { AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';

const logger = createLogger('MCP:MultiAgent');

/**
 * Agent session info
 */
export interface AgentSession {
  id: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  agents: AgentInfo[];
  result?: any;
}

/**
 * Agent info
 */
export interface AgentInfo {
  id: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
}

/**
 * Register multi-agent MCP tools
 */
export function registerMultiAgentTools(server: McpServer): void {
  logger.info('Registering multi-agent MCP tools');

  // Create agent session
  server.registerTool(
    'create_agent_session',
    {
      description: 'Create a new multi-agent session for complex task coordination',
      inputSchema: {
        goal: { type: 'string', description: 'Overall goal for the agent session' },
        mode: {
          type: 'string',
          description: 'Coordination mode: sequential, parallel, debate, consensus',
          enum: ['sequential', 'parallel', 'debate', 'consensus'],
        },
        agents: {
          type: 'array',
          description: 'Agent roles to create',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'Agent role (planner, executor, critic, etc.)' },
              model: { type: 'string', description: 'LLM model for this agent' },
            },
            required: ['role'],
          },
        },
      } as unknown as AnySchema,
    },
    async ({ goal, mode = 'sequential', agents = [] }) => {
      try {
        const { spawnAgent } = await import('@/lib/spawn');

        // Create session ID
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Spawn agents
        const agentInfos: AgentInfo[] = [];

        for (const agentConfig of agents) {
          const agent = await spawnAgent({
            task: `${agentConfig.role}: ${goal}`,
            model: agentConfig.model || 'anthropic/claude-3-5-sonnet',
            executionPolicy: 'sandbox-required',
          });

          agentInfos.push({
            id: agent.id,
            role: agentConfig.role,
            status: 'running',
          });
        }

        // If no agents specified, create default roles
        if (agentInfos.length === 0) {
          const defaultRoles = ['planner', 'executor', 'critic'];

          for (const role of defaultRoles) {
            const agent = await spawnAgent({
              task: `${role}: ${goal}`,
              model: 'anthropic/claude-3-5-sonnet',
              executionPolicy: 'sandbox-required',
            });

            agentInfos.push({
              id: agent.id,
              role,
              status: 'running',
            });
          }
        }

        const session: AgentSession = {
          id: sessionId,
          goal,
          status: 'running',
          createdAt: Date.now(),
          agents: agentInfos,
        };

        // Store session (in production, use database)
        storeSession(session);

        logger.info('Created agent session', { sessionId, mode, agents: agentInfos.length });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                sessionId,
                mode,
                agents: agentInfos.map(a => ({ id: a.id, role: a.role })),
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Failed to create agent session', { error: error.message });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to create session: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get session status
  server.registerTool(
    'get_agent_session_status',
    {
      description: 'Get status of a multi-agent session',
      inputSchema: {
        sessionId: { type: 'string', description: 'Session ID' },
      } as unknown as AnySchema,
    },
    async ({ sessionId }) => {
      try {
        const session = getSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        // Update agent statuses
        const { getAgentServiceManager } = await import('@/lib/spawn');
        const manager = getAgentServiceManager();

        for (const agent of session.agents) {
          try {
            const agentStatus = manager.getAgent(agent.id);
            if (agentStatus) {
              agent.status = agentStatus.status as any;
              agent.output = agentStatus.lastOutput;
            }
          } catch {
            agent.status = 'failed';
          }
        }

        // Check if all agents completed
        const allCompleted = session.agents.every(a => a.status === 'completed');
        const anyFailed = session.agents.some(a => a.status === 'failed');

        if (allCompleted || anyFailed) {
          session.status = allCompleted ? 'completed' : 'failed';
          storeSession(session);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                sessionId: session.id,
                goal: session.goal,
                status: session.status,
                agents: session.agents.map(a => ({
                  id: a.id,
                  role: a.role,
                  status: a.status,
                  output: a.output,
                })),
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Failed to get session status', { error: error.message });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get status: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Coordinate agents (send task to multiple agents)
  server.registerTool(
    'coordinate_agents',
    {
      description: 'Send coordinated task to multiple agents in a session',
      inputSchema: {
        sessionId: { type: 'string', description: 'Session ID' },
        task: { type: 'string', description: 'Task to coordinate' },
        coordinationMode: {
          type: 'string',
          description: 'How to coordinate: broadcast, sequential, parallel',
          enum: ['broadcast', 'sequential', 'parallel'],
        },
      } as unknown as AnySchema,
    },
    async ({ sessionId, task, coordinationMode = 'broadcast' }) => {
      try {
        const session = getSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        const { getAgentServiceManager } = await import('@/lib/spawn');
        const manager = getAgentServiceManager();

        const results: Record<string, any> = {};

        switch (coordinationMode) {
          case 'broadcast':
            // Send same task to all agents
            for (const agent of session.agents) {
              try {
                await manager.sendPrompt(agent.id, task);
                results[agent.id] = { status: 'sent' };
              } catch (error: any) {
                results[agent.id] = { status: 'failed', error: error.message };
              }
            }
            break;

          case 'sequential':
            // Send to agents in order, waiting for each to complete
            for (const agent of session.agents) {
              try {
                const result = await manager.sendPrompt(agent.id, task);
                results[agent.id] = { status: 'completed', output: result };
              } catch (error: any) {
                results[agent.id] = { status: 'failed', error: error.message };
                break;
              }
            }
            break;

          case 'parallel':
            // Send to all agents and wait for all to complete
            const promises = session.agents.map(async agent => {
              try {
                const result = await manager.sendPrompt(agent.id, task);
                results[agent.id] = { status: 'completed', output: result };
              } catch (error: any) {
                results[agent.id] = { status: 'failed', error: error.message };
              }
            });

            await Promise.all(promises);
            break;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                sessionId,
                coordinationMode,
                results,
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Failed to coordinate agents', { error: error.message });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to coordinate: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Get agent result
  server.registerTool(
    'get_agent_result',
    {
      description: 'Get result from a specific agent in a session',
      inputSchema: {
        sessionId: { type: 'string', description: 'Session ID' },
        agentId: { type: 'string', description: 'Agent ID' },
      } as unknown as AnySchema,
    },
    async ({ sessionId, agentId }) => {
      try {
        const session = getSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        const agent = session.agents.find(a => a.id === agentId);

        if (!agent) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Agent not found: ${agentId}`,
              },
            ],
            isError: true,
          };
        }

        const { getAgentServiceManager } = await import('@/lib/spawn');
        const manager = getAgentServiceManager();

        const agentStatus = manager.getAgent(agentId);

        if (!agentStatus) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Agent status unavailable: ${agentId}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                sessionId,
                agentId,
                role: agent.role,
                status: agentStatus.status,
                output: agentStatus.lastOutput,
                progress: agentStatus.progress,
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Failed to get agent result', { error: error.message });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get result: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Multi-agent debate/consensus
  server.registerTool(
    'agent_debate',
    {
      description: 'Facilitate debate between agents to reach consensus on a topic',
      inputSchema: {
        sessionId: { type: 'string', description: 'Session ID' },
        topic: { type: 'string', description: 'Topic to debate' },
        rounds: { type: 'number', description: 'Number of debate rounds', default: 3 },
      } as unknown as AnySchema,
    },
    async ({ sessionId, topic, rounds = 3 }) => {
      try {
        const session = getSession(sessionId);

        if (!session) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Session not found: ${sessionId}`,
              },
            ],
            isError: true,
          };
        }

        const { getAgentServiceManager } = await import('@/lib/spawn');
        const manager = getAgentServiceManager();

        const debateHistory: string[] = [];

        // Run debate rounds
        for (let round = 1; round <= rounds; round++) {
          const roundArguments: Record<string, string> = {};

          // Each agent presents their argument
          for (const agent of session.agents) {
            const prompt = `Round ${round}: Present your argument on: ${topic}\n\nPrevious arguments:\n${debateHistory.join('\n')}`;

            try {
              const result = await manager.sendPrompt(agent.id, prompt);
              roundArguments[agent.role] = result.output;
              debateHistory.push(`${agent.role} (Round ${round}): ${result.output}`);
            } catch (error: any) {
              logger.warn('Agent debate error', { agent: agent.id, error: error.message });
            }
          }
        }

        // Reach consensus
        const consensusPrompt = `Based on the debate, reach a consensus on: ${topic}\n\nDebate history:\n${debateHistory.join('\n')}\n\nProvide a unified conclusion that incorporates the best arguments from all perspectives.`;

        const consensusResults: Record<string, string> = {};

        for (const agent of session.agents) {
          try {
            const result = await manager.sendPrompt(agent.id, consensusPrompt);
            consensusResults[agent.role] = result.output;
          } catch {
            // Ignore individual failures
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                sessionId,
                topic,
                rounds,
                debateHistory,
                consensusResults,
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Failed to facilitate debate', { error: error.message });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to debate: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// In-memory session store (use database in production)
const sessions = new Map<string, AgentSession>();

function storeSession(session: AgentSession): void {
  sessions.set(session.id, session);
}

function getSession(sessionId: string): AgentSession | undefined {
  return sessions.get(sessionId);
}
