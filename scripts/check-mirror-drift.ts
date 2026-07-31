#!/usr/bin/env tsx
/**
 * check-mirror-drift.ts — monorepo mirror-drift detector
 *
 * Walks the monorepo's three tsconfig-aliased mirror pairs and reports any
 * `.ts` file that exists in BOTH the mirror and the canonical source at
 * the same relative path but with different SHA-256 content. The detection
 * catches the "silent shadow" failure mode documented in
 * `docs/MONOREPO_LAYOUT.md`:
 *
 *   `web/.bing-shared/`, `web/.bing-platform/src/`, and
 *   `web/.bing-infra-config/` are tsconfig-aliased mirrors of
 *   `packages/shared/`, `packages/platform/src/`, and `infra/`
 *   respectively. The canonical entry is listed FIRST in `web/tsconfig.json`
 *   `paths` — so any new file under `packages/*` silently shadows the
 *   mirror copy at the same relative path. This script surfaces the
 *   drift at CI time.
 *
 * Pair configuration:
 *   shared:    web/.bing-shared/         ↔ packages/shared/
 *   platform:  web/.bing-platform/src/   ↔ packages/platform/src/
 *   infra:     web/.bing-infra-config/   ↔ infra/
 *
 * The three pairs are configured in the PAIRS array below; adding a new
 * mirror pair is a 1-line addition. The tsconfig.json `paths` block is
 * the source of truth for the mapping — if the tsconfig changes (a
 * future re-ordering of the priority, a new alias, etc.), update this
 * array in lockstep.
 *
 * Algorithm:
 *   1. For each configured pair, walk the mirror root recursively and
 *      collect `(relativePath, sha256)` for every `.ts` file.
 *   2. Walk the canonical root the same way.
 *   3. Compute the intersection (relative paths present in BOTH).
 *   4. For each intersection entry, compare the shas — if they differ,
 *      that's drift.
 *   5. Report: (a) per-pair counts, (b) any drift entries with the
 *      shas of both sides, (c) an overall pass/fail summary.
 *
 * Standalone mirrors (mirror file with no canonical counterpart) and
 * standalone canonicals (canonical file with no mirror counterpart) are
 * NOT drift per the doc's framing — they are valid web-only or
 * workspace-only files. The script surfaces them as INFO (sub-dir count
 * + a "no mirror pairs" note) without failing the build.
 *
 * EXIT CODES
 *   0   no drift detected (or --warn-only mode prints findings but exits 0)
 *   1   at least one mirror-pair file has sha mismatch
 *   2   configuration / argument / runtime error
 *
 * USAGE
 *   pnpm dlx tsx scripts/check-mirror-drift.ts [flags]
 *
 * FLAGS
 *   --pair=shared|platform|infra|all   which pair to check (default: all)
 *   --ext=ts,tsx,mts                  comma-separated file extensions to include
 *                                     (default: ts only)
 *   --quiet                           suppress per-file drift output (just summary)
 *   --warn-only                       print findings but exit 0 (advisory mode)
 *   --top=N                           limit per-pair drift output to top-N (default: 50)
 *   -h, --help                        show this message
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// CLI parser
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function getOpt(name: string, fallback: string | null = null): string | null {
  const prefix = `--${name}=`;
  const found = argv.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasOpt(name: string): boolean {
  return argv.includes(`--${name}`);
}

const onlyPair = getOpt('pair'); // 'shared' | 'platform' | 'infra' | 'all' | null
const extArg = getOpt('ext', 'ts') ?? 'ts';
const quiet = hasOpt('quiet');
const warnOnly = hasOpt('warn-only');
const topN = parseInt(getOpt('top', String(50)) ?? '50', 10);

// ---------------------------------------------------------------------------
// Paths + ANSI helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};
const red = (s: string) => `${c.red}${s}${c.reset}`;
const green = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const cyan = (s: string) => `${c.cyan}${s}${c.reset}`;
const bold = (s: string) => `${c.bold}${s}${c.reset}`;
const dim = (s: string) => `${c.dim}${s}${c.reset}`;

function printUsage(): void {
  console.log(`${bold('check-mirror-drift.ts')} — monorepo mirror-drift detector`);
  console.log('');
  console.log('USAGE');
  console.log(`  ${cyan('pnpm dlx tsx scripts/check-mirror-drift.ts [flags]')}`);
  console.log('');
  console.log('FLAGS');
  console.log(`  ${dim('--pair=shared|platform|infra|all  ')}which pair to check (default: all)`);
  console.log(`  ${dim('--ext=ts,tsx,mts                  ')}comma-separated extensions (default: ts)`);
  console.log(`  ${dim('--quiet                           ')}suppress per-file drift output`);
  console.log(`  ${dim('--warn-only                       ')}print findings but exit 0`);
  console.log(`  ${dim('--top=N                           ')}limit drift output per pair (default: 50)`);
  console.log(`  ${dim('-h, --help                        ')}show this message`);
  console.log('');
  console.log('EXIT CODES');
  console.log(`  ${green('0')}   no drift detected${warnOnly ? ' (--warn-only mode)' : ''}`);
  console.log(`  ${red('1')}   at least one mirror-pair file has sha mismatch`);
  console.log(`  2   configuration / argument / runtime error`);
  console.log('');
  console.log('EXAMPLES');
  console.log(`  ${dim('# default: check all 3 pairs, fail on any drift')}`);
  console.log(`  pnpm dlx tsx scripts/check-mirror-drift.ts`);
  console.log(`  ${dim('# only the shared pair + advisory mode')}`);
  console.log(`  pnpm dlx tsx scripts/check-mirror-drift.ts --pair=shared --warn-only`);
  console.log(`  ${dim('# include .tsx + .mts files too')}`);
  console.log(`  pnpm dlx tsx scripts/check-mirror-drift.ts --ext=ts,tsx,mts`);
}

// ---------------------------------------------------------------------------
// Pair configuration
// ---------------------------------------------------------------------------

interface MirrorPair {
  name: string;
  mirror: string;     // relative to PROJECT_ROOT
  canonical: string;  // relative to PROJECT_ROOT
}

// Source of truth: web/tsconfig.json lines 25-52. If a future tsconfig change
// adds a new mirror alias, add a new entry here in lockstep.
const PAIRS: ReadonlyArray<MirrorPair> = [
  { name: 'shared',   mirror: 'web/.bing-shared',         canonical: 'packages/shared' },
  { name: 'platform', mirror: 'web/.bing-platform/src',   canonical: 'packages/platform/src' },
  { name: 'infra',    mirror: 'web/.bing-infra-config',   canonical: 'infra' },
];

const VALID_PAIRS = new Set(PAIRS.map((p) => p.name));
VALID_PAIRS.add('all');

// ---------------------------------------------------------------------------
// Walk + hash
// ---------------------------------------------------------------------------

/**
 * Walk `rootAbs` recursively and collect `(relativePath, sha256)` for every
 * file whose extension is in `exts`. Symlinks are followed. The relative
 * path uses POSIX separators (`/`) so two trees with different OS
 * separators (Windows vs Linux) produce identical keys.
 */
function walkFiles(rootAbs: string, exts: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(rootAbs)) return out;

  const visit = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      // Permission denied / EIO / etc. — skip silently. A future enhancement
      // could log to stderr; today, we surface the pair as "0 walked" in
      // the output so the operator can investigate.
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirAbs, entry.name);

      // Resolve what this entry actually is, following symlinks. We can't
      // trust `entry.isDirectory()` / `entry.isFile()` for symlinks — those
      // reflect the symlink itself, not the target. If a future contributor
      // ever replaces a mirror file with a symlink to its canonical (or
      // vice versa), we want the script to KEEP walking it, not silently
      // drop it. A `statSync` failure is treated as "not a file we can
      // hash" and skipped, mirroring the readFile failure path below.
      const isDir = entry.isDirectory()
        || (entry.isSymbolicLink() && (() => {
          try { return fs.statSync(full).isDirectory(); } catch { return false; }
        })());
      if (isDir) {
        visit(full);
        continue;
      }
      const isFile = entry.isFile()
        || (entry.isSymbolicLink() && (() => {
          try { return fs.statSync(full).isFile(); } catch { return false; }
        })());
      if (!isFile) continue;

      const ext = path.extname(entry.name).slice(1);
      if (!exts.has(ext)) continue;
      const rel = path.relative(rootAbs, full).split(path.sep).join('/');
      try {
        const buf = fs.readFileSync(full);
        const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
        out.set(rel, sha);
      } catch {
        // EACCES / EIO on individual files — skip. The output's per-pair
        // count surfaces the gap if this is a real issue.
      }
    }
  };

  visit(rootAbs);
  return out;
}

// ---------------------------------------------------------------------------
// Per-pair check
// ---------------------------------------------------------------------------

interface DriftEntry {
  rel: string;
  mirrorSha: string;
  canonicalSha: string;
}

interface PairResult {
  pair: MirrorPair;
  mirrorCount: number;
  canonicalCount: number;
  pairCount: number;
  inSyncCount: number;
  drift: DriftEntry[];
  mirrorOnlyCount: number;
  canonicalOnlyCount: number;
  passed: boolean;
}

function checkPair(pair: MirrorPair, exts: Set<string>): PairResult {
  const mirrorRoot = path.join(PROJECT_ROOT, pair.mirror);
  const canonicalRoot = path.join(PROJECT_ROOT, pair.canonical);

  const mirrorFiles = walkFiles(mirrorRoot, exts);
  const canonicalFiles = walkFiles(canonicalRoot, exts);

  const drift: DriftEntry[] = [];
  let inSyncCount = 0;
  for (const [rel, mirrorSha] of mirrorFiles) {
    const canonicalSha = canonicalFiles.get(rel);
    if (canonicalSha === undefined) continue; // mirror-only — see counts below
    if (canonicalSha === mirrorSha) {
      inSyncCount++;
    } else {
      drift.push({ rel, mirrorSha, canonicalSha });
    }
  }

  // pairCount = intersection size = in-sync files + drifted files.
  // (Computed below from the actual arrays, not from a Math.min that
  // always returns 0 — that was a pre-cleanup dead branch.)
  const pairCount = inSyncCount + drift.length;

  // Counts of standalone files (informational; not drift).
  let mirrorOnlyCount = 0;
  for (const rel of mirrorFiles.keys()) {
    if (!canonicalFiles.has(rel)) mirrorOnlyCount++;
  }
  let canonicalOnlyCount = 0;
  for (const rel of canonicalFiles.keys()) {
    if (!mirrorFiles.has(rel)) canonicalOnlyCount++;
  }

  return {
    pair,
    mirrorCount: mirrorFiles.size,
    canonicalCount: canonicalFiles.size,
    pairCount: inSyncCount + drift.length,
    inSyncCount,
    drift,
    mirrorOnlyCount,
    canonicalOnlyCount,
    passed: drift.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function renderPairResult(r: PairResult, topN: number): string[] {
  const lines: string[] = [];
  const head = `[${r.pair.name}: ${r.pair.mirror}/ ↔ ${r.pair.canonical}/]`;
  lines.push(`  ${bold(head)}`);
  lines.push(`    walked mirror:    ${r.mirrorCount} files`);
  lines.push(`    walked canonical: ${r.canonicalCount} files`);
  lines.push(`    mirror pairs:     ${r.pairCount}  ${dim(`(${r.inSyncCount} in sync, ${r.drift.length} drifted)`)}`);
  lines.push(`    standalone:       ${r.mirrorOnlyCount} mirror-only, ${r.canonicalOnlyCount} canonical-only  ${dim('(INFO — not drift)')}`);
  if (r.drift.length === 0) {
    lines.push(`    ${green('[PASS]')} no drift.`);
  } else {
    lines.push(`    ${red(`[FAIL] ${r.drift.length} drifted file(s):`)}`);
    if (!quiet) {
      const head = r.drift.slice(0, topN);
      const more = r.drift.length > head.length ? `  ${dim(`(+${r.drift.length - head.length} more — re-run with --top=N)`)}` : '';
      for (const d of head) {
        lines.push(`      - ${d.rel}`);
        lines.push(`          ${dim('mirror:')}    ${d.mirrorSha}`);
        lines.push(`          ${dim('canonical:')} ${d.canonicalSha}`);
      }
      if (more) lines.push(`      ${more}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    return 0;
  }
  if (onlyPair !== null && !VALID_PAIRS.has(onlyPair)) {
    console.error(`[check-mirror-drift] unknown --pair value: ${onlyPair}`);
    console.error(`  valid values: ${[...VALID_PAIRS].join(', ')}`);
    printUsage();
    return 2;
  }

  const exts = new Set(extArg.split(',').map((e) => e.trim()).filter(Boolean));
  if (exts.size === 0) {
    console.error(`[check-mirror-drift] --ext produced an empty extension set: '${extArg}'`);
    return 2;
  }

  const wantedPairs = onlyPair === null || onlyPair === 'all'
    ? PAIRS
    : PAIRS.filter((p) => p.name === onlyPair);

  console.log(bold('== check-mirror-drift =='));
  console.log(`  project root:  ${PROJECT_ROOT}`);
  console.log(`  pairs:         ${onlyPair ?? 'all'}`);
  console.log(`  extensions:    ${[...exts].join(', ')}`);
  console.log(`  warn-only:     ${warnOnly ? 'yes' : 'no'}`);
  console.log(`  quiet:         ${quiet ? 'yes' : 'no'}`);
  console.log(`  top-N:         ${topN}`);
  console.log('');

  const results: PairResult[] = [];
  for (const pair of wantedPairs) {
    const r = checkPair(pair, exts);
    results.push(r);
    for (const line of renderPairResult(r, topN)) console.log(line);
    console.log('');
  }

  const allPass = results.every((r) => r.passed);
  const totalPairs = results.reduce((n, r) => n + r.pairCount, 0);
  const totalInSync = results.reduce((n, r) => n + r.inSyncCount, 0);
  const totalDrift = results.reduce((n, r) => n + r.drift.length, 0);
  const totalMirrorOnly = results.reduce((n, r) => n + r.mirrorOnlyCount, 0);
  const totalCanonicalOnly = results.reduce((n, r) => n + r.canonicalOnlyCount, 0);

  console.log(bold('== summary =='));
  for (const r of results) {
    console.log(`  ${r.pair.name.padEnd(8)} ${r.passed ? green('pass') : red('fail')}  ${dim(`(pairs=${r.pairCount}, in-sync=${r.inSyncCount}, drift=${r.drift.length}, mirror-only=${r.mirrorOnlyCount}, canonical-only=${r.canonicalOnlyCount})`)}`);
  }
  console.log('');
  console.log(`  totals:        pairs=${totalPairs}, in-sync=${totalInSync}, drift=${totalDrift}, mirror-only=${totalMirrorOnly}, canonical-only=${totalCanonicalOnly}`);
  console.log(`  exit: ${allPass ? green('0') : warnOnly ? yellow('0') : red('1')}${warnOnly ? ' (--warn-only)' : ''}`);

  if (warnOnly) return 0;
  return allPass ? 0 : 1;
}

main()
  .then((rc) => process.exit(rc))
  .catch((err) => {
    console.error(`[check-mirror-drift] fatal: ${err instanceof Error ? err.message : (err?.message ?? String(err))}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
