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
import { E2BDesktopProvider, desktopSessionManager, type DesktopHandle, type E2BDesktopConfig } from './e2b-desktop-provider'
// Lazy import Mistral Agent Provider to avoid circular dependencies
// const { MistralAgentProvider } = require('./mistral/mistral-agent-provider')

// Extended provider type including new providers
export type SandboxProviderType =
  | 'daytona'
  | 'runloop'
  | 'microsandbox'
  | 'e2b'
  | 'mistral'           // Legacy code interpreter
  | 'mistral-agent'    // NEW: Full Agent SDK with code_interpreter
  | 'blaxel'           // Blaxel cloud sandboxes
  | 'sprites'          // Fly.io Sprites persistent VMs
  | 'codesandbox'      // CodeSandbox SDK cloud VMs

// Provider registry entry
interface ProviderRegistryEntry {
  provider: SandboxProvider
  priority: number
  enabled: boolean
  available: boolean
  factory?: () => SandboxProvider
}

// Provider registry
const providerRegistry = new Map<SandboxProviderType, ProviderRegistryEntry>()

/**
 * Initialize provider registry
 */
function initializeRegistry() {
  // Register providers with priority (lower = higher priority in fallback chain)
  providerRegistry.set('microsandbox', {
    provider: new MicrosandboxProvider(),
    priority: 4,
    enabled: true,
    available: true,
  })

  providerRegistry.set('blaxel', {
    provider: new BlaxelProvider(),
    priority: 5,
    enabled: true,
    available: true,
  })

  providerRegistry.set('sprites', {
    provider: new SpritesProvider(),
    priority: 6,
    enabled: true,
    available: true,
  })

  providerRegistry.set('codesandbox', {
    provider: new CodeSandboxProvider(),
    priority: 7,
    enabled: true,
    available: true,
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
 */
export function getSandboxProvider(type: SandboxProviderType): SandboxProvider {
  const entry = providerRegistry.get(type)
  
  if (!entry) {
    throw new Error(
      `Unknown sandbox provider type: ${type}. ` +
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
        `Failed to initialize provider ${type}: ${error.message}. ` +
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
  createTemplateBuilder,
  quickBuildTemplate,
  TemplatePresets,
  type TemplateConfig,
  type TemplateBuildResult,
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
