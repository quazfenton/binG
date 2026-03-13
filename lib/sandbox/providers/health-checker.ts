/**
 * Provider Health Checker
 * 
 * Periodically checks health of all sandbox providers
 * Implements circuit breaker pattern for unhealthy providers
 * 
 * @example
 * ```typescript
 * // Start health checking
 * providerHealthChecker.start()
 * 
 * // Get health status
 * const health = await providerHealthChecker.getHealthStatus()
 * ```
 */

import { EventEmitter } from 'node:events'
import type { SandboxProviderType } from './index'
import { getSandboxProvider } from './index'
import { sandboxMetrics } from '@/lib/backend/metrics'

export interface ProviderHealthStatus {
  provider: SandboxProviderType
  healthy: boolean
  latency?: number
  lastCheck: Date
  lastError?: string
  consecutiveFailures: number
}

export interface HealthCheckerConfig {
  /** Interval between health checks in milliseconds */
  checkInterval: number
  /** Number of consecutive failures before marking provider unhealthy */
  failureThreshold: number
  /** Timeout for health check in milliseconds */
  checkTimeout: number
}

const DEFAULT_CONFIG: HealthCheckerConfig = {
  checkInterval: 30000, // 30 seconds
  failureThreshold: 3,
  checkTimeout: 10000, // 10 seconds
}

export class ProviderHealthChecker extends EventEmitter {
  private config: HealthCheckerConfig
  private healthStatus: Map<SandboxProviderType, ProviderHealthStatus> = new Map()
  private checkInterval?: NodeJS.Timeout
  private running = false
  private enabledProviders: Set<SandboxProviderType> = new Set()

  constructor(config: Partial<HealthCheckerConfig> = {}) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start periodic health checking
   */
  start(): void {
    if (this.running) {
      console.log('[ProviderHealthChecker] Already running')
      return
    }

    this.running = true
    console.log(
      `[ProviderHealthChecker] Starting with ${this.config.checkInterval / 1000}s interval`
    )

    // Run initial health check immediately
    this.runHealthCheck()

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.runHealthCheck()
    }, this.config.checkInterval)

    // Don't prevent Node.js from exiting
    if (this.checkInterval.unref) {
      this.checkInterval.unref()
    }
  }

  /**
   * Stop periodic health checking
   */
  stop(): void {
    this.running = false

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
    }

    console.log('[ProviderHealthChecker] Stopped')
  }

  /**
   * Enable health checking for specific providers
   */
  setEnabledProviders(providers: SandboxProviderType[]): void {
    this.enabledProviders = new Set(providers)
  }

  /**
   * Run health check on all providers
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.running) return

    const providers = Array.from(this.enabledProviders)
    const checkPromises = providers.map(provider => this.checkProviderHealth(provider))

    await Promise.allSettled(checkPromises)

    // Emit health status update
    this.emit('healthCheckComplete', this.getHealthSummary())
  }

  /**
   * Check health of a single provider
   */
  private async checkProviderHealth(provider: SandboxProviderType): Promise<void> {
    const startTime = Date.now()
    let latency: number | undefined
    let healthy = false
    let lastError: string | undefined

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.config.checkTimeout)
      })

      // Get provider and run health check
      const healthCheckPromise = (async () => {
        const providerInstance = await getSandboxProvider(provider)
        
        if ('healthCheck' in providerInstance && typeof providerInstance.healthCheck === 'function') {
          const result = await providerInstance.healthCheck()
          return result
        }

        // Fallback: try to get provider as basic health check
        return { healthy: true, latency: 0 }
      })()

      const result = await Promise.race([healthCheckPromise, timeoutPromise])
      
      healthy = result.healthy !== false
      latency = result.latency || Date.now() - startTime

    } catch (error: any) {
      healthy = false
      lastError = error.message
      console.error(
        `[ProviderHealthChecker] ${provider} health check failed:`,
        error.message
      )
    }

    const duration = Date.now() - startTime

    // Update health status
    const existing = this.healthStatus.get(provider)
    const consecutiveFailures = healthy
      ? 0
      : (existing?.consecutiveFailures || 0) + 1

    const status: ProviderHealthStatus = {
      provider,
      healthy,
      latency,
      lastCheck: new Date(),
      lastError,
      consecutiveFailures,
    }

    this.healthStatus.set(provider, status)

    // Emit individual provider health update
    this.emit('providerHealthUpdate', status)

    // Update metrics
    sandboxMetrics.providerHealthCheckTotal.inc({
      provider,
      status: healthy ? 'success' : 'failure',
    })

    if (latency) {
      sandboxMetrics.providerHealthCheckDuration.observe(
        { provider },
        latency / 1000
      )
    }

    // Log state changes
    if (existing && existing.healthy !== healthy) {
      const state = healthy ? 'HEALTHY' : 'UNHEALTHY'
      console.log(`[ProviderHealthChecker] ${provider} is now ${state}`)
      
      this.emit('providerStateChange', {
        provider,
        from: existing.healthy ? 'healthy' : 'unhealthy',
        to: healthy ? 'healthy' : 'unhealthy',
        consecutiveFailures,
      })
    }
  }

  /**
   * Get health status for all providers
   */
  getHealthStatus(): Map<SandboxProviderType, ProviderHealthStatus> {
    return new Map(this.healthStatus)
  }

  /**
   * Get health status for a specific provider
   */
  getProviderHealth(provider: SandboxProviderType): ProviderHealthStatus | undefined {
    return this.healthStatus.get(provider)
  }

  /**
   * Check if a provider is healthy
   */
  isHealthy(provider: SandboxProviderType): boolean {
    const status = this.healthStatus.get(provider)
    if (!status) return true // Assume healthy if no data yet
    
    return status.healthy && status.consecutiveFailures < this.config.failureThreshold
  }

  /**
   * Get summary of health status
   */
  getHealthSummary(): {
    total: number
    healthy: number
    unhealthy: number
    unknown: number
    providers: ProviderHealthStatus[]
  } {
    const providers = Array.from(this.healthStatus.values())
    const healthy = providers.filter(p => p.healthy).length
    const unhealthy = providers.filter(p => !p.healthy).length
    const unknown = providers.filter(p => !p.lastCheck).length

    return {
      total: providers.length,
      healthy,
      unhealthy,
      unknown,
      providers,
    }
  }

  /**
   * Reset health status for a provider
   */
  resetProvider(provider: SandboxProviderType): void {
    this.healthStatus.delete(provider)
    console.log(`[ProviderHealthChecker] Reset health status for ${provider}`)
  }

  /**
   * Get unhealthy providers
   */
  getUnhealthyProviders(): SandboxProviderType[] {
    return Array.from(this.healthStatus.entries())
      .filter(([_, status]) => !status.healthy)
      .map(([provider]) => provider)
  }

  /**
   * Get healthy providers
   */
  getHealthyProviders(): SandboxProviderType[] {
    return Array.from(this.healthStatus.entries())
      .filter(([_, status]) => status.healthy)
      .map(([provider]) => provider)
  }
}

// Singleton instance
export const providerHealthChecker = new ProviderHealthChecker()

/**
 * Start health checking with default configuration
 */
export async function startProviderHealthCheck(config?: Partial<HealthCheckerConfig>): Promise<ProviderHealthChecker> {
  // Get all enabled providers from the registry
  const { getEnabledProviders } = await import('./index');
  const enabledProviders = getEnabledProviders();
  providerHealthChecker.setEnabledProviders(enabledProviders);
  
  providerHealthChecker.start()
  if (config) {
    providerHealthChecker.config = { ...DEFAULT_CONFIG, ...config }
  }
  return providerHealthChecker
}

/**
 * Stop health checking
 */
export function stopProviderHealthCheck(): void {
  providerHealthChecker.stop()
}
