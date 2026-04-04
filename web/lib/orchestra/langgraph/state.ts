/**
 * LangGraph State Definitions
 *
 * Extends existing VfsState with LangGraph annotations for graph-based orchestration.
 * Reuses existing state management while adding LangGraph message handling.
 *
 * @see {@link ../../stateful-agent/state/index.ts} Base VfsState
 */

import { Annotation } from '@langchain/langgraph';
import type { VfsState } from '../stateful-agent/state';

/**
 * LangGraph-enhanced Agent State
 *
 * Combines existing VFS state with LangGraph message handling.
 * All existing state fields are preserved for compatibility.
 */
export const AgentState = Annotation.Root({
  // === Reuse existing VFS state ===
  /** Virtual filesystem state */
  vfs: Annotation<Record<string, string>>({
    reducer: (left: Record<string, string>, right: Record<string, string>) => ({
      ...left,
      ...right,
    }),
    default: () => ({}),
  }),

  /** Transaction log for shadow commits */
  transactionLog: Annotation<Array<{
    path: string;
    type: 'UPDATE' | 'CREATE' | 'DELETE';
    timestamp: string;
    originalContent?: string;
    newContent?: string;
    search?: string;
    replace?: string;
  }>>({
    reducer: (left: any[], right: any[]) => [...left, ...right],
    default: () => [],
  }),

  /** Current execution plan */
  currentPlan: Annotation<any | undefined>(),

  /** Error tracking */
  errors: Annotation<Array<{
    message: string;
    path?: string;
    step?: number | string;
    timestamp?: string;
    operation?: string;
    parameters?: any;
    stack?: string;
    recoverable?: boolean;
    suggestions?: string[];
  }>>({
    reducer: (left: any[], right: any[]) => [...left, ...right],
    default: () => [],
  }),

  /** Retry count for self-healing */
  retryCount: Annotation<number>({
    reducer: (left: number, right: number) => right,
    default: () => 0,
  }),

  // === Add LangGraph-specific state ===
  /** Message history for LLM interactions */
  messages: Annotation<Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, any>;
    }>;
    toolResults?: Array<{
      toolCallId: string;
      result: any;
    }>;
  }>>({
    reducer: (left: any[], right: any[]) => [...left, ...right],
    default: () => [],
  }),

  /** Next node to execute (for conditional edges) */
  next: Annotation<string | undefined>(),

  /** Session ID for state isolation */
  sessionId: Annotation<string>(),

  /** Sandbox handle for code execution */
  sandboxHandle: Annotation<any | undefined>(),
});

/**
 * Agent state type inferred from annotation
 */
export type AgentStateType = typeof AgentState.State;

/**
 * Convert existing VfsState to LangGraph AgentState
 */
export function vfsStateToAgentState(vfsState: VfsState, sessionId: string): AgentStateType {
  return {
    vfs: vfsState.vfs || {},
    transactionLog: vfsState.transactionLog?.map(entry => ({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    })) || [],
    currentPlan: vfsState.currentPlan,
    errors: vfsState.errors?.map(e => ({
      ...e,
      timestamp: typeof e.timestamp === 'number' ? new Date(e.timestamp).toISOString() : (e.timestamp || new Date().toISOString()),
    })) || [],
    retryCount: vfsState.retryCount || 0,
    messages: [],
    next: undefined,
    sessionId,
    sandboxHandle: undefined,
  };
}

/**
 * Convert LangGraph AgentState back to VfsState
 */
export function agentStateToVfsState(agentState: AgentStateType): VfsState {
  return {
    vfs: agentState.vfs,
    transactionLog: agentState.transactionLog,
    currentPlan: agentState.currentPlan,
    // @ts-ignore - error type conversion between string and number timestamp
    errors: agentState.errors.map(e => ({
      step: typeof e.step === 'string' ? parseInt(e.step, 10) || 0 : (e.step || 0),
      path: e.path,
      message: e.message,
      timestamp: e.timestamp || new Date().toISOString(),
    })),
    retryCount: agentState.retryCount,
  };
}
