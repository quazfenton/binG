// Server-only module - do not import directly in Client Components
export const runtime = 'nodejs';

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface RipgrepMatch {
  type: 'match';
  path: string;
  lineNumber: number;
  line: number; // Alias for lineNumber for backward compatibility
  content: string; // Line content alias
  lines: string;
  absoluteOffset: number;
  submatches?: { match: string; start: number; end: number }[];
  contextBefore?: string[]; // Lines before the match (for contextLines option)
  contextAfter?: string[]; // Lines after the match (for contextLines option)
}

export interface RipgrepResult {
  matches: RipgrepMatch[];
  stats: {
    searches: number;
    matches: number;
    filesWithMatches: number;
    filesSearched: number;
    elapsedMs: number;
  };
  errors: string[];
  usedRipgrep: boolean; // Indicates whether real ripgrep was used vs JS fallback
}

export interface RipgrepOptions {
  query: string;
  path?: string;
  glob?: string | string[];
  fixedString?: boolean;
  caseInsensitive?: boolean;
  wordRegexp?: boolean;
  follow?: boolean;
  maxResults?: number;
  maxCountPerFile?: number;
  contextLines?: number;
  timeoutMs?: number;
}

// Path caching for ripgrep binary
let cachedRgBin: string | null = null;

/**
 * Clear the ripgrep binary path cache.
 * Useful for tests that need to reset the path.
 */
export function clearRipgrepPathCache(): void {
  cachedRgBin = null;
}

/**
 * Check if ripgrep binary is available (cached check).
 */
export function isRipgrepAvailable(): boolean {
  return getRgBin() !== null;
}

/**
 * Resolve ripgrep binary path (cached).
 * @deprecated Use getRgBin() directly for explicit path checking
 */
export function resolveRipgrepPath(): string | null {
  return getRgBin();
}

function getRgBin(): string | null {
  if (cachedRgBin !== null) return cachedRgBin;
  if (process.env.RG_BIN) {
    cachedRgBin = process.env.RG_BIN;
    return cachedRgBin;
  }
  // Use __dirname equivalent for CommonJS or process.cwd() fallback
  const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const binDir = path.join(baseDir, '..', '..', 'tools', 'bin');
  
  // Determine the correct binary name based on platform
  let binaryName: string;
  if (process.platform === 'win32') {
    binaryName = 'rg.exe';
  } else if (process.platform === 'darwin') {
    binaryName = 'rg-macos';
  } else {
    // Linux and other Unix-like systems
    binaryName = 'rg-linux';
  }
  
  const candidates = [
    path.join(binDir, binaryName),
    path.join(binDir, 'ripgrep', 'rg'),
    path.join(binDir, process.platform === 'win32' ? 'rg.exe' : 'rg'),
  ];
  for (const candidate of candidates) {
    try { 
      fs.accessSync(candidate, fs.constants.F_OK);
      // Make executable on Unix systems
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(candidate, 0o755);
        } catch {}
      }
      cachedRgBin = candidate; 
      return cachedRgBin; 
    } catch {}
  }
  // Fall back to system rg
  cachedRgBin = 'rg';
  return cachedRgBin;
}

function buildArgs(opts: RipgrepOptions, cwd: string): string[] {
  const args: string[] = [];
  if (opts.fixedString) args.push('-F');
  if (opts.caseInsensitive) args.push('-i');
  if (opts.wordRegexp) args.push('-w');
  if (opts.follow) args.push('-L');
  if (opts.contextLines && opts.contextLines > 0) {
    args.push(`-${'B'.repeat(opts.contextLines)}`, `-${'A'.repeat(opts.contextLines)}`);
  }
  args.push('--json');
  if (opts.maxCountPerFile !== undefined) args.push('--max-count', String(opts.maxCountPerFile));
  if (opts.glob) {
    const globs = Array.isArray(opts.glob) ? opts.glob : [opts.glob];
    for (const g of globs) args.push('--glob', g);
  }
  if (opts.maxResults !== undefined) args.push('--limit', String(opts.maxResults));
  args.push('--timeout', String(opts.timeoutMs ?? 10000));
  args.push(opts.query);
  args.push(opts.path ?? cwd);
  return args;
}

interface RgJsonLine {
  type: string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    absolute_offset?: number;
    submatches?: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

async function runRipgrep(opts: RipgrepOptions, cwd: string): Promise<RipgrepResult> {
  const rgBin = getRgBin();
  if (!rgBin) return { matches: [], stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: 0 }, errors: ['Ripgrep binary not found'], usedRipgrep: false };
  const startTime = Date.now();
  const args = buildArgs(opts, cwd);
  return new Promise((resolve) => {
    const proc = spawn(rgBin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const errors: string[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); errors.push('Ripgrep timed out'); }, opts.timeoutMs ?? 10000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;
      if (code !== 0 && code !== null && code !== 1) errors.push(stderr || 'Ripgrep error');
      const matches: RipgrepMatch[] = [];
      let filesWithMatches = 0, filesSearched = 0;
      for (const line of stdout.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as RgJsonLine;
          if (parsed.type === 'match' && parsed.data) {
            const match: RipgrepMatch = {
              type: 'match',
              path: parsed.data.path?.text ?? '',
              lines: parsed.data.lines?.text ?? '',
              lineNumber: parsed.data.line_number ?? 0,
              line: parsed.data.line_number ?? 0, // Backward compat alias
              content: parsed.data.lines?.text ?? '', // Backward compat alias
              absoluteOffset: parsed.data.absolute_offset ?? 0,
            };
            if (parsed.data.submatches) match.submatches = parsed.data.submatches.map(s => ({ match: s.match.text, start: s.start, end: s.end }));
            matches.push(match);
          } else if (parsed.type === 'begin' || parsed.type === 'end') {
            filesSearched++;
          }
        } catch {}
      }
      const uniquePaths = new Set(matches.map(m => m.path));
      filesWithMatches = uniquePaths.size;
      resolve({ matches, stats: { searches: 1, matches: matches.length, filesWithMatches, filesSearched, elapsedMs }, errors, usedRipgrep: rgBin !== null && code !== null && code !== 1 });
    });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ matches: [], stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: Date.now() - startTime }, errors: [err.message], usedRipgrep: false }); });
  });
}

/**
 * Convert a basic glob (`*`, `**`, `?`, `{a,b}`) to a regex. Used by the JS
 * fallback to filter files when `opts.glob` is provided. Real ripgrep handles
 * globs natively via `--glob`.
 */
function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 2; continue; }
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

async function runJsSearch(opts: RipgrepOptions, cwd: string): Promise<RipgrepResult> {
  // Bug fix: when opts.path is absolute, path.join(cwd, opts.path) produces
  // garbage on Windows ("c:\repo\c:\Temp\x") and on POSIX produces a doubled
  // path ("/repo//tmp/x"). Use the absolute path as-is when provided.
  const searchPath = opts.path
    ? (path.isAbsolute(opts.path) ? opts.path : path.join(cwd, opts.path))
    : cwd;
  const maxResults = opts.maxResults ?? 100;
  const contextLines = opts.contextLines ?? 0;
  const matches: RipgrepMatch[] = [];
  async function walkDir(dir: string): Promise<string[]> {
    const files: string[] = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walkDir(fullPath)));
        else if (entry.isFile()) files.push(fullPath);
      }
    } catch {}
    return files;
  }
  const flags = opts.caseInsensitive ? 'i' : '';
  let pattern = opts.query;
  if (opts.fixedString) {
    // Escape special regex chars for literal string matching
    // Character class needs ] escaped as \] and \ escaped as \\
    const escapeRegex = /[.*+?^${}()|[\]\\]/g;
    pattern = pattern.replace(escapeRegex, '\\$&');
  }
  if (opts.wordRegexp) pattern = `\\b(?:${pattern})\\b`;
  let re: RegExp;
  try { re = new RegExp(pattern, flags); } catch { return { matches: [], stats: { searches: 0, matches: 0, filesWithMatches: 0, filesSearched: 0, elapsedMs: 0 }, errors: ['Invalid regex'], usedRipgrep: false }; }
  const startTime = Date.now();
  let filesSearched = 0;
  async function searchFile(filePath: string): Promise<void> {
    if (matches.length >= maxResults) return;
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      filesSearched++;
      const lines = content.split('\n');
      let offset = 0;
      let fileMatches = 0;
      const maxPerFile = opts.maxCountPerFile ?? 50;
      for (let i = 0; i < lines.length; i++) {
        if (fileMatches >= maxPerFile || matches.length >= maxResults) break;
        const line = lines[i];
        if (re.test(line)) {
          const match: RipgrepMatch = {
            type: 'match',
            path: path.relative(cwd, filePath),
            lines: line,
            lineNumber: i + 1,
            line: i + 1, // Backward compat alias
            content: line, // Backward compat alias
            absoluteOffset: offset,
          };
          
          // Add context lines if requested
          if (contextLines > 0) {
            match.contextBefore = lines.slice(Math.max(0, i - contextLines), i);
            match.contextAfter = lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines));
          }
          
          matches.push(match);
          fileMatches++;
        }
        offset += Buffer.byteLength(line, 'utf8') + 1;
      }
    } catch {}
  }
  try {
    const allFiles = await walkDir(searchPath);
    // Apply glob filtering (the JS fallback didn't honor opts.glob originally).
    // Real ripgrep handles globs natively via --glob; this brings the fallback
    // into rough parity for common patterns ("*.ts", "**/*.{ts,tsx}", etc.).
    const globs = opts.glob
      ? (Array.isArray(opts.glob) ? opts.glob : [opts.glob])
      : [];
    const globRegexes = globs.map(globToRegex);
    const files = globRegexes.length === 0
      ? allFiles
      : allFiles.filter((f) => {
          const base = path.basename(f);
          // Match against either the full path or just the base name so that
          // both "*.txt" and "src/**/*.ts" patterns work.
          return globRegexes.some((r) => r.test(f) || r.test(base));
        });
    for (const file of files) { if (matches.length >= maxResults) break; await searchFile(file); }
  } catch {}
  const uniquePaths = new Set(matches.map(m => m.path));
  return { matches, stats: { searches: 1, matches: matches.length, filesWithMatches: uniquePaths.size, filesSearched, elapsedMs: Date.now() - startTime }, errors: [], usedRipgrep: false };
}

export async function ripgrep(opts: RipgrepOptions): Promise<RipgrepResult> {
  const cwd = opts.path ?? process.cwd();
  const rgResult = await runRipgrep(opts, cwd);
  
  // If ripgrep had errors and no matches, fall back to JS search
  if (rgResult.errors.length > 0 && rgResult.matches.length === 0) {
    const jsResult = await runJsSearch(opts, cwd);
    return { ...jsResult, usedRipgrep: false };
  }
  
  return rgResult;
}

// Backward compatibility alias
export const ripgrepSearch = ripgrep;