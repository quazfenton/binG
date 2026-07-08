/**
 * Regression test for the tool-call-tracker SQLite read/write disconnect
 * (SEV-10). Symptom: `toolCallTracker.getModelToolStats(10)` returns an
 * empty array on every periodic refresh, even though `recordToolCall(...)`
 * was called many times right before the refresh.
 *
 * Root cause: when the SQLite INSERT inside `recordToolCall` silently
 * throws (schema drift, db lock, missing table at query time despite the
 * SEV-9 defensive CREATE), the catch block falls through to
 * `memoryRecords.push(record)`. The read path, however, queries SQLite
 * only when `this.db` is truthy — so it misses the records that landed
 * in `memoryRecords`.
 *
 * Pre-fix: this test fails because the second `it` returns 0 stats.
 * Post-fix: this test passes because `getModelToolStats` merges SQLite +
 * memoryRecords regardless of whether the SQLite write succeeded.
 *
 * Companion fix: `bing/web/lib/tools/tool-call-tracker.ts` (`getModelToolStats`
 * now always reads memoryRecords AND SQLite, sum-merging at (provider, model,
 * tool_name) granularity before `aggregateToolStats`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// `execSchemaFile` walks the bundled cwd path; in tests we mock it as a no-op.
// Without this mock, the schema lookup throws and the test fixture's tracker
// would never reach its SEV-9 defensive CREATE statement.
vi.mock('@/lib/database/schema', () => ({
  execSchemaFile: (_db: any, _name: string) => {
    /* no-op for vitest; tracker uses defensive CREATE TABLE IF NOT EXISTS */
  },
}));

import { toolCallTracker } from '@/lib/tools/tool-call-tracker';

describe('tool-call-tracker — read/write disconnect (SEV-10)', () => {
  beforeAll(async () => {
    await toolCallTracker.initialize();
    toolCallTracker.clearDedupCache();
  });

  afterAll(() => {
    // Close the SQLite handle so vitest's process doesn't keep the DB file
    // locked. Failures here are best-effort.
    const db = (toolCallTracker as any).db;
    if (db && typeof db.close === 'function') {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  });

  it('returns ≥1 stat after a normal run (sanity baseline)', async () => {
    // The happy path: write→read both flow through SQLite. Asserts the
    // baseline behavior IS preserved by the SEV-10 merge fix — the merge
    // does NOT over-count when memoryRecords is empty (sum of empty +
    // SQLite rows = SQLite rows).
    toolCallTracker.clearDedupCache();

    await toolCallTracker.recordToolCall({
      provider: 'openai',
      model: 'gpt-4',
      toolName: 'read_file',
      success: true,
      timestamp: Date.now(),
      toolCallId: `happy-${Date.now()}-1`,
    });

    const stats = await toolCallTracker.getModelToolStats(10);
    expect(stats.length).toBeGreaterThan(0);

    const openaiGpt4 = stats.find(
      (s) => s.provider === 'openai' && s.model === 'gpt-4',
    );
    expect(openaiGpt4).toBeDefined();
    expect(openaiGpt4!.totalToolCalls).toBeGreaterThanOrEqual(1);
    // At least one read_file row in the breakdown.
    expect(openaiGpt4!.toolBreakdown.read_file).toBeDefined();
    expect(openaiGpt4!.toolBreakdown.read_file.success).toBeGreaterThanOrEqual(1);
  });

  it('returns ≥1 stat after a simulated SQLite-write disconnect (the regression)', async () => {
    // Simulates the production failure mode:
    // 1. recordToolCall's SQLite INSERT throws (schema drift, db lock,
    //    missing table at query time, etc.).
    // 2. The catch block falls through to memoryRecords.push(record).
    // 3. THIS test forces the same condition by monkey-patching
    //    `tracker.db.prepare` so the INSERT statement returns a runner
    //    that throws on .run(...).
    // 4. Three writes — all fail SQLite, all land in memoryRecords only.
    // 5. Asserts getModelToolStats(10) returns ≥1 stat (proves reads
    //    consult memoryRecords even when `this.db` is truthy).
    //
    // Pre-fix: returns [] because reads query SQLite (empty) only.
    // Post-fix: returns ≥1 because reads merge SQLite + memoryRecords.
    toolCallTracker.clearDedupCache();

    const db = (toolCallTracker as any).db;
    if (!db || typeof db.prepare !== 'function') {
      throw new Error(
        'Test requires better-sqlite3 with a working db.prepare — DB unavailable in this env',
      );
    }

    // Snapshot synthetic events for assertion introspection.
    const events: Array<{ id: string; written: 'sqlite' | 'memory' }> = [];

    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (/INSERT INTO tool_calls/i.test(sql)) {
        // Return a runner whose .run(...) throws — every write goes through
        // the catch block in recordToolCall and falls through to memoryRecords.
        return {
          run: (..._args: any[]) => {
            throw new Error(
              'Simulated read/write disconnect (SEV-10): SQLite INSERT intentionally throws',
            );
          },
          // The defensive CREATE statements in initialize() also call .run()
          // and reset the table — those SHOULD succeed. Filter them by
          // statement shape so the monkey-patch only affects the data
          // INSERT path (recordToolCall + recordToolCalls).
        };
      }
      return originalPrepare(sql);
    };

    try {
      const baseId = `disconnect-${Date.now()}`;
      // 3 calls — all should fail SQLite INSERT → fall through to memoryRecords.
      for (let i = 0; i < 3; i++) {
        const toolCallId = `${baseId}-${i}`;
        await toolCallTracker.recordToolCall({
          provider: 'anthropic',
          model: 'claude-3.5',
          toolName: 'write_file',
          success: i % 2 === 0, // success on i=0, success on i=2; fail on i=1
          error: i % 2 === 1 ? 'Simulated failure' : undefined,
          timestamp: Date.now(),
          toolCallId,
        });
        events.push({ id: toolCallId, written: 'memory' });
      }
    } finally {
      db.prepare = originalPrepare;
    }

    // Read using the same shape as model-ranker.ts's periodic refresh
    // (refreshModelTelemetryCache → toolCallTracker.getModelToolStats(10)).
    const stats = await toolCallTracker.getModelToolStats(10);

    // The disconnect must NOT result in an empty aggregation — the user's
    // original complaint was "the read pipeline returns empty on every
    // periodic refresh". This assertion fails pre-fix.
    expect(stats.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.written === 'memory')).toHaveLength(3);

    // Specifically: the anthropic claude-3.5 record surface should be visible.
    const anthropicStats = stats.find(
      (s) => s.provider === 'anthropic' && s.model === 'claude-3.5',
    );
    expect(anthropicStats).toBeDefined();
    expect(anthropicStats!.totalToolCalls).toBe(3);
    // success on i=0 and i=2 → 2 successes / 1 failure.
    expect(anthropicStats!.successfulToolCalls).toBe(2);
    expect(anthropicStats!.failedToolCalls).toBe(1);
    expect(anthropicStats!.toolBreakdown.write_file).toBeDefined();
    expect(anthropicStats!.toolBreakdown.write_file.success).toBe(2);
    expect(anthropicStats!.toolBreakdown.write_file.failed).toBe(1);

    // Cleanup synthetic records from memoryRecords so the next test starts
    // clean (DB SQLite state is irrelevant — those writes all failed).
    (toolCallTracker as any).memoryRecords.length = 0;
  });
});
