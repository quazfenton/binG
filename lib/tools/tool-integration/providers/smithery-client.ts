/**
 * Smithery MCP Server Integration
 *
 * Provides access to 100+ pre-built MCP servers via Smithery.
 * Smithery handles server hosting, updates, and maintenance.
 *
 * Features:
 * - Server discovery and installation
 * - Tool execution via MCP
 * - Automatic server updates
 * - Usage tracking
 *
 * @see https://smithery.ai/
 * @see https://docs.smithery.ai/
 */

import { z } from 'zod';

export interface SmitheryConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface SmitheryServer {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  tools: SmitheryTool[];
  installed: boolean;
  version?: string;
}

export interface SmitheryTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface SmitheryExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  serverId?: string;
}

/**
 * Smithery Client Class
 */
export class SmitheryClient {
  private config: SmitheryConfig;
  private servers = new Map<string, SmitheryServer>();
  private initialized = false;

  constructor(config: SmitheryConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Initialize Smithery client
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Fetch available servers
      await this.discoverServers();
      this.initialized = true;
      console.log('[SmitheryClient] Initialized');
    } catch (error: any) {
      console.error('[SmitheryClient] Initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Discover available MCP servers
   */
  async discoverServers(): Promise<SmitheryServer[]> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to discover servers: ${response.statusText}`);
      }

      const data = await response.json();
      const servers = data.servers || [];

      // Cache servers
      servers.forEach((server: any) => {
        this.servers.set(server.id, {
          id: server.id,
          name: server.name,
          description: server.description,
          author: server.author,
          category: server.category,
          tools: server.tools || [],
          installed: server.installed || false,
          version: server.version,
        });
      });

      return servers;
    } catch (error: any) {
      console.error('[SmitheryClient] discoverServers failed:', error.message);
      return [];
    }
  }

  /**
   * Get server by ID
   */
  getServer(serverId: string): SmitheryServer | undefined {
    return this.servers.get(serverId);
  }

  /**
   * List all servers
   */
  listServers(): SmitheryServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * Search servers by query
   */
  searchServers(query: string): SmitheryServer[] {
    const queryLower = query.toLowerCase();
    return this.listServers().filter(
      server =>
        server.name.toLowerCase().includes(queryLower) ||
        server.description.toLowerCase().includes(queryLower) ||
        server.category.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Install a server
   */
  async installServer(serverId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/install`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to install server: ${response.statusText}`);
      }

      const server = this.servers.get(serverId);
      if (server) {
        server.installed = true;
      }

      console.log(`[SmitheryClient] Installed server: ${serverId}`);
      return true;
    } catch (error: any) {
      console.error('[SmitheryClient] installServer failed:', error.message);
      return false;
    }
  }

  /**
   * Uninstall a server
   */
  async uninstallServer(serverId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/uninstall`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to uninstall server: ${response.statusText}`);
      }

      const server = this.servers.get(serverId);
      if (server) {
        server.installed = false;
      }

      console.log(`[SmitheryClient] Uninstalled server: ${serverId}`);
      return true;
    } catch (error: any) {
      console.error('[SmitheryClient] uninstallServer failed:', error.message);
      return false;
    }
  }

  /**
   * Execute tool via MCP server
   */
  async executeTool(
    serverId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<SmitheryExecutionResult> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/tools/${toolName}/execute`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ arguments: args }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
          serverId,
        };
      }

      const result = await response.json();
      return {
        success: true,
        output: result,
        serverId,
      };
    } catch (error: any) {
      console.error('[SmitheryClient] executeTool failed:', error.message);
      return {
        success: false,
        error: error.message,
        serverId,
      };
    }
  }

  /**
   * Get server usage statistics
   */
  async getUsage(serverId?: string): Promise<{
    totalExecutions: number;
    totalTokens: number;
    cost: number;
  }> {
    try {
      const params = serverId ? `?server_id=${serverId}` : '';
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/usage${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get usage: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] getUsage failed:', error.message);
      return {
        totalExecutions: 0,
        totalTokens: 0,
        cost: 0,
      };
    }
  }

  /**
   * Create a connection to a server
   * 
   * ADDED: Connection management support
   * 
   * @param serverId - Server ID or namespace/name
   * @param config - Connection configuration
   * @returns Connection ID
   * 
   * @example
   * ```typescript
   * const connectionId = await smitheryClient.createConnection('github', {
   *   apiKey: process.env.GITHUB_API_KEY,
   * });
   * ```
   */
  async createConnection(
    serverId: string,
    config: Record<string, any> = {}
  ): Promise<{
    success: boolean;
    connectionId?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/connections`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            server_id: serverId,
            config,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        connectionId: data.id,
      };
    } catch (error: any) {
      console.error('[SmitheryClient] createConnection failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get a connection by ID
   * 
   * @param connectionId - Connection ID
   * @returns Connection details or null if not found
   */
  async getConnection(connectionId: string): Promise<{
    id: string;
    serverId: string;
    config: Record<string, any>;
    status: 'active' | 'inactive' | 'error';
    createdAt: string;
    updatedAt: string;
  } | null> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/connections/${connectionId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] getConnection failed:', error.message);
      return null;
    }
  }

  /**
   * List all connections
   * 
   * @param options - List options
   * @returns Array of connections
   */
  async listConnections(options?: {
    serverId?: string;
    status?: 'active' | 'inactive' | 'error';
    limit?: number;
  }): Promise<Array<{
    id: string;
    serverId: string;
    status: string;
    createdAt: string;
  }>> {
    try {
      const params = new URLSearchParams();
      if (options?.serverId) params.set('server_id', options.serverId);
      if (options?.status) params.set('status', options.status);
      if (options?.limit) params.set('limit', String(options.limit));

      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/connections?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.connections || [];
    } catch (error: any) {
      console.error('[SmitheryClient] listConnections failed:', error.message);
      return [];
    }
  }

  /**
   * Delete a connection
   * 
   * @param connectionId - Connection ID to delete
   * @returns True if deleted successfully
   */
  async deleteConnection(connectionId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/connections/${connectionId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      return response.ok;
    } catch (error: any) {
      console.error('[SmitheryClient] deleteConnection failed:', error.message);
      return false;
    }
  }

  /**
   * Get MCP endpoint for a connection
   * 
   * ADDED: MCP endpoint support
   * 
   * @param namespace - Server namespace
   * @param connectionId - Connection ID
   * @returns MCP connection details
   * 
   * @example
   * ```typescript
   * const mcp = await smitheryClient.getMcpEndpoint('github', 'conn_123');
   * // Connect using mcp.url and mcp.headers
   * ```
   */
  async getMcpEndpoint(
    namespace: string,
    connectionId: string
  ): Promise<{
    url: string;
    headers: Record<string, string>;
  } | null> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/connect/${namespace}/${connectionId}/mcp`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] getMcpEndpoint failed:', error.message);
      return null;
    }
  }

  /**
   * Poll events from a server
   * 
   * ADDED: Events polling support
   * 
   * @param serverId - Server ID
   * @param connectionId - Connection ID
   * @param options - Polling options
   * @returns Array of events
   * 
   * @example
   * ```typescript
   * const events = await smitheryClient.pollEvents('github', 'conn_123', {
   *   since: Date.now() - 3600000, // Last hour
   *   limit: 100,
   * });
   * ```
   */
  async pollEvents(
    serverId: string,
    connectionId: string,
    options: {
      since?: number;
      limit?: number;
      types?: string[];
    } = {}
  ): Promise<Array<{
    id: string;
    type: string;
    data: any;
    timestamp: number;
  }>> {
    try {
      const params = new URLSearchParams();
      if (options.since) params.set('since', String(options.since));
      if (options.limit) params.set('limit', String(options.limit));
      if (options.types) params.set('types', options.types.join(','));

      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/connections/${connectionId}/events?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] pollEvents failed:', error.message);
      return [];
    }
  }

  /**
   * Subscribe to events from a server
   * 
   * @param serverId - Server ID
   * @param connectionId - Connection ID
   * @param callback - Event callback function
   * @returns Unsubscribe function
   */
  async subscribeToEvents(
    serverId: string,
    connectionId: string,
    callback: (event: any) => void
  ): Promise<() => void> {
    let subscribed = true;

    const poll = async () => {
      if (!subscribed) return;

      const events = await this.pollEvents(serverId, connectionId, {
        since: Date.now() - 60000, // Last minute
      });

      for (const event of events) {
        callback(event);
      }

      // Poll again after 5 seconds
      setTimeout(poll, 5000);
    };

    // Start polling
    poll();

    // Return unsubscribe function
    return () => {
      subscribed = false;
    };
  }

  /**
   * Publish a server
   * 
   * ADDED: Server publishing support
   * 
   * @param namespace - Server namespace
   * @param config - Server configuration
   * @returns Server ID
   * 
   * @example
   * ```typescript
   * const serverId = await smitheryClient.publishServer('my-server', {
   *   name: 'My Server',
   *   description: 'A custom MCP server',
   *   dockerImage: 'my-image:latest',
   * });
   * ```
   */
  async publishServer(
    namespace: string,
    config: {
      name: string;
      description: string;
      dockerImage?: string;
      repository?: string;
      private?: boolean;
    }
  ): Promise<{
    success: boolean;
    serverId?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${namespace}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        serverId: data.id,
      };
    } catch (error: any) {
      console.error('[SmitheryClient] publishServer failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Release a server version
   * 
   * @param serverId - Server ID
   * @param version - Version string
   * @returns True if released successfully
   */
  async releaseServer(serverId: string, version: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/releases`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ version }),
        }
      );

      return response.ok;
    } catch (error: any) {
      console.error('[SmitheryClient] releaseServer failed:', error.message);
      return false;
    }
  }

  /**
   * Get server logs
   * 
   * @param serverId - Server ID
   * @param options - Log options
   * @returns Array of log entries
   */
  async getServerLogs(
    serverId: string,
    options: {
      limit?: number;
      level?: 'info' | 'warn' | 'error';
      since?: number;
    } = {}
  ): Promise<Array<{
    timestamp: number;
    level: string;
    message: string;
    metadata?: any;
  }>> {
    try {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', String(options.limit));
      if (options.level) params.set('level', options.level);
      if (options.since) params.set('since', String(options.since));

      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/logs?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] getServerLogs failed:', error.message);
      return [];
    }
  }

  /**
   * Create a namespace
   * 
   * ADDED: Namespace management support
   * 
   * @param name - Namespace name
   * @param options - Namespace options
   * @returns Namespace ID
   */
  async createNamespace(
    name: string,
    options: {
      description?: string;
      private?: boolean;
    } = {}
  ): Promise<{
    success: boolean;
    namespaceId?: string;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/namespaces`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, ...options }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        namespaceId: data.id,
      };
    } catch (error: any) {
      console.error('[SmitheryClient] createNamespace failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List namespaces
   * 
   * @returns Array of namespaces
   */
  async listNamespaces(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    serverCount: number;
    createdAt: string;
  }>> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/namespaces`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] listNamespaces failed:', error.message);
      return [];
    }
  }

  /**
   * Delete a namespace
   * 
   * @param namespaceId - Namespace ID to delete
   * @returns True if deleted successfully
   */
  async deleteNamespace(namespaceId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/namespaces/${namespaceId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      return response.ok;
    } catch (error: any) {
      console.error('[SmitheryClient] deleteNamespace failed:', error.message);
      return false;
    }
  }

  /**
   * Set budget limit for a server
   * 
   * ADDED: Cost optimization support
   * 
   * @param serverId - Server ID
   * @param limit - Budget limit in dollars
   * @returns True if set successfully
   */
  async setBudgetLimit(serverId: string, limit: number): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/servers/${serverId}/budget`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ limit }),
        }
      );

      return response.ok;
    } catch (error: any) {
      console.error('[SmitheryClient] setBudgetLimit failed:', error.message);
      return false;
    }
  }

  /**
   * Get budget alerts
   * 
   * @returns Array of budget alerts
   */
  async getBudgetAlerts(): Promise<Array<{
    serverId: string;
    budget: number;
    spent: number;
    percentage: number;
    alerted: boolean;
  }>> {
    try {
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.smithery.ai'}/v1/budget/alerts`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return [];
      }

      return await response.json();
    } catch (error: any) {
      console.error('[SmitheryClient] getBudgetAlerts failed:', error.message);
      return [];
    }
  }
}

/**
 * Create Smithery client instance
 */
export function createSmitheryClient(config: SmitheryConfig): SmitheryClient {
  return new SmitheryClient(config);
}

/**
 * Singleton instance
 */
let smitheryClientInstance: SmitheryClient | null = null;

/**
 * Get or create Smithery client instance
 */
export function getSmitheryClient(): SmitheryClient | null {
  if (!smitheryClientInstance) {
    const apiKey = process.env.SMITHERY_API_KEY;
    if (!apiKey) {
      return null;
    }

    smitheryClientInstance = createSmitheryClient({ apiKey });
  }
  return smitheryClientInstance;
}
