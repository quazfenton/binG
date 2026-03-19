// Re-export the sandbox module for use within binG0
export { SandboxServiceBridge as SandboxService, sandboxBridge } from './sandbox-service-bridge';
export type { WorkspaceSession, SandboxConfig } from './types';
export type { ToolResult, PreviewInfo, AgentMessage } from './types';
export { runAgentLoop } from '../orchestra/agent-loop';
export { sandboxEvents } from './sandbox-events';
export type { SandboxEvent, SandboxEventType } from './sandbox-events';
export { terminalManager, TerminalManager } from '../terminal/terminal-manager';
export { provisionBaseImage, warmPool, WarmPool } from './base-image';
export type { BasePackageSet, ProvisionResult } from './base-image';
export { sandboxFilesystemSync } from '../virtual-filesystem/sync/sandbox-filesystem-sync';

// Enhanced terminal manager with desktop/MCP support
export { EnhancedTerminalManager } from '../terminal/enhanced-terminal-manager';

// Enhanced sandbox tools with computer use, MCP, desktop operations
export { ENHANCED_SANDBOX_TOOLS, TOOL_CATEGORIES, getToolsByCategory, isToolAvailable, getToolByName } from './enhanced-sandbox-tools';

// Enhanced port detection
export { enhancedPortDetector, detectPorts, getDetectedPorts, clearDetectedPorts, type PortDetectionResult } from '../previews/enhanced-port-detector';

// Resource monitoring
export {
  SandboxResourceMonitor,
  createResourceMonitor,
  quickMonitor,
} from '../management/resource-monitor';

export type {
  ResourceMetrics,
  ResourceAlert,
  ScalingRecommendation,
  MonitoringConfig,
} from '../management/resource-monitor';

// Auto-scaling
export {
  AutoScalingManager,
  createAutoScalingManager,
  ScalingPresets,
} from './auto-scaling';

export type {
  ScalingPolicy,
  ScalingDecision,
  ResourceUsage,
  ScalingPolicyType,
  ScalingAction,
} from './auto-scaling';

// Local filesystem executor (NEW - migrated from TerminalPanel)
export {
  LocalCommandExecutor,
  type LocalFilesystemEntry,
  type LocalCommandExecutorConfig,
} from '../terminal/commands/local-filesystem-executor'

// Terminal handlers (NEW - complete migration)
export {
  TerminalLocalFSHandler,
  createTerminalLocalFSHandler,
  type TerminalLocalFSConfig,
} from '../terminal/commands/terminal-local-fs-handler'

export {
  TerminalInputHandler,
  createTerminalInputHandler,
  type TerminalInputHandlerConfig,
} from '../terminal/commands/terminal-input-handler'

export {
  TerminalEditorHandler,
  createTerminalEditorHandler,
  type EditorSession,
  type TerminalEditorHandlerConfig,
} from '../terminal/commands/terminal-editor-handler'

export {
  SandboxConnectionManager,
  createSandboxConnectionManager,
  type SandboxConnectionState,
  type SandboxConnectionManagerConfig,
} from './sandbox-connection-manager'

export {
  TerminalInputBatcher,
  createTerminalInputBatcher,
  type TerminalInputBatcherConfig,
} from '../terminal/terminal-input-batcher'

export {
  TerminalHealthMonitor,
  createTerminalHealthMonitor,
  type TerminalHealthMonitorConfig,
} from '../terminal/terminal-health-monitor'

export {
  TerminalStateManager,
  createTerminalStateManager,
  type TerminalState,
  type TerminalStateManagerConfig,
} from '../terminal/session/terminal-state-manager'

// Terminal UI Manager (NEW - UI/UX operations)
export {
  TerminalUIManager,
  createTerminalUIManager,
  type TerminalUIState,
  type TerminalUIManagerConfig,
} from '../terminal/terminal-ui-manager'

// Terminal Handler Wiring (NEW - wiring utilities)
export {
  wireTerminalHandlers,
  getHandler,
  hasHandler,
  cleanupHandlers,
  type TerminalHandlers,
  type TerminalHandlerWiringConfig,
} from '../terminal/commands/terminal-handler-wiring'

// ==================== Phase 1 Integration (NEW) ====================
// Per-user terminal session isolation, auto-snapshots, VFS sync, provider MCP tools

export {
  // User terminal sessions
  UserTerminalSessionManager,
  userTerminalSessionManager,
  type UserTerminalSession,
  type CreateSessionOptions,
  type DisconnectSessionOptions,
  type RestoreResult,
  
  // Auto-snapshot service
  AutoSnapshotService,
  autoSnapshotService,
  enableAutoSnapshot,
  createSnapshot,
  type AutoSnapshotConfig,
  type SnapshotMetadata,
  
  // VFS sync-back
  VFSyncBackService,
  vfsSyncBackService,
  syncSandboxToVFS,
  type VFSFileEntry,
  type VFSyncConfig,
  type VFSyncResult,
  type VFSyncStatus,
  
  // Enhanced PTY terminal (real WebSocket PTY with local fallback)
  EnhancedPTYTerminalManager,
  enhancedPTYTerminalManager,
  createPTYTerminal,
  getPTYTerminal,
  connectPTYToSandbox,
  disconnectPTY,
  type PTYMode,
  type PTYTerminalConfig,
  type PTYConnectOptions,
  type PTYDisconnectOptions,
  type PTYTerminalInstance,
  
  // Phase 1 integration helper
  Phase1Integration,
  phase1,
  createSessionWithAutoSnapshot,
  restoreLatestAndSync,
} from './phase1-integration';

// ==================== Phase 2 Integration (NEW) ====================
// Provider router, E2B deep integration, Daytona Computer Use, CodeSandbox Batch, Live Preview

export {
  // Phase 2 unified API
  Phase2Integration,
  phase2,
  runAgentTaskWithAutoProvider,
  runCIWithAutoProvider,
  
  // Provider Router
  ProviderRouter,
  providerRouter,
  selectOptimalProvider,
  selectProviderWithServices,
  getProviderRecommendations,
  checkServiceSupport,
  getProvidersForService,
  type TaskType,
  type TaskDuration,
  type ProviderService,
  type TaskContext,
  type ProviderSelectionResult,
  type ProviderProfile,
  
  // E2B Deep Integration
  E2BIntegration,
  e2bIntegration,
  runAmpAgent,
  runCodexAgent,
  cloneRepo,
  type AmpAgentConfig,
  type CodexAgentConfig,
  type GitCloneConfig,
  type DesktopConfig,
  type E2BResult,
  type AmpEvent,
  type CodexEvent,
  type GitOperationResult,
  
  // Daytona Computer Use
  DaytonaComputerUseWorkflow,
  daytonaComputerUse,
  takeScreenshot,
  takeRegionScreenshot,
  startRecording,
  stopRecording,
  click,
  type,
  type ScreenRegion,
  type MousePosition,
  type KeyboardInput,
  type RecordingResult,
  type ScreenshotResult,
  
  // CodeSandbox Batch CI/CD
  CodeSandboxBatchCI,
  codesandboxBatch,
  runBatchJob,
  runParallelTests,
  runMultiEnvBuild,
  runCIPipeline,
  type BatchTask,
  type BatchResult,
  type BatchAggregatedResult,
  type ParallelTestConfig,
  type MultiEnvBuildConfig,
  type CIPipelineConfig,
  
  // Live Preview Offloading
  LivePreviewOffloading,
  livePreviewOffloading,
  getPreviewProvider,
  getProviderPreviewUrl,
  getPreview,
  createSmartPreview,
  type PreviewMode,
  type AppFramework,
  type PreviewRequest,
  type ProjectDetection,
} from './phase2-integration';

// ==================== Phase 3 Integration (NEW) ====================
// Cross-provider snapshots, LSP integration, GPU routing, object storage

export {
  // Phase 3 unified API
  Phase3Integration,
  phase3,
  migrateAndSync,
  getCodeIntelligence,
  
  // Snapshot Portability
  SnapshotPortability,
  snapshotPortability,
  exportSnapshot,
  importSnapshot,
  migrateSession,
  verifySnapshot,
  type PortableSnapshot,
  type MigrationResult,
  
  // LSP Integration
  LSPIntegration,
  lspIntegration,
  getCompletions,
  goToDefinition,
  findReferences,
  getHover,
  getDiagnostics,
  formatDocument,
  type Position,
  type CompletionItem,
  type Diagnostic,
  type Location,
  type Hover,
  
  // GPU Task Routing
  GPUTaskRouting,
  gpuTaskRouting,
  checkGPUAvailability,
  getGPUProviders,
  routeMLTask,
  getCostEstimate,
  shouldUseGPU,
  type GPUTaskType,
  type GPURequirements,
  type GPUAvailability,
  
  // Object Storage Integration
  ObjectStorageIntegration,
  objectStorageIntegration,
  uploadFile,
  downloadFile,
  listFiles,
  deleteFile,
  getStorageUrl,
  isStorageSupported,
  type UploadResult,
  type DownloadResult,
  type StoredFile,
} from './phase3-integration';
