/**
 * Terminal Editor Handler
 * 
 * Handles nano/vim editor input processing.
 * Migrated from TerminalPanel.tsx lines 2106-2593
 * 
 * Features:
 * - Nano keybindings (^G, ^O, ^X, ^K, ^U, ^Y, ^C, ^F, ^R, ^W, ^Q, ^S)
 * - Vim keybindings (NORMAL mode, insert mode, :q, :w, :wq, :x)
 * - Line-by-line editing with cursor
 * - Scroll offset for long files
 * - Modified buffer detection
 * - Save confirmation on exit
 * - Clipboard operations (cut/paste)
 * 
 * @example
 * ```typescript
 * const editor = createTerminalEditorHandler({
 *   terminalId: 'term-1',
 *   filePath: 'project/test.txt',
 *   content: 'file content',
 *   write: (text) => term.this.write(text),
 *   writeLine: (text) => term.this.write(text + '\r\n'),
 *   getPrompt: (cwd) => getPrompt('local', cwd),
 *   syncToVFS: async (path, content) => { ... },
 *   updateTerminalState: (updates) => { ... },
 *   getCwd: () => localShellCwdRef.current[terminalId],
 * })
 * 
 * editor.open()
 * editor.handleInput('^O') // Save
 * editor.handleInput('^X') // Exit
 * ```
 */

import { createLogger } from '../../utils/logger'

const logger = createLogger('TerminalEditor')

export interface EditorSession {
  type: 'nano' | 'vim' | 'vi'
  filePath: string
  content: string
  cursor: number
  lines: string[]
  cursorLine: number
  cursorCol: number
  originalContent: string
  clipboard: string
  pendingExit?: boolean
}

export interface TerminalEditorHandlerConfig {
  terminalId: string
  filePath: string
  content: string
  editorType?: 'nano' | 'vim' | 'vi'
  write: (text: string) => void
  writeLine: (text: string) => void
  getPrompt: (cwd: string) => string
  syncToVFS: (filePath: string, content: string) => Promise<void>
  updateTerminalState: (updates: any) => void
  getCwd: () => string
  getFileSystem: () => Record<string, any>
  setFileSystem: (fs: Record<string, any>) => void
}

export class TerminalEditorHandler {
  private terminalId: string
  private session: EditorSession | null = null
  private write: (text: string) => void
  private writeLine: (text: string) => void
  private getPrompt: (cwd: string) => string
  private syncToVFS: (filePath: string, content: string) => Promise<void>
  private updateTerminalState: (updates: any) => void
  private getCwd: () => string
  private getFileSystem: () => Record<string, any>
  private setFileSystem: (fs: Record<string, any>) => void

  constructor(config: TerminalEditorHandlerConfig) {
    this.terminalId = config.terminalId
    this.write = config.write
    this.writeLine = config.writeLine
    this.getPrompt = config.getPrompt
    this.syncToVFS = config.syncToVFS
    this.updateTerminalState = config.updateTerminalState
    this.getCwd = config.getCwd
    this.getFileSystem = config.getFileSystem
    this.setFileSystem = config.setFileSystem
  }

  /**
   * Open editor for a file
   */
  open(editorType: 'nano' | 'vim' | 'vi' = 'nano'): void {
    const fs = this.getFileSystem()
    const content = fs[this.session?.filePath || '']?.content || ''
    const lines = content.split('\n')

    this.session = {
      type: editorType,
      filePath: this.session?.filePath || '',
      content: content,
      cursor: 0,
      lines: lines.length > 0 ? lines : [''],
      cursorLine: 0,
      cursorCol: 0,
      originalContent: content,
      clipboard: '',
      pendingExit: false,
    }

    this.updateTerminalState({ mode: 'editor' })
    this.render()
  }

  /**
   * Open editor for specific file
   */
  openFile(filePath: string, editorType: 'nano' | 'vim' | 'vi' = 'nano'): void {
    const fs = this.getFileSystem()
    const content = fs[filePath]?.content || ''
    const lines = content.split('\n')

    this.session = {
      type: editorType,
      filePath,
      content,
      cursor: 0,
      lines: lines.length > 0 ? lines : [''],
      cursorLine: 0,
      cursorCol: 0,
      originalContent: content,
      clipboard: '',
      pendingExit: false,
    }

    this.updateTerminalState({ mode: 'editor' })
    this.render()
  }

  /**
   * Handle editor input
   */
  async handleInput(input: string): Promise<void> {
    if (!this.session) return

    // Handle pending exit confirmation
    if (this.session.pendingExit) {
      await this.handlePendingExit(input)
      return
    }

    // Arrow keys
    if (input === '\x1b[A') { // Up
      if (this.session.cursorLine > 0) {
        this.session.cursorLine--
        const line = this.session.lines[this.session.cursorLine] || ''
        this.session.cursorCol = Math.min(this.session.cursorCol, line.length)
      }
      this.render()
      return
    }

    if (input === '\x1b[B') { // Down
      if (this.session.cursorLine < this.session.lines.length - 1) {
        this.session.cursorLine++
        const line = this.session.lines[this.session.cursorLine] || ''
        this.session.cursorCol = Math.min(this.session.cursorCol, line.length)
      }
      this.render()
      return
    }

    if (input === '\x1b[D') { // Left
      if (this.session.cursorCol > 0) {
        this.session.cursorCol--
      }
      this.render()
      return
    }

    if (input === '\x1b[C') { // Right
      const line = this.session.lines[this.session.cursorLine] || ''
      if (this.session.cursorCol < line.length) {
        this.session.cursorCol++
      }
      this.render()
      return
    }

    // Enter/Return
    if (input === '\r' || input === '\n') {
      this.writeLine('')

      // Handle vim command mode
      const currentLine = this.session.lines[this.session.cursorLine] || ''
      if (currentLine.startsWith(':') && this.session.type === 'vim') {
        await this.handleVimCommand(currentLine.slice(1).trim())
        return
      }

      // Insert new line
      if (this.session.cursorLine < this.session.lines.length) {
        this.session.lines[this.session.cursorLine] = currentLine
      }
      this.session.cursorLine++
      if (this.session.cursorLine >= this.session.lines.length) {
        this.session.lines.push('')
      }
      this.session.cursorCol = 0
      this.render()
      return
    }

    // Escape / Ctrl+C - Exit editor
    if (input === '\x1b' || input === '\x03') {
      await this.exit()
      return
    }

    // Backspace
    if (input === '\x7f') {
      if (this.session.cursorCol > 0) {
        const line = this.session.lines[this.session.cursorLine] || ''
        this.session.lines[this.session.cursorLine] = line.slice(0, this.session.cursorCol - 1) + line.slice(this.session.cursorCol)
        this.session.cursorCol--
      }
      this.render()
      return
    }

    // Nano keybindings
    if (input === '\x07') { // ^G - Help
      this.showHelp()
      return
    }

    if (input === '\x0f') { // ^F - Save (alternative)
      await this.save()
      return
    }

    if (input === '\x18') { // ^X - Exit
      await this.exit()
      return
    }

    if (input === '\x0b') { // ^K - Cut line
      this.cutLine()
      return
    }

    if (input === '\x15') { // ^U - Paste
      this.paste()
      return
    }

    if (input === '\x19') { // ^Y - Previous page
      if (this.session.cursorLine > 0) {
        this.session.cursorLine--
        const line = this.session.lines[this.session.cursorLine] || ''
        this.session.cursorCol = Math.min(this.session.cursorCol, line.length)
      }
      this.render()
      return
    }

    if (input === '\x12') { // ^R - Insert file
      this.writeLine('\x1b[90mFile to insert [from ./]: \x1b[0m')
      this.render()
      return
    }

    // Regular character input
    if (input >= ' ') {
      const line = this.session.lines[this.session.cursorLine] || ''
      const before = line.slice(0, this.session.cursorCol)
      const after = line.slice(this.session.cursorCol)
      this.session.lines[this.session.cursorLine] = before + input + after
      this.session.cursorCol++
      this.render()
    }
  }

  /**
   * Handle pending exit confirmation
   */
  private async handlePendingExit(input: string): Promise<void> {

    const key = input.toLowerCase()
    if (key === 'y') {
      // Save and exit
      await this.save()
      this.writeLine(`\x1b[32m"${this.session?.filePath}" saved\x1b[0m`)
      await this.close()
    } else if (key === 'n') {
      // Exit without saving
      this.writeLine('\x1b[90mChanges discarded.\x1b[0m')
      await this.close()
    } else if (key === 'c' || input === '\x1b') {
      // Cancel exit
      delete this.session!.pendingExit
      this.render()
    }
  }

  /**
   * Handle vim commands
   */
  private async handleVimCommand(cmd: string): Promise<void> {

    if (cmd === 'q' || cmd === 'q!') {
      // Quit without saving
      this.updateTerminalState({ mode: 'local' })
      const cwd = this.getCwd()
      this.writeLine(`\x1b[90mExit without saving.\x1b[0m`)
      this.write(this.getPrompt(cwd))
      this.session = null
      return
    }

    if (cmd === 'wq' || cmd === 'x' || cmd === 'w') {
      // Write and quit
      await this.save()
      this.writeLine(`\x1b[32m"${this.session?.filePath}" ${this.session?.lines.length}L ${this.session?.content.length}C written\x1b[0m`)

      if (cmd === 'wq' || cmd === 'x') {
        await this.close()
      } else {
        this.session!.originalContent = this.session!.lines.join('\n')
        this.session!.cursorLine = 0
        this.session!.cursorCol = 0
        this.writeLine('\x1b[33mNORMAL MODE\x1b[0m')
        this.render()
      }
      return
    }

    if (cmd === 'w') {
      this.writeLine('\x1b[90mUse :w to save or :wq to save and quit\x1b[0m')
      return
    }

    this.writeLine(`\x1b[31mUnknown command: ${cmd}\x1b[0m`)
    this.session!.lines[this.session!.cursorLine] = ''
    this.render()
  }

  /**
   * Save file
   */
  private async save(): Promise<void> {
    if (!this.session) return

    const fs = this.getFileSystem()
    const fileContent = this.session.lines.join('\n')

    fs[this.session.filePath] = {
      type: 'file',
      content: fileContent,
      createdAt: fs[this.session.filePath]?.createdAt || Date.now(),
      modifiedAt: Date.now(),
    }

    this.setFileSystem(fs)
    await this.syncToVFS(this.session.filePath, fileContent)
    this.session.originalContent = fileContent
  }

  /**
   * Cut line (nano ^K)
   */
  private cutLine(): void {
    if (!this.session) return

    const line = this.session.lines[this.session.cursorLine] || ''
    this.session.clipboard = (this.session.clipboard || '') + (this.session.clipboard ? '\n' : '') + line
    this.session.lines[this.session.cursorLine] = ''
    this.session.cursorCol = 0
    this.render()
  }

  /**
   * Paste line (nano ^U)
   */
  private paste(): void {
    if (!this.session || !this.session.clipboard) return

    const lines = this.session.clipboard.split('\n')
    const currentLine = this.session.lines[this.session.cursorLine] || ''
    const beforeCursor = currentLine.slice(0, this.session.cursorCol)
    const afterCursor = currentLine.slice(this.session.cursorCol)
    this.session.lines[this.session.cursorLine] = beforeCursor + lines[0] + afterCursor
    this.session.cursorCol = beforeCursor.length + lines[0].length

    for (let i = 1; i < lines.length; i++) {
      this.session.lines.splice(this.session.cursorLine + i, 0, lines[i])
    }
    this.session.cursorLine += lines.length - 1

    if (this.session.cursorLine >= this.session.lines.length) {
      this.session.lines.push('')
      this.session.cursorLine = this.session.lines.length - 1
    }

    this.render()
  }

  /**
   * Show help (nano ^G)
   */
  private showHelp(): void {

    this.writeLine('\x1b[36m==== Nano Help ====\x1b[0m')
    this.writeLine('\x1b[33m^G\x1b[0m  \x1b[37mDisplay this help     \x1b[33m^X\x1b[0m  \x1b[37mExit editor\x1b[0m')
    this.writeLine('\x1b[33m^O\x1b[0m  \x1b[37mSave (WriteOut)       \x1b[33m^K\x1b[0m  \x1b[37mCut line\x1b[0m')
    this.writeLine('\x1b[33m^U\x1b[0m  \x1b[37mPaste (Uncut)        \x1b[33m^Y\x1b[0m  \x1b[37mPrevious page\x1b[0m')
    this.writeLine('\x1b[33m^C\x1b[0m  \x1b[37mShow cursor position\x1b[0m')
    this.render()
  }

  /**
   * Render editor screen
   */
  private render(): void {
    if (!this.session) return

    // Clear screen
    this.write('\x1b[2J\x1b[H')

    // Title bar
    const fileName = this.session.filePath.split('/').pop() || 'Untitled'
    this.writeLine(`\x1b[1;32m ${this.session.type === 'nano' ? 'Nano' : 'Vim'} - ${fileName}\x1b[0m`)
    this.writeLine('\x1b[90m─────────────────────────────────────\x1b[0m')

    // Display lines (15 lines max)
    const maxLines = 15
    const scrollOffset = Math.max(0, this.session.cursorLine - maxLines + 1)
    const displayLines = this.session.lines.slice(scrollOffset, scrollOffset + maxLines)

    displayLines.forEach((line, i) => {
      const actualLine = scrollOffset + i
      const prefix = actualLine === this.session!.cursorLine ? '\x1b[32m>\x1b[0m ' : '  '
      this.writeLine(`${prefix}${line || ''}`)
    })

    if (this.session.lines.length > scrollOffset + maxLines) {
      this.writeLine(`\x1b[90m... ${this.session.lines.length - scrollOffset - maxLines} more lines ...\x1b[0m`)
    }

    this.writeLine('\x1b[90m─────────────────────────────────────\x1b[0m')

    // Status bar
    if (this.session.type === 'nano') {
      this.writeLine('\x1b[36m^G Help  ^O Save  ^X Exit  ^K Cut  ^U Paste\x1b[0m')
    } else {
      this.writeLine('\x1b[33mNORMAL MODE\x1b[0m')
    }

    this.writeLine(`\x1b[90mLine ${this.session.cursorLine + 1}/${this.session.lines.length} | Col ${this.session.cursorCol}\x1b[0m`)
  }

  /**
   * Exit editor
   */
  private async exit(): Promise<void> {
    if (!this.session) return

    // Check if modified
    const currentContent = this.session.lines.join('\n')
    if (currentContent !== this.session.originalContent) {
      // Modified - show confirmation
      this.session.pendingExit = true
      this.write('\x1b[2J\x1b[H')
      this.writeLine('\x1b[33mSave modified buffer?\x1b[0m')
      this.writeLine('')
      this.writeLine('  \x1b[32mY\x1b[0m  Yes - save and exit')
      this.writeLine('  \x1b[31mN\x1b[0m  No - discard changes and exit')
      this.writeLine('  \x1b[90mC\x1b[0m  Cancel - return to editor')
      return
    }

    // Not modified - just exit
    await this.close()
  }

  /**
   * Close editor
   */
  private async close(): Promise<void> {
    this.session = null
    this.updateTerminalState({ mode: 'local' })
    const cwd = this.getCwd()
    this.write(this.getPrompt(cwd))
  }

  /**
   * Get current session
   */
  getSession(): EditorSession | null {
    return this.session
  }

  /**
   * Check if editor is open
   */
  isOpen(): boolean {
    return this.session !== null
  }
}

/**
 * Create Terminal Editor Handler
 */
export function createTerminalEditorHandler(config: TerminalEditorHandlerConfig): TerminalEditorHandler {
  return new TerminalEditorHandler(config)
}


