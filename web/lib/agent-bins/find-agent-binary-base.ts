/**
 * Agent Binary Detection — Shared Base
 *
 * Generic, OS-aware detection of CLI agent binaries.
 * Used by all agent-specific finders (opencode, pi, codex, amp, claude-code).
 *
 * Detection order:
 * 1. Environment variable override (e.g., OPENCODE_BIN, PI_BIN)
 * 2. OS-specific command detection (max N attempts):
 *    - All platforms: `which <binary>` (works on Windows via Git Bash/MSYS2)
 *    - Windows:       `where <binary>` (native CMD)
 *    - Windows:       `(Get-Command <binary>).Source` (PowerShell)
 *    - Unix:          `type -p <binary>` (bash built-in)
 * 3. Default fallback paths by OS + npm global bin
 *
 * Stops after `maxCommandAttempts` command tries, then checks default paths.
 * Results are cached at the module level per agent type.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '@/lib/utils/logger';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface AgentBinaryConfig {
  /** The agent name (used for logging and env var prefix, e.g. 'opencode', 'pi') */
  name: string;

  /** Environment variable name for explicit override (e.g. 'OPENCODE_BIN') */
  envVar: string;

  /** Binary name on Unix (e.g. 'opencode', 'pi') */
  binName: string;

  /** Binary name on Windows (defaults to `${binName}.exe`) */
  binNameWindows?: string;

  /** Windows npm wrapper name (defaults to `${binName}.cmd`) */
  npmWrapperWindows?: string;

  /** Default install directories relative to $HOME (Unix-style, no leading slash) */
  homeSubdirs?: string[];

  /** Absolute fallback paths for non-Windows (e.g. '/usr/local/bin/opencode') */
  unixPaths?: string[];

  /** Absolute fallback paths for Windows (e.g. '%LOCALAPPDATA%\\opencode\\bin') */
  windowsPaths?: (home: string) => string[];

  /** Max command-based detection attempts (default: 2) */
  maxCommandAttempts?: number;
}

export interface FindBinaryOptions {
  /** Max number of command-based detection attempts (default: 2) */
  maxCommandAttempts?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

/** Normalize path separators to forward slashes for cross-platform consistency. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Join path segments with forward slashes. Used by agent-specific finders for windowsPaths callbacks. */
export function joinPaths(...segments: string[]): string {
  return segments.reduce((acc, seg, i) => {
    if (i === 0) return seg;
    const separator = seg.startsWith('/') || seg.startsWith('\\') ? '' : '/';
    return acc + separator + seg;
  }, '');
}

/** Command timeout — 2s is enough for which/where; 5s is excessive at startup. */
const CMD_TIMEOUT_MS = 2000;

/**
 * Try executing a detection command and return the first line of output
 * if the resulting path exists on disk.
 */
function tryCommand(cmd: string): string | null {
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: CMD_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    if (!result) return null;

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
 */
function buildDetectionCommands(binName: string): string[] {
  const isWindows = process.platform === 'win32';
  const commands: string[] = [];

  commands.push(`which ${binName}`);

  if (isWindows) {
    commands.push(`where ${binName}`);
    commands.push(`powershell -NoProfile -Command "(Get-Command ${binName}).Source"`);
  } else {
    commands.push(`type -p ${binName}`);
  }

  return commands;
}

/**
 * Build the list of default fallback paths for the current OS.
 */
function buildDefaultPaths(config: AgentBinaryConfig, npmPrefix: string | null): string[] {
  const isWindows = process.platform === 'win32';
  const home = homedir();
  const paths: string[] = [];

  const binName = isWindows ? (config.binNameWindows || `${config.binName}.exe`) : config.binName;

  // $HOME subdirs
  for (const subdir of config.homeSubdirs || []) {
    paths.push(normalizePath(join(home, ...subdir.split('/'), binName)));
  }

  // OS-specific absolute paths
  if (isWindows) {
    if (config.windowsPaths) {
      for (const p of config.windowsPaths(home)) {
        paths.push(normalizePath(join(p, binName)));
      }
    }
  } else {
    for (const p of config.unixPaths || []) {
      paths.push(p); // already normalized
    }
  }

  // npm global bin directory
  if (npmPrefix) {
    const npmWrapper = isWindows
      ? normalizePath(join(npmPrefix, config.npmWrapperWindows || `${config.binName}.cmd`))
      : normalizePath(join(npmPrefix, 'bin', config.binName));
    paths.push(npmWrapper);
  }

  return paths;
}

/**
 * Resolve npm prefix (cached per agent type).
 */
function resolveNpmPrefix(): string | null {
  try {
    return execSync('npm config get prefix', {
      encoding: 'utf-8',
      timeout: CMD_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-agent caches
// ────────────────────────────────────────────────────────────────────────────

interface AgentCache {
  binary: string | null | undefined;
  npmPrefix: string | null | undefined;
}

const agentCaches = new Map<string, AgentCache>();

function getCache(name: string): AgentCache {
  let cache = agentCaches.get(name);
  if (!cache) {
    cache = { binary: undefined, npmPrefix: undefined };
    agentCaches.set(name, cache);
  }
  return cache;
}

/**
 * Reset the cache for a specific agent (or all agents). Intended ONLY for test isolation.
 */
export function resetBinaryCacheForTesting(agentName?: string): void {
  if (agentName) {
    const cache = agentCaches.get(agentName);
    if (cache) {
      cache.binary = undefined;
      cache.npmPrefix = undefined;
    }
  } else {
    agentCaches.clear();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Core resolution
// ────────────────────────────────────────────────────────────────────────────

function resolveBinaryPath(config: AgentBinaryConfig, maxCommandAttempts: number): string | null {
  const logger = createLogger(`Find${capitalize(config.name)}Binary`);

  // Step 1: Env var override
  const envValue = process.env[config.envVar];
  if (envValue) {
    logger.info(`Using ${config.envVar}=${envValue}`);
    return normalizePath(envValue);
  }

  // Step 2: Command-based detection
  const commands = buildDetectionCommands(config.binName);
  let attempts = 0;

  for (const cmd of commands) {
    if (attempts >= maxCommandAttempts) break;
    attempts++;

    logger.info(`Attempt ${attempts}/${maxCommandAttempts}: ${cmd}`);
    const found = tryCommand(cmd);
    if (found) {
      logger.info(`Found at: ${found}`);
      return found;
    }
  }

  // Step 3: Default fallback paths (with cached npm prefix)
  const cache = getCache(config.name);
  if (cache.npmPrefix === undefined) {
    cache.npmPrefix = resolveNpmPrefix();
  }

  const defaultPaths = buildDefaultPaths(config, cache.npmPrefix);

  for (const fallbackPath of defaultPaths) {
    logger.info(`Checking default path: ${fallbackPath}`);
    if (existsSync(fallbackPath)) {
      logger.info(`Found at default path: ${fallbackPath}`);
      return fallbackPath;
    }
  }

  logger.warn(`${config.name} binary not found in any location`);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create async and sync binary finder functions for a specific agent.
 *
 * Returns `{ findBinary, findBinarySync }` with module-level caching
 * and env-var bypass, identical to the opencode finder pattern.
 */
export function createBinaryFinders(config: AgentBinaryConfig) {
  const cache = getCache(config.name);
  const defaultMaxAttempts = config.maxCommandAttempts ?? 2;

  async function findBinary(options?: FindBinaryOptions): Promise<string | null> {
    if (process.env[config.envVar]) {
      return normalizePath(process.env[config.envVar]!);
    }
    if (cache.binary !== undefined) return cache.binary;

    const maxAttempts = options?.maxCommandAttempts ?? defaultMaxAttempts;
    const result = resolveBinaryPath(config, maxAttempts);
    cache.binary = result;
    return result;
  }

  function findBinarySync(options?: FindBinaryOptions): string | null {
    if (process.env[config.envVar]) {
      return normalizePath(process.env[config.envVar]!);
    }
    if (cache.binary !== undefined) return cache.binary;

    const maxAttempts = options?.maxCommandAttempts ?? defaultMaxAttempts;
    const result = resolveBinaryPath(config, maxAttempts);
    cache.binary = result;
    return result;
  }

  return { findBinary, findBinarySync };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
