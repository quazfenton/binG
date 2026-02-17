import type { ToolResult } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
} from './sandbox-provider'

const WORKSPACE_DIR = '/workspace'

const sandboxInstances = new Map<string, any>()

export class MicrosandboxProvider implements SandboxProvider {
  readonly name = 'microsandbox'

  constructor() {
    // Requires microsandbox server running on host
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const { NodeSandbox } = require('microsandbox')

    const createOptions: any = {
      name: `session-${Date.now()}`,
    }

    if (config.mounts?.length) {
      createOptions.mounts = config.mounts.map((m) => ({
        hostPath: m.source,
        containerPath: m.target,
      }))
    }

    const sb = await NodeSandbox.create(createOptions)
    sandboxInstances.set(sb.id, sb)

    const handle = new MicrosandboxSandboxHandle(sb)
    await handle.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const sb = sandboxInstances.get(sandboxId)
    if (!sb) throw new Error(`Microsandbox session ${sandboxId} not found`)
    return new MicrosandboxSandboxHandle(sb)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const sb = sandboxInstances.get(sandboxId)
    if (sb) {
      await sb.stop()
      sandboxInstances.delete(sandboxId)
    }
  }
}

class MicrosandboxSandboxHandle implements SandboxHandle {
  readonly id: string
  private sb: any

  constructor(sb: any) {
    this.sb = sb
    this.id = sb.id
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const fullCommand = cwd ? `cd ${cwd} && ${command}` : `cd ${WORKSPACE_DIR} && ${command}`

    const exec = await this.sb.run(fullCommand)
    const output = await exec.output()

    return {
      success: exec.exit_code === 0,
      output,
      exitCode: exec.exit_code,
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    const dir = resolved.substring(0, resolved.lastIndexOf('/'))
    await this.executeCommand(`mkdir -p ${dir}`)

    const escaped = content.replace(/'/g, "'\\''")
    await this.executeCommand(`printf '%s' '${escaped}' > ${resolved}`)
    return { success: true, output: `File written: ${resolved}` }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)
    return this.executeCommand(`cat ${resolved}`)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath)
    return this.executeCommand(`ls -la ${resolved}`)
  }

  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const proc = await this.sb.spawn('/bin/bash')

    proc.stdout.on('data', (data: Buffer) => {
      options.onData(new Uint8Array(data))
    })
    proc.stderr.on('data', (data: Buffer) => {
      options.onData(new Uint8Array(data))
    })

    return new MicrosandboxPtyHandle(options.id, proc)
  }

  private resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) return filePath
    return `${WORKSPACE_DIR}/${filePath}`
  }
}

class MicrosandboxPtyHandle implements PtyHandle {
  readonly sessionId: string
  private proc: any

  constructor(sessionId: string, proc: any) {
    this.sessionId = sessionId
    this.proc = proc
  }

  async sendInput(data: string): Promise<void> {
    this.proc.stdin.write(data)
  }

  async resize(_cols: number, _rows: number): Promise<void> {
    // Microsandbox spawn doesn't support resize natively
  }

  async waitForConnection(): Promise<void> {
    // Spawn is immediately connected
  }

  async disconnect(): Promise<void> {
    this.proc.kill()
  }

  async kill(): Promise<void> {
    this.proc.kill('SIGKILL')
  }
}
