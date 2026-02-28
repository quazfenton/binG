/**
 * Sprites Provider - Enhanced with Auto-Suspend, HTTP Service, and Checkpoint Metadata
 * 
 * Enhanced Features (per Deep Codebase Audit):
 * - Auto-suspend with memory state preservation
 * - HTTP service configuration
 * - Checkpoint manager with metadata/tags/filters
 * 
 * @see https://docs.sprites.dev/working-with-sprites
 */

import type { ToolResult, PreviewInfo } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
  ProxyConfig,
  EnvServiceConfig,
  ServiceInfo,
} from './sandbox-provider'
import { quotaManager } from '@/lib/services/quota-manager'
import { syncVfsSnapshotToSprite, syncChangedFilesToSprite, type TarSyncFile } from './sprites-tar-sync'
import { SpritesCheckpointManager, createCheckpointManager, type RetentionPolicy } from './sprites-checkpoint-manager'

const WORKSPACE_DIR = '/home/sprite/workspace'
const MAX_INSTANCES = 30
const INSTANCE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

interface SpritesSandboxInstance {
  sprite: any
  metadata: SpritesSandboxMetadata
  createdAt: number
  lastActive: number
}

interface SpritesSandboxMetadata {
  name: string
  url: string
  region: string
  plan: string
  status: 'running' | 'stopped' | 'hibernating'
}

const sandboxInstances = new Map<string, SpritesSandboxInstance>()

export class SpritesProvider implements SandboxProvider {
  readonly name = 'sprites'
  private client: any = null
  private token: string
  private defaultRegion: string
  private defaultPlan: string
  private enableCheckpoints: boolean
  private enableAutoServices: boolean
  private enableAutoSuspend: boolean

  constructor() {
    this.token = process.env.SPRITES_TOKEN || ''
    this.defaultRegion = process.env.SPRITES_DEFAULT_REGION || 'iad'
    this.defaultPlan = process.env.SPRITES_DEFAULT_PLAN || 'standard-1'
    this.enableCheckpoints = process.env.SPRITES_ENABLE_CHECKPOINTS !== 'false'
    this.enableAutoServices = process.env.SPRITES_AUTO_SERVICES === 'true'
    this.enableAutoSuspend = process.env.SPRITES_ENABLE_AUTO_SUSPEND !== 'false'

    if (!this.token) {
      console.warn('[Sprites] SPRITES_TOKEN not configured')
    }
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client

    try {
      const { SpritesClient } = await import('@fly/sprites')
      this.client = new SpritesClient(this.token, {
        baseURL: 'https://api.sprites.dev',
        timeout: 30000,
      })
      return this.client
    } catch (error: any) {
      throw new Error(`Sprites SDK not available: ${error.message}`)
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

      const spriteName = `bing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Build create config with auto-suspend services
      const createConfig: any = {}

      if (this.enableAutoSuspend) {
        // Configure service for auto-suspend with memory state preservation
        createConfig.config = {
          services: [{
            protocol: 'tcp',
            internal_port: 8080,
            autostart: true,
            autostop: 'suspend', // 'suspend' saves memory state, 'stop' only saves disk
          }]
        }
        console.log(`[Sprites] Auto-suspend enabled for Sprite: ${spriteName}`)
      }

      const sprite = await client.createSprite(spriteName, createConfig)
      await this.waitForSpriteReady(sprite, 30000)

      const now = Date.now()
      const metadata: SpritesSandboxMetadata = {
        name: spriteName,
        url: `https://${spriteName}.sprites.app`,
        region: this.defaultRegion,
        plan: this.defaultPlan,
        status: 'running',
      }

      const instance: SpritesSandboxInstance = {
        sprite,
        metadata,
        createdAt: now,
        lastActive: now,
      }

      sandboxInstances.set(spriteName, instance)
      quotaManager.recordUsage('sprites')

      console.log(`[Sprites] Created Sprite: ${spriteName}, URL: ${metadata.url}`)

      const handle = new SpritesSandboxHandle(
        sprite,
        metadata,
        this.enableCheckpoints,
        this.enableAutoServices,
        false,
        this.enableAutoSuspend
      )

      await handle.setupWorkspace()
      return handle
    } catch (error: any) {
      console.error('[Sprites] Failed to create Sprite:', error.message)
      throw new Error(`Sprites creation failed: ${error.message}`)
    }
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const instance = sandboxInstances.get(sandboxId)
    if (!instance) {
      const client = await this.ensureClient()
      try {
        const sprite = await client.getSprite(sandboxId)
        const metadata: SpritesSandboxMetadata = {
          name: sandboxId,
          url: `https://${sandboxId}.sprites.app`,
          region: this.defaultRegion,
          plan: this.defaultPlan,
          status: 'running',
        }
        const handle = new SpritesSandboxHandle(
          sprite,
          metadata,
          this.enableCheckpoints,
          this.enableAutoServices,
          true,
          this.enableAutoSuspend
        )
        return handle
      } catch (error: any) {
        throw new Error(`Sprites ${sandboxId} not found: ${error.message}`)
      }
    }

    instance.lastActive = Date.now()
    return new SpritesSandboxHandle(
      instance.sprite,
      instance.metadata,
      this.enableCheckpoints,
      this.enableAutoServices
    )
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const instance = sandboxInstances.get(sandboxId)
    if (instance) {
      try {
        await instance.sprite.delete()
        console.log(`[Sprites] Destroyed Sprite: ${sandboxId}`)
      } catch (error: any) {
        console.warn(`[Sprites] Failed to destroy Sprite ${sandboxId}:`, error.message)
      } finally {
        sandboxInstances.delete(sandboxId)
      }
    }
  }

  private async waitForSpriteReady(sprite: any, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      try {
        await sprite.execFile('echo', ['ready'])
        return
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw new Error(`Sprite did not become ready within ${timeoutMs}ms`)
  }
}

/**
 * Enhanced Sprites Sandbox Handle with Auto-Suspend, HTTP Service, and Checkpoint Metadata
 */
export class SpritesSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private sprite: any
  private metadata: SpritesSandboxMetadata
  private enableCheckpoints: boolean
  private enableAutoServices: boolean
  private isReconnect: boolean
  private enableAutoSuspend: boolean
  private checkpointManager?: SpritesCheckpointManager

  constructor(
    sprite: any,
    metadata: SpritesSandboxMetadata,
    enableCheckpoints: boolean,
    enableAutoServices: boolean,
    isReconnect: boolean = false,
    enableAutoSuspend: boolean = false
  ) {
    this.sprite = sprite
    this.id = sprite.name || metadata.name
    this.metadata = metadata
    this.enableCheckpoints = enableCheckpoints
    this.enableAutoServices = enableAutoServices
    this.isReconnect = isReconnect
    this.enableAutoSuspend = enableAutoSuspend
  }

  /**
   * Configure service with auto-suspend support
   * 
   * @see https://docs.sprites.dev/working-with-sprites#auto-suspend
   */
  async configureService(config: {
    name: string
    command: string
    args?: string[]
    port?: number
    autoStart?: boolean
    autoStop?: 'suspend' | 'stop'
  }): Promise<ServiceInfo> {
    try {
      const args = [
        'sprite-env',
        'services',
        'create',
        config.name,
        '--cmd',
        config.command,
      ]

      if (config.args && config.args.length > 0) {
        args.push('--args', ...config.args)
      }

      if (config.port) {
        args.push('--port', config.port.toString())
      }

      if (config.autoStart) {
        args.push('--auto-start')
      }

      if (config.autoStop === 'suspend') {
        args.push('--auto-suspend') // Preserves memory state
      } else if (config.autoStop === 'stop') {
        args.push('--auto-stop') // Only saves disk
      }

      const result = await this.sprite.execFile('sprite', args)
      const service = JSON.parse(result.stdout)

      return {
        id: service.id || config.name,
        name: config.name,
        status: service.status || 'running',
        port: config.port,
        url: service.url,
      }
    } catch (error: any) {
      console.error('[Sprites] Failed to configure service:', error)
      throw error
    }
  }

  /**
   * Get service status
   */
  async getServiceStatus(serviceName: string): Promise<{
    status: 'running' | 'stopped' | 'suspended' | 'unknown'
    port?: number
    url?: string
    lastStarted?: string
    restartCount?: number
  }> {
    try {
      const result = await this.sprite.execFile('sprite-env', [
        'services',
        'status',
        serviceName,
      ])
      
      const status = JSON.parse(result.stdout)
      return {
        status: status.status || 'unknown',
        port: status.port,
        url: status.url,
        lastStarted: status.lastStarted,
        restartCount: status.restartCount,
      }
    } catch (error: any) {
      console.error('[Sprites] Failed to get service status:', error)
      return { status: 'unknown' }
    }
  }

  /**
   * Restart service
   */
  async restartService(serviceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.sprite.execFile('sprite-env', [
        'services',
        'restart',
        serviceName,
      ])
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Configure HTTP service with automatic port detection
   * 
   * @see https://docs.sprites.dev/working-with-sprites#http-access
   */
  async configureHttpService(port?: number): Promise<{
    success: boolean
    url: string
    message?: string
  }> {
    try {
      const args = [
        'sprite-env',
        'http',
        'configure',
      ]

      if (port) {
        args.push(port.toString())
      } else {
        args.push('--auto-detect')
      }

      const result = await this.sprite.execFile('sprite', args)
      const config = JSON.parse(result.stdout)

      return {
        success: true,
        url: config.url || this.metadata.url,
        message: config.message,
      }
    } catch (error: any) {
      return {
        success: false,
        url: '',
        message: error.message,
      }
    }
  }

  /**
   * Get checkpoint manager with metadata support
   */
  getCheckpointManager(policy?: Partial<RetentionPolicy>): SpritesCheckpointManager | null {
    if (!this.enableCheckpoints) {
      console.warn('[Sprites] Checkpoints disabled')
      return null
    }

    if (!this.checkpointManager) {
      this.checkpointManager = createCheckpointManager(
        process.env.SPRITES_TOKEN || '',
        this.id,
        policy
      )
    }

    return this.checkpointManager
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    try {
      const result = await this.sprite.execFile('bash', ['-c', command], {
        cwd: cwd || this.workspaceDir,
        timeout: timeout || 60000,
      })
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
      const fullPath = filePath.startsWith('/') ? filePath : `${this.workspaceDir}/${filePath}`
      await this.sprite.files.write(fullPath, content)
      return { success: true, output: `Written ${filePath}` }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const fullPath = filePath.startsWith('/') ? filePath : `${this.workspaceDir}/${filePath}`
      const content = await this.sprite.files.read(fullPath)
      return { success: true, output: content }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const fullPath = dirPath.startsWith('/') ? dirPath : `${this.workspaceDir}/${dirPath}`
      const files = await this.sprite.files.list(fullPath)
      return {
        success: true,
        output: files.map((f: any) => f.name).join('\n'),
      }
    } catch (error: any) {
      return { success: false, output: error.message }
    }
  }

  async setupWorkspace(): Promise<void> {
    await this.sprite.execFile('mkdir', ['-p', this.workspaceDir])
  }

  async kill(): Promise<void> {
    try {
      await this.sprite.delete()
      console.log(`[Sprites] Deleted Sprite: ${this.id}`)
    } catch (error: any) {
      console.error('[Sprites] Kill error:', error)
    }
  }

  async getInfo(): Promise<{
    id: string
    name: string
    url: string
    status: string
    region: string
    plan: string
  }> {
    return {
      id: this.id,
      name: this.metadata.name,
      url: this.metadata.url,
      status: this.metadata.status,
      region: this.metadata.region,
      plan: this.metadata.plan,
    }
  }
}

// Export singleton instance
export const spritesProvider = new SpritesProvider()
