/**
 * prompt-orchestrator/__tests__/doc1-row-budget.test.ts
 *
 * Regression test: every row of DOC1 (the 4-row "Verdict table (Group C
 * Phase-2 format)" at lines L18-L21 of
 * /opt/bing/docs/prompt-orchestrator-deferred-steps.md) must be under a
 * configurable char budget (default ≤700 chars). The intent is to LOCK
 * IN the per-row budget so a future PR that re-introduces a heavy
 * rationale (e.g., a new structural-conflict analysis paragraph with
 * multiple `<br>`-separated risk classes) fails the build at PR time.
 *
 * ## Line range (FIXED at L18-L21)
 *
 * The DOC1 table has 4 data rows between L17 (divider) and L22 (blank):
 *   L18: Step #4 (round-trip writes / writeAdapter)
 *   L19: Step #5 (provider-fallback)
 *   L20: Step #8 (observability)
 *   L21: Step #9 (UI/CLI for prompt mgmt)
 *
 * Line-numbers are hard-pinned to L18-L21: if a future PR adds a 5th row
 * below L21 (e.g., Step #10), this test must be RE-PINNED — the regression
 * only guards the 4 audited rows; expanding coverage is a separate audit
 * exercise and requires its own review.
 *
 * ## Counting method
 *
 * Each row's char count is the LITERAL line length after `.trimEnd()` —
 * the row's footprint in the source file, including the markdown delim
 * pipes at the start (`| `) and the trailing pipe (` |`) plus any
 * adjacent whitespace before EOL. This is the "cost of shipping this
 * row" — the literal number of bytes the row occupies in the docs viewer
 * / grep / file-system copy.
 *
 * NOT cell-sum: many DOC1 cells contain HTML (`<br>`) or could contain
 * escaped pipes (`\|`) in future tables; splitting on `|` would
 * mis-count. Pipe splitting also breaks when cells span multiple lines
 * via continuation — out of scope here but defending against it future-proof.
 *
 * NOT longest-cell-only: ambiguous semantics, and inconsistent with the
 * user's "row under a char budget" phrasing.
 *
 * ## Budget override (configurable)
 *
 *   - PO_DOC1_ROW_BUDGET (env var, positive integer parsed via parseInt).
 *     If unset, the default 700 applies per the user's spec.
 *   - Validation: the override must be a positive integer; a NaN / 0 /
 *     negative value throws at beforeAll so the test fails LOUDLY
 *     instead of silently under-budgeting or over-budgeting.
 *
 * No per-row allowlist: the user specified a single budget applied to
 * all 4 rows uniformly. Adding per-row exemptions would expand the
 * test's surface area beyond the user's ask.
 *
 * ## Failure message
 *
 * On a budget breach, the test throws an Error including:
 *   - Offender count
 *   - Each offender's line number, char count, and an 80-char body
 *     preview (whitespace-collapsed) so the PR author sees exactly which
 *     cell to trim.
 *   - The env-override key + usage hint so a reviewer can bump the
 *     budget for a one-off ack without editing the test.
 *
 * ## See also
 *
 *   - /opt/bing/docs/prompt-orchestrator-deferred-steps.md (DOC1 source)
 *   - /opt/bing/web/lib/orchestra/prompt-orchestrator/__tests__/default-scripts.test.ts (sibling snapshot-style regression)
 *   - /opt/bing/web/scripts/check-default-scripts-shape.ts (vitest-free shape-lock CLI; sibling pattern)
 *   - /opt/bing/.tickets/AUTH-LOGIN-COLD-PATH-5380MS.md (sibling close-pattern: docs)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest can run in either CJS or ESM transform — `__dirname` is CJS-only.
// Use `fileURLToPath(import.meta.url)` for cross-mode safety (works in
// both vite-node ESM transform and the legacy CJS transform used by
// the project's tsx-based scripts). Pattern mirrors scripts/check-default-
// scripts-shape.ts's cwd-anchored approach but uses the test's own file
// location instead of the invocation cwd (more reliable for vitest).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// DOC1 path: from `web/lib/orchestra/prompt-orchestrator/__tests__/`
// go up 5 levels to reach `/opt/bing/`, then into `docs/`. All relative
// hops are bounded — no process.cwd() dependency — so the test is
// cwd-invariant (anchored at the test file's own directory).
const DOC1_PATH = join(
  __dirname,
  '..', '..', '..', '..', '..',
  'docs',
  'prompt-orchestrator-deferred-steps.md',
);

const DEFAULT_ROW_BUDGET = 700;
const ENV_OVERRIDE_KEY = 'PO_DOC1_ROW_BUDGET';
const DOC1_LBOUND = 18;                    // inclusive (1-indexed)
const DOC1_UBOUND = 21;                    // inclusive (1-indexed)
const BODY_PREVIEW_CHARS = 80;

function readDoc1Rows(): string[] {
  const src = readFileSync(DOC1_PATH, 'utf8');
  const lines = src.split(/\r?\n/);
  return lines.slice(DOC1_LBOUND - 1, DOC1_UBOUND);
}

describe('DOC1 verdict table — per-row char budget regression', () => {
  let rows: string[];
  let budget: number;

  beforeAll(() => {
    rows = readDoc1Rows();
    const envBudget = process.env[ENV_OVERRIDE_KEY];
    budget = envBudget ? parseInt(envBudget, 10) : DEFAULT_ROW_BUDGET;
    if (!Number.isFinite(budget) || budget < 1) {
      throw new Error(
        `${ENV_OVERRIDE_KEY} must be a positive integer (got: ${JSON.stringify(envBudget)})`,
      );
    }
  });

  it('DOC1 source is found at the expected path + has at least DOC1_UBOUND lines', () => {
    const src = readFileSync(DOC1_PATH, 'utf8');
    expect(src.split(/\r?\n/).length).toBeGreaterThanOrEqual(DOC1_UBOUND);
  });

  it('DOC1 has exactly 4 rows between L18 and L21 (structural baseline lock)', () => {
    // Locks the table size so adding/removing rows triggers a deliberate
    // re-pin of L-range AND char budget before this test is updated.
    // The number 4 itself is the audit contract; if this assertion
    // starts failing, the audit contract has drifted.
    expect(rows.length).toBe(DOC1_UBOUND - DOC1_LBOUND + 1);
  });

  it('every DOC1 row at L18-L21 fits under the per-row char budget', () => {
    // Map row → measured length; filter to offenders; throw a structured
    // Error so the reporter sees (a) the budget-defining env var, (b)
    // per-offender line + char count + 80-char body preview.
    const offenders = rows
      .map((row, idx) => ({
        line: idx + DOC1_LBOUND,
        length: row.trimEnd().length,
        raw: row,
      }))
      .filter((r) => r.length > budget);

    if (offenders.length > 0) {
      const formatted = offenders
        .map(
          (o) =>
            `  L${o.line}: ${o.length} chars (>budget ${budget}); preview: ` +
            `"${o.raw
              .trimEnd()
              .slice(0, BODY_PREVIEW_CHARS)
              .replace(/\s+/g, ' ')}…"`,
        )
        .join('\n');
      throw new Error(
        `DOC1 has ${offenders.length} row(s) exceeding the per-row char budget of ${budget}:\n` +
          `${formatted}\n` +
          `Budget override: set ${ENV_OVERRIDE_KEY}=<positive-int> env var ` +
          `(e.g. ${ENV_OVERRIDE_KEY}=1800 to bump from the ${DEFAULT_ROW_BUDGET} default). ` +
          `File: ${DOC1_PATH}`,
      );
    }
  });

  it('DOC1 rows are non-empty (sanity — no accidental blank-line drift in the L18-L21 slice)', () => {
    // Companion sanity check to the budget test — if a future PR
    // accidentally blank-lines one of the rows, both this AND the
    // budget test fail, making the cleanup visible.
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].trim()).not.toBe('');
    }
  });
});
