/**
 * OpenSandbox + Nullclaw Containerized Provider
 *
 * Spawns Nullclaw inside an OpenSandbox container with network policies,
 * health checks, and endpoint routing. Based on the Alibaba OpenSandbox
 * nullclaw example pattern (github.com/alibaba/OpenSandbox/examples/nullclaw).
 *
 * Features:
 * - Nullclaw agent gateway running in isolated OpenSandbox container
 * - Network policy enforcement (deny-by-default, allow specific egress)
 * - Health check polling before returning handle
 * - Agent/tool endpoint calls into the sandboxed nullclaw instance
 * - Configuration injection via config.yml writes
 *
 * @see opensandbox-provider.ts - Base OpenSandbox provider
 * @see opensandbox-agent-sandbox-provider.ts - Agent sandbox variant
 */

import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'

const WORKSPACE_DIR = '/workspace'
const DEFAULT_TIMEOUT_SECONDS = 3600 // 1 hour
const HEALTH_CHECK_INTERVAL_MS = 200
const HEALTH_CHECK_MAX_ATTEMPTS = 150 // ~30 seconds
const NULLCLAW_PORT = 3000

// ---------------------------------------------------------------------------
// Network policy types (mirror OpenSandbox SDK)
// ---------------------------------------------------------------------------

export interface NetworkRule {
  action: 'allow' | 'deny'
  target: string
  ports?: number[]
}

export interface NetworkPolicy {
  defaultAction: 'allow' | 'deny'
  egress?: NetworkRule[]
  ingress?: NetworkRule[]
}

// ---------------------------------------------------------------------------
// Nullclaw configuration types
// ---------------------------------------------------------------------------

export interface NullclawConfig {
  providers?: Record<string, { api_key?: string; models?: string[] }>
  agents?: {
    defaults?: {
      model?: { primary?: string; fallback?: string }
      max_steps?: number
      timeout?: number
    }
  }
  tools?: Record<string, { enabled?: boolean; api_key?: string; [k: string]: any }>
  server?: { host?: string; port?: number }
}

export interface NullclawAgentOptions {
  model?: string
  tools?: string[]
  timeout?: number
  context?: string
}

export interface NullclawAgentResult {
  response: string
  steps: any[]
  toolCalls: any[]
}

// ---------------------------------------------------------------------------
// Internal record
// ---------------------------------------------------------------------------

interface NullclawSandboxRecord {
  id: string
  serverId: string
  lifecycleBaseUrl: string
  execdBaseUrl: string
  execdAccessToken?: string
  nullclawEndpoint?: string
}

const nullclawHandles = new Map<string, OpenSandboxNullclawHandle>()

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenSandboxNullclawProvider implements SandboxProvider {
  readonly name = 'opensandbox-nullclaw'
  private readonly lifecycleBaseUrl: string
  private readonly execdBaseUrl: string
  private readonly apiKey: string
  private readonly execdAccessToken?: string

  constructor() {
    this.lifecycleBaseUrl = (
      process.env.OPEN_SANDBOX_BASE_URL || 'http://localhost:8080/v1'
    ).replace(/\/$/, '')
    this.execdBaseUrl = (
      process.env.OPEN_SANDBOX_EXECD_BASE_URL ||
      this.lifecycleBaseUrl.replace(/\/v1$/, '')
    ).replace(/\/$/, '')
    this.apiKey = process.env.OPEN_SANDBOX_API_KEY || ''
    this.execdAccessToken =
      process.env.OPEN_SANDBOX_EXECD_ACCESS_TOKEN || undefined
  }

  // -- lifecycle HTTP helper ------------------------------------------------

  private async requestLifecycle(
    pathname: string,
    init: RequestInit = {},
  ): Promise<any> {
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
          : payload?.message ||
            `OpenSandbox lifecycle request failed (${response.status})`,
      )
    }

    return payload
  }

  // -- build network policy -------------------------------------------------

  private buildNetworkPolicy(): NetworkPolicy {
    const allowedDomains = (
      process.env.NULLCLAW_ALLOWED_DOMAINS || 'openrouter.ai'
    )
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)

    return {
      defaultAction: 'deny',
      egress: allowedDomains.map((target) => ({
        action: 'allow' as const,
        target,
      })),
    }
  }

  // -- health check ---------------------------------------------------------

  private async waitForNullclaw(
    record: NullclawSandboxRecord,
  ): Promise<string> {
    // Resolve the endpoint URL via the lifecycle API
    let endpointUrl: string

    try {
      const epPayload = await this.requestLifecycle(
        `/sandboxes/${record.serverId}/endpoints/${NULLCLAW_PORT}`,
        { method: 'GET' },
      )
      endpointUrl =
        epPayload?.url ||
        epPayload?.endpoint ||
        `http://localhost:${NULLCLAW_PORT}`
    } catch {
      endpointUrl = `http://localhost:${NULLCLAW_PORT}`
    }

    const healthUrl = `${endpointUrl.replace(/\/$/, '')}/health`

    for (let i = 0; i < HEALTH_CHECK_MAX_ATTEMPTS; i++) {
      try {
        const resp = await fetch(healthUrl, {
          signal: AbortSignal.timeout(1000),
        })
        if (resp.ok) {
          console.log(
            `[opensandbox-nullclaw] Sandbox ${record.serverId} healthy after ${((i + 1) * HEALTH_CHECK_INTERVAL_MS / 1000).toFixed(1)}s`,
          )
          return endpointUrl
        }
      } catch {
        // not ready yet
      }
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS),
      )
    }

    console.warn(
      `[opensandbox-nullclaw] Health check timed out for sandbox ${record.serverId}; proceeding anyway`,
    )
    return endpointUrl
  }

  // -- SandboxProvider interface --------------------------------------------

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const timeout = Number(
      config.autoStopInterval ||
        process.env.NULLCLAW_TIMEOUT ||
        DEFAULT_TIMEOUT_SECONDS,
    )
    const image =
      process.env.NULLCLAW_IMAGE || 'ghcr.io/nullclaw/nullclaw:latest'
    const networkPolicy = this.buildNetworkPolicy()

    const body: Record<string, any> = {
      image,
      timeout,
      envs: {
        NULLCLAW_TIMEOUT: String(timeout),
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
        ...(config.envVars || {}),
      },
      metadata: {
        ...config.labels,
        mode: 'nullclaw',
        createdBy: 'opensandbox-nullclaw-provider',
      },
      network_policy: networkPolicy,
    }

    const payload = await this.requestLifecycle('/sandboxes', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    const serverId =
      payload?.sandboxId || payload?.id || payload?.sandbox?.id
    if (!serverId) {
      throw new Error('OpenSandbox did not return sandbox id')
    }

    const sandboxId = `osb-nullclaw-${serverId}`
    const record: NullclawSandboxRecord = {
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    }

    // Wait for nullclaw to be healthy and capture the endpoint
    const nullclawEndpoint = await this.waitForNullclaw(record)
    record.nullclawEndpoint = nullclawEndpoint

    const handle = new OpenSandboxNullclawHandle(record)
    nullclawHandles.set(sandboxId, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = nullclawHandles.get(sandboxId)
    if (existing) return existing

    const serverId = sandboxId.replace(/^osb-nullclaw-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'GET' })

    const handle = new OpenSandboxNullclawHandle({
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    })

    nullclawHandles.set(sandboxId, handle)
    return handle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const serverId = sandboxId.replace(/^osb-nullclaw-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'DELETE' })
    nullclawHandles.delete(sandboxId)
  }
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

export class OpenSandboxNullclawHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  readonly id: string
  private readonly record: NullclawSandboxRecord

  constructor(record: NullclawSandboxRecord) {
    this.record = record
    this.id = record.id
  }

  // -- execd HTTP helper ----------------------------------------------------

  private async requestExec(
    pathname: string,
    init: RequestInit = {},
  ): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) || {}),
    }

    if (this.record.execdAccessToken) {
      headers['X-EXECD-ACCESS-TOKEN'] = this.record.execdAccessToken
    }

    const response = await fetch(
      `${this.record.execdBaseUrl}${pathname}`,
      { ...init, headers },
    )

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
          : payload?.message ||
            `OpenSandbox nullclaw execd request failed (${response.status})`,
      )
    }

    return payload
  }

  // -- nullclaw HTTP helper -------------------------------------------------

  private getNullclawBaseUrl(): string {
    return (
      this.record.nullclawEndpoint ||
      `http://localhost:${NULLCLAW_PORT}`
    ).replace(/\/$/, '')
  }

  private async requestNullclaw(
    pathname: string,
    init: RequestInit = {},
  ): Promise<any> {
    const url = `${this.getNullclawBaseUrl()}${pathname}`
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) || {}),
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
          : payload?.message ||
            `Nullclaw request failed (${response.status})`,
      )
    }

    return payload
  }

  // -- SandboxHandle: standard operations -----------------------------------

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

      const output = [payload?.stdout, payload?.stderr]
        .filter(Boolean)
        .join('\n')
      const exitCode = Number(payload?.exitCode ?? payload?.exit_code ?? 0)

      return { success: exitCode === 0, output, exitCode }
    } catch (error: any) {
      return {
        success: false,
        output:
          error?.message || 'OpenSandbox nullclaw command execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(
      this.workspaceDir,
      filePath,
    )
    const dir = path.dirname(resolved)
    await this.executeCommand(`mkdir -p ${JSON.stringify(dir)}`)
    const encoded = Buffer.from(content, 'utf-8').toString('base64')
    return this.executeCommand(
      `printf %s ${JSON.stringify(encoded)} | base64 -d > ${JSON.stringify(resolved)}`,
    )
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(
      this.workspaceDir,
      filePath,
    )
    return this.executeCommand(`cat ${JSON.stringify(resolved)}`)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(
      this.workspaceDir,
      dirPath || '.',
    )
    return this.executeCommand(`ls -la ${JSON.stringify(resolved)}`)
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    try {
      const response = await fetch(
        `${this.record.lifecycleBaseUrl}/sandboxes/${this.record.serverId}/endpoints/${port}`,
        {
          headers: {
            'OPEN-SANDBOX-API-KEY':
              process.env.OPEN_SANDBOX_API_KEY || '',
          },
        },
      )

      const payload = await response.json().catch(() => null)
      const url =
        payload?.url || payload?.endpoint || `http://localhost:${port}`
      return { port, url }
    } catch {
      return { port, url: `http://localhost:${port}` }
    }
  }

  // -- Nullclaw-specific operations -----------------------------------------

  /**
   * Get the nullclaw gateway endpoint URL and health status
   */
  async getNullclawEndpoint(): Promise<{ url: string; healthy: boolean }> {
    const url = this.getNullclawBaseUrl()
    try {
      const resp = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      return { url, healthy: resp.ok }
    } catch {
      return { url, healthy: false }
    }
  }

  /**
   * Call the nullclaw agent endpoint inside the sandbox
   */
  async callNullclawAgent(
    prompt: string,
    options?: NullclawAgentOptions,
  ): Promise<NullclawAgentResult> {
    const body: Record<string, any> = { prompt }
    if (options?.model) body.model = options.model
    if (options?.tools) body.tools = options.tools
    if (options?.timeout) body.timeout = options.timeout
    if (options?.context) body.context = options.context

    const payload = await this.requestNullclaw('/api/agent', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    return {
      response: payload?.response || payload?.output || '',
      steps: payload?.steps || [],
      toolCalls: payload?.toolCalls || payload?.tool_calls || [],
    }
  }

  /**
   * Call a specific nullclaw tool inside the sandbox
   */
  async callNullclawTool(
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    return this.requestNullclaw(`/api/tools/${encodeURIComponent(toolName)}`, {
      method: 'POST',
      body: JSON.stringify(args),
    })
  }

  /**
   * Check nullclaw health
   */
  async getNullclawHealth(): Promise<{
    status: string
    uptime?: number
  }> {
    try {
      const payload = await this.requestNullclaw('/health', {
        method: 'GET',
      })
      return {
        status: payload?.status || 'ok',
        uptime: payload?.uptime,
      }
    } catch (error: any) {
      return { status: 'unhealthy' }
    }
  }

  /**
   * Write a new nullclaw config.yml into the running sandbox
   */
  async configureNullclaw(config: NullclawConfig): Promise<void> {
    // Build YAML manually (simple key-value, avoids js-yaml dependency)
    const lines: string[] = []

    if (config.providers) {
      lines.push('providers:')
      for (const [name, prov] of Object.entries(config.providers)) {
        lines.push(`  ${name}:`)
        if (prov.api_key) lines.push(`    api_key: ${prov.api_key}`)
        if (prov.models) {
          lines.push('    models:')
          for (const m of prov.models) lines.push(`      - ${m}`)
        }
      }
    }

    if (config.agents?.defaults) {
      lines.push('agents:')
      lines.push('  defaults:')
      const d = config.agents.defaults
      if (d.model) {
        lines.push('    model:')
        if (d.model.primary) lines.push(`      primary: ${d.model.primary}`)
        if (d.model.fallback) lines.push(`      fallback: ${d.model.fallback}`)
      }
      if (d.max_steps != null) lines.push(`    max_steps: ${d.max_steps}`)
      if (d.timeout != null) lines.push(`    timeout: ${d.timeout}`)
    }

    if (config.tools) {
      lines.push('tools:')
      for (const [name, tool] of Object.entries(config.tools)) {
        lines.push(`  ${name}:`)
        for (const [k, v] of Object.entries(tool)) {
          lines.push(`    ${k}: ${v}`)
        }
      }
    }

    if (config.server) {
      lines.push('server:')
      if (config.server.host) lines.push(`  host: ${config.server.host}`)
      if (config.server.port != null)
        lines.push(`  port: ${config.server.port}`)
    }

    const yamlContent = lines.join('\n') + '\n'
    await this.writeFile('/app/config.yml', yamlContent)
  }
}
