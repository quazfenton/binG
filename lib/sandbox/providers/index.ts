/**
 * Sandbox Providers Index
 *
 * Central registry for all sandbox providers.
 * Add new providers here and the SandboxProviderType union.
 */

import type { SandboxProvider } from './sandbox-provider'
import { MicrosandboxProvider } from '../local/microsandbox-provider'
import { BlaxelProvider } from './blaxel-provider'
import { SpritesProvider } from './sprites-provider'
import { CodeSandboxProvider } from './codesandbox-provider'
import { E2BProvider } from './e2b-provider'
import { DaytonaProvider } from './daytona-provider'
import { RunloopProvider } from './runloop-provider'
import { E2BDesktopProvider, desktopSessionManager, type DesktopSandboxHandle as DesktopHandle } from '../../computer/e2b-desktop-provider-enhanced'
import { CircuitBreaker, providerCircuitBreakers, createCircuitBreakerWithMetrics } from '@/lib/utils/circuit-breaker'
import { sandboxMetrics } from '@/lib/backend/metrics'
import { createLogger } from '@/lib/utils/logger'

const log = createLogger('SandboxProviders')

/**
 * Union type for all supported sandbox providers.
 * Add new provider keys here when registering new providers.
 */
export type SandboxProviderType =
  | 'daytona'
  | 'e2b'
  | 'runloop'
  | 'microsandbox'
  | 'blaxel'
  | 'blaxel-mcp'
  | 'sprites'
  | 'codesandbox'
  | 'webcontainer'
  | 'webcontainer-filesystem'
  | 'webcontainer-spawn'
  | 'opensandbox'
  | 'opensandbox-code-interpreter'
  | 'opensandbox-agent'
  | 'opensandbox-nullclaw'
  | 'mistral-agent'
  | 'mistral'
  | 'vercel-sandbox'
  | 'oracle-vm'

// Provider registry
interface ProviderEntry {
  provider: SandboxProvider | null
  priority: number
  enabled: boolean
  available: boolean
  healthy: boolean
  initializing: boolean
  initPromise: Promise<SandboxProvider> | null
  failureCount: number
  circuitBreaker?: CircuitBreaker
  factory?: () => SandboxProvider
  asyncFactory?: () => Promise<SandboxProvider>
}

const providerRegistry = new Map<SandboxProviderType, ProviderEntry>()

function initializeRegistry() {
  // Register providers with priority (lower = higher priority in fallback chain)
  // Use async factory functions for lazy initialization to avoid SDK import errors in tests

  providerRegistry.set('daytona', {
    provider: null as any as any,
    priority: 1,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { DaytonaProvider } = await import('./daytona-provider')
      return new DaytonaProvider()
    },
  })

  providerRegistry.set('e2b', {
    provider: null as any as any,
    priority: 2,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { E2BProvider } = await import('./e2b-provider')
      return new E2BProvider()
    },
  })

  providerRegistry.set('runloop', {
    provider: null as any as any,
    priority: 3,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { RunloopProvider } = await import('./runloop-provider')
      return new RunloopProvider()
    },
  })

  providerRegistry.set('microsandbox', {
    provider: null as any as any,
    priority: 4,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { MicrosandboxProvider } = await import('../local/microsandbox-provider')
      return new MicrosandboxProvider()
    },
  })

  providerRegistry.set('blaxel', {
    provider: null as any as any,
    priority: 5,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { BlaxelProvider } = await import('./blaxel-provider')
      return new BlaxelProvider()
    },
  })

  // Blaxel MCP mode - uses blaxel-mcp-server for tool-based access
  providerRegistry.set('blaxel-mcp', {
    provider: null as any as any,
    priority: 5,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    // Note: BlaxelMcpServer requires a sandboxHandle argument, so it cannot be initialized as a singleton provider
    // Use createBlaxelMcpServer() function directly with a sandbox handle instead
    // However, we need a provider factory for getSandboxProvider('blaxel-mcp') to work
    asyncFactory: async () => {
      const { BlaxelProvider } = await import('./blaxel-provider')
      return new BlaxelProvider()
    },
  })

  providerRegistry.set('sprites', {
    provider: null as any as any,
    priority: 6,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { SpritesProvider } = await import('./sprites-provider')
      return new SpritesProvider()
    },
  })

  providerRegistry.set('codesandbox', {
    provider: null as any as any,
    priority: 7,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { CodeSandboxProvider } = await import('./codesandbox-provider')
      return new CodeSandboxProvider()
    },
  })

  providerRegistry.set('webcontainer', {
    provider: null as any as any,
    priority: 8,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { WebContainerProvider } = await import('./webcontainer-provider')
      return new WebContainerProvider()
    },
  })

  providerRegistry.set('webcontainer-filesystem', {
    provider: null as any as any,
    priority: 8,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { WebContainerFileSystemProvider } = await import('./webcontainer-filesystem-provider')
      return new WebContainerFileSystemProvider()
    },
  })

  providerRegistry.set('webcontainer-spawn', {
    provider: null as any as any,
    priority: 8,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { WebContainerSpawnProvider } = await import('./webcontainer-spawn-provider')
      return new WebContainerSpawnProvider()
    },
  })

  providerRegistry.set('opensandbox', {
    provider: null as any as any,
    priority: 9,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { OpenSandboxProvider } = await import('./opensandbox-provider')
      return new OpenSandboxProvider()
    },
  })

  providerRegistry.set('opensandbox-code-interpreter', {
    provider: null as any as any,
    priority: 9,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { OpenSandboxCodeInterpreterProvider } = await import('./opensandbox-code-interpreter-provider')
      return new OpenSandboxCodeInterpreterProvider()
    },
  })

  providerRegistry.set('opensandbox-agent', {
    provider: null as any as any,
    priority: 9,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { OpenSandboxAgentSandboxProvider } = await import('./opensandbox-agent-sandbox-provider')
      return new OpenSandboxAgentSandboxProvider()
    },
  })

  providerRegistry.set('opensandbox-nullclaw', {
    provider: null as any as any,
    priority: 9,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { OpenSandboxNullclawProvider } = await import('./opensandbox-nullclaw-provider')
      return new OpenSandboxNullclawProvider()
    },
  })

  // Mistral Agent provider (lazy initialization)
  providerRegistry.set('mistral-agent', {
    provider: null as any as any,
    priority: 3,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { MistralAgentProvider } = await import('./mistral/mistral-agent-provider')
      return new MistralAgentProvider()
    },
  })

  // Legacy Mistral code interpreter
  providerRegistry.set('mistral', {
    provider: null as any as any,
    priority: 3,
    enabled: false, // Disabled by default, use mistral-agent instead
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      // Lazy import to avoid circular dependencies
      const { MistralCodeInterpreterProvider } = await import('./mistral-code-interpreter-provider')
      return new MistralCodeInterpreterProvider()
    },
  })

  // Vercel Sandbox - Isolated Linux VMs with snapshot support
  providerRegistry.set('vercel-sandbox', {
    provider: null as any as any,
    priority: 8,
    enabled: true,
    available: false,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { VercelSandboxProvider } = await import('./vercel-sandbox-provider')
      return new VercelSandboxProvider()
    },
  })

  // Oracle VM - SSH into Oracle Cloud Infrastructure VM instances
  providerRegistry.set('oracle-vm', {
    provider: null as any as any,
    priority: 9,
    enabled: true,
    available: !!process.env.ORACLE_VM_HOST,
    healthy: false,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    asyncFactory: async () => {
      const { OracleVMProvider } = await import('./oracle-vm-provider')
      return new OracleVMProvider()
    },
  })
}

// Initialize on module load
initializeRegistry()

const MAX_RETRIES = 3

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Get a sandbox provider by type with retry logic, race condition prevention, and circuit breaker protection.
 * @param type - Provider type (defaults to SANDBOX_PROVIDER env var or 'daytona')
 */
export async function getSandboxProvider(type?: SandboxProviderType): Promise<SandboxProvider> {
  const providerType = type || (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona';
  log.debug(`getSandboxProvider called with type: ${providerType}`)
  
  const entry = providerRegistry.get(providerType);

  if (!entry) {
    log.error(`Unknown sandbox provider type: ${providerType}`)
    throw new Error(
      `Unknown sandbox provider type: ${providerType}. ` +
      `Available providers: ${Array.from(providerRegistry.keys()).join(', ')}`
    )
  }

  if (!entry.enabled) {
    log.error(`Provider ${providerType} is disabled`)
    throw new Error(`Provider ${providerType} is disabled`)
  }

  if (!entry.provider && !entry.factory && !entry.asyncFactory) {
    log.error(`Provider ${providerType} has no initialization factory`)
    throw new Error(`Provider ${providerType} has no initialization factory`)
  }

  // Get or create circuit breaker for this provider
  if (!entry.circuitBreaker) {
    entry.circuitBreaker = createCircuitBreakerWithMetrics(providerType);
  }
  const circuitBreaker = entry.circuitBreaker;

  // Check circuit breaker before attempting initialization
  if (!circuitBreaker.canExecute()) {
    const stats = circuitBreaker.getStats();
    log.warn(`Provider ${providerType} circuit breaker ${stats.state}`)
    sandboxMetrics.providerInitTotal.inc({ provider: providerType, status: 'circuit_open' });
    throw new Error(
      `Provider ${providerType} is unavailable (circuit breaker ${stats.state}). ` +
      `Next attempt at: ${stats.nextAttemptTime?.toISOString() || 'unknown'}`
    );
  }

  // Check health checker status (if running)
  const { providerHealthChecker } = await import('../../management/health-checker');
  const healthStatus = providerHealthChecker.getProviderHealth(providerType);
  if (healthStatus && !healthStatus.healthy && healthStatus.consecutiveFailures >= 3) {
    log.warn(`Provider ${providerType} is unhealthy: ${healthStatus.lastError}`)
    sandboxMetrics.providerInitTotal.inc({ provider: providerType, status: 'unhealthy' });
    throw new Error(
      `Provider ${providerType} is unhealthy (${healthStatus.consecutiveFailures} consecutive failures). ` +
      `Last error: ${healthStatus.lastError || 'unknown'}`
    );
  }

  // Already initialized and healthy — return immediately
  if (entry.provider && entry.healthy) {
    log.debug(`Provider ${providerType} already initialized and healthy`)
    return entry.provider
  }

  // Race condition prevention: if already initializing, wait for the existing attempt
  if (entry.initializing && entry.initPromise) {
    log.debug(`Provider ${providerType} initialization in progress, waiting...`)
    return entry.initPromise
  }

  // Start initialization with retry logic
  entry.initializing = true
  const initStartTime = Date.now();
  log.debug(`Starting initialization for provider ${providerType}`)

  entry.initPromise = (async () => {
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log.debug(`Provider ${providerType} initialization attempt ${attempt}/${MAX_RETRIES}`)
        if (entry.asyncFactory) {
          entry.provider = await entry.asyncFactory()
        } else if (entry.factory) {
          entry.provider = entry.factory()
        }
        if (!entry.provider) {
          throw new Error(`Provider ${providerType} initialization returned no instance`)
        }
        entry.available = true
        entry.healthy = true
        entry.failureCount = 0
        entry.initializing = false

        // Record successful initialization metrics
        const initDuration = (Date.now() - initStartTime) / 1000;
        log.info(`Provider ${providerType} initialized successfully in ${initDuration}s`)
        sandboxMetrics.providerInitTotal.inc({ provider: providerType, status: 'success' });
        sandboxMetrics.providerInitDuration.observe(initDuration);

        // Circuit breaker success is recorded via the execute() wrapper, not here

        return entry.provider
      } catch (error: any) {
        lastError = error
        entry.failureCount++

        log.error(`Provider ${providerType} initialization failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`)

        // Record failed initialization metrics
        const initDuration = (Date.now() - initStartTime) / 1000;
        sandboxMetrics.providerInitTotal.inc({ provider: providerType, status: 'failure' });
        sandboxMetrics.providerInitDuration.observe(initDuration);

        if (attempt < MAX_RETRIES) {
          await delay(Math.pow(2, attempt) * 100) // exponential backoff: 200ms, 400ms
        }
      }
    }
    // All retries exhausted
    entry.available = false
    entry.healthy = false
    entry.initializing = false
    entry.initPromise = null
    log.error(`Provider ${providerType} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`)
    throw new Error(
      `Failed to initialize provider ${providerType} after ${MAX_RETRIES} attempts: ${lastError?.message}. ` +
      `Check that required environment variables are set.`
    )
  })()

  return entry.initPromise
}

/**
 * Get a sandbox provider with automatic fallback.
 * Tries providers in priority order (lower number = higher priority).
 * Skips disabled, unhealthy, and circuit-breaker-OPEN providers.
 */
export async function getSandboxProviderWithFallback(
  preferredType?: SandboxProviderType,
): Promise<{ provider: SandboxProvider; type: SandboxProviderType }> {
  // Build ordered list: preferred first, then by priority
  const sorted = Array.from(providerRegistry.entries())
    .filter(([, e]) => e.enabled)
    .sort((a, b) => a[1].priority - b[1].priority)

  const ordered: SandboxProviderType[] = []
  if (preferredType) {
    ordered.push(preferredType)
  }
  for (const [t] of sorted) {
    if (t !== preferredType) {
      ordered.push(t)
    }
  }

  const errors: string[] = []
  for (const providerType of ordered) {
    // CIRCUIT BREAKER CHECK: Skip providers with OPEN circuit breakers
    if (!providerCircuitBreakers.isAvailable(providerType)) {
      const stats = providerCircuitBreakers.get(providerType).getStats()
      console.warn(
        `[ProviderFallback] Skipping ${providerType} - circuit breaker ${stats.state}. ` +
        `Next attempt at: ${stats.nextAttemptTime?.toISOString() || 'unknown'}`
      )
      errors.push(`${providerType}: Circuit breaker ${stats.state}`)
      continue
    }

    try {
      const provider = await getSandboxProvider(providerType)
      return { provider, type: providerType }
    } catch (error: any) {
      errors.push(`${providerType}: ${error.message}`)
    }
  }

  throw new Error(
    `All sandbox providers failed or unavailable:\n${errors.join('\n')}`
  )
}

/**
 * Get all registered providers
 */
export function getAllProviders(): SandboxProviderType[] {
  return Array.from(providerRegistry.keys())
}

/**
 * Get enabled providers (not disabled in registry)
 */
export function getEnabledProviders(): SandboxProviderType[] {
  return Array.from(providerRegistry.entries())
    .filter(([, entry]) => entry.enabled)
    .map(([type]) => type)
}

/**
 * Get available providers (initialized and ready)
 * Uses the same async retry logic as getSandboxProvider() for consistency.
 */
export async function getAvailableProviders(): Promise<SandboxProviderType[]> {
  const available: SandboxProviderType[] = []

  for (const [type, entry] of providerRegistry) {
    if (!entry.enabled) continue

    // If already initialized and healthy, include it
    if (entry.provider && entry.available && entry.healthy) {
      available.push(type)
      continue
    }

    // Try async initialization with retry (consistent with getSandboxProvider)
    try {
      await getSandboxProvider(type)
      available.push(type)
    } catch {
      // Provider failed to initialize — skip it
      continue
    }
  }

  return available.sort((a, b) => {
    const aEntry = providerRegistry.get(a)
    const bEntry = providerRegistry.get(b)
    return (aEntry?.priority ?? 10) - (bEntry?.priority ?? 10)
  })
}

/**
 * Check if a provider type is available
 */
export function isProviderAvailable(type: string): boolean {
  const entry = providerRegistry.get(type as SandboxProviderType)
  return entry?.available ?? false
}

/**
 * Enable/disable a provider
 */
export function setProviderEnabled(type: SandboxProviderType, enabled: boolean) {
  const entry = providerRegistry.get(type)
  if (entry) {
    entry.enabled = enabled
  }
}

/**
 * Get provider priority
 */
export function getProviderPriority(type: SandboxProviderType): number {
  return providerRegistry.get(type)?.priority ?? 10
}

// Re-export provider implementations for direct import
export { MicrosandboxProvider } from '../local/microsandbox-provider'
export { BlaxelProvider, verifyCallbackSignature, verifyCallbackMiddleware } from './blaxel-provider'
export type { BlaxelSandboxHandle } from './blaxel-provider'
export { SpritesProvider } from './sprites-provider'
export { CodeSandboxProvider } from './codesandbox-provider'
export { WebContainerProvider } from './webcontainer-provider'
export { WebContainerFileSystemProvider } from './webcontainer-filesystem-provider'
export { WebContainerSpawnProvider } from './webcontainer-spawn-provider'
export { OpenSandboxProvider } from './opensandbox-provider'
export { OpenSandboxCodeInterpreterProvider } from './opensandbox-code-interpreter-provider'
export { OpenSandboxAgentSandboxProvider } from './opensandbox-agent-sandbox-provider'
export { E2BProvider, E2BGitIntegration, createE2BGitIntegration } from './e2b-provider'
export { createAmpService, executeAmpTask } from '../spawn/e2b-amp-service'
export { CodexSchemas, createCodexService, executeCodexTask } from '../spawn/e2b-codex-service'
// export { MistralAgentProvider } from './mistral/mistral-agent-provider' // Lazy export

// Re-export CodeSandbox advanced integration
export {
  CodeSandboxExecutionRecorder,
  CodeSandboxSnapshotManager,
  CodeSandboxIdleManager,
  CodeSandboxResourceScaler,
  CodeSandboxPortManager,
  CodeSandboxPreCommitValidator,
  CodeSandboxAdvancedIntegration,
  createCodeSandboxAdvancedIntegration,
} from './codesandbox-advanced'
export type {
  FileSnapshot,
  FileDiff,
} from './codesandbox-advanced'

// Re-export Sprites utilities
export { SpritesCheckpointManager, createCheckpointManager } from './sprites-checkpoint-manager'
export type { RetentionPolicy, CheckpointInfo } from './sprites-checkpoint-manager'

// Re-export Sprites tar-sync utility
export { syncFilesToSprite, syncVfsSnapshotToSprite, syncChangedFilesToSprite } from './sprites-tar-sync'
export type { TarSyncFile, TarSyncResult } from './sprites-tar-sync'

// Re-export Universal VFS Sync
export { UniversalVfsSync, computeFileHash, detectChangedFiles } from '../../virtual-filesystem/sync/universal-vfs-sync'
export type { VfsFile, SyncOptions, SyncResult, ProviderSyncStrategy } from '../../virtual-filesystem/sync/universal-vfs-sync'

// Re-export Blaxel Jobs Manager
export { BlaxelJobsManager, executeBatchJob, deployBatchJob } from './blaxel-jobs-manager'
export type { BatchJobConfig, BatchTask, JobExecutionResult, BlaxelJob, BlaxelExecution } from './blaxel-jobs-manager'

// Re-export Blaxel callback verification
export { verifyBlaxelCallback, verifyBlaxelCallbackFromRequest, blaxelCallbackMiddleware, parseBlaxelCallbackPayload } from './blaxel-callback-verify'
export type { BlaxelCallbackPayload } from './blaxel-callback-verify'

// Re-export Unified Execution Recorder
export {
  createExecutionRecorder,
  createRecorderFromEnv,
  getRecordingStats,
  filterRecordingByType,
  filterRecordingByTimeRange,
  mergeRecordings,
} from './unified-execution-recorder'
export type {
  ExecutionRecorder,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionRecorderConfig,
  ExecutionRecordingExport,
  ReplayResult,
} from './unified-execution-recorder'

// Re-export Template Builder
export {
  createTemplateBuilder,
  createTemplateBuilderFromEnv,
  buildTemplate,
} from './template-builder'
export type {
  TemplateBuilder,
  TemplateBuildConfig,
  TemplateBuildResult,
  TemplateInfo,
} from './template-builder'

// Re-export MCP Gateway
export {
  createMCPGateway,
  createGatewayFromEnv,
  callMCPTool,
  listMCPTools,
} from '../../mcp/mcp-gateway'
export type {
  MCPGateway,
  MCPServerConfig,
  MCPTool,
  MCPGatewayConfig,
  GatewayConnectionResult,
  GatewayToolCallResult,
} from '../../mcp/mcp-gateway'

// Re-export Advanced Tool Calling
export {
  createOptimizedToolRouter,
  calculateCost,
  getRecommendedModel,
  compareProviders,
} from '../../tools/advanced-tool-calling'
export type {
  AdvancedToolRouter,
  TaskType,
  OptimizationGoal,
  ProviderMetrics,
  TaskRoutingConfig,
  ModelRecommendation,
  CostTracking,
  CostReport,
  OptimizationRecommendation,
} from '../../tools/advanced-tool-calling'

// Re-export Template Integration
export {
  createOpenCodeTemplate,
  listOpenCodeTemplates,
  createClaudeCodeTemplate,
  exportTemplateToUniversalFormat,
  importTemplateFromUniversalFormat,
  buildTemplateIntegration,
  getTemplateExamples,
} from './template-integration'
export type {
  OpenCodeTemplateConfig,
  OpenCodeTemplateResult,
  ClaudeCodeTemplateConfig,
  ClaudeCodeTemplateResult,
  UniversalTemplateFormat,
} from './template-integration'

// Re-export core types
export type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'

// Export new utilities
export { SpritesSSHFS, mountSpriteSSHFS, unmountSpriteSSHFS } from './sprites-sshfs'
export type { SSHFSMountConfig, SSHFSMountResult } from './sprites-sshfs'

export { BlaxelMcpServer, createBlaxelMcpServer } from './blaxel-mcp-server'

export {
  SandboxRateLimiter,
  createSandboxRateLimiter,
  rateLimitMiddleware,
  DEFAULT_RATE_LIMITS,
} from './rate-limiter'
export type { RateLimitConfig, RateLimitResult, RateLimitStatus } from './rate-limiter'

// ===========================================
// E2B Desktop Exports
// ===========================================
export {
  E2BDesktopProvider,
  desktopSessionManager,
  executeDesktopCommand,
  type DesktopSandboxHandle as DesktopHandle,
  type DesktopAction,
  type AgentLoopResult,
  type DesktopStats,
  type AmpSession,
  type MCPConfig,
} from '../../computer/e2b-desktop-provider-enhanced';

// ===========================================
// E2B MCP Gateway Exports
// ===========================================
export {
  E2BMCPGatewayManager,
  createMCPGatewayManager,
  quickSetupMCP,
  PRECONFIGURED_MCP_TOOLS,
  type MCPGatewayConfig as E2BMCPGatewayConfig,
  type MCPGatewayResult,
  type MCPToolConfig,
} from '../../mcp/e2b-mcp-gateway';

// ===========================================
// E2B Structured Output Exports
// ===========================================
export {
  E2BStructuredOutputManager,
  createStructuredOutputManager,
  quickExecuteWithSchema,
  type JsonSchema,
  type StructuredOutputConfig,
  type StructuredOutputResult,
} from './e2b-structured-output';

// ===========================================
// E2B Session Manager Exports
// ===========================================
export {
  E2BSessionManager,
  createSessionManager,
  quickMultiTurnExecute,
  type SessionMetadata,
  type SessionExecutionResult,
} from './e2b-session-manager';

// ===========================================
// E2B Template Builder Exports
// ===========================================
export {
  E2BTemplateBuilder,
  createE2BTemplateBuilder,
  quickBuildTemplate,
  TemplatePresets,
  type TemplateConfig,
  type TemplateBuildResult as E2BTemplateBuildResult,
} from './e2b-template-builder';

// ===========================================
// E2B Git Helper Exports
// ===========================================
export {
  E2BGitHelper,
  createGitHelper,
  quickClone,
  type GitCloneOptions,
  type GitCommitOptions,
  type GitPushOptions,
  type GitBranchInfo,
  type GitStatusInfo,
} from '../../virtual-filesystem/e2b-git-helper';

// ===========================================
// E2B Analytics Exports
// ===========================================
export {
  E2BAnalyticsManager,
  e2bAnalytics,
  createE2BAnalytics,
  trackExecution,
  type ExecutionMetrics,
  type CostBreakdown,
  type UsageStats,
} from './e2b-analytics';

// ===========================================
// E2B Debug Mode Exports
// ===========================================
export {
  E2BDebugManager,
  e2bDebug,
  createE2BDebug,
  traceExecution,
  type DebugLogEntry,
  type ExecutionTrace,
} from './e2b-debug';

// ===========================================
// E2B Network Isolation Exports
// ===========================================
export {
  E2BNetworkIsolation,
  e2bNetworkIsolation,
  createNetworkIsolation,
  NetworkPresets,
  type NetworkPolicy,
  type NetworkTrafficLog,
} from './e2b-network-isolation';

// ===========================================
// Blaxel Async Exports
// ===========================================
export {
  BlaxelAsyncManager,
  blaxelAsyncManager,
  verifyWebhookFromRequest,
  type AsyncTriggerConfig,
  type AsyncExecutionResult,
  type BlaxelWebhookPayload,
} from './blaxel-async';

// Lazy export for MistralAgentProvider
export function getMistralAgentProvider() {
  const { MistralAgentProvider } = require('./mistral/mistral-agent-provider')
  return new MistralAgentProvider()
}
