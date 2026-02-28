/**
 * Smithery Provider - MCP Server Integration
 *
 * Integrates Smithery MCP servers for tool execution.
 * Smithery provides 100+ pre-built MCP servers for various services.
 *
 * Features:
 * - MCP protocol compliance
 * - Multi-server support
 * - Tool discovery and execution
 * - Authentication handling
 *
 * @see https://smithery.ai/
 * @see https://modelcontextprotocol.io/
 */

import { z } from 'zod';
import type { ToolProvider, ProviderExecutionRequest, ToolExecutionResult } from '../tool-integration/types';

export interface SmitheryServerConfig {
  id: string;
  name: string;
  url: string;
  authToken?: string;
  timeout?: number;
  enabled?: boolean;
}

export interface SmitheryTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverId: string;
}

export interface SmitheryConfig {
  apiKey?: string;
  servers?: SmitheryServerConfig[];
  timeout?: number;
}

/**
 * Smithery Provider Implementation
 */
export class SmitheryProvider implements ToolProvider {
  readonly name = 'smithery';
  private config: SmitheryConfig;
  private servers = new Map<string, SmitheryServerConfig>();
  private tools = new Map<string, SmitheryTool>();
  private client: any = null;
  private initialized = false;

  constructor(config: SmitheryConfig = {}) {
    this.config = {
      timeout: 30000,
      ...config,
    };

    // Register configured servers
    if (config.servers) {
      for (const server of config.servers) {
        this.registerServer(server);
      }
    }
  }

  /**
   * Initialize Smithery client
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Dynamic import for Smithery SDK or MCP client
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

      this.client = { Client, StdioClientTransport };
      this.initialized = true;
      console.log('[SmitheryProvider] Initialized MCP client');
    } catch (error: any) {
      console.warn('[SmitheryProvider] MCP SDK not available, using HTTP fallback');
      // Fallback to HTTP-based MCP client
      this.initialized = true;
    }
  }

  /**
   * Register a Smithery server
   */
  registerServer(config: SmitheryServerConfig): void {
    this.servers.set(config.id, config);
    console.log(`[SmitheryProvider] Registered server: ${config.name} (${config.id})`);
  }

  /**
   * Unregister a server
   */
  unregisterServer(serverId: string): void {
    this.servers.delete(serverId);
    // Remove tools from this server
    for (const [key, tool] of this.tools.entries()) {
      if (tool.serverId === serverId) {
        this.tools.delete(key);
      }
    }
  }

  /**
   * Discover tools from a server
   */
  async discoverTools(serverId: string): Promise<SmitheryTool[]> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    try {
      await this.initialize();

      // Try MCP tool discovery
      if (this.client?.Client) {
        const mcpClient = new this.client.Client({
          name: 'smithery-consumer',
          version: '1.0.0',
        });

        const transport = new this.client.StdioClientTransport({
          command: 'npx',
          args: ['-y', `@smithery/cli@latest`, 'run', serverId],
          env: {
            SMITHERY_API_KEY: this.config.apiKey || process.env.SMITHERY_API_KEY || '',
          },
        });

        await mcpClient.connect(transport);

        const toolsResult = await mcpClient.request(
          { method: 'tools/list' },
          { schema: z.any() }
        );

        const discoveredTools: SmitheryTool[] = (toolsResult.tools || []).map((tool: any) => ({
          name: tool.name,
          description: tool.description || `Tool ${tool.name}`,
          inputSchema: tool.inputSchema || {},
          serverId,
        }));

        // Cache discovered tools
        for (const tool of discoveredTools) {
          this.tools.set(`${serverId}:${tool.name}`, tool);
        }

        return discoveredTools;
      }

      // HTTP fallback
      const response = await fetch(`${server.url}/tools`, {
        headers: server.authToken ? { Authorization: `Bearer ${server.authToken}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Failed to discover tools: ${response.statusText}`);
      }

      const toolsData = await response.json();
      const discoveredTools: SmitheryTool[] = toolsData.map((tool: any) => ({
        name: tool.name,
        description: tool.description || `Tool ${tool.name}`,
        inputSchema: tool.inputSchema || {},
        serverId,
      }));

      // Cache discovered tools
      for (const tool of discoveredTools) {
        this.tools.set(`${serverId}:${tool.name}`, tool);
      }

      return discoveredTools;
    } catch (error: any) {
      console.error(`[SmitheryProvider] Failed to discover tools from ${serverId}:`, error.message);
      return [];
    }
  }

  /**
   * Discover tools from all registered servers
   */
  async discoverAllTools(): Promise<SmitheryTool[]> {
    const allTools: SmitheryTool[] = [];

    for (const [id, server] of this.servers.entries()) {
      if (server.enabled !== false) {
        const tools = await this.discoverTools(id);
        allTools.push(...tools);
      }
    }

    return allTools;
  }

  /**
   * Check if provider is available
   */
  isAvailable(): boolean {
    const hasApiKey = !!(this.config.apiKey || process.env.SMITHERY_API_KEY);
    const hasServers = this.servers.size > 0;
    return hasApiKey && hasServers;
  }

  /**
   * Check if provider supports request
   */
  supports(request: ProviderExecutionRequest): boolean {
    // Check if tool is from Smithery
    if (request.toolKey.startsWith('smithery:')) {
      return true;
    }

    // Check if any registered server has this tool
    for (const tool of this.tools.values()) {
      if (tool.name === request.toolKey) {
        return true;
      }
    }

    return false;
  }

  /**
   * Execute a tool via Smithery
   */
  async execute(request: ProviderExecutionRequest): Promise<ToolExecutionResult> {
    try {
      await this.initialize();

      // Extract tool name and server from toolKey
      let toolName = request.toolKey;
      let serverId = '';

      if (toolKey.startsWith('smithery:')) {
        const parts = toolKey.split(':');
        serverId = parts[1];
        toolName = parts.slice(2).join(':');
      } else {
        // Find server that has this tool
        for (const [key, tool] of this.tools.entries()) {
          if (tool.name === toolName) {
            serverId = tool.serverId;
            break;
          }
        }
      }

      const server = this.servers.get(serverId);
      if (!server) {
        return {
          success: false,
          error: `Server ${serverId} not found`,
        };
      }

      // Execute via MCP
      if (this.client?.Client) {
        const mcpClient = new this.client.Client({
          name: 'smithery-consumer',
          version: '1.0.0',
        });

        const transport = new this.client.StdioClientTransport({
          command: 'npx',
          args: ['-y', `@smithery/cli@latest`, 'run', serverId],
          env: {
            SMITHERY_API_KEY: this.config.apiKey || process.env.SMITHERY_API_KEY || '',
          },
        });

        await mcpClient.connect(transport);

        const result = await mcpClient.request(
          {
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: request.input,
            },
          },
          { schema: z.any() }
        );

        return {
          success: !result.isError,
          output: result.content?.[0]?.text || result,
        };
      }

      // HTTP fallback
      const response = await fetch(`${server.url}/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(server.authToken ? { Authorization: `Bearer ${server.authToken}` } : {}),
        },
        body: JSON.stringify({
          arguments: request.input,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        output: result,
      };
    } catch (error: any) {
      console.error('[SmitheryProvider] execute failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get registered servers
   */
  getServers(): SmitheryServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get cached tools
   */
  getTools(): SmitheryTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): SmitheryTool | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === toolName) {
        return tool;
      }
    }
    return undefined;
  }
}

/**
 * Create Smithery provider instance
 */
export function createSmitheryProvider(config?: SmitheryConfig): SmitheryProvider {
  return new SmitheryProvider(config);
}

/**
 * Default Smithery servers
 */
export const DEFAULT_SMITHERY_SERVERS: SmitheryServerConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://mcp.github.com',
    enabled: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.so',
    enabled: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    url: 'https://mcp.slack.com',
    enabled: true,
  },
];
