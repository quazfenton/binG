/**
 * Session Management Module
 * 
 * Unified session and state management.
 * Re-exports from session-manager and state-bridge for cleaner imports.
 * 
 * @example
 * ```typescript
 * import { 
 *   sessionManager,
 *   sessionStateBridge,
 *   type Session,
 * } from '@/lib/session'
 * ```
 */

// Session Manager
export { 
  sessionManager,
  SessionManager,
  // Deprecated (backward compatible)
  agentSessionManager,
  openCodeV2SessionManager,
} from './session-manager'

export type {
  Session,
  SessionConfig,
  SessionQuota,
  // Deprecated types (backward compatible)
  Session as AgentSession,
  SessionConfig as AgentSessionConfig,
  Session as OpenCodeV2Session,
  SessionConfig as V2SessionConfig,
  SessionQuota as V2SessionQuota,
} from './session-manager'

// State Bridge
export {
  sessionStateBridge,
  SessionStateBridge,
  // Deprecated (backward compatible)
  createStateForSession,
  persistState,
  restoreState,
  getLatestState,
} from './state-bridge'

export type {
  StateStorageEntry,
  PersistStateResult,
  RestoreStateResult,
} from './state-bridge'

// Re-export UnifiedAgentState from orchestra for convenience
export type {
  UnifiedAgentState,
  AgentStateType,
  Message,
} from '../orchestra/unified-agent-state'
