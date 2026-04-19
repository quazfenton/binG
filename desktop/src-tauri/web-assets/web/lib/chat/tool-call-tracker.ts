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
  /** Unique tool call ID for deduplication */
  toolCallId?: string;
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
  /** In-memory fallback when SQLite is unavailable */
  private memoryRecords: ToolCallRecord[] = [];
  /** Deduplication set: tracks seen toolCallIds to prevent double-counting */
  private seenToolCallIds = new Set<string>();

  /**
   * Initialize the SQLite database (shared with chat-request-logger)
   * Falls back to in-memory storage if better-sqlite3 is unavailable.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const path = await import('path');
        const dbPath = process.env.TOOL_CALL_DB_PATH ||
          path.join(process.cwd(), '.data', 'tool-calls.db');

        // Ensure directory exists
        const fs = await import('fs');
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        const Database = require('better-sqlite3');
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
            conversation_id TEXT,
            tool_call_id TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_tool_calls_model
            ON tool_calls(provider, model, timestamp);
          CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp
            ON tool_calls(timestamp);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_dedup
            ON tool_calls(tool_call_id) WHERE tool_call_id IS NOT NULL;
        `);

        this.initialized = true;
        logger.info('Tool call tracker initialized (SQLite)');
      } catch (error) {
        logger.warn('better-sqlite3 unavailable, using in-memory fallback', error);
        this.initialized = true; // Mark as initialized so we use memory fallback
      }
    })();

    return this.initPromise;
  }

  /**
   * Record a tool call execution result.
   * Deduplicates by toolCallId to prevent double-counting from both
   * stream handler and onToolExecution callback.
   */
  async recordToolCall(record: ToolCallRecord): Promise<void> {
    await this.initialize();

    // Real-time console logging for immediate visibility
    const statusIcon = record.success ? '✓' : '✗';
    const errorSuffix = record.error ? ` — ${record.error.slice(0, 80)}` : '';
    console.log(
      `[ToolCall] ${statusIcon} ${record.model} (${record.provider}) → ${record.toolName}${errorSuffix}`
    );

    // Deduplicate by toolCallId
    if (record.toolCallId) {
      if (this.seenToolCallIds.has(record.toolCallId)) {
        return; // Already recorded
      }
      this.seenToolCallIds.add(record.toolCallId);

      // Cap dedup set size to prevent memory leak
      if (this.seenToolCallIds.size > 10000) {
        // Keep only the most recent 5000
        const arr = Array.from(this.seenToolCallIds);
        this.seenToolCallIds = new Set(arr.slice(-5000));
      }
    }

    // SQLite path
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO tool_calls (model, provider, tool_name, success, error, timestamp, conversation_id, tool_call_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          record.model,
          record.provider,
          record.toolName,
          record.success ? 1 : 0,
          record.error || null,
          record.timestamp,
          record.conversationId || null,
          record.toolCallId || null,
        );
        return;
      } catch (error) {
        logger.warn('SQLite insert failed, falling back to memory', { tool: record.toolName, error });
      }
    }

    // In-memory fallback
    this.memoryRecords.push(record);
  }

  /**
   * Record multiple tool calls at once (batch insert).
   */
  async recordToolCalls(records: ToolCallRecord[]): Promise<void> {
    await this.initialize();
    if (records.length === 0) return;

    // Filter out duplicates
    const uniqueRecords = records.filter(r => {
      if (r.toolCallId) {
        if (this.seenToolCallIds.has(r.toolCallId)) return false;
        this.seenToolCallIds.add(r.toolCallId);
      }
      return true;
    });

    if (uniqueRecords.length === 0) return;

    // Real-time console logging for batch
    for (const r of uniqueRecords) {
      const statusIcon = r.success ? '✓' : '✗';
      const errorSuffix = r.error ? ` — ${r.error.slice(0, 80)}` : '';
      console.log(
        `[ToolCall] ${statusIcon} ${r.model} (${r.provider}) → ${r.toolName}${errorSuffix}`
      );
    }

    // SQLite batch path
    if (this.db) {
      try {
        const insert = this.db.prepare(`
          INSERT INTO tool_calls (model, provider, tool_name, success, error, timestamp, conversation_id, tool_call_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = this.db.transaction((rows: any[][]) => {
          for (const row of rows) {
            insert.run(...row);
          }
        });

        const rows = uniqueRecords.map(r => [
          r.model,
          r.provider,
          r.toolName,
          r.success ? 1 : 0,
          r.error || null,
          r.timestamp,
          r.conversationId || null,
          r.toolCallId || null,
        ]);

        insertMany(rows);
        return;
      } catch (error) {
        logger.warn('SQLite batch insert failed, falling back to memory', error);
      }
    }

    // In-memory fallback
    this.memoryRecords.push(...uniqueRecords);
  }

  /**
   * Get per-model tool stats for the last N minutes.
   * Returns stats sorted by tool success rate (best first).
   * Uses SQLite if available, falls back to in-memory records.
   */
  async getModelToolStats(minutesBack: number = 30): Promise<ModelToolStats[]> {
    await this.initialize();

    let records: ToolCallRecord[] = [];

    if (this.db) {
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

        return this.aggregateToolStats(results.map(r => ({
          provider: r.provider,
          model: r.model,
          toolName: r.tool_name,
          totalCalls: r.totalCalls,
          successes: r.successes,
          failures: r.failures,
        })));
      } catch (error) {
        logger.warn('SQLite query failed, using memory fallback', error);
      }
    }

    // In-memory fallback
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;
    const recentRecords = this.memoryRecords.filter(r => r.timestamp >= cutoffTime);

    // Group by provider:model:toolName
    const grouped = new Map<string, { provider: string; model: string; toolName: string; totalCalls: number; successes: number; failures: number }>();

    for (const record of recentRecords) {
      const key = `${record.provider}:${record.model}:${record.toolName}`;
      if (!grouped.has(key)) {
        grouped.set(key, { provider: record.provider, model: record.model, toolName: record.toolName, totalCalls: 0, successes: 0, failures: 0 });
      }
      const entry = grouped.get(key)!;
      entry.totalCalls++;
      if (record.success) entry.successes++;
      else entry.failures++;
    }

    return this.aggregateToolStats(Array.from(grouped.values()));
  }

  /** Aggregate raw tool stats records into ModelToolStats array */
  private aggregateToolStats(records: Array<{
    provider: string;
    model: string;
    toolName: string;
    totalCalls: number;
    successes: number;
    failures: number;
  }>): ModelToolStats[] {
    const modelMap = new Map<string, ModelToolStats>();

    for (const row of records) {
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
      stats.toolBreakdown[row.toolName] = {
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
    let totalCleaned = 0;

    // SQLite cleanup
    if (this.db) {
      try {
        const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
        const stmt = this.db.prepare('DELETE FROM tool_calls WHERE timestamp < ?');
        const result = stmt.run(cutoffTime);
        totalCleaned += result.changes;
      } catch (error) {
        logger.warn('SQLite cleanup failed', error);
      }
    }

    // In-memory cleanup
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const beforeCount = this.memoryRecords.length;
    this.memoryRecords = this.memoryRecords.filter(r => r.timestamp >= cutoffTime);
    totalCleaned += beforeCount - this.memoryRecords.length;

    if (totalCleaned > 0) {
      logger.info(`Cleaned up ${totalCleaned} old tool call records`);
    }
    return totalCleaned;
  }

  /**
   * Get raw records for debugging/analysis.
   */
  async getRawRecords(limit: number = 100): Promise<any[]> {
    await this.initialize();
    const records: any[] = [];

    // SQLite records
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          SELECT * FROM tool_calls ORDER BY timestamp DESC LIMIT ?
        `);
        records.push(...stmt.all(limit));
      } catch (error) {
        logger.warn('SQLite raw records query failed', error);
      }
    }

    // In-memory records
    const memoryRecords = [...this.memoryRecords].sort((a, b) => b.timestamp - a.timestamp);
    const remaining = limit - records.length;
    if (remaining > 0) {
      records.push(...memoryRecords.slice(0, remaining));
    }

    return records;
  }

  /**
   * Clear the deduplication cache (useful for testing).
   */
  clearDedupCache(): void {
    this.seenToolCallIds.clear();
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
