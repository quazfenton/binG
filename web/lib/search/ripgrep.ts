/**
 * ripgrep.ts — Real ripgrep executor with auto-detect + JS fallback.
 *
 * Resolution order for the `rg` binary:
 *   1. `process.env.RG_BIN` (explicit override)
 *   2. `<repoRoot>/tools/bin/rg.exe` (Windows) / `tools/bin/rg` (Unix)
 *   3. `@vscode/ripgrep` npm package (ships prebuilt binaries cross-platform)
 *   4. System `PATH` (`rg` / `rg.exe`)
 *   5. JS fallback (line-by-line regex scan across walked files)
 *
 * To enable real ripgrep:
 *   - Drop a `rg` / `rg.exe` binary at `tools/bin/` in the repo, OR
 *   - `npm install @vscode/ripgrep` (adds 8MB cross-platform binaries), OR
 *   - Set `RG_BIN=/abs/path/to/rg`
 *
 * The JS fallback is intentionally simple — it is correct but ~10–100× slower
 * than real ripgrep. Production deployments should ship a binary.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Search:Ripgrep');

// ─── Binary detection ───────────────────────────────────────────────────────

let _rgPathCache: string | null | undefined; // undefined = not probed yet

/**
 * Resolve the ripgrep binary path. Cached after first call.
 * Returns `null` when no binary is available (caller should use JS fallback).
 */
export async function resolveRipgrepPath(): Promise<string | null> {
  if (_rgPathCache !== undefined) return _rgPathCache;

  const isWin = process.platform === 'win32';
  const rgName = isWin ? 'rg.exe' : 'rg';
  const candidates: string[] = [];

  // 1. Env override
  if (process.env.RG_BIN) {
    candidates.push(process.env.RG_BIN);
  }

  // 2. Repo-bundled binary
  // Walk up from this file to find a directory containing tools/bin/rg
  const repoRoot = findRepoRoot(__dirname) ?? process.cwd();
  candidates.push(path.join(repoRoot, 'tools', 'bin', rgName));

  // 3. @vscode/ripgrep npm package
  try {
    // @ts-ignore - optional dependency, may not be installed
    const vscodeRg = await import('@vscode/ripgrep').catch(() => null);
    if (vscodeRg && typeof (vscodeRg as any).rgPath === 'string') {
      candidates.push((vscodeRg as any).rgPath);
    }
  } catch {
    // Not installed — skip
  }

  // 4. System PATH (no full path; rely on PATH lookup)
  candidates.push(rgName);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      _rgPathCache = candidate;
      log.info('Ripgrep binary resolved', { path: candidate });
      return candidate;
    }
  }

  _rgPathCache = null;
  log.debug('Ripgrep binary not found — JS fallback will be used', {
    triedPathCount: candidates.length,
  });
  return null;
}

/** Test/diagnostic helper — clear the binary path cache. */
export function clearRipgrepPathCache(): void {
  _rgPathCache = undefined;
}

/** Cheap probe: returns true if the binary path can be executed. */
async function isExecutable(p: string): Promise<boolean> {
  // For absolute or relative paths, stat first. For PATH-only names,
  // attempt a `--version` spawn (rg returns 0 on `--version`).
  if (p.includes(path.sep) || /[/\\]/.test(p)) {
    try {
      const st = await fs.stat(p);
      return st.isFile();
    } catch {
      return false;
    }
  }
  // Bare name — try executing
  return new Promise<boolean>((resolve) => {
    const child = spawn(p, ['--version'], { stdio: 'ignore', shell: false });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** Walk up from a directory looking for `package.json`, return that directory. */
function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (fsExistsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Tiny sync existence check (no need to require fs.existsSync separately)
function fsExistsSync(p: string): boolean {
  try {
    require('node:fs').accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Search API ─────────────────────────────────────────────────────────────

export interface RipgrepMatch {
  /** Absolute or relative file path (as returned by rg) */
  path: string;
  /** 1-indexed line number */
  line: number;
  /** Matching line contents (no trailing newline) */
  content: string;
  /** Lines before the match (in order, oldest first) */
  contextBefore?: string[];
  /** Lines after the match (in order) */
  contextAfter?: string[];
}

export interface RipgrepOptions {
  /** Pattern. Treated as regex unless `fixedString` is true. */
  query: string;
  /** Root directory to search. Defaults to cwd. */
  path?: string;
  /** Glob filter (e.g., "*.ts", "**/*.{ts,tsx}"). May be repeated as array. */
  glob?: string | string[];
  /** Treat the query as a literal string (no regex). */
  fixedString?: boolean;
  /** Case-insensitive search. */
  caseInsensitive?: boolean;
  /** Match whole words only. */
  wordRegexp?: boolean;
  /** Allow multi-line patterns. */
  multiline?: boolean;
  /** Max results across all files (default 200). */
  maxResults?: number;
  /** Max results per file (default 50). */
  maxCountPerFile?: number;
  /** Lines of context before/after each match (default 0). */
  contextLines?: number;
  /** Hard timeout in ms (default 10_000). */
  timeoutMs?: number;
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  usedRipgrep: boolean;
  truncated: boolean;
  durationMs: number;
}

/**
 * Run a search. Uses ripgrep when available, otherwise a JS fallback.
 */
export async function ripgrepSearch(opts: RipgrepOptions): Promise<RipgrepResult> {
  const start = Date.now();
  const rgPath = await resolveRipgrepPath();
  if (rgPath) {
    try {
      const result = await runRipgrep(rgPath, opts);
      return { ...result, usedRipgrep: true, durationMs: Date.now() - start };
    } catch (err: any) {
      log.warn('Ripgrep execution failed — falling back to JS scan', { error: err.message });
    }
  }
  const fallback = await jsScan(opts);
  return { ...fallback, usedRipgrep: false, durationMs: Date.now() - start };
}

/** Probe whether real ripgrep is available (without running a search). */
export async function isRipgrepAvailable(): Promise<boolean> {
  return (await resolveRipgrepPath()) !== null;
}

// ─── Real ripgrep runner ───────────────────────────────────────────────────

async function runRipgrep(
  rgPath: string,
  opts: RipgrepOptions,
): Promise<{ matches: RipgrepMatch[]; truncated: boolean }> {
  const args: string[] = ['--json', '--no-messages'];
  if (opts.caseInsensitive) args.push('--ignore-case');
  if (opts.wordRegexp) args.push('--word-regexp');
  if (opts.multiline) args.push('--multiline');
  if (opts.fixedString) args.push('--fixed-strings');
  if (opts.contextLines && opts.contextLines > 0) {
    args.push('--context', String(opts.contextLines));
  }
  const maxCountPerFile = opts.maxCountPerFile ?? 50;
  args.push('--max-count', String(maxCountPerFile));
  const globs = Array.isArray(opts.glob) ? opts.glob : opts.glob ? [opts.glob] : [];
  for (const g of globs) {
    args.push('--glob', g);
  }
  args.push('--', opts.query);
  if (opts.path) args.push(opts.path);

  const maxResults = opts.maxResults ?? 200;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const matches: RipgrepMatch[] = [];
    let truncated = false;
    let buffer = '';
    let pendingContext: { before: string[]; line: number; content: string } | null = null;
    const ctxBefore: string[] = [];
    let ctxAfterCount = 0;

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ripgrep timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const lineStr = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!lineStr) continue;
        let event: any;
        try {
          event = JSON.parse(lineStr);
        } catch {
          continue;
        }
        if (event.type === 'match') {
          const data = event.data;
          const filePath = data.path?.text ?? data.path?.bytes ?? '';
          const lineNumber = data.line_number ?? 0;
          const content = (data.lines?.text ?? '').replace(/\r?\n$/, '');
          matches.push({
            path: filePath,
            line: lineNumber,
            content,
            contextBefore: ctxBefore.length > 0 ? [...ctxBefore] : undefined,
          });
          ctxBefore.splice(0, ctxBefore.length);
          if (matches.length >= maxResults) {
            truncated = true;
            child.kill();
            return;
          }
        } else if (event.type === 'context') {
          const data = event.data;
          const content = (data.lines?.text ?? '').replace(/\r?\n$/, '');
          // Attach context-after to the most recent match if applicable
          if (matches.length > 0 && (opts.contextLines ?? 0) > 0) {
            const last = matches[matches.length - 1];
            if (!last.contextAfter) last.contextAfter = [];
            if (last.contextAfter.length < (opts.contextLines ?? 0)) {
              last.contextAfter.push(content);
              continue;
            }
          }
          ctxBefore.push(content);
          if (ctxBefore.length > (opts.contextLines ?? 0)) ctxBefore.shift();
        }
      }
    });

    child.stderr.on('data', () => {
      /* ignored */
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      // rg exit codes: 0 = matches found, 1 = no matches, 2 = error
      if (code === 0 || code === 1 || truncated || code === null) {
        resolve({ matches, truncated });
      } else {
        reject(new Error(`ripgrep exited with code ${code}`));
      }
    });
  });
}

// ─── JS fallback ───────────────────────────────────────────────────────────

const FALLBACK_FILE_LIMIT = 5_000;
const FALLBACK_FILE_SIZE_LIMIT = 1_000_000; // 1MB
const FALLBACK_SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'target',
  '.cache', 'coverage', '.turbo', 'out', '.parcel-cache',
]);

async function jsScan(
  opts: RipgrepOptions,
): Promise<{ matches: RipgrepMatch[]; truncated: boolean }> {
  const root = opts.path ?? process.cwd();
  const matches: RipgrepMatch[] = [];
  const maxResults = opts.maxResults ?? 200;
  const maxCountPerFile = opts.maxCountPerFile ?? 50;
  const ctxN = opts.contextLines ?? 0;
  let truncated = false;

  // Build regex
  const flags = opts.caseInsensitive ? 'i' : '';
  let pattern = opts.fixedString
    ? opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : opts.query;
  if (opts.wordRegexp) pattern = `\\b(?:${pattern})\\b`;
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err: any) {
    throw new Error(`Invalid regex: ${err.message}`);
  }

  // Build glob matchers (very basic — just extension/name suffix support)
  const globs = Array.isArray(opts.glob) ? opts.glob : opts.glob ? [opts.glob] : [];
  const globRegexes = globs.map(globToRegex);

  let filesScanned = 0;

  async function walk(dir: string): Promise<void> {
    if (matches.length >= maxResults || filesScanned >= FALLBACK_FILE_LIMIT) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (FALLBACK_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(full);
      } else if (entry.isFile()) {
        if (globRegexes.length > 0 && !globRegexes.some((r) => r.test(full) || r.test(entry.name))) {
          continue;
        }
        filesScanned++;
        if (filesScanned >= FALLBACK_FILE_LIMIT) {
          truncated = true;
          return;
        }
        try {
          const stat = await fs.stat(full);
          if (stat.size > FALLBACK_FILE_SIZE_LIMIT) continue;
          const content = await fs.readFile(full, 'utf8');
          const lines = content.split(/\r?\n/);
          let perFile = 0;
          for (let i = 0; i < lines.length; i++) {
            if (perFile >= maxCountPerFile) break;
            if (re.test(lines[i])) {
              const before = ctxN > 0 ? lines.slice(Math.max(0, i - ctxN), i) : undefined;
              const after = ctxN > 0 ? lines.slice(i + 1, i + 1 + ctxN) : undefined;
              matches.push({
                path: full,
                line: i + 1,
                content: lines[i],
                contextBefore: before,
                contextAfter: after,
              });
              perFile++;
              if (matches.length >= maxResults) {
                truncated = true;
                return;
              }
            }
          }
        } catch {
          // Binary or unreadable file — skip
        }
      }
    }
  }

  await walk(root);
  return { matches, truncated };
}

/** Convert a basic glob (`*`, `**`, `?`, `{a,b}`) to a regex. */
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/\\\\]*';
    } else if (c === '?') {
      re += '[^/\\\\]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        const parts = glob.slice(i + 1, end).split(',');
        re += '(?:' + parts.map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end + 1;
        continue;
      }
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
    i++;
  }
  return new RegExp(re + '$');
}
