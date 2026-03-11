/**
 * Nullclaw Integration
 * 
 * Integrates Nullclaw task assistant running as a separate Docker container.
 * Provides non-coding agency:
 * - Discord/Telegram messaging
 * - Internet browsing and data extraction
 * - Server automation
 * - API integrations
 * - Scheduled tasks
 * 
 * Based on: docs/sdk/opensandbox/examples/nullclaw/main.py
 * 
 * Architecture:
 * ┌─────────────────┐     HTTP      ┌─────────────────┐
 * │  OpenCode Agent │ ◄──────────►  │  Nullclaw       │
 * │  (Sandbox A)    │   API Calls   │  (Sandbox B)    │
 * └─────────────────┘               └─────────────────┘
 *                                     │
 *                                     ▼
 *                              ┌─────────────────┐
 *                              │  External APIs  │
 *                              │  - Discord      │
 *                              │  - Telegram     │
 *                              │  - Web Browsing │
 *                              └─────────────────┘
 */

import { spawn } from 'child_process';
import { agentSessionManager } from './agent-session-manager';
import { createLogger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('Agent:Nullclaw');

export interface NullclawConfig {
  image: string; // 'ghcr.io/nullclaw/nullclaw:latest'
  port: number; // Default: 3000
  timeout: number; // seconds
  allowedDomains: string[]; // Network egress rules
  healthCheckTimeout?: number; // milliseconds
  dockerNetwork?: string; // Docker network for communication
  mode?: 'shared' | 'per-session';
  maxContainers?: number;
  basePort?: number;
  externalUrl?: string;
}

export interface NullclawContainer {
  id: string;
  containerId?: string;
  endpoint: string;
  port: number;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  healthUrl: string;
}

export interface NullclawTask {
  id: string;
  type: 'message' | 'browse' | 'automate' | 'api' | 'schedule';
  description: string;
  params: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt?: Date;
  completedAt?: Date;
}

export interface NullclawStatus {
  available: boolean;
  container?: NullclawContainer;
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
    image: process.env.NULLCLAW_IMAGE || 'ghcr.io/nullclaw/nullclaw:latest',
    port: parseInt(process.env.NULLCLAW_PORT || '3000'),
    timeout: parseInt(process.env.NULLCLAW_TIMEOUT || '3600'),
    allowedDomains: (process.env.NULLCLAW_ALLOWED_DOMAINS || 'openrouter.ai,api.discord.com,api.telegram.org').split(','),
    healthCheckTimeout: parseInt(process.env.NULLCLAW_HEALTH_TIMEOUT || '30000'),
    dockerNetwork: process.env.NULLCLAW_NETWORK || 'bing-network',
    mode: (process.env.NULLCLAW_MODE as 'shared' | 'per-session') || 'shared',
    maxContainers: parseInt(process.env.NULLCLAW_MAX_CONTAINERS || '4'),
    basePort: parseInt(process.env.NULLCLAW_BASE_PORT || '3001'),
    externalUrl: process.env.NULLCLAW_URL,
  };

  private containers = new Map<string, NullclawContainer>();
  private sessionContainers = new Map<string, string>();
  private tasks = new Map<string, NullclawTask>();

  getContainerForSession(userId: string, conversationId: string): NullclawContainer | undefined {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    if (containerId) {
      return this.containers.get(containerId);
    }
    return Array.from(this.containers.values()).find(c => c.status === 'ready');
  }

  /**
   * Start Nullclaw container
   */
  async startContainer(config: Partial<NullclawConfig> = {}): Promise<NullclawContainer> {
    const nullclawConfig = { ...this.defaultConfig, ...config };
    if (nullclawConfig.externalUrl) {
      const container: NullclawContainer = {
        id: 'nullclaw-external',
        endpoint: nullclawConfig.externalUrl,
        port: nullclawConfig.port,
        status: 'ready',
        healthUrl: `${nullclawConfig.externalUrl}/health`,
      };
      this.containers.set(container.id, container);
      return container;
    }

    const containerId = `nullclaw-${uuidv4()}`;

    logger.info(`Starting Nullclaw container: ${containerId}`);

    try {
      // Build docker run command
      const dockerArgs = [
        'run',
        '-d',
        '--name', containerId,
        '--network', nullclawConfig.dockerNetwork,
        '-p', `${nullclawConfig.port}:3000`,
        '--env', `NULLCLAW_TIMEOUT=${nullclawConfig.timeout}`,
        '--env', `ALLOWED_DOMAINS=${nullclawConfig.allowedDomains.join(',')}`,
        '--label', 'managed-by=bing-agent-v2',
        '--restart', 'unless-stopped',
        nullclawConfig.image,
      ];

      logger.debug(`Docker command: docker ${dockerArgs.join(' ')}`);

      // Start container
      await this.runDockerCommand(dockerArgs);

      const container: NullclawContainer = {
        id: containerId,
        containerId,
        endpoint: `http://localhost:${nullclawConfig.port}`,
        port: nullclawConfig.port,
        status: 'starting',
        healthUrl: `http://localhost:${nullclawConfig.port}/health`,
      };

      this.containers.set(containerId, container);

      // Wait for health check
      const ready = await this.waitForHealth(container, nullclawConfig.healthCheckTimeout!);
      
      if (!ready) {
        throw new Error('Nullclaw container health check timeout');
      }

      container.status = 'ready';
      logger.info(`Nullclaw container ready at ${container.endpoint}`);

      return container;

    } catch (error: any) {
      logger.error('Failed to start Nullclaw container', error);
      
      const container: NullclawContainer = {
        id: containerId,
        endpoint: '',
        port: nullclawConfig.port,
        status: 'error',
        healthUrl: '',
      };
      
      this.containers.set(containerId, container);
      throw error;
    }
  }

  /**
   * Stop Nullclaw container
   */
  async stopContainer(containerId: string): Promise<void> {
    const container = this.containers.get(containerId);
    
    if (!container) {
      logger.debug(`Container ${containerId} not found`);
      return;
    }

    if (containerId === 'nullclaw-external') {
      this.containers.delete(containerId);
      logger.info('External Nullclaw endpoint released');
      return;
    }

    logger.info(`Stopping Nullclaw container: ${containerId}`);

    try {
      await this.runDockerCommand(['stop', containerId, '-t', '10']);
      await this.runDockerCommand(['rm', containerId]);
      
      container.status = 'stopped';
      this.containers.delete(containerId);
      for (const [key, id] of this.sessionContainers.entries()) {
        if (id === containerId) this.sessionContainers.delete(key);
      }
      
      logger.info(`Nullclaw container ${containerId} stopped`);
    } catch (error: any) {
      logger.error(`Failed to stop container ${containerId}`, error);
      throw error;
    }
  }

  /**
   * Initialize Nullclaw for a session (starts container if not running)
   */
  async initializeForSession(
    userId: string,
    conversationId: string,
    config: Partial<NullclawConfig> = {},
  ): Promise<string | undefined> {
    if (process.env.NULLCLAW_ENABLED !== 'true') {
      logger.debug('Nullclaw is disabled');
      return undefined;
    }

    try {
      const nullclawConfig = { ...this.defaultConfig, ...config };
      const sessionKey = `${userId}:${conversationId}`;

      // External URL mode
      if (nullclawConfig.externalUrl) {
        const container = await this.startContainer({ externalUrl: nullclawConfig.externalUrl });
        this.sessionContainers.set(sessionKey, container.id);
        const session = await agentSessionManager.getOrCreateSession(userId, conversationId, {
          mode: 'hybrid',
          enableNullclaw: true,
        });
        session.nullclawEndpoint = container.endpoint;
        return container.endpoint;
      }

      // Per-session container mode
      if (nullclawConfig.mode === 'per-session') {
        const existingId = this.sessionContainers.get(sessionKey);
        const existing = existingId ? this.containers.get(existingId) : undefined;
        if (existing && existing.status === 'ready') {
          return existing.endpoint;
        }

        if (this.containers.size >= (nullclawConfig.maxContainers || 1)) {
          throw new Error('Nullclaw per-session container limit reached');
        }

        const port = (nullclawConfig.basePort || 3001) + this.containers.size;
        const container = await this.startContainer({ ...config, port });
        this.sessionContainers.set(sessionKey, container.id);

        const session = await agentSessionManager.getOrCreateSession(userId, conversationId, {
          mode: 'hybrid',
          enableNullclaw: true,
        });
        session.nullclawEndpoint = container.endpoint;
        logger.info(`Nullclaw per-session container ready at ${container.endpoint}`);
        return container.endpoint;
      }

      // Shared pool mode (default)
      let container = Array.from(this.containers.values()).find(c => c.status === 'ready');
      
      // Start new container if needed
      if (!container) {
        if (this.containers.size >= (nullclawConfig.maxContainers || 1)) {
          throw new Error('Nullclaw container pool exhausted');
        }
        const port = (nullclawConfig.basePort || 3001) + this.containers.size;
        container = await this.startContainer({ ...config, port });
      }

      // Get session and associate with container
      const session = await agentSessionManager.getOrCreateSession(userId, conversationId, {
        mode: 'hybrid',
        enableNullclaw: true,
      });

      session.nullclawEndpoint = container.endpoint;
      this.sessionContainers.set(sessionKey, container.id);

      logger.info(`Nullclaw initialized for session ${session.id} at ${container.endpoint}`);
      return container.endpoint;

    } catch (error: any) {
      logger.error('Failed to initialize Nullclaw', error);
      return undefined;
    }
  }

  /**
   * Execute task via Nullclaw container
   */
  async executeTask(
    userId: string,
    conversationId: string,
    task: NullclawTask,
  ): Promise<NullclawTask> {
    const sessionKey = `${userId}:${conversationId}`;
    const containerId = this.sessionContainers.get(sessionKey);
    const container =
      (containerId && this.containers.get(containerId)) ||
      Array.from(this.containers.values()).find(c => c.status === 'ready');
    
    if (!container) {
      throw new Error('Nullclaw container not running. Call initializeForSession first.');
    }

    task.createdAt = new Date();
    task.status = 'pending';
    this.tasks.set(task.id, task);

    try {
      logger.debug(`Executing Nullclaw task: ${task.type} - ${task.description}`);

      // Send task to Nullclaw via HTTP API
      const response = await fetch(`${container.endpoint}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });

      if (!response.ok) {
        throw new Error(`Nullclaw API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      task.status = result.status || 'completed';
      task.result = result.result;
      task.error = result.error;
      task.completedAt = new Date();
      this.tasks.set(task.id, task);

      return task;

    } catch (error: any) {
      logger.error('Nullclaw task execution failed', error);
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = new Date();
      this.tasks.set(task.id, task);
      
      return task;
    }
  }

  /**
   * Send Discord message via Nullclaw
   */
  async sendDiscordMessage(
    userId: string,
    conversationId: string,
    channelId: string,
    message: string,
  ): Promise<NullclawTask> {
    const task: NullclawTask = {
      id: `discord-${Date.now()}`,
      type: 'message',
      description: `Send Discord message to channel ${channelId}`,
      params: {
        platform: 'discord',
        channelId,
        message,
      },
      status: 'pending',
    };

    return this.executeTask(userId, conversationId, task);
  }

  /**
   * Send Telegram message via Nullclaw
   */
  async sendTelegramMessage(
    userId: string,
    conversationId: string,
    chatId: string,
    message: string,
  ): Promise<NullclawTask> {
    const task: NullclawTask = {
      id: `telegram-${Date.now()}`,
      type: 'message',
      description: `Send Telegram message to chat ${chatId}`,
      params: {
        platform: 'telegram',
        chatId,
        message,
      },
      status: 'pending',
    };

    return this.executeTask(userId, conversationId, task);
  }

  /**
   * Browse URL and extract content via Nullclaw
   */
  async browseURL(
    userId: string,
    conversationId: string,
    url: string,
  ): Promise<NullclawTask> {
    const task: NullclawTask = {
      id: `browse-${Date.now()}`,
      type: 'browse',
      description: `Browse and extract content from ${url}`,
      params: { url },
      status: 'pending',
    };

    return this.executeTask(userId, conversationId, task);
  }

  /**
   * Execute server automation task via Nullclaw
   */
  async automateServer(
    userId: string,
    conversationId: string,
    commands: string[],
    serverId?: string,
  ): Promise<NullclawTask> {
    const task: NullclawTask = {
      id: `automate-${Date.now()}`,
      type: 'automate',
      description: `Execute ${commands.length} commands on server`,
      params: {
        serverId,
        commands,
      },
      status: 'pending',
    };

    return this.executeTask(userId, conversationId, task);
  }

  /**
   * Get Nullclaw status
   */
  async getStatus(): Promise<NullclawStatus> {
    const container = Array.from(this.containers.values()).find(c => c.status === 'ready');
    
    if (!container) {
      return {
        available: false,
        health: 'unknown',
        tasks: { pending: 0, running: 0, completed: 0, failed: 0 },
      };
    }

    try {
      const response = await fetch(container.healthUrl, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        return {
          available: true,
          container,
          health: 'unhealthy',
          tasks: this.getTaskStats(),
        };
      }

      const data = await response.json();
      
      return {
        available: true,
        container,
        health: 'healthy',
        tasks: data.tasks || this.getTaskStats(),
      };

    } catch (error: any) {
      return {
        available: true,
        container,
        health: 'unhealthy',
        tasks: this.getTaskStats(),
      };
    }
  }

  /**
   * Get task statistics
   */
  private getTaskStats(): { pending: number; running: number; completed: number; failed: number } {
    const tasks = Array.from(this.tasks.values());
    return {
      pending: tasks.filter(t => t.status === 'pending').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };
  }

  /**
   * Run docker command
   */
  private async runDockerCommand(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Docker command failed (code ${code}): ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Wait for container health check
   */
  private async waitForHealth(container: NullclawContainer, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(container.healthUrl, {
          signal: AbortSignal.timeout(2000),
        });
        
        if (response.status === 200) {
          const elapsed = Date.now() - startTime;
          logger.debug(`Nullclaw container ready after ${elapsed}ms`);
          return true;
        }
      } catch {
        // Not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }

  /**
   * Shutdown all Nullclaw containers
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Nullclaw containers...');
    
    const containerIds = Array.from(this.containers.keys());
    
    for (const containerId of containerIds) {
      try {
        await this.stopContainer(containerId);
      } catch (error: any) {
        logger.error(`Failed to stop container ${containerId}`, error);
      }
    }
    this.sessionContainers.clear();
    logger.info('Nullclaw shutdown complete');
  }
}

// Singleton instance
export const nullclawIntegration = new NullclawIntegration();

// Export for testing
export { NullclawIntegration };
