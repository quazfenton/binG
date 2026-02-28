/**
 * Agents Module
 * 
 * Provides multi-agent collaboration and memory systems.
 */

export {
  MultiAgentCollaboration,
  createMultiAgentCollaboration,
  quickCollaborativeExecute,
} from './multi-agent-collaboration';

export {
  AgentMemoryManager,
  createAgentMemoryManager,
  quickAddMemory,
} from './agent-memory';

export type {
  AgentRole,
  AgentState,
  Task,
  AgentMessage,
  CollaborationResult,
} from './multi-agent-collaboration';

export type {
  MemoryItem,
  ContextConfig,
  MemoryRetrievalResult,
} from './agent-memory';
