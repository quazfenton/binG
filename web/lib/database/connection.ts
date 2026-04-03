// Database configuration - lazy initialized to avoid Edge Runtime issues
// All Node.js modules are lazy-loaded inside functions, not at module load time
// This file is server-only - do not import in Client Components
export const runtime = 'nodejs';

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
    cwd = process.cwd?.();
  }

  return cwd ? path.join(cwd, 'data', 'binG.db') : './data/binG.db';
}

// Encryption key - MUST be set via environment variable in production
// Lazy-loaded to avoid Edge Runtime and build-time errors
let encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;

  // Use require at runtime (safe in server code)
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
  if (ENCRYPTION_KEY.length < 16) {
    throw new Error('ENCRYPTION_KEY must be at least 16 characters for secure encryption');
  }

  // Pad or truncate to exactly 32 bytes for AES-256
  encryptionKey = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  return encryptionKey;
}

/**
 * Create a mock database object for use during build or while migrations are pending
 */
function getMockDatabase() {
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
 * Get database instance - SYNCHRONOUS after first initialization
 * 
 * Returns:
 * - Cached db instance if already initialized
 * - Mock database during build/Edge runtime
 * - null on first call if db is still initializing (caller should handle this)
 * 
 * @example
 * const db = getDatabase();
 * if (!db) {
 *   // Database not ready yet - use fallback or retry
 *   return;
 * }
 * db.prepare('SELECT * FROM users').all();
 */
export function getDatabase(): any {
  // Return cached instance (most common case after first init)
  if (db) return db;
  
  // Skip database initialization during build process or Edge Runtime
  if (shouldSkipDbInit() || isEdgeRuntime()) {
    // Return a mock database object during build time
    // This allows the build to proceed without requiring the native module
    console.log('[DB] Skipping database initialization during build/Edge');
    return getMockDatabase();
  }
  
  // First call - trigger async initialization in background
  if (!dbInitializing) {
    dbInitializing = true;
    // Use setImmediate to avoid blocking the current request (Node.js only)
    if (typeof setImmediate !== 'undefined') {
      setImmediate(() => initializeDatabase().catch(console.error));
    } else {
      // Fallback for environments without setImmediate
      setTimeout(() => initializeDatabase().catch(console.error), 0);
    }
  }

  // Return null on first call - caller should handle this case
  // Most callers already have fallback logic for this scenario
  return null;
}

/**
 * Initialize database asynchronously (called once in background)
 */
async function initializeDatabase(): Promise<void> {
  if (db) return; // Already initialized
  
  try {
    // Dynamic import to avoid bundling Node.js modules in client/Edge
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

    // SECURITY: Enable foreign key enforcement
    // Without this, ON DELETE CASCADE and foreign key constraints are silently ignored
    db.pragma('foreign_keys = ON');

    // Initialize schema synchronously first time
    if (!dbInitialized) {
      initializeSchemaSync();

      // SECURITY: Run migrations SYNCHRONOUSLY first time to prevent race conditions
      // Without this, requests can execute before migrations complete, causing
      // "no such column" errors for migration-added columns like email_verification_token
      try {
        // Respect AUTO_RUN_MIGRATIONS environment variable
        if (process.env.AUTO_RUN_MIGRATIONS !== 'false') {
          // Dynamic import to avoid circular import at module load time
          const { migrationRunner } = await import('./migration-runner');
          if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
            // Use synchronous migration runner
            migrationRunner.runMigrationsSync();
            console.log('[database] Migrations completed successfully');

            // Also run performance index migration
            try {
              const { addPerformanceIndexesSync } = await import('./performance-indexes');
              addPerformanceIndexesSync(db);
              console.log('[database] Performance indexes added successfully');
            } catch (indexError) {
              // Performance indexes may already exist from base schema - this is OK
              if (!indexError.message?.includes('already exists')) {
                console.warn('[database] Performance index migration failed (indexes may already exist):', indexError);
              }
            }
          } else {
            console.log('[database] Migration runner not ready; migrations handled by run-migrations.js script.');
          }
        } else {
          console.log('[database] Auto-run migrations disabled via environment variable');
        }
      } catch (error: any) {
        // Only log if it's a real error, not module loading issues after successful migrations
        if (!error.message?.includes('Cannot find module')) {
          console.warn('[database] Migrations failed (continuing with base schema):', error);
        }
      }

      dbInitialized = true;
    }

    console.log('[DB] Database initialized successfully');
  } catch (error: any) {
    console.error('[DB] Database initialization failed:', error);
    dbInitializing = false;
    throw error;
  }
}

export async function initializeDatabaseAsync(): Promise<any> {
  const database = getDatabase();

  if (!dbInitialized) {
    await initializeSchema();
    dbInitialized = true;
  }

  return database;
}

async function initializeSchemaSync(): Promise<void> {
  if (!db) return;
  
  // Only run schema initialization in Node.js runtime
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Use require instead of dynamic import to avoid Edge Runtime analysis
    const fsModule = require('fs');
    const pathModule = require('path');
    const readFileSync = fsModule.readFileSync;
    const join = pathModule.join;

    // Get schema path at runtime
    const cwd = process.cwd?.();
    const schemaPath = cwd
      ? join(cwd, 'lib', 'database', 'schema.sql')
      : './lib/database/schema.sql';

    // Execute base schema to ensure required tables exist
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);

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

  // Load crypto module for encryption operations
  const crypto = require('crypto');

  try {
    // Get all API credentials
    const stmt = db.prepare('SELECT id, user_id, provider, api_key_encrypted FROM api_credentials WHERE is_active = TRUE');
    const credentials = stmt.all() as Array<{ id: number; user_id: number; provider: string; api_key_encrypted: string }>;

    for (const cred of credentials) {
      try {
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
  private db: any;
  private dbReady: Promise<void>;
  
  // PREPARED STATEMENTS CACHE - create once, reuse infinitely
  // This avoids recreating prepared statements on every call
  private preparedStatements: Map<string, any> = new Map();
  private preparedStatementsInitialized = false;
  
  private getPrepared(name: string, sql: string): any {
    // Check if statement exists and database is still valid
    if (!this.preparedStatementsInitialized || !this.db) {
      this.initializePreparedStatements();
    }
    
    if (!this.preparedStatements.has(name)) {
      this.preparedStatements.set(name, this.db.prepare(sql));
    }
    return this.preparedStatements.get(name);
  }

  constructor() {
    // Use mock database initially to avoid blocking on database initialization
    this.db = getMockDatabase();
    
    // Get real database synchronously (may be null on first call)
    const realDb = getDatabase();
    
    if (realDb) {
      // Database already initialized
      this.db = realDb;
      this.initializePreparedStatements();
    } else {
      // Database not ready yet - will use mock database until it's ready
      // The next request will get the real database
      console.warn('[DatabaseOperations] Database not ready, using mock database for this request');
    }
  }
  
  private initializePreparedStatements(): void {
    if (this.preparedStatementsInitialized) {
      return; // Already initialized
    }
    
    // Clear existing statements in case of reconnection
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
   * Reinitialize prepared statements after database reconnection
   * Call this if the database connection is lost and re-established
   */
  async reinitializeAfterReconnection(): Promise<void> {
    this.preparedStatementsInitialized = false;
    this.preparedStatements.clear();
    this.db = await getDatabase();
    this.initializePreparedStatements();
  }

  /**
   * Get the underlying database instance (for advanced operations).
   */
  getDb(): any {
    return this.db;
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
