/**
 * Nullclaw MCP Bridge
 * 
 * Exposes Nullclaw capabilities as MCP tools for both:
 * - Architecture 1 (AI SDK): Direct tool calls
 * - Architecture 2 (OpenCode CLI): Via MCP HTTP server
 * 
 * Features:
 * - Discord/Telegram messaging
 * - Internet browsing
 * - Server automation
 * - API integrations
 * - Task scheduling
 * 
 * Architecture:
 * ┌─────────────────┐     MCP Tools    ┌─────────────────┐
 * │  AI SDK /      │ ◄───────────────► │  NullclawMCP   │
 * │  OpenCode CLI  │                  │     Bridge      │
 * └─────────────────┘                  └────────┬────────┘
 *                                                │
 *                                                ▼
 *                                        ┌─────────────────┐
 *                                        │   Nullclaw      │
 *                                        │  Docker Container│
 *                                        └────────┬────────┘
 *                                                │
 *                                                ▼
 *                                        ┌─────────────────┐
 *                                        │  External APIs  │
 *                                        │  Discord/Telegram│
 *                                        │  Web Browsing   │
 *                                        └─────────────────┘
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { nullclawIntegration, type NullclawTask, type NullclawContainer } from '../agent/nullclaw-integration';

const logger = createLogger('MCP:NullclawBridge');

export interface NullclawMCPToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface NullclawMCPToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface NullclawBridgeConfig {
  containerPoolSize: number;
  defaultTimeout: number;
  allowedDomains: string[];
  enableAuth?: boolean;
}

const DEFAULT_CONFIG: NullclawBridgeConfig = {
  containerPoolSize: 2,
  defaultTimeout: 300000, // 5 minutes
  allowedDomains: ['api.discord.com', 'api.telegram.org', '*.github.com', 'api.openai.com'],
  enableAuth: false,
};

class NullclawMCPBridge {
  private config: NullclawBridgeConfig;
  private containerPool: Map<string, NullclawContainer> = new Map();
  private taskQueue: Map<string, NullclawTask> = new Map();
  private sessionToContainer: Map<string, string> = new Map();

  constructor(config: Partial<NullclawBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get all Nullclaw tool definitions for MCP
   */
  getToolDefinitions(): NullclawMCPToolDefinition[] {
    return [
      // Messaging tools
      {
        type: 'function',
        function: {
          name: 'nullclaw_sendDiscord',
          description: 'Send a message to a Discord channel via Nullclaw',
          parameters: {
            type: 'object',
            properties: {
              channelId: { type: 'string', description: 'Discord channel ID' },
              message: { type: 'string', description: 'Message content to send' },
            },
            required: ['channelId', 'message'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'nullclaw_sendTelegram',
          description: 'Send a message to a Telegram chat via Nullclaw',
          parameters: {
            type: 'object',
            properties: {
              chatId: { type: 'string', description: 'Telegram chat ID' },
              message: { type: 'string', description: 'Message content to send' },
            },
            required: ['chatId', 'message'],
          },
        },
      },
      // Browsing tools
      {
        type: 'function',
        function: {
          name: 'nullclaw_browse',
          description: 'Browse a URL and extract content via Nullclaw',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to browse' },
              extractSelector: { type: 'string', description: 'CSS selector to extract specific content' },
            },
            required: ['url'],
          },
        },
      },
      // Automation tools
      {
        type: 'function',
        function: {
          name: 'nullclaw_automate',
          description: 'Execute server automation commands via Nullclaw',
          parameters: {
            type: 'object',
            properties: {
              serverId: { type: 'string', description: 'Server identifier' },
              commands: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'Commands to execute' 
              },
            },
            required: ['commands'],
          },
        },
      },
      // Status tool
      {
        type: 'function',
        function: {
          name: 'nullclaw_status',
          description: 'Get Nullclaw service status',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];
  }

  /**
   * Execute a Nullclaw tool by name
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    sessionId: string
  ): Promise<NullclawMCPToolResult> {
    logger.debug(`Executing Nullclaw tool: ${toolName}`, { args, sessionId });

    // Ensure container is available for this session
    const container = await this.getContainerForSession(sessionId);
    if (!container) {
      return {
        success: false,
        output: '',
        error: 'Nullclaw container not available. Please initialize Nullclaw first.',
      };
    }

    try {
      switch (toolName) {
        case 'nullclaw_sendDiscord':
          return await this.sendDiscord(args.channelId, args.message, sessionId);
        
        case 'nullclaw_sendTelegram':
          return await this.sendTelegram(args.chatId, args.message, sessionId);
        
        case 'nullclaw_browse':
          return await this.browse(args.url, args.extractSelector, sessionId);
        
        case 'nullclaw_automate':
          return await this.automate(args.serverId, args.commands, sessionId);
        
        case 'nullclaw_status':
          return await this.getStatus();
        
        default:
          return {
            success: false,
            output: '',
            error: `Unknown Nullclaw tool: ${toolName}`,
          };
      }
    } catch (error: any) {
      logger.error(`Nullclaw tool execution failed: ${toolName}`, error);
      return {
        success: false,
        output: '',
        error: error.message || 'Tool execution failed',
      };
    }
  }

  /**
   * Ensure container is available for session
   */
  private async getContainerForSession(sessionId: string): Promise<NullclawContainer | null> {
    const mode = process.env.NULLCLAW_MODE || 'shared';
    if (mode === 'per-session' || process.env.NULLCLAW_URL) {
      await nullclawIntegration.initializeForSession(sessionId, sessionId);
      const container = nullclawIntegration.getContainerForSession(sessionId, sessionId);
      if (container && container.status === 'ready') {
        return container;
      }
      return null;
    }

    // Check if session already has a container
    const existingContainerId = this.sessionToContainer.get(sessionId);
    if (existingContainerId && this.containerPool.has(existingContainerId)) {
      const container = this.containerPool.get(existingContainerId)!;
      if (container.status === 'ready') {
        return container;
      }
    }

    // Try to reuse from pool
    for (const [, container] of this.containerPool) {
      if (container.status === 'ready') {
        this.sessionToContainer.set(sessionId, container.id);
        return container;
      }
    }

    // Start new container if pool not full
    if (this.containerPool.size < this.config.containerPoolSize) {
      try {
        const container = await nullclawIntegration.startContainer({
          port: parseInt(process.env.NULLCLAW_BASE_PORT || '3001', 10) + this.containerPool.size,
          allowedDomains: this.config.allowedDomains,
          timeout: this.config.defaultTimeout / 1000,
        });
        
        this.containerPool.set(container.id, container);
        this.sessionToContainer.set(sessionId, container.id);
        
        return container;
      } catch (error: any) {
        logger.error('Failed to start Nullclaw container', error);
        return null;
      }
    }

    // Pool is full, wait for available container
    logger.warn('Nullclaw container pool exhausted');
    return null;
  }

  /**
   * Send Discord message
   */
  private async sendDiscord(
    channelId: string,
    message: string,
    sessionId: string
  ): Promise<NullclawMCPToolResult> {
    const task: NullclawTask = {
      id: `discord-${uuidv4()}`,
      type: 'message',
      description: `Send Discord message to channel ${channelId}`,
      params: {
        platform: 'discord',
        channelId,
        message,
      },
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await nullclawIntegration.executeTask(
      sessionId,
      sessionId,
      task
    );

    return {
      success: result.status === 'completed',
      output: JSON.stringify(result.result || {}),
      error: result.error,
      metadata: {
        taskId: result.id,
        status: result.status,
      },
    };
  }

  /**
   * Send Telegram message
   */
  private async sendTelegram(
    chatId: string,
    message: string,
    sessionId: string
  ): Promise<NullclawMCPToolResult> {
    const task: NullclawTask = {
      id: `telegram-${uuidv4()}`,
      type: 'message',
      description: `Send Telegram message to chat ${chatId}`,
      params: {
        platform: 'telegram',
        chatId,
        message,
      },
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await nullclawIntegration.executeTask(
      sessionId,
      sessionId,
      task
    );

    return {
      success: result.status === 'completed',
      output: JSON.stringify(result.result || {}),
      error: result.error,
      metadata: {
        taskId: result.id,
        status: result.status,
      },
    };
  }

  /**
   * Browse URL
   */
  private async browse(
    url: string,
    extractSelector?: string,
    sessionId?: string
  ): Promise<NullclawMCPToolResult> {
    const task: NullclawTask = {
      id: `browse-${uuidv4()}`,
      type: 'browse',
      description: `Browse and extract content from ${url}`,
      params: { 
        url,
        ...(extractSelector && { extractSelector }),
      },
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await nullclawIntegration.executeTask(
      sessionId || 'default',
      sessionId || 'default',
      task
    );

    return {
      success: result.status === 'completed',
      output: JSON.stringify(result.result || {}),
      error: result.error,
      metadata: {
        taskId: result.id,
        url,
      },
    };
  }

  /**
   * Server automation
   */
  private async automate(
    serverId: string | undefined,
    commands: string[],
    sessionId: string
  ): Promise<NullclawMCPToolResult> {
    const task: NullclawTask = {
      id: `automate-${uuidv4()}`,
      type: 'automate',
      description: `Execute ${commands.length} commands on server`,
      params: {
        serverId,
        commands,
      },
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await nullclawIntegration.executeTask(
      sessionId,
      sessionId,
      task
    );

    return {
      success: result.status === 'completed',
      output: JSON.stringify(result.result || {}),
      error: result.error,
      metadata: {
        taskId: result.id,
        commandsCount: commands.length,
      },
    };
  }

  /**
   * Get Nullclaw status
   */
  private async getStatus(): Promise<NullclawMCPToolResult> {
    const status = await nullclawIntegration.getStatus();

    return {
      success: status.available,
      output: JSON.stringify(status),
      metadata: {
        available: status.available,
        health: status.health,
        taskStats: status.tasks,
      },
    };
  }

  /**
   * Release session from container
   */
  releaseSession(sessionId: string): void {
    const containerId = this.sessionToContainer.get(sessionId);
    if (containerId) {
      this.sessionToContainer.delete(sessionId);
      
      // Check if container can be stopped (not in use by other sessions)
      let inUse = false;
      for (const [, cid] of this.sessionToContainer) {
        if (cid === containerId) {
          inUse = true;
          break;
        }
      }
      
      if (!inUse) {
        const container = this.containerPool.get(containerId);
        if (container && container.status === 'ready') {
          // Keep container warm for a bit, then stop
          setTimeout(() => {
            const stillInUse = Array.from(this.sessionToContainer.values()).some(
              mappedId => mappedId === containerId
            );
            if (!stillInUse) {
              nullclawIntegration.stopContainer(containerId).catch(logger.error);
              this.containerPool.delete(containerId);
            }
          }, 60000); // 1 minute cooldown
        }
      }
    }
  }

  /**
   * Shutdown bridge
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Nullclaw MCP Bridge...');
    
    for (const containerId of this.containerPool.keys()) {
      try {
        await nullclawIntegration.stopContainer(containerId);
      } catch (error: any) {
        logger.error(`Failed to stop container ${containerId}`, error);
      }
    }
    
    this.containerPool.clear();
    this.sessionToContainer.clear();
    this.taskQueue.clear();
    
    logger.info('Nullclaw MCP Bridge shutdown complete');
  }

  /**
   * Get bridge statistics
   */
  getStats(): {
    containerPoolSize: number;
    activeContainers: number;
    sessionsMapped: number;
    queuedTasks: number;
  } {
    let activeContainers = 0;
    for (const container of this.containerPool.values()) {
      if (container.status === 'ready') activeContainers++;
    }

    return {
      containerPoolSize: this.config.containerPoolSize,
      activeContainers,
      sessionsMapped: this.sessionToContainer.size,
      queuedTasks: this.taskQueue.size,
    };
  }
}

export const nullclawMCPBridge = new NullclawMCPBridge();
