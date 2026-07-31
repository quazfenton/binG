/**
 * Regression test for Bug 1 fix: ROOT_READ_WHITELIST in resolveScopedPath
 * (2026-07-22).
 *
 * Closes the VFS session path normalization bug from
 * /opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md. The LLM treats the
 * workspace root as a flat filesystem and tries to read configuration files
 * directly (`package.json`, `tsconfig.json`, `README.md`); without the
 * whitelist, the rejection forces a `list_files("/")` round-trip before the
 * LLM can read these.
 *
 * Test cases:
 *  - whitelisted bare basenames → synthesized at `workspace/<file>` (NOT session-scoped)
 *  - non-whitelisted bare basenames → default `${scope}/<file>` synthesis (preserves Bug-1 evidence)
 *  - subpaths (`lib/file.ts`) → default `${scope}/<path>`
 *  - already-qualified `workspace/other-project/<file>` paths → throws (security guard,
 *    bypasses normalizeLLMPath strip-pattern)
 *  - `../package.json` → still throws (rejectTraversal: true)
 *  - empty / '.' / '../' inputs → return scope unchanged
 *  - regression guard: iterate the exported ROOT_READ_WHITELIST const to lock
 *    the public semantic — future maintainers who expand the const get a clear
 *    pointing test failure instead of silent behavior drift.
 *
 * Reference: see /opt/bing/docs/CENTRALIZED_TODO_LIST.md (cross-bug unification narrative).
 */

import { describe, it, expect } from 'vitest';

import { resolveScopedPath, ROOT_READ_WHITELIST } from '../../lib/virtual-filesystem/scope-utils';

const SESSION_SCOPE = 'workspace/sessions/001';
const NESTED_SUBDIR_SCOPE = 'workspace/sessions/abc/sub';

describe('resolveScopedPath — Bug 1 ROOT_READ_WHITELIST (2026-07-22)', () => {
  describe('whitelisted bare basenames → synthesized at workspace root', () => {
    it.each([
      ['package.json'],
      ['tsconfig.json'],
      ['README.md'],
    ])('synthesizes %s at workspace root (NOT session-scoped) when a session scope is provided', (filename) => {
      const result = resolveScopedPath(filename, SESSION_SCOPE);
      // Synthesized at workspace root — NOT inside session scope
      expect(result).toBe(`workspace/${filename}`);
      // Verify it did NOT leak into session scope
      expect(result).not.toContain(SESSION_SCOPE);
      // Verify it did NOT use the default ${scope}/${relative} fallback
      expect(result).not.toBe(`${SESSION_SCOPE}/${filename}`);
    });

    it('synthesizes package.json at workspace root when scopePath is the default-fallback scope', () => {
      const result = resolveScopedPath('package.json', 'workspace/sessions/000');
      expect(result).toBe('workspace/package.json');
    });

    it('synthesizes tsconfig.json when a nested subdir scope is provided', () => {
      const result = resolveScopedPath('tsconfig.json', NESTED_SUBDIR_SCOPE);
      expect(result).toBe('workspace/tsconfig.json');
    });
  });

  describe('non-whitelisted bare basenames → default session-scoped synthesis (preserves Bug-1 evidence)', () => {
    it.each([
      ['NOTES.md'],
      ['agent.js'],
      ['secret.txt'],
    ])('rejects non-whitelisted bare %s via default ${scope}/${relative} path', (filename) => {
      const result = resolveScopedPath(filename, SESSION_SCOPE);
      // Default synthesis — Bug 1 evidence: this gave the LLM the out-of-scope
      // rejection that triggered the cascade. Whitelist does NOT cover these.
      expect(result).toBe(`${SESSION_SCOPE}/${filename}`);
    });
  });

  describe('subpaths → default session-scoped synthesis (no regression)', () => {
    it('preserves existing behavior for lib/file.ts', () => {
      const result = resolveScopedPath('lib/file.ts', SESSION_SCOPE);
      expect(result).toBe(`${SESSION_SCOPE}/lib/file.ts`);
    });

    it('preserves existing behavior for deeply nested src/components/Button.tsx', () => {
      const result = resolveScopedPath('src/components/Button.tsx', SESSION_SCOPE);
      expect(result).toBe(`${SESSION_SCOPE}/src/components/Button.tsx`);
    });
  });

  describe('already-qualified workspace/ paths → scope containment validation (security preserved)', () => {
    it('accepts workspace/sessions/001/lib/file.ts inside matching scope', () => {
      const result = resolveScopedPath('workspace/sessions/001/lib/file.ts', SESSION_SCOPE);
      expect(result).toBe('workspace/sessions/001/lib/file.ts');
    });

    it('rejects workspace/other-project/something.ts outside the requested scope', () => {
      // Note: normalizeLLMPath strips `workspace/sessions/{id}/` prefix at L145-L148
      // in path-normalizer.ts, so a workspace/sessions/{different-id}/... input would
      // survive to the LLM as just `<basename>` (caught by the default branch — Bug 1
      // evidence path). To exercise the actual scope-escape throw branch at L114 in
      // scope-utils.ts, we must use a workspace/ path that normalizeLLMPath does NOT
      // strip — e.g., workspace/other-project/something.ts (not matching
      // `^workspace/sessions/[^/]+/.+$`).
      expect(() => {
        resolveScopedPath('workspace/other-project/something.ts', SESSION_SCOPE);
      }).toThrow(/outside the allowed scope/);
    });

    it('rejects workspace/package.json as scope escape (workspace/-prefixed paths are NOT under whitelist — only bare basenames are)', () => {
      // The whitelist only matches bare top-level filenames — workspace/-prefixed
      // paths go through the security guard at L110-L114 in scope-utils.ts.
      // (workspace/package.json doesn't match any normalizeLLMPath strip-pattern,
      // so it survives as `workspace/package.json` → caught by throw.)
      expect(() => {
        resolveScopedPath('workspace/package.json', SESSION_SCOPE);
      }).toThrow(/outside the allowed scope/);
    });
  });

  describe('reject-traversal security preserved (CVE regression)', () => {
    it('rejects ../package.json (the canonical Bug 1 evidence case)', () => {
      expect(() => {
        resolveScopedPath('../package.json', SESSION_SCOPE);
      }).toThrow();
    });

    it('rejects .. path', () => {
      expect(() => {
        resolveScopedPath('..', SESSION_SCOPE);
      }).toThrow();
    });
  });

  describe('edge cases preserve existing behavior', () => {
    it('empty path → returns scope unchanged', () => {
      expect(resolveScopedPath('', SESSION_SCOPE)).toBe(SESSION_SCOPE);
    });

    it("'.' path → returns scope as root-of-scope", () => {
      expect(resolveScopedPath('.', SESSION_SCOPE)).toBe(SESSION_SCOPE);
    });

    it('whitespace-only path → returns scope unchanged', () => {
      expect(resolveScopedPath('   ', SESSION_SCOPE)).toBe(SESSION_SCOPE);
    });
  });

  describe('whitelist surface area (regression guard)', () => {
    it('contains exactly the 3 documented whitelist entries (no silent expansion)', () => {
      // ROOT_READ_WHITELIST is now exported — assert directly via .has() so
      // a future maintainer who legitimately adds an entry (e.g., '.eslintrc.json')
      // gets a CLEAR POINTING test failure at the membership assertion below,
      // not silent behavior drift across the codebase.
      expect(ROOT_READ_WHITELIST.has('package.json')).toBe(true);
      expect(ROOT_READ_WHITELIST.has('tsconfig.json')).toBe(true);
      expect(ROOT_READ_WHITELIST.has('README.md')).toBe(true);
      expect(ROOT_READ_WHITELIST.size).toBe(3);
    });

    it('iterates exported whitelist + asserts each documented filename synthesizes at workspace root', () => {
      // Drives from the exported const — if the const grows, this test STILL
      // covers every entry. If it shrinks, this test STARTS failing with a
      // clear message pointing at this describe block.
      for (const filename of ROOT_READ_WHITELIST) {
        expect(resolveScopedPath(filename, SESSION_SCOPE)).toBe(`workspace/${filename}`);
      }
    });

    it('non-whitelisted bare filenames synthesize under session scope (default branch)', () => {
      // Inverted-iteration pattern (per SHOULDCONSIDER closure 2026-07-22):
      // FIRST assert membership (pointing error if a candidate is added to the
      // whitelist), THEN assert the default-branch behavior. This surfaces the
      // "added to whitelist" intent cleanly instead of the indirect behavioral
      // expectation failure.
      const nonWhitelistedSample: ReadonlyArray<string> = ['.eslintrc.json', 'yarn.lock', '.gitignore'];
      for (const candidate of nonWhitelistedSample) {
        expect(ROOT_READ_WHITELIST.has(candidate)).toBe(false);
      }
      for (const filename of nonWhitelistedSample) {
        expect(resolveScopedPath(filename, SESSION_SCOPE)).toBe(`${SESSION_SCOPE}/${filename}`);
      }
    });
  });
});
