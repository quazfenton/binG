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
  toolName?: string;
  provider?: string;
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
        baseURL: this.config.baseUrl,
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
   *
   * @param filters - Optional filters (toolkit, tags, limit)
   */
  async getTools(filters?: {
    toolkit?: string;
    tags?: string[];
    limit?: number;
  }): Promise<ArcadeTool[]> {
    await this.initialize();

    try {
      // Check cache first if no filters
      if (!filters && this.tools.size > 0) {
        return Array.from(this.tools.values());
      }

      const cacheKey = filters?.toolkit ? `toolkit:${filters.toolkit}` : 'all';
      
      if (this.client?.tools) {
        const options = {
          toolkit: filters?.toolkit,
          tags: filters?.tags,
          limit: filters?.limit,
        };
        const tools = await this.client.tools.list(options);
        const mappedTools = tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          toolkit: t.toolkit,
          inputSchema: t.input_schema || {},
          requiresAuth: t.requires_auth || false,
        }));
        
        // Populate cache
        if (!filters) {
          this.tools.clear();
          for (const tool of mappedTools) {
            this.tools.set(tool.name, tool);
          }
        } else if (filters?.toolkit) {
          for (const tool of mappedTools) {
            this.tools.set(tool.name, tool);
          }
        }
        
        return mappedTools;
      }

      // HTTP fallback
      const url = new URL(`${this.config.baseUrl || 'https://api.arcade.dev'}/v1/tools`);
      if (filters?.toolkit) {
        url.searchParams.set('toolkit', filters.toolkit);
      }
      if (filters?.tags?.length) {
        url.searchParams.set('tags', filters.tags.join(','));
      }
      if (filters?.limit) {
        url.searchParams.set('limit', String(filters.limit));
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
      const mappedTools = data.tools?.map((t: any) => ({
        name: t.name,
        description: t.description,
        toolkit: t.toolkit,
        inputSchema: t.input_schema || {},
        requiresAuth: t.requires_auth || false,
      })) || [];
      
      // Populate cache
      if (!filters) {
        this.tools.clear();
        for (const tool of mappedTools) {
          this.tools.set(tool.name, tool);
        }
      } else if (filters?.toolkit) {
        for (const tool of mappedTools) {
          this.tools.set(tool.name, tool);
        }
      }
      
      return mappedTools;
    } catch (error: any) {
      console.error('[ArcadeService] getTools failed:', error.message);
      return [];
    }
  }

  /**
   * Search for tools
   *
   * @param query - Search query
   * @param options - Optional search options (limit, etc.)
   */
  async searchTools(
    query: string,
    options?: { limit?: number }
  ): Promise<ArcadeTool[]> {
    await this.initialize();

    try {
      if (this.client?.tools?.search) {
        const tools = await this.client.tools.search({
          query,
          limit: options?.limit,
        });
        return tools.map((t: any) => ({
          name: t.name,
          description: t.description,
          toolkit: t.toolkit,
          inputSchema: t.input_schema || {},
          requiresAuth: t.requires_auth || false,
        }));
      }

      // Fallback to local search
      const allTools = await this.getTools();
      const queryLower = query.toLowerCase();

      let results = allTools.filter(tool =>
        tool.name.toLowerCase().includes(queryLower) ||
        tool.description.toLowerCase().includes(queryLower) ||
        tool.toolkit.toLowerCase().includes(queryLower)
      );

      if (options?.limit) {
        results = results.slice(0, options.limit);
      }

      return results;
    } catch (error: any) {
      console.error('[ArcadeService] searchTools failed:', error.message);
      return [];
    }
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
    error?: string;
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
    return this.executeTool(toolName, input, userId);
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
          tool_name: toolName,
          input: args,
          user_id: userId,
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
   * Start OAuth authorization for a provider using Arcade SDK
   *
   * Uses client.auth.start() which handles the OAuth flow through Arcade's
   * managed auth layer. Returns auth URL if authorization is not yet complete.
   *
   * @param userId - User identifier (Arcade user ID)
   * @param provider - OAuth provider name (e.g., "github", "google", "x"/"twitter")
   * @param scopes - Optional OAuth scopes to request (e.g., ["tweet.read", "tweet.write"])
   * @returns { status, url?, token? } — status is "completed" when token is ready
   *
   * @example
   * ```typescript
   * // Basic provider auth
   * const result = await arcadeService.startProviderAuth('user_123', 'github');
   *
   * // With specific scopes (per Arcade SDK docs)
   * const result = await arcadeService.startProviderAuth('user_123', 'x', [
   *   'tweet.read', 'tweet.write', 'users.read'
   * ]);
   *
   * if (result.status !== 'completed') {
   *   // Redirect user to result.url to complete OAuth in browser
   * } else {
   *   // result.token is ready for API calls
   * }
   * ```
   */
  async startProviderAuth(
    userId: string,
    provider: string,
    scopes?: string[],
  ): Promise<{
    status: 'completed' | 'pending' | 'error';
    url?: string;
    token?: string;
    error?: string;
  }> {
    await this.initialize();

    try {
      // SDK path (preferred) — uses client.auth.start(userId, provider, scopes?)
      // Per Arcade SDK docs:
      //   client.auth.start(userId, provider)                        // no scopes
      //   client.auth.start(userId, provider, ["scope1", "scope2"])  // array form (X/Twitter)
      //   client.auth.start(userId, provider, { scopes: [...] })     // object form (Discord)
      // All return { status, url?, context: { token? } }
      if (this.client?.auth?.start) {
        let authResponse: any;

        if (scopes && scopes.length > 0) {
          // Use object form { scopes } for consistency across providers
          // (Discord, Google, GitHub all expect { scopes: [...] })
          authResponse = await this.client.auth.start(userId, provider, { scopes });
        } else {
          authResponse = await this.client.auth.start(userId, provider);
        }

        if (authResponse.status === 'completed' && authResponse.context?.token) {
          return {
            status: 'completed',
            token: authResponse.context.token,
          };
        }

        // Authorization not yet complete — return URL for browser flow
        if (authResponse.url) {
          return {
            status: 'pending',
            url: authResponse.url,
          };
        }

        // No URL and not completed — unexpected state
        return {
          status: 'error',
          error: 'No authorization URL returned from Arcade',
        };
      }

      // HTTP fallback — use the authorize endpoint
      if (this.client?.auth?.authorize) {
        const result = await this.client.auth.authorize({
          userId,
          tool: provider,
        });

        if (result.authorized && result.context?.token) {
          return {
            status: 'completed',
            token: result.context.token,
          };
        }

        if (result.auth_url) {
          return {
            status: 'pending',
            url: result.auth_url,
          };
        }
      }

      // Full HTTP fallback — no SDK available
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
            tool: provider,
          }),
        }
      );

      if (!response.ok) {
        return {
          status: 'error',
          error: `Arcade auth failed: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();

      if (data.authorized && data.context?.token) {
        return {
          status: 'completed',
          token: data.context.token,
        };
      }

      if (data.auth_url) {
        return {
          status: 'pending',
          url: data.auth_url,
        };
      }

      return {
        status: 'error',
        error: 'No token or auth URL returned from Arcade',
      };
    } catch (error: any) {
      console.error('[ArcadeService] startProviderAuth failed:', error.message);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Wait for provider authorization to complete using Arcade SDK
   *
   * Polls Arcade until the user completes the OAuth flow in their browser.
   * Uses client.auth.waitForCompletion() under the hood.
   *
   * @param userId - User identifier
   * @param provider - OAuth provider name
   * @param authResponse - The initial auth response from startProviderAuth
   * @param timeoutMs - Max time to wait (default: 300000 = 5 min)
   * @returns { status, token? } — status is "completed" with token on success
   *
   * @example
   * ```typescript
   * const result = await arcadeService.waitForProviderAuth(userId, 'github', pendingResponse);
   * // result.token is the OAuth token for the provider API
   * ```
   */
  async waitForProviderAuth(
    userId: string,
    provider: string,
    authResponse: { status: string; url?: string },
    timeoutMs: number = 300000,
  ): Promise<{
    status: 'completed' | 'timeout' | 'error';
    token?: string;
    error?: string;
  }> {
    await this.initialize();

    try {
      // SDK path (preferred) — uses client.auth.waitForCompletion()
      if (this.client?.auth?.waitForCompletion) {
        const result = await this.client.auth.waitForCompletion(authResponse, {
          timeoutMs,
        });

        if (result.status === 'completed' && result.context?.token) {
          return {
            status: 'completed',
            token: result.context.token,
          };
        }

        if (result.status === 'timeout') {
          return {
            status: 'timeout',
            error: `Authorization timed out after ${timeoutMs / 1000}s`,
          };
        }

        return {
          status: 'error',
          error: result.error || 'Authorization did not complete',
        };
      }

      // Manual polling fallback — no SDK waitForCompletion
      // FIX: Bypass the connection cache during polling to ensure we see newly authorized providers.
      // getConnections() short-circuits to cached active connections; if a stale cache exists
      // the polling loop won't see the new authorization and will time out incorrectly.
      const maxAttempts = Math.max(1, Math.floor(timeoutMs / 3000)); // poll every 3s
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Force a fresh fetch from Arcade API, bypassing the in-memory cache
        const connections = await this._fetchConnections(userId);
        const providerConn = connections.find(c =>
          c.provider.toLowerCase() === provider.toLowerCase() && c.status === 'active'
        );

        if (providerConn) {
          // Connection established — now we need to get the token
          // Try contextual auth to retrieve token
          const tokenResult = await this.getContextualAuth(userId, `${provider}.default`);
          if (tokenResult.authorized && tokenResult.context?.token) {
            return {
              status: 'completed',
              token: tokenResult.context.token,
            };
          }

          // Connection exists but token not retrievable via contextual auth
          return {
            status: 'completed',
            // Token will be obtained on next executeTool call via Arcade's internal auth
          };
        }
      }

      return {
        status: 'timeout',
        error: `Authorization timed out after ${timeoutMs / 1000}s`,
      };
    } catch (error: any) {
      console.error('[ArcadeService] waitForProviderAuth failed:', error.message);
      return {
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * Get an OAuth token for a provider using Arcade SDK
   *
   * Combines startProviderAuth + waitForProviderAuth into a single call.
   * If already authorized, returns token immediately.
   *
   * @param userId - User identifier
   * @param provider - OAuth provider name (e.g., "github", "google", "x")
   * @param scopes - Optional OAuth scopes (e.g., ["tweet.read", "tweet.write"])
   * @param timeoutMs - Max time to wait for user to authorize
   * @returns { token?, requiresAuth?, authUrl? }
   */
  async getProviderToken(
    userId: string,
    provider: string,
    scopes?: string[],
    timeoutMs: number = 300000,
  ): Promise<{
    token?: string;
    requiresAuth?: boolean;
    authUrl?: string;
    error?: string;
  }> {
    // First check if connection already exists
    const existingConnection = await this.getConnection(userId, `${provider}.default`);
    if (existingConnection) {
      // Try to get token via contextual auth
      const authResult = await this.getContextualAuth(userId, `${provider}.default`);
      if (authResult.authorized && authResult.context?.token) {
        return { token: authResult.context.token };
      }
      // Connection exists — token will be obtained on execute
      return { token: undefined /* will be resolved during execution */ };
    }

    // Start authorization (with scopes if provided)
    const startResult = await this.startProviderAuth(userId, provider, scopes);

    if (startResult.status === 'error') {
      return { error: startResult.error };
    }

    if (startResult.status === 'completed' && startResult.token) {
      return { token: startResult.token };
    }

    // User needs to complete OAuth in browser — wait for them if caller allows
    if (startResult.status === 'pending' && startResult.url) {
      // If timeoutMs is > 0, poll Arcade until the user completes the OAuth flow
      if (timeoutMs > 0) {
        const waitResult = await this.waitForProviderAuth(userId, provider, startResult, timeoutMs);
        if (waitResult.status === 'completed' && waitResult.token) {
          return { token: waitResult.token };
        }
        if (waitResult.status === 'timeout') {
          return { requiresAuth: true, authUrl: startResult.url };
        }
        if (waitResult.status === 'error') {
          return { error: waitResult.error };
        }
      }
      return {
        requiresAuth: true,
        authUrl: startResult.url,
      };
    }

    return { error: 'Unexpected auth state' };
  }

  /**
   * Fetch connections from Arcade API, bypassing the in-memory cache.
   * Used during polling to detect newly authorized providers.
   */
  private async _fetchConnections(userId: string): Promise<ArcadeConnection[]> {
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

    if (!response.ok) return [];

    const data = await response.json();
    return data.connections?.map((c: any) => ({
      id: c.id,
      provider: c.provider,
      userId: c.user_id,
      status: c.status,
      createdAt: new Date(c.created_at).getTime(),
    })) || [];
  }

  /**
   * Get user's connections
   */
  async getConnections(userId: string): Promise<ArcadeConnection[]> {
    try {
      await this.initialize();

      // Check cache first
      const userConnections: ArcadeConnection[] = [];
      for (const conn of this.connections.values()) {
        if (conn.userId === userId && conn.status === 'active') {
          userConnections.push(conn);
        }
      }
      if (userConnections.length > 0) {
        return userConnections;
      }

      if (this.client?.connections) {
        const connections = await this.client.connections.list({ userId });
        const mappedConnections = connections.map((c: any) => ({
          id: c.id,
          provider: c.provider,
          userId: c.user_id,
          status: c.status,
          createdAt: new Date(c.created_at).getTime(),
        }));
        
        // Populate cache
        for (const conn of mappedConnections) {
          this.connections.set(`${userId}:${conn.provider}`, conn);
        }
        
        return mappedConnections;
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
      const mappedConnections = data.connections?.map((c: any) => ({
        id: c.id,
        provider: c.provider,
        userId: c.user_id,
        status: c.status,
        createdAt: new Date(c.created_at).getTime(),
      })) || [];
      
      // Populate cache
      for (const conn of mappedConnections) {
        this.connections.set(`${userId}:${conn.provider}`, conn);
      }
      
      return mappedConnections;
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
   * Invalidate cached connections
   * @param userId - Optional user ID to invalidate specific user's connections
   * @param provider - Optional provider to invalidate specific provider connection
   */
  invalidateConnectionsCache(userId?: string, provider?: string): void {
    if (!userId) {
      // Clear all connections
      this.connections.clear();
      console.log('[ArcadeService] Cleared all connections cache');
      return;
    }

    // Clear specific user's connections
    const keysToRemove: string[] = [];
    for (const key of this.connections.keys()) {
      if (key.startsWith(`${userId}:`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.connections.delete(key);
    }
    console.log(`[ArcadeService] Cleared connections cache for user ${userId}`);
  }

  /**
   * Invalidate cached tools
   */
  invalidateToolsCache(): void {
    this.tools.clear();
    console.log('[ArcadeService] Cleared tools cache');
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    connectionsCount: number;
    toolsCount: number;
  } {
    return {
      initialized: this.initialized,
      connectionsCount: this.connections.size,
      toolsCount: this.tools.size,
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
    const apiKey = process.env.ARCADE_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }
    console.log(`[ArcadeService] Initializing with key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

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

  const apiKey = (config?.apiKey || process.env.ARCADE_API_KEY)?.trim();
  if (!apiKey) {
    return null;
  }
  console.log(`[ArcadeService] Initializing with key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

  arcadeServiceInstance = createArcadeService({
    apiKey,
    ...config,
  });

  return arcadeServiceInstance;
}
