/**
 * Terminal UI Manager
 * 
 * Handles terminal UI/UX operations.
 * Migrated from TerminalPanel.tsx various UI functions
 * 
 * Features:
 * - Keyboard shortcuts (Ctrl+Shift+C/V/A)
 * - Context menu handling
 * - Idle timeout monitoring
 * - Sandbox connection toggle
 * - Activity tracking
 * - Terminal lifecycle (open/close/dispose)
 * - Panel resize handling
 * - Split view management
 * 
 * @example
 * ```typescript
 * const uiManager = createTerminalUIManager({
 *   getTerminals: () => terminalsRef.current,
 *   getActiveTerminalId: () => activeTerminalId,
 *   getSandboxStatus: () => sandboxStatus,
 *   setSandboxStatus: (status) => setSandboxStatus(status),
 *   connectTerminal: (terminalId) => connectTerminal(terminalId),
 *   copyOutput: () => copyOutput(),
 *   pasteFromClipboard: () => pasteFromClipboard(),
 *   selectAll: () => selectAll(),
 *   clearTerminal: (terminalId) => clearTerminal(terminalId),
 *   killAllTerminals: () => killAllTerminals(),
 * })
 * 
 * uiManager.setupKeyboardShortcuts()
 * uiManager.startIdleMonitoring()
 * ```
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('TerminalUIManager')

// Configuration
const IDLE_TIMEOUT_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_TIMEOUT_MS || '900000', 10)
const IDLE_WARNING_MS = parseInt(process.env.NEXT_PUBLIC_SANDBOX_IDLE_WARNING_MS || '60000', 10)

export interface TerminalUIManagerConfig {
  getTerminals: () => any[]
  getActiveTerminalId: () => string | null
  getSandboxStatus: () => string
  setSandboxStatus: (status: string) => void
  connectTerminal: (terminalId: string) => Promise<void>
  copyOutput: () => Promise<void>
  pasteFromClipboard: () => Promise<void>
  selectAll: () => void
  clearTerminal: (terminalId?: string) => void
  killAllTerminals: () => Promise<void>
  saveTerminalSession: (session: any) => void
  getCommandHistory: (terminalId: string) => string[]
  onContextMenu?: (x: number, y: number, terminalId: string) => void
  onClose?: () => void
  onMinimize?: () => void
}

export interface TerminalUIState {
  isExpanded: boolean
  isSplitView: boolean
  isSelectingMode: boolean
  isResizing: boolean
  terminalHeight: number
  contextMenu: { x: number; y: number; terminalId: string } | null
  idleTimeLeft: number | null
  lastActivity: number
}

export class TerminalUIManager {
  private getTerminals: () => any[]
  private getActiveTerminalId: () => string | null
  private getSandboxStatus: () => string
  private setSandboxStatus: (status: string) => void
  private connectTerminal: (terminalId: string) => Promise<void>
  private copyOutput: () => Promise<void>
  private pasteFromClipboard: () => Promise<void>
  private selectAll: () => void
  private clearTerminal: (terminalId?: string) => void
  private killAllTerminals: () => Promise<void>
  private saveTerminalSession: (session: any) => void
  private getCommandHistory: (terminalId: string) => string[]
  private onContextMenu?: (x: number, y: number, terminalId: string) => void
  private onClose?: () => void
  private onMinimize?: () => void

  private state: TerminalUIState = {
    isExpanded: false,
    isSplitView: false,
    isSelectingMode: false,
    isResizing: false,
    terminalHeight: 450,
    contextMenu: null,
    idleTimeLeft: null,
    lastActivity: Date.now(),
  }

  private idleCheckInterval?: NodeJS.Timeout
  private keyboardHandler?: (e: KeyboardEvent) => void
  private clickHandler?: () => void

  constructor(config: TerminalUIManagerConfig) {
    this.getTerminals = config.getTerminals
    this.getActiveTerminalId = config.getActiveTerminalId
    this.getSandboxStatus = config.getSandboxStatus
    this.setSandboxStatus = config.setSandboxStatus
    this.connectTerminal = config.connectTerminal
    this.copyOutput = config.copyOutput
    this.pasteFromClipboard = config.pasteFromClipboard
    this.selectAll = config.selectAll
    this.clearTerminal = config.clearTerminal
    this.killAllTerminals = config.killAllTerminals
    this.saveTerminalSession = config.saveTerminalSession
    this.getCommandHistory = config.getCommandHistory
    this.onContextMenu = config.onContextMenu
    this.onClose = config.onClose
    this.onMinimize = config.onMinimize
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts(isOpen: boolean): () => void {
    this.keyboardHandler = (e: KeyboardEvent) => {
      // Only handle if terminal is open and not typing in an input
      if (!isOpen) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Ctrl+Shift+C - Copy selection or all output
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault()
        this.copyOutput()
        return
      }

      // Ctrl+Shift+V - Paste from clipboard
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault()
        this.pasteFromClipboard()
        return
      }

      // Ctrl+Shift+A - Select all (copy all visible)
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        this.selectAll()
        return
      }
    }

    // Click outside to close context menu
    this.clickHandler = () => {
      if (this.state.contextMenu) {
        this.closeContextMenu()
      }
    }

    document.addEventListener('keydown', this.keyboardHandler)
    document.addEventListener('click', this.clickHandler)

    // Return cleanup function
    return () => {
      document.removeEventListener('keydown', this.keyboardHandler!)
      document.removeEventListener('click', this.clickHandler!)
    }
  }

  /**
   * Start idle timeout monitoring
   */
  startIdleMonitoring(): () => void {
    // Only monitor if timeout is enabled
    if (IDLE_TIMEOUT_MS <= 0) {
      return () => {}
    }

    this.idleCheckInterval = setInterval(() => {
      const sandboxStatus = this.getSandboxStatus()
      
      // Only monitor if sandbox is connected
      if (sandboxStatus !== 'connected') {
        this.state.idleTimeLeft = null
        return
      }

      const elapsed = Date.now() - this.state.lastActivity
      const remaining = IDLE_TIMEOUT_MS - elapsed

      if (remaining <= 0) {
        // Timeout reached - auto disconnect
        logger.info('Idle timeout reached, disconnecting sandbox')
        this.toggleSandboxConnection()
        this.state.idleTimeLeft = null
      } else if (remaining <= IDLE_WARNING_MS && remaining > 0) {
        // Show warning in last minute
        this.state.idleTimeLeft = remaining
      } else if (remaining > IDLE_WARNING_MS) {
        // Still plenty of time
        this.state.idleTimeLeft = null
      }
    }, 10000) // Check every 10 seconds

    // Return cleanup function
    return () => {
      if (this.idleCheckInterval) {
        clearInterval(this.idleCheckInterval)
        this.idleCheckInterval = undefined
      }
    }
  }

  /**
   * Update last activity time
   */
  updateActivity(): void {
    this.state.lastActivity = Date.now()
  }

  /**
   * Toggle sandbox connection
   */
  async toggleSandboxConnection(): Promise<void> {
    const sandboxStatus = this.getSandboxStatus()
    const activeTerminalId = this.getActiveTerminalId()
    const terminals = this.getTerminals()

    if (sandboxStatus === 'connected') {
      // Disconnect - kill sandbox session
      const term = terminals.find(t => t.id === activeTerminalId)
      if (term?.sandboxInfo.sessionId) {
        try {
          await fetch('/api/sandbox/terminal', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId: term.sandboxInfo.sessionId }),
          })
          this.setSandboxStatus('disconnected')
          logger.info('Sandbox disconnected')
        } catch (error) {
          logger.error('Failed to disconnect sandbox', error)
        }
      }
    } else if (sandboxStatus === 'disconnected') {
      this.setSandboxStatus('connecting')
      try {
        if (activeTerminalId) {
          await this.connectTerminal(activeTerminalId)
        }
      } catch (error) {
        logger.error('Failed to connect sandbox', error)
        this.setSandboxStatus('disconnected')
      }
    }
  }

  /**
   * Handle context menu
   */
  handleContextMenu(e: React.MouseEvent, terminalId: string): void {
    e.preventDefault()
    if (this.onContextMenu) {
      this.onContextMenu(e.clientX, e.clientY, terminalId)
    }
  }

  /**
   * Close context menu
   */
  closeContextMenu(): void {
    this.state.contextMenu = null
  }

  /**
   * Handle terminal close
   */
  handleTerminalClose(terminalId: string): void {
    const terminals = this.getTerminals()
    const terminal = terminals.find(t => t.id === terminalId)
    
    if (terminal) {
      // Save command history
      const history = this.getCommandHistory(terminalId)
      if (history && history.length > 0) {
        this.saveTerminalSession({
          id: terminal.id,
          name: terminal.name,
          commandHistory: history,
          sandboxInfo: terminal.sandboxInfo,
          lastUsed: Date.now(),
        })
      }
    }
  }

  /**
   * Handle panel close
   */
  handlePanelClose(): void {
    const terminals = this.getTerminals()
    
    if (terminals.length > 0) {
      // Save all terminal sessions
      terminals.forEach(t => {
        this.saveTerminalSession({
          id: t.id,
          name: t.name,
          commandHistory: this.getCommandHistory(t.id),
          sandboxInfo: {
            ...t.sandboxInfo,
            status: 'none'
          },
          lastUsed: Date.now(),
        })
      })
    }

    if (this.onClose) {
      this.onClose()
    }
  }

  /**
   * Handle panel minimize
   */
  handlePanelMinimize(): void {
    if (this.onMinimize) {
      this.onMinimize()
    }
  }

  /**
   * Set expanded state
   */
  setExpanded(expanded: boolean): void {
    this.state.isExpanded = expanded
  }

  /**
   * Toggle split view
   */
  toggleSplitView(): void {
    this.state.isSplitView = !this.state.isSplitView
  }

  /**
   * Set selecting mode
   */
  setSelectingMode(selecting: boolean): void {
    this.state.isSelectingMode = selecting
  }

  /**
   * Start resize
   */
  startResize(startY: number, startHeight: number): void {
    this.state.isResizing = true
  }

  /**
   * Stop resize
   */
  stopResize(): void {
    this.state.isResizing = false
  }

  /**
   * Set terminal height
   */
  setTerminalHeight(height: number): void {
    this.state.terminalHeight = height
  }

  /**
   * Get UI state
   */
  getState(): TerminalUIState {
    return this.state
  }

  /**
   * Get auth headers (helper)
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    
    // Try to get token from localStorage
    if (typeof window !== 'undefined') {
      try {
        const token = localStorage.getItem('token')
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        // Anonymous session is now handled via HttpOnly cookie - no need to send header
        // The server sets anon-session-id cookie and credentials: 'include' sends it automatically
      } catch (error) {
        logger.warn('Failed to get auth token', error)
      }
    }
    
    return headers
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = undefined
    }
    
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler)
    }
    
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler)
    }
  }
}

/**
 * Create Terminal UI Manager
 */
export function createTerminalUIManager(config: TerminalUIManagerConfig): TerminalUIManager {
  return new TerminalUIManager(config)
}
