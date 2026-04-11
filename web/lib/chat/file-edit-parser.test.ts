/**
 * Tests for file-edit-parser module
 * Covers extractJsonToolCalls, extractFileEdits, sanitizeFileEditTags, and incremental parsing
 */

import { describe, it, expect } from 'vitest';
import {
  extractJsonToolCalls,
  extractFileEdits,
  extractIncrementalFileEdits,
  createIncrementalParser,
  sanitizeFileEditTags,
  sanitizeAssistantDisplayContent,
  isValidExtractedPath,
} from './file-edit-parser';

// ============================================================================
// extractJsonToolCalls
// ============================================================================

describe('extractJsonToolCalls', () => {
  it('returns empty array when no tool calls present', () => {
    expect(extractJsonToolCalls('Just some normal text')).toEqual([]);
    expect(extractJsonToolCalls('')).toEqual([]);
  });

  it('extracts single write_file tool call', () => {
    const content = `{ "tool": "write_file", "arguments": { "path": "hello.txt", "content": "Hello World" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toEqual({
      path: 'hello.txt',
      content: 'Hello World',
    });
  });

  it('extracts batch_write tool call with multiple files', () => {
    const content = `{
      "tool": "batch_write",
      "arguments": {
        "files": [
          { "path": "package.json", "content": "{}" },
          { "path": "index.js", "content": "console.log('hi')" }
        ]
      }
    }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(2);
    expect(edits[0].path).toBe('package.json');
    expect(edits[0].content).toBe('{}');
    expect(edits[1].path).toBe('index.js');
    expect(edits[1].content).toBe("console.log('hi')");
  });

  it('extracts apply_diff as patch action', () => {
    const content = `{ "tool": "apply_diff", "arguments": { "path": "src/main.ts", "diff": "--- old\\n+++ new\\n-foo\\n+bar" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('src/main.ts');
    expect(edits[0].action).toBe('patch');
    expect(edits[0].content).toContain('--- old');
  });

  it('extracts delete_file as delete action', () => {
    const content = `{ "tool": "delete_file", "arguments": { "path": "temp.txt" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('temp.txt');
    expect(edits[0].action).toBe('delete');
    expect(edits[0].content).toBe('');
  });

  it('ignores non-file tools like read_file, list_files', () => {
    const content = `{ "tool": "read_file", "arguments": { "path": "config.json" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(0);
  });

  it('handles multiple tool calls in one content', () => {
    const content = `First: { "tool": "write_file", "arguments": { "path": "a.txt", "content": "aaa" } }
Second: { "tool": "write_file", "arguments": { "path": "b.txt", "content": "bbb" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(2);
    expect(edits[0].path).toBe('a.txt');
    expect(edits[1].path).toBe('b.txt');
  });

  it('skips malformed JSON', () => {
    const content = `{ "tool": "write_file", "arguments": { invalid json } }`;
    expect(extractJsonToolCalls(content)).toEqual([]);
  });

  it('skips empty content', () => {
    const content = `{ "tool": "write_file", "arguments": { "path": "empty.txt", "content": "" } }`;
    expect(extractJsonToolCalls(content)).toEqual([]);
  });

  it('skips invalid paths', () => {
    const content = `{ "tool": "write_file", "arguments": { "path": "{invalid}", "content": "test" } }`;
    expect(extractJsonToolCalls(content)).toEqual([]);
  });

  it('is case-insensitive for tool names', () => {
    const content = `{ "tool": "WRITE_FILE", "arguments": { "path": "test.txt", "content": "data" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('test.txt');
  });

  it('handles write_files (plural) as batch write', () => {
    const content = `{ "tool": "write_files", "arguments": { "files": [{ "path": "x.js", "content": "fn()" }] } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('x.js');
  });

  it('does not crash on nested braces in content', () => {
    const content = `{ "tool": "write_file", "arguments": { "path": "test.js", "content": "const x = { a: { b: 1 } };" } }`;
    const edits = extractJsonToolCalls(content);
    expect(edits).toHaveLength(1);
    expect(edits[0].content).toBe('const x = { a: { b: 1 } };');
  });
});

// ============================================================================
// extractFileEdits integration
// ============================================================================

describe('extractFileEdits with JSON tool calls', () => {
  it('extracts JSON tool calls alongside other formats', () => {
    const content = `Some text
{ "tool": "write_file", "arguments": { "path": "app.js", "content": "main()" } }
More text`;
    const edits = extractFileEdits(content);
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits.some(e => e.path === 'app.js')).toBe(true);
  });

  it('returns empty when no edit markers present', () => {
    expect(extractFileEdits('Just a regular response')).toEqual([]);
  });
});

// ============================================================================
// sanitizeFileEditTags — JSON tool call stripping
// ============================================================================

describe('sanitizeFileEditTags', () => {
  it('strips raw JSON tool calls from content', () => {
    const content = `Sure! Here's the code:
{ "tool": "batch_write", "arguments": { "files": [{ "path": "a.js", "content": "x" }] } }
Done!`;
    const sanitized = sanitizeFileEditTags(content);
    expect(sanitized).not.toContain('"tool"');
    expect(sanitized).not.toContain('"batch_write"');
    expect(sanitized).toContain('Sure!');
    expect(sanitized).toContain('Done!');
  });

  it('does not strip non-tool JSON', () => {
    const content = `Here is the config: { "key": "value" }`;
    const sanitized = sanitizeFileEditTags(content);
    expect(sanitized).toContain('"key"');
    expect(sanitized).toContain('"value"');
  });
});

describe('sanitizeAssistantDisplayContent', () => {
  it('strips JSON tool calls while preserving prose', () => {
    const content = `I'll create the files for you.\n\n{ "tool": "write_file", "arguments": { "path": "hello.txt", "content": "world" } }\n\nAll done!`;
    const result = sanitizeAssistantDisplayContent(content);
    expect(result).toContain("I'll create the files for you.");
    expect(result).toContain('All done!');
    expect(result).not.toContain('"tool"');
  });
});

// ============================================================================
// Incremental parsing with JSON tool calls
// ============================================================================

describe('extractIncrementalFileEdits', () => {
  it('detects JSON tool calls in streaming buffer', () => {
    const state = createIncrementalParser();
    const buffer = `{ "tool": "write_file", "arguments": { "path": "stream.js", "content": "live()" } }`;
    const edits = extractIncrementalFileEdits(buffer, state);
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits.some(e => e.path === 'stream.js')).toBe(true);
  });

  it('does not duplicate edits on incremental calls', () => {
    const state = createIncrementalParser();
    const buffer1 = `{ "tool": "write_file", "arguments": { "path": "dup.js", "content": "once" } }`;
    const edits1 = extractIncrementalFileEdits(buffer1, state);
    const count1 = edits1.filter(e => e.path === 'dup.js').length;

    const buffer2 = buffer1 + ' more text';
    const edits2 = extractIncrementalFileEdits(buffer2, state);
    const count2 = edits2.filter(e => e.path === 'dup.js').length;

    expect(count1).toBeGreaterThanOrEqual(1);
    expect(count2).toBe(0); // already emitted
  });

  it('handles incomplete JSON tool calls during streaming', () => {
    const state = createIncrementalParser();
    // Incomplete JSON — no closing brace
    const buffer = `{ "tool": "write_file", "arguments": { "path": "partial.js"`;
    const edits = extractIncrementalFileEdits(buffer, state);
    // Should not emit incomplete edits
    expect(edits.filter(e => e.path === 'partial.js')).toHaveLength(0);
  });
});

// ============================================================================
// isValidExtractedPath
// ============================================================================

describe('isValidExtractedPath', () => {
  it('accepts valid file paths', () => {
    expect(isValidExtractedPath('src/index.ts')).toBe(true);
    expect(isValidExtractedPath('package.json')).toBe(true);
    expect(isValidExtractedPath('components/Button.tsx')).toBe(true);
    expect(isValidExtractedPath('./local/file.js')).toBe(true);
  });

  it('rejects JSON/object syntax', () => {
    expect(isValidExtractedPath('{path}')).toBe(false);
    expect(isValidExtractedPath('[0]')).toBe(false);
  });

  it('rejects CSS values', () => {
    expect(isValidExtractedPath('0.3s')).toBe(false);
    expect(isValidExtractedPath('10px')).toBe(false);
  });

  it('rejects paths with special ending chars', () => {
    expect(isValidExtractedPath('file.txt/')).toBe(false);
    expect(isValidExtractedPath('file.txt,')).toBe(false);
  });
});
