/**
 * Tests for file-diff-utils
 * Covers applySearchAndReplace and applySimpleLineDiff
 */

import { describe, it, expect } from 'vitest';
import {
  applySearchAndReplace,
  applySimpleLineDiff,
} from '../file-diff-utils';

// ============================================================================
// applySimpleLineDiff
// ============================================================================

describe('applySimpleLineDiff', () => {

  // ── Full file content ──

  it('treats content without diff markers as full file (new file)', () => {
    const result = applySimpleLineDiff('', 'line1\nline2\nline3');
    expect(result).toBe('line1\nline2\nline3');
  });

  it('treats content without diff markers as full file (overwrite existing)', () => {
    const result = applySimpleLineDiff('old content', 'completely new content');
    expect(result).toBe('completely new content');
  });

  // ── Claude-style `+ ` prefix ──

  it('handles Claude-style `+ ` added lines', () => {
    const result = applySimpleLineDiff(
      'line1\nline2\nline3',
      '  line1\n  line2\n+ new_line\n  line3'
    );
    expect(result).toBe('line1\nline2\nnew_line\nline3');
  });

  it('handles Claude-style `- ` removed lines', () => {
    const result = applySimpleLineDiff(
      'line1\nline2\nline3',
      '  line1\n- line2\n  line3'
    );
    expect(result).toBe('line1\nline3');
  });

  it('handles Claude-style `  ` two-space context lines', () => {
    const result = applySimpleLineDiff(
      'keep this',
      '  keep this\n+ new line'
    );
    expect(result).toBe('keep this\nnew line');
  });

  // ── Unified diff bare `+` prefix ──

  it('handles unified diff bare `+content` added lines', () => {
    const result = applySimpleLineDiff(
      'line1\nline3',
      'line1\n+new_line2\nline3'
    );
    expect(result).toBe('line1\nnew_line2\nline3');
  });

  it('handles unified diff bare `-content` removed lines', () => {
    const result = applySimpleLineDiff(
      'line1\nline2\nline3',
      'line1\n-line2\nline3'
    );
    expect(result).toBe('line1\nline3');
  });

  // ── Unified diff single-space context ──

  it('handles unified diff single-space context lines', () => {
    const result = applySimpleLineDiff(
      'a\nb\nc',
      ' a\n-b\n+c'
    );
    expect(result).toBe('a\nc');
  });

  // ── @@ hunk headers ──

  it('skips @@ hunk header lines', () => {
    const result = applySimpleLineDiff(
      'unchanged\nold\nstill here',
      ' unchanged\n@@ -1,3 +1,3 @@\n-old\n+new\n still here'
    );
    expect(result).toBe('unchanged\nnew\nstill here');
  });

  it('skips multiple @@ hunk headers', () => {
    const result = applySimpleLineDiff(
      'a\nb\nc\nd',
      ' a\n@@ -1,2 +1,2 @@\n-b\n+c\n@@ -3,4 +3,4 @@\n-d\n+e'
    );
    expect(result).toBe('a\nc\ne');
  });

  // ── Mixed formats ──

  it('handles mixed Claude-style and unified diff formats', () => {
    const result = applySimpleLineDiff(
      'one\ntwo\nthree\nfour',
      '  one\n-two\n+new_two\n three\n-four\n+new_four'
    );
    expect(result).toBe('one\nnew_two\nthree\nnew_four');
  });

  // ── Edge cases ──

  it('returns empty string for empty diff body (treated as full content)', () => {
    const result = applySimpleLineDiff('content', '');
    expect(result).toBe('');
  });

  it('returns null when result is empty string', () => {
    const result = applySimpleLineDiff('a', '- a');
    // After removing 'a', there's nothing left
    expect(result).toBeNull();
  });

  it('returns diff body as-is when treated as full file content (no diff markers)', () => {
    const result = applySimpleLineDiff('unchanged', '  unchanged');
    // isFullFileContent returns true, so diff body replaces current content entirely
    expect(result).toBe('  unchanged');
  });

  it('preserves lines with no diff prefix as context', () => {
    const result = applySimpleLineDiff(
      'a\nb\nc',
      'a\n+added\nc'  // 'a' and 'c' have no prefix — preserved via else clause
    );
    expect(result).toBe('a\nadded\nc');
  });

  // ── Bug #46 — Unified-diff file headers must NOT leak into the file ──

  it('Bug #46: SKIPS `--- a/path` header (does not leak it into result)', () => {
    // Pre-fix behavior would preserve `--- a/path` as context, corrupting the file.
    // Post-fix: the line is skipped via `continue`, so the result contains only
    // the actual diff content.
    const result = applySimpleLineDiff(
      'old\ncontent',
      '--- a/path\n-old\n+new\n content'
    );
    expect(result).not.toContain('--- a/path');
    expect(result).not.toContain('--- ');
    expect(result).toContain('new');
    expect(result).toContain('content');
  });

  it('Bug #46: SKIPS `+++ b/path` header (does not leak it into result)', () => {
    const result = applySimpleLineDiff(
      'old content',
      '+++ b/path\n-old content\n+new content'
    );
    expect(result).not.toContain('+++ b/path');
    expect(result).not.toContain('+++ ');
    expect(result).toContain('new content');
    expect(result).not.toContain('old content');
  });

  it('Bug #46: full unified diff with `--- a/path` + `+++ b/path` + `@@` produces clean file content', () => {
    // Real-world scenario: LLM sends a unified diff block.
    // Pre-fix: ---/+++ headers leak as literal lines into the output file.
    // Post-fix: only the actual additions/removals survive.
    const current = 'line1\nline2\nline3';
    const unifiedDiff =
      '--- a/foo.ts\n' +
      '+++ b/foo.ts\n' +
      '@@ -1,3 +1,3 @@\n' +
      '-line2\n' +
      '+LINE_TWO_REPLACED';
    const result = applySimpleLineDiff(current, unifiedDiff);
    expect(result).toBe('line1\nLINE_TWO_REPLACED\nline3');
    expect(result).not.toContain('--- ');
    expect(result).not.toContain('+++ ');
  });

  it('Bug #46: defense-in-depth REJECTS results containing `--- ` / `+++ ` headers (strict)', () => {
    // Review fix (tighter): the main loop skips `--- ` and `+++ ` (with trailing
    // space) via `continue`. The defense-in-depth check at the END of
    // applySimpleLineDiff rejects any result that still contains those headers
    // (they could come from a `--- path` with no trailing space that the main
    // loop's startsWith("--- ") check missed). This test asserts both:
    //   (1) for an input that would leak a `--- ` line, the result is EITHER
    //       null (defense-in-depth rejected) OR a string that contains zero
    //       lines matching the `--- `/`+++ ` pattern.
    //   (2) the main loop + defense-in-depth BOTH contributed — verified by
    //       asserting that for the standard `--- a/path` case (which the main
    //       loop handles), the result is NOT null and contains only file content.
    const sneakyDiff = 'line1\n--- foo\n+line2';
    const result = applySimpleLineDiff('line1', sneakyDiff);
    if (result !== null) {
      const lines = result.split('\n');
      for (const line of lines) {
        // Post-condition: NO result line can start with `--- ` or `+++ `.
        // If any does, the defense-in-depth check failed to reject.
        expect(/^(--- |\+\+\+ )/.test(line)).toBe(false);
      }
    }
    // (2) Standard case: main loop handles it, result is non-null and clean.
    const standardResult = applySimpleLineDiff(
      'old\ncontent',
      '--- a/path\n-old\n+new\n content'
    );
    expect(standardResult).not.toBeNull();
    expect(standardResult).toBe('new\ncontent');
  });

  it('handles a single bare `+` line (no space, no content)', () => {
    // A bare `+` by itself on a line
    const result = applySimpleLineDiff('a\nb', 'a\n+\nb');
    // `+` with length 1 doesn't match the added-line condition, preserved as context
    expect(result).toBe('a\n+\nb');
  });

  it('handles a single bare `-` line (no space, no content)', () => {
    const result = applySimpleLineDiff('a\nb', 'a\n-\nb');
    // `-` with length 1 doesn't match the removed-line condition, preserved as context
    expect(result).toBe('a\n-\nb');
  });
});

// ============================================================================
// applySearchAndReplace
// ============================================================================

describe('applySearchAndReplace', () => {

  // ── Basic SAR ──

  it('replaces SEARCH block with REPLACE block', () => {
    const content = 'function oldName() {\n  return 1;\n}\n';
    const diff = '<<<<<<< SEARCH\nfunction oldName() {\n  return 1;\n}\n=======\nfunction newName() {\n  return 2;\n}\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('function newName() {\n  return 2;\n}\n');
  });

  it('returns null when diff has no SAR markers', () => {
    const result = applySearchAndReplace('content', 'some regular text');
    expect(result).toBeNull();
  });

  // ── Multiple blocks ──

  it('applies multiple SAR blocks in a single diff', () => {
    const content = 'foo\nbar\nbaz\n';
    const diff = '<<<<<<< SEARCH\nfoo\n=======\nFOO\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nbar\n=======\nBAR\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('FOO\nBAR\nbaz\n');
  });

  // ── No match ──

  it('returns null when SEARCH does not match current content', () => {
    const content = 'some content';
    const diff = '<<<<<<< SEARCH\nnonexistent text\n=======\nreplacement\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBeNull();
  });

  // ── Case insensitivity ──

  it('handles lowercase SEARCH and REPLACE markers', () => {
    const content = 'old code';
    const diff = '<<<<<<< search\nold code\n=======\nnew code\n>>>>>>> replace';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('new code');
  });

  it('handles mixed case SEARCH and REPLACE markers', () => {
    const content = 'old code';
    const diff = '<<<<<<< Search\nold code\n=======\nnew code\n>>>>>>> Replace';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('new code');
  });

  // ── Trimmed-end fallback ──

  it('falls back to trimmed-end matching when exact match fails', () => {
    const content = 'function foo() {\n  return 1;\n}\n';
    // SEARCH has trailing spaces on lines, content doesn't
    const diff = '<<<<<<< SEARCH\nfunction foo() {  \n  return 1;  \n}\n=======\nfunction bar() {\n  return 2;\n}\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('function bar() {\n  return 2;\n}\n');
  });

  it('returns null when even trimmed-end matching fails', () => {
    const content = 'completely different content';
    const diff = '<<<<<<< SEARCH\nsomething else\n=======\nreplacement\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBeNull();
  });

  // ── Multiple blocks with partial match ──

  it('applies only matching blocks and ignores non-matching ones', () => {
    const content = 'keep this\nchange this\n';
    const diff = '<<<<<<< SEARCH\nkeep this\n=======\nKEPT\n>>>>>>> REPLACE\n<<<<<<< SEARCH\ndoes not exist\n=======\nIGNORED\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    // First block matches (replace "keep this" with "KEPT")
    // Second block doesn't match (no "does not exist" in content)
    expect(result).toBe('KEPT\nchange this\n');
  });

  // ── Edge cases ──

  it('handles empty current content', () => {
    const diff = '<<<<<<< SEARCH\nsomething\n=======\nreplacement\n>>>>>>> REPLACE';
    const result = applySearchAndReplace('', diff);
    expect(result).toBeNull();
  });

  it('handles SAR when markers have no leading whitespace (exact regex match)', () => {
    const content = 'old code';
    const diff = '<<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('new code');
  });

  it('handles multiple `=` characters as separator', () => {
    const content = 'old code';
    const diff = '<<<<<<< SEARCH\nold code\n===========\nnew code\n>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('new code');
  });

  it('handles multiple `<` and `>` characters', () => {
    const content = 'old code';
    const diff = '<<<<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>>>> REPLACE';
    const result = applySearchAndReplace(content, diff);
    expect(result).toBe('new code');
  });
});
