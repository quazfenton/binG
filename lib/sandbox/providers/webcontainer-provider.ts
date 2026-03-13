import path from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'
import { SandboxSecurityManager } from '../security-manager'
import { generateSecureId } from '@/lib/utils'

const WORKSPACE_DIR = '/workspace'

type WebContainerProcess = {
  output?: ReadableStream<Uint8Array>
  exit?: Promise<number>
}

type WebContainerInstance = {
  fs: {
    mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>
    writeFile(filePath: string, content: string): Promise<void>
    readFile(filePath: string, encoding?: string): Promise<string | Uint8Array>
    readdir(dirPath: string, options?: { withFileTypes?: boolean }): Promise<any[]>
  }
  spawn(command: string, args?: string[], options?: { cwd?: string }): Promise<WebContainerProcess>
  on?(event: string, listener: (...args: any[]) => void): void
}

type WebContainerModule = {
  WebContainer: {
    boot(): Promise<WebContainerInstance>
  }
  auth?: {
    init(options: { clientId: string; scope: string }): void
  }
}

const webContainerHandles = new Map<string, WebContainerSandboxHandle>()

function tokenizeCommand(command: string): string[] {
  const matches = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) || []
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ''))
}

async function readStreamToString(stream?: ReadableStream<Uint8Array>): Promise<string> {
  if (!stream) return ''
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

export class WebContainerProvider implements SandboxProvider {
  readonly name = 'webcontainer'
  private modulePromise: Promise<WebContainerModule> | null = null

  private async loadModule(): Promise<WebContainerModule> {
    if (typeof window === 'undefined') {
      throw new Error('WebContainer provider requires a browser runtime')
    }

    if (!this.modulePromise) {
      this.modulePromise = (new Function('return import("@webcontainer/api")')() as Promise<WebContainerModule>)
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

  async createSandbox(_config: SandboxCreateConfig): Promise<SandboxHandle> {
    const instance = await this.bootWebContainer()
    const id = `webcontainer-${Date.now()}-${generateSecureId('wc').split('_')[2]}`
    const handle = new WebContainerSandboxHandle(id, instance)
    webContainerHandles.set(id, handle)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = webContainerHandles.get(sandboxId)
    if (!existing) {
      throw new Error(`WebContainer sandbox not found: ${sandboxId}`)
    }
    return existing
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    webContainerHandles.delete(sandboxId)
  }
}

class WebContainerSandboxHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  private previews = new Map<number, string>()

  constructor(
    readonly id: string,
    private readonly instance: WebContainerInstance,
  ) {
    this.instance.on?.('server-ready', (port: number, url: string) => {
      if (typeof port === 'number' && typeof url === 'string') {
        this.previews.set(port, url)
      }
    })
  }

  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      const shellAttempt = await this.trySpawn('jsh', ['-c', sanitized], safeCwd)
      if (shellAttempt) return shellAttempt

      const tokens = tokenizeCommand(sanitized)
      if (tokens.length === 0) {
        return { success: true, output: '', exitCode: 0 }
      }

      const [cmd, ...args] = tokens
      const process = await this.instance.spawn(cmd, args, { cwd: safeCwd })
      const output = await readStreamToString(process.output)
      const exitCode = process.exit ? await process.exit : 0

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

  private async trySpawn(command: string, args: string[], cwd: string): Promise<ToolResult | null> {
    try {
      const process = await this.instance.spawn(command, args, { cwd })
      const output = await readStreamToString(process.output)
      const exitCode = process.exit ? await process.exit : 0
      return {
        success: exitCode === 0,
        output,
        exitCode,
      }
    } catch {
      return null
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
}
