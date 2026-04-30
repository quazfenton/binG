/**
 * Orphaned Record Cleaner
 * 
 * Automatically cleans up orphaned records before user deletion to prevent
 * constraint violations. This module identifies and removes records that
 * reference non-existent users or violate foreign key constraints.
 * 
 * @module database/orphaned-record-cleaner
 */

import { getDatabase } from '@/lib/database/connection';

export interface OrphanedRecordInfo {
  table: string;
  column: string;
  orphanedCount: number;
  oldestOrphan?: Date;
}

export interface CleanupResult {
  table: string;
  deletedCount: number;
  durationMs: number;
  error?: string;
}

export interface CleanupSummary {
  success: boolean;
  totalOrphansFound: number;
  totalRecordsDeleted: number;
  details: CleanupResult[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
}

/**
 * Configuration for orphaned record cleanup
 */
export interface OrphanCleanupConfig {
  /** Enable automatic cleanup before user deletion */
  enabled: boolean;
  /** Tables to check for orphaned records */
  tables: { table: string; column: string }[];
  /** Batch size for deletion operations */
  batchSize: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Only report orphans without deleting */
  dryRun: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: OrphanCleanupConfig = {
  enabled: true,
  tables: [
    // Core user-related tables
    { table: 'events', column: 'user_id' },
    { table: 'scheduled_tasks', column: 'user_id' },
    { table: 'conversations', column: 'user_id' },
    { table: 'messages', column: 'user_id' },
    { table: 'usage_logs', column: 'user_id' },
    { table: 'user_sessions', column: 'user_id' },
    // OAuth and external connections
    { table: 'api_credentials', column: 'user_id' },
    { table: 'external_connections', column: 'user_id' },
    { table: 'oauth_sessions', column: 'user_id' },
    { table: 'service_permissions', column: 'user_id' },
    // User preferences and skills
    { table: 'user_preferences', column: 'user_id' },
    { table: 'skills', column: 'user_id' },
    // HITL approval requests
    { table: 'hitl_approval_requests', column: 'user_id' },
    { table: 'approval_requests', column: 'user_id' },
    // Terminal sessions
    { table: 'sessions', column: 'user_id' },
  ],
  batchSize: 1000,
  verbose: false,
  dryRun: false,
};

/**
 * Orphaned Record Cleaner
 * 
 * Scans for and cleans up orphaned records that reference non-existent users.
 * This prevents FK constraint violations during user deletion operations.
 */
export class OrphanedRecordCleaner {
  private config: OrphanCleanupConfig;

  constructor(config: Partial<OrphanCleanupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scan for orphaned records across all configured tables
   */
   scanForOrphans(): OrphanedRecordInfo[] {
     const db = getDatabase();
     const orphans: OrphanedRecordInfo[] = [];

     for (const { table, column } of this.config.tables) {
       // Validate identifiers to prevent SQL injection
       if (!this.isValidIdentifier(table) || !this.isValidIdentifier(column)) {
         if (this.config.verbose) {
           console.log(`[OrphanCleaner] Invalid identifier: ${table}.${column}, skipping`);
         }
         continue;
       }
       
       try {
         // Check if table exists
         const tableExists = db.prepare(
           `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
         ).get(table);

         if (!tableExists) {
           if (this.config.verbose) {
             console.log(`[OrphanCleaner] Table ${table} does not exist, skipping`);
           }
           continue;
         }

         // Count orphaned records (records with user_id not in users table)
         // Using NOT EXISTS for better performance on large tables
         const countResult = db.prepare(`
           SELECT COUNT(*) as count 
           FROM ${table} 
           WHERE ${column} IS NOT NULL 
           AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${table}.${column})
         `).get() as { count: number };

         if (countResult.count > 0) {
           // Get oldest orphan timestamp if available
           let oldestOrphan: Date | undefined;
           try {
             const createdAtCol = db.prepare(
               `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
             ).get(table) as { sql: string } | undefined;

             // Check if table has created_at column
             if (createdAtCol?.sql?.includes('created_at')) {
               const oldestResult = db.prepare(`
                 SELECT MIN(created_at) as oldest 
                 FROM ${table} 
                 WHERE ${column} IS NOT NULL 
                 AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${table}.${column})
               `).get() as { oldest: string | null } | undefined;

               if (oldestResult?.oldest) {
                 oldestOrphan = new Date(oldestResult.oldest);
               }
             }
           } catch {
             // Ignore if we can't get oldest timestamp
           }

           orphans.push({
             table,
             column,
             orphanedCount: countResult.count,
             oldestOrphan,
           });

           if (this.config.verbose) {
             console.log(
               `[OrphanCleaner] Found ${countResult.count} orphaned records in ${table}.${column}`
             );
           }
         }
       } catch (error: any) {
         console.error(`[OrphanCleaner] Error scanning ${table}:`, error.message);
       }
     }

     return orphans;
   }

  /**
   * Get total count of all orphaned records
   */
  getTotalOrphanCount(): number {
    const orphans = this.scanForOrphans();
    return orphans.reduce((sum, o) => sum + o.orphanedCount, 0);
  }

   /**
    * Clean up orphaned records in a specific table
    */
   private cleanupTable(
     db: any,
     table: string,
     column: string
   ): CleanupResult {
     const startTime = Date.now();
     
     try {
       // Validate identifiers to prevent SQL injection
       if (!this.isValidIdentifier(table) || !this.isValidIdentifier(column)) {
         return {
           table,
           deletedCount: 0,
           durationMs: Date.now() - startTime,
           error: `Invalid identifier: ${table}.${column}`,
         };
       }
       
       // Delete orphaned records in batches
       let totalDeleted = 0;
       let batchDeleted = this.config.batchSize;

       while (batchDeleted === this.config.batchSize) {
         const result = db.prepare(`
           DELETE FROM ${table}
           WHERE ${column} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${table}.${column})
           LIMIT ?
         `).run(this.config.batchSize);

         batchDeleted = result.changes;
         totalDeleted += batchDeleted;

         if (this.config.verbose && batchDeleted > 0) {
           console.log(`[OrphanCleaner] ${table}: deleted batch of ${batchDeleted} records`);
         }
       }

       return {
         table,
         deletedCount: totalDeleted,
         durationMs: Date.now() - startTime,
       };
     } catch (error: any) {
       return {
         table,
         deletedCount: 0,
         durationMs: Date.now() - startTime,
         error: error.message,
       };
     }
   }

  /**
   * Clean up all orphaned records across configured tables
   */
  cleanupAll(): CleanupSummary {
    const startTime = new Date();
    const db = getDatabase();
    const results: CleanupResult[] = [];

    if (this.config.dryRun) {
      console.log('[OrphanCleaner] DRY RUN - No records will be deleted');
    }

    if (!this.config.enabled) {
      console.log('[OrphanCleaner] Cleanup is disabled');
      return {
        success: true,
        totalOrphansFound: 0,
        totalRecordsDeleted: 0,
        details: [],
        startTime,
        endTime: new Date(),
        durationMs: 0,
      };
    }

    // Scan first to get total orphan count
    const orphans = this.scanForOrphans();
    const totalOrphans = orphans.reduce((sum, o) => sum + o.orphanedCount, 0);

    console.log(`[OrphanCleaner] Starting cleanup of ${totalOrphans} orphaned records`);

    // Clean up each table
    for (const { table, column } of this.config.tables) {
      const existingTable = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(table);

      if (!existingTable) {
        continue;
      }

      // Skip if no orphans found for this table
      const orphanInfo = orphans.find(o => o.table === table);
      if (!orphanInfo || orphanInfo.orphanedCount === 0) {
        if (this.config.verbose) {
          console.log(`[OrphanCleaner] Skipping ${table} - no orphans found`);
        }
        continue;
      }

      if (this.config.dryRun) {
        console.log(`[OrphanCleaner] DRY RUN: Would delete ${orphanInfo.orphanedCount} records from ${table}`);
        results.push({
          table,
          deletedCount: 0,
          durationMs: 0,
          error: 'dry run - no actual deletion',
        });
        continue;
      }

      const result = this.cleanupTable(db, table, column);
      results.push(result);

      if (result.error) {
        console.error(`[OrphanCleaner] Error cleaning ${table}:`, result.error);
      } else if (result.deletedCount > 0) {
        console.log(`[OrphanCleaner] Cleaned ${result.deletedCount} orphaned records from ${table}`);
      }
    }

    const endTime = new Date();
    const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);

    return {
      success: results.every(r => !r.error),
      totalOrphansFound: totalOrphans,
      totalRecordsDeleted: totalDeleted,
      details: results,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
    };
  }

  /**
   * Clean up orphans that would conflict with a specific user deletion
   * Returns tables that were cleaned to prevent constraint violations
   */
  cleanupForUserDeletion(userId: string): {
    cleanedTables: string[];
    skippedTables: string[];
    totalCleaned: number;
    orphansFound: OrphanedRecordInfo[];
    userExists: boolean;
  } {
    const db = getDatabase();
    const cleanedTables: string[] = [];
    const skippedTables: string[] = [];
    const orphansFound: OrphanedRecordInfo[] = [];
    let totalCleaned = 0;

    // First check if user exists
    const userExists = db.prepare(
      `SELECT id FROM users WHERE id = ?`
    ).get(userId);

    if (!userExists) {
      console.log(`[OrphanCleaner] User ${userId} does not exist, returning early`);
      return { cleanedTables, skippedTables, totalCleaned, orphansFound, userExists: false };
    }

    for (const { table, column } of this.config.tables) {
      try {
        // Validate table and column names against whitelist
        if (!this.isValidIdentifier(table) || !this.isValidIdentifier(column)) {
          console.warn(`[OrphanCleaner] Invalid identifier: ${table}.${column}, skipping`);
          skippedTables.push(`${table}.${column} (invalid identifier)`);
          continue;
        }

        // Check if table exists
        const tableExists = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table);

        if (!tableExists) {
          skippedTables.push(table);
          continue;
        }

        // Count orphaned records for this table
        const orphanCountResult = db.prepare(`
          SELECT COUNT(*) as count 
          FROM ${table} 
          WHERE ${column} IS NOT NULL 
          AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${table}.${column})
        `).get() as { count: number } | undefined;

        if (orphanCountResult && orphanCountResult.count > 0) {
          orphansFound.push({
            table,
            column,
            orphanedCount: orphanCountResult.count,
          });
        }

        // Check if there are records for this specific user
        const countResult = db.prepare(
          `SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`
        ).get(userId) as { count: number } | undefined;

        if (!countResult || countResult.count === 0) {
          // No records for this user, skip
          skippedTables.push(`${table} (no records for user)`);
          continue;
        }

        // Delete all records for this user (they will be cleaned by FK cascade anyway,
        // but explicit deletion helps with tables without FK constraints)
        const deleteResult = db.prepare(
          `DELETE FROM ${table} WHERE ${column} = ?`
        ).run(userId);

        if (deleteResult.changes > 0) {
          cleanedTables.push(`${table} (${deleteResult.changes} records)`);
          totalCleaned += deleteResult.changes;
        }
      } catch (error: any) {
        console.error(`[OrphanCleaner] Error cleaning ${table} for user ${userId}:`, error.message);
        skippedTables.push(`${table} (${error.message})`);
      }
    }

    return { cleanedTables, skippedTables, totalCleaned, orphansFound, userExists: true };
  }

  /**
   * Validate identifier (table/column name) against SQL injection
   */
  private isValidIdentifier(name: string): boolean {
    // Only allow alphanumeric characters, underscores, and common SQL identifiers
    // This prevents SQL injection through config values
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OrphanCleanupConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): OrphanCleanupConfig {
    return { ...this.config };
  }
}

/**
 * Export singleton instance
 */
export const orphanedRecordCleaner = new OrphanedRecordCleaner();

/**
 * Quick cleanup function for use in other modules
 */
export function quickCleanup(): CleanupSummary {
  return orphanedRecordCleaner.cleanupAll();
}

/**
 * Check if cleanup is needed
 */
export function needsCleanup(): boolean {
  return orphanedRecordCleaner.getTotalOrphanCount() > 0;
}