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
import type { TransactionLogEntry, PlanJSON, FileModificationIntent, ApprovalRequest } from '../stateful-agent/schemas';

// ============================================================================
// TYPED INTERFACES (replacing `any` types)
// ============================================================================

/** Message in LangGraph conversation history */
export interface LangGraphMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: LangGraphToolCall[];
  toolResults?: LangGraphToolResult[];
}

/** Tool call within a message */
export interface LangGraphToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Tool result within a message */
export interface LangGraphToolResult {
  toolCallId: string;
  result: unknown;
}

/** Error tracked in LangGraph state */
export interface LangGraphError {
  message: string;
  path?: string;
  step: string;
  timestamp: string;
  operation?: string;
  parameters?: Record<string, unknown>;
  stack?: string;
  recoverable: boolean;
  suggestions?: string[];
}

/** Transaction entry in LangGraph state (string timestamp) */
export interface LangGraphTransactionEntry {
  path: string;
  type: 'UPDATE' | 'CREATE' | 'DELETE';
  timestamp: string;
  originalContent?: string;
  newContent?: string;
  search?: string;
  replace?: string;
}

// ============================================================================
// AGENT STATE DEFINITION
// ============================================================================

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
  transactionLog: Annotation<LangGraphTransactionEntry[]>({
    reducer: (left: LangGraphTransactionEntry[], right: LangGraphTransactionEntry[]) => [...left, ...right],
    default: () => [],
  }),

  /** Current execution plan */
  currentPlan: Annotation<PlanJSON | null>({
    reducer: (left: PlanJSON | null, right: PlanJSON | null) => right,
    default: () => null,
  }),

  /** Discovery intents from file modification planning */
  discoveryIntents: Annotation<FileModificationIntent[]>({
    reducer: (left: FileModificationIntent[], right: FileModificationIntent[]) => [...left, ...right],
    default: () => [],
  }),

  /** Error tracking with proper types */
  errors: Annotation<LangGraphError[]>({
    reducer: (left: LangGraphError[], right: LangGraphError[]) => [...left, ...right],
    default: () => [],
  }),

  /** Retry count for self-healing */
  retryCount: Annotation<number>({
    reducer: (left: number, right: number) => right,
    default: () => 0,
  }),

  /** Agent status phase */
  status: Annotation<'idle' | 'discovering' | 'planning' | 'editing' | 'verifying' | 'committing' | 'error'>({
    reducer: (left: string, right: string) => right as any,
    default: () => 'idle',
  }),

  /** Sandbox identifier */
  sandboxId: Annotation<string | null>({
    reducer: (left: string | null, right: string | null) => right,
    default: () => null,
  }),

  /** Pending approval request */
  pendingApproval: Annotation<ApprovalRequest | null>({
    reducer: (left: ApprovalRequest | null, right: ApprovalRequest | null) => right,
    default: () => null,
  }),

  // === Add LangGraph-specific state ===
  /** Message history for LLM interactions */
  messages: Annotation<LangGraphMessage[]>({
    reducer: (left: LangGraphMessage[], right: LangGraphMessage[]) => [...left, ...right],
    default: () => [],
  }),

  /** Next node to execute (for conditional edges) */
  next: Annotation<string | undefined>({
    reducer: (left: string | undefined, right: string | undefined) => right,
    default: () => undefined,
  }),

  /** Session ID for state isolation */
  sessionId: Annotation<string>({
    reducer: (left: string, right: string) => right,
    default: () => '',
  }),

  /** Sandbox handle for code execution */
  sandboxHandle: Annotation<unknown>({
    reducer: (left: unknown, right: unknown) => right,
    default: () => undefined,
  }),
});

/**
 * Agent state type inferred from annotation
 */
export type AgentStateType = typeof AgentState.State;

// ============================================================================
// STATE CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert existing VfsState to LangGraph AgentState
 * Handles the timestamp type mismatch: VfsState uses number, AgentState uses string.
 */
export function vfsStateToAgentState(vfsState: VfsState, sessionId: string): AgentStateType {
  return {
    vfs: vfsState.vfs || {},
    transactionLog: (vfsState.transactionLog || []).map((entry: TransactionLogEntry): LangGraphTransactionEntry => ({
      path: entry.path,
      type: entry.type,
      timestamp: typeof entry.timestamp === 'number'
        ? new Date(entry.timestamp).toISOString()
        : (entry.timestamp || new Date().toISOString()),
      originalContent: (entry as any).originalContent,
      newContent: (entry as any).newContent,
      search: (entry as any).search,
      replace: (entry as any).replace,
    })),
    currentPlan: vfsState.currentPlan,
    discoveryIntents: vfsState.discoveryIntents || [],
    errors: (vfsState.errors || []).map(e => ({
      message: e.message,
      path: e.path,
      step: String(e.step),
      timestamp: typeof e.timestamp === 'number'
        ? new Date(e.timestamp).toISOString()
        : (String(e.timestamp) || new Date().toISOString()),
      recoverable: true,
    })),
    retryCount: vfsState.retryCount || 0,
    status: vfsState.status || 'idle',
    sandboxId: vfsState.sandboxId,
    pendingApproval: vfsState.pendingApproval,
    messages: [],
    next: undefined,
    sessionId,
    sandboxHandle: undefined,
  } as AgentStateType;
}

/**
 * Convert LangGraph AgentState back to VfsState
 * Handles the timestamp type mismatch: AgentState uses string, VfsState uses number.
 */
export function agentStateToVfsState(agentState: AgentStateType): VfsState {
  return {
    vfs: agentState.vfs,
    transactionLog: (agentState.transactionLog || []).map(entry => ({
      path: entry.path,
      type: entry.type,
      timestamp: entry.timestamp,
    })),
    currentPlan: agentState.currentPlan,
    discoveryIntents: agentState.discoveryIntents || [],
    errors: (agentState.errors || []).map(e => ({
      step: typeof e.step === 'string' ? parseInt(e.step, 10) || 0 : (Number(e.step) || 0),
      path: e.path,
      message: e.message,
      timestamp: e.timestamp ? new Date(e.timestamp).getTime() : Date.now(),
    })),
    retryCount: agentState.retryCount,
    status: agentState.status || 'idle',
    sandboxId: agentState.sandboxId,
    sessionId: agentState.sessionId,
    pendingApproval: agentState.pendingApproval,
  };
}
