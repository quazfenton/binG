import type { WorkspaceSession, SandboxConfig, ToolResult, PreviewInfo } from './types'
import { getSandboxProvider, type SandboxProvider, type SandboxHandle } from './providers'
import { saveSession, updateSession, deleteSession } from './session-store'
import { setupCacheVolumes } from './dep-cache'
import { provisionBaseImage, warmPool } from './base-image'
import { randomUUID } from 'crypto'

export class SandboxService {
  private provider: SandboxProvider
  private fallbackProvider: SandboxProvider | null
  private sandboxProviderById = new Map<string, SandboxProvider>()

  constructor() {
    this.provider = getSandboxProvider()
    this.fallbackProvider = this.getConfiguredFallbackProvider()
  }

  private getDefaultResources(): { cpu: number; memory: number } {
    const parseOrDefault = (raw: string | undefined, fallback: number) => {
      const parsed = Number.parseInt(raw ?? '', 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
    }
    return {
      cpu: parseOrDefault(process.env.SANDBOX_DEFAULT_CPU, 1),
      memory: parseOrDefault(process.env.SANDBOX_DEFAULT_MEMORY, 2),
    }
  }

  private getConfiguredFallbackProvider(): SandboxProvider | null {
    const enabled = process.env.SANDBOX_ENABLE_FALLBACK === 'true'
    if (!enabled) return null

    const fallbackType = (process.env.SANDBOX_FALLBACK_PROVIDER || 'microsandbox') as any
    try {
      const fallback = getSandboxProvider(fallbackType)
      if (fallback.name === this.provider.name) return null
      return fallback
    } catch (error) {
      console.warn(`[sandbox-service] Invalid SANDBOX_FALLBACK_PROVIDER="${fallbackType}", fallback disabled`)
      return null
    }
  }

  private async createSandboxWithProvider(
    provider: SandboxProvider,
    userId: string,
    config?: SandboxConfig
  ): Promise<SandboxHandle> {
    const handle = await provider.createSandbox({
      language: config?.language ?? 'typescript',
      autoStopInterval: config?.autoStopInterval ?? 60,
      resources: config?.resources ?? this.getDefaultResources(),
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config?.envVars,
      },
      labels: { userId },
    })

    // Cache volume / preloaded packages are best-effort and provider-dependent.
    try {
      await setupCacheVolumes(handle)
    } catch (error) {
      console.warn(`[sandbox-service] Cache volume setup skipped for provider=${provider.name}: ${(error as Error).message}`)
    }

    if (process.env.SANDBOX_PRELOAD_PACKAGES !== 'false') {
      try {
        await provisionBaseImage(handle)
      } catch (error) {
        console.warn(`[sandbox-service] Base image provisioning failed for provider=${provider.name}: ${(error as Error).message}`)
      }
    }

    this.sandboxProviderById.set(handle.id, provider)
    return handle
  }

  private async resolveProviderForSandbox(sandboxId: string): Promise<SandboxProvider> {
    const cached = this.sandboxProviderById.get(sandboxId)
    if (cached) return cached

    // Probe primary first.
    try {
      await this.provider.getSandbox(sandboxId)
      this.sandboxProviderById.set(sandboxId, this.provider)
      return this.provider
    } catch {
      // continue
    }

    if (this.fallbackProvider) {
      try {
        await this.fallbackProvider.getSandbox(sandboxId)
        this.sandboxProviderById.set(sandboxId, this.fallbackProvider)
        return this.fallbackProvider
      } catch {
        // continue
      }
    }

    throw new Error(`Sandbox ${sandboxId} not found on any configured provider`)
  }

  private async getHandle(sandboxId: string): Promise<SandboxHandle> {
    const provider = await this.resolveProviderForSandbox(sandboxId)
    return provider.getSandbox(sandboxId)
  }

  async createWorkspace(userId: string, config?: SandboxConfig): Promise<WorkspaceSession> {
    let handle: SandboxHandle

    // Only use warm pool when no custom config is specified
    // Custom configs (language, resources, env vars) require fresh sandbox
    if (process.env.SANDBOX_WARM_POOL === 'true' && !config) {
      try {
        handle = await warmPool.acquire(userId)
        this.sandboxProviderById.set(handle.id, this.provider)
      } catch (error) {
        console.warn('[sandbox-service] Warm pool unavailable; falling back to direct sandbox creation')
        try {
          handle = await this.createSandboxWithProvider(this.provider, userId, config)
        } catch (primaryError) {
          if (!this.fallbackProvider) {
            throw primaryError
          }
          console.warn(`[sandbox-service] Primary provider failed (${this.provider.name}); trying fallback provider (${this.fallbackProvider.name})`)
          handle = await this.createSandboxWithProvider(this.fallbackProvider, userId, config)
        }
      }
    } else {
      try {
        handle = await this.createSandboxWithProvider(this.provider, userId, config)
      } catch (primaryError) {
        if (!this.fallbackProvider) {
          throw primaryError
        }
        console.warn(`[sandbox-service] Primary provider failed (${this.provider.name}); trying fallback provider (${this.fallbackProvider.name})`)
        handle = await this.createSandboxWithProvider(this.fallbackProvider, userId, config)
      }
    }

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
    return this.getHandle(sandboxId)
  }

  async executeCommand(sandboxId: string, command: string, cwd?: string): Promise<ToolResult> {
    const handle = await this.getHandle(sandboxId)
    return handle.executeCommand(command, cwd)
  }

  async writeFile(sandboxId: string, filePath: string, content: string): Promise<ToolResult> {
    const handle = await this.getHandle(sandboxId)
    return handle.writeFile(filePath, content)
  }

  async readFile(sandboxId: string, filePath: string): Promise<ToolResult> {
    const handle = await this.getHandle(sandboxId)
    return handle.readFile(filePath)
  }

  async listDirectory(sandboxId: string, dirPath?: string): Promise<ToolResult> {
    const handle = await this.getHandle(sandboxId)
    return handle.listDirectory(dirPath ?? '.')
  }

  async getPreviewLink(sandboxId: string, port: number): Promise<PreviewInfo> {
    const handle = await this.getHandle(sandboxId)
    if (!handle.getPreviewLink) {
      const provider = await this.resolveProviderForSandbox(sandboxId)
      throw new Error(`Provider '${provider.name}' does not support preview links`)
    }
    return handle.getPreviewLink(port)
  }

  async destroyWorkspace(sessionId: string, sandboxId: string): Promise<void> {
    // Destroy the sandbox first, then update state
    // This prevents inconsistent state if provider call fails
    const provider = await this.resolveProviderForSandbox(sandboxId)
    await provider.destroySandbox(sandboxId)
    this.sandboxProviderById.delete(sandboxId)
    updateSession(sessionId, { status: 'destroyed' })
    deleteSession(sessionId)
  }
}
