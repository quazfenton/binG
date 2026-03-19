import type { WorkspaceSession, SandboxConfig, ToolResult, PreviewInfo } from './types'
import { getSandboxProvider, type SandboxProvider, type SandboxHandle, type SandboxProviderType } from './providers'
import { saveSession, updateSession, deleteSession } from '../storage/session-store'
import { setupCacheVolumes } from './dep-cache'
import { provisionBaseImage, warmPool } from './base-image'
import { randomUUID } from 'crypto'
import { quotaManager } from '../management/quota-manager'
import { createLogger } from '@/lib/utils/logger'

const log = createLogger('SandboxService')

export class SandboxService {
   private _provider: SandboxProvider | null = null
   private primaryProviderType: SandboxProviderType
   private sandboxProviderById = new Map<string, SandboxProvider>()

   constructor() {
     this.primaryProviderType = (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona'
     log.debug(`SandboxService initialized with primary provider: ${this.primaryProviderType}`)
   }

   private async getProvider(): Promise<SandboxProvider> {
     if (!this._provider) {
       log.debug(`Initializing primary provider: ${this.primaryProviderType}`)
       this._provider = await getSandboxProvider(this.primaryProviderType)
       log.debug(`Primary provider ${this.primaryProviderType} initialized successfully`)
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
    if (sandboxId.startsWith('mistral-agent-')) return 'mistral-agent'
    if (sandboxId.startsWith('mistral-')) return 'mistral'
    // Check specific blaxel-mcp prefix BEFORE the general blaxel- prefix
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp'
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
    log.debug(`Getting candidate provider types, primary: ${primary}`)
    const quotaChain = quotaManager.getSandboxProviderChain(primary) as SandboxProviderType[];
    const preferred = Array.from(new Set(quotaChain.length ? quotaChain : [primary]));
    const supported: SandboxProviderType[] = [];

    for (const providerType of preferred) {
      try {
        log.debug(`Checking provider availability: ${providerType}`)
        await getSandboxProvider(providerType);
        log.debug(`Provider ${providerType} is available`)
         supported.push(providerType);
      } catch (error: any) {
        log.debug(`Provider ${providerType} not available: ${error.message}`)
        // Provider not integrated in this build, skip.
      }
    }

    log.debug(`Candidate providers: ${supported.join(', ')}`)
    return supported.length ? supported : [primary];
  }

  private async createSandboxWithProvider(
    providerType: SandboxProviderType,
    userId: string,
    config?: SandboxConfig
  ): Promise<SandboxHandle> {
    log.debug(`Creating sandbox with provider ${providerType} for user ${userId}`)
    const provider = await getSandboxProvider(providerType)
    log.debug(`Provider ${providerType} instance obtained, creating sandbox...`)
    
     const handle = await provider.createSandbox({
      language: config?.language ?? 'typescript',
      resources: config?.resources ?? this.getDefaultResources(),
      // @ts-ignore - env may not be in SandboxCreateConfig type
      env: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
        ...config?.env,
      },
      labels: { userId },
    })

    log.debug(`Sandbox created successfully with ID: ${handle.id}`)

    // Cache volume / preloaded packages are best-effort and provider-dependent.
    try {
      await setupCacheVolumes(handle)
    } catch (error: any) {
      log.warn(`Cache volume setup skipped for provider=${provider.name}: ${error.message}`)
    }

    if (process.env.SANDBOX_PRELOAD_PACKAGES !== 'false') {
      try {
        await provisionBaseImage(handle)
      } catch (error: any) {
        log.warn(`Base image provisioning failed for provider=${provider.name}: ${error.message}`)
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
      'blaxel-mcp',
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
      'mistral',
      'vercel-sandbox'
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
    log.info(`Creating workspace for user ${userId}${config ? ' with custom config' : ''}`)
    let handle: SandboxHandle | null = null
    
    // P1 FIX: Honor explicit provider in config if provided
    const explicitProvider = config?.provider as SandboxProviderType | undefined;
    const preferredType = explicitProvider 
      || (quotaManager.pickAvailableSandboxProvider(this.primaryProviderType) as SandboxProviderType | null)
      || this.primaryProviderType
    log.debug(`Preferred provider type: ${preferredType}`)
    const candidateTypes = await this.getCandidateProviderTypes(preferredType)
    log.debug(`Candidate types for workspace creation: ${candidateTypes.join(', ')}`)

    // Only use warm pool when no custom config is specified
    // Custom configs (language, resources, env vars) require fresh sandbox
    if (process.env.SANDBOX_WARM_POOL === 'true' && !config && preferredType === this.primaryProviderType) {
      log.debug('Attempting to acquire sandbox from warm pool')
      try {
        handle = await warmPool.acquire(userId)
        log.info(`Acquired sandbox from warm pool: ${handle.id}`)
        this.sandboxProviderById.set(handle.id, await this.getProvider())
      } catch (error: any) {
        log.warn(`Warm pool unavailable; falling back to provider chain: ${error.message}`)
        let lastError: unknown = error
        for (const providerType of candidateTypes) {
          try {
            log.debug(`Attempting to create sandbox with provider: ${providerType}`)
            handle = await this.createSandboxWithProvider(providerType, userId, config)
            log.info(`Successfully created sandbox with provider ${providerType}: ${handle.id}`)
            lastError = null
            break
          } catch (providerError: any) {
            lastError = providerError
            const message = providerError instanceof Error ? providerError.message : String(providerError)
            log.warn(`Provider failed (${providerType}): ${message}; trying next fallback`)
          }
        }
        if (lastError) {
          log.error(`All providers failed for workspace creation`, lastError as Error)
          throw lastError
        }
      }
    } else {
      log.debug('Using direct provider chain (warm pool disabled or custom config)')
      let lastError: unknown = null
      for (const providerType of candidateTypes) {
        try {
          log.debug(`Attempting to create sandbox with provider: ${providerType}`)
          handle = await this.createSandboxWithProvider(providerType, userId, config)
          log.info(`Successfully created sandbox with provider ${providerType}: ${handle.id}`)
          lastError = null
          break
        } catch (providerError: any) {
          lastError = providerError
          const message = providerError instanceof Error ? providerError.message : String(providerError)
          log.warn(`Provider failed (${providerType}): ${message}; trying next fallback`)
        }
      }
      if (lastError) {
        log.error(`All providers failed for workspace creation`, lastError as Error)
        throw lastError
      }
    }

    if (!handle) {
      log.error('No sandbox handle obtained from any provider')
      throw new Error('Failed to create sandbox with all available providers')
    }

    // Create session object
    const session: WorkspaceSession = {
      sessionId: randomUUID(),
      sandboxId: handle.id,
      userId,
      cwd: '/workspace',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      status: 'active',
    }

    log.info(`Workspace session created: ${session.sessionId} (sandbox: ${handle.id})`)
    
    // Save session to store
    try {
      saveSession(session)
    } catch (saveError: any) {
      // If session save fails, clean up the sandbox to avoid orphaned resources
      log.error(`Failed to save session, cleaning up sandbox: ${saveError.message}`)
      try {
        const provider = await this.resolveProviderForSandbox(handle.id)
        await provider.destroySandbox(handle.id)
        this.sandboxProviderById.delete(handle.id)
      } catch (cleanupError: any) {
        log.error(`Failed to cleanup sandbox after session save failure: ${cleanupError.message}`)
      }
      throw new Error(`Failed to save session: ${saveError.message}`)
    }
    
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
    updateSession(sessionId, { status: 'closed' })
    deleteSession(sessionId)
  }
}
