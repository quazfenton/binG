/**
 * Terminal State Manager
 * 
 * Persists terminal state to localStorage.
 * Migrated from TerminalPanel.tsx lines 476-534
 * 
 * Features:
 * - Command history persistence
 * - Sandbox connection state
 * - Auto-restore on page reload
 * - Beforeunload save
 * 
 * @example
 * ```typescript
 * const stateManager = createTerminalStateManager({
 *   getCommandHistory: () => commandHistoryRef.current,
 *   getSandboxStatus: () => sandboxStatus,
 *   restoreCommandHistory: (history) => { commandHistoryRef.current = history },
 *   restoreSandboxStatus: (status) => { sandboxStatus = status },
 * })
 * 
 * stateManager.save()
 * stateManager.restore()
 * ```
 */

import { createLogger } from '../../utils/logger'

const logger = createLogger('TerminalStateManager')

const STORAGE_KEY = 'terminal-state'
const STATE_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes

export interface TerminalState {
  commandHistory: Record<string, string[]>
  sandboxConnected: boolean
  timestamp: number
}

export interface TerminalStateManagerConfig {
  getCommandHistory: () => Record<string, string[]>
  getSandboxStatus: () => string
  restoreCommandHistory: (history: Record<string, string[]>) => void
  restoreSandboxStatus: (status: string) => void
}

export class TerminalStateManager {
  private getCommandHistory: () => Record<string, string[]>
  private getSandboxStatus: () => string
  private restoreCommandHistory: (history: Record<string, string[]>) => void
  private restoreSandboxStatus: (status: string) => void

  constructor(config: TerminalStateManagerConfig) {
    this.getCommandHistory = config.getCommandHistory
    this.getSandboxStatus = config.getSandboxStatus
    this.restoreCommandHistory = config.restoreCommandHistory
    this.restoreSandboxStatus = config.restoreSandboxStatus
  }

  /**
   * Save state to localStorage
   */
  save(): void {
    try {
      const state: TerminalState = {
        commandHistory: this.getCommandHistory(),
        sandboxConnected: this.getSandboxStatus() === 'connected',
        timestamp: Date.now(),
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      logger.debug('Terminal state saved')
    } catch (error) {
      logger.warn('Failed to save terminal state', error)
    }
  }

  /**
   * Restore state from localStorage
   */
  restore(): boolean {
    try {
      const savedState = localStorage.getItem(STORAGE_KEY)
      if (!savedState) {
        logger.debug('No saved terminal state found')
        return false
      }

      const state: TerminalState = JSON.parse(savedState)

      // Check if state is expired
      const age = Date.now() - state.timestamp
      if (age > STATE_EXPIRY_MS) {
        logger.debug('Saved terminal state expired', { age })
        localStorage.removeItem(STORAGE_KEY)
        return false
      }

      // Restore command history
      if (state.commandHistory) {
        this.restoreCommandHistory(state.commandHistory)
        logger.info('Restored command history')
      }

      // Restore sandbox connection state
      if (state.sandboxConnected) {
        this.restoreSandboxStatus('disconnected')
        logger.info('Restored sandbox connection state')
      }

      return true
    } catch (error) {
      logger.error('Failed to restore terminal state', error)
      return false
    }
  }

  /**
   * Clear saved state
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY)
      logger.debug('Terminal state cleared')
    } catch (error) {
      logger.warn('Failed to clear terminal state', error)
    }
  }

  /**
   * Setup auto-save on beforeunload
   */
  setupAutoSave(): () => void {
    const saveHandler = () => {
      this.save()
    }

    window.addEventListener('beforeunload', saveHandler)

    // Return cleanup function
    return () => {
      window.removeEventListener('beforeunload', saveHandler)
    }
  }
}

/**
 * Create Terminal State Manager
 */
export function createTerminalStateManager(config: TerminalStateManagerConfig): TerminalStateManager {
  return new TerminalStateManager(config)
}
