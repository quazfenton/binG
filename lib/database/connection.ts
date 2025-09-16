import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as crypto from 'crypto';

// Database configuration
const DB_PATH = process.env.DATABASE_PATH || join(process.cwd(), 'data', 'binG.db');
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-char-secret-key-here-change-this';

// Ensure the encryption key is 32 bytes
const encryptionKey = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));

// Initialize database
let db: Database.Database | null = null;

let dbInitialized = false;

export function getDatabase(): Database.Database {
  if (!db) {
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
      
      // Initialize schema synchronously first time
      if (!dbInitialized) {
        initializeSchemaSync();
        dbInitialized = true;
      }
      
      console.log('Database initialized successfully');
    } catch (error) {
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
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    
    // Execute base schema
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
  const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
  
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
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Database operations
export class DatabaseOperations {
  private db: Database.Database;
  
  constructor() {
    this.db = getDatabase();
  }
  
  // User operations
  createUser(email: string, username: string, passwordHash: string) {
    const stmt = this.db.prepare(`
      INSERT INTO users (email, username, password_hash)
      VALUES (?, ?, ?)
    `);
    
    return stmt.run(email, username, passwordHash);
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