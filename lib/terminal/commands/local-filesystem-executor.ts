/**
 * Local Filesystem Executor
 * 
 * Provides local shell command execution with full filesystem emulation.
 * Migrated from TerminalPanel.tsx to be reusable across components.
 * 
 * Features:
 * - Full POSIX-like command support (ls, cd, mkdir, rm, cat, etc.)
 * - In-memory filesystem with directory structure
 * - Text editors (nano, vim simulation)
 * - File operations (cp, mv, touch, echo with redirects)
 * - Search operations (grep, find, tree, wc)
 * - System commands (pwd, whoami, date, env, history)
 * - VFS sync for persistence
 * 
 * @example
 * ```typescript
 * const executor = new LocalCommandExecutor('terminal-1')
 * const output = await executor.execute('ls -la')
 * console.log(output)
 * ```
 */

import { createLogger } from '../../utils/logger'

const logger = createLogger('LocalFilesystem')

export interface LocalFilesystemEntry {
  type: 'file' | 'directory'
  content?: string
  createdAt: number
  modifiedAt: number
}

export interface LocalCommandExecutorConfig {
  terminalId: string
  onWrite?: (text: string) => void
  onWriteLine?: (text: string) => void
  onWriteError?: (text: string) => void
  syncToVFS?: (filePath: string, content: string) => Promise<void>
  getFileSystem?: () => Record<string, LocalFilesystemEntry>
  setFileSystem?: (fs: Record<string, LocalFilesystemEntry>) => void
  onOpenEditor?: (filePath: string, editorType: 'nano' | 'vim' | 'vi') => void
  getCwd?: () => string
  setCwd?: (cwd: string) => void
  onFileChanged?: (path: string, type: 'create' | 'update' | 'delete') => void
}

export class LocalCommandExecutor {
  private cwd: Record<string, string> = {}
  private fileSystem: Record<string, LocalFilesystemEntry> = {}
  private commandHistory: string[] = []
  private terminalId: string
  private onWrite?: (text: string) => void
  private onWriteLine?: (text: string) => void
  private onWriteError?: (text: string) => void
  private syncToVFS?: (filePath: string, content: string) => Promise<void>
  private getExtFileSystem?: () => Record<string, LocalFilesystemEntry>
  private setExtFileSystem?: (fs: Record<string, LocalFilesystemEntry>) => void
  private onOpenEditor?: (filePath: string, editorType: 'nano' | 'vim' | 'vi') => void
  private getExtCwd?: () => string
  private setExtCwd?: (cwd: string) => void
  private onFileChanged?: (path: string, type: 'create' | 'update' | 'delete') => void

  constructor(config: LocalCommandExecutorConfig | string) {
    if (typeof config === 'string') {
      this.terminalId = config
    } else {
      this.terminalId = config.terminalId
      this.onWrite = config.onWrite
      this.onWriteLine = config.onWriteLine
      this.onWriteError = config.onWriteError
      this.syncToVFS = config.syncToVFS
      this.getExtFileSystem = config.getFileSystem
      this.setExtFileSystem = config.setFileSystem
      this.onOpenEditor = config.onOpenEditor
      this.getExtCwd = config.getCwd
      this.setExtCwd = config.setCwd
      this.onFileChanged = config.onFileChanged
      
      // If external filesystem provided, load initial state from it
      if (this.getExtFileSystem) {
        const extFs = this.getExtFileSystem()
        if (extFs && Object.keys(extFs).length > 0) {
          this.fileSystem = extFs
        }
      }
    }

    // Initialize cwd - use external cwd if available, otherwise default
    const extCwd = this.getExtCwd?.()
    const defaultCwd = 'project/sessions'
    
    // Use external cwd if provided and valid, otherwise use default
    // FIX: Validate that the CWD actually exists in the filesystem - if not, fall back to default
    let initialCwd = extCwd && extCwd.trim() ? extCwd : defaultCwd
    
    // Check if the directory exists in filesystem, if not use default
    const fs = this.getExtFileSystem?.() || this.fileSystem
    if (!fs[initialCwd] || fs[initialCwd]?.type !== 'directory') {
      initialCwd = defaultCwd
    }
    
    this.cwd[this.terminalId] = initialCwd

    // Ensure project root exists
    if (!this.fileSystem['project']) {
      this.fileSystem = {
        'project': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
      }
    }
  }

  /**
   * Save filesystem to external storage if available
   */
  private saveToExternal(): void {
    if (this.setExtFileSystem) {
      this.setExtFileSystem(this.fileSystem)
    }
  }

  /**
   * Execute a shell command
   */
  async execute(command: string): Promise<string> {
    const trimmed = command.trim()
    if (!trimmed) return ''

    // Add to history
    if (!trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
      this.commandHistory.push(trimmed)
      if (this.commandHistory.length > 100) {
        this.commandHistory.shift()
      }
    }

    const write = (text: string) => {
      if (this.onWrite) this.onWrite(text)
      return true
    }

    const writeLine = (text: string) => {
      if (this.onWriteLine) {
        this.onWriteLine(text)
      } else {
        write(text + '\r\n')
      }
      return true
    }

    const writeError = (text: string) => {
      if (this.onWriteError) {
        this.onWriteError(text)
      } else {
        write(`\x1b[31m${text}\x1b[0m\r\n`)
      }
      return true
    }

    // Check for pipes - chain commands
    if (trimmed.includes('|')) {
      return this.executePipedCommand(trimmed, write, writeLine, writeError)
    }

    // Parse command
    const args = this.parseArgs(trimmed)
    const cmd = args[0]?.toLowerCase()
    const arg1 = args[1]
    const arg2 = args[2]
    const allArgs = args.slice(1).join(' ')

    // Get current working directory
    const cwd = this.cwd[this.terminalId] || 'project'

    // Execute command
    switch (cmd) {
      case 'help':
        return this.executeHelp(writeLine)
      
      case 'clear':
        write('\x1bc')
        return ''
      
      case 'pwd':
        writeLine(cwd.replace(/^project/, '~'))
        return ''
      
      case 'cd':
        return this.executeCd(args, writeError)
      
      case 'ls':
        return this.executeLs(args, writeLine, writeError)
      
      case 'cat':
        return this.executeCat(args, writeLine, writeError)
      
      case 'mkdir':
        return this.executeMkdir(args, writeLine, writeError)
      
      case 'touch':
        return this.executeTouch(args, writeError)
      
      case 'rm':
        return this.executeRm(args, writeLine, writeError)
      
      case 'rmdir':
        return this.executeRmdir(args, writeLine, writeError)
      
      case 'cp':
        return this.executeCp(args, writeLine, writeError)
      
      case 'mv':
        return this.executeMv(args, writeLine, writeError)
      
      case 'echo':
        return this.executeEcho(args, write, writeLine, writeError)
      
      case 'head':
        return this.executeHead(args, writeLine, writeError)
      
      case 'tail':
        return this.executeTail(args, writeLine, writeError)
      
      case 'grep':
        return this.executeGrep(args, writeLine, writeError)
      
      case 'wc':
        return this.executeWc(args, writeLine, writeError)
      
      case 'tree':
        return this.executeTree(writeLine)
      
      case 'find':
        return this.executeFind(args, writeLine)
      
      case 'nano':
      case 'vim':
      case 'vi':
        return this.executeEditor(cmd, args, writeLine, writeError)
      
      case 'history':
        return this.executeHistory(writeLine)
      
      case 'whoami':
        writeLine('user')
        return ''
      
      case 'date':
        writeLine(new Date().toString())
        return ''
      
      case 'env':
        return this.executeEnv(writeLine)

      case 'export':
        return this.executeExport(args, writeLine, writeError)

      case 'connect':
        writeLine('\x1b[33mConnecting to sandbox...\x1b[0m')
        writeLine('\x1b[90m(Use the connect button in the UI)\x1b[0m')
        return ''
      
      case 'disconnect':
        writeLine('\x1b[33mDisconnecting from sandbox...\x1b[0m')
        return ''
      
      case 'status':
        writeLine('\x1b[36m=== Sandbox Status ===\x1b[0m')
        writeLine('Status: \x1b[31mDisconnected\x1b[0m')
        writeLine('Mode: \x1b[33mLocal Shell\x1b[0m')
        writeLine('Type \x1b[32m"connect"\x1b[0m to connect to sandbox')
        return ''
      
      case 'preview':
      case 'preview:html':
      case 'preview:raw':
      case 'preview:parcel':
      case 'preview:devbox':
      case 'preview:pyodide':
      case 'preview:vite':
      case 'preview:webpack':
      case 'preview:node':
        writeLine('\x1b[33mPreview command - use the Preview panel in the UI\x1b[0m')
        return ''
      
      case 'snapshot:create':
      case 'snapshot:restore':
      case 'snapshot:list':
      case 'snapshot:delete':
        writeLine('\x1b[33mSnapshot command - use the Snapshots panel in the UI\x1b[0m')
        return ''
      
      default:
        writeError(`\x1b[31mCommand not found: ${cmd}\x1b[0m`)
        writeLine('Type \x1b[36mhelp\x1b[0m for available commands')
        return ''
    }
  }

  private parseArgs(command: string): string[] {
    // Simple argument parser (handles quoted strings)
    const args: string[] = []
    let current = ''
    let inQuote = false
    let quoteChar = ''

    for (let i = 0; i < command.length; i++) {
      const char = command[i]

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false
          args.push(current)
          current = ''
        } else {
          current += char
        }
      } else if (char === '"' || char === "'") {
        inQuote = true
        quoteChar = char
      } else if (char === ' ') {
        if (current) {
          args.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }

    if (current) {
      args.push(current)
    }

    return args
  }

  private resolvePath(cwd: string, target: string): string {
    if (!target) return cwd
    // Handle ~ first
    if (target === '~' || target === '~/') return 'project'
    if (target.startsWith('~/')) {
      target = 'project/' + target.slice(2)
    }
    // Absolute path
    if (target.startsWith('/')) {
      target = target.slice(1)
    } else {
      // Relative path - prepend cwd
      target = `${cwd}/${target}`
    }
    
    // Normalize: resolve . and .. segments, remove trailing slashes
    const parts = target.split('/').filter(Boolean)
    const stack: string[] = []
    for (const part of parts) {
      if (part === '.') continue
      if (part === '..') {
        // Don't pop below project root
        if (stack.length > 1) stack.pop()
        else if (stack.length === 1 && stack[0] !== 'project') stack.pop()
        continue
      }
      stack.push(part)
    }
    
    const result = stack.join('/')
    // Ensure we always have at least 'project'
    return result || 'project'
  }

  private getParentPath(path: string): string {
    const parts = path.split('/')
    parts.pop()
    return parts.join('/') || 'project'
  }

  private ensureProjectRootExists() {
    const fs = this.getFileSystem()
    if (!fs['project']) {
      fs['project'] = { 
        type: 'directory', 
        createdAt: Date.now(), 
        modifiedAt: Date.now() 
      }
      this.setFileSystem(fs)
    }
  }

  private listDirectory(dirPath: string, fs?: Record<string, LocalFilesystemEntry>): string[] {
    const fileSystem = fs || this.getFileSystem()
    const entries: string[] = []
    for (const key of Object.keys(fileSystem)) {
      const parent = this.getParentPath(key)
      if (parent === dirPath) {
        entries.push(key.split('/').pop() || key)
      }
    }
    return entries.sort()
  }

  // ==================== Command Implementations ====================

  private executeHelp(writeLine: (text: string) => void): string {
    writeLine('\x1b[36m=== Local Shell Commands ===\x1b[0m')
    writeLine('\x1b[33mFile Operations:\x1b[0m')
    writeLine('  ls [-l] [path]     List directory contents')
    writeLine('  pwd                Print working directory')
    writeLine('  cd <dir>           Change directory')
    writeLine('  cat <file>         Display file contents')
    writeLine('  head <file>        Show first 10 lines')
    writeLine('  tail <file>        Show last 10 lines')
    writeLine('  grep <pat> <file>  Search file for pattern')
    writeLine('  wc <file>          Count lines/words/chars')
    writeLine('  tree [dir]         Show directory tree')
    writeLine('  find [dir] [pat]   Find files')
    writeLine('  mkdir <dir>        Create directory')
    writeLine('  touch <file>       Create empty file')
    writeLine('  rm [-rf] <path>    Remove file/directory')
    writeLine('  cp <src> <dst>     Copy file')
    writeLine('  mv <src> <dst>     Move/rename file')
    writeLine('  echo <text>        Output text')
    writeLine('')
    writeLine('\x1b[33mText Editing:\x1b[0m')
    writeLine('  nano <file>        Edit file with nano')
    writeLine('  vim <file>         Edit file with vim')
    writeLine('  vi <file>          Edit file with vi')
    writeLine('')
    writeLine('\x1b[33mSystem:\x1b[0m')
    writeLine('  clear              Clear terminal')
    writeLine('  history            Show command history')
    writeLine('  whoami              Display current user')
    writeLine('  date               Display current date/time')
    writeLine('  env                Display environment variables')
    writeLine('')
    writeLine('\x1b[33mSandbox:\x1b[0m')
    writeLine('  connect            Connect to sandbox')
    writeLine('  disconnect         Disconnect from sandbox')
    writeLine('  status             Show sandbox status')
    return ''
  }

  private executeCd(args: string[], writeError: (text: string) => void): string {
    const target = args.slice(1).join(' ')
    // No argument = go to project root directly (don't resolve 'project' against cwd)
    const nextPath = target ? this.resolvePath(this.cwd[this.terminalId], target) : 'project'
    const fs = this.getFileSystem() // Use external filesystem if available
    
    this.ensureProjectRootExists()

    if (fs[nextPath] && fs[nextPath].type === 'directory') {
      this.cwd[this.terminalId] = nextPath
      // Sync cwd change to external (TerminalPanel)
      if (this.setExtCwd) {
        this.setExtCwd(nextPath)
      }
    } else if (!fs[nextPath]) {
      writeError(`cd: no such directory: ${target}`)
    } else {
      writeError(`cd: not a directory: ${target}`)
    }
    return ''
  }

  private executeLs(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    const showLong = args[1] === '-l' || args[1] === '-la' || args[1] === '-al'
    const explicitTarget = showLong ? (args[1].startsWith('-') ? args[2] : undefined) : args[1]
    // When no explicit target, use cwd directly (don't resolve cwd against itself)
    const targetPath = explicitTarget
      ? this.resolvePath(this.cwd[this.terminalId], explicitTarget)
      : this.cwd[this.terminalId]
    const target = explicitTarget || this.cwd[this.terminalId]
    const fs = this.getFileSystem() // Use external filesystem if available

    this.ensureProjectRootExists()

    if (!fs[targetPath]) {
      const fileCount = Object.keys(fs).filter(k => k !== 'project').length
      if (fileCount === 0) {
        writeLine('\x1b[33m⚠ Filesystem is empty. Files will appear here when created.\x1b[0m')
      } else {
        writeError(`ls: cannot access '${target}': No such file or directory`)
      }
      return ''
    }

    if (fs[targetPath].type === 'file') {
      if (showLong) {
        const info = fs[targetPath]
        const date = new Date(info.modifiedAt).toLocaleDateString()
        writeLine(`-rw-r--r--  1 user  staff  ${info.content?.length || 0}  ${date}  ${target}`)
      } else {
        writeLine(target)
      }
      return ''
    }

    const entries = this.listDirectory(targetPath, fs)
    if (showLong) {
      for (const entry of entries) {
        const entryPath = targetPath === 'project' ? `project/${entry}` : `${targetPath}/${entry}`
        const info = fs[entryPath]
        const prefix = info.type === 'directory' ? 'd' : '-'
        const date = new Date(info.modifiedAt).toLocaleDateString()
        const size = info.content?.length || (info.type === 'directory' ? 0 : 4096)
        writeLine(`${prefix}rw-r--r--  1 user  staff  ${String(size).padStart(5)}  ${date}  ${entry}${info.type === 'directory' ? '/' : ''}`)
      }
    } else {
      const dirs: string[] = []
      const files: string[] = []
      for (const entry of entries) {
        const entryPath = targetPath === 'project' ? `project/${entry}` : `${targetPath}/${entry}`
        if (fs[entryPath]?.type === 'directory') {
          dirs.push(`\x1b[34m${entry}/\x1b[0m`)
        } else {
          files.push(entry)
        }
      }
      writeLine([...dirs, ...files].join('  '))
    }
    return ''
  }

  /**
   * Execute piped commands (e.g., "cat file.txt | grep pattern | wc -l")
   */
  private executePipedCommand(
    command: string,
    write: (text: string) => void,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    // Split by pipe, but respect quoted strings
    const parts = this.splitPipes(command)
    
    if (parts.length === 0) {
      writeError('Invalid pipe syntax')
      return ''
    }

    let input = '' // Input for next command (output from previous)
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      if (!part) continue

      // Execute single command with input from previous command
      const output = this.executeSingleCommand(part, input, write, writeLine, writeError)
      
      // Last command writes to terminal
      if (i === parts.length - 1) {
        if (output) {
          writeLine(output)
        }
      } else {
        // Pass output to next command
        input = output
      }
    }
    
    return ''
  }

  /**
   * Split command string by pipes, respecting quoted strings
   */
  private splitPipes(command: string): string[] {
    const parts: string[] = []
    let current = ''
    let inQuote = false
    let quoteChar = ''

    for (let i = 0; i < command.length; i++) {
      const char = command[i]
      
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true
        quoteChar = char
        current += char
      } else if (char === quoteChar && inQuote) {
        inQuote = false
        quoteChar = ''
        current += char
      } else if (char === '|' && !inQuote) {
        parts.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    
    if (current.trim()) {
      parts.push(current.trim())
    }
    
    return parts
  }

  /**
   * Execute a single command with optional input
   */
  private executeSingleCommand(
    command: string,
    input: string,
    write: (text: string) => void,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const args = this.parseArgs(command)
    const cmd = args[0]?.toLowerCase()
    
    // Capture output instead of writing directly
    let output = ''
    const captureLine = (text: string) => {
      output += text + '\n'
    }
    
    // For commands that read from stdin, use input
    switch (cmd) {
      case 'grep':
        return this.executeGrepWithInput(args, input, captureLine, writeError)
      case 'wc':
        return this.executeWcWithInput(args, input, captureLine, writeError)
      case 'head':
        return this.executeHeadWithInput(args, input, captureLine, writeError)
      case 'tail':
        return this.executeTailWithInput(args, input, captureLine, writeError)
      case 'sort':
        return this.executeSortWithInput(args, input, captureLine, writeError)
      case 'uniq':
        return this.executeUniqWithInput(args, input, captureLine, writeError)
      case 'cut':
        return this.executeCutWithInput(args, input, captureLine, writeError)
      case 'cat':
        // Cat with no args reads from stdin
        if (!args[1]) {
          return input
        }
        break
      default:
        // For other commands, execute normally but capture output
        break
    }
    
    // Execute command normally (writes to captureLine)
    this.executeCommandImpl(cmd, args, write, captureLine, writeError)
    
    return output.trim()
  }

  /**
   * Execute command implementation (extracted for pipe support)
   */
  private executeCommandImpl(
    cmd: string,
    args: string[],
    write: (text: string) => void,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const cwd = this.cwd[this.terminalId] || 'project'
    
    switch (cmd) {
      case 'help':
        return this.executeHelp(writeLine)
      case 'clear':
        write('\x1bc')
        return ''
      case 'pwd':
        writeLine(cwd.replace(/^project/, '~'))
        return ''
      case 'cd':
        return this.executeCd(args, writeError)
      case 'ls':
        return this.executeLs(args, writeLine, writeError)
      case 'cat':
        return this.executeCat(args, writeLine, writeError)
      case 'mkdir':
        return this.executeMkdir(args, writeLine, writeError)
      case 'touch':
        return this.executeTouch(args, writeError)
      case 'rm':
        return this.executeRm(args, writeLine, writeError)
      case 'rmdir':
        return this.executeRmdir(args, writeLine, writeError)
      case 'cp':
        return this.executeCp(args, writeLine, writeError)
      case 'mv':
        return this.executeMv(args, writeLine, writeError)
      case 'echo':
        return this.executeEcho(args, write, writeLine, writeError)
      case 'head':
        return this.executeHead(args, writeLine, writeError)
      case 'tail':
        return this.executeTail(args, writeLine, writeError)
      case 'grep':
        return this.executeGrep(args, writeLine, writeError)
      case 'wc':
        return this.executeWc(args, writeLine, writeError)
      case 'uniq':
        return this.executeUniq(args, writeLine, writeError)
      case 'cut':
        return this.executeCut(args, writeLine, writeError)
      case 'tree':
        return this.executeTree(writeLine)
      case 'find':
        return this.executeFind(args, writeLine)
      case 'nano':
      case 'vim':
      case 'vi':
        return this.executeEditor(cmd, args, writeLine, writeError)
      case 'history':
        return this.executeHistory(writeLine)
      case 'whoami':
        writeLine('user')
        return ''
      case 'date':
        writeLine(new Date().toString())
        return ''
      case 'env':
        return this.executeEnv(writeLine)
      default:
        writeError(`Command not found: ${cmd}`)
        return ''
    }
  }

  /**
   * Grep with stdin input support
   */
  private executeGrepWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    if (!args[1]) {
      writeError('grep: pattern required')
      return ''
    }
    
    const pattern = args[1]
    const lines = input.split('\n')
    const regex = new RegExp(pattern, 'i')
    const matchingLines = lines.filter(line => regex.test(line))
    
    return matchingLines.join('\n')
  }

  /**
   * Wc with stdin input support
   */
  private executeWcWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const lines = input.split('\n').length
    const words = input.split(/\s+/).length
    const chars = input.length
    
    return `${lines} ${words} ${chars}`
  }

  /**
   * Head with stdin input support
   */
  private executeHeadWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const lines = input.split('\n')
    const count = args[1] ? parseInt(args[1].replace('-', '')) : 10
    return lines.slice(0, count).join('\n')
  }

  /**
   * Tail with stdin input support
   */
  private executeTailWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const lines = input.split('\n')
    const count = args[1] ? parseInt(args[1].replace('-', '')) : 10
    return lines.slice(-count).join('\n')
  }

  /**
   * Sort with stdin input support
   */
  private executeSortWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const lines = input.split('\n').filter(l => l.trim())
    const isReverse = args.includes('-r')
    
    const sorted = [...lines].sort((a, b) => {
      if (isReverse) {
        return b.localeCompare(a)
      }
      return a.localeCompare(b)
    })
    
    return sorted.join('\n')
  }

  /**
   * Uniq with stdin input support
   */
  private executeUniqWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const lines = input.split('\n').filter(l => l.trim())
    const isCount = args.includes('-c')
    
    if (isCount) {
      // Count occurrences
      const counts = new Map<string, number>()
      for (const line of lines) {
        counts.set(line, (counts.get(line) || 0) + 1)
      }
      return Array.from(counts.entries())
        .map(([line, count]) => `${count.toString().padStart(4)} ${line}`)
        .join('\n')
    } else {
      // Remove consecutive duplicates
      const unique: string[] = []
      let prev = ''
      for (const line of lines) {
        if (line !== prev) {
          unique.push(line)
          prev = line
        }
      }
      return unique.join('\n')
    }
  }

  /**
   * Cut with stdin input support
   */
  private executeCutWithInput(
    args: string[],
    input: string,
    writeLine: (text: string) => void,
    writeError: (text: string) => void
  ): string {
    const delimiter = args.includes('-d') ? args[args.indexOf('-d') + 1] : '\t'
    const fieldsArg = args.find(a => a.startsWith('-f'))
    
    if (!fieldsArg) {
      writeError('cut: -f required')
      return ''
    }
    
    const fields = fieldsArg.replace('-f', '').split(',').map(f => parseInt(f) - 1)
    const lines = input.split('\n')
    
    const cutLines = lines.map(line => {
      const parts = line.split(delimiter)
      return fields.map(f => parts[f] || '').join(delimiter)
    })
    
    return cutLines.join('\n')
  }

  private executeCat(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('cat: missing file operand')
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    this.ensureProjectRootExists()

    if (!this.fileSystem[filePath]) {
      writeError(`cat: ${args[1]}: No such file or directory`)
      return ''
    }
    if (this.fileSystem[filePath].type === 'directory') {
      writeError(`cat: ${args[1]}: Is a directory`)
      return ''
    }
    const content = this.fileSystem[filePath].content || ''
    writeLine(content.replace(/\n/g, ''))
    return ''
  }

  private executeMkdir(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('mkdir: missing operand')
      return ''
    }
    const dirs = args[1].includes(' ') ? args[1].split(' ') : [args[1]]
    const fs = this.getFileSystem()

    for (const d of dirs) {
      const dirPath = this.resolvePath(this.cwd[this.terminalId], d)

      this.ensureProjectRootExists()

      // Use external filesystem for existence check
      if (fs[dirPath]) {
        writeError(`mkdir: cannot create directory '${d}': File exists`)
        continue
      }

      const parent = this.getParentPath(dirPath)
      if (!fs[parent]) {
        writeError(`mkdir: cannot create directory '${d}': No such file or directory`)
        continue
      }

      // Write to external filesystem
      fs[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }

      // Sync to VFS
      if (this.syncToVFS) {
        this.syncToVFS(`${dirPath}/.keep`, '')
      }
      
      // Emit filesystem event for UI update
      this.emitFilesystemEvent(dirPath, 'create')
    }
    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    return ''
  }

  private executeTouch(args: string[], writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('touch: missing file operand')
      return ''
    }
    const fs = this.getFileSystem()
    const files = args[1].includes(' ') ? args[1].split(' ') : [args[1]]

    for (const f of files) {
      const filePath = this.resolvePath(this.cwd[this.terminalId], f)
      const parent = this.getParentPath(filePath)

      if (!fs[parent]) {
        writeError(`touch: cannot touch '${f}': No such file or directory`)
        continue
      }

      if (fs[filePath]) {
        fs[filePath].modifiedAt = Date.now()
        // Emit update event for existing file
        this.emitFilesystemEvent(filePath, 'update')
      } else {
        fs[filePath] = { type: 'file', content: '', createdAt: Date.now(), modifiedAt: Date.now() }
        if (this.syncToVFS) {
          this.syncToVFS(filePath, '')
        }
        // Emit create event for new file
        this.emitFilesystemEvent(filePath, 'create')
      }
    }
    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    return ''
  }

  private executeRm(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('rm: missing operand')
      return ''
    }
    const fs = this.getFileSystem()
    const isRecursive = args[1] === '-rf' || args[1] === '-fr' || args[1] === '-r'
    const target = isRecursive ? args[2] : args[1]
    const targetPath = this.resolvePath(this.cwd[this.terminalId], target)

    if (!fs[targetPath]) {
      writeError(`rm: cannot remove '${target}': No such file or directory`)
      return ''
    }

    if (fs[targetPath].type === 'directory' && !isRecursive) {
      writeError(`rm: cannot remove '${target}': Is a directory`)
      return ''
    }

    // Collect paths to delete for event emission
    const pathsToDelete: string[] = []
    
    // Remove target and all children
    for (const path of Object.keys(fs)) {
      if (path === targetPath || path.startsWith(`${targetPath}/`)) {
        pathsToDelete.push(path)
        delete fs[path]
      }
    }
    
    // Emit delete events for UI update
    for (const path of pathsToDelete) {
      this.emitFilesystemEvent(path, 'delete')
    }
    
    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    return ''
  }

  private executeRmdir(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('rmdir: missing operand')
      return ''
    }
    const fs = this.getFileSystem()
    const dirPath = this.resolvePath(this.cwd[this.terminalId], args[1])

    if (!fs[dirPath]) {
      writeError(`rmdir: failed to remove '${args[1]}': No such file or directory`)
      return ''
    }

    if (fs[dirPath].type !== 'directory') {
      writeError(`rmdir: failed to remove '${args[1]}': Not a directory`)
      return ''
    }

    const entries = this.listDirectory(dirPath, fs)
    if (entries.length > 0) {
      writeError(`rmdir: failed to remove '${args[1]}': Directory not empty`)
      return ''
    }

    delete fs[dirPath]
    
    // Emit delete event for UI update
    this.emitFilesystemEvent(dirPath, 'delete')
    
    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    return ''
  }

  private executeCp(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1] || !args[2]) {
      writeError('cp: missing file operand')
      return ''
    }
    const srcPath = this.resolvePath(this.cwd[this.terminalId], args[1])
    const dstPath = this.resolvePath(this.cwd[this.terminalId], args[2])

    if (!this.fileSystem[srcPath]) {
      writeError(`cp: cannot stat '${args[1]}': No such file or directory`)
      return ''
    }

    if (this.fileSystem[srcPath].type === 'directory') {
      writeError(`cp: cannot copy directory '${args[1]}': Not implemented`)
      return ''
    }

    const dstParent = this.getParentPath(dstPath)
    if (!this.fileSystem[dstParent]) {
      writeError(`cp: cannot create file '${args[2]}': No such file or directory`)
      return ''
    }

    // Check for conflict - ask for confirmation if destination exists
    if (this.fileSystem[dstPath]) {
      writeError(`cp: '${args[2]}' already exists. Use -f to overwrite.`)
      return ''
    }

    const fs = this.getFileSystem()
    fs[dstPath] = {
      type: 'file',
      content: this.fileSystem[srcPath].content,
      createdAt: Date.now(),
      modifiedAt: Date.now()
    }
    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    
    // Emit filesystem event for UI update
    this.emitFilesystemEvent(dstPath, 'create')
    
    return ''
  }

  private executeMv(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1] || !args[2]) {
      writeError('mv: missing file operand')
      return ''
    }
    const fs = this.getFileSystem()
    const srcPath = this.resolvePath(this.cwd[this.terminalId], args[1])
    const dstPath = this.resolvePath(this.cwd[this.terminalId], args[2])

    // Use external filesystem for existence check
    if (!fs[srcPath]) {
      writeError(`mv: cannot stat '${args[1]}': No such file or directory`)
      return ''
    }

    const dstParent = this.getParentPath(dstPath)
    if (!fs[dstParent]) {
      writeError(`mv: cannot move '${args[1]}': No such file or directory`)
      return ''
    }

    // Check for conflict - ask for confirmation if destination exists
    if (fs[dstPath]) {
      writeError(`mv: cannot move '${args[1]}': '${args[2]}' already exists. Use -f to overwrite.`)
      return ''
    }

    // Check for circular move
    if (dstPath.startsWith(srcPath + '/')) {
      writeError(`mv: cannot move '${args[1]}': cannot move a directory into itself`)
      return ''
    }

    // Move within external filesystem
    fs[dstPath] = { ...fs[srcPath], modifiedAt: Date.now() }
    delete fs[srcPath]

    // Update cwd if we moved the current directory
    if (this.cwd[this.terminalId] === srcPath) {
      this.cwd[this.terminalId] = dstPath
    }

    // Sync changes to external filesystem
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
    
    // Emit filesystem event for UI update
    this.emitFilesystemEvent(dstPath, 'create')

    return ''
  }

  /**
   * Emit filesystem change event for UI synchronization
   */
  private emitFilesystemEvent(path: string, type: 'create' | 'update' | 'delete'): void {
    if (this.onFileChanged) {
      this.onFileChanged(path, type)
    }
  }

  private executeEcho(args: string[], write: (text: string) => void, writeLine: (text: string) => void, writeError: (text: string) => void): string {
    let text = args.slice(1).join(' ')

    // Remove quotes
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1)
    }

    // Expand environment variables
    text = this.expandVariables(text)

    // Check for redirect
    const redirectMatch = args.slice(1).join(' ').match(/^(.*?)\s*>\s*(.+?)$/)
    if (redirectMatch) {
      const [, echoText, fileName] = redirectMatch
      const filePath = this.resolvePath(this.cwd[this.terminalId], fileName.trim())
      const parent = this.getParentPath(filePath)

      this.ensureProjectRootExists()

      if (!this.fileSystem[parent] && parent === 'project') {
        this.fileSystem['project'] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }
      }

      if (!this.fileSystem[parent]) {
        writeError(`echo: cannot write to '${fileName.trim()}': No such file or directory`)
        return ''
      }

      this.fileSystem[filePath] = {
        type: 'file',
        content: this.expandVariables(echoText.trim()) + '\n',
        createdAt: Date.now(),
        modifiedAt: Date.now()
      }

      if (this.syncToVFS) {
        this.syncToVFS(filePath, this.expandVariables(echoText.trim()) + '\n')
      }
      // Sync changes to external filesystem
      if (this.setExtFileSystem) {
        this.setExtFileSystem(this.fileSystem)
      }
      return ''
    }

    writeLine(text)
    return ''
  }

  private executeHead(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('head: missing file operand')
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    if (!this.fileSystem[filePath]) {
      writeError(`head: cannot open '${args[1]}': No such file or directory`)
      return ''
    }
    
    const content = this.fileSystem[filePath].content || ''
    const lines = content.split('\n').slice(0, 10)
    writeLine(lines.join('\n'))
    return ''
  }

  private executeTail(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('tail: missing file operand')
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    if (!this.fileSystem[filePath]) {
      writeError(`tail: cannot open '${args[1]}': No such file or directory`)
      return ''
    }
    
    const content = this.fileSystem[filePath].content || ''
    const lines = content.split('\n').slice(-10)
    writeLine(lines.join('\n'))
    return ''
  }

  private executeGrep(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1] || !args[2]) {
      writeError('grep: pattern and file required')
      return ''
    }
    const pattern = args[1]
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[2])
    
    if (!this.fileSystem[filePath]) {
      writeError(`grep: ${args[2]}: No such file or directory`)
      return ''
    }
    
    const content = this.fileSystem[filePath].content || ''
    const regex = new RegExp(pattern, 'i')
    const matchingLines = content.split('\n').filter(line => regex.test(line))
    writeLine(matchingLines.join('\n'))
    return ''
  }

  private executeWc(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('wc: missing file operand')
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    if (!this.fileSystem[filePath]) {
      writeError(`wc: ${args[1]}: No such file or directory`)
      return ''
    }
    
    const content = this.fileSystem[filePath].content || ''
    const lines = content.split('\n').length
    const words = content.split(/\s+/).length
    const chars = content.length
    
    writeLine(`${lines} ${words} ${chars} ${args[1]}`)
    return ''
  }

  private executeUniq(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('uniq: missing file operand')
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    if (!this.fileSystem[filePath]) {
      writeError(`uniq: ${args[1]}: No such file or directory`)
      return ''
    }
    
    const content = this.fileSystem[filePath].content || ''
    const lines = content.split('\n').filter(l => l.trim())
    const isCount = args.includes('-c')
    
    if (isCount) {
      const counts = new Map<string, number>()
      for (const line of lines) {
        counts.set(line, (counts.get(line) || 0) + 1)
      }
      writeLine(Array.from(counts.entries())
        .map(([line, count]) => `${count.toString().padStart(4)} ${line}`)
        .join('\n'))
    } else {
      const unique: string[] = []
      let prev = ''
      for (const line of lines) {
        if (line !== prev) {
          unique.push(line)
          prev = line
        }
      }
      writeLine(unique.join('\n'))
    }
    return ''
  }

  private executeCut(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('cut: missing file operand')
      return ''
    }
    
    const fieldsArg = args.find(a => a.startsWith('-f'))
    if (!fieldsArg) {
      writeError('cut: -f required')
      return ''
    }
    
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[args.length - 1])
    
    if (!this.fileSystem[filePath]) {
      writeError(`cut: ${args[args.length - 1]}: No such file or directory`)
      return ''
    }
    
    const delimiter = args.includes('-d') ? args[args.indexOf('-d') + 1] : '\t'
    const fields = fieldsArg.replace('-f', '').split(',').map(f => parseInt(f) - 1)
    const content = this.fileSystem[filePath].content || ''
    const lines = content.split('\n')
    
    const cutLines = lines.map(line => {
      const parts = line.split(delimiter)
      return fields.map(f => parts[f] || '').join(delimiter)
    })
    
    writeLine(cutLines.join('\n'))
    return ''
  }

  private executeTree(writeLine: (text: string) => void): string {
    writeLine('project/')
    
    const printTree = (dir: string, prefix: string = '') => {
      const entries = this.listDirectory(dir)
      entries.forEach((entry, i) => {
        const isLast = i === entries.length - 1
        const entryPath = `${dir}/${entry}`
        const connector = isLast ? '└── ' : '├── '
        
        if (this.fileSystem[entryPath]?.type === 'directory') {
          writeLine(`${prefix}${connector}\x1b[34m${entry}/\x1b[0m`)
          printTree(entryPath, prefix + (isLast ? '    ' : '│   '))
        } else {
          writeLine(`${prefix}${connector}${entry}`)
        }
      })
    }
    
    printTree('project')
    return ''
  }

  private executeFind(args: string[], writeLine: (text: string) => void): string {
    const startDir = args[1] || 'project'
    const pattern = args[2] || '*'
    const startPath = this.resolvePath(this.cwd[this.terminalId], startDir)
    
    const results: string[] = []
    for (const path of Object.keys(this.fileSystem)) {
      if (path.startsWith(startPath) && path.split('/').pop()?.includes(pattern)) {
        results.push(path)
      }
    }
    
    writeLine(results.join('\n'))
    return ''
  }

  private executeEditor(cmd: string, args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError(`${cmd}: missing file operand`)
      return ''
    }
    const filePath = this.resolvePath(this.cwd[this.terminalId], args[1])
    
    // Check if file exists, get its content
    const fs = this.getFileSystem()
    const fileExists = !!fs[filePath]
    
    // Try to open editor - if callback provided, use it; otherwise show message
    if (this.onOpenEditor) {
      this.onOpenEditor(filePath, cmd as 'nano' | 'vim' | 'vi')
      return ''
    }
    
    // Fallback message if no editor callback
    writeLine(`\x1b[33mOpening ${cmd} editor for ${filePath}...\x1b[0m`)
    if (!fileExists) {
      writeLine(`\x1b[90m(File will be created on save)\x1b[0m`)
    }
    writeLine(`\x1b[90m(Use the Files panel to edit files in the UI)\x1b[0m`)
    return ''
  }

  private executeHistory(writeLine: (text: string) => void): string {
    this.commandHistory.forEach((cmd, i) => {
      writeLine(`  ${i + 1}  ${cmd}`)
    })
    return ''
  }

  private envVars: Record<string, string> = {
    'TERM': 'xterm-256color',
    'LANG': 'en_US.UTF-8',
    'PWD': 'project',
    'HOME': '/home/user',
    'USER': 'user',
    'SHELL': '/bin/bash',
  }

  private executeEnv(writeLine: (text: string) => void): string {
    // Update PWD from current cwd
    this.envVars['PWD'] = this.cwd[this.terminalId] || 'project'
    
    // Print all environment variables
    for (const [key, value] of Object.entries(this.envVars)) {
      writeLine(`${key}=${value}`)
    }
    return ''
  }

  private executeExport(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      // Print all exported variables
      for (const [key, value] of Object.entries(this.envVars)) {
        writeLine(`export ${key}="${value}"`)
      }
      return ''
    }
    
    // Parse export VAR=value or export VAR
    const exportArg = args[1]
    const eqIndex = exportArg.indexOf('=')
    
    if (eqIndex > 0) {
      const key = exportArg.substring(0, eqIndex)
      let value = exportArg.substring(eqIndex + 1)
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      
      // Expand existing variables
      value = this.expandVariables(value)
      
      this.envVars[key] = value
      this.envVars['PWD'] = this.cwd[this.terminalId] || 'project'
    } else {
      // Just mark variable for export (already exported if exists)
      const key = exportArg
      if (!this.envVars[key]) {
        this.envVars[key] = ''
      }
    }
    
    return ''
  }

  /**
   * Expand $VAR and ${VAR} in string
   */
  private expandVariables(str: string): string {
    return str.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (match, varName) => {
      return this.envVars[varName] || ''
    })
  }

  // ==================== Getters ====================

  getFileSystem(): Record<string, LocalFilesystemEntry> {
    // If external filesystem provided, use it
    if (this.getExtFileSystem) {
      return this.getExtFileSystem()
    }
    return this.fileSystem
  }

  getCwd(): string {
    // Return external cwd if available, otherwise return internal
    if (this.getExtCwd) {
      const extCwd = this.getExtCwd()
      if (extCwd && extCwd.trim()) {
        return extCwd
      }
    }
    return this.cwd[this.terminalId] || 'project'
  }

  setCwd(cwd: string): void {
    // Validate cwd
    if (!cwd || typeof cwd !== 'string') {
      console.warn('[LocalCommandExecutor] Invalid cwd:', cwd)
      return
    }

    // Update internal state
    this.cwd[this.terminalId] = cwd

    // Sync to external if available
    if (this.setExtCwd) {
      this.setExtCwd(cwd)
    }
  }

  setFileSystem(fs: Record<string, LocalFilesystemEntry>): void {
    // Always update local copy
    this.fileSystem = fs
    // Also sync to external if available
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    }
  }
}
