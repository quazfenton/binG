/**
 * Bug #9/#15/#19 — text-mode extraction guard tests
 *
 * Tests for the three new guards added to `parseFilesystemResponse`:
 *   - Bug #9: project-name hallucination guard (`looksLikeProjectName`)
 *   - Bug #15: post-forceExtract dedup pass (by path, first-wins)
 *   - Bug #19: tool_result JSON block stripping (`stripToolResultBlocks`)
 */

import { describe, it, expect } from 'vitest';
import {
  parseFilesystemResponse,
  looksLikeProjectName,
  stripToolResultBlocks,
} from '../file-edit-parser';

// ============================================================================
// Bug #9: project-name hallucination guard
// ============================================================================

describe('Bug #9: looksLikeProjectName guard', () => {
  it('flags bare names with no extension and no separator as project names', () => {
    expect(looksLikeProjectName('coding-agent-tui')).toBe(true);
    expect(looksLikeProjectName('my-project')).toBe(true);
    expect(looksLikeProjectName('someapp')).toBe(true);
  });

  it('does NOT flag paths with file extensions', () => {
    expect(looksLikeProjectName('app.ts')).toBe(false);
    expect(looksLikeProjectName('package.json')).toBe(false);
    expect(looksLikeProjectName('README.md')).toBe(false);
  });

  it('does NOT flag paths with separators', () => {
    expect(looksLikeProjectName('src/app.ts')).toBe(false);
    expect(looksLikeProjectName('a/b/c/d.ts')).toBe(false);
  });

  it('bypasses the guard for paths in explicitToolCalls', () => {
    expect(looksLikeProjectName('coding-agent-tui', ['coding-agent-tui'])).toBe(false);
    expect(looksLikeProjectName('package', ['package'])).toBe(false);
  });

  it('bypasses the guard for paths that are suffixes of explicitToolCalls', () => {
    // A path like `package.json` is a suffix of `src/package.json`
    expect(looksLikeProjectName('package.json', ['src/package.json'])).toBe(false);
  });

  it('does not flag single-character names (too short to be a real path)', () => {
    expect(looksLikeProjectName('a')).toBe(false);
    expect(looksLikeProjectName('')).toBe(false);
  });

  it('parseFilesystemResponse skips project-name hallucinations in fence blocks', () => {
    // The LLM writes prose mentioning a project name, then a fence block
    // for that name. The fence block should be ignored.
    const content = `The project is \`coding-agent-tui\` and here's the file:
\`\`\`file: coding-agent-tui
content here
\`\`\``;
    const result = parseFilesystemResponse(content);
    // No writes should be created for the project name
    expect(result.writes.find((w) => w.path === 'coding-agent-tui')).toBeUndefined();
  });

  it('parseFilesystemResponse allows project-name paths when in explicitToolCalls', () => {
    const content = `\`\`\`file: package.json
{ "name": "foo" }
\`\`\``;
    // Without explicitToolCalls, package.json has a `.json` extension so it's fine
    const result1 = parseFilesystemResponse(content);
    expect(result1.writes.find((w) => w.path === 'package.json')).toBeDefined();

    // With explicitToolCalls including the path, still allowed
    const result2 = parseFilesystemResponse(content, false, ['package.json']);
    expect(result2.writes.find((w) => w.path === 'package.json')).toBeDefined();
  });

  it('parseFilesystemResponse still extracts legitimate paths', () => {
    const content = `\`\`\`file: src/components/Card.tsx
export const Card = () => <div />;
\`\`\``;
    const result = parseFilesystemResponse(content);
    expect(result.writes.find((w) => w.path === 'src/components/Card.tsx')).toBeDefined();
  });
});

// ============================================================================
// Bug #15: post-forceExtract dedup pass
// ============================================================================

describe('Bug #15: post-forceExtract dedup pass', () => {
  it('dedupes duplicate writes to the same path when forceExtract is true', () => {
    // Same path written twice with different content — forceExtract should
    // still dedup by path (first-wins).
    const content = `\`\`\`file: src/app.ts
version 1
\`\`\`
\`\`\`file: src/app.ts
version 2
\`\`\``;
    const result = parseFilesystemResponse(content, true);
    const appWrites = result.writes.filter((w) => w.path === 'src/app.ts');
    // Only one write to src/app.ts should remain
    expect(appWrites).toHaveLength(1);
    // First-wins: the original content
    expect(appWrites[0].content).toBe('version 1');
  });

  it('does NOT apply post-forceExtract dedup when forceExtract is false', () => {
    // The post-forceExtract dedup pass is GATED on `forceExtract === true`.
    // When forceExtract is false, the existing per-key dedup (path::content)
    // applies as before. This test verifies that the same content produces
    // the same result with forceExtract=false and without the third arg.
    const content = `\`\`\`file: src/app.ts
version 1
\`\`\``;
    const resultNoForce = parseFilesystemResponse(content);
    const resultFalse = parseFilesystemResponse(content, false);
    expect(resultFalse.writes).toEqual(resultNoForce.writes);
  });

  it('preserves all distinct paths even with forceExtract', () => {
    const content = `\`\`\`file: src/a.ts
content a
\`\`\`
\`\`\`file: src/b.ts
content b
\`\`\`
\`\`\`file: src/c.ts
content c
\`\`\``;
    const result = parseFilesystemResponse(content, true);
    expect(result.writes).toHaveLength(3);
    expect(result.writes.map((w) => w.path).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});

// ============================================================================
// Bug #19: tool_result JSON block stripping
// ============================================================================

describe('Bug #19: stripToolResultBlocks', () => {
  it('removes tool_result JSON blocks from content', () => {
    const content = `Some text {"type": "tool_result", "success": true, "output": "data"} more text`;
    const result = stripToolResultBlocks(content);
    expect(result).not.toContain('tool_result');
    expect(result).toContain('Some text');
    expect(result).toContain('more text');
  });

  it('removes tool_result blocks with success=false', () => {
    const content = `text {"type": "tool_result", "success": false, "error": "x"} after`;
    const result = stripToolResultBlocks(content);
    expect(result).not.toContain('tool_result');
    expect(result).toContain('text');
    expect(result).toContain('after');
  });

  it('handles nested objects in tool_result blocks', () => {
    const content = `before {"type": "tool_result", "data": {"nested": "object"}, "ok": true} after`;
    const result = stripToolResultBlocks(content);
    expect(result).not.toContain('tool_result');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('does NOT remove regular JSON that does not have type=tool_result', () => {
    const content = `text {"type": "other", "data": "x"} after`;
    const result = stripToolResultBlocks(content);
    expect(result).toBe(content);
  });

  it('handles empty content', () => {
    expect(stripToolResultBlocks('')).toBe('');
  });

  it('parseFilesystemResponse does not extract paths from tool_result blocks', () => {
    // The LLM echoes a tool_result with a path-like field. The path
    // should NOT be extracted as a file write.
    const content = `Here's the result: {"type": "tool_result", "success": true, "path": "src/should-not-be-extracted.ts", "content": "fake"}`;
    const result = parseFilesystemResponse(content);
    expect(result.writes.find((w) => w.path === 'src/should-not-be-extracted.ts')).toBeUndefined();
  });

  it('still extracts legitimate edits when tool_result blocks are present', () => {
    const content = `{"type": "tool_result", "success": true, "output": "noise"}
\`\`\`file: src/real.ts
real content
\`\`\`
{"type": "tool_result", "success": false, "error": "more noise"}`;
    const result = parseFilesystemResponse(content);
    expect(result.writes.find((w) => w.path === 'src/real.ts')).toBeDefined();
  });
});
