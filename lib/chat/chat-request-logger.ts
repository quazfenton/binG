/**
 * Chat API Request Logging
 *
 * Provides comprehensive request/response logging for the chat API.
 * Useful for debugging, analytics, and compliance.
 *
 * Features:
 * - SQLite persistence for request logs
 * - Query by user, date range, provider
 * - Token usage tracking
 * - Latency metrics
 * - Error tracking
 */

import { getDatabase } from '@/lib/database/connection';

export interface ChatRequestLog {
  id: string;
  userId: string;
  provider: string;
  model: string;
  messageCount: number;
  requestSize: number;
  responseSize?: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs?: number;
  streaming: boolean;
  success: boolean;
  error?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface ChatLogQuery {
  userId?: string;
  provider?: string;
  model?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface ChatLogStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  totalTokens: number;
  averageTokensPerRequest: number;
  successRate: number;
}

class ChatRequestLogger {
  private db: any = null;
  private initialized = false;

  /**
   * Initialize database for request logging
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = getDatabase();
      
      // Create request log table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS chat_request_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          message_count INTEGER NOT NULL,
          request_size INTEGER NOT NULL,
          response_size INTEGER,
          token_usage_prompt INTEGER,
          token_usage_completion INTEGER,
          token_usage_total INTEGER,
          latency_ms INTEGER,
          streaming BOOLEAN NOT NULL DEFAULT 0,
          success BOOLEAN NOT NULL DEFAULT 0,
          error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        )
      `);

      // Create indexes for common queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_logs_user_id
        ON chat_request_logs(user_id)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_logs_provider
        ON chat_request_logs(provider)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_logs_model
        ON chat_request_logs(model)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at
        ON chat_request_logs(created_at)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_logs_success
        ON chat_request_logs(success)
      `);

      this.initialized = true;
      console.log('[ChatRequestLogger] Database initialized');
    } catch (error) {
      console.warn('[ChatRequestLogger] DB init failed, logging disabled:', error);
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Log a chat request start
   */
  async logRequestStart(
    requestId: string,
    userId: string,
    provider: string,
    model: string | undefined,  // Make model optional
    messages: any[],
    streaming: boolean,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
      // Use INSERT OR IGNORE to avoid duplicate requestIds (first write wins)
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO chat_request_logs
        (id, user_id, provider, model, message_count, request_size, streaming, created_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `);

      const requestSize = JSON.stringify(messages).length;

      stmt.run(
        requestId,
        userId,
        provider,
        model || 'unknown',  // Default to 'unknown' if model is undefined
        messages.length,
        requestSize,
        streaming ? 1 : 0,
        metadata ? JSON.stringify(metadata) : null
      );
    } catch (error: any) {
      // Silently ignore UNIQUE constraint errors (already logged with INSERT OR REPLACE)
      if (error?.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        console.error('[ChatRequestLogger] Failed to log request start:', error);
      }
    }
  }

  /**
   * Log a chat request completion
   */
  async logRequestComplete(
    requestId: string,
    success: boolean,
    responseSize?: number,
    tokenUsage?: { prompt: number; completion: number; total: number },
    latencyMs?: number,
    error?: string
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        UPDATE chat_request_logs
        SET response_size = ?,
            token_usage_prompt = ?,
            token_usage_completion = ?,
            token_usage_total = ?,
            latency_ms = ?,
            success = ?,
            error = ?
        WHERE id = ?
      `);

      stmt.run(
        responseSize || null,
        tokenUsage?.prompt || null,
        tokenUsage?.completion || null,
        tokenUsage?.total || null,
        latencyMs || null,
        success ? 1 : 0,
        error || null,
        requestId
      );
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to log request complete:', error);
    }
  }

  /**
   * Query request logs
   */
  async queryLogs(query: ChatLogQuery): Promise<ChatRequestLog[]> {
    await this.initialize();
    if (!this.db) return [];

    try {
      let sql = 'SELECT * FROM chat_request_logs WHERE 1=1';
      const params: any[] = [];

      if (query.userId) {
        sql += ' AND user_id = ?';
        params.push(query.userId);
      }

      if (query.provider) {
        sql += ' AND provider = ?';
        params.push(query.provider);
      }

      if (query.model) {
        sql += ' AND model = ?';
        params.push(query.model);
      }

      if (query.success !== undefined) {
        sql += ' AND success = ?';
        params.push(query.success ? 1 : 0);
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
        streaming: !!row.streaming,
        success: !!row.success,
        tokenUsage: row.token_usage_total ? {
          prompt: row.token_usage_prompt,
          completion: row.token_usage_completion,
          total: row.token_usage_total,
        } : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }));
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to query logs:', error);
      return [];
    }
  }

  /**
   * Get request statistics
   */
  async getStats(startDate?: string, endDate?: string): Promise<ChatLogStats> {
    await this.initialize();
    if (!this.db) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        totalTokens: 0,
        averageTokensPerRequest: 0,
        successRate: 0,
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
      const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM chat_request_logs ${whereClause}`);
      const successStmt = this.db.prepare(`SELECT COUNT(*) as count FROM chat_request_logs ${whereClause} AND success = 1`);
      const failedStmt = this.db.prepare(`SELECT COUNT(*) as count FROM chat_request_logs ${whereClause} AND success = 0`);
      const avgLatencyStmt = this.db.prepare(`SELECT AVG(latency_ms) as avg FROM chat_request_logs ${whereClause} AND latency_ms IS NOT NULL`);
      const totalTokensStmt = this.db.prepare(`SELECT SUM(token_usage_total) as total FROM chat_request_logs ${whereClause} AND token_usage_total IS NOT NULL`);

      const total = (totalStmt.get(...params) as any).count;
      const successful = (successStmt.get(...params) as any).count;
      const failed = (failedStmt.get(...params) as any).count;
      const avgLatency = (avgLatencyStmt.get(...params) as any).avg || 0;
      const totalTokens = (totalTokensStmt.get(...params) as any).total || 0;

      return {
        totalRequests: total,
        successfulRequests: successful,
        failedRequests: failed,
        averageLatencyMs: Math.round(avgLatency),
        totalTokens,
        averageTokensPerRequest: total > 0 ? Math.round(totalTokens / total) : 0,
        successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      };
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to get stats:', error);
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageLatencyMs: 0,
        totalTokens: 0,
        averageTokensPerRequest: 0,
        successRate: 0,
      };
    }
  }

  /**
   * Get per-model performance metrics
   * Used by model-ranker for telemetry-based model selection
   */
  async getModelPerformance(minutesBack: number = 10): Promise<Array<{
    provider: string;
    model: string;
    avgLatency: number;
    failureRate: number;
    totalCalls: number;
    lastUpdated: number;
    successRate: number;
  }>> {
    await this.initialize();
    if (!this.db) {
      return [];
    }

    try {
      // Match SQLite datetime format (YYYY-MM-DD HH:MM:SS)
      const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

      const stmt = this.db.prepare(`
        SELECT 
          provider,
          model,
          COUNT(*) as totalCalls,
          AVG(latency_ms) as avgLatency,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
          MAX(created_at) as lastUpdated,
          AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successRate
        FROM chat_request_logs
        WHERE created_at >= ?
        GROUP BY provider, model
        HAVING totalCalls >= 1
        ORDER BY avgLatency ASC
      `);

      const results = stmt.all(cutoffTime) as any[];

      return results.map(row => ({
        provider: row.provider,
        model: row.model,
        avgLatency: Math.round(row.avgLatency || 0),
        failureRate: row.totalCalls > 0 ? row.failures / row.totalCalls : 0,
        lastUpdated: new Date(row.lastUpdated).getTime(),
        totalCalls: row.totalCalls,
        successRate: row.successRate || 1 - (row.failures / row.totalCalls),
      }));
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to get model performance:', error);
      return [];
    }
  }

  /**
   * Clean up old logs
   */
  async cleanupOldLogs(daysToKeep: number = 30): Promise<number> {
    await this.initialize();
    if (!this.db) return 0;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const stmt = this.db.prepare(`
        DELETE FROM chat_request_logs
        WHERE created_at < ?
      `);

      const result = stmt.run(cutoffDate.toISOString());
      console.log(`[ChatRequestLogger] Cleaned up ${result.changes} old logs`);
      return result.changes;
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to cleanup old logs:', error);
      return 0;
    }
  }
}

// Singleton instance
export const chatRequestLogger = new ChatRequestLogger();

// Auto-cleanup old logs every 24 hours
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    chatRequestLogger.cleanupOldLogs(30);
  }, 24 * 60 * 60 * 1000);
}
