/**
 * Workspace Session Graph (Gap #4 closure)
 *
 * A unified session graph connecting all session types in a workspace:
 *   - Shell sessions (PTY, command-mode)
 *   - Editor sessions (VFS/MCP file operations)
 *   - Agent sessions (AI agent loops)
 *   - Preview sessions (dev server URLs)
 *   - Log sessions (service output streams)
 *   - Execution sessions (code execution)
 *
 * Enables independent reconnection of each session type. Instead of a single
 * monolithic "terminal session", the workspace can have multiple shells, an
 * editor session, an agent session, and preview/log sessions — all tracked
 * in a unified graph with parent-child relationships.
 *
 * Architecture:
 *   Session managers (terminal, agent, preview) call registerSession()
 *   on create and unregisterSession() on disconnect/destroy.
 *   The graph persists in SQLite with workspace-scoped queries.
 *   Reconnection UI queries getReconnectableSessions() to find
 *   disconnected sessions that can be independently resumed.
 *
 * @module workspace/workspace-session-graph
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createLogger } from '@/lib/utils/logger';
import { secureRandomId } from '@/lib/utils/crypto-random';
import { execSchemaFile } from '@/lib/database/schema';

const logger = createLogger('WorkspaceSessionGraph');

// ============================================================================
// Types
// ============================================================================

export type SessionType = 'shell' | 'editor' | 'agent' | 'preview' | 'log' | 'execution';

export type SessionStatus = 'active' | 'idle' | 'disconnected' | 'closed';

export interface SessionGraphNode {
  id: string;
  workspaceId: string;
  userId: string;
  sessionType: SessionType;
  sessionSubtype: string;
  parentSessionId: string | null;
  status: SessionStatus;
  sandboxId: string | null;
  provider: string | null;
  metadata: Record<string, any>;
  connectedAt: number;
  lastActiveAt: number;
  disconnectedAt: number | null;
}

export interface RegisterSessionParams {
  workspaceId: string;
  userId: string;
  sessionType: SessionType;
  sessionSubtype?: string;
  parentSessionId?: string;
  sandboxId?: string;
  provider?: string;
  metadata?: Record<string, any>;
}

export interface SessionGraphResult {
  workspaceId: string;
  sessions: SessionGraphNode[];
  grouped: Record<SessionType, SessionGraphNode[]>;
  summary: {
    total: number;
    active: number;
    disconnected: number;
    closed: number;
    byType: Record<SessionType, number>;
  };
}

export interface ReconnectableSession {
  node: SessionGraphNode;
  disconnectedAt: number;
  idleDuration: number;
}

// ============================================================================
// SQLite Configuration
// ============================================================================

const SESSION_GRAPH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours before closed sessions are pruned
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

// ============================================================================
// WorkspaceSessionGraph Class
// ============================================================================

export class WorkspaceSessionGraph {
  private db: BetterSqlite3.Database | null = null;
  private initialized = false;

  // Prepared statements
  private stmtInsert: BetterSqlite3.Statement | null = null;
  private stmtUpdateStatus: BetterSqlite3.Statement | null = null;
  private stmtUpdateActivity: BetterSqlite3.Statement | null = null;
  private stmtGetById: BetterSqlite3.Statement | null = null;
  private stmtGetByWorkspace: BetterSqlite3.Statement | null = null;
  private stmtGetByWorkspaceAndType: BetterSqlite3.Statement | null = null;
  private stmtGetReconnectable: BetterSqlite3.Statement | null = null;
  private stmtCleanupClosed: BetterSqlite3.Statement | null = null;
  private stmtGetStats: BetterSqlite3.Statement | null = null;

  private ensureInitialized(): void {
    if (this.initialized && this.db) return;

    try {
      const { getDatabase } = require('@/lib/database/connection-shim');
      this.db = getDatabase();
      if (!this.db) return;

      execSchemaFile(this.db, '023_workspace_session_graph');

      this.stmtInsert = this.db.prepare(`
        INSERT OR REPLACE INTO workspace_session_graph
          (id, workspace_id, user_id, session_type, session_subtype,
           parent_session_id, status, sandbox_id, provider, metadata,
           connected_at, last_active_at, disconnected_at)
        VALUES
          (@id, @workspaceId, @userId, @sessionType, @sessionSubtype,
           @parentSessionId, @status, @sandboxId, @provider, @metadata,
           @connectedAt, @lastActiveAt, @disconnectedAt)
      `);

      this.stmtUpdateStatus = this.db.prepare(`
        UPDATE workspace_session_graph
        SET status = @status,
            last_active_at = @lastActiveAt,
            disconnected_at = @disconnectedAt
        WHERE id = @id
      `);

      this.stmtUpdateActivity = this.db.prepare(`
        UPDATE workspace_session_graph
        SET last_active_at = @lastActiveAt
        WHERE id = @id
      `);

      this.stmtGetById = this.db.prepare(`
        SELECT * FROM workspace_session_graph WHERE id = ?
      `);

      this.stmtGetByWorkspace = this.db.prepare(`
        SELECT * FROM workspace_session_graph
        WHERE workspace_id = ? AND status != 'closed'
        ORDER BY connected_at DESC
      `);

      this.stmtGetByWorkspaceAndType = this.db.prepare(`
        SELECT * FROM workspace_session_graph
        WHERE workspace_id = ? AND session_type = ? AND status != 'closed'
        ORDER BY connected_at DESC
      `);

      this.stmtGetReconnectable = this.db.prepare(`
        SELECT * FROM workspace_session_graph
        WHERE workspace_id = ? AND user_id = ? AND status = 'disconnected'
        ORDER BY disconnected_at DESC
      `);

      this.stmtCleanupClosed = this.db.prepare(`
        DELETE FROM workspace_session_graph
        WHERE status = 'closed' AND last_active_at < ?
      `);

      this.stmtGetStats = this.db.prepare(`
        SELECT
          session_type,
          status,
          COUNT(*) as count
        FROM workspace_session_graph
        WHERE workspace_id = ? AND status != 'closed'
        GROUP BY session_type, status
      `);

      this.initialized = true;

      // Start periodic cleanup of closed sessions
      const timer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
      timer.unref?.();

      logger.info('Workspace session graph initialized');
    } catch (err: any) {
      logger.warn('Workspace session graph unavailable', { error: err.message });
    }
  }

  // ==========================================================================
  // Public API - Session Registration
  // ==========================================================================

  /**
   * Register a new session in the workspace graph.
   * Call this when any session type is created (shell, editor, agent, preview, log, execution).
   */
  registerSession(params: RegisterSessionParams): string {
    this.ensureInitialized();
    if (!this.db || !this.stmtInsert) return '';

    const id = `sess-${params.sessionType}-${Date.now()}-${secureRandomId().slice(0, 8)}`;
    const now = Date.now();

    try {
      this.stmtInsert.run({
        id,
        workspaceId: params.workspaceId,
        userId: params.userId,
        sessionType: params.sessionType,
        sessionSubtype: params.sessionSubtype || '',
        parentSessionId: params.parentSessionId || null,
        status: 'active',
        sandboxId: params.sandboxId || null,
        provider: params.provider || null,
        metadata: JSON.stringify(params.metadata || {}),
        connectedAt: now,
        lastActiveAt: now,
        disconnectedAt: null,
      });

      logger.info('Session registered in graph', {
        id: id.slice(0, 24),
        workspaceId: params.workspaceId.slice(0, 16),
        type: params.sessionType,
        subtype: params.sessionSubtype,
      });
    } catch (err: any) {
      logger.warn('Failed to register session in graph', { error: err.message });
    }

    return id;
  }

  /**
   * Unregister a session — marks it as disconnected.
   * Disconnected sessions can be reconnected later.
   */
  unregisterSession(sessionId: string, close: boolean = false): void {
    this.ensureInitialized();
    if (!this.db || !this.stmtUpdateStatus) return;

    const now = Date.now();
    const status: SessionStatus = close ? 'closed' : 'disconnected';

    try {
      this.stmtUpdateStatus.run({
        id: sessionId,
        status,
        lastActiveAt: now,
        disconnectedAt: now,
      });

      logger.info('Session unregistered from graph', {
        id: sessionId.slice(0, 24),
        status,
        close,
      });
    } catch (err: any) {
      logger.warn('Failed to unregister session', { error: err.message });
    }
  }

  /**
   * Reconnect a disconnected session — marks it as active again.
   */
  reconnectSession(sessionId: string): SessionGraphNode | null {
    this.ensureInitialized();
    if (!this.db || !this.stmtUpdateStatus || !this.stmtGetById) return null;

    const node = this.getById(sessionId);
    if (!node || node.status !== 'disconnected') return null;

    const now = Date.now();
    try {
      this.stmtUpdateStatus.run({
        id: sessionId,
        status: 'active',
        lastActiveAt: now,
        disconnectedAt: null,
      });

      logger.info('Session reconnected', {
        id: sessionId.slice(0, 24),
        type: node.sessionType,
      });

      return { ...node, status: 'active', lastActiveAt: now, disconnectedAt: null };
    } catch (err: any) {
      logger.warn('Failed to reconnect session', { error: err.message });
      return null;
    }
  }

  // ==========================================================================
  // Public API - Activity Tracking
  // ==========================================================================

  /**
   * Update the last activity timestamp for a session.
   * Call this periodically for long-lived sessions (shell, agent) to prevent
   * them from appearing idle.
   */
  updateSessionActivity(sessionId: string): void {
    this.ensureInitialized();
    if (!this.db || !this.stmtUpdateActivity) return;

    try {
      this.stmtUpdateActivity.run({ id: sessionId, lastActiveAt: Date.now() });
    } catch {
      // Best-effort
    }
  }

  /**
   * Mark a session as idle.
   */
  markSessionIdle(sessionId: string): void {
    this.ensureInitialized();
    if (!this.db || !this.stmtUpdateStatus) return;

    try {
      this.stmtUpdateStatus.run({
        id: sessionId,
        status: 'idle',
        lastActiveAt: Date.now(),
        disconnectedAt: null,
      });
    } catch {
      // Best-effort
    }
  }

  // ==========================================================================
  // Public API - Graph Queries
  // ==========================================================================

  /**
   * Get the full session graph for a workspace.
   * Returns all non-closed sessions grouped by type.
   */
  getSessionGraph(workspaceId: string): SessionGraphResult {
    this.ensureInitialized();
    const sessions = this.getByWorkspace(workspaceId);

    const grouped: Record<SessionType, SessionGraphNode[]> = {
      shell: [],
      editor: [],
      agent: [],
      preview: [],
      log: [],
      execution: [],
    };

    const byType: Record<SessionType, number> = {
      shell: 0, editor: 0, agent: 0, preview: 0, log: 0, execution: 0,
    };

    let active = 0;
    let disconnected = 0;
    let closed = 0;

    for (const s of sessions) {
      grouped[s.sessionType]?.push(s);
      byType[s.sessionType] = (byType[s.sessionType] || 0) + 1;

      if (s.status === 'active') active++;
      else if (s.status === 'disconnected') disconnected++;
      else if (s.status === 'closed') closed++;
    }

    return {
      workspaceId,
      sessions,
      grouped,
      summary: {
        total: sessions.length,
        active,
        disconnected,
        closed,
        byType,
      },
    };
  }

  /**
   * Get sessions of a specific type in a workspace.
   */
  getSessionsByType(workspaceId: string, sessionType: SessionType): SessionGraphNode[] {
    this.ensureInitialized();
    return this.getByWorkspaceAndType(workspaceId, sessionType);
  }

  /**
   * Get all reconnectable sessions for a user in a workspace.
   * Returns disconnected sessions sorted by most recently disconnected.
   */
  getReconnectableSessions(workspaceId: string, userId: string): ReconnectableSession[] {
    this.ensureInitialized();
    if (!this.db || !this.stmtGetReconnectable) return [];

    const now = Date.now();
    try {
      const rows = this.stmtGetReconnectable.all(workspaceId, userId) as any[];
      return rows.map((row: any) => ({
        node: this.rowToNode(row),
        disconnectedAt: row.disconnected_at,
        idleDuration: now - row.disconnected_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Check if a workspace has an active session of a given type.
   */
  hasActiveSession(workspaceId: string, sessionType: SessionType): boolean {
    const sessions = this.getSessionsByType(workspaceId, sessionType);
    return sessions.some(s => s.status === 'active');
  }

  // ==========================================================================
  // Public API - Statistics & Cleanup
  // ==========================================================================

  /**
   * Get session statistics for a workspace.
   */
  getSessionStats(workspaceId: string): Array<{ sessionType: string; status: string; count: number }> {
    this.ensureInitialized();
    if (!this.db || !this.stmtGetStats) return [];

    try {
      return this.stmtGetStats.all(workspaceId) as any[];
    } catch {
      return [];
    }
  }

  /**
   * Clean up closed sessions older than the TTL.
   */
  cleanupStaleSessions(): number {
    this.ensureInitialized();
    if (!this.db || !this.stmtCleanupClosed) return 0;

    try {
      const cutoff = Date.now() - SESSION_GRAPH_TTL_MS;
      const result = this.stmtCleanupClosed.run(cutoff);
      const deleted = (result as any).changes || 0;
      if (deleted > 0) {
        logger.debug(`Cleaned up ${deleted} stale session graph entries`);
      }
      return deleted;
    } catch {
      return 0;
    }
  }

  /**
   * Close all sessions for a workspace.
   */
  closeWorkspaceSessions(workspaceId: string): void {
    const sessions = this.getByWorkspace(workspaceId);
    for (const s of sessions) {
      this.unregisterSession(s.id, true);
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getById(id: string): SessionGraphNode | null {
    if (!this.db || !this.stmtGetById) return null;
    try {
      const row = this.stmtGetById.get(id) as any;
      return row ? this.rowToNode(row) : null;
    } catch {
      return null;
    }
  }

  private getByWorkspace(workspaceId: string): SessionGraphNode[] {
    if (!this.db || !this.stmtGetByWorkspace) return [];
    try {
      const rows = this.stmtGetByWorkspace.all(workspaceId) as any[];
      return rows.map((r: any) => this.rowToNode(r));
    } catch {
      return [];
    }
  }

  private getByWorkspaceAndType(workspaceId: string, sessionType: SessionType): SessionGraphNode[] {
    if (!this.db || !this.stmtGetByWorkspaceAndType) return [];
    try {
      const rows = this.stmtGetByWorkspaceAndType.all(workspaceId, sessionType) as any[];
      return rows.map((r: any) => this.rowToNode(r));
    } catch {
      return [];
    }
  }

  private rowToNode(row: any): SessionGraphNode {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      sessionType: row.session_type as SessionType,
      sessionSubtype: row.session_subtype || '',
      parentSessionId: row.parent_session_id || null,
      status: row.status as SessionStatus,
      sandboxId: row.sandbox_id || null,
      provider: row.provider || null,
      metadata: (() => { try { return JSON.parse(row.metadata || '{}'); } catch { return {}; } })(),
      connectedAt: row.connected_at,
      lastActiveAt: row.last_active_at,
      disconnectedAt: row.disconnected_at || null,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceSessionGraph = new WorkspaceSessionGraph();
