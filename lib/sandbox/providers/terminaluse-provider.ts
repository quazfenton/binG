/**
 * TerminalUse Provider
 *
 * Cloud agents with persistent filesystems and sandboxed compute.
 * TerminalUse provides AI agent infrastructure with:
 * - Persistent filesystems across task executions (/workspace mount)
 * - Task/event streaming for real-time interaction
 * - State management for agent memory (per task/agent)
 * - Sandboxed Python runtime with system folders
 * - Agent-to-Client Protocol (ACP) for task creation
 *
 * Core Model:
 * - Namespace: Isolation boundary for compute/storage
 * - Project: Collaboration and permission boundary for filesystems
 * - Filesystem: Persistent files mounted at /workspace
 * - Agent: Deployed Python runtime (versions via branches)
 * - Task: One running conversation/unit of work
 * - Event: Input sent to task (user text/data)
 * - Message: Output emitted by agent
 * - State: Per-task persisted JSON
 *
 * Task Lifecycle:
 * 1. Create task → on_create handler
 * 2. Send events → on_event handler
 * 3. Cancel task → on_cancel handler
 *
 * @see https://docs.terminaluse.com/
 * @see https://docs.terminaluse.com/concepts/core-model
 * @see https://docs.terminaluse.com/concepts/task-lifecycle
 *
 * @example
 * ```typescript
 * import { TerminalUseProvider } from './terminaluse-provider'
 *
 * const provider = new TerminalUseProvider()
 * const handle = await provider.createSandbox({
 *   envVars: {
 *     OPENAI_API_KEY: process.env.OPENAI_API_KEY,
 *   },
 *   labels: {
 *     project_id: 'proj_xxxxx', // Links to a project for filesystem
 *   },
 * })
 *
 * // Execute commands
 * const result = await handle.executeCommand('python --version')
 *
 * // Create a task for agent execution
 * const task = await handle.createTask({
 *   agent_name: 'my-namespace/my-agent',
 *   params: { goal: 'refactor the codebase' },
 * })
 *
 * // Stream task events
 * for await (const event of handle.streamTask(task.id)) {
 *   console.log('Event:', event)
 * }
 * ```
 */

import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  ProviderInfo,
  CheckpointInfo,
  ServiceConfig,
  ServiceInfo,
  BatchJobConfig,
  BatchTask,
  BatchJobResult,
  AsyncExecutionConfig,
  AsyncExecutionResult,
  LogEntry,
} from './sandbox-provider'
import type { ToolResult, PreviewInfo } from '../types'
import { SandboxSecurityManager } from '../security-manager'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('TerminalUse:Provider')

const WORKSPACE_DIR = '/workspace'
const DEFAULT_TIMEOUT_SECONDS = 3600 // 1 hour
const HEALTH_CHECK_INTERVAL_MS = 500
const HEALTH_CHECK_MAX_ATTEMPTS = 60 // ~30 seconds

// ---------------------------------------------------------------------------
// TerminalUse API Types
// ---------------------------------------------------------------------------

export interface TerminalUseTask {
  id: string
  agent_name?: string
  filesystem_id: string
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TERMINATED' | 'TIMED_OUT' | 'DELETED'
  params: Record<string, unknown>
  created_at: string
  updated_at: string
  branch?: string
  name?: string
  project_id?: string
}

export interface TerminalUseEvent {
  id: string
  task_id: string
  agent_id: string
  sequence_id: number
  content: {
    type: 'text' | 'data'
    text?: string
    data?: Record<string, unknown>
  }
  created_at: string
}

export interface TerminalUseFilesystem {
  id: string
  name: string
  project_id: string
  namespace_id: string
  status: 'CREATING' | 'READY' | 'ARCHIVED' | 'DELETED'
  created_at: string
  updated_at: string
  last_synced_at?: string
  archive_size_bytes?: number
}

export interface TerminalUseAgent {
  id: string
  name: string
  namespace_id: string
  status: 'DEPLOYED' | 'BUILDING' | 'FAILED' | 'DELETED'
  created_at: string
  updated_at: string
  branch?: string
  version?: string
}

export interface TerminalUseState {
  id: string
  task_id: string
  agent_id: string
  state: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface TerminalUseMessage {
  id: string
  task_id: string
  agent_id: string
  content: string
  role: 'user' | 'assistant' | 'system'
  created_at: string
}

// ---------------------------------------------------------------------------
// TerminalUse Client
// ---------------------------------------------------------------------------

export class TerminalUseClient {
  private baseUrl: string
  private apiKey: string
  private headers: HeadersInit

  constructor(config: { apiKey: string; environment?: string }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.environment || 'https://api.terminaluse.com'
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...(options.headers || {}) },
    })

    if (!res.ok) {
      const error = await res.text().catch(() => 'Unknown error')
      throw new Error(`TerminalUse API error (${res.status}): ${error}`)
    }

    // Handle 204 No Content
    if (res.status === 204) {
      return {} as T
    }

    return res.json() as Promise<T>
  }

  // === Tasks ===

  async createTask(body: {
    agent_name?: string
    agent_id?: string
    filesystem_id?: string
    project_id?: string
    branch?: string
    name?: string
    params?: Record<string, unknown>
  }): Promise<TerminalUseTask> {
    return this.request<TerminalUseTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getTask(taskId: string): Promise<TerminalUseTask> {
    return this.request<TerminalUseTask>(`/tasks/${taskId}`)
  }

  async listTasks(params?: { limit?: number; page_number?: number; status?: string }): Promise<TerminalUseTask[]> {
    const query = new URLSearchParams({
      ...(params?.limit && { limit: String(params.limit) }),
      ...(params?.page_number && { page_number: String(params.page_number) }),
      ...(params?.status && { status: params.status }),
    })
    return this.request<TerminalUseTask[]>(`/tasks?${query}`)
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request(`/tasks/${taskId}/cancel`, { method: 'POST' })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request(`/tasks/${taskId}`, { method: 'DELETE' })
  }

  async updateTask(taskId: string, body: { params?: Record<string, unknown>; status?: string }): Promise<TerminalUseTask> {
    return this.request<TerminalUseTask>(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  // === Events ===

  async sendEvent(
    taskId: string,
    content: { type: 'text' | 'data'; text?: string; data?: Record<string, unknown> },
    opts?: { idempotency_key?: string; persist_message?: boolean }
  ): Promise<TerminalUseEvent> {
    return this.request<TerminalUseEvent>(`/tasks/${taskId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        idempotency_key: opts?.idempotency_key,
        persist_message: opts?.persist_message ?? true,
      }),
    })
  }

  async listEvents(taskId: string): Promise<TerminalUseEvent[]> {
    return this.request<TerminalUseEvent[]>(`/tasks/${taskId}/events`)
  }

  async getEvent(eventId: string): Promise<TerminalUseEvent> {
    return this.request<TerminalUseEvent>(`/events/${eventId}`)
  }

  // === Streaming ===

  async *streamTask(taskId: string, signal?: AbortSignal): AsyncGenerator<TerminalUseEvent> {
    const url = `${this.baseUrl}/tasks/${taskId}/stream`
    const res = await fetch(url, {
      headers: { ...this.headers, Accept: 'text/event-stream' },
      signal,
    })

    if (!res.ok || !res.body) {
      throw new Error('Stream failed')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6)) as TerminalUseEvent
            } catch {
              // Yield raw event for non-JSON data
              yield {
                id: 'raw',
                task_id: taskId,
                agent_id: 'unknown',
                sequence_id: 0,
                content: { type: 'text', text: line.slice(6) },
                created_at: new Date().toISOString(),
              } as TerminalUseEvent
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // === Filesystems ===

  async createFilesystem(body: { project_id: string; name: string }): Promise<TerminalUseFilesystem> {
    return this.request<TerminalUseFilesystem>('/filesystems', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getFilesystem(filesystemId: string): Promise<TerminalUseFilesystem> {
    return this.request<TerminalUseFilesystem>(`/filesystems/${filesystemId}`)
  }

  async listFilesystems(params?: { project_id?: string }): Promise<TerminalUseFilesystem[]> {
    const query = params?.project_id ? `?project_id=${params.project_id}` : ''
    return this.request<TerminalUseFilesystem[]>(`/filesystems${query}`)
  }

  async listFiles(params: { filesystem_id: string; path?: string; recursive?: boolean }): Promise<{ path: string; size: number; type: string }[]> {
    const query = new URLSearchParams({
      recursive: String(params.recursive ?? true),
      ...(params.path && { path: params.path }),
    })
    return this.request(`/filesystems/${params.filesystem_id}/files?${query}`)
  }

  async getFile(params: { filesystem_id: string; file_path: string; include_content?: boolean }): Promise<{
    path: string
    size: number
    content?: string
    metadata: Record<string, unknown>
  }> {
    const query = new URLSearchParams({ include_content: String(params.include_content ?? true) })
    return this.request(`/filesystems/${params.filesystem_id}/files/${encodeURIComponent(params.file_path)}?${query}`)
  }

  async uploadFile(params: { filesystem_id: string; file_path: string; content: string }): Promise<void> {
    await this.request(`/filesystems/${params.filesystem_id}/files/${encodeURIComponent(params.file_path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content: params.content }),
    })
  }

  async deleteFile(params: { filesystem_id: string; file_path: string }): Promise<void> {
    await this.request(`/filesystems/${params.filesystem_id}/files/${encodeURIComponent(params.file_path)}`, {
      method: 'DELETE',
    })
  }

  async getUploadUrl(filesystemId: string): Promise<{ url: string; expires_at: string }> {
    return this.request(`/filesystems/${filesystemId}/upload-url`)
  }

  async getDownloadUrl(filesystemId: string): Promise<{ url: string; expires_at: string }> {
    return this.request(`/filesystems/${filesystemId}/download-url`)
  }

  // === State ===

  async createState(body: { task_id: string; agent_id: string; state: Record<string, unknown> }): Promise<TerminalUseState> {
    return this.request<TerminalUseState>('/states', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async getState(taskId: string, agentId: string): Promise<TerminalUseState> {
    return this.request<TerminalUseState>(`/states?task_id=${taskId}&agent_id=${agentId}`)
  }

  async updateState(taskId: string, agentId: string, state: Record<string, unknown>): Promise<TerminalUseState> {
    return this.request<TerminalUseState>(`/states?task_id=${taskId}&agent_id=${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    })
  }

  async deleteState(taskId: string, agentId: string): Promise<void> {
    await this.request(`/states?task_id=${taskId}&agent_id=${agentId}`, { method: 'DELETE' })
  }

  // === Messages ===

  async listMessages(taskId: string): Promise<TerminalUseMessage[]> {
    return this.request<TerminalUseMessage[]>(`/tasks/${taskId}/messages`)
  }

  async getMessage(messageId: string): Promise<TerminalUseMessage> {
    return this.request<TerminalUseMessage>(`/messages/${messageId}`)
  }

  // === Agents ===

  async listAgents(): Promise<TerminalUseAgent[]> {
    return this.request<TerminalUseAgent[]>('/agents')
  }

  async getAgent(agentId: string): Promise<TerminalUseAgent> {
    return this.request<TerminalUseAgent>(`/agents/${agentId}`)
  }

  async getAgentByName(name: string): Promise<TerminalUseAgent> {
    return this.request<TerminalUseAgent>(`/agents/by-name/${name}`)
  }

  async deployAgent(body: {
    name: string
    branch?: string
    environment?: string
    env_vars?: Record<string, string>
  }): Promise<TerminalUseAgent> {
    return this.request<TerminalUseAgent>('/agents/deploy', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request(`/agents/${agentId}`, { method: 'DELETE' })
  }

  // === Projects ===

  async createProject(body: { namespace_id: string; name: string }): Promise<{ id: string; name: string; namespace_id: string }> {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async listProjects(): Promise<{ id: string; name: string; namespace_id: string }[]> {
    return this.request('/projects')
  }

  async getProject(projectId: string): Promise<{ id: string; name: string; namespace_id: string }> {
    return this.request(`/projects/${projectId}`)
  }

  async updateProject(projectId: string, body: { name?: string }): Promise<{ id: string; name: string; namespace_id: string }> {
    return this.request(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request(`/projects/${projectId}`, { method: 'DELETE' })
  }

  // === Namespaces ===

  async listNamespaces(): Promise<{ id: string; name: string; slug: string }[]> {
    return this.request('/namespaces')
  }

  async getNamespace(namespaceId: string): Promise<{ id: string; name: string; slug: string }> {
    return this.request(`/namespaces/${namespaceId}`)
  }

  async getNamespaceBySlug(slug: string): Promise<{ id: string; name: string; slug: string }> {
    return this.request(`/namespaces/by-slug/${slug}`)
  }

  async createNamespace(body: { name: string; slug?: string }): Promise<{ id: string; name: string; slug: string }> {
    return this.request('/namespaces', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  // === Branches ===

  async listBranches(agentId?: string): Promise<{ id: string; name: string; agent_id: string; environment: string }[]> {
    const query = agentId ? `?agent_id=${agentId}` : ''
    return this.request(`/branches${query}`)
  }

  async getBranch(branchId: string): Promise<{ id: string; name: string; agent_id: string; environment: string; version_id: string }> {
    return this.request(`/branches/${branchId}`)
  }

  async listBranchVersions(branchId: string): Promise<{ id: string; created_at: string; version_number: number }[]> {
    return this.request(`/branches/${branchId}/versions`)
  }

  async redeployBranch(branchId: string): Promise<{ id: string; status: string }> {
    return this.request(`/branches/${branchId}/redeploy`, {
      method: 'POST',
    })
  }

  // === Versions ===

  async getVersion(versionId: string): Promise<{ id: string; agent_id: string; created_at: string; version_number: number }> {
    return this.request(`/versions/${versionId}`)
  }

  async listVersions(agentId?: string): Promise<{ id: string; agent_id: string; created_at: string; version_number: number }[]> {
    const query = agentId ? `?agent_id=${agentId}` : ''
    return this.request(`/versions${query}`)
  }
}

// ---------------------------------------------------------------------------
// Internal Records
// ---------------------------------------------------------------------------

interface TerminalUseSandboxRecord {
  id: string
  taskId?: string
  filesystemId?: string
  agentId?: string
  projectId?: string
  client: TerminalUseClient
}

const terminalUseHandles = new Map<string, TerminalUseSandboxHandle>()

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class TerminalUseProvider implements SandboxProvider {
  readonly name = 'terminaluse'
  private client?: TerminalUseClient

  constructor() {}

  private getClient(): TerminalUseClient {
    if (!this.client) {
      const apiKey = process.env.TERMINALUSE_API_KEY
      if (!apiKey) {
        throw new Error('TERMINALUSE_API_KEY is not configured')
      }
      this.client = new TerminalUseClient({
        apiKey,
        environment: process.env.TERMINALUSE_BASE_URL,
      })
    }
    return this.client
  }

  isAvailable(): boolean {
    return !!process.env.TERMINALUSE_API_KEY
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const startTime = Date.now()
    try {
      const client = this.getClient()
      // Try to list agents as a health check
      await client.listAgents()
      const latency = Date.now() - startTime
      return { healthy: true, latency, details: { status: 'ok' } }
    } catch (error: any) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        details: { error: error.message },
      }
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const client = this.getClient()
    const sandboxId = `tu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    logger.info(`Creating TerminalUse sandbox: ${sandboxId}`)

    try {
      // Create a project if project_id is provided in labels
      let projectId: string | undefined
      if (config.labels?.project_id) {
        projectId = config.labels.project_id
      }

      // Create filesystem for persistent storage
      let filesystemId: string | undefined
      if (projectId) {
        const fs = await client.createFilesystem({
          project_id: projectId,
          name: `workspace-${sandboxId}`,
        })
        filesystemId = fs.id
        logger.info(`Created filesystem: ${filesystemId}`)
      }

      // Create initial task (idle state)
      const task = await client.createTask({
        name: `sandbox-${sandboxId}`,
        filesystem_id: filesystemId,
        project_id: projectId,
        params: {
          type: 'sandbox',
          language: config.language || 'typescript',
          ...config.envVars,
        },
      })

      const record: TerminalUseSandboxRecord = {
        id: sandboxId,
        taskId: task.id,
        filesystemId,
        projectId,
        client,
      }

      const handle = new TerminalUseSandboxHandle(record)
      terminalUseHandles.set(sandboxId, handle)

      logger.info(`TerminalUse sandbox created: ${sandboxId}, task: ${task.id}`)

      return handle as unknown as SandboxHandle
    } catch (error: any) {
      logger.error(`Failed to create TerminalUse sandbox: ${error.message}`)
      throw error
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const existing = terminalUseHandles.get(sandboxId)
    if (existing) {
      return existing
    }

    const client = this.getClient()
    const task = await client.getTask(sandboxId.replace(/^tu-/, ''))

    const record: TerminalUseSandboxRecord = {
      id: sandboxId,
      taskId: task.id,
      filesystemId: task.filesystem_id,
      projectId: task.project_id,
      client,
    }

    const handle = new TerminalUseSandboxHandle(record)
    terminalUseHandles.set(sandboxId, handle)
    return handle as unknown as SandboxHandle
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = terminalUseHandles.get(sandboxId)
    if (handle) {
      await handle.cleanup()
      terminalUseHandles.delete(sandboxId)
    }

    const client = this.getClient()
    const taskId = sandboxId.replace(/^tu-/, '')

    try {
      await client.cancelTask(taskId)
      logger.info(`TerminalUse sandbox destroyed: ${sandboxId}`)
    } catch (error: any) {
      logger.warn(`Failed to cancel task ${taskId}: ${error.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

export class TerminalUseSandboxHandle implements SandboxHandle {
  readonly workspaceDir = WORKSPACE_DIR
  readonly id: string
  private record: TerminalUseSandboxRecord
  private currentTaskId?: string

  constructor(record: TerminalUseSandboxRecord) {
    this.record = record
    this.id = record.id
    this.currentTaskId = record.taskId
  }

  private getClient(): TerminalUseClient {
    return this.record.client
  }

  // -- Cleanup --

  async cleanup(): Promise<void> {
    if (this.currentTaskId) {
      try {
        await this.getClient().cancelTask(this.currentTaskId)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // -- SandboxHandle: Standard Operations --

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const sanitized = SandboxSecurityManager.sanitizeCommand(command)
      const safeCwd = cwd
        ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd)
        : this.workspaceDir

      // Create a new task for command execution
      const client = this.getClient()
      const task = await client.createTask({
        name: `cmd-${Date.now()}`,
        filesystem_id: this.record.filesystemId,
        params: {
          type: 'command',
          command: sanitized,
          cwd: safeCwd,
          timeout: timeout || 300, // 5 minutes default
        },
      })

      // Wait for task completion by polling
      const maxAttempts = timeout ? Math.floor(timeout / 2) : 150
      for (let i = 0; i < maxAttempts; i++) {
        const status = await client.getTask(task.id)
        if (status.status === 'COMPLETED') {
          break
        }
        if (status.status === 'FAILED' || status.status === 'CANCELED') {
          return {
            success: false,
            output: `Task failed with status: ${status.status}`,
            exitCode: 1,
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      // Get events for output
      const events = await client.listEvents(task.id)
      const stdout = events
        .filter((e) => e.content.type === 'text')
        .map((e) => e.content.text)
        .join('\n')

      return {
        success: true,
        output: stdout || 'Command executed',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message || 'TerminalUse command execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    if (!this.record.filesystemId) {
      return {
        success: false,
        output: 'No filesystem attached to this sandbox',
        exitCode: 1,
      }
    }

    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const client = this.getClient()
      await client.uploadFile({
        filesystem_id: this.record.filesystemId,
        file_path: resolved,
        content,
      })
      return {
        success: true,
        output: `File written: ${resolved}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message || 'Failed to write file',
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    if (!this.record.filesystemId) {
      return {
        success: false,
        output: 'No filesystem attached to this sandbox',
        exitCode: 1,
      }
    }

    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
      const client = this.getClient()
      const file = await client.getFile({
        filesystem_id: this.record.filesystemId,
        file_path: resolved,
        include_content: true,
      })
      return {
        success: true,
        output: file.content || '',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message || 'Failed to read file',
        exitCode: 1,
      }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    if (!this.record.filesystemId) {
      return {
        success: false,
        output: 'No filesystem attached to this sandbox',
        exitCode: 1,
      }
    }

    try {
      const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath || '.')
      const client = this.getClient()
      const files = await client.listFiles({
        filesystem_id: this.record.filesystemId,
        path: resolved,
        recursive: false,
      })
      const output = files.map((f) => `${f.type === 'directory' ? 'd' : '-'} ${f.path} (${f.size} bytes)`).join('\n')
      return {
        success: true,
        output: output || 'Directory is empty',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message || 'Failed to list directory',
        exitCode: 1,
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    // TerminalUse doesn't support port previews directly
    // Return a placeholder URL
    return {
      port,
      url: `https://${this.id}.terminaluse.app:${port}`,
    }
  }

  // -- TerminalUse-Specific Operations --

  /**
   * Create a new task for agent execution
   */
  async createTask(config: {
    agent_name?: string
    params?: Record<string, unknown>
    branch?: string
  }): Promise<TerminalUseTask> {
    const client = this.getClient()
    const task = await client.createTask({
      agent_name: config.agent_name,
      filesystem_id: this.record.filesystemId,
      project_id: this.record.projectId,
      branch: config.branch,
      params: config.params || {},
    })
    this.currentTaskId = task.id
    return task
  }

  /**
   * Send an event to a task
   */
  async sendEvent(
    taskId: string,
    content: string | Record<string, unknown>,
    opts?: { persist_message?: boolean }
  ): Promise<TerminalUseEvent> {
    const client = this.getClient()
    return client.sendEvent(
      taskId,
      typeof content === 'string' ? { type: 'text', text: content } : { type: 'data', data: content },
      opts
    )
  }

  /**
   * Stream events from a task
   */
  async *streamTask(taskId: string, signal?: AbortSignal): AsyncGenerator<TerminalUseEvent> {
    const client = this.getClient()
    yield* client.streamTask(taskId, signal)
  }

  /**
   * Get task state
   */
  async getState(agentId: string): Promise<Record<string, unknown>> {
    if (!this.currentTaskId) {
      throw new Error('No active task to get state from')
    }
    const client = this.getClient()
    const state = await client.getState(this.currentTaskId, agentId)
    return state.state
  }

  /**
   * Update task state
   */
  async updateState(agentId: string, state: Record<string, unknown>): Promise<void> {
    if (!this.currentTaskId) {
      throw new Error('No active task to update state')
    }
    const client = this.getClient()
    await client.updateState(this.currentTaskId, agentId, state)
  }

  /**
   * Get task messages
   */
  async getMessages(): Promise<TerminalUseMessage[]> {
    if (!this.currentTaskId) {
      throw new Error('No active task to get messages from')
    }
    const client = this.getClient()
    return client.listMessages(this.currentTaskId)
  }

  /**
   * Cancel current task
   */
  async cancelTask(): Promise<void> {
    if (!this.currentTaskId) {
      return
    }
    const client = this.getClient()
    await client.cancelTask(this.currentTaskId)
    this.currentTaskId = undefined
  }

  /**
   * Get current task
   */
  getCurrentTaskId(): string | undefined {
    return this.currentTaskId
  }

  /**
   * Get filesystem ID
   */
  getFilesystemId(): string | undefined {
    return this.record.filesystemId
  }

  // -- Extended Capabilities (Blaxel-style) --

  async runBatchJob(tasks: BatchTask[], config?: BatchJobConfig): Promise<BatchJobResult> {
    // Execute tasks sequentially (TerminalUse doesn't have native batch jobs)
    const results: Array<{ taskId: string; status: 'success' | 'failed'; output?: any; error?: string }> = []

    for (const task of tasks) {
      try {
        const tuTask = await this.createTask({
          params: task.data,
        })
        results.push({
          taskId: tuTask.id,
          status: 'success',
          output: tuTask,
        })
      } catch (error: any) {
        results.push({
          taskId: task.id || 'unknown',
          status: 'failed',
          error: error.message,
        })
      }
    }

    return {
      jobId: `batch-${Date.now()}`,
      status: results.every((r) => r.status === 'success') ? 'completed' : 'failed',
      totalTasks: tasks.length,
      completedTasks: results.filter((r) => r.status === 'success').length,
      failedTasks: results.filter((r) => r.status === 'failed').length,
      results,
    }
  }

  async executeAsync(config: AsyncExecutionConfig): Promise<AsyncExecutionResult> {
    const task = await this.createTask({
      params: {
        type: 'async',
        command: config.command,
        timeout: config.timeout,
      },
    })

    return {
      executionId: task.id,
      status: 'started',
    }
  }

  async streamLogs(options?: { follow?: boolean; tail?: number; since?: string }): Promise<AsyncIterableIterator<LogEntry>> {
    const self = this
    const client = this.getClient()
    
    return (async function* () {
      if (!self.currentTaskId) {
        return
      }

      const events = await client.listEvents(self.currentTaskId)

      let filteredEvents = events
      if (options?.since) {
        const sinceTime = new Date(options.since).getTime()
        filteredEvents = events.filter((e) => new Date(e.created_at).getTime() > sinceTime)
      }
      if (options?.tail) {
        filteredEvents = filteredEvents.slice(-options.tail)
      }

      for (const event of filteredEvents) {
        yield {
          timestamp: event.created_at,
          message: event.content.text || JSON.stringify(event.content.data),
          level: 'info',
        }
      }

      if (options?.follow) {
        // Stream new events
        for await (const event of self.streamTask(self.currentTaskId)) {
          yield {
            timestamp: event.created_at,
            message: event.content.text || JSON.stringify(event.content.data),
            level: 'info',
          }
        }
      }
    })()
  }

  async callAgent(config: { targetAgent: string; input: any; waitForCompletion?: boolean }): Promise<any> {
    const task = await this.createTask({
      agent_name: config.targetAgent,
      params: config.input,
    })

    if (config.waitForCompletion !== false) {
      // Poll for completion
      const client = this.getClient()
      while (true) {
        const status = await client.getTask(task.id)
        if (status.status === 'COMPLETED') {
          const messages = await client.listMessages(task.id)
          return messages[messages.length - 1]?.content || task
        }
        if (status.status === 'FAILED' || status.status === 'CANCELED') {
          throw new Error(`Agent execution failed: ${status.status}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }

    return task
  }

  async getProviderInfo(): Promise<ProviderInfo> {
    return {
      provider: 'terminaluse',
      status: 'running',
      url: `https://app.terminaluse.com/tasks/${this.currentTaskId || this.id}`,
      createdAt: new Date().toISOString(),
    }
  }

  async createSnapshot(label?: string): Promise<CheckpointInfo> {
    // TerminalUse uses filesystems for persistence
    // Snapshots would be filesystem archives
    if (!this.record.filesystemId) {
      throw new Error('No filesystem to snapshot')
    }
    const client = this.getClient()
    const fs = await client.getFilesystem(this.record.filesystemId)
    return {
      id: this.record.filesystemId,
      name: label || fs.name,
      createdAt: fs.updated_at,
      size: fs.archive_size_bytes,
    }
  }

  async listSnapshots(): Promise<CheckpointInfo[]> {
    if (!this.record.projectId) {
      return []
    }
    const client = this.getClient()
    const filesystems = await client.listFilesystems({ project_id: this.record.projectId })
    return filesystems.map((fs) => ({
      id: fs.id,
      name: fs.name,
      createdAt: fs.created_at,
      size: fs.archive_size_bytes,
    }))
  }

  // Placeholder implementations for optional capabilities
  async createCheckpoint?(name?: string): Promise<CheckpointInfo> {
    return this.createSnapshot(name)
  }

  async listCheckpoints?(): Promise<CheckpointInfo[]> {
    return this.listSnapshots()
  }

  async createService?(config: ServiceConfig): Promise<ServiceInfo> {
    // TerminalUse doesn't have native services - tasks are the unit of execution
    const task = await this.createTask({
      params: {
        type: 'service',
        name: config.name,
        command: config.command,
        args: config.args,
        port: config.port,
      },
    })
    return {
      id: task.id,
      name: config.name,
      status: 'running',
      port: config.port,
    }
  }

  async listServices?(): Promise<ServiceInfo[]> {
    if (!this.record.projectId) {
      return []
    }
    const client = this.getClient()
    const tasks = await client.listTasks({ status: 'RUNNING' })
    return tasks.map((t) => ({
      id: t.id,
      name: t.name || 'Unnamed',
      status: 'running',
    }))
  }
}
