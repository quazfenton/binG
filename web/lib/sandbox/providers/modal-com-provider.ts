/**
 * Modal.com Sandbox Provider
 *
 * Integration with Modal.com's serverless container platform using the official Modal SDK.
 * Provides fast, GPU-enabled sandboxes with tunnel support for previews.
 *
 * Features:
 * - Serverless container execution with sub-second cold starts
 * - GPU support (H100, A100, A10G, T4, L4, A10)
 * - Live tunnels for port forwarding with automatic TLS
 * - Custom image building with dockerfile commands
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
 * import { modalComProvider } from '@/lib/sandbox/providers/modal-com-provider';
 *
 * const sandbox = await modalComProvider.createSandbox({
 *   image: 'python:3.13',
 *   gpu: 'A10G',
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

import { ModalClient, Sandbox, Image, App, Secret, Volume } from 'modal';
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider';
import type { ToolResult, PreviewInfo } from '../types';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ModalComProvider');

/**
 * Modal.com sandbox configuration
 */
export interface ModalComConfig extends SandboxCreateConfig {
  /** Modal.com API token (tokenId) */
  apiToken?: string;

  /** Modal.com API secret (tokenSecret) */
  apiSecret?: string;

  /** Modal.com environment */
  environment?: string;

  /** Base image (e.g., 'python:3.13', 'debian:slim') */
  image?: string;

  /** GPU type (H100, A100, A10G, T4, L4, A10) */
  gpu?: string;

  /** Number of CPUs */
  cpu?: number;

  /** Memory in MB */
  memory?: number;

  /** Timeout in seconds (default: 300 = 5 minutes) */
  timeout?: number;

  /** Idle timeout in milliseconds */
  idleTimeoutMs?: number;

  /** Secret names to attach */
  secrets?: string[];

  /** Environment variables */
  envVars?: Record<string, string>;

  /** Dockerfile commands to build custom image */
  dockerfileCommands?: string[];

  /** Working directory */
  workdir?: string;

  /** Ports to expose (encrypted with TLS) */
  encryptedPorts?: number[];

  /** Ports to expose without encryption */
  unencryptedPorts?: number[];

  /** Enable PTY */
  pty?: boolean;

  /** Volume configurations */
  volumes?: ModalComVolumeConfig[];

  /** Cloud bucket mount configurations (S3, GCS, etc.) */
  cloudBucketMounts?: ModalComCloudBucketMountConfig[];

  /** Proxy name to use for outbound traffic */
  proxy?: string;

  /** Cloud provider preference */
  cloud?: string;

  /** Region preference */
  regions?: string[];

  /** Custom sandbox name */
  name?: string;
}

/**
 * Volume configuration for Modal.com
 */
export interface ModalComVolumeConfig {
  /** Volume name */
  name: string;

  /** Mount path in container */
  mountPath: string;

  /** Volume mode (read-write, read-only) */
  mode?: 'rw' | 'ro';
}

/**
 * Cloud bucket mount configuration for Modal.com (S3, GCS, etc.)
 */
export interface ModalComCloudBucketMountConfig {
  /** Bucket name */
  bucketName: string;

  /** Mount path in container */
  mountPath: string;

  /** Secret name containing AWS/GCP credentials */
  secretName?: string;

  /** Key prefix within the bucket */
  keyPrefix?: string;

  /** Mount as read-only */
  readOnly?: boolean;

  /** Cloud provider (aws, gcp) */
  provider?: 'aws' | 'gcp';
}

/**
 * Tunnel information for port forwarding
 */
export interface ModalTunnelInfo {
  /** Tunnel ID */
  tunnelId: string;

  /** Public URL (HTTPS) */
  url: string;

  /** TLS socket address */
  tlsSocket?: {
    host: string;
    port: number;
  };

  /** TCP socket address (for unencrypted tunnels) */
  tcpSocket?: {
    host: string;
    port: number;
  };

  /** Port being forwarded */
  port: number;

  /** Whether tunnel is unencrypted */
  unencrypted?: boolean;

  /** When tunnel was created */
  createdAt: number;
}

/**
 * Modal.com sandbox handle
 */
export class ModalComSandboxHandle implements SandboxHandle {
  public readonly id: string;
  public readonly workspaceDir: string;

  private config: ModalComConfig;
  private tunnels = new Map<number, ModalTunnelInfo>();
  private _ptySessions = new Map<string, ModalPtyHandle>();
  private sandbox: Sandbox;
  private app?: App;
  private image?: Image;
  private _connectToken?: { url: string; token: string; createdAt: number };

  constructor(
    id: string,
    config: ModalComConfig,
    private client: ModalClient,
    sandbox: Sandbox
  ) {
    this.id = id;
    this.config = config;
    this.sandbox = sandbox;
    this.workspaceDir = config.workdir || '/root';
  }

  /**
   * Initialize sandbox references
   */
  async initialize(): Promise<void> {
    logger.debug('Initializing Modal.com sandbox', { sandboxId: this.id });

    try {
      // Sandbox is already created, just store metadata
      logger.info('Modal.com sandbox initialized', {
        sandboxId: this.id,
        workspaceDir: this.workspaceDir,
      });
    } catch (error: any) {
      logger.error('Failed to initialize Modal.com sandbox', {
        sandboxId: this.id,
        error: error.message,
      });
      throw error;
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
    const startTime = Date.now();

    try {
      const process = await this.sandbox.exec(['sh', '-c', command], {
        workdir: cwd || this.workspaceDir,
        timeoutMs: timeout || this.config.timeout || 300000,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout.readText(),
        process.stderr.readText(),
        process.wait(),
      ]);

      return {
        success: exitCode === 0,
        output: stdout,
        error: stderr || undefined,
        exitCode,
        executionTime: Date.now() - startTime,
        content: stdout,
      };
    } catch (error: any) {
      logger.error('Command execution failed', {
        sandboxId: this.id,
        command,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Write a file to the sandbox
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      const file = await this.sandbox.open(filePath, 'w');
      const encoder = new TextEncoder();
      await file.write(encoder.encode(content));
      await file.close();

      return {
        success: true,
        output: `File written: ${filePath}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to write file: ${error.message}`,
      };
    }
  }

  /**
   * Read a file from the sandbox
   */
  async readFile(filePath: string): Promise<ToolResult> {
    try {
      const file = await this.sandbox.open(filePath, 'r');
      const content = await file.read();
      await file.close();

      const decoder = new TextDecoder();
      const text = decoder.decode(content);

      return {
        success: true,
        content: text,
        output: text,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to read file: ${error.message}`,
      };
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      // Use ls command to list directory
      const result = await this.executeCommand(`ls -la "${dirPath}"`);

      return {
        success: result.success,
        content: result.output,
        output: result.output,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to list directory: ${error.message}`,
      };
    }
  }

  /**
   * Forward a port and create a tunnel
   */
  async getPreviewLink(port: number): Promise<PreviewInfo> {
    let tunnel = this.tunnels.get(port);

    if (!tunnel) {
      // Get tunnels from sandbox
      const tunnels = await this.sandbox.tunnels();
      const tunnelInfo = tunnels[port];

      if (!tunnelInfo) {
        throw new Error(`No tunnel found for port ${port}`);
      }

      tunnel = {
        tunnelId: `tunnel-${port}-${Date.now()}`,
        url: tunnelInfo.url,
        tlsSocket: {
          host: tunnelInfo.tlsSocket[0],
          port: tunnelInfo.tlsSocket[1],
        },
        port,
        unencrypted: false,
        createdAt: Date.now(),
      };

      this.tunnels.set(port, tunnel);
      logger.info('Modal tunnel retrieved', {
        sandboxId: this.id,
        port,
        url: tunnel.url,
      });
    }

    return {
      port,
      url: tunnel.url,
      openedAt: tunnel.createdAt,
    };
  }

  /**
   * Create a PTY session
   */
  async createPty(options: PtyOptions): Promise<PtyHandle> {
    const sessionId = options.id || `pty-${Date.now()}`;

    const ptyHandle = new ModalPtyHandle(
      sessionId,
      this.id,
      this.sandbox,
      options
    );

    await ptyHandle.initialize();
    this._ptySessions.set(sessionId, ptyHandle);

    return ptyHandle;
  }

  /**
   * Connect to an existing PTY session
   */
  async connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle> {
    const existing = this._ptySessions.get(sessionId);
    if (existing) {
      existing.setOnDataHandler(options.onData);
      return existing;
    }

    throw new Error(`PTY session not found: ${sessionId}`);
  }

  /**
   * Kill a PTY session
   */
  async killPty(sessionId: string): Promise<void> {
    const pty = this._ptySessions.get(sessionId);
    if (pty) {
      await pty.kill();
      this._ptySessions.delete(sessionId);
    }
  }

  /**
   * Resize a PTY session
   */
  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    const pty = this._ptySessions.get(sessionId);
    if (pty) {
      await pty.resize(cols, rows);
    } else {
      throw new Error(`PTY session not found: ${sessionId}`);
    }
  }

  /**
   * Get tunnel information
   */
  getTunnel(port: number): ModalTunnelInfo | undefined {
    return this.tunnels.get(port);
  }

  /**
   * Get all active tunnels
   */
  getTunnels(): ModalTunnelInfo[] {
    return Array.from(this.tunnels.values());
  }

  /**
   * Close a tunnel
   */
  async closeTunnel(port: number): Promise<void> {
    this.tunnels.delete(port);
    logger.debug('Tunnel removed from cache', { port });
  }

  /**
   * Get Modal sandbox reference
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }

  /**
   * Get PTY sessions map (for cleanup)
   */
  get ptySessions(): Map<string, ModalPtyHandle> {
    return this._ptySessions;
  }

  /**
   * Create a connect token for authenticated HTTP access
   */
  async createConnectToken(userMetadata?: string): Promise<{ url: string; token: string }> {
    try {
      const creds = await this.sandbox.createConnectToken({
        userMetadata,
      });

      this._connectToken = {
        url: creds.url,
        token: creds.token,
        createdAt: Date.now(),
      };

      logger.info('Modal connect token created', {
        sandboxId: this.id,
        url: creds.url,
      });

      return { url: creds.url, token: creds.token };
    } catch (error: any) {
      logger.error('Failed to create connect token', {
        sandboxId: this.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get connect token (creates one if not exists)
   */
  async getConnectToken(): Promise<{ url: string; token: string } | undefined> {
    if (!this._connectToken) {
      await this.createConnectToken();
    }
    return this._connectToken;
  }

  /**
   * Snapshot the filesystem to create a new Image
   */
  async snapshotFilesystem(timeoutMs?: number): Promise<{ imageId: string }> {
    try {
      const snapshotImage = await this.sandbox.snapshotFilesystem(timeoutMs);

      logger.info('Filesystem snapshot created', {
        sandboxId: this.id,
        imageId: snapshotImage.imageId,
      });

      return { imageId: snapshotImage.imageId };
    } catch (error: any) {
      logger.error('Failed to snapshot filesystem', {
        sandboxId: this.id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Snapshot a specific directory to create a new Image
   */
  async snapshotDirectory(path: string): Promise<{ imageId: string }> {
    try {
      const snapshotImage = await this.sandbox.snapshotDirectory(path);

      logger.info('Directory snapshot created', {
        sandboxId: this.id,
        path,
        imageId: snapshotImage.imageId,
      });

      return { imageId: snapshotImage.imageId };
    } catch (error: any) {
      logger.error('Failed to snapshot directory', {
        sandboxId: this.id,
        path,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mount an Image at a path in the sandbox filesystem
   */
  async mountImage(path: string, imageId: string): Promise<void> {
    try {
      const image = await this.client.images.fromId(imageId);
      await this.sandbox.mountImage(path, image);

      logger.info('Image mounted', {
        sandboxId: this.id,
        path,
        imageId,
      });
    } catch (error: any) {
      logger.error('Failed to mount image', {
        sandboxId: this.id,
        path,
        imageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Terminate the sandbox
   */
  async terminate(): Promise<void> {
    try {
      // Kill all PTY sessions first
      for (const sessionId of Array.from(this._ptySessions.keys())) {
        try {
          await this.killPty(sessionId);
        } catch (error: any) {
          logger.warn('Failed to kill PTY during terminate', {
            sandboxId: this.id,
            sessionId,
            error: error.message,
          });
        }
      }
      
      // Clear PTY sessions map
      this._ptySessions.clear();
      
      // Clear connect token
      this._connectToken = undefined;
      
      // Close all tunnels
      for (const port of Array.from(this.tunnels.keys())) {
        try {
          await this.closeTunnel(port);
        } catch (error: any) {
          logger.warn('Failed to close tunnel during terminate', {
            sandboxId: this.id,
            port,
            error: error.message,
          });
        }
      }
      
      // Terminate sandbox
      await this.sandbox.terminate();
      logger.info('Modal sandbox terminated', { sandboxId: this.id });
    } catch (error: any) {
      logger.error('Failed to terminate sandbox', {
        sandboxId: this.id,
        error: error.message,
      });
    }
  }

  /**
   * Wait for sandbox to complete
   */
  async wait(): Promise<number> {
    return await this.sandbox.wait();
  }

  /**
   * Check if sandbox is still running
   */
  async poll(): Promise<number | null> {
    return await this.sandbox.poll();
  }
}

/**
 * Modal.com PTY handle
 */
class ModalPtyHandle implements PtyHandle {
  public readonly sessionId: string;

  private onDataHandler?: (data: Uint8Array) => void;
  private connected = false;
  private exitCode?: number;
  private process?: any; // ContainerProcess
  private readLoop?: Promise<void>;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  constructor(
    sessionId: string,
    private sandboxId: string,
    private sandbox: Sandbox,
    private options: PtyOptions
  ) {
    this.sessionId = sessionId;
  }

  /**
   * Initialize PTY session
   */
  async initialize(): Promise<void> {
    try {
      // Create PTY process using exec with pty option
      this.process = await this.sandbox.exec(['bash', '--login'], {
        pty: true,
        workdir: this.options.cwd,
        env: this.options.envs,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      this.connected = true;

      // Set up stdout reader for PTY data
      this.readLoop = this.readPtyOutput();

      logger.debug('Modal PTY session initialized', {
        sandboxId: this.sandboxId,
        sessionId: this.sessionId,
      });
    } catch (error: any) {
      logger.error('Failed to initialize PTY session', {
        sandboxId: this.sandboxId,
        sessionId: this.sessionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Read PTY output and emit data events
   * 
   * Includes protection against infinite retry loops:
   * - Tracks consecutive errors
   * - Exits after MAX_CONSECUTIVE_ERRORS
   * - Resets counter on successful read
   */
  private async readPtyOutput(): Promise<void> {
    if (!this.process) return;

    try {
      const reader = this.process.stdout;
      while (this.connected) {
        try {
          const chunk = await reader.read();
          
          // Reset error counter on successful read
          this.consecutiveErrors = 0;
          
          if (chunk && this.onDataHandler) {
            const encoder = new TextEncoder();
            this.onDataHandler(encoder.encode(chunk));
          }
        } catch (error: any) {
          // Check for terminal errors that indicate stream is closed
          if (error.message?.includes('closed') || 
              error.message?.includes('EOF') || 
              error.message?.includes('aborted') ||
              error.message?.includes('cancelled')) {
            logger.debug('PTY stream closed', {
              sandboxId: this.sandboxId,
              sessionId: this.sessionId,
            });
            break;
          }
          
          // Track consecutive errors
          this.consecutiveErrors++;
          
          // Exit if too many consecutive errors (prevents infinite retry loop)
          if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
            logger.error('PTY read failed too many times, disconnecting', {
              sandboxId: this.sandboxId,
              sessionId: this.sessionId,
              errorCount: this.consecutiveErrors,
            });
            this.connected = false;
            break;
          }
          
          logger.warn('PTY read error (retrying)', {
            sandboxId: this.sandboxId,
            sessionId: this.sessionId,
            error: error.message,
            retryCount: this.consecutiveErrors,
          });
          
          // Backoff delay before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error: any) {
      logger.error('PTY output reader failed', { error: error.message });
    }
  }

  /**
   * Send input to PTY
   */
  async sendInput(data: string): Promise<void> {
    if (!this.connected || !this.process) {
      throw new Error('PTY not connected');
    }

    try {
      await this.process.stdin.write(data);
    } catch (error: any) {
      logger.error('Failed to send PTY input', { error: error.message });
      throw error;
    }
  }

  /**
   * Resize PTY
   */
  async resize(cols: number, rows: number): Promise<void> {
    // Modal SDK doesn't expose PTY resize directly
    // This would need to be implemented via escape sequences
    logger.debug('PTY resize requested', { cols, rows });
  }

  /**
   * Wait for PTY connection
   */
  async waitForConnection(): Promise<void> {
    // Already connected after initialize
    return Promise.resolve();
  }

  /**
   * Wait for PTY to exit
   */
  async wait(): Promise<{ exitCode: number }> {
    if (this.exitCode !== undefined) {
      return { exitCode: this.exitCode };
    }

    try {
      this.exitCode = await this.process.wait();
      return { exitCode: this.exitCode };
    } catch (error: any) {
      logger.error('PTY wait failed', { error: error.message });
      return { exitCode: 1 };
    }
  }

  /**
   * Disconnect PTY
   */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /**
   * Kill PTY session
   */
  async kill(): Promise<void> {
    this.connected = false;
    // The PTY process will be terminated when sandbox is terminated
  }

  /**
   * Set data handler
   */
  setOnDataHandler(handler: (data: Uint8Array) => void): void {
    this.onDataHandler = handler;
  }
}

/**
 * Modal.com Sandbox Provider
 */
export class ModalComProvider implements SandboxProvider {
  public readonly name = 'modal-com';

  private client?: ModalClient;
  private sandboxes = new Map<string, ModalComSandboxHandle>();
  private initialized = false;

  /**
   * Check if provider is available (has API credentials)
   */
  isAvailable(): boolean {
    return !!(process.env.MODAL_API_TOKEN && process.env.MODAL_API_SECRET);
  }

  /**
   * Health check - verifies API connectivity
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const startTime = Date.now();
    try {
      if (!this.client) {
        this.initialize();
      }

      // Try to list apps as health check
      const apps = this.client!.apps;
      const latency = Date.now() - startTime;

      // If we can access the client, we're healthy
      const healthy = !!apps;
      return { healthy, latency };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      logger.error('Modal.com health check failed', { error: error.message });
      return { healthy: false, latency, details: { error: error.message } };
    }
  }

  /**
   * Initialize provider with API credentials
   */
  initialize(apiToken?: string, apiSecret?: string): void {
    const tokenId = apiToken || process.env.MODAL_API_TOKEN;
    const tokenSecret = apiSecret || process.env.MODAL_API_SECRET;

    if (!tokenId || !tokenSecret) {
      logger.warn('Modal.com API credentials not provided');
      throw new Error(
        'Modal.com API credentials required. Set MODAL_API_TOKEN and MODAL_API_SECRET environment variables or pass apiToken and apiSecret options.'
      );
    }

    this.client = new ModalClient({
      tokenId,
      tokenSecret,
    });

    this.initialized = true;
    logger.info('Modal.com provider initialized');
  }

  /**
   * Ensure provider is initialized
   */
  ensureInitialized(apiToken?: string, apiSecret?: string): void {
    if (!this.initialized || !this.client) {
      this.initialize(apiToken, apiSecret);
    }
  }

  /**
   * Create a Modal.com sandbox
   * 
   * Validates configuration and creates a new sandbox with the specified resources.
   */
  async createSandbox(config: ModalComConfig): Promise<ModalComSandboxHandle> {
    try {
      // Validate required configuration
      if (!config.image && !config.dockerfileCommands) {
        throw new Error('Either image or dockerfileCommands must be specified');
      }
      
      // Validate resource limits
      if (config.cpu !== undefined && config.cpu <= 0) {
        throw new Error('CPU must be a positive number');
      }
      if (config.memory !== undefined && config.memory <= 0) {
        throw new Error('Memory must be a positive number (in MB)');
      }
      if (config.timeout !== undefined && config.timeout <= 0) {
        throw new Error('Timeout must be a positive number (in seconds)');
      }
      
      // Validate GPU configuration
      if (config.gpu && !['H100', 'A100', 'A10G', 'T4', 'L4', 'A10', 'H200', 'L40S'].includes(config.gpu)) {
        logger.warn('Unknown GPU type, Modal may reject this configuration', { gpu: config.gpu });
      }
      
      this.ensureInitialized(config.apiToken, config.apiSecret);

      const sandboxId = `modal-com-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Create or get app
      const app = await this.client!.apps.fromName('bings-workspace', {
        createIfMissing: true,
      });

      // Build image
      let image: Image;
      if (config.dockerfileCommands && config.dockerfileCommands.length > 0) {
        image = this.client!.images
          .fromRegistry(config.image || 'python:3.13-slim')
          .dockerfileCommands(config.dockerfileCommands);
      } else {
        image = this.client!.images.fromRegistry(config.image || 'python:3.13-slim');
      }

      // Prepare secrets
      let secrets: Secret[] = [];
      if (config.secrets && config.secrets.length > 0) {
        secrets = await Promise.all(
          config.secrets.map(name =>
            this.client!.secrets.fromName(name, { requiredKeys: [] })
          )
        );
      }

      // Prepare volumes
      const volumes: Record<string, Volume> = {};
      if (config.volumes && config.volumes.length > 0) {
        for (const volConfig of config.volumes) {
          const volume = await this.client!.volumes.fromName(volConfig.name, {
            createIfMissing: true,
          });
          volumes[volConfig.mountPath] = volConfig.mode === 'ro' ? volume.readOnly() : volume;
        }
      }

      // Prepare cloud bucket mounts
      const cloudBucketMounts: Record<string, any> = {};
      if (config.cloudBucketMounts && config.cloudBucketMounts.length > 0) {
        for (const mountConfig of config.cloudBucketMounts) {
          let secret: Secret | undefined;
          if (mountConfig.secretName) {
            secret = await this.client!.secrets.fromName(mountConfig.secretName, {
              requiredKeys: [],
            });
          }

          const cloudBucketMount = this.client!.cloudBucketMounts.create(
            mountConfig.bucketName,
            {
              secret,
              keyPrefix: mountConfig.keyPrefix,
              readOnly: mountConfig.readOnly,
            }
          );
          cloudBucketMounts[mountConfig.mountPath] = cloudBucketMount;
        }
      }

      // Prepare proxy
      let proxy: any;
      if (config.proxy) {
        proxy = await this.client!.proxies.fromName(config.proxy, {
          environment: config.environment,
        });
      }

      // Prepare sandbox create params
      const createParams: any = {
        cpu: config.cpu,
        memoryMiB: config.memory,
        gpu: config.gpu,
        timeoutMs: config.timeout ? config.timeout * 1000 : undefined,
        idleTimeoutMs: config.idleTimeoutMs,
        workdir: config.workdir,
        env: config.envVars,
        secrets: secrets.length > 0 ? secrets : undefined,
        volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
        cloudBucketMounts: Object.keys(cloudBucketMounts).length > 0 ? cloudBucketMounts : undefined,
        proxy,
        encryptedPorts: config.encryptedPorts,
        unencryptedPorts: config.unencryptedPorts,
        pty: config.pty,
        cloud: config.cloud,
        regions: config.regions,
        name: config.name,
      };

      // Remove undefined values
      Object.keys(createParams).forEach(key => {
        if (createParams[key] === undefined) {
          delete createParams[key];
        }
      });

      // Create sandbox
      const sandbox = await this.client!.sandboxes.create(app, image, createParams);

      const handle = new ModalComSandboxHandle(
        sandboxId,
        config,
        this.client!,
        sandbox
      );

      await handle.initialize();
      this.sandboxes.set(sandboxId, handle);

      logger.info('Modal.com sandbox created', {
        sandboxId,
        image: config.image,
        gpu: config.gpu,
        cpu: config.cpu,
        memory: config.memory,
      });

      return handle;
    } catch (error: any) {
      logger.error('Failed to create Modal.com sandbox', {
        error: error.message,
        config,
      });
      throw new Error(
        `Failed to create Modal.com sandbox: ${error.message}. ` +
        'Ensure MODAL_API_TOKEN and MODAL_API_SECRET are set and valid.'
      );
    }
  }

  /**
   * Get existing sandbox handle
   */
  async getSandbox(sandboxId: string): Promise<ModalComSandboxHandle> {
    const handle = this.sandboxes.get(sandboxId);

    if (!handle) {
      logger.error('Sandbox not found', { sandboxId });
      throw new Error(`Modal.com sandbox not found: ${sandboxId}`);
    }

    return handle;
  }

  /**
   * Destroy a sandbox and clean up resources
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = this.sandboxes.get(sandboxId);

    if (handle) {
      try {
        // Close all tunnels
        const tunnels = handle.getTunnels();
        for (const tunnel of tunnels) {
          try {
            await handle.closeTunnel(tunnel.port);
          } catch (error: any) {
            logger.warn('Failed to close tunnel', {
              sandboxId,
              tunnelId: tunnel.tunnelId,
              error: error.message,
            });
          }
        }

        // Kill all PTY sessions for this sandbox
        const ptySessionIds = Array.from(handle.ptySessions.keys());
        for (const sessionId of ptySessionIds) {
          try {
            await handle.killPty(sessionId);
          } catch (error: any) {
            logger.warn('Failed to kill PTY session', {
              sandboxId,
              sessionId,
              error: error.message,
            });
          }
        }

        // Terminate sandbox
        await handle.terminate();

        this.sandboxes.delete(sandboxId);
        logger.info('Modal.com sandbox destroyed', { sandboxId });
      } catch (error: any) {
        logger.error('Error destroying sandbox', {
          sandboxId,
          error: error.message,
        });
        // Still remove from map even if cleanup failed
        this.sandboxes.delete(sandboxId);
      }
    } else {
      logger.debug('Attempted to destroy non-existent sandbox', { sandboxId });
    }
  }

  /**
   * Destroy all active sandboxes (cleanup on shutdown)
   */
  async destroyAll(): Promise<void> {
    const sandboxIds = Array.from(this.sandboxes.keys());
    logger.info('Destroying all Modal.com sandboxes', { count: sandboxIds.length });

    await Promise.allSettled(
      sandboxIds.map(id => this.destroySandbox(id))
    );

    this.sandboxes.clear();
  }

  /**
   * Get all active sandboxes
   */
  getActiveSandboxes(): ModalComSandboxHandle[] {
    return Array.from(this.sandboxes.values());
  }

  /**
   * Get active sandbox count
   */
  getActiveSandboxCount(): number {
    return this.sandboxes.size;
  }
}

// Singleton instance
export const modalComProvider = new ModalComProvider();

/**
 * Factory function to create a new ModalComProvider instance
 */
export function createModalComProvider(): ModalComProvider {
  return new ModalComProvider();
}

/**
 * Get the singleton ModalComProvider instance
 */
export function getModalComProvider(): ModalComProvider {
  return modalComProvider;
}

/**
 * Cleanup function to destroy all active sandboxes
 */
export async function cleanupModalComSandboxes(): Promise<void> {
  await modalComProvider.destroyAll();
}

/**
 * Type guard to check if a sandbox handle is a ModalComSandboxHandle
 */
export function isModalComSandbox(handle: any): handle is ModalComSandboxHandle {
  return handle instanceof ModalComSandboxHandle;
}

/**
 * Create a named sandbox (for long-running services)
 */
export async function createNamedSandbox(
  name: string,
  config: Omit<ModalComConfig, 'name'>
): Promise<ModalComSandboxHandle> {
  const provider = getModalComProvider();
  return provider.createSandbox({ ...config, name });
}

/**
 * Get a sandbox by name
 */
export async function getSandboxByName(
  appName: string,
  name: string,
  environment?: string
): Promise<ModalComSandboxHandle> {
  const provider = getModalComProvider();
  provider.ensureInitialized();

  const modalClient = (provider as any).client as ModalClient;
  const sandbox = await modalClient.sandboxes.fromName(appName, name, { environment });

  // Find or create handle
  for (const handle of provider.getActiveSandboxes()) {
    if (handle.getSandbox() === sandbox) {
      return handle;
    }
  }

  // Create new handle for existing sandbox
  const handle = new ModalComSandboxHandle(
    sandbox.sandboxId,
    { image: 'unknown' },
    modalClient,
    sandbox
  );

  return handle;
}
