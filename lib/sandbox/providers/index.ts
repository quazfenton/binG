/**
 * Sandbox Providers Index
 *
 * Central registry for all sandbox providers.
 * Add new providers here and the SandboxProviderType union.
 */

import type { SandboxProvider } from './sandbox-provider'
import { MicrosandboxProvider } from './microsandbox-provider'
import { BlaxelProvider } from './blaxel-provider'
import { SpritesProvider } from './sprites-provider'
import { CodeSandboxProvider } from './codesandbox-provider'
import { E2BProvider } from './e2b-provider'
import { DaytonaProvider } from './daytona-provider'
import { RunloopProvider } from './runloop-provider'
import { E2BDesktopProvider, desktopSessionManager, type DesktopSandboxHandle as DesktopHandle } from './e2b-desktop-provider-enhanced'

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
  | 'sprites'
  | 'codesandbox'
  | 'webcontainer'
  | 'opensandbox'
  | 'mistral-agent'
  | 'mistral'

// Provider registry
interface ProviderEntry {
  provider: SandboxProvider
  priority: number
  enabled: boolean
  available: boolean
  healthy: boolean
  initializing: boolean
  initPromise: Promise<SandboxProvider> | null
  failureCount: number
  factory?: () => SandboxProvider
}

const providerRegistry = new Map<SandboxProviderType, ProviderEntry>()

function initializeRegistry() {
  // Register providers with priority (lower = higher priority in fallback chain)
  // Use factory functions for lazy initialization to avoid SDK import errors in tests
  
  providerRegistry.set('daytona', {
    provider: null as any,
    priority: 1,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { DaytonaProvider } = require('./daytona-provider')
      return new DaytonaProvider()
    },
  })

  providerRegistry.set('e2b', {
    provider: null as any,
    priority: 2,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { E2BProvider } = require('./e2b-provider')
      return new E2BProvider()
    },
  })

  providerRegistry.set('runloop', {
    provider: null as any,
    priority: 3,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { RunloopProvider } = require('./runloop-provider')
      return new RunloopProvider()
    },
  })

  providerRegistry.set('microsandbox', {
    provider: null as any,
    priority: 4,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { MicrosandboxProvider } = require('./microsandbox-provider')
      return new MicrosandboxProvider()
    },
  })

  providerRegistry.set('blaxel', {
    provider: null as any,
    priority: 5,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { BlaxelProvider } = require('./blaxel-provider')
      return new BlaxelProvider()
    },
  })

  providerRegistry.set('sprites', {
    provider: null as any,
    priority: 6,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { SpritesProvider } = require('./sprites-provider')
      return new SpritesProvider()
    },
  })

  providerRegistry.set('codesandbox', {
    provider: null as any,
    priority: 7,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { CodeSandboxProvider } = require('./codesandbox-provider')
      return new CodeSandboxProvider()
    },
  })

  providerRegistry.set('webcontainer', {
    provider: null as any,
    priority: 8,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { WebContainerProvider } = require('./webcontainer-provider')
      return new WebContainerProvider()
    },
  })

  providerRegistry.set('opensandbox', {
    provider: null as any,
    priority: 9,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { OpenSandboxProvider } = require('./opensandbox-provider')
      return new OpenSandboxProvider()
    },
  })

  // Mistral Agent provider (lazy initialization)
  providerRegistry.set('mistral-agent', {
    provider: null as any,
    priority: 3,
    enabled: true,
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      const { MistralAgentProvider } = require('./mistral/mistral-agent-provider')
      return new MistralAgentProvider()
    },
  })

  // Legacy Mistral code interpreter
  providerRegistry.set('mistral', {
    provider: null as any,
    priority: 3,
    enabled: false, // Disabled by default, use mistral-agent instead
    available: false,
    healthy: true,
    initializing: false,
    initPromise: null,
    failureCount: 0,
    factory: () => {
      // Lazy import to avoid circular dependencies
      const { MistralCodeInterpreterProvider } = require('./mistral-code-interpreter-provider')
      return new MistralCodeInterpreterProvider()
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
 * Get a sandbox provider by type with retry logic and race condition prevention.
 * @param type - Provider type (defaults to SANDBOX_PROVIDER env var or 'daytona')
 */
export async function getSandboxProvider(type?: SandboxProviderType): Promise<SandboxProvider> {
  const providerType = type || (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona';
  const entry = providerRegistry.get(providerType);

  if (!entry) {
    throw new Error(
      `Unknown sandbox provider type: ${providerType}. ` +
      `Available providers: ${Array.from(providerRegistry.keys()).join(', ')}`
    )
  }

  // Already initialized and healthy — return immediately
  if (entry.provider && entry.healthy) {
    return entry.provider
  }

  // Race condition prevention: if already initializing, wait for the existing attempt
  if (entry.initializing && entry.initPromise) {
    return entry.initPromise
  }

  // Start initialization with retry logic
  entry.initializing = true
  entry.initPromise = (async () => {
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (entry.factory) {
          entry.provider = entry.factory()
        }
        entry.available = true
        entry.healthy = true
        entry.failureCount = 0
        entry.initializing = false
        return entry.provider
      } catch (error: any) {
        lastError = error
        entry.failureCount++
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
 * Skips disabled and unhealthy providers.
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
    try {
      const provider = await getSandboxProvider(providerType)
      return { provider, type: providerType }
    } catch (error: any) {
      errors.push(`${providerType}: ${error.message}`)
    }
  }

  throw new Error(
    `All sandbox providers failed:\n${errors.join('\n')}`
  )
}

/**
 * Get all registered providers
 */
export function getAllProviders(): SandboxProviderType[] {
  return Array.from(providerRegistry.keys())
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
    if (entry.provider && entry.available) {
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
export { MicrosandboxProvider } from './microsandbox-provider'
export { BlaxelProvider, verifyCallbackSignature, verifyCallbackMiddleware } from './blaxel-provider'
export type { BlaxelSandboxHandle } from './blaxel-provider'
export { SpritesProvider } from './sprites-provider'
export { CodeSandboxProvider } from './codesandbox-provider'
export { WebContainerProvider } from './webcontainer-provider'
export { OpenSandboxProvider } from './opensandbox-provider'
export { E2BProvider, E2BGitIntegration, createE2BGitIntegration } from './e2b-provider'
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
export { UniversalVfsSync, computeFileHash, detectChangedFiles } from './universal-vfs-sync'
export type { VfsFile, SyncOptions, SyncResult, ProviderSyncStrategy } from './universal-vfs-sync'

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
} from './mcp-gateway'
export type {
  MCPGateway,
  MCPServerConfig,
  MCPTool,
  MCPGatewayConfig,
  GatewayConnectionResult,
  GatewayToolCallResult,
} from './mcp-gateway'

// Re-export Advanced Tool Calling
export {
  createOptimizedToolRouter,
  calculateCost,
  getRecommendedModel,
  compareProviders,
} from './advanced-tool-calling'
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
} from './advanced-tool-calling'

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
} from './e2b-desktop-provider-enhanced';

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
} from './e2b-mcp-gateway';

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
} from './e2b-git-helper';

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
