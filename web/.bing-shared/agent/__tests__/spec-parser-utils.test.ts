/**
 * Unit Tests for extractFirstJsonObject, tryRepairJson,
 * removeTrailingCommas, and stripJsonComments from spec-parser-utils.ts
 *
 * Covers JSON extraction, repair, and comment stripping logic used by
 * the first-response-routing parser and other shared-agent modules.
 */

import { describe, it, expect } from 'vitest';
import {
  extractFirstJsonObject,
  tryRepairJson,
  removeTrailingCommas,
  stripJsonComments,
} from '../spec-parser-utils';

// ─── removeTrailingCommas ─────────────────────────────────────────────

describe('removeTrailingCommas', () => {
  it('should remove trailing comma before }', () => {
    expect(removeTrailingCommas('{"a":1,}')).toBe('{"a":1}');
  });

  it('should remove trailing comma before ]', () => {
    expect(removeTrailingCommas('[1,2,]')).toBe('[1,2]');
  });

  it('should remove trailing comma with whitespace before }', () => {
    expect(removeTrailingCommas('{"a":1,  }')).toBe('{"a":1  }');
  });

  it('should remove trailing comma with newline before ]', () => {
    expect(removeTrailingCommas('[1,\n]')).toBe('[1\n]');
  });

  it('should handle multiple trailing commas in nested structures', () => {
    const input = '{"a":[1,],"b":{"c":2,},}';
    const result = removeTrailingCommas(input);
    expect(result).toBe('{"a":[1],"b":{"c":2}}');
  });

  it('should not remove non-trailing commas', () => {
    expect(removeTrailingCommas('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
  });

  it('should handle empty string', () => {
    expect(removeTrailingCommas('')).toBe('');
  });

  it('should handle string with no braces or brackets', () => {
    expect(removeTrailingCommas('hello world')).toBe('hello world');
  });

  it('should NOT remove trailing comma inside a string (string-aware)', () => {
    // The function is now string-aware — commas inside quoted strings are preserved.
    const input = '{"text":"hello, }"}';
    const result = removeTrailingCommas(input);
    expect(result).toBe('{"text":"hello, }"}');
  });

  it('should preserve commas inside string values in multi-property objects', () => {
    // A more realistic scenario: commas inside string values are not removed.
    const input = '{"text":"a, }","next":1}';
    const result = removeTrailingCommas(input);
    expect(result).toBe('{"text":"a, }","next":1}');
  });

  it('should handle escaped quotes inside strings correctly', () => {
    // A comma before } that appears after an escaped quote should not be removed
    const input = '{"text":"he said \"hello\", }"}';
    const result = removeTrailingCommas(input);
    expect(result).toBe('{"text":"he said \"hello\", }"}');
  });
});

// ─── stripJsonComments ───────────────────────────────────────────────

describe('stripJsonComments', () => {
  it('should remove single-line comments', () => {
    expect(stripJsonComments('{"a":1} // comment')).toBe('{"a":1} ');
  });

  it('should remove single-line comments at start of line', () => {
    expect(stripJsonComments('// comment\n{"a":1}')).toBe('\n{"a":1}');
  });

  it('should remove block comments', () => {
    expect(stripJsonComments('{"a":1}/* comment */')).toBe('{"a":1}');
  });

  it('should remove multi-line block comments', () => {
    expect(stripJsonComments('{"a":1}/* line1\nline2 */')).toBe('{"a":1}');
  });

  it('should remove both single-line and block comments', () => {
    const input = '{"a":1} // line comment\n{"b":2}/* block */';
    const result = stripJsonComments(input);
    expect(result).toBe('{"a":1} \n{"b":2}');
  });

  it('should handle empty string', () => {
    expect(stripJsonComments('')).toBe('');
  });

  it('should handle string with no comments', () => {
    expect(stripJsonComments('{"a":1}')).toBe('{"a":1}');
  });

  it('should handle multiple single-line comments', () => {
    const input = '// first\n{"a":1} // second\n// third';
    const result = stripJsonComments(input);
    expect(result).toBe('\n{"a":1} \n');
  });

  it('should remove inline block comment between properties', () => {
    const input = '{"a":1}/* inline */,"b":2';
    const result = stripJsonComments(input);
    expect(result).toBe('{"a":1},"b":2');
  });

  it('should preserve // inside string literals (string-aware)', () => {
    // The function is now string-aware — // inside quoted strings is not treated as a comment.
    // URLs like "https://example.com" are preserved intact.
    const input = '{"url":"https://example.com"}';
    const result = stripJsonComments(input);
    expect(result).toBe('{"url":"https://example.com"}');
  });

  it('should preserve /* inside string literals (string-aware)', () => {
    // Block-comment start inside a quoted string is not treated as a comment.
    const input = '{"text":"/* not a comment */"}';
    const result = stripJsonComments(input);
    expect(result).toBe('{"text":"/* not a comment */"}');
  });

  it('should handle escaped quotes inside strings correctly', () => {
    // In JSON, \" is an escaped quote that does NOT close the string.
    // So // after an escaped quote is still inside the string literal.
    // In the JS string below, \\ represents a single backslash in the raw string,
    // so \\\" in JS produces \" in the actual string (a JSON-escaped quote).
    const input = '{"text":"line1\\" // still in string"} // real comment';
    const result = stripJsonComments(input);
    expect(result).toBe('{"text":"line1\\" // still in string"} ');
  });
});

// ─── tryRepairJson ─────────────────────────────────────────────────────

describe('tryRepairJson', () => {
  it('should strip comments and remove trailing commas', () => {
    const input = '{"a":1, // comment\n"b":2,}';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":1, \n"b":2}');
  });

  it('should handle trailing commas without comments', () => {
    const input = '{"a":1,}';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":1}');
  });

  it('should handle comments without trailing commas', () => {
    const input = '{"a":1} // comment';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":1} ');
  });

  it('should handle block comments with trailing commas', () => {
    // Input: {"a":1,/* comment */"b":[2,],}
    // After stripJsonComments: {"a":1,"b":[2,],}
    // After removeTrailingCommas: removes , before ] and , before }
    const input = '{"a":1,/* comment */"b":[2,],}';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":1,"b":[2]}');
  });

  it('should return valid JSON for typical LLM output with both issues', () => {
    const input = `{
      "classification": "code", // task type
      "complexity": "low",
      "items": [1, 2,],
    }`;
    const result = tryRepairJson(input);
    // After stripping comments and trailing commas, should be parseable
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should handle empty string', () => {
    expect(tryRepairJson('')).toBe('');
  });

  it('should handle already-valid JSON', () => {
    const input = '{"a":1,"b":2}';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('should handle nested trailing commas', () => {
    const input = '{"a":{"b":1,},"c":[3,],}';
    const result = tryRepairJson(input);
    expect(result).toBe('{"a":{"b":1},"c":[3]}');
  });
});

// ─── extractFirstJsonObject ─────────────────────────────────────────────

describe('extractFirstJsonObject', () => {
  describe('returns null when no JSON object found', () => {
    it('should return null for empty string', () => {
      expect(extractFirstJsonObject('')).toBeNull();
    });

    it('should return null for plain text', () => {
      expect(extractFirstJsonObject('hello world')).toBeNull();
    });

    it('should return null for unbalanced braces (only opening)', () => {
      expect(extractFirstJsonObject('{')).toBeNull();
    });

    it('should return null for unbalanced braces (multiple opening)', () => {
      expect(extractFirstJsonObject('{{')).toBeNull();
    });

    it('should return null for array only', () => {
      expect(extractFirstJsonObject('[1,2,3]')).toBeNull();
    });

    it('should skip leading closing brace and extract the following object', () => {
      // The first } doesn't trigger a return (start=-1), then {} is extracted.
      expect(extractFirstJsonObject('}{}')).toBe('{}');
    });
  });

  describe('extracts simple JSON objects', () => {
    it('should extract an empty object', () => {
      expect(extractFirstJsonObject('{}')).toBe('{}');
    });

    it('should extract a simple object', () => {
      expect(extractFirstJsonObject('{"a":1}')).toBe('{"a":1}');
    });

    it('should extract object surrounded by text', () => {
      expect(extractFirstJsonObject('before {"a":1} after')).toBe('{"a":1}');
    });

    it('should extract object after whitespace', () => {
      expect(extractFirstJsonObject('   \n  {"a":1}')).toBe('{"a":1}');
    });

    it('should extract the first of multiple objects', () => {
      expect(extractFirstJsonObject('{"a":1}{"b":2}')).toBe('{"a":1}');
    });
  });

  describe('extracts nested JSON objects', () => {
    it('should extract a nested object', () => {
      const input = '{"a":{"b":2}}';
      expect(extractFirstJsonObject(input)).toBe('{"a":{"b":2}}');
    });

    it('should extract deeply nested objects', () => {
      const input = '{"a":{"b":{"c":{"d":1}}}}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should extract object with nested array containing objects', () => {
      const input = '{"items":[{"x":1},{"y":2}]}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle mixed nesting', () => {
      const input = '{"a":[1,{"b":2},3],"c":{"d":4}}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });
  });

  describe('handles braces inside string literals', () => {
    it('should not count braces inside double-quoted strings', () => {
      const input = '{"text":"{not an object}"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle unbalanced braces in strings', () => {
      const input = '{"text":"{only opening"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle closing brace in string', () => {
      const input = '{"text":"only closing}"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle multiple braces in string', () => {
      const input = '{"text":"{a}{b}{c}"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle escaped quotes inside strings', () => {
      const input = '{"text":"He said \\"hello\\""}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle escaped backslash before quote', () => {
      const input = '{"path":"C:\\\\Users\\\\"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should handle escaped backslash at end of string', () => {
      const input = '{"text":"end\\\\"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });
  });

  describe('handles real-world LLM output patterns', () => {
    it('should extract JSON after a marker tag', () => {
      const input = '[ROUTING_METADATA]\n{"classification":"code","complexity":"low"}';
      const result = extractFirstJsonObject(input);
      expect(result).toBe('{"classification":"code","complexity":"low"}');
    });

    it('should extract JSON with text before and after', () => {
      const input = 'Here is the result:\n{"status":"ok"}\nDone.';
      const result = extractFirstJsonObject(input);
      expect(result).toBe('{"status":"ok"}');
    });

    it('should extract JSON with array values', () => {
      const input = '{"items":[1,2,3],"name":"test"}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should extract JSON with boolean and null values', () => {
      const input = '{"active":true,"deleted":false,"parent":null}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should extract JSON with number values', () => {
      const input = '{"count":42,"ratio":3.14,"negative":-1}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });

    it('should extract JSON with nested empty objects and arrays', () => {
      const input = '{"a":{},"b":[],"c":{"d":[]}}';
      expect(extractFirstJsonObject(input)).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('should handle object starting at the very end of string', () => {
      // Unbalanced — only opening brace at end
      expect(extractFirstJsonObject('text {')).toBeNull();
    });

    it('should handle braces inside code fences', () => {
      // The function doesn't understand code fences — it just tracks braces
      const input = '```json\n{"a":1}\n```';
      const result = extractFirstJsonObject(input);
      expect(result).toBe('{"a":1}');
    });

    it('should handle single-character object', () => {
      // Not a valid JSON object, but the extractor finds balanced braces
      expect(extractFirstJsonObject('{}}')).toBe('{}');
    });

    it('should return the substring from first { to matching }', () => {
      const input = 'prefix {"a":{"b":2}} suffix {"c":3}';
      const result = extractFirstJsonObject(input);
      expect(result).toBe('{"a":{"b":2}}');
    });

    it('should handle very long JSON', () => {
      const longValue = 'x'.repeat(10000);
      const input = `{"data":"${longValue}"}`;
      expect(extractFirstJsonObject(input)).toBe(input);
    });
  });
});
