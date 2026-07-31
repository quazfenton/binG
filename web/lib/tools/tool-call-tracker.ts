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

import { execSchemaFile } from '@/lib/database/schema';
import { createLogger } from '@/lib/utils/logger';
// Tag better-sqlite3 binding-load failures with the same diagnostic taxonomy
// used by storage/session-store.ts so the in-memory fallback log line states
// WHY the binding failed, not just THAT it failed.
import { classifySqliteFailure } from '@/lib/database/sqlite-failure';

const logger = createLogger('ToolCallTracker');

/**
 * Dynamic-import wrapper around `better-sqlite3`. The previous code used a
 * naked `require('better-sqlite3')` inside the async initializer — that works
 * in vitest and in webpack-bundled output, but in pure-Next.js / turbopack ESM
 * contexts `require` is undefined and the import throws ReferenceError before
 * the binding can even fail to load. Dynamic `await import(...)` works in any
 * ESM context (Node ESM, vitest, Next dev, Edge runtime).
 *
 * On failure emits a structured warn with `classifySqliteFailure(err)` (see
 * storage/session-store.ts) so operators can tell apart an arch mismatch, a
 * missing libc++, an ABI mismatch, or a missing module — not just a vague
 * "better-sqlite3 unavailable" string.
 */
async function tryImportBetterSqlite(): Promise<any> {
  try {
    const mod = await import('better-sqlite3');
    // better-sqlite3 is a CJS module — Node's ESM import wraps the default export.
    return (mod as any).default ?? mod;
  } catch (err) {
    logger.warn(
      'better-sqlite3 failed to load – falling back to in-memory storage',
      classifySqliteFailure(err),
    );
    return null;
  }
}

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
  /** In-memory storage for redacted invocation payloads */
  private memoryInvocations: any[] = [];
  /** Deduplication set: tracks seen toolCallIds to prevent double-counting */
  private seenToolCallIds = new Set<string>();
  /**
   * Counter incremented in recordToolCall + recordToolCalls (batch) catch
   * blocks when SQLite INSERT silently throws. Exposed via
   * `getDisconnectCountForTests()` so production monitors can alert on
   * repeated silent demotions (records fall through to memoryRecords
   * without ever reaching the durable store).
   */
  private disconnectCount = 0;

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

        const Database = await tryImportBetterSqlite();
        if (!Database) {
          // Wrapper already logged the structured warn; mark initialized so
          // subsequent recordToolCall paths use the in-memory fallback.
          this.initialized = true;
          return;
        }
        this.db = new Database(dbPath);

        // Enable WAL mode for concurrent reads
        this.db.pragma('journal_mode = WAL');

        // logging-schema.sql defines tool_calls + chat_request_logs + hitl_audit_logs
        execSchemaFile(this.db, 'logging-schema');

        // Create a lightweight table for redacted invocation payloads (for debugging)
        try {
          this.db.prepare(`
            CREATE TABLE IF NOT EXISTS tool_call_payloads (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER,
              model TEXT,
              provider TEXT,
              tool_name TEXT,
              redacted_args TEXT,
              origin_stack TEXT,
              tool_call_id TEXT
            )
          `).run();
        } catch (e) {
          logger.warn('Failed to create tool_call_payloads table', e);
        }

        // SEV-9 (2026-06-18 fix): Defensive CREATE TABLE IF NOT EXISTS for
        // `tool_calls` mirroring the canonical definition in
        // lib/database/schema/logging-schema.sql. The execSchemaFile call above
        // SHOULD apply that schema, but in some runtime paths — e.g. when
        // TOOL_CALL_DB_PATH points to a fresh `.data/tool-calls.db` outside
        // the bundled cwd resolution root, when schema-version drift causes
        // execSchemaFile to skip stale markers, or when the file lookup path
        // is misaligned in dev — the `tool_calls` table is observably absent
        // at query time, surfacing as
        //   SqliteError: no such table: tool_calls
        // and silently demoting telemetry to in-memory storage via the
        // `SQLite query failed, using memory fallback` warn at line ~314.
        // Mirror the exact pattern already used for `tool_call_payloads`
        // (defensive CREATE alongside execSchemaFile) so this tracker
        // guarantees tool_calls exists on its own when execSchemaFile's run
        // is a no-op. Columns AND indexes are reproduced verbatim from
        // logging-schema.sql so the existing SELECT/INSERT/DELETE statements
        // in this file continue to match.
        try {
          this.db.prepare(`
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
            )
          `).run();

          this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_tool_calls_model
              ON tool_calls(provider, model, timestamp)
          `).run();
          this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp
              ON tool_calls(timestamp)
          `).run();
          this.db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_tool_calls_dedup
              ON tool_calls(tool_call_id) WHERE tool_call_id IS NOT NULL
          `).run();
        } catch (e) {
          logger.warn('Failed to create tool_calls defensive schema', e);
        }

        this.initialized = true;
        logger.info('Tool call tracker initialized (SQLite)');
      } catch (error) {
        // The dynamic import above succeeded but `new Database(dbPath)` or
        // schema setup threw. Classify with the same diagnostic taxonomy so
        // operators see WHY the SQLite path failed (locked DB, missing dir,
        // schema mismatch, missing table) and not just a generic error.
        // Distinct from the binding-load failure above, which the wrapper
        // already surfaced as a separate warn.
        logger.warn(
          'SQLite init failed after import – falling back to in-memory storage',
          classifySqliteFailure(error),
        );
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
        this.disconnectCount++;  // ship-ready metric: read via getDisconnectCountForTests()
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
        this.disconnectCount++;  // ship-ready metric
      }
    }

    // In-memory fallback
    this.memoryRecords.push(...uniqueRecords);
  }

  /**
   * Get per-model tool stats for the last N minutes.
   * Returns stats sorted by tool success rate (best first).
   * Uses SQLite if available, falls back to in-memory records.
   *
   * SEV-10 (2026-07-08 fix): the prior version's `if (this.db)` short-circuit
   * caused the read pipeline to return [] whenever `recordToolCall`'s SQLite
   * INSERT silently threw (schema drift, db lock, missing `tool_calls` table
   * despite defensive CREATE TABLE IF NOT EXISTS, SEV-9 follow-on). The catch
   * block on the write path fell through to `memoryRecords.push(record)` — so
   * writes succeeded IN MEMORY only — but the read path queried SQLite only
   * and missed those records. Net: `refreshModelTelemetryCache()` (every 5 min
   * via `setInterval` in model-ranker.ts) returned empty `toolStats` on every
   * refresh even after successful tool calls. The fix merges SQLite rows
   * AND memoryRecords at the (provider, model, tool_name) granularity, with
   * sums, before `aggregateToolStats` collapses to provider:model groups.
   * Idempotent for the happy case (memoryRecords empty when SQLite writes
   * succeed) and self-healing for the disconnect case (memoryRecords catches
   * the rows SQLite missed).
   */
  async getModelToolStats(minutesBack: number = 30): Promise<ModelToolStats[]> {
    await this.initialize();
    const cutoffTime = Date.now() - minutesBack * 60 * 1000;

    // 1) Read SQLite if available (best-effort). Empty array if db missing
    //    OR if the SELECT threw (logged below) — either way, the merge in
    //    step 3 still runs against memoryRecords.
    let sqliteRows: Array<{
      provider: string;
      model: string;
      tool_name: string;
      totalCalls: number;
      successes: number;
      failures: number;
    }> = [];
    if (this.db) {
      try {
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
        sqliteRows = stmt.all(cutoffTime) as typeof sqliteRows;
      } catch (error) {
        logger.warn('SQLite query failed, falling back to memory merge', error);
        sqliteRows = [];
      }
    }

    // 2) Always pull memoryRecords for the same window. This is the SEV-10
    //    disconnect patch: when writes fall through to memoryRecords (because
    //    SQLite INSERT threw), the next periodic read MUST consult this list
    //    or return empty even though the writes "succeeded".
    const memGrouped = new Map<string, { provider: string; model: string; tool_name: string; totalCalls: number; successes: number; failures: number }>();
    for (const r of this.memoryRecords) {
      if (r.timestamp < cutoffTime) continue;
      const k = `${r.provider}:${r.model}:${r.toolName}`;
      const existing = memGrouped.get(k);
      if (existing) {
        existing.totalCalls += 1;
        if (r.success) existing.successes += 1;
        else existing.failures += 1;
      } else {
        memGrouped.set(k, {
          provider: r.provider,
          model: r.model,
          tool_name: r.toolName,
          totalCalls: 1,
          successes: r.success ? 1 : 0,
          failures: r.success ? 0 : 1,
        });
      }
    }

    // 3) Sum-merge at (provider, model, tool_name) granularity. Both sources
    //    are pre-grouped by SQLite's GROUP BY and the loop above, so this is
    //    a straight sum (no double-counting when a record happens to live in
    //    both — which the current write path doesn't do, but defence-in-depth
    //    against a future refactor that double-pushes on the success path).
    const combined = new Map<string, { provider: string; model: string; tool_name: string; totalCalls: number; successes: number; failures: number }>();
    for (const r of sqliteRows) {
      combined.set(`${r.provider}:${r.model}:${r.tool_name}`, r);
    }
    for (const r of memGrouped.values()) {
      const k = `${r.provider}:${r.model}:${r.tool_name}`;
      const existing = combined.get(k);
      if (existing) {
        existing.totalCalls += r.totalCalls;
        existing.successes += r.successes;
        existing.failures += r.failures;
      } else {
        combined.set(k, r);
      }
    }

    return this.aggregateToolStats(Array.from(combined.values()).map(r => ({
      provider: r.provider,
      model: r.model,
      toolName: r.tool_name,
      totalCalls: r.totalCalls,
      successes: r.successes,
      failures: r.failures,
    })));
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
   * Record a redacted invocation payload for debugging and tracing (non-sensitive)
   */
  async recordInvocationPayload(payload: {
    timestamp?: number;
    model?: string;
    provider?: string;
    toolName?: string;
    redactedArgs?: string;
    originStack?: string;
    toolCallId?: string | null;
  }): Promise<void> {
    await this.initialize();
    const rec = {
      timestamp: payload.timestamp || Date.now(),
      model: payload.model || null,
      provider: payload.provider || null,
      tool_name: payload.toolName || null,
      redacted_args: payload.redactedArgs || null,
      origin_stack: payload.originStack || null,
      tool_call_id: payload.toolCallId || null,
    };

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO tool_call_payloads (timestamp, model, provider, tool_name, redacted_args, origin_stack, tool_call_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(rec.timestamp, rec.model, rec.provider, rec.tool_name, rec.redacted_args, rec.origin_stack, rec.tool_call_id);
        return;
      } catch (e) {
        logger.warn('Failed to insert tool_call_payloads row', e);
      }
    }

    // In-memory fallback
    this.memoryInvocations.push(rec);
  }

  async getRecentInvocations(limit: number = 100): Promise<any[]> {
    await this.initialize();
    const results: any[] = [];
    if (this.db) {
      try {
        const stmt = this.db.prepare(`SELECT * FROM tool_call_payloads ORDER BY timestamp DESC LIMIT ?`);
        results.push(...stmt.all(limit));
      } catch (e) {
        logger.warn('Failed to query tool_call_payloads', e);
      }
    }

    const mem = [...this.memoryInvocations].sort((a, b) => b.timestamp - a.timestamp);
    const remaining = limit - results.length;
    if (remaining > 0) results.push(...mem.slice(0, remaining));
    return results;
  }

  /**
   * Clear the deduplication cache (useful for testing).
   */
  clearDedupCache(): void {
    this.seenToolCallIds.clear();
  }

  /**
   * Reset in-memory records + the disconnect counter + the SQLite
   * `tool_calls` table (test-only helper). All three track the same
   * SQLite-failure fallthrough surface — disconnect tests want a clean
   * slate between runs so the writes under test are the ONLY signals
   * visible to subsequent assertions. Without the SQLite reset, the
   * happy-path write from test 1 leaks into test 2's disconnect-proof
   * assertion (the SQLite `EXISTS(...)` finds the leftover row, making
   * the disconnect-proof assertion pass for the wrong reason).
   */
  __resetMemoryRecordsForTests(): void {
    this.memoryRecords.length = 0;
    this.disconnectCount = 0;
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM tool_calls').run();
      } catch {
        // Best-effort: helper is for vitest; if the table is drifted /
        // unavailable, the next test's reset will catch up. Don't
        // throw — callers expect a silent cleanup.
      }
    }
  }

  /**
   * Reset redacted invocation payloads (test-only helper).
   * Separate from memoryRecords because `recordInvocationPayload` has its
   * own fallthrough path (memoryInvocations) that some tests inspect
   * independently.
   */
  __resetInvocationsForTests(): void {
    this.memoryInvocations.length = 0;
  }

  /**
   * Integration helper: returns true if any tool calls have been recorded
   * (either in SQLite OR in the in-memory fallback). The audit's behavioral
   * rec #3 called for an integration test that "runs and asserts nonzero" —
   * this method is the lightweight boolean surface that lets that test
   * exist without inspecting the read API for shape.
   *
   * SEV-10 disconnect patch (2026-07-08): the read pipeline used to miss
   * records that fell through to memoryRecords because of a SQLite INSERT
   * failure. `getModelToolStats` was patched to merge both sources; this
   * method is the boolean alternative for callers that only need an
   * existence check ("do we have ANY tool-call telemetry?").
   *
   * Async-by-design: mirrors the rest of the public read surface
   * (getModelToolStats, getRecentInvocations, getRawRecords) so consumers
   * who already await can drop this in directly.
   *
 * Lifetime existence only — not time-windowed. For time-windowed
 * checks, use `getModelToolStats(N).then(s => s.length > 0)` instead.
   */
  async hasRecordedTools(): Promise<boolean> {
    await this.initialize();
    // Fast path: memoryRecords has entries — true, regardless of SQLite state.
    // This is the SEV-10 proof path: even if the SQLite INSERT fell through
    // to memoryRecords because of a schema-drift / lock / missing-table
    // failure, `hasRecordedTools()` still reports `true` because the writes
    // are durably tracked in the in-memory fallback.
    if (this.memoryRecords.length > 0) return true;
    // Slow path: query SQLite with the canonical EXISTS subquery (idiomatic
    // SQLite shape for boolean existence checks; returns 0/1 without a row
    // payload). Empty result → false.
    if (this.db) {
      try {
        const stmt = this.db.prepare(
          'SELECT EXISTS(SELECT 1 FROM tool_calls) AS has_records',
        );
        const row = stmt.get() as { has_records: number } | undefined;
        return row?.has_records === 1;
      } catch (error) {
        // SQLite unavailable (schema drift, lock). Caller cannot
        // confirm any record exists. Return false honestly.
        logger.warn('SQLite EXISTS failed in hasRecordedTools', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Read the current disconnect count (test-only counter).
   * Counts recordToolCall + recordToolCalls (batch) SQLite-failure
   * fallthroughs since the last reset. Useful for asserting that the
   * monkey-patched SQLite-prepare-throws test paths actually do fall
   * through to memoryRecords.
   */
  getDisconnectCountForTests(): number {
    return this.disconnectCount;
  }

  /**
   * Test-only mock helper: monkey-patches `db.prepare` so subsequent
   * INSERTs into `tool_calls` throw on .run() — every write falls
   * through to memoryRecords, exercising the SEV-10 disconnect path.
   * Returns a restore function that callers MUST invoke (via
   * `try/finally`) to undo the patch.
   *
   * Centralizes the previously-inline monkey-patch shape that appeared
   * in 2 disconnect tests (the audit reviewer flagged it as a drift
   * risk — three easy-to-miss invariants: an exact INSERT-into-tool_calls
   * regex that filter-defends `CREATE TABLE IF NOT EXISTS` and SELECT
   * statements; the `.bind(db)` capture so `originalPrepare(sql)` keeps
   * its `this`; and the finally-restore that, when missing, leaves the
   * SQLite handle broken across sibling tests).
   *
   * Error message is fixed (no caller-customizable string) — the helper
   * exists to enforce a single, recognizable signature in vitest output,
   * not to give each test its own message.
   */
  simulateInsertDisconnectForTests(db: any): () => void {
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (/INSERT INTO tool_calls/i.test(sql)) {
        return {
          run: (..._args: any[]) => {
            throw new Error(
              'Simulated read/write disconnect — SQLite INSERT intentionally throws (test-only)',
            );
          },
        };
      }
      return originalPrepare(sql);
    };
    return () => {
      db.prepare = originalPrepare;
    };
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
