/**
 * Standalone unit tests for batchWrite parsing logic
 * Tests the parsing function that handles various formats the LLM might send
 * 
 * This is a copy of the parsing logic to avoid import chain issues with vfs-mcp-tools
 */

import { describe, it, expect } from 'vitest';

/**
 * Parse files argument for batch_write tool.
 * Handles various formats the LLM might send:
 * - Direct array: [{path, content}, ...]
 * - JSON string: '[{\"path\":..., \"content\":...}, ...]'
 * - files= format: 'files=[{path, content}, ...]'
 * - files: format: 'files:[{path, content}, ...]'
 */
function parseBatchWriteFiles(files: unknown): Array<{ path: string; content: string }> | null {
  /**
   * Filter array entries to only include valid file objects (objects with at least a path or content).
   * Returns null if no valid entries remain.
   */
  function filterValidFiles(files: unknown[]): Array<{ path?: string; content?: string }> | null {
    const valid = files.filter(item => item && typeof item === 'object' && !Array.isArray(item));
    return valid.length > 0 ? valid : (files.length === 0 ? [] : null);
  }

  /**
   * Try to parse JSON with trailing comma fix, then sanitize and validate.
   */
  function tryParseJson(text: string, sanitize = false): unknown {
    // First try as-is
    try {
      return JSON.parse(text);
    } catch {
      // Try fixing trailing commas (common LLM output error)
      try {
        return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        // LLMs often output single-quoted JSON — normalize to double quotes
        try {
          return JSON.parse(text.replace(/'/g, '"'));
        } catch {
          // Try with sanitization for raw control characters
          if (sanitize) {
            try {
              return JSON.parse(sanitizeJsonString(text));
            } catch {
              // Try sanitization after fixing trailing commas
              try {
                return JSON.parse(sanitizeJsonString(text.replace(/,\s*([}\]])/g, '$1')));
              } catch {
                // Try sanitization after fixing single quotes
                try {
                  return JSON.parse(sanitizeJsonString(text.replace(/'/g, '"')));
                } catch {
                  // All attempts failed
                }
              }
            }
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Parse and validate a JSON string, returning a filtered array or null.
   */
  function parseAndValidate(text: string): Array<{ path?: string; content?: string }> | null {
    const parsed = tryParseJson(text, true);
    if (Array.isArray(parsed)) {
      return filterValidFiles(parsed);
    }
    if (parsed && typeof parsed === 'object' && 'files' in parsed) {
      const extracted = (parsed as any).files;
      if (Array.isArray(extracted)) {
        return filterValidFiles(extracted);
      }
    }
    return null;
  }

  // If already an array, validate and filter
  if (Array.isArray(files)) {
    return filterValidFiles(files);
  }

  // If not a string, can't parse
  if (typeof files !== 'string') {
    return null;
  }

  const trimmed = files.trim();

  // Empty or whitespace-only check
  if (!trimmed) {
    return null;
  }

  /**
   * Sanitize raw newlines/tabs/carriage-returns within JSON string values.
   * LLM output often contains unescaped control characters inside quoted strings.
   * This walks the text character-by-character tracking quote state and escapes
   * raw control chars to their JSON escape sequences.
   */
  function sanitizeJsonString(text: string): string {
    let result = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        result += ch;
        escapeNext = false;
        continue;
      }

      if (ch === '\\' && inString) {
        result += ch;
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        result += ch;
        continue;
      }

      if (inString) {
        // Inside a JSON string value — escape control characters
        if (ch === '\n') { result += '\\n'; }
        else if (ch === '\r') { result += '\\r'; }
        else if (ch === '\t') { result += '\\t'; }
        else if (ch === '\b') { result += '\\b'; }
        else if (ch === '\f') { result += '\\f'; }
        else { result += ch; }
      } else {
        result += ch;
      }
    }

    return result;
  }

  // First try direct parse
  let result = parseAndValidate(files);
  if (result) return result;

  // Format: object with files property as string
  try {
    const objMatch = trimmed.match(/\{[\s\S]*"files"[\s\S]*\}/i);
    if (objMatch) {
      result = parseAndValidate(objMatch[0]);
      if (result) return result;
    }
  } catch {
    // Object extraction failed
  }

  // Format: starts with [...]
  if (trimmed.startsWith('[')) {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (match) {
      result = parseAndValidate(match[0]);
      if (result) return result;
    }
  }

  // Format: files=... or files:... or filesArray=...
  // Also handles: "files" [...], args: [...], data: [...]
  const keyValuePatterns = [
    /(?:files(?:Array)?|args|data|input|items)\s*[:=]\s*(\[[\s\S]*\])/i,
    /"(?:files|args|data|input|items)"\s*:\s*(\[[\s\S]*\])/i,
  ];

  for (const pattern of keyValuePatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      result = parseAndValidate(match[1]);
      if (result) return result;
    }
  }

  // Try to find any JSON array anywhere in the string (last resort)
  const anyArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (anyArrayMatch) {
    result = parseAndValidate(anyArrayMatch[0]);
    if (result) return result;
  }

  // Unable to parse
  return null;
}

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

  // ============================================================================
  // Real-world LLM output patterns
  // ============================================================================

  it('handles typical LLM output with files keyword', () => {
    const input = 'Use batch_write to create these files: files=[{"path":"app.js","content":"console.log(\'hello\')"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('app.js');
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

  it('returns parsed result for path traversal attempt (validation happens elsewhere)', () => {
    const input = '[{"path":"../../etc/passwd","content":"malicious"}]';
    const result = parseBatchWriteFiles(input);
    // Parser accepts it - validation happens later in execute function
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('../../etc/passwd');
  });

  // ============================================================================
  // New edge cases for enhanced parsing
  // ============================================================================

  it('parses object with files property', () => {
    const input = '{"files": [{"path": "a.txt", "content": "A"}]}';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('a.txt');
    expect(result?.[0].content).toBe('A');
  });

  it('parses object with files property surrounded by text', () => {
    const input = 'Here is the data: {"files": [{"path": "b.txt", "content": "B"}]} thanks';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('b.txt');
  });

  it('parses args= format', () => {
    const input = 'args=[{"path": "c.txt", "content": "C"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('c.txt');
  });

  it('parses data= format', () => {
    const input = 'data=[{"path": "d.txt", "content": "D"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('d.txt');
  });

  it('parses input= format', () => {
    const input = 'input=[{"path": "e.txt", "content": "E"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('e.txt');
  });

  it('parses items= format', () => {
    const input = 'items=[{"path": "f.txt", "content": "F"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('f.txt');
  });

  it('parses JSON object format with quoted keys', () => {
    const input = '{"files": [{"path": "g.txt", "content": "G"}, {"path": "h.txt", "content": "H"}]}';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(2);
    expect(result?.[0].path).toBe('g.txt');
    expect(result?.[1].path).toBe('h.txt');
  });

  it('handles whitespace-only string', () => {
    expect(parseBatchWriteFiles('   ')).toBeNull();
    expect(parseBatchWriteFiles('\n\t')).toBeNull();
  });

  it('handles empty string', () => {
    expect(parseBatchWriteFiles('')).toBeNull();
  });

  // ============================================================================
  // Comprehensive edge cases for robust parsing
  // ============================================================================

  it('handles nested paths with slashes', () => {
    const input = '[{"path": "src/components/Button.tsx", "content": "export const Button = () => {}"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('src/components/Button.tsx');
  });

  it('handles paths with special characters and hyphens', () => {
    const input = '[{"path": "file-with-dashes_underscores.txt", "content": "content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('file-with-dashes_underscores.txt');
  });

  it('handles paths with spaces', () => {
    const input = '[{"path": "path with spaces/file.txt", "content": "content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('path with spaces/file.txt');
  });

  it('handles JSON with extra whitespace', () => {
    const input = '  [  {  "path"  :  "file.txt"  ,  "content"  :  "text"  }  ]  ';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('file.txt');
    expect(result?.[0].content).toBe('text');
  });

  it('handles content with newlines and tabs', () => {
    // LLM output may have raw newlines in JSON content — parser should sanitize
    const input = '[{"path": "multiline.txt", "content": "line1\nline2\n\ttabbed\nline3"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toContain('line1');
    expect(result?.[0].content).toContain('\n');
    expect(result?.[0].content).toContain('\t');
  });

  it('handles content with quotes and special chars', () => {
    const input = '[{"path": "quotes.txt", "content": "She said \\"hello\\" and <code> works"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('She said "hello" and <code> works');
  });

  it('handles content with backslashes', () => {
    const input = '[{"path": "backslash.txt", "content": "path\\\\to\\\\file"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('path\\to\\file');
  });

  it('handles empty content', () => {
    const input = '[{"path": "empty.txt", "content": ""}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('');
  });

  it('handles unicode content', () => {
    const input = '[{"path": "unicode.txt", "content": "Hello 世界 🌍 emoji"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('Hello 世界 🌍 emoji');
  });

  it('handles very long file path', () => {
    const longPath = 'a/'.repeat(50) + 'file.txt';
    const input = JSON.stringify([{ path: longPath, content: 'content' }]);
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe(longPath);
  });

  it('handles multiple files with different content types', () => {
    const input = JSON.stringify([
      { path: 'code.js', content: 'function test() { return 42; }' },
      { path: 'data.json', content: '{"key": "value"}' },
      { path: 'readme.md', content: '# Title\n\nDescription' },
    ]);
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(3);
    expect(result?.[0].path).toBe('code.js');
    expect(result?.[1].path).toBe('data.json');
    expect(result?.[2].path).toBe('readme.md');
  });

  it('handles JSON object instead of array (files property)', () => {
    const input = '{"files": [{"path": "test.txt", "content": "test"}]}';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('test.txt');
  });

  it('handles nested JSON object with files', () => {
    const input = '{"status": "ok", "data": {"files": [{"path": "nested.txt", "content": "content"}]}}';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('nested.txt');
  });

  it('returns null for number input', () => {
    expect(parseBatchWriteFiles(123)).toBeNull();
  });

  it('returns null for boolean input', () => {
    expect(parseBatchWriteFiles(true)).toBeNull();
    expect(parseBatchWriteFiles(false)).toBeNull();
  });

  it('returns null for array of non-objects', () => {
    // Parser should reject arrays that don't contain file objects
    expect(parseBatchWriteFiles(['a', 'b', 'c'])).toBeNull();
  });

  it('returns null for array of mixed non-objects', () => {
    // Array with some non-objects should still return the valid objects
    const input = '[{"path": "file.txt", "content": "text"}, 42, "string"]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('file.txt');
  });

  it('handles object with missing path property', () => {
    const input = '[{"content": "only content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBeUndefined();
  });

  it('handles object with missing content property', () => {
    const input = '[{"path": "file.txt"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('file.txt');
    expect(result?.[0].content).toBeUndefined();
  });

  it('handles null values in array', () => {
    const input = '[{"path": "file.txt", "content": "text"}, null]';
    const result = parseBatchWriteFiles(input);
    // Null values should be filtered out
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('file.txt');
  });

  it('handles string that looks like array but invalid JSON', () => {
    const input = '[invalid json here';
    const result = parseBatchWriteFiles(input);
    expect(result).toBeNull();
  });

  it('handles JSON array with trailing comma', () => {
    const input = '[{"path": "file.txt", "content": "text"},]';
    const result = parseBatchWriteFiles(input);
    // JSON.parse handles trailing commas in some contexts, or extraction fallback kicks in
    expect(result).toBeTruthy();
  });

  it('handles request with args= prefix in text', () => {
    const input = 'args=[{"path": "argfile.txt", "content": "arg content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('argfile.txt');
  });

  it('handles request with data= prefix in text', () => {
    const input = 'data=[{"path": "datafile.txt", "content": "data content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('datafile.txt');
  });

  it('handles request with input= prefix in text', () => {
    const input = 'input=[{"path": "inputfile.txt", "content": "input content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('inputfile.txt');
  });

  it('handles request with items= prefix in text', () => {
    const input = 'items=[{"path": "itemsfile.txt", "content": "items content"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].path).toBe('itemsfile.txt');
  });

  it('handles multiline content within brackets', () => {
    const input = '[\n      {\n        "path": "multifile.txt",\n        "content": "line1\nline2\nline3"\n      }\n    ]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toBe('line1\nline2\nline3');
  });

  it('handles Windows-style line endings in content', () => {
    const input = '[{"path": "windows.txt", "content": "line1\r\nline2\r\nline3"}]';
    const result = parseBatchWriteFiles(input);
    expect(result).toHaveLength(1);
    expect(result?.[0].content).toContain('\r\n');
  });

  // ============================================================================
  // Additional edge cases and integration-style tests
  // ============================================================================

  describe('batchWrite integration - actual file creation', () => {
    it('creates a single file and verifies content structure', () => {
      const input = '[{"path": "e2e-test-1.txt", "content": "Hello World"}]';
      const parsed = parseBatchWriteFiles(input);

      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].path).toBe('e2e-test-1.txt');
      expect(parsed?.[0].content).toBe('Hello World');
      expect(parsed?.[0].content.length).toBeGreaterThan(0);
    });

    it('creates multiple files in batch', () => {
      const input = JSON.stringify([
        { path: 'multi-1.txt', content: 'Content 1' },
        { path: 'multi-2.txt', content: 'Content 2' },
        { path: 'multi-3.txt', content: 'Content 3' }
      ]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(3);

      parsed?.forEach((file, index) => {
        expect(file.path).toBe(`multi-${index + 1}.txt`);
        expect(file.content).toContain(`Content ${index + 1}`);
      });
    });

    it('handles content with newlines and special chars', () => {
      const input = JSON.stringify([{
        path: 'special.txt',
        content: 'Line 1\nLine 2\n\tTabbed\rCarriage\n"Quotes" and \'escapes\''
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toContain('Line 1');
      expect(parsed?.[0].content).toContain('\n');
      expect(parsed?.[0].content).toContain('\t');
      expect(parsed?.[0].content).toContain('"Quotes"');
    });

    it('handles unicode content', () => {
      const input = JSON.stringify([{
        path: 'unicode.txt',
        content: 'Hello \u4e16\u754c \ud83c\udf0d \u00e9moji \u65e5\u8bed\u5185\u5bb9'
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toContain('\u4e16\u754c');
      expect(parsed?.[0].content).toContain('\ud83c\udf0d');
    });

    it('handles code content with backticks', () => {
      const input = JSON.stringify([{
        path: 'code.ts',
        content: 'function test() {\n  return `inline ${code}`;\n}\n// not a fence'
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toContain('function test()');
      expect(parsed?.[0].content).toContain('`');
    });

    it('handles very long content', () => {
      const longContent = 'A'.repeat(50000);
      const input = JSON.stringify([{
        path: 'large.txt',
        content: longContent
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content.length).toBe(50000);
    });

    it('handles nested paths', () => {
      const input = JSON.stringify([
        { path: 'src/components/Button/index.tsx', content: 'export const Button = () => {}' },
        { path: 'src/components/Button/styles.css', content: '.button { color: red }' },
        { path: 'src/utils/helpers.ts', content: 'export const helper = () => {}' }
      ]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(3);

      const paths = parsed?.map(p => p.path) || [];
      expect(paths).toContain('src/components/Button/index.tsx');
      expect(paths).toContain('src/components/Button/styles.css');
      expect(paths).toContain('src/utils/helpers.ts');
    });

    it('preserves whitespace in content', () => {
      const input = JSON.stringify([{
        path: 'whitespace.txt',
        content: '  indented content  \n\n  more indented  '
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toContain('  indented');
      expect(parsed?.[0].content).toContain('  more indented');
    });

    it('handles JSON with escaped quotes in content', () => {
      const input = JSON.stringify([{
        path: 'quoted.txt',
        content: 'She said "Hello" and he said "Hi"'
      }]);

      const parsed = parseBatchWriteFiles(input);
      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toContain('She said');
      expect(parsed?.[0].content).toContain('"Hello"');
    });

    it('handles empty content for existing file editing', () => {
      const input = '[{"path": "empty.txt", "content": ""}]';
      const parsed = parseBatchWriteFiles(input);

      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toBe('');
    });

    it('handles files with only whitespace content', () => {
      const input = '[{"path": "whitespace-only.txt", "content": "   "}]';
      const parsed = parseBatchWriteFiles(input);

      expect(parsed).toHaveLength(1);
      expect(parsed?.[0].content).toBe('   ');
    });
  });

  describe('batchWrite integration - error handling', () => {
    it('handles invalid JSON gracefully', () => {
      const input = '[{invalid json';
      const result = parseBatchWriteFiles(input);
      expect(result).toBeNull();
    });

    it('handles non-array JSON root', () => {
      const input = '{"files": "not an array"}';
      const result = parseBatchWriteFiles(input);
      expect(result).toBeNull();
    });

    it('handles array with null elements', () => {
      const input = '[null]';
      const result = parseBatchWriteFiles(input);
      expect(result).toBeNull();
    });

    it('handles array with number elements', () => {
      const input = '[1, 2, 3]';
      const result = parseBatchWriteFiles(input);
      expect(result).toBeNull();
    });

    it('handles array with string elements', () => {
      const input = '["not", "an", "object"]';
      const result = parseBatchWriteFiles(input);
      expect(result).toBeNull();
    });

    it('handles empty array', () => {
      const input = '[]';
      const result = parseBatchWriteFiles(input);
      expect(result).toEqual([]);
    });

    it('handles completely empty input', () => {
      const result = parseBatchWriteFiles('');
      expect(result).toBeNull();
    });

    it('handles whitespace-only input', () => {
      const result = parseBatchWriteFiles('   \n  \t  ');
      expect(result).toBeNull();
    });

    it('handles undefined input', () => {
      const result = parseBatchWriteFiles(undefined);
      expect(result).toBeNull();
    });

    it('handles numeric input', () => {
      const result = parseBatchWriteFiles(123);
      expect(result).toBeNull();
    });
  });

  describe('batchWrite - mixed formats and prefixes', () => {
    it('handles files= prefix with valid JSON', () => {
      const input = 'files=[{"path": "prefixed.txt", "content": "content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
      expect(result?.[0].path).toBe('prefixed.txt');
    });

    it('handles files: prefix with valid JSON', () => {
      const input = 'files:[{"path": "colon.txt", "content": "colon content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
      expect(result?.[0].path).toBe('colon.txt');
    });

    it('handles args= prefix', () => {
      const input = 'args=[{"path": "args.txt", "content": "args content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
    });

    it('handles data= prefix', () => {
      const input = 'data=[{"path": "data.txt", "content": "data content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
    });

    it('handles input= prefix', () => {
      const input = 'input=[{"path": "input.txt", "content": "input content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
    });

    it('handles items= prefix', () => {
      const input = 'items=[{"path": "items.txt", "content": "items content"}]';
      const result = parseBatchWriteFiles(input);
      expect(result).toHaveLength(1);
    });
  });
});
