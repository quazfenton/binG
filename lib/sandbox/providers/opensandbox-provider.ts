import * as path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'
import path from 'path'

const WORKSPACE_DIR = '/workspace'
const DEFAULT_TIMEOUT_SECONDS = 3600

interface OpenSandboxRecord {
  id: string
  lifecycleBaseUrl: string
  execdBaseUrl: string
  execdAccessToken?: string
}

const openSandboxHandles = new Map<string, OpenSandboxSandboxHandle>()

export class OpenSandboxProvider implements SandboxProvider {
  readonly name = 'opensandbox'
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
      throw new Error(typeof payload === 'string' ? payload : payload?.message || `OpenSandbox lifecycle request failed (${response.status})`)
    }

    return payload
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const timeout = Number(config.autoStopInterval || DEFAULT_TIMEOUT_SECONDS)
    const image = process.env.OPEN_SANDBOX_IMAGE || 'node:20'

    const payload = await this.requestLifecycle('/sandboxes', {
      method: 'POST',
      body: JSON.stringify({
        image,
        timeout,
        entrypoint: ['/bin/sh', '-lc', 'sleep infinity'],
        envs: config.envVars || {},
        metadata: config.labels || {},
      }),
    })

    const sandboxId = payload?.sandboxId || payload?.id || payload?.sandbox?.id
    if (!sandboxId) {
      throw new Error('OpenSandbox did not return sandbox id')
    }

    const record: OpenSandboxRecord = {
      id: sandboxId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    }

    const handle = new OpenSandboxSandboxHandle(record)
    openSandboxHandles.set(sandboxId, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = openSandboxHandles.get(sandboxId)
    if (existing) {
      return existing
    }

    await this.requestLifecycle(`/sandboxes/${sandboxId}`, { method: 'GET' })

    const handle = new OpenSandboxSandboxHandle({
      id: sandboxId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    })

    openSandboxHandles.set(sandboxId, handle)
    return handle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await this.requestLifecycle(`/sandboxes/${sandboxId}`, { method: 'DELETE' })
    openSandboxHandles.delete(sandboxId)
  }
}

class OpenSandboxSandboxHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  readonly id: string

  constructor(private readonly record: OpenSandboxRecord) {
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
      throw new Error(typeof payload === 'string' ? payload : payload?.message || `OpenSandbox exec request failed (${response.status})`)
    }

    return payload
  }

  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd) : this.workspaceDir
      const payload = await this.requestExec('/command', {
        method: 'POST',
        body: JSON.stringify({
          command: sanitized,
          cwd: safeCwd,
          sandboxId: this.record.id,
          background: false,
        }),
      })

      const output = [payload?.stdout, payload?.stderr].filter(Boolean).join('\n')
      const exitCode = Number(payload?.exitCode ?? payload?.exit_code ?? 0)

      return {
        success: exitCode === 0,
        output,
        exitCode,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'OpenSandbox command execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    const dir = path.dirname(resolved)
    await this.executeCommand(`mkdir -p ${JSON.stringify(dir)}`)
    const encoded = Buffer.from(content, 'utf-8').toString('base64')
    return this.executeCommand(`printf %s ${JSON.stringify(encoded)} | base64 -d > ${JSON.stringify(resolved)}`)
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
      const response = await fetch(`${this.record.lifecycleBaseUrl}/sandboxes/${this.record.id}/endpoints/${port}`, {
        headers: {
          'OPEN-SANDBOX-API-KEY': process.env.OPEN_SANDBOX_API_KEY || '',
        },
      })

      const payload = await response.json().catch(() => null)
      const url = payload?.url || payload?.endpoint || `http://localhost:${port}`

      return {
        port,
        url,
      }
    } catch {
      return {
        port,
        url: `http://localhost:${port}`,
      }
    }
  }
}
