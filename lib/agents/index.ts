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

// agent-memory moved to deprecated/lib/agents/ on 2026-03-01

export type {
  AgentRole,
  AgentState,
  Task,
  AgentMessage,
  CollaborationResult,
} from './multi-agent-collaboration';
