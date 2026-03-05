import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'

const WORKSPACE_DIR = '/workspace'

// Full SpawnOptions from WebContainer docs
interface SpawnOptions {
  cwd?: string
  env?: Record<string, string | number | boolean>
  output?: boolean
  terminal?: { cols: number; rows: number }
}

interface WebContainerProcess {
  output: ReadableStream<Uint8Array>
  input: WritableStream<string>
  exit: Promise<number>
  kill(): void
  resize(dimensions: { cols: number; rows: number }): void
}

interface WebContainerInstance {
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
    writeFile(path: string, data: string | Uint8Array): Promise<void>
    readFile(path: string, encoding?: string): Promise<string | Uint8Array>
    readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any[]>
  }
  spawn(command: string, args?: string[], options?: SpawnOptions): Promise<WebContainerProcess>
  on(event: 'port' | 'error' | 'server-ready' | 'preview-message', listener: (...args: any[]) => void): () => void
  teardown(): void
  readonly path: string
  readonly workdir: string
}

interface BootOptions {
  coep?: 'require-corp' | 'credentialless' | 'none'
  workdirName?: string
  forwardPreviewErrors?: boolean | 'exceptions-only'
}

type WebContainerModule = {
  WebContainer: {
    boot(options?: BootOptions): Promise<WebContainerInstance>
  }
  auth?: {
    init(options: { clientId: string; scope: string }): any
  }
}

interface PtySession {
  process: WebContainerProcess
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

const spawnHandles = new Map<string, WebContainerSpawnHandle>()
const ptySessions = new Map<string, PtySession>()

export class WebContainerSpawnProvider implements SandboxProvider {
  readonly name = 'webcontainer-spawn'
  private modulePromise: Promise<WebContainerModule> | null = null

  private async loadModule(): Promise<WebContainerModule> {
    if (typeof window === 'undefined') {
      throw new Error('WebContainer provider requires a browser runtime')
    }

    if (!this.modulePromise) {
      this.modulePromise = new Function('return import("@webcontainer/api")')() as Promise<WebContainerModule>
    }

    return this.modulePromise
  }

  private async bootWebContainer(): Promise<WebContainerInstance> {
    const mod = await this.loadModule()
    const clientId = (process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____').trim()
    const scope = (process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '').trim()

    if (mod.auth?.init) {
      mod.auth.init({ clientId, scope })
    }

    const instance = await mod.WebContainer.boot()
    await instance.fs.mkdir(WORKSPACE_DIR, { recursive: true })
    return instance
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const instance = await this.bootWebContainer()
    const id = `wc-spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const handle = new WebContainerSpawnHandle(id, instance, config.envVars || {})
    spawnHandles.set(id, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = spawnHandles.get(sandboxId)
    if (!existing) {
      throw new Error(`WebContainer Spawn sandbox not found: ${sandboxId}`)
    }
    return existing
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = spawnHandles.get(sandboxId)
    if (handle) {
      handle.instance.teardown()
    }
    spawnHandles.delete(sandboxId)
  }
}

class WebContainerSpawnHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  private previews = new Map<number, string>()
  private backgroundProcesses = new Map<string, WebContainerProcess>()
  private defaultEnv: Record<string, string>

  constructor(
    readonly id: string,
    readonly instance: WebContainerInstance,
    envVars?: Record<string, string>,
  ) {
    this.defaultEnv = {
      TERM: 'xterm-256color',
      LANG: 'en_US.UTF-8',
      PATH: instance.path,
      ...envVars,
    }

    this.instance.on('server-ready', (port: number, url: string) => {
      if (typeof port === 'number' && typeof url === 'string') {
        this.previews.set(port, url)
      }
    })

    this.instance.on('error', (error: { message: string }) => {
      console.error('[WebContainer Spawn] Error:', error.message)
    })
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      const tokens = this.tokenizeCommand(sanitized)
      if (tokens.length === 0) {
        return { success: true, output: '', exitCode: 0 }
      }

      const [cmd, ...args] = tokens

      // Use full SpawnOptions with environment and terminal
      const process = await this.instance.spawn(cmd, args, {
        cwd: safeCwd,
        env: this.defaultEnv,
        output: true,
        terminal: { cols: 80, rows: 24 },
      })

      // Handle timeout if specified
      let exitCode: number
      if (timeout && timeout > 0) {
        const timeoutPromise = new Promise<number>((resolve) => {
          setTimeout(() => {
            process.kill()
            resolve(124) // Timeout exit code
          }, timeout * 1000)
        })

        exitCode = await Promise.race([process.exit, timeoutPromise])
      } else {
        exitCode = await process.exit
      }

      const output = await this.readStreamToString(process.output)

      return {
        success: exitCode === 0,
        output,
        exitCode,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to execute command in WebContainer',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const dir = path.dirname(resolved)
      await this.instance.fs.mkdir(dir, { recursive: true })
      await this.instance.fs.writeFile(resolved, content)

      return {
        success: true,
        output: `File written: ${resolved}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to write file in WebContainer',
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const data = await this.instance.fs.readFile(resolved, 'utf-8')
      const output = typeof data === 'string' ? data : new TextDecoder().decode(data)

      return {
        success: true,
        output,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to read file in WebContainer',
        exitCode: 1,
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath || '.')
      const entries = await this.instance.fs.readdir(resolved, { withFileTypes: true })

      const output = entries
        .map((entry: any) => {
          const isDir = typeof entry?.isDirectory === 'function' ? entry.isDirectory() : false
          const name = entry?.name || String(entry)
          return `${isDir ? 'd' : '-'} ${name}`
        })
        .join('\n')

      return {
        success: true,
        output,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to list directory in WebContainer',
        exitCode: 1,
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    return {
      port,
      url: this.previews.get(port) || `http://localhost:${port}`,
    }
  }

  // ============================================
  // Extended SpawnOptions Methods
  // ============================================

  /**
   * Spawn a process with full SpawnOptions
   */
  async spawnProcess(
    command: string,
    args: string[],
    options?: SpawnOptions
  ): Promise<{ process: WebContainerProcess; output: string }> {
    const process = await this.instance.spawn(command, args, {
      cwd: options?.cwd || this.workspaceDir,
      env: { ...this.defaultEnv, ...options?.env },
      output: options?.output ?? true,
      terminal: options?.terminal || { cols: 80, rows: 24 },
    })

    const output = await this.readStreamToString(process.output)
    return { process, output }
  }

  /**
   * Spawn a background process
   */
  async spawnBackground(
    command: string,
    args: string[],
    sessionId: string
  ): Promise<ToolResult> {
    try {
      const process = await this.instance.spawn(command, args, {
        cwd: this.workspaceDir,
        env: this.defaultEnv,
        output: false, // Don't capture output for background processes
      })

      this.backgroundProcesses.set(sessionId, process)
      return {
        success: true,
        output: `Background process started with session: ${sessionId}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to start background process',
        exitCode: 1,
      }
    }
  }

  /**
   * Kill a background process
   */
  async killBackground(sessionId: string): Promise<ToolResult> {
    const process = this.backgroundProcesses.get(sessionId)
    if (!process) {
      return {
        success: false,
        output: `No background process found for session: ${sessionId}`,
        exitCode: 1,
      }
    }

    process.kill()
    this.backgroundProcesses.delete(sessionId)
    return {
      success: true,
      output: `Background process terminated: ${sessionId}`,
      exitCode: 0,
    }
  }

  /**
   * Get background process status
   */
  async getBackgroundStatus(sessionId: string): Promise<ToolResult> {
    const process = this.backgroundProcesses.get(sessionId)
    if (!process) {
      return {
        success: false,
        output: `No background process found for session: ${sessionId}`,
        exitCode: 1,
      }
    }

    // Check if process has exited
    const exitPromise = process.exit
    const hasExited = await Promise.race([
      exitPromise.then(() => true),
      new Promise<false>(() => setTimeout(() => false, 0)),
    ])

    return {
      success: !hasExited,
      output: hasExited ? 'Process has exited' : 'Process is running',
      exitCode: hasExited ? 1 : 0,
    }
  }

  /**
   * Resize terminal for a process
   */
  async resizeProcess(sessionId: string, cols: number, rows: number): Promise<ToolResult> {
    const process = this.backgroundProcesses.get(sessionId)
    if (!process) {
      // Also check pty sessions
      const ptySession = ptySessions.get(sessionId)
      if (ptySession) {
        ptySession.cols = cols
        ptySession.rows = rows
        ptySession.process.resize({ cols, rows })
        return { success: true, output: `Resized terminal to ${cols}x${rows}`, exitCode: 0 }
      }
      return { success: false, output: `No process found for session: ${sessionId}`, exitCode: 1 }
    }

    process.resize({ cols, rows })
    return { success: true, output: `Resized terminal to ${cols}x${rows}`, exitCode: 0 }
  }

  /**
   * Create a PTY session
   */
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const process = await this.instance.spawn('jsh', ['-c', options.cwd || this.workspaceDir], {
      cwd: options.cwd || this.workspaceDir,
      env: { ...this.defaultEnv, ...options.envs },
      output: true,
      terminal: { cols: options.cols || 80, rows: options.rows || 24 },
    })

    const session: PtySession = {
      process,
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || this.workspaceDir,
      env: { ...this.defaultEnv, ...options.envs },
    }

    ptySessions.set(options.id, session)

    return {
      sessionId: options.id,
      async sendInput(data: string) {
        const writer = process.input.getWriter()
        await writer.write(data)
      },
      async resize(cols: number, rows: number) {
        process.resize({ cols, rows })
        session.cols = cols
        session.rows = rows
      },
      async waitForConnection() {
        // Already connected when process is spawned
      },
      async disconnect() {
        process.kill()
        ptySessions.delete(options.id)
      },
      async kill() {
        process.kill()
        ptySessions.delete(options.id)
      },
    }
  }

  /**
   * Connect to an existing PTY session
   */
  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const session = ptySessions.get(sessionId)
    if (!session) {
      throw new Error(`PTY session not found: ${sessionId}`)
    }

    return {
      sessionId,
      async sendInput(data: string) {
        const writer = session.process.input.getWriter()
        await writer.write(data)
      },
      async resize(cols: number, rows: number) {
        session.process.resize({ cols, rows })
        session.cols = cols
        session.rows = rows
      },
      async waitForConnection() {},
      async disconnect() {
        ptySessions.delete(sessionId)
      },
      async kill() {
        session.process.kill()
        ptySessions.delete(sessionId)
      },
    }
  }

  /**
   * Kill a PTY session
   */
  async killPty(sessionId: string): Promise<void> {
    const session = ptySessions.get(sessionId)
    if (session) {
      session.process.kill()
      ptySessions.delete(sessionId)
    }
  }

  /**
   * Resize PTY
   */
  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = ptySessions.get(sessionId)
    if (session) {
      session.process.resize({ cols, rows })
      session.cols = cols
      session.rows = rows
    }
  }

  private tokenizeCommand(command: string): string[] {
    const matches = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) || []
    return matches.map(token => token.replace(/^['"]|['"]$/g, ''))
  }

  private async readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let output = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) output += decoder.decode(value, { stream: true })
    }

    output += decoder.decode()
    return output
  }
}
