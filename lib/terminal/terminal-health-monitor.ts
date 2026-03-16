/**
 * Terminal Health Monitor
 * 
 * Periodic health checks for terminal connections.
 * Migrated from TerminalPanel.tsx lines 3916-3956
 * 
 * Features:
 * - Periodic connection monitoring (30s interval)
 * - WebSocket readyState checking
 * - Automatic reconnection trigger
 * - Connection status logging
 * 
 * @example
 * ```typescript
 * const healthMonitor = createTerminalHealthMonitor({
 *   getTerminals: () => terminalsRef.current,
 *   updateTerminalState: (terminalId, updates) => { ... },
 *   writeLine: (terminalId, text) => { ... },
 * })
 * 
 * healthMonitor.start()
 * healthMonitor.stop()
 * ```
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('TerminalHealthMonitor')

const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds

export interface TerminalHealthMonitorConfig {
  getTerminals: () => any[]
  updateTerminalState: (terminalId: string, updates: any) => void
  writeLine: (terminalId: string, text: string) => void
}

export class TerminalHealthMonitor {
  private getTerminals: () => any[]
  private updateTerminalState: (terminalId: string, updates: any) => void
  private writeLine: (terminalId: string, text: string) => void
  private healthCheckInterval?: NodeJS.Timeout
  private isRunning: boolean = false

  constructor(config: TerminalHealthMonitorConfig) {
    this.getTerminals = config.getTerminals
    this.updateTerminalState = config.updateTerminalState
    this.writeLine = config.writeLine
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Health monitor already running')
      return
    }

    this.isRunning = true
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck()
    }, HEALTH_CHECK_INTERVAL)

    logger.info('Health monitoring started')
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
    this.isRunning = false
    logger.info('Health monitoring stopped')
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const terminals = this.getTerminals()

    terminals.forEach(term => {
      if (term.mode === 'pty' && term.isConnected && term.websocket) {
        // Check WebSocket readyState
        if (term.websocket.readyState === WebSocket.CLOSED) {
          logger.warn('Terminal health check: WebSocket closed', {
            terminalId: term.id,
            sandboxId: term.sandboxInfo?.sandboxId,
          })

          // Trigger reconnection
          this.updateTerminalState(term.id, {
            websocket: null,
            isConnected: false,
            mode: 'sandbox-cmd',
          })

          this.writeLine(term.id, '\x1b[31m⚠ Connection lost detected. Type "connect" to reconnect.\x1b[0m')
        } else if (term.websocket.readyState === WebSocket.CLOSING) {
          logger.debug('Terminal health check: WebSocket closing', {
            terminalId: term.id,
          })
        }
      }
    })
  }

  /**
   * Check if monitoring is running
   */
  isMonitoring(): boolean {
    return this.isRunning
  }
}

/**
 * Create Terminal Health Monitor
 */
export function createTerminalHealthMonitor(config: TerminalHealthMonitorConfig): TerminalHealthMonitor {
  return new TerminalHealthMonitor(config)
}
