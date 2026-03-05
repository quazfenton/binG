import type { WorkspaceSession, SandboxConfig, ToolResult, PreviewInfo } from './types'
import { getSandboxProvider, type SandboxProvider, type SandboxHandle, type SandboxProviderType } from './providers'
import { saveSession, updateSession, deleteSession } from './session-store'
import { setupCacheVolumes } from './dep-cache'
import { provisionBaseImage, warmPool } from './base-image'
import { randomUUID } from 'crypto'
import { quotaManager } from '../services/quota-manager'

export class SandboxService {
   private _provider: SandboxProvider | null = null
   private primaryProviderType: SandboxProviderType
   private sandboxProviderById = new Map<string, SandboxProvider>()

   constructor() {
     this.primaryProviderType = (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona'
   }

   private async getProvider(): Promise<SandboxProvider> {
     if (!this._provider) {
       this._provider = await getSandboxProvider(this.primaryProviderType)
     }
     return this._provider
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

  private inferProviderFromSandboxId(sandboxId: string): SandboxProviderType | null {
    if (sandboxId.startsWith('mistral-')) return 'mistral'
    if (sandboxId.startsWith('blaxel-')) return 'blaxel'
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites'
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox'
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer'
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem'
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn'
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter'
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent'
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox'
    return null
  }

  private async getCandidateProviderTypes(primary: SandboxProviderType): Promise<SandboxProviderType[]> {
    const quotaChain = quotaManager.getSandboxProviderChain(primary) as SandboxProviderType[];
    const preferred = Array.from(new Set(quotaChain.length ? quotaChain : [primary]));
    const supported: SandboxProviderType[] = [];

    for (const providerType of preferred) {
      try {
        await getSandboxProvider(providerType);
         supported.push(providerType);
      } catch {
        // Provider not integrated in this build, skip.
      }
    }

    return supported.length ? supported : [primary];
  }

  private async createSandboxWithProvider(
    providerType: SandboxProviderType,
    userId: string,
    config?: SandboxConfig
  ): Promise<SandboxHandle> {
    const provider = await getSandboxProvider(providerType)
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
    quotaManager.recordUsage(provider.name)
    return handle
  }

  private async resolveProviderForSandbox(sandboxId: string): Promise<SandboxProvider> {
    const cached = this.sandboxProviderById.get(sandboxId)
    if (cached) return cached

    const inferredProvider = this.inferProviderFromSandboxId(sandboxId)
    if (inferredProvider) {
      try {
        const inferred = await getSandboxProvider(inferredProvider)
        await inferred.getSandbox(sandboxId)
        this.sandboxProviderById.set(sandboxId, inferred)
        return inferred
      } catch {
        // Continue with generic probing below.
      }
    }

    // Probe primary first.
     const primaryProvider = await this.getProvider()
     try {
       await primaryProvider.getSandbox(sandboxId)
       this.sandboxProviderById.set(sandboxId, primaryProvider)
       return primaryProvider
     } catch {
      // continue
    }

    // For resolving existing sandboxes, try ALL configured providers (not just quota-available ones)
    // Sandboxes created before quota was hit should remain accessible even if provider is now over quota
    const allProviderTypes: SandboxProviderType[] = [
      'daytona',
      'runloop',
      'blaxel',
      'sprites',
      'codesandbox',
      'webcontainer',
      'webcontainer-filesystem',
      'webcontainer-spawn',
      'opensandbox',
      'opensandbox-code-interpreter',
      'opensandbox-agent',
      'microsandbox',
      'e2b',
      'mistral'
    ]
    const configuredProviders: SandboxProviderType[] = []
    
    for (const providerType of allProviderTypes) {
      try {
        await getSandboxProvider(providerType)
         configuredProviders.push(providerType)
      } catch {
        // Provider not configured in this build, skip
      }
    }

    // Try all configured providers (excluding primary which we already tried)
    for (const fallbackType of configuredProviders.filter(t => t !== this.primaryProviderType)) {
      try {
        const fallback = await getSandboxProvider(fallbackType)
        await fallback.getSandbox(sandboxId)
        this.sandboxProviderById.set(sandboxId, fallback)
        return fallback
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
    let handle: SandboxHandle | null = null
    const preferredType = (quotaManager.pickAvailableSandboxProvider(this.primaryProviderType) as SandboxProviderType | null)
      || this.primaryProviderType
    const candidateTypes = await this.getCandidateProviderTypes(preferredType)

    // Only use warm pool when no custom config is specified
    // Custom configs (language, resources, env vars) require fresh sandbox
    if (process.env.SANDBOX_WARM_POOL === 'true' && !config && preferredType === this.primaryProviderType) {
      try {
        handle = await warmPool.acquire(userId)
        this.sandboxProviderById.set(handle.id, await this.getProvider())
      } catch (error) {
        console.warn('[sandbox-service] Warm pool unavailable; falling back to provider chain')
        let lastError: unknown = error
        for (const providerType of candidateTypes) {
          try {
            handle = await this.createSandboxWithProvider(providerType, userId, config)
            lastError = null
            break
          } catch (providerError) {
            lastError = providerError
            const message = providerError instanceof Error ? providerError.message : String(providerError)
            console.warn(`[sandbox-service] Provider failed (${providerType}): ${message}; trying next fallback`)
          }
        }
        if (lastError) throw lastError
      }
    } else {
      let lastError: unknown = null
      for (const providerType of candidateTypes) {
        try {
          handle = await this.createSandboxWithProvider(providerType, userId, config)
          lastError = null
          break
        } catch (providerError) {
          lastError = providerError
          const message = providerError instanceof Error ? providerError.message : String(providerError)
          console.warn(`[sandbox-service] Provider failed (${providerType}): ${message}; trying next fallback`)
        }
      }
      if (lastError) throw lastError
    }

    if (!handle) {
      throw new Error('Failed to create sandbox with all available providers')
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
