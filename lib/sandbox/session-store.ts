import type { WorkspaceSession } from './types'
import type BetterSqlite3 from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Fallback: in-memory Map (used when better-sqlite3 is unavailable)
// ---------------------------------------------------------------------------
const memSessions = new Map<string, WorkspaceSession>()
const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

// ---------------------------------------------------------------------------
// SQLite setup – graceful degradation if native module is missing
// ---------------------------------------------------------------------------
let useSqlite = false
let db: BetterSqlite3.Database | null = null

// Prepared statements (cached for performance)
let stmtInsert: BetterSqlite3.Statement | null = null
let stmtGet: BetterSqlite3.Statement | null = null
let stmtGetByUser: BetterSqlite3.Statement | null = null
let stmtDelete: BetterSqlite3.Statement | null = null
let stmtAllActive: BetterSqlite3.Statement | null = null
let stmtCleanup: BetterSqlite3.Statement | null = null

try {
  const { default: getDatabase } = require('../database/connection') as { default: () => BetterSqlite3.Database }
  db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_sessions (
      sessionId   TEXT PRIMARY KEY,
      sandboxId   TEXT NOT NULL,
      userId      TEXT NOT NULL,
      ptySessionId TEXT,
      cwd         TEXT NOT NULL,
      createdAt   TEXT NOT NULL,
      lastActive  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'creating'
    )
  `)

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_userId ON sandbox_sessions(userId)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_status ON sandbox_sessions(status)`)

  // Prepare statements
  stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO sandbox_sessions
      (sessionId, sandboxId, userId, ptySessionId, cwd, createdAt, lastActive, status)
    VALUES
      (@sessionId, @sandboxId, @userId, @ptySessionId, @cwd, @createdAt, @lastActive, @status)
  `)

  stmtGet = db.prepare(`
    SELECT * FROM sandbox_sessions
    WHERE sessionId = ? AND lastActive > datetime('now', '-4 hours')
  `)

  stmtGetByUser = db.prepare(`
    SELECT * FROM sandbox_sessions
    WHERE userId = ? AND status = 'active' AND lastActive > datetime('now', '-4 hours')
    LIMIT 1
  `)

  stmtDelete = db.prepare(`DELETE FROM sandbox_sessions WHERE sessionId = ?`)

  stmtAllActive = db.prepare(`
    SELECT * FROM sandbox_sessions
    WHERE status = 'active' AND lastActive > datetime('now', '-4 hours')
  `)

  stmtCleanup = db.prepare(`DELETE FROM sandbox_sessions WHERE lastActive <= datetime('now', '-4 hours')`)

  // Initial cleanup
  stmtCleanup.run()

  useSqlite = true
  console.log('[session-store] Using SQLite for session persistence')
} catch (_err) {
  useSqlite = false
  console.warn('[session-store] better-sqlite3 unavailable – falling back to in-memory store')
}

// ---------------------------------------------------------------------------
// Periodic cleanup (every 30 minutes)
// ---------------------------------------------------------------------------
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000

function runCleanup() {
  if (useSqlite && stmtCleanup) {
    try {
      stmtCleanup.run()
    } catch (_e) {
      // ignore – DB may have been closed
    }
  } else {
    const now = Date.now()
    for (const [id, session] of memSessions) {
      if (now - new Date(session.lastActive).getTime() > SESSION_TTL_MS) {
        memSessions.delete(id)
      }
    }
  }
}

const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS)
cleanupTimer.unref?.()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function saveSession(session: WorkspaceSession): void {
  session.lastActive = new Date().toISOString()

  if (useSqlite && stmtInsert) {
    stmtInsert.run({
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
      userId: session.userId,
      ptySessionId: session.ptySessionId ?? null,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
      status: session.status,
    })
  } else {
    memSessions.set(session.sessionId, session)
  }
}

export function getSession(sessionId: string): WorkspaceSession | undefined {
  if (useSqlite && stmtGet) {
    const row = stmtGet.get(sessionId) as WorkspaceSession | undefined
    return row || undefined
  }

  const session = memSessions.get(sessionId)
  if (!session) return undefined
  if (Date.now() - new Date(session.lastActive).getTime() > SESSION_TTL_MS) {
    memSessions.delete(sessionId)
    return undefined
  }
  return session
}

export function getSessionByUserId(userId: string): WorkspaceSession | undefined {
  if (useSqlite && stmtGetByUser) {
    const row = stmtGetByUser.get(userId) as WorkspaceSession | undefined
    return row || undefined
  }

  for (const session of memSessions.values()) {
    if (session.userId === userId && session.status === 'active') {
      if (Date.now() - new Date(session.lastActive).getTime() <= SESSION_TTL_MS) return session
      memSessions.delete(session.sessionId)
    }
  }
  return undefined
}

export function updateSession(sessionId: string, updates: Partial<WorkspaceSession>): void {
  const now = new Date().toISOString()

  if (useSqlite && db) {
    const setClauses: string[] = ['lastActive = @lastActive']
    const params: Record<string, unknown> = { sessionId, lastActive: now }

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'sessionId') continue // never update PK
      setClauses.push(`${key} = @${key}`)
      params[key] = value ?? null
    }

    db.prepare(
      `UPDATE sandbox_sessions SET ${setClauses.join(', ')} WHERE sessionId = @sessionId`
    ).run(params)
  } else {
    const session = memSessions.get(sessionId)
    if (session) {
      Object.assign(session, updates, { lastActive: now })
    }
  }
}

export function deleteSession(sessionId: string): void {
  if (useSqlite && stmtDelete) {
    stmtDelete.run(sessionId)
  } else {
    memSessions.delete(sessionId)
  }
}

export function getAllActiveSessions(): WorkspaceSession[] {
  if (useSqlite && stmtAllActive) {
    return stmtAllActive.all() as WorkspaceSession[]
  }

  const now = Date.now()
  const active: WorkspaceSession[] = []
  for (const [id, session] of memSessions) {
    if (now - new Date(session.lastActive).getTime() > SESSION_TTL_MS) {
      memSessions.delete(id)
    } else if (session.status === 'active') {
      active.push(session)
    }
  }
  return active
}
