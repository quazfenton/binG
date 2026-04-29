/**
 * User Deletion API Route with Constraint Monitoring
 * 
 * Provides admin endpoint to delete users with full monitoring of
 * database constraint violations during cascade operations.
 * 
 * POST /api/user/delete
 * Authorization: Admin only (ADMIN_USER_IDS)
 * Body: { userId: string, reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApiOrForbidden } from '@/lib/auth/admin';
import { getDatabase } from '@/lib/database/connection';
import { constraintMonitor } from '@/lib/observability/constraint-violation-monitor';
import { orphanedRecordCleaner, OrphanedRecordInfo } from '@/lib/database/orphaned-record-cleaner';

interface DeleteUserRequest {
  userId: string;
  reason?: string;
  cascadeOptions?: {
    /** Force deletion even if FK constraints might fail */
    force?: boolean;
    /** Skip specific table cleanups */
    skipTables?: string[];
  };
}

interface DeletionResult {
  success: boolean;
  userId: string;
  deletedTables: string[];
  constraintViolations: string[];
  orphanedData: Record<string, number>;
  cleanupPerformed: {
    autoCleanup: boolean;
    tablesCleaned: string[];
    recordsCleaned: number;
    orphansFound: OrphanedRecordInfo[];
  };
  error?: string;
}

/**
 * Get tables that reference users table
 */
function getUserDependentTables(db: any): { table: string; column: string; onDelete: string }[] {
  const tables: { table: string; column: string; onDelete: string }[] = [];
  
  // Known tables with user_id foreign key (from schema analysis)
  const knownRelations = [
    { table: 'user_sessions', column: 'user_id', onDelete: 'CASCADE' },
    { table: 'usage_logs', column: 'user_id', onDelete: 'CASCADE' },
    { table: 'events', column: 'user_id', onDelete: 'CASCADE' },
    { table: 'scheduled_tasks', column: 'user_id', onDelete: 'CASCADE' },
    { table: 'conversations', column: 'user_id', onDelete: 'CASCADE' },
    { table: 'messages', column: 'user_id', onDelete: 'SET NULL' },
    { table: 'hitl_approval_requests', column: 'user_id', onDelete: 'CASCADE' },
  ];

  // Verify each table exists and get FK info
  for (const rel of knownRelations) {
    try {
      const result = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
      ).get(rel.table);
      
      if (result) {
        tables.push(rel);
      }
    } catch {
      // Table doesn't exist, skip
    }
  }

  return tables;
}

/**
 * Count records to be affected by deletion
 */
function countAffectedRecords(
  db: any,
  userId: string,
  tables: { table: string; column: string; onDelete: string }[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const rel of tables) {
    try {
      const result = db.prepare(
        `SELECT COUNT(*) as count FROM ${rel.table} WHERE ${rel.column} = ?`
      ).get(userId);
      counts[rel.table] = result?.count || 0;
    } catch {
      counts[rel.table] = 0;
    }
  }

  return counts;
}

/**
 * Delete user with full constraint monitoring and automatic cleanup
 */
async function deleteUser(
  db: any,
  userId: string,
  options?: DeleteUserRequest['cascadeOptions']
): Promise<DeletionResult> {
  const monitor = constraintMonitor;
  const cleaner = orphanedRecordCleaner;
  const result: DeletionResult = {
    success: false,
    userId,
    deletedTables: [],
    constraintViolations: [],
    orphanedData: {},
    cleanupPerformed: {
      autoCleanup: false,
      tablesCleaned: [],
      recordsCleaned: 0,
      orphansFound: [],
    },
  };

  // Get dependent tables
  const dependentTables = getUserDependentTables(db);
  
  // Count affected records
  result.orphanedData = countAffectedRecords(db, userId, dependentTables);

  try {
    // Enable foreign key enforcement
    db.exec('PRAGMA foreign_keys = ON');

    // ============================================
    // AUTOMATIC CLEANUP + USER DELETION PHASE
    // ============================================
    // Wrap both cleanup and deletion in a single transaction for atomicity
    // If either fails, both changes are rolled back
    db.exec('BEGIN TRANSACTION');

    try {
      // Clean up orphaned records for this specific user before deletion
      const cleanupResult = cleaner.cleanupForUserDeletion(userId);
      
      // Store orphan info in result
      result.cleanupPerformed.orphansFound = cleanupResult.orphansFound;

      // If cleanup was performed (records were deleted), log it
      if (cleanupResult.totalCleaned > 0) {
        result.cleanupPerformed.autoCleanup = true;
        result.cleanupPerformed.tablesCleaned = cleanupResult.cleanedTables;
        result.cleanupPerformed.recordsCleaned = cleanupResult.totalCleaned;

        console.log(
          `[AUDIT] Auto-cleanup performed before user ${userId} deletion: ` +
          `${cleanupResult.totalCleaned} records from ${cleanupResult.cleanedTables.length} tables`
        );
      }

      // ============================================
      // USER DELETION PHASE
      // ============================================

      try {
        // Delete from tables in order (respecting FK dependencies)
      // First, delete from tables that reference users but may not have FK
      for (const rel of dependentTables) {
        if (options?.skipTables?.includes(rel.table)) {
          continue;
        }

        try {
          // Log before deletion
          console.log(`[UserDelete] Deleting from ${rel.table} where ${rel.column} = ${userId}`);
          
          const deleteStmt = db.prepare(
            `DELETE FROM ${rel.table} WHERE ${rel.column} = ?`
          );
          const deleteResult = deleteStmt.run(userId);
          
          result.deletedTables.push(`${rel.table} (${deleteResult.changes} rows)`);
          
        } catch (error: any) {
          // Record constraint violation
          monitor.recordUserDeletionViolation(
            error,
            userId,
            { table: rel.table, column: rel.column }
          );
          
          result.constraintViolations.push(
            `${rel.table}: ${error.message}`
          );

          // If not forcing, rethrow
          if (!options?.force) {
            throw error;
          }
        }
      }

      // Finally, delete the user
      const userStmt = db.prepare('DELETE FROM users WHERE id = ?');
      const userResult = userStmt.run(userId);

      if (userResult.changes === 0) {
        throw new Error(`User ${userId} not found`);
      }

      result.deletedTables.push(`users (1 row)`);
      result.success = true;

      // Commit transaction
      db.exec('COMMIT');

      console.log(`[UserDelete] Successfully deleted user ${userId}`);
      
    } catch (error: any) {
      // Rollback on error
      db.exec('ROLLBACK');
      
      // Note: Violations are already recorded in recordUserDeletionViolation above
      // No need to double-record
      
      throw error;
    }
    } catch (error: any) {
      // Outer catch for transaction-level errors
      result.error = error.message;
      
      console.error(`[UserDelete] Failed to delete user ${userId}:`, error);
    }

  } catch (error: any) {
    result.error = error.message;
    
    console.error(`[UserDelete] Failed to delete user ${userId}:`, error);
  }

  return result;
}

/**
 * POST /api/user/delete
 * Delete a user with constraint monitoring
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Require admin access
    const admin = await requireAdminApiOrForbidden(req);
    if (admin instanceof NextResponse) {
      return admin;
    }

    // Parse request body
    const body: DeleteUserRequest = await req.json();

    if (!body.userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Validate userId - allow numeric IDs (common in SQLite) or string IDs
    const userIdNum = parseInt(body.userId, 10);
    const isValidUserId = !isNaN(userIdNum) && userIdNum > 0 || /^[a-zA-Z0-9_-]+$/.test(body.userId);
    if (!isValidUserId) {
      return NextResponse.json(
        { error: 'Invalid userId format' },
        { status: 400 }
      );
    }

    console.log(`[UserDelete] Admin ${admin.userId} initiating deletion of user ${body.userId}`);
    console.log(`[UserDelete] Reason: ${body.reason || 'Not specified'}`);

    // Get database connection
    const db = getDatabase();

    // Pre-check: Verify user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(body.userId);
    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found', userId: body.userId },
        { status: 404 }
      );
    }

    // Perform deletion with monitoring (async function)
    const result: DeletionResult = await deleteUser(db, body.userId, body.cascadeOptions);

    // Log audit event
    console.log(
      `[AUDIT] User deletion by admin ${admin.userId}: ` +
      JSON.stringify({
        targetUserId: body.userId,
        reason: body.reason,
        success: result.success,
        deletedTables: result.deletedTables,
        violations: result.constraintViolations,
      })
    );

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `User ${body.userId} deleted successfully`,
        result,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Deletion failed',
          result,
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[UserDelete] Unexpected error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user/delete
 * Get constraint violation monitoring status
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Require admin access
    const admin = await requireAdminApiOrForbidden(req);
    if (admin instanceof NextResponse) {
      return admin;
    }

    const monitor = constraintMonitor;

    return NextResponse.json({
      monitoringEnabled: monitor.getStatus().enabled,
      constraintStats: monitor.getStats(),
      recentViolations: monitor.getRecentViolations(20),
      status: monitor.getStatus(),
    });

  } catch (error: any) {
    console.error('[UserDelete] Status check error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}