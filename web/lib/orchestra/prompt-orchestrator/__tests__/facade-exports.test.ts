/**
 * facade-exports.test.ts
 *
 * Tier 8 step 8 polish B — locks the facade's observability re-export surface.
 *
 * Contract being asserted:
 *   `lib/orchestra/prompt-orchestrator/index.ts` MUST re-export ONLY
 *   `{ observeApplyScript, serializeMetrics }` from `./observability`. The
 *   11 @internal helpers (recordInjection, recordIdempotencySkip, etc.)
 *   are deliberately NOT re-exported through the facade so that the
 *   public API surface stays minimal — a future PR that accidentally
 *   re-exports one of them would silently grow the surface, breaking
 *   the contract for any consumer using
 *   `import { ... } from '@/lib/orchestra/prompt-orchestrator'`.
 *
 * Failure mode: this test prints the facade's current observability
 * re-export set vs the expected set so a reviewer can identify the
 * regression in one glance.
 *
 * Implementation note: we read index.ts as TEXT rather than importing it
 * because we want to lock the SHAPE of what's re-exported — a textual
 * check is the minimal-overhead primitive that catches the regression
 * class (a future PR silently growing the public surface via a new
 * `export ... from './observability'` line / block).
 *
 * Robustness strategy (learned from v1 + v2 + v3 iterations of this test):
 *
 *   **v1 (per-line filter)**: rejected multi-line exports — no single
 *   line has BOTH `^\s*export\s*` and `from './observability'`. Fixed
 *   by switching to per-statement parsing.
 *
 *   **v2 (dotall regex)**: too permissive — the lazy `[\s\S]*?` body
 *   capture started at the FIRST `export` in the source and reached
 *   forward to the only `} from './observability'`, swallowing 4
 *   intermediate re-exports into one match. Caused 6 names to be
 *   collected (4 from intermediate re-exports) instead of 2. Fixed
 *   by switching to per-statement parsing.
 *
 *   **v3 (per-statement parser, this version)**: split source on `;`
 *   (after stripping comments) so each match is one logical export
 *   statement; regex-match each individually. Per-token cleanup
 *   handles `type `-prefix, `as`-alias (receiving-side), and inline
 *   comments.
 *
 * Edge cases handled:
 *   - `;` inside block comments / line comments: stripped before splitting
 *     so they can't produce phantom statements.
 *   - Verbose `as`-aliases (`foo as bar`): the **receiving-side** `bar`
 *     is the public name consumers import — that's what we track.
 *   - `type`-only re-exports (`export type { Foo } from ...`): `type `
 *     prefix stripped.
 *
 * Escalation criteria (when to upgrade to TS-AST via
 * `typescript.createSourceFile`):
 *   - Surface exceeds 5 symbols
 *   - Production starts using `as`-aliases in observability re-exports
 *   - Docstrings grow complex (multi-paragraph JSDoc with `;`)
 *   - Barrel-of-barrels (facade re-exports from another facade)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FACADE_PATH = join(__dirname, '..', 'index.ts');
const ALLOWED_OBSERVABILITY_EXPORTS = new Set(['observeApplyScript', 'serializeMetrics']);

/**
 * Strip line + block comments from the source so comments containing `;`
 * can't produce phantom statements when we split on `;`.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Per-statement parser. Splits the source on `;` (after comment-strip)
 * so every match is one logical export statement, then regex-matches
 * each individually against a single-line anchored pattern.
 *
 * @param facadeSrc - raw text content of lib/orchestra/prompt-orchestrator/index.ts
 * @returns the set of identifiers (post-comment-strip + post-type-strip +
 *          post-alias-strip) that the facade re-exports from './observability'.
 */
function parseObservabilityExports(facadeSrc: string): Set<string> {
  const names = new Set<string>();
  // Per-statement: split on `;` so each match is one logical export statement.
  // Multi-line exports are one statement (the closing `;` is at the end).
  const cleanedSrc = stripComments(facadeSrc);
  const statements = cleanedSrc.split(';');
  // Anchored single-line-style regex (works for single-line AND multi-line
  // statements because the body is delimited by `\{ ... \}` and we collapse
  // whitespace before matching). The `(?:type\s+)?` allows both
  //   `export { a, b } from '...'`
  // and
  //   `export type { A, B } from '...'`
  // — TypeScript's optional `type` keyword between `export` and `{`.
  const stmtRe = /^\s*export\s+(?:type\s+)?\{([^}]*)\}\s*from\s+['"]\.\/observability['"]\s*$/;
  const typeStripRe = /^type\s+/;
  const aliasSplitRe = /\s+as\s+/;
  /**
   * Strip inline + block comments from a token, then strip `type ` prefix,
   * then keep the RECEIVING-SIDE of any `as` rename. For `foo as bar`,
   * `bar` is the public name `bar` consumers import — that's what we
   * track. `foo` (the local source name) is invisible to consumers.
   */
  function cleanToken(raw: string): string {
    const noComment = raw.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const noType = noComment.replace(typeStripRe, '');
    const receivingSide = noType
      .split(aliasSplitRe)
      .pop()
      ?.trim() ?? '';
    return receivingSide;
  }
  for (const stmt of statements) {
    // Collapse whitespace so multi-line statements fit the single-line regex.
    const flat = stmt.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    const m = flat.match(stmtRe);
    if (!m || !m[1]) continue;
    for (const sym of m[1].split(',')) {
      const cleaned = cleanToken(sym);
      if (cleaned) names.add(cleaned);
    }
  }
  return names;
}

describe('facade exports — observability surface (Tier 8 step 8 polish B)', () => {
  it('re-exports exactly { observeApplyScript, serializeMetrics } from observability (no @internal leaks)', () => {
    const facadeSrc = readFileSync(FACADE_PATH, 'utf8');
    const currentSet = parseObservabilityExports(facadeSrc);

    // Contract: at least one `export ... from './observability'` statement
    // must exist (omitting observability is also a regression).
    expect(currentSet.size).toBeGreaterThanOrEqual(1);

    // Exact set match — both directions.
    expect(currentSet.size).toBe(ALLOWED_OBSERVABILITY_EXPORTS.size);
    for (const expected of ALLOWED_OBSERVABILITY_EXPORTS) {
      expect(currentSet.has(expected)).toBe(true);
    }
    for (const actual of currentSet) {
      expect(ALLOWED_OBSERVABILITY_EXPORTS.has(actual)).toBe(true);
    }

    // Reproducible diagnostic diff for reviewers.
    const sortedCurrent = [...currentSet].sort();
    const sortedAllowed = [...ALLOWED_OBSERVABILITY_EXPORTS].sort();
    expect(sortedCurrent.join(', ')).toBe(sortedAllowed.join(', '));
  });

  it('handles multi-line export variants (defensive)', () => {
    // Simulate a multi-line export — clean fixture (no leading fake
    // docstring text, because the parser splits on `;` and the fixture
    // shape is supposed to mirror what real `split(';')` produces for
    // a multi-line observability export in a real facade file).
    const simulatedMultiLine = `\nexport {\n  observeApplyScript,\n  serializeMetrics,\n} from './observability';\n`;
    const names = parseObservabilityExports(simulatedMultiLine);
    expect(names.size).toBe(2);
    expect(names.has('observeApplyScript')).toBe(true);
    expect(names.has('serializeMetrics')).toBe(true);
  });

  it('does NOT over-match when facade has multiple exports (regression for v2 dotall bug)', () => {
    // v2 dotall regex collected 6 names because it matched the FIRST
    // `export` to the LAST `} from './observability'`, swallowing
    // intermediate re-exports. v3 per-statement parser must avoid that.
    const simulated = `prompt-orchestrator/index.ts\n` +
      `\n` +
      `export { scanMarkers, formatMarker, idempotencyKey } from './marker-scanner';\n` +
      `export { calculateSha, applyScript } from './injection-planner';\n` +
      `export { loadScript, ScriptLoadError } from './script-loader';\n` +
      `export { observeApplyScript, serializeMetrics } from './observability';`;
    const names = parseObservabilityExports(simulated);
    expect(names.size).toBe(2);
    expect(names.has('observeApplyScript')).toBe(true);
    expect(names.has('serializeMetrics')).toBe(true);
    // Ensure the false-positive symbols from v2 are NOT picked up:
    expect(names.has('scanMarkers')).toBe(false);
    expect(names.has('formatMarker')).toBe(false);
    expect(names.has('idempotencyKey')).toBe(false);
    expect(names.has('calculateSha')).toBe(false);
    expect(names.has('applyScript')).toBe(false);
    expect(names.has('loadScript')).toBe(false);
    expect(names.has('ScriptLoadError')).toBe(false);
  });

  it('handles a type-only observability re-export (forward-compat)', () => {
    // If a future PR adds a type-only observability re-export,
    // the parser must extract the type identifier (after stripping `type `).
    const simulated = `\nexport type { SomeTypeAlias } from './observability';\n`;
    const names = parseObservabilityExports(simulated);
    expect(names.size).toBe(1);
    expect(names.has('SomeTypeAlias')).toBe(true);
  });

  it('handles a renamed observability re-export (forward-compat — tracks receiving-side)', () => {
    // A future PR might rename: `export { foo as bar } from './observability';`
    // The exported symbol is `bar` (the receiving-side) — that's what
    // consumers write as `import { bar } from '@/lib/...'` — so we
    // must track the receiving-side, NOT the source-side.
    const simulated = `\nexport { observeApplyScript as applyScriptWithMetrics, serializeMetrics as serializeObsMetrics } from './observability';\n`;
    const names = parseObservabilityExports(simulated);
    expect(names.size).toBe(2);
    expect(names.has('applyScriptWithMetrics')).toBe(true);
    expect(names.has('serializeObsMetrics')).toBe(true);
    // Source-side names must NOT leak into the reported set.
    expect(names.has('observeApplyScript')).toBe(false);
    expect(names.has('serializeMetrics')).toBe(false);
  });

  it('handles semicolons inside block comments (forward-compat)', () => {
    // If a future PR adds `/* note; ignore */` inside a docstring,
    // stripComments must remove it BEFORE the `;`-split so it can't
    // produce a phantom statement.
    const simulated = `\n/* docstring note; this semicolon is inside a comment */\nexport { observeApplyScript, serializeMetrics } from './observability';\n`;
    const names = parseObservabilityExports(simulated);
    expect(names.size).toBe(2);
    expect(names.has('observeApplyScript')).toBe(true);
    expect(names.has('serializeMetrics')).toBe(true);
  });
});
