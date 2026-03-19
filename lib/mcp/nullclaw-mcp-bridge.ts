/**
 * Nullclaw MCP Bridge (Hybrid: URL + Container Fallback)
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
 * Configuration:
 * - Primary: NULLCLAW_URL (external service)
 * - Fallback: Container pool (NULLCLAW_POOL_SIZE, NULLCLAW_MODE)
 *
 * Architecture:
 * ┌─────────────────┐     MCP Tools    ┌─────────────────┐
 * │  AI SDK /      │ ◄───────────────► │  NullclawMCP   │
 * │  OpenCode CLI  │                  │     Bridge      │
 * └─────────────────┘                  └────────┬────────┘
 *                                                │
 *                     ┌──────────────────────────┘
 *                     │
 *                     ▼
 *              ┌─────────────────┐
 *              │  Nullclaw       │
 *              │  Integration    │
 *              │  (URL or Pool)  │
 *              └────────┬────────┘
 *                       │
 *                       ▼
 *              ┌─────────────────┐
 *              │  External APIs  │
 *              │  Discord/Telegram│
 *              │  Web Browsing   │
 *              └─────────────────┘
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { 
  nullclawIntegration, 
  type NullclawTask,
  type NullclawConfig,
  executeNullclawTask,
  isNullclawAvailable,
  initializeNullclaw,
} from '../agent/nullclaw-integration';

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

// Nullclaw container type - may need to be imported or defined
type NullclawContainer = any;

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
   * Ensure Nullclaw is initialized for session
   */
  private async ensureInitializedForSession(sessionId: string): Promise<void> {
    // Check if already initialized
    if (nullclawIntegration.isAvailable()) {
      return;
    }

    // Initialize (will use URL or spawn containers based on config)
    await nullclawIntegration.initialize();
  }

  /**
   * Send Discord message
   */
  private async sendDiscord(
    channelId: string,
    message: string,
    sessionId: string
  ): Promise<NullclawMCPToolResult> {
    await this.ensureInitializedForSession(sessionId);

    const result = await nullclawIntegration.sendDiscordMessage(
      channelId,
      message,
      sessionId,
      sessionId
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
    await this.ensureInitializedForSession(sessionId);

    const result = await nullclawIntegration.sendTelegramMessage(
      chatId,
      message,
      sessionId,
      sessionId
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
    if (sessionId) {
      await this.ensureInitializedForSession(sessionId);
    }

    const result = await nullclawIntegration.browseUrl(
      url,
      extractSelector,
      sessionId,
      sessionId
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
    await this.ensureInitializedForSession(sessionId);

    const result = await nullclawIntegration.automateTask(
      commands,
      serverId,
      sessionId,
      sessionId
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
