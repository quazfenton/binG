/**
 * Arcade Service - Tool Execution with Authorization
 *
 * Provides tool execution via Arcade's MCP servers.
 * Arcade provides 1000+ pre-built tools with OAuth management.
 *
 * Features:
 * - Tool execution with user authorization
 * - OAuth connection management
 * - MCP protocol support
 * - Centralized governance
 *
 * @see https://arcade.dev/
 * @see https://docs.arcade.dev/
 */

import { z } from 'zod';

export interface ArcadeConfig {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  timeout?: number;
}

export interface ArcadeTool {
  name: string;
  description: string;
  toolkit: string;
  inputSchema: Record<string, any>;
  requiresAuth: boolean;
}

export interface ArcadeConnection {
  id: string;
  provider: string;
  userId: string;
  status: 'active' | 'inactive' | 'expired';
  createdAt: number;
}

export interface ArcadeExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  requiresAuth?: boolean;
  authUrl?: string;
  connectionId?: string;
}

/**
 * Arcade Service Class
 */
export class ArcadeService {
  private config: ArcadeConfig;
  private client: any = null;
  private initialized = false;
  private connections = new Map<string, ArcadeConnection>();
  private tools = new Map<string, ArcadeTool>();

  constructor(config: ArcadeConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Initialize Arcade client
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Try dynamic import for Arcade SDK
      const { Arcade } = await import('@arcadeai/arcadejs');

      this.client = new Arcade({
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        organizationId: this.config.organizationId,
      });

      this.initialized = true;
      console.log('[ArcadeService] Initialized with SDK');
    } catch (error: any) {
      console.warn('[ArcadeService] Arcade SDK not available, using HTTP API');
      // Fallback to HTTP API
      this.initialized = true;
    }
  }

  /**
   * Get available toolkits
   */
  async getToolkits(): Promise<string[]> {
    await this.initialize();

    try {
      if (this.client?.toolkits) {
        const toolkits = await this.client.toolkits.list();
        return toolkits.map((t: any) => t.name);
      }

      // HTTP fallback
      const response = await fetch(`${this.config.baseUrl || 'https://api.arcade.dev'}/v1/toolkits`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get toolkits: ${response.statusText}`);
      }

      const data = await response.json();
      return data.toolkits?.map((t: any) => t.name) || [];
    } catch (error: any) {
      console.error('[ArcadeService] getToolkits failed:', error.message);
      return [];
    }
  }

  /**
   * Get available tools for a toolkit
   */
  async getTools(toolkit?: string): Promise<ArcadeTool[]> {
    await this.initialize();

    try {
      if (this.client?.tools) {
        const tools = await this.client.tools.list(toolkit ? { toolkit } : {});
        return tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          toolkit: t.toolkit,
          inputSchema: t.input_schema || {},
          requiresAuth: t.requires_auth || false,
        }));
      }

      // HTTP fallback
      const url = new URL(`${this.config.baseUrl || 'https://api.arcade.dev'}/v1/tools`);
      if (toolkit) {
        url.searchParams.set('toolkit', toolkit);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get tools: ${response.statusText}`);
      }

      const data = await response.json();
      return data.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        toolkit: t.toolkit,
        inputSchema: t.input_schema || {},
        requiresAuth: t.requires_auth || false,
      })) || [];
    } catch (error: any) {
      console.error('[ArcadeService] getTools failed:', error.message);
      return [];
    }
  }

  /**
   * Search for tools
   */
  async searchTools(query: string, toolkit?: string): Promise<ArcadeTool[]> {
    const allTools = await this.getTools(toolkit);
    const queryLower = query.toLowerCase();

    return allTools.filter(tool =>
      tool.name.toLowerCase().includes(queryLower) ||
      tool.description.toLowerCase().includes(queryLower) ||
      tool.toolkit.toLowerCase().includes(queryLower)
    );
  }

  /**
   * Get contextual authorization for a tool
   * 
   * ADDED: Contextual auth support per Arcade docs
   * 
   * @param userId - User identifier
   * @param toolName - Tool name
   * @param context - Authorization context (e.g., repo, channel)
   * @returns Authorization info with URL
   * 
   * @example
   * ```typescript
   * const auth = await arcadeService.getContextualAuth(
   *   'user_123',
   *   'github.create_issue',
   *   { repo: 'user/repo' }
   * );
   * ```
   */
  async getContextualAuth(
    userId: string,
    toolName: string,
    context?: Record<string, any>
  ): Promise<{
    authorized: boolean;
    authUrl?: string;
    connectionId?: string;
    context?: Record<string, any>;
  }> {
    await this.initialize();

    try {
      if (this.client?.auth) {
        const result = await this.client.auth.authorize({
          userId,
          tool: toolName,
          context,
        });

        return {
          authorized: result.authorized || false,
          authUrl: result.auth_url,
          connectionId: result.connection_id,
          context: result.context,
        };
      }

      // HTTP fallback
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.arcade.dev'}/v1/auth/authorize`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: userId,
            tool: toolName,
            context,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get contextual auth: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        authorized: result.authorized || false,
        authUrl: result.auth_url,
        connectionId: result.connection_id,
        context: result.context,
      };
    } catch (error: any) {
      console.error('[ArcadeService] getContextualAuth failed:', error.message);
      return {
        authorized: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute tool with contextual authorization
   * 
   * @param userId - User identifier
   * @param toolName - Tool name
   * @param input - Tool input
   * @param context - Authorization context
   * @returns Execution result
   */
  async executeWithContext(
    userId: string,
    toolName: string,
    input: Record<string, any>,
    context?: Record<string, any>
  ): Promise<ArcadeExecutionResult> {
    // First check authorization
    const auth = await this.getContextualAuth(userId, toolName, context);

    if (!auth.authorized && auth.authUrl) {
      return {
        success: false,
        requiresAuth: true,
        authUrl: auth.authUrl,
        toolName: toolName,
        provider: this.extractToolkit(toolName).toLowerCase(),
        error: 'Authorization required',
      };
    }

    // Execute tool
    return this.executeTool(userId, toolName, input);
  }

  /**
   * Execute a tool
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>,
    userId: string
  ): Promise<ArcadeExecutionResult> {
    await this.initialize();

    try {
      // Check if user has connection for this tool
      const connection = await this.getConnection(userId, toolName);
      
      if (!connection) {
        // Get auth URL for the toolkit
        const toolkit = this.extractToolkit(toolName);
        const authUrl = await this.getAuthUrl(toolkit, userId);

        return {
          success: false,
          requiresAuth: true,
          authUrl,
          toolName: toolName,
          provider: toolkit.toLowerCase(),
          error: `Authorization required for ${toolName}`,
        };
      }

      // Execute tool via SDK
      if (this.client?.tools) {
        const result = await this.client.tools.execute({
          name: toolName,
          input: args,
          connectionId: connection.id,
        });

        return {
          success: true,
          output: result,
          connectionId: connection.id,
        };
      }

      // HTTP fallback
      const response = await fetch(`${this.config.baseUrl || 'https://api.arcade.dev'}/v1/tools/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          tool: toolName,
          input: args,
          connection_id: connection.id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Check if auth error
        if (response.status === 401 || errorData.code === 'AUTH_REQUIRED') {
          const toolkit = this.extractToolkit(toolName);
          const authUrl = await this.getAuthUrl(toolkit, userId);
          
          return {
            success: false,
            requiresAuth: true,
            authUrl,
            error: 'Authorization required',
          };
        }

        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        output: result,
        connectionId: connection.id,
      };
    } catch (error: any) {
      console.error('[ArcadeService] executeTool failed:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get user's connection for a tool
   */
  async getConnection(userId: string, toolName: string): Promise<ArcadeConnection | null> {
    // Check cache
    const cached = this.connections.get(`${userId}:${toolName}`);
    if (cached && cached.status === 'active') {
      return cached;
    }

    try {
      await this.initialize();

      if (this.client?.connections) {
        const connections = await this.client.connections.list({ userId });
        const toolkit = this.extractToolkit(toolName);
        
        const connection = connections.find((c: any) => 
          c.provider === toolkit && c.status === 'active'
        );

        if (connection) {
          const conn: ArcadeConnection = {
            id: connection.id,
            provider: connection.provider,
            userId: connection.user_id,
            status: connection.status,
            createdAt: new Date(connection.created_at).getTime(),
          };
          this.connections.set(`${userId}:${toolName}`, conn);
          return conn;
        }
      }

      // HTTP fallback
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.arcade.dev'}/v1/connections?user_id=${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const toolkit = this.extractToolkit(toolName);
      const connection = data.connections?.find((c: any) => 
        c.provider === toolkit && c.status === 'active'
      );

      if (connection) {
        const conn: ArcadeConnection = {
          id: connection.id,
          provider: connection.provider,
          userId: connection.user_id,
          status: connection.status,
          createdAt: new Date(connection.created_at).getTime(),
        };
        this.connections.set(`${userId}:${toolName}`, conn);
        return conn;
      }

      return null;
    } catch (error: any) {
      console.error('[ArcadeService] getConnection failed:', error.message);
      return null;
    }
  }

  /**
   * Get authorization URL for a toolkit
   */
  async getAuthUrl(toolkit: string, userId: string): Promise<string> {
    try {
      await this.initialize();

      if (this.client?.auth) {
        const authUrl = await this.client.auth.getUrl({
          toolkit,
          userId,
        });
        return authUrl;
      }

      // HTTP fallback
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.arcade.dev'}/v1/auth/url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            toolkit,
            user_id: userId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get auth URL: ${response.statusText}`);
      }

      const data = await response.json();
      return data.url;
    } catch (error: any) {
      console.error('[ArcadeService] getAuthUrl failed:', error.message);
      // Fallback to direct Arcade auth URL
      return `https://auth.arcade.dev/authorize?toolkit=${toolkit}&user_id=${userId}`;
    }
  }

  /**
   * Get user's connections
   */
  async getConnections(userId: string): Promise<ArcadeConnection[]> {
    try {
      await this.initialize();

      if (this.client?.connections) {
        const connections = await this.client.connections.list({ userId });
        return connections.map((c: any) => ({
          id: c.id,
          provider: c.provider,
          userId: c.user_id,
          status: c.status,
          createdAt: new Date(c.created_at).getTime(),
        }));
      }

      // HTTP fallback
      const response = await fetch(
        `${this.config.baseUrl || 'https://api.arcade.dev'}/v1/connections?user_id=${userId}`,
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
      return data.connections?.map((c: any) => ({
        id: c.id,
        provider: c.provider,
        userId: c.user_id,
        status: c.status,
        createdAt: new Date(c.created_at).getTime(),
      })) || [];
    } catch (error: any) {
      console.error('[ArcadeService] getConnections failed:', error.message);
      return [];
    }
  }

  /**
   * Extract toolkit from tool name
   */
  private extractToolkit(toolName: string): string {
    // Tool names are typically in format: toolkit.action
    const parts = toolName.split('.');
    return parts[0] || toolName;
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    connectionsCount: number;
  } {
    return {
      initialized: this.initialized,
      connectionsCount: this.connections.size,
    };
  }
}

/**
 * Create Arcade service instance
 */
export function createArcadeService(config: ArcadeConfig): ArcadeService {
  return new ArcadeService(config);
}

/**
 * Singleton instance
 */
let arcadeServiceInstance: ArcadeService | null = null;

/**
 * Get or create Arcade service instance
 */
export function getArcadeService(): ArcadeService | null {
  if (!arcadeServiceInstance) {
    const apiKey = process.env.ARCADE_API_KEY;
    if (!apiKey) {
      return null;
    }

    arcadeServiceInstance = createArcadeService({
      apiKey,
      baseUrl: process.env.ARCADE_BASE_URL,
      organizationId: process.env.ARCADE_ORGANIZATION_ID,
    });
  }
  return arcadeServiceInstance;
}

/**
 * Initialize Arcade service
 */
export function initializeArcadeService(config?: Partial<ArcadeConfig>): ArcadeService | null {
  if (arcadeServiceInstance) {
    return arcadeServiceInstance;
  }

  const apiKey = config?.apiKey || process.env.ARCADE_API_KEY;
  if (!apiKey) {
    return null;
  }

  arcadeServiceInstance = createArcadeService({
    apiKey,
    ...config,
  });

  return arcadeServiceInstance;
}
