/**
 * Blaxel Provider - Enhanced with Agent-to-Agent, Scheduled Jobs, and Log Streaming
 * 
 * Enhanced Features (per Deep Codebase Audit):
 * - Agent-to-agent calls for multi-agent workflows
 * - Scheduled jobs with cron expressions
 * - Log streaming for real-time monitoring
 * 
 * @see https://docs.blaxel.ai/Agents/Overview
 * @see https://docs.blaxel.ai/Jobs/Overview
 */

import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  BatchJobConfig,
  BatchTask,
  BatchJobResult,
  AsyncExecutionConfig,
  AsyncExecutionResult,
  LogEntry,
} from './sandbox-provider'
import { quotaManager } from '@/lib/services/quota-manager'
import { blaxelAsyncManager, verifyWebhookFromRequest } from './blaxel-async'
import { getDatabase } from '@/lib/database/connection';

const WORKSPACE_DIR = '/workspace'
const MAX_INSTANCES = 50
const INSTANCE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

interface BlaxelSandboxInstance {
  sandbox: any
  metadata: BlaxelSandboxMetadata
  createdAt: number
  lastActive: number
}

interface BlaxelSandboxMetadata {
  name: string
  displayName: string
  region: string
  url: string
  status: string
  expiresIn?: number
  volumes?: Array<{ name: string; mountPath: string }>
}

const sandboxInstances = new Map<string, BlaxelSandboxInstance>()

export class BlaxelProvider implements SandboxProvider {
  readonly name = 'blaxel'
  private client: any = null
  private apiKey: string
  private workspace: string
  private defaultRegion: string
  private defaultImage: string
  private defaultMemory: number
  private defaultTtl: string

  constructor() {
    this.apiKey = process.env.BLAXEL_API_KEY || ''
    this.workspace = process.env.BLAXEL_WORKSPACE || 'default'
    this.defaultRegion = process.env.BLAXEL_DEFAULT_REGION || 'us-pdx-1'
    this.defaultImage = process.env.BLAXEL_DEFAULT_IMAGE || 'blaxel/base-image:latest'
    this.defaultMemory = parseInt(process.env.BLAXEL_DEFAULT_MEMORY || '4096', 10)
    this.defaultTtl = process.env.BLAXEL_DEFAULT_TTL || '24h'

    if (!this.apiKey) {
      console.warn('[Blaxel] BLAXEL_API_KEY not configured')
    }
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client

    try {
      const blaxelSdk = await import('@blaxel/core')
      this.client = new blaxelSdk.default({
        apiKey: this.apiKey,
        workspace: this.workspace,
      })
      return this.client
    } catch (error: any) {
      throw new Error(`Blaxel SDK not available: ${error.message}`)
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const client = await this.ensureClient()

    try {
      if (sandboxInstances.size >= MAX_INSTANCES) {
        let oldestId: string | null = null
        let oldestTime = Date.now()
        for (const [id, instance] of sandboxInstances.entries()) {
          if (instance.createdAt < oldestTime) {
            oldestTime = instance.createdAt
            oldestId = id
          }
        }
        if (oldestId) {
          sandboxInstances.delete(oldestId)
        }
      }

      const languageImageMap: Record<string, string> = {
        typescript: 'blaxel/typescript:latest',
        javascript: 'blaxel/node:latest',
        python: 'blaxel/python:latest',
        go: 'blaxel/go:latest',
        rust: 'blaxel/rust:latest',
      }
      const image = config.language ? (languageImageMap[config.language] || this.defaultImage) : this.defaultImage

      const createParams: any = {
        image,
        region: this.defaultRegion,
        memory: this.defaultMemory,
        ttl: this.defaultTtl,
        envVars: {
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          ...config.envVars,
        },
      }

      const sandbox = await client.sandbox.create(createParams)
      const metadata: BlaxelSandboxMetadata = {
        name: sandbox.name,
        displayName: `binG Sandbox ${sandbox.name}`,
        region: sandbox.region,
        status: sandbox.status,
        url: '',
      }

      const instance: BlaxelSandboxInstance = {
        sandbox,
        metadata,
        createdAt: Date.now(),
        lastActive: Date.now(),
      }

      sandboxInstances.set(sandbox.id, instance)
      quotaManager.recordUsage('blaxel', 1)

      console.log(`[Blaxel] Created sandbox: ${sandbox.id}`)
      return new BlaxelSandboxHandle(sandbox, metadata)
    } catch (error: any) {
      throw new Error(`Blaxel creation failed: ${error.message}`)
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const instance = sandboxInstances.get(sandboxId)
    if (!instance) {
      throw new Error(`Blaxel sandbox ${sandboxId} not found`)
    }
    instance.lastActive = Date.now()
    return new BlaxelSandboxHandle(instance.sandbox, instance.metadata)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const instance = sandboxInstances.get(sandboxId)
    if (instance) {
      try {
        await instance.sandbox.delete()
        console.log(`[Blaxel] Destroyed sandbox: ${sandboxId}`)
      } catch (error: any) {
        console.warn(`[Blaxel] Failed to destroy sandbox ${sandboxId}:`, error.message)
      } finally {
        sandboxInstances.delete(sandboxId)
      }
    }
  }

  /**
   * Call another agent (multi-agent workflow)
   * 
   * @see https://docs.blaxel.ai/Agents/Overview#multi-agent-chaining
   */
  async callAgent(config: {
    targetAgent: string
    input: any
    waitForCompletion?: boolean
  }): Promise<any> {
    const client = await this.ensureClient()
    
    try {
      const response = await client.agents.call({
        name: config.targetAgent,
        input: config.input,
        waitForCompletion: config.waitForCompletion ?? true,
      })
      
      return response.output
    } catch (error: any) {
      console.error('[Blaxel] Agent call failed:', error.message)
      throw error
    }
  }

  /**
   * Schedule a recurring job
   * 
   * @see https://docs.blaxel.ai/Jobs/Scheduling
   */
  async scheduleJob(
    schedule: string, // Cron expression (e.g., '0 9 * * *')
    tasks?: BatchTask[]
  ): Promise<{ scheduleId: string }> {
    const client = await this.ensureClient()
    
    try {
      const response = await client.jobs.schedule({
        schedule,
        tasks: tasks || [],
      })
      
      return { scheduleId: response.id }
    } catch (error: any) {
      console.error('[Blaxel] Job scheduling failed:', error.message)
      throw error
    }
  }

  /**
   * Cancel a scheduled job
   */
  async cancelSchedule(scheduleId: string): Promise<void> {
    const client = await this.ensureClient()
    
    try {
      await client.jobs.cancelSchedule(scheduleId)
    } catch (error: any) {
      console.error('[Blaxel] Schedule cancellation failed:', error.message)
      throw error
    }
  }

  /**
   * Stream logs in real-time
   * 
   * @see https://docs.blaxel.ai/Logs/Streaming
   */
  async streamLogs(options?: {
    follow?: boolean
    tail?: number
    since?: string
  }): Promise<AsyncIterableIterator<LogEntry>> {
    const client = await this.ensureClient()
    
    try {
      const stream = await client.logs.stream({
        follow: options?.follow ?? false,
        tail: options?.tail,
        since: options?.since,
      })
      
      return stream
    } catch (error: any) {
      console.error('[Blaxel] Log streaming failed:', error.message)
      throw error
    }
  }

  /**
   * Run batch job
   */
  async runBatchJob(
    tasks: BatchTask[],
    config?: BatchJobConfig
  ): Promise<BatchJobResult> {
    const client = await this.ensureClient()
    
    try {
      const response = await client.jobs.run({
        tasks,
        config,
      })
      
      return response
    } catch (error: any) {
      console.error('[Blaxel] Batch job failed:', error.message)
      throw error
    }
  }

  /**
   * Execute async with callback
   */
  async executeAsync(config: AsyncExecutionConfig): Promise<AsyncExecutionResult> {
    return blaxelAsyncManager.executeAsync(config)
  }
}

/**
 * Enhanced Blaxel Sandbox Handle
 */
export class BlaxelSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private sandbox: any
  private metadata: BlaxelSandboxMetadata

  constructor(sandbox: any, metadata: BlaxelSandboxMetadata) {
    this.sandbox = sandbox
    this.id = sandbox.id
    this.metadata = metadata
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const result = await this.sandbox.process.executeCommand(command, cwd || this.workspaceDir, timeout)
      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      await this.sandbox.files.write(filePath, content)
      return { success: true, output: `Written ${filePath}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const content = await this.sandbox.files.read(filePath)
      return { success: true, output: content }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const files = await this.sandbox.files.list(dirPath)
      return {
        success: true,
        output: files.map((f: any) => f.name).join('\n'),
      }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    return {
      url: `https://${this.id}-${port}.blaxel.app`,
      port,
    }
  }

  async kill(): Promise<void> {
    try {
      await this.sandbox.delete()
      console.log(`[Blaxel] Deleted sandbox: ${this.id}`)
    } catch (error: any) {
      console.error('[Blaxel] Kill error:', error)
    }
  }

  async getInfo(): Promise<{
    id: string
    name: string
    url: string
    status: string
    region: string
  }> {
    return {
      id: this.id,
      name: this.metadata.name,
      url: this.metadata.url,
      status: this.metadata.status,
      region: this.metadata.region,
    }
  }
}

// Export singleton instance
export const blaxelProvider = new BlaxelProvider()
