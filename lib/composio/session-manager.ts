/**
 * Composio Session Manager
 *
 * Provides secure, per-user session isolation for Composio tools.
 * Each user gets their own session with isolated tools and auth.
 *
 * SECURITY FIX: Added database persistence for sessions
 *
 * @see https://docs.composio.dev/ TypeScript SDK Docs
 * @see docs/sdk/composio-llms-full.txt Full documentation
 */

import { Composio } from '@composio/core';
import type { Tool } from '@composio/core';
import { getDatabase } from '@/lib/database';

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
  private composio: Composio | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private db: any = null;
  private dbInitialized = false;

  constructor() {
    this.sessions = new Map();
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
   * @returns User session with tools
   */
  async getSession(userId: string): Promise<UserSession> {
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastActive = Date.now();
      await this.persistSession(existing);
      return existing;
    }

    // Create new session
    const composio = await this.initComposio();
    const session = await composio.create(userId);

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
   * ENHANCED: Now with tool caching for better performance
   */
  async getUserTools(
    userId: string,
    options?: { toolkit?: string; limit?: number }
  ): Promise<Tool[]> {
    const session = await this.getSession(userId);

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
   * Search tools for user
   */
  async searchTools(
    userId: string,
    query: string,
    options?: { toolkit?: string; limit?: number }
  ): Promise<Tool[]> {
    const session = await this.getSession(userId);

    try {
      const tools = await session.tools();

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
   * Initialize Composio client
   */
  private async initComposio(): Promise<Composio> {
    if (this.composio) return this.composio;

    try {
      this.composio = new Composio({
        apiKey: process.env.COMPOSIO_API_KEY,
        baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev',
      });
      return this.composio;
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
