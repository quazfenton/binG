/**
 * Regression tests for Bug #72 wiring in VirtualFilesystemService.
 *
 * Covers:
 *   1. Dead-import removal: `assertScopePathMatchesSessionId` is NO LONGER
 *      imported by `virtual-filesystem-service.ts` (both call sites use the
 *      recovery variant `reconcileScopePathWithSessionId` instead).
 *   2. The `ownerId` rebound pattern at the readFile + writeFile call sites:
 *      `ownerId = reconcileScopePathWithSessionId(ownerId, resolvedFilePath).ownerId;`
 *   3. The call-site payload contract: the wrapper is called with the
 *      original `ownerId` and the `resolvedFilePath` (not the raw `filePath`).
 *
 * The full VirtualFilesystemService class is 2,324 lines with many
 * dependencies (fsBridge, sessionFileTracker, gitBackedVFS, etc.) — testing
 * the full readFile/writeFile methods would require complex mocking. Instead,
 * these tests verify the wiring at the import + call-site level:
 *   - The import structure (assert is gone, reconcile is present)
 *   - The rebound pattern (ownerId is reassigned to the wrapper's output)
 *   - The payload contract (right args at the right call sites)
 *
 * The recovery behavior of `reconcileScopePathWithSessionId` itself is
 * covered exhaustively in `session-path-guard.test.ts` (16 tests covering
 * match / mismatch / root-scope / no-session / `$`-split / empty inputs).
 *
 * See: `session-path-guard.test.ts` for `reconcileScopePathWithSessionId` tests
 * See: `session-path-guard.test.ts` for `assertScopePathMatchesSessionId` tests
 * (the old throw-on-mismatch behavior that was replaced by the recovery variant)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock fsBridge to prevent any real filesystem access
vi.mock('@/lib/filesystem/fs-bridge', () => ({
  fsBridge: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import {
  DETECTION_TERMS,
  withDetectionTerms,
} from '../session-path-guard';

describe('VirtualFilesystemService — Bug #72 wiring (dead-import removal)', () => {
  it('does NOT import assertScopePathMatchesSessionId (replaced by the recovery variant)', () => {
    // Read the VFS service source file and check the imports.
    // Both readFile and writeFile now use `reconcileScopePathWithSessionId`
    // (which recovers from path-drift) instead of `assertScopePathMatchesSessionId`
    // (which throws on mismatch). The assert import is dead and should be removed.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    // The import line should contain reconcileScopePathWithSessionId
    expect(source).toMatch(/import\s*\{[^}]*reconcileScopePathWithSessionId[^}]*\}\s*from\s*['"]\.\/session-path-guard['"]/);

    // The import line should NOT contain assertScopePathMatchesSessionId
    const importLine = source
      .split('\n')
      .find((line) => line.includes("from './session-path-guard'") || line.includes('from "./session-path-guard"'));
    expect(importLine).toBeDefined();
    expect(importLine).not.toMatch(/assertScopePathMatchesSessionId/);
  });

  it('imports DETECTION_TERMS and withDetectionTerms from session-path-guard', () => {
    // The VFS service uses these for the Pass-7 #107 detection-term logging
    // (see session-path-guard.ts). Verify the import is present.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    const importLine = source
      .split('\n')
      .find((line) => line.includes("from './session-path-guard'") || line.includes('from "./session-path-guard"'));
    expect(importLine).toBeDefined();
    expect(importLine).toMatch(/DETECTION_TERMS/);
    expect(importLine).toMatch(/withDetectionTerms/);
  });
});

describe('VirtualFilesystemService — Bug #72 wiring (ownerId rebound pattern)', () => {
  it('readFile call site uses the rebound pattern: ownerId = reconcileScopePathWithSessionId(ownerId, resolvedFilePath).ownerId', () => {
    // The rebound pattern is the key behavior change for #72:
    // instead of throwing on mismatch, the local `ownerId` is reassigned
    // to the scopePath-derived value so the actual VFS read targets the
    // correct session folder.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    // There should be exactly 2 rebound sites (readFile + writeFile)
    const reboundMatches = source.match(/ownerId\s*=\s*reconcileScopePathWithSessionId\(/g);
    expect(reboundMatches).not.toBeNull();
    expect(reboundMatches!.length).toBe(2);
  });

  it('readFile rebound uses resolvedFilePath (NOT raw filePath) as the scopePath arg', () => {
    // The rebound must use `resolvedFilePath` (the scope-resolved path)
    // not the raw `filePath` arg. This ensures the scopePath is normalized
    // before the session id is extracted.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    // Both call sites should pass `resolvedFilePath` as the second arg
    const calls = source.match(/reconcileScopePathWithSessionId\([^)]+\)/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(2);
    for (const call of calls!) {
      expect(call).toMatch(/resolvedFilePath/);
      expect(call).not.toMatch(/filePath(?!\w)/); // not the raw `filePath` (but `filePath` as part of `resolvedFilePath` is OK)
    }
  });

  it('the rebound pattern is inside the method body (not at module scope)', () => {
    // The rebound must be inside the readFile/writeFile method bodies,
    // not at module scope (which would rebind once at import time).
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    // Find the rebound lines and verify they're inside method bodies
    // (heuristic: they're preceded by a line with `let ownerId` or
    // they're inside an `async` method)
    const lines = source.split('\n');
    const reboundLineIndices = lines
      .map((line, i) => (line.match(/ownerId\s*=\s*reconcileScopePathWithSessionId/) ? i : -1))
      .filter((i) => i >= 0);

    expect(reboundLineIndices.length).toBe(2);
    for (const i of reboundLineIndices) {
      // Look backwards for the enclosing method declaration
      const start = Math.max(0, i - 30);
      const context = lines.slice(start, i).join('\n');
      expect(context).toMatch(/async\s+(readFile|writeFile)/);
    }
  });
});

describe('VirtualFilesystemService — Bug #72 wiring (call-site payload contract)', () => {
  it('the rebound returns { ownerId } (not { ownerId, recovered } or other shape)', () => {
    // The production code only uses `.ownerId` from the wrapper's return value.
    // This is by design: the caller rebinds ownerId and continues.
    // The `recovered` flag is available for logging/observability but not
    // used at the call sites.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    const calls = source.match(/reconcileScopePathWithSessionId\([^)]+\)\.ownerId/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(2);
  });

  it('the call sites use the result of the rebound for the actual VFS operation', () => {
    // The whole point of the rebound: the subsequent fsBridge call uses the
    // rebound ownerId, not the original. This is verified by reading the source
    // and confirming that the fsBridge calls come AFTER the rebound (not before).
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    const lines = source.split('\n');
    const reboundIndices = lines
      .map((line, i) => (line.match(/ownerId\s*=\s*reconcileScopePathWithSessionId/) ? i : -1))
      .filter((i) => i >= 0);

    for (const i of reboundIndices) {
      // Look forwards for the fsBridge call (should be within 30 lines)
      const end = Math.min(lines.length, i + 30);
      const afterRebound = lines.slice(i + 1, end).join('\n');
      expect(afterRebound).toMatch(/fsBridge\.(readFile|writeFile)/);
    }
  });
});

describe('VirtualFilesystemService — Bug #72 wiring (DETECTION_TERMS usage)', () => {
  it('uses DETECTION_TERMS.drift and DETECTION_TERMS.mismatch in log messages', () => {
    // The VFS service uses these canonical detection terms for Pass-7 #107
    // observability. Verify the constants are used somewhere in the file.
    const source = readFileSync(
      join(__dirname, '..', 'virtual-filesystem-service.ts'),
      'utf-8',
    );

    // DETECTION_TERMS.drift should appear at least once
    expect(source).toMatch(/DETECTION_TERMS\.drift/);
    // DETECTION_TERMS.mismatch should appear at least once
    expect(source).toMatch(/DETECTION_TERMS\.mismatch/);
  });

  it('exports DETECTION_TERMS and withDetectionTerms from session-path-guard (re-exported for VFS use)', () => {
    // The VFS service imports these from session-path-guard. Verify they
    // are exported from the source module.
    expect(DETECTION_TERMS).toBeDefined();
    expect(DETECTION_TERMS.drift).toBe('drift');
    expect(DETECTION_TERMS.mismatch).toBe('mismatch');
    expect(typeof withDetectionTerms).toBe('function');
  });
});

// NOTE: The "documents" tests (3 in the call-site payload contract block)
// were removed per reviewer feedback — they're redundant with the 16
// exhaustive `reconcileScopePathWithSessionId` tests in
// `session-path-guard.test.ts`. The remaining tests verify the WIRING
// (import structure, rebound pattern, call-site payload contract) not
// the wrapper behavior itself.
