import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'

const WORKSPACE_DIR = '/workspace'
const DEFAULT_TIMEOUT_SECONDS = 3600

const SUPPORTED_LANGUAGES = new Set(['python', 'javascript', 'typescript', 'java', 'go', 'bash'])

const DEFAULT_CI_IMAGE =
  'sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.0.1'
const DEFAULT_CI_ENTRYPOINT = '/opt/opensandbox/code-interpreter.sh'

interface CodeInterpreterRecord {
  id: string
  serverId: string
  lifecycleBaseUrl: string
  execdBaseUrl: string
  execdAccessToken?: string
}

interface CodeExecutionResult {
  stdout: string[]
  stderr: string[]
  results: string[]
  error: { name: string; value: string } | null
}

const codeInterpreterHandles = new Map<string, OpenSandboxCodeInterpreterHandle>()

export class OpenSandboxCodeInterpreterProvider implements SandboxProvider {
  readonly name = 'opensandbox-code-interpreter'
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
    const image = process.env.OPEN_SANDBOX_CI_IMAGE || DEFAULT_CI_IMAGE
    const entrypoint = (process.env.OPEN_SANDBOX_CI_ENTRYPOINT || DEFAULT_CI_ENTRYPOINT).split(',')

    const body: Record<string, any> = {
      image,
      timeout,
      entrypoint,
      envs: config.envVars || {},
      metadata: { ...config.labels, mode: 'code-interpreter' },
    }

    const poolRef = process.env.OPEN_SANDBOX_CI_POOL_REF
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

    const sandboxId = `osb-ci-${serverId}`
    const record: CodeInterpreterRecord = {
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    }

    const handle = new OpenSandboxCodeInterpreterHandle(record)
    codeInterpreterHandles.set(sandboxId, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = codeInterpreterHandles.get(sandboxId)
    if (existing) return existing

    const serverId = sandboxId.replace(/^osb-ci-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'GET' })

    const handle = new OpenSandboxCodeInterpreterHandle({
      id: sandboxId,
      serverId,
      lifecycleBaseUrl: this.lifecycleBaseUrl,
      execdBaseUrl: this.execdBaseUrl,
      execdAccessToken: this.execdAccessToken,
    })

    codeInterpreterHandles.set(sandboxId, handle)
    return handle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const serverId = sandboxId.replace(/^osb-ci-/, '')
    await this.requestLifecycle(`/sandboxes/${serverId}`, { method: 'DELETE' })
    codeInterpreterHandles.delete(sandboxId)
  }
}

class OpenSandboxCodeInterpreterHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  readonly id: string
  private readonly record: CodeInterpreterRecord
  private contexts = new Map<string, string>()

  constructor(record: CodeInterpreterRecord) {
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
          : payload?.message || `OpenSandbox execd request failed (${response.status})`,
      )
    }

    return payload
  }

  private async requestExecRaw(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    }

    if (this.record.execdAccessToken) {
      headers['X-EXECD-ACCESS-TOKEN'] = this.record.execdAccessToken
    }

    return fetch(`${this.record.execdBaseUrl}${pathname}`, {
      ...init,
      headers,
    })
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

  // ---------------------------------------------------------------------------
  // Code Interpreter API
  // ---------------------------------------------------------------------------

  async runCode(code: string, language: string): Promise<ToolResult> {
    const lang = language.toLowerCase()
    if (!SUPPORTED_LANGUAGES.has(lang)) {
      return {
        success: false,
        output: `Language '${language}' is not supported by the code interpreter. Supported: ${[...SUPPORTED_LANGUAGES].join(', ')}`,
        exitCode: 1,
      }
    }

    try {
      const contextId = await this.getOrCreateContext(lang)

      const response = await this.requestExecRaw('/code', {
        method: 'POST',
        body: JSON.stringify({
          code,
          context_id: contextId,
          language: lang,
          sandboxId: this.record.serverId,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        return {
          success: false,
          output: errText || `Code execution failed (${response.status})`,
          exitCode: 1,
        }
      }

      const body = await response.text()
      const result = parseSSEResponse(body)

      const outputParts: string[] = []
      if (result.stdout.length) outputParts.push(result.stdout.join('\n'))
      if (result.stderr.length) outputParts.push(result.stderr.join('\n'))
      if (result.results.length) outputParts.push(result.results.join('\n'))

      if (result.error) {
        outputParts.push(`${result.error.name}: ${result.error.value}`)
        return {
          success: false,
          output: outputParts.join('\n') || `${result.error.name}: ${result.error.value}`,
          exitCode: 1,
        }
      }

      return {
        success: true,
        output: outputParts.join('\n') || '(no output)',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Code interpreter execution failed',
        exitCode: 1,
      }
    }
  }

  async listContexts(language?: string): Promise<ToolResult> {
    try {
      const query = language ? `?language=${encodeURIComponent(language)}` : ''
      const payload = await this.requestExec(`/code/contexts${query}`, { method: 'GET' })
      return {
        success: true,
        output: JSON.stringify(payload, null, 2),
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to list code contexts',
        exitCode: 1,
      }
    }
  }

  async deleteContext(contextId: string): Promise<ToolResult> {
    try {
      await this.requestExec(`/code/contexts/${contextId}`, { method: 'DELETE' })
      for (const [lang, id] of this.contexts) {
        if (id === contextId) {
          this.contexts.delete(lang)
          break
        }
      }
      return { success: true, output: `Context ${contextId} deleted`, exitCode: 0 }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Failed to delete code context',
        exitCode: 1,
      }
    }
  }

  private async getOrCreateContext(language: string): Promise<string> {
    const cached = this.contexts.get(language)
    if (cached) return cached

    const payload = await this.requestExec('/code/context', {
      method: 'POST',
      body: JSON.stringify({
        language,
        sandboxId: this.record.serverId,
      }),
    })

    const contextId = payload?.context_id || payload?.contextId || payload?.id
    if (!contextId) {
      throw new Error('OpenSandbox did not return a context id')
    }

    this.contexts.set(language, contextId)
    return contextId
  }
}

// ---------------------------------------------------------------------------
// SSE Response Parser
// ---------------------------------------------------------------------------

function parseSSEResponse(text: string): CodeExecutionResult {
  const stdout: string[] = []
  const stderr: string[] = []
  const results: string[] = []
  let error: { name: string; value: string } | null = null

  // Try parsing as plain JSON first (some servers return JSON instead of SSE)
  try {
    const json = JSON.parse(text)
    if (json && typeof json === 'object') {
      if (json.stdout) stdout.push(typeof json.stdout === 'string' ? json.stdout : JSON.stringify(json.stdout))
      if (json.stderr) stderr.push(typeof json.stderr === 'string' ? json.stderr : JSON.stringify(json.stderr))
      if (json.result) results.push(typeof json.result === 'string' ? json.result : JSON.stringify(json.result))
      if (json.error) {
        error = {
          name: json.error.name || 'Error',
          value: json.error.value || json.error.message || JSON.stringify(json.error),
        }
      }
      return { stdout, stderr, results, error }
    }
  } catch {
    // Not JSON — parse as SSE
  }

  let currentEvent = ''
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice(6).trim()
    } else if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim()
      if (!data) continue

      try {
        const parsed = JSON.parse(data)
        switch (currentEvent) {
          case 'stdout':
            if (parsed.text != null) stdout.push(String(parsed.text))
            break
          case 'stderr':
            if (parsed.text != null) stderr.push(String(parsed.text))
            break
          case 'result':
            if (parsed.text != null) results.push(String(parsed.text))
            break
          case 'error':
            error = {
              name: parsed.name || 'Error',
              value: parsed.value || parsed.message || JSON.stringify(parsed),
            }
            break
          // execution_complete, init, status, execution_count — no-op
        }
      } catch {
        // Unparseable data line — treat as raw stdout
        if (currentEvent === 'stdout' || currentEvent === '') {
          stdout.push(data)
        }
      }
    }
  }

  return { stdout, stderr, results, error }
}
