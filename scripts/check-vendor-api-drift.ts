#!/usr/bin/env tsx
/**
 * check-vendor-api-drift.ts — ARCH-001 Flag 3 audit anchor
 *
 * Sibling checks (one script, two checks):
 *   vendor-drift       — pin vendor-API export sets at install time; fail on
 *                        drift. Snapshots live under scripts/vendor-api-snapshots/.
 *   env-completeness   — pin the inline allowlist (in this script) against
 *                        every `process.env.X` reference surfaced in source.
 *                        Reports the cross-product and groups missing vars by
 *                        category (API_KEY / DEPLOYMENT_ENV / MODEL_CONFIG /
 *                        SERVER_RUNTIME / STORAGE / TEST / DEBUG / FEATURE_FLAG /
 *                        OTHER).
 *
 * The env-completeness check is the audit-anchor that resolves the user's
 * missing-static-env-surfacing grep into an at-runtime CI signal: any future
 * reference to a `process.env.X` whose X is not in the build.passThroughEnv
 * allowlist (or covered by its wildcard, e.g. `NEXT_PUBLIC_*`) shows up as a
 * finding here, and the operator's workflow is `--warn-only` first → review
 * exemptions → bump the inline allowlist before re-running in strict mode.
 *
 * EXIT CODES
 *   0   all checks passed (or --warn-only mode prints findings but exits 0)
 *   1   at least one check failed (non-zero drift or missing env vars)
 *   2   configuration / argument / runtime error
 *
 * USAGE
 *   pnpm dlx tsx scripts/check-vendor-api-drift.ts [flags]
 *
 * FLAGS
 *   --check=vendor|env|all   which sibling check to run (default: all)
 *   --update                  regenerate vendor-API snapshots (vendor-drift only)
 *   --strict                  disable exemptions in env-completeness
 *   --verbose                 include __tests__ + JSDoc matches in env-completeness
 *   --top=N                   limit env-completeness output to top-N missing (default: 30)
 *   --warn-only               print findings but exit 0 (advisory mode)
 *   -h, --help                show this message
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// CLI parser
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function getOpt(name: string, fallback: string | null = null): string | null {
  const prefix = `--${name}=`;
  const found = argv.find(a => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasOpt(name: string): boolean {
  return argv.includes(`--${name}`);
}

const onlyCheck = getOpt('check'); // 'vendor' | 'env' | 'all' | null
const update = hasOpt('update');
const strict = hasOpt('strict');
const verbose = hasOpt('verbose');
const warnOnly = hasOpt('warn-only');
const topN = parseInt(getOpt('top', String(30)) ?? '30', 10);

// ---------------------------------------------------------------------------
// Paths + ANSI helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const SNAPSHOT_DIR = path.join(SCRIPT_DIR, 'vendor-api-snapshots');

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
  console.log(`${bold('check-vendor-api-drift.ts')} — ARCH-001 Flag 3 audit anchor`);
  console.log('');
  console.log('USAGE');
  console.log(`  ${cyan('pnpm dlx tsx scripts/check-vendor-api-drift.ts [flags]')}`);
  console.log('');
  console.log('FLAGS');
  console.log(`  ${dim('--check=vendor|env|all  ')}which sibling check to run (default: all)`);
  console.log(`  ${dim('--update                 ')}regenerate vendor-API snapshots (vendor-drift only)`);
  console.log(`  ${dim('--strict                 ')}disable exemptions in env-completeness`);
  console.log(`  ${dim('--verbose                ')}include __tests__ matches in env-completeness`);
  console.log(`  ${dim('--top=N                  ')}limit env-completeness output to top-N missing (default: 30)`);
  console.log(`  ${dim('--warn-only              ')}print findings but exit 0 (advisory mode)`);
  console.log(`  ${dim('-h, --help               ')}show this message`);
  console.log('');
  console.log('EXIT CODES');
  console.log(`  ${green('0')}   all checks passed${warnOnly ? ' (--warn-only mode)' : ''}`);
  console.log(`  ${red('1')}   at least one check failed`);
  console.log(`  2   configuration / argument / runtime error`);
  console.log('');
  console.log('EXAMPLES');
  console.log(`  ${dim('# default (run both sibling checks, fail on any mismatch)')}`);
  console.log(`  pnpm dlx tsx scripts/check-vendor-api-drift.ts`);
  console.log(`  ${dim('# only the env audit + advisory mode (no CI break)')}`);
  console.log(`  pnpm dlx tsx scripts/check-vendor-api-drift.ts --check=env --warn-only`);
  console.log(`  ${dim('# regenerate vendor-API snapshots after a deliberate SDK bump')}`);
  console.log(`  pnpm dlx tsx scripts/check-vendor-api-drift.ts --check=vendor --update`);
}

// ---------------------------------------------------------------------------
// Vendor-drift side: extract named exports from .d.ts files.
// ---------------------------------------------------------------------------

function listDtsFiles(pkgDir: string): string[] {
  if (!fs.existsSync(pkgDir)) return [];
  // Prefer the canonical index.d.ts when present.
  const canonical = [
    path.join(pkgDir, 'dist', 'index.d.ts'),
    path.join(pkgDir, 'dist', 'index.d.mts'),
    path.join(pkgDir, 'dist', 'index.d.cts'),
  ].filter(p => fs.existsSync(p));
  if (canonical.length > 0) return canonical;

  // Fallback: walk dist recursively for .d.ts / .d.mts / .d.cts.
  const out: string[] = [];
  const visit = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.d\.(ts|mts|cts)$/.test(entry.name)) out.push(full);
    }
  };
  const distDir = path.join(pkgDir, 'dist');
  if (fs.existsSync(distDir)) visit(distDir);
  return out;
}

function extractNamedExportsFromDts(content: string): Set<string> {
  const found = new Set<string>();
  // export { Foo, Bar as Baz }
  for (const m of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (trimmed.length > 0 && trimmed !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
        found.add(trimmed);
      }
    }
  }
  // export const/declare/function/class/interface/type ...
  for (const m of content.matchAll(/\bexport\s+(?:declare\s+)?(?:const|let|var|function|class|enum|namespace|interface|type|abstract\s+class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    found.add(m[1]);
  }
  return found;
}

function getVendorExports(pkg: string): { exports: Set<string>; dtsFiles: string[] } | null {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules', pkg),
    path.join(PROJECT_ROOT, 'web', 'node_modules', pkg),
  ];
  const pkgDir = candidates.find(d => fs.existsSync(path.join(d, 'package.json')));
  if (!pkgDir) return null;
  const dtsFiles = listDtsFiles(pkgDir);
  if (dtsFiles.length === 0) return null;
  const exports = new Set<string>();
  for (const f of dtsFiles) {
    extractNamedExportsFromDts(fs.readFileSync(f, 'utf-8')).forEach(n => exports.add(n));
  }
  return { exports, dtsFiles };
}

// ---------------------------------------------------------------------------
// Vendor-drift check
// ---------------------------------------------------------------------------

async function checkVendorDrift(opts: { update: boolean }): Promise<{ pass: boolean; details: string[] }> {
  const details: string[] = [];
  let pass = true;

  // Pull pinned vendor packages from BOTH /opt/bing/package.json AND
  // /opt/bing/web/package.json. The list is the union of both files' deps +
  // devDeps: the drift script's watch-list (see WATCH_LIST below) is checked
  // against this union, so a package hoisted only in the web workspace
  // (e.g. `vaul`, which desktop+web use but root's package.json doesn't
  // declare) is still surfaced as `present` for snapshot generation.
  //
  // Note: this is intentionally tolerant of missing files (e.g. a fresh
  // checkout without `/opt/bing/web/package.json` yet) — `Object.assign` of
  // `{}` is the no-op term.
  const pkgJsonPaths = [
    path.join(PROJECT_ROOT, 'package.json'),
    path.join(PROJECT_ROOT, 'web', 'package.json'),
  ];
  const allDeps: Record<string, string> = {};
  for (const p of pkgJsonPaths) {
    if (!fs.existsSync(p)) continue;
    const pj = JSON.parse(fs.readFileSync(p, 'utf-8'));
    Object.assign(allDeps, pj.dependencies ?? {}, pj.devDependencies ?? {});
  }

  const WATCH_LIST = ['@daytonaio/sdk', 'vaul', 'modal', '@opencode-ai/sdk'];
  const present = WATCH_LIST.filter(p => allDeps[p]);
  const missing = WATCH_LIST.filter(p => !allDeps[p]);

  if (missing.length > 0) {
    details.push(`  ${yellow('[vendor-drift]')} watch-list packages NOT in package.json: ${missing.join(', ')}`);
  }

  for (const pkg of present) {
    const live = getVendorExports(pkg);
    const snapshotPath = path.join(SNAPSHOT_DIR, `${pkg.replace(/[/@]/g, '_')}.json`);

    if (live === null) {
      details.push(`  ${yellow(`[vendor-drift] ${pkg}`)} no .d.ts files in node_modules — skipping (snapshot still trusted if present).`);
      continue;
    }

    const liveExports = Array.from(live.exports).sort();
    const snapshotExists = fs.existsSync(snapshotPath);

    if (opts.update || !snapshotExists) {
      if (!opts.update && !snapshotExists) {
        // Footgun guard: in non-update mode, a missing snapshot must NOT
        // become a silent baseline. The legitimate creation path is the
        // `--update` flag (an operator explicitly ack'd the new surface).
        // Silently writing a brand-new baseline would let CI report "IN SYNC"
        // against an unreviewed snapshot — e.g. after a `git rm` of the
        // snapshot file mid-PR. Failing loud here forces the operator to
        // either rerun with `--update` (intentional bump) or restore the
        // snapshot from version control (unexpected loss).
        pass = false;
        details.push(`  ${red(`[vendor-drift] ${pkg}`)} no snapshot at ${snapshotPath}`);
        details.push(`    → ${cyan('regenerate via:')} pnpm check:vendor-drift --check=vendor --update   ${dim('(operator-acked only)')}`);
        details.push(`    → ${cyan('or revert via:')}      git restore ${snapshotPath.replace(`${PROJECT_ROOT}/`, '')}`);
        continue;
      }
      if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({ pkg, generatedAt: new Date().toISOString(), exports: liveExports }, null, 2),
        'utf-8'
      );
      details.push(`  ${green(`[vendor-drift] ${pkg}`)} snapshot ${opts.update ? 'regenerated' : 'created'} (${liveExports.length} exports).`);
      continue;
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const snapExports: string[] = (snapshot.exports ?? []).slice().sort();
    const liveSet = new Set(liveExports);
    const snapSet = new Set(snapExports);
    const added = liveExports.filter(x => !snapSet.has(x));
    const removed = snapExports.filter(x => !liveSet.has(x));

    if (added.length === 0 && removed.length === 0) {
      details.push(`  ${green(`[vendor-drift] ${pkg}`)} IN SYNC (${liveExports.length} exports).`);
    } else {
      pass = false;
      details.push(`  ${red(`[vendor-drift] ${pkg} DRIFTED:`)}`);
      if (added.length > 0) {
        const head = added.slice(0, 20);
        const more = added.length > 20 ? `, ... (+${added.length - 20} more)` : '';
        details.push(`    ${green('+')} new: ${head.join(', ')}${more}`);
      }
      if (removed.length > 0) {
        const head = removed.slice(0, 20);
        const more = removed.length > 20 ? `, ... (-${removed.length - 20} more)` : '';
        details.push(`    ${red('-')} removed: ${head.join(', ')}${more}`);
      }
      details.push(`    → ${cyan('regenerate via:')} pnpm dlx tsx scripts/check-vendor-api-drift.ts --check=vendor --update`);
    }
  }

  return { pass, details };
}

// ---------------------------------------------------------------------------
// Env-completeness side: the missing-static-env-surfacing audit, as a sibling.
// ---------------------------------------------------------------------------

type Cat =
  | 'API_KEY'
  | 'DEPLOYMENT_ENV'
  | 'MODEL_CONFIG'
  | 'SERVER_RUNTIME'
  | 'STORAGE'
  | 'TEST'
  | 'DEBUG'
  | 'FEATURE_FLAG'
  | 'OTHER';

const CATEGORY_ORDER: Cat[] = ['API_KEY', 'DEPLOYMENT_ENV', 'MODEL_CONFIG', 'SERVER_RUNTIME', 'STORAGE', 'TEST', 'DEBUG', 'FEATURE_FLAG', 'OTHER'];

// Categorize based on env-var naming convention (matches /opt/bing/scripts/validate-env.js
// CANONICAL_VARS structure for cross-reference). Order of checks matters — API_KEY
// beats SERVER_RUNTIME beats STORAGE so a single var falls into the most-specific
// category even when multiple regexes match.
function categorize(name: string): Cat {
  // DEBUG / TEST / dev-only are the first-priority exemptions; in strict mode these
  // are reported, in non-strict mode they're exempted from the allowlist check.
  if (/^(TEST|VITEST)_/i.test(name) || /_TEST_/i.test(name)) return 'TEST';
  if (/^DEBUG_/i.test(name) || /^(VITE|HMR)_/i.test(name)) return 'DEBUG';
  if (/_API_KEY$|_TOKEN$|_SECRET$|_PASSWORD$|_CREDENTIALS?$|_PRIVATE_KEY$/i.test(name)) return 'API_KEY';
  if (/^LLM_/.test(name) || /_MODEL$/i.test(name) || /_PROVIDER$/i.test(name)) return 'MODEL_CONFIG';
  if (/^OPENCODE/.test(name) && !/_API_KEY$|_TOKEN$/i.test(name)) return 'MODEL_CONFIG';
  if (/_(URL|ENDPOINT|HOST|PORT|PATH)$/i.test(name) || /^DATABASE/i.test(name)) return 'SERVER_RUNTIME';
  if (/^(RUNTIME|DESKTOP|HEADLESS|PROD|STAGING|ENVIRONMENT)$/i.test(name)) return 'DEPLOYMENT_ENV';
  if (/^SENTRY_|^ANALYTICS_|^OTEL_|^LOG_/i.test(name)) return 'DEPLOYMENT_ENV';
  if (/^REDIS_URL$|^POSTGRES_|^MINIO_|^S3_|^R2_|^AWS_|^GCP_|^DO_SPACES_/i.test(name)) return 'STORAGE';
  if (/^FEATURE_|^FLAG_|^EXPERIMENT_|^ENABLE_/i.test(name)) return 'FEATURE_FLAG';
  return 'OTHER';
}

interface Ref {
  name: string;
  count: number;
}

function globMatch(name: string, pattern: string): boolean {
  if (name === pattern) return true;
  if (pattern.includes('*')) {
    const re = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*') +
        '$'
    );
    return re.test(name);
  }
  return false;
}

/**
 * Run the user's missing-static-env-surfacing grep across the codebase.
 * Falls back to `grep -E` if `rg` is not on PATH.
 */
function collectReferences(verbose: boolean): Map<string, number> {
  const counter = new Map<string, number>();
  const SEARCH_PATHS = ['/opt/bing/web/app', '/opt/bing/web/lib', '/opt/bing/packages'];
  // rg `-g` flag is INCLUSIVE-when-not-prefixed-with-!. Default mode excludes
  // __tests__ directories and *.d.ts files (typical tsc-emitted artifacts that
  // contain dead-code references). --verbose REMOVES those exclusions so the
  // audit reflects EVERY occurrence including test fixtures and JSDoc comments.
  const GLOBS: string[] = verbose
    ? ['--type', 'ts']
    : ['--type', 'ts', '-g', '!__tests__', '-g', '!*.d.ts'];

  const rgArgs = ['process\\.env\\.[A-Z_]+', ...SEARCH_PATHS, ...GLOBS, '--no-heading', '-N'];
  const rgCmd = ['rg', ...rgArgs].map(a => (a.includes(' ') ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

  let out = '';
  try {
    out = execSync(rgCmd, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e: any) {
    // rg exits non-zero on no-match in some configs — fall back to stdout.
    out = (e.stdout?.toString?.() ?? '') as string;
  }

  // If rg returned nothing (silent failure or fallback exhausted), try grep -E.
  // grep doesn't understand rg's `-g` — use grep's own
  // `--include/--exclude-dir/--exclude` flags. `--exclude-dir` globs match by
  // directory basename in grep, so `__tests__` matches `__tests__/` cleanly.
  if (out === '') {
    const grepExcludeArgs = verbose
      ? `--include='*.ts'`
      : `--include='*.ts' --exclude-dir='__tests__' --exclude='*.d.ts'`;
    try {
      out = execSync(
        `grep -rE 'process\\.env\\.[A-Z_]+' ${SEARCH_PATHS.join(' ')} ${grepExcludeArgs}`,
        { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }
      );
    } catch (e: any) {
      out = (e.stdout?.toString?.() ?? '') as string;
    }
  }

  for (const line of out.split('\n')) {
    const m = line.match(/process\.env\.([A-Z_]+)/);
    if (!m) continue;
    counter.set(m[1], (counter.get(m[1]) ?? 0) + 1);
  }
  return counter;
}

async function checkEnvCompleteness(opts: { strict: boolean; verbose: boolean; topN: number }): Promise<{ pass: boolean; details: string[] }> {
  const details: string[] = [];

  const counter = collectReferences(opts.verbose);  // Build-time pass-through env allowlist. Wildcards (`*`) are honored by
  // `globMatch` below — keep that semantics in sync if editing this list.
  const allowlist: ReadonlyArray<string> = [
    'NODE_ENV',
    'CI',
    'NEXT_PUBLIC_*',
    'DATABASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'REDIS_URL',
  ];

  // Exemptions. The non-strict (default) mode mirrors what Next.js reads at
  // build time when `ci` env vars are not present: if Next.js isn't reading
  // them, the build doesn't fail. So in non-strict mode we silently skip
  // these categories and the operator only sees the actionable findings.
  const exemptAuto: string[] = ['NODE_ENV', 'CI'];
  const exemptPrefixes: string[] = opts.strict ? [] : ['TEST_', 'DEBUG_', 'VITE_', 'HMR_'];

  const isExempt = (name: string): boolean => {
    if (exemptAuto.includes(name)) return true;
    return exemptPrefixes.some(p => name.startsWith(p));
  };

  const inAllowlist = (name: string): boolean => {
    if (isExempt(name)) return true;
    return allowlist.some(e => globMatch(name, e));
  };

  const grouped: Record<Cat, Ref[]> = {
    API_KEY: [], DEPLOYMENT_ENV: [], MODEL_CONFIG: [], SERVER_RUNTIME: [], STORAGE: [], TEST: [], DEBUG: [], FEATURE_FLAG: [], OTHER: [],
  };
  for (const [name, count] of counter.entries()) {
    if (inAllowlist(name)) continue;
    grouped[categorize(name)].push({ name, count });
  }
  for (const cat of CATEGORY_ORDER) {
    grouped[cat].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  const total_missing = CATEGORY_ORDER.reduce((n, cat) => n + grouped[cat].length, 0);
  const pass = total_missing === 0;

  details.push(`  ${bold('[env-completeness]')} referenced: ${counter.size} unique vars | allowlist: ${allowlist.length}${opts.strict ? ' (' + dim('strict') + ')' : ''}`);
  details.push(`    allowlist: ${allowlist.join(', ')}`);
  details.push(`    exemptions: ${exemptAuto.join(', ')} ${exemptPrefixes.length > 0 ? '+ prefix-exemptions: ' + exemptPrefixes.join(',') : ''}`);

  if (total_missing === 0) {
    details.push(`    ${green('[PASS]')} no missing vars.`);
  } else {
    details.push(`    ${red(`[FAIL] ${total_missing} vars missing from build.passThroughEnv:`)}`);
    for (const cat of CATEGORY_ORDER) {
      const entries = grouped[cat];
      if (entries.length === 0) continue;
      const head = entries.slice(0, opts.topN);
      const more = entries.length > head.length ? `, showing top ${head.length}` : '';
      details.push(`      ${bold(cat)} (${entries.length}${more}):`);
      for (const e of head) {
        details.push(`        ${e.count.toString().padStart(5)}  ${e.name}`);
      }
    }
    details.push(`    → ${cyan('bump')} the allowlist in scripts/check-vendor-api-drift.ts, or pass ${cyan('--strict')} to expose even exempted categories.`);
  }

  return { pass, details };
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    printUsage();
    return 0;
  }
  if (onlyCheck !== null && !['vendor', 'env', 'all'].includes(onlyCheck)) {
    console.error(`[check-vendor-api-drift] unknown --check value: ${onlyCheck}`);
    printUsage();
    return 2;
  }

  let allPass = true;
  const runVendor = onlyCheck === null || onlyCheck === 'all' || onlyCheck === 'vendor';
  const runEnv = onlyCheck === null || onlyCheck === 'all' || onlyCheck === 'env';

  console.log(bold('== check-vendor-api-drift =='));
  console.log(`  project root:  ${PROJECT_ROOT}`);
  console.log(`  checks:        ${onlyCheck ?? 'all'}`);
  console.log(`  strict:        ${strict ? 'yes' : 'no'}`);
  console.log(`  verbose:       ${verbose ? 'yes' : 'no'}`);
  console.log(`  warn-only:     ${warnOnly ? 'yes' : 'no'}`);
  console.log(`  top-N:         ${topN}`);
  console.log('');

  if (runVendor) {
    console.log(bold('[vendor-drift]'));
    const result = await checkVendorDrift({ update });
    for (const line of result.details) console.log(line);
    if (!result.pass) allPass = false;
    console.log('');
  }

  if (runEnv) {
    console.log(bold('[env-completeness]'));
    const result = await checkEnvCompleteness({ strict, verbose, topN });
    for (const line of result.details) console.log(line);
    if (!result.pass) allPass = false;
    console.log('');
  }

  console.log(bold('== summary =='));
  console.log(`  vendor-drift:     ${runVendor ? (allPass ? green('pass') : red('fail')) : dim('skipped')}`);
  console.log(`  env-completeness: ${runEnv ? (allPass ? green('pass') : red('fail')) : dim('skipped')}`);
  console.log(`  exit: ${allPass ? green('0') : warnOnly ? yellow('0') : red('1')}${warnOnly ? ' (--warn-only)' : ''}`);

  if (warnOnly) return 0;
  return allPass ? 0 : 1;
}

main()
  .then(rc => process.exit(rc))
  .catch(err => {
    console.error(`[check-vendor-api-drift] fatal: ${err instanceof Error ? err.message : (err?.message ?? String(err))}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
