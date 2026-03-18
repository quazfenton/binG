/**
 * HITL Audit Logging
 *
 * Provides comprehensive audit logging for human-in-the-loop approvals.
 * Logs all approval requests, decisions, and metadata for compliance and debugging.
 *
 * Features:
 * - SQLite persistence for audit logs
 * - Query by user, action, date range
 * - Export capabilities for compliance
 * - Automatic cleanup of old logs
 */

import { getDatabase } from '@/lib/database/connection';

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  target: string;
  reason: string;
  approved: boolean;
  feedback?: string;
  modifiedValue?: any;
  responseTimeMs?: number;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  approved?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogStats {
  totalRequests: number;
  approvedCount: number;
  rejectedCount: number;
  timeoutCount: number;
  averageResponseTimeMs: number;
  approvalRate: number;
}

class HITLAuditLogger {
  private db: any = null;
  private initialized = false;

  /**
   * Initialize database for audit logging
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = getDatabase();
      
      // Create audit log table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS hitl_audit_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target TEXT NOT NULL,
          reason TEXT NOT NULL,
          approved BOOLEAN NOT NULL,
          feedback TEXT,
          modified_value TEXT,
          response_time_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        )
      `);

      // Create indexes for common queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hitl_audit_user_id
        ON hitl_audit_logs(user_id)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hitl_audit_action
        ON hitl_audit_logs(action)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hitl_audit_created_at
        ON hitl_audit_logs(created_at)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_hitl_audit_approved
        ON hitl_audit_logs(approved)
      `);

      this.initialized = true;
      console.log('[HITLAuditLogger] Database initialized');
    } catch (error) {
      console.warn('[HITLAuditLogger] DB init failed, audit logging disabled:', error);
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Log an approval request
   */
  async logApprovalRequest(
    interruptId: string,
    userId: string,
    action: string,
    target: string,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO hitl_audit_logs
        (id, user_id, action, target, reason, approved, created_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `);

      stmt.run(
        interruptId,
        userId,
        action,
        target,
        reason,
        false, // Will be updated when resolved
        metadata ? JSON.stringify(metadata) : null
      );
    } catch (error) {
      console.error('[HITLAuditLogger] Failed to log approval request:', error);
    }
  }

  /**
   * Log an approval decision
   */
  async logApprovalDecision(
    interruptId: string,
    approved: boolean,
    feedback?: string,
    modifiedValue?: any,
    responseTimeMs?: number
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE hitl_audit_logs
        SET approved = ?,
            feedback = ?,
            modified_value = ?,
            response_time_ms = ?
        WHERE id = ?
      `);

      stmt.run(
        approved ? 1 : 0,
        feedback || null,
        modifiedValue ? JSON.stringify(modifiedValue) : null,
        responseTimeMs || null,
        interruptId
      );
    } catch (error) {
      console.error('[HITLAuditLogger] Failed to log approval decision:', error);
    }
  }

  /**
   * Query audit logs
   */
  async queryLogs(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    await this.initialize();
    if (!this.db) return [];

    try {
      let sql = 'SELECT * FROM hitl_audit_logs WHERE 1=1';
      const params: any[] = [];

      if (query.userId) {
        sql += ' AND user_id = ?';
        params.push(query.userId);
      }

      if (query.action) {
        sql += ' AND action = ?';
        params.push(query.action);
      }

      if (query.approved !== undefined) {
        sql += ' AND approved = ?';
        params.push(query.approved ? 1 : 0);
      }

      if (query.startDate) {
        sql += ' AND created_at >= ?';
        params.push(query.startDate);
      }

      if (query.endDate) {
        sql += ' AND created_at <= ?';
        params.push(query.endDate);
      }

      sql += ' ORDER BY created_at DESC';

      const limit = query.limit || 100;
      const offset = query.offset || 0;
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      return rows.map(row => ({
        ...row,
        approved: !!row.approved,
        modifiedValue: row.modified_value ? JSON.parse(row.modified_value) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }));
    } catch (error) {
      console.error('[HITLAuditLogger] Failed to query logs:', error);
      return [];
    }
  }

  /**
   * Get audit log statistics
   */
  async getStats(startDate?: string, endDate?: string): Promise<AuditLogStats> {
    await this.initialize();
    if (!this.db) {
      return {
        totalRequests: 0,
        approvedCount: 0,
        rejectedCount: 0,
        timeoutCount: 0,
        averageResponseTimeMs: 0,
        approvalRate: 0,
      };
    }

    try {
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (startDate) {
        whereClause += ' AND created_at >= ?';
        params.push(startDate);
      }

      if (endDate) {
        whereClause += ' AND created_at <= ?';
        params.push(endDate);
      }

      // Get counts
      const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM hitl_audit_logs ${whereClause}`);
      const approvedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM hitl_audit_logs ${whereClause} AND approved = 1`);
      const rejectedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM hitl_audit_logs ${whereClause} AND approved = 0`);
      const timeoutStmt = this.db.prepare(`SELECT COUNT(*) as count FROM hitl_audit_logs ${whereClause} AND feedback LIKE '%timed out%'`);
      const avgResponseStmt = this.db.prepare(`SELECT AVG(response_time_ms) as avg FROM hitl_audit_logs ${whereClause} AND response_time_ms IS NOT NULL`);

      const total = (totalStmt.get(...params) as any).count;
      const approved = (approvedStmt.get(...params) as any).count;
      const rejected = (rejectedStmt.get(...params) as any).count;
      const timeouts = (timeoutStmt.get(...params) as any).count;
      const avgResponse = (avgResponseStmt.get(...params) as any).avg || 0;

      return {
        totalRequests: total,
        approvedCount: approved,
        rejectedCount: rejected,
        timeoutCount: timeouts,
        averageResponseTimeMs: Math.round(avgResponse),
        approvalRate: total > 0 ? Math.round((approved / total) * 100) : 0,
      };
    } catch (error) {
      console.error('[HITLAuditLogger] Failed to get stats:', error);
      return {
        totalRequests: 0,
        approvedCount: 0,
        rejectedCount: 0,
        timeoutCount: 0,
        averageResponseTimeMs: 0,
        approvalRate: 0,
      };
    }
  }

  /**
   * Export audit logs to JSON
   */
  async exportLogs(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    // Use unlimited limit for exports
    return this.queryLogs({ ...query, limit: 10000, offset: 0 });
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    await this.initialize();
    if (!this.db) return 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const stmt = this.db.prepare(`
        DELETE FROM hitl_audit_logs
        WHERE created_at < ?
      `);

      const result = stmt.run(cutoffDate.toISOString());
      console.log(`[HITLAuditLogger] Cleaned up ${result.changes} old audit logs`);
      return result.changes;
    } catch (error) {
      console.error('[HITLAuditLogger] Failed to cleanup old logs:', error);
      return 0;
    }
  }
}

// Singleton instance
export const hitlAuditLogger = new HITLAuditLogger();

// Auto-cleanup old logs every 24 hours
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    hitlAuditLogger.cleanupOldLogs(90);
  }, 24 * 60 * 60 * 1000);
}
