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

    for (const op of this._operations) {
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

        results.push({ success: true, file });
      } catch (err: any) {
        results.push({ success: false, error: err.message });
      }
    }

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

      // Allow empty string content (empty files are valid), but reject undefined/null
      if ((op.type === 'create' || op.type === 'update') && op.content === undefined) {
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
    const processed: BatchOperationResult['processed'] = [];
    let successful = 0;
    let skipped = 0;

    for (const op of operations) {
      try {
        // Use persistence manager if sandboxId is provided for incremental sync
        if (sandboxId && op.type !== 'delete') {
          const syncResult = await sandboxPersistenceManager.syncIncremental(
            { id: sandboxId } as any, 
            [{ path: op.path, content: op.content }]
          );
          
          if (syncResult.skipped > 0) {
            skipped++;
            processed.push({ path: op.path, success: true });
            continue;
          }
        }

        // Standard write
        if (op.type === 'delete') {
          await virtualFilesystem.deletePath(this.ownerId, op.path);
        } else {
          await virtualFilesystem.writeFile(this.ownerId, op.path, op.content);
        }

        processed.push({ path: op.path, success: true });
        successful++;
      } catch (err: any) {
        processed.push({ path: op.path, success: false, error: err.message });
      }
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
   */
  async batchWrite(operations: BatchFileOperation[]): Promise<BatchOperationResult> {
    const startTime = Date.now();
    const processed: BatchOperationResult['processed'] = [];
    let successful = 0;
    let failed = 0;

    try {
      for (const op of operations) {
        try {
          if (op.type === 'delete') {
            await virtualFilesystem.deletePath(this.ownerId, op.path);
          } else {
            await virtualFilesystem.writeFile(this.ownerId, op.path, op.content);
          }
          
          processed.push({
            path: op.path,
            success: true,
          });
          successful++;
        } catch (error: any) {
          processed.push({
            path: op.path,
            success: false,
            error: error.message,
          });
          failed++;
        }
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
        successful,
        failed,
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

      for (const file of files) {
        // Check include/exclude patterns
        if (config.include && !this.matchesPatterns(file.path, config.include)) {
          continue;
        }
        if (config.exclude && this.matchesPatterns(file.path, config.exclude)) {
          continue;
        }

        filesScanned++;

        try {
          // Read file
          const fileData = await virtualFilesystem.readFile(this.ownerId, file.path);
          let content = fileData.content;
          let replacements = 0;

          // Perform replacement
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

          // Write back if modified
          if (replacements > 0) {
            await virtualFilesystem.writeFile(this.ownerId, file.path, content);
            
            modified.push({
              path: file.path,
              replacements,
            });
            
            totalReplacements += replacements;
          }
        } catch (error: any) {
          // Skip files that can't be processed
          console.warn(`[VFSBatchOperations] Failed to process ${file.path}:`, error.message);
        }
      }

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
      for (const file of files) {
        try {
          const content = await virtualFilesystem.readFile(this.ownerId, file.source);
          await virtualFilesystem.writeFile(this.ownerId, file.destination, content.content);
          
          processed.push({
            path: `${file.source} -> ${file.destination}`,
            success: true,
          });
          successful++;
        } catch (error: any) {
          processed.push({
            path: `${file.source} -> ${file.destination}`,
            success: false,
            error: error.message,
          });
          failed++;
        }
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
