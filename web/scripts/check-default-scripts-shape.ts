#!/usr/bin/env tsx
/**
 * scripts/check-default-scripts-shape.ts
 *
 * CLI shape-lock for `web/lib/orchestra/prompt-orchestrator/default-scripts.ts`.
 *
 * Mirrors the same shape checks as `__tests__/default-scripts.test.ts` but on
 * raw file text — exits non-zero on shape drift. Useable as a shell-level
 * pre-commit hook or Vercel preview deployment gate that doesn't require
 * vitest. Pure Node + TypeScript via `tsx`; no extra runtime deps.
 *
 * ## Why a CLI script AND the vitest snapshot?
 *
 * `__tests__/default-scripts.test.ts` runs the shape checks at vitest time
 * (parametrized + toMatchSnapshot + disjoint invariant). This CLI runs the
 * same logical checks on raw file text WITHOUT requiring vitest, so it
 * can sit in `.husky/pre-commit` or `vercel.json`'s `buildCommand` and
 * fail the deployment on shape drift before the snapshot ever has a chance
 * to mismatch.
 *
 * The 3 production guards now compose:
 *   1. Static-file audit (`unified-agent-prompt-orchestrator-audit.test.ts` Test 2c) — text-pass on caller file.
 *   2. Vitest snapshot (`__tests__/default-scripts.test.ts`) — vitest-native, parametric + disjoint.
 *   3. THIS CLI (`scripts/check-default-scripts-shape.ts`) — vitest-free, file-text gate.
 *
 * ## Shape checks (in execution order)
 *
 *   1. Source file present + readable (exit 2 if not).
 *   2. Both `PO_UNIFIED_AGENT_SCRIPT` and `PO_MARKER_TAIL_SCRIPT` declared.
 *   3. Canonical promptIds:
 *      - `PO_UNIFIED_AGENT_SCRIPT.promptId === 'unified-agent-entry'`
 *      - `PO_MARKER_TAIL_SCRIPT.promptId  === 'marker-tail-poll'`
 *   4. Empty-steps contract: each const's `steps: []` is a literal empty array.
 *   5. Disjoint invariant: the 2 promptIds are different.
 *
 * ## Exit codes
 *
 *   - 0 — all 5 checks pass (or --self-test all caught).
 *   - 1 — at least one check drifted (drift list printed to stderr, line-numbered).
 *   - 2 — source file missing or unreadable (parse error printed to stderr).
 *
 * ## Usage
 *
 *   npx tsx scripts/check-default-scripts-shape.ts
 *   # or
 *   bun scripts/check-default-scripts-shape.ts
 *
 * Pre-commit hook (`.husky/pre-commit`):
 *   tsx scripts/check-default-scripts-shape.ts || exit 1
 *
 * Vercel preview gate (`vercel.json`):
 *   "buildCommand": "tsx scripts/check-default-scripts-shape.ts && next build"
 *
 * ## Self-test
 *
 *   npx tsx scripts/check-default-scripts-shape.ts --self-test
 *
 * Runs 7 fixture cases (1 OK + 4 drift injections + 2 robustness tests
 * against comment-line false-positives) against `parseAndCheck`
 * IN-PROCESS — no subprocess, no temp files written, no SOURCE_PATH touched.
 * Prints a matrix `case-id → injected-drift-description → caught?`, exits
 * 0 if all caught, 1 if any missed. Lets the team regression-test the
 * parser without manual sed drift-test cycles.
 *
 * 7 fixture cases (case 7 is the regression-test for the block-comment
 * scanner fix documented below):
 *   1. ok-fixture               — canonical source; expects exit 0 + 0 drifts.
 *   2. decl-missing             — PO_UNIFIED_AGENT_SCRIPT removed via line-comment-replace; expects declaration-presence.
 *   3. promptid-drift           — PO_UNIFIED_AGENT_SCRIPT.promptId → 'unified-agent-DRIFT'; expects canonical-promptId.
 *   4. steps-drift              — both consts gain a step; expects empty-steps-contract.
 *   5. disjoint-violation       — both promptIds share 'unified-agent-entry'; expects disjoint-prompt-ids.
 *   6. jsdoc-comment-ignored    — JSDoc-style comment with `* export const X:` lines (SAFE: asterisk-prefix) must NOT satisfy the declaration check.
 *   7. jsdoc-comment-bare-decl  — `/* ... *​/` block containing a BARE `\nexport const X:` line (no `*` prefix) must NOT satisfy the declaration check (BUG pattern, now defended).
 *
 * ## BUG-pattern defense (added)
 *
 * A `/* ... *​/` block whose example content used a bare `\nexport const X:`
 * line with NO `*` prefix USED to match `declRegex` falsely, because
 * `(?:^|\n)\s*export...` is line-anchored and ignores block-comment regions.
 * The fix layers a `buildBlockCommentIntervals(source)` scanner on top of
 * `declRegex`; the `findDecl(reg, source, intervals)` helper filters any
 * match whose `match.index` lands inside a `/* ... *​/` interval. Drift line
 * numbers stay accurate because the source is never mutated — only the
 * false-positive matches are skipped. Case 7 above is the regression-test
 * for this defense.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ────────────────────────────────────────────────────────────────────
// Source path: anchor at process.cwd() so the script works whether
// invoked from the repo root, from scripts/, or from a CI subprocess.
// The default-scripts.ts file is the single source of truth for the
// 2 per-call-site default PromptScripts.
// ────────────────────────────────────────────────────────────────────

const SOURCE_PATH = join(
  process.cwd(),
  'lib',
  'orchestra',
  'prompt-orchestrator',
  'default-scripts.ts',
);

// ────────────────────────────────────────────────────────────────────
// Canonical shape — the audit-contract. If you add a 3rd const to
// default-scripts.ts, add the third entry here AND update the vitest
// snapshot in __tests__/default-scripts.test.ts AND update this list.
// The 3 sources of guard stay in sync via this constant table.
// ────────────────────────────────────────────────────────────────────

const CANONICAL: ReadonlyArray<{
  constName: string;
  promptId: string;
  sourceLabel: string;
}> = [
  {
    constName: 'PO_UNIFIED_AGENT_SCRIPT',
    promptId: 'unified-agent-entry',
    sourceLabel: 'unified-agent',
  },
  {
    constName: 'PO_MARKER_TAIL_SCRIPT',
    promptId: 'marker-tail-poll',
    sourceLabel: 'marker-tail',
  },
];

// ────────────────────────────────────────────────────────────────────
// Drift model — line-numbered, machine-parsable. stderr lines look like:
//
//   - [canonical-promptId] L77: PO_UNIFIED_AGENT_SCRIPT promptId drift
//     (expected 'unified-agent-entry', actual 'unified-agent-v2')
//
// The `[check-name] L<line>` prefix is the parse contract for any
// downstream tooling (pre-commit summary, Vercel build log scraper, etc.).
// Keep it stable; don't reformat without updating the consumers.
// ────────────────────────────────────────────────────────────────────

type Drift = {
  check: string;
  line: number;
  message: string;
};

function lineNumberOf(source: string, charIndex: number): number {
  // 1-indexed line numbers matching how editors + grep/ripgrep report.
  return source.slice(0, charIndex).split('\n').length;
}

/**
 * Structural block-region scope: returns the end-offset for slicing the
 * body of a single `export const X` declaration. The slice terminates at
 * the FIRST occurrence of `\nexport const ` strictly AFTER `prevMatchEndIdx`
 * (so the next sibling const's body is excluded), or `source.length` if
 * this is the last const in the file.
 *
 * Caller contract: `prevMatchEndIdx` MUST be set to
 * `declMatch.index + declMatch[0].length` (one past the entire previous
 * match). Do NOT pass `declMatch.index + 1` — the regex's `\s*` consumes
 * MULTIPLE newlines because `\s` includes `\n`, so the inner `\n` of
 * `\n\nexport const X` lands at `declMatch.index + 1`, and
 * `source.indexOf('\nexport const ', declMatch.index + 1)` would falsely
 * hit at that inner `\n` (yielding a 1-char blockRegion and triggering
 * false-positive drifts on every fixture). The full prev-match length
 * skips past this trap.
 *
 * Replaces the previous fixed 600-char window — that window would
 * TRUNCATE a long JSDoc above `steps: []`, miss drifts, AND would BLEED
 * into a neighboring const's body if two consts are packed close together.
 * The structural anchor is robust to multi-line spreads, long comments,
 * reorderings, AND to the leading-blank-line `\n\n` that precedes most
 * sibling consts (which the 600-char window couldn't assert against).
 */
function nextConstBoundary(source: string, prevMatchEndIdx: number): number {
  const NEXT_ANCHOR = '\nexport const ';
  const idx = source.indexOf(NEXT_ANCHOR, prevMatchEndIdx);
  return idx === -1 ? source.length : idx;
}

// Build a list of `[start, end]` intervals for every `/* ... */` block in
// `source`. Used by `findDecl` to filter false-positive declRegex matches
// whose `match.index` lands INSIDE a block comment — a `/* ...\nexport const
// X: ... */` block whose example content uses a bare `\nexport const X:`
// line (no `*` prefix) would otherwise be misread as a real declaration.
//
// Single linear pass over `source` via a non-greedy block-comment regex;
// result is a small array reused for every decl match in `parseAndCheck`.
// Drift line numbers stay accurate because the scanner preserves the
// original source untouched — only the matches whose index falls inside an
// interval are filtered, never the source itself.
//
// Does NOT parse string literals — a `/*` inside a string or template is
// rare for a shape-lock prompt-script file, and treating it as a comment
// start is the safer default (a literal `/*...*/` sequence in a
// prompt-script source is suspicious on its own).
function buildBlockCommentIntervals(source: string): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    intervals.push([m.index, m.index + m[0].length]);
  }
  // Sort by start offset so `findDecl`'s linear scan can short-circuit at
  // the first interval whose start > match.index (intervals come from
  // left-to-right in source order already via the regex, but `Array.sort`
  // makes the invariant explicit + survives any future caller passing in
  // intervals from a non-monotonic source).
  intervals.sort((a, b) => a[0] - b[0]);
  return intervals;
}

// Like `regex.exec(source)` but skips matches whose `.index` lies inside
// any of the `intervals` (block comments). The regex MUST be global (`/g`)
// so `exec` advances its `lastIndex` across iterations — otherwise the loop
// would spin on an inside-comment match forever.
//
// Used as a defensive layer on top of `declRegex` for the bare-comment-line
// bug pattern: a `/* ...\nexport const X: ... */` line (no `*` prefix)
// USED TO falsely satisfy the decl-presence check. With this helper the
// parser refuses to count a match whose `.index` sits inside a `/* … */`
// interval — preserving all existing drift-line-number accuracy because
// the source string is never mutated.
function findDecl(
  regex: RegExp,
  source: string,
  intervals: Array<[number, number]>,
): RegExpExecArray | null {
  // Sorted-aware linear scan: a match landing at index N can only be inside
  // an interval whose start ≤ N < end. Since `intervals` is sorted by start
  // offset (see buildBlockCommentIntervals), all candidate intervals come
  // BEFORE any whose start > N. So we can `break` on the first interval
  // with start > N — converting the per-match scan from O(N) to O(1)
  // amortized (intervals past the test index are skipped entirely).
  let m: RegExpExecArray | null;
  while ((m = regex.exec(source)) !== null) {
    let inside = false;
    for (const [s, e] of intervals) {
      if (s > m!.index) break; // sorted: no further interval can contain this match
      if (m!.index >= s && m!.index < e) {
        inside = true;
        break;
      }
    }
    if (!inside) return m;
  }
  return null;
}

// Match a REAL declaration like `export const PO_UNIFIED_AGENT_SCRIPT: PromptScript =`.
// Anchored at `(?:^|\n)\s*` so a `// export const PO_UNIFIED_AGENT_SCRIPT` inside a
// comment line cannot falsely satisfy the declaration check (commented-out
// declarations don't count — they aren't deployed into the bundle).
const declRegex = (constName: string): RegExp =>
  new RegExp(`(?:^|\\n)\\s*export\\s+const\\s+${constName}\\s*:`, 'g');

// Match `promptId: 'unified-agent-entry',` — capture the actual promptId
// string in group 1, even if it drifted (so we can print both expected + actual).
const promptIdRegex = (blockRegion: string): RegExp | null => {
  const r = /promptId:\s*['"]([^'"]+)['"]/;
  return r.test(blockRegion) ? r : null;
};

function parseAndCheck(source: string): Drift[] {
  const drifts: Drift[] = [];
  const blockCommentIntervals = buildBlockCommentIntervals(source);

  // Check 2-4: per-const invariants
  for (const { constName, promptId: expectedPromptId } of CANONICAL) {
    const declMatch = findDecl(declRegex(constName), source, blockCommentIntervals);
    if (!declMatch) {
      drifts.push({
        check: 'declaration-presence',
        line: 0,
        message: `Missing export const ${constName}:`,
      });
      continue;
    }
    const declLine = lineNumberOf(source, declMatch.index);

    // Structural scope: slice from decl start to NEXT `export const `
    // boundary (or EOF). Pass `declMatch.index + declMatch[0].length` so
    // the search skips past the entire prev match — see nextConstBoundary's
    // JSDoc for why `declMatch.index + 1` would falsely hit the inner `\n`
    // of `\n\nexport const X`.
    const blockRegion = source.slice(
      declMatch.index,
      nextConstBoundary(source, declMatch.index + declMatch[0].length),
    );

    // Check 3: canonical promptId. Position-tracked so the drift message
    // points at the actual mismatched promptId line, not the const decl line —
    // operators grep the message directly when fixing the drift.
    const promptIdActualMatch = /promptId:\s*['"]([^'"]+)['"]/.exec(blockRegion);
    if (!promptIdActualMatch) {
      drifts.push({
        check: 'canonical-promptId',
        line: declLine,
        message: `${constName} promptId key absent (expected '${expectedPromptId}')`,
      });
    } else if (promptIdActualMatch[1] !== expectedPromptId) {
      const driftAbsIdx = declMatch.index + promptIdActualMatch.index;
      drifts.push({
        check: 'canonical-promptId',
        line: lineNumberOf(source, driftAbsIdx),
        message:
          `${constName} promptId drift (expected '${expectedPromptId}', ` +
          `actual '${promptIdActualMatch[1]}')`,
      });
    }

    // Check 4: empty-steps contract. Position-tracked so the drift line is the
    // `steps:` key's line, not the const decl line. Drops the previous
    // `<empty>` label fallback — `trim() === ''` is reported verbatim so
    // `[]` vs `[\n]` are distinguishable diagnostics.
    const emptyStepsOk = /steps:\s*\[\s*\]/.test(blockRegion);
    if (!emptyStepsOk) {
      const actualStepsMatch = /steps:\s*\[([^\]]*)\]/.exec(blockRegion);
      if (actualStepsMatch) {
        const driftAbsIdx = declMatch.index + actualStepsMatch.index;
        drifts.push({
          check: 'empty-steps-contract',
          line: lineNumberOf(source, driftAbsIdx),
          message: `${constName} steps is not literal [] (actual: [${actualStepsMatch[1]}])`,
        });
      } else {
        // No `steps:` key found at all in the structural block region.
        drifts.push({
          check: 'empty-steps-contract',
          line: declLine,
          message: `${constName} steps key absent (expected [] but no steps: key in const body)`,
        });
      }
    }
  }

  // Check 5: disjoint invariant. Independent of per-const checks so a
  // disjoint drift surfaces as a separate finding (different failure mode).
  const unifiedDecl = findDecl(declRegex('PO_UNIFIED_AGENT_SCRIPT'), source, blockCommentIntervals);
  const markerDecl = findDecl(declRegex('PO_MARKER_TAIL_SCRIPT'), source, blockCommentIntervals);
  if (unifiedDecl && markerDecl) {
    // Same caller-contract as the main loop: skip past the entire prev
    // match, not just one char past it. See nextConstBoundary's JSDoc.
    const unifiedRegion = source.slice(
      unifiedDecl.index,
      nextConstBoundary(source, unifiedDecl.index + unifiedDecl[0].length),
    );
    const markerRegion = source.slice(
      markerDecl.index,
      nextConstBoundary(source, markerDecl.index + markerDecl[0].length),
    );
    const idA = /promptId:\s*['"]([^'"]+)['"]/.exec(unifiedRegion)?.[1];
    const idB = /promptId:\s*['"]([^'"]+)['"]/.exec(markerRegion)?.[1];
    if (idA !== undefined && idB !== undefined && idA === idB) {
      // Polish 1: constName-keyed lookup (not `CANONICAL[0]/[1]` index access).
      // Survives array reordering + 3rd-const additions: if the array is
      // reordered or extended, this lookup still returns the correct expected
      // promptId for the const whose actual drifted. If the array is missing
      // the entry (silent CANONICAL drift), the `?? '<missing>'` fallback
      // surfaces the miss instead of crashing on `undefined`.
      const expectedA =
        CANONICAL.find((c) => c.constName === 'PO_UNIFIED_AGENT_SCRIPT')?.promptId ??
        '<missing-from-CANONICAL>';
      const expectedB =
        CANONICAL.find((c) => c.constName === 'PO_MARKER_TAIL_SCRIPT')?.promptId ??
        '<missing-from-CANONICAL>';
      drifts.push({
        check: 'disjoint-prompt-ids',
        line: lineNumberOf(source, unifiedDecl.index),
        message:
          `Disjoint invariant violated: 2 call-site promptIds collapsed to the same value. ` +
          `Expected: '${expectedA}' (PO_UNIFIED_AGENT_SCRIPT) + '${expectedB}' (PO_MARKER_TAIL_SCRIPT). ` +
          `Both are actually '${idA}'. ` +
          `Collapsing hides per-call-site attribution in prompt_injection_total{promptId=...} Prometheus labels.`,
      });
    }
  }

  return drifts;
}

// ────────────────────────────────────────────────────────────────────
// Self-test mode: regression-test parseAndCheck IN-PROCESS without
// touching SOURCE_PATH or the filesystem. Each fixture is a string;
// parseAndCheck runs on the string directly.
//
// Matrix is printed to stdout so CI logs capture it. Drift-caught verdict
// is the exit code: 0 = all caught, 1 = at least one missed.
//
// Not pytest-paradigm-with-fixtures — pure in-memory string fixtures are
// the minimum surface area for regression-testing a text-parser.
// ────────────────────────────────────────────────────────────────────

/**
 * Each case asserts:
 *   - expectedExit === actualExit (parses cleanly → 0; or has drifts → 1)
 *   - expectedChecks ⊆ actualChecks (if the case expects a specific
 *     named check to fire, the drift list must contain that name)
 *
 * For the OK case (`expectedChecks: []`), the assertion flips: assert
 * `drifts.length === 0` (no drifts surfaced on a healthy fixture).
 */
function runSelfTest(): number {
  const FIXTURE_OK = `import type { PromptScript } from './types'

export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
  promptId: 'unified-agent-entry',
  steps: [],
}

export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
  promptId: 'marker-tail-poll',
  steps: [],
}
`;

  // (2) declaration-presence drift: replace `export const PO_UNIFIED_AGENT_SCRIPT` with a comment.
  const FIXTURE_MISSING_DECL = FIXTURE_OK.replace(
    /export const PO_UNIFIED_AGENT_SCRIPT/,
    '// [self-test: removed]\n// export const PO_UNIFIED_AGENT_SCRIPT',
  );

  // (3) canonical-promptId drift: change `'unified-agent-entry'` (uniq to PO_UNIFIED_AGENT_SCRIPT) → 'unified-agent-DRIFT'.
  const FIXTURE_DRIFT_PROMPTID = FIXTURE_OK.replace(
    "'unified-agent-entry'",
    "'unified-agent-DRIFT'",
  );

  // (4) empty-steps drift: `steps: [],` appears in BOTH consts — replace both with a non-empty literal.
  const FIXTURE_DRIFT_STEPS = FIXTURE_OK.replace(
    'steps: [],',
    "steps: [{ id: 'x' }],",
  );

  // (5) disjoint violation: change `'marker-tail-poll'` (uniq to PO_MARKER_TAIL_SCRIPT) → 'unified-agent-entry'.
  // This ALSO triggers canonical-promptId drift on PO_MARKER_TAIL_SCRIPT (its expected promptId is
  // 'marker-tail-poll', not 'unified-agent-entry'). The case asserts the disjoint check fires;
  // additional canonical-promptId checks are tolerated.
  const FIXTURE_DISJOINT_VIOLATION = FIXTURE_OK.replace(
    "'marker-tail-poll'",
    "'unified-agent-entry'",
  );

  // (6) JSDoc-code-example robustness (SAFE PATTERN only): a JSDoc-style
  // comment block ABOVE the file with `* export const PO_*_SCRIPT:` lines
  // (the asterisk-prefix convention). The declRegex anchor `(?:^|\n)\s*export...`
  // must correctly skip these because `\s*` matches whitespace only, not `*`.
  //   - Expected: parses cleanly (0 drifts, exit 0).
  //   - If this case starts failing, someone has weakened the anchor (e.g.,
  //     removed `(?:^|\n)\s*`) and now `* export const X:` lines falsely
  //     satisfy the declaration check.
  //
  // Self-contained template literal (not derived from FIXTURE_OK via replace)
  // to avoid anchoring fragility to FIXTURE_OK's import-line format. If
  // FIXTURE_OK's structure ever changes (multiline-import refactor, import
  // deduplication, different quote style), a derive-by-replace approach would
  // silently no-op and this test would mask regressions. By being self-contained,
  // the fixture is visibly tied to the canonical shape — any drift in FIXTURE_OK
  // is detectable by side-by-side comparison.
  const FIXTURE_JSDOC_IGNORED = `import type { PromptScript } from './types'

/**
 * Documentation example (do NOT count as declarations — the \`*\` line-prefix
 * is what excludes them from the declRegex anchor):
 *
 *   * export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
 *       promptId: 'demo-unified',
 *       steps: [],
 *     }
 *
 *   * export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
 *       promptId: 'demo-marker',
 *       steps: [],
 *     }
 */

export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
  promptId: 'unified-agent-entry',
  steps: [],
}

export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
  promptId: 'marker-tail-poll',
  steps: [],
}
`;

  // (7) BUG PATTERN defense — block comment containing BARE
  // `\nexport const X:` lines (NO `*` prefix; just space-indented like
  // code). Before the fix, `declRegex`'s `(?:^|\n)\s*export...` anchor was
  // line-only — these bare lines matched and the parser falsely counted them
  // as real declarations (declaration-presence was satisfied TWICE per
  // const, and `nextConstBoundary` could be misled). The fix layers
  // `buildBlockCommentIntervals` + `findDecl` on top of `declRegex` to
  // filter matches whose index lands inside a `/* ... */` interval.
  //   - Expected: parses cleanly (0 drifts, exit 0).
  //   - If this case starts failing, the block-comment scanner is broken
  //     and the bare-comment-line bug pattern is regressed: a future edit
  //     that drops illustrative code blocks into a `/* ... */` would falsely
  //     satisfy the declaration-presence check, masking a real missing
  //     declaration in production source.
  //
  // Self-contained template literal — same rationale as case 6: visible
  // tie to the canonical shape protects against FIXTURE_OK drift masking.
  const FIXTURE_JSDOC_BARE = `import type { PromptScript } from './types'

/*
 * JSDoc-style block whose example content is space-indented like code
 * (BUG pattern: NO asterisk prefix on the export lines). The
 * block-comment scanner MUST skip these matches:
 *
   export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
     promptId: 'demo-unified',
     steps: [],
   }
 *
   export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
     promptId: 'demo-marker',
     steps: [],
   }
 *
 * More JSDoc.
 */

export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = {
  promptId: 'unified-agent-entry',
  steps: [],
}

export const PO_MARKER_TAIL_SCRIPT: PromptScript = {
  promptId: 'marker-tail-poll',
  steps: [],
}
`;

  type Case = {
    id: string;
    description: string;
    source: string;
    expectedExit: 0 | 1;
    expectedChecks: string[];
  };
  const cases: Case[] = [
    {
      id: 'ok-fixture',
      description: 'canonical source — no drifts expected',
      source: FIXTURE_OK,
      expectedExit: 0,
      expectedChecks: [],
    },
    {
      id: 'decl-missing',
      description: 'PO_UNIFIED_AGENT_SCRIPT declaration removed',
      source: FIXTURE_MISSING_DECL,
      expectedExit: 1,
      expectedChecks: ['declaration-presence'],
    },
    {
      id: 'promptid-drift',
      description: "PO_UNIFIED_AGENT_SCRIPT.promptId → 'unified-agent-DRIFT'",
      source: FIXTURE_DRIFT_PROMPTID,
      expectedExit: 1,
      expectedChecks: ['canonical-promptId'],
    },
    {
      id: 'steps-drift',
      description: "steps: [{ id: 'x' }] (non-empty literal)",
      source: FIXTURE_DRIFT_STEPS,
      expectedExit: 1,
      expectedChecks: ['empty-steps-contract'],
    },
    {
      id: 'disjoint-violation',
      description: "both promptIds share 'unified-agent-entry'",
      source: FIXTURE_DISJOINT_VIOLATION,
      expectedExit: 1,
      expectedChecks: ['disjoint-prompt-ids'],
    },
    {
      id: 'jsdoc-comment-ignored',
      description:
        'JSDoc-style comment with `* export const X:` lines must NOT be parsed as declarations',
      source: FIXTURE_JSDOC_IGNORED,
      expectedExit: 0,
      expectedChecks: [],
    },
    {
      id: 'jsdoc-comment-bare-decl',
      description:
        'block comment with bare \\nexport const X: lines (BUG pattern, no asterisk prefix) must NOT be parsed as declarations',
      source: FIXTURE_JSDOC_BARE,
      expectedExit: 0,
      expectedChecks: [],
    },
  ];

  process.stdout.write(
    `[check-default-scripts-shape] --self-test: ${cases.length} case(s)\n`,
  );

  let caught = 0;
  for (const c of cases) {
    const drifts = parseAndCheck(c.source);
    const actualExit: 0 | 1 = drifts.length === 0 ? 0 : 1;
    const exitOk = c.expectedExit === actualExit;
    let checkOk: boolean;
    if (c.expectedChecks.length === 0) {
      // OK case: assert ZERO drifts surfaced.
      checkOk = drifts.length === 0;
    } else {
      // Drift case: assert at least ONE expected check name is in the drift list.
      checkOk = c.expectedChecks.some((expected) =>
        drifts.some((d) => d.check === expected),
      );
    }
    const ok = exitOk && checkOk;
    if (ok) caught++;

    const actualCheckNames = drifts.map((d) => d.check).join('|') || 'none';
    const expectedCheckNames = c.expectedChecks.join('|') || 'none';
    process.stdout.write(
      `  [${ok ? '✓' : '✗'}] ${c.id}: ${c.description}\n` +
        `         expected  exit=${c.expectedExit}  checks=${expectedCheckNames}\n` +
        `         actual    exit=${actualExit}  checks=${actualCheckNames}\n`,
    );
  }

  const allCaught = caught === cases.length;
  process.stdout.write(
    `[check-default-scripts-shape] --self-test RESULT: ${caught}/${cases.length} case(s) caught — ${
      allCaught ? 'OK' : 'FAIL'
    }\n`,
  );
  return allCaught ? 0 : 1;
}

function main(): void {
  // Polish 3: --self-test arg routes to in-process regression-test mode.
  // Bypasses the SOURCE_PATH read + drift reporting — just exercises
  // parseAndCheck against fixture strings.
  if (process.argv[2] === '--self-test') {
    process.exit(runSelfTest());
  }

  let source: string;
  try {
    source = readFileSync(SOURCE_PATH, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[check-default-scripts-shape] ERROR: cannot read ${SOURCE_PATH}: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  const drifts = parseAndCheck(source);

  if (drifts.length === 0) {
    process.stdout.write(
      `[check-default-scripts-shape] OK — 5 invariants hold on ${SOURCE_PATH} ` +
        `(PO_UNIFIED_AGENT_SCRIPT + PO_MARKER_TAIL_SCRIPT, disjoint promptIds, empty-steps contract)\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `[check-default-scripts-shape] DRIFT — ${drifts.length} finding(s) on ${SOURCE_PATH}:\n`,
  );
  for (const d of drifts) {
    const lineStr = d.line === 0 ? 'N/A' : `L${d.line}`;
    process.stderr.write(`  - [${d.check}] ${lineStr}: ${d.message}\n`);
  }
  process.exit(1);
}

main();
