import { describe, it, expect } from 'vitest';
import { parseRoleReason } from '../role-reason-parser';

describe('parseRoleReason', () => {
  describe('schema-compliant input', () => {
    it('parses `signal: x; expected: y` as structured', () => {
      const r = parseRoleReason('signal: cross-cutting design; expected: architect owns trade-offs');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('cross-cutting design');
      expect(r.expected).toBe('architect owns trade-offs');
      expect(r.wasSplit).toBe(true);
      expect(r.raw).toBe('signal: cross-cutting design; expected: architect owns trade-offs');
    });

    it('handles em-dash separators case-insensitively', () => {
      const r = parseRoleReason('Signal — recovery from prior failure; Expected — debugger digs into stack trace');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('recovery from prior failure');
      expect(r.expected).toBe('debugger digs into stack trace');
    });

    it('accepts ASCII hyphen separators with a single space', () => {
      const r = parseRoleReason('signal - cross-cutting; expected - planner breaks it down');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('cross-cutting');
      expect(r.expected).toBe('planner breaks it down');
    });

    it('accepts synoym substitution (trigger/will)', () => {
      const r = parseRoleReason('trigger: stack trace; will: debugger reproduces then roots it');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('stack trace');
      expect(r.expected).toBe('debugger reproduces then roots it');
    });

    it('accepts another synonym pair (because/should)', () => {
      const r = parseRoleReason('because: stack trace; should: debugger dig into root cause');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('stack trace');
      expect(r.expected).toBe('debugger dig into root cause');
    });

    it('handles uppercase input', () => {
      const r = parseRoleReason('SIGNAL: A; EXPECTED: B');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('A');
      expect(r.expected).toBe('B');
    });

    it('handles mixed case', () => {
      const r = parseRoleReason('Signal: A; ExPeCtEd: B');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('A');
      expect(r.expected).toBe('B');
    });

    it('handles equals sign separator', () => {
      const r = parseRoleReason('signal=foo; expected=bar');
      expect(r.confidence).toBe('structured');
      expect(r.signal).toBe('foo');
      expect(r.expected).toBe('bar');
    });
  });

  describe('semicolon-only split (LLM drops keyword prefixes)', () => {
    it('splits into signal + expected by position when both markers are absent', () => {
      const r = parseRoleReason('recovery from prior failure; debugger digs into stack trace');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('recovery from prior failure');
      expect(r.expected).toBe('debugger digs into stack trace');
      expect(r.wasSplit).toBe(true);
    });

    it('handles newline as phrase separator', () => {
      const r = parseRoleReason('recovery from prior failure\ndebugger digs into stack trace');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('recovery from prior failure');
      expect(r.expected).toBe('debugger digs into stack trace');
    });

    it('handles mixed case marker only on signal side', () => {
      const r = parseRoleReason('signal: failure recovery; debugger does root cause');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('failure recovery');
      expect(r.expected).toBe('debugger does root cause');
    });

    it('handles mixed case marker only on expected side', () => {
      const r = parseRoleReason('failure from prior tool call; expected: debugger does root cause');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('failure from prior tool call');
      expect(r.expected).toBe('debugger does root cause');
    });
  });

  describe('single-marker input', () => {
    it('parses signal marker without separator as partial', () => {
      const r = parseRoleReason('signal: cross-cutting multi-subsystem design');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('cross-cutting multi-subsystem design');
      expect(r.expected).toBeNull();
      expect(r.wasSplit).toBe(false);
    });

    it('parses expected marker without separator as partial', () => {
      const r = parseRoleReason('expected: debugger specializes in stack-trace analysis');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBeNull();
      expect(r.expected).toBe('debugger specializes in stack-trace analysis');
      expect(r.wasSplit).toBe(false);
    });

    it('parses signal marker with em-dash only (no expected)', () => {
      const r = parseRoleReason('trigger — failure recovery needed');
      expect(r.confidence).toBe('partial');
      expect(r.signal).toBe('failure recovery needed');
      expect(r.expected).toBeNull();
    });
  });

  describe('freeform input', () => {
    it('treats plain English without markers as freeform', () => {
      const r = parseRoleReason('I need a debugger because of the stack trace earlier');
      expect(r.confidence).toBe('freeform');
      expect(r.signal).toBe('I need a debugger because of the stack trace earlier');
      expect(r.expected).toBeNull();
      expect(r.wasSplit).toBe(false);
    });

    it('treats a single phrase with a keyword inside but no separator as freeform', () => {
      // `because` is a keyword, but with no separator we cannot extract a phrase
      // — the parser preserves the whole text as `signal` per the freeform rule.
      const r = parseRoleReason('debugger because stack');
      expect(r.confidence).toBe('freeform');
      expect(r.signal).toBe('debugger because stack');
      expect(r.expected).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null/empty for empty string', () => {
      const r = parseRoleReason('');
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe('');
      expect(r.signal).toBeNull();
      expect(r.expected).toBeNull();
      expect(r.wasSplit).toBe(false);
    });

    it('returns null/empty for whitespace-only string', () => {
      const r = parseRoleReason('   \n\t  ');
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe('');
      expect(r.signal).toBeNull();
      expect(r.expected).toBeNull();
    });

    it('returns null/empty for undefined input', () => {
      const r = parseRoleReason(undefined);
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe('');
      expect(r.signal).toBeNull();
      expect(r.expected).toBeNull();
    });

    it('returns null/empty for null input', () => {
      const r = parseRoleReason(null);
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe('');
    });

    it('coerces numbers to string without throwing', () => {
      const r = parseRoleReason(42);
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe('42');
      expect(r.signal).toBe('42');
    });

    it('handles only-semicolon input as empty phrases', () => {
      const r = parseRoleReason(';;;');
      // After filter of empty phrases, we have 0 phrases → falls into freeform
      expect(r.confidence).toBe('freeform');
      expect(r.raw).toBe(';;;');
      expect(r.signal).toBe(';;;');
    });

    it('does not throw on bizarre control characters', () => {
      expect(() => parseRoleReason('signal:\u0000foo; expected:\u0007bar')).not.toThrow();
      const r = parseRoleReason('signal:\u0000foo; expected:\u0007bar');
      expect(r.confidence).toBe('structured');
      expect(r.signal?.startsWith('foo')).toBe(true);
      expect(r.expected?.startsWith('bar')).toBe(true);
    });

    it('does not match keyword inside a longer word', () => {
      // "signaler" should NOT be matched as the `signal` keyword.
      const r = parseRoleReason('signaler: foo; expected: bar');
      expect(r.signal).toBe('foo');
      expect(r.expected).toBe('bar');
    });
  });

  describe('confidence taxonomy invariants', () => {
    it('structured rows always have both fields non-null', () => {
      const inputs = [
        'signal: x; expected: y',
        'Signal — X; Expected — Y',
        'SIGNAL: a; EXPECTED: b',
        'trigger: foo; will: bar',
        'because: baz; should: qux',
      ];
      for (const input of inputs) {
        const r = parseRoleReason(input);
        expect(r.confidence, `for input ${JSON.stringify(input)}`).toBe('structured');
        expect(r.signal).not.toBeNull();
        expect(r.expected).not.toBeNull();
      }
    });

    it('partial rows have at least one non-null field', () => {
      const inputs = [
        'signal: x',
        'expected: y',
        'x; y',
        'signal: a; plain phrase b',
        'plain phrase a; expected: b',
      ];
      for (const input of inputs) {
        const r = parseRoleReason(input);
        expect(r.confidence, `for input ${JSON.stringify(input)}`).toBe('partial');
        expect(r.signal !== null || r.expected !== null).toBe(true);
      }
    });
  });
});
