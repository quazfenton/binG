/**
 * OpenCode Binary Detection
 *
 * Robust, OS-aware detection of the `opencode` CLI binary.
 *
 * Detection order:
 * 1. OPENCODE_BIN env var (explicit override)
 * 2. OS-specific command detection (max 2 attempts, no loops):
 *    - All platforms: `which opencode` (works on Windows via Git Bash/MSYS2)
 *    - Windows:       `where opencode` (native CMD)
 *    - Windows:       `(Get-Command opencode).Source` (PowerShell)
 *    - Unix:          `type -p opencode` (bash built-in, more reliable)
 * 3. Default fallback paths by OS:
 *    - Cross-platform: $HOME/.opencode/bin/opencode
 *    - Linux/macOS:    /usr/local/bin/opencode (curl script install)
 *    - Windows:        %LOCALAPPDATA%\opencode\bin\opencode.exe
 *    - npm global:     $(npm config get prefix)/bin/opencode
 *
 * Stops after 2 command attempts and then checks default paths.
 * Returns null if the binary is not found anywhere.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('FindOpencodeBinary');

/** Normalize path separators to forward slashes.
 *  Node.js accepts forward slashes on all platforms (Windows included),
 *  and this keeps paths consistent regardless of the host OS. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Command timeout — 2s is enough for which/where; 5s is excessive at startup. */
const CMD_TIMEOUT_MS = 2000;

export interface FindBinaryOptions {
  /** Max number of command-based detection attempts (default: 2) */
  maxCommandAttempts?: number;
}

/**
 * Try executing a detection command and return the first line of output
 * if the resulting path exists on disk.
 */
function tryCommand(cmd: string): string | null {
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: CMD_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'ignore'], // suppress stderr
    }).trim();

    if (!result) return null;

    // `which` / `where` may return multiple lines — take the first
    const rawPath = result.split('\n')[0].trim();
    if (rawPath && existsSync(rawPath)) {
      return normalizePath(rawPath);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the ordered list of detection commands for the current OS.
 *
 * `which` is placed first because it works on ALL platforms:
 * - Native on Linux/macOS
 * - Available on Windows via Git Bash, MSYS2, or WSL
 *
 * After that, platform-specific alternatives are appended.
 */
function buildDetectionCommands(): string[] {
  const isWindows = process.platform === 'win32';
  const commands: string[] = [];

  // 1. `which` — works everywhere (Linux, macOS, and Windows with Git Bash)
  commands.push('which opencode');

  if (isWindows) {
    // 2. `where` — native Windows CMD locator
    commands.push('where opencode');
    // 3. PowerShell — (Get-Command opencode).Source
    commands.push('powershell -NoProfile -Command "(Get-Command opencode).Source"');
  } else {
    // 2. `type -p` — bash built-in, more reliable than `which` in some shells
    commands.push('type -p opencode');
  }

  return commands;
}

// ---- Module-level caches (declared before buildDefaultPaths for readability) ----

/**
 * Cached npm prefix — avoids repeated `execSync('npm config get prefix')`
 * which adds up to 2s of blocking on every call.
 *
 * - `undefined` = not yet computed
 * - `string`     = resolved prefix path
 * - `null`       = npm not available or failed
 */
let _cachedNpmPrefix: string | null | undefined = undefined;

/**
 * Module-level cache for the resolved binary path.
 * Once found (or confirmed absent), the result is reused on subsequent
 * calls to avoid repeated execSync/existsSync overhead.
 *
 * - `undefined` = not yet computed
 * - `string`     = resolved path
 * - `null`       = binary not found
 */
let _cachedBinary: string | null | undefined = undefined;

/**
 * Reset the binary and npm prefix caches. Intended ONLY for test isolation.
 */
export function resetBinaryCacheForTesting(): void {
  _cachedBinary = undefined;
  _cachedNpmPrefix = undefined;
}

/**
 * Build the list of default fallback paths for the current OS.
 *
 * These are checked *after* command-based detection fails.
 */
function buildDefaultPaths(): string[] {
  const isWindows = process.platform === 'win32';
  const home = homedir();
  const paths: string[] = [];

  // Cross-platform: $HOME/.opencode/bin/opencode
  const binName = isWindows ? 'opencode.exe' : 'opencode';
  paths.push(normalizePath(join(home, '.opencode', 'bin', binName)));

  if (isWindows) {
    // Windows: %LOCALAPPDATA%\opencode\bin\opencode.exe
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    paths.push(normalizePath(join(localAppData, 'opencode', 'bin', 'opencode.exe')));
  } else {
    // Linux/macOS: /usr/local/bin/opencode (curl script install)
    paths.push('/usr/local/bin/opencode'); // already normalized
  }

  // npm global bin directory (cached — only runs execSync once)
  if (_cachedNpmPrefix === undefined) {
    try {
      _cachedNpmPrefix = execSync('npm config get prefix', {
        encoding: 'utf-8',
        timeout: CMD_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim() || null;
    } catch {
      _cachedNpmPrefix = null; // npm not available
    }
  }

  if (_cachedNpmPrefix) {
    const npmBin = isWindows
      ? normalizePath(join(_cachedNpmPrefix, 'opencode.cmd'))   // Windows npm uses .cmd wrappers
      : normalizePath(join(_cachedNpmPrefix, 'bin', 'opencode')); // Unix npm puts bins in prefix/bin/
    paths.push(npmBin);
  }

  return paths;
}

/**
 * Internal: resolve the binary path without caching (used by both async and sync variants).
 */
function resolveBinaryPath(maxCommandAttempts: number): string | null {
  // ── Step 1: Explicit env var override ──────────────────────────────
  if (process.env.OPENCODE_BIN) {
    logger.info('[findOpencodeBinary] Using OPENCODE_BIN=' + process.env.OPENCODE_BIN);
    return normalizePath(process.env.OPENCODE_BIN);
  }

  // ── Step 2: Command-based detection (max N attempts) ────────────────
  const commands = buildDetectionCommands();
  let attempts = 0;

  for (const cmd of commands) {
    if (attempts >= maxCommandAttempts) break;
    attempts++;

    logger.info(`[findOpencodeBinary] Attempt ${attempts}/${maxCommandAttempts}: ${cmd}`);
    const found = tryCommand(cmd);
    if (found) {
      logger.info(`[findOpencodeBinary] Found at: ${found}`);
      return found;
    }
  }

  // ── Step 3: Default fallback paths ─────────────────────────────────
  const defaultPaths = buildDefaultPaths();

  for (const fallbackPath of defaultPaths) {
    logger.info(`[findOpencodeBinary] Checking default path: ${fallbackPath}`);
    if (existsSync(fallbackPath)) {
      logger.info(`[findOpencodeBinary] Found at default path: ${fallbackPath}`);
      return fallbackPath;
    }
  }

  logger.warn('[findOpencodeBinary] Binary not found in any location');
  return null;
}

/**
 * Find the opencode binary path with robust OS-aware detection.
 *
 * @returns Absolute path to the opencode binary, or null if not found.
 *
 * Detection stops after `maxCommandAttempts` command-based tries (default 2),
 * then checks a fixed list of default install paths, then returns null.
 * No loops, no retries, no endless waiting.
 *
 * Results are cached after the first call (per non-env-var path).
 * OPENCODE_BIN always bypasses the cache since it's an explicit override.
 */
export async function findOpencodeBinary(options?: FindBinaryOptions): Promise<string | null> {
  // Env var always bypasses cache
  if (process.env.OPENCODE_BIN) {
    return normalizePath(process.env.OPENCODE_BIN);
  }

  if (_cachedBinary !== undefined) return _cachedBinary;

  const maxAttempts = options?.maxCommandAttempts ?? 2;
  const result = resolveBinaryPath(maxAttempts);
  _cachedBinary = result;
  return result;
}

/**
 * Synchronous variant for use in contexts where async is not possible
 * (e.g., module-level initialization, constructor-time checks).
 *
 * Same detection logic as findOpencodeBinary but uses execSync throughout.
 * Results are cached after the first call.
 */
export function findOpencodeBinarySync(options?: FindBinaryOptions): string | null {
  // Env var always bypasses cache
  if (process.env.OPENCODE_BIN) {
    return normalizePath(process.env.OPENCODE_BIN);
  }

  if (_cachedBinary !== undefined) return _cachedBinary;

  const maxAttempts = options?.maxCommandAttempts ?? 2;
  const result = resolveBinaryPath(maxAttempts);
  _cachedBinary = result;
  return result;
}
