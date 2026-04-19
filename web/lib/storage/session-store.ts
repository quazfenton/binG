import type { WorkspaceSession } from '../sandbox/types'
import type BetterSqlite3 from 'better-sqlite3'
import { createLogger } from '@/lib/utils/logger'
import { compress, decompress, isCompressed } from '@/lib/utils/compression'

const log = createLogger('SessionStore')

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface SessionCheckpoint {
  checkpointId: string
  sessionId: string
  userId: string
  label?: string
  timestamp: number
  state: {
    conversationState: unknown
    sandboxState: unknown
    toolState: unknown
    quotaUsage: unknown
    metadata: unknown
  }
  version: string
}

type StoredSessionCheckpoint = SessionCheckpoint

// Memory checkpoint limits
const MAX_MEMORY_CHECKPOINTS = 100
const CHECKPOINT_TTL_MS = 60 * 60 * 1000 // 1 hour

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

// ============================================================================
// Checkpoint Storage Setup
// ============================================================================

let stmtInsertCheckpoint: BetterSqlite3.Statement | null = null
let stmtGetCheckpoint: BetterSqlite3.Statement | null = null
let stmtGetCheckpointsBySession: BetterSqlite3.Statement | null = null
let stmtDeleteCheckpoint: BetterSqlite3.Statement | null = null

const memCheckpoints = new Map<string, StoredSessionCheckpoint>()

function initCheckpointStorage() {
  if (!useSqlite || !db) return

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_checkpoints (
        checkpointId TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        userId TEXT NOT NULL,
        label TEXT,
        timestamp INTEGER NOT NULL,
        state TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0'
      )
    `)

    db.exec(`CREATE INDEX IF NOT EXISTS idx_checkpoints_sessionId ON session_checkpoints(sessionId)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_checkpoints_timestamp ON session_checkpoints(timestamp)`)

    stmtInsertCheckpoint = db.prepare(`
      INSERT OR REPLACE INTO session_checkpoints
        (checkpointId, sessionId, userId, label, timestamp, state, version)
      VALUES
        (@checkpointId, @sessionId, @userId, @label, @timestamp, @state, @version)
    `)

    stmtGetCheckpoint = db.prepare(`SELECT * FROM session_checkpoints WHERE checkpointId = ?`)

    stmtGetCheckpointsBySession = db.prepare(`
      SELECT * FROM session_checkpoints
      WHERE sessionId = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)

    stmtDeleteCheckpoint = db.prepare(`DELETE FROM session_checkpoints WHERE checkpointId = ?`)

    log.info('[session-store] Checkpoint storage initialized')
  } catch (err) {
    log.warn('[session-store] Failed to init checkpoint storage:', err)
  }
}

initCheckpointStorage()

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
  log.debug(`Saving session: ${session.sessionId} (sandbox: ${session.sandboxId}, user: ${session.userId})`)
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
    log.debug(`Session ${session.sessionId} saved to SQLite`)
  } else {
    memSessions.set(session.sessionId, session)
    log.debug(`Session ${session.sessionId} saved to memory (${memSessions.size} total)`)
  }
}

export function getSession(sessionId: string): WorkspaceSession | undefined {
  log.debug(`Getting session: ${sessionId}`)
  
  if (useSqlite && stmtGet) {
    const row = stmtGet.get(sessionId) as WorkspaceSession | undefined
    if (row) {
      log.debug(`Session ${sessionId} found in SQLite`)
      return row
    }
    log.debug(`Session ${sessionId} not found in SQLite`)
    return undefined
  }

  const session = memSessions.get(sessionId)
  if (!session) {
    log.debug(`Session ${sessionId} not found in memory`)
    return undefined
  }
  if (Date.now() - new Date(session.lastActive).getTime() > SESSION_TTL_MS) {
    log.debug(`Session ${sessionId} expired, removing from memory`)
    memSessions.delete(sessionId)
    return undefined
  }
  log.debug(`Session ${sessionId} found in memory`)
  return session
}

export function getSessionByUserId(userId: string): WorkspaceSession | undefined {
  log.debug(`Getting active session for user: ${userId}`)
  
  if (useSqlite && stmtGetByUser) {
    const row = stmtGetByUser.get(userId) as WorkspaceSession | undefined
    if (row) {
      log.debug(`Active session found for user ${userId}: ${row.sessionId}`)
      return row
    }
    log.debug(`No active session found for user ${userId}`)
    return undefined
  }

  for (const session of memSessions.values()) {
    if (session.userId === userId && session.status === 'active') {
      if (Date.now() - new Date(session.lastActive).getTime() <= SESSION_TTL_MS) {
        log.debug(`Active session found for user ${userId}: ${session.sessionId}`)
        return session
      }
      log.debug(`Session ${session.sessionId} expired, removing`)
      memSessions.delete(session.sessionId)
    }
  }
  log.debug(`No active session found for user ${userId}`)
  return undefined
}

export function updateSession(sessionId: string, updates: Partial<WorkspaceSession>): void {
  const now = new Date().toISOString()
  log.debug(`Updating session ${sessionId}: ${JSON.stringify(updates)}`)

  // Whitelist of allowed column names to prevent SQL injection
  const ALLOWED_COLUMNS = new Set(['sandboxId', 'userId', 'ptySessionId', 'cwd', 'createdAt', 'lastActive', 'status'])

  if (useSqlite && db) {
    const setClauses: string[] = ['lastActive = @lastActive']
    const params: Record<string, unknown> = { sessionId, lastActive: now }

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'sessionId') continue // never update PK
      if (!ALLOWED_COLUMNS.has(key)) {
        log.warn(`Ignoring unknown update key: ${key}`)
        continue
      }
      setClauses.push(`${key} = @${key}`)
      params[key] = value ?? null
    }

    const result = db.prepare(
      `UPDATE sandbox_sessions SET ${setClauses.join(', ')} WHERE sessionId = @sessionId`
    ).run(params)
    log.debug(`Session ${sessionId} updated in SQLite (${result.changes} rows changed)`)
  } else {
    const session = memSessions.get(sessionId)
    if (session) {
      Object.assign(session, updates, { lastActive: now })
      log.debug(`Session ${sessionId} updated in memory`)
    } else {
      log.warn(`Session ${sessionId} not found for update`)
    }
  }
}

export function deleteSession(sessionId: string): void {
  log.debug(`Deleting session: ${sessionId}`)

  if (useSqlite && stmtDelete) {
    const result = stmtDelete.run(sessionId)
    log.debug(`Session ${sessionId} deleted from SQLite (${result.changes} rows affected)`)
  } else {
    memSessions.delete(sessionId)
    log.debug(`Session ${sessionId} deleted from memory`)
  }
}

/**
 * Clear all sessions for a specific user
 * Useful for recovering from sandbox creation failures
 */
export function clearUserSessions(userId: string): void {
  log.info(`Clearing all sessions for user: ${userId}`)
  
  if (useSqlite && db) {
    try {
      const result = db.prepare('DELETE FROM sandbox_sessions WHERE userId = ?').run(userId)
      log.info(`Deleted ${result.changes} sessions from SQLite for user ${userId}`)
    } catch (err: any) {
      log.warn(`Failed to clear user sessions from SQLite: ${err.message}`)
    }
  }
  
  // Clear from memory store
  let clearedCount = 0
  for (const [id, session] of memSessions.entries()) {
    if (session.userId === userId) {
      memSessions.delete(id)
      clearedCount++
    }
  }
  log.info(`Cleared ${clearedCount} sessions from memory for user ${userId}`)
}

/**
 * Clear stale sessions (older than TTL or with 'creating' status for > 5 minutes)
 */
export function clearStaleSessions(): void {
  log.info('Clearing stale sessions')
  const now = Date.now()
  const staleThreshold = 5 * 60 * 1000 // 5 minutes for 'creating' status
  
  if (useSqlite && db) {
    try {
      // Delete sessions older than TTL
      const ttlStmt = db.prepare("DELETE FROM sandbox_sessions WHERE lastActive <= datetime('now', '-4 hours')")
      const ttlResult = ttlStmt.run()
      log.info(`Deleted ${ttlResult.changes} TTL-expired sessions`)
      
      // Delete stuck 'creating' sessions
      const creatingStmt = db.prepare(`
        DELETE FROM sandbox_sessions 
        WHERE status = 'creating' 
        AND createdAt <= datetime('now', '-5 minutes')
      `)
      const creatingResult = creatingStmt.run()
      log.info(`Deleted ${creatingResult.changes} stuck 'creating' sessions`)
    } catch (err: any) {
      log.warn(`Failed to clear stale sessions from SQLite: ${err.message}`)
    }
  }
  
  // Clear from memory store
  let clearedCount = 0
  for (const [id, session] of memSessions.entries()) {
    const sessionAge = now - new Date(session.lastActive).getTime()
    const isCreatingTooLong = session.status === 'creating' && 
      (now - new Date(session.createdAt).getTime()) > staleThreshold
    
    if (sessionAge > SESSION_TTL_MS || isCreatingTooLong) {
      memSessions.delete(id)
      clearedCount++
    }
  }
  log.info(`Cleared ${clearedCount} stale sessions from memory`)
}

/**
 * Delete all sessions for a user (e.g., on logout)
 */
export function deleteSessionsByUserId(userId: string): void {
  log.debug(`Deleting all sessions for user: ${userId}`)
  
  if (useSqlite && db) {
    const result = db.prepare('DELETE FROM sandbox_sessions WHERE userId = ?').run(userId)
    log.debug(`Deleted ${result.changes} sessions for user ${userId}`)
  } else {
    let deleted = 0
    for (const [id, session] of memSessions.entries()) {
      if (session.userId === userId) {
        memSessions.delete(id)
        deleted++
      }
    }
    log.debug(`Deleted ${deleted} memory sessions for user ${userId}`)
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

// ============================================================================
// Checkpoint Storage API
// ============================================================================

const CHECKPOINT_VERSION = '1.0'
const MAX_CHECKPOINTS_PER_SESSION = 10

export function saveCheckpoint(checkpoint: SessionCheckpoint): void {
  checkpoint.version = CHECKPOINT_VERSION

  if (useSqlite && stmtInsertCheckpoint) {
    try {
      const stateJson = JSON.stringify(checkpoint.state)
      const compressedState = compress(stateJson)

      stmtInsertCheckpoint.run({
        checkpointId: checkpoint.checkpointId,
        sessionId: checkpoint.sessionId,
        userId: checkpoint.userId,
        label: checkpoint.label ?? null,
        timestamp: checkpoint.timestamp,
        state: compressedState,
        version: checkpoint.version,
      })
      log.debug(`Checkpoint ${checkpoint.checkpointId} saved to SQLite (compressed: ${compressedState.length < stateJson.length})`)

      cleanupOldCheckpoints(checkpoint.sessionId)
    } catch (err) {
      log.error(`Failed to save checkpoint ${checkpoint.checkpointId}:`, err)
      throw err
    }
  } else {
    // Memory store: enforce limits
    enforceMemoryCheckpointLimits()
    memCheckpoints.set(checkpoint.checkpointId, { ...checkpoint })
    log.debug(`Checkpoint ${checkpoint.checkpointId} saved to memory (${memCheckpoints.size} total)`)
  }
}

export function getCheckpoint(checkpointId: string): SessionCheckpoint | undefined {
  if (useSqlite && stmtGetCheckpoint) {
    const row = stmtGetCheckpoint.get(checkpointId) as any
    if (row) {
      const stateBuffer = Buffer.isBuffer(row.state) ? row.state : Buffer.from(row.state)
      const decompressed = isCompressed(stateBuffer) ? decompress(stateBuffer) : stateBuffer
      return {
        ...row,
        state: JSON.parse(decompressed.toString('utf-8')),
      }
    }
    return undefined
  }

  const checkpoint = memCheckpoints.get(checkpointId)
  return checkpoint
}

export function getCheckpointsBySession(sessionId: string, limit = 10): SessionCheckpoint[] {
  if (useSqlite && stmtGetCheckpointsBySession) {
    const rows = stmtGetCheckpointsBySession.all(sessionId, limit) as any[]
    return rows.map(row => {
      const stateBuffer = Buffer.isBuffer(row.state) ? row.state : Buffer.from(row.state)
      const decompressed = isCompressed(stateBuffer) ? decompress(stateBuffer) : stateBuffer
      return {
        ...row,
        state: JSON.parse(decompressed.toString('utf-8')),
      }
    })
  }

  const checkpoints: SessionCheckpoint[] = []
  for (const cp of memCheckpoints.values()) {
    if (cp.sessionId === sessionId) {
      checkpoints.push(cp)
    }
  }
  return checkpoints
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
}

export function deleteCheckpoint(checkpointId: string): void {
  if (useSqlite && stmtDeleteCheckpoint) {
    stmtDeleteCheckpoint.run(checkpointId)
    log.debug(`Checkpoint ${checkpointId} deleted from SQLite`)
  } else {
    memCheckpoints.delete(checkpointId)
    log.debug(`Checkpoint ${checkpointId} deleted from memory`)
  }
}

async function cleanupOldCheckpoints(sessionId: string): Promise<void> {
  if (!useSqlite || !db) return

  const checkpoints = await getCheckpointsBySession(sessionId, MAX_CHECKPOINTS_PER_SESSION + 1)
  if (checkpoints.length <= MAX_CHECKPOINTS_PER_SESSION) return

  const toDelete = checkpoints.slice(MAX_CHECKPOINTS_PER_SESSION)
  for (const cp of toDelete) {
    deleteCheckpoint(cp.checkpointId)
  }
  log.debug(`Cleaned up ${toDelete.length} old checkpoints for session ${sessionId}`)
}

function enforceMemoryCheckpointLimits(): void {
  if (memCheckpoints.size >= MAX_MEMORY_CHECKPOINTS) {
    // Remove oldest checkpoints
    const sorted = Array.from(memCheckpoints.values())
      .sort((a, b) => a.timestamp - b.timestamp)
    const toRemove = Math.ceil(MAX_MEMORY_CHECKPOINTS * 0.2) // Remove 20%
    for (let i = 0; i < toRemove; i++) {
      memCheckpoints.delete(sorted[i].checkpointId)
    }
    log.debug(`Memory checkpoint limit reached, removed ${toRemove} oldest`)
  }

  // Also remove expired checkpoints
  const now = Date.now()
  for (const [id, cp] of memCheckpoints) {
    if (now - cp.timestamp > CHECKPOINT_TTL_MS) {
      memCheckpoints.delete(id)
      log.debug(`Checkpoint ${id} expired`)
    }
  }
}

export function getLatestCheckpoint(sessionId: string): SessionCheckpoint | undefined {
  const checkpoints = getCheckpointsBySession(sessionId, 1)
  return checkpoints[0]
}
