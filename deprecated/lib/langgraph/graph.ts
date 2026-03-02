/**
 * LangGraph Agent Graph
 * 
 * Compiles the agent workflow graph with existing checkpointers.
 * Reuses all existing state management and tools.
 * 
 * @see {@link ./state} State definitions
 * @see {@link ./nodes} Graph nodes
 */

import { StateGraph, END } from '@langchain/langgraph';
import type { AgentStateType } from './state';
import { AgentState } from './state';
import {
  plannerNode,
  executorNode,
  verifierNode,
  selfHealingNode,
  verifierRouter,
  selfHealingRouter,
} from './nodes';
import { createCheckpointer } from '@/lib/stateful-agent/checkpointer';

/**
 * Create and compile the agent graph
 * 
 * @returns Compiled graph ready for execution
 * 
 * @example
 * ```typescript
 * const graph = await createAgentGraph();
 * const result = await graph.invoke({
 *   messages: [{ role: 'user', content: 'Create a React component' }],
 *   sessionId: 'session-123',
 * });
 * ```
 */
export async function createAgentGraph() {
  // Create graph with state definition
  const graphBuilder = new StateGraph<AgentStateType>({
    channels: AgentState,
  });

  // Add nodes (all reuse existing StatefulAgent logic)
  graphBuilder.addNode('planner', plannerNode);
  graphBuilder.addNode('executor', executorNode);
  graphBuilder.addNode('verifier', verifierNode);
  graphBuilder.addNode('self-healing', selfHealingNode);

  // Define edges (explicit workflow)
  graphBuilder.addEdge('planner', 'executor');
  graphBuilder.addEdge('executor', 'verifier');
  
  // Conditional edges for retry loops
  graphBuilder.addConditionalEdges('verifier', verifierRouter, [
    'self-healing',
    'end',
  ]);
  graphBuilder.addConditionalEdges('self-healing', selfHealingRouter, [
    'self-healing',
    'verifier',
    'end',
  ]);

  // Set entry and exit points
  graphBuilder.setEntryPoint('planner');
  graphBuilder.addEdge('verifier', END);

  // Compile with existing checkpointer
  const checkpointer = await createCheckpointer();
  
  return graphBuilder.compile({
    checkpointer,
    interruptBefore: ['executor'], // Optional: approve before execution
  });
}

/**
 * Run agent with LangGraph orchestration
 * 
 * @param userMessage - User's request
 * @param options - Agent options
 * @returns Agent execution result
 * 
 * @example
 * ```typescript
 * const result = await runLangGraphAgent('Create a todo app', {
 *   sessionId: 'session-123',
 *   sandboxHandle,
 * });
 * ```
 */
export async function runLangGraphAgent(
  userMessage: string,
  options: {
    sessionId?: string;
    sandboxHandle?: any;
  } = {}
) {
  const graph = await createAgentGraph();
  
  const sessionId = options.sessionId || crypto.randomUUID();
  
  // Invoke graph
  const result = await graph.invoke({
    messages: [{ role: 'user', content: userMessage }],
    sessionId,
    sandboxHandle: options.sandboxHandle,
    vfs: {},
    transactionLog: [],
    currentPlan: undefined,
    errors: [],
    retryCount: 0,
    next: undefined,
  });

  return {
    success: result.errors.length === 0,
    vfs: result.vfs,
    transactionLog: result.transactionLog,
    errors: result.errors,
    sessionId,
  };
}
