/**
 * Tests for the VFS Safe-Path Helper (safe-path.ts)
 *
 * Covers:
 *   - sanitizePath: normal paths, traversal, null bytes, sensitive dirs
 *   - safeResolve: normal join, traversal prevention
 *   - validateVfsPrefix: allowed list, custom list, edge cases
 *   - PathTraversalError: shape and properties
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizePath,
  safeResolve,
  validateVfsPrefix,
  PathTraversalError,
} from '../safe-path';

// Use a fixed base dir that won't exist on the test runner so tests are
// deterministic regardless of which CWD the test suite runs from.
const TEST_BASE = '/app/workspace';

// ─── PathTraversalError ────────────────────────────────────────────────

describe('PathTraversalError', () => {
  it('constructs with correct name, path, reason, and message', () => {
    const err = new PathTraversalError('../../etc/passwd', 'escapes base directory');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PathTraversalError');
    expect(err.path).toBe('../../etc/passwd');
    expect(err.reason).toBe('escapes base directory');
    expect(err.message).toContain('../../etc/passwd');
    expect(err.message).toContain('escapes base directory');
  });
});

// ─── sanitizePath ──────────────────────────────────────────────────────

describe('sanitizePath', () => {
  it('returns normalised relative path for a simple subpath', () => {
    const result = sanitizePath('workspace/sessions/001', TEST_BASE);
    expect(result).toBe('workspace/sessions/001');
  });

  it('returns normalised relative path for a file within subpath', () => {
    const result = sanitizePath('workspace/sessions/001/index.html', TEST_BASE);
    expect(result).toBe('workspace/sessions/001/index.html');
  });

  it('resolves a single-component path correctly', () => {
    const result = sanitizePath('sessions', TEST_BASE);
    expect(result).toBe('sessions');
  });

  it('rejects absolute paths that escape baseDir', () => {
    // Leading `/` makes path.resolve treat the second argument as absolute,
    // returning /workspace/sessions/001 which is NOT under /app/workspace.
    expect(() => sanitizePath('/workspace/sessions/001', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for upward traversal (../)', () => {
    expect(() => sanitizePath('../../etc/passwd', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for complex traversal (a/../../../etc)', () => {
    expect(() => sanitizePath('a/../../../etc/hosts', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for absolute path targeting different root', () => {
    expect(() => sanitizePath('/etc/passwd', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for null bytes in path', () => {
    expect(() => sanitizePath('workspace/\0malicious', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for empty string', () => {
    expect(() => sanitizePath('', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for non-string input', () => {
    expect(() => sanitizePath(null as any, TEST_BASE)).toThrow(PathTraversalError);
    expect(() => sanitizePath(undefined as any, TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for node_modules directory', () => {
    expect(() => sanitizePath('node_modules/package/index.js', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for .git directory', () => {
    expect(() => sanitizePath('.git/config', TEST_BASE)).toThrow(PathTraversalError);
  });

  it('allows paths with dots that are not traversal', () => {
    const result = sanitizePath('workspace/sessions/001/file.test.ts', TEST_BASE);
    expect(result).toBe('workspace/sessions/001/file.test.ts');
  });

  it('uses process.cwd() when no baseDir is provided', () => {
    // Should not throw for a safe relative path
    const result = sanitizePath('workspace/test');
    // Relative to actual cwd — just verify it doesn't throw
    expect(typeof result).toBe('string');
  });
});

// ─── safeResolve ───────────────────────────────────────────────────────

describe('safeResolve', () => {
  it('joins segments within root', () => {
    const result = safeResolve(TEST_BASE, 'workspace', 'sessions', '001');
    expect(result).toBe('workspace/sessions/001');
  });

  it('handles single segment', () => {
    const result = safeResolve(TEST_BASE, 'workspace');
    expect(result).toBe('workspace');
  });

  it('throws PathTraversalError when segments escape root', () => {
    expect(() => safeResolve(TEST_BASE, 'workspace', '../../etc')).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for deeply nested traversal', () => {
    expect(() =>
      safeResolve(TEST_BASE, 'a', 'b', 'c', 'd', '..', '..', '..', '..', '..', 'etc'),
    ).toThrow(PathTraversalError);
  });

  it('rejects segments with null bytes', () => {
    expect(() => safeResolve(TEST_BASE, 'safe', '\0malicious')).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for empty rootDir', () => {
    expect(() => safeResolve('', 'workspace')).toThrow(PathTraversalError);
  });

  it('throws PathTraversalError for non-string segment', () => {
    expect(() => safeResolve(TEST_BASE, 'workspace', 123 as any)).toThrow(PathTraversalError);
  });
});

// ─── validateVfsPrefix ─────────────────────────────────────────────────

describe('validateVfsPrefix', () => {
  it('returns true for default workspace/ prefix', () => {
    expect(validateVfsPrefix('workspace/sessions/001')).toBe(true);
  });

  it('returns true for default sessions/ prefix', () => {
    expect(validateVfsPrefix('sessions/001/index.html')).toBe(true);
  });

  it('returns true for exact prefix match', () => {
    expect(validateVfsPrefix('workspace/')).toBe(true);
  });

  it('returns false for traversal paths', () => {
    expect(validateVfsPrefix('../../etc/passwd')).toBe(false);
  });

  it('returns false for absolute paths', () => {
    expect(validateVfsPrefix('/etc/passwd')).toBe(false);
  });

  it('returns false for paths with no recognised prefix', () => {
    expect(validateVfsPrefix('temp/foo')).toBe(false);
    expect(validateVfsPrefix('downloads/bar')).toBe(false);
  });

  it('respects a custom allowed-prefixes list', () => {
    const customPrefixes = ['projects/', 'plugins/'] as const;
    expect(validateVfsPrefix('projects/my-app', customPrefixes)).toBe(true);
    expect(validateVfsPrefix('plugins/editor', customPrefixes)).toBe(true);
    expect(validateVfsPrefix('workspace/sessions/001', customPrefixes)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateVfsPrefix('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(validateVfsPrefix(null as any)).toBe(false);
    expect(validateVfsPrefix(undefined as any)).toBe(false);
  });
});
