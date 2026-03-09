import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'

const WORKSPACE_DIR = '/workspace'
const DEFAULT_TIMEOUT_SECONDS = 600 // 10 minutes for agent workloads
const HEALTH_CHECK_INTERVAL_MS = 200
const HEALTH_CHECK_MAX_ATTEMPTS = 150 // ~30 seconds

interface AgentSandboxRecord {
  id: string
  serverId: string
  lifecycleBaseUrl: string
  execdBaseUrl: string
  execdAccessToken?: string
}

const agentSandboxHandles = new Map<string, OpenSandboxAgentSandboxHandle>()

export class OpenSandboxAgentSandboxProvider implements SandboxProvider {
  readonly name = 'opensandbox-agent'
  private readonly lifecycleBaseUrl: string
  private readonly execdBaseUrl: string
  private readonly apiKey: string
  private readonly execdAccessToken?: string

  constructor() {
    this.lifecycleBaseUrl = (process.env.OPEN_SANDBOX_BASE_URL || 'http://localhost:8080/v1').replace(/\/$/, '')
    this.execdBaseUrl = (process.env.OPEN_SANDBOX_EXECD_BASE_URL || this.lifecycleBaseUrl.replace(/\/v1$/, '')).replace(/\/$/, '')
    this.apiKey = process.env.OPEN_SANDBOX_API_KEY || ''
    this.execdAccessToken = process.env.OPEN_SANDBOX_EXECD_ACCESS_TOKEN || undefined
  }

  private async requestLifecycle(pathname: string, init: RequestInit = {}): Promise<any> {
    if (!this.apiKey) {
      throw new Error('OPEN_SANDBOX_API_KEY is not configured')
    }

    const response = await fetch(`${this.lifecycleBaseUrl}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'OPEN-SANDBOX-API-KEY': this.apiKey,
        ...(init.headers || {}),
      },
    })

    const text = await response.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    if (!response.ok) {
      throw new Error(
        typeof payload === 'string'
          ? payload
          : payload?.message || `OpenSandbox lifecycle request failed (${response.status})`,
      )
    }

    return payload
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const timeout = Number(config.autoStopInterval || DEFAULT_TIMEOUT_SECONDS)
    const image = process.env.OPEN_SANDBOX_AGENT_IMAGE || 'ubuntu:22.04'
    const entrypoint = process.env.OPEN_SANDBOX_AGENT_ENTRYPOINT

    const body: Record<string, any> = {
      image,
      timeout,
      envs: config.envVars || {},
      metadata: { ...config.labels, mode: 'agent-sandbox' },
    }

    if (entrypoint) {
      body.entrypoint = entrypoint.split(',')
    }

    const poolRef = process.env.OPEN_SANDBOX_AGENT_POOL_REF
    if (poolRef) {
      body.extensions = { poolRef }
    }

    const payload = await this.requestLifecycle('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const serverId = payload?.sandboxId || payload?.id || payload?.sandbox?.id
    if (!serverId) {
      throw new Error('OpenSandbox did not return sandbox id')
    }

    const sandboxId = `osb-agent-${serverId}`
    const record: AgentSandboxRecord = {
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    }

    // Wait until the sandbox is ready before returning the handle
    if (process.env.OPEN_SANDBOX_AGENT_HEALTH_CHECK !== 'false') {
      await this.waitForReady(record)
    }

    const handle = new OpenSandboxAgentSandboxHandle(record)
    agentSandboxHandles.set(sandboxId, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = agentSandboxHandles.get(sandboxId)
    if (existing) return existing

    const serverId = sandboxId.replace(/^osb-agent-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'GET' })

    const handle = new OpenSandboxAgentSandboxHandle({
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    })

    agentSandboxHandles.set(sandboxId, handle)
    return handle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const serverId = sandboxId.replace(/^osb-agent-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'DELETE' })
    agentSandboxHandles.delete(sandboxId)
  }

  private async waitForReady(record: AgentSandboxRecord): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (record.execdAccessToken) {
      headers['X-EXECD-ACCESS-TOKEN'] = record.execdAccessToken
    }

    for (let i = 0; i < HEALTH_CHECK_MAX_ATTEMPTS; i++) {
      try {
        const response = await fetch(`${record.execdBaseUrl}/ping`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return
      } catch {
        // Not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS))
    }

    console.warn(
      `[opensandbox-agent] Health check timed out for sandbox ${record.serverId}; proceeding anyway`,
    )
  }
}

class OpenSandboxAgentSandboxHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  readonly id: string
  private readonly record: AgentSandboxRecord

  constructor(record: AgentSandboxRecord) {
    this.record = record
    this.id = record.id
  }

  private async requestExec(pathname: string, init: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    }

    if (this.record.execdAccessToken) {
      headers['X-EXECD-ACCESS-TOKEN'] = this.record.execdAccessToken
    }

    const response = await fetch(`${this.record.execdBaseUrl}${pathname}`, {
      ...init,
      headers,
    })

    const text = await response.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    if (!response.ok) {
      throw new Error(
        typeof payload === 'string'
          ? payload
          : payload?.message || `OpenSandbox agent execd request failed (${response.status})`,
      )
    }

    return payload
  }

  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      const payload = await this.requestExec('/command', {
        method: 'POST',
        body: JSON.stringify({
          command: sanitized,
          cwd: safeCwd,
          sandboxId: this.record.serverId,
          background: false,
        }),
      })

      const output = [payload?.stdout, payload?.stderr].filter(Boolean).join('\n')
      const exitCode = Number(payload?.exitCode ?? payload?.exit_code ?? 0)

      return { success: exitCode === 0, output, exitCode }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'OpenSandbox agent command execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    const dir = path.dirname(resolved)
    await this.executeCommand(`mkdir -p ${JSON.stringify(dir)}`)
    const encoded = Buffer.from(content, 'utf-8').toString('base64')
    return this.executeCommand(
      `printf %s ${JSON.stringify(encoded)} | base64 -d > ${JSON.stringify(resolved)}`,
    )
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    return this.executeCommand(`cat ${JSON.stringify(resolved)}`)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath || '.')
    return this.executeCommand(`ls -la ${JSON.stringify(resolved)}`)
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    try {
      const response = await fetch(
        `${this.record.lifecycleBaseUrl}/sandboxes/${this.record.serverId}/endpoints/${port}`,
        {
          headers: { 'OPEN-SANDBOX-API-KEY': process.env.OPEN_SANDBOX_API_KEY || '' },
        },
      )

      const payload = await response.json().catch(() => null)
      const url = payload?.url || payload?.endpoint || `http://localhost:${port}`
      return { port, url }
    } catch {
      return { port, url: `http://localhost:${port}` }
    }
  }

  async getMetrics(): Promise<ToolResult> {
    try {
      const payload = await this.requestExec('/metrics', { method: 'GET' })
      return {
        success: true,
        output: JSON.stringify(payload, null, 2),
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to fetch metrics',
        exitCode: 1,
      }
    }
  }

  async uploadFile(filePath: string, content: Buffer): Promise<ToolResult> {
    try {
      const headers: Record<string, string> = {}
      if (this.record.execdAccessToken) {
        headers['X-EXECD-ACCESS-TOKEN'] = this.record.execdAccessToken
      }

      const formData = new FormData()
      formData.append('file', new Blob([content]), path.basename(filePath))
      formData.append('path', filePath)

      const response = await fetch(`${this.record.execdBaseUrl}/files/upload`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        const text = await response.text()
        return { success: false, output: text || 'Upload failed', exitCode: 1 }
      }

      return { success: true, output: `Uploaded ${filePath}`, exitCode: 0 }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'File upload failed',
        exitCode: 1,
      }
    }
  }

  async searchFiles(pattern: string, dirPath?: string): Promise<ToolResult> {
    try {
      const query = new URLSearchParams({ pattern })
      if (dirPath) query.set('path', dirPath)

      const payload = await this.requestExec(`/files/search?${query.toString()}`, {
        method: 'GET',
      })

      return {
        success: true,
        output: JSON.stringify(payload, null, 2),
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'File search failed',
        exitCode: 1,
      }
    }
  }
}
