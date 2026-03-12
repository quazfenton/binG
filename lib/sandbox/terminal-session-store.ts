/**
 * Terminal Session Persistence
 * 
 * Persists terminal session state to database for recovery
 * Supports reconnection after server restart
 * 
 * @see lib/sandbox/session-store.ts - Main session store
 * @see lib/sandbox/terminal-manager.ts - Terminal manager integration
 */

import type BetterSqlite3 from 'better-sqlite3'

export interface TerminalSessionState {
  /** Unique session identifier */
  sessionId: string

  /** Sandbox identifier */
  sandboxId: string

  /** PTY session identifier */
  ptySessionId: string

  /** User identifier */
  userId: string

  /** Terminal mode */
  mode: 'pty' | 'command-mode'

  /** Current working directory */
  cwd: string

  /** Terminal columns */
  cols: number

  /** Terminal rows */
  rows: number

  /** Last activity timestamp */
  lastActive: number

  /** Command history */
  history: string[]

  /** Last snapshot ID (for auto-snapshot service) */
  lastSnapshotId?: string

  /** Additional metadata */
  metadata?: Record<string, any>
}

const memSessions = new Map<string, TerminalSessionState>()
let useSqlite = false
let db: BetterSqlite3.Database | null = null
let stmtInsert: BetterSqlite3.Statement | null = null
let stmtGet: BetterSqlite3.Statement | null = null
let stmtUpdate: BetterSqlite3.Statement | null = null
let stmtDelete: BetterSqlite3.Statement | null = null
let stmtAll: BetterSqlite3.Statement | null = null
let stmtCleanup: BetterSqlite3.Statement | null = null

// Session TTL (4 hours)
const SESSION_TTL_MS = 4 * 60 * 60 * 1000

// Initialize SQLite
try {
  const { default: getDatabase } = require('../database/connection') as { default: () => BetterSqlite3.Database }
  db = getDatabase()
  
  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      sessionId TEXT PRIMARY KEY,
      sandboxId TEXT NOT NULL,
      ptySessionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      mode TEXT NOT NULL,
      cwd TEXT NOT NULL,
      cols INTEGER DEFAULT 120,
      rows INTEGER DEFAULT 30,
      lastActive TEXT NOT NULL,
      history TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  // Create indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_userId 
    ON terminal_sessions(userId)
  `)
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_sandboxId 
    ON terminal_sessions(sandboxId)
  `)
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_lastActive 
    ON terminal_sessions(lastActive)
  `)
  
  // Prepare statements for performance
  stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO terminal_sessions
      (sessionId, sandboxId, ptySessionId, userId, mode, cwd, cols, rows, lastActive, history, metadata)
    VALUES
      (@sessionId, @sandboxId, @ptySessionId, @userId, @mode, @cwd, @cols, @rows, @lastActive, @history, @metadata)
  `)
  
  stmtGet = db.prepare(`SELECT * FROM terminal_sessions WHERE sessionId = ?`)
  
  stmtUpdate = db.prepare(`
    UPDATE terminal_sessions 
    SET lastActive = @lastActive, 
        cwd = @cwd, 
        cols = @cols, 
        rows = @rows, 
        history = @history
    WHERE sessionId = @sessionId
  `)
  
  stmtDelete = db.prepare(`DELETE FROM terminal_sessions WHERE sessionId = ?`)
  
  stmtAll = db.prepare(`
    SELECT * FROM terminal_sessions 
    WHERE lastActive > datetime('now', '-4 hours')
  `)
  
  stmtCleanup = db.prepare(`
    DELETE FROM terminal_sessions 
    WHERE lastActive <= datetime('now', '-4 hours')
  `)
  
  // Initial cleanup of expired sessions
  stmtCleanup.run()
  
  useSqlite = true
  console.log('[terminal-session-store] Using SQLite for terminal session persistence')
} catch (error: any) {
  useSqlite = false
  console.warn('[terminal-session-store] SQLite unavailable, using in-memory store:', error.message)
}

// Periodic cleanup (every 30 minutes)
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000

function runCleanup() {
  if (useSqlite && stmtCleanup) {
    try {
      const result = stmtCleanup.run()
      if ((result as any).changes > 0) {
        console.log(`[terminal-session-store] Cleaned up ${(result as any).changes} expired sessions`)
      }
    } catch (error: any) {
      // DB may have been closed, ignore
    }
  } else {
    // In-memory cleanup
    const now = Date.now()
    for (const [id, session] of memSessions) {
      if (now - session.lastActive > SESSION_TTL_MS) {
        memSessions.delete(id)
      }
    }
  }
}

const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS)
cleanupTimer.unref?.() // Don't prevent process exit

/**
 * Save terminal session to store
 * 
 * @param session - Session state to save
 * 
 * @example
 * ```typescript
 * saveTerminalSession({
 *   sessionId: 'sess_123',
 *   sandboxId: 'sbx_456',
 *   ptySessionId: 'pty_789',
 *   userId: 'user_abc',
 *   mode: 'pty',
 *   cwd: '/workspace',
 *   cols: 120,
 *   rows: 30,
 *   lastActive: Date.now(),
 *   history: ['ls', 'cd project'],
 * })
 * ```
 */
export function saveTerminalSession(session: TerminalSessionState): void {
  session.lastActive = Date.now()
  
  if (useSqlite && stmtInsert) {
    stmtInsert.run({
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
      ptySessionId: session.ptySessionId,
      userId: session.userId,
      mode: session.mode,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      lastActive: new Date(session.lastActive).toISOString(),
      history: JSON.stringify(session.history),
      metadata: session.metadata ? JSON.stringify(session.metadata) : null,
    })
  } else {
    memSessions.set(session.sessionId, session)
  }
}

/**
 * Get terminal session by ID
 * 
 * @param sessionId - Session identifier
 * @returns Session state or undefined if not found/expired
 */
export function getTerminalSession(sessionId: string): TerminalSessionState | undefined {
  if (useSqlite && stmtGet) {
    const row = stmtGet.get(sessionId) as any
    if (!row) return undefined
    
    return {
      ...row,
      lastActive: new Date(row.lastActive).getTime(),
      history: row.history ? JSON.parse(row.history) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }
  
  const session = memSessions.get(sessionId)
  if (!session) return undefined
  
  // Check TTL for in-memory sessions
  if (Date.now() - session.lastActive > SESSION_TTL_MS) {
    memSessions.delete(sessionId)
    return undefined
  }
  
  return session
}

/**
 * Update terminal session
 * 
 * @param sessionId - Session identifier
 * @param updates - Fields to update
 * 
 * @example
 * ```typescript
 * updateTerminalSession('sess_123', {
 *   cwd: '/workspace/new-dir',
 *   history: [...oldHistory, 'new-command'],
 * })
 * ```
 */
export function updateTerminalSession(
  sessionId: string,
  updates: Partial<TerminalSessionState>
): void {
  const session = getTerminalSession(sessionId)
  if (!session) return
  
  const updated = { ...session, ...updates, lastActive: Date.now() }
  
  if (useSqlite && stmtUpdate) {
    stmtUpdate.run({
      sessionId,
      lastActive: new Date(updated.lastActive).toISOString(),
      cwd: updated.cwd,
      cols: updated.cols,
      rows: updated.rows,
      history: JSON.stringify(updated.history),
    })
  } else {
    memSessions.set(sessionId, updated)
  }
}

/**
 * Delete terminal session
 * 
 * @param sessionId - Session identifier
 */
export function deleteTerminalSession(sessionId: string): void {
  if (useSqlite && stmtDelete) {
    stmtDelete.run(sessionId)
  } else {
    memSessions.delete(sessionId)
  }
}

/**
 * Get all active terminal sessions
 * 
 * @returns Array of active sessions
 */
export function getAllTerminalSessions(): TerminalSessionState[] {
  if (useSqlite && stmtAll) {
    return stmtAll.all().map((row: any) => ({
      ...row,
      lastActive: new Date(row.lastActive).getTime(),
      history: row.history ? JSON.parse(row.history) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }))
  }
  
  const now = Date.now()
  const active: TerminalSessionState[] = []
  
  for (const [id, session] of memSessions) {
    if (now - session.lastActive <= SESSION_TTL_MS) {
      active.push(session)
    } else {
      memSessions.delete(id)
    }
  }
  
  return active
}

/**
 * Get sessions by user ID
 * 
 * @param userId - User identifier
 * @returns Array of user's active sessions
 */
export function getSessionsByUserId(userId: string): TerminalSessionState[] {
  const allSessions = getAllTerminalSessions()
  return allSessions.filter(session => session.userId === userId)
}

/**
 * Get sessions by sandbox ID
 * 
 * @param sandboxId - Sandbox identifier
 * @returns Array of sessions for sandbox
 */
export function getSessionsBySandboxId(sandboxId: string): TerminalSessionState[] {
  const allSessions = getAllTerminalSessions()
  return allSessions.filter(session => session.sandboxId === sandboxId)
}

/**
 * Clear all sessions (use with caution)
 */
export function clearAllSessions(): void {
  if (useSqlite) {
    db?.exec('DELETE FROM terminal_sessions')
  } else {
    memSessions.clear()
  }
}

/**
 * Export sessions to JSON
 */
export function exportSessions(): string {
  const sessions = getAllTerminalSessions()
  return JSON.stringify(sessions, null, 2)
}

/**
 * Import sessions from JSON
 * 
 * @param json - JSON string with sessions
 */
export function importSessions(json: string): number {
  try {
    const sessions: TerminalSessionState[] = JSON.parse(json)
    let count = 0
    
    for (const session of sessions) {
      if (validateSession(session)) {
        saveTerminalSession(session)
        count++
      }
    }
    
    return count
  } catch {
    return 0
  }
}

/**
 * Validate session structure
 */
function validateSession(session: any): session is TerminalSessionState {
  return (
    session &&
    typeof session.sessionId === 'string' &&
    typeof session.sandboxId === 'string' &&
    typeof session.ptySessionId === 'string' &&
    typeof session.userId === 'string' &&
    typeof session.mode === 'string' &&
    typeof session.cwd === 'string' &&
    typeof session.cols === 'number' &&
    typeof session.rows === 'number' &&
    typeof session.lastActive === 'number' &&
    Array.isArray(session.history)
  )
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  total: number
  byMode: { pty: number; 'command-mode': number }
  byAge: { recent: number; old: number }
} {
  const sessions = getAllTerminalSessions()
  const now = Date.now()
  const oneHourAgo = now - 60 * 60 * 1000
  
  return {
    total: sessions.length,
    byMode: {
      pty: sessions.filter(s => s.mode === 'pty').length,
      'command-mode': sessions.filter(s => s.mode === 'command-mode').length,
    },
    byAge: {
      recent: sessions.filter(s => s.lastActive > oneHourAgo).length,
      old: sessions.filter(s => s.lastActive <= oneHourAgo).length,
    },
  }
}
