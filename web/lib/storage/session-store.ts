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

// ---------------------------------------------------------------------------
// Native-binding diagnostics
// ---------------------------------------------------------------------------
// `require('../database/connection-shim')` can throw for several distinct reasons.
// The bare warn line used to swallow every possibility under the same
// `[session-store] better-sqlite3 unavailable` text, leaving operators no way
// to tell apart a CPU-arch mismatch from a missing libc++ from an ESM/CJS
// require mismatch. The classifier below tags each failure mode so the warn
// log states WHY, not just THAT the binding failed.
type SqliteFailureKind =
  | 'arch-mismatch'
  | 'libc-missing'
  | 'abi-mismatch'
  | 'native-not-built'
  | 'module-not-installed'
  | 'cjs-of-esm'
  | 'sqlite-runtime-error'
  | 'interop-mismatch'
  | 'unknown'

export interface SqliteFailure {
  kind: SqliteFailureKind
  reason: string
  hint: string
}

/**
 * Best-effort classification of a failure encountered while requiring or
 * initializing better-sqlite3. Combines `message`, `code`, and `name` into a
 * single haystack so a check on `err.code === 'ERR_REQUIRE_ESM'` does not
 * silently miss the actual message text.
 *
 * Pure function — exported for direct unit testing without needing vi.mock
 * on the better-sqlite3 native module.
 */
export function classifySqliteFailure(err: unknown): SqliteFailure {
  const e = err as { message?: string; code?: string; name?: string } | null
  const haystack =
    `${e?.message ?? ''} ${e?.code ?? ''} ${e?.name ?? ''}`.toLowerCase()

  // SqliteError instances mean the binding loaded but a SQL operation failed
  // (locked DB, permission denied, file-system error, etc.) — distinctly
  // different from a binding-load failure and a different remediation path.
  if (err instanceof Error && err.name === 'SqliteError') {
    return {
      kind: 'sqlite-runtime-error',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 loaded but a SQL operation failed (database locked, missing directory, permission denied, or schema mismatch); check DATABASE_PATH and filesystem permissions',
    }
  }
  if (
    /wrong architecture|incorrect elf|not a valid (win32|mach-o)|invalid target|mach-o .* but.+ is required/.test(
      haystack
    )
  ) {
    return {
      kind: 'arch-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 .node binary was built for a different CPU architecture (x64 vs arm64, macOS vs Linux); run `pnpm rebuild better-sqlite3` to recompile against the current arch',
    }
  }
  if (
    /glibc[_\s]?\d|libstdc\+\+|libc\+\+|libc\.so\.1|cannot open shared object|libgcc_s\.so|libcrypto\.so|libssl\.so/.test(
      haystack
    )
  ) {
    return {
      kind: 'libc-missing',
      reason: e?.message ?? haystack,
      hint:
        'a native shared library (libc++ / libstdc++ / libssl) is missing; on Alpine run `apk add libstdc++`, on Debian/Ubuntu install `libc6` + `libssl3`, then `pnpm rebuild better-sqlite3`',
    }
  }
  if (
    /node_module_version|the module '[^']+' was compiled against a different node|abi version/i.test(
      haystack
    )
  ) {
    return {
      kind: 'abi-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 was compiled against a different Node.js version; run `pnpm rebuild better-sqlite3` to recompile against the current NODE_MODULE_VERSION',
    }
  }
  if (
    /could not locate the bindings|bindings? (file)? .* did not match|the specified module could not be found|enoent/.test(
      haystack
    )
  ) {
    return {
      kind: 'native-not-built',
      reason: e?.message ?? haystack,
      hint:
        'the prebuilt .node binary is missing or invalid for this platform; try `pnpm install --force better-sqlite3` then `pnpm rebuild better-sqlite3`',
    }
  }
  if (/cannot find module 'better-sqlite3'|cannot find package 'better-sqlite3'/.test(haystack)) {
    return {
      kind: 'module-not-installed',
      reason: e?.message ?? haystack,
      hint:
        'better-sqlite3 is not declared as a dependency; add it with `pnpm add better-sqlite3` and rebuild',
    }
  }
  if (/err_require_esm|require\(\) of es module|\berm\b.*esm/.test(haystack)) {
    return {
      kind: 'cjs-of-esm',
      reason: e?.message ?? haystack,
      hint:
        'a CJS require() tried to import an ESM module; replace the require() with a dynamic import() or upgrade better-sqlite3 to a CJS-compatible prebuild',
    }
  }
  // CJS/ESM default-export hoisting mismatch: `module.exports = fn` (default
  // hoisted to module.exports), so `require(...).default` is undefined but
  // `require(...)` IS the callable. Distinguish from generic TypeErrors by
  // requiring TypeError AND a function-callability signal. Match EITHER the
  // runtime message ("is not a function") OR our wrapper's own throw message
  // ("did not export a callable default") — both signal the same CJS/ESM
  // interop issue and should yield the same hint.
  if (
    err instanceof TypeError &&
    (/is not a function/.test(haystack) || /did not export a callable default/.test(haystack)) &&
    /getDatabase|default/i.test(haystack)
  ) {
    return {
      kind: 'interop-mismatch',
      reason: e?.message ?? haystack,
      hint:
        'database/connection-shim module loaded but its default export was not callable through this require() site — CJS/ESM interop hoisted the default to module.exports. Use `conn.default ?? conn` (defensive unwrap) instead of destructuring `const { default } = conn`.',
    }
  }
  return {
    kind: 'unknown',
    reason: e?.message ?? String(err),
    hint:
      'rebuild better-sqlite3 (`pnpm rebuild`) and verify the active Node.js version has a matching prebuild in the better-sqlite3 release matrix',
  }
}

/**
 * Wrap the `require('../database/connection-shim')` call — the line that historically
 * swallowed every failure under a single vague warn message. If the require
 * itself throws (CJS/ESM mismatch, missing module, native binding failure
 * surfacing from connection.ts), classify and warn with structured fields
 * before returning null so the caller can fall back to the in-memory store.
 *
 * Pure Node ESM-safe: uses the same `require(...)` pattern connection.ts uses.
 *
 * BUG FIX (3-shape ladder, hardened against the actual dev-server symptom):
 *   The first version unwrapped `const { default } = conn` — broken on
 *   CJS-hoisted output. The second version unwrapped
 *   `typeof conn === 'function' ? conn : (conn && conn.default)` — broken on
 *   the namespace-flattened output where named exports are preserved but
 *   `default` is dropped. The third shape, seen in production:
 *     typeof conn=object, conn.default=undefined, conn.getDatabase=fn
 *   is the result of Next.js/turbopack flattening `export default getDatabase`
 *   + `export function getDatabase` into just `{ getDatabase: fn, ... }`.
 *
 * Fix: try `typeof conn === 'function'` first (CJS-hoisted), then
 * `conn.default` (ESM-wrapped namespace), then `conn.getDatabase` (named-only
 * flattened). Only throw TypeError when NONE of the three resolve to a callable.
 * Each throw includes "is not a function" + "did not export a callable default"
 * + the literal substring `getDatabase` so classifySqliteFailure's
 * interop-mismatch branch reliably fires.
 */
function tryRequireDatabaseConnection():
  | { getDatabase: () => BetterSqlite3.Database }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn: any = require('../database/connection-shim')
    // 3-shape unwrap delegated to the exported pure helper — single source
    // of truth across session-store, terminal-session-manager, and jwt (×3).
    // The helper returns `undefined` when none of Shape A/B/C matches, so
    // the throw below fires only on genuine interop-mismatch (no callable).
    const getDatabase = unwrapDefaultExport<() => BetterSqlite3.Database>(conn)
    if (typeof getDatabase !== 'function') {
      throw new TypeError(
        // Include both "is not a function" (JavaScript runtime TypeError format)
        // AND "did not export a callable default" (our wrapper vocabulary) so
        // classifySqliteFailure's interop-mismatch branch reliably fires for
        // either phrasing. Without these two substrings, the error falls through
        // unknown and the operator gets the misleading "rebuild better-sqlite3"
        // hint — the very bug this whole patch is fixing.
        `getDatabase is not a function: database/connection-shim did not export a callable default ` +
        `(typeof conn=${typeof conn}, conn.default=${typeof conn?.default}, conn.getDatabase=${typeof conn?.getDatabase}). ` +
        `This is a CJS/ESM interop mismatch, not a better-sqlite3 binding issue.`,
      )
    }
    return { getDatabase }
  } catch (requireErr) {
    useSqlite = false
    log.warn(
      '[session-store] better-sqlite3 binding failed to load – falling back to in-memory store',
      classifySqliteFailure(requireErr),
    )
    return null
  }
}

/**
 * Pure unwrap helper — exported ONLY for direct unit testing of the 3-shape
 * ladder. Production code goes through `tryRequireDatabaseConnection()`
 * which combines this unwrap with the bind-warn + classify pipeline.
 *
 * Shapes handled:
 *   A: any-function        → the fn itself
 *   B: { default: fn }     → conn.default
 *   C: { getDatabase: fn } → conn.getDatabase  (named-only flatten case)
 *
 * Returns undefined when no shape matches (e.g. null/undefined/empty
 * object), so callers can decide whether to throw or fail-open.
 *
 * `export` is necessary so the vitest file can lock down Shape A/B/C
 * regressions without spinning up the full session-store module (which
 * has init side effects like setInterval).
 */
export function unwrapDefaultExport<T = (...args: any[]) => any>(
  mod: unknown,
): T | undefined {
  if (typeof mod === 'function') return mod as T
  if (mod && typeof (mod as any).default === 'function') return (mod as any).default as T
  if (mod && typeof (mod as any).getDatabase === 'function') return (mod as any).getDatabase as T
  return undefined
}

const connection = tryRequireDatabaseConnection()
if (connection) {
  try {
    const { getDatabase } = connection
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
  } catch (initErr) {
    // The require above succeeded but the DB schema setup or
    // `getDatabase()` itself raised. Treat as a binding/runtime failure and
    // surface the same diagnostic taxonomy so the operator isn't told it's
    // "better-sqlite3 unavailable" when in reality it was a permission
    // problem during db.exec.
    useSqlite = false
    log.warn(
      '[session-store] SQLite initialization failed after require – falling back to in-memory store',
      classifySqliteFailure(initErr),
    )
  }
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

  // Bug #35 (Pass-5 audit REGRESSING) — singleton/persistence guard.
  // The prior fix called initCheckpointStorage() unconditionally at module
  // load, which re-ran 4× per hour under Next.js hot-reload. Each re-run
  // re-prepared all 4 SQL statements against the same DB connection,
  // leaking native Statement objects and inflating heap pressure.
  //
  // Fix: persist an "already initialized" flag on `globalThis` so hot-
  // reload module re-evaluation skips the full init path. A per-process
  // counter (`__sessionStoreReinitCount__`) tracks how many redundant
  // init calls were suppressed — operators see `[WARN] Checkpoint storage
  // re-init suppressed (N times)` once N > 0, which is the regression
  // signal the audit asked for. PID check ensures worker restarts
  // (different process) get a fresh init.
  const reinitMarker = (globalThis as unknown as Record<string, { pid: number; at: number; suppressed: number }>).__sessionStoreInitialized__;
  if (reinitMarker && reinitMarker.pid === process.pid) {
    reinitMarker.suppressed += 1;
    if (reinitMarker.suppressed === 1 || reinitMarker.suppressed % 10 === 0) {
      log.warn(
        `[session-store] Checkpoint storage re-init suppressed ` +
        `(${reinitMarker.suppressed} times in this process — likely Next.js hot-reload)`,
      );
    }
    return;
  }

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

    // Use a typed local variable to avoid tsc inferring the globalThis
    // property type from the surrounding module scope (which has
    // `Statement` types from better-sqlite3). The `as unknown as Record<...>`
    // cast on the globalThis side makes the property assignment
    // unambiguous. Mirrors the read-side cast above.
    const initMarker: { pid: number; at: number; suppressed: number } = {
      pid: process.pid,
      at: Date.now(),
      suppressed: 0,
    };
    (globalThis as unknown as Record<string, { pid: number; at: number; suppressed: number }>).__sessionStoreInitialized__ = initMarker;
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
