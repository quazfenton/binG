/**
 * Database Session Store
 * 
 * Provides persistent storage for terminal sessions with:
 * - SQLite backend for simplicity
 * - Session recovery on restart
 * - User-linked sessions
 * - Automatic cleanup of expired sessions
 * 
 * Schema:
 * - sessions: id, user_id, sandbox_id, created_at, last_active, config, status
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('DatabaseSessionStore');

export interface SessionRecord {
  id: string;
  user_id: string;
  sandbox_id: string;
  created_at: string;
  last_active: string;
  config: string;  // JSON stringified
  status: 'active' | 'inactive' | 'expired';
  terminal_output?: string;  // Last terminal output for recovery
}

export interface SessionConfig {
  cols: number;
  rows: number;
  theme: string;
  fontSize: number;
  shell: string;
}

class DatabaseSessionStore {
  private db: Database.Database | null = null;
  private dbPath: string;
  /**
   * Bug #35 (audit) — tracks how many times `initialize()` has been
   * called on this instance. The audit observed 4 inits in 1 hour,
   * which strongly suggested either a hot-reload leak or a lifecycle
   * bug where the previous instance was not closed. The counter is
   * logged at warn level when > 1 so the regression is visible in
   * run.log without a separate metric.
   */
  public initCount: number = 0;

  constructor(dbPath: string = './data/sessions.db') {
    this.dbPath = dbPath;
  }

  /**
   * Initialize database and create tables
   */
  initialize(): void {
    this.initCount++;
    // Bug #35 (audit) — warn on every re-init past the first. If you
    // see this in production logs, either the singleton is being
    // recreated (hot-reload, misconfigured module resolution) or
    // some call site is calling initialize() directly without going
    // through getDatabaseSessionStore(). A typical healthy run logs
    // exactly one "Database session store initialized" line.
    if (this.initCount > 1) {
      logger.warn(`Database session store re-initialized ${this.initCount} times at ${this.dbPath} — possible lifecycle leak`, {
        initCount: this.initCount,
        dbPath: this.dbPath,
      });
    }
    try {
      // Bug #35 (audit) — close any prior connection on this instance
      // before opening a new one. Without this, a re-init leaves the
      // previous better-sqlite3 handle open, leaking file descriptors
      // and risking "database is locked" errors on the old handle.
      if (this.db) {
        try {
          this.db.close();
        } catch (closeErr: any) {
          logger.debug('Prior db close during re-init failed (non-fatal)', { error: closeErr.message });
        }
        this.db = null;
      }
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // NOTE: The sessions table is created via schema.sql.
      // Always ensure indexes exist, as they are essential for performance
      // and may not be fully managed by initial schema migration.
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_sandbox ON sessions(sandbox_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active);
      `);

      logger.info(`Database session store initialized at ${this.dbPath}`, { initCount: this.initCount });
    } catch (error: any) {
      logger.error('Failed to initialize database:', error.message);
      logger.warn('Session persistence disabled - sessions will be in-memory only');
      this.db = null;
    }
  }

  /**
   * Save or update a session
   */
  saveSession(session: SessionRecord): void {
    if (!this.db) {
      logger.debug('Database not available, skipping session save');
      return;
    }

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO sessions (id, user_id, sandbox_id, created_at, last_active, config, status, terminal_output)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        session.id,
        session.user_id,
        session.sandbox_id,
        session.created_at,
        session.last_active,
        session.config,
        session.status,
        session.terminal_output || null
      );

      logger.debug(`Session saved: ${session.id}`);
    } catch (error: any) {
      logger.error('Failed to save session:', error.message);
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionRecord | null {
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
      return stmt.get(sessionId) as SessionRecord | null;
    } catch (error: any) {
      logger.error('Failed to get session:', error.message);
      return null;
    }
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): SessionRecord[] {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM sessions WHERE user_id = ? AND status = ? ORDER BY last_active DESC'
      );
      return stmt.all(userId, 'active') as SessionRecord[];
    } catch (error: any) {
      logger.error('Failed to get user sessions:', error.message);
      return [];
    }
  }

  /**
   * Update session last active timestamp
   */
  touchSession(sessionId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET last_active = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run(sessionId);
    } catch (error: any) {
      logger.error('Failed to touch session:', error.message);
    }
  }

  /**
   * Update session terminal output
   */
  updateTerminalOutput(sessionId: string, output: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET terminal_output = ?, last_active = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run(output, sessionId);
    } catch (error: any) {
      logger.error('Failed to update terminal output:', error.message);
    }
  }

  /**
   * Mark session as expired
   */
  expireSession(sessionId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE sessions 
        SET status = 'expired', last_active = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      stmt.run(sessionId);
      logger.debug(`Session expired: ${sessionId}`);
    } catch (error: any) {
      logger.error('Failed to expire session:', error.message);
    }
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
      stmt.run(sessionId);
      logger.debug(`Session deleted: ${sessionId}`);
    } catch (error: any) {
      logger.error('Failed to delete session:', error.message);
    }
  }

  /**
   * Cleanup expired sessions (older than 24 hours)
   */
  cleanupExpiredSessions(maxAgeHours: number = 24): number {
    if (!this.db) return 0;

    try {
      const stmt = this.db.prepare(`
        DELETE FROM sessions 
        WHERE status = 'expired' 
        OR last_active < datetime('now', ?)
      `);
      
      const result = stmt.run(`-${maxAgeHours} hours`);
      logger.info(`Cleaned up ${result.changes} expired sessions`);
      return result.changes;
    } catch (error: any) {
      logger.error('Failed to cleanup sessions:', error.message);
      return 0;
    }
  }

  /**
   * Recover active sessions on startup
   */
  recoverActiveSessions(): SessionRecord[] {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        `SELECT * FROM sessions 
         WHERE status = 'active' 
         AND last_active > datetime('now', '-1 hours')
         ORDER BY last_active DESC`
      );
      
      const sessions = stmt.all() as SessionRecord[];
      logger.info(`Recovered ${sessions.length} active sessions`);
      
      return sessions;
    } catch (error: any) {
      logger.error('Failed to recover sessions:', error.message);
      return [];
    }
  }

  /**
   * Get session statistics
   */
  getStats(): {
    total: number;
    active: number;
    expired: number;
    byUser: Record<string, number>;
  } {
    if (!this.db) {
      return { total: 0, active: 0, expired: 0, byUser: {} };
    }

    try {
      const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions');
      const activeStmt = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'");
      const expiredStmt = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'expired'");
      const byUserStmt = this.db.prepare('SELECT user_id, COUNT(*) as count FROM sessions GROUP BY user_id');

      return {
        total: (totalStmt.get() as any).count,
        active: (activeStmt.get() as any).count,
        expired: (expiredStmt.get() as any).count,
        byUser: Object.fromEntries(
          (byUserStmt.all() as any[]).map(row => [row.user_id, row.count])
        ),
      };
    } catch (error: any) {
      logger.error('Failed to get stats:', error.message);
      return { total: 0, active: 0, expired: 0, byUser: {} };
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database session store closed');
    }
  }
}

// Singleton instance.
// Bug #35 (audit) — persist the singleton on `globalThis` so a
// hot-reload (Next.js dev server) doesn't construct a fresh
// `DatabaseSessionStore` on every reload. Without this, the
// audit's "4 inits in 1 hour" symptom recurs in development
// because each HMR cycle evaluates the module again and `let
// instance` starts as `null` again. The `__dbSessionStore__`
// symbol also doubles as a re-init tripwire — if the module is
// being re-evaluated, the getter now returns the *same* instance
// the previous module load created, and the re-init warning
// fires if `initialize()` is called again on it.
declare global {
  // eslint-disable-next-line no-var
  var __dbSessionStore__: DatabaseSessionStore | undefined;
}

export function getDatabaseSessionStore(): DatabaseSessionStore {
  if (!globalThis.__dbSessionStore__) {
    globalThis.__dbSessionStore__ = new DatabaseSessionStore();
    globalThis.__dbSessionStore__.initialize();
  }
  return globalThis.__dbSessionStore__;
}

/**
 * Bug #35 (audit) — test helper. Resets the singleton so tests can
 * re-initialize cleanly without leaking DB connections across test
 * files. Not exported in the production API surface.
 */
export function __resetDatabaseSessionStoreForTests(): void {
  if (globalThis.__dbSessionStore__) {
    try {
      globalThis.__dbSessionStore__.close();
    } catch {
      // Best-effort close; ignore errors.
    }
    globalThis.__dbSessionStore__ = undefined;
  }
}

export default DatabaseSessionStore;
