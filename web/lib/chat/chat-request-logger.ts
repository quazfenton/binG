/**
 * Chat API Request Logging with Comprehensive Telemetry
 *
 * Provides comprehensive request/response logging for the chat API.
 * Useful for debugging, analytics, compliance, and model ranking.
 *
 * Features:
 * - SQLite persistence for request logs
 * - Query by user, date range, provider
 * - Token usage tracking
 * - Latency metrics
 * - Error tracking
 * - Tool execution telemetry (calls, args, results, success rate)
 * - Telemetry scoring (latency, token efficiency, tool success, overall)
 */

import { getDatabase } from '@/lib/database/connection';
import { execSchemaFile } from '@/lib/database/schema';

// Dynamic import to avoid circular dependency with model-ranker
// model-ranker imports chatRequestLogger, so we import recordModelAttempt lazily

/**
 * Async wrapper for recordModelAttempt to avoid circular imports
 */
async function recordModelAttemptAsync(provider: string, model: string, success: boolean): Promise<void> {
  try {
    const { recordModelAttempt } = await import('@/lib/models/model-ranker');
    recordModelAttempt(provider, model, success);
  } catch (error) {
    console.warn('[ChatRequestLogger] Failed to record model attempt:', error);
  }
}

/**
 * FIX: Also track rate limit errors for circuit breaker
 * This ensures failed attempts update the rotation data even before request completion
 */
async function recordRateLimitErrorAsync(provider: string, model: string): Promise<void> {
  try {
    const { recordRateLimitError, recordModelAttempt } = await import('@/lib/models/model-ranker');
    recordRateLimitError(provider, model);
    // FIX: Also record as a failed attempt so rotation tracking knows this model failed
    recordModelAttempt(provider, model, false);
  } catch (error) {
    console.warn('[ChatRequestLogger] Failed to record rate limit error:', error);
  }
}

export interface ToolCallTelemetry {
  toolCallId: string;
  toolName: string;
  state: 'call' | 'result';
  args?: Record<string, any>;
  result?: any;
  latencyMs?: number;
  success?: boolean;
}

export interface TelemetryScores {
  latencyScore: number;      // 0-1, lower latency = higher score (exponential decay)
  tokenEfficiency: number;   // 0-1, tokens per content char ratio
  toolSuccessRate: number;   // 0-1, tool call success rate
  overallScore: number;      // 0-1, weighted composite (40% latency, 30% efficiency, 30% tools)
}

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
  // Tool execution telemetry
  toolCalls?: ToolCallTelemetry[];
  toolCallCount?: number;
  toolCallSuccessCount?: number;
  toolCallFailCount?: number;
  // Telemetry scores
  telemetryScores?: TelemetryScores;
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

export class ChatRequestLogger {
  private db: any = null;
  private initialized = false;

  /**
   * Initialize database for request logging
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = getDatabase();

      // logging-schema.sql defines chat_request_logs + tool_calls + hitl_audit_logs
      execSchemaFile(this.db, 'logging-schema');

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
    model: string | undefined,
    messages: any[],
    streaming: boolean,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
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
        model || 'unknown',
        messages.length,
        requestSize,
        streaming ? 1 : 0,
        metadata ? JSON.stringify(metadata) : null
      );
    } catch (error: any) {
      if (error?.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        console.error('[ChatRequestLogger] Failed to log request start:', error);
      }
    }
  }

  /**
   * Log a chat request completion with comprehensive telemetry
   */
   async logRequestComplete(
     requestId: string,
     success: boolean,
     responseSize?: number,
     tokenUsage?: { prompt: number; completion: number; total: number },
     latencyMs?: number,
     error?: string,
     actualProvider?: string,
     actualModel?: string,
     // Tool execution telemetry
     toolCalls?: ToolCallTelemetry[],
     contentLength?: number,
   ): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    // Detect model-not-found errors — penalize ALL telemetry scores by -10
    // so the model never gets selected again for fastModel or tool-capable routing
    const isModelNotFoundError = error && /not found|invalid.*model|model.*invalid|does not exist|unknown model|404/i.test(error);

    // FIX: Detect rate limit errors (429) and track them immediately
    // This ensures the circuit breaker and rotation tracking are updated
    // even for streaming requests that fail before completion
      const isRateLimitError = error && /429|rate.limit|too many requests|quota exceeded/i.test(error);
      const finalProvider = actualProvider;
      const finalModel = actualModel;

    // FIX: Track rate limit errors immediately (before the DB write)
    // This ensures rotation tracking and circuit breaker are updated
    if (isRateLimitError && finalProvider && finalModel && finalModel !== 'unknown') {
      recordRateLimitErrorAsync(finalProvider, finalModel).catch(() => {
        // Non-fatal - don't fail logging due to rate limit tracking
      });
    }

    // Compute telemetry scores
    let telemetryScores = this.computeTelemetryScores({
      latencyMs: latencyMs || 0,
      tokenUsage,
      toolCalls,
      contentLength: contentLength || 0,
    });

    // Apply -10 penalty across ALL scores for model-not-found errors
    if (isModelNotFoundError) {
      telemetryScores = {
        latencyScore: -10,
        tokenEfficiency: -10,
        toolSuccessRate: -10,
        overallScore: -10,
      };
    }

    // Aggregate tool call stats
    const toolCallCount = toolCalls?.length || 0;
    const toolCallSuccessCount = toolCalls?.filter(t => t.success !== false).length || 0;
    const toolCallFailCount = toolCalls?.filter(t => t.success === false).length || 0;

    try {
      const stmt = this.db.prepare(`
        UPDATE chat_request_logs
        SET response_size = ?,
            token_usage_prompt = ?,
            token_usage_completion = ?,
            token_usage_total = ?,
            latency_ms = ?,
            success = ?,
            error = ?,
            provider = COALESCE(?, provider),
            model = COALESCE(?, model),
            metadata = json_patch(
              COALESCE(json(metadata), '{}'),
              json(?)
            )
        WHERE id = ?
      `);

      // Merge tool telemetry into metadata (truncate args/result for storage)
      const metadataExtension: Record<string, any> = {};
      if (toolCalls && toolCalls.length > 0) {
        metadataExtension.toolCalls = toolCalls.map(t => ({
          toolCallId: t.toolCallId,
          toolName: t.toolName,
          state: t.state,
          args: t.args ? JSON.stringify(t.args).slice(0, 500) : undefined,
          result: t.result ? JSON.stringify(t.result).slice(0, 500) : undefined,
          latencyMs: t.latencyMs,
          success: t.success,
        }));
        metadataExtension.toolCallCount = toolCallCount;
        metadataExtension.toolCallSuccessCount = toolCallSuccessCount;
        metadataExtension.toolCallFailCount = toolCallFailCount;
      }
      if (telemetryScores) {
        metadataExtension.telemetryScores = telemetryScores;
      }

      stmt.run(
        responseSize || null,
        tokenUsage?.prompt || null,
        tokenUsage?.completion || null,
        tokenUsage?.total || null,
        latencyMs || null,
        success ? 1 : 0,
        error || null,
        actualProvider || null,
        actualModel || null,
        Object.keys(metadataExtension).length > 0 ? JSON.stringify(metadataExtension) : '{}',
        requestId
      );

      // Log telemetry summary to console for real-time monitoring
      if (toolCalls && toolCalls.length > 0) {
        console.log(
          `[Telemetry] ${requestId}: ${toolCallCount} tools (${toolCallSuccessCount}✓/${toolCallFailCount}✗), ` +
          `scores: latency=${(telemetryScores?.latencyScore || 0).toFixed(2)} ` +
          `efficiency=${(telemetryScores?.tokenEfficiency || 0).toFixed(2)} ` +
          `tools=${(telemetryScores?.toolSuccessRate || 0).toFixed(2)} ` +
          `overall=${(telemetryScores?.overallScore || 0).toFixed(2)}`
        );
      }

       // CRITICAL: Record model attempt for rotation tracking
       // This allows the model-ranker to prefer untested models over stuck ones
       // Using dynamic import to avoid circular dependency with model-ranker
       const finalProvider = actualProvider;
       const finalModel = actualModel;
       if (finalProvider && finalModel && finalModel !== 'unknown') {
         // Dynamic import to avoid circular dependency
         recordModelAttemptAsync(finalProvider, finalModel, success).catch(() => {
           // Non-fatal - don't fail logging due to rotation tracking
         });
      }
    } catch (error) {
      console.error('[ChatRequestLogger] Failed to log request complete:', error);
    }
  }

  /**
   * Compute telemetry scores for a completed request
   */
  private computeTelemetryScores(options: {
    latencyMs: number;
    tokenUsage?: { prompt: number; completion: number; total: number };
    toolCalls?: Array<{ success?: boolean }>;
    contentLength: number;
  }): TelemetryScores {
    const { latencyMs, tokenUsage, toolCalls, contentLength } = options;

    // Latency score: 0-1, exponential decay
    // < 2s = 1.0, 5s = 0.6, 10s = 0.37, 20s = 0.14, 30s+ = 0.05
    const latencyScore = Math.exp(-latencyMs / 5000);

    // Token efficiency: tokens per content character
    // Good ratio: ~0.3-0.5 tokens per char (efficient)
    // Bad ratio: > 2.0 tokens per char (wasteful)
    let tokenEfficiency = 0.5; // default
    if (tokenUsage && contentLength > 0) {
      const tokensPerChar = tokenUsage.total / contentLength;
      // Score: 1.0 at 0.3 tpc, 0.5 at 1.0 tpc, 0.1 at 3.0+ tpc
      tokenEfficiency = Math.max(0.05, Math.min(1.0, 1.0 / (1 + tokensPerChar * 0.7)));
    }

    // Tool success rate
    let toolSuccessRate = 1.0; // default if no tools
    if (toolCalls && toolCalls.length > 0) {
      const successCount = toolCalls.filter(t => t.success !== false).length;
      toolSuccessRate = successCount / toolCalls.length;
    }

    // Overall score: weighted composite
    // 40% latency, 30% token efficiency, 30% tool success
    const overallScore = 0.4 * latencyScore + 0.3 * tokenEfficiency + 0.3 * toolSuccessRate;

    return {
      latencyScore: Math.round(latencyScore * 100) / 100,
      tokenEfficiency: Math.round(tokenEfficiency * 100) / 100,
      toolSuccessRate: Math.round(toolSuccessRate * 100) / 100,
      overallScore: Math.round(overallScore * 100) / 100,
    };
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
    if (!this.db) return [];

    try {
      const cutoffTime = new Date(Date.now() - minutesBack * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

      const stmt = this.db.prepare(`
        SELECT
          provider,
          model,
          COUNT(*) as totalCalls,
          AVG(latency_ms) as avgLatency,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
          MAX(created_at) as lastUpdated,
          AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successRate,
          MIN(
            CASE
              WHEN json_extract(metadata, '$.telemetryScores.overallScore') IS NOT NULL
              THEN json_extract(metadata, '$.telemetryScores.overallScore')
              ELSE NULL
            END
          ) as minTelemetryScore
        FROM chat_request_logs
        WHERE created_at >= ?
        GROUP BY provider, model
        HAVING totalCalls >= 1
        ORDER BY avgLatency ASC
      `);

      const results = stmt.all(cutoffTime) as any[];

      return results.map(row => {
        const rawFailureRate = row.totalCalls > 0 ? row.failures / row.totalCalls : 0;
        const minTelemetryScore = row.minTelemetryScore;

        // If any request had a -10 telemetry score (model-not-found), propagate it
        // by setting failureRate to -10 and successRate to -10
        const isPenalized = minTelemetryScore !== null && minTelemetryScore < 0;

        return {
          provider: row.provider,
          model: row.model,
          avgLatency: Math.round(row.avgLatency || 0),
          failureRate: isPenalized ? -10 : rawFailureRate,
          lastUpdated: new Date(row.lastUpdated).getTime(),
          totalCalls: row.totalCalls,
          successRate: isPenalized ? -10 : (row.successRate || 1 - rawFailureRate),
        };
      });
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
