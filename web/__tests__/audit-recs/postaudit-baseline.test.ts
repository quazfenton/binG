/**
 * Postaudit acceptance baseline regression guard.
 *
 * Snapshots the postaudit acceptance test state captured in
 * `/opt/bing/web/__tests__/audit-recs/.postaudit-baseline.json`. Every CI
 * run:
 *
 *   1. Spawns vitest with `--reporter=json` against the postaudit files
 *   2. Parses the JSON output to extract per-test status (passed / failed /
 *      skipped) and aggregate counts
 *   3. Compares against the baseline:
 *      - HARD-FAIL if a NEW test ID appears in failed/skipped lists beyond
 *        `trackedFailed` + `trackedSkipped`
 *      - HARD-FAIL if `numPassedTests` drops below `thresholds.minPassedTests`
 *      - HARD-FAIL if `numTotalTests` drops below `thresholds.minTotalTests`
 *      - HARD-FAIL if `numFailedTests` exceeds `thresholds.maxFailedTests`
 *      - WARN (allowed) if a tracked test now PASSES (i.e., was fixed or
 *        un-skipped intentionally) — operator should remove it from the
 *        baseline + commit the intent
 *
 * The baseline file is human-edited when intentional changes happen
 * (e.g., adding a new `it.skip`, un-skipping a tracked test). This test
 * does NOT auto-update the baseline — that would mask regressions.
 *
 * Companion to:
 * - cite-drift.test.ts (locks cite-accuracy in MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md
 *   + CENTRALIZED_TODO_LIST.md)
 * - /opt/bing/.tickets/STALL-ROUTEINTEGRATION-FOLLOWUP.md (the 6 tracked skipped
 *   tests' integration follow-up)
 *
 * Why this exists: the L9 sub-bullet 1 advertised result (170/172 from
 * the prior audit-thread state) needs a CI-runnable regression guard so
 * the test-side investigation doesn't accidentally regress while Path C
 * (StallWatchdogError errorCode → HTTP status mapping) is in-flight.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASELINE_PATH = path.resolve(__dirname, '.postaudit-baseline.json');
// Derive PROJECT_ROOT from the test file's location so the guard works
// regardless of cwd (CI container, `pnpm -r --filter web test`, etc.).
// postaudit-baseline.test.ts lives at:
//   /opt/bing/web/__tests__/audit-recs/postaudit-baseline.test.ts
// so the project root is 2 levels up from __dirname:
//   __dirname = /opt/bing/web/__tests__/audit-recs
//   ../.. = /opt/bing/web  ✓
// (3-ups would land at /opt/bing — off-by-one bug caught in code-review.)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
// Resolve the vitest binary directly (skip the `npx` indirection) so the
// guard works in environments where `npx` is not in PATH (vitest pool:
// 'forks' worker sandboxes sometimes don't include npx). On Windows CI
// the bin script is vitest.cmd — resolved lazily so the Linux/macOS path
// stays the default.
const VITEST_BIN_NAME = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';
const VITEST_BIN = path.resolve(PROJECT_ROOT, 'node_modules', '.bin', VITEST_BIN_NAME);

interface BaselineTrackedTest {
  file: string;
  testPath: string;
  ticket: string;
}

interface Baseline {
  version: string;
  capturedAt: string;
  postauditAcceptanceFiles: string[];
  summary: {
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    numSkippedTests: number;
  };
  trackedSkipped: BaselineTrackedTest[];
  trackedFailed: BaselineTrackedTest[];
  thresholds: {
    minTotalTests: number;
    minPassedTests: number;
    maxFailedTests: number;
    maxUntrackedSkippedTests: number;
    maxUntrackedFailedTests: number;
  };
}

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'run';
  title: string;
}

interface VitestFileResult {
  name: string;
  numPassingTests: number;
  numFailingTests: number;
  numPendingTests: number;
  assertionResults: VitestAssertionResult[];
}

interface VitestRunJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: VitestFileResult[];
}

/**
 * Run the postaudit acceptance suite as a child process and parse the
 * JSON output. Returns the parsed JSON object.
 *
 * Uses `--reporter=json` so vitest emits a single JSON object on stdout
 * that we can parse deterministically (text reporters have ANSI codes
 * + non-deterministic ordering). 180s timeout matches the suite's
 * observed runtime.
 */
function runPostauditAcceptance(): VitestRunJson {
  const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const args = [
    'run',
    '--reporter=json',
    ...baseline.postauditAcceptanceFiles,
  ];
  const stdout = execFileSync(VITEST_BIN, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    // Allow non-zero exit (vitest exits non-zero when tests fail). We
    // parse the JSON regardless and report the failures via the guard.
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  // vitest --reporter=json emits a single JSON object on stdout. Trim any
  // leading/trailing whitespace + extract the first balanced JSON object.
  const trimmed = stdout.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(
      `[postaudit-baseline] Could not locate JSON object in vitest stdout (${stdout.length} bytes). First 200 chars: ${stdout.slice(0, 200)}`,
    );
  }
  const jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonStr);
}

/**
 * Build a Set of tracked test keys for O(1) lookup. Key format:
 *   `${file}:${testPath}` (testPath is the fullName minus ancestor titles).
 */
function buildTrackedKeySet(items: BaselineTrackedTest[]): Set<string> {
  return new Set(items.map((t) => `${t.file}::${t.testPath}`));
}

/**
 * Reduce vitest's assertionResults to a flat list of {file, testPath, status}
 * for the regression guard's comparison. testPath is the fullName (which
 * vitest builds as `parent1 > parent2 > ... > testName`).
 */
function flattenAssertions(data: VitestRunJson): Array<{
  file: string;
  testPath: string;
  status: VitestAssertionResult['status'];
}> {
  const out: Array<{
    file: string;
    testPath: string;
    status: VitestAssertionResult['status'];
  }> = [];
  for (const fileResult of data.testResults) {
    const relFile = fileResult.name.replace(/^.*\/opt\/bing\/web\//, '');
    for (const assertion of fileResult.assertionResults) {
      out.push({
        file: relFile,
        testPath: assertion.fullName,
        status: assertion.status,
      });
    }
  }
  return out;
}

describe('Postaudit acceptance baseline regression guard', () => {
  let baseline: Baseline;
  let current: VitestRunJson;

  beforeAll(() => {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    // eslint-disable-next-line no-console
    console.log(
      `[postaudit-baseline] baseline loaded: ${baseline.summary.numPassedTests}/${baseline.summary.numTotalTests} passing, ${baseline.trackedSkipped.length} tracked skipped, ${baseline.trackedFailed.length} tracked failed (captured ${baseline.capturedAt})`,
    );
    current = runPostauditAcceptance();
    // eslint-disable-next-line no-console
    console.log(
      `[postaudit-baseline] current run: ${current.numPassedTests}/${current.numTotalTests} passing, ${current.numPendingTests} pending`,
    );
  }, 180_000);

  it('aggregate counts meet baseline thresholds (hard-fail on green→red drift)', () => {
    const failures: string[] = [];
    if (current.numTotalTests < baseline.thresholds.minTotalTests) {
      failures.push(
        `TOTAL DROPPED: baseline ${baseline.thresholds.minTotalTests} → current ${current.numTotalTests} (tests removed without intent — likely accidental test deletion)`,
      );
    }
    if (current.numPassedTests < baseline.thresholds.minPassedTests) {
      failures.push(
        `PASS DROPPED: baseline ${baseline.thresholds.minPassedTests} → current ${current.numPassedTests} (${baseline.thresholds.minPassedTests - current.numPassedTests} tests flipped green→red since baseline capture)`,
      );
    }
    if (current.numFailedTests > baseline.thresholds.maxFailedTests) {
      failures.push(
        `NEW FAILURES: baseline ${baseline.thresholds.maxFailedTests} → current ${current.numFailedTests} (${current.numFailedTests - baseline.thresholds.maxFailedTests} new untracked failures)`,
      );
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[postaudit-baseline] threshold failures:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('no NEW test ID appears in the current failed list beyond trackedFailed (hard-fail on untracked regression)', () => {
    const trackedFailedKeys = buildTrackedKeySet(baseline.trackedFailed);
    const failures: string[] = [];
    for (const t of flattenAssertions(current)) {
      if (t.status === 'failed') {
        const key = `${t.file}::${t.testPath}`;
        if (!trackedFailedKeys.has(key)) {
          failures.push(
            `NEW FAILURE (untracked): ${t.file} > ${t.testPath}\n  → Either (a) fix the test, or (b) add it to baseline.trackedFailed if the failure is intentional`,
          );
        }
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[postaudit-baseline] untracked-failure regressions:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('no NEW test ID appears in the current skipped list beyond trackedSkipped (hard-fail on untracked skip drift)', () => {
    const trackedSkippedKeys = buildTrackedKeySet(baseline.trackedSkipped);
    const failures: string[] = [];
    for (const t of flattenAssertions(current)) {
      if (t.status === 'skipped' || t.status === 'pending' || t.status === 'todo') {
        const key = `${t.file}::${t.testPath}`;
        if (!trackedSkippedKeys.has(key)) {
          failures.push(
            `NEW SKIP (untracked): ${t.file} > ${t.testPath}\n  → Either (a) un-skip the test, or (b) add it to baseline.trackedSkipped with a ticket reference`,
          );
        }
      }
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[postaudit-baseline] untracked-skip regressions:\n' + failures.join('\n'));
    }
    expect(failures).toEqual([]);
  });

  it('tracked skipped tests that are now passing are reported as POSITIVE changes (informational, not a regression)', () => {
    const trackedSkippedKeys = buildTrackedKeySet(baseline.trackedSkipped);
    const trackedSkippedByKey = new Map(baseline.trackedSkipped.map((t) => [`${t.file}::${t.testPath}`, t]));
    const positiveChanges: string[] = [];
    for (const t of flattenAssertions(current)) {
      const key = `${t.file}::${t.testPath}`;
      if (trackedSkippedKeys.has(key) && t.status === 'passed') {
        const tracked = trackedSkippedByKey.get(key);
        positiveChanges.push(
          `FIXED: ${t.file} > ${t.testPath} (was tracked-skipped per ticket ${tracked?.ticket ?? 'unknown'}; now passing — operator should remove from baseline.trackedSkipped and commit the intent)`,
        );
      }
    }
    if (positiveChanges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[postaudit-baseline] POSITIVE changes (tracked → now passing):\n' + positiveChanges.join('\n'),
      );
    }
    // Positive changes are informational — test always passes
    expect(positiveChanges).toBeDefined();
  });

  it('tracked failed tests that are now passing are reported as POSITIVE changes (informational, not a regression)', () => {
    const trackedFailedKeys = buildTrackedKeySet(baseline.trackedFailed);
    const trackedFailedByKey = new Map(baseline.trackedFailed.map((t) => [`${t.file}::${t.testPath}`, t]));
    const positiveChanges: string[] = [];
    for (const t of flattenAssertions(current)) {
      const key = `${t.file}::${t.testPath}`;
      if (trackedFailedKeys.has(key) && t.status === 'passed') {
        const tracked = trackedFailedByKey.get(key);
        positiveChanges.push(
          `FIXED: ${t.file} > ${t.testPath} (was tracked-failed per ticket ${tracked?.ticket ?? 'unknown'}; now passing — operator should remove from baseline.trackedFailed and commit the intent)`,
        );
      }
    }
    if (positiveChanges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[postaudit-baseline] POSITIVE changes (tracked-failed → now passing):\n' + positiveChanges.join('\n'),
      );
    }
    expect(positiveChanges).toBeDefined();
  });

  it('every trackedSkipped + trackedFailed entry actually appears in the current run (orphan detection — hard-fail on ANY orphan)', () => {
    // Edge case the untracked-skip check misses: if a trackedSkipped test
    // is REMOVED from the source file (e.g. someone deletes the it.skip
    // block), vitest never reports it, so the "untracked skip" check
    // never sees the orphaned baseline entry. Without this guard, the
    // baseline rots silently as tracked tests are removed without intent.
    //
    // Policy: ANY orphan is a hard-fail. Operators must either (a)
    // restore the test to source, or (b) delete the orphaned entry from
    // baseline.trackedSkipped / baseline.trackedFailed (with a commit
    // message explaining the intent). The prior "soft-warn at 1-2
    // orphans" approach used `expect(orphans).toBeDefined()` (a no-op
    // assertion) which silently passed even when orphans were present,
    // defeating the warn intent. The ≥1 hard-fail threshold ensures CI
    // dashboards see a red signal immediately.
    const currentKeys = new Set(flattenAssertions(current).map((t) => `${t.file}::${t.testPath}`));
    const orphans: string[] = [];
    for (const tracked of [...baseline.trackedSkipped, ...baseline.trackedFailed]) {
      const key = `${tracked.file}::${tracked.testPath}`;
      if (!currentKeys.has(key)) {
        orphans.push(
          `ORPHAN: ${tracked.file} > ${tracked.testPath} (baseline references test that no longer exists in source — ticket ${tracked.ticket ?? 'unknown'}; restore the test to source OR delete this entry from baseline if removal was intentional)`,
        );
      }
    }
    if (orphans.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[postaudit-baseline] ORPHANED tracked entries:\n' + orphans.join('\n'));
    }
    expect(orphans).toEqual([]);
  });
});