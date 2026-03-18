/**
 * Unified Agent State Interface
 * 
 * Consolidates state definitions from:
 * - lib/orchestra/stateful-agent/state/Index.ts (VfsState, AgentState)
 * - lib/agent/multi-agent-collaboration.ts (AgentState for roles)
 * - lib/agent/unified-agent.ts (AgentSession)
 * - lib/orchestra/langgraph/state.ts (LangGraph AgentState)
 * 
 * Provides a single source of truth for agent state across the codebase.
 * 
 * @example
 * ```typescript
 * import { createUnifiedAgentState } from '@/lib/orchestra/state/unified-agent-state'
 * 
 * const state = createUnifiedAgentState({
 *   type: 'execution', // or 'collaboration' or 'session'
 *   sessionId: 'sess_123',
 *   userId: 'user_456',
 * })
 * ```
 */

import type { PlanJSON, FileModificationIntent, TransactionLogEntry, ApprovalRequest } from './stateful-agent/schemas'

// ============================================================================
// Core State Types (from orchestra/stateful-agent/state/Index.ts)
// ============================================================================

/**
 * Virtual Filesystem State
 * Tracks in-memory filesystem state for agent operations
 */
export interface VfsState {
  /** Virtual filesystem: path -> content */
  vfs: Record<string, string>
  
  /** Transaction log for shadow commits */
  transactionLog: TransactionLogEntry[]
  
  /** Current execution plan */
  currentPlan: PlanJSON | null
  
  /** Discovery intents for file modifications */
  discoveryIntents: FileModificationIntent[]
  
  /** Error tracking */
  errors: Array<{
    step: number
    path?: string
    message: string
    timestamp: number
  }>
  
  /** Retry count for self-healing */
  retryCount: number
  
  /** Execution status */
  status: 'idle' | 'discovering' | 'planning' | 'editing' | 'verifying' | 'committing' | 'error'
  
  /** Sandbox ID for code execution */
  sandboxId: string | null
  
  /** Session ID for state isolation */
  sessionId: string
  
  /** Pending approval request (HITL) */
  pendingApproval: ApprovalRequest | null
}

/**
 * Message for agent communication
 */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
  toolResults?: Array<{
    toolCallId: string
    result: any
  }>
}

/**
 * Execution Agent State (orchestra/stateful-agent)
 * Used for Plan-Act-Verify workflow agents
 */
export interface ExecutionAgentState extends VfsState {
  /** Message history for LLM interactions */
  messages: Message[]
}

// ============================================================================
// Collaboration State Types (from agent/multi-agent-collaboration.ts)
// ============================================================================

/**
 * Agent role for multi-agent collaboration
 */
export type AgentRole =
  | 'planner'
  | 'researcher'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'executor'
  | 'coordinator'

/**
 * Collaboration Agent State
 * Used for multi-agent role-based workflows
 */
export interface CollaborationAgentState {
  /** Agent ID */
  id: string
  
  /** Agent role */
  role: AgentRole
  
  /** Current task description */
  currentTask?: string
  
  /** Agent status */
  status: 'idle' | 'working' | 'waiting' | 'completed'
  
  /** Last activity timestamp */
  lastActivity: number
  
  /** Task result (when completed) */
  result?: any
  
  /** Error message (when failed) */
  error?: string
}

// ============================================================================
// Session State Types (from agent/unified-agent.ts)
// ============================================================================

/**
 * Agent capability
 */
export type AgentCapability =
  | 'terminal'
  | 'desktop'
  | 'mcp'
  | 'code-execution'
  | 'git'
  | 'file-ops'
  | 'preview'

/**
 * Agent Session State
 * Tracks session metadata for unified agent
 */
export interface AgentSessionState {
  /** Session ID */
  sessionId: string
  
  /** Sandbox ID */
  sandboxId: string
  
  /** User ID */
  userId: string
  
  /** Provider (e2b, daytona, etc.) */
  provider: string
  
  /** Enabled capabilities */
  capabilities: AgentCapability[]
  
  /** Creation timestamp */
  createdAt: number
  
  /** Last active timestamp */
  lastActive: number
  
  /** Terminal output history */
  terminalOutput?: Array<{
    type: 'stdout' | 'stderr' | 'error' | 'system'
    data: string
    timestamp: number
  }>
}

// ============================================================================
// Unified State Type
// ============================================================================

/**
 * Agent state type discriminator
 */
export type AgentStateType = 'execution' | 'collaboration' | 'session' | 'langgraph'

/**
 * LangGraph-specific state extensions
 */
export interface LangGraphStateExtensions {
  /** Next node to execute (for conditional edges) */
  next?: string
  
  /** Sandbox handle for code execution */
  sandboxHandle?: any
}

/**
 * Unified Agent State
 * 
 * Combines all state types into a single interface.
 * Use the `type` field to determine which state variant is active.
 */
export interface UnifiedAgentState {
  /** State type discriminator */
  type: AgentStateType
  
  /** Common state fields */
  sessionId: string
  userId?: string
  createdAt: number
  lastActivity: number
  
  /** Execution state (when type='execution') */
  execution?: ExecutionAgentState
  
  /** Collaboration state (when type='collaboration') */
  collaboration?: CollaborationAgentState
  
  /** Session state (when type='session') */
  session?: AgentSessionState
  
  /** LangGraph extensions (when type='langgraph') */
  langgraph?: LangGraphStateExtensions
  
  /** Custom metadata */
  metadata?: Record<string, any>
}

// ============================================================================
// State Creation Functions
// ============================================================================

/**
 * Create execution agent state
 */
export function createExecutionAgentState(options?: {
  sessionId?: string
  sandboxId?: string
  initialMessages?: Message[]
  userId?: string
}): ExecutionAgentState {
  return {
    sessionId: options?.sessionId || crypto.randomUUID(),
    sandboxId: options?.sandboxId || null,
    messages: options?.initialMessages || [],
    vfs: {},
    transactionLog: [],
    currentPlan: null,
    discoveryIntents: [],
    errors: [],
    retryCount: 0,
    status: 'idle',
    pendingApproval: null,
  }
}

/**
 * Create collaboration agent state
 */
export function createCollaborationAgentState(options: {
  id: string
  role: AgentRole
  currentTask?: string
  userId?: string
}): CollaborationAgentState {
  return {
    id: options.id,
    role: options.role,
    currentTask: options.currentTask,
    status: 'idle',
    lastActivity: Date.now(),
  }
}

/**
 * Create agent session state
 */
export function createAgentSessionState(options: {
  sessionId: string
  sandboxId: string
  userId: string
  provider: string
  capabilities: AgentCapability[]
}): AgentSessionState {
  return {
    sessionId: options.sessionId,
    sandboxId: options.sandboxId,
    userId: options.userId,
    provider: options.provider,
    capabilities: options.capabilities,
    createdAt: Date.now(),
    lastActive: Date.now(),
    terminalOutput: [],
  }
}

/**
 * Create unified agent state
 */
export function createUnifiedAgentState(options: {
  type: AgentStateType
  sessionId?: string
  userId?: string
  sandboxId?: string
  role?: AgentRole
  capabilities?: AgentCapability[]
  provider?: string
  initialMessages?: Message[]
}): UnifiedAgentState {
  const now = Date.now()
  const sessionId = options.sessionId || crypto.randomUUID()
  
  const base: UnifiedAgentState = {
    type: options.type,
    sessionId,
    userId: options.userId,
    createdAt: now,
    lastActivity: now,
    metadata: {},
  }
  
  switch (options.type) {
    case 'execution':
      base.execution = createExecutionAgentState({
        sessionId,
        sandboxId: options.sandboxId,
        initialMessages: options.initialMessages,
        userId: options.userId,
      })
      break
      
    case 'collaboration':
      if (!options.role) {
        throw new Error('role is required for collaboration state')
      }
      base.collaboration = createCollaborationAgentState({
        id: sessionId,
        role: options.role,
        userId: options.userId,
      })
      break
      
    case 'session':
      if (!options.sandboxId || !options.provider || !options.capabilities) {
        throw new Error('sandboxId, provider, and capabilities are required for session state')
      }
      base.session = createAgentSessionState({
        sessionId,
        sandboxId: options.sandboxId,
        userId: options.userId || 'anonymous',
        provider: options.provider,
        capabilities: options.capabilities,
      })
      break
      
    case 'langgraph':
      base.execution = createExecutionAgentState({
        sessionId,
        sandboxId: options.sandboxId,
        initialMessages: options.initialMessages,
      })
      base.langgraph = {
        next: undefined,
        sandboxHandle: undefined,
      }
      break
  }
  
  return base
}

// ============================================================================
// State Utilities
// ============================================================================

/**
 * Update state last activity
 */
export function updateStateActivity(state: UnifiedAgentState): void {
  state.lastActivity = Date.now()
}

/**
 * Add error to state
 */
export function addStateError(
  state: UnifiedAgentState,
  error: { step?: number; path?: string; message: string }
): void {
  if (state.execution) {
    state.execution.errors.push({
      step: error.step || 0,
      path: error.path,
      message: error.message,
      timestamp: Date.now(),
    })
  }
  updateStateActivity(state)
}

/**
 * Update state status
 */
export function updateStateStatus(
  state: UnifiedAgentState,
  status: ExecutionAgentState['status'] | CollaborationAgentState['status']
): void {
  if (state.execution) {
    state.execution.status = status as ExecutionAgentState['status']
  }
  if (state.collaboration) {
    state.collaboration.status = status as CollaborationAgentState['status']
  }
  updateStateActivity(state)
}

/**
 * Add message to state
 */
export function addStateMessage(
  state: UnifiedAgentState,
  message: Message
): void {
  if (state.execution) {
    state.execution.messages.push(message)
  }
  if (state.langgraph) {
    state.execution?.messages.push(message)
  }
  updateStateActivity(state)
}

/**
 * Update VFS in state
 */
export function updateStateVfs(
  state: UnifiedAgentState,
  path: string,
  content: string
): void {
  if (state.execution) {
    state.execution.vfs[path] = content
  }
  updateStateActivity(state)
}

/**
 * Get state as JSON (for persistence)
 */
export function stateToJSON(state: UnifiedAgentState): string {
  return JSON.stringify(state, null, 2)
}

/**
 * Parse state from JSON
 */
export function stateFromJSON(json: string): UnifiedAgentState {
  return JSON.parse(json) as UnifiedAgentState
}

/**
 * Validate state structure
 */
export function validateState(state: any): state is UnifiedAgentState {
  return (
    state &&
    typeof state.type === 'string' &&
    typeof state.sessionId === 'string' &&
    typeof state.createdAt === 'number' &&
    typeof state.lastActivity === 'number' &&
    ['execution', 'collaboration', 'session', 'langgraph'].includes(state.type)
  )
}
