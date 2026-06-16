/**
 * Regression tests for the round-1 fixes in route.ts.
 *
 * Covers:
 *  - A. `preParsedEdits: undefined` (no `as any` cast) — the field is optional
 *       in `applyFilesystemEditsFromResponse`'s signature.
 *  - B. `FilesystemEditSummary` is exported from `./filesystem-edits` and
 *       can be imported as a type in route.ts (the type was previously
 *       `interface` not `export interface`).
 *  - C. `fileEdits` typed as `FilesystemEditSummary[]` in route.ts (no
 *       inline literal that would cause null-deref issues when `applied`
 *       is undefined).
 *  - D. `encoderRef = null` cleanup is safe — the 3 call sites have
 *       null-checks (`if (encoderRef) controller.enqueue(...)`).
 *  - E. Reader null check uses `controller.error()` + `return` (not
 *       `throw new Error(...)` which would crash the stream silently).
 *
 * These are structural/regression tests — they read the source and assert
 * the wiring is correct, so a future refactor that reintroduces the
 * anti-patterns will fail CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROUTE_PATH = join(__dirname, '..', 'route.ts');
const FILESYSTEM_EDITS_PATH = join(__dirname, '..', 'filesystem-edits.ts');

function readSource(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('route.ts — round-1 fixes (preParsedEdits / FilesystemEditSummary / null-checks)', () => {
  // ─── A. preParsedEdits: undefined (no `as any` cast) ────────────────────
  describe('A. preParsedEdits: undefined (no `as any` cast)', () => {
    it('does NOT use `preParsedEdits: undefined as any` anywhere', () => {
      const source = readSource(ROUTE_PATH);
      const matches = source.match(/preParsedEdits:\s*undefined\s+as\s+any/g);
      expect(matches).toBeNull();
    });

    it('uses `preParsedEdits: undefined` (or omits the field) at the 2 V2 sites', () => {
      const source = readSource(ROUTE_PATH);
      // The 2 V2 sites (gateway + local) pass preParsedEdits: undefined
      // Bug #X regression guard: must NOT be followed by `as any` (use
      // a non-word character lookahead instead of \b, which falsely
      // matches the space between `undefined` and `as`).
      const matches = source.match(/preParsedEdits:\s*undefined(?!\s+as\s+any)/g);
      // Allow at least 2 (the 2 V2 sites we fixed); more is fine (other call sites)
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── B. FilesystemEditSummary is exported from filesystem-edits.ts ──────
  describe('B. FilesystemEditSummary is exported from filesystem-edits.ts', () => {
    it('declares `export interface FilesystemEditSummary`', () => {
      const source = readSource(FILESYSTEM_EDITS_PATH);
      expect(source).toMatch(/export\s+interface\s+FilesystemEditSummary\b/);
    });

    it('does NOT declare a non-exported `interface FilesystemEditSummary`', () => {
      const source = readSource(FILESYSTEM_EDITS_PATH);
      // Belt-and-suspenders: no unexported version that would shadow the export
      expect(source).not.toMatch(/^interface\s+FilesystemEditSummary\b/m);
    });

    it('route.ts imports `FilesystemEditSummary` from ./filesystem-edits (any form)', () => {
      const source = readSource(ROUTE_PATH);
      // Bug #X regression guard: accept BOTH `import type { FilesystemEditSummary }`
      // AND `import { type FilesystemEditSummary }` (both are valid TS syntax).
      expect(source).toMatch(
        /import\s+(?:type\s+)?\{[^}]*FilesystemEditSummary[^}]*\}\s+from\s+['"]\.\/filesystem-edits['"]/,
      );
    });
  });

  // ─── C. fileEdits typed as FilesystemEditSummary[] in route.ts ─────────
  describe('C. fileEdits typed as FilesystemEditSummary[] (no inline literal)', () => {
    it('declares `const fileEdits: FilesystemEditSummary[] = allEdits.applied`', () => {
      const source = readSource(ROUTE_PATH);
      expect(source).toMatch(
        /const\s+fileEdits:\s*FilesystemEditSummary\[\]\s*=\s*allEdits\.applied/,
      );
    });

    it('does NOT declare `const fileEdits = allEdits.applied` (untyped)', () => {
      const source = readSource(ROUTE_PATH);
      // The untyped version would be `const fileEdits = allEdits.applied` (no type annotation)
      // We allow the typed version above, but not the untyped one.
      const untypedMatches = source.match(/const\s+fileEdits\s+=\s+allEdits\.applied\b/g);
      expect(untypedMatches).toBeNull();
    });
  });

  // ─── D. encoderRef null-check at all 3 call sites ─────────────────────
  describe('D. encoderRef null-check at all call sites (runtime safety after cleanup)', () => {
    it('all `controller.enqueue(encoderRef.encode(...))` calls are guarded with `if (encoderRef)`', () => {
      const source = readSource(ROUTE_PATH);
      // Bug #X regression guard: count unguarded calls and count of
      // `if (encoderRef)` guards. Guarded guards may be on the same
      // line OR across multiple lines (e.g. `if (encoderRef) {\n  controller.enqueue(...)\n}`).
      // We assert: 0 unguarded AND at least 3 `if (encoderRef)` guards.
      const unguarded = source.match(/controller\.enqueue\(encoderRef\.encode\(/g) || [];
      const guardCount = (source.match(/if\s*\(\s*encoderRef\s*\)/g) || []).length;
      expect(unguarded.length).toBe(0);
      expect(guardCount).toBeGreaterThanOrEqual(3);
    });

    it('encoderRef cleanup is `encoderRef = null` (no cast)', () => {
      const source = readSource(ROUTE_PATH);
      // The cleanup line should be `encoderRef = null;` (no cast)
      // The buggy version was `encoderRef = null as unknown as TextEncoder;`
      expect(source).not.toMatch(/encoderRef\s*=\s*null\s+as\s+unknown\s+as\s+TextEncoder/);
      expect(source).toMatch(/encoderRef\s*=\s*null\s*;/);
    });
  });

  // ─── E. Reader null check uses controller.error() + return ────────────
  describe('E. Reader null check uses controller.error() + return (not throw)', () => {
    it('does NOT use `throw new Error(\'No response body reader available\')`', () => {
      const source = readSource(ROUTE_PATH);
      // The buggy version was `throw new Error('No response body reader available');`
      expect(source).not.toMatch(
        /throw\s+new\s+Error\(['"]No response body reader available['"]\)/,
      );
    });

    it('uses `controller.error(new Error(\'...No response body reader available...\'))`', () => {
      const source = readSource(ROUTE_PATH);
      expect(source).toMatch(
        /controller\.error\(new\s+Error\(['"][^'"]*No response body reader available[^'"]*['"]\)\)/,
      );
    });
  });
});
