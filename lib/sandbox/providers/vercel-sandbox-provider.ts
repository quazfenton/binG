/**
 * Vercel Sandbox Provider
 * 
 * Provides isolated Linux microVMs via Vercel Sandbox SDK
 * @see https://vercel.com/docs/vercel-sandbox
 * 
 * Features:
 * - Isolated Linux microVMs for code execution
 * - Snapshot support for faster startups
 * - Network firewall policies
 * - Port exposure for live previews
 * - OIDC or token authentication
 * 
 * Authentication (choose one):
 * - VERCEL_TOKEN - Vercel Access Token (from vercel.com/account/tokens)
 * - VERCEL_SANDBOX_TOKEN - Dedicated sandbox token
 * - Project-based OIDC (when deployed to Vercel)
 * 
 * @example
 * ```typescript
 * const provider = new VercelSandboxProvider()
 * const sandbox = await provider.createSandbox({ language: 'typescript' })
 * const result = await sandbox.executeCommand('npm install express')
 * const previewUrl = await sandbox.getPreviewLink(3000)
 * ```
 */

import { resolve, join } from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'

const WORKSPACE_DIR = '/vercel/sandbox/workspace'
const MAX_COMMAND_TIMEOUT = 300000 // 5 minutes (Vercel default)

// Vercel Sandbox SDK types (from @vercel/sandbox)
interface VercelSandboxSDK {
  sandboxId: string
  status: 'pending' | 'running' | 'stopping' | 'stopped' | 'failed'
  createdAt: Date
  timeout: number
  activeCpuUsageMs: number
  networkUsage: { ingress: number; egress: number }
  
  runCommand(cmd: string, args?: string[], opts?: any): Promise<CommandFinished>
  mkDir(path: string, opts?: any): Promise<void>
  readFile(file: { path: string; cwd?: string }, opts?: any): Promise<ReadableStream | null>
  readFileToBuffer(file: { path: string; cwd?: string }, opts?: any): Promise<Buffer | null>
  writeFiles(files: { path: string; content: Buffer }[], opts?: any): Promise<void>
  downloadFile(src: { path: string; cwd?: string }, dst: { path: string; cwd?: string }, opts?: any): Promise<string | null>
  domain(port: number): string
  stop(opts?: { blocking?: boolean; signal?: any }): Promise<any>
  updateNetworkPolicy(policy: NetworkPolicy, opts?: any): Promise<void>
  extendTimeout(duration: number, opts?: any): Promise<void>
  snapshot(opts?: { expiration?: number; signal?: any }): Promise<Snapshot>
}

interface CommandFinished {
  cmdId: string
  exitCode: number
  cwd: string
  startedAt: number
  stdout(opts?: any): Promise<string>
  stderr(opts?: any): Promise<string>
  output(stream: 'stdout' | 'stderr' | 'both', opts?: any): Promise<string>
  logs(opts?: any): AsyncGenerator<{ stream: 'stdout' | 'stderr'; data: string }>
}

interface Snapshot {
  snapshotId: string
  sourceSandboxId: string
  status: 'created' | 'deleted' | 'failed'
  sizeBytes: number
  createdAt: Date
  expiresAt: Date | null
  delete(opts?: any): Promise<void>
}

type NetworkPolicy = 
  | 'allow-all'
  | 'deny-all'
  | {
      allow?: string[] | Record<string, any[]>
      subnets?: {
        allow?: string[]
        deny?: string[]
      }
    }

type Runtime = 'node24' | 'node22' | 'python3.13'

export class VercelSandboxProvider implements SandboxProvider {
  readonly name = 'vercel-sandbox'
  private token?: string
  private teamId?: string
  private sdkModule?: any

  constructor() {
    // Get authentication token (priority order)
    this.token = 
      process.env.VERCEL_SANDBOX_TOKEN?.trim().replace(/^['"]+|['"]+$/g, '') ||
      process.env.VERCEL_TOKEN?.trim().replace(/^['"]+|['"]+$/g, '')
    
    this.teamId = process.env.VERCEL_TEAM_ID?.trim()

    if (!this.token && !this.isRunningOnVercel()) {
      console.warn('[VercelSandbox] VERCEL_SANDBOX_TOKEN or VERCEL_TOKEN not set. Vercel Sandbox will not be available.')
    }
  }

  private isRunningOnVercel(): boolean {
    return !!process.env.VERCEL || !!process.env.NOW_BUILDER
  }

  /**
   * Health check - verifies SDK can be loaded and token is configured
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const startTime = Date.now()
    try {
      // Check if we can load the SDK
      await this.loadSDK()
      
      const latency = Date.now() - startTime
      
      // Check if token is configured (or running on Vercel with OIDC)
      const hasAuth = this.token || this.isRunningOnVercel()
      
      return { 
        healthy: hasAuth, 
        latency,
        details: { 
          hasToken: !!this.token,
          runningOnVercel: this.isRunningOnVercel(),
          teamId: this.teamId || 'personal'
        } 
      }
    } catch (error: any) {
      const latency = Date.now() - startTime
      console.error('[VercelSandbox] Health check failed:', error.message)
      return { 
        healthy: false, 
        latency, 
        details: { error: error.message } 
      }
    }
  }

  private async loadSDK(): Promise<any> {
    if (this.sdkModule) return this.sdkModule

    try {
      // Dynamic import to avoid requiring @vercel/sandbox in all deployments
      this.sdkModule = await import('@vercel/sandbox')
      return this.sdkModule
    } catch (error: any) {
      const message = '@vercel/sandbox not installed. Run: npm install @vercel/sandbox'
      console.error('[VercelSandbox]', message)
      throw new Error(message)
    }
  }

  private mapLanguageToRuntime(language: string): Runtime {
    const runtimeMap: Record<string, Runtime> = {
      'typescript': 'node22',
      'javascript': 'node22',
      'node': 'node22',
      'nodejs': 'node22',
      'python': 'python3.13',
      'python3': 'python3.13',
      'py': 'python3.13',
    }
    return runtimeMap[language] || 'node22'
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const { Sandbox } = await this.loadSDK()

    // Map language to Vercel runtime
    const runtime = this.mapLanguageToRuntime(config.language || 'typescript')

    // Build sandbox creation options
    const createOptions: any = {
      runtime: runtime,
      resources: {
        vcpus: config.resources?.cpu === 4 ? 4 : config.resources?.cpu === 8 ? 8 : 2,
      },
      env: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config.envVars,
      },
    }

    // Add timeout if specified (max 5 hours on Pro/Enterprise)
    if (config.autoStopInterval) {
      createOptions.timeout = config.autoStopInterval * 60 * 1000 // Convert minutes to ms
    }

    // Configure network policy for security
    if (process.env.VERCEL_SANDBOX_FIREWALL === 'true') {
      createOptions.networkPolicy = {
        allow: [
          'api.vercel.com',
          '*.vercel.com',
          'registry.npmjs.org',
          'pypi.org',
          '*.python.org',
        ],
      }
    }

    // Create sandbox
    const sandbox: VercelSandboxSDK = await Sandbox.create(createOptions)

    // Create workspace directory
    try {
      await sandbox.mkDir(WORKSPACE_DIR)
    } catch (error) {
      console.warn('[VercelSandbox] Failed to create workspace directory:', error)
    }

    return new VercelSandboxHandle(sandbox, this)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const { Sandbox } = await this.loadSDK()

    // Rehydrate existing sandbox
    const sandbox: VercelSandboxSDK = await Sandbox.get({ sandboxId })

    return new VercelSandboxHandle(sandbox, this)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    try {
      const sandbox = await this.getSandbox(sandboxId)
      await (sandbox as any).stop()
      console.log(`[VercelSandbox] Destroyed sandbox ${sandboxId}`)
    } catch (error: any) {
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        console.log(`[VercelSandbox] Sandbox ${sandboxId} already destroyed`)
        return
      }
      console.error(`[VercelSandbox] Failed to destroy sandbox ${sandboxId}:`, error.message)
      throw error
    }
  }

  // ====================
  // Extended Methods (Vercel-specific)
  // ====================

  async listSandboxes(): Promise<Array<{ id: string; status: string; createdAt: string }>> {
    const { Sandbox } = await this.loadSDK()
    const result = await Sandbox.list({ limit: 50 })
    return result.json.sandboxes.map((s: any) => ({
      id: s.sandboxId,
      status: s.status,
      createdAt: s.createdAt,
    }))
  }

  async createSnapshot(sandboxId: string, label?: string): Promise<string> {
    const sandbox = await this.getSandbox(sandboxId)
    // Use VercelSandboxHandle's createSnapshot method
    const snapshot = await sandbox.createSnapshot(label)
    if (!snapshot) {
      throw new Error('Snapshot creation not supported')
    }
    return snapshot.id
  }

  async restoreSnapshot(snapshotId: string): Promise<SandboxHandle> {
    const { Sandbox } = await this.loadSDK()
    const sandbox: VercelSandboxSDK = await Sandbox.create({
      source: {
        type: 'snapshot',
        snapshotId: snapshotId,
      } as any,
    })
    return new VercelSandboxHandle(sandbox, this)
  }

  async listSnapshots(): Promise<Array<{ id: string; size: number; createdAt: string }>> {
    const { Snapshot } = await this.loadSDK()
    const result = await Snapshot.list({ limit: 50 })
    return result.json.snapshots.map((s: any) => ({
      id: s.snapshotId,
      size: s.sizeBytes,
      createdAt: s.createdAt,
    }))
  }
}

// ====================
// Sandbox Handle
// ====================

class VercelSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR

  constructor(
    private readonly sandbox: VercelSandboxSDK,
    private readonly provider: VercelSandboxProvider
  ) {
    this.id = sandbox.sandboxId
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      // Security: Sanitize command
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd 
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      // Parse command into cmd and args
      const [cmd, ...args] = sanitized.split(/\s+/)

      const result = await this.sandbox.runCommand(cmd, args, {
        cwd: safeCwd,
        timeout: timeout || MAX_COMMAND_TIMEOUT,
      })

      const stdout = await result.stdout()
      const stderr = await result.stderr()

      return {
        success: result.exitCode === 0,
        output: stdout || stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to execute command',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // Security: Validate path and content
      const { resolvedPath, validatedContent } = SandboxSecurityManager.validateWriteFile(
        filePath,
        content,
        this.workspaceDir
      )

      await this.sandbox.writeFiles([{
        path: resolvedPath,
        content: Buffer.from(validatedContent),
      }])

      return {
        success: true,
        output: `File written: ${resolvedPath}`,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to write file',
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const buffer = await this.sandbox.readFileToBuffer({ path: resolved })

      if (!buffer) {
        return {
          success: false,
          output: 'File not found',
        }
      }

      return {
        success: true,
        output: buffer.toString('utf-8'),
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to read file',
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath || '.')
      
      // Use ls command since Vercel SDK doesn't have listFiles
      const result = await this.sandbox.runCommand('ls', ['-la', resolved])
      const output = await result.stdout()

      return {
        success: true,
        output,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to list directory',
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    try {
      const url = this.sandbox.domain(port)
      return {
        port,
        url,
      }
    } catch (error: any) {
      return {
        port,
        url: `http://localhost:${port}`,
      }
    }
  }

  async stop(): Promise<void> {
    try {
      await this.sandbox.stop({ blocking: true })
    } catch (error: any) {
      console.warn('[VercelSandbox] Failed to stop sandbox:', error.message)
    }
  }

  async extendTimeout(duration: number): Promise<void> {
    try {
      await this.sandbox.extendTimeout(duration)
    } catch (error: any) {
      console.warn('[VercelSandbox] Failed to extend timeout:', error.message)
    }
  }

  // Optional: Snapshot support
  async createSnapshot(label?: string): Promise<any> {
    const snapshot = await this.sandbox.snapshot()
    return { 
      id: snapshot.snapshotId, 
      createdAt: snapshot.createdAt.toISOString(),
      size: snapshot.sizeBytes,
    }
  }

  async rollbackToSnapshot(snapshotId: string): Promise<void> {
    // Create new sandbox from snapshot (can't rollback existing)
    throw new Error('Use provider.restoreSnapshot() to create a new sandbox from snapshot')
  }

  async listSnapshots(): Promise<any[]> {
    // Would need provider-level method
    return []
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    const { Snapshot } = await this.provider['loadSDK']()
    const snapshot = await Snapshot.get({ snapshotId })
    await snapshot.delete()
  }

  // PTY not supported by Vercel Sandbox
  async createPty?(options: PtyOptions): Promise<PtyHandle> {
    throw new Error('PTY not supported by Vercel Sandbox - use command-mode or WebSocket terminal')
  }

  async connectPty?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    throw new Error('PTY not supported by Vercel Sandbox')
  }

  async killPty?(sessionId: string): Promise<void> {
    throw new Error('PTY not supported by Vercel Sandbox')
  }

  async resizePty?(sessionId: string, cols: number, rows: number): Promise<void> {
    throw new Error('PTY not supported by Vercel Sandbox')
  }
}

// Export singleton instance
export const vercelSandboxProvider = new VercelSandboxProvider()
