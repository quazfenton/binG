/**
 * Virtual Filesystem Batch Operations
 * 
 * Provides efficient batch file operations for the virtual filesystem.
 * Reduces overhead by batching multiple operations into single transactions.
 * 
 * @see {@link ../virtual-filesystem-service} Base VFS service
 */

import type { VirtualFile } from './filesystem-types';
import { virtualFilesystem } from './virtual-filesystem-service';
import { sandboxPersistenceManager } from '@/lib/storage/persistence-manager';
import { getVfsLimiter, VFS_CAP_DEFAULT } from '@/lib/vfs/concurrency-cap';

/**
 * Batch file operation
 */
export interface BatchFileOperation {
  /**
   * File path
   */
  path: string;
  
  /**
   * File content
   */
  content: string;
  
  /**
   * Operation type
   * @default 'write'
   */
  type?: 'write' | 'delete';
}

/**
 * Batch operation result
 */
export interface BatchOperationResult {
  /**
   * Whether batch succeeded
   */
  success: boolean;
  
  /**
   * Files processed
   */
  processed: Array<{
    path: string;
    success: boolean;
    error?: string;
  }>;
  
  /**
   * Total files in batch
   */
  totalFiles: number;
  
  /**
   * Successful operations
   */
  successful: number;
  
  /**
   * Failed operations
   */
  failed: number;
  
  /**
   * Execution duration
   */
  duration: number;
  
  /**
   * Error message if batch failed
   */
  error?: string;
}

/**
 * Search and replace configuration
 */
export interface SearchReplaceConfig {
  /**
   * Pattern to search for
   */
  pattern: string;
  
  /**
   * Replacement string
   */
  replacement: string;
  
  /**
   * File patterns to include
   */
  include?: string[];
  
  /**
   * File patterns to exclude
   */
  exclude?: string[];
  
  /**
   * Whether to use regex
   * @default false
   */
  useRegex?: boolean;
  
  /**
   * Whether to replace all occurrences
   * @default false
   */
  replaceAll?: boolean;
}

/**
 * Search and replace result
 */
export interface SearchReplaceResult {
  /**
   * Files modified
   */
  modified: Array<{
    path: string;
    replacements: number;
  }>;
  
  /**
   * Total replacements made
   */
  totalReplacements: number;
  
  /**
   * Files scanned
   */
  filesScanned: number;
}

/**
 * Batch operation type
 */
export type BatchOperationType = 'create' | 'update' | 'delete' | 'read';

/**
 * Queued batch operation
 */
export interface QueuedBatchOperation {
  type: BatchOperationType;
  path: string;
  content?: string;
}

/**
 * Batch operation execution result
 */
export interface BatchExecutionResult {
  success: boolean;
  file?: VirtualFile;
  error?: string;
}

/**
 * Batch validation result
 */
export interface BatchValidationResult {
  valid: boolean;
  errors: Array<{ operation: number; message: string }>;
}

/**
 * Batch operation summary
 */
export interface BatchSummary {
  total: number;
  creates: number;
  updates: number;
  deletes: number;
  reads: number;
}

/**
 * VFS Batch Operations Manager
 *
 * Provides fluent API for batching file operations.
 */
export class VFSBatchOperations {
  private ownerId: string;
  private _operations: QueuedBatchOperation[] = [];

  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  /**
   * Get queued operations
   */
  get operations(): QueuedBatchOperation[] {
    return this._operations;
  }

  /**
   * Queue a file creation
   */
  create(path: string, content: string): this {
    this._operations.push({ type: 'create', path, content });
    return this;
  }

  /**
   * Queue a file update
   */
  update(path: string, content: string): this {
    this._operations.push({ type: 'update', path, content });
    return this;
  }

  /**
   * Queue a file deletion
   */
  delete(path: string): this {
    this._operations.push({ type: 'delete', path });
    return this;
  }

  /**
   * Queue a file read
   */
  read(path: string): this {
    this._operations.push({ type: 'read', path });
    return this;
  }

  /**
   * Execute all queued operations
   */
  async execute(vfs: any): Promise<BatchExecutionResult[]> {
    const results: BatchExecutionResult[] = [];

    // Meta #2 cap (audit 2026-06-20): bound concurrent file ops in execute()
    // to avoid Node fd exhaustion under large batches. Use permits=1 to
    // preserve operation ordering since queued operations may have implicit
    // dependencies (e.g. create then read the same path). Per-operation
    // Semaphore (not singleton) — see /opt/bing/web/lib/vfs/concurrency-cap.ts.
    const limit25 = getVfsLimiter({ inputSize: 1 });
    const opResults25 = await Promise.all(
      this._operations.map(op => limit25.runExclusive(async () => {
        try {
          let file: VirtualFile | undefined;
          switch (op.type) {
            case 'create':
            case 'update':
              file = await vfs.writeFile(this.ownerId, op.path, op.content!);
              break;
            case 'delete':
              await vfs.deletePath(this.ownerId, op.path);
              break;
            case 'read':
              file = await vfs.readFile(this.ownerId, op.path);
              break;
          }
          return { success: true as const, file };
        } catch (err: any) {
          return { success: false as const, error: err.message };
        }
      }))
    );
    // Promise.all preserves input order; results array inherits order.
    for (const r of opResults25) results.push(r);

    return results;
  }

  /**
   * Validate all queued operations
   */
  validate(): BatchValidationResult {
    const errors: Array<{ operation: number; message: string }> = [];

    this._operations.forEach((op, index) => {
      if (!op.path || op.path.trim().length === 0) {
        errors.push({ operation: index, message: 'Path cannot be empty' });
      }

      // Validate path format - reject directory traversal attempts
      if (op.path && /(^|\/|\\)\.\.(\/|\\|$)/.test(op.path)) {
        errors.push({ operation: index, message: 'Invalid path: directory traversal not allowed' });
      }

      // Allow empty string content (empty files are valid), but reject undefined/null
      if ((op.type === 'create' || op.type === 'update') && op.content == null) {
        errors.push({ operation: index, message: 'Content is required for create/update' });
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Clear all queued operations
   */
  clear(): void {
    this._operations = [];
  }

  /**
   * Get summary of queued operations
   */
  getSummary(): BatchSummary {
    const summary: BatchSummary = {
      total: this._operations.length,
      creates: 0,
      updates: 0,
      deletes: 0,
      reads: 0,
    };

    this._operations.forEach(op => {
      if (op.type === 'create') summary.creates++;
      else if (op.type === 'update') summary.updates++;
      else if (op.type === 'delete') summary.deletes++;
      else if (op.type === 'read') summary.reads++;
    });

    return summary;
  }

  /**
   * Execute batch write with incremental optimization
   */
  async batchWriteIncremental(
    operations: BatchFileOperation[],
    sandboxId?: string
  ): Promise<BatchOperationResult> {
    const startTime = Date.now();
    const processed: BatchOperationResult['processed'] = new Array(operations.length);
    let successful = 0;
    let skipped = 0;

    // Meta #2 cap (audit 2026-06-20): bound concurrent ops in
    // batchWriteIncremental() to 10. The `continue` becomes an early `return`
    // from the map callback; we still update `processed` for parity.
    // Also enforce sequential execution (permits=1) so operations with
    // implicit dependencies (e.g. create then read the same path) don't race.
    const limit26 = getVfsLimiter({ inputSize: 1 });
    const opResults26 = await Promise.allSettled(
      operations.map((op, index) => limit26.runExclusive(async () => {
        try {
          if (sandboxId && op.type !== 'delete') {
            const syncResult = await sandboxPersistenceManager.syncIncremental(
              { id: sandboxId } as any,
              [{ path: op.path, content: op.content }]
            );
            if (syncResult.skipped > 0) {
              processed[index] = { path: op.path, success: true };
              return 'skipped' as const;
            }
          }
          if (op.type === 'delete') {
            await virtualFilesystem.deletePath(this.ownerId, op.path);
          } else {
            await virtualFilesystem.writeFile(this.ownerId, op.path, op.content);
          }
          processed[index] = { path: op.path, success: true };
          return 'processed' as const;
        } catch (err: any) {
          processed[index] = { path: op.path, success: false, error: err.message };
          return 'error' as const;
        }
      }))
    );
    // Rebuild counters from the settled results so semantics are preserved.
    for (const r of opResults26) {
      if (r.status === 'fulfilled' && r.value === 'skipped') skipped++;
      else if (r.status === 'fulfilled' && r.value === 'processed') successful++;
    }

    return {
      success: processed.every(p => p.success),
      processed,
      totalFiles: operations.length,
      successful,
      failed: operations.length - successful - skipped,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Execute batch file write operations
   *
   * NEW Meta-coalesce (audit 2026-06-20): concurrent `writeFile`/`deletePath`
   * calls previously triggered N separate `persistWorkspace` calls, each of
   * which wraps everything in a `db.transaction(() => { ... })` (better-sqlite3,
   * SYNCHRONOUS — blocks the event loop while the transaction body runs).
   * `Promise.all` over 10 ops therefore serialized through the event-loop
   * mutex, yielding ZERO real wallclock parallelism.
   *
   * `virtualFilesystem.applyBatchMutations(...)` is the audit's coalesced
   * path: loads the workspace ONCE, applies all mutations to the in-memory
   * `workspace.files` Map, then runs ONE shared `persistWorkspace` (which
   * internally wraps everything in a single SQLite transaction). N fsyncs
   * collapse into 1 fsync — saves ~9 x (5-20ms) per batch (~45-180ms saved).
   *
   * Backward-compat: `BatchOperationResult` shape unchanged (success flag,
   * processed[], totalFiles, successful, failed, duration, optional error).
   * Partial-success semantics preserved (replication of prior `allSettled`
   * semantics — individual validation failures don't abort the rest).
   *
   * Semantic difference vs. prior shape: events (`onFileChange` /
   * `onSnapshotChange`) emit ONCE per batch (single `snapshotChange` covers
   * the whole batch, plus N `fileChange` events post-persist) instead of once
   * per write. Listeners that depended on the per-write snapshot for
   * granule-level cache invalidation should consult the `processed` array.
   */
  async batchWrite(operations: BatchFileOperation[]): Promise<BatchOperationResult> {
    const startTime = Date.now();
    const processed: BatchOperationResult['processed'] = [];

    try {
      // Meta #2 cap retained: bound batch size to 10 per chunk (same as the
      // prior cap-enforced Semaphore(10)). For a batch of >10 ops, chunk into
      // groups of 10 and let `applyBatchMutations` coalesce each chunk into
      // its own single transaction.
      const CHUNK = VFS_CAP_DEFAULT;
      let successful = 0;
      let failed = 0;
      for (let i = 0; i < operations.length; i += CHUNK) {
        const chunk = operations.slice(i, i + CHUNK);
        const chunkResult = await virtualFilesystem.applyBatchMutations(
          this.ownerId,
          chunk.map(op => op.type === 'delete'
            ? { type: 'delete' as const, path: op.path }
            : { type: 'write' as const, path: op.path, content: op.content ?? '' },
          ),
        );
        for (const p of chunkResult.processed) {
          processed.push({
            path: p.path,
            success: p.success,
            ...(p.error ? { error: p.error } : {}),
          });
        }
        successful += chunkResult.successful;
        failed += chunkResult.failed;
      }

      return {
        success: failed === 0,
        processed,
        totalFiles: operations.length,
        successful,
        failed,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        processed,
        totalFiles: operations.length,
        successful: processed.filter(p => p.success).length,
        failed: processed.length - processed.filter(p => p.success).length,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Execute batch file delete operations
   * 
   * @param paths - Array of file paths to delete
   * @returns Batch operation result
   */
  async batchDelete(paths: string[]): Promise<BatchOperationResult> {
    const operations: BatchFileOperation[] = paths.map(path => ({
      path,
      content: '',
      type: 'delete',
    }));

    return this.batchWrite(operations);
  }

  /**
   * Search and replace across multiple files
   * 
   * @param config - Search and replace configuration
   * @returns Search and replace result
   * 
   * @example
   * ```typescript
   * const batch = new VFSBatchOperations('user-123');
   * 
   * const result = await batch.searchAndReplace({
   *   pattern: 'oldFunction',
   *   replacement: 'newFunction',
   *   include: ['*.ts', '*.tsx'],
   *   exclude: ['node_modules/**'],
   *   replaceAll: true,
   * });
   * 
   * console.log(`Modified ${result.modified.length} files`);
   * ```
   */
  async searchAndReplace(config: SearchReplaceConfig): Promise<SearchReplaceResult> {
    const modified: SearchReplaceResult['modified'] = [];
    let totalReplacements = 0;
    let filesScanned = 0;

    try {
      // Get all files
      const listing = await virtualFilesystem.listDirectory(this.ownerId);
      const files = listing.nodes.filter(node => node.type === 'file');

      // Meta #2 cap: bound concurrent ops in searchAndReplace() to 10.
      const limit28 = getVfsLimiter({ inputSize: files.length });
      await Promise.allSettled(
        files.map(file => limit28.runExclusive(async () => {
          if (config.include && !this.matchesPatterns(file.path, config.include)) return;
          if (config.exclude && this.matchesPatterns(file.path, config.exclude)) return;
          filesScanned++;
          try {
            const fileData = await virtualFilesystem.readFile(this.ownerId, file.path);
            let content = fileData.content;
            let replacements = 0;
            if (config.useRegex) {
              const regex = new RegExp(
                config.pattern,
                config.replaceAll ? 'g' : ''
              );
              const matches = content.match(regex);
              replacements = matches ? matches.length : 0;
              content = content.replace(regex, config.replacement);
            } else {
              const index = content.indexOf(config.pattern);
              if (index !== -1) {
                replacements = 1;
                content = content.replace(config.pattern, config.replacement);
                if (config.replaceAll) {
                  while (content.includes(config.pattern)) {
                    content = content.replace(config.pattern, config.replacement);
                    replacements++;
                  }
                }
              }
            }
            if (replacements > 0) {
              await virtualFilesystem.writeFile(this.ownerId, file.path, content);
              modified.push({ path: file.path, replacements });
              totalReplacements += replacements;
            }
          } catch (error: any) {
            console.warn(`[VFSBatchOperations] Failed to process ${file.path}:`, error.message);
          }
        }))
      );

      return {
        modified,
        totalReplacements,
        filesScanned,
      };
    } catch (error: any) {
      throw new Error(`Search and replace failed: ${error.message}`);
    }
  }

  /**
   * Copy multiple files
   * 
   * @param files - Array of source/destination pairs
   * @returns Batch operation result
   */
  async batchCopy(files: Array<{ source: string; destination: string }>): Promise<BatchOperationResult> {
    const startTime = Date.now();
    const processed: BatchOperationResult['processed'] = [];
    let successful = 0;
    let failed = 0;

    try {
      // Meta #2 cap: bound concurrent ops in batchCopy() to 10.
      const limit29 = getVfsLimiter({ inputSize: files.length });
      const opResults29 = await Promise.all(
        files.map(file => limit29.runExclusive(async () => {
          try {
            const content = await virtualFilesystem.readFile(this.ownerId, file.source);
            await virtualFilesystem.writeFile(this.ownerId, file.destination, content.content);
            return { status: 'success' as const, processed: { path: `${file.source} -> ${file.destination}`, success: true } };
          } catch (error: any) {
            return { status: 'error' as const, processed: { path: `${file.source} -> ${file.destination}`, success: false, error: error.message } };
          }
        }))
      );
      for (const r of opResults29) {
        processed.push(r.processed);
        if (r.status === 'success') successful++; else failed++;
      }

      return {
        success: failed === 0,
        processed,
        totalFiles: files.length,
        successful,
        failed,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        processed,
        totalFiles: files.length,
        successful,
        failed,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Move multiple files
   * 
   * @param files - Array of source/destination pairs
   * @returns Batch operation result
   */
  async batchMove(files: Array<{ source: string; destination: string }>): Promise<BatchOperationResult> {
    const copyResult = await this.batchCopy(files);
    
    if (copyResult.success) {
      const deleteResult = await this.batchDelete(files.map(f => f.source));
      
      return {
        ...copyResult,
        success: deleteResult.success,
        failed: copyResult.failed + deleteResult.failed,
        processed: [...copyResult.processed, ...deleteResult.processed],
      };
    }
    
    return copyResult;
  }

  /**
   * Check if path matches any pattern
   */
  private matchesPatterns(path: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    });
  }
}

/**
 * Create batch operations manager for owner
 * 
 * @param ownerId - Owner ID
 * @returns Batch operations manager
 */
export function createVFSBatchOperations(ownerId: string): VFSBatchOperations {
  return new VFSBatchOperations(ownerId);
}

/**
 * Quick batch write helper
 * 
 * @param ownerId - Owner ID
 * @param files - Array of file operations
 * @returns Batch operation result
 */
export async function quickBatchWrite(
  ownerId: string,
  files: BatchFileOperation[]
): Promise<BatchOperationResult> {
  const batch = createVFSBatchOperations(ownerId);
  return await batch.batchWrite(files);
}
