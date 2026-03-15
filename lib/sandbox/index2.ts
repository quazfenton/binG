/**
 * Sandbox Module
 * 
 * Organized exports for sandbox functionality.
 * 
 * Categories:
 * - Core Service: SandboxService, sandboxBridge, runAgentLoop
 * - Terminal: terminalManager, EnhancedTerminalManager, handlers
 * - Providers: Phase1/2/3 integrations, provider router
 * - Utils: monitoring, scaling, port detection, tools
 */

// ============================================================================
// CORE SERVICE
// ============================================================================

export { SandboxServiceBridge as SandboxService, sandboxBridge } from './sandbox-service-bridge';
export type { WorkspaceSession, SandboxConfig } from './types';
export type { ToolResult, PreviewInfo, AgentMessage } from './types';
export { runAgentLoop } from './agent-loop';

// ============================================================================
// TERMINAL MANAGEMENT
// ============================================================================

export { terminalManager, TerminalManager } from './terminal-manager';
export { EnhancedTerminalManager } from './enhanced-terminal-manager';
export { EnhancedPTYTerminalManager, enhancedPTYTerminalManager } from './enhanced-pty-terminal';
export type { PTYMode, PTYTerminalConfig, PTYConnectOptions, PTYDisconnectOptions, PTYTerminalInstance } from './enhanced-pty-terminal';

// Terminal handlers
export { TerminalLocalFSHandler, createTerminalLocalFSHandler } from './terminal-local-fs-handler';
export type { TerminalLocalFSConfig } from './terminal-local-fs-handler';
export { TerminalInputHandler, createTerminalInputHandler } from './terminal-input-handler';
export type { TerminalInputHandlerConfig } from './terminal-input-handler';
export { TerminalEditorHandler, createTerminalEditorHandler } from './terminal-editor-handler';
export type { EditorSession, TerminalEditorHandlerConfig } from './terminal-editor-handler';
export { TerminalInputBatcher, createTerminalInputBatcher } from './terminal-input-batcher';
export type { TerminalInputBatcherConfig } from './terminal-input-batcher';
export { TerminalHealthMonitor, createTerminalHealthMonitor } from './terminal-health-monitor';
export type { TerminalHealthMonitorConfig } from './terminal-health-monitor';
export { TerminalStateManager, createTerminalStateManager } from './terminal-state-manager';
export type { TerminalState, TerminalStateManagerConfig } from './terminal-state-manager';
export { TerminalUIManager, createTerminalUIManager } from './terminal-ui-manager';
export type { TerminalUIState, TerminalUIManagerConfig } from './terminal-ui-manager';
export { wireTerminalHandlers, getHandler, hasHandler, cleanupHandlers } from './terminal-handler-wiring';
export type { TerminalHandlers, TerminalHandlerWiringConfig } from './terminal-handler-wiring';

// Local filesystem executor
export { LocalCommandExecutor } from './local-filesystem-executor';
export type { LocalFilesystemEntry, LocalCommandExecutorConfig } from './local-filesystem-executor';

// ============================================================================
// PROVIDER INTEGRATIONS (Phase 1/2/3)
// ============================================================================

// Phase 1
export {
  UserTerminalSessionManager,
  userTerminalSessionManager,
  AutoSnapshotService,
  autoSnapshotService,
  enableAutoSnapshot,
  createSnapshot,
  VFSyncBackService,
  vfsSyncBackService,
  syncSandboxToVFS,
  Phase1Integration,
  phase1,
  createSessionWithAutoSnapshot,
  restoreLatestAndSync,
} from './phase1-integration';

export type {
  UserTerminalSession,
  CreateSessionOptions,
  DisconnectSessionOptions,
  RestoreResult,
  AutoSnapshotConfig,
  SnapshotMetadata,
  VFSFileEntry,
  VFSyncConfig,
  VFSyncResult,
  VFSyncStatus,
} from './phase1-integration';

// Phase 2
export {
  Phase2Integration,
  phase2,
  runAgentTaskWithAutoProvider,
  runCIWithAutoProvider,
  ProviderRouter,
  providerRouter,
  selectOptimalProvider,
  selectProviderWithServices,
  getProviderRecommendations,
  checkServiceSupport,
  getProvidersForService,
  E2BIntegration,
  e2bIntegration,
  runAmpAgent,
  runCodexAgent,
  cloneRepo,
  DaytonaComputerUseWorkflow,
  daytonaComputerUse,
  takeScreenshot,
  takeRegionScreenshot,
  startRecording,
  stopRecording,
  click,
  type as daytonaType,
  CodeSandboxBatchCI,
  codesandboxBatch,
  runBatchJob,
  runParallelTests,
  runMultiEnvBuild,
  runCIPipeline,
  LivePreviewOffloading,
  livePreviewOffloading,
} from './phase2-integration';

export type {
  TaskType,
  TaskDuration,
  ProviderService,
  TaskContext,
  ProviderSelectionResult,
  ProviderProfile,
  AmpAgentConfig,
  CodexAgentConfig,
  GitCloneConfig,
  DesktopConfig,
  E2BResult,
  AmpEvent,
  CodexEvent,
  GitOperationResult,
  ScreenRegion,
  MousePosition,
  KeyboardInput,
  RecordingResult,
  ScreenshotResult,
  BatchTask,
  BatchResult,
  BatchAggregatedResult,
  ParallelTestConfig,
  MultiEnvBuildConfig,
  CIPipelineConfig,
  PreviewProvider,
  AppFramework,
  PreviewContext,
  PreviewResult,
  SmartPreviewConfig,
} from './phase2-integration';

// Phase 3
export {
  Phase3Integration,
  phase3,
  migrateAndSync,
  getCodeIntelligence,
  SnapshotPortability,
  snapshotPortability,
  LSPIntegration,
  lspIntegration,
  GPUTaskRouting,
  gpuTaskRouting,
  ObjectStorageIntegration,
  objectStorageIntegration,
} from './phase3-integration';

export type {
  PortableSnapshot,
  MigrationResult,
  Position,
  CompletionItem,
  Diagnostic,
  Location,
  Hover,
  GPUTaskType,
  GPURequirements,
  GPUAvailability,
  UploadResult,
  DownloadResult,
  StoredFile,
} from './phase3-integration';

// ============================================================================
// UTILITIES
// ============================================================================

// Resource monitoring
export { SandboxResourceMonitor, createResourceMonitor, quickMonitor } from './resource-monitor';
export type { ResourceMetrics, ResourceAlert, ScalingRecommendation, MonitoringConfig } from './resource-monitor';

// Auto-scaling
export { AutoScalingManager, createAutoScalingManager, ScalingPresets } from './auto-scaling';
export type { ScalingPolicy, ScalingDecision, ResourceUsage, ScalingPolicyType, ScalingAction } from './auto-scaling';

// Port detection
export { enhancedPortDetector, detectPorts, getDetectedPorts, clearDetectedPorts } from './enhanced-port-detector';
export type { PortDetectionResult } from './enhanced-port-detector';

// Enhanced tools
export { ENHANCED_SANDBOX_TOOLS, TOOL_CATEGORIES, getToolsByCategory, isToolAvailable, getToolByName } from './enhanced-sandbox-tools';

// Events
export { sandboxEvents } from './sandbox-events';
export type { SandboxEvent, SandboxEventType } from './sandbox-events';

// Connection manager
export { SandboxConnectionManager, createSandboxConnectionManager } from './sandbox-connection-manager';
export type { SandboxConnectionState, SandboxConnectionManagerConfig } from './sandbox-connection-manager';

// Filesystem sync
export { sandboxFilesystemSync } from './sandbox-filesystem-sync';

// Base image
export { provisionBaseImage, warmPool, WarmPool } from './base-image';
export type { BasePackageSet, ProvisionResult } from './base-image';
