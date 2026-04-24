// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

/**
 * Filesystem Edit Session Database Service
 *
 * Persists filesystem edit transactions to SQLite database
 * Provides durability across server restarts
 *
 * Features:
 * - Transaction persistence to database
 * - Denial history tracking
 * - Conflict detection
 * - Rollback support
 */

import { getDatabase } from '../database/connection';
import { execSchemaFile } from '../database/schema';
import type {
  FilesystemEditTransaction,
  FilesystemEditOperationRecord,
  FilesystemEditDenialRecord
} from './filesystem-edit-session-service';

export interface PersistedTransaction {
  id: string;
  owner_id: string;
  conversation_id: string;
  request_id: string;
  created_at: string;
  status: string;
  operations: string; // JSON string
  errors: string; // JSON string
  denied_reason?: string;
}

export interface PersistedDenial {
  transaction_id: string;
  conversation_id: string;
  timestamp: string;
  reason: string;
  paths: string; // JSON string
}

class FilesystemEditDatabaseService {
  private db: any = null;
  private initialized = false;

  /**
   * Ensure database schema exists
   */
  private ensureSchema(): void {
    if (!this.db) return;

    try {
      // filesystem-edit-schema.sql defines fs_edit_transactions + fs_edit_denials
      execSchemaFile(this.db, 'filesystem-edit-schema');
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to ensure schema:', error);
    }
  }

  /**
   * Get database connection lazily
   */
  private ensureDatabase(): void {
    if (this.db) return;

    try {
      this.db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!this.db) {
        console.warn('[FilesystemEditDB] Database not ready, using in-memory only');
        return;
      }
      
      this.ensureSchema();
      this.initialized = true;
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to initialize database:', error);
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Persist transaction to database
   */
  async persistTransaction(transaction: FilesystemEditTransaction): Promise<void> {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO filesystem_edit_transactions 
        (id, owner_id, conversation_id, request_id, created_at, status, operations, errors, denied_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        transaction.id,
        transaction.ownerId,
        transaction.conversationId,
        transaction.requestId,
        transaction.createdAt,
        transaction.status,
        JSON.stringify(transaction.operations),
        JSON.stringify(transaction.errors),
        transaction.deniedReason || null
      );
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to persist transaction:', error);
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(transactionId: string): Promise<FilesystemEditTransaction | null> {
    this.ensureDatabase();
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare('SELECT * FROM filesystem_edit_transactions WHERE id = ?');
      const row = stmt.get(transactionId) as PersistedTransaction | undefined;

      if (!row) return null;

      return {
        id: row.id,
        ownerId: row.owner_id,
        conversationId: row.conversation_id,
        requestId: row.request_id,
        createdAt: row.created_at,
        status: row.status as any,
        operations: JSON.parse(row.operations) as FilesystemEditOperationRecord[],
        errors: JSON.parse(row.errors) as string[],
        deniedReason: row.denied_reason || undefined,
      };
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to get transaction:', error);
      return null;
    }
  }

  /**
   * Get transactions by conversation ID
   */
  async getTransactionsByConversation(conversationId: string): Promise<FilesystemEditTransaction[]> {
    this.ensureDatabase();
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM filesystem_edit_transactions WHERE conversation_id = ? ORDER BY created_at DESC'
      );
      const rows = stmt.all(conversationId) as PersistedTransaction[];

      return rows.map(row => ({
        id: row.id,
        ownerId: row.owner_id,
        conversationId: row.conversation_id,
        requestId: row.request_id,
        createdAt: row.created_at,
        status: row.status as any,
        operations: JSON.parse(row.operations) as FilesystemEditOperationRecord[],
        errors: JSON.parse(row.errors) as string[],
        deniedReason: row.denied_reason || undefined,
      }));
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to get transactions:', error);
      return [];
    }
  }

  /**
   * Persist denial record
   */
  async persistDenial(denial: FilesystemEditDenialRecord): Promise<void> {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO filesystem_edit_denials (transaction_id, conversation_id, reason, paths)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(
        denial.transactionId,
        denial.conversationId,
        denial.reason,
        JSON.stringify(denial.paths)
      );
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to persist denial:', error);
    }
  }

  /**
   * Get denials by conversation ID
   */
  async getDenialsByConversation(conversationId: string): Promise<FilesystemEditDenialRecord[]> {
    this.ensureDatabase();
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM filesystem_edit_denials WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 20'
      );
      const rows = stmt.all(conversationId) as PersistedDenial[];

      return rows.map(row => ({
        transactionId: row.transaction_id,
        conversationId: row.conversation_id,
        timestamp: row.timestamp,
        reason: row.reason,
        paths: JSON.parse(row.paths) as string[],
      }));
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to get denials:', error);
      return [];
    }
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(transactionId: string, status: string): Promise<void> {
    this.ensureDatabase();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE filesystem_edit_transactions 
        SET status = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);

      stmt.run(status, transactionId);
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to update transaction status:', error);
    }
  }

  /**
   * Get recent transactions for owner
   */
  async getRecentTransactions(ownerId: string, limit: number = 10): Promise<FilesystemEditTransaction[]> {
    this.ensureDatabase();
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM filesystem_edit_transactions WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
      );
      const rows = stmt.all(ownerId, limit) as PersistedTransaction[];

      return rows.map(row => ({
        id: row.id,
        ownerId: row.owner_id,
        conversationId: row.conversation_id,
        requestId: row.request_id,
        createdAt: row.created_at,
        status: row.status as any,
        operations: JSON.parse(row.operations) as FilesystemEditOperationRecord[],
        errors: JSON.parse(row.errors) as string[],
        deniedReason: row.denied_reason || undefined,
      }));
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to get recent transactions:', error);
      return [];
    }
  }

  /**
   * Cleanup old transactions (older than 30 days)
   */
  async cleanupOldTransactions(daysOld: number = 30): Promise<number> {
    this.ensureDatabase();
    if (!this.db) return 0;

    try {
      const stmt = this.db.prepare(`
        DELETE FROM filesystem_edit_transactions 
        WHERE created_at < datetime('now', '-' || ? || ' days')
      `);

      const result = stmt.run(daysOld);
      return result.changes || 0;
    } catch (error: any) {
      console.error('[FilesystemEditDB] Failed to cleanup old transactions:', error);
      return 0;
    }
  }
}

export const filesystemEditDatabase = new FilesystemEditDatabaseService();
