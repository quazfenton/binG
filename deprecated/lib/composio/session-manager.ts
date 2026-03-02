/**
 * Composio Session Manager
 *
 * Provides secure, per-user session isolation for Composio tools.
 * Each user gets their own session with isolated tools and auth.
 *
 * Features:
 * - Per-user session isolation
 * - MCP (Model Context Protocol) support
 * - Multiple provider framework support (Vercel, Anthropic, OpenAI, etc.)
 * - Tool caching with TTL
 * - Auth state persistence
 * - Database session persistence
 * - Agentic loop handling
 *
 * @see https://docs.composio.dev/ TypeScript SDK Docs
 * @see docs/sdk/composio-llms-full.txt Full documentation
 */

import { Composio } from '@composio/core';
import type { Tool } from '@composio/core';
import { getDatabase } from '@/lib/database/connection';
import { VercelProvider } from '@composio/vercel';
import { AnthropicProvider } from '@composio/anthropic';
import { OpenAIAgentsProvider } from '@composio/openai-agents';

/**
 * User session with Composio
 */
interface UserSession {
  userId: string;
  session: any; // Composio session - SDK doesn't export session type
  createdAt: number;
  lastActive: number;
  tools?: Tool[]; // Cached tools for user
  mcpConfig?: {
    url: string;
    headers: Record<string, string>;
  };
}

/**
 * Composio session configuration
 */
export interface ComposioSessionConfig {
  provider?: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp';
  defaultToolkits?: string[];
  manageConnections?: boolean;
}

/**
 * Tool execution result type
 */
interface ToolExecutionResult {
  successful: boolean;
  data?: any;
  error?: string;
  authRequired?: boolean;
}

/**
 * Session manager for Composio
 *
 * Features:
 * - Per-user session isolation
 * - Automatic session cleanup
 * - Tool caching per user
 * - Auth state persistence
 * - MCP configuration support
 * - Database persistence for sessions
 */
class ComposioSessionManager {
  private sessions: Map<string, UserSession>;
  private composioInstances: Map<string, Composio> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private db: any = null;
  private dbInitialized = false;
  private defaultConfig: ComposioSessionConfig;

  constructor(config?: ComposioSessionConfig) {
    this.sessions = new Map();
    this.defaultConfig = config || {};
    this.initializeDatabase();
    this.startCleanupTimer();
  }

  /**
   * Initialize database for session persistence
   */
  private async initializeDatabase(): Promise<void> {
    try {
      this.db = getDatabase();
      
      // Create table for session persistence
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS composio_sessions (
          user_id TEXT PRIMARY KEY,
          session_data TEXT NOT NULL,
          mcp_config_json TEXT,
          created_at INTEGER NOT NULL,
          last_active INTEGER NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_composio_sessions_last_active
        ON composio_sessions(last_active)
      `);

      // Load existing sessions from database
      await this.loadSessionsFromDb();

      this.dbInitialized = true;
      console.log('[ComposioSessionManager] Database initialized for session persistence');
    } catch (error) {
      console.warn('[ComposioSessionManager] DB init failed, using in-memory only:', error);
      this.db = null;
      this.dbInitialized = false;
    }
  }

  /**
   * Load sessions from database on startup
   */
  private async loadSessionsFromDb(): Promise<void> {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM composio_sessions
        WHERE last_active > ?
        ORDER BY last_active DESC
        LIMIT 100
      `);

      const cutoff = Date.now() - this.SESSION_TTL_MS;
      const rows = stmt.all(cutoff) as any[];

      for (const row of rows) {
        try {
          const sessionData = JSON.parse(row.session_data);
          const mcpConfig = row.mcp_config_json ? JSON.parse(row.mcp_config_json) : undefined;

          // Recreate session from stored data
          // Note: We can't fully restore Composio sessions, but we can cache the metadata
          this.sessions.set(row.user_id, {
            userId: row.user_id,
            session: null, // Will be recreated on next access
            createdAt: row.created_at,
            lastActive: row.last_active,
            mcpConfig,
          });
        } catch (parseError) {
          console.warn('[ComposioSessionManager] Failed to parse session:', parseError);
        }
      }

      console.log(`[ComposioSessionManager] Loaded ${this.sessions.size} sessions from DB`);
    } catch (error) {
      console.warn('[ComposioSessionManager] Failed to load sessions:', error);
    }
  }

  /**
   * Persist session to database
   */
  private async persistSession(session: UserSession): Promise<void> {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO composio_sessions
        (user_id, session_data, mcp_config_json, created_at, last_active, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(
        session.userId,
        JSON.stringify({
          createdAt: session.createdAt,
          lastActive: session.lastActive,
        }),
        session.mcpConfig ? JSON.stringify(session.mcpConfig) : null,
        session.createdAt,
        session.lastActive,
      );
    } catch (error) {
      console.warn('[ComposioSessionManager] Failed to persist session:', error);
    }
  }

  /**
   * Delete session from database
   */
  private async deleteSessionFromDb(userId: string): Promise<void> {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('DELETE FROM composio_sessions WHERE user_id = ?');
      stmt.run(userId);
    } catch (error) {
      console.warn('[ComposioSessionManager] Failed to delete session:', error);
    }
  }

  /**
   * Get or create session for user
   *
   * @param userId - Unique user identifier
   * @param options - Session options including provider and toolkits
   * @returns User session with tools
   */
  async getSession(userId: string, options?: { 
    provider?: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp'; 
    toolkits?: string[] 
  }): Promise<UserSession> {
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastActive = Date.now();
      await this.persistSession(existing);
      return existing;
    }

    // Create new session
    const composio = await this.initComposio(options?.provider);
    
    // Create session with configuration based on provider and options
    const sessionConfig: any = {
      userId,
    };
    
    if (options?.toolkits || this.defaultConfig.defaultToolkits) {
      sessionConfig.toolkits = options?.toolkits || this.defaultConfig.defaultToolkits;
    }
    
    if (this.defaultConfig.manageConnections) {
      sessionConfig.manageConnections = true;
    }

    const session = await composio.create(sessionConfig);

    // Cache MCP config from session
    const mcpConfig = session.mcp ? {
      url: session.mcp.url,
      headers: session.mcp.headers || {},
    } : undefined;

    const userSession: UserSession = {
      userId,
      session,
      createdAt: Date.now(),
      lastActive: Date.now(),
      mcpConfig,
    };

    this.sessions.set(userId, userSession);
    await this.persistSession(userSession);

    return userSession;
  }

  /**
   * Get tools for user
   * 
   * ENHANCED: Now with tool caching for better performance and framework-specific support
   */
  async getUserTools(
    userId: string,
    options?: { 
      toolkit?: string; 
      limit?: number;
      provider?: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp';
    }
  ): Promise<Tool[]> {
    const session = await this.getSession(userId, { provider: options?.provider });

    // Return cached tools if available and no filters
    if (session.tools && !options) {
      return session.tools;
    }

    try {
      const tools = await session.tools();

      // Filter if toolkit specified
      let filteredTools = tools;
      if (options?.toolkit) {
        filteredTools = tools.filter(tool =>
          tool.toolkit?.toLowerCase() === options.toolkit!.toLowerCase()
        );
      }

      // Apply limit if specified
      if (options?.limit) {
        filteredTools = filteredTools.slice(0, options.limit);
      }

      // Cache tools for future requests (only if no filters)
      if (!options) {
        session.tools = tools;
        await this.persistSession(session);
      }

      return filteredTools;
    } catch (error: any) {
      console.error('[ComposioSessionManager] Failed to get tools:', error);
      return [];
    }
  }

  /**
   * Get cached tool by name
   * 
   * ADDED: Fast tool lookup from cache
   */
  async getCachedTool(userId: string, toolName: string): Promise<Tool | null> {
    const session = this.sessions.get(userId);
    if (!session?.tools) return null;

    return session.tools.find(t => t.slug === toolName || t.name === toolName) || null;
  }

  /**
   * Clear tool cache for user
   * 
   * ADDED: Manual cache invalidation
   */
  async clearToolCache(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      session.tools = undefined;
      await this.persistSession(session);
    }
  }

  /**
   * Clear all tool caches
   * 
   * ADDED: Global cache invalidation
   */
  async clearAllToolCaches(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.tools = undefined;
    }
  }

  /**
   * Get MCP configuration for user
   */
  async getMcpConfig(userId: string): Promise<{ url: string; headers: Record<string, string> } | null> {
    const session = await this.getSession(userId);
    return session.mcpConfig || null;
  }

  /**
   * Execute tool for user
   */
  async executeTool(
    userId: string,
    toolName: string,
    params: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const session = await this.getSession(userId);

    try {
      const tools = await session.tools();
      const tool = tools.find(t => t.slug === toolName || t.name === toolName);

      if (!tool) {
        return {
          successful: false,
          error: `Tool ${toolName} not found`,
        };
      }

      const result = await tool.execute({
        userId,
        params,
      });

      session.lastActive = Date.now();
      await this.persistSession(session);

      return {
        successful: true,
        data: result,
      };
    } catch (error: any) {
      console.error(`[ComposioSessionManager] Tool execution failed: ${toolName}`, error);

      const isAuthError = error.message?.includes('auth') ||
                         error.message?.includes('authorization') ||
                         error.message?.includes('connected account');

      return {
        successful: false,
        error: error.message || 'Tool execution failed',
        authRequired: isAuthError,
      };
    }
  }

  /**
   * AGENTIC LOOP: Run complete tool execution cycle with LLM
   * 
   * This implements the full agentic loop pattern from Composio docs:
   * 1. Send user message to LLM with tools
   * 2. If LLM requests tool use, execute the tool
   * 3. Feed tool result back to LLM
   * 4. Continue until LLM has final response
   * 
   * @param userId - User ID
   * @param messages - Conversation messages
   * @param options - Loop options
   * @returns Final response with tool execution history
   */
  async runAgenticLoop(
    userId: string,
    messages: Array<{ role: string; content: string }>,
    options: {
      llm?: any; // LLM client (OpenAI, Anthropic, etc.)
      maxSteps?: number;
      provider?: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp';
      onToolExecute?: (toolName: string, result: any) => void;
    } = {}
  ): Promise<{
    success: boolean;
    response: string;
    steps: number;
    toolExecutions: Array<{ tool: string; result: any }>;
    error?: string;
  }> {
    const session = await this.getSession(userId, { provider: options.provider });
    const tools = await session.tools();
    
    // Use provided LLM or default to OpenAI
    let llm = options.llm;
    if (!llm) {
      try {
        const { OpenAI } = await import('openai');
        llm = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      } catch {
        return {
          success: false,
          response: '',
          steps: 0,
          toolExecutions: [],
          error: 'No LLM provided and OpenAI not available',
        };
      }
    }

    const maxSteps = options.maxSteps ?? 10;
    const toolExecutions: Array<{ tool: string; result: any }> = [];
    let currentMessages = [...messages];
    let steps = 0;

    while (steps < maxSteps) {
      try {
        // Call LLM with tools
        const response = await llm.chat.completions.create({
          model: 'gpt-4o',
          messages: currentMessages,
          tools: tools.map(t => ({
            type: 'function',
            function: {
              name: t.slug || t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          })),
          tool_choice: 'auto',
        });

        const choice = response.choices[0];
        const message = choice.message;

        // If no tool calls, we have final response
        if (!message.tool_calls || message.tool_calls.length === 0) {
          return {
            success: true,
            response: message.content || '',
            steps,
            toolExecutions,
          };
        }

        // Execute tool calls
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          // Find tool in session
          const tool = tools.find(t => t.slug === toolName || t.name === toolName);
          if (!tool) {
            return {
              success: false,
              response: '',
              steps,
              toolExecutions,
              error: `Tool ${toolName} not found`,
            };
          }

          // Execute tool
          const result = await this.executeTool(userId, toolName, toolArgs);
          
          toolExecutions.push({
            tool: toolName,
            result: result.successful ? result.data : result.error,
          });

          // Notify callback if provided
          options.onToolExecute?.(toolName, result);

          // Add tool result to conversation
          currentMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCall],
          });

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.successful ? result.data : { error: result.error }),
          });
        }

        steps++;
      } catch (error: any) {
        console.error('[ComposioSessionManager] Agentic loop error:', error);
        return {
          success: false,
          response: '',
          steps,
          toolExecutions,
          error: error.message || 'Agentic loop failed',
        };
      }
    }

    return {
      success: false,
      response: '',
      steps,
      toolExecutions,
      error: `Max steps (${maxSteps}) exceeded`,
    };
  }

  /**
   * PROVIDER SWITCHING: Switch user session to different provider
   * 
   * Allows switching between Vercel, Anthropic, OpenAI Agents, and MCP
   * without losing session state
   */
  async switchProvider(
    userId: string,
    newProvider: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp'
  ): Promise<{
    success: boolean;
    previousProvider: string;
    newProvider: string;
    toolsReloaded: boolean;
  }> {
    const session = this.sessions.get(userId);
    
    // Determine previous provider
    let previousProvider = 'mcp';
    if (session?.mcpConfig) {
      previousProvider = 'mcp';
    }
    // Could track provider in session metadata for more accuracy

    // Remove old session to force recreation with new provider
    this.sessions.delete(userId);

    // Create new session with new provider
    try {
      const newSession = await this.getSession(userId, { provider: newProvider });
      
      return {
        success: true,
        previousProvider,
        newProvider,
        toolsReloaded: true,
      };
    } catch (error: any) {
      // Restore old session on failure
      if (session) {
        this.sessions.set(userId, session);
      }
      
      return {
        success: false,
        previousProvider,
        newProvider,
        toolsReloaded: false,
        error: error.message,
      };
    }
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Array<{
    name: string;
    description: string;
    available: boolean;
  }> {
    const providers = [
      {
        name: 'vercel',
        description: 'Vercel AI SDK integration',
        available: !!process.env.VERCEL_API_KEY,
      },
      {
        name: 'anthropic',
        description: 'Anthropic Claude integration',
        available: !!process.env.ANTHROPIC_API_KEY,
      },
      {
        name: 'openai-agents',
        description: 'OpenAI Agents SDK integration',
        available: !!process.env.OPENAI_API_KEY,
      },
      {
        name: 'mcp',
        description: 'Model Context Protocol (no API key required)',
        available: true,
      },
    ];

    return providers;
  }

  /**
   * Search tools for user
   */
  async searchTools(
    userId: string,
    query: string,
    options?: { toolkit?: string; limit?: number }
  ): Promise<Tool[]> {
    const userSession = await this.getSession(userId);

    try {
      const tools = await userSession.session.tools();

      const queryLower = query.toLowerCase();
      let results = tools.filter(tool =>
        tool.name?.toLowerCase().includes(queryLower) ||
        tool.description?.toLowerCase().includes(queryLower) ||
        tool.toolkit?.toLowerCase().includes(queryLower)
      );

      if (options?.toolkit) {
        results = results.filter(tool =>
          tool.toolkit?.toLowerCase() === options.toolkit!.toLowerCase()
        );
      }

      if (options?.limit) {
        results = results.slice(0, options.limit);
      }

      return results;
    } catch (error: any) {
      console.error('[ComposioSessionManager] Failed to search tools:', error);
      return [];
    }
  }

  /**
   * Get connected accounts for user
   */
  async getConnectedAccounts(userId: string): Promise<any[]> {
    const session = await this.getSession(userId);

    try {
      const accounts = await session.session.connectedAccounts.list();
      return accounts.filter((a: any) => a.userId === userId);
    } catch (error: any) {
      console.error('[ComposioSessionManager] Failed to get connected accounts:', error);
      return [];
    }
  }

  /**
   * Connect account for user
   */
  async connectAccount(
    userId: string,
    toolkit: string,
    authMode: 'OAUTH2' | 'API_KEY' | 'BASIC' = 'OAUTH2'
  ): Promise<{ redirectUrl?: string; connectionId?: string; status: 'pending' | 'active' }> {
    const session = await this.getSession(userId);

    try {
      const connection = await session.session.initiateConnection({
        toolkit,
        authMode,
        userId,
      });

      session.tools = undefined;
      await this.persistSession(session);

      if (connection.redirectUrl) {
        return {
          redirectUrl: connection.redirectUrl,
          status: 'pending',
        };
      }

      return {
        connectionId: connection.id,
        status: 'active',
      };
    } catch (error: any) {
      console.error('[ComposioSessionManager] Failed to connect account:', error);
      throw error;
    }
  }

  /**
   * Disconnect account for user
   */
  async disconnectAccount(userId: string, accountId: string): Promise<void> {
    const session = await this.getSession(userId);
    await session.session.connectedAccounts.delete({ id: accountId });

    session.tools = undefined;
    await this.persistSession(session);
  }

  /**
   * Remove user session
   */
  async removeSession(userId: string): Promise<void> {
    this.sessions.delete(userId);
    await this.deleteSessionFromDb(userId);
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeUsers: number;
    totalTools: number;
  } {
    const now = Date.now();
    const activeUsers = Array.from(this.sessions.values())
      .filter(s => now - s.lastActive < 5 * 60 * 1000)
      .length;

    const totalTools = Array.from(this.sessions.values())
      .reduce((sum, s) => sum + (s.tools?.length || 0), 0);

    return {
      totalSessions: this.sessions.size,
      activeUsers,
      totalTools,
    };
  }

  /**
   * Start cleanup timer for expired sessions
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const expiredUsers: string[] = [];

      for (const [userId, session] of this.sessions.entries()) {
        if (now - session.lastActive > this.SESSION_TTL_MS) {
          expiredUsers.push(userId);
        }
      }

      for (const userId of expiredUsers) {
        this.sessions.delete(userId);
        await this.deleteSessionFromDb(userId);
        console.log(`[ComposioSessionManager] Cleaned up expired session for ${userId}`);
      }
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Initialize Composio client with provider support
   */
  private async initComposio(providerType?: 'vercel' | 'anthropic' | 'openai-agents' | 'mcp'): Promise<Composio> {
    const type = providerType || this.defaultConfig.provider || 'mcp';
    
    if (this.composioInstances.has(type)) {
      return this.composioInstances.get(type)!;
    }

    try {
      let providerInstance;
      
      // Use the specified provider or default based on config
      switch (type) {
        case 'vercel':
          providerInstance = new VercelProvider();
          break;
        case 'anthropic':
          providerInstance = new AnthropicProvider();
          break;
        case 'openai-agents':
          providerInstance = new OpenAIAgentsProvider();
          break;
        case 'mcp':
        default:
          // MCP provider is the default which doesn't require a specific provider instance
          break;
      }

      const composioOptions: any = {
        apiKey: process.env.COMPOSIO_API_KEY,
        baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev',
      };

      if (providerInstance) {
        composioOptions.provider = providerInstance;
      }

      const instance = new Composio(composioOptions);
      this.composioInstances.set(type, instance);
      return instance;
    } catch (error) {
      console.error('[ComposioSessionManager] Failed to initialize:', error);
      throw error;
    }
  }
}

// Singleton instance
export const composioSessionManager = new ComposioSessionManager();

// Export for testing
export { ComposioSessionManager };
