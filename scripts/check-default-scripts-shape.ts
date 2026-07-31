#!/usr/bin/env tsx
/**
 * check-default-scripts-shape.ts
 *
 * Shell-level shape lock for
 * `bing/web/lib/orchestra/prompt-orchestrator/default-scripts.ts` + its
 * facade re-export in `bing/web/lib/orchestra/prompt-orchestrator/index.ts`.
 *
 * Mirrors the vitest snapshot test
 * (`bing/web/lib/orchestra/prompt-orchestrator/__tests__/default-scripts.test.ts`)
 * plus the static audit lock
 * (`bing/web/lib/orchestra/__tests__/unified-agent-prompt-orchestrator-audit.test.ts`
 * Test 2c) on RAW FILE TEXT — no vitest runtime needed, so it can run as a
 * pre-commit hook or a Vercel preview-deployment gate that catches shape
 * drift before the test suite spins up.
 *
 * ## What it checks (mirrors Guard 1 + Guard 2 + Guard 3 in
 *   `bing/docs/prompt-orchestrator-default-scripts.md`)
 *
 *   1. `PO_UNIFIED_AGENT_SCRIPT` block in default-scripts.ts has:
 *      - `export const PO_UNIFIED_AGENT_SCRIPT: PromptScript = { ... }`
 *      - `promptId: 'unified-agent-entry'`
 *      - `steps: []`
 *   2. `PO_MARKER_TAIL_SCRIPT` block in default-scripts.ts has:
 *      - `export const PO_MARKER_TAIL_SCRIPT: PromptScript = { ... }`
 *      - `promptId: 'marker-tail-poll'`
 *      - `steps: []`
 *   3. The 2 `promptId`s are distinct (observability attribution invariant).
 *   4. The facade `index.ts` re-exports both consts from `./default-scripts`.
 *
 * ## Exit codes
 *
 *   - 0  all checks pass
 *   - 1  at least one check failed (errors printed to stderr)
 *
 * ## Usage
 *
 *   tsx scripts/check-default-scripts-shape.ts                # default paths
 *   tsx scripts/check-default-scripts-shape.ts --quiet        # suppress PASS lines
 *   tsx scripts/check-default-scripts-shape.ts --src <path>   # override source file
 *   tsx scripts/check-default-scripts-shape.ts --facade <path>  # override facade
 *   tsx scripts/check-default-scripts-shape.ts --help          # show help
 *
 * Pre-commit hook wrapper:
 *
 *   tsx bing/scripts/check-default-scripts-shape.ts || exit 1
 *
 * Vercel `buildCommand` in vercel.json (gates preview deployments):
 *
 *   "buildCommand": "tsx bing/scripts/check-default-scripts-shape.ts && next build"
 */

import {
  readFileSync,
  existsSync,
  statSync,
} from 'node:fs';
import {
  fileURLToPath,
} from 'node:url';
import {
  dirname,
  resolve,
} from 'node:path';
import {
  argv,
  exit,
  stdout,
  stderr,
} from 'node:process';

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL';
  detail?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Script lives at /opt/bing/scripts/check-default-scripts-shape.ts
// Target source files live at /opt/bing/web/lib/orchestra/prompt-orchestrator/
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_SCRIPTS_PATH = resolve(
  PROJECT_ROOT, 'web', 'lib', 'orchestra', 'prompt-orchestrator', 'default-scripts.ts',
);
const FACADE_INDEX_PATH = resolve(
  PROJECT_ROOT, 'web', 'lib', 'orchestra', 'prompt-orchestrator', 'index.ts',
);

const QUIET = argv.includes('--quiet') || argv.includes('-q');
const HELP = argv.includes('--help') || argv.includes('-h');

function printHelp(): never {
  stdout.write(
`Usage: tsx check-default-scripts-shape.ts [options]

Shell-level shape lock for default-scripts.ts + facade index.ts.
Mirrors the vitest snapshot + audit (Guard 1+2+3 in
  bing/docs/prompt-orchestrator-default-scripts.md).

Options:
  -q, --quiet              Suppress PASS lines (only show failures).
  -h, --help               Show this help.
  --src <path>             Override default-scripts.ts path.
                           (default: ${DEFAULT_SCRIPTS_PATH})
  --facade <path>          Override facade index.ts path.
                           (default: ${FACADE_INDEX_PATH})

Exit codes:
  0  all checks pass
  1  at least one check failed
`,
  );
  exit(0);
}

if (HELP) printHelp();

/**
 * Read a file's UTF-8 text or write an error to stderr and return null.
 */
function readTextOrFail(path: string): string | null {
  if (!existsSync(path)) {
    stderr.write(`✗ file not found: ${path}\n`);
    return null;
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    stderr.write(`✗ not a regular file: ${path}\n`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

/**
 * Detect whether `text` contains the const header
 *   `export const <NAME>: PromptScript = {`
 * and, if so, return the body slice in which to search for promptId/steps.
 *
 * Body-slice strategy uses TS-level SYNTHACTIC ANCHORS rather than naive
 * brace-counting. This is robust against:
 *   - comments that happen to contain `{` / `}` (e.g., JSDoc examples)
 *   - template literals `\`text ${foo}\`` whose `}` would unbalance a
 *     naive depth counter
 *   - future Tier 8 step 4 un-defer unblocker landing `steps: [{...}]`
 *     (the script's body slice remains valid because we never try to
 *     match nested braces)
 *
 * The body slice is bounded by either:
 *   - the next `\nexport\s+const\s+` header (start of the next const block
 *     in the file — useful when 2+ consts share the same source), OR
 *   - the remainder of the file if no further `export const` exists.
 */
function constBodySlice(text: string, name: string): string | null {
  const headerRe = new RegExp(
    `export\\s+const\\s+${name}\\s*:\\s*PromptScript\\s*=\\s*\\{`,
  );
  const headerMatch = text.match(headerRe);
  if (!headerMatch || headerMatch.index === undefined) return null;
  const startIdx = headerMatch.index + headerMatch[0].length;
  const tail = text.slice(startIdx);
  // Use the NEXT `export const ` header as the body bound (works for both
  // the 1st const in the file AND any future-added 3rd const — the LAST
  // const's body extends to EOF naturally because no later header exists).
  const nextHeader = tail.match(/\nexport\s+const\s+/);
  return nextHeader ? tail.slice(0, nextHeader.index) : tail;
}

function checkConstShape(
  text: string,
  name: string,
  expectedPromptId: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const body = constBodySlice(text, name);

  if (body === null) {
    results.push({
      name: `${name} — header present`,
      status: 'FAIL',
      detail: `Could not locate \`export const ${name}: PromptScript = {\` in default-scripts.ts`,
    });
    return results;
  }
  results.push({ name: `${name} — header present`, status: 'PASS' });

  // promptId check: must equal expectedPromptId verbatim. Anchored on a
  // line-start to avoid spurious matches inside string-literals or
  // template-substitutions within the body.
  const promptIdRe = new RegExp(
    `(?:^|\\n)\\s*promptId\\s*:\\s*(['"])([^'"]+)\\1`,
  );
  const promptIdMatch = body.match(promptIdRe);
  if (!promptIdMatch) {
    results.push({
      name: `${name} — promptId present`,
      status: 'FAIL',
      detail: `No \`promptId: '…'\` line found within the const body`,
    });
  } else if (promptIdMatch[2] !== expectedPromptId) {
    results.push({
      name: `${name} — promptId == '${expectedPromptId}'`,
      status: 'FAIL',
      detail: `got '${promptIdMatch[2]}'`,
    });
  } else {
    results.push({
      name: `${name} — promptId == '${expectedPromptId}'`,
      status: 'PASS',
    });
  }

  // steps check: must be an empty array literal. Anchored on a line so
  // the regex isn't confused by other identifiers that happen to contain
  // the substring `steps`.
  if (!/(?:^|\n)\s*steps\s*:\s*\[\s*\](?=\s|,|\n|$)/.test(body)) {
    results.push({
      name: `${name} — steps == []`,
      status: 'FAIL',
      detail: `\`steps\` is not an empty array literal within the const body`,
    });
  } else {
    results.push({ name: `${name} — steps == []`, status: 'PASS' });
  }

  return results;
}

function checkDisjoint(text: string): CheckResult {
  // Each promptId is matched by anchoring on its own const header, then
  // a lazy `[\s\S]*?` up to the first `promptId:` line. The downside of
  // the lazy quantifier (could match across const blocks in degenerate
  // inputs) is mitigated by anchoring on the const header.
  const uaRe = new RegExp(
    `export\\s+const\\s+PO_UNIFIED_AGENT_SCRIPT\\s*:\\s*PromptScript\\s*=\\s*\\{[\\s\\S]*?promptId\\s*:\\s*(['"])([^'"]+)\\1`,
  );
  const mtRe = new RegExp(
    `export\\s+const\\s+PO_MARKER_TAIL_SCRIPT\\s*:\\s*PromptScript\\s*=\\s*\\{[\\s\\S]*?promptId\\s*:\\s*(['"])([^'"]+)\\1`,
  );
  const uaMatch = text.match(uaRe);
  const mtMatch = text.match(mtRe);
  if (!uaMatch || !mtMatch) {
    return {
      name: 'Disjoint promptIds (observability attribution invariant)',
      status: 'FAIL',
      detail: 'Could not match promptIds from one or both const blocks',
    };
  }
  const uaPromptId = uaMatch[2];
  const mtPromptId = mtMatch[2];
  if (uaPromptId === mtPromptId) {
    return {
      name: 'Disjoint promptIds (observability attribution invariant)',
      status: 'FAIL',
      detail: `Both promptIds equal '${uaPromptId}' — Prometheus series will mesh together`,
    };
  }
  return {
    name: 'Disjoint promptIds (observability attribution invariant)',
    status: 'PASS',
  };
}

function checkFacadeReExport(facadeText: string): CheckResult[] {
  // Matches `export { PO_UNIFIED_AGENT_SCRIPT } from './default-scripts'`
  // — both consts must be re-exported via a SINGLE export {...} block.
  const uaRe = /export\s*\{[^}]*\bPO_UNIFIED_AGENT_SCRIPT\b[^}]*\}\s*from\s*['"]\.\/default-scripts['"]/;
  const mtRe = /export\s*\{[^}]*\bPO_MARKER_TAIL_SCRIPT\b[^}]*\}\s*from\s*['"]\.\/default-scripts['"]/;
  return [
    {
      name: 'Facade re-export PO_UNIFIED_AGENT_SCRIPT from ./default-scripts',
      status: uaRe.test(facadeText) ? 'PASS' : 'FAIL',
    },
    {
      name: 'Facade re-export PO_MARKER_TAIL_SCRIPT from ./default-scripts',
      status: mtRe.test(facadeText) ? 'PASS' : 'FAIL',
    },
  ];
}

// ── main ─────────────────────────────────────────────────────────────────────
function main(): number {
  const parseValue = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : null;
  };
  const srcPath = parseValue('--src') ?? DEFAULT_SCRIPTS_PATH;
  const facadePath = parseValue('--facade') ?? FACADE_INDEX_PATH;

  const srcText = readTextOrFail(srcPath);
  if (srcText === null) {
    stderr.write('aborting: cannot read default-scripts.ts body\n');
    return 1;
  }
  const facadeText = readTextOrFail(facadePath);
  if (facadeText === null) {
    stderr.write('aborting: cannot read facade index.ts body\n');
    return 1;
  }

  const allResults: CheckResult[] = [
    ...checkConstShape(srcText, 'PO_UNIFIED_AGENT_SCRIPT', 'unified-agent-entry'),
    ...checkConstShape(srcText, 'PO_MARKER_TAIL_SCRIPT', 'marker-tail-poll'),
    checkDisjoint(srcText),
    ...checkFacadeReExport(facadeText),
  ];

  const failures = allResults.filter((r) => r.status === 'FAIL');
  for (const r of allResults) {
    if (r.status === 'FAIL') {
      stderr.write(`✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}\n`);
    } else if (!QUIET) {
      stdout.write(`✓ ${r.name}\n`);
    }
  }

  if (failures.length > 0) {
    stderr.write(
      `\n${failures.length}/${allResults.length} shape-lock checks failed.\n` +
      `Run the vitest snapshot for diff:\n` +
      `  cd bing/web && pnpm exec vitest run __tests__/default-scripts.test.ts\n` +
      `And the audit suite:\n` +
      `  cd bing/web && pnpm exec vitest run __tests__/unified-agent-prompt-orchestrator-audit.test.ts\n`,
    );
    return 1;
  }

  stdout.write(`\n✓ all ${allResults.length} shape-lock checks passed.\n`);
  return 0;
}

exit(main());
