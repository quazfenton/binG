/**
 * LangGraph Integration Index
 * 
 * Main entry point for LangGraph-based orchestration.
 * Reuses all existing tools, state, and checkpointers.
 */

// State definitions
export { AgentState, vfsStateToAgentState, agentStateToVfsState } from './state';
export type { AgentStateType } from './state';

// Graph nodes
export {
  plannerNode,
  executorNode,
  verifierNode,
  selfHealingNode,
  verifierRouter,
  selfHealingRouter,
} from './nodes';

// graph.ts moved to deprecated/lib/langgraph/ on 2026-03-01
// Agent graph orchestration uses lib/mastra/ and lib/stateful-agent/ instead

// Re-export for convenience
export { createCheckpointer } from '../stateful-agent/commit/shadow-commit';
