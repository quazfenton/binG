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
// The verdict on whether this vi.mock is strictly required is empirical —
// verified in the `repro-orchestrator.test.ts` experiment that runs vitest
// with the mock stripped. If repro still fails WITHOUT the mock (i.e. the
// schema lookup genuinely throws outside this fixture), this mock stays;
// otherwise this block can be deleted.
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

    // Polish nit (a): the prior `events` snapshot array was redundant —
    // read-side assertions on totalToolCalls / successfulToolCalls / etc.
    // already verify the 3 falls-through-to-memory. Dropped.
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
      }
      // Item-3 ship-ready metric: 3 forced-failure writes must each bump
      // the disconnect counter in recordToolCall's catch block. Proves the
      // counter is wired (not just present at 0 after __resetMemoryRecordsForTests).
      expect(toolCallTracker.getDisconnectCountForTests()).toBe(3);
    } finally {
      db.prepare = originalPrepare;
    }

    // Read using the same shape as model-ranker.ts's periodic refresh
    // (refreshModelTelemetryCache → toolCallTracker.getModelToolStats(10)).
    const stats = await toolCallTracker.getModelToolStats(10);

    // The disconnect must NOT result in an empty aggregation — the user's
    // original complaint was "the read pipeline returns empty on every
    // periodic refresh". This assertion fails pre-fix. The 3-write count
    // is implicitly verified by `expect(anthropicStats.totalToolCalls).toBe(3)`
    // below (read-side assertions verify everything after polish nit (a)).
    expect(stats.length).toBeGreaterThan(0);

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
    // Polish nit (b): use the new test-only helper instead of
    // `(toolCallTracker as any).memoryRecords.length = 0` — the helper
    // also resets the disconnect counter (item-3 ship-ready metric).
    toolCallTracker.__resetMemoryRecordsForTests();
    // Sanity: the disconnect counter (incremented in recordToolCall's catch
    // block) is now 0 after reset, confirming the helper couples both resets
    // as documented.
    expect(toolCallTracker.getDisconnectCountForTests()).toBe(0);
  });

  // Item-3 closure (audit 2026-07-08): hasRecordedTools() integration test.
  // The audit's behavioral rec #3 says: "add an integration test that
  // toolCallTracker.hasRecordedTools() runs and asserts nonzero". Two
  // cases locked: (a) happy path (SQLite write succeeds), (b) disconnect
  // path (SQLite INSERT fails so writes fall through to memoryRecords).
  // Both must return true — proving the SEV-10 read/write disconnect
  // fix is observable from the new public surface. Without the SEV-10
  // patch the disconnect-path case would return `false` (reads query
  // SQLite only → empty when writes silently demoted to memoryRecords).

  it('hasRecordedTools() returns true after a happy-path recordToolCall (integration smoke)', async () => {
    toolCallTracker.clearDedupCache();
    toolCallTracker.__resetMemoryRecordsForTests();
    // Happy path: SQLite INSERT succeeds — record lives in SQLite only.
    // The SEV-10 fix merges SQLite + memoryRecords; hasRecordedTools
    // should observe the SQLite write path.
    await toolCallTracker.recordToolCall({
      provider: 'integration-happy',
      model: 'm',
      toolName: 'write_msg',
      success: true,
      timestamp: Date.now(),
      toolCallId: `hasrecorded-happy-${Date.now()}`,
    });
    // Read via the new public surface; must be true.
    expect(await toolCallTracker.hasRecordedTools()).toBe(true);
    // Disconnect counter clean (no SQLite fallthrough happened).
    expect(toolCallTracker.getDisconnectCountForTests()).toBe(0);
    toolCallTracker.__resetMemoryRecordsForTests();
  });

  it('hasRecordedTools() returns true after a memoryRecords-fallthrough disconnect (SEV-10 proof)', async () => {
    // SEV-10 proof: even when SQLite INSERT fails (writes silently
    // demote to memoryRecords), hasRecordedTools() returns true because
    // the fast-path consults memoryRecords first. The interleaving reset
    // (memoryRecords AND `DELETE FROM tool_calls`) ensures inter-test
    // isolation — test 1's happy-path SQLite row cannot bleed into this
    // assertion (the SQLite `EXISTS(...)` would otherwise find the
    // leftover row and make this assertion pass for the wrong reason).
    toolCallTracker.clearDedupCache();
    toolCallTracker.__resetMemoryRecordsForTests();
    // Sanity: post-reset state must be empty. If hasRecordedTools returns
    // true here, the helper skipped the SQLite DELETE (schema-drift env,
    // future helper refactor, etc.) — fail loud now rather than silently
    // weaken the post-write assertion below. Cheaper than the polarity-
    // flipped version (one async call vs two) AND catches helper drift
    // that the polarity version caught by accident.
    expect(await toolCallTracker.hasRecordedTools()).toBe(false);
    const db = (toolCallTracker as any).db;
    if (!db || typeof db.prepare !== 'function') {
      throw new Error(
        'Test requires better-sqlite3 with a working db.prepare — DB unavailable in this env',
      );
    }
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (/INSERT INTO tool_calls/i.test(sql)) {
        return {
          run: (..._args: any[]) => {
            throw new Error(
              'Simulated read/write disconnect — INSERT intentionally throws for hasRecordedTools test',
            );
          },
        };
      }
      return originalPrepare(sql);
    };
    try {
      await toolCallTracker.recordToolCall({
        provider: 'integration-disconnect',
        model: 'm',
        toolName: 'write_msg',
        success: true,
        timestamp: Date.now(),
        toolCallId: `hasrecorded-disconnect-${Date.now()}`,
      });
      // Sanity: the SQLite throw fired (disconnect counter = 1) before
      // we trust the post-write assertion.
      expect(toolCallTracker.getDisconnectCountForTests()).toBe(1);
      // CORE ASSERTION: with broken SQLite + the only record in
      // memoryRecords, hasRecordedTools() returns true — proves the
      // SEV-10 fix is observable from the new boolean API.
      expect(await toolCallTracker.hasRecordedTools()).toBe(true);
    } finally {
      db.prepare = originalPrepare;
      toolCallTracker.__resetMemoryRecordsForTests();
    }
  });
});
