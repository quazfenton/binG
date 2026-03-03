/**
 * Backend Module Index
 * Exports all backend adapters, managers, and routers
 */

// Auth
export {
  AuthManager,
  authManager,
  getUserId,
  createToken,
  validateToken,
  getCurrentUser,
  requireAuth,
  validateUserId,
  type AuthConfig,
} from './auth';

// Preview Router
export {
  PreviewRouter,
  PreviewRegistry,
  FallbackOrchestrator,
  previewRouter,
  type PreviewTarget,
  type PreviewRegistration,
} from './preview-router';

// Sandbox Manager
export {
  SandboxManager,
  sandboxManager,
  type Sandbox,
  type SandboxConfig,
  type ExecResult,
  type FileEntry,
} from './sandbox-manager';

// Adapters
export {
  FlaskAdapter,
  DjangoAdapter,
  NodeWasmAdapter,
  PreviewMountManager,
  createFlaskAdapter,
  createDjangoAdapter,
  createNodeWasmAdapter,
  createPreviewMountManager,
  type FlaskApp,
  type DjangoASGIApp,
  type QuickJSRuntime,
  type PreviewMount,
} from './adapters';

// WebSocket Terminal
export {
  WebSocketTerminalServer,
  webSocketTerminalServer,
  type TerminalSession,
} from './websocket-terminal';

// Storage Backend
export {
  StorageBackend,
  S3StorageBackend,
  LocalStorageBackend,
  createStorageBackend,
  getS3Backend,
  getLocalBackend,
  type StorageConfig,
  type StorageObject,
  type UploadResult,
} from './storage-backend';

// Firecracker Runtime
export {
  FirecrackerRuntime,
  ProcessRuntime,
  createRuntime,
  getFirecrackerRuntime,
  getProcessRuntime,
  type FirecrackerConfig,
  type VMInstance,
} from './firecracker-runtime';

// Metrics
export {
  Metric,
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  SandboxMetrics,
  createMetricsEndpoint,
  sandboxMetrics,
  metricsEndpoint,
  type MetricType,
  type MetricLabels,
  type MetricSample,
} from './metrics';

// Quota
export {
  QuotaManager,
  quotaManager,
  type QuotaConfig,
  type UsageRecord,
  type QuotaViolation,
} from './quota';

// Virtual FS
export {
  VirtualFS,
  virtualFS,
  type MountPoint,
} from './virtual-fs';

// Background Jobs
export {
  BackgroundExecutor,
  backgroundExecutor,
  type BackgroundJobConfig,
  type BackgroundJob,
  type JobExecutionResult,
  type JobExecutor,
} from './background-jobs';

// Container Runtime
export {
  ContainerRuntime,
  FirecrackerRuntime,
  ProcessRuntime,
  createRuntime,
  getFirecrackerRuntime,
  getProcessRuntime,
  type RuntimeType,
  type ResourceLimits,
  type ContainerInfo,
  type ExecResult,
  type FirecrackerConfig,
  type VMInstance,
} from './firecracker-runtime';

// Snapshot Manager
export {
  SnapshotManager,
  snapshotManager,
  type RetryConfig,
  type SnapshotResult,
  type SnapshotInfo,
  type StorageBackend,
} from './snapshot-manager';

// Agent Workspace
export {
  WorkspaceManager,
  workspaceManager,
  type AgentWorkspace,
  type CreateWorkspaceRequest,
  type ShareWorkspaceRequest,
  type WorkerListing,
  type PublishWorkerRequest,
  type ExecRequest,
} from './agent-workspace';
