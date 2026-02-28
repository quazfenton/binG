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
import { E2BDesktopProvider, desktopSessionManager, type DesktopHandle, type E2BDesktopConfig } from './e2b-desktop-provider'

// Provider registry
const providerRegistry = new Map<SandboxProviderType, {
  provider: SandboxProvider
  priority: number
  enabled: boolean
  available: boolean
  factory?: () => SandboxProvider
}>()

// ... (existing code)

function initializeRegistry() {
  // Register providers with priority (lower = higher priority in fallback chain)
  // Use factory functions for lazy initialization to avoid SDK import errors in tests
  
  providerRegistry.set('daytona', {
    provider: null as any,
    priority: 1,
    enabled: true,
    available: false,
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
    factory: () => {
      const { CodeSandboxProvider } = require('./codesandbox-provider')
      return new CodeSandboxProvider()
    },
  })

  // Mistral Agent provider (lazy initialization)
  providerRegistry.set('mistral-agent', {
    provider: null as any,
    priority: 3,
    enabled: true,
    available: false,
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
    factory: () => {
      // Lazy import to avoid circular dependencies
      const { MistralCodeInterpreterProvider } = require('./mistral-code-interpreter-provider')
      return new MistralCodeInterpreterProvider()
    },
  })
}

// Initialize on module load
initializeRegistry()

/**
 * Get a sandbox provider by type
 * @param type - Provider type (defaults to SANDBOX_PROVIDER env var or 'daytona')
 */
export function getSandboxProvider(type?: SandboxProviderType): SandboxProvider {
  const providerType = type || (process.env.SANDBOX_PROVIDER as SandboxProviderType) || 'daytona';
  const entry = providerRegistry.get(providerType);

  if (!entry) {
    throw new Error(
      `Unknown sandbox provider type: ${providerType}. ` +
      `Available providers: ${Array.from(providerRegistry.keys()).join(', ')}`
    )
  }

  // Lazy initialization if factory exists
  if (!entry.provider && entry.factory) {
    try {
      entry.provider = entry.factory()
      entry.available = true
    } catch (error: any) {
      entry.available = false
      throw new Error(
        `Failed to initialize provider ${providerType}: ${error.message}. ` +
        `Check that required environment variables are set.`
      )
    }
  }

  return entry.provider
}

/**
 * Get all registered providers
 */
export function getAllProviders(): SandboxProviderType[] {
  return Array.from(providerRegistry.keys())
}

/**
 * Get available providers (initialized and ready)
 */
export async function getAvailableProviders(): Promise<SandboxProviderType[]> {
  const available: SandboxProviderType[] = []

  for (const [type, entry] of providerRegistry) {
    if (!entry.enabled) continue

    // Try to initialize if not yet done
    if (!entry.provider && entry.factory) {
      try {
        entry.provider = entry.factory()
        entry.available = true
      } catch {
        entry.available = false
        continue
      }
    }

    if (entry.available) {
      available.push(type)
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
export { BlaxelProvider } from './blaxel-provider'
export { SpritesProvider } from './sprites-provider'
export { CodeSandboxProvider } from './codesandbox-provider'
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
export type { CheckpointRetention, CheckpointInfo } from './sprites-checkpoint-manager'

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
  getDesktopSessionInfo,
  listDesktopSessions,
  type DesktopHandle,
  type E2BDesktopConfig,
} from './e2b-desktop-provider';

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
