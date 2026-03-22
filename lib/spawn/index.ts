/**
 * AI Coding Agent Services
 * 
 * Containerized remote server implementations for popular AI coding agents.
 * 
 * Supported Agents:
 * - Claude Code (Anthropic) - Advanced coding with file operations
 * - Amp (OpenAI) - Code generation, review, and refactoring
 * - OpenCode - Open-source coding assistant
 * 
 * @example
 * ```typescript
 * import { createAgent, AgentType } from '@/lib/spawn';
 * 
 * // Create Claude Code agent
 * const claude = await createAgent('claude-code', {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   workspaceDir: '/workspace/my-project',
 * });
 * 
 * // Send prompt
 * const result = await claude.prompt({
 *   message: 'Refactor the authentication module',
 * });
 * 
 * // Create Amp agent
 * const amp = await createAgent('amp', {
 *   apiKey: process.env.OPENAI_API_KEY,
 *   workspaceDir: '/workspace/my-project',
 * });
 * 
 * // Generate code
 * const code = await amp.generateCode('A React hook for fetching data');
 * 
 * // Clean up
 * await claude.stop();
 * await amp.stop();
 * ```
 */

// Core service manager
export {
  AgentServiceManager,
  getAgentServiceManager,
  resetAgentServiceManager,
  type AgentType,
  type AgentConfig,
  type AgentInstance,
  type PromptRequest,
  type PromptResponse,
  type AgentEvent,
} from './agent-service-manager';

// Import create functions for internal use
import { createClaudeCodeAgent } from './claude-code-agent';
import { createAmpAgent } from './amp-agent';
import { createOpenCodeAgent } from './opencode-agent';

// Agent Pool
export {
  AgentPool,
  getAgentPool,
  destroyAllPools,
  getAllPoolStats,
  type PoolAgentType,
  type PoolAgent,
  type AgentPoolConfig,
  type PoolStats,
  type PooledAgent,
} from './agent-pool';

// Agent Orchestration & Memory
export {
  AgentTeam,
  createAgentTeam,
  createSpecializedTeam,
  createMemoryAgent,
  AgentMemory,
  createAgentMemory,
  type AgentRole,
  type CollaborationStrategy,
  type TaskStatus,
  type AgentTeamConfig,
  type TeamTask,
  type TeamExecutionResult,
  type TeamProgress,
  type AgentContribution,
  type MemoryType,
  type VectorStoreType,
  type MemoryEntry,
  type MemoryQuery,
  type MemoryResult,
  type ConversationMessage,
  type AgentMemoryConfig,
} from './orchestration';

// Claude Code Agent
export {
  ClaudeCodeAgent,
  createClaudeCodeAgent,
  CLAUDE_CODE_TOOLS,
  type ClaudeCodeConfig,
  type ClaudeCodeMessage,
  type ClaudeCodeTool,
} from './claude-code-agent';

// Amp Agent
export {
  AmpAgent,
  createAmpAgent,
  AMP_TOOLS,
  type AmpConfig,
  type AmpMessage,
  type AmpTool,
} from './amp-agent';

// OpenCode Agent
export {
  OpenCodeAgent,
  createOpenCodeAgent,
  OPENCODE_TOOLS,
  type OpenCodeConfig,
  type OpenCodeMessage,
  type OpenCodeTool,
} from './opencode-agent';

// ============================================================================
// Factory Function
// ============================================================================

import type { AgentConfig } from './agent-service-manager';
import { ClaudeCodeAgent, type ClaudeCodeConfig } from './claude-code-agent';
import { AmpAgent, type AmpConfig } from './amp-agent';
import { OpenCodeAgent, type OpenCodeConfig } from './opencode-agent';

export type AgentTypeUnion = 'claude-code' | 'amp' | 'opencode';

/**
 * Create an AI coding agent
 */
export async function createAgent(
  type: 'claude-code',
  config: Omit<ClaudeCodeConfig, keyof AgentConfig> & Pick<AgentConfig, 'workspaceDir' | 'agentId'>
): Promise<ClaudeCodeAgent>;

export async function createAgent(
  type: 'amp',
  config: Omit<AmpConfig, keyof AgentConfig> & Pick<AgentConfig, 'workspaceDir' | 'agentId'>
): Promise<AmpAgent>;

export async function createAgent(
  type: 'opencode',
  config: Omit<OpenCodeConfig, keyof AgentConfig> & Pick<AgentConfig, 'workspaceDir' | 'agentId'>
): Promise<OpenCodeAgent>;

export async function createAgent(
  type: AgentTypeUnion,
  config: any
): Promise<any> {
  switch (type) {
    case 'claude-code':
      return createClaudeCodeAgent(config as ClaudeCodeConfig);
    case 'amp':
      return createAmpAgent(config as AmpConfig);
    case 'opencode':
      return createOpenCodeAgent(config as OpenCodeConfig);
    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

// ============================================================================
// Agent Comparison
// ============================================================================

/**
 * Agent capabilities comparison
 */
export const AGENT_CAPABILITIES: Record<string, {
  fileOperations: boolean;
  terminalAccess: boolean;
  gitIntegration: boolean;
  webSearch: boolean;
  codeReview: boolean;
  testGeneration: boolean;
  maxContextTokens: number;
}> = {
  'claude-code': {
    fileOperations: true,
    terminalAccess: true,
    gitIntegration: true,
    webSearch: false,
    codeReview: true,
    testGeneration: true,
    maxContextTokens: 200000,
  },
  'amp': {
    fileOperations: true,
    terminalAccess: true,
    gitIntegration: false,
    webSearch: false,
    codeReview: true,
    testGeneration: true,
    maxContextTokens: 128000,
  },
  'opencode': {
    fileOperations: true,
    terminalAccess: true,
    gitIntegration: true,
    webSearch: false,
    codeReview: true,
    testGeneration: true,
    maxContextTokens: 100000,
  },
};

/**
 * Get recommended agent for task
 */
export function getRecommendedAgent(task: string): AgentTypeUnion {
  const taskLower = task.toLowerCase();
  
  // Complex file operations → Claude Code
  if (taskLower.includes('refactor') || taskLower.includes('multiple files')) {
    return 'claude-code';
  }
  
  // Code generation → Amp
  if (taskLower.includes('generate') || taskLower.includes('create') || taskLower.includes('write')) {
    return 'amp';
  }
  
  // Code review → Claude Code
  if (taskLower.includes('review') || taskLower.includes('audit')) {
    return 'claude-code';
  }
  
  // Default → Amp (fastest for general tasks)
  return 'amp';
}

export default createAgent;
