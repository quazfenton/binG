/**
 * CrewAI Integration Index
 * 
 * Main entry point for CrewAI-based multi-agent orchestration.
 * Reuses all existing tools, state, and checkpointers.
 * 
 * @see https://docs.crewai.com
 */

// Role-based agents
export { RoleAgent } from './agents/role-agent';
export type { RoleAgentConfig, RoleAgentOutput } from './agents/role-agent';

// Memory system
export { CrewMemory, createMemory, ShortTermMemory, EntityMemoryStore, PersistentMemory } from './agents/memory';
export type { MemoryEntry, EntityMemory, MemoryConfig } from './agents/memory';

// Self-healing
export { SelfHealingExecutor, RetryBudget, CrossAgentConsensus, runCrewWithSelfHealing } from './runtime/self-healing';
export type { RetryConfig, AgentRetryState, ConsensusVote, ConsensusResult, HealingStrategy } from './runtime/self-healing';

// Context window
export { ContextWindowManager, createContextWindow } from './runtime/context-window';
export type { Message, ContextWindowConfig } from './runtime/context-window';

// Streaming
export { CrewStreamingOutputImpl, createCrewStream, runCrewWithStreaming } from './runtime/streaming';
export type { StreamChunk, AgentStreamData, ToolStreamData, CrewStreamingOutput } from './runtime/streaming';


// Task system
export { Task } from './tasks/task';
export type { TaskConfig, TaskOutput, FileInput } from './tasks/task';

// Crew orchestration
export { Crew } from './crew/crew';
export type { CrewConfig, CrewOutput, ProcessType, CrewKnowledgeSource } from './crew/crew';

// Events
export * from './crew/events';

// Factory functions
import { Crew } from './crew/crew';
import { Task } from './tasks/task';
import { RoleAgent } from './agents/role-agent';

/**
 * Create a crew with agents and tasks
 */
export function createCrew(config: {
  name: string;
  agents: any[];
  tasks: any[];
  process?: 'sequential' | 'hierarchical';
}): Crew {
  return new Crew({
    agents: config.agents,
    tasks: config.tasks,
    process: config.process || 'sequential',
  });
}


/**
 * Run CrewAI workflow
 */
export async function runCrewAI(options: {
  sessionId: string;
  userMessage: string;
}): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    const { runCrewAIWorkflow } = await import('./runtime/run-crewai');
    const result = await runCrewAIWorkflow({
      sessionId: options.sessionId,
      userMessage: options.userMessage,
    });
    const resultAny = result as any;
    return { success: resultAny.success || true, response: resultAny.response || result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * CrewAI Manager class
 */
export class CrewAIManager {
  private crews: Map<string, Crew> = new Map();
  
  createCrew(id: string, config: {
    name: string;
    agents: any[];
    tasks: any[];
    process?: 'sequential' | 'hierarchical';
  }): Crew {
    const crew = createCrew({ ...config, name: id });
    this.crews.set(id, crew);
    return crew;
  }
  
  getCrew(id: string): Crew | undefined {
    return this.crews.get(id);
  }
  
  deleteCrew(id: string): boolean {
    return this.crews.delete(id);
  }
  
  listCrews(): string[] {
    return Array.from(this.crews.keys());
  }
}

export const crewAIManager = new CrewAIManager();

// Re-export for convenience
export { createCrewAITools as createToolAdapterTools, createAgentWithTools, setDelegationContext, clearDelegationContext } from './tools/tool-adapter';
export type { CrewAIToolAdapter, CrewAIToolDefinition } from './tools/tool-adapter';

// Runtime
export { runCrewAIWorkflow } from './runtime/run-crewai';
export type { CrewAIRunOptions, CrewAIRunResult } from './runtime/run-crewai';

// Model router
export { ModelRouter, modelRouter, createModelRouter } from './runtime/model-router';
export type { ModelTier, ModelConfig, ModelRouterConfig } from './runtime/model-router';

// Knowledge
export { KnowledgeSource, KnowledgeBase, createKnowledgeBase } from './knowledge';
export type { KnowledgeSourceConfig, DocumentChunk, SearchResult, EmbedderConfig } from './knowledge';

// MCP Server
export { MCPServer } from './mcp/server';
export type { MCPTool, MCPServerConfig, MCPRequest, MCPResponse, MCPEvent } from './mcp/server';

// Observability
export { TraceRecorder, MetricsCollector, LangSmithExporter, createObservability } from './observability';
export type { TokenUsage, ExecutionMetrics, Span, Trace } from './observability';

// Tools
export { SerperDevTool, WikipediaTool, DirectorySearchTool, FileReadTool, CodeDocsSearchTool, createToolRegistry } from './tools/crewai-tools';
export { DockerCodeExecutor, createCodeExecutionTool } from './tools/code-execution';
export type { CodeExecutionConfig, ExecutionResult } from './tools/code-execution';

// Swarms
export { MultiCrewSwarm, HierarchicalSwarm, ShardPlanner, AggregatorCrew } from './swarm';
export type { Shard, ShardResult, AggregatorResult, SwarmConfig, SwarmEvent } from './swarm';


// Export types
export * from './types';

// Export callbacks
export { CallbackHandler, createCallbackHandler } from './callbacks';
export type { CallbackHandlers } from './callbacks';

// Export agents factory
export {
  createAgent,
  createResearcherAgent,
  createWriterAgent,
  createCoderAgent,
} from './agents';
export type { AgentConfig } from './agents';

// Export tasks factory
export {
  createTask,
  createResearchTask,
  createWriteTask,
  createCodeTask,
} from './tasks';

