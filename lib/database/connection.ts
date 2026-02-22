import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

// Database configuration
const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'binG.db');

// Encryption key - MUST be set via environment variable in production
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Ensure the encryption key is 32 bytes (pad or truncate as needed)
const encryptionKey = (() => {
  if (!ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production');
    }
    console.warn('⚠️  WARNING: ENCRYPTION_KEY not set! Using insecure fallback for development only.');
    console.warn('Set ENCRYPTION_KEY environment variable to a secure 32+ character random string.');
    console.warn('Example: ENCRYPTION_KEY=$(openssl rand -hex 32)');
    return Buffer.from('default-insecure-key-change-me!!'); // exactly 32 bytes
  }
  return Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
})();

/**
 * Create a mock database object for use during build or while migrations are pending
 */
function getMockDatabase(): Database.Database {
  const mockDb: Partial<Database.Database> = {
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
      } as any;
    },
    exec: () => mockDb as Database.Database,
    pragma: () => {},
    transaction: (fn: any) => fn,
    close: () => {},
    backup: () => Promise.resolve({ progress: () => {} }),
    defaultSafeIntegers: () => mockDb as Database.Database,
    register: () => mockDb as Database.Database,
    loadExtension: () => mockDb as Database.Database,
    serialize: () => Buffer.alloc(0),
    table: () => null,
    function: () => mockDb as Database.Database,
    aggregate: () => mockDb as Database.Database,
    unsafeMode: () => mockDb as Database.Database,
  };

  return mockDb as Database.Database;
}

// Initialize database
let db: Database.Database | null = null;

let dbInitialized = false;

export function getDatabase(): Database.Database {
  if (!db) {
    // Skip database initialization during build process
    if (process.env.SKIP_DB_INIT) {
      // Return a mock database object during build time
      // This allows the build to proceed without requiring the native module
      console.log('Skipping database initialization during build');
      return getMockDatabase();
    }

    try {
      // Create data directory if it doesn't exist
      const { mkdirSync } = require('fs');
      const { dirname } = require('path');
      mkdirSync(dirname(DB_PATH), { recursive: true });

      db = new Database(DB_PATH);

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

        // SECURITY: Run migrations SYNCHRONOUSLY to prevent race conditions
        // Without this, requests can execute before migrations complete, causing
        // "no such column" errors for migration-added columns like email_verification_token
        try {
          // Require here to avoid circular import at module load time
          const { migrationRunner } = require('./migration-runner');
          if (migrationRunner && typeof migrationRunner.runMigrationsSync === 'function') {
            // Use synchronous migration runner
            migrationRunner.runMigrationsSync();
            console.log('[database] Migrations completed successfully');
          } else {
            console.warn('[database] Migration runner not ready during initial database setup; migrations will be handled by the migration runner module.');
          }
        } catch (error) {
          console.warn('[database] Migrations failed (continuing with base schema):', error);
        }

        dbInitialized = true;
      }

      console.log('Database initialized successfully');
    } catch (error: any) {
      // Handle native module binding errors gracefully
      const isNativeModuleError = error.message?.includes('Could not locate the bindings file') ||
                                  error.message?.includes('better_sqlite3.node');

      if (isNativeModuleError) {
        console.warn('Database native module not available. Running in mock mode.');
        console.warn('To fix: run `pnpm rebuild better-sqlite3` or set SKIP_DB_INIT=true');

        // Return mock database for graceful degradation
        return getMockDatabase();
      }
      
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  return db;
}

export async function initializeDatabaseAsync(): Promise<Database.Database> {
  const database = getDatabase();
  
  if (!dbInitialized) {
    await initializeSchema();
    dbInitialized = true;
  }
  
  return database;
}

function initializeSchemaSync() {
  if (!db) return;

  try {
    // Execute base schema to ensure required tables exist
    const schemaPath = join(process.cwd(), 'lib', 'database', 'schema.sql');
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

// Encryption utilities for API keys
export function encryptApiKey(apiKey: string): { encrypted: string; hash: string } {
  const iv = crypto.randomBytes(16);
  // Use createCipheriv which properly uses the IV (non-deprecated)
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);

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
  const [ivHex, encrypted] = encryptedData.split(':');

  // Try new format first (createCipheriv with proper IV usage)
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (newFormatError) {
    // New format failed - try legacy format (createCipher with EVP_BytesToKey)
    // Legacy data also has IV:encrypted format, but the IV was randomly generated and unused
    // createCipher derived both key and IV from the password using MD5
    try {
      const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      // SECURITY WARNING: Legacy format detected
      // This data was encrypted with deprecated createDecipher using MD5 key derivation
      // which is vulnerable to known-plaintext attacks.
      // 
      // ACTION REQUIRED: Re-encrypt this API key using the secure format by calling
      // encryptApiKey() with the decrypted value and updating the database record.
      // 
      // The legacy fallback will be removed in a future version.
      console.warn(
        '[decryptApiKey] ⚠️  SECURITY WARNING: Legacy encryption format detected!',
        'Data encrypted with deprecated createDecipher (MD5 key derivation) is vulnerable.',
        'Please migrate this API key by re-encrypting with encryptApiKey() and updating the database.',
        'Legacy support will be removed in a future release.'
      );

      return decrypted;
    } catch (legacyError) {
      // Both formats failed - this is truly corrupted data
      console.error('[decryptApiKey] Failed to decrypt: both new and legacy formats failed');
      throw new Error('Failed to decrypt API key: data may be corrupted');
    }
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
          crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
          // If this succeeds, it's new format - skip
          continue;
        } catch {
          // New format failed, this is legacy - migrate it
          const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');

          // Re-encrypt with secure format
          const { encrypted: newEncrypted } = encryptApiKey(decrypted);

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
  private db: Database.Database;
  
  constructor() {
    this.db = getDatabase();
  }
  
  // User operations
  createUser(email: string, username: string, passwordHash: string) {
    // Handle empty username - set to NULL to avoid unique constraint conflicts
    const finalUsername = username.trim() || null;
    
    const stmt = this.db.prepare(`
      INSERT INTO users (email, username, password_hash)
      VALUES (?, ?, ?)
    `);

    return stmt.run(email, finalUsername, passwordHash);
  }

  createUserWithVerification(email: string, username: string, passwordHash: string, verificationToken: string, verificationExpires: Date) {
    // Handle empty username - set to NULL to avoid unique constraint conflicts
    const finalUsername = username.trim() || null;
    
    const stmt = this.db.prepare(`
      INSERT INTO users (email, username, password_hash, email_verification_token, email_verification_expires, email_verified)
      VALUES (?, ?, ?, ?, ?, FALSE)
    `);

    return stmt.run(email, finalUsername, passwordHash, verificationToken, verificationExpires.toISOString());
  }
  
  getUserByEmail(email: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE email = ? AND is_active = TRUE
    `);
    
    return stmt.get(email);
  }
  
  getUserById(id: number) {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE id = ? AND is_active = TRUE
    `);
    
    return stmt.get(id);
  }
  
  // API credentials operations
  saveApiCredential(userId: number, provider: string, apiKey: string) {
    const { encrypted, hash } = encryptApiKey(apiKey);
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO api_credentials 
      (user_id, provider, api_key_encrypted, api_key_hash, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    return stmt.run(userId, provider, encrypted, hash);
  }
  
  getApiCredential(userId: number, provider: string): string | null {
    const stmt = this.db.prepare(`
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
  
  getConversation(id: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND is_archived = FALSE
    `);
    
    return stmt.get(id);
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
  saveMessage(id: string, conversationId: string, role: string, content: string, provider?: string, model?: string) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, provider, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    return stmt.run(id, conversationId, role, content, provider, model);
  }
  
  getConversationMessages(conversationId: string) {
    const stmt = this.db.prepare(`
      SELECT * FROM messages 
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    
    return stmt.all(conversationId);
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
    const stmt = this.db.prepare(`
      INSERT INTO user_sessions (id, user_id, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    return stmt.run(sessionId, userId, expiresAt.toISOString(), ipAddress, userAgent);
  }
  
  getSession(sessionId: string) {
    const stmt = this.db.prepare(`
      SELECT s.*, u.email, u.username, u.subscription_tier
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE
    `);
    
    return stmt.get(sessionId);
  }
  
  deleteSession(sessionId: string) {
    const stmt = this.db.prepare(`
      DELETE FROM user_sessions WHERE id = ?
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

// Graceful shutdown
process.on('SIGINT', () => {
  if (db) {
    db.close();
    console.log('Database connection closed.');
  }
  process.exit(0);
});

export default getDatabase;
