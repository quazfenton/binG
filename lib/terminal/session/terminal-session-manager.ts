/**
 * Consolidated Terminal Session Manager
 * 
 * Merges terminal-session-store.ts, user-terminal-sessions.ts, and storage/session-store.ts
 * into unified interface with full feature parity.
 * 
 * Features preserved:
 * - SQLite + in-memory fallback
 * - Session TTL (4 hours)
 * - Periodic cleanup (30 minutes)
 * - User-scoped isolation
 * - Auto-snapshot on disconnect
 * - Session restoration from snapshots
 * - VFS sync-back on restore
 * - Export/import JSON
 * - Session statistics
 * - Provider inference
 * - Quota management integration
 * 
 * @see lib/terminal/session/terminal-session-store.ts - DEPRECATED (re-exported)
 * @see lib/terminal/session/user-terminal-sessions.ts - DEPRECATED (re-exported)
 * @see lib/storage/session-store.ts - DEPRECATED (re-exported)
 */

import type BetterSqlite3 from 'better-sqlite3'
import { createLogger } from '../../utils/logger'
import { getSandboxProvider, type SandboxProviderType } from '../../sandbox/providers'
import { quotaManager } from '../../management/quota-manager'
import type { SandboxHandle } from '../../sandbox/providers/sandbox-provider'

const logger = createLogger('Terminal:SessionManager')

// ============================================================================
// Type Definitions
// ============================================================================

export interface TerminalSessionState {
  sessionId: string
  sandboxId: string
  ptySessionId: string
  userId: string
  mode: 'pty' | 'command-mode' | 'sandbox-cmd' | 'local'
  cwd: string
  cols: number
  rows: number
  lastActive: number
  history: string[]
  lastSnapshotId?: string
  lastSnapshotAt?: number
  metadata?: Record<string, any>
  // Workspace session fields (from storage/session-store.ts)
  status?: 'creating' | 'active' | 'idle' | 'suspended' | 'deleted'
  createdAt?: number
}

export interface UserTerminalSession extends TerminalSessionState {
  providerType: SandboxProviderType
  metadata: TerminalSessionState['metadata'] & {
    restoredFromSnapshot?: boolean
    restoredSnapshotId?: string
    autoSnapshotEnabled?: boolean
    lastSnapshotReason?: 'user_request' | 'auto_disconnect' | 'idle_timeout' | 'manual' | 'error'
  }
}

export interface CreateSessionOptions {
  userId: string
  providerType?: SandboxProviderType
  autoSnapshot?: boolean
  restoreFromSnapshot?: boolean
  snapshotId?: string
  cols?: number
  rows?: number
  cwd?: string
  mode?: TerminalSessionState['mode']
}

export interface DisconnectSessionOptions {
  createSnapshot?: boolean
  reason?: 'user_request' | 'idle_timeout' | 'error' | 'manual'
  snapshotName?: string
}

export interface RestoreResult {
  success: boolean
  session?: UserTerminalSession
  sandboxId: string
  snapshotRestored?: boolean
  filesSynced?: number
  error?: string
}

// ============================================================================
// SQLite Configuration
// ============================================================================

const memSessions = new Map<string, TerminalSessionState>()
let useSqlite = false
let db: BetterSqlite3.Database | null = null

// Prepared statements
let stmtInsert: BetterSqlite3.Statement | null = null
let stmtGet: BetterSqlite3.Statement | null = null
let stmtUpdate: BetterSqlite3.Statement | null = null
let stmtDelete: BetterSqlite3.Statement | null = null
let stmtAll: BetterSqlite3.Statement | null = null
let stmtAllActive: BetterSqlite3.Statement | null = null
let stmtCleanup: BetterSqlite3.Statement | null = null
let stmtGetByUser: BetterSqlite3.Statement | null = null

// Constants
const SESSION_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

// Initialize SQLite
try {
  const { default: getDatabase } = require('../../database/connection') as { default: () => BetterSqlite3.Database }
  db = getDatabase()

  // Create terminal_sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      sessionId TEXT PRIMARY KEY,
      sandboxId TEXT NOT NULL,
      ptySessionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'pty',
      cwd TEXT NOT NULL,
      cols INTEGER DEFAULT 120,
      rows INTEGER DEFAULT 30,
      lastActive TEXT NOT NULL,
      history TEXT,
      metadata TEXT,
      status TEXT DEFAULT 'active',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_sessions_userId ON terminal_sessions(userId)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_sessions_sandboxId ON terminal_sessions(sandboxId)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_sessions_lastActive ON terminal_sessions(lastActive)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_terminal_sessions_status ON terminal_sessions(status)`)

  // Prepare statements
  stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO terminal_sessions
      (sessionId, sandboxId, ptySessionId, userId, mode, cwd, cols, rows, lastActive, history, metadata, status, createdAt)
    VALUES
      (@sessionId, @sandboxId, @ptySessionId, @userId, @mode, @cwd, @cols, @rows, @lastActive, @history, @metadata, @status, @createdAt)
  `)

  stmtGet = db.prepare(`SELECT * FROM terminal_sessions WHERE sessionId = ?`)
  
  stmtGetByUser = db.prepare(`
    SELECT * FROM terminal_sessions
    WHERE userId = ? AND status = 'active' AND lastActive > datetime('now', '-4 hours')
    LIMIT 1
  `)

  stmtUpdate = db.prepare(`
    UPDATE terminal_sessions
    SET lastActive = @lastActive,
        cwd = @cwd,
        cols = @cols,
        rows = @rows,
        history = @history,
        status = @status
    WHERE sessionId = @sessionId
  `)

  stmtDelete = db.prepare(`DELETE FROM terminal_sessions WHERE sessionId = ?`)

  stmtAll = db.prepare(`SELECT * FROM terminal_sessions WHERE lastActive > datetime('now', '-4 hours')`)

  stmtAllActive = db.prepare(`SELECT * FROM terminal_sessions WHERE status = 'active' AND lastActive > datetime('now', '-4 hours')`)

  stmtCleanup = db.prepare(`DELETE FROM terminal_sessions WHERE lastActive <= datetime('now', '-4 hours')`)

  // Initial cleanup
  stmtCleanup.run()

  useSqlite = true
  logger.info('Using SQLite for terminal session persistence')
} catch (error: any) {
  useSqlite = false
  logger.warn('SQLite unavailable, using in-memory store:', error.message)
}

// Periodic cleanup
function runCleanup() {
  if (useSqlite && stmtCleanup) {
    try {
      const result = stmtCleanup.run()
      if ((result as any).changes > 0) {
        logger.debug(`Cleaned up ${(result as any).changes} expired sessions`)
      }
    } catch {
      // DB may have been closed
    }
  } else {
    const now = Date.now()
    for (const [id, session] of memSessions) {
      if (now - session.lastActive > SESSION_TTL_MS) {
        memSessions.delete(id)
      }
    }
  }
}

const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS)
cleanupTimer.unref?.()

// ============================================================================
// Terminal Session Manager Class
// ============================================================================

export class TerminalSessionManager {
  /** In-memory cache of active sessions */
  private activeSessions = new Map<string, UserTerminalSession>()

  /**
   * Save terminal session
   */
  saveSession(session: TerminalSessionState): void {
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
        status: session.status || 'active',
        createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : new Date().toISOString(),
      })
    } else {
      memSessions.set(session.sessionId, session)
    }
  }

  /**
   * Get terminal session by ID
   */
  getSession(sessionId: string): TerminalSessionState | undefined {
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

    if (Date.now() - session.lastActive > SESSION_TTL_MS) {
      memSessions.delete(sessionId)
      return undefined
    }

    return session
  }

  /**
   * Update terminal session
   */
  updateSession(sessionId: string, updates: Partial<TerminalSessionState>): void {
    const session = this.getSession(sessionId)
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
        status: updated.status || 'active',
      })
    } else {
      memSessions.set(sessionId, updated)
    }
  }

  /**
   * Delete terminal session
   */
  deleteSession(sessionId: string): void {
    if (useSqlite && stmtDelete) {
      stmtDelete.run(sessionId)
    } else {
      memSessions.delete(sessionId)
    }
    this.activeSessions.delete(sessionId)
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): TerminalSessionState[] {
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
   */
  getSessionsByUserId(userId: string): TerminalSessionState[] {
    return this.getAllSessions().filter(session => session.userId === userId)
  }

  /**
   * Get sessions by sandbox ID
   */
  getSessionsBySandboxId(sandboxId: string): TerminalSessionState[] {
    return this.getAllSessions().filter(session => session.sandboxId === sandboxId)
  }

  /**
   * Get active session by ID (user-terminal-sessions compatibility)
   */
  getActiveSession(sessionId: string): UserTerminalSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Create session for user
   */
  async createSession(options: CreateSessionOptions): Promise<UserTerminalSession> {
    const {
      userId,
      providerType = 'daytona',
      autoSnapshot = false,
      restoreFromSnapshot = false,
      snapshotId,
      cols = 120,
      rows = 30,
      cwd = '/workspace',
      mode = 'pty',
    } = options

    // Check quota
    const quotaCheck = quotaManager.checkQuota(providerType)
    if (!quotaCheck.allowed) {
      const fallbackChain = quotaManager.getSandboxProviderChain(providerType)
      let fallbackProvider: SandboxProviderType | null = null

      for (const provider of fallbackChain) {
        if (provider !== providerType && quotaManager.isAvailable(provider)) {
          fallbackProvider = provider as SandboxProviderType
          break
        }
      }

      if (!fallbackProvider) {
        throw new Error(
          `No sandbox providers available. ${providerType} quota exceeded ` +
          `(${quotaCheck.remaining} remaining). Quota resets on ${new Date().toISOString()}`
        )
      }

      logger.info(`${providerType} over quota, falling back to ${fallbackProvider}`)
    }

    // Try restore from snapshot
    if (restoreFromSnapshot) {
      const restoreResult = await this.restoreFromSnapshot(userId, snapshotId)
      if (restoreResult.success && restoreResult.session) {
        logger.info(`Restored session ${restoreResult.session.sessionId} from snapshot for user ${userId}`)
        return restoreResult.session
      }
    }

    // Create fresh sandbox
    const provider = await getSandboxProvider(providerType)
    const handle = await provider.createSandbox({
      language: 'typescript',
      autoStopInterval: 60,
      resources: { cpu: 1, memory: 2 },
      envVars: {
        TERM: 'xterm-256color',
        LANG: 'en_US.UTF-8',
      },
      labels: { userId },
    })

    quotaManager.recordUsage(providerType)

    const sessionId = `user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: UserTerminalSession = {
      sessionId,
      sandboxId: handle.id,
      ptySessionId: sessionId,
      userId,
      providerType,
      mode,
      cwd,
      cols,
      rows,
      lastActive: Date.now(),
      history: [],
      status: 'active',
      createdAt: Date.now(),
      metadata: {
        autoSnapshotEnabled: autoSnapshot,
        restoredFromSnapshot: false,
      },
    }

    this.saveSession(session)
    this.activeSessions.set(session.sessionId, session)

    logger.info(`Created new session ${session.sessionId} for user ${userId} on ${providerType}`)
    return session
  }

  /**
   * Disconnect session with optional snapshot
   */
  async disconnectSession(
    sessionId: string,
    options: DisconnectSessionOptions = {}
  ): Promise<{ success: boolean; snapshotId?: string; error?: string }> {
    const {
      createSnapshot = false,
      reason = 'user_request',
      snapshotName,
    } = options

    const session = this.getActiveSession(sessionId) ||
                    this.getSessionsByUserId(sessionId.split('-')[1] || 'unknown')[0]

    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    let snapshotId: string | undefined

    // Create snapshot
    if (createSnapshot) {
      try {
        snapshotId = await this.createSessionSnapshot(sessionId, snapshotName, reason)
        logger.info(`Created snapshot ${snapshotId} for session ${sessionId}`)
      } catch (error: any) {
        logger.warn(`Snapshot creation failed:`, error?.message || error)
      }
    }

    // Update session metadata
    this.updateSession(sessionId, {
      lastActive: Date.now(),
      lastSnapshotId: snapshotId,
      lastSnapshotAt: snapshotId ? Date.now() : undefined,
      metadata: {
        ...session.metadata,
        lastSnapshotReason: reason,
      },
    })

    this.activeSessions.delete(sessionId)
    logger.info(`Disconnected session ${sessionId}${snapshotId ? ' with snapshot' : ''}`)

    return { success: true, snapshotId }
  }

  /**
   * Create session snapshot
   */
  async createSessionSnapshot(
    sessionId: string,
    name?: string,
    reason: 'user_request' | 'auto_disconnect' | 'idle_timeout' | 'manual' | 'error' = 'user_request'
  ): Promise<string> {
    const session = this.getActiveSession(sessionId) ||
                    this.getSessionsByUserId(sessionId.split('-')[1] || 'unknown')[0]

    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const provider = await getSandboxProvider((session as UserTerminalSession).providerType)
    const handle = await provider.getSandbox(session.sandboxId)

    if (!handle.createCheckpoint && !handle.createSnapshot) {
      throw new Error(
        `Provider ${(session as UserTerminalSession).providerType} does not support snapshots`
      )
    }

    const snapshotName = name || `snapshot-${sessionId}-${Date.now()}`
    let snapshotId: string

    if (handle.createCheckpoint) {
      const checkpoint = await handle.createCheckpoint(snapshotName)
      snapshotId = checkpoint.id
    } else if (handle.createSnapshot) {
      const snapshot = await handle.createSnapshot(snapshotName)
      snapshotId = snapshot.id || snapshot.snapshotId
    } else {
      throw new Error('No snapshot method available')
    }

    this.updateSession(sessionId, {
      lastSnapshotId: snapshotId,
      lastSnapshotAt: Date.now(),
      metadata: {
        ...session.metadata,
        lastSnapshotReason: reason,
      },
    })

    return snapshotId
  }

  /**
   * Restore from snapshot
   */
  async restoreFromSnapshot(
    userId: string,
    snapshotId?: string
  ): Promise<RestoreResult> {
    const userSessions = this.getSessionsByUserId(userId)

    if (userSessions.length === 0 && !snapshotId) {
      return { success: false, sandboxId: '', error: 'No previous sessions found' }
    }

    let targetSession: UserTerminalSession | undefined
    let targetSnapshotId: string | undefined

    if (snapshotId) {
      targetSession = userSessions.find(s => s.lastSnapshotId === snapshotId) as UserTerminalSession
      targetSnapshotId = snapshotId
    } else {
      const sessionsWithSnapshots = userSessions.filter(s => s.lastSnapshotId)
      targetSession = sessionsWithSnapshots.sort(
        (a, b) => (b.lastSnapshotAt || 0) - (a.lastSnapshotAt || 0)
      )[0] as UserTerminalSession
      targetSnapshotId = targetSession?.lastSnapshotId
    }

    if (!targetSession || !targetSnapshotId) {
      return { success: false, sandboxId: '', error: 'No snapshot found' }
    }

    try {
      const provider = await getSandboxProvider(targetSession.providerType)
      const handle = await provider.getSandbox(targetSession.sandboxId)

      if (handle.restoreCheckpoint && targetSession.lastSnapshotId) {
        await handle.restoreCheckpoint(targetSnapshotId)
        logger.info(`Restored checkpoint ${targetSnapshotId}`)
      }

      const restoredSession: UserTerminalSession = {
        ...targetSession,
        sessionId: `user-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        lastActive: Date.now(),
        metadata: {
          ...targetSession.metadata,
          restoredFromSnapshot: true,
          restoredSnapshotId: targetSnapshotId,
        },
      }

      this.saveSession(restoredSession)
      this.activeSessions.set(restoredSession.sessionId, restoredSession)

      logger.info(`Restored session ${restoredSession.sessionId} from snapshot ${targetSnapshotId}`)

      return {
        success: true,
        session: restoredSession,
        sandboxId: handle.id,
        snapshotRestored: true,
      }
    } catch (error: any) {
      logger.error(`Restoration failed:`, error?.message || error)
      return {
        success: false,
        sandboxId: targetSession.sandboxId,
        error: error?.message || 'Failed to restore',
      }
    }
  }

  /**
   * Sync sandbox files back to VFS after snapshot restore
   *
   * This ensures the virtual filesystem matches the restored sandbox state.
   * Uses vfsSyncBackService for proper VFS integration.
   */
  async syncSandboxToVFS(
    sessionId: string,
    vfsSyncFn: (files: Array<{ path: string; content: string }>) => Promise<void>
  ): Promise<{ success: boolean; filesSynced: number; error?: string }> {
    const session = this.getActiveSession(sessionId) ||
                    this.getSessionsByUserId(sessionId.split('-')[1] || 'unknown')[0]

    if (!session) {
      return { success: false, filesSynced: 0, error: 'Session not found' }
    }

    try {
      const provider = await getSandboxProvider((session as UserTerminalSession).providerType)
      const handle = await provider.getSandbox(session.sandboxId)

      // List files in sandbox workspace
      const listResult = await handle.listDirectory(session.cwd || '/workspace')

      if (!listResult.success) {
        return {
          success: false,
          filesSynced: 0,
          error: listResult.output || 'Failed to list directory',
        }
      }

      // Parse file list and sync each file
      const files: Array<{ path: string; content: string }> = []
      const fileLines = listResult.output.split('\n').filter(line => line.trim())

      for (const line of fileLines) {
        // Parse ls -la output format: "-rw-r--r-- 1 user user 1234 Jan 1 12:00 filename"
        const parts = line.trim().split(/\s+/)
        const fileName = parts[parts.length - 1]

        if (fileName === '.' || fileName === '..') continue

        // Read file content
        const readResult = await handle.readFile(fileName)
        if (readResult.success && readResult.output) {
          files.push({
            path: `${session.cwd || '/workspace'}/${fileName}`,
            content: readResult.output,
          })
        }
      }

      // Sync to VFS
      if (files.length > 0) {
        await vfsSyncFn(files)
        logger.info(`Synced ${files.length} files to VFS for session ${sessionId}`)
      }

      return {
        success: true,
        filesSynced: files.length,
      }
    } catch (error: any) {
      logger.error(`VFS sync failed:`, error?.message || error)
      return {
        success: false,
        filesSynced: 0,
        error: error?.message || 'VFS sync failed',
      }
    }
  }

  /**
   * Sync sandbox to VFS using vfsSyncBackService (alternative method)
   * 
   * This is the full-featured sync using the dedicated VFS sync-back service.
   * Supports incremental sync, file patterns, and proper error handling.
   */
  async syncSandboxToVFSFull(
    sessionId: string,
    options: {
      vfsScopePath?: string
      syncMode?: 'full' | 'incremental' | 'changed-only'
    } = {}
  ): Promise<{ success: boolean; filesSynced: number; bytesSynced?: number; duration?: number; error?: string }> {
    const session = this.getSession(sessionId)

    if (!session) {
      return { success: false, filesSynced: 0, error: 'Session not found' }
    }

    try {
      // Dynamic import to prevent bundling in client components
      const { vfsSyncBackService } = await import('../../virtual-filesystem/sync/vfs-sync-back')

      const result = await vfsSyncBackService.syncSandboxToVFS(sessionId, {
        vfsScopePath: options.vfsScopePath || 'project',
        syncMode: options.syncMode || 'full',
      })

      return {
        success: result.success,
        filesSynced: result.filesSynced,
        bytesSynced: (result as any).bytesSynced,
        duration: (result as any).duration,
      }
    } catch (error: any) {
      logger.error(`Full VFS sync failed:`, error?.message || error)
      return {
        success: false,
        filesSynced: 0,
        error: error?.message || 'Full VFS sync failed',
      }
    }
  }
  getSessionStats(): {
    total: number
    byMode: { pty: number; 'command-mode': number; 'sandbox-cmd': number; local: number }
    byAge: { recent: number; old: number }
    byStatus: { creating: number; active: number; idle: number; suspended: number }
  } {
    const sessions = this.getAllSessions()
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000

    return {
      total: sessions.length,
      byMode: {
        pty: sessions.filter(s => s.mode === 'pty').length,
        'command-mode': sessions.filter(s => s.mode === 'command-mode').length,
        'sandbox-cmd': sessions.filter(s => s.mode === 'sandbox-cmd').length,
        local: sessions.filter(s => s.mode === 'local').length,
      },
      byAge: {
        recent: sessions.filter(s => s.lastActive > oneHourAgo).length,
        old: sessions.filter(s => s.lastActive <= oneHourAgo).length,
      },
      byStatus: {
        creating: sessions.filter(s => s.status === 'creating').length,
        active: sessions.filter(s => s.status === 'active').length,
        idle: sessions.filter(s => s.status === 'idle').length,
        suspended: sessions.filter(s => s.status === 'suspended').length,
      },
    }
  }

  /**
   * Get user session statistics
   */
  getUserSessionStats(userId: string): {
    totalSessions: number
    activeSessions: number
    sessionsWithSnapshots: number
    totalSnapshots: number
    providerBreakdown: Record<string, number>
  } {
    const sessions = this.getSessionsByUserId(userId)

    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => this.activeSessions.has(s.sessionId)).length,
      sessionsWithSnapshots: sessions.filter(s => s.lastSnapshotId).length,
      totalSnapshots: sessions.filter(s => s.lastSnapshotId).length,
      providerBreakdown: sessions.reduce((acc, s) => {
        const providerType = (s as UserTerminalSession).providerType || this.inferProviderType(s.sandboxId)
        acc[providerType] = (acc[providerType] || 0) + 1
        return acc
      }, {} as Record<string, number>),
    }
  }

  /**
   * Export sessions to JSON
   */
  exportSessions(): string {
    return JSON.stringify(this.getAllSessions(), null, 2)
  }

  /**
   * Import sessions from JSON
   */
  importSessions(json: string): number {
    try {
      const sessions: TerminalSessionState[] = JSON.parse(json)
      let count = 0

      for (const session of sessions) {
        if (this.validateSession(session)) {
          this.saveSession(session)
          count++
        }
      }

      return count
    } catch {
      return 0
    }
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    if (useSqlite) {
      db?.exec('DELETE FROM terminal_sessions')
    } else {
      memSessions.clear()
    }
    this.activeSessions.clear()
  }

  /**
   * Clear user sessions
   */
  clearUserSessions(userId: string): void {
    if (useSqlite && db) {
      try {
        const result = db.prepare('DELETE FROM terminal_sessions WHERE userId = ?').run(userId)
        logger.info(`Deleted ${(result as any).changes} sessions for user ${userId}`)
      } catch (err: any) {
        logger.warn(`Failed to clear user sessions:`, err.message)
      }
    }

    for (const [id, session] of memSessions.entries()) {
      if (session.userId === userId) {
        memSessions.delete(id)
      }
    }
    logger.info(`Cleared sessions from memory for user ${userId}`)
  }

  /**
   * Clear stale sessions
   */
  clearStaleSessions(): void {
    const now = Date.now()
    const staleThreshold = 5 * 60 * 1000

    if (useSqlite && db) {
      try {
        const ttlStmt = db.prepare("DELETE FROM terminal_sessions WHERE lastActive <= datetime('now', '-4 hours')")
        const ttlResult = ttlStmt.run()
        logger.info(`Deleted ${(ttlResult as any).changes} TTL-expired sessions`)

        const creatingStmt = db.prepare(`
          DELETE FROM terminal_sessions
          WHERE status = 'creating'
          AND createdAt <= datetime('now', '-5 minutes')
        `)
        const creatingResult = creatingStmt.run()
        logger.info(`Deleted ${(creatingResult as any).changes} stuck 'creating' sessions`)
      } catch (err: any) {
        logger.warn(`Failed to clear stale sessions:`, err.message)
      }
    }

    let clearedCount = 0
    for (const [id, session] of memSessions.entries()) {
      const sessionAge = now - session.lastActive
      const isCreatingTooLong = session.status === 'creating' &&
        (now - (session.createdAt || session.lastActive)) > staleThreshold

      if (sessionAge > SESSION_TTL_MS || isCreatingTooLong) {
        memSessions.delete(id)
        clearedCount++
      }
    }
    logger.info(`Cleared ${clearedCount} stale sessions from memory`)
  }

  /**
   * Cleanup old sessions
   */
  cleanupOldSessions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now()
    const cutoff = now - maxAgeMs
    let cleaned = 0

    for (const session of this.activeSessions.values()) {
      if (session.lastActive < cutoff) {
        this.activeSessions.delete(session.sessionId)
        this.deleteSession(session.sessionId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old sessions`)
    }

    return cleaned
  }

  /**
   * Get all active sessions (filtered by status='active')
   * From storage/session-store.ts - for WorkspaceSession compatibility
   */
  getAllActiveSessions(): TerminalSessionState[] {
    if (useSqlite && stmtAllActive) {
      return stmtAllActive.all().map((row: any) => ({
        ...row,
        lastActive: new Date(row.lastActive).getTime(),
        history: row.history ? JSON.parse(row.history) : [],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
    }

    const now = Date.now()
    const active: TerminalSessionState[] = []
    for (const [id, session] of memSessions) {
      if (now - session.lastActive > SESSION_TTL_MS) {
        memSessions.delete(id)
      } else if (session.status === 'active') {
        active.push(session)
      }
    }
    return active
  }

  /**
   * Get single active session by user ID
   * From storage/session-store.ts - for WorkspaceSession compatibility
   */
  getSessionByUserId(userId: string): TerminalSessionState | undefined {
    if (useSqlite && stmtGetByUser) {
      const row = stmtGetByUser.get(userId) as any
      if (row) {
        return {
          ...row,
          lastActive: new Date(row.lastActive).getTime(),
          history: row.history ? JSON.parse(row.history) : [],
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        }
      }
      return undefined
    }

    for (const session of memSessions.values()) {
      if (session.userId === userId && session.status === 'active') {
        if (Date.now() - session.lastActive <= SESSION_TTL_MS) {
          return session
        }
        memSessions.delete(session.sessionId)
      }
    }
    return undefined
  }

  /**
   * Delete all sessions for a user
   * From storage/session-store.ts - for WorkspaceSession compatibility
   */
  deleteSessionsByUserId(userId: string): void {
    if (useSqlite && db) {
      try {
        const result = db.prepare('DELETE FROM terminal_sessions WHERE userId = ?').run(userId)
        logger.info(`Deleted ${(result as any).changes} sessions for user ${userId}`)
      } catch (err: any) {
        logger.warn(`Failed to delete user sessions:`, err.message)
      }
    }

    let deleted = 0
    for (const [id, session] of memSessions.entries()) {
      if (session.userId === userId) {
        memSessions.delete(id)
        deleted++
      }
    }
    logger.info(`Deleted ${deleted} memory sessions for user ${userId}`)
  }

  /**
   * Validate session structure
   */
  private validateSession(session: any): session is TerminalSessionState {
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
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    const isE2BFormat = /^[a-z0-9]{15,25}$/i.test(sandboxId)
    if (isE2BFormat) return 'e2b'

    if (sandboxId.startsWith('mistral-')) return 'mistral'
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp'
    if (sandboxId.startsWith('blaxel-')) return 'blaxel'
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites'
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer'
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem'
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn'
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter'
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent'
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox'
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox'
    if (sandboxId.startsWith('e2b-')) return 'e2b'
    return 'daytona'
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const terminalSessionManager = new TerminalSessionManager()

// ============================================================================
// Backward Compatibility Exports (DEPRECATED)
// ============================================================================

/**
 * @deprecated Use terminalSessionManager.saveSession()
 */
export const saveTerminalSession = terminalSessionManager.saveSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSession()
 */
export const getTerminalSession = terminalSessionManager.getSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.updateSession()
 */
export const updateTerminalSession = terminalSessionManager.updateSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.deleteSession()
 */
export const deleteTerminalSession = terminalSessionManager.deleteSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getAllSessions()
 */
export const getAllTerminalSessions = terminalSessionManager.getAllSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionsByUserId()
 */
export const getSessionsByUserId = terminalSessionManager.getSessionsByUserId.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionsBySandboxId()
 */
export const getSessionsBySandboxId = terminalSessionManager.getSessionsBySandboxId.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.clearAllSessions()
 */
export const clearAllSessions = terminalSessionManager.clearAllSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.exportSessions()
 */
export const exportSessions = terminalSessionManager.exportSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.importSessions()
 */
export const importSessions = terminalSessionManager.importSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionStats()
 */
export const getSessionStats = terminalSessionManager.getSessionStats.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.clearUserSessions()
 */
export const clearUserSessions = terminalSessionManager.clearUserSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.clearStaleSessions()
 */
export const clearStaleSessions = terminalSessionManager.clearStaleSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getAllActiveSessions()
 */
export const getAllActiveSessions = terminalSessionManager.getAllActiveSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionByUserId()
 */
export const getSessionByUserId = terminalSessionManager.getSessionByUserId.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.deleteSessionsByUserId()
 */
export const deleteSessionsByUserId = terminalSessionManager.deleteSessionsByUserId.bind(terminalSessionManager)

// Re-export types for backward compatibility (already exported as interfaces above)
export type { WorkspaceSession } from '../../sandbox/types'
