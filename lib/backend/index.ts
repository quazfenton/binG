/**
 * Backend Module Index
 * Exports all backend adapters, managers, and routers
 */

// Backend Service (NEW - centralized initialization)
export {
  backendService,
  BackendService,
  initializeBackend,
  getBackendStatus,
  type BackendConfig,
  type BackendStatus,
} from './backend-service';

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
} from '../previews/preview-router';

// Sandbox Manager
export {
  SandboxManager,
  sandboxManager,
  type Sandbox,
  type SandboxConfig,
  type ExecResult as SandboxExecResult,
  type FileEntry,
} from '../sandbox/sandbox-manager';

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
} from '../previews/adapters';

// WebSocket Terminal
export {
  WebSocketTerminalServer,
  webSocketTerminalServer,
  type TerminalSession,
} from '../terminal/websocket-terminal';

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
} from '../storage/storage-backend';

// Firecracker Runtime
export {
  FirecrackerRuntime,
  ProcessRuntime,
  createRuntime,
  getFirecrackerRuntime,
  getProcessRuntime,
  type FirecrackerConfig,
  type VMInstance,
  type RuntimeType,
  type ResourceLimits,
  type ContainerInfo,
  type ExecResult as FirecrackerExecResult,
} from '../sandbox/firecracker-runtime';

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
} from '../management/quota';

// Virtual FS
export {
  VirtualFS,
  virtualFS,
  type MountPoint,
} from '../virtual-filesystem/virtual-fs';

// Background Jobs
export {
  BackgroundExecutor,
  backgroundExecutor,
  type BackgroundJobConfig,
  type BackgroundJob,
  type JobExecutionResult,
  type JobExecutor,
} from '../agent/background-jobs';

// Snapshot Manager
export {
  SnapshotManager,
  snapshotManager,
  type RetryConfig,
  type SnapshotResult,
  type SnapshotInfo,
} from '../virtual-filesystem/sync/snapshot-manager';

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
} from '../agent/agent-workspace';
