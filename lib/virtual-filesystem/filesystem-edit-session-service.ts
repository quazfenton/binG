import { virtualFilesystem } from './virtual-filesystem-service';

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

  recordOperation(
    transactionId: string,
    operation: FilesystemEditOperationRecord,
  ): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) return;
    tx.operations.push(operation);
  }

  addError(transactionId: string, message: string): void {
    const tx = this.transactions.get(transactionId);
    if (!tx) return;
    tx.errors.push(message);
  }

  getTransaction(transactionId: string): FilesystemEditTransaction | null {
    return this.transactions.get(transactionId) || null;
  }

  acceptTransaction(transactionId: string): FilesystemEditTransaction | null {
    const tx = this.transactions.get(transactionId);
    if (!tx) return null;
    if (tx.status === 'denied' || tx.status === 'reverted_with_conflicts') {
      return tx;
    }
    tx.status = 'accepted';
    return tx;
  }

  async denyTransaction(input: {
    transactionId: string;
    reason?: string;
  }): Promise<DenyFilesystemEditResult | null> {
    const tx = this.transactions.get(input.transactionId);
    if (!tx) return null;

    const revertedPaths: string[] = [];
    const conflicts: string[] = [];

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

  getRecentDenials(conversationId: string, limit = 3): FilesystemEditDenialRecord[] {
    const list = this.denialHistoryByConversation.get(conversationId) || [];
    return list.slice(-Math.max(1, limit));
  }
}

export const filesystemEditSessionService = new FilesystemEditSessionService();
