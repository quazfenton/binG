/**
 * CodeSandbox SDK Provider
 *
 * Provides cloud sandbox environments via the CodeSandbox SDK.
 * Features:
 * - Isolated Firecracker VM-based sandboxes
 * - Full filesystem operations (read, write, readdir, mkdir)
 * - Command execution with output
 * - Interactive PTY terminals via shell API
 * - Preview URLs for exposed ports (https://$ID-$PORT.csb.app)
 * - Hibernation & resume with state preservation
 *
 * @see https://codesandbox.io/docs/sdk
 * @see https://github.com/codesandbox/codesandbox-sdk
 *
 * Requires: npm install @codesandbox/sdk
 * Env: CSB_API_KEY
 */

import { resolve, relative, dirname } from 'node:path'
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

// Dynamic import types
type CodeSandboxSDK = any
type CSBSandbox = any
type CSBClient = any

const WORKSPACE_DIR = '/project/workspace'
const MAX_COMMAND_TIMEOUT = 600_000 // 10 minutes

export class CodeSandboxProvider implements SandboxProvider {
  readonly name = 'codesandbox'
  private apiKey?: string
  private defaultTemplate?: string
  private privacy?: 'public' | 'private' | 'public-hosts'
  private hibernationTimeout?: number
  private autoWakeup?: boolean
  private vmTier?: string
  private commandTimeout: number
  private sdkModule?: any
  private moduleLoadError?: string

  constructor() {
    this.apiKey = process.env.CSB_API_KEY
    this.defaultTemplate = process.env.CSB_DEFAULT_TEMPLATE || undefined
    this.privacy = (process.env.CSB_PRIVACY as any) || 'public-hosts'
    this.hibernationTimeout = parseInt(process.env.CSB_HIBERNATION_TIMEOUT || '86400', 10)
    this.autoWakeup = process.env.CSB_AUTO_WAKEUP !== 'false'
    this.vmTier = process.env.CSB_VM_TIER || undefined
    this.commandTimeout = parseInt(process.env.CSB_COMMAND_TIMEOUT || '600000', 10)

    if (!this.apiKey) {
      console.warn('[CodeSandbox] CSB_API_KEY not set. CodeSandbox sandboxes will not be available.')
    }
  }

  private async ensureModule(): Promise<any> {
    if (this.sdkModule) return this.sdkModule
    if (this.moduleLoadError) throw new Error(this.moduleLoadError)

    try {
      this.sdkModule = await import('@codesandbox/sdk')
      return this.sdkModule
    } catch (error: any) {
      this.moduleLoadError = '@codesandbox/sdk not installed. Run: npm install @codesandbox/sdk'
      console.error('[CodeSandbox]', this.moduleLoadError)
      throw new Error(this.moduleLoadError)
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    if (!this.apiKey) {
      throw new Error('CSB_API_KEY is not configured')
    }

    if (!quotaManager.isAvailable('codesandbox')) {
      throw new Error('CodeSandbox quota exceeded')
    }

    const mod = await this.ensureModule()
    const { CodeSandbox, VMTier } = mod

    try {
      const sdk: CodeSandboxSDK = new CodeSandbox(this.apiKey)

      const createOpts: Record<string, any> = {}
      if (this.defaultTemplate) {
        createOpts.id = this.defaultTemplate
      }
      if (config.labels?.userId) {
        createOpts.tags = ['sdk', `user:${config.labels.userId}`]
      }
      if (this.privacy) {
        createOpts.privacy = this.privacy
      }
      if (this.hibernationTimeout) {
        createOpts.hibernationTimeoutSeconds = this.hibernationTimeout
      }
      if (this.autoWakeup !== undefined) {
        createOpts.automaticWakeupConfig = {
          http: this.autoWakeup,
          websocket: this.autoWakeup,
        }
      }
      if (this.vmTier) {
        createOpts.vmTier = VMTier[this.vmTier as keyof typeof VMTier] || VMTier.Micro
      }

      const sandbox: CSBSandbox = await sdk.sandboxes.create(createOpts)
      const client: CSBClient = await sandbox.connect()

      // Set up environment variables inside the sandbox
      if (config.envVars && Object.keys(config.envVars).length > 0) {
        const envExports = Object.entries(config.envVars)
          .map(([k, v]) => `export ${k}='${String(v).replace(/'/g, "'\\''")}'`)
          .join(' && ')
        try {
          await client.commands.run(envExports, { cwd: WORKSPACE_DIR })
        } catch {
          // Best-effort env setup
        }
      }

      quotaManager.recordUsage('codesandbox', 1)
      console.log(`[CodeSandbox] Created sandbox ${sandbox.id}`)

      return new CodeSandboxHandle(sandbox.id, client, sdk, {
        commandTimeout: this.commandTimeout,
      })
    } catch (error: any) {
      console.error('[CodeSandbox] Failed to create sandbox:', error)
      throw error
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    if (!this.apiKey) {
      throw new Error('CSB_API_KEY is not configured')
    }

    const mod = await this.ensureModule()
    const { CodeSandbox } = mod

    try {
      const sdk: CodeSandboxSDK = new CodeSandbox(this.apiKey)
      const sandbox: CSBSandbox = await sdk.sandboxes.resume(sandboxId)
      const client: CSBClient = await sandbox.connect()

      console.log(`[CodeSandbox] Connected to sandbox ${sandboxId}`)
      return new CodeSandboxHandle(sandboxId, client, sdk)
    } catch (error: any) {
      console.error(`[CodeSandbox] Failed to get sandbox ${sandboxId}:`, error)
      throw error
    }
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    if (!this.apiKey) {
      console.warn('[CodeSandbox] Cannot destroy sandbox: CSB_API_KEY not configured')
      return
    }

    const mod = await this.ensureModule()
    const { CodeSandbox } = mod

    try {
      const sdk: CodeSandboxSDK = new CodeSandbox(this.apiKey)
      await sdk.sandboxes.shutdown(sandboxId)
      console.log(`[CodeSandbox] Shutdown sandbox ${sandboxId}`)
    } catch (error: any) {
      if (error.message?.includes('not found') || error.message?.includes('not running')) {
        console.log(`[CodeSandbox] Sandbox ${sandboxId} already stopped`)
        return
      }
      console.error(`[CodeSandbox] Failed to destroy sandbox ${sandboxId}:`, error)
      throw error
    }
  }
}

interface CodeSandboxHandleOptions {
  commandTimeout?: number
}

class CodeSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private client: CSBClient
  private sdk: CodeSandboxSDK
  private terminalSessions = new Map<string, { terminal: any; outputBuffer: string[] }>()
  private commandTimeout: number

  constructor(id: string, client: CSBClient, sdk: CodeSandboxSDK, options?: CodeSandboxHandleOptions) {
    this.id = id
    this.client = client
    this.sdk = sdk
    this.commandTimeout = options?.commandTimeout || MAX_COMMAND_TIMEOUT
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const output = await this.client.commands.run(command, {
        cwd: cwd || this.workspaceDir,
      })

      return {
        success: true,
        output: output || '',
        exitCode: 0,
      }
    } catch (error: any) {
      // CodeSandbox SDK throws CommandError with exitCode and output
      if (error.exitCode !== undefined) {
        return {
          success: false,
          output: error.output || error.message || 'Command failed',
          exitCode: error.exitCode,
        }
      }
      return {
        success: false,
        output: error.message || 'Command execution failed',
        exitCode: -1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)

      // Ensure parent directory exists
      const dir = dirname(resolved)
      if (dir !== '/' && dir !== '.') {
        try {
          await this.client.fs.mkdir(dir, true)
        } catch {
          // Directory may already exist
        }
      }

      await this.client.fs.writeTextFile(resolved, content)

      return {
        success: true,
        output: `File written: ${resolved}`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Write file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to write file',
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)
      const content = await this.client.fs.readTextFile(resolved)

      return {
        success: true,
        output: content,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Read file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to read file',
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(dirPath)
      const entries = await this.client.fs.readdir(resolved)

      const formatted = entries
        .map((e: any) => `${e.type === 'directory' ? 'd' : '-'}  ${e.name}`)
        .join('\n')

      return {
        success: true,
        output: formatted || '(empty directory)',
      }
    } catch (error: any) {
      console.error('[CodeSandbox] List directory error:', error)
      return {
        success: false,
        output: error.message || 'Failed to list directory',
      }
    }
  }

  async writeFileBinary(filePath: string, content: Uint8Array): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)

      const dir = dirname(resolved)
      if (dir !== '/' && dir !== '.') {
        try {
          await this.client.fs.mkdir(dir, true)
        } catch {
          // Directory may already exist
        }
      }

      await this.client.fs.writeFile(resolved, content)

      return {
        success: true,
        output: `Binary file written: ${resolved}`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Write binary file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to write binary file',
      }
    }
  }

  async readFileBinary(filePath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)
      const content = await this.client.fs.readFile(resolved)

      return {
        success: true,
        output: '',
        binary: content,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Read binary file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to read binary file',
      }
    }
  }

  async batchWrite(files: Array<{ path: string; content: string | Uint8Array }>): Promise<ToolResult> {
    try {
      const formattedFiles = files.map(f => ({
        path: this.resolvePath(f.path),
        content: f.content,
      }))

      await this.client.fs.batchWrite(formattedFiles)

      return {
        success: true,
        output: `Batch wrote ${files.length} files`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Batch write error:', error)
      return {
        success: false,
        output: error.message || 'Failed to batch write files',
      }
    }
  }

  async copyFile(sourcePath: string, destPath: string): Promise<ToolResult> {
    try {
      const resolvedSrc = this.resolvePath(sourcePath)
      const resolvedDest = this.resolvePath(destPath)

      await this.client.fs.copy(resolvedSrc, resolvedDest)

      return {
        success: true,
        output: `Copied ${resolvedSrc} to ${resolvedDest}`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Copy file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to copy file',
      }
    }
  }

  async renameFile(oldPath: string, newPath: string): Promise<ToolResult> {
    try {
      const resolvedOld = this.resolvePath(oldPath)
      const resolvedNew = this.resolvePath(newPath)

      await this.client.fs.rename(resolvedOld, resolvedNew)

      return {
        success: true,
        output: `Renamed ${resolvedOld} to ${resolvedNew}`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Rename file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to rename file',
      }
    }
  }

  async removeFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)

      await this.client.fs.remove(resolved)

      return {
        success: true,
        output: `Removed ${resolved}`,
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Remove file error:', error)
      return {
        success: false,
        output: error.message || 'Failed to remove file',
      }
    }
  }

  async downloadAsZip(path: string): Promise<{ downloadUrl: string }> {
    try {
      const resolved = this.resolvePath(path)
      const { downloadUrl } = await this.client.fs.download(resolved)
      return { downloadUrl }
    } catch (error: any) {
      console.error('[CodeSandbox] Download error:', error)
      throw new Error(`Failed to generate download URL: ${error.message}`)
    }
  }

  // File watching support
  private _watchIntervals = new Map<string, NodeJS.Timeout>()

  async watchFile(filePath: string, callback: (event: string, path: string) => void): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(filePath)
      let previousContent: string | null = null
      let previousExists = false

      // Initial read
      try {
        previousContent = await this.client.fs.readFile(resolved, 'utf8')
        previousExists = true
      } catch {
        // File may not exist yet
      }

      // Poll for changes every 2 seconds
      const interval = setInterval(async () => {
        try {
          const currentContent = await this.client.fs.readFile(resolved, 'utf8')
          
          if (!previousExists) {
            callback('add', filePath)
            previousExists = true
            previousContent = currentContent
          } else if (currentContent !== previousContent) {
            callback('change', filePath)
            previousContent = currentContent
          }
        } catch {
          if (previousExists) {
            callback('unlink', filePath)
            previousExists = false
            previousContent = null
          }
        }
      }, 2000)

      this._watchIntervals.set(filePath, interval)

      return { success: true, output: `Watching file: ${filePath}` }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to watch file: ${error.message}`,
      }
    }
  }

  async watchDirectory(dirPath: string, callback: (event: string, path: string) => void): Promise<ToolResult> {
    try {
      const resolved = this.resolvePath(dirPath)
      let previousFiles = new Map<string, string>()

      // Initial listing
      try {
        const entries = await this.client.fs.readdir(resolved)
        entries.forEach((e: any) => previousFiles.set(e.name, e.path))
      } catch {
        // Directory may not exist yet
      }

      // Poll for changes every 3 seconds
      const interval = setInterval(async () => {
        try {
          const entries = await this.client.fs.readdir(resolved)
          const currentFiles = new Map(entries.map((e: any) => [e.name, e.path]))

          // Check for additions
          currentFiles.forEach((path, name) => {
            if (!previousFiles.has(name)) {
              callback('add', `${dirPath}/${name}`)
            }
          })

          // Check for removals
          previousFiles.forEach((path, name) => {
            if (!currentFiles.has(name)) {
              callback('unlink', `${dirPath}/${name}`)
            }
          })

          previousFiles = currentFiles
        } catch {
          callback('unlinkDir', dirPath)
          clearInterval(interval)
        }
      }, 3000)

      this._watchIntervals.set(dirPath, interval)

      return { success: true, output: `Watching directory: ${dirPath}` }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to watch directory: ${error.message}`,
      }
    }
  }

  async unwatchFile(filePath: string): Promise<ToolResult> {
    try {
      const interval = this._watchIntervals.get(filePath)
      if (interval) {
        clearInterval(interval)
        this._watchIntervals.delete(filePath)
      }
      return { success: true, output: `Stopped watching file: ${filePath}` }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to unwatch file: ${error.message}`,
      }
    }
  }

  async unwatchDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const interval = this._watchIntervals.get(dirPath)
      if (interval) {
        clearInterval(interval)
        this._watchIntervals.delete(dirPath)
      }
      return { success: true, output: `Stopped watching directory: ${dirPath}` }
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to unwatch directory: ${error.message}`,
      }
    }
  }

  async executeCommandBackground(
    command: string,
    onOutput?: (data: string) => void,
    cwd?: string
  ): Promise<{ process: any; kill: () => Promise<void> }> {
    try {
      const proc = await this.client.commands.runBackground(command, {
        cwd: cwd || this.workspaceDir,
      })

      if (onOutput) {
        proc.stdout?.on('data', (chunk: string) => onOutput(chunk))
        proc.stderr?.on('data', (chunk: string) => onOutput(chunk))
      }

      return {
        process: proc,
        kill: async () => {
          try {
            await proc.kill()
          } catch {
            // Process may already be killed
          }
        },
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Background command error:', error)
      throw error
    }
  }

  async waitForPort(port: number, timeoutMs = 60000): Promise<PreviewInfo> {
    try {
      const portInfo = await this.client.ports.waitForPort(port, { timeout: timeoutMs })
      const url = this.client.hosts.getUrl(port)
      return { port, url }
    } catch (error: any) {
      console.error('[CodeSandbox] Wait for port error:', error)
      throw new Error(`Port ${port} did not open within ${timeoutMs}ms: ${error.message}`)
    }
  }

  onPortOpen(callback: (portInfo: { port: number; host: string }) => void): () => void {
    const listener = this.client.ports.onDidPortOpen((portInfo: { port: number }) => {
      callback({
        port: portInfo.port,
        host: this.client.hosts.getUrl(portInfo.port),
      })
    })
    return () => listener.dispose()
  }

  onPortClose(callback: (port: number) => void): () => void {
    const listener = this.client.ports.onDidPortClose(callback)
    return () => listener.dispose()
  }

  async getAllOpenPorts(): Promise<Array<{ port: number; host: string }>> {
    const ports = this.client.ports.getAll()
    return ports.map((p: any) => ({
      port: p.port,
      host: this.client.hosts.getUrl(p.port),
    }))
  }

  async getTask(taskName: string): Promise<any> {
    try {
      return await this.client.tasks.get(taskName)
    } catch (error: any) {
      console.error('[CodeSandbox] Get task error:', error)
      return null
    }
  }

  async listTasks(): Promise<Array<{ name: string; command: string; status: string }>> {
    try {
      const tasks = this.client.tasks.getAll()
      return tasks.map((t: any) => ({
        name: t.name,
        command: t.command,
        status: t.status,
      }))
    } catch (error: any) {
      console.error('[CodeSandbox] List tasks error:', error)
      return []
    }
  }

  async runTask(taskName: string): Promise<{ success: boolean; port?: number; url?: string }> {
    try {
      const task = await this.client.tasks.get(taskName)
      if (!task) {
        return { success: false }
      }

      await task.run()

      const portInfo = await task.waitForPort()
      const url = this.client.hosts.getUrl(portInfo.port)

      return { success: true, port: portInfo.port, url }
    } catch (error: any) {
      console.error('[CodeSandbox] Run task error:', error)
      return { success: false }
    }
  }

  async getSetupStatus(): Promise<{ status: string; steps: Array<{ name: string; command: string; status: string }> }> {
    try {
      const status = this.client.setup.status
      const steps = await this.client.setup.getSteps()
      return {
        status,
        steps: steps.map((s: any) => ({
          name: s.name,
          command: s.command,
          status: s.status,
        })),
      }
    } catch (error: any) {
      console.error('[CodeSandbox] Get setup status error:', error)
      return { status: 'unknown', steps: [] }
    }
  }

  async waitForSetupComplete(timeoutMs = 300000): Promise<boolean> {
    try {
      await this.client.setup.waitUntilComplete({ timeout: timeoutMs })
      return true
    } catch (error: any) {
      console.error('[CodeSandbox] Setup wait error:', error)
      return false
    }
  }

  async getProviderInfo(): Promise<{
    provider: string
    status: 'running' | 'stopped' | 'hibernating' | 'failed' | 'deployed'
    url?: string
    createdAt: string
    region?: string
  }> {
    try {
      return {
        provider: 'codesandbox',
        status: 'running',
        url: `https://${this.id}.csb.app`,
        createdAt: new Date().toISOString(),
      }
    } catch (error: any) {
      return {
        provider: 'codesandbox',
        status: 'failed',
        createdAt: new Date().toISOString(),
      }
    }
  }

  async hibernate(): Promise<void> {
    try {
      await this.sdk.sandboxes.hibernate(this.id)
      console.log(`[CodeSandbox] Hibernated sandbox ${this.id}`)
    } catch (error: any) {
      console.error('[CodeSandbox] Hibernate error:', error)
      throw error
    }
  }

  async resume(): Promise<void> {
    try {
      const sandbox = await this.sdk.sandboxes.resume(this.id)
      this.client = await sandbox.connect()
      console.log(`[CodeSandbox] Resumed sandbox ${this.id}`)
    } catch (error: any) {
      console.error('[CodeSandbox] Resume error:', error)
      throw error
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    const url = this.client.hosts.getUrl(port)
    return { port, url }
  }

  async createPty(options: PtyOptions): Promise<PtyHandle> {
    try {
      const sessionId = options.id
      const cols = options.cols || 120
      const rows = options.rows || 30

      // Create a terminal using the CodeSandbox terminals API
      const terminal = await this.client.terminals.create('bash', {
        cwd: options.cwd || this.workspaceDir,
        env: {
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          ...options.envs,
        },
        dimensions: { cols, rows },
      })

      // Open the terminal to subscribe to output
      await terminal.open({ cols, rows })

      // Buffer for output and subscribe to terminal output events
      const outputBuffer: string[] = []
      terminal.onOutput((data: string) => {
        outputBuffer.push(data)
        // Forward output as Uint8Array to match the PtyOptions.onData signature
        options.onData(new TextEncoder().encode(data))
      })

      this.terminalSessions.set(sessionId, { terminal, outputBuffer })

      console.log(`[CodeSandbox] Created PTY session ${sessionId} (shell: ${terminal.id})`)

      return new CodeSandboxPtyHandle(sessionId, terminal, cols, rows)
    } catch (error: any) {
      console.error('[CodeSandbox] Create PTY error:', error)
      throw error
    }
  }

  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const session = this.terminalSessions.get(sessionId)
    if (!session) {
      throw new Error(`PTY session ${sessionId} not found`)
    }

    const { terminal } = session

    // Re-open to get current output and subscribe
    const currentOutput = await terminal.open()

    // Subscribe to new output
    terminal.onOutput((data: string) => {
      options.onData(new TextEncoder().encode(data))
    })

    // Send current buffered output
    if (currentOutput) {
      options.onData(new TextEncoder().encode(currentOutput))
    }

    console.log(`[CodeSandbox] Reconnected to PTY session ${sessionId}`)
    return new CodeSandboxPtyHandle(sessionId, terminal, 120, 30)
  }

  async killPty(sessionId: string): Promise<void> {
    const session = this.terminalSessions.get(sessionId)
    if (!session) return

    try {
      await session.terminal.kill()
    } catch {
      // Terminal may already be killed
    }
    this.terminalSessions.delete(sessionId)
    console.log(`[CodeSandbox] Killed PTY session ${sessionId}`)
  }

  private resolvePath(filePath: string): string {
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, '/')
    
    // SECURITY: Block path traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Path traversal rejected: ${filePath}`)
    }
    
    // Resolve absolute paths
    if (filePath.startsWith('/')) {
      const resolved = resolve(filePath)
      
      // SECURITY: Ensure path stays within workspace
      const rel = relative(this.workspaceDir, resolved)
      if (rel.startsWith('..') || resolved === '..' || resolve(this.workspaceDir, rel) !== resolved) {
        throw new Error(`Path traversal rejected: ${filePath}`)
      }
      
      return resolved
    }
    
    // Resolve relative paths
    const resolved = resolve(this.workspaceDir, filePath)
    
    // SECURITY: Double-check path is within workspace
    const rel = relative(this.workspaceDir, resolved)
    if (rel.startsWith('..') || resolved === '..' || resolve(this.workspaceDir, rel) !== resolved) {
      throw new Error(`Path traversal rejected: ${filePath}`)
    }
    
    return resolved
  }

  async watchDirectory(
    dirPath: string,
    callback: (event: { type: string; path: string; name?: string }) => void
  ): Promise<{ close: () => Promise<void> }> {
    const resolved = this.resolvePath(dirPath)
    const intervalMs = 2000
    
    let lastFiles: Map<string, string> = new Map()
    
    const listFiles = async () => {
      try {
        const result = await this.listDirectory(resolved)
        if (!result.success) return
        
        const currentFiles = new Map<string, string>()
        const lines = result.output.split('\n').filter(l => l.trim())
        
        for (const line of lines) {
          const parts = line.split(/\s+/)
          if (parts.length >= 9) {
            const name = parts.slice(8).join(' ')
            const isDir = line.startsWith('d')
            currentFiles.set(name, isDir ? 'dir' : 'file')
          }
        }
        
        for (const [name, type] of currentFiles) {
          if (!lastFiles.has(name)) {
            callback({ type: 'create', path: `${resolved}/${name}`, name })
          }
        }
        
        for (const [name] of lastFiles) {
          if (!currentFiles.has(name)) {
            callback({ type: 'delete', path: `${resolved}/${name}`, name })
          }
        }
        
        lastFiles = currentFiles
      } catch {
        // Best-effort polling
      }
    }
    
    await listFiles()
    const intervalId = setInterval(listFiles, intervalMs)
    
    return {
      close: async () => {
        clearInterval(intervalId)
      }
    }
  }

  async watchFile(
    filePath: string,
    callback: (event: { type: string; path: string }) => void
  ): Promise<{ close: () => Promise<void> }> {
    const resolved = this.resolvePath(filePath)
    const intervalMs = 2000
    
    let lastMtime: number | null = null
    
    const checkFile = async () => {
      try {
        const result = await this.executeCommand(`stat -c %Y "${resolved}"`)
        if (!result.success) return
        
        const currentMtime = parseInt(result.output.trim(), 10)
        if (lastMtime !== null && currentMtime !== lastMtime) {
          callback({ type: 'change', path: resolved })
        }
        lastMtime = currentMtime
      } catch {
        // File may not exist
      }
    }
    
    await checkFile()
    const intervalId = setInterval(checkFile, intervalMs)
    
    return {
      close: async () => {
        clearInterval(intervalId)
      }
    }
  }
}

class CodeSandboxPtyHandle implements PtyHandle {
  readonly sessionId: string
  private terminal: any
  private cols: number
  private rows: number
  private connected = false

  constructor(sessionId: string, terminal: any, cols: number, rows: number) {
    this.sessionId = sessionId
    this.terminal = terminal
    this.cols = cols
    this.rows = rows
  }

  async sendInput(data: string): Promise<void> {
    await this.terminal.write(data, { cols: this.cols, rows: this.rows })
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.cols = cols
    this.rows = rows
    // CodeSandbox SDK passes dimensions with each write; store for next write
  }

  async waitForConnection(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async kill(): Promise<void> {
    await this.terminal.kill()
    this.connected = false
  }
}

export const codesandboxProvider = new CodeSandboxProvider()
