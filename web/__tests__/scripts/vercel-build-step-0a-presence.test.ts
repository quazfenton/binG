/**
 * __tests__/scripts/vercel-build-step-0a-presence.test.ts
 *
 * Regression-snapshot for the Step 0a shape-lock gate in scripts/vercel-build.sh.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `scripts/vercel-build.sh` is the entry point invoked by Vercel's
 *   `"buildCommand": "NODE_ENV=production bash scripts/vercel-build.sh"`
 * (see `bing/web/vercel.json`). Step 0a inside that script runs the
 * CLI shape-lock against `lib/orchestra/prompt-orchestrator/default-scripts.ts`
 * BEFORE any `next build` work or app/api stash. If a future refactor
 * deletes or weakens Step 0a, the build no longer guards against 3 classes
 * of drift (canonical promptIds, disjoint invariant, empty-steps contract)
 * — the vitest snapshot and CLI tests still pass on the local host, but
 * the Vercel preview-deploy pipeline loses the gate silently.
 *
 * This test locks the 4 behavioral markers of Step 0a so any accidental
 * deletion surfaces as a vitest failure during normal `pnpm test` runs.
 *
 * Body-proximity shape-lock assertions (NOT brittle multiline regex): each
 * test reads the script as a single string and asserts specific tokens +
 * ordering relationships. Per the brittleness pattern learned in the
 * `__tests__/audit-recs/finding-5-6-log-shape.test.ts` earlier flow — the
 * multiline regex there matched TS-formatter whitespace incorrectly; this
 * test uses substring/regex on a stable text body (a bash script), which is
 * less brittle.
 *
 * Failure mode: if any assertion fails, the test prints the verified
 * fragment of the script (first 30 chars after a marker find) so a
 * diff'd version can be inspected without the full script dump.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('scripts/vercel-build.sh — Step 0a shape-lock gate presence (regression)', () => {
  let content: string;
  let stepAIdx: number;

  beforeAll(() => {
    // The script lives at web/scripts/vercel-build.sh; tests run with
    // process.cwd() at the web/ root per the project's vitest config.
    // process.cwd()-relativise so the test doesn't depend on absolute paths.
    const scriptPath = join(process.cwd(), 'scripts', 'vercel-build.sh');
    content = readFileSync(scriptPath, 'utf-8');
    // Anchor on the SECTION-BANNER comment line (regex) instead of the
    // literal descriptive phrase — locks the STEP ORDINAL (0a) but lets
    // descriptive comment text drift across releases without breaking
    // the test. The `─+` permits the leading comment rule (one or more
    // box-drawing chars) and `Step 0a\b` strictly enforces the ordinal.
    stepAIdx = content.search(/(?:^|\n)\s*#\s*─+\s*Step 0a\b/);
  });

  it('declares the Step 0a comment header marker', () => {
    // Anchor: the canonical phrase used in the comment block. A refactor
    // that removes the gate may also remove this header — caught here.
    expect(stepAIdx).toBeGreaterThan(0);
  });

  it('invokes the CLI shape-lock via `npx tsx scripts/check-default-scripts-shape.ts`', () => {
    // The exact command the gate runs. If `tsx` resolution breaks or the
    // command path drifts, this assertion fires before the operator
    // hits preview-deploy.
    expect(content).toMatch(/npx tsx scripts\/check-default-scripts-shape\.ts/);
  });

  it('branches on $GATE_EXIT and exits the build with that exit code on failure', () => {
    // Both fragments are required: the branch detection AND the exit
    // propagation. A refactor that removes one but leaves the other
    // would let the build continue on failure — caught here.
    expect(content).toMatch(/if \[ \$GATE_EXIT -ne 0 \]/);
    expect(content).toMatch(/exit \$GATE_EXIT/);
  });

  it('points operators to local repro + --self-test in the failure message', () => {
    // The diagnostic message is the operator's escape hatch when the
    // gate fires on CI. Removing these strings would leave them
    // guessing what's wrong.
    expect(content).toContain('Run locally:  npx tsx scripts/check-default-scripts-shape.ts');
    expect(content).toContain(
      'Or self-test: npx tsx scripts/check-default-scripts-shape.ts --self-test',
    );
  });

  it('runs Step 0a BEFORE Step 0 (app/api stash) — order invariant', () => {
    // Step 0a must fire before the app/api stash step so a shape drift
    // doesn't waste time stashing/restoring before failing. A reorder
    // (e.g. someone moving the gate to "Step 0.5 (after stash)")
    // would invalidate this invariant and is caught here.
    // Regex locks the ordinal (Step 0) + key noun (Stash app/api) while
    // letting the descriptive comment text drift across releases.
    const step0Idx = content.search(/(?:^|\n)\s*#\s*─+\s*Step 0\b.*Stash app\/api/);
    expect(stepAIdx).toBeGreaterThanOrEqual(0);
    expect(step0Idx).toBeGreaterThanOrEqual(0);
    expect(stepAIdx).toBeLessThan(step0Idx);
  });

  it('prints the operator-visible gate banner (silencing is a stealth regression)', () => {
    // The `echo` line at the top of Step 0a surfaces the gate in build
    // logs. If someone refactors the gate to silent-no-print (e.g., moves
    // the npx tsx call into background async, or replaces the echo with
    // a comment-only header), the deploy would no longer show the gate
    // ran — making drift invisible in CI. Lock the banner verbatim.
    expect(content).toContain('echo "▦ default-scripts shape-lock gate..."');
  });
});
