// Database configuration - lazy initialized to avoid Edge Runtime issues
// All Node.js modules are lazy-loaded inside functions, not at module load time
// This file is server-only - do not import in Client Components
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

  let schemaPath: string;
  try {
    // Use dynamic require so webpack doesn't try to bundle these for the client.
    // Resolve schema.sql relative to the process working directory so this works
    // in both CommonJS and ESM contexts (process.cwd() is universally available).
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
    schemaPath = join(cwd, 'lib', 'database', 'schema.sql');
    _cachedSchemaSql = readFileSync(schemaPath, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // During build, missing schema.sql is non-fatal (db init is mocked anyway).
    // At runtime this is a real error — warn but don't throw so the caller can
    // decide how to handle a missing schema.
    console.error(`[DB] Could not read schema.sql (path: ${schemaPath}): ${msg}`);
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
    console.warn('[DB] Skipping ENCRYPTION_KEY validation during build/Edge');
    return Buffer.alloc(32, 'dummy-key-for-build');
  }

  if (!ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === 'production') {
      // Don't throw during build - use dummy key
      if (shouldSkipDbInit()) {
        console.warn('[DB] ENCRYPTION_KEY not set - using dummy key for build');
        return Buffer.alloc(32, 'dummy-key-for-build');
      }
      throw new Error('ENCRYPTION_KEY must be set in production for data security');
    }
    // In development, generate random key per session (not persistent)
    console.warn('⚠️  WARNING: ENCRYPTION_KEY not set! Using random dev key.');
    console.warn('API keys will NOT persist across restarts in development.');
    console.warn('Set ENCRYPTION_KEY environment variable to a secure 32+ character random string.');
    return crypto.randomBytes(32);
  }

  // Validate key strength
  if (!ENCRYPTION_KEY || typeof ENCRYPTION_KEY !== 'string') {
    console.warn('[DB] ENCRYPTION_KEY is missing or invalid, using fallback');
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
 * Create a mock database object for use during build or while migrations are pending
 */
// Singleton mock — always the same instance so identity checks work
let _mockDatabase: any = null;
function getMockDatabase() {
  if (!_mockDatabase) {
    _mockDatabase = (() => {
      const mockDb: any = {
    prepare: () => {
      return {
        run: () => ({ lastInsertRowid: 1, changes: 1 }),
        get: () => null,
        all: () => [],
        bind: () => null,
        columns: () => [],
        finalize: () => {},
        iterate: () => [],
        raw: () => []
      };
    },
    exec: function() { return this; },
    pragma: () => {},
    transaction: (fn: any) => {
      // Mock transaction - returns a function that executes the transaction
      // Matches better-sqlite3 behavior where transaction() returns a callable
      return (...args: any[]) => fn(...args);
    },
    close: function() { return this; },
    backup: () => Promise.resolve({ totalPages: 0, remainingPages: 0 }),
    defaultSafeIntegers: function() { return this; },
    loadExtension: function() { return this; },
    serialize: () => Buffer.alloc(0),
    table: () => null,
    function: function() { return this; },
    aggregate: function() { return this; },
    unsafeMode: function() { return this; },
  };

  return mockDb;
    })();
  }
  return _mockDatabase;
}

// Initialize database
let db: any = null;

let dbInitialized = false;
let dbInitializing = false;

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
  // Return cached instance (most common case after first init)
  if (db) return db;

  // Skip database initialization during build process or Edge Runtime
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    return getMockDatabase();
  }

  // Synchronous initialization — better-sqlite3 is inherently synchronous
  // No reason to defer init when there's no network or I/O blocking
  if (!dbInitializing) {
    dbInitializing = true;
    try {
      initializeDatabaseSync();
    } catch (err) {
      console.error('[DB] Synchronous database initialization failed:', err);
      dbInitializing = false;
      return getMockDatabase();
    }
  }

  // Return null if still initializing (should not happen with sync init)
  return db;
}

/**
 * Synchronous database initialization
 */
function initializeDatabaseSync(): void {
  if (db) return; // Already initialized

  const fsModule = require('fs');
  const pathModule = require('path');
  const mkdirSync = fsModule.mkdirSync;
  const join = pathModule.join;
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

  // Initialize schema synchronously
  if (!dbInitialized) {
    initializeSchemaSync();

    // Run migrations synchronously
    try {
      if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
        // Dynamic import for migration runner
        const migrationModule = require('./migration-runner');
        const migrationRunner = migrationModule?.migrationRunner;
        if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
          migrationRunner.runMigrationsSync();
          console.log('[database] Migrations completed successfully');

          // Also run performance index migration
          try {
            const { addPerformanceIndexesSync } = require('./performance-indexes');
            addPerformanceIndexesSync(db);
            console.log('[database] Performance indexes added successfully');
          } catch (indexError: any) {
            if (!indexError.message?.includes('already exists')) {
              console.warn('[database] Performance index migration failed (indexes may already exist):', indexError);
            }
          }
        }
      }
    } catch (migrationError) {
      if (!migrationError.message?.includes('Cannot find module')) {
        console.warn('[database] Migrations failed (continuing with base schema):', migrationError);
      }
    }

    dbInitialized = true;
  }

  console.log('[DB] Database initialized successfully (synchronous)');
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

async function initializeSchemaSync(): Promise<void> {
  if (!db) return;

  // Only run schema initialization in Node.js runtime
  if (typeof process === 'undefined' || process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Execute base schema to ensure required tables exist
    const schemaSql = getSchemaSql();
    if (schemaSql) {
      db.exec(schemaSql);
    }

    console.log('Database base schema initialized');
  } catch (error) {
    console.error('Failed to initialize base schema:', error);
    throw error;
  }
}

async function initializeSchema() {
  if (!db) return;

  try {
    // Run migrations
    const { migrationRunner } = await import('./migration-runner');
    await migrationRunner.runMigrations();

    console.log('Database migrations completed');
  } catch (error) {
    console.error('Failed to run migrations:', error);
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
    } catch (error) {
      console.error('[decryptApiKey] New format decryption failed:', error);
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
    console.error('[decryptApiKey] Legacy format decryption failed:', legacyError);
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
        } catch (e) {
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
          console.log(`[MigrateKeys] Migrated API key for user ${cred.user_id}, provider ${cred.provider}`);
        }
      } catch (err) {
        errors++;
        console.error(`[MigrateKeys] Failed to migrate key for user ${cred.user_id}, provider ${cred.provider}:`, err);
      }
    }

    console.log(`[MigrateKeys] Migration complete: ${migrated} migrated, ${errors} errors`);
  } catch (error) {
    console.error('[MigrateKeys] Migration failed:', error);
    errors++;
  }

  return { migrated, errors };
}

// Database operations
export class DatabaseOperations {
  private dbReady: Promise<void>;
  
  // PREPARED STATEMENTS CACHE - create once, reuse infinitely
  // This avoids recreating prepared statements on every call
  private preparedStatements: Map<string, any> = new Map();
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
      console.error('[DatabaseOperations] Real DB unavailable, using mock');
    }
  }

  private initializePreparedStatements(): void {
    if (this.preparedStatementsInitialized) {
      return;
    }

    // Ensure we have the real DB before initializing
    const realDb = getDatabase();
    if (realDb && this.db !== realDb) {
      this.db = realDb;
    }

    if (!this.db) {
      console.error('[DatabaseOperations] Cannot init prepared statements: db is null');
      return;
    }
    this.preparedStatements.clear();
    
    // User operations
    this.preparedStatements.set('createUser', this.db.prepare(`
      INSERT INTO users (email, username, password_hash)
      VALUES (?, ?, ?)
    `));
    this.preparedStatements.set('getUserByEmail', this.db.prepare(`
      SELECT * FROM users WHERE email = ? AND is_active = TRUE
    `));
    this.preparedStatements.set('getUserById', this.db.prepare(`
      SELECT * FROM users WHERE id = ? AND is_active = TRUE
    `));
    
    // API credentials
    this.preparedStatements.set('saveApiCredential', this.db.prepare(`
      INSERT OR REPLACE INTO api_credentials
      (user_id, provider, api_key_encrypted, api_key_hash, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `));
    this.preparedStatements.set('getApiCredential', this.db.prepare(`
      SELECT api_key_encrypted FROM api_credentials
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
    `));
    
    // Sessions
    this.preparedStatements.set('createSession', this.db.prepare(`
      INSERT INTO user_sessions
      (session_id, user_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `));
    this.preparedStatements.set('getSession', this.db.prepare(`
      SELECT * FROM user_sessions
      WHERE session_id = ? AND expires_at > CURRENT_TIMESTAMP
    `));
    
    // External connections
    this.preparedStatements.set('getExternalConnection', this.db.prepare(`
      SELECT access_token_encrypted, token_expires_at 
      FROM external_connections 
      WHERE user_id = ? AND provider = ? AND is_active = TRUE
      LIMIT 1
    `));
    
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
    const stmt = this.getPrepared('createUser', `
      INSERT INTO users (email, username, password_hash)
      VALUES (?, ?, ?)
    `);
    return stmt.run(email, finalUsername, passwordHash);
  }

  createUserWithVerification(email: string, username: string, passwordHash: string, verificationToken: string, verificationExpires: Date, emailVerified: boolean = false) {
    // Handle empty username - set to NULL to avoid unique constraint conflicts
    const finalUsername = username.trim() || null;
    const stmt = this.db.prepare(`
      INSERT INTO users (email, username, password_hash, email_verification_token, email_verification_expires, email_verified)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    // Convert boolean to number for SQLite (0 or 1)
    return stmt.run(email, finalUsername, passwordHash, verificationToken, verificationExpires.toISOString(), emailVerified ? 1 : 0);
  }

  getUserByEmail(email: string) {
    const stmt = this.getPrepared('getUserByEmail', `
      SELECT * FROM users WHERE email = ? AND is_active = TRUE
    `);
    return stmt.get(email);
  }

  getUserById(id: number) {
    const stmt = this.getPrepared('getUserById', `
      SELECT * FROM users WHERE id = ? AND is_active = TRUE
    `);
    return stmt.get(id);
  }
  
  // API credentials operations
  async saveApiCredential(userId: number, provider: string, apiKey: string): Promise<{ lastInsertRowid: number }> {
    const { encrypted, hash } = await encryptApiKey(apiKey);

    const stmt = this.getPrepared('saveApiCredential', `
      INSERT OR REPLACE INTO api_credentials
      (user_id, provider, api_key_encrypted, api_key_hash, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    return stmt.run(userId, provider, encrypted, hash);
  }

  getApiCredential(userId: number, provider: string): string | null {
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
  createConversation(id: string, userId: number | null, title: string) {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, user_id, title)
      VALUES (?, ?, ?)
    `);
    
    return stmt.run(id, userId, title);
  }
  
  getConversation(id: string, userId?: number) {
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
  getConversationById(id: string, userId: number) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations 
      WHERE id = ? AND user_id = ? AND is_archived = FALSE
    `);

    return stmt.get(id, userId);
  }
  
  getUserConversations(userId: number, limit: number = 50) {
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
  getConversationMessagesWithAuth(conversationId: string, userId: number) {
    const stmt = this.db.prepare(`
      SELECT m.* FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
      ORDER BY m.created_at ASC
    `);

    return stmt.all(conversationId, userId);
  }
  
  // Usage tracking
  logUsage(userId: number | null, provider: string, model: string, tokensUsed: number, costUsd: number) {
    const stmt = this.db.prepare(`
      INSERT INTO usage_logs (user_id, provider, model, tokens_used, cost_usd)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(userId, provider, model, tokensUsed, costUsd);
  }
  
  getUserUsageStats(userId: number) {
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
  createSession(sessionId: string, userId: number, expiresAt: Date, ipAddress?: string, userAgent?: string) {
    const stmt = this.getPrepared('createSession', `
      INSERT INTO user_sessions (session_id, user_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `);

    return stmt.run(sessionId, userId, expiresAt.toISOString(), ipAddress, userAgent);
  }

  getSession(sessionId: string) {
    const stmt = this.getPrepared('getSession', `
      SELECT s.*, u.email, u.username, u.subscription_tier
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
    `);

    return stmt.get(sessionId);
  }

  deleteSession(sessionId: string) {
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE session_id = ?
    `);

    return stmt.run(sessionId);
  }

  // Cleanup expired sessions
  cleanupExpiredSessions() {
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP
    `);

    return stmt.run();
  }
  
  // User preferences
  setUserPreference(userId: number, key: string, value: string) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_preferences (user_id, preference_key, preference_value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    return stmt.run(userId, key, value);
  }
  
  getUserPreference(userId: number, key: string) {
    const stmt = this.db.prepare(`
      SELECT preference_value FROM user_preferences 
      WHERE user_id = ? AND preference_key = ?
    `);
    
    const result = stmt.get(userId, key) as { preference_value: string } | undefined;
    return result?.preference_value || null;
  }
  
  getUserPreferences(userId: number) {
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
