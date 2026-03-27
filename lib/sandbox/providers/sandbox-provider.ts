import type { ToolResult, PreviewInfo } from '../types'

export interface SandboxProvider {
  readonly name: string

  createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle>
  getSandbox(sandboxId: string): Promise<SandboxHandle>
  destroySandbox(sandboxId: string): Promise<void>

  /** Check if provider is available (configuration/credentials) */
  isAvailable?(): boolean

  /** Health check - verifies API connectivity and sandbox creation capability */
  healthCheck?(): Promise<{ healthy: boolean; latency?: number; details?: any }>
}

export interface SandboxHandle {
  readonly id: string
  readonly workspaceDir: string

  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>
  writeFile(filePath: string, content: string): Promise<ToolResult>
  readFile(filePath: string): Promise<ToolResult>
  listDirectory(dirPath: string): Promise<ToolResult>
  getPreviewLink?(port: number): Promise<PreviewInfo>

  createPty?(options: PtyOptions): Promise<PtyHandle>
  connectPty?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
  killPty?(sessionId: string): Promise<void>
  resizePty?(sessionId: string, cols: number, rows: number): Promise<void>
  
  // Extended capabilities (provider-specific, optional)
  getProviderInfo?(): Promise<ProviderInfo>
  createSnapshot?(label?: string): Promise<any>
  rollbackToSnapshot?(snapshotId: string): Promise<void>
  listSnapshots?(): Promise<any[]>
  deleteSnapshot?(snapshotId: string): Promise<void>
  createCheckpoint?(name?: string): Promise<CheckpointInfo>
  restoreCheckpoint?(checkpointId: string): Promise<void>
  listCheckpoints?(): Promise<CheckpointInfo[]>
  createService?(config: ServiceConfig): Promise<ServiceInfo>
  configureService?(config: ServiceConfig & { autoStop?: 'suspend' | 'stop' }): Promise<ServiceInfo>
  listServices?(): Promise<ServiceInfo[]>
  listSessions?(): Promise<SessionInfo[]>
  attachSession?(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
  
  // Blaxel-specific extensions
  runBatchJob?(tasks: BatchTask[], config?: BatchJobConfig): Promise<BatchJobResult>
  scheduleJob?(schedule: string, tasks?: BatchTask[]): Promise<{ scheduleId: string }>
  executeAsync?(config: AsyncExecutionConfig): Promise<AsyncExecutionResult>
  executeAsyncWithVerifiedCallback?(config: AsyncExecutionConfig & { callbackSecret?: string }): Promise<AsyncExecutionResult & { verified: boolean }>
  streamLogs?(options?: { follow?: boolean; tail?: number; since?: string }): Promise<AsyncIterableIterator<LogEntry>>
  callAgent?(config: { targetAgent: string; input: any; waitForCompletion?: boolean }): Promise<any>
  
  // Sprites-specific extensions
  createProxy?(config: ProxyConfig): Promise<{ pid: number; url: string }>
  getPublicUrl?(): Promise<string>
  updateUrlAuth?(mode: 'public' | 'default'): Promise<void>
  createEnvService?(config: EnvServiceConfig): Promise<ServiceInfo>
  listEnvServices?(): Promise<ServiceInfo[]>
  removeEnvService?(name: string): Promise<void>
  upgrade?(): Promise<void>
  killSession?(sessionId: string): Promise<void>
  syncVfs?(vfsSnapshot: { files: Array<{ path: string; content: string }> }): Promise<{
    success: boolean
    filesSynced: number
    duration: number
    method: 'tar-pipe' | 'individual'
  }>
  syncChangedVfs?(vfsSnapshot: { files: Array<{ path: string; content: string }> }): Promise<{
    success: boolean
    filesSynced: number
    changedFiles: number
    duration: number
  }>
  getServiceStatus?(serviceName: string): Promise<{
    status: 'running' | 'stopped' | 'suspended' | 'unknown'
    port?: number
    url?: string
    lastStarted?: string
    restartCount?: number
  }>
  restartService?(serviceName: string): Promise<{ success: boolean; error?: string }>
  configureHttpService?(port: number): Promise<{ success: boolean; url: string; message?: string }>
  getCheckpointManager?(policy?: Partial<any>): any

  // Desktop/VNC extensions
  createDesktop?(config?: { resolution?: [number, number] }): Promise<{ id: string; streamUrl: string }>

  // MCP Gateway extensions
  getMcpGateway?(config: { serverId: string }): Promise<{ availableTools: any[] }>

  // Status check
  getStatus?(): Promise<{ status: string; uptime?: number }>

  // Provider-specific service accessors (optional, provider-dependent)
  getAmpService?(): { run(config: { prompt: string; workingDir?: string; streamJson?: boolean; model?: string }): Promise<{ output?: string; cost?: number; tokens?: number }> } | undefined
  getCodexService?(): { run(config: { prompt: string; workingDir?: string; fullAuto?: boolean; outputSchemaPath?: string }): Promise<{ output?: string; cost?: number; tokens?: number }> } | undefined
  getComputerUseService?(): { takeRegion?(config: { x?: number; y?: number; width?: number; height?: number }): Promise<{ image: string }>; startRecording?(): Promise<{ recordingId: string }>; stopRecording?(recordingId: string): Promise<{ video: string }> } | undefined
}

/**
 * Provider metadata and status information
 */
export interface ProviderInfo {
  provider: string
  region?: string
  status: 'running' | 'stopped' | 'hibernating' | 'failed' | 'deployed'
  url?: string
  createdAt: string
  lastUsedAt?: string
  expiresIn?: number // seconds until auto-deletion
  plan?: string // Sprites-specific
}

/**
 * Checkpoint information for state snapshots
 */
export interface CheckpointInfo {
  id: string
  name?: string
  createdAt: string
  size?: number // bytes
  comment?: string
}

/**
 * Service configuration for auto-restart processes
 */
export interface ServiceConfig {
  name: string
  command: string
  args?: string[]
  port?: number
  autoStart?: boolean
  workingDir?: string
  env?: Record<string, string>
}

/**
 * Service status information
 */
export interface ServiceInfo {
  id: string
  name: string
  status: 'running' | 'stopped'
  port?: number
  url?: string
}

/**
 * Session information for TTY sessions
 */
export interface SessionInfo {
  id: string
  command: string
  createdAt: string
  isAttached: boolean
  pid?: number
  cwd?: string
}

/**
 * Batch job configuration (Blaxel-specific)
 */
export interface BatchJobConfig {
  name?: string
  runtime?: {
    memory?: number
    timeout?: number
    maxConcurrentTasks?: number
  }
  maxRetries?: number
}

/**
 * Batch task for parallel execution (Blaxel-specific)
 */
export interface BatchTask {
  id?: string
  data: Record<string, any>
}

/**
 * Batch job result (Blaxel-specific)
 */
export interface BatchJobResult {
  jobId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  totalTasks: number
  completedTasks: number
  failedTasks: number
  results: Array<{
    taskId: string
    status: 'success' | 'failed'
    output?: any
    error?: string
  }>
}

/**
 * Async execution configuration (Blaxel-specific)
 */
export interface AsyncExecutionConfig {
  command: string
  callbackUrl?: string
  timeout?: number
}

/**
 * Async execution result (Blaxel-specific)
 */
export interface AsyncExecutionResult {
  executionId: string
  status: 'started' | 'completed' | 'failed'
  callbackUrl?: string
}

/**
 * Log entry for streaming logs (Blaxel-specific)
 */
export interface LogEntry {
  timestamp: string
  message: string
  level?: 'info' | 'warn' | 'error' | 'debug'
}

/**
 * Proxy configuration (Sprites-specific)
 */
export interface ProxyConfig {
  localPort: number
  remotePort: number
  remoteHost?: string
}

/**
 * Service configuration for sprite-env (Sprites-specific)
 */
export interface EnvServiceConfig {
  name: string
  command: string
  args?: string[]
  workingDir?: string
  autoStart?: boolean
}

export interface PtyHandle {
  readonly sessionId: string
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  waitForConnection(): Promise<void>
  wait?(): Promise<{ exitCode: number }>
  disconnect(): Promise<void>
  kill(): Promise<void>
}

export interface PtyOptions {
  id: string  // Session identifier
  cwd?: string
  envs?: Record<string, string>
  cols?: number
  rows?: number
  onData: (data: Uint8Array) => void
}

export interface PtyConnectOptions {
  onData: (data: Uint8Array) => void
}

export interface SandboxCreateConfig {
  language?: string
  autoStopInterval?: number
  resources?: { cpu?: number; memory?: number }
  envVars?: Record<string, string>
  labels?: Record<string, string>
  mounts?: Array<{ source: string; target: string }>
}
