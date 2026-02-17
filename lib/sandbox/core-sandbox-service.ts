import type { WorkspaceSession, SandboxConfig, ToolResult, PreviewInfo } from './types'
import { getSandboxProvider, type SandboxProvider, type SandboxHandle } from './providers'
import { saveSession, updateSession, deleteSession } from './session-store'
import { setupCacheVolumes } from './dep-cache'
import { randomUUID } from 'crypto'

export class SandboxService {
  private provider: SandboxProvider

  constructor() {
    this.provider = getSandboxProvider()
  }

  async createWorkspace(userId: string, config?: SandboxConfig): Promise<WorkspaceSession> {
    const handle = await this.provider.createSandbox({
      language: config?.language ?? 'typescript',
      autoStopInterval: config?.autoStopInterval ?? 60,
      resources: config?.resources ?? { cpu: 2, memory: 4 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config?.envVars,
      },
      labels: { userId },
    })

    await setupCacheVolumes(handle)

    const session: WorkspaceSession = {
      sessionId: randomUUID(),
      sandboxId: handle.id,
      userId,
      cwd: '/workspace',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      status: 'active',
    }

    saveSession(session)
    return session
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    return this.provider.getSandbox(sandboxId)
  }

  async executeCommand(sandboxId: string, command: string, cwd?: string): Promise<ToolResult> {
    const handle = await this.provider.getSandbox(sandboxId)
    return handle.executeCommand(command, cwd)
  }

  async writeFile(sandboxId: string, filePath: string, content: string): Promise<ToolResult> {
    const handle = await this.provider.getSandbox(sandboxId)
    return handle.writeFile(filePath, content)
  }

  async readFile(sandboxId: string, filePath: string): Promise<ToolResult> {
    const handle = await this.provider.getSandbox(sandboxId)
    return handle.readFile(filePath)
  }

  async listDirectory(sandboxId: string, dirPath?: string): Promise<ToolResult> {
    const handle = await this.provider.getSandbox(sandboxId)
    return handle.listDirectory(dirPath ?? '.')
  }

  async getPreviewLink(sandboxId: string, port: number): Promise<PreviewInfo> {
    const handle = await this.provider.getSandbox(sandboxId)
    if (!handle.getPreviewLink) {
      throw new Error(`Provider '${this.provider.name}' does not support preview links`)
    }
    return handle.getPreviewLink(port)
  }

  async destroyWorkspace(sessionId: string, sandboxId: string): Promise<void> {
    // Destroy the sandbox first, then update state
    // This prevents inconsistent state if provider call fails
    await this.provider.destroySandbox(sandboxId)
    updateSession(sessionId, { status: 'destroyed' })
    deleteSession(sessionId)
  }
}
