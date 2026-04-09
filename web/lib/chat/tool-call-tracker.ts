/**
 * Tool Call Tracker
 *
 * Tracks per-model tool execution success/failure for smart retry model selection.
 * Uses SQLite (same DB as chat-request-logger) for persistence.
 *
 * Scoring:
 *   +1 for each successful tool call
 *   -1 for each failed tool call (empty args, invalid path, diff failed, etc.)
 *   0 for tool calls that didn't execute (model declined to call tools)
 *
 * Used by:
 *   - model-ranker.ts → getRetryModel() for intelligent retry model selection
 *   - route.ts → empty response retry logic
 *   - enhanced-llm-service.ts → tool execution feedback
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('ToolCallTracker');

export interface ToolCallRecord {
  /** The model that made the tool call */
  model: string;
  /** The provider (openai, anthropic, etc.) */
  provider: string;
  /** Tool name (read_file, write_file, apply_diff, etc.) */
  toolName: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: number;
  /** Conversation ID for correlation */
  conversationId?: string;
}

export interface ModelToolStats {
  provider: string;
  model: string;
  /** Total tool calls attempted */
  totalToolCalls: number;
  /** Successful tool calls */
  successfulToolCalls: number;
  /** Failed tool calls */
  failedToolCalls: number;
  /** Cumulative score: +1 per success, -1 per failure */
  toolCallScore: number;
  /** Tool success rate (0-1) */
  toolSuccessRate: number;
  /** Average score per call (-1 to +1) */
  avgToolScore: number;
  /** When this was last updated */
  lastUpdated: number;
  /** Breakdown by tool name */
  toolBreakdown: Record<string, { success: number; failed: number; score: number }>;
}

class ToolCallTracker {
  private db: any = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the SQLite database (shared with chat-request-logger)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const Database = require('better-sqlite3');
        const dbPath = process.env.TOOL_CALL_DB_PATH || 'tool-calls.db';
        this.db = new Database(dbPath);

        // Enable WAL mode for concurrent reads
        this.db.pragma('journal_mode = WAL');

        this.db.exec(`
          CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            provider TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            success INTEGER NOT NULL,
            error TEXT,
            timestamp INTEGER NOT NULL,
            conversation_id TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_tool_calls_model
            ON tool_calls(provider, model, timestamp);
          CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp
            ON tool_calls(timestamp);
        `);

        this.initialized = true;
        logger.info('Tool call tracker initialized');
      } catch (error) {
        logger.error('Failed to initialize tool call tracker', error);
        this.initialized = false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Record a tool call execution result.
   * Call this whenever a tool call succeeds or fails.
   */
  async recordToolCall(record: ToolCallRecord): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO tool_calls (model, provider, tool_name, success, error, timestamp, conversation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.model,
        record.provider,
        record.toolName,
        record.success ? 1 : 0,
        record.error || null,
        record.timestamp,
        record.conversationId || null,
      );
    } catch (error) {
      logger.warn('Failed to record tool call', { model: record.model, tool: record.toolName, error });
    }
  }

  /**
   * Record multiple tool calls at once (batch insert).
   */
  async recordToolCalls(records: ToolCallRecord[]): Promise<void> {
    await this.initialize();
    if (!this.db || records.length === 0) return;

    try {
      const insert = this.db.prepare(`
        INSERT INTO tool_calls (model, provider, tool_name, success, error, timestamp, conversation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = this.db.transaction((rows: any[][]) => {
        for (const row of rows) {
          insert.run(...row);
        }
      });

      const rows = records.map(r => [
        r.model,
        r.provider,
        r.toolName,
        r.success ? 1 : 0,
        r.error || null,
        r.timestamp,
        r.conversationId || null,
      ]);

      insertMany(rows);
    } catch (error) {
      logger.warn('Failed to batch record tool calls', error);
    }
  }

  /**
   * Get per-model tool stats for the last N minutes.
   * Returns stats sorted by tool success rate (best first).
   */
  async getModelToolStats(minutesBack: number = 30): Promise<ModelToolStats[]> {
    await this.initialize();
    if (!this.db) return [];

    try {
      const cutoffTime = Date.now() - minutesBack * 60 * 1000;

      const stmt = this.db.prepare(`
        SELECT
          provider,
          model,
          tool_name,
          COUNT(*) as totalCalls,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
        FROM tool_calls
        WHERE timestamp >= ?
        GROUP BY provider, model, tool_name
      `);

      const results = stmt.all(cutoffTime) as Array<{
        provider: string;
        model: string;
        tool_name: string;
        totalCalls: number;
        successes: number;
        failures: number;
      }>;

      // Aggregate per model
      const modelMap = new Map<string, ModelToolStats>();

      for (const row of results) {
        const key = `${row.provider}:${row.model}`;

        if (!modelMap.has(key)) {
          modelMap.set(key, {
            provider: row.provider,
            model: row.model,
            totalToolCalls: 0,
            successfulToolCalls: 0,
            failedToolCalls: 0,
            toolCallScore: 0,
            toolSuccessRate: 0,
            avgToolScore: 0,
            lastUpdated: Date.now(),
            toolBreakdown: {},
          });
        }

        const stats = modelMap.get(key)!;
        stats.totalToolCalls += row.totalCalls;
        stats.successfulToolCalls += row.successes;
        stats.failedToolCalls += row.failures;
        stats.toolCallScore += row.successes - row.failures;
        stats.toolBreakdown[row.tool_name] = {
          success: row.successes,
          failed: row.failures,
          score: row.successes - row.failures,
        };
      }

      // Calculate rates
      for (const stats of modelMap.values()) {
        stats.toolSuccessRate = stats.totalToolCalls > 0
          ? stats.successfulToolCalls / stats.totalToolCalls
          : 0;
        stats.avgToolScore = stats.totalToolCalls > 0
          ? stats.toolCallScore / stats.totalToolCalls
          : 0;
      }

      return Array.from(modelMap.values()).sort((a, b) => {
        // Primary sort: avgToolScore (higher is better)
        if (Math.abs(a.avgToolScore - b.avgToolScore) > 0.05) {
          return b.avgToolScore - a.avgToolScore;
        }
        // Tiebreaker: success rate
        return b.toolSuccessRate - a.toolSuccessRate;
      });
    } catch (error) {
      logger.error('Failed to get model tool stats', error);
      return [];
    }
  }

  /**
   * Get stats for a specific model.
   */
  async getModelToolStatsForModel(
    provider: string,
    model: string,
    minutesBack: number = 30
  ): Promise<ModelToolStats | null> {
    const allStats = await this.getModelToolStats(minutesBack);
    return allStats.find(s => s.provider === provider && s.model === model) || null;
  }

  /**
   * Clean up old records (keep last N days).
   */
  async cleanupOldRecords(daysToKeep: number = 7): Promise<number> {
    await this.initialize();
    if (!this.db) return 0;

    try {
      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      const stmt = this.db.prepare('DELETE FROM tool_calls WHERE timestamp < ?');
      const result = stmt.run(cutoffTime);
      logger.info(`Cleaned up ${result.changes} old tool call records`);
      return result.changes;
    } catch (error) {
      logger.error('Failed to cleanup old tool call records', error);
      return 0;
    }
  }

  /**
   * Get raw records for debugging/analysis.
   */
  async getRawRecords(limit: number = 100): Promise<any[]> {
    await this.initialize();
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM tool_calls ORDER BY timestamp DESC LIMIT ?
      `);
      return stmt.all(limit);
    } catch (error) {
      logger.error('Failed to get raw records', error);
      return [];
    }
  }
}

// Singleton instance
export const toolCallTracker = new ToolCallTracker();

// Auto-cleanup old records every 24 hours
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    toolCallTracker.cleanupOldRecords(7);
  }, 24 * 60 * 60 * 1000);
}
