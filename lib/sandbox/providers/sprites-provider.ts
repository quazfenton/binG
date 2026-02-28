/**
 * Fly.io Sprites Sandbox Provider
 * 
 * Persistent, hardware-isolated execution environments with:
 * - True persistence (ext4 filesystem persists indefinitely)
 * - Hardware isolation (dedicated microVM)
 * - Checkpoint system (snapshot filesystem for rollbacks)
 * - Auto-hibernation (sleeps after 30s inactivity, wakes <500ms)
 * - Full Linux environment (install any packages)
 * - Public URLs (https://<name>.sprites.app)
 * - Session management (detachable TTY sessions)
 * - Services (auto-restart processes on wake)
 * 
 * Documentation: https://docs.sprites.dev/
 * SDK: @fly/sprites (requires Node.js 24+)
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
} from './sandbox-provider'
import { quotaManager } from '@/lib/services/quota-manager'
import { syncVfsSnapshotToSprite, syncChangedFilesToSprite, type TarSyncFile } from './sprites-tar-sync'
import { SpritesCheckpointManager, createCheckpointManager, type RetentionPolicy } from './sprites-checkpoint-manager'

const WORKSPACE_DIR = '/home/sprite/workspace'
const MAX_INSTANCES = 30
const INSTANCE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours (Sprites are persistent)

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

// Periodic cleanup - Sprites are persistent, so we only track handles
setInterval(() => {
  const now = Date.now()
  for (const [id, instance] of sandboxInstances.entries()) {
    if (now - instance.lastActive > INSTANCE_TTL_MS) {
      console.log(`[Sprites] Removing stale handle: ${id} (Sprite persists)`)
      sandboxInstances.delete(id)
    }
  }
}, 60 * 60 * 1000)

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
      console.warn('[Sprites] SPRITES_TOKEN not configured. Provider will fail on first use.')
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
      throw new Error(
        `Sprites SDK not available. Install with: npm install @fly/sprites. Error: ${error.message}`
      )
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const client = await this.ensureClient()

    try {
      // Enforce max instances (handles, not actual Sprites which are persistent)
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
          console.log(`[Sprites] Removing oldest handle: ${oldestId}`)
          sandboxInstances.delete(oldestId)
        }
      }

      const spriteName = `bing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Build create config with auto-suspend services if enabled
      const createConfig: any = {}
      
      if (this.enableAutoSuspend) {
        // Configure service for auto-suspend/resume with memory state preservation
        // Documentation: https://docs.sprites.dev/working-with-sprites#auto-suspend
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

      // Create Sprite with config
      const sprite = await client.createSprite(spriteName, createConfig)

      // Wait for Sprite to be ready
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

      // Pre-setup workspace
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
      // Try to reconnect to existing Sprite
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
        
        // Reconnect without reinitializing
        const handle = new SpritesSandboxHandle(
          sprite,
          metadata,
          this.enableCheckpoints,
          this.enableAutoServices,
          true // isReconnect
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
        // Note: This actually deletes the Sprite permanently
        // Sprites are persistent by default, so this should be used carefully
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
        // Test connectivity with a simple command
        await sprite.execFile('echo', ['ready'])
        return
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    throw new Error(`Sprite did not become ready within ${timeoutMs}ms`)
  }
}

interface CheckpointInfo {
  id: string
  name?: string
  createdAt: string
  comment?: string
}

interface ServiceConfig {
  name: string
  command: string
  args?: string[]
  port?: number
  autoStart?: boolean
}

interface ServiceInfo {
  id: string
  name: string
  status: 'running' | 'stopped'
  port?: number
  url?: string
}

interface SessionInfo {
  id: string
  command: string
  createdAt: string
  isAttached: boolean
}

export class SpritesSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private sprite: any
  private metadata: SpritesSandboxMetadata
  private enableCheckpoints: boolean
  private enableAutoServices: boolean
  private enableAutoSuspend: boolean
  private isReconnect: boolean
  private checkpointManager: SpritesCheckpointManager | null = null
  private lastFileHash?: Map<string, string> // For incremental sync

  constructor(
    sprite: any,
    metadata: SpritesSandboxMetadata,
    enableCheckpoints: boolean,
    enableAutoServices: boolean,
    isReconnect: boolean = false,
    enableAutoSuspend: boolean = false
  ) {
    this.sprite = sprite
    this.metadata = metadata
    this.enableCheckpoints = enableCheckpoints
    this.enableAutoServices = enableAutoServices
    this.enableAutoSuspend = enableAutoSuspend
    this.isReconnect = isReconnect
    this.id = metadata.name
  }

  /**
   * Get checkpoint manager for advanced checkpoint operations
   */
  getCheckpointManager(policy?: Partial<RetentionPolicy>): SpritesCheckpointManager {
    if (!this.checkpointManager) {
      this.checkpointManager = createCheckpointManager(this, policy);
    }
    return this.checkpointManager;
  }

  /**
   * Setup workspace directory structure
   * Only runs on fresh creation, not on reconnect
   */
  async setupWorkspace(): Promise<void> {
    if (this.isReconnect) return

    try {
      // Create workspace directory
      await this.executeCommand(`mkdir -p ${WORKSPACE_DIR}`)
      
      // Set up common development tools if not present
      await this.executeCommand('command -v node >/dev/null 2>&1 || echo "Node not installed"')
      
      // Create package cache directory
      await this.executeCommand('mkdir -p /home/sprite/.npm')
      await this.executeCommand('mkdir -p /home/sprite/.cache')
    } catch (error) {
      console.warn('[Sprites] Workspace setup failed:', error)
      // Non-fatal, continue
    }
  }

  /**
   * Sync virtual filesystem to Sprite using tar-pipe method
   * Much faster than individual file writes for large projects (10+)
   */
  async syncVfs(vfsSnapshot: { files: Array<{ path: string; content: string }> }): Promise<{
    success: boolean
    filesSynced: number
    duration: number
    method: 'tar-pipe' | 'individual'
  }> {
    try {
      // Use tar-pipe for 10+ files, individual for smaller sets
      if (vfsSnapshot.files.length >= 10) {
        const result = await syncVfsSnapshotToSprite(
          this.sprite,
          vfsSnapshot,
          WORKSPACE_DIR
        )
        
        return {
          success: result.success,
          filesSynced: result.filesSynced,
          duration: result.duration,
          method: 'tar-pipe'
        }
      } else {
        // Fall back to individual writes for small projects
        let successCount = 0
        const startTime = Date.now()
        
        for (const file of vfsSnapshot.files) {
          const result = await this.writeFile(file.path, file.content)
          if (result.success) successCount++
        }
        
        return {
          success: successCount === vfsSnapshot.files.length,
          filesSynced: successCount,
          duration: Date.now() - startTime,
          method: 'individual'
        }
      }
    } catch (error: any) {
      console.error('[Sprites] VFS sync failed:', error.message)
      return {
        success: false,
        filesSynced: 0,
        duration: 0,
        method: 'individual'
      }
    }
  }

  /**
   * Sync only changed files (incremental sync)
   * Uses file hashing to determine what needs syncing
   */
  async syncChangedVfs(
    vfsSnapshot: { files: Array<{ path: string; content: string }> }
  ): Promise<{
    success: boolean
    filesSynced: number
    changedFiles: number
    duration: number
  }> {
    const files: TarSyncFile[] = vfsSnapshot.files.map(f => ({
      path: f.path.replace(/^project\//, ''),
      content: f.content
    }))
    
    const result = await syncChangedFilesToSprite(
      this.sprite,
      files,
      this.lastFileHash,
      WORKSPACE_DIR
    )
    
    // Update hash map
    if (result.previousHash) {
      this.lastFileHash = result.previousHash
    }
    
    return {
      success: result.success,
      filesSynced: result.filesSynced,
      changedFiles: result.changedFiles || 0,
      duration: result.duration
    }
  }

  private sanitizeCommand(command: string): string {
    // Block ALL shell metacharacters including pipes and redirects
    // This prevents command injection via: echo "hi" | bash, ls > file, cat < file, etc.
    const dangerousChars = /[;`$(){}[\]!#~\\|>&]/
    if (dangerousChars.test(command)) {
      throw new Error('Command contains disallowed characters for security')
    }
    if (/[\n\r\0]/.test(command)) {
      throw new Error('Command contains invalid control characters')
    }
    return command
  }

  private resolvePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.includes('..') || normalized.includes('\0')) {
      throw new Error(`Invalid file path: ${filePath}`)
    }
    if (filePath.startsWith('/')) {
      const resolved = filePath
      // Allow common system paths for package installation
      if (resolved.startsWith('/home/sprite') || resolved.startsWith('/opt') || resolved.startsWith('/usr/local')) {
        return resolved
      }
      if (!resolved.startsWith(WORKSPACE_DIR)) {
        throw new Error(`Path traversal detected: ${filePath}`)
      }
      return resolved
    }
    const resolved = `${WORKSPACE_DIR}/${normalized}`
    if (!resolved.startsWith(WORKSPACE_DIR)) {
      throw new Error(`Path traversal detected: ${filePath}`)
    }
    return resolved
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const safeCommand = this.sanitizeCommand(command)
    const effectiveTimeout = timeout ?? 60_000

    try {
      // Use execFile for direct command execution (no shell)
      // For shell features, wrap in bash -c
      const result = await this.sprite.execFile('bash', ['-c', safeCommand], {
        cwd: cwd || WORKSPACE_DIR,
        maxBuffer: 1024 * 1024, // 1MB buffer
      })

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr || '',
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      if (error.message?.includes('timed out') || error.code === 'TIMEOUT') {
        return {
          success: false,
          output: `Command timed out after ${effectiveTimeout}ms`,
          exitCode: 124,
        }
      }
      
      // Handle ExecError from Sprites SDK
      if (error.exitCode !== undefined) {
        return {
          success: false,
          output: error.stdout || error.stderr || error.message,
          exitCode: error.exitCode,
        }
      }
      
      throw error
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)

    try {
      // Use exec to write file (Sprites doesn't have fs.write in older SDK versions)
      const escapedContent = content.replace(/'/g, "'\\''")
      const escapedPath = resolved.replace(/'/g, "'\\''")
      
      // Create directory if needed
      const dir = resolved.substring(0, resolved.lastIndexOf('/'))
      await this.executeCommand(`mkdir -p '${dir}'`)
      
      // Write file content
      await this.executeCommand(`printf '%s' '${escapedContent}' > '${escapedPath}'`)
      
      return {
        success: true,
        output: `File written: ${resolved}`,
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath)

    try {
      const result = await this.executeCommand(`cat '${resolved}'`)
      return {
        success: result.success,
        output: result.output,
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

  async listDirectory(dirPath?: string): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath || '.')

    try {
      const result = await this.executeCommand(`ls -la '${resolved}'`)
      return result
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
      }
    }
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    // Sprites provide public URLs
    return {
      port,
      url: this.metadata.url,
      token: undefined,
    }
  }

  async getProviderInfo(): Promise<any> {
    return {
      provider: 'sprites',
      region: this.metadata.region,
      status: this.metadata.status,
      url: this.metadata.url,
      createdAt: new Date().toISOString(),
      plan: this.metadata.plan,
    }
  }

  /**
   * Create a checkpoint (filesystem snapshot)
   * Sprites-specific feature
   */
  async createCheckpoint(name?: string): Promise<CheckpointInfo> {
    if (!this.enableCheckpoints) {
      throw new Error('Checkpoints are disabled. Enable with SPRITES_ENABLE_CHECKPOINTS=true')
    }

    try {
      const checkpointName = name || `checkpoint-${Date.now()}`
      const checkpoint = await this.sprite.createCheckpoint(checkpointName)
      
      return {
        id: checkpoint.id,
        name: checkpointName,
        createdAt: new Date().toISOString(),
      }
    } catch (error: any) {
      throw new Error(`Failed to create checkpoint: ${error.message}`)
    }
  }

  /**
   * Restore from a checkpoint
   * Sprites-specific feature
   */
  async restoreCheckpoint(checkpointId: string): Promise<void> {
    if (!this.enableCheckpoints) {
      throw new Error('Checkpoints are disabled')
    }

    try {
      await this.sprite.restore(checkpointId)
      console.log(`[Sprites] Restored checkpoint: ${checkpointId}`)
    } catch (error: any) {
      throw new Error(`Failed to restore checkpoint: ${error.message}`)
    }
  }

  /**
   * List available checkpoints
   * Sprites-specific feature
   */
  async listCheckpoints(): Promise<CheckpointInfo[]> {
    if (!this.enableCheckpoints) {
      return []
    }

    try {
      const checkpoints = await this.sprite.listCheckpoints()
      return checkpoints.map((cp: any) => ({
        id: cp.id,
        name: cp.name,
        createdAt: cp.created_at,
      }))
    } catch (error: any) {
      console.warn('[Sprites] Failed to list checkpoints:', error.message)
      return []
    }
  }

  /**
   * Create a service (auto-restart on wake)
   * Sprites-specific feature
   */
  async createService(config: ServiceConfig): Promise<ServiceInfo> {
    if (!this.enableAutoServices) {
      throw new Error('Auto-services are disabled. Enable with SPRITES_AUTO_SERVICES=true')
    }

    try {
      const service = await this.sprite.services.create(config.name, {
        cmd: config.command,
        args: config.args || [],
      })

      return {
        id: service.id,
        name: config.name,
        status: 'running',
        port: config.port,
        url: config.port ? `${this.metadata.url}:${config.port}` : undefined,
      }
    } catch (error: any) {
      throw new Error(`Failed to create service: ${error.message}`)
    }
  }

  /**
   * List running services
   * Sprites-specific feature
   */
  async listServices(): Promise<ServiceInfo[]> {
    try {
      const services = await this.sprite.services.list()
      return services.map((s: any) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        port: s.port,
      }))
    } catch (error: any) {
      console.warn('[Sprites] Failed to list services:', error.message)
      return []
    }
  }

  /**
   * Get detailed service status
   * Sprites-specific feature
   */
  async getServiceStatus(serviceName: string): Promise<{
    status: 'running' | 'stopped' | 'suspended' | 'unknown'
    port?: number
    url?: string
    lastStarted?: string
    restartCount?: number
  }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      const { stdout } = await execPromise(
        `sprite-env services status ${serviceName} -s ${this.id} --json 2>/dev/null || echo "{}"`
      )

      const status = JSON.parse(stdout || '{}')

      return {
        status: status.state || 'unknown',
        port: status.port,
        url: status.url,
        lastStarted: status.last_started,
        restartCount: status.restart_count
      }
    } catch {
      return {
        status: 'unknown'
      }
    }
  }

  /**
   * Restart a service
   * Sprites-specific feature
   */
  async restartService(serviceName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services restart ${serviceName} -s ${this.id}`
      )

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to restart service: ${error.message}`
      }
    }
  }

  /**
   * Configure HTTP service for auto-suspend/resume
   * Sprites-specific feature
   */
  async configureHttpService(port: number = 8080): Promise<{
    success: boolean
    url: string
    message?: string
  }> {
    if (!this.enableAutoSuspend) {
      return {
        success: false,
        url: '',
        message: 'Auto-suspend is disabled. Enable with SPRITES_ENABLE_AUTO_SUSPEND=true'
      }
    }

    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services create http-server -s ${this.id} ` +
        `--cmd "node" --args "server.js" ` +
        `--port ${port} ` +
        `--autostart --autostop=suspend`
      )

      return {
        success: true,
        url: this.metadata.url,
        message: `HTTP service configured on port ${port}. Sprite will auto-suspend when idle.`
      }
    } catch (error: any) {
      return {
        success: false,
        url: '',
        message: `Failed to configure service: ${error.message}`
      }
    }
  }

  /**
   * List active sessions
   * Sprites-specific feature
   */
  async listSessions(): Promise<SessionInfo[]> {
    try {
      const sessions = await this.sprite.listSessions()
      return sessions.map((s: any) => ({
        id: s.id,
        command: s.command,
        createdAt: s.created_at,
        isAttached: s.is_attached,
      }))
    } catch (error: any) {
      console.warn('[Sprites] Failed to list sessions:', error.message)
      return []
    }
  }

  /**
   * Create a PTY session (detachable)
   * Sprites-specific feature
   */
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    try {
      const session = await this.sprite.createSession('bash', [], {
        tty: true,
        rows: options.rows || 24,
        cols: options.cols || 80,
        cwd: options.cwd,
        env: options.envs,
      })

      // Set up data handler
      session.stdout.on('data', (data: Buffer) => {
        options.onData(new Uint8Array(data))
      })

      session.stderr.on('data', (data: Buffer) => {
        options.onData(new Uint8Array(data))
      })

      return new SpritesPtyHandle(session, options.id)
    } catch (error: any) {
      throw new Error(`Failed to create PTY session: ${error.message}`)
    }
  }

  /**
   * Attach to an existing session
   * Sprites-specific feature
   */
  async attachSession(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    try {
      const session = await this.sprite.attachSession(sessionId)
      
      session.stdout.on('data', (data: Buffer) => {
        options.onData(new Uint8Array(data))
      })

      session.stderr.on('data', (data: Buffer) => {
        options.onData(new Uint8Array(data))
      })

      return new SpritesPtyHandle(session, sessionId)
    } catch (error: any) {
      throw new Error(`Failed to attach to session: ${error.message}`)
    }
  }

  /**
   * Create port forwarding tunnel
   * Ideal for: accessing remote databases, dev servers, debugging
   */
  async createProxy(config: ProxyConfig): Promise<{ pid: number; url: string }> {
    try {
      const { spawn } = await import('child_process')

      // Start proxy tunnel
      const proxy = spawn('sprite', [
        'proxy',
        `${config.localPort}:${config.remotePort}`,
        '-s',
        this.id,
      ])

      return new Promise((resolve, reject) => {
        proxy.on('spawn', () => {
          resolve({
            pid: proxy.pid!,
            url: `http://localhost:${config.localPort}`,
          })
        })

        proxy.on('error', (error: any) => {
          reject(new Error(`Proxy failed: ${error.message}`))
        })

        proxy.stderr.on('data', (data: Buffer) => {
          const output = data.toString()
          if (output.includes('error')) {
            reject(new Error(`Proxy error: ${output}`))
          }
        })

        // Timeout after 10 seconds if not spawned
        setTimeout(() => {
          reject(new Error('Proxy timed out'))
        }, 10000)
      })
    } catch (error: any) {
      console.error('[Sprites] Proxy creation failed:', error.message)
      throw new Error(`Failed to create proxy: ${error.message}`)
    }
  }

  /**
   * Get Sprite's public URL
   */
  async getPublicUrl(): Promise<string> {
    return this.metadata.url
  }

  /**
   * Configure URL authentication mode
   */
  async updateUrlAuth(mode: 'public' | 'default'): Promise<void> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)
      
      await execPromise(
        `sprite url update --auth ${mode} -s ${this.id}`
      )
      
      console.log(`[Sprites] URL auth updated to: ${mode}`)
    } catch (error: any) {
      console.error('[Sprites] URL auth update failed:', error.message)
      throw new Error(`Failed to update URL auth: ${error.message}`)
    }
  }

  /**
   * Create env service (auto-restart on wake)
   * Uses sprite-env services command
   */
  async createEnvService(config: EnvServiceConfig): Promise<ServiceInfo> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)
      
      // Build command
      let cmd = `sprite-env services create ${config.name} --cmd "${config.command}"`
      
      if (config.args?.length) {
        cmd += ` --args "${config.args.join(' ')}"`
      }
      
      if (config.workingDir) {
        cmd += ` --dir "${config.workingDir}"`
      }
      
      if (config.autoStart !== false) {
        cmd += ' --auto-start'
      }
      
      cmd += ` -s ${this.id}`
      
      await execPromise(cmd)
      
      return {
        id: config.name,
        name: config.name,
        status: 'running',
      }
    } catch (error: any) {
      console.error('[Sprites] Env service creation failed:', error.message)
      throw new Error(`Failed to create env service: ${error.message}`)
    }
  }

  /**
   * List all env services
   */
  async listEnvServices(): Promise<ServiceInfo[]> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      const { stdout } = await execPromise(
        `sprite-env services list -s ${this.id} --json 2>/dev/null || echo "[]"`
      )

      const services = JSON.parse(stdout || '[]')
      return Array.isArray(services) ? services.map((s: any) => ({
        id: s.name,
        name: s.name,
        status: s.status || 'unknown',
        command: s.command,
        autoStart: s.autoStart,
      })) : []
    } catch (error: any) {
      console.warn('[Sprites] Failed to list env services:', error.message)
      return []
    }
  }

  /**
   * Create a service with auto-start on wake
   * 
   * Services automatically restart when Sprite wakes from hibernation.
   * This is the RECOMMENDED way to run persistent services (web servers, etc.)
   * 
   * @param name - Service name
   * @param command - Command to run (e.g., 'node')
   * @param args - Command arguments (e.g., ['server.js'])
   * @param options - Service options
   */
  async createService(
    name: string,
    command: string,
    args: string[],
    options?: {
      autoStart?: boolean
      workingDir?: string
      env?: Record<string, string>
    }
  ): Promise<{
    success: boolean
    serviceId: string
    message?: string
  }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      // Build command with options
      let cmd = `sprite-env services create ${name} -s ${this.id} --cmd ${command}`
      
      if (args.length > 0) {
        cmd += ` --args "${args.join(' ')}"`
      }

      if (options?.workingDir) {
        cmd += ` --workdir ${options.workingDir}`
      }

      if (options?.autoStart !== false) {
        cmd += ' --autostart'
      }

      // Add environment variables
      if (options?.env) {
        for (const [key, value] of Object.entries(options.env)) {
          cmd += ` --env ${key}=${value}`
        }
      }

      const { stdout, stderr } = await execPromise(cmd)

      return {
        success: true,
        serviceId: name,
        message: stdout || `Service ${name} created successfully`,
      }
    } catch (error: any) {
      console.error('[Sprites] Service creation failed:', error.message)
      return {
        success: false,
        serviceId: name,
        message: `Failed to create service: ${error.message}`,
      }
    }
  }

  /**
   * Start a service
   */
  async startService(name: string): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services start ${name} -s ${this.id}`
      )

      return {
        success: true,
        message: `Service ${name} started`,
      }
    } catch (error: any) {
      console.error('[Sprites] Service start failed:', error.message)
      return {
        success: false,
        message: `Failed to start service: ${error.message}`,
      }
    }
  }

  /**
   * Stop a service
   */
  async stopService(name: string): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services stop ${name} -s ${this.id}`
      )

      return {
        success: true,
        message: `Service ${name} stopped`,
      }
    } catch (error: any) {
      console.error('[Sprites] Service stop failed:', error.message)
      return {
        success: false,
        message: `Failed to stop service: ${error.message}`,
      }
    }
  }

  /**
   * Restart a service
   */
  async restartService(name: string): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services restart ${name} -s ${this.id}`
      )

      return {
        success: true,
        message: `Service ${name} restarted`,
      }
    } catch (error: any) {
      console.error('[Sprites] Service restart failed:', error.message)
      return {
        success: false,
        message: `Failed to restart service: ${error.message}`,
      }
    }
  }

  /**
   * Remove an env service
   */
  async removeEnvService(name: string): Promise<void> {
    try {
      const { exec } = await import('child_process')
      const util = await import('util')
      const execPromise = util.promisify(exec)

      await execPromise(
        `sprite-env services remove ${name} -s ${this.id}`
      )
    } catch (error: any) {
      console.error('[Sprites] Env service removal failed:', error.message)
      throw new Error(`Failed to remove service: ${error.message}`)
    }
  }

  /**
   * Upgrade Sprite to latest version
   */
  async upgrade(): Promise<void> {
    try {
      await this.sprite.upgrade()
      console.log(`[Sprites] Upgraded sprite: ${this.id}`)
    } catch (error: any) {
      console.error('[Sprites] Upgrade failed:', error.message)
      throw new Error(`Failed to upgrade Sprite: ${error.message}`)
    }
  }

  /**
   * Kill a specific session
   */
  async killSession(sessionId: string): Promise<void> {
    try {
      const sessions = await this.listSessions()
      const session = sessions?.find(s => s.id === sessionId)
      
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }
      
      // Use spawn to kill session
      const { spawn } = await import('child_process')
      
      return new Promise((resolve, reject) => {
        const proc = spawn('sprite', ['sessions', 'kill', sessionId, '-s', this.id])
        
        proc.on('close', (code) => {
          if (code === 0) {
            resolve()
          } else {
            reject(new Error(`Session kill exited with code ${code}`))
          }
        })
        
        proc.on('error', (error: any) => {
          reject(error)
        })
      })
    } catch (error: any) {
      console.error('[Sprites] Session kill failed:', error.message)
      throw new Error(`Failed to kill session: ${error.message}`)
    }
  }

  /**
   * List sessions with detailed information
   */
  async listSessionsDetailed(): Promise<Array<{
    id: string
    command: string
    createdAt: string
    isAttached: boolean
    pid?: number
    cwd?: string
  }>> {
    try {
      const sessions = await this.sprite.listSessions()
      return sessions.map((s: any) => ({
        id: s.id,
        command: s.command,
        createdAt: s.created_at,
        isAttached: s.is_attached,
        pid: s.pid,
        cwd: s.cwd,
      }))
    } catch (error: any) {
      console.warn('[Sprites] Failed to list detailed sessions:', error.message)
      return []
    }
  }
}

class SpritesPtyHandle implements PtyHandle {
  readonly sessionId: string
  private session: any

  constructor(session: any, sessionId: string) {
    this.session = session
    this.sessionId = sessionId
  }

  async sendInput(data: string): Promise<void> {
    this.session.stdin.write(data)
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.session.resize(cols, rows)
  }

  async waitForConnection(): Promise<void> {
    // Session is ready immediately
    return Promise.resolve()
  }

  async wait(): Promise<{ exitCode: number }> {
    const exitCode = await this.session.wait()
    return { exitCode }
  }

  async disconnect(): Promise<void> {
    // Detach without killing the session
    // Session continues running in background
  }

  async kill(): Promise<void> {
    this.session.kill()
  }
}
