/**
 * Terminal Input Handler
 * 
 * Handles all terminal input processing:
 * - Line buffer management with cursor positioning
 * - Command history navigation (up/down arrows)
 * - Tab completion
 * - Ctrl+R history search
 * - Line editing (Ctrl+U, Ctrl+K, Home, End, Delete)
 * - Arrow key navigation
 * 
 * This is MIGRATED from TerminalPanel.tsx lines 2790-2970
 */

import type { LocalFilesystemEntry } from './local-filesystem-executor'

export interface TerminalInputHandlerConfig {
  terminalId: string
  getFileSystem: () => Record<string, LocalFilesystemEntry>
  getCwd: () => string
  getCommandHistory: () => string[]
  setCommandHistory: (history: string[]) => void
  executeCommand: (command: string) => Promise<void>
  write: (text: string) => void
  writeLine: (text: string) => void
  getPrompt: (cwd: string) => string
}

export class TerminalInputHandler {
  private terminalId: string
  private lineBuffer: string = ''
  private cursorPos: number = 0
  private historyIndex: number = 0
  private getFileSystem: () => Record<string, LocalFilesystemEntry>
  private getCwd: () => string
  private getCommandHistory: () => string[]
  private setCommandHistory: (history: string[]) => void
  private executeCommand: (command: string) => Promise<void>
  private write: (text: string) => void
  private writeLine: (text: string) => void
  private getPrompt: (cwd: string) => string

  constructor(config: TerminalInputHandlerConfig) {
    this.terminalId = config.terminalId
    this.getFileSystem = config.getFileSystem
    this.getCwd = config.getCwd
    this.getCommandHistory = config.getCommandHistory
    this.setCommandHistory = config.setCommandHistory
    this.executeCommand = config.executeCommand
    this.write = config.write
    this.writeLine = config.writeLine
    this.getPrompt = config.getPrompt
    
    // Initialize from refs - get history length to position at end (ready for up arrow)
    const history = this.getCommandHistory()
    this.lineBuffer = ''
    this.cursorPos = 0
    // Start at history length so up arrow goes to last command
    this.historyIndex = history.length
  }

  /**
   * Handle terminal input data
   */
  async handleInput(data: string): Promise<void> {
    // Update cursor position ref
    this.cursorPos = Math.max(0, Math.min(this.cursorPos, this.lineBuffer.length))

    // ==================== Special Keys ====================
    
    // Home key - move cursor to start
    if (data === '\u001b[H') {
      this.cursorPos = 0
      this.rewriteLine()
      return
    }

    // End key - move cursor to end
    if (data === '\u001b[F') {
      this.cursorPos = this.lineBuffer.length
      this.rewriteLine()
      return
    }

    // Left arrow - move cursor left
    if (data === '\u001b[D') {
      if (this.cursorPos > 0) {
        this.cursorPos--
        this.write('\x1b[D')
      }
      return
    }

    // Right arrow - move cursor right
    if (data === '\u001b[C') {
      if (this.cursorPos < this.lineBuffer.length) {
        this.cursorPos++
        this.write('\x1b[C')
      }
      return
    }

    // Backspace - delete character before cursor
    if (data === '\u007f' || data === '\b') {
      if (this.cursorPos > 0) {
        const beforeCursor = this.lineBuffer.slice(0, this.cursorPos - 1)
        const afterCursor = this.lineBuffer.slice(this.cursorPos)
        this.lineBuffer = beforeCursor + afterCursor
        this.cursorPos--
        // Clear from cursor to end, then rewrite
        this.write('\x1b[D\x1b[K' + this.lineBuffer.slice(this.cursorPos))
        const moveBack = this.lineBuffer.length - this.cursorPos
        if (moveBack > 0) {
          this.write(`\x1b[${moveBack}D`)
        }
      }
      return
    }

    // Delete key - delete character at cursor
    if (data === '\u007e') {
      if (this.cursorPos < this.lineBuffer.length) {
        const beforeCursor = this.lineBuffer.slice(0, this.cursorPos)
        const afterCursor = this.lineBuffer.slice(this.cursorPos + 1)
        this.lineBuffer = beforeCursor + afterCursor
        // Clear from cursor to end, then rewrite
        this.write('\x1b[K' + this.lineBuffer.slice(this.cursorPos))
        const moveBack = this.lineBuffer.length - this.cursorPos
        if (moveBack > 0) {
          this.write(`\x1b[${moveBack}D`)
        }
      }
      return
    }

    // Ctrl+U - clear line from cursor to start
    if (data === '\u0015') {
      if (this.cursorPos > 0) {
        this.lineBuffer = this.lineBuffer.slice(this.cursorPos)
        this.cursorPos = 0
        this.rewriteLine()
      }
      return
    }

    // Ctrl+K - clear line from cursor to end
    if (data === '\u000b') {
      if (this.cursorPos < this.lineBuffer.length) {
        this.lineBuffer = this.lineBuffer.slice(0, this.cursorPos)
        this.write('\x1b[K')
      }
      return
    }

    // ==================== Enter/Return ====================
    
    if (data === '\r' || data === '\n') {
      this.write('\r\n')
      const command = this.lineBuffer.trim()
      
      if (command) {
        // Add to history
        const history = this.getCommandHistory()
        if (history.length === 0 || history[history.length - 1] !== command) {
          history.push(command)
          if (history.length > 100) history.shift()
          this.setCommandHistory(history)
        }
        this.historyIndex = history.length
        
        // Execute command
        await this.executeCommand(command)
      }
      
      // Reset line buffer
      this.lineBuffer = ''
      this.cursorPos = 0
      this.historyIndex = 0
      
      // Write new prompt
      const cwd = this.getCwd()
      this.write(this.getPrompt(cwd))
      return
    }

    // ==================== History Navigation ====================
    
    // Up arrow - previous command in history
    if (data === '\u001b[A') {
      const history = this.getCommandHistory()
      if (this.historyIndex > 0) {
        this.historyIndex--
        const cmd = history[this.historyIndex] || ''
        this.lineBuffer = cmd
        this.cursorPos = cmd.length
        this.rewriteLine()
      }
      return
    }

    // Down arrow - next command in history
    if (data === '\u001b[B') {
      const history = this.getCommandHistory()
      if (this.historyIndex < history.length - 1) {
        this.historyIndex++
        const cmd = history[this.historyIndex] || ''
        this.lineBuffer = cmd
        this.cursorPos = cmd.length
        this.rewriteLine()
      } else {
        // Clear line - no more history
        this.historyIndex = history.length
        this.lineBuffer = ''
        this.cursorPos = 0
        this.rewriteLine()
      }
      return
    }

    // ==================== Tab Completion ====================
    
    if (data === '\t') {
      const lastWord = this.lineBuffer.split(' ').pop() || ''
      if (lastWord) {
        const fs = this.getFileSystem()
        const completions = Object.keys(fs)
          .filter(k => {
            const relativePath = k.replace(/^project\//, '')
            return relativePath.startsWith(lastWord)
          })
          .map(k => k.split('/').pop() || k)

        if (completions.length === 1) {
          // Single completion - auto-fill
          const completion = completions[0].slice(lastWord.length)
          this.lineBuffer += completion
          this.cursorPos = this.lineBuffer.length
          this.write(completion)
        } else if (completions.length > 1) {
          // Multiple completions - show list
          this.write('\r\n' + completions.join('  ') + '\r\n')
          this.rewriteLine()
        } else {
          // No completions - beep
          this.write('\x07')
        }
      }
      return
    }

    // ==================== Ctrl+R - History Search ====================
    
    if (data === '\x12') {
      const history = this.getCommandHistory()
      const currentInput = this.lineBuffer
      
      // Find matching command from history (reverse search)
      const match = [...history].reverse().find(cmd =>
        cmd.toLowerCase().includes(currentInput.toLowerCase())
      )

      if (match) {
        this.lineBuffer = match
        this.cursorPos = match.length
        this.rewriteLine()
      } else {
        this.write('\x07') // Beep if no match
      }
      return
    }

    // ==================== Ctrl+C - Cancel ====================
    
    if (data === '\x03') {
      this.write('^C\r\n')
      this.lineBuffer = ''
      this.cursorPos = 0
      const cwd = this.getCwd()
      this.write(this.getPrompt(cwd))
      return
    }

    // ==================== Regular Characters ====================
    
    if (data >= ' ' || data === '\t') {
      const beforeCursor = this.lineBuffer.slice(0, this.cursorPos)
      const afterCursor = this.lineBuffer.slice(this.cursorPos)
      this.lineBuffer = beforeCursor + data + afterCursor
      this.cursorPos++

      // Re-render the line from the cursor position onwards
      this.write(data + afterCursor)

      // Move cursor back if necessary
      const moveBack = afterCursor.length
      if (moveBack > 0) {
        this.write(`\x1b[${moveBack}D`)
      }
    }
  }

  /**
   * Rewrite the current line with cursor positioning
   */
  private rewriteLine(): void {
    const cwd = this.getCwd()
    const prompt = this.getPrompt(cwd)
    this.write('\r\x1b[K' + prompt + this.lineBuffer)
    // Move cursor to correct position
    const cursorCol = prompt.length + this.cursorPos + 1
    this.write(`\x1b[${cursorCol}G`)
  }

  /**
   * Get current line buffer
   */
  getLineBuffer(): string {
    return this.lineBuffer
  }

  /**
   * Get cursor position
   */
  getCursorPos(): number {
    return this.cursorPos
  }

  /**
   * Clear line buffer
   */
  clear(): void {
    this.lineBuffer = ''
    this.cursorPos = 0
  }
}

/**
 * Create Terminal Input Handler
 */
export function createTerminalInputHandler(config: TerminalInputHandlerConfig): TerminalInputHandler {
  return new TerminalInputHandler(config)
}
