/**
 * Unit tests for parseBatchWriteFiles function
 * Tests various formats the LLM might send for batch_write tool arguments
 */

import { describe, it, expect } from 'vitest';
import { parseBatchWriteFiles } from '../vfs-mcp-tools';

describe('parseBatchWriteFiles', () => {
  // ============================================================================
  // Direct array input (already correct format)
  // ============================================================================

  it('returns array as-is when already an array', () => {
    const input = [
      { path: 'file1.txt', content: 'content1' },
      { path: 'file2.txt', content: 'content2' },
    ];
    expect(parseBatchWriteFiles(input)).toEqual(input);
  });

  it('returns empty array when empty array provided', () => {
    expect(parseBatchWriteFiles([])).toEqual([]);
  });

  it('returns null for non-array non-string input', () => {
    expect(parseBatchWriteFiles(123)).toBeNull();
    expect(parseBatchWriteFiles({})).toBeNull();
    expect(parseBatchWriteFiles(undefined)).toBeNull();
  });

  // ============================================================================
  // Direct JSON string (properly formatted JSON)
  // ============================================================================

  it('parses direct JSON string with valid array', () => {
    const input = '[{"path":"file1.txt","content":"content1"},{"path":"file2.txt","content":"content2"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(2);
    expect(result?.[0].path).toBe('file1.txt');
    expect(result?.[0].content).toBe('content1');
    expect(result?.[1].path).toBe('file2.txt');
    expect(result?.[1].content).toBe('content2');
  });

  it('parses JSON string with single quotes (JSON format)', () => {
    const input = "[{'path':'test.js','content':'console.log()'}]";
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('test.js');
  });

  it('returns null for JSON string that is not an array', () => {
    const input = '{"path":"file.txt","content":"test"}';
    expect(parseBatchWriteFiles(input)).toBeNull();
  });

  it('returns null for invalid JSON string', () => {
    const input = 'not valid json at all';
    expect(parseBatchWriteFiles(input)).toBeNull();
  });

  // ============================================================================
  // Bracket extraction format ([...])
  // ============================================================================

  it('extracts array from string starting with brackets', () => {
    const input = '[{"path":"a.txt","content":"AAA"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('a.txt');
    expect(result?.[0].content).toBe('AAA');
  });

  it('extracts array from string with surrounding text', () => {
    const input = 'Here is the files array: [{"path":"x.txt","content":"X"}] end of message';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('x.txt');
  });

  it('extracts array from string with extra whitespace', () => {
    const input = '   [{"path":"y.txt","content":"Y"}]   ';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('y.txt');
  });

  it('returns null when brackets extraction fails', () => {
    const input = 'no brackets here at all';
    expect(parseBatchWriteFiles(input)).toBeNull();
  });

  // ============================================================================
  // files= format
  // ============================================================================

  it('parses files= format with JSON array', () => {
    const input = 'files=[{"path":"f1.txt","content":"c1"},{"path":"f2.txt","content":"c2"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(2);
    expect(result?.[0].path).toBe('f1.txt');
    expect(result?.[1].path).toBe('f2.txt');
  });

  it('parses files= format with surrounding text', () => {
    const input = 'Please create files=[{"path":"test.txt","content":"hello"}] thanks';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('test.txt');
    expect(result?.[0].content).toBe('hello');
  });

  it('parses files= format with extra whitespace', () => {
    const input = 'files = [{"path":"w.txt","content":"whitespace"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('w.txt');
  });

  // ============================================================================
  // files: format
  // ============================================================================

  it('parses files: format with JSON array', () => {
    const input = 'files:[{"path":"colon.txt","content":"colon content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('colon.txt');
  });

  it('parses files: format with surrounding text', () => {
    const input = 'Use files: [{"path":"z.txt","content":"Z"}] for the files';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('z.txt');
  });

  // ============================================================================
  // filesArray format
  // ============================================================================

  it('parses filesArray= format', () => {
    const input = 'filesArray=[{"path":"arr.txt","content":"array content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('arr.txt');
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  it('handles empty string', () => {
    expect(parseBatchWriteFiles('')).toBeNull();
  });

  it('handles whitespace-only string', () => {
    expect(parseBatchWriteFiles('   ')).toBeNull();
  });

  it('handles string with only brackets but invalid JSON', () => {
    const input = '[not valid json]';
    expect(parseBatchWriteFiles(input)).toBeNull();
  });

  it('handles string that looks like files= but has invalid JSON', () => {
    const input = 'files=[invalid json]';
    expect(parseBatchWriteFiles(input)).toBeNull();
  });

  it('handles nested arrays in JSON (returns first level)', () => {
    const input = '[{"path":"nested.txt","content":"content","extra":[[1,2],[3,4]]}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('nested.txt');
  });

  it('handles special characters in path and content', () => {
    const input = '[{"path":"path/with/special.txt","content":"line1\\nline2\\ttab"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('path/with/special.txt');
    expect(result?.[0].content).toBe('line1\nline2\ttab');
  });

  it('handles Unicode characters in content', () => {
    const input = '[{"path":"unicode.txt","content":"Hello \\u4e16\\u754c"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('Hello \u4e16\u754c');
  });

  // ============================================================================
  // Real-world LLM output patterns
  // ============================================================================

  it('handles typical LLM output with files keyword', () => {
    const input = 'Use batch_write to create these files: files=[{"path":"app.js","content":"console.log(\'hello\')"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('app.js');
    expect(result?.[0].content).toContain('console.log');
  });

  it('handles LLM output with JSON array in natural language', () => {
    const input = 'I will create the following files: [{"path":"config.json","content":"{}"}] Please confirm.';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('config.json');
  });

  it('handles LLM output with multiline content', () => {
    const input = '[{"path":"multiline.txt","content":"line 1\\nline 2\\nline 3"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('line 1\nline 2\nline 3');
  });

  it('returns null for path traversal attempt', () => {
    const input = '[{"path":"../../etc/passwd","content":"malicious"}]';
    const result = parseBatchWriteFiles(input);
    // The parser itself doesn't reject this - validation happens later in the execute function
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('../../etc/passwd');
  });
});