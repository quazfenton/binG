// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

import { virtualFilesystem } from './virtual-filesystem-service';
import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';
import { filesystemEditDatabase } from './filesystem-edit-database';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('FilesystemEditSession');

export type FilesystemEditOperationType = 'write' | 'patch' | 'delete';
export type FilesystemEditTransactionStatus =
  | 'auto_applied'
  | 'accepted'
  | 'denied'
  | 'reverted_with_conflicts';

export interface FilesystemEditOperationRecord {
  path: string;
  operation: FilesystemEditOperationType;
  newVersion: number;
  previousVersion: number | null;
  previousContent: string | null;
  existedBefore: boolean;
}

export interface FilesystemEditTransaction {
  id: string;
  ownerId: string;
  conversationId: string;
  requestId: string;
  createdAt: string;
  status: FilesystemEditTransactionStatus;
  operations: FilesystemEditOperationRecord[];
  errors: string[];
  deniedReason?: string;
}

export interface FilesystemEditDenialRecord {
  transactionId: string;
  conversationId: string;
  timestamp: string;
  reason: string;
  paths: string[];
}

export interface DenyFilesystemEditResult {
  transaction: FilesystemEditTransaction;
  revertedPaths: string[];
  conflicts: string[];
}

class FilesystemEditSessionService {
  private transactions = new Map<string, FilesystemEditTransaction>();
  private denialHistoryByConversation = new Map<string, FilesystemEditDenialRecord[]>();
  private db: ReturnType<typeof getDatabase> | null = null;
  private initialized = false;

  /**
   * Initialize database schema for transaction persistence
   */
  private ensureInitialized(): void {
    if (this.initialized) return;

    try {
      this.db = getDatabase();
      
      // Handle case where database is not yet initialized
      if (!this.db) {
        console.warn('[FilesystemEditSession] Database not ready, using in-memory only');
        this.initialized = true;
        return;
      }
      
      // filesystem-edit-schema.sql defines fs_edit_transactions + fs_edit_denials
      execSchemaFile(this.db, 'filesystem-edit-schema');

      // Load existing transactions from database
      this.loadTransactionsFromDb();
      
      this.initialized = true;
    } catch (error) {
      console.warn('[FilesystemEditSession] DB init failed, using in-memory only:', error);
      this.db = null;
      this.initialized = true;
    }
  }

  /**
   * Load transactions from database on startup
   */
  private loadTransactionsFromDb(): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM fs_edit_transactions
        WHERE status IN ('auto_applied', 'accepted')
        AND datetime(created_at) > datetime('now', '-24 hours')
        ORDER BY created_at DESC
        LIMIT 100
      `);

      // Type-safe database row interface
      interface TransactionRow {
        id: string;
        owner_id: string;
        conversation_id: string;
        request_id: string;
        created_at: string;
        status: string;
        operations_json: string;
        errors_json: string;
        denied_reason: string | null;
      }

      const rows = stmt.all() as TransactionRow[];
      for (const row of rows) {
        try {
          const tx: FilesystemEditTransaction = {
            id: row.id,
            ownerId: row.owner_id,
            conversationId: row.conversation_id,
            requestId: row.request_id,
            createdAt: row.created_at,
            status: row.status as FilesystemEditTransactionStatus,
            operations: JSON.parse(row.operations_json || '[]'),
            errors: JSON.parse(row.errors_json || '[]'),
            deniedReason: row.denied_reason || undefined,
          };
          this.transactions.set(tx.id, tx);
        } catch (parseError) {
          console.warn('[FilesystemEditSession] Failed to parse transaction:', parseError);
        }
      }
      console.log(`[FilesystemEditSession] Loaded ${this.transactions.size} transactions from DB`);
    } catch (error) {
      console.warn('[FilesystemEditSession] Failed to load transactions:', error);
    }
  }

  /**
   * Persist transaction to database
   */
  private persistTransaction(tx: FilesystemEditTransaction): void {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO fs_edit_transactions 
        (id, owner_id, conversation_id, request_id, created_at, status, operations_json, errors_json, denied_reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(
        tx.id,
        tx.ownerId,
        tx.conversationId,
        tx.requestId,
        tx.createdAt,
        tx.status,
        JSON.stringify(tx.operations),
        JSON.stringify(tx.errors),
        tx.deniedReason || null
      );
    } catch (error) {
      console.warn('[FilesystemEditSession] Failed to persist transaction:', error);
    }
  }

  /**
   * Persist denial record to database
   */
  private persistDenial(record: FilesystemEditDenialRecord): void {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare(`
        INSERT INTO fs_edit_denials 
        (transaction_id, conversation_id, timestamp, reason, paths_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        record.transactionId,
        record.conversationId,
        record.timestamp,
        record.reason,
        JSON.stringify(record.paths)
      );
    } catch (error) {
      console.warn('[FilesystemEditSession] Failed to persist denial:', error);
    }
  }

  createTransaction(input: {
    ownerId: string;
    conversationId: string;
    requestId: string;
  }): FilesystemEditTransaction {
    const id = `fse_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const tx: FilesystemEditTransaction = {
      id,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
      status: 'auto_applied',
      operations: [],
      errors: [],
    };
    this.transactions.set(id, tx);
    return tx;
  }

  /**
   * Record operation with size validation
   *
   * SECURITY: Validates operation count and total transaction size
   * 
   * @param transactionId - Transaction to record operation in
   * @param operation - Operation to record
   * @returns true if operation was recorded, false if validation failed
   */
  recordOperation(
    transactionId: string,
    operation: FilesystemEditOperationRecord,
  ): boolean {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      logger.warn(`[FilesystemEditSession] Cannot record operation: transaction ${transactionId} not found`);
      return false;
    }

    // Validate transaction can still be modified
    if (tx.status !== 'auto_applied') {
      logger.warn(`[FilesystemEditSession] Cannot record operation: transaction ${transactionId} already finalized (${tx.status})`);
      return false;
    }

    // SECURITY: Validate operation count limit
    const MAX_OPERATIONS_PER_TRANSACTION = 50;
    if (tx.operations.length >= MAX_OPERATIONS_PER_TRANSACTION) {
      tx.errors.push(`Too many operations: ${tx.operations.length + 1} (max ${MAX_OPERATIONS_PER_TRANSACTION})`);
      console.warn(`[FilesystemEditSession] Operation limit exceeded for transaction ${transactionId}`);
      return false;
    }

    // SECURITY: Validate total transaction size (10MB limit)
    const MAX_TRANSACTION_SIZE_BYTES = 10 * 1024 * 1024;
    const currentSize = JSON.stringify([...tx.operations, operation]).length;
    if (currentSize > MAX_TRANSACTION_SIZE_BYTES) {
      tx.errors.push(
        `Transaction too large: ${(currentSize / 1024).toFixed(2)}KB (max ${MAX_TRANSACTION_SIZE_BYTES / 1024}KB)`
      );
      console.warn(`[FilesystemEditSession] Transaction size limit exceeded for ${transactionId}`);
      return false;
    }

    tx.operations.push(operation);
    return true;
  }

  /**
   * Add error to transaction with validation
   */
  addError(transactionId: string, message: string): boolean {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      logger.warn(`[FilesystemEditSession] Cannot add error: transaction ${transactionId} not found`);
      return false;
    }
    tx.errors.push(message);
    return true;
  }

  /**
   * Accept a transaction (commit changes permanently)
   * 
   * RACE CONDITION PROTECTION: Checks if transaction is already finalized
   * before accepting to prevent concurrent accept/deny issues.
   * 
   * MEMORY CLEANUP: Schedules transaction for removal after 1 hour.
   */
  acceptTransaction(transactionId: string): FilesystemEditTransaction | null {
    const tx = this.transactions.get(transactionId);
    if (!tx) {
      logger.warn(`[FilesystemEditSession] Cannot accept: transaction ${transactionId} not found`);
      return null;
    }

    // RACE CONDITION: Check if already finalized
    if (tx.status === 'denied' || tx.status === 'reverted_with_conflicts') {
      logger.warn(`[FilesystemEditSession] Cannot accept: transaction ${transactionId} already finalized (${tx.status})`);
      return tx;
    }

    // RACE CONDITION: Check if already accepted
    if (tx.status === 'accepted') {
      logger.debug(`[FilesystemEditSession] Transaction ${transactionId} already accepted`);
      return tx;
    }

    tx.status = 'accepted';

    // Persist to database
    filesystemEditDatabase.persistTransaction(tx);

    // MEMORY CLEANUP: Schedule removal from in-memory map after 1 hour
    // (already persisted to DB, this prevents memory leaks)
    setTimeout(() => {
      this.transactions.delete(transactionId);
      logger.debug(`[FilesystemEditSession] Cleaned up accepted transaction ${transactionId} from memory`);
    }, 60 * 60 * 1000); // 1 hour

    return tx;
  }

  /**
   * Deny a transaction (rollback changes with conflict detection)
   * 
   * RACE CONDITION PROTECTION: Checks if transaction is already finalized
   * before denying to prevent concurrent accept/deny issues.
   * 
   * MEMORY CLEANUP: Schedules transaction for removal after 1 hour.
   */
  async denyTransaction(input: {
    transactionId: string;
    reason?: string;
  }): Promise<DenyFilesystemEditResult | null> {
    // Use getTransaction to support both in-memory and database-persisted transactions
    const tx = await this.getTransaction(input.transactionId);
    if (!tx) {
      logger.warn(`[FilesystemEditSession] Cannot deny: transaction ${input.transactionId} not found`);
      return null;
    }

    // RACE CONDITION: Check if already finalized
    if (tx.status === 'denied' || tx.status === 'reverted_with_conflicts') {
      logger.warn(`[FilesystemEditSession] Cannot deny: transaction ${input.transactionId} already finalized (${tx.status})`);
      return {
        transaction: tx,
        revertedPaths: [],
        conflicts: [],
      };
    }

    // RACE CONDITION: Check if already accepted
    if (tx.status === 'accepted') {
      logger.warn(`[FilesystemEditSession] Cannot deny: transaction ${input.transactionId} already accepted`);
      return {
        transaction: tx,
        revertedPaths: [],
        conflicts: ['Transaction already accepted, cannot deny'],
      };
    }

    const revertedPaths: string[] = [];
    const conflicts: string[] = [];

    // Try Git-backed VFS rollback first (if previous version is available)
    const useGitRollback = tx.operations.length > 0 && tx.operations[0].previousVersion != null;
    
    if (useGitRollback) {
      try {
        // Get the target version (minimum previousVersion across all operations)
        const versionsWithPrevious = tx.operations.filter(op => op.previousVersion != null);

        if (versionsWithPrevious.length === 0) {
          // No previous versions to rollback to, use manual revert
          throw new Error('No previous versions available for rollback');
        }

        const targetVersion = Math.min(
          ...versionsWithPrevious.map(op => op.previousVersion!)
        );

        // Get current workspace version
        const currentVersion = await virtualFilesystem.getWorkspaceVersion(tx.ownerId);
        
        // CRITICAL: Check if workspace has newer edits after this transaction
        // If current version > transaction's highest version, other edits exist
        const transactionTip = Math.max(...tx.operations.map((op) => op.newVersion));
        
        if (currentVersion > transactionTip) {
          // Workspace has been modified since this transaction - manual revert is safer
          logger.warn('[FilesystemEditSession] Workspace has newer edits, using manual revert to avoid collateral damage', {
            transactionId: input.transactionId,
            transactionTip,
            currentVersion,
          });
          throw new Error('Workspace has newer edits, using manual revert');
        }

        // Only rollback if target version is different from current
        if (targetVersion < currentVersion) {
          logger.info('[FilesystemEditSession] Using Git-backed rollback', {
            transactionId: input.transactionId,
            targetVersion,
            currentVersion,
            operationCount: versionsWithPrevious.length,
          });

          // Use the existing VFS rollback method
          const rollbackResult = await virtualFilesystem.rollbackToVersion(tx.ownerId, targetVersion);

          if (rollbackResult.success && rollbackResult.restoredFiles > 0) {
            // Mark all successfully rolled back files
            revertedPaths.push(
              ...versionsWithPrevious.map(op => op.path)
            );

            tx.deniedReason = input.reason?.trim() || 'User denied AI file edits';
            tx.status = 'denied';

            const denialRecord: FilesystemEditDenialRecord = {
              transactionId: tx.id,
              conversationId: tx.conversationId,
              timestamp: new Date().toISOString(),
              reason: tx.deniedReason,
              paths: tx.operations.map((op) => op.path),
            };

            // Persist transaction and denial to database
            filesystemEditDatabase.persistTransaction(tx);
            filesystemEditDatabase.persistDenial(denialRecord);

            const denialList = this.denialHistoryByConversation.get(tx.conversationId) || [];
            denialList.push(denialRecord);
            this.denialHistoryByConversation.set(
              tx.conversationId,
              denialList.slice(-20),
            );

            logger.info('[FilesystemEditSession] Git rollback successful', {
              restoredFiles: rollbackResult.restoredFiles,
              deletedFiles: rollbackResult.deletedFiles,
              conflicts: rollbackResult.errors?.length || 0,
            });

            return {
              transaction: tx,
              revertedPaths,
              conflicts: rollbackResult.errors || [],
            };
          } else {
            // Rollback returned no restored files, fall back to manual
            logger.warn('[FilesystemEditSession] Git rollback returned no restored files, using manual revert');
          }
        } else {
          logger.info('[FilesystemEditSession] Target version equals current version, using manual revert');
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        logger.warn('[FilesystemEditSession] Git rollback failed, falling back to manual revert:', message);
        // Fall through to manual revert logic below
      }
    }

    // Manual revert (fallback for when Git rollback is not available)
    for (let i = tx.operations.length - 1; i >= 0; i -= 1) {
      const op = tx.operations[i];

      try {
        if (op.operation === 'delete') {
          if (!op.existedBefore) {
            continue;
          }
          await virtualFilesystem.writeFile(
            tx.ownerId,
            op.path,
            op.previousContent || '',
          );
          revertedPaths.push(op.path);
          continue;
        }

        const currentFile = await virtualFilesystem.readFile(tx.ownerId, op.path);
        if (currentFile.version !== op.newVersion) {
          conflicts.push(
            `${op.path} changed after AI edit (expected v${op.newVersion}, found v${currentFile.version})`,
          );
          continue;
        }

        if (!op.existedBefore) {
          await virtualFilesystem.deletePath(tx.ownerId, op.path);
          revertedPaths.push(op.path);
          continue;
        }

        await virtualFilesystem.writeFile(
          tx.ownerId,
          op.path,
          op.previousContent || '',
        );
        revertedPaths.push(op.path);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'unknown error';
        conflicts.push(`${op.path} revert failed: ${message}`);
      }
    }

    tx.deniedReason = input.reason?.trim() || 'User denied AI file edits';
    tx.status = conflicts.length > 0 ? 'reverted_with_conflicts' : 'denied';

    const denialRecord: FilesystemEditDenialRecord = {
      transactionId: tx.id,
      conversationId: tx.conversationId,
      timestamp: new Date().toISOString(),
      reason: tx.deniedReason,
      paths: tx.operations.map((op) => op.path),
    };

    // Persist transaction and denial to database
    filesystemEditDatabase.persistTransaction(tx);
    filesystemEditDatabase.persistDenial(denialRecord);

    const denialList = this.denialHistoryByConversation.get(tx.conversationId) || [];
    denialList.push(denialRecord);
    this.denialHistoryByConversation.set(
      tx.conversationId,
      denialList.slice(-20),
    );

    // MEMORY CLEANUP: Schedule removal from in-memory map after 1 hour
    // (already persisted to DB, this prevents memory leaks)
    setTimeout(() => {
      this.transactions.delete(tx.id);
      logger.debug(`[FilesystemEditSession] Cleaned up denied transaction ${tx.id} from memory`);
    }, 60 * 60 * 1000); // 1 hour

    return {
      transaction: tx,
      revertedPaths,
      conflicts,
    };
  }

  async getRecentDenials(conversationId: string, limit = 3): Promise<FilesystemEditDenialRecord[]> {
    // Try database first for persistence
    const dbDenials = await filesystemEditDatabase.getDenialsByConversation(conversationId);
    if (dbDenials.length > 0) {
      return dbDenials.slice(-Math.max(1, limit));
    }

    // Fallback to in-memory
    const list = this.denialHistoryByConversation.get(conversationId) || [];
    return list.slice(-Math.max(1, limit));
  }
  
  /**
   * Get transaction by ID synchronously (in-memory only, for auto-commit)
   */
  getTransactionSync(transactionId: string): FilesystemEditTransaction | null {
    return this.transactions.get(transactionId) || null;
  }

  /**
   * Get transaction by ID (from database or memory)
   */
  async getTransaction(transactionId: string): Promise<FilesystemEditTransaction | null> {
    // Try database first for persistence
    const dbTx = await filesystemEditDatabase.getTransaction(transactionId);
    if (dbTx) {
      // Also keep in memory for quick access
      this.transactions.set(transactionId, dbTx);
      return dbTx;
    }

    // Fallback to in-memory
    return this.transactions.get(transactionId) || null;
  }

  /**
   * Clean up old transactions from memory (not database)
   * 
   * Call this periodically to prevent memory leaks.
   * Transactions older than maxAgeHours are removed from the in-memory Map.
   * Database records are preserved for persistence.
   * 
   * @param maxAgeHours - Maximum age in hours (default: 24)
   * @returns Number of transactions cleaned up
   */
  cleanupOldTransactions(maxAgeHours = 24): number {
    const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, tx] of this.transactions.entries()) {
      const txTime = new Date(tx.createdAt).getTime();
      if (txTime < cutoff) {
        this.transactions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[FilesystemEditSession] Cleaned up ${cleaned} old transactions (older than ${maxAgeHours}h)`);
    }

    return cleaned;
  }
}

export const filesystemEditSessionService = new FilesystemEditSessionService();
