import type { WorkspaceSession, SandboxConfig, ToolResult, PreviewInfo } from './types'
import { getSandboxProvider, type SandboxProvider, type SandboxHandle, type SandboxProviderType } from './providers'
import { saveSession, updateSession, deleteSession } from '../storage/session-store'
import { setupCacheVolumes } from './dep-cache'
import { provisionBaseImage, warmPool } from './base-image'
import { workspaceImageBuilder } from './workspace-image-builder'
import { notifySandboxRequested } from './predictive-prewarmer'
import { randomUUID } from 'crypto'
import { quotaManager } from '../management/quota-manager'
import { createLogger } from '@/lib/utils/logger'
import { withRetryAndTimeout } from '@/lib/utils/retry'
import { isDesktopMode } from '@bing/platform/env'
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync'
import { autoSuspendService } from './auto-suspend-service'
import { recordFailureBreaker, getBreakerCooldownUntil } from '@/lib/utils/circuit-breaker';

const log = createLogger('SandboxService')

// Create singleton instance for code-executor compatibility
export const coreSandboxService = {
  createSandbox: async (config: { language: string; timeout: number; env?: Record<string, string> }) => {
    const service = new SandboxService()
    const workspace = await service.createWorkspace('temp-user', { language: config.language, env: config.env })
    return {
      id: workspace.sandboxId,
      executeCommand: async (cmd: string) => {
        return service.executeCommand(workspace.sandboxId, cmd)
      },
    }
  },
  writeFile: async (sandboxId: string, filePath: string, content: string) => {
    const service = new SandboxService()
    return service.writeFile(sandboxId, filePath, content)
  },
  executeCommand: async (sandboxId: string, command: string, opts?: { timeout?: number }) => {
    const service = new SandboxService()
    return service.executeCommand(sandboxId, command)
  },
  destroySandbox: async (sandboxId: string) => {
    const service = new SandboxService()
    try {
      const provider = await service['resolveProviderForSandbox'](sandboxId)
      await provider.destroySandbox(sandboxId)
      service['sandboxProviderById'].delete(sandboxId)
      warmPool.release(sandboxId)
      log.info(`Sandbox destroyed via singleton: ${sandboxId}`)
      return { success: true }
    } catch (error: any) {
      log.error(`Failed to destroy sandbox via singleton: ${error.message}`)
      return { success: false, error: error.message }
    }
  },
}

export class SandboxService {
   private _provider: SandboxProvider | null = null
   private primaryProviderType: SandboxProviderType
   private sandboxProviderById = new Map<string, SandboxProvider>()

   constructor() {
      // In desktop mode, default to the desktop provider
      this.primaryProviderType = isDesktopMode()
        ? 'desktop'
        : (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona';
      log.debug(`SandboxService initialized with primary provider: ${this.primaryProviderType}`);
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
    // Explicit prefix matches (highest priority)
    if (sandboxId.startsWith('firecracker-')) return 'firecracker'
    if (sandboxId.startsWith('daytona-')) return 'daytona'
    if (sandboxId.startsWith('runloop-')) return 'runloop'
    if (sandboxId.startsWith('desktop-')) return 'desktop'
    if (sandboxId.startsWith('agentfs-')) return 'agentfs'
    if (sandboxId.startsWith('modal-')) return 'modal'
    if (sandboxId.startsWith('mistral-agent-')) return 'mistral-agent'
    // Check specific blaxel-mcp prefix BEFORE the general blaxel- prefix
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp'
    if (sandboxId.startsWith('blaxel-')) return 'blaxel'
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites'
    if (sandboxId.startsWith('csb-')) return 'codesandbox'
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer'
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem'
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn'
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter'
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent'
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox'
    if (sandboxId.startsWith('microsandbox-') || sandboxId.startsWith('micro-')) return 'microsandbox'
    // LocalSandboxHandle fallback (no container — skip VFS sync)
    if (sandboxId.startsWith('local-')) return 'microsandbox'
    // Pattern-based detection (lower priority)
    // E2B: 18-25 char alphanumeric (no hyphens)
    if (/^[a-z0-9]{18,25}$/i.test(sandboxId)) return 'e2b'
    // CodeSandbox: exactly 6-char alphanumeric
    if (/^[a-z0-9]{6}$/i.test(sandboxId)) return 'codesandbox'
    // Blaxel/Runloop/Mistral: short codes (5-7 chars)
    if (/^[a-z0-9]{5,7}$/i.test(sandboxId)) return 'blaxel'
    // UUID format (Daytona)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sandboxId)) return 'daytona'
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

    // EDGE CASE FIX: Enforce timeout on sandbox creation via the shared retry utility.
    // Replaces hand-rolled Promise.race with withRetryAndTimeout which provides
    // per-attempt timeout, exponential backoff, and jitter out of the box.
    // On transient provider failures (e.g. timeout), one automatic retry with
    // a brief backoff improves resilience without adding user-visible latency.
    const rawTimeout = process.env.SANDBOX_CREATION_TIMEOUT_MS || '300000';
    const creationTimeoutMs = (() => {
      const parsed = parseInt(rawTimeout, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
    })();

    let handle: SandboxHandle | null = null;
    try {
      handle = await withRetryAndTimeout(
        () =>
          provider.createSandbox({
            language: config?.language ?? 'typescript',
            resources: config?.resources ?? this.getDefaultResources(),
            envVars: {
              TERM: 'xterm-256color',
              LANG: 'en_US.UTF-8',
              ...config?.env,
            },
            labels: { userId },
          }),
        creationTimeoutMs,
        {
          maxRetries: 1,
          baseDelayMs: 5000,
          jitter: true,
          name: `sandbox-create:${providerType}`,
        },
      );

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

      // Register provider and track sandbox with auto-suspend service so idle
      // sandboxes are proactively destroyed (or suspended if the provider supports
      // it). Without this registration, Daytona and other providers that lack a
      // suspend method would pile up concurrent sandboxes until the account limit
      // is reached.
      try {
        autoSuspendService.registerProvider(provider.name, provider as any)
        autoSuspendService.trackActivity(handle.id)
      } catch (err: any) {
        log.warn('autoSuspendService registration failed (sandbox may not be suspended when idle)', {
          provider: provider.name,
          sandboxId: handle.id,
          error: err?.message || String(err),
        });
      }

      // Start VFS sync for bidirectional file sync between VFS database and sandbox
      try {
        sandboxFilesystemSync.startSync(handle.id, userId);
        log.debug('VFS sync started for sandbox', { sandboxId: handle.id, userId });
      } catch (syncErr: any) {
        log.warn('Failed to start VFS sync for sandbox:', syncErr.message);
      }          // Phase 7 (Production): Workspace image synthesis for instant warm starts.
          // After base image provisioning + VFS sync, check for dependency files
          // and restore or build a cached workspace image.
          //
          // RESTORE PATH: Synchronous and blocking — when a matching image is found
          // in the registry (checkpoint available), we restore it before returning
          // the sandbox. This gives the user an instant warm start with all deps
          // pre-installed. The operation is near-instant (checkpoint restore).
          //
          // BUILD PATH: Background (fire-and-forget) — when no matching image exists,
          // installs run in the background since they take 30-300 seconds. The sandbox
          // is usable while installs proceed, albeit without the warm-start benefit.
          try {
            const workspaceDir = handle.workspaceDir || '/tmp';
            const image = await workspaceImageBuilder.ensureImage(handle, workspaceDir);
            if (image) {
              log.info('Workspace image ready', {
                sandboxId: handle.id,
                hash: image.hash.slice(0, 12),
                tools: image.tools,
                restoredFromCache: image.useCount > 1,
              });
            }
          } catch (imgErr: any) {
            log.warn('Workspace image synthesis failed or skipped', {
              sandboxId: handle.id,
              error: imgErr.message,
            });
          }


      return handle
    } catch (error: any) {
      // EDGE CASE FIX: Clean up sandbox on any failure after creation
      // If handle was created but later steps (cache, image, sync) failed,
      // destroy the sandbox to prevent orphaned resources.
      if (handle) {
        log.warn(
          `Cleaning up sandbox ${handle.id} after creation failure: ${error.message}`,
        );
        try {
          await provider.destroySandbox(handle.id)
          this.sandboxProviderById.delete(handle.id)
          warmPool.release(handle.id)
        } catch (cleanupErr: any) {
          log.error(
            `Failed to cleanup sandbox ${handle.id}: ${cleanupErr.message}`,
          );
        }
      }
      throw error
    }
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

    // Bug #87 follow-up (Pass-6) — pre-check the circuit breaker BEFORE
    // the primary provider probe. If the breaker is tripped, every
    // provider in the fallback chain has been failing and we should
    // back off rather than pay the cost of another failed round trip
    // against the primary (which is typically the same provider class
    // that just tripped the breaker).
    //
    // Placement (Pass-6 review fix #1): the pre-check is intentionally
    // placed AFTER the inferred-provider probe (prefix-match fast path)
    // and AFTER the cache hit, but BEFORE the primary probe. This way:
    //   - cache hit: no breaker check needed (we already have a working
    //     provider).
    //   - inferred provider: preserved as a fast path. If a user has an
    //     existing sandbox on a non-primary provider (firecracker,
    //     modal, mistral, etc.) inferred from its ID prefix, we can
    //     still resolve it even when the primary's breaker is open.
    //   - primary probe: guarded (this is the fix the user asked for).
    //   - fallback chain: guarded by a per-provider pre-check inside the
    //     loop (see below) so a daytona trip doesn't short-circuit
    //     nullclaw/opensandbox/local-pty.
    //
    // Per-provider breaker key (Pass-6 follow-up): the key is now
    // `sandbox:${providerType}` instead of a single global `'sandbox'`.
    // A daytona limit trip only short-circuits daytona, not the rest
    // of the fallback chain. This matches the per-sandbox pattern in
    // `sandbox-filesystem-sync.ts`.
    const primaryBreakerKey = `sandbox:${this.primaryProviderType}`
    const primaryBreakerCooldown = getBreakerCooldownUntil(primaryBreakerKey)
    if (primaryBreakerCooldown > Date.now()) {
      const remainingMs = primaryBreakerCooldown - Date.now()
      log.warn(`[SandboxService] ${primaryBreakerKey} circuit breaker is open, short-circuiting primary probe`, {
        remainingMs,
        primaryProvider: this.primaryProviderType,
      })
      throw new Error(`Sandbox circuit breaker is open for ${Math.ceil(remainingMs / 1000)}s`)
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
      'desktop',
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
      'mistral-agent',
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

    // Try all configured providers (excluding primary which we already tried).
    //
    // Pass-6 follow-up: the breaker pre-check is now wired INTO this loop
    // (before the per-provider try block) so a tripped provider's
    // `getSandbox` call is skipped entirely — we don't pay the cost of a
    // doomed attempt, we just `continue` to the next provider. Combined
    // with the per-provider breaker key (`sandbox:${fallbackType}`), a
    // daytona limit trip only skips daytona in this loop, not the rest
    // of the chain.
    for (const fallbackType of configuredProviders.filter(t => t !== this.primaryProviderType)) {
      // Pre-check the per-provider breaker BEFORE the try block. If this
      // specific provider's breaker is open, skip it without attempting
      // the round trip (avoids the cost of a doomed attempt).
      const fallbackBreakerKey = `sandbox:${fallbackType}`
      const fallbackBreakerCooldown = getBreakerCooldownUntil(fallbackBreakerKey)
      if (fallbackBreakerCooldown > Date.now()) {
        log.debug(`[SandboxService] ${fallbackBreakerKey} circuit breaker is open, skipping this fallback provider`, {
          remainingMs: fallbackBreakerCooldown - Date.now(),
          sandboxId,
        })
        // continue to next provider
        continue
      }
      try {
        const fallback = await getSandboxProvider(fallbackType)
        await fallback.getSandbox(sandboxId)
        this.sandboxProviderById.set(sandboxId, fallback)
        return fallback
      } catch (fallbackErr: any) {
        // Bug #87 (Pass-6) — when a provider throws a tagged SANDBOX_LIMIT_EXCEEDED
        // error, log the limitType + provider so the operator can see which
        // provider hit which limit (disk / count / quota / unknown), then
        // continue to the next provider in the chain (nullclaw → opensandbox
        // → local-pty). The fallback chain naturally continues via `continue`.
        if (
          fallbackErr?.code === 'SANDBOX_LIMIT_EXCEEDED' ||
          (typeof fallbackErr?.message === 'string' && fallbackErr.message.includes('SANDBOX_LIMIT_EXCEEDED'))
        ) {
          log.warn(
            `[Sandbox] ${fallbackType} hit SANDBOX_LIMIT_EXCEEDED ` +
            `(limitType=${fallbackErr?.limitType ?? 'unknown'}) — falling through`,
            { sandboxId, provider: fallbackType, limitType: fallbackErr?.limitType },
          );
        // Bug #87 follow-up (Pass-6) — trip THIS provider's circuit breaker
        // so the next call skips it. 60s cooldown matches the
        // arcade-service (#88) convention. Per-provider key means a
        // daytona trip only short-circuits daytona, not the rest of the
        // chain.
        recordFailureBreaker(fallbackBreakerKey, 60_000)
        }
        // continue to next provider
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

    // Bug #87 follow-up (Pass-7) — pre-check the PRIMARY provider's circuit
    // breaker BEFORE attempting to create a new sandbox. The breaker trips
    // when existing-sandbox resolution has been failing repeatedly (see
    // the `recordFailureBreaker(`sandbox:${fallbackType}`, 60_000)` calls
    // in `resolveProviderForSandbox`). Without this pre-check, a tripped
    // primary breaker would still allow new sandboxes to be created, which
    // can re-trip the breaker on the very first call.
    //
    // Per-provider breaker key (Pass-6 follow-up): the key is now
    // `sandbox:${this.primaryProviderType}` instead of a single global
    // `'sandbox'`. A daytona limit trip only short-circuits daytona, not
    // the rest of the candidate list. The warm-pool acquire path is also
    // short-circuited (the warm pool is itself the primary provider's
    // backend that would fail in the same conditions). Per-provider
    // pre-checks inside the direct-chain loop below handle the fallback
    // providers.
    const primaryBreakerKey = `sandbox:${this.primaryProviderType}`
    const sandboxBreakerCooldown = getBreakerCooldownUntil(primaryBreakerKey)
    if (sandboxBreakerCooldown > Date.now()) {
      const remainingMs = sandboxBreakerCooldown - Date.now()
      log.warn(`[SandboxService] ${primaryBreakerKey} circuit breaker is open, short-circuiting createWorkspace`, {
        remainingMs,
        primaryProvider: this.primaryProviderType,
        userId,
      })
      throw new Error(`Sandbox circuit breaker is open for ${Math.ceil(remainingMs / 1000)}s`)
    }

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
    // Disable warm pool for desktop provider to avoid provider mismatch
    const useWarmPool = process.env.SANDBOX_WARM_POOL === 'true'
      && !config
      && preferredType === this.primaryProviderType
      && this.primaryProviderType !== 'desktop';
    if (useWarmPool) {
      log.debug('Attempting to acquire sandbox from warm pool')
      try {
        handle = await warmPool.acquire(userId)
        log.info(`Acquired sandbox from warm pool: ${handle.id}`)
        this.sandboxProviderById.set(handle.id, await this.getProvider())
      } catch (error: any) {
        log.warn(`Warm pool unavailable; falling back to provider chain: ${error.message}`)
        let lastError: unknown = error
        let lastFailedType: SandboxProviderType | null = null
        const providerErrors: Array<{ provider: SandboxProviderType; error: string }> = []
        for (const providerType of candidateTypes) {
          // Pre-check the per-provider breaker BEFORE the try block. If
          // this specific provider's breaker is open, skip it without
          // attempting the round trip.
          const providerBreakerKey = `sandbox:${providerType}`
          const providerBreakerCooldown = getBreakerCooldownUntil(providerBreakerKey)
          if (providerBreakerCooldown > Date.now()) {
            log.debug(`[SandboxService] ${providerBreakerKey} circuit breaker is open, skipping this provider`, {
              remainingMs: providerBreakerCooldown - Date.now(),
              userId,
            })
            // continue to next provider
            continue
          }
          try {
            log.debug(`Attempting to create sandbox with provider: ${providerType}`)
            handle = await this.createSandboxWithProvider(providerType, userId, config)
            log.info(`Successfully created sandbox with provider ${providerType}: ${handle.id}`)
            lastError = null
            break
          } catch (providerError: any) {
            lastError = providerError
            lastFailedType = providerType
            const message = providerError instanceof Error ? providerError.message : String(providerError)
            providerErrors.push({ provider: providerType, error: message })
            log.warn(`Provider failed (${providerType}): ${message}; trying next fallback`)
          }
        }
        if (lastError) {
          const summary = providerErrors.map(e => `${e.provider}: ${e.error}`).join('; ')
          log.error(`All providers failed for workspace creation: ${summary}`, lastError as Error)
          // Bug #87 follow-up (Pass-7) — trip the LAST failed provider's
          // circuit breaker so the next call (resolve OR create)
          // short-circuits just that provider, not the whole chain.
          // 60s cooldown matches the existing
          // `resolveProviderForSandbox` breaker trip and the
          // arcade-service (#88) convention.
          if (lastFailedType) {
            recordFailureBreaker(`sandbox:${lastFailedType}`, 60_000)
          }
          const aggregated = new Error(`All sandbox providers failed: ${summary}`)
          throw aggregated
        }
      }
    } else {
      log.debug('Using direct provider chain (warm pool disabled or custom config)')
      let lastError: unknown = null
      let lastFailedType: SandboxProviderType | null = null
      const providerErrors: Array<{ provider: SandboxProviderType; error: string }> = []
      for (const providerType of candidateTypes) {
        // Pre-check the per-provider breaker BEFORE the try block. If
        // this specific provider's breaker is open, skip it without
        // attempting the round trip.
        const providerBreakerKey = `sandbox:${providerType}`
        const providerBreakerCooldown = getBreakerCooldownUntil(providerBreakerKey)
        if (providerBreakerCooldown > Date.now()) {
          log.debug(`[SandboxService] ${providerBreakerKey} circuit breaker is open, skipping this provider`, {
            remainingMs: providerBreakerCooldown - Date.now(),
            userId,
          })
          // continue to next provider
          continue
        }
        try {
          log.debug(`Attempting to create sandbox with provider: ${providerType}`)
          handle = await this.createSandboxWithProvider(providerType, userId, config)
          log.info(`Successfully created sandbox with provider ${providerType}: ${handle.id}`)
          lastError = null
          break
        } catch (providerError: any) {
          lastError = providerError
          lastFailedType = providerType
          const message = providerError instanceof Error ? providerError.message : String(providerError)
          providerErrors.push({ provider: providerType, error: message })
          log.warn(`Provider failed (${providerType}): ${message}; trying next fallback`)
        }
      }
      if (lastError) {
        const summary = providerErrors.map(e => `${e.provider}: ${e.error}`).join('; ')
        log.error(`All providers failed for workspace creation: ${summary}`, lastError as Error)
        // Bug #87 follow-up (Pass-7) — trip the LAST failed provider's
        // circuit breaker so the next call (resolve OR create)
        // short-circuits just that provider, not the whole chain.
        // 60s cooldown matches the existing
        // `resolveProviderForSandbox` breaker trip and the
        // arcade-service (#88) convention.
        if (lastFailedType) {
          recordFailureBreaker(`sandbox:${lastFailedType}`, 60_000)
        }
        const aggregated = new Error(`All sandbox providers failed: ${summary}`)
        throw aggregated
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
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      status: 'active',
    }

    log.info(`Workspace session created: ${session.sessionId} (sandbox: ${handle.id})`)
    
    // FIX: Notify the prewarmer that a sandbox has been requested, enabling
    // predictive prewarming for subsequent sessions.
    try {
      notifySandboxRequested();
    } catch { /* non-critical */ }
    
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
        warmPool.release(handle.id)
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

  async executeCommand(sandboxId: string, command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const handle = await this.getHandle(sandboxId)
    return handle.executeCommand(command, cwd, timeout)
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
    warmPool.release(sandboxId)
    updateSession(sessionId, { status: 'closed' })
    deleteSession(sessionId)
  }
}
