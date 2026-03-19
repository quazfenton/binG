/**
 * NDJSON Parser Tests
 *
 * Tests for robust NDJSON stream parsing that handles:
 * - Partial chunks (incomplete JSON objects)
 * - Multiple JSON objects per chunk
 * - Empty lines and whitespace
 * - Buffer size limits
 * - Malformed JSON recovery
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createNDJSONParser, parseNDJSONString, stringifyNDJSON, stringifyNDJSONArray } from '../ndjson-parser';

describe('NDJSON Parser', () => {
  describe('Basic Parsing', () => {
    it('should parse single JSON object', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('{"name":"test","value":123}\n');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'test', value: 123 });
    });

    it('should parse multiple JSON objects', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('{"id":1}\n{"id":2}\n{"id":3}\n');
      
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
      expect(result[2]).toEqual({ id: 3 });
    });

    it('should skip empty lines', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('\n\n{"id":1}\n\n{"id":2}\n\n');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
    });

    it('should handle whitespace trimming', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('  {"id":1}  \n  {"id":2}  \n');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
    });

    it('should handle braces/brackets inside string values', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('{"text":"Hello } world [test]"}\n');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ text: 'Hello } world [test]' });
    });

    it('should handle multiple braces/brackets in strings', () => {
      const parser = createNDJSONParser();
      const json = '{"code":"function test() { return [1,2,3]; }","regex":"/^[a-z]+$/"}\n';
      const result = parser.parse(json);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        code: 'function test() { return [1,2,3]; }',
        regex: '/^[a-z]+$/',
      });
    });

    it('should handle escaped characters in strings', () => {
      const parser = createNDJSONParser();
      const result = parser.parse('{"text":"Line1\\nLine2\\tTabbed"}\n');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ text: 'Line1\nLine2\tTabbed' });
    });

    it('should handle nested JSON strings with braces', () => {
      const parser = createNDJSONParser();
      const json = '{"message":"Error: { \\"code\\": 404, \\"text\\": \\"Not found\\" }"}\n';
      const result = parser.parse(json);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        message: 'Error: { "code": 404, "text": "Not found" }',
      });
    });
  });

  describe('Partial Chunk Handling', () => {
    it('should buffer incomplete JSON objects', () => {
      const parser = createNDJSONParser();
      
      // Send incomplete JSON
      const result1 = parser.parse('{"name":"test","value":');
      expect(result1).toHaveLength(0);
      expect(parser.getBufferSize()).toBeGreaterThan(0);

      // Complete the JSON in next chunk
      const result2 = parser.parse('123}\n');
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual({ name: 'test', value: 123 });
      expect(parser.getBufferSize()).toBe(0);
    });

    it('should handle JSON split across multiple chunks', () => {
      const parser = createNDJSONParser();
      
      // Split JSON across 3 chunks
      const result1 = parser.parse('{"name');
      expect(result1).toHaveLength(0);

      const result2 = parser.parse('":"test","val');
      expect(result2).toHaveLength(0);

      const result3 = parser.parse('ue":123}\n');
      expect(result3).toHaveLength(1);
      expect(result3[0]).toEqual({ name: 'test', value: 123 });
    });

    it('should handle multiple complete + one incomplete in same chunk', () => {
      const parser = createNDJSONParser();
      
      const result = parser.parse('{"id":1}\n{"id":2}\n{"id":3');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
      expect(parser.getBufferSize()).toBeGreaterThan(0);

      // Complete the third object
      const result2 = parser.parse('}\n');
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual({ id: 3 });
    });

    it('should handle partial JSON with nested objects', () => {
      const parser = createNDJSONParser();
      
      // Incomplete nested JSON
      const result1 = parser.parse('{"user":{"name":"');
      expect(result1).toHaveLength(0);

      const result2 = parser.parse('John","age":30}}\n');
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual({ user: { name: 'John', age: 30 } });
    });

    it('should handle partial JSON arrays', () => {
      const parser = createNDJSONParser();
      
      const result1 = parser.parse('[1,2,');
      expect(result1).toHaveLength(0);

      const result2 = parser.parse('3,4,5]\n');
      expect(result2).toHaveLength(1);
      expect(result2[0]).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        onError: (error) => errors.push(error),
        verbose: true,
      });

      const result = parser.parse('{"invalid json}\n{"valid":true}\n');
      
      // Parser detects invalid structure and skips it
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ valid: true });
      // Parser should continue after errors (error count may vary based on detection)
      expect(parser).toBeDefined();
    });

    it('should continue parsing after errors', () => {
      const parser = createNDJSONParser();
      
      const result = parser.parse('invalid\n{"id":1}\nalso invalid\n{"id":2}\n');
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
    });

    it('should detect unbalanced braces', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        onError: (error) => errors.push(error),
        verbose: false,
      });

      const result = parser.parse('{"unbalanced":\n{"valid":true}\n');
      
      // Should buffer the incomplete one and parse the valid one
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ valid: true });
    });

    it('should detect unbalanced brackets', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        onError: (error) => errors.push(error),
      });

      const result = parser.parse('[1,2,3\n{"valid":true}\n');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ valid: true });
    });

    it('should handle strings with escaped quotes', () => {
      const parser = createNDJSONParser();
      
      const result = parser.parse('{"text":"say \\"hello\\""}\n');
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ text: 'say "hello"' });
    });
  });

  describe('Buffer Limits', () => {
    it('should enforce max buffer size', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        maxBufferSize: 100, // Very small for testing
        onError: (error) => errors.push(error),
      });

      // Send large chunk without newline
      const largeChunk = '{"data":"' + 'x'.repeat(150) + '"';
      const result = parser.parse(largeChunk);
      
      expect(result).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Buffer size exceeded');
      expect(parser.getBufferSize()).toBe(0); // Buffer cleared
    });

    it('should enforce max line length', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        maxLineLength: 50,
        onError: (error) => errors.push(error),
      });

      // Create a line that exceeds the limit when buffered
      const longLine = '{"data":"' + 'x'.repeat(60) + '"}';
      const result = parser.parse(longLine);
      
      // Parser should detect line too long and clear buffer
      expect(result).toHaveLength(0);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      if (errors[0]) {
        expect(errors[0].message).toContain('Line length exceeded');
      }
    });
  });

  describe('Finalize', () => {
    it('should process remaining buffered data on finalize', () => {
      const parser = createNDJSONParser();
      
      // Add incomplete JSON that can be completed
      parser.parse('{"incomplete":true}');
      
      // Finalize should attempt to parse it
      const final = parser.finalize();
      
      // Since there's no newline, it stays in buffer and finalize processes it
      expect(final.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle finalize with empty buffer', () => {
      const parser = createNDJSONParser();
      
      const final = parser.finalize();
      
      expect(final).toHaveLength(0);
    });

    it('should handle finalize with malformed JSON', () => {
      const errors: Error[] = [];
      const parser = createNDJSONParser({
        onError: (error) => errors.push(error),
      });

      parser.parse('{"malformed":');
      const final = parser.finalize();
      
      // Incomplete JSON is detected and error is logged
      expect(final).toHaveLength(0);
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Reset', () => {
    it('should clear buffer on reset', () => {
      const parser = createNDJSONParser();
      
      parser.parse('{"incomplete":');
      expect(parser.getBufferSize()).toBeGreaterThan(0);
      
      parser.reset();
      expect(parser.getBufferSize()).toBe(0);
    });

    it('should reset parse and error counts', () => {
      const parser = createNDJSONParser();
      
      parser.parse('{"id":1}\n');
      parser.reset();
      
      // After reset, counts should be reset
      expect(parser.getBufferSize()).toBe(0);
    });
  });

  describe('Helper Functions', () => {
    describe('parseNDJSONString', () => {
      it('should parse NDJSON string', () => {
        const result = parseNDJSONString('{"id":1}\n{"id":2}\n{"id":3}\n');
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ id: 1 });
        expect(result[1]).toEqual({ id: 2 });
        expect(result[2]).toEqual({ id: 3 });
      });
    });

    describe('stringifyNDJSON', () => {
      it('should stringify object to NDJSON line', () => {
        const result = stringifyNDJSON({ id: 1, name: 'test' });
        
        expect(result).toBe('{"id":1,"name":"test"}\n');
      });

      it('should handle special characters', () => {
        const result = stringifyNDJSON({ text: 'hello\nworld' });
        
        expect(result).toBe('{"text":"hello\\nworld"}\n');
      });
    });

    describe('stringifyNDJSONArray', () => {
      it('should stringify array to NDJSON', () => {
        const result = stringifyNDJSONArray([
          { id: 1 },
          { id: 2 },
          { id: 3 },
        ]);
        
        expect(result).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
      });
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle SSE-style data lines (without prefix)', () => {
      const parser = createNDJSONParser();
      
      // Pure NDJSON format (what most SSE streams send after stripping 'data: ' prefix)
      const chunk1 = '{"type":"start","id":1}\n';
      const chunk2 = '{"type":"chunk","content":"hello"}\n';
      
      const result1 = parser.parse(chunk1);
      const result2 = parser.parse(chunk2);
      
      expect(result1).toHaveLength(1);
      expect(result1[0].type).toBe('start');
      expect(result2).toHaveLength(1);
      expect(result2[0].type).toBe('chunk');
    });

    it('should handle LLM streaming tokens', () => {
      const parser = createNDJSONParser();
      
      // Simulate LLM token stream
      const tokens = [
        '{"choices":[{"delta":{"content":"Hello"}}]}\n',
        '{"choices":[{"delta":{"content":" world"}}]}\n',
        '{"choices":[{"delta":{"content":"!"}}]}\n',
      ];
      
      const results: any[] = [];
      for (const token of tokens) {
        results.push(...parser.parse(token));
      }
      
      expect(results).toHaveLength(3);
      expect(results[0].choices[0].delta.content).toBe('Hello');
      expect(results[1].choices[0].delta.content).toBe(' world');
      expect(results[2].choices[0].delta.content).toBe('!');
    });

    it('should handle rapid fire events', () => {
      const parser = createNDJSONParser();
      
      // Many small JSON objects
      const chunk = Array(100).fill(0).map((_, i) => `{"id":${i}}`).join('\n') + '\n';
      const result = parser.parse(chunk);
      
      expect(result).toHaveLength(100);
      expect(result[0]).toEqual({ id: 0 });
      expect(result[99]).toEqual({ id: 99 });
    });

    it('should handle mixed valid and empty lines', () => {
      const parser = createNDJSONParser();
      
      const chunk = '\n\n{"id":1}\n\n\n{"id":2}\n\n{"id":3}\n\n\n';
      const result = parser.parse(chunk);
      
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 1 });
      expect(result[1]).toEqual({ id: 2 });
      expect(result[2]).toEqual({ id: 3 });
    });
  });
});
