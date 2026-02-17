import { Daytona } from '@daytonaio/sdk'
import { resolve, relative } from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'

const WORKSPACE_DIR = '/home/daytona/workspace'
const MAX_COMMAND_TIMEOUT = 120

export class DaytonaProvider implements SandboxProvider {
  readonly name = 'daytona'
  private client: Daytona

  constructor() {
    this.client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY!,
    })
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandbox = await this.client.create({
      language: config.language ?? 'typescript',
      autoStopInterval: config.autoStopInterval ?? 60,
      resources: config.resources ?? { cpu: 2, memory: 4 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config.envVars,
      },
      labels: config.labels,
    })

    await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
    return new DaytonaSandboxHandle(sandbox, this.client)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const sandbox = await this.client.get(sandboxId)
    return new DaytonaSandboxHandle(sandbox, this.client)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = await this.client.get(sandboxId)
    await sandbox.delete()
  }
}

class DaytonaSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = '/home/daytona/workspace'
  private sandbox: any
  private client: Daytona

  constructor(sandbox: any, client: Daytona) {
    this.sandbox = sandbox
    this.id = sandbox.id
    this.client = client
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const response = await this.sandbox.process.executeCommand(
      command,
      cwd ?? WORKSPACE_DIR,
      undefined,
      timeout ?? MAX_COMMAND_TIMEOUT,
    )
    return {
      success: response.exitCode === 0,
      output: response.result,
      exitCode: response.exitCode,
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    const dir = resolved.substring(0, resolved.lastIndexOf('/'))
    if (dir) {
      await this.sandbox.fs.createFolder(dir, '755')
    }
    await this.sandbox.fs.uploadFile(Buffer.from(content, 'utf-8'), resolved)
    return { success: true, output: `File written: ${resolved}` }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    const buffer = await this.sandbox.fs.downloadFile(resolved)
    return { success: true, output: buffer.toString('utf-8') }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath)
    const files = await this.sandbox.fs.listFiles(resolved)
    const listing = files.map((f: any) => `${f.isDir ? 'd' : '-'} ${f.name}`).join('\n')
    return { success: true, output: listing || '(empty directory)' }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    const preview = await this.sandbox.getPreviewLink(port)
    return { port, url: preview.url, token: preview.token }
  }

  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const ptyHandle = await this.sandbox.process.createPty({
      id: options.id,
      cwd: options.cwd ?? WORKSPACE_DIR,
      envs: options.envs ?? { TERM: 'xterm-256color' },
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      onData: options.onData,
    })

    return new DaytonaPtyHandle(options.id, ptyHandle)
  }

  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const ptyHandle = await this.sandbox.process.connectPty(sessionId, {
      onData: options.onData,
    })
    return new DaytonaPtyHandle(sessionId, ptyHandle)
  }

  private resolvePath(filePath: string): string {
    const resolved = filePath.startsWith('/')
      ? resolve(filePath)
      : resolve(WORKSPACE_DIR, filePath);
    
    // Ensure path stays within workspace
    const rel = relative(WORKSPACE_DIR, resolved);
    if (rel.startsWith('..') || resolve(WORKSPACE_DIR, rel) !== resolved || rel === '..') {
      throw new Error(`Path traversal rejected: ${filePath}`);
    }
    return resolved;
  }
}

class DaytonaPtyHandle implements PtyHandle {
  readonly sessionId: string
  private handle: any

  constructor(sessionId: string, handle: any) {
    this.sessionId = sessionId
    this.handle = handle
  }

  async sendInput(data: string): Promise<void> {
    await this.handle.sendInput(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.handle.resize(cols, rows)
  }

  async waitForConnection(): Promise<void> {
    await this.handle.waitForConnection()
  }

  async disconnect(): Promise<void> {
    await this.handle.disconnect()
  }

  async kill(): Promise<void> {
    await this.handle.kill()
  }
}
