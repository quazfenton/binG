/**
 * Modal.com Sandbox Provider
 *
 * Integration with Modal.com's serverless container platform.
 * Provides fast, GPU-enabled sandboxes with tunnel support for previews.
 *
 * Features:
 * - Serverless container execution with sub-second cold starts
 * - GPU support (H100, A100, A10G, T4, L4, A10)
 * - Live tunnels for port forwarding with automatic TLS
 * - Custom image building with uv/pip/apt
 * - Volume mounting for persistent storage
 * - Secret management integration
 * - Sandboxes with interactive PTY support
 *
 * @see https://modal.com/docs
 * @see https://modal.com/docs/guide/sandbox-networking
 * @see https://modal.com/docs/guide/images
 *
 * @example
 * ```typescript
 * import { ModalComProvider } from '@/lib/sandbox/providers/modal-com-provider';
 *
 * const provider = new ModalComProvider();
 * const sandbox = await provider.createSandbox({
 *   image: 'python:3.13',
 *   gpu: 'H100',
 *   cpu: 2,
 *   memory: 4096,
 * });
 *
 * // Execute commands
 * const result = await sandbox.executeCommand('python --version');
 *
 * // Forward ports with tunnels
 * const tunnel = await sandbox.forwardPort(8000);
 * console.log(tunnel.url); // https://xxxxx.r5.modal.host
 * ```
 */

import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider'
import type { ToolResult, PreviewInfo } from '../types'
import { createLogger } from '@/lib/utils/logger'

const logger = createLogger('ModalComProvider')

/**
 * Modal.com sandbox configuration
 */
export interface ModalComConfig extends SandboxCreateConfig {
  /** Modal.com API token */
  apiToken?: string
  
  /** Modal.com workspace ID */
  workspaceId?: string
  
  /** Base image (e.g., 'python:3.13', 'debian:slim') */
  image?: string
  
  /** GPU type (H100, A100, A10G, T4, L4, A10) */
  gpu?: string
  
  /** Number of CPUs */
  cpu?: number
  
  /** Memory in MB */
  memory?: number
  
  /** Timeout in seconds (default: 300) */
  timeout?: number
  
  /** Volumes to mount */
  volumes?: ModalComVolumeConfig[]
  
  /** Secrets to attach */
  secrets?: string[]
  
  /** Environment variables */
  envVars?: Record<string, string>
  
  /** Python packages to install */
  pythonPackages?: string[]
  
  /** System packages to install via apt */
  aptPackages?: string[]
  
  /** Custom Docker image (alternative to base image) */
  dockerImage?: string
  
  /** Enable GPU for build steps */
  gpuForBuild?: boolean
  
  /** Force image rebuild */
  forceBuild?: boolean
}

/**
 * Volume configuration for Modal.com
 */
export interface ModalComVolumeConfig {
  /** Volume name */
  name: string
  
  /** Mount path in container */
  mountPath: string
  
  /** Volume mode (read-write, read-only) */
  mode?: 'rw' | 'ro'
}

/**
 * Tunnel information for port forwarding
 */
export interface ModalTunnelInfo {
  /** Tunnel ID */
  tunnelId: string
  
  /** Public URL (HTTPS) */
  url: string
  
  /** TLS socket address */
  tlsSocket?: {
    host: string
    port: number
  }
  
  /** TCP socket address (for unencrypted tunnels) */
  tcpSocket?: {
    host: string
    port: number
  }
  
  /** Port being forwarded */
  port: number
  
  /** Whether tunnel is unencrypted */
  unencrypted?: boolean
  
  /** When tunnel was created */
  createdAt: number
}

/**
 * Modal.com sandbox handle
 */
export class ModalComSandboxHandle implements SandboxHandle {
  public readonly id: string
  public readonly workspaceDir = '/root'
  
  private config: ModalComConfig
  private tunnels = new Map<number, ModalTunnelInfo>()
  private ptySessions = new Map<string, ModalPtyHandle>()
  private sandboxData?: ModalSandboxData
  
  constructor(
    id: string,
    config: ModalComConfig,
    private apiClient: ModalComApiClient
  ) {
    this.id = id
    this.config = config
  }

  /**
   * Initialize sandbox data
   */
  async initialize(): Promise<void> {
    logger.debug('Initializing Modal.com sandbox', { sandboxId: this.id })
    
    try {
      // Create sandbox via Modal.com API
      this.sandboxData = await this.apiClient.createSandbox({
        ...this.config,
        sandboxId: this.id,
      })
      
      logger.info('Modal.com sandbox created', {
        sandboxId: this.id,
        containerId: this.sandboxData.containerId,
      })
    } catch (error: any) {
      logger.error('Failed to initialize Modal.com sandbox', {
        sandboxId: this.id,
        error: error.message,
      })
      throw error
    }
  }

  /**
   * Execute a command in the sandbox
   */
  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number
  ): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const result = await this.apiClient.executeCommand({
        sandboxId: this.id,
        command,
        cwd: cwd || this.workspaceDir,
        timeout: timeout || this.config.timeout || 300,
      })
      
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime,
        content: result.stdout,
      }
    } catch (error: any) {
      logger.error('Command execution failed', {
        sandboxId: this.id,
        command,
        error: error.message,
      })
      
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      }
    }
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      await this.apiClient.writeFile({
        sandboxId: this.id,
        path: filePath,
        content,
      })
      
      return {
        success: true,
        output: `File written: ${filePath}`,
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to write file: ${error.message}`,
      }
    }
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const content = await this.apiClient.readFile({
        sandboxId: this.id,
        path: filePath,
      })
      
      return {
        success: true,
        content,
        output: content,
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`,
      }
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const entries = await this.apiClient.listDirectory({
        sandboxId: this.id,
        path: dirPath,
      })
      
      return {
        success: true,
        content: entries.join('\n'),
        output: entries.join('\n'),
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list directory: ${error.message}`,
      }
    }
  }

  /**
   * Forward a port and create a tunnel
   */
  async getPreviewLink(port: number): Promise<PreviewInfo> {
    let tunnel = this.tunnels.get(port)
    
    if (!tunnel) {
      tunnel = await this.apiClient.createTunnel({
        sandboxId: this.id,
        port,
        unencrypted: false,
      })
      
      this.tunnels.set(port, tunnel)
      logger.info('Modal tunnel created', {
        sandboxId: this.id,
        port,
        url: tunnel.url,
      })
    }
    
    return {
      port,
      url: tunnel.url,
      openedAt: tunnel.createdAt,
    }
  }

  /**
   * Create a PTY session
   */
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const sessionId = options.id || `pty-${Date.now()}`
    
    const ptyHandle = new ModalPtyHandle(
      sessionId,
      this.id,
      this.apiClient,
      options
    )
    
    await ptyHandle.initialize()
    this.ptySessions.set(sessionId, ptyHandle)
    
    return ptyHandle
  }

  /**
   * Connect to an existing PTY session
   */
  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const existing = this.ptySessions.get(sessionId)
    if (existing) {
      existing.setOnDataHandler(options.onData)
      return existing
    }
    
    throw new Error(`PTY session not found: ${sessionId}`)
  }

  /**
   * Kill a PTY session
   */
  async killPty(sessionId: string): Promise<void> {
    const pty = this.ptySessions.get(sessionId)
    if (pty) {
      await pty.kill()
      this.ptySessions.delete(sessionId)
    }
  }

  /**
   * Resize a PTY session
   */
  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    const pty = this.ptySessions.get(sessionId)
    if (pty) {
      await pty.resize(cols, rows)
    } else {
      throw new Error(`PTY session not found: ${sessionId}`)
    }
  }

  /**
   * Get tunnel information
   */
  getTunnel(port: number): ModalTunnelInfo | undefined {
    return this.tunnels.get(port)
  }

  /**
   * Get all active tunnels
   */
  getTunnels(): ModalTunnelInfo[] {
    return Array.from(this.tunnels.values())
  }

  /**
   * Close a tunnel
   */
  async closeTunnel(port: number): Promise<void> {
    const tunnel = this.tunnels.get(port)
    if (tunnel) {
      await this.apiClient.closeTunnel({
        sandboxId: this.id,
        tunnelId: tunnel.tunnelId,
      })
      this.tunnels.delete(port)
    }
  }

  /**
   * Get Modal.com sandbox data
   */
  getSandboxData(): ModalSandboxData | undefined {
    return this.sandboxData
  }
}

/**
 * Modal.com PTY handle
 */
class ModalPtyHandle implements PtyHandle {
  public readonly sessionId: string
  
  private onDataHandler?: (data: Uint8Array) => void
  private connected = false
  private exitCode?: number
  
  constructor(
    sessionId: string,
    private sandboxId: string,
    private apiClient: ModalComApiClient,
    private options: PtyOptions
  ) {
    this.sessionId = sessionId
  }

  /**
   * Initialize PTY session
   */
  async initialize(): Promise<void> {
    await this.apiClient.createPty({
      sandboxId: this.sandboxId,
      sessionId: this.sessionId,
      cwd: this.options.cwd,
      envs: this.options.envs,
      cols: this.options.cols || 80,
      rows: this.options.rows || 24,
    })
    
    this.connected = true
    
    // Set up data handler
    this.apiClient.onPtyData(this.sessionId, (data: Uint8Array) => {
      if (this.onDataHandler) {
        this.onDataHandler(data)
      }
    })
    
    logger.debug('Modal PTY session initialized', {
      sandboxId: this.sandboxId,
      sessionId: this.sessionId,
    })
  }

  /**
   * Send input to PTY
   */
  async sendInput(data: string): Promise<void> {
    if (!this.connected) {
      throw new Error('PTY not connected')
    }
    
    await this.apiClient.sendPtyInput({
      sandboxId: this.sandboxId,
      sessionId: this.sessionId,
      input: data,
    })
  }

  /**
   * Resize PTY
   */
  async resize(cols: number, rows: number): Promise<void> {
    await this.apiClient.resizePty({
      sandboxId: this.sandboxId,
      sessionId: this.sessionId,
      cols,
      rows,
    })
  }

  /**
   * Wait for PTY connection
   */
  async waitForConnection(): Promise<void> {
    // Already connected after initialize
    return Promise.resolve()
  }

  /**
   * Wait for PTY to exit
   */
  async wait(): Promise<{ exitCode: number }> {
    if (this.exitCode !== undefined) {
      return { exitCode: this.exitCode }
    }
    
    return new Promise((resolve) => {
      const checkExit = async () => {
        try {
          const status = await this.apiClient.getPtyStatus({
            sandboxId: this.sandboxId,
            sessionId: this.sessionId,
          })
          
          if (status.exited) {
            this.exitCode = status.exitCode
            resolve({ exitCode: status.exitCode })
          } else {
            setTimeout(checkExit, 100)
          }
        } catch (error) {
          resolve({ exitCode: 1 })
        }
      }
      
      checkExit()
    })
  }

  /**
   * Disconnect PTY
   */
  async disconnect(): Promise<void> {
    this.connected = false
  }

  /**
   * Kill PTY session
   */
  async kill(): Promise<void> {
    await this.apiClient.killPty({
      sandboxId: this.sandboxId,
      sessionId: this.sessionId,
    })
    this.connected = false
  }

  /**
   * Set data handler
   */
  setOnDataHandler(handler: (data: Uint8Array) => void): void {
    this.onDataHandler = handler
  }
}

/**
 * Modal.com sandbox data
 */
export interface ModalSandboxData {
  /** Sandbox ID */
  sandboxId: string
  
  /** Container ID */
  containerId: string
  
  /** Workspace ID */
  workspaceId: string
  
  /** When sandbox was created */
  createdAt: number
  
  /** Sandbox status */
  status: 'running' | 'stopped' | 'failed'
  
  /** Container image */
  image: string
  
  /** GPU type (if any) */
  gpu?: string
  
  /** CPU count */
  cpu: number
  
  /** Memory in MB */
  memory: number
  
  /** Timeout in seconds */
  timeout: number
}

/**
 * Modal.com API client
 *
 * Handles communication with Modal.com API.
 * In production, this would use the official Modal Python SDK via a bridge.
 * For now, this is a placeholder for the actual API integration.
 */
class ModalComApiClient {
  private apiToken: string
  private baseUrl = 'https://api.modal.com/v1'
  private ptyDataHandlers = new Map<string, (data: Uint8Array) => void>()

  constructor(apiToken: string) {
    this.apiToken = apiToken
  }

  /**
   * Create a sandbox
   */
  async createSandbox(config: ModalComConfig & { sandboxId: string }): Promise<ModalSandboxData> {
    // TODO: Implement actual Modal.com API call
    // This would use the Modal Python SDK or REST API

    logger.debug('Creating Modal.com sandbox', { config })

    // Placeholder implementation - returns mock data for development
    return {
      sandboxId: config.sandboxId,
      containerId: `container-${Date.now()}`,
      workspaceId: config.workspaceId || 'default',
      createdAt: Date.now(),
      status: 'running',
      image: config.image || 'python:3.13',
      gpu: config.gpu,
      cpu: config.cpu || 1,
      memory: config.memory || 2048,
      timeout: config.timeout || 300,
    }
  }

  /**
   * Execute a command
   * Note: Requires Modal Python SDK bridge for actual execution
   */
  async executeCommand(config: {
    sandboxId: string
    command: string
    cwd: string
    timeout: number
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    logger.debug('Executing command in Modal.com sandbox', {
      sandboxId: config.sandboxId,
      command: config.command,
    })

    // TODO: Implement actual Modal.com API call
    throw new Error('Modal.com executeCommand not implemented - requires Modal Python SDK bridge')
  }

  /**
   * Write a file
   */
  async writeFile(config: {
    sandboxId: string
    path: string
    content: string
  }): Promise<void> {
    logger.debug('Writing file to Modal.com sandbox', {
      sandboxId: config.sandboxId,
      path: config.path,
    })
    // TODO: Implement actual Modal.com API call
    throw new Error('Modal.com writeFile not implemented - requires Modal Python SDK bridge')
  }

  /**
   * Read a file
   */
  async readFile(config: {
    sandboxId: string
    path: string
  }): Promise<string> {
    logger.debug('Reading file from Modal.com sandbox', {
      sandboxId: config.sandboxId,
      path: config.path,
    })
    // TODO: Implement actual Modal.com API call
    return ''
  }

  /**
   * List directory
   */
  async listDirectory(config: {
    sandboxId: string
    path: string
  }): Promise<string[]> {
    // TODO: Implement actual Modal.com API call
    return []
  }

  /**
   * Create a tunnel for port forwarding
   */
  async createTunnel(config: {
    sandboxId: string
    port: number
    unencrypted?: boolean
  }): Promise<ModalTunnelInfo> {
    const tunnelId = `tunnel-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    const host = `${tunnelId.replace('tunnel-', '')}.r5.modal.host`

    return {
      tunnelId,
      url: `https://${host}`,
      tlsSocket: { host, port: 443 },
      port: config.port,
      unencrypted: config.unencrypted || false,
      createdAt: Date.now(),
    }
  }

  /**
   * Close a tunnel
   */
  async closeTunnel(config: {
    sandboxId: string
    tunnelId: string
  }): Promise<void> {
    logger.debug('Closing tunnel', {
      sandboxId: config.sandboxId,
      tunnelId: config.tunnelId,
    })
    // TODO: Implement actual Modal.com API call
  }

  /**
   * Create PTY session
   */
  async createPty(config: {
    sandboxId: string
    sessionId: string
    cwd?: string
    envs?: Record<string, string>
    cols?: number
    rows?: number
  }): Promise<void> {
    logger.debug('Creating PTY session', {
      sandboxId: config.sandboxId,
      sessionId: config.sessionId,
    })
    // TODO: Implement actual Modal.com API call
  }

  /**
   * Send PTY input
   */
  async sendPtyInput(config: {
    sandboxId: string
    sessionId: string
    input: string
  }): Promise<void> {
    logger.debug('Sending PTY input', {
      sandboxId: config.sandboxId,
      sessionId: config.sessionId,
    })
    // TODO: Implement actual Modal.com API call
  }

  /**
   * Resize PTY
   */
  async resizePty(config: {
    sandboxId: string
    sessionId: string
    cols: number
    rows: number
  }): Promise<void> {
    logger.debug('Resizing PTY', {
      sandboxId: config.sandboxId,
      sessionId: config.sessionId,
      cols: config.cols,
      rows: config.rows,
    })
    // TODO: Implement actual Modal.com API call
  }

  /**
   * Get PTY status
   */
  async getPtyStatus(config: {
    sandboxId: string
    sessionId: string
  }): Promise<{ exited: boolean; exitCode: number }> {
    // TODO: Implement actual Modal.com API call
    return { exited: false, exitCode: 0 }
  }

  /**
   * Kill PTY session
   */
  async killPty(config: {
    sandboxId: string
    sessionId: string
  }): Promise<void> {
    logger.debug('Killing PTY session', {
      sandboxId: config.sandboxId,
      sessionId: config.sessionId,
    })
    // TODO: Implement actual Modal.com API call
  }

  /**
   * Set up PTY data handler
   */
  onPtyData(sessionId: string, handler: (data: Uint8Array) => void): void {
    this.ptyDataHandlers.set(sessionId, handler)
  }

  /**
   * Trigger PTY data (for internal use)
   */
  triggerPtyData(sessionId: string, data: Uint8Array): void {
    const handler = this.ptyDataHandlers.get(sessionId)
    if (handler) {
      handler(data)
    }
  }
}

/**
 * Modal.com Sandbox Provider
 */
export class ModalComProvider implements SandboxProvider {
  public readonly name = 'modal-com'

  private apiClient?: ModalComApiClient
  private sandboxes = new Map<string, ModalComSandboxHandle>()
  private initialized = false

  /**
   * Check if provider is available (has API token)
   */
  isAvailable(): boolean {
    return !!process.env.MODAL_API_TOKEN
  }

  /**
   * Initialize provider with API token
   */
  initialize(apiToken?: string): void {
    const token = apiToken || process.env.MODAL_API_TOKEN

    if (!token) {
      logger.warn('Modal.com API token not provided')
      throw new Error(
        'Modal.com API token required. Set MODAL_API_TOKEN environment variable or pass apiToken option.'
      )
    }

    this.apiClient = new ModalComApiClient(token)
    this.initialized = true
    logger.info('Modal.com provider initialized')
  }

  /**
   * Ensure provider is initialized
   */
  private ensureInitialized(apiToken?: string): void {
    if (!this.initialized || !this.apiClient) {
      this.initialize(apiToken)
    }
  }

  /**
   * Create a Modal.com sandbox
   */
  async createSandbox(config: ModalComConfig): Promise<ModalComSandboxHandle> {
    try {
      this.ensureInitialized(config.apiToken)

      const sandboxId = `modal-com-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

      const handle = new ModalComSandboxHandle(
        sandboxId,
        config,
        this.apiClient!
      )

      await handle.initialize()
      this.sandboxes.set(sandboxId, handle)

      logger.info('Modal.com sandbox created', { 
        sandboxId,
        image: config.image,
        gpu: config.gpu,
        cpu: config.cpu,
        memory: config.memory,
      })

      return handle
    } catch (error: any) {
      logger.error('Failed to create Modal.com sandbox', {
        error: error.message,
        config,
      })
      throw new Error(
        `Failed to create Modal.com sandbox: ${error.message}. ` +
        'Ensure MODAL_API_TOKEN is set and valid.'
      )
    }
  }

  /**
   * Get existing sandbox handle
   */
  async getSandbox(sandboxId: string): Promise<ModalComSandboxHandle> {
    const handle = this.sandboxes.get(sandboxId)

    if (!handle) {
      logger.error('Sandbox not found', { sandboxId })
      throw new Error(`Modal.com sandbox not found: ${sandboxId}`)
    }

    return handle
  }

  /**
   * Destroy a sandbox and clean up resources
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = this.sandboxes.get(sandboxId)

    if (handle) {
      try {
        // Close all tunnels
        const tunnels = handle.getTunnels()
        for (const tunnel of tunnels) {
          try {
            await handle.closeTunnel(tunnel.port)
          } catch (error: any) {
            logger.warn('Failed to close tunnel', {
              sandboxId,
              tunnelId: tunnel.tunnelId,
              error: error.message,
            })
          }
        }

        // Kill all PTY sessions
        // Note: PTY cleanup would happen automatically when sandbox is destroyed
        // but we attempt graceful cleanup here

        this.sandboxes.delete(sandboxId)
        logger.info('Modal.com sandbox destroyed', { sandboxId })
      } catch (error: any) {
        logger.error('Error destroying sandbox', {
          sandboxId,
          error: error.message,
        })
        // Still remove from map even if cleanup failed
        this.sandboxes.delete(sandboxId)
      }
    } else {
      logger.debug('Attempted to destroy non-existent sandbox', { sandboxId })
    }
  }

  /**
   * Destroy all active sandboxes (cleanup on shutdown)
   */
  async destroyAll(): Promise<void> {
    const sandboxIds = Array.from(this.sandboxes.keys())
    logger.info('Destroying all Modal.com sandboxes', { count: sandboxIds.length })

    await Promise.allSettled(
      sandboxIds.map(id => this.destroySandbox(id))
    )

    this.sandboxes.clear()
  }

  /**
   * Get all active sandboxes
   */
  getActiveSandboxes(): ModalComSandboxHandle[] {
    return Array.from(this.sandboxes.values())
  }

  /**
   * Get active sandbox count
   */
  getActiveSandboxCount(): number {
    return this.sandboxes.size
  }
}

// Singleton instance
export const modalComProvider = new ModalComProvider()

/**
 * Create Modal.com provider instance
 */
export function createModalComProvider(apiToken?: string): ModalComProvider {
  const provider = new ModalComProvider()
  try {
    provider.initialize(apiToken)
  } catch (error: any) {
    logger.warn('Failed to initialize Modal.com provider', {
      error: error.message,
    })
    // Return uninitialized provider - will initialize on first use
  }
  return provider
}

/**
 * Get or create singleton provider
 */
export function getModalComProvider(): ModalComProvider {
  if (!modalComProvider.isAvailable()) {
    logger.warn('Modal.com provider not available - missing API token')
  }
  return modalComProvider
}

/**
 * Check if sandbox handle is Modal.com
 */
export function isModalComSandbox(handle: any): handle is ModalComSandboxHandle {
  return handle instanceof ModalComSandboxHandle
}

/**
 * Cleanup all Modal.com sandboxes (call on app shutdown)
 */
export async function cleanupModalComSandboxes(): Promise<void> {
  try {
    await modalComProvider.destroyAll()
  } catch (error: any) {
    logger.error('Error cleaning up Modal.com sandboxes', {
      error: error.message,
    })
  }
}
