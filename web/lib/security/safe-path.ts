/**
 * VFS Safe-Path Helper
 *
 * Centralised path-sanitisation utilities for the Virtual Filesystem (VFS)
 * and all file-shaped features.  Every `path.resolve`, `path.join`, or
 * `path.normalise` call in the web application should route through this
 * module so that path-traversal hardening lives in ONE place rather than
 * being duplicated (and potentially inconsistent) across call sites.
 *
 * Exports:
 *   - `sanitizePath`      – resolves a user-supplied path against a base
 *                           directory and rejects traversal attempts.
 *   - `safeResolve`        – joins multiple path segments safely, keeping
 *                           the result within the allowed root.
 *   - `validateVfsPrefix`  – confirms that a path starts with one of the
 *                           recognised VFS scope prefixes.
 *
 * All three return the normalised **relative** path (forward slashes) on
 * success and throw a `PathTraversalError` on failure.
 *
 * @see lib/security/security.ts  – sibling module with broader security
 *                                  helpers (secret masking, etc.).
 * @see FIREFOX-WS-PATH-TRAVERSAL-PATH-FIX  – the ticket that introduced
 *                                             this shared module.
 */

import * as nodePath from 'node:path';

// ─── Error type ────────────────────────────────────────────────────────

/** Error thrown when a path fails a traversal or validation check. */
export class PathTraversalError extends Error {
  public readonly path: string;
  public readonly reason: string;

  constructor(path: string, reason: string) {
    super(`Path traversal detected: ${reason} — "${path}"`);
    this.name = 'PathTraversalError';
    this.path = path;
    this.reason = reason;
  }
}

// ─── Defaults ──────────────────────────────────────────────────────────

/**
 * Default allowed VFS scope prefixes.  Every VFS path MUST start with one
 * of these prefixes (or an allowed prefix passed explicitly) to be
 * considered valid.
 *
 * `workspace/`  – the standard workspace root (e.g., "workspace/sessions/001").
 * `sessions/`   – short-form session paths used by some client features.
 */
const DEFAULT_ALLOWED_VFS_PREFIXES = ['workspace/', 'sessions/'] as const;

// ─── Core helpers ──────────────────────────────────────────────────────

/**
 * Resolve `inputPath` relative to `baseDir`, normalise it, and verify that
 * the result stays within `baseDir`.  Returns the normalised **relative**
 * path (forward slashes) so callers don't leak absolute filesystem paths
 * into logs, diffs, or network responses.
 *
 * @param inputPath  – The user-supplied path to sanitise.
 * @param baseDir    – The allowed root directory.  Defaults to `process.cwd()`.
 * @returns          The safe relative path (e.g., `"workspace/sessions/001"`).
 * @throws {PathTraversalError} if the path escapes `baseDir`, contains null
 *         bytes, or resolves to a forbidden location.
 *
 * @example
 * ```ts
 * sanitizePath('workspace/sessions/001/index.html');
 * // → "workspace/sessions/001/index.html"
 *
 * sanitizePath('../../etc/passwd');
 * // → throws PathTraversalError
 * ```
 */
export function sanitizePath(inputPath: string, baseDir: string = process.cwd()): string {
  // --- Guard: null / non-string / empty ---
  if (!inputPath || typeof inputPath !== 'string') {
    throw new PathTraversalError(String(inputPath), 'Path must be a non-empty string');
  }

  // --- Guard: null bytes (CWE-158) ---
  if (inputPath.includes('\0')) {
    throw new PathTraversalError(inputPath, 'Path contains null bytes');
  }

  // --- Resolve to absolute ---
  const resolved = nodePath.resolve(baseDir, inputPath);

  // --- Normalise baseDir with trailing separator to prevent prefix collision ---
  // e.g. "/app/workspace" should NOT match "/app/workspace-extra/file"
  const normalisedBase = nodePath.resolve(baseDir) + nodePath.sep;

  if (!resolved.startsWith(normalisedBase)) {
    throw new PathTraversalError(
      inputPath,
      `Path resolves outside base directory (resolved: ${resolved})`,
    );
  }

  // --- Guard: sensitive directories ---
  const pathParts = resolved.split(nodePath.sep);
  const sensitiveDirs = new Set(['node_modules', '.git', '.env', 'tmp', 'temp']);
  for (const part of pathParts) {
    if (sensitiveDirs.has(part.toLowerCase())) {
      throw new PathTraversalError(inputPath, `Path targets a sensitive directory: "${part}"`);
    }
  }

  // --- Return normalised relative path (forward slashes for cross-platform consistency) ---
  const relative = nodePath.relative(baseDir, resolved).replace(/\\/g, '/');
  return relative || '.';
}

/**
 * Join multiple path segments safely, keeping the result within `rootDir`.
 * Each segment is individually sanitised so that a single malicious segment
 * (`../../etc`) cannot escape the boundary.
 *
 * @param rootDir   – The allowed root directory.
 * @param segments  – One or more path segments to join (e.g. `"workspace"`,
 *                   `"sessions"`, `"001"`).
 * @returns         – The normalised path relative to `rootDir`.
 * @throws {PathTraversalError} if the joined path escapes `rootDir`.
 *
 * @example
 * ```ts
 * safeResolve('/app', 'workspace', 'sessions', '001');
 * // → "workspace/sessions/001"
 *
 * safeResolve('/app', 'workspace', '../../etc/passwd');
 * // → throws PathTraversalError
 * ```
 */
export function safeResolve(rootDir: string, ...segments: string[]): string {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new PathTraversalError(String(rootDir), 'rootDir must be a non-empty string');
  }

  // Guard each segment for null bytes
  for (const seg of segments) {
    if (typeof seg !== 'string') {
      throw new PathTraversalError(String(seg), 'Each segment must be a string');
    }
    if (seg.includes('\0')) {
      throw new PathTraversalError(seg, 'Segment contains null bytes');
    }
  }

  // Build the candidate path
  const candidate = nodePath.resolve(rootDir, ...segments);
  const normalisedRoot = nodePath.resolve(rootDir) + nodePath.sep;

  if (!candidate.startsWith(normalisedRoot)) {
    throw new PathTraversalError(
      segments.join('/'),
      `Resolved path escapes root (resolved: ${candidate})`,
    );
  }

  return nodePath.relative(rootDir, candidate).replace(/\\/g, '/');
}

/**
 * Validate that a VFS path starts with one of the recognised scope prefixes.
 *
 * This is a lightweight check that can be used early in a request handler
 * (before any filesystem I/O) to reject obviously-invalid paths.
 *
 * @param path             – The VFS path to check (e.g. `"workspace/sessions/001"`).
 * @param allowedPrefixes  – Optional list of allowed prefixes.  Defaults to
 *                           `DEFAULT_ALLOWED_VFS_PREFIXES`.
 * @returns `true` if the path starts with an allowed prefix, `false` otherwise.
 *
 * @example
 * ```ts
 * validateVfsPrefix('workspace/sessions/001');
 * // → true
 *
 * validateVfsPrefix('../../etc/passwd');
 * // → false
 *
 * validateVfsPrefix('sessions/', ['workspace/']);
 * // → false  (prefix not in explicit allow-list)
 * ```
 */
export function validateVfsPrefix(
  path: string,
  allowedPrefixes?: readonly string[],
): boolean {
  if (!path || typeof path !== 'string') return false;

  const prefixes = allowedPrefixes ?? DEFAULT_ALLOWED_VFS_PREFIXES;
  return prefixes.some((prefix) => path.startsWith(prefix));
}
