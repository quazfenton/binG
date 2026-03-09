/**
 * Blaxel MCP Integration Service
 * 
 * Provides deployment and management of MCP servers on Blaxel infrastructure.
 * Supports:
 * - Deploying custom MCP servers from code
 * - Converting OpenAPI specs to MCP servers (Code Mode)
 * - Deploying pre-built MCP servers from Blaxel Hub
 * - Invoking MCP tools on deployed servers
 * 
 * API Reference: https://docs.blaxel.ai
 */

import { z } from 'zod';

const BLAXEL_API_BASE = process.env.BLAXEL_API_BASE || 'https://api.blaxel.ai';

export interface BlaxelMcpServer {
  id: string;
  name: string;
  status: 'deploying' | 'deployed' | 'error' | 'deleted';
  endpoint?: string;
  transport: 'websocket' | 'http-stream';
  tools: BlaxelMcpTool[];
  createdAt: string;
  updatedAt: string;
  runtime?: string;
  region?: string;
}

export interface BlaxelMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface BlaxelHubServer {
  id: string;
  name: string;
  description: string;
  category: string;
  iconUrl?: string;
  toolCount: number;
  author: string;
}

export interface BlaxelDeploymentConfig {
  name: string;
  code?: string;
  source?: 'stdio' | 'openapi' | 'hub';
  hubServerId?: string;
  openApiSpec?: object;
  env?: Record<string, string>;
  secrets?: string[];
  timeout?: number;
  runtime?: 'node' | 'python';
  region?: string;
}

export interface BlaxelInvocationRequest {
  tool: string;
  args: Record<string, any>;
}

export interface BlaxelInvocationResponse {
  result: any;
  error?: string;
}

const BlaxelMcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['deploying', 'deployed', 'error', 'deleted']),
  endpoint: z.string().optional(),
  transport: z.enum(['websocket', 'http-stream']),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.any()),
  })),
  createdAt: z.string(),
  updatedAt: z.string(),
  runtime: z.string().optional(),
  region: z.string().optional(),
});

export class BlaxelMcpService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BLAXEL_API_KEY || '';
    this.baseUrl = process.env.BLAXEL_API_BASE || BLAXEL_API_BASE;
  }

  /**
   * Check if Blaxel is configured and available
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Blaxel API key not configured');
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Blaxel API error (${response.status}): ${errorText}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    return JSON.parse(text);
  }

  /**
   * List all MCP servers in workspace
   * @see https://docs.blaxel.ai/api-reference/functions/list-all-mcp-servers
   */
  async listServers(): Promise<BlaxelMcpServer[]> {
    const servers = await this.request<BlaxelMcpServer[]>('/functions/mcp');
    return servers.map(s => BlaxelMcpServerSchema.parse(s));
  }

  /**
   * Get a specific MCP server
   * @see https://docs.blaxel.ai/api-reference/functions/get-mcp-server
   */
  async getServer(serverId: string): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>(`/functions/mcp/${serverId}`);
    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Create a new MCP server from code
   * @see https://docs.blaxel.ai/api-reference/functions/create-mcp-server
   */
  async createServer(config: BlaxelDeploymentConfig): Promise<BlaxelMcpServer> {
    const payload: Record<string, any> = {
      name: config.name,
      type: 'mcp',
    };

    if (config.code) {
      payload.code = config.code;
    }

    if (config.runtime) {
      payload.runtime = config.runtime;
    }

    if (config.env) {
      payload.env = config.env;
    }

    if (config.secrets) {
      payload.secrets = config.secrets;
    }

    if (config.timeout) {
      payload.timeout = config.timeout;
    }

    if (config.region) {
      payload.region = config.region;
    }

    const server = await this.request<BlaxelMcpServer>('/functions/mcp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Create MCP server from OpenAPI spec (Code Mode)
   * @see https://docs.blaxel.ai/Functions/Code-mode
   */
  async createFromOpenApi(
    name: string, 
    openApiSpec: object,
    options?: {
      runtime?: 'node' | 'python';
      env?: Record<string, string>;
      secrets?: string[];
    }
  ): Promise<BlaxelMcpServer> {
    return this.createServer({
      name,
      code: JSON.stringify(openApiSpec),
      source: 'openapi',
      ...options,
    });
  }

  /**
   * Deploy MCP server from Blaxel Hub (pre-built)
   * @see https://docs.blaxel.ai/Functions/Overview
   */
  async deployFromHub(hubServerId: string, name: string): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>('/functions/mcp', {
      method: 'POST',
      body: JSON.stringify({
        name,
        source: 'hub',
        hubServerId,
      }),
    });

    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * List available MCP servers in Blaxel Hub
   * @see https://docs.blaxel.ai/api-reference/mcphub/list-mcp-hub-servers
   */
  async listHubServers(category?: string): Promise<BlaxelHubServer[]> {
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    return this.request<BlaxelHubServer[]>(`/mcphub/servers${params}`);
  }

  /**
   * Search Blaxel Hub for MCP servers
   */
  async searchHubServers(query: string): Promise<BlaxelHubServer[]> {
    return this.request<BlaxelHubServer[]>(`/mcphub/servers?q=${encodeURIComponent(query)}`);
  }

  /**
   * Update MCP server configuration
   * @see https://docs.blaxel.ai/api-reference/functions/update-mcp-server
   */
  async updateServer(
    serverId: string, 
    config: Partial<BlaxelDeploymentConfig>
  ): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>(`/functions/mcp/${serverId}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });

    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Delete an MCP server
   * @see https://docs.blaxel.ai/api-reference/functions/delete-mcp-server
   */
  async deleteServer(serverId: string): Promise<void> {
    await this.request(`/functions/mcp/${serverId}`, { method: 'DELETE' });
  }

  /**
   * Invoke an MCP tool on a deployed server
   * @see https://docs.blaxel.ai/Functions/Invoke-functions
   */
  async invokeTool(
    serverId: string, 
    toolName: string, 
    args: Record<string, any> = {}
  ): Promise<any> {
    const response = await this.request<BlaxelInvocationResponse>(
      `/functions/mcp/${serverId}/invoke`,
      {
        method: 'POST',
        body: JSON.stringify({
          tool: toolName,
          args,
        }),
      }
    );

    if (response.error) {
      throw new Error(`Blaxel MCP invocation error: ${response.error}`);
    }

    return response.result;
  }

  /**
   * Get server logs with pagination
   */
  async getServerLogs(
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<string> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));

    const queryString = params.toString();
    return this.request<string>(`/functions/mcp/${serverId}/logs${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Resume a paused server deployment
   */
  async resumeServer(serverId: string): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>(
      `/functions/mcp/${serverId}/resume`,
      { method: 'POST' }
    );
    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Pause a running MCP server
   */
  async pauseServer(serverId: string): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>(
      `/functions/mcp/${serverId}/pause`,
      { method: 'POST' }
    );
    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Restart an MCP server
   */
  async restartServer(serverId: string): Promise<BlaxelMcpServer> {
    const server = await this.request<BlaxelMcpServer>(
      `/functions/mcp/${serverId}/restart`,
      { method: 'POST' }
    );
    return BlaxelMcpServerSchema.parse(server);
  }

  /**
   * Create async trigger for agent
   * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
   */
  async createAsyncTrigger(
    agentId: string,
    callbackUrl?: string
  ): Promise<{ id: string; type: string; callbackUrl?: string }> {
    const response = await this.request(
      `/agents/${agentId}/triggers`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'http-async',
          callbackUrl,
        }),
      }
    );
    return response;
  }

  /**
   * List triggers for an agent
   */
  async listTriggers(agentId: string): Promise<any[]> {
    return this.request(`/agents/${agentId}/triggers`);
  }

  /**
   * Delete a trigger
   */
  async deleteTrigger(agentId: string, triggerId: string): Promise<void> {
    await this.request(`/agents/${agentId}/triggers/${triggerId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Invoke agent asynchronously
   * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
   */
  async invokeAgentAsync(
    agentId: string,
    input: any,
    callbackUrl?: string
  ): Promise<{ success: boolean }> {
    const url = callbackUrl
      ? `${this.baseUrl}/agents/${agentId}?async=true&callback=${encodeURIComponent(callbackUrl)}`
      : `${this.baseUrl}/agents/${agentId}?async=true`;

    return this.request<{ success: boolean }>(url, {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
  }

  /**
   * Get agent by name
   * @see https://docs.blaxel.ai/api-reference/agents/get-agent-by-name
   */
  async getAgent(agentName: string): Promise<any> {
    return this.request(`/agents/${agentName}`);
  }

  /**
   * Update agent configuration
   * @see https://docs.blaxel.ai/api-reference/agents/update-agent-by-name
   */
  async updateAgent(
    agentName: string,
    config: {
      public?: boolean;
      env?: Record<string, string>;
      timeout?: number;
      memory?: number;
    }
  ): Promise<any> {
    return this.request(`/agents/${agentName}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  }

  /**
   * Deactivate agent deployment
   */
  async deactivateAgent(agentName: string): Promise<void> {
    await this.updateAgent(agentName, { public: false });
  }

  /**
   * Activate agent deployment
   */
  async activateAgent(agentName: string): Promise<void> {
    await this.updateAgent(agentName, { public: true });
  }
}

/**
 * Verify callback signature from Blaxel webhook
 * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
 */
export function verifyCallbackSignature(
  request: Request,
  secret: string
): { valid: boolean; error?: string } {
  try {
    const signature = request.headers.get('x-blaxel-signature');
    const timestamp = request.headers.get('x-blaxel-timestamp');

    if (!signature || !timestamp) {
      return { valid: false, error: 'Missing signature or timestamp headers' };
    }

    // Verify timestamp is recent (within 5 minutes)
    const now = Date.now() / 1000;
    const timestampNum = parseInt(timestamp, 10);
    
    if (isNaN(timestampNum)) {
      return { valid: false, error: 'Invalid timestamp format' };
    }
    
    if (Math.abs(now - timestampNum) > 300) {
      return { valid: false, error: 'Timestamp is too old or from the future' };
    }

    // Verify signature format: sha256=<hex>
    const [algorithm, expectedSignature] = signature.split('=');
    if (algorithm !== 'sha256' || !expectedSignature) {
      return { valid: false, error: 'Invalid signature format' };
    }

    // Compute expected signature
    // Note: In Node.js environment, we need to get the body differently
    // This function should be called with the raw body string
    const body = (request as any).bodyRaw || '';
    if (!body) {
      return { valid: false, error: 'Request body is empty or not accessible' };
    }

    const crypto = require('crypto');
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const expectedBytes = Buffer.from(expectedSignature, 'hex');
    const computedBytes = Buffer.from(computedSignature, 'hex');

    if (expectedBytes.length !== computedBytes.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    let result = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      result |= expectedBytes[i] ^ computedBytes[i];
    }

    if (result !== 0) {
      return { valid: false, error: 'Signature mismatch' };
    }

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, error: `Verification failed: ${errorMessage}` };
  }
}

// Singleton instance
let blaxelMcpServiceInstance: BlaxelMcpService | null = null;

export function getBlaxelMcpService(apiKey?: string): BlaxelMcpService {
  if (!blaxelMcpServiceInstance) {
    blaxelMcpServiceInstance = new BlaxelMcpService(apiKey);
  }
  return blaxelMcpServiceInstance;
}

// Helper to create MCP server code from tool definitions
export function createMcpServerCode(tools: Array<{
  name: string;
  description: string;
  inputSchema: object;
  handler: string;
}>): string {
  return `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

const tools = ${JSON.stringify(tools, null, 2)};

class MCP extends Server {
  constructor() {
    super({
      name: 'blaxel-mcp-server',
      version: '1.0.0',
    }, {
      capabilities: {
        tools: {},
      },
    });

    // Register tools
    for (const tool of tools) {
      this.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async ({ args }) => {
          // Execute tool handler
          ${tools.map(t => `if (tool.name === '${t.name}') { ${t.handler} }`).join(' else ')}
        }
      );
    }
  }
}

const server = new MCP();
const transport = new SSEServerTransport('/mcp', server);
server.start(transport);
`;
}
