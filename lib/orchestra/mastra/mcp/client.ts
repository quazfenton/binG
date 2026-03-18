/**
 * MCP Client for Mastra Workflows
 *
 * Allows workflows to call tools via MCP protocol.
 * Useful for:
 * - Provider-agnostic tool execution
 * - Centralized tool management
 * - Tool versioning
 *
 * @see https://mastra.ai/docs/mcp/clients
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  /** Path to MCP server script */
  serverPath?: string;
  /** Server arguments */
  serverArgs?: string[];
  /** Environment variables for server */
  env?: Record<string, string>;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/**
 * MCP Client for workflow integration
 *
 * @example
 * ```typescript
 * const mcp = new MastraMCPClient({
 *   serverPath: 'node',
 *   serverArgs: ['lib/mastra/mcp/server.ts'],
 * });
 *
 * await mcp.connect();
 *
 * const result = await mcp.callTool('WRITE_FILE', {
 *   path: 'src/index.ts',
 *   content: 'export const hello = "world";',
 *   ownerId: 'user-123',
 * });
 *
 * await mcp.disconnect();
 * ```
 */
export class MastraMCPClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private config: MCPClientConfig;
  private connected: boolean = false;

  constructor(config: MCPClientConfig = {}) {
    this.config = {
      serverPath: 'node',
      serverArgs: ['lib/mastra/mcp/server.ts'],
      timeout: 30000,
      ...config,
    };

    this.client = new Client(
      {
        name: 'mastra-workflow-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );
  }

  /**
   * Connect to MCP server
   */
  async connect() {
    if (this.connected) {
      console.log('[MCP Client] Already connected');
      return;
    }

    try {
      console.log('[MCP Client] Connecting to server...');

      this.transport = new StdioClientTransport({
        command: this.config.serverPath!,
        args: this.config.serverArgs || [],
        env: this.config.env,
      });

      await this.client.connect(this.transport);
      this.connected = true;

      console.log('[MCP Client] Connected successfully');

      // List available tools
      const tools = await this.listTools();
      console.log(`[MCP Client] Available tools: ${tools.map(t => t.name).join(', ')}`);
    } catch (error) {
      console.error('[MCP Client] Connection failed:', error);
      throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    if (!this.connected) {
      return;
    }

    try {
      console.log('[MCP Client] Disconnecting...');
      await this.client.close();
      this.connected = false;
      console.log('[MCP Client] Disconnected');
    } catch (error) {
      console.error('[MCP Client] Disconnect failed:', error);
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPTool[]> {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    try {
      const result = await this.client.request(
        { method: 'tools/list' },
        ListToolsRequestSchema
      );

      // @ts-ignore - MCP protocol response structure
      return result.tools || [];
    } catch (error) {
      console.error('[MCP Client] Failed to list tools:', error);
      return [];
    }
  }

  /**
   * Call a tool via MCP
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    console.log(`[MCP Client] Calling tool: ${toolName}`, args);

    try {
      const result = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        },
        CallToolRequestSchema
      );

      console.log(`[MCP Client] Tool ${toolName} completed`);

      // Parse result content
      // @ts-ignore - MCP protocol response structure
      if (result.content && Array.isArray(result.content)) {
        // @ts-ignore - MCP protocol response structure
        const textContent = result.content.find(c => c.type === 'text');
        if (textContent) {
          try {
            return JSON.parse(textContent.text);
          } catch {
            return textContent.text;
          }
        }
      }

      return result;
    } catch (error) {
      console.error(`[MCP Client] Tool ${toolName} failed:`, error);
      throw new Error(`Tool ${toolName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get client instance for direct access
   */
  getClient(): Client {
    return this.client;
  }
}

/**
 * Create MCP tool wrapper for Mastra workflows
 * Converts MCP tools to Mastra tool format
 */
export async function createMCPToolWrapper(
  mcpClient: MastraMCPClient,
  toolName: string,
  toolSchema: Record<string, any>
) {
  return {
    id: toolName,
    description: toolSchema.description || `MCP tool: ${toolName}`,
    inputSchema: toolSchema.inputSchema,
    execute: async ({ context }: any) => {
      return await mcpClient.callTool(toolName, context);
    },
  };
}

/**
 * Load all MCP tools as Mastra tools
 */
export async function loadMCPTools(mcpClient: MastraMCPClient) {
  await mcpClient.connect();
  
  const mcpTools = await mcpClient.listTools();
  const mastraTools = [];

  for (const tool of mcpTools) {
    const wrappedTool = await createMCPToolWrapper(mcpClient, tool.name, tool);
    mastraTools.push(wrappedTool);
  }

  return mastraTools;
}
