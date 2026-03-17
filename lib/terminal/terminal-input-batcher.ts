/**
 * Terminal Input Batcher
 * 
 * Batches terminal input for efficient WebSocket sending.
 * Migrated from TerminalPanel.tsx lines 2595-2668
 * 
 * Features:
 * - Input batching to reduce WebSocket overhead
 * - Debounced sending (~60fps)
 * - Resize handling with sandbox sync
 * 
 * @example
 * ```typescript
 * const batcher = createTerminalInputBatcher({
 *   terminalId: 'term-1',
 *   sendInput: (sessionId, data) => { ... },
 *   sendResize: (sessionId, cols, rows) => { ... },
 * })
 * 
 * batcher.batch('ls -la\n')
 * batcher.flush() // Send immediately
 * batcher.sendResize(120, 30)
 * ```
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('TerminalInputBatcher')

const BATCH_DELAY_MS = 16 // ~60fps

export interface TerminalInputBatcherConfig {
  terminalId: string
  sessionId?: string
  sendInput: (sessionId: string, data: string) => void
  sendResize: (sessionId: string, cols: number, rows: number) => void
}

export class TerminalInputBatcher {
  private terminalId: string
  private sessionId?: string
  private sendInput: (sessionId: string, data: string) => void
  private sendResize: (sessionId: string, cols: number, rows: number) => void
  private inputBuffer: string = ''
  private flushTimeout?: NodeJS.Timeout

  constructor(config: TerminalInputBatcherConfig) {
    this.terminalId = config.terminalId
    this.sessionId = config.sessionId
    this.sendInput = config.sendInput
    this.sendResize = config.sendResize
  }

  /**
   * Batch input for sending
   */
  batch(data: string): void {
    this.inputBuffer += data

    // Clear existing timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }

    // Schedule flush
    this.flushTimeout = setTimeout(() => {
      this.flush()
    }, BATCH_DELAY_MS)
  }

  /**
   * Flush input buffer immediately
   */
  flush(): void {
    if (this.inputBuffer && this.sessionId) {
      this.sendInput(this.sessionId, this.inputBuffer)
      this.inputBuffer = ''
    }

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = undefined
    }
  }

  /**
   * Send resize
   */
  resize(cols: number, rows: number): void {
    if (this.sessionId) {
      this.sendResize(this.sessionId, cols, rows)
    }
  }

  /**
   * Set session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId
    // Flush any buffered input
    this.flush()
  }

  /**
   * Clear session
   */
  clearSession(): void {
    this.sessionId = undefined
    this.inputBuffer = ''
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = undefined
    }
  }
}

/**
 * Create Terminal Input Batcher
 */
export function createTerminalInputBatcher(config: TerminalInputBatcherConfig): TerminalInputBatcher {
  return new TerminalInputBatcher(config)
}
