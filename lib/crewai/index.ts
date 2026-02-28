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
export { SelfHealingExecutor, RetryBudget, CrossAgentConsensus, createSelfHealingExecutor } from './runtime/self-healing';
export type { RetryConfig, AgentRetryState, ConsensusVote, ConsensusResult, HealingStrategy } from './runtime/self-healing';

// Context window
export { ContextWindowManager, createContextWindowManager } from './runtime/context-window';
export type { Message, ContextWindowConfig } from './runtime/context-window';
export { createStreamingOutput } from './runtime/context-window';

// Streaming
export { CrewStreamingOutputImpl, streamToAsyncIterable } from './runtime/streaming';
export type { StreamChunk, AgentStreamData, ToolStreamData, CrewStreamingOutput } from './runtime/streaming';

// Task system
export { Task } from './tasks/task';
export type { TaskConfig, TaskOutput, FileInput } from './tasks/task';

// Crew orchestration
export { Crew } from './crew/crew';
export type { CrewConfig, CrewOutput, ProcessType, StreamChunk, CrewKnowledgeSource } from './crew/crew';

// Events
export * from './crew/events';

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
export { MCPServer, createMCPServer, MCPErrorCodes } from './mcp/server';
export type { MCPTool, MCPServerConfig, MCPRequest, MCPResponse, MCPEvent } from './mcp/server';

// Observability
export { ObservabilityManager, TraceRecorder, MetricsCollector, LangSmithExporter, createObservability } from './observability';
export type { TokenUsage, ExecutionMetrics, Span, Trace } from './observability';

// Tools
export { SerperDevTool, WikipediaTool, DirectorySearchTool, FileReadTool, CodeDocsSearchTool, createCrewAITools as createSearchTools, getToolByName } from './tools/crewai-tools';
export { DockerCodeExecutor, CodeInterpreterTool, createCodeExecutor } from './tools/code-execution';
export type { CodeExecutionConfig, ExecutionResult } from './tools/code-execution';

// Swarms
export { MultiCrewSwarm, HierarchicalSwarm, ShardPlanner, AggregatorCrew, createSwarm } from './swarm';
export type { Shard, ShardResult, AggregatorResult, SwarmConfig, SwarmEvent } from './swarm';
