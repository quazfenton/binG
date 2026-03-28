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
 *   acquireUnifiedLock,
 *   getLockMetrics,
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

// Session Lock - Multi-Strategy
export {
  acquireUnifiedLock,
  createUnifiedLock,
  getLockStrategyHealth,
  type UnifiedLockRelease,
  type UnifiedLockResult,
  type UnifiedLockConfig,
  type LockStrategy,
} from './unified-lock'

// Session Lock - Redis (Primary)
export {
  acquireSessionLock,
  releaseSessionLock,
  checkRedisHealth,
  type SessionLockRelease,
} from './session-lock'

// Session Lock - Memory (Secondary Fallback)
export {
  acquireMemoryLock,
  acquireMemoryLockWithRetry,
  releaseMemoryLock,
  isSessionLocked,
  getMemoryLockStats,
  // Note: __clearAllLocks__ is test-only, import from @/lib/session/__internal__
  type MemoryLockRelease,
  type MemoryLockResult,
} from './memory-lock'

// Session Lock - Queue (Tertiary Fallback)
export {
  acquireQueueLock,
  getQueueStats,
  // Note: __clearAllQueues__ is test-only, import from @/lib/session/__internal__
  type QueueLockRelease,
  type QueueLockResult,
} from './queue-lock'

// Session Lock - Metrics & Monitoring
export {
  recordLockMetric,
  getLockMetrics,
  getLockHealth,
  getAlertHistory,
  startAlertMonitor,
  stopAlertMonitor,
  // Note: __clearAllMetrics__ is test-only, import from @/lib/session/__internal__
  type LockMetric,
} from './lock-metrics'

// Re-export UnifiedAgentState from orchestra for convenience
export type {
  UnifiedAgentState,
  AgentStateType,
  Message,
} from '../orchestra/unified-agent-state'
