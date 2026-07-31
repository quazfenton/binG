/**
 * Tests for /opt/bing/web/lib/utils/canonical-json.ts
 *
 * Coverage (per audit thread MCP_TOOL_SELECTION_POSTAUDIT §canonical-json):
 *   1. Stable key ordering across key-insertion orderings
 *   2. Nested-object sort at every depth
 *   3. Array preservation vs object sort (arrays are NOT sorted)
 *   4. Circular reference detection (throws RangeError)
 *   5. Primitives (string / number / boolean / null) handling
 *   6. Top-level undefined returns undefined (matches JSON.stringify)
 *   7. Object values: undefined / functions / Symbols DROPPED (matches JSON.stringify)
 *   8. Array values: undefined / functions / Symbols become null (matches JSON.stringify)
 *   9-10. Circular reference detection
 *   11-12. Edge cases (empty object, mixed nested)
 *   13-15. Object-drop + array-null for functions/Symbols (new in 2026-07-16)
 */

// Tests 6 + 7 + 13 + 14 + 15 align with Option (a) (close the docblock-vs-impl
// drift): stableStringify mirrors JSON.stringify for undefined / functions /
// Symbols. See /opt/bing/.tickets/CANONICAL-JSON-DRIFT-FIX.md for closure context.

import { describe, it, expect } from 'vitest';
import { stableStringify } from '@/lib/utils/canonical-json';

describe('lib/utils/canonical-json', () => {
  describe('stableStringify — stable key ordering', () => {
    it('1. sorts keys alphabetically regardless of insertion order', () => {
      const a = { a: 1, b: 2, c: 3 };
      const b = { c: 3, a: 1, b: 2 };
      const c = { b: 2, c: 3, a: 1 };
      const expected = '{"a":1,"b":2,"c":3}';
      expect(stableStringify(a)).toBe(expected);
      expect(stableStringify(b)).toBe(expected);
      expect(stableStringify(c)).toBe(expected);
    });

    it('2. recursively sorts nested objects at every depth', () => {
      const nested1 = { z: { b: 2, a: 1 }, y: 0, x: { d: 4, c: { f: 6, e: 5 } } };
      const nested2 = { x: { c: { e: 5, f: 6 }, d: 4 }, y: 0, z: { a: 1, b: 2 } };
      const expected = '{"x":{"c":{"e":5,"f":6},"d":4},"y":0,"z":{"a":1,"b":2}}';
      expect(stableStringify(nested1)).toBe(expected);
      expect(stableStringify(nested2)).toBe(expected);
    });
  });

  describe('stableStringify — array preservation', () => {
    it('3. preserves array element order (does NOT sort arrays)', () => {
      expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
      expect(stableStringify([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
      expect(stableStringify([])).toBe('[]');
    });

    it('4. arrays nested inside objects are preserved, but object elements inside them are sorted', () => {
      expect(stableStringify({ list: [{ z: 1, a: 2 }, { y: 3, b: 4 }] }))
        .toBe('{"list":[{"a":2,"z":1},{"b":4,"y":3}]}');
    });
  });

  describe('stableStringify — primitive handling', () => {
    it('5. string / number / boolean / null pass through JSON.stringify', () => {
      expect(stableStringify('hello')).toBe('"hello"');
      expect(stableStringify(42)).toBe('42');
      expect(stableStringify(true)).toBe('true');
      expect(stableStringify(false)).toBe('false');
      expect(stableStringify(null)).toBe('null');
    });

    it('6. undefined as a top-level value returns undefined (JSON.stringify semantics)', () => {
      // Top-level: typeof undefined !== 'object', so JSON.stringify(undefined)
      // is returned directly. JSON.stringify(undefined) === undefined (the
      // primitive, not the string "undefined"). stableStringify mirrors this.
      expect(stableStringify(undefined)).toBeUndefined();
    });

    // Option (a) docblock-alignment: the implementation now mirrors
    // JSON.stringify semantics — undefined / functions / Symbols are DROPPED
    // from object keys, and become `null` inside arrays. This closes the
    // audit-ticket docblock-vs-impl drift (CANONICAL-JSON-DRIFT-FIX.md).
    it('7. undefined values inside an object are DROPPED (JSON.stringify parity)', () => {
      // Mirrors JSON.stringify: { a: 1, b: undefined } -> '{"a":1}' (b is dropped)
      expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
      expect(stableStringify({ a: undefined })).toBe('{}');
      expect(stableStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    });

    it('8. undefined inside arrays becomes null (JSON.stringify parity)', () => {
      // Mirrors JSON.stringify: [undefined, 1, undefined] -> '[null,1,null]'
      expect(stableStringify([undefined, 1, undefined])).toBe('[null,1,null]');
      expect(stableStringify([undefined])).toBe('[null]');
      expect(stableStringify([1, undefined, 2])).toBe('[1,null,2]');
    });

    it('13. function values inside an object are DROPPED (JSON.stringify parity)', () => {
      const fn = () => 'never called';
      expect(stableStringify({ a: 1, b: fn })).toBe('{"a":1}');
      expect(stableStringify({ a: fn, b: 2 })).toBe('{"b":2}');
    });

    it('14. Symbol values inside an object are DROPPED (JSON.stringify parity)', () => {
      expect(stableStringify({ a: 1, b: Symbol('x') })).toBe('{"a":1}');
      expect(stableStringify({ [Symbol.iterator]: 'x', a: 1 })).toBe('{"a":1}');
    });

    it('15. functions and Symbols inside arrays become null (JSON.stringify parity)', () => {
      const fn = () => 'never';
      expect(stableStringify([fn, 1, Symbol('x')])).toBe('[null,1,null]');
      expect(stableStringify([Symbol.iterator])).toBe('[null]');
    });
  });

  describe('stableStringify — circular reference detection', () => {
    it('9. throws RangeError on direct self-reference', () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      expect(() => stableStringify(obj)).toThrow(RangeError);
    });

    it('10. throws RangeError on indirect cycle', () => {
      const a: any = { name: 'a' };
      const b: any = { name: 'b', a };
      a.b = b;
      expect(() => stableStringify(a)).toThrow(RangeError);
    });
  });

  describe('stableStringify — edge cases', () => {
    it('11. empty object serializes to {}', () => {
      expect(stableStringify({})).toBe('{}');
    });

    it('12. mixed nested types preserve structure', () => {
      const input = {
        config: { timeout: 5000, retries: 3, tags: ['a', 'b'] },
        meta: { ts: 1234, ok: true },
      };
      // Verify deterministic output + structural correctness
      const out = stableStringify(input);
      expect(out).toBe('{"config":{"retries":3,"tags":["a","b"],"timeout":5000},"meta":{"ok":true,"ts":1234}}');
    });
  });
});