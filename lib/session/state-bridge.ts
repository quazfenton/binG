/**
 * Session-State Bridge
 * 
 * Connects session management with agent state management.
 * Provides bidirectional sync between:
 * - lib/session/session-manager.ts (session lifecycle)
 * - lib/orchestra/state/unified-agent-state.ts (agent execution state)
 * 
 * Features:
 * - Sync session metadata with agent state
 * - Persist agent state to session storage
 * - Restore agent state from session
 * - State versioning for rollback
 * - Automatic state cleanup on session destroy
 * 
 * @example
 * ```typescript
 * import { sessionStateBridge } from '@/lib/session/state-bridge'
 * 
 * // Create session and state
 * const session = await sessionManager.getOrCreateSession(userId, conversationId)
 * const state = await sessionStateBridge.createStateForSession(session.id, 'execution')
 * 
 * // Persist state updates
 * await sessionStateBridge.persistState(session.id, state)
 * 
 * // Restore state later
 * const restored = await sessionStateBridge.restoreState(session.id)
 * ```
 */

import { createLogger } from '../../utils/logger'
import { sessionManager } from '../session-manager'
import {
  createUnifiedAgentState,
  type UnifiedAgentState,
  type AgentStateType,
  type Message,
  stateToJSON,
  stateFromJSON,
  validateState,
} from '../orchestra/state/unified-agent-state'
import type { SandboxHandle } from '../../sandbox/providers/sandbox-provider'

const logger = createLogger('Session:StateBridge')

// ============================================================================
// State Storage Interface
// ============================================================================

/**
 * State storage entry
 */
export interface StateStorageEntry {
  sessionId: string
  state: UnifiedAgentState
  version: number
  createdAt: number
  updatedAt: number
  metadata?: {
    snapshotLabel?: string
    checkpointId?: string
    vfsHash?: string
  }
}

/**
 * State persistence result
 */
export interface PersistStateResult {
  success: boolean
  version: number
  timestamp: number
  error?: string
}

/**
 * State restoration result
 */
export interface RestoreStateResult {
  success: boolean
  state?: UnifiedAgentState
  version?: number
  error?: string
}

// ============================================================================
// In-Memory State Store
// ============================================================================

const stateStore = new Map<string, StateStorageEntry[]>()
const latestVersion = new Map<string, number>()

// ============================================================================
// Session-State Bridge Class
// ============================================================================

export class SessionStateBridge {
  /**
   * Create state for session
   */
  async createStateForSession(
    sessionId: string,
    stateType: AgentStateType,
    options?: {
      userId?: string
      sandboxId?: string
      role?: any
      capabilities?: any[]
      provider?: string
      initialMessages?: Message[]
    }
  ): Promise<UnifiedAgentState> {
    const session = sessionManager.getSessionById(sessionId)
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const state = createUnifiedAgentState({
      type: stateType,
      sessionId,
      userId: session.userId,
      sandboxId: session.sandboxId,
      role: options?.role,
      capabilities: options?.capabilities || (session as any).capabilities,
      provider: options?.provider || session.sandboxProvider,
      initialMessages: options?.initialMessages,
    })

    // Store initial state
    await this.persistState(sessionId, state, { snapshotLabel: 'initial' })

    logger.info(`Created ${stateType} state for session ${sessionId}`)
    return state
  }

  /**
   * Persist state to storage
   */
  async persistState(
    sessionId: string,
    state: UnifiedAgentState,
    metadata?: {
      snapshotLabel?: string
      checkpointId?: string
      vfsHash?: string
    }
  ): Promise<PersistStateResult> {
    try {
      // Validate state
      if (!validateState(state)) {
        return {
          success: false,
          version: 0,
          timestamp: Date.now(),
          error: 'Invalid state structure',
        }
      }

      // Get current version
      const currentVersion = latestVersion.get(sessionId) || 0
      const newVersion = currentVersion + 1

      // Create storage entry
      const entry: StateStorageEntry = {
        sessionId,
        state,
        version: newVersion,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata,
      }

      // Store in memory
      const existingEntries = stateStore.get(sessionId) || []
      existingEntries.push(entry)
      
      // Keep only last 10 versions to prevent memory bloat
      if (existingEntries.length > 10) {
        existingEntries.shift()
      }
      
      stateStore.set(sessionId, existingEntries)
      latestVersion.set(sessionId, newVersion)

      logger.debug(`Persisted state v${newVersion} for session ${sessionId}`)

      return {
        success: true,
        version: newVersion,
        timestamp: Date.now(),
      }
    } catch (error: any) {
      logger.error(`Failed to persist state for session ${sessionId}:`, error.message)
      return {
        success: false,
        version: 0,
        timestamp: Date.now(),
        error: error.message,
      }
    }
  }

  /**
   * Restore state from storage
   */
  async restoreState(
    sessionId: string,
    version?: number
  ): Promise<RestoreStateResult> {
    try {
      const entries = stateStore.get(sessionId)
      
      if (!entries || entries.length === 0) {
        return {
          success: false,
          error: 'No state found for session',
        }
      }

      // Get specific version or latest
      let entry: StateStorageEntry
      if (version !== undefined) {
        entry = entries.find(e => e.version === version)
        if (!entry) {
          return {
            success: false,
            error: `Version ${version} not found`,
          }
        }
      } else {
        entry = entries[entries.length - 1] // Latest version
      }

      logger.info(`Restored state v${entry.version} for session ${sessionId}`)

      return {
        success: true,
        state: entry.state,
        version: entry.version,
      }
    } catch (error: any) {
      logger.error(`Failed to restore state for session ${sessionId}:`, error.message)
      return {
        success: false,
        error: error.message,
      }
    }
  }

  /**
   * Get state history for session
   */
  getStateHistory(sessionId: string): Array<{
    version: number
    timestamp: number
    stateType: AgentStateType
    metadata?: StateStorageEntry['metadata']
  }> {
    const entries = stateStore.get(sessionId) || []
    return entries.map(entry => ({
      version: entry.version,
      timestamp: entry.updatedAt,
      stateType: entry.state.type,
      metadata: entry.metadata,
    }))
  }

  /**
   * Get state by version
   */
  getStateAtVersion(sessionId: string, version: number): UnifiedAgentState | undefined {
    const entries = stateStore.get(sessionId) || []
    const entry = entries.find(e => e.version === version)
    return entry?.state
  }

  /**
   * Get latest state
   */
  getLatestState(sessionId: string): UnifiedAgentState | undefined {
    const version = latestVersion.get(sessionId)
    if (version === undefined) {
      return undefined
    }
    return this.getStateAtVersion(sessionId, version)
  }

  /**
   * Rollback to previous version
   */
  async rollbackToVersion(
    sessionId: string,
    targetVersion: number
  ): Promise<RestoreStateResult> {
    const entries = stateStore.get(sessionId) || []
    const targetEntry = entries.find(e => e.version === targetVersion)
    
    if (!targetEntry) {
      return {
        success: false,
        error: `Version ${targetVersion} not found`,
      }
    }

    // Create new entry with rolled back state
    const rolledBackState = { ...targetEntry.state }
    rolledBackState.metadata = {
      ...rolledBackState.metadata,
      rolledBackFrom: latestVersion.get(sessionId),
      rolledBackTo: targetVersion,
      rolledBackAt: Date.now(),
    }

    return this.persistState(sessionId, rolledBackState, {
      snapshotLabel: `rollback-to-v${targetVersion}`,
    })
  }

  /**
   * Export state to JSON
   */
  exportState(sessionId: string, version?: number): string | null {
    const state = version !== undefined
      ? this.getStateAtVersion(sessionId, version)
      : this.getLatestState(sessionId)
    
    if (!state) {
      return null
    }

    return stateToJSON(state)
  }

  /**
   * Import state from JSON
   */
  async importState(sessionId: string, json: string): Promise<PersistStateResult> {
    try {
      const state = stateFromJSON(json)
      
      if (!validateState(state)) {
        return {
          success: false,
          version: 0,
          timestamp: Date.now(),
          error: 'Invalid state JSON',
        }
      }

      // Ensure session ID matches
      state.sessionId = sessionId

      return this.persistState(sessionId, state)
    } catch (error: any) {
      return {
        success: false,
        version: 0,
        timestamp: Date.now(),
        error: error.message,
      }
    }
  }

  /**
   * Clear state for session
   */
  clearState(sessionId: string): void {
    stateStore.delete(sessionId)
    latestVersion.delete(sessionId)
    logger.debug(`Cleared state for session ${sessionId}`)
  }

  /**
   * Clear all states (use with caution)
   */
  clearAllStates(): void {
    stateStore.clear()
    latestVersion.clear()
    logger.warn('Cleared all states')
  }

  /**
   * Get state statistics
   */
  getStateStats(): {
    totalSessions: number
    totalVersions: number
    avgVersionsPerSession: number
  } {
    const totalSessions = stateStore.size
    let totalVersions = 0
    
    for (const entries of stateStore.values()) {
      totalVersions += entries.length
    }

    return {
      totalSessions,
      totalVersions,
      avgVersionsPerSession: totalSessions > 0 ? totalVersions / totalSessions : 0,
    }
  }

  /**
   * Cleanup old state versions (keep only last N versions per session)
   */
  cleanupOldVersions(keepVersions: number = 5): number {
    let cleaned = 0

    for (const [sessionId, entries] of stateStore.entries()) {
      if (entries.length > keepVersions) {
        const toRemove = entries.length - keepVersions
        entries.splice(0, toRemove)
        stateStore.set(sessionId, entries)
        cleaned += toRemove
        
        // Update latest version
        if (entries.length > 0) {
          latestVersion.set(sessionId, entries[entries.length - 1].version)
        }
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old state versions`)
    }

    return cleaned
  }

  /**
   * Sync state with session manager
   * Ensures session metadata matches state
   */
  async syncWithSession(sessionId: string): Promise<{
    success: boolean
    synced: boolean
    error?: string
  }> {
    const session = sessionManager.getSessionById(sessionId)
    const state = this.getLatestState(sessionId)

    if (!session) {
      return {
        success: false,
        synced: false,
        error: 'Session not found',
      }
    }

    if (!state) {
      return {
        success: false,
        synced: false,
        error: 'State not found',
      }
    }

    // Update state with session info
    state.userId = session.userId
    state.lastActivity = session.lastActivity

    // Persist updated state
    const result = await this.persistState(sessionId, state)

    return {
      success: result.success,
      synced: result.success,
      error: result.error,
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const sessionStateBridge = new SessionStateBridge()

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create state for session
 * @deprecated Use sessionStateBridge.createStateForSession()
 */
export async function createStateForSession(
  sessionId: string,
  stateType: AgentStateType,
  options?: any
): Promise<UnifiedAgentState> {
  return sessionStateBridge.createStateForSession(sessionId, stateType, options)
}

/**
 * Persist state
 * @deprecated Use sessionStateBridge.persistState()
 */
export async function persistState(
  sessionId: string,
  state: UnifiedAgentState,
  metadata?: any
): Promise<PersistStateResult> {
  return sessionStateBridge.persistState(sessionId, state, metadata)
}

/**
 * Restore state
 * @deprecated Use sessionStateBridge.restoreState()
 */
export async function restoreState(
  sessionId: string,
  version?: number
): Promise<RestoreStateResult> {
  return sessionStateBridge.restoreState(sessionId, version)
}

/**
 * Get latest state
 * @deprecated Use sessionStateBridge.getLatestState()
 */
export function getLatestState(sessionId: string): UnifiedAgentState | undefined {
  return sessionStateBridge.getLatestState(sessionId)
}
