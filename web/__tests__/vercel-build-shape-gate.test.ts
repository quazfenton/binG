/**
 * __tests__/vercel-build-shape-gate.test.ts
 *
 * Production Guard (build layer) — Vercel build script Step 0a gate block
 * snapshot. Locks `scripts/vercel-build.sh` Step 0a as a tamper-evident seal
 * so a future refactor can't silently comment out the gate, route it around,
 * or reorder it past `next build` work without a conscious change to this
 * test file (which acts as the audit trail for that change).
 *
 * ## Composition with the 3 production guards
 *
 * The default-scripts shape-lock contract is defended by 4 layers; the new
 * test composes with three of them at the audit/test surface:
 *
 *   1. **Static-file audit** — `__tests__/audit-recs/finding-1-stall-discriminator.test.ts`
 *      (and the wider `__tests__/audit-recs/` family) — readFileSync-anchored
 *      regex-presence invariants for cross-file invariants. The same readFileSync
 *      pattern this test uses to anchor against revert of behavior (regex/text
 *      against a frozen source string), not against runtime behavior.
 *
 *   2. **Vitest snapshot** — this file (`__tests__/vercel-build-shape-gate.test.ts`)
 *      is one of them. Pairs with `__tests__/scripts/vercel-build-step-0a-presence.test.ts`
 *      (which is FRAGMENT-LEVEL — locks the 5 individual tokens/regexes) and
 *      `__tests__/default-scripts.test.ts` (vitest snapshot of the 5 invariants
 *      against the runtime source). This file is the BLOCK-LEVEL counterpart:
 *      catches an editor commenting out `echo "▦ default-scripts shape-lock gate..."`
 *      (a refactor the fragment test would not catch because the regex still
 *      exists in the source — but inside a comment).
 *
 *   3. **CLI gate** — `scripts/check-default-scripts-shape.ts` invoked by
 *      husky `prepare`  AND by Step 0a in `vercel-build.sh`. This test pins
 *      Step 0a's BLOCK PRESENCE; the CLI's behavior is pinned via the sibling
 *      `--self-test` 7-case regression. Together: the test file locks the wire,
 *      the CLI locks the data, husky + vercel-build.sh are the actual fires.
 *
 *   4. **MCP signal regression** — `__tests__/mcp/http-transport-signal.test.ts`
 *      covers the chat-hang Fix Step A invariants on `HTTPTransport.request`.
 *      Not related to the shape-lock contract directly; the user's task listed
 *      it alongside this test as one of the 4 production guards that compose
 *      the safety net.
 *
 * ## Differentiation from `vercel-build-step-0a-presence.test.ts`
 *
 * | Test | Granularity | Catches |
 * |---|---|---|
 * | `vercel-build-step-0a-presence.test.ts` (sibling) | 5 fragment-level assertions | Removal of single tokens (echo, npx tsx, $GATE_EXIT branch, error-message lines, ordinal banner). False-positive-safe on comment reflow. |
 * | `__tests__/vercel-build-shape-gate.test.ts` (this file) | Block-level frozen-string snapshot | Inline edits to the gate that don't delete tokens: e.g. someone adding `&& echo "skipping..."` to the npx line, or moving the `echo` banner inside the `if [ $GATE_EXIT -ne 0 ]` (which would surface AFTER the gate runs — invisible to fragment test). |
 *
 * Both tests are required. Stripped comments + trimmed whitespace give the
 * block-test resilience to harmless doc reflows while still catching the
 * inline-edit class.
 *
 * ## Why a frozen-string + .toBe() (not vitest `toMatchInlineSnapshot()`)?
 *
 * `toMatchInlineSnapshot()` re-encodes the snapshot with its own quote/escape
 * transformer — visible in the test source as `\"`, `\\n`, etc. — which makes
 * PR diffs noisy and fragile (one stray character in the literal `\u200B` from
 * elsewhere and the test silently breaks). A frozen canonical-string literal
 * compared with `.toBe()` makes the PR diff unambiguous: any byte that drifts
 * appears in the diff with its real character.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'vercel-build.sh');

describe('Production Guard — Vercel build Step 0a shape-lock gate (block snapshot)', () => {
  let scriptContent: string;

  beforeAll(() => {
    scriptContent = readFileSync(SCRIPT_PATH, 'utf-8');
  });

  // ────────────────────────────────────────────────────────────────
  // Block extraction: slice from the "Step 0a" banner comment up to
  // AND INCLUDING the gate's `if [...]` closer `fi`. The slice covers
  // banner comment + executable lines through the gate's full
  // if-then-fi shape — stops BEFORE the inter-section `OUTDIR`/`STDERR_LOG`
  // variable assignments that sit BELOW the gate block (those belong
  // to Step 0, not Step 0a).
  //
  // Anchor strategy (1-step, regression-resistant):
  //   START = position of the literal "# ── Step 0a" banner comment.
  //   END   = position IMMEDIATELY AFTER `\nfi\n` that follows the
  //           gate's `exit $GATE_EXIT` line. The gate has no nested `if`,
  //           so the FIRST `\nfi\n` after the banner is unambiguously the
  //           gate's closer. Refactor-resilient: doesn't anchor on the
  //           variable name (`$GATE_EXIT`) so a rename to `$STEP_0A_EXIT`
  //           or similar still resolves correctly.
  //
  // Comments are stripped before snapshot comparison so reflowing the
  // banner comment text doesn't false-positive.
  //
  // Anchor-not-found uses `expect().toBeGreaterThan(-1)` per project
  // convention (matches `vercel-build-step-0a-presence.test.ts`,
  // `audit-recs/finding-5-6-log-shape.test.ts`) — produces structured
  // vitest failure output with file context instead of a raw Error throw.
  // ────────────────────────────────────────────────────────────────
  function extractStep0aBlock(): string {
    const step0aStart = scriptContent.indexOf('# ── Step 0a');
    expect(step0aStart, 'Step 0a banner must exist in scripts/vercel-build.sh').toBeGreaterThan(-1);
    // The gate has no nested `if`, so the FIRST `\nfi\n` after the banner
    // is the gate's if-block closer. Anchoring on `\nfi\n` (rather than
    // the variable-bound `if [ $GATE_EXIT -ne 0 ]`) keeps the snapshot
    // stable across variable renames while still pinning the if-then-fi
    // structure that would be lost on a refactor that removes the gate.
    const fiMarker = '\nfi\n';
    const fiIdx = scriptContent.indexOf(fiMarker, step0aStart);
    expect(fiIdx, 'Gate `\\nfi\\n` closer must exist after Step 0a banner — the gate has been deleted, opened, or refactored out of the if-then-fi shape').toBeGreaterThan(-1);
    // Slice ends at position of the trailing `\n` of `\nfi\n` (exclusive
    // of the next character). The trailing `.trim()` cleans the trailing
    // newline; the `replace(/^\n+|\n+$/g, ...)` strips any leading blank
    // lines from the slice. Both strips are idempotent.
    const raw = scriptContent.slice(step0aStart, fiIdx + fiMarker.length - 1);
    return raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .trim();
  }

  it('locks the executable portion of Step 0a as a frozen canonical string (tamper-evident seal)', () => {
    // CANONICAL — any drift appears in the .toBe() diff. The frozen string
    // is the EXACT post-strip block. If a future refactor modifies any of
    // these 9 lines (edit echo to silent, route the npx around, swap order,
    // add an `&& true` to mask failures, etc.), this test fires and the PR
    // diff surfaces the change for review.
    const CANONICAL_STEP_0A_BLOCK = [
      'echo "▦ default-scripts shape-lock gate..."',
      'npx tsx scripts/check-default-scripts-shape.ts',
      'GATE_EXIT=$?',
      'if [ $GATE_EXIT -ne 0 ]; then',
      '  echo ""',
      '  echo "✗ default-scripts shape-lock gate FAILED (exit $GATE_EXIT)"',
      '  echo "  Run locally:  npx tsx scripts/check-default-scripts-shape.ts"',
      '  echo "  Or self-test: npx tsx scripts/check-default-scripts-shape.ts --self-test"',
      '  exit $GATE_EXIT',
      'fi',
    ].join('\n');

    const actualBlock = extractStep0aBlock();
    expect(actualBlock).toBe(CANONICAL_STEP_0A_BLOCK);
  });

  it('Step 0a block precedes Step 0 (app/api stash) — order invariant', () => {
    // Reinforces the order assertion in `vercel-build-step-0a-presence.test.ts`.
    // If a future refactor moves Step 0a AFTER Step 0 (e.g. as a "post-stash
    // gate"), the app/api stash would run first, and a shape drift would
    // waste time on the stash+restore cycle before failing. This test pins
    // the order so a leak in the other direction surfaces.
    const step0aIdx = scriptContent.indexOf('# ── Step 0a');
    const step0Idx = scriptContent.indexOf('# ── Step 0:', step0aIdx);
    expect(step0aIdx).toBeGreaterThan(-1);
    expect(step0Idx).toBeGreaterThan(-1);
    expect(step0aIdx).toBeLessThan(step0Idx);
  });

  it('Step 0a block precedes Step 2 (next build) — order invariant', () => {
    // Belt-and-suspenders for the ORDINAL guarantee: Step 0a must fire
    // BEFORE any next-build work, including the vendor-sync Step 1.
    // If someone refactors the gate to "Step -1 (after vendor sync but
    // before next build)", this catches it.
    const step0aIdx = scriptContent.indexOf('# ── Step 0a');
    const step2Idx = scriptContent.indexOf('# ── Step 2:', step0aIdx);
    expect(step0aIdx).toBeGreaterThan(-1);
    expect(step2Idx).toBeGreaterThan(-1);
    expect(step0aIdx).toBeLessThan(step2Idx);
  });

  // ────────────────────────────────────────────────────────────────
  // Composition assertions: the test file references its sibling tests
  // (audit-recs, MCP signal) by path so a future maintainer grepping
  // any of the 3 guard tests finds the others. Concept-composition (not
  // import — vitest runs in isolated forks), via path string equality.
  // ────────────────────────────────────────────────────────────────
  describe('composes with the wider production-guard telemetry', () => {
    const AUDIT_RECS_DIR = join(process.cwd(), '__tests__', 'audit-recs');
    const MCP_SIGNAL_PATH = join(
      process.cwd(),
      '__tests__',
      'mcp',
      'http-transport-signal.test.ts',
    );
    const GATE_CLI_PATH = join(process.cwd(), 'scripts', 'check-default-scripts-shape.ts');

    it('audit-recs directory exists (regex-presence guards are collective)', () => {
      expect(existsSync(AUDIT_RECS_DIR)).toBe(true);
    });

    it('MCP signal regression test exists (chat-hang-fix Step A surface)', () => {
      expect(existsSync(MCP_SIGNAL_PATH)).toBe(true);
    });

    it('CLI gate source exists (the third guard layer that Step 0a executes)', () => {
      expect(existsSync(GATE_CLI_PATH)).toBe(true);
    });
  });
});
