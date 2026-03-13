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

import { createLogger } from '../utils/logger'

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
      
      // If external filesystem provided, load initial state from it
      if (this.getExtFileSystem) {
        const extFs = this.getExtFileSystem()
        if (extFs && Object.keys(extFs).length > 0) {
          this.fileSystem = extFs
        }
      }
    }

    // Ensure project root exists
    if (!this.fileSystem['project']) {
      this.fileSystem = {
        'project': { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() },
      }
    }

    this.cwd[this.terminalId] = '~/project'
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

    // Parse command
    const args = this.parseArgs(trimmed)
    const cmd = args[0]?.toLowerCase()
    const arg1 = args[1]
    const arg2 = args[2]
    const allArgs = args.slice(1).join(' ')

    // Get current working directory
    const cwd = this.cwd[this.terminalId] || '~/project'

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
    if (target.startsWith('~/')) return target.replace('~/', 'project/')
    if (target.startsWith('/')) return target.slice(1)
    if (target === '~') return 'project'
    
    // Relative path
    if (target === '.') return cwd
    if (target === '..') {
      const parts = cwd.split('/')
      parts.pop()
      return parts.join('/') || 'project'
    }
    
    return `${cwd}/${target}`.replace(/\/+/g, '/')
  }

  private getParentPath(path: string): string {
    const parts = path.split('/')
    parts.pop()
    return parts.join('/') || 'project'
  }

  private ensureProjectRootExists() {
    if (!this.fileSystem['project']) {
      this.fileSystem['project'] = { 
        type: 'directory', 
        createdAt: Date.now(), 
        modifiedAt: Date.now() 
      }
    }
  }

  private listDirectory(dirPath: string): string[] {
    const entries: string[] = []
    for (const key of Object.keys(this.fileSystem)) {
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
    const target = args.slice(1).join(' ') || 'project'
    const nextPath = this.resolvePath(this.cwd[this.terminalId], target)
    
    this.ensureProjectRootExists()

    if (this.fileSystem[nextPath] && this.fileSystem[nextPath].type === 'directory') {
      this.cwd[this.terminalId] = nextPath
    } else if (!this.fileSystem[nextPath]) {
      writeError(`cd: no such directory: ${target}`)
    } else {
      writeError(`cd: not a directory: ${target}`)
    }
    return ''
  }

  private executeLs(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    const showLong = args[1] === '-l' || args[1] === '-la' || args[1] === '-al'
    const target = showLong ? (args[1].startsWith('-') ? args[2] : args[1]) : (args[1] || this.cwd[this.terminalId])
    const targetPath = this.resolvePath(this.cwd[this.terminalId], target)

    this.ensureProjectRootExists()

    if (!this.fileSystem[targetPath]) {
      const fileCount = Object.keys(this.fileSystem).filter(k => k !== 'project').length
      if (fileCount === 0) {
        writeLine('\x1b[33m⚠ Filesystem is empty. Files will appear here when created.\x1b[0m')
      } else {
        writeError(`ls: cannot access '${target}': No such file or directory`)
      }
      return ''
    }

    if (this.fileSystem[targetPath].type === 'file') {
      if (showLong) {
        const info = this.fileSystem[targetPath]
        const date = new Date(info.modifiedAt).toLocaleDateString()
        writeLine(`-rw-r--r--  1 user  staff  ${info.content?.length || 0}  ${date}  ${target}`)
      } else {
        writeLine(target)
      }
      return ''
    }

    const entries = this.listDirectory(targetPath)
    if (showLong) {
      for (const entry of entries) {
        const entryPath = targetPath === 'project' ? `project/${entry}` : `${targetPath}/${entry}`
        const info = this.fileSystem[entryPath]
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
        if (this.fileSystem[entryPath]?.type === 'directory') {
          dirs.push(`\x1b[34m${entry}/\x1b[0m`)
        } else {
          files.push(entry)
        }
      }
      writeLine([...dirs, ...files].join('  '))
    }
    return ''
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
    
    for (const d of dirs) {
      const dirPath = this.resolvePath(this.cwd[this.terminalId], d)
      
      this.ensureProjectRootExists()

      if (this.fileSystem[dirPath]) {
        writeError(`mkdir: cannot create directory '${d}': File exists`)
        continue
      }

      const parent = this.getParentPath(dirPath)
      if (!this.fileSystem[parent]) {
        writeError(`mkdir: cannot create directory '${d}': No such file or directory`)
        continue
      }

      this.fileSystem[dirPath] = { type: 'directory', createdAt: Date.now(), modifiedAt: Date.now() }
      
      // Sync to VFS
      if (this.syncToVFS) {
        this.syncToVFS(`${dirPath}/.keep`, '')
      }
    }
    return ''
  }

  private executeTouch(args: string[], writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('touch: missing file operand')
      return ''
    }
    const files = args[1].includes(' ') ? args[1].split(' ') : [args[1]]
    
    for (const f of files) {
      const filePath = this.resolvePath(this.cwd[this.terminalId], f)
      const parent = this.getParentPath(filePath)

      if (!this.fileSystem[parent]) {
        writeError(`touch: cannot touch '${f}': No such file or directory`)
        continue
      }

      if (this.fileSystem[filePath]) {
        this.fileSystem[filePath].modifiedAt = Date.now()
      } else {
        this.fileSystem[filePath] = { type: 'file', content: '', createdAt: Date.now(), modifiedAt: Date.now() }
        if (this.syncToVFS) {
          this.syncToVFS(filePath, '')
        }
      }
    }
    return ''
  }

  private executeRm(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('rm: missing operand')
      return ''
    }
    const isRecursive = args[1] === '-rf' || args[1] === '-fr' || args[1] === '-r'
    const target = isRecursive ? args[2] : args[1]
    const targetPath = this.resolvePath(this.cwd[this.terminalId], target)

    if (!this.fileSystem[targetPath]) {
      writeError(`rm: cannot remove '${target}': No such file or directory`)
      return ''
    }

    if (this.fileSystem[targetPath].type === 'directory' && !isRecursive) {
      writeError(`rm: cannot remove '${target}': Is a directory`)
      return ''
    }

    // Remove target and all children
    for (const path of Object.keys(this.fileSystem)) {
      if (path === targetPath || path.startsWith(`${targetPath}/`)) {
        delete this.fileSystem[path]
      }
    }
    return ''
  }

  private executeRmdir(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1]) {
      writeError('rmdir: missing operand')
      return ''
    }
    const dirPath = this.resolvePath(this.cwd[this.terminalId], args[1])

    if (!this.fileSystem[dirPath]) {
      writeError(`rmdir: failed to remove '${args[1]}': No such file or directory`)
      return ''
    }

    if (this.fileSystem[dirPath].type !== 'directory') {
      writeError(`rmdir: failed to remove '${args[1]}': Not a directory`)
      return ''
    }

    const entries = this.listDirectory(dirPath)
    if (entries.length > 0) {
      writeError(`rmdir: failed to remove '${args[1]}': Directory not empty`)
      return ''
    }

    delete this.fileSystem[dirPath]
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

    this.fileSystem[dstPath] = {
      type: 'file',
      content: this.fileSystem[srcPath].content,
      createdAt: Date.now(),
      modifiedAt: Date.now()
    }
    return ''
  }

  private executeMv(args: string[], writeLine: (text: string) => void, writeError: (text: string) => void): string {
    if (!args[1] || !args[2]) {
      writeError('mv: missing file operand')
      return ''
    }
    const srcPath = this.resolvePath(this.cwd[this.terminalId], args[1])
    const dstPath = this.resolvePath(this.cwd[this.terminalId], args[2])

    if (!this.fileSystem[srcPath]) {
      writeError(`mv: cannot stat '${args[1]}': No such file or directory`)
      return ''
    }

    const dstParent = this.getParentPath(dstPath)
    if (!this.fileSystem[dstParent]) {
      writeError(`mv: cannot move '${args[1]}': No such file or directory`)
      return ''
    }

    this.fileSystem[dstPath] = { ...this.fileSystem[srcPath], modifiedAt: Date.now() }
    delete this.fileSystem[srcPath]
    return ''
  }

  private executeEcho(args: string[], write: (text: string) => void, writeLine: (text: string) => void, writeError: (text: string) => void): string {
    let text = args.slice(1).join(' ')
    
    // Remove quotes
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1)
    }

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
        content: echoText.trim() + '\n',
        createdAt: Date.now(),
        modifiedAt: Date.now()
      }

      if (this.syncToVFS) {
        this.syncToVFS(filePath, echoText.trim() + '\n')
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
    
    writeLine(`\x1b[33mOpening ${cmd} editor for ${filePath}...\x1b[0m`)
    writeLine(`\x1b[90m(Use the Files panel to edit files in the UI)\x1b[0m`)
    return ''
  }

  private executeHistory(writeLine: (text: string) => void): string {
    this.commandHistory.forEach((cmd, i) => {
      writeLine(`  ${i + 1}  ${cmd}`)
    })
    return ''
  }

  private executeEnv(writeLine: (text: string) => void): string {
    writeLine('TERM=xterm-256color')
    writeLine('LANG=en_US.UTF-8')
    writeLine('PWD=' + this.cwd[this.terminalId])
    writeLine('HOME=/home/user')
    writeLine('USER=user')
    writeLine('SHELL=/bin/bash')
    return ''
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
    return this.cwd[this.terminalId]
  }

  setCwd(cwd: string): void {
    this.cwd[this.terminalId] = cwd
  }

  setFileSystem(fs: Record<string, LocalFilesystemEntry>): void {
    // If external filesystem provided, sync to it
    if (this.setExtFileSystem) {
      this.setExtFileSystem(fs)
    } else {
      this.fileSystem = fs
    }
  }
}
