/**
 * Nullclaw Integration (Hybrid: URL + Container Fallback)
 *
 * Integrates Nullclaw task assistant with flexible deployment:
 * - Primary: URL-based (docker-compose, external service)
 * - Fallback: Local container spawning (development, isolated instances)
 *
 * Provides non-coding agency:
 * - Discord/Telegram messaging
 * - Internet browsing and data extraction
 * - Server automation
 * - API integrations
 * - Scheduled tasks
 *
 * Configuration Priority:
 * 1. NULLCLAW_URL - Use external service (recommended for production)
 * 2. NULLCLAW_MODE=shared - Single shared container (default for local)
 * 3. NULLCLAW_MODE=per-session - Container per session (isolated)
 *
 * Architecture:
 * ┌─────────────────┐     HTTP      ┌─────────────────┐
 * │  OpenCode Agent │ ◄──────────►  │  Nullclaw       │
 * │  (Sandbox A)    │   API Calls   │  Service (URL)  │
 * └─────────────────┘               └─────────────────┘
 *         │                               │
 *         │ (fallback)                    ▼
 *         │                        ┌─────────────────┐
 *         └───────────────────────►│  Nullclaw       │
 *           Docker Spawn           │  Container Pool │
 *                                  └────────┬────────┘
 *                                           │
 *                                           ▼
 *                                    ┌─────────────────┐
 *                                    │  External APIs  │
 *                                    │  - Discord      │
 *                                    │  - Telegram     │
 *                                    │  - Web Browsing │
 *                                    └─────────────────┘
 *
 * Environment Variables:
 * - NULLCLAW_URL: Base URL (e.g., 'http://nullclaw:3000' or 'http://localhost:3001')
 * - NULLCLAW_API_KEY: Optional API key for authentication
 * - NULLCLAW_MODE: 'shared' (default) or 'per-session'
 * - NULLCLAW_POOL_SIZE: Number of containers in pool (default: 2, max: 4)
 * - NULLCLAW_IMAGE: Docker image (default: 'ghcr.io/nullclaw/nullclaw:latest')
 * - NULLCLAW_PORT: Base port (default: 3001)
 * - NULLCLAW_TIMEOUT: Request timeout in seconds (default: 300)
 * - NULLCLAW_ALLOWED_DOMAINS: Comma-separated allowed domains
 */

import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('Agent:Nullclaw');

export interface NullclawConfig {
  // URL-based configuration (primary)
  baseUrl?: string;           // e.g., 'http://nullclaw:3000' or 'http://localhost:3001'
  apiKey?: string;            // Optional API key for authentication
  
  // Container-based configuration (fallback)
  mode?: 'shared' | 'per-session';  // Container sharing mode
  poolSize?: number;          // Number of containers in pool (shared mode)
  image?: string;             // Docker image
  basePort?: number;          // Base port for containers
  timeout?: number;           // Request timeout in milliseconds
  allowedDomains?: string[];  // Network egress rules
  healthCheckTimeout?: number; // Health check timeout in ms
  dockerNetwork?: string;     // Docker network for communication
}

export interface NullclawContainer {
  id: string;
  containerId?: string;       // Docker container ID (if locally spawned)
  endpoint: string;           // Base URL for API calls
  port: number;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  healthUrl: string;
  isExternal: boolean;        // true if using external URL, false if locally spawned
  assignedSessions?: string[]; // Sessions assigned to this container
}

export interface NullclawTask {
  id: string;
  type: 'message' | 'browse' | 'automate' | 'api' | 'schedule';
  description: string;
  params: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  containerId?: string;       // Which container executed this task
}

export interface NullclawStatus {
  available: boolean;
  mode: 'url' | 'shared' | 'per-session';
  baseUrl?: string;
  containers: {
    total: number;
    ready: number;
    starting: number;
    error: number;
  };
  health: 'healthy' | 'unhealthy' | 'unknown';
  tasks: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
}

class NullclawIntegration {
  private readonly defaultConfig: NullclawConfig = {
    baseUrl: process.env.NULLCLAW_URL,
    apiKey: process.env.NULLCLAW_API_KEY,
    mode: (process.env.NULLCLAW_MODE as 'shared' | 'per-session') || 'shared',
    poolSize: parseInt(process.env.NULLCLAW_POOL_SIZE || '2'),
    image: process.env.NULLCLAW_IMAGE || 'ghcr.io/nullclaw/nullclaw:latest',
    basePort: parseInt(process.env.NULLCLAW_PORT || '3001'),
    timeout: parseInt(process.env.NULLCLAW_TIMEOUT || '300000'),
    allowedDomains: (process.env.NULLCLAW_ALLOWED_DOMAINS || 'openrouter.ai,api.discord.com,api.telegram.org').split(','),
    healthCheckTimeout: parseInt(process.env.NULLCLAW_HEALTH_TIMEOUT || '30000'),
    dockerNetwork: process.env.NULLCLAW_NETWORK || 'bing-network',
  };

  private containers = new Map<string, NullclawContainer>();
  private sessionContainers = new Map<string, string>(); // sessionKey -> containerId
  private tasks = new Map<string, NullclawTask>();
  private initializationPromise: Promise<void> | null = null;

  /**
   * Check if URL-based configuration is available
   */
  private isUrlMode(): boolean {
    return !!this.defaultConfig.baseUrl;
  }

  /**
   * Get Nullclaw configuration
   */
  getConfig(): NullclawConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Check if Nullclaw is configured and available
   */
  isAvailable(): boolean {
    return this.isUrlMode() || this.containers.size > 0;
  }

  /**
   * Get current mode
   */
  getMode(): 'url' | 'shared' | 'per-session' {
    if (this.isUrlMode()) return 'url';
    return this.defaultConfig.mode || 'shared';
  }

  /**
   * Make HTTP request to Nullclaw service
   */
  private async request<T>(
    endpoint: string,
    container?: NullclawContainer,
    options: RequestInit = {}
  ): Promise<T> {
    const targetContainer = container || this.getAvailableContainer();
    if (!targetContainer) {
      throw new Error('No Nullclaw container available');
    }

    const { apiKey, timeout } = this.defaultConfig;
    const baseUrl = targetContainer.endpoint;
    
    const url = `${baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      ...options.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Nullclaw request failed (${response.status}): ${errorText}`);
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      return JSON.parse(text) as T;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Nullclaw request timeout (${timeout}ms)`);
      }
      throw error;
    }
  }

  /**
   * Get or create container for session
   */
  getContainerForSession(userId: string, conversationId: string): NullclawContainer | undefined {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    
    if (containerId) {
      const container = this.containers.get(containerId);
      // Return only if container exists and is ready
      if (container && container.status === 'ready') {
        return container;
      }
      // Container not ready, clear assignment
      this.sessionContainers.delete(sessionKey);
    }

    // In per-session mode, never fall back to another session's container
    if (this.defaultConfig.mode === 'per-session') {
      return undefined;
    }

    // Shared mode or URL mode: return any ready container
    return this.getAvailableContainer();
  }

  /**
   * Get available container from pool
   */
  private getAvailableContainer(): NullclawContainer | undefined {
    const readyContainers = Array.from(this.containers.values()).filter(c => c.status === 'ready');
    
    if (readyContainers.length === 0) {
      return undefined;
    }

    // Simple round-robin: return first ready container
    // Could be enhanced with load balancing logic
    return readyContainers[0];
  }

  /**
   * Get next available port for container
   * 
   * FIX (Bug 12): Scans up to 64 ports to find free slot, avoiding collisions
   * with error-state containers and pools larger than poolSize.
   */
  private getNextAvailablePort(): number {
    const basePort = this.defaultConfig.basePort || 3001;
    const usedPorts = new Set(
      Array.from(this.containers.values()).map((c) => c.port),
    );

    // Scan up to basePort + 64 to find a free slot; never blindly use
    // basePort + containers.size which can alias an occupied port.
    for (let offset = 0; offset < 64; offset++) {
      const candidate = basePort + offset;
      if (!usedPorts.has(candidate)) return candidate;
    }

    throw new Error('No available ports for Nullclaw container (all 64 slots occupied)');
  }

  /**
   * Initialize Nullclaw (URL or container pool)
   * 
   * FIX (Bug 11): Prevents concurrent initialization by storing promise BEFORE
   * async work begins, and clearing it only AFTER completion.
   */
  async initialize(): Promise<void> {
    // If already initialized (containers exist), skip
    if (this.isAvailable()) return;

    // If an init is in-flight, join it instead of starting a new one
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Create and store the promise BEFORE starting the async work so
    // any concurrent caller that arrives while we are awaiting will
    // find the promise already set and join it.
    this.initializationPromise = (async () => {
      try {
        if (this.isUrlMode()) {
          logger.info(`Using Nullclaw URL: ${this.defaultConfig.baseUrl}`);
          const container: NullclawContainer = {
            id: 'nullclaw-external',
            endpoint: this.defaultConfig.baseUrl!,
            port: new URL(this.defaultConfig.baseUrl!).port ? parseInt(new URL(this.defaultConfig.baseUrl!).port) : 80,
            status: 'ready',
            healthUrl: `${this.defaultConfig.baseUrl}/health`,
            isExternal: true,
            assignedSessions: [],
          };
          this.containers.set(container.id, container);
          logger.info('Nullclaw external service registered');
        } else {
          // Container mode: spawn pool based on NULLCLAW_MODE
          const mode = this.defaultConfig.mode || 'shared';
          const poolSize = mode === 'per-session' ? 1 : (this.defaultConfig.poolSize || 2);

          logger.info(`Spawning Nullclaw container pool (mode: ${mode}, size: ${poolSize})`);

          const spawnPromises = Array.from({ length: poolSize }, (_, i) =>
            this.spawnContainer(`nullclaw-pool-${i}`)
          );

          await Promise.all(spawnPromises);
          logger.info(`Nullclaw container pool ready (${poolSize} containers)`);
        }
      } catch (error) {
        // Clear promise so callers can retry after a failure
        this.initializationPromise = null;
        throw error;
      }
      // Clear only on success — keep alive during the await so concurrent
      // callers always join the same promise while it is pending.
      this.initializationPromise = null;
    })();

    return this.initializationPromise;
  }

  /**
   * Initialize Nullclaw for a specific session (for per-session mode)
   */
  async initializeForSession(userId: string, conversationId: string): Promise<string | undefined> {
    const sessionKey = `${userId}:${conversationId}`;
    
    // Check if already has container
    const existingContainer = this.getContainerForSession(userId, conversationId);
    if (existingContainer) {
      return existingContainer.endpoint;
    }

    // In per-session mode, spawn dedicated container
    if (this.defaultConfig.mode === 'per-session') {
      const containerId = `nullclaw-session-${uuidv4()}`;
      const container = await this.spawnContainer(containerId);
      
      this.sessionContainers.set(sessionKey, container.id);
      logger.info(`Spawned dedicated Nullclaw container for session ${sessionKey}`);
      
      return container.endpoint;
    }

    // In shared mode, ensure pool is initialized
    await this.initialize();
    const sharedContainer = this.getAvailableContainer();
    
    if (sharedContainer) {
      this.sessionContainers.set(sessionKey, sharedContainer.id);
      return sharedContainer.endpoint;
    }

    return undefined;
  }

  /**
   * Spawn a single Nullclaw container
   * 
   * FIX (Bug 13): Cleans up error-state containers from the pool so they
   * don't pollute container counts. Also avoids leaving 'starting' containers
   * in the map when spawn rejects.
   */
  private async spawnContainer(containerId: string): Promise<NullclawContainer> {
    const config = this.defaultConfig;
    const port = await this.getNextAvailablePort();
    const container: NullclawContainer = {
      id: containerId,
      containerId: undefined,
      endpoint: `http://localhost:${port}`,
      port,
      status: 'starting',
      healthUrl: `http://localhost:${port}/health`,
      isExternal: false,
      assignedSessions: [],
    };

    // Register optimistically so port is reserved; will be removed on failure
    this.containers.set(containerId, container);

    return new Promise((resolve, reject) => {
      logger.debug(`Spawning Nullclaw container: docker run -d --name ${containerId} -p ${port}:3000`);

      const docker = spawn('docker', [
        'run', '-d',
        '--name', containerId,
        '-p', `${port}:3000`,
        '--network', config.dockerNetwork || 'host',
        '-e', `NULLCLAW_ALLOWED_DOMAINS=${config.allowedDomains?.join(',')}`,
        '--restart', 'unless-stopped',
        config.image || 'ghcr.io/nullclaw/nullclaw:latest',
      ]);

      docker.stdout.on('data', (data) => {
        const dockerContainerId = data.toString().trim();
        container.containerId = dockerContainerId;
        logger.info(`Nullclaw container spawned: ${dockerContainerId} on port ${port}`);
      });

      docker.stderr.on('data', (data) => {
        // Log but don't fail — docker stderr can contain non-fatal warnings
        logger.warn(`Nullclaw docker stderr: ${data.toString().trim()}`);
      });

      docker.on('close', async (code) => {
        if (code === 0) {
          // Wait for health check
          const healthy = await this.waitForHealth(container);
          if (healthy) {
            container.status = 'ready';
            resolve(container);
          } else {
            // FIX: remove error containers so the pool stays clean
            container.status = 'error';
            this.containers.delete(containerId);
            reject(new Error(`Nullclaw container ${containerId} failed health check`));
          }
        } else {
          container.status = 'error';
          this.containers.delete(containerId); // FIX: clean up
          reject(new Error(`Nullclaw spawn exited with code ${code}`));
        }
      });

      docker.on('error', async (error) => {
        container.status = 'error';
        this.containers.delete(containerId); // FIX: clean up
        reject(new Error(`Nullclaw spawn failed: ${error.message}`));
      });
    });
  }

  /**
   * Cleanup container on failure
   */
  private async cleanupContainer(container: NullclawContainer): Promise<void> {
    // Remove from containers map if present
    this.containers.delete(container.id);
    
    // Try to stop docker container if it was created
    if (container.containerId) {
      try {
        const { spawn } = await import('child_process');
        const docker = spawn('docker', ['rm', '-f', container.containerId]);
        docker.on('close', () => {
          logger.debug(`Cleaned up docker container ${container.containerId}`);
        });
      } catch (error) {
        logger.error(`Failed to cleanup docker container:`, error);
      }
    }
  }

  /**
   * Wait for container to be healthy
   */
  private async waitForHealth(container: NullclawContainer, maxAttempts = 30): Promise<boolean> {
    const timeout = this.defaultConfig.healthCheckTimeout || 30000;
    const interval = timeout / maxAttempts;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(container.healthUrl);
        if (response.ok) {
          return true;
        }
      } catch {
        // Health check failed, retry
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return false;
  }

  /**
   * Check Nullclaw health
   * 
   * FIX (Bug 14): Returns 'unhealthy' (not 'unknown') when all containers
   * fail their health checks. Returns 'unknown' only when there are no
   * containers at all.
   */
  async checkHealth(): Promise<'healthy' | 'unhealthy' | 'unknown'> {
    const containers = Array.from(this.containers.values());

    if (containers.length === 0) return 'unknown';

    const results = await Promise.all(
      containers.map(async (c) => {
        try {
          await this.request('/health', c);
          return true;
        } catch {
          return false;
        }
      }),
    );

    const healthyCount = results.filter(Boolean).length;

    if (healthyCount === containers.length) return 'healthy';
    // FIX: any failure → 'unhealthy'; 'unknown' is only for zero containers
    return 'unhealthy';
  }

  /**
   * Execute a task on Nullclaw
   */
  async executeTask(
    type: NullclawTask['type'],
    description: string,
    params: Record<string, any>,
    userId?: string,
    conversationId?: string
  ): Promise<NullclawTask> {
    // Ensure initialized
    if (!this.isAvailable()) {
      await this.initialize();
    }

    // Get container for session
    const container = (userId && conversationId) 
      ? this.getContainerForSession(userId, conversationId)
      : this.getAvailableContainer();

    if (!container) {
      throw new Error('No Nullclaw container available');
    }

    const fullTask: NullclawTask = {
      type,
      description,
      params,
      id: uuidv4(),
      status: 'pending',
      createdAt: new Date(),
      containerId: container.id,
    };

    this.tasks.set(fullTask.id, fullTask);

    try {
      logger.debug(`Executing Nullclaw task: ${type} - ${description}`);

      // Send task to Nullclaw via HTTP API
      const result = await this.request<any>('/tasks/execute', container, {
        method: 'POST',
        body: JSON.stringify({
          type: fullTask.type,
          description: fullTask.description,
          params: fullTask.params,
        }),
      });

      fullTask.status = 'completed';
      fullTask.result = result;
      fullTask.completedAt = new Date();

      logger.debug(`Nullclaw task completed: ${type}`);
    } catch (error: any) {
      fullTask.status = 'failed';
      fullTask.error = error.message;
      logger.error(`Nullclaw task failed: ${type}`, error);
    }

    this.tasks.set(fullTask.id, fullTask);
    return fullTask;
  }

  /**
   * Send Discord message via Nullclaw
   */
  async sendDiscordMessage(channelId: string, message: string, userId?: string, conversationId?: string): Promise<NullclawTask> {
    return this.executeTask('message', `Send Discord message to channel ${channelId}`, { channelId, message }, userId, conversationId);
  }

  /**
   * Send Telegram message via Nullclaw
   */
  async sendTelegramMessage(chatId: string, message: string, userId?: string, conversationId?: string): Promise<NullclawTask> {
    return this.executeTask('message', `Send Telegram message to chat ${chatId}`, { chatId, message }, userId, conversationId);
  }

  /**
   * Browse URL via Nullclaw
   */
  async browseUrl(url: string, action?: string, userId?: string, conversationId?: string): Promise<NullclawTask> {
    return this.executeTask('browse', `Browse ${url}${action ? ` and ${action}` : ''}`, { url, action }, userId, conversationId);
  }

  /**
   * Execute automation task via Nullclaw
   */
  async automateTask(commands: string[], serverId?: string, userId?: string, conversationId?: string): Promise<NullclawTask> {
    return this.executeTask('automate', `Execute ${commands.length} command(s)${serverId ? ` on server ${serverId}` : ''}`, { commands, serverId }, userId, conversationId);
  }

  /**
   * Get task status
   */
  getTask(taskId: string): NullclawTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get task statistics
   */
  getTaskStats(): { pending: number; running: number; completed: number; failed: number } {
    const stats = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const task of this.tasks.values()) {
      stats[task.status]++;
    }
    return stats;
  }

  /**
   * Get Nullclaw status
   */
  async getStatus(): Promise<NullclawStatus> {
    const containers = Array.from(this.containers.values());
    const health = await this.checkHealth();
    
    return {
      available: this.isAvailable(),
      mode: this.getMode(),
      baseUrl: this.isUrlMode() ? this.defaultConfig.baseUrl : undefined,
      containers: {
        total: containers.length,
        ready: containers.filter(c => c.status === 'ready').length,
        starting: containers.filter(c => c.status === 'starting').length,
        error: containers.filter(c => c.status === 'error').length,
      },
      health,
      tasks: this.getTaskStats(),
    };
  }

  /**
   * Clear completed tasks older than specified time
   */
  cleanupTasks(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      if (
        (task.status === 'completed' || task.status === 'failed') &&
        task.completedAt &&
        (now - task.completedAt.getTime() > maxAgeMs)
      ) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * Stop a specific container (only for locally spawned)
   */
  async stopContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    if (!container || container.isExternal) {
      return;
    }

    if (container.containerId) {
      try {
        await new Promise<void>((resolve, reject) => {
          const docker = spawn('docker', ['stop', container.containerId!]);
          docker.on('close', () => resolve());
          docker.on('error', reject);
        });
        logger.info(`Stopped Nullclaw container: ${containerId}`);
        this.containers.delete(containerId);
      } catch (error) {
        logger.error(`Failed to stop container ${containerId}:`, error);
      }
    }
  }

  /**
   * Shutdown and cleanup all containers (only for locally spawned)
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Nullclaw integration...');

    // Only stop locally spawned containers
    for (const container of this.containers.values()) {
      if (!container.isExternal && container.containerId) {
        try {
          await this.stopContainer(container.id);
        } catch (error) {
          logger.error(`Failed to stop container ${container.id}:`, error);
        }
      }
    }

    this.containers.clear();
    this.sessionContainers.clear();
    logger.info('Nullclaw shutdown complete');
  }
}

// Singleton instance
export const nullclawIntegration = new NullclawIntegration();

/**
 * Initialize Nullclaw (call at app startup)
 */
export async function initializeNullclaw(): Promise<void> {
  return nullclawIntegration.initialize();
}

/**
 * Check if Nullclaw is available
 */
export function isNullclawAvailable(): boolean {
  return nullclawIntegration.isAvailable();
}

/**
 * Get Nullclaw status
 */
export async function getNullclawStatus(): Promise<NullclawStatus> {
  return nullclawIntegration.getStatus();
}

/**
 * Get Nullclaw configuration
 */
export function getNullclawConfig(): NullclawConfig {
  return nullclawIntegration.getConfig();
}

/**
 * Get Nullclaw mode
 */
export function getNullclawMode(): 'url' | 'shared' | 'per-session' {
  return nullclawIntegration.getMode();
}

/**
 * Execute a Nullclaw task
 */
export async function executeNullclawTask(
  type: NullclawTask['type'],
  description: string,
  params: Record<string, any>,
  userId?: string,
  conversationId?: string
): Promise<NullclawTask> {
  return nullclawIntegration.executeTask(type, description, params, userId, conversationId);
}

/**
 * Send Discord message via Nullclaw
 */
export async function sendNullclawDiscordMessage(
  channelId: string,
  message: string,
  userId?: string,
  conversationId?: string
): Promise<NullclawTask> {
  return nullclawIntegration.sendDiscordMessage(channelId, message, userId, conversationId);
}

/**
 * Send Telegram message via Nullclaw
 */
export async function sendNullclawTelegramMessage(
  chatId: string,
  message: string,
  userId?: string,
  conversationId?: string
): Promise<NullclawTask> {
  return nullclawIntegration.sendTelegramMessage(chatId, message, userId, conversationId);
}

/**
 * Browse URL via Nullclaw
 */
export async function browseNullclawUrl(
  url: string,
  action?: string,
  userId?: string,
  conversationId?: string
): Promise<NullclawTask> {
  return nullclawIntegration.browseUrl(url, action, userId, conversationId);
}

/**
 * Execute automation via Nullclaw
 */
export async function automateNullclawTask(
  commands: string[],
  serverId?: string,
  userId?: string,
  conversationId?: string
): Promise<NullclawTask> {
  return nullclawIntegration.automateTask(commands, serverId, userId, conversationId);
}

/**
 * Shutdown Nullclaw (call at app shutdown)
 */
export async function shutdownNullclaw(): Promise<void> {
  return nullclawIntegration.shutdown();
}
