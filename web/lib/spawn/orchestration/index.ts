/**
 * Agent Memory & Orchestration Index
 * 
 * Advanced agent functionality:
 * - Multi-agent teams and orchestration
 * - Persistent memory with RAG
 * - Knowledge graphs
 * - Workflow automation
 */

// Agent Team Orchestration
export {
  AgentTeam,
  createAgentTeam,
  type AgentRole,
  type CollaborationStrategy,
  type TaskStatus,
  type AgentTeamConfig,
  type TeamTask,
  type TeamExecutionResult,
  type TeamProgress,
  type AgentContribution,
} from './agent-team';

// Agent Memory - re-export from memory module
export {
  AgentMemory,
  createAgentMemory,
  type MemoryType,
  type VectorStoreType,
  type MemoryEntry,
  type MemoryQuery,
  type MemoryResult,
  type ConversationMessage,
  type AgentMemoryConfig,
} from '../memory/agent-memory';

// ============================================================================
// Convenience Functions
// ============================================================================

import { createAgentTeam, type AgentTeamConfig } from './agent-team';
import { createAgentMemory, type AgentMemoryConfig } from '../memory/agent-memory';

/**
 * Create a specialized agent team for common workflows
 */
export async function createSpecializedTeam(
  workflow: 'refactor' | 'feature' | 'bugfix' | 'review' | 'docs',
  config: Omit<AgentTeamConfig, 'agents' | 'strategy'>
) {
  const workflowConfigs: Record<string, { agents: AgentTeamConfig['agents']; strategy: any }> = {
    'refactor': {
      agents: [
        { role: 'architect', type: 'claude-code', model: 'claude-opus-4-5-20250929', weight: 2 },
        { role: 'developer', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'reviewer', type: 'amp', model: 'amp-coder-1' },
      ],
      strategy: 'hierarchical',
    },
    'feature': {
      agents: [
        { role: 'architect', type: 'claude-code', model: 'claude-opus-4-5-20250929' },
        { role: 'developer', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'tester', type: 'amp', model: 'amp-coder-1' },
        { role: 'documenter', type: 'opencode', model: 'anthropic/claude-sonnet-4-5-20250929' },
      ],
      strategy: 'relay',
    },
    'bugfix': {
      agents: [
        { role: 'reviewer', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'developer', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'tester', type: 'amp', model: 'amp-coder-1' },
      ],
      strategy: 'collaborative',
    },
    'review': {
      agents: [
        { role: 'reviewer', type: 'claude-code', model: 'claude-opus-4-5-20250929', weight: 2 },
        { role: 'security', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'optimizer', type: 'amp', model: 'amp-coder-1' },
      ],
      strategy: 'consensus',
    },
    'docs': {
      agents: [
        { role: 'documenter', type: 'claude-code', model: 'claude-sonnet-4-5-20250929' },
        { role: 'reviewer', type: 'amp', model: 'amp-coder-1' },
      ],
      strategy: 'relay',
    },
  };

  const workflowConfig = workflowConfigs[workflow];

  return createAgentTeam({
    ...config,
    name: `${workflow}-${Date.now()}`,
    agents: workflowConfig.agents,
    strategy: workflowConfig.strategy as any,
  });
}

/**
 * Create memory-enabled agent wrapper
 */
export async function createMemoryAgent(
  agentConfig: any,
  memoryConfig: Omit<AgentMemoryConfig, 'agentId' | 'workspaceDir'>
) {
  const { createAgent } = await import('../index');
  const { createAgentMemory } = await import('../memory/agent-memory');

  const agent = await createAgent(agentConfig.type, {
    workspaceDir: agentConfig.workspaceDir,
    agentId: agentConfig.agentId,
  } as any);

  const memory = await createAgentMemory({
    ...memoryConfig,
    agentId: agentConfig.agentId || (agent as any).agentId,
    workspaceDir: agentConfig.workspaceDir,
  });

  // Enhanced prompt with memory retrieval
  const originalPrompt = (agent as any).prompt.bind(agent);
  (agent as any).prompt = async (request: any) => {
    // Retrieve relevant memories
    const memories = await memory.retrieve(request.message);

    // Add memory context to prompt
    const enhancedRequest = {
      ...request,
      context: [
        ...(request.context || []),
        'Relevant context from memory:',
        ...memories.map(m => `- ${m.entry.content}`),
      ],
    };

    const result = await originalPrompt(enhancedRequest);

    // Store conversation
    await memory.addMessage({
      role: 'user',
      content: request.message,
    });

    await memory.addMessage({
      role: 'assistant',
      content: result.response,
      toolCalls: result.toolCalls,
    });

    // Store code patterns if files modified
    if (result.filesModified && result.filesModified.length > 0) {
      for (const file of result.filesModified) {
        await memory.store({
          type: 'code',
          content: `Modified ${file.path}: ${file.action}`,
          metadata: {
            file: file.path,
            tags: ['code', file.action],
            importance: 0.7,
          },
        });
      }
    }

    return result;
  };

  return { agent, memory };
}

export default {
  createAgentTeam,
  createSpecializedTeam,
  createMemoryAgent,
};
