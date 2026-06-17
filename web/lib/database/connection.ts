// Database configuration - lazy initialized to avoid Edge Runtime issues
// All Node.js modules are lazy-loaded inside functions, not at module load time
// This file is server-only - do not import in Client Components
import { createLogger } from '@/lib/utils/logger';
// Pass-7 #107: tag schema-drift logs with the canonical `drift` detection
// term so the meta-monitor can grep on a single token. The schema on disk
// has drifted past the schema.sql in code (the underlying cause) which
// is the same family of detection as SKILL.md mtime drift.
import { DETECTION_TERMS, withDetectionTerms } from '@/lib/virtual-filesystem/session-path-guard';

const logger = createLogger('Database:Connection');

// Top-level await with string concatenation prevents Turbopack from statically
// tracing `node:module` into client bundles. At runtime in Node.js ESM the
// dynamic import resolves to the real built-in module.
const { createRequire } = await import('node' + ':module');
const require = createRequire(import.meta.url);
export const runtime = 'nodejs';

// Cached schema SQL — read once from schema.sql at runtime to prevent drift between
// the .sql file and any inline constant. Returns empty string during build/Edge.
let _cachedSchemaSql: string | null = null;

/**
 * Load the database schema from schema.sql at runtime.
 *
 * Single source of truth — the schema lives in web/lib/database/schema.sql.
 * This function reads it once and caches the result, so both the init path
 * and the migration path get the exact same SQL without duplication.
 *
 * Returns empty string during build/Edge where fs access is unavailable,
 * allowing the database to initialize via mock fallbacks.
 */
function getSchemaSql(): string {
  if (_cachedSchemaSql !== null) {
    return _cachedSchemaSql;
  }

  // Guard: skip fs access during build or in Edge Runtime
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    _cachedSchemaSql = '';
    return _cachedSchemaSql;
  }

  // Guard: skip if require/fs are unavailable (shouldn't happen in Node.js, but be safe)
  if (typeof require === 'undefined' || typeof process === 'undefined') {
    _cachedSchemaSql = '';
    return _cachedSchemaSql;
  }

  let schemaPath: string | null = null;
  try {
    // Use the shared multi-strategy path resolver from the schema loader.
    // Delegates to resolveSqlPath() which tries cwd + __dirname walk-up.
    const { resolveSqlPath } = require('./schema/loader');
    const { readFileSync } = require('fs');

    schemaPath = resolveSqlPath(['lib', 'database', 'schema.sql']);

    if (schemaPath) {
      _cachedSchemaSql = readFileSync(schemaPath, 'utf8');
      return _cachedSchemaSql;
    }

    logger.warn(`[DB] schema.sql not found (tried cwd + __dirname walk-up)`);
    _cachedSchemaSql = '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // During build, missing schema.sql is non-fatal (db init is mocked anyway).
    // At runtime this is a real error — warn but don't throw so the caller can
    // decide how to handle a missing schema.
    logger.error(`[DB] Could not read schema.sql (path: ${schemaPath ?? 'unresolved'}): ${msg}`);
    _cachedSchemaSql = '';
  }

  return _cachedSchemaSql;
}

// Check if we're in a build/Edge environment where database initialization should be skipped
function shouldSkipDbInit(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = typeof process !== 'undefined' ? (process as any).env : {};
  return env.SKIP_DB_INIT === 'true' ||
         env.SKIP_DB_INIT === '1' ||
         env.NEXT_BUILD === 'true' ||
         env.NEXT_BUILD === '1' ||
         env.NEXT_PHASE === 'build' ||
         env.NEXT_PHASE === 'export' ||
         env.NEXT_PHASE === 'phase-production-build' ||
         env.NEXT_PHASE === 'phase-export';
}

// Check if we're in Edge Runtime (no Node.js)
function isEdgeRuntime(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof (process as any)?.versions?.node === 'undefined';
}

// Database path - computed synchronously at runtime
function getDBPath(): string {
  // Use require at runtime (safe in server code)
  // Guard with typeof check so webpack doesn't try to bundle this for client
  if (typeof process === 'undefined' || typeof require === 'undefined') {
    return './data/binG.db';
  }
  const path = require('path');

  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }

  // Desktop mode: use user's app data directory
  if (process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true') {
    try {
      const { getDesktopDBPath } = require('./desktop-database');
      return getDesktopDBPath();
    } catch {
      // Fallback to default if desktop-database not available
    }
  }

  // Only call process.cwd() in Node.js runtime (not Edge)
  let cwd: string | undefined;
  if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
    cwd = process.cwd?.();
  }

  return cwd ? path.join(cwd, 'data', 'binG.db') : './data/binG.db';
}

// Encryption key - MUST be set via environment variable in production
// Lazy-loaded to avoid Edge Runtime and build-time errors
let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  // Guard with runtime check so webpack doesn't bundle for client
  if (typeof require === 'undefined') {
    return Buffer.alloc(32, 'dummy-key-for-build');
  }
  const crypto = require('crypto');

  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

  // Skip validation during build/Edge
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    // Return a dummy key for build/Edge - actual key loaded at runtime
    logger.warn('[DB] Skipping ENCRYPTION_KEY validation during build/Edge');
    return Buffer.alloc(32, 'dummy-key-for-build');
  }

  if (!ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === 'production') {
      // Don't throw during build - use dummy key
      if (shouldSkipDbInit()) {
        logger.warn('[DB] ENCRYPTION_KEY not set - using dummy key for build');
        return Buffer.alloc(32, 'dummy-key-for-build');
      }
      throw new Error('ENCRYPTION_KEY must be set in production for data security');
    }
    // In development, generate random key per session (not persistent)
    logger.warn('⚠️  WARNING: ENCRYPTION_KEY not set! Using random dev key.');
    logger.warn('API keys will NOT persist across restarts in development.');
    logger.warn('Set ENCRYPTION_KEY environment variable to a secure 32+ character random string.');
    return crypto.randomBytes(32);
  }

  // Validate key strength
  if (!ENCRYPTION_KEY || typeof ENCRYPTION_KEY !== 'string') {
    logger.warn('[DB] ENCRYPTION_KEY is missing or invalid, using fallback');
    return crypto.randomBytes(32);
  }

  if (ENCRYPTION_KEY.length < 16) {
    throw new Error('ENCRYPTION_KEY must be at least 16 characters for secure encryption');
  }

  // Pad or truncate to exactly 32 bytes for AES-256
  encryptionKey = Buffer.from(String(ENCRYPTION_KEY).padEnd(32, '0').slice(0, 32));
  return encryptionKey;
}

/**
 * Create a mock database object for use during build or while migrations are pending.
 * 
 * The mock now includes the full schema to match the real database structure,
 * allowing tests to run without a real database connection.
 */
// Singleton mock — always the same instance so identity checks work
let _mockDatabase: any = null;

// Export function to reset mock database (useful for tests)
export function resetMockDatabase(): void {
  _mockDatabase = null;
}

// In-memory schema for mock database (split into individual CREATE statements for reliable parsing)
const MOCK_SCHEMA = `CREATE TABLE IF NOT EXISTS vfs_workspace_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT UNIQUE NOT NULL, version INTEGER DEFAULT 1, root TEXT NOT NULL DEFAULT '/', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed_at TEXT); CREATE TABLE IF NOT EXISTS vfs_workspace_files (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, path TEXT NOT NULL, content TEXT, blob_hash TEXT, is_compressed INTEGER DEFAULT 0, language TEXT DEFAULT '', size INTEGER DEFAULT 0, version INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(owner_id, path)); CREATE TABLE IF NOT EXISTS file_content_blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, compressed_size INTEGER, ref_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_accessed_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT, password_hash TEXT, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, email_verified INTEGER DEFAULT 0, email_verification_token_hash TEXT, email_verification_expires TEXT, subscription_tier TEXT DEFAULT 'free', token_version INTEGER DEFAULT 1); CREATE TABLE IF NOT EXISTS user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS api_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, api_key_hash TEXT, is_active INTEGER DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, UNIQUE(user_id, provider)); CREATE TABLE IF NOT EXISTS external_connections (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL, access_token_encrypted TEXT NOT NULL, refresh_token_encrypted TEXT, token_expires_at TEXT, is_active INTEGER DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, UNIQUE(user_id, provider)); CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, is_archived INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT, model TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT NOT NULL, preference_key TEXT NOT NULL, preference_value TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, preference_key), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, tokens_used INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL); CREATE TABLE IF NOT EXISTS oauth_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, provider TEXT NOT NULL, redirect_uri TEXT, state TEXT, expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS service_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, service TEXT NOT NULL, permission TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, UNIQUE(user_id, service, permission)); CREATE TABLE IF NOT EXISTS token_refresh_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, provider TEXT NOT NULL, success INTEGER DEFAULT 0, error_message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT UNIQUE NOT NULL, user_id TEXT, workspace_path TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT); CREATE TABLE IF NOT EXISTS shadow_commits (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, content TEXT, commit_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_name TEXT UNIQUE NOT NULL, enabled INTEGER DEFAULT 1, config TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS email_provider_quotas (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, daily_limit INTEGER DEFAULT 100, used_today INTEGER DEFAULT 0, reset_date TEXT, UNIQUE(provider)); CREATE TABLE IF NOT EXISTS fs_edit_transactions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, conversation_id TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, operations_json TEXT, errors_json TEXT, denied_reason TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS fs_edit_denials (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id TEXT NOT NULL, conversation_id TEXT NOT NULL, reason TEXT NOT NULL, paths_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chat_request_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, message_count INTEGER NOT NULL, request_size INTEGER NOT NULL, response_size INTEGER, token_usage_prompt INTEGER, token_usage_completion INTEGER, token_usage_total INTEGER, latency_ms INTEGER, streaming BOOLEAN NOT NULL DEFAULT 0, success BOOLEAN NOT NULL DEFAULT 0, error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, metadata TEXT); CREATE TABLE IF NOT EXISTS tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, provider TEXT NOT NULL, tool_name TEXT NOT NULL, success INTEGER NOT NULL, error TEXT, timestamp INTEGER NOT NULL, conversation_id TEXT, tool_call_id TEXT); CREATE TABLE IF NOT EXISTS hitl_audit_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, approved BOOLEAN NOT NULL, feedback TEXT, modified_value TEXT, response_time_ms INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, metadata TEXT); CREATE TABLE IF NOT EXISTS workspace_snapshots (workspace_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_provider TEXT NOT NULL, source_sandbox_id TEXT NOT NULL, workspace_dir TEXT NOT NULL, created_at INTEGER NOT NULL, checkpoint_id TEXT, vfs_version INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0, lock_files_json TEXT NOT NULL DEFAULT '{}', estimated_cache_bytes INTEGER, env_vars_json TEXT, expires_at INTEGER NOT NULL);`;

function getMockDatabase() {
  if (!_mockDatabase) {
    _mockDatabase = (() => {
      // In-memory data storage for mock
      const tables: Record<string, any[]> = {
        // VFS tables (from migration 013)
        vfs_workspace_meta: [],
        vfs_workspace_files: [],
        // Core tables
        users: [],
        user_sessions: [],
        api_credentials: [],
        external_connections: [],
        conversations: [],
        messages: [],
        user_preferences: [],
        usage_logs: [],
        oauth_sessions: [],
        service_permissions: [],
        token_refresh_logs: [],
        sessions: [],
        shadow_commits: [],
        skills: [],
        email_provider_quotas: [],
        // Logging tables (for chat-request-logger tests)
        chat_request_logs: [],
        tool_calls: [],
        hitl_audit_logs: [],
        // Workspace snapshot tables (from migration 025)
        workspace_snapshots: [],
        // Replay & graph tables (from migrations 021, 023) —
        // loaded by execSchemaFile for real DB, but MockDB needs them
        // explicitly to avoid [MockDB] Table does not exist warnings.
        workspace_replay_events: [],
        workspace_session_graph: [],
      };

      // Initialize tables from schema immediately
      const initTablesFromSchema = (schemaSql: string) => {
        // Split by semicolons and process each statement
        const statements = schemaSql.split(';');
        for (const stmt of statements) {
          const trimmed = stmt.trim();
          if (trimmed.startsWith('CREATE TABLE')) {
            const tableMatch = trimmed.match(/CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i);
            if (tableMatch) {
              const tableName = tableMatch[1].toLowerCase();
              if (!tables[tableName]) {
                tables[tableName] = [];
              }
            }
          }
        }
      };

      // Initialize VFS tables and all other tables immediately (before exec)
      initTablesFromSchema(MOCK_SCHEMA);

      /**
       * Parse a single SET pair like "col1 = ?" or "col2 = CURRENT_TIMESTAMP" or "col3 = 0"
       * Returns { col, value } where value is one of:
       *   - '__SQL_PARAM__' for ? (will be filled from params)
       *   - '__CURRENT_TIMESTAMP__' for CURRENT_TIMESTAMP / datetime('now') / strftime(...)
       *   - '__EXPR__' for complex expressions like REPLACE(path, ...)
       *   - the literal value for simple literals (numbers, strings)
       */
      // Attach raw SQL value to the result so the caller (UPDATE handler) can inspect it.
      /**
 * Find the position of the top-level WHERE keyword in a SQL statement by scanning
 * right-to-left and tracking parenthesis depth. This avoids matching WHERE inside
 * function calls like COALESCE(... WHERE ...) or json_patch(...).
 *
 * @param sql - The full SQL statement
 * @returns The index AFTER the WHERE keyword (realWhereStart), or -1 if not found
 */
function findTopLevelWherePos(sql: string): number {
  let depth = 0;
  for (let i = sql.length - 1; i >= 0; i--) {
    const ch = sql[i];
    if (ch === ')') depth++;
    else if (ch === '(') depth--;
    else if (depth === 0 && sql.substring(i, i + 5).toUpperCase() === 'WHERE') {
      return i + 5;
    }
  }
  return -1;
}

function parseSetPair(pair: string): { col: string; value: any; rawValue?: string } {
        const eqIdx = pair.indexOf('=');
        if (eqIdx < 0) return { col: pair.trim(), value: null };
        const col = pair.slice(0, eqIdx).trim();
        const valRaw = pair.slice(eqIdx + 1).trim();

        // Count all ? placeholders in the value — handles simple ? and function calls
        // like COALESCE(?, x), json(?), json_patch(a, json(?)), REPLACE(?, ...) etc.
        const placeholderCount = (valRaw.match(/\?/g) || []).length;
        if (placeholderCount > 0) {
          // Return special marker so the caller counts all placeholders correctly
          // value = placeholderCount lets caller do setPlaceholderCount += count
          return { col, value: '__SQL_PARAM__', rawValue: valRaw };
        }
        // CURRENT_TIMESTAMP, datetime('now'), strftime('%s', 'now') — all produce current time
        if (/^CURRENT_TIMESTAMP$/i.test(valRaw) || /^datetime\s*\(/i.test(valRaw) || /^strftime\s*\(/i.test(valRaw)) {
          return { col, value: '__CURRENT_TIMESTAMP__' };
        }
        // TRUE / FALSE
        if (/^TRUE$/i.test(valRaw)) return { col, value: 1 };
        if (/^FALSE$/i.test(valRaw)) return { col, value: 0 };
        // Numeric literal
        if (/^-?\d+(\.\d+)?$/.test(valRaw)) return { col, value: parseFloat(valRaw) };
        // String literal (single-quoted), handles SQL escaped quotes: 'it''s' → it's
        // Uses precise pattern (?:[^']|'')* that correctly handles escaped quotes
        // without over-matching on comma-separated strings like 'val1', 'val2'
        if (/^('(?:[^']|'')*')$/.test(valRaw)) {
          const inner = valRaw.slice(1, -1).replace(/''/g, "'");
          return { col, value: inner };
        }
        // Anything else is a complex expression (function call, REPLACE, etc.)
        return { col, value: '__EXPR__' };
      }

      const mockDb: any = {
        // Store tables for reference and diagnostics
        _tables: tables,

        prepare: (sql: string) => {
          // Parse SQL to determine operation type
          const upperSql = sql.toUpperCase().trim();
          const isInsert = upperSql.startsWith('INSERT');
          const isUpdate = upperSql.startsWith('UPDATE');
          const isDelete = upperSql.startsWith('DELETE');

          // Extract table name from SQL - handle various SQL patterns
          let tableName = '';
          // Match INTO table_name or INSERT INTO table_name
          const intoMatch = sql.match(/INTO\s+`?(\w+)`?/i) || sql.match(/INSERT\s+INTO\s+`?(\w+)`?/i);
          if (intoMatch) tableName = intoMatch[1];
          // Match FROM table_name
          else if (upperSql.includes('FROM')) {
            const fromMatch = sql.match(/FROM\s+`?(\w+)`?/i);
            if (fromMatch) tableName = fromMatch[1];
          }
          // Match UPDATE table_name
          else if (upperSql.includes('UPDATE')) {
            const updateMatch = sql.match(/UPDATE\s+`?(\w+)`?/i);
            if (updateMatch) tableName = updateMatch[1];
          }
          // Match DELETE FROM table_name
          else if (upperSql.includes('DELETE')) {
            const deleteMatch = sql.match(/DELETE\s+FROM\s+`?(\w+)`?/i);
            if (deleteMatch) tableName = deleteMatch[1];
          }

          // Normalize table name - ensure it's lowercase and check if it exists
          const normalizedTable = tableName.toLowerCase();
          // First try exact match, then try without trailing 's'
          const actualTable = tables[normalizedTable] 
            ? normalizedTable 
            : tables[normalizedTable.replace(/s$/, '')] 
              ? normalizedTable.replace(/s$/, '')
              : normalizedTable;

          const stmt = {
            run: (...params: any[]) => {
              if (!tables[actualTable]) {
                logger.debug(`[MockDB] Table '${actualTable}' does not exist in mock`);
                return { lastInsertRowid: 1, changes: 0 };
              }

              if (isInsert) {
                // Create a mock row based on INSERT
                const mockRow: any = {};
                // Extract column names from SQL (simplified)
                const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
                if (colMatch) {
                  const cols = colMatch[1].split(',').map((c: string) => c.trim());
                  cols.forEach((col: string, idx: number) => {
                    const colName = col.split('.').pop()?.trim();
                    // Convert undefined to null for proper SQL NULL semantics.
                    // This matters for COALESCE(?, col) — undefined params should behave
                    // like SQL NULL, falling back to the existing column value.
                    const val = params[idx];
                    mockRow[colName] = val === undefined ? null : (val ?? null);
                  });
                }
                
                // Auto-generate id if not provided
                if (!mockRow.id && actualTable.includes('fs_edit')) {
                  mockRow.id = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                }
                
                tables[actualTable].push(mockRow);
                return { lastInsertRowid: tables[actualTable].length, changes: 1 };
              }

              // Handle UPDATE statements
              if (isUpdate) {                  // Parse SET clause — extract all column=value pairs
                  // Handles: SET col1 = ?, col2 = CURRENT_TIMESTAMP, col3 = datetime('now'), col4 = 0
                  const setClauseMatch = sql.match(/SET\s+([\s\S]+?)(?:\s+WHERE\s+|$)/i);
                if (setClauseMatch) {
                  const setClause = setClauseMatch[1];
                  // Split by comma, but be careful of function calls like COALESCE(a, b), datetime('now'), etc.
                  // Strategy: split on commas that are at depth 0 AND NOT directly after a '(' (i.e., not
                  // commas that are function-argument separators). A comma at depth 0 that follows a '('
                  // means we're inside a function call — keep going.
                  // Split SET clause into (column, value) pairs, respecting parenthesis nesting
                  // and not splitting commas that are function-argument separators (comma followed by ')').
                  const setPairs: Array<{ col: string; value: any }> = [];
                  let depth = 0;
                  let segmentStart = 0;
                  let idx = 0;
                  while (idx < setClause.length) {
                    const ch = setClause[idx];
                    if (ch === '(') {
                      depth++;
                      idx++;
                    } else if (ch === ')') {
                      depth--;
                      idx++;
                    } else if (ch === ',' && depth === 0) {
                      // Skip commas that are function-argument separators: look ahead to the
                      // next non-space character. If it's ')', this comma is inside a function
                      // call (e.g., COALESCE(?, x) or json_patch(a, b) or COALESCE(a, '{}')).
                      let aheadIdx = idx + 1;
                      while (aheadIdx < setClause.length && setClause[aheadIdx] === ' ') aheadIdx++;
                      const nextChar = setClause[aheadIdx];
                      if (nextChar === ')') {
                        idx++;
                        continue;
                      }
                      setPairs.push(parseSetPair(setClause.slice(segmentStart, idx).trim()));
                      segmentStart = idx + 1;
                      idx++;
                    } else {
                      idx++;
                    }
                  }
                  // Don't forget the last segment
                  if (segmentStart < setClause.length) {
                    setPairs.push(parseSetPair(setClause.slice(segmentStart).trim()));
                  }

                  // Count ? placeholders in SET clause — needed to know WHERE param indices.
                  // Scan the raw setClause string and count '?' at depth 0, skipping string literals.
                  let setPlaceholderCount = 0;
                  let scanDepth = 0;
                  let inString = false;
                  for (let scanIdx = 0; scanIdx < setClause.length; scanIdx++) {
                    const sc = setClause[scanIdx];
                    if (inString) {
                      // Track string end: next unescaped single quote ends the string
                      if (sc === "'") {
                        // Check if it's escaped (previous char is \)
                        const prev = setClause[scanIdx - 1];
                        if (prev !== '\\') {
                          inString = false;
                        }
                      }
                      continue;
                    }
                    if (sc === "'") {
                      inString = true;
                    } else if (sc === '(') {
                      scanDepth++;
                    } else if (sc === ')') {
                      scanDepth--;
                    } else if (sc === '?' && scanDepth === 0) {
                      setPlaceholderCount++;
                    } else if (sc === '?') {
                      // Also count ? inside functions (depth > 0)
                      setPlaceholderCount++;
                    }
                  }

                  // Parse WHERE clause — support AND conditions
                  // e.g. WHERE id = ?  OR  WHERE sandbox_id = ? AND agent = ?
                  // findTopLevelWherePos scans right-to-left to avoid matching WHERE inside COALESCE(...).
                  const realWhereStart = findTopLevelWherePos(sql);

                  const whereConditions: Array<{ col: string; paramIdx: number }> = [];
                  let whereParamIdx = setPlaceholderCount; // WHERE params start after SET params
                  if (realWhereStart > 0) {
                    const whereClause = sql.slice(realWhereStart).trim();
                    // Split on AND/OR at depth 0
                    const andParts = whereClause.split(/\s+AND\s+/i);
                    for (const part of andParts) {
                      const trimmed = part.trim();
                      // Skip tautological conditions — these have no params and always match
                      // e.g. "created_at IS NOT NULL" is always true for existing rows
                      if (/^\w+\s+IS\s+NOT\s+NULL$/i.test(trimmed)) continue;
                      if (/^\w+\s+IS\s+NULL$/i.test(trimmed)) continue;
                      // Match: column = ?
                      const condMatch = trimmed.match(/(\w+)\s*=\s*\?/i);
                      if (condMatch) {
                        whereConditions.push({ col: condMatch[1].toLowerCase(), paramIdx: whereParamIdx });
                        whereParamIdx++;
                      }
                      // For LIKE conditions, skip (literal value in SQL, no param)
                    }
                  }

                  // Find matching rows
                  let changes = 0;
                  for (let ri = 0; ri < tables[actualTable].length; ri++) {
                    const row = tables[actualTable][ri];
                    let matches = true;
                    for (const cond of whereConditions) {
                      if (row[cond.col] !== params[cond.paramIdx]) {
                        matches = false;
                        break;
                      }
                    }
                    if (matches) {
                      // Apply all SET pairs
                      let paramIdx = 0; // SET ? placeholders consume params from the start
                      for (const pair of setPairs) {
                        const colName = pair.col.toLowerCase();
                        if (pair.value === '__SQL_PARAM__') {
                          const newVal = params[paramIdx];
                          // COALESCE(a, b) semantics: if a is null/undefined, keep existing row value.
                          // The SET clause for chat_request_logs often uses COALESCE(actualParam, col)
                          // meaning "only update if actualParam was provided; otherwise preserve".
                          // Detect this pattern so the mock behaves like real SQLite.
                          const setVal = (pair as any).rawValue || '';
                          const coalesceMatch = setVal.match(/^COALESCE\s*\(\s*\?\s*,/i);
                          if (coalesceMatch && (newVal === null || newVal === undefined)) {
                            // null/undefined first arg → COALESCE falls back to existing column value
                            paramIdx++;
                            continue;
                          }
                          tables[actualTable][ri][colName] = newVal;
                          paramIdx++;
                        } else if (pair.value === '__CURRENT_TIMESTAMP__') {
                          tables[actualTable][ri][colName] = new Date().toISOString();
                        } else if (pair.value === '__EXPR__') {
                          // Complex expression like REPLACE(path, '\\', '/') — skip for mock
                          // These are typically maintenance queries, not functional logic
                        } else {
                          // Literal value (number, string, boolean)
                          tables[actualTable][ri][colName] = pair.value;
                        }
                      }
                      changes++;
                    }
                  }
                  return { lastInsertRowid: 0, changes };
                }
                return { lastInsertRowid: 0, changes: 0 };
              }

              // Handle DELETE statements
              if (isDelete) {
                if (!tables[actualTable]) {
                  return { lastInsertRowid: 0, changes: 0 };
                }

                // findTopLevelWherePos scans right-to-left to avoid matching WHERE inside COALESCE(...).
                const realWhereStart = findTopLevelWherePos(sql);

                if (realWhereStart < 0) {
                  // DELETE FROM table (no WHERE) — delete all rows
                  const count = tables[actualTable].length;
                  tables[actualTable] = [];
                  return { lastInsertRowid: 0, changes: count };
                }

                // Parse WHERE conditions
                const whereClause = sql.slice(realWhereStart).trim();
                const whereConditions: Array<{ col: string; paramIdx: number; op: string }> = [];
                let paramIdx = 0;
                const andParts = whereClause.split(/\s+AND\s+/i);
                for (const part of andParts) {
                  const trimmed = part.trim();
                  // Match: column = ?
                  const eqMatch = trimmed.match(/(\w+)\s*=\s*\?/i);
                  if (eqMatch) {
                    whereConditions.push({ col: eqMatch[1].toLowerCase(), paramIdx, op: '=' });
                    paramIdx++;
                    continue;
                  }
                  // Match: column <= expr  or  column < expr  (time-based cleanup)
                  const cmpMatch = trimmed.match(/(\w+)\s*(<=|<|>=|>)\s*/i);
                  if (cmpMatch) {
                    // For time comparisons, just mark it — mock doesn't evaluate datetime expressions
                    whereConditions.push({ col: cmpMatch[1].toLowerCase(), paramIdx: -1, op: cmpMatch[2] });
                    continue;
                  }
                  // LIKE with literal value — skip
                }

                // Filter rows: DELETE rows where ALL conditions match (AND semantics)
                // Keep rows where AT LEAST ONE condition does NOT match
                const before = tables[actualTable].length;
                const evaluableConditions = whereConditions.filter(c => c.paramIdx !== -1);
                tables[actualTable] = tables[actualTable].filter(row => {
                  if (evaluableConditions.length === 0) {
                    // KNOWN LIMITATION: Time-based conditions (<= datetime('now', ...)) can't be
                    // evaluated in the mock. When ALL conditions are non-evaluable, keep all rows.
                    return true;
                  }
                  // AND semantics: row is deleted only if ALL evaluable conditions match
                  const allMatch = evaluableConditions.every(cond => {
                    return cond.op === '=' && row[cond.col] === params[cond.paramIdx];
                  });
                  return !allMatch; // Keep row if NOT all conditions matched
                });
                const deleted = before - tables[actualTable].length;
                return { lastInsertRowid: 0, changes: deleted };
              }

              return { lastInsertRowid: 0, changes: 0 };
            },

            get: (...params: any[]) => {
              if (!tables[actualTable]) {
                return null;
              }

              const rows = tables[actualTable];
              if (rows.length === 0) return null;

              // findTopLevelWherePos scans right-to-left to avoid matching WHERE inside COALESCE(...).
              const realWhereStart = findTopLevelWherePos(sql);

              if (realWhereStart > 0 && params.length > 0) {
                const whereClause = sql.slice(realWhereStart).trim();
                const andParts = whereClause.split(/\s+AND\s+/i);
                const conditions: Array<{ col: string; paramIdx: number }> = [];
                let pIdx = 0;
                for (const part of andParts) {
                  const trimmed = part.trim();
                  const condMatch = trimmed.match(/(\w+)\s*=\s*\?/i);
                  if (condMatch) {
                    conditions.push({ col: condMatch[1].toLowerCase(), paramIdx: pIdx });
                    pIdx++;
                  }
                  // Skip non-? conditions (IS TRUE, <= expr, etc.)
                }

                if (conditions.length > 0) {
                  // Find first row matching ALL conditions (AND semantics)
                  const match = rows.find(row => {
                    return conditions.every(cond => row[cond.col] === params[cond.paramIdx]);
                  });
                  return match ? { ...match } : null;
                }
              }
              
              // Fallback: return first row if no WHERE filtering needed
              return { ...rows[0] };
            },

            all: (...params: any[]) => {
              if (!tables[actualTable]) {
                return [];
              }

              let rows = [...tables[actualTable]];

              // Track how many params are consumed by WHERE ? placeholders
              // so LIMIT ? uses the correct param index
              let whereParamCount = 0;

              // Parse WHERE clause properly — support AND conditions
              // SECURITY: Apply all WHERE filters for workspace isolation
              // Find the last/top-level WHERE by scanning right-to-left with paren depth.
              // This avoids matching WHERE inside COALESCE(...) in the SQL.
              let realWhereStart = -1;
              let parenDepth = 0;
              for (let i = sql.length - 1; i >= 0; i--) {
                const ch = sql[i];
                if (ch === ')') parenDepth++;
                else if (ch === '(') parenDepth--;
                else if (parenDepth === 0 && sql.substring(i, i + 5).toUpperCase() === 'WHERE') {
                  realWhereStart = i + 5;
                  break;
                }
              }

              if (realWhereStart > 0 && params.length > 0) {
                const whereClause = sql.slice(realWhereStart).trim();
                // Strip ORDER BY / LIMIT / GROUP BY suffix to get clean WHERE clause
                const cleanClause = whereClause.replace(/\s+ORDER\s+BY\s+[\s\S]+$/i, '').replace(/\s+LIMIT\s+[\s\S]+$/i, '').replace(/\s+GROUP\s+BY\s+[\s\S]+$/i, '');
                const andParts = cleanClause.split(/\s+AND\s+/i);
                const conditions: Array<{ col: string; paramIdx: number }> = [];
                let pIdx = 0;
                for (const part of andParts) {
                  const trimmed = part.trim();
                  const condMatch = trimmed.match(/(\w+)\s*=\s*\?/i);
                  if (condMatch) {
                    conditions.push({ col: condMatch[1].toLowerCase(), paramIdx: pIdx });
                    pIdx++;
                  }
                  // Skip non-? conditions (IS TRUE, <= datetime(...), LIKE '...', etc.)
                }

                whereParamCount = pIdx; // remember for LIMIT param resolution

                if (conditions.length > 0) {
                  rows = rows.filter(row => {
                    return conditions.every(cond => row[cond.col] === params[cond.paramIdx]);
                  });
                }
              }
              
              // Parse ORDER BY and LIMIT from SQL
              // Match ORDER BY column_name [ASC|DESC] LIMIT n
              const orderByMatch = sql.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
              const limitMatch = sql.match(/LIMIT\s+(\d+|\?)/i);
              
              if (orderByMatch) {
                const orderCol = orderByMatch[1].toLowerCase();
                const orderDir = orderByMatch[2]?.toUpperCase() === 'DESC' ? -1 : 1;
                rows = [...rows].sort((a: any, b: any) => {
                  // Handle snake_case column names
                  const colName = orderCol.includes('_') ? orderCol : 
                    Object.keys(a).find(k => k.toLowerCase() === orderCol) || orderCol;
                  const aVal = a[colName];
                  const bVal = b[colName];
                  if (aVal < bVal) return -1 * orderDir;
                  if (aVal > bVal) return 1 * orderDir;
                  return 0;
                });
              }
              
              if (limitMatch) {
                const limitStr = limitMatch[1];
                if (limitStr !== '?') {
                  const limit = parseInt(limitStr, 10);
                  rows = rows.slice(0, limit);
                } else if (params.length > whereParamCount) {
                  // Use the param AFTER all WHERE ? placeholders as the LIMIT value
                  const limit = parseInt(params[whereParamCount], 10);
                  if (!isNaN(limit)) {
                    rows = rows.slice(0, limit);
                  }
                }
              }
              
              return rows.map(r => ({ ...r }));
            },

            bind: () => stmt,
            columns: () => [],
            finalize: () => {},
            iterate: () => ({
              next: () => ({ done: true, value: null }),
            }),
            raw: () => [],
          };

          return stmt;
        },

        exec: function(sql: string) {
          // Process CREATE TABLE statements
          initTablesFromSchema(sql);
          return this;
        },

        pragma: () => {},
        transaction: (fn: any) => {
          return (...args: any[]) => fn(...args);
        },
        close: function() { return this; },
        backup: () => Promise.resolve({ totalPages: 0, remainingPages: 0 }),
        defaultSafeIntegers: function() { return this; },
        loadExtension: function() { return this; },
        serialize: () => Buffer.alloc(0),
        table: (name: string) => tables[name] ? true : null,
        function: function() { return this; },
        aggregate: function() { return this; },
        unsafeMode: function() { return this; },
      };

      // Initialize with schema
      mockDb.exec(MOCK_SCHEMA);

      return mockDb;
    })();
  }
  return _mockDatabase;
}

// Initialize database
// Persist db instance and init flag on globalThis so they survive Next.js
// HMR cycles in dev mode (module-level variables reset on re-evaluation).
let db: any = (globalThis as any).__binG_dbInstance || null;
let dbInitialized: boolean = (globalThis as any).__binG_dbInitialized || false;

// Mutex to prevent concurrent schema initialization in serverless cold starts
// Multiple concurrent requests during cold start would otherwise race and cause
// initializeSchemaSync() to run multiple times (even though it's idempotent, it causes log spam)
let dbInitLock: boolean = false;

// Lazy-loaded imports - only loaded when needed, not at module load time
type Database = any;
let DatabaseConstructor: any = null;

function getDatabaseConstructor(): any {
  if (!DatabaseConstructor) {
    // Dynamic import to avoid bundling native module in client/Edge
    const betterSqlite3 = require('better-sqlite3');
    // Handle both ESM default export and CommonJS module
    DatabaseConstructor = betterSqlite3.default || betterSqlite3;
  }
  return DatabaseConstructor;
}

/**
 * Get database instance — SYNCHRONOUS initialization
 *
 * Returns:
 * - Cached db instance if already initialized
 * - Mock database during build/Edge runtime
 * - Synchronously initialized real DB on first call (Node.js runtime)
 */
export function getDatabase(): any {
  // CRITICAL FIX: Always check globalThis FIRST - module variables may be reset
  // on HMR, serverless cold starts, or container restarts
  // BUT also verify that initialization completed to avoid returning a partially initialized db
  const persistedDb = (globalThis as any).__binG_dbInstance;
  const persistedInit = (globalThis as any).__binG_dbInitialized;
  if (persistedDb && persistedInit) {
    db = persistedDb;
    dbInitialized = true;
    return db;
  }

  // Return cached instance (most common case after first init)
  if (db) return db;

  // Skip database initialization during build process or Edge Runtime
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    return getMockDatabase();
  }

  // Acquire mutex lock to prevent concurrent schema initialization in serverless cold starts
  // Multiple concurrent requests during cold start would otherwise race and cause
  // initializeSchemaSync() to run multiple times (even though it's idempotent, it causes log spam)

  // Check if db is already available BEFORE spin-waiting (avoid unnecessary wait)
  if (db) return db;

  if (dbInitLock) {
    // Another caller is initializing - wait for it to complete (spin-wait, but init is fast <100ms)
    const maxWaitMs = 5000;
    const startTime = Date.now();
    while (dbInitLock && (Date.now() - startTime) < maxWaitMs) {
      // spin wait - in practice initialization completes in <100ms
    }
    // After wait, db should be initialized (unless error occurred)
    if (db) return db;
    // If db still not set after wait, we should proceed with our own init attempt
  }
  dbInitLock = true;

  try {
    if (!db) {
      initializeDatabaseSync();
    }
  } finally {
    dbInitLock = false;
  }

  return db ?? getMockDatabase();
}

/**
 * Synchronous database initialization
 */
function initializeDatabaseSync(): void {
  if (db) return; // Already initialized

  // Use boolean lock to prevent concurrent initialization
  if (dbInitLock) {
    // Another caller is initializing - this shouldn't happen since getDatabase()
    // handles the lock, but just in case, wait briefly
    return;
  }

  const fsModule = require('fs');
  const pathModule = require('path');
  const mkdirSync = fsModule.mkdirSync;
  const dirname = pathModule.dirname;

  const dbPath = getDBPath();

  // Create data directory if it doesn't exist
  mkdirSync(dirname(dbPath), { recursive: true });

  const DBConstructor = getDatabaseConstructor();
  db = new DBConstructor(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = 1000');
  db.pragma('temp_store = memory');
  db.pragma('foreign_keys = ON');

  // CRITICAL FIX: Check globalThis for dbInitialized flag - module variable may be reset
  const isAlreadyInitialized = dbInitialized || (globalThis as any).__binG_dbInitialized;

  // Only persist to globalThis AFTER checking if already initialized to avoid
  // reusing a partially initialized database after a failed init
  if (!isAlreadyInitialized) {
    try {
      initializeSchemaSync();
    } catch (schemaError: any) {
      logger.error('[database] Schema initialization failed:', schemaError);
      if (process.env.NODE_ENV === 'production') {
        throw schemaError;
      }
      logger.warn('[database] Continuing with partial schema (development only)');
    }

    // Run migrations synchronously
    try {
      if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
        // Dynamic import for migration runner
        const migrationModule = require('./migration-runner');
        const migrationRunner = migrationModule?.migrationRunner;
        if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
          migrationRunner.runMigrationsSync();
          logger.info('[database] Migrations completed successfully');

          // Also run performance index migration
          try {
            const { addPerformanceIndexesSync } = require('./performance-indexes');
            addPerformanceIndexesSync(db);
            logger.info('[database] Performance indexes added successfully');
          } catch (indexError: any) {
            if (!indexError.message?.includes('already exists')) {
              logger.warn('[database] Performance index migration failed (indexes may already exist):', indexError);
            }
          }
        }
      }
    } catch (migrationError: unknown) {
      const errMsg = migrationError instanceof Error ? migrationError.message : String(migrationError);
      if (!errMsg?.includes('Cannot find module')) {
        // HIGH-2 fix: In production, migration failure is fatal — the app would run
        // with an outdated schema, causing runtime errors on missing columns/indexes.
        // In development, continue with base schema for convenience.
        if (process.env.NODE_ENV === 'production') {
          logger.error('[database] FATAL: Migrations failed in production — cannot continue with outdated schema:', migrationError);
          throw migrationError;
        }
        logger.warn('[database] Migrations failed (continuing with base schema — development only):', migrationError);
      }
    }

    dbInitialized = true;
    (globalThis as any).__binG_dbInitialized = true;
  }

  // Belt-and-suspenders: re-persist after init completes successfully
  (globalThis as any).__binG_dbInstance = db;

  logger.info('[DB] Database initialized successfully (synchronous)');
}

/**
 * Initialize database asynchronously (kept for backwards compatibility)
 * Delegates to synchronous init since better-sqlite3 is inherently sync
 */
async function initializeDatabase(): Promise<void> {
  if (db) return;
  // Delegate to sync initialization
  getDatabase();
}

export async function initializeDatabaseAsync(): Promise<any> {
  // Sync init is now done automatically by getDatabase()
  return getDatabase();
}

/**
 * Execute each SQL statement individually with per-statement error tolerance.
 *
 * When an existing database has tables created by an older schema version, some
 * statements in schema.sql (e.g. CREATE INDEX on a column added later) will fail
 * because the column doesn't exist yet.  Executing the entire schema as a single
 * blob (db.exec) would abort on the first error, leaving later tables uncreated.
 *
 * By executing statements one-by-one we create every new table while skipping
 * index definitions that reference columns not yet present in pre-existing tables.
 * Migrations will add those columns and indexes afterwards.
 */
function executeSchemaStatements(sql: string): void {
  // Split on semicolons — simple but effective for schema.sql which does not
  // embed semicolons inside string literals.
  const statements = sql.split(';');
  let created = 0;
  let skipped = 0;

  for (const raw of statements) {
    const stmt = raw.trim();
    if (!stmt) continue;

    try {
      db.exec(stmt + ';');
      created++;
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      // Tolerate references to columns / tables that don't exist yet on a
      // pre-existing database.  Migrations are responsible for bringing those
      // columns/tables into existence.
      if (/no such column/i.test(msg) || /no such table/i.test(msg)) {
        skipped++;
        logger.warn(
          withDetectionTerms(
            `[schema-init] Skipping statement (schema drift — migration will add): ${msg}`,
            DETECTION_TERMS.drift,
          ),
        );
        continue;
      }
      // SQLITE_BUSY is transient — let the caller's retry loop handle it.
      if (err.code === 'SQLITE_BUSY') {
        throw err;
      }
      // All other errors (syntax, constraint violations, etc.) are real.
      logger.error(`[schema-init] Statement failed: ${stmt.substring(0, 120)} — ${msg}`);
      throw err;
    }
  }

  logger.info(
    withDetectionTerms(
      `[schema-init] Executed ${created} statements, skipped ${skipped} (schema drift)`,
      DETECTION_TERMS.drift,
    ),
  );
}

/**
 * Synchronous schema initializer.
 *
 * better-sqlite3 is inherently synchronous so this was always called without
 * `await`, making the old `async` + `await setTimeout` retry a broken
 * fire-and-forget whose rejections became unhandled rejections.
 *
 * Now fully synchronous with a busy-wait fallback for the rare SQLITE_BUSY
 * case (unlikely under WAL mode but handled defensively).
 */
function initializeSchemaSync(): void {
  if (!db) return;

  // Only run schema initialization in Node.js runtime
  if (typeof process === 'undefined' || process.env.NEXT_RUNTIME !== 'nodejs') return;

  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Execute base schema to ensure required tables exist
      const schemaSql = getSchemaSql();
      if (schemaSql) {
        executeSchemaStatements(schemaSql);
      }

      logger.info('Database base schema initialized');
      return;
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY' && attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 100; // Exponential backoff
        logger.warn(`Database is locked (SQLITE_BUSY), retrying in ${delayMs}ms... (Attempt ${attempt}/${maxRetries})`);
        // Synchronous sleep — the old `await setTimeout` was never awaited.
        // SQLITE_BUSY is extremely rare with WAL mode; a brief busy-wait is
        // acceptable for these short delays (200–3200 ms).
        const end = Date.now() + delayMs;
        while (Date.now() < end) { /* spin */ }
        continue;
      }
      logger.error('Failed to initialize database schema after retries', error);
      throw error;
    }
  }
}

async function initializeSchema() {
  if (!db) return;

  try {
    // Run migrations
    const { migrationRunner } = await import('./migration-runner');
    await migrationRunner.runMigrations();

    logger.info('Database migrations completed');
  } catch (error: unknown) {
    logger.error('Failed to run migrations:', error);
    throw error;
  }
}

// Encryption utilities for API keys - lazy-loaded
// Only available in Node.js runtime
export function encryptApiKey(apiKey: string): { encrypted: string; hash: string } {
  // Not available in Edge Runtime - throw early to avoid crypto import
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    throw new Error('encryptApiKey is only available in Node.js runtime');
  }
  
  // Use require to avoid Edge Runtime analysis of crypto import
  const cryptoModule = require('crypto');
  const crypto = cryptoModule;
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(16);
  // Use createCipheriv which properly uses the IV (non-deprecated)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const encryptedWithIv = iv.toString('hex') + ':' + encrypted;
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

  return {
    encrypted: encryptedWithIv,
    hash
  };
}

export function decryptApiKey(encryptedData: string): string {
  // Not available in Edge Runtime - throw early to avoid crypto import
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    throw new Error('decryptApiKey is only available in Node.js runtime');
  }
  
  // Use require to avoid Edge Runtime analysis of crypto import
  const cryptoModule = require('crypto');
  const crypto = cryptoModule;
  const key = getEncryptionKey();

  const parts = encryptedData.split(':');

  // Check if it's new format (iv:encrypted) or legacy format (just encrypted)
  if (parts.length === 2) {
    // New format with IV
    const [ivHex, encrypted] = parts;
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error: unknown) {
      logger.error('[decryptApiKey] New format decryption failed:', error);
    }
  }
  
  // Try legacy format (no IV, uses deprecated createDecipheriv with zero IV)
  try {
    // Legacy format used a zero-filled IV
    // Note: This is deprecated but kept for backward compatibility with existing encrypted data
    const zeroIv = Buffer.alloc(16, 0);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, zeroIv);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (legacyError) {
    logger.error('[decryptApiKey] Legacy format decryption failed:', legacyError);
    throw new Error('Failed to decrypt API key: data may be corrupted');
  }
}

/**
 * Migration helper: Re-encrypt all API credentials with secure format
 * Call this once to migrate legacy encrypted data to the new format
 */
export async function migrateLegacyEncryptedKeys(): Promise<{ migrated: number; errors: number }> {
  const db = getDatabase();
  let migrated = 0;
  let errors = 0;

  // Guard with runtime check so webpack doesn't bundle for client
  if (typeof require === 'undefined') {
    return { migrated: 0, errors: 0 };
  }
  // Load crypto module for encryption operations
  const crypto = require('crypto');

  try {
    // Get all API credentials
    const stmt = db.prepare('SELECT id, user_id, provider, api_key_encrypted FROM api_credentials WHERE is_active = TRUE');
    const credentials = stmt.all() as Array<{ id: number; user_id: number; provider: string; api_key_encrypted: string }>;

    for (const cred of credentials) {
      try {
        if (!cred || !cred.api_key_encrypted) continue;
        
        // Check if it's legacy format (legacy format has a shorter IV - 32 hex chars vs proper 32 hex chars)
        const parts = cred.api_key_encrypted.split(':');
        if (parts.length !== 2 || parts[0].length !== 32) {
          // Skip if it doesn't look like our format
          continue;
        }

        // Try to decrypt with legacy method
        const ivHex = parts[0];
        const encrypted = parts[1];
        
        // If IV is 32 chars but doesn't work with new format, it's legacy
        try {
          const iv = Buffer.from(ivHex, 'hex');
          const encKey = getEncryptionKey();
          (crypto as any).createDecipheriv('aes-256-cbc', encKey, iv);
          // If this succeeds, it's new format - skip
          continue;
        } catch (e: unknown) {
          // New format failed, this is legacy - migrate it
          const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), Buffer.alloc(16, 0));
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');

          // Re-encrypt with secure format
          const { encrypted: newEncrypted } = await encryptApiKey(decrypted);

          // Update database
          const updateStmt = db.prepare('UPDATE api_credentials SET api_key_encrypted = ? WHERE id = ?');
          updateStmt.run(newEncrypted, cred.id);
          migrated++;
          logger.info(`[MigrateKeys] Migrated API key for user ${cred.user_id}, provider ${cred.provider}`);
        }
      } catch (err: unknown) {
        errors++;
        logger.error(`[MigrateKeys] Failed to migrate key for user ${cred.user_id}, provider ${cred.provider}:`, err);
      }
    }

    logger.info(`[MigrateKeys] Migration complete: ${migrated} migrated, ${errors} errors`);
  } catch (error: unknown) {
    logger.error('[MigrateKeys] Migration failed:', error);
    errors++;
  }

  return { migrated, errors };
}

// Database operations
export class DatabaseOperations {
  private dbReady: Promise<void>;
  
  // PREPARED STATEMENTS CACHE - create once, reuse infinitely
  // This avoids recreating prepared statements on every call
  private preparedStatements: Map<string, any> = new Map<string, any>();
  private preparedStatementsInitialized = false;

  // Database instance — resolved synchronously in constructor via getDatabase()
  db: any = getDatabase();

  private getPrepared(name: string, sql: string): any {
    // Resolve real DB if available (handles late initialization)
    const realDb = getDatabase();
    if (realDb && this.db !== realDb) {
      this.db = realDb;
      this.preparedStatementsInitialized = false;
      this.preparedStatements.clear();
    }

    if (!this.preparedStatementsInitialized || !this.db) {
      this.initializePreparedStatements();
    }

    if (!this.preparedStatements.has(name)) {
      this.preparedStatements.set(name, this.db.prepare(sql));
    }
    return this.preparedStatements.get(name);
  }

  constructor() {
    // Trigger sync DB init — this is now fully synchronous
    this.db = getDatabase();

    if (this.db) {
      this.initializePreparedStatements();
    } else {
      // Fallback: DB truly failed to init (shouldn't happen with sync init)
      this.db = getMockDatabase();
      logger.error('[DatabaseOperations] Real DB unavailable, using mock');
    }
  }

  private initializePreparedStatements(): void {
    if (this.preparedStatementsInitialized) return;

    const realDb = getDatabase();
    if (realDb && this.db !== realDb) this.db = realDb;

    if (!this.db) {
      this.db = getMockDatabase();
    }

    this.preparedStatements.clear();

    // Helper to safely prepare statements (catch errors for mock/partial DB)
    const safePrepare = (name: string, sql: string) => {
      try {
        const stmt = this.db.prepare(sql);
        this.preparedStatements.set(name, stmt);
      } catch (error: any) {
        logger.warn(`[DatabaseOperations] Statement '${name}' unavailable: ${error.message}`);
      }
    };

    // User operations
    safePrepare('createUser', `INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)`);
    safePrepare('getUserByEmail', `SELECT * FROM users WHERE email = ? AND is_active = TRUE`);
    safePrepare('getUserById', `SELECT * FROM users WHERE id = ? AND is_active = TRUE`);

    // API credentials
    safePrepare('saveApiCredential', `INSERT OR REPLACE INTO api_credentials (user_id, provider, api_key_encrypted, api_key_hash, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`);
    safePrepare('getApiCredential', `SELECT api_key_encrypted FROM api_credentials WHERE user_id = ? AND provider = ? AND is_active = TRUE`);

    // Sessions
    safePrepare('createSession', `INSERT INTO user_sessions (session_id, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`);
    safePrepare('getSession', `SELECT * FROM user_sessions WHERE session_id = ? AND expires_at > CURRENT_TIMESTAMP`);

    // External connections
    safePrepare('getExternalConnection', `SELECT access_token_encrypted, token_expires_at FROM external_connections WHERE user_id = ? AND provider = ? AND is_active = TRUE LIMIT 1`);

    this.preparedStatementsInitialized = true;
  }
  
  /**
   * Get the underlying database instance (for advanced operations).
   * Always resolves to the real DB if available.
   */
  getDb(): any {
    const realDb = getDatabase();
    if (realDb && this.db !== realDb) {
      this.db = realDb;
      this.preparedStatementsInitialized = false;
      this.preparedStatements.clear();
    }
    return this.db;
  }

  /**
   * Reinitialize prepared statements after database reconnection
   * Call this if the database connection is lost and re-established
   */
  async reinitializeAfterReconnection(): Promise<void> {
    this.preparedStatementsInitialized = false;
    this.preparedStatements.clear();
    this.db = getDatabase();
    this.initializePreparedStatements();
  }

  // User operations
  createUser(email: string, username: string, passwordHash: string) {
    // Handle empty username - set to NULL to avoid unique constraint conflicts
    const finalUsername = username.trim() || null;
    // Generate UUID for new user (users.id is now TEXT PRIMARY KEY)
    const crypto = require('crypto');
    const userId = crypto.randomUUID();
    const stmt = this.getPrepared('createUser', `
      INSERT INTO users (id, email, username, password_hash)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(userId, email, finalUsername, passwordHash);
  }

  createUserWithVerification(email: string, username: string, passwordHash: string, verificationToken: string, verificationExpires: Date, emailVerified: boolean = false) {
    // Handle empty username - set to NULL to avoid unique constraint conflicts
    const finalUsername = username.trim() || null;
    // Hash the verification token for secure storage
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
    // Generate UUID for new user (users.id is now TEXT PRIMARY KEY)
    const userId = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, username, password_hash, email_verification_token_hash, email_verification_expires, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // Convert boolean to number for SQLite (0 or 1)
    return stmt.run(userId, email, finalUsername, passwordHash, tokenHash, verificationExpires.toISOString(), emailVerified ? 1 : 0);
  }

  getUserByEmail(email: string) {
    const stmt = this.getPrepared('getUserByEmail', `
      SELECT * FROM users WHERE email = ? AND is_active = TRUE
    `);
    return stmt.get(email);
  }

  getUserById(id: string) {
    const stmt = this.getPrepared('getUserById', `
      SELECT * FROM users WHERE id = ? AND is_active = TRUE
    `);
    return stmt.get(id);
  }
  
  // API credentials operations
  async saveApiCredential(userId: string, provider: string, apiKey: string): Promise<{ lastInsertRowid: number }> {
    const { encrypted, hash } = await encryptApiKey(apiKey);

    const stmt = this.getPrepared('saveApiCredential', `
      INSERT OR REPLACE INTO api_credentials
      (user_id, provider, api_key_encrypted, api_key_hash, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    return stmt.run(userId, provider, encrypted, hash);
  }

  getApiCredential(userId: string, provider: string): string | null {
    const stmt = this.getPrepared('getApiCredential', `
      SELECT api_key_encrypted FROM api_credentials
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
    `);

    const result = stmt.get(userId, provider) as { api_key_encrypted: string } | undefined;

    if (result) {
      return decryptApiKey(result.api_key_encrypted);
    }

    return null;
  }
  
  // Conversation operations
  createConversation(id: string, userId: string | null, title: string) {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, user_id, title)
      VALUES (?, ?, ?)
    `);
    
    return stmt.run(id, userId, title);
  }
  
  getConversation(id: string, userId?: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND is_archived = FALSE
      ${userId ? 'AND user_id = ?' : ''}
    `);

    return userId ? stmt.get(id, userId) : stmt.get(id);
  }

  /**
   * Get conversation with user ownership verification
   * SECURITY: Always use this method when accessing conversations by ID
   */
  getConversationById(id: string, userId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE id = ? AND user_id = ? AND is_archived = FALSE
    `);

    return stmt.get(id, userId);
  }
  
  getUserConversations(userId: string, limit: number = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE user_id = ? AND is_archived = FALSE
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    
    return stmt.all(userId, limit);
  }
  
  // Message operations
  /**
   * Save a message to a conversation
   * SECURITY: Caller should verify conversation ownership before calling
   */
  saveMessage(id: string, conversationId: string, role: string, content: string, provider?: string, model?: string) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, provider, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(id, conversationId, role, content, provider, model);
  }

  /**
   * Get messages for a conversation without user verification
   * SECURITY: Caller must verify conversation ownership before calling
   * @deprecated Use getConversationMessagesWithAuth() instead
   */
  getConversationMessages(conversationId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);

    return stmt.all(conversationId);
  }

  /**
   * Get messages for a conversation with user ownership verification
   * SECURITY: This is the preferred method - verifies conversation belongs to user
   */
  getConversationMessagesWithAuth(conversationId: string, userId: string) {
    const stmt = this.db.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
      ORDER BY m.created_at ASC
    `);

    return stmt.all(conversationId, userId);
  }
  
  // Usage tracking
  logUsage(userId: string | null, provider: string, model: string, tokensUsed: number, costUsd: number) {
    const stmt = this.db.prepare(`
      INSERT INTO usage_logs (user_id, provider, model, tokens_used, cost_usd)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(userId, provider, model, tokensUsed, costUsd);
  }
  
  getUserUsageStats(userId: string) {
    const stmt = this.db.prepare(`
      SELECT 
        provider,
        model,
        SUM(tokens_used) as total_tokens,
        SUM(cost_usd) as total_cost,
        COUNT(*) as request_count
      FROM usage_logs 
      WHERE user_id = ?
      GROUP BY provider, model
      ORDER BY total_cost DESC
    `);
    
    return stmt.all(userId);
  }
  
  // Session management
  createSession(sessionId: string, userId: string, expiresAt: Date, ipAddress?: string, userAgent?: string) {
    const crypto = require('crypto');
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const stmt = this.getPrepared('createSession', `
      INSERT INTO user_sessions (session_id, user_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `);

    return stmt.run(sessionHash, userId, expiresAt.toISOString(), ipAddress, userAgent);
  }

  getSession(sessionId: string) {
    const crypto = require('crypto');
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const stmt = this.getPrepared('getSession', `
      SELECT s.*, u.email, u.username, u.subscription_tier
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
    `);

    return stmt.get(sessionHash);
  }

  deleteSession(sessionId: string) {
    const crypto = require('crypto');
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE session_id = ?
    `);

    return stmt.run(sessionHash);
  }

  // Cleanup expired sessions
  cleanupExpiredSessions() {
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP
    `);

    return stmt.run();
  }
  
  // User preferences
  setUserPreference(userId: string, key: string, value: string) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    return stmt.run(userId, key, value);
  }
  
  getUserPreference(userId: string, key: string) {
    const stmt = this.db.prepare(`
      SELECT preference_value FROM user_preferences 
      WHERE user_id = ? AND preference_key = ?
    `);
    
    const result = stmt.get(userId, key) as { preference_value: string } | undefined;
    return result?.preference_value || null;
  }
  
  getUserPreferences(userId: string) {
    const stmt = this.db.prepare(`
      SELECT preference_key, preference_value FROM user_preferences 
      WHERE user_id = ?
    `);
    
    const results = stmt.all(userId) as Array<{ preference_key: string; preference_value: string }>;
    
    return results.reduce((acc, { preference_key, preference_value }) => {
      acc[preference_key] = preference_value;
      return acc;
    }, {} as Record<string, string>);
  }
}

// Export singleton instance
export const dbOps = new DatabaseOperations();

// Note: Graceful shutdown removed - not compatible with Edge Runtime/serverless
// Database connections will be cleaned up automatically by the runtime

export default getDatabase;

/**
 * Returns true if the database is available (better-sqlite3 can be loaded AND
 * its native binding works). Use this to skip DB-dependent code paths when
 * running in environments where the native module cannot be loaded
 * (e.g., Edge Runtime, missing native deps, or a broken native binding).
 *
 * The result is cached at module level — the check instantiates an in-memory
 * database to verify the native binding works, which is expensive to repeat.
 *
 * IMPORTANT: This check is more than just `require('better-sqlite3')` — the
 * require can succeed even when the native binding is broken (the .node file
 * is present in node_modules but cannot be loaded by Node.js). We must
 * actually instantiate the database to catch native binding failures.
 */
export function isDatabaseAvailable(): boolean {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    const Database = require('better-sqlite3');
    const testDb = new Database(':memory:');
    testDb.close();
    _dbAvailable = true;
    return true;
  } catch {
    _dbAvailable = false;
    return false;
  }
}

// Module-level cache for isDatabaseAvailable() to avoid repeated native-binding
// instantiation on every call. null = not yet checked, true/false = cached result.
let _dbAvailable: boolean | null = null;
