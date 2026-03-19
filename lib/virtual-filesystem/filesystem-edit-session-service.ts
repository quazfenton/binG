import { virtualFilesystem } from './virtual-filesystem-service';
import { filesystemEditDatabase } from './filesystem-edit-database';
import { getDatabase } from '@/lib/database/connection';
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
      // Create table for persisting transactions
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fs_edit_transactions (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL,
          operations_json TEXT NOT NULL,
          errors_json TEXT NOT NULL,
          denied_reason TEXT,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fs_transactions_owner 
        ON fs_edit_transactions(owner_id)
      `);
      
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fs_transactions_conversation 
        ON fs_edit_transactions(conversation_id)
      `);
      
      // Create table for denial history
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS fs_edit_denials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          reason TEXT NOT NULL,
          paths_json TEXT NOT NULL
        )
      `);
      
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fs_denials_conversation 
        ON fs_edit_denials(conversation_id)
      `);
      
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
      
      const rows = stmt.all() as any[];
      for (const row of rows) {
        try {
          const tx: FilesystemEditTransaction = {
            id: row.id,
            ownerId: row.owner_id,
            conversationId: row.conversation_id,
            requestId: row.request_id,
            createdAt: row.created_at,
            status: row.status,
            operations: JSON.parse(row.operations_json || '[]'),
            errors: JSON.parse(row.errors_json || '[]'),
            deniedReason: row.denied_reason,
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
   */
  recordOperation(
    transactionId: string,
    operation: FilesystemEditOperationRecord,
  ): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) return;

    // SECURITY: Validate operation count limit
    const MAX_OPERATIONS_PER_TRANSACTION = 50;
    if (tx.operations.length >= MAX_OPERATIONS_PER_TRANSACTION) {
      tx.errors.push(`Too many operations: ${tx.operations.length + 1} (max ${MAX_OPERATIONS_PER_TRANSACTION})`);
      console.warn(`[FilesystemEditSession] Operation limit exceeded for transaction ${transactionId}`);
      return;
    }

    // SECURITY: Validate total transaction size (10MB limit)
    const MAX_TRANSACTION_SIZE_BYTES = 10 * 1024 * 1024;
    const currentSize = JSON.stringify([...tx.operations, operation]).length;
    if (currentSize > MAX_TRANSACTION_SIZE_BYTES) {
      tx.errors.push(
        `Transaction too large: ${(currentSize / 1024).toFixed(2)}KB (max ${MAX_TRANSACTION_SIZE_BYTES / 1024}KB)`
      );
      console.warn(`[FilesystemEditSession] Transaction size limit exceeded for ${transactionId}`);
      return;
    }

    tx.operations.push(operation);
  }

  addError(transactionId: string, message: string): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) return;
    tx.errors.push(message);
  }

  acceptTransaction(transactionId: string): FilesystemEditTransaction | null {
    const tx = this.transactions.get(transactionId);
    if (!tx) return null;
    if (tx.status === 'denied' || tx.status === 'reverted_with_conflicts') {
      return tx;
    }
    tx.status = 'accepted';

    // Persist to database
    filesystemEditDatabase.persistTransaction(tx);

    // Remove from in-memory map to prevent memory leak (already persisted to DB)
    this.transactions.delete(transactionId);

    return tx;
  }

  async denyTransaction(input: {
    transactionId: string;
    reason?: string;
  }): Promise<DenyFilesystemEditResult | null> {
    // Use getTransaction to support both in-memory and database-persisted transactions
    const tx = await this.getTransaction(input.transactionId);
    if (!tx) return null;

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
}

export const filesystemEditSessionService = new FilesystemEditSessionService();
