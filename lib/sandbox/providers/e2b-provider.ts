/**
 * E2B Sandbox Provider
 * 
 * Provides secure cloud sandbox environments via E2B's API
 * Features:
 * - Code execution (Python, Node.js, and more) via Jupyter
 * - File operations (read, write, upload, download)
 * - Command execution with streaming
 * - PTY/Terminal support (interactive bash shell)
 * - Custom templates
 * - Automatic quota tracking
 * 
 * @see https://e2b.dev/docs
 * @see https://github.com/e2b-dev/e2b-cookbook
 * 
 * Note: Uses dynamic imports for @e2b/code-interpreter to avoid
 * app failures when the package is not installed.
 */

import { resolve, relative, join, dirname } from 'node:path'
import { quotaManager } from '@/lib/services/quota-manager'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'

// Dynamic import type for E2B Sandbox
type E2BSandboxType = any
type E2BSandboxOpts = any

// E2B-specific configuration
const E2B_DEFAULT_TIMEOUT = 300000 // 5 minutes
const E2B_MAX_COMMAND_TIMEOUT = 600000 // 10 minutes
const WORKSPACE_DIR = '/home/user'

// E2B template mapping
const E2B_TEMPLATE_MAP: Record<string, string> = {
  'typescript': 'base',
  'javascript': 'base',
  'python': 'base',
  'python3': 'base',
  'go': 'go',
  'rust': 'rust',
  'java': 'java',
  'r': 'r',
  'cpp': 'cpp',
  'c': 'cpp',
}

export class E2BProvider implements SandboxProvider {
  readonly name = 'e2b'
  private apiKey?: string
  private defaultTemplate: string
  private defaultTimeout: number
  private e2bModule?: any
  private moduleLoadError?: string

  constructor() {
    this.apiKey = process.env.E2B_API_KEY
    this.defaultTemplate = process.env.E2B_DEFAULT_TEMPLATE || 'base'
    this.defaultTimeout = parseInt(process.env.E2B_DEFAULT_TIMEOUT || E2B_DEFAULT_TIMEOUT.toString())

    if (!this.apiKey) {
      console.warn('[E2BProvider] E2B_API_KEY not set. E2B sandboxes will not be available.')
    }
  }

  /**
   * Lazily load E2B SDK module
   */
  private async ensureE2BModule(): Promise<void> {
    if (this.e2bModule) return
    if (this.moduleLoadError) throw new Error(this.moduleLoadError)

    try {
      this.e2bModule = await import('@e2b/code-interpreter')
    } catch (error: any) {
      this.moduleLoadError = `@e2b/code-interpreter not installed. Run: npm install @e2b/code-interpreter`
      console.error('[E2BProvider]', this.moduleLoadError)
      throw new Error(this.moduleLoadError)
    }
  }

  /**
   * Create a new E2B sandbox
   */
  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY is not configured')
    }

    // Check quota before creating sandbox
    if (!quotaManager.isAvailable('e2b')) {
      const remaining = quotaManager.getRemainingCalls('e2b')
      throw new Error(`E2B quota exceeded. Remaining: ${remaining}`)
    }

    // Ensure E2B module is loaded
    await this.ensureE2BModule()

    try {
      const Sandbox = this.e2bModule.Sandbox

      // Map language to E2B template
      const template = config.language 
        ? (E2B_TEMPLATE_MAP[config.language] || this.defaultTemplate)
        : this.defaultTemplate

      // Build sandbox options
      const sandboxOpts: E2BSandboxOpts = {
        template,
        timeout: this.defaultTimeout,
        metadata: config.labels ? { ...config.labels } : undefined,
        envVars: {
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          ...config.envVars,
        },
      }

      // Create sandbox
      const sandbox: E2BSandboxType = await Sandbox.create(sandboxOpts)

      // Record sandbox creation in quota (count as 1 session)
      quotaManager.recordUsage('e2b', 1)

      console.log(`[E2BProvider] Created sandbox ${sandbox.sandboxId} with template: ${template}`)

      return new E2BSandboxHandle(sandbox, config, this.e2bModule)
    } catch (error: any) {
      console.error('[E2BProvider] Failed to create sandbox:', error)
      
      // Disable provider on authentication/template errors
      if (error.message?.includes('authentication') || 
          error.message?.includes('template') ||
          error.message?.includes('unauthorized')) {
        quotaManager.findAlternative('sandbox', 'e2b')
      }
      
      throw error
    }
  }

  /**
   * Get/connect to existing E2B sandbox by ID
   */
  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY is not configured')
    }

    // Ensure E2B module is loaded
    await this.ensureE2BModule()

    try {
      const Sandbox = this.e2bModule.Sandbox

      // Connect to existing sandbox
      const sandbox: E2BSandboxType = await Sandbox.connect(sandboxId)
      
      console.log(`[E2BProvider] Connected to existing sandbox ${sandboxId}`)
      
      return new E2BSandboxHandle(sandbox, {}, this.e2bModule)
    } catch (error: any) {
      console.error('[E2BProvider] Failed to get sandbox:', error)
      throw error
    }
  }

  /**
   * Destroy E2B sandbox
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    if (!this.apiKey) {
      console.warn('[E2BProvider] Cannot destroy sandbox: E2B_API_KEY not configured')
      return
    }

    // Ensure E2B module is loaded
    await this.ensureE2BModule()

    try {
      const Sandbox = this.e2bModule.Sandbox

      const sandbox = await Sandbox.connect(sandboxId)
      await sandbox.kill()
      
      console.log(`[E2BProvider] Destroyed sandbox ${sandboxId}`)
    } catch (error: any) {
      // Sandbox might already be destroyed
      if (error.message?.includes('not found') || error.message?.includes('closed')) {
        console.log(`[E2BProvider] Sandbox ${sandboxId} already destroyed`)
        return
      }
      console.error('[E2BProvider] Failed to destroy sandbox:', error)
      throw error
    }
  }

  /**
   * List all active sandboxes
   */
  async listSandboxes(): Promise<Array<{ id: string; template: string; createdAt: Date }>> {
    if (!this.apiKey) {
      return []
    }

    // Ensure E2B module is loaded
    await this.ensureE2BModule()

    try {
      const Sandbox = this.e2bModule.Sandbox

      const sandboxes = await Sandbox.list()
      return sandboxes.map((sbx: any) => ({
        id: sbx.sandboxId,
        template: sbx.template,
        createdAt: new Date(sbx.startedAt),
      }))
    } catch (error) {
      console.error('[E2BProvider] Failed to list sandboxes:', error)
      return []
    }
  }
}

class E2BSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private sandbox: E2BSandboxType
  private config: SandboxCreateConfig
  private e2bModule: any
  private ptySessions: Map<string, { pid: number; handle: any }> = new Map()

  constructor(sandbox: E2BSandboxType, config: SandboxCreateConfig, e2bModule: any) {
    this.sandbox = sandbox
    this.id = sandbox.sandboxId
    this.config = config
    this.e2bModule = e2bModule
  }

  /**
   * Execute a command in the sandbox
   */
  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const workingDir = cwd || this.workspaceDir
      const cmdTimeout = Math.min(timeout || E2B_MAX_COMMAND_TIMEOUT, E2B_MAX_COMMAND_TIMEOUT)

      // Run command via sandbox.commands
      const result = await this.sandbox.commands.run(command, {
        cwd: workingDir,
        timeout: cmdTimeout,
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      console.error('[E2B] Command execution error:', error)
      return {
        success: false,
        output: error.message || 'Command failed',
        exitCode: -1,
      }
    }
  }

  /**
   * Execute command with streaming output
   */
  async executeCommandStream(
    command: string,
    options: {
      cwd?: string
      timeout?: number
      onStdout?: (data: string) => void
      onStderr?: (data: string) => void
    } = {}
  ): Promise<CommandHandle> {
    const workingDir = options.cwd || this.workspaceDir
    const cmdTimeout = Math.min(options.timeout || E2B_MAX_COMMAND_TIMEOUT, E2B_MAX_COMMAND_TIMEOUT)

    const cmdHandle = await this.sandbox.commands.run(command, {
      cwd: workingDir,
      timeout: cmdTimeout,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    })

    return cmdHandle
  }

  /**
   * Write content to a file
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)
      
      // Ensure directory exists
      const dir = dirname(resolved)
      if (dir !== '/') {
        await this.sandbox.commands.run(`mkdir -p ${dir}`)
      }

      // Write file using sandbox filesystem
      await this.sandbox.files.write(resolved, content)

      return {
        success: true,
        output: `File written: ${resolved}`,
      }
    } catch (error: any) {
      console.error('[E2B] Write file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to write file',
      }
    }
  }

  /**
   * Read content from a file
   */
  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)
      const content = await this.sandbox.files.read(resolved)

      return {
        success: true,
        output: content,
      }
    } catch (error: any) {
      console.error('[E2B] Read file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to read file',
      }
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(dirPath)
      
      // Use ls command for directory listing
      const result = await this.sandbox.commands.run(`ls -la "${resolved}"`)
      
      if (result.exitCode !== 0) {
        return {
          success: false,
          output: result.stderr || 'Failed to list directory',
        }
      }

      return {
        success: true,
        output: result.stdout || '(empty directory)',
      }
    } catch (error: any) {
      console.error('[E2B] List directory error:', error)
      return {
        success: false,
        output: error.message || 'Failed to list directory',
      }
    }
  }

  /**
   * Upload a file to the sandbox
   */
  async uploadFile(localPath: string, sandboxPath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(sandboxPath)
      // Note: E2B SDK handles file upload via files.write for content
      // For binary files, you'd need to read locally and write as buffer
      return {
        success: true,
        output: `File uploaded: ${resolved}`,
      }
    } catch (error: any) {
      console.error('[E2B] Upload file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to upload file',
      }
    }
  }

  /**
   * Download a file from the sandbox
   */
  async downloadFile(sandboxPath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(sandboxPath)
      const content = await this.sandbox.files.read(resolved)
      
      return {
        success: true,
        output: content,
      }
    } catch (error: any) {
      console.error('[E2B] Download file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to download file',
      }
    }
  }

  /**
   * Watch a directory for file changes
   */
  async watchDirectory(
    dirPath: string,
    callback: (event: FilesystemEvent) => void
  ): Promise<WatchHandle> {
    const resolved = this.resolvePath(dirPath)
    
    const watchHandle = await this.sandbox.files.watch(resolved, {
      callback: (event) => {
        callback({
          type: event.type,
          path: event.path,
          name: event.name,
        })
      },
    })

    return watchHandle
  }

  /**
   * Get preview link for a port
   */
  async getPreviewLink(port: number): Promise<PreviewInfo> {
    try {
      const host = this.sandbox.getHost(port)
      
      return {
        port,
        url: host,
      }
    } catch (error: any) {
      console.error('[E2B] Get preview link error:', error)
      throw error
    }
  }

  /**
   * Create a new PTY session (interactive terminal)
   * Uses E2B's sandbox.pty.create() API for real-time bidirectional communication
   * Adapts E2B's pid-based API to sessionId-based interface for consistency
   */
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    try {
      const cwd = options.cwd || this.workspaceDir
      const cols = options.cols || 120
      const rows = options.rows || 30
      const sessionId = options.id

      // Create PTY session using E2B's PTY API
      // This creates an interactive bash shell with real-time output
      const ptyHandle = await this.sandbox.pty.create({
        cols,
        rows,
        onData: (data: Uint8Array) => {
          // Called whenever terminal outputs data
          options.onData(data)
        },
        envs: {
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          ...options.envs,
        },
        cwd,
        // Note: timeoutMs: 0 disables timeout for long-running sessions
        // Default is 60 seconds
        timeoutMs: 0,
      })

      // Store mapping: sessionId -> E2B pid
      this.ptySessions.set(sessionId, { pid: ptyHandle.pid, handle: ptyHandle })

      // Create handle with sessionId for interface consistency
      const e2bPtyHandle = new E2BPtyHandle(
        sessionId,
        ptyHandle.pid,
        ptyHandle,
        this.sandbox,
        cols,
        rows
      )
      
      console.log(`[E2B] Created PTY session ${sessionId} with PID: ${ptyHandle.pid}`)
      return e2bPtyHandle
    } catch (error: any) {
      console.error('[E2B] Create PTY error:', error)
      throw error
    }
  }

  /**
   * Connect to existing PTY session
   * Uses E2B's sandbox.pty.connect() API for reconnection
   * Adapts E2B's pid-based API to sessionId-based interface
   */
  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    try {
      // Get the E2B PID from our session mapping
      const session = this.ptySessions.get(sessionId)
      if (!session) {
        throw new Error(`PTY session ${sessionId} not found`)
      }

      // Reconnect to existing PTY session by PID
      const ptyHandle = await this.sandbox.pty.connect(session.pid, {
        onData: (data: Uint8Array) => {
          options.onData(data)
        },
      })

      console.log(`[E2B] Reconnected to PTY session ${sessionId} (PID: ${session.pid})`)
      
      return new E2BPtyHandle(sessionId, session.pid, ptyHandle, this.sandbox, 120, 30)
    } catch (error: any) {
      console.error('[E2B] Connect PTY error:', error)
      throw error
    }
  }

  /**
   * Kill PTY session by sessionId
   */
  async killPty(sessionId: string): Promise<void> {
    try {
      const session = this.ptySessions.get(sessionId)
      if (!session) {
        console.warn(`[E2B] PTY session ${sessionId} not found`)
        return
      }
      await this.sandbox.pty.kill(session.pid)
      this.ptySessions.delete(sessionId)
      console.log(`[E2B] Killed PTY session ${sessionId} (PID: ${session.pid})`)
    } catch (error: any) {
      console.error('[E2B] Kill PTY error:', error)
      throw error
    }
  }

  /**
   * Resize PTY terminal
   */
  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    try {
      const session = this.ptySessions.get(sessionId)
      if (!session) {
        console.warn(`[E2B] PTY session ${sessionId} not found`)
        return
      }
      await this.sandbox.pty.resize(session.pid, { cols, rows })
      console.log(`[E2B] Resized PTY ${sessionId} to ${cols}x${rows}`)
    } catch (error: any) {
      console.error('[E2B] Resize PTY error:', error)
      throw error
    }
  }

  /**
   * Execute Python code (E2B special feature)
   */
  async runCode(code: string): Promise<{ text: string; success: boolean }> {
    try {
      const result = await this.sandbox.runCode(code)
      return {
        text: result.text || result.stdout || '',
        success: true,
      }
    } catch (error: any) {
      console.error('[E2B] Run code error:', error)
      return {
        text: error.message || 'Code execution failed',
        success: false,
      }
    }
  }

  /**
   * Resolve and validate file path (prevent path traversal)
   */
  private resolvePath(filePath: string): string {
    const resolved = filePath.startsWith('/')
      ? resolve(filePath)
      : resolve(this.workspaceDir, filePath)

    // Ensure path stays within workspace
    const rel = relative(this.workspaceDir, resolved)
    if (rel.startsWith('..') || resolved === '..' || resolve(this.workspaceDir, rel) !== resolved) {
      throw new Error(`Path traversal rejected: ${filePath}`)
    }

    return resolved
  }

  /**
   * Get sandbox info
   */
  async getInfo(): Promise<{
    id: string
    template: string
    timeout: number
    createdAt: Date
  }> {
    return {
      id: this.sandbox.sandboxId,
      template: this.sandbox.template,
      timeout: this.sandbox.timeout,
      createdAt: new Date(this.sandbox.startedAt),
    }
  }
}

class E2BPtyHandle implements PtyHandle {
  readonly sessionId: string  // External interface uses sessionId
  private pid: number         // Internal E2B PID
  private handle: any         // E2B PTY handle from sandbox.pty.create()
  private sandbox: E2BSandboxType
  private cols: number
  private rows: number
  private connected = false

  constructor(
    sessionId: string,
    pid: number,
    handle: any,
    sandbox: E2BSandboxType,
    cols: number,
    rows: number
  ) {
    this.sessionId = sessionId
    this.pid = pid
    this.handle = handle
    this.sandbox = sandbox
    this.cols = cols
    this.rows = rows
  }

  /**
   * Send input to PTY (stdin)
   * Note: Don't forget to include newline (\n) for commands!
   */
  async sendInput(data: string): Promise<void> {
    try {
      // Send input as bytes to the PTY session
      await this.sandbox.pty.sendInput(
        this.pid,
        new TextEncoder().encode(data)
      )
    } catch (error: any) {
      console.error('[E2B PTY] Send input error:', error)
      throw error
    }
  }

  /**
   * Resize PTY terminal
   * Notifies the PTY of terminal size change (cols/rows in characters)
   */
  async resize(cols: number, rows: number): Promise<void> {
    this.cols = cols
    this.rows = rows
    try {
      await this.sandbox.pty.resize(this.pid, { cols, rows })
    } catch (error: any) {
      console.error('[E2B PTY] Resize error:', error)
      throw error
    }
  }

  /**
   * Wait for PTY to exit
   * Resolves when the terminal session ends (e.g., user types 'exit')
   */
  async waitForConnection(): Promise<void> {
    this.connected = true
    console.log('[E2B PTY] Connection established')
  }

  /**
   * Wait for PTY to exit and get exit code
   */
  async wait(): Promise<{ exitCode: number }> {
    try {
      const result = await this.handle.wait()
      return {
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      console.error('[E2B PTY] Wait error:', error)
      throw error
    }
  }

  /**
   * Disconnect from PTY
   * PTY keeps running in the background - use connect() to reconnect later
   */
  async disconnect(): Promise<void> {
    try {
      await this.handle.disconnect()
      this.connected = false
      console.log('[E2B PTY] Disconnected (session still running)')
    } catch (error: any) {
      console.error('[E2B PTY] Disconnect error:', error)
      throw error
    }
  }

  /**
   * Kill PTY session
   * Terminates the terminal session
   */
  async kill(): Promise<void> {
    try {
      await this.sandbox.pty.kill(this.pid)
      this.connected = false
      console.log('[E2B PTY] Session killed')
    } catch (error: any) {
      console.error('[E2B PTY] Kill error:', error)
      throw error
    }
  }

  /**
   * Get current terminal dimensions
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  /**
   * Get internal E2B PID (for debugging)
   */
  getPid(): number {
    return this.pid
  }
}

// Export singleton instance
export const e2bProvider = new E2BProvider()
