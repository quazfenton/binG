import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'

const WORKSPACE_DIR = '/home/user/workspace'
const MAX_COMMAND_TIMEOUT = 120

export class RunloopProvider implements SandboxProvider {
  readonly name = 'runloop'
  private client: any

  constructor() {
    const { RunloopSDK } = require('@runloop/runloop-sdk')
    this.client = new RunloopSDK({
      apiKey: process.env.RUNLOOP_API_KEY!,
    })
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const devbox = await this.client.devbox.create({
      blueprint: 'standard',
    })

    const handle = new RunloopSandboxHandle(devbox, this.client)
    await handle.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
    return handle
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const devbox = await this.client.devbox.get(sandboxId)
    return new RunloopSandboxHandle(devbox, this.client)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const devbox = await this.client.devbox.get(sandboxId)
    await devbox.shutdown()
  }
}

class RunloopSandboxHandle implements SandboxHandle {
  readonly id: string
  private devbox: any
  private client: any

  constructor(devbox: any, client: any) {
    this.devbox = devbox
    this.id = devbox.id
    this.client = client
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const fullCommand = cwd ? `cd ${cwd} && ${command}` : `cd ${WORKSPACE_DIR} && ${command}`
    const result = await this.devbox.cmd.exec({
      command: fullCommand,
      shell: '/bin/bash',
    })

    const stdout = await result.stdout()
    const stderr = await result.stderr()

    return {
      success: result.exit_code === 0,
      output: stdout + (stderr ? `\n${stderr}` : ''),
      exitCode: result.exit_code,
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

  private resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) return filePath
    return `${WORKSPACE_DIR}/${filePath}`
  }
}
