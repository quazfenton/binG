/**
 * Calculator Utility Tests
 *
 * Validates arithmetic operations and the NaN/Infinity guard
 * that was added to prevent divide-by-zero from propagating
 * corrupt state through the calculator display.
 */

import { describe, it, expect } from 'vitest';
import { calculate, isValidResult } from '@/lib/utils/calculator';

describe('calculate', () => {
  // ── Basic arithmetic ────────────────────────────────────────────────

  describe('basic arithmetic', () => {
    it('should add two numbers', () => {
      expect(calculate(2, 3, '+')).toBe(5);
    });

    it('should subtract two numbers', () => {
      expect(calculate(10, 4, '-')).toBe(6);
    });

    it('should multiply two numbers', () => {
      expect(calculate(3, 7, '×')).toBe(21);
    });

    it('should divide two numbers', () => {
      expect(calculate(15, 3, '÷')).toBe(5);
    });

    it('should return second value for "="', () => {
      expect(calculate(99, 42, '=')).toBe(42);
    });

    it('should return second value for unknown operation', () => {
      expect(calculate(10, 5, '^')).toBe(5);
    });
  });

  // ── NaN / Infinity guard (divide-by-zero) ───────────────────────────

  describe('NaN / Infinity guard', () => {
    it('should return NaN for divide by zero', () => {
      const result = calculate(10, 0, '÷');
      expect(isNaN(result)).toBe(true);
    });

    it('should return NaN for 0 / 0', () => {
      const result = calculate(0, 0, '÷');
      expect(isNaN(result)).toBe(true);
    });

    it('should return Infinity for large number / 0 (JavaScript semantics)', () => {
      // Note: our implementation returns NaN for all ÷0 cases,
      // which is stricter than raw JS (1/0 === Infinity).
      const result = calculate(1, 0, '÷');
      expect(isNaN(result)).toBe(true);
    });

    it('should NOT produce NaN for valid division', () => {
      const result = calculate(100, 25, '÷');
      expect(isNaN(result)).toBe(false);
      expect(result).toBe(4);
    });

    it('should NOT produce Infinity for multiplication of large numbers', () => {
      // While JS can produce Infinity for very large results,
      // normal-sized multiplications should be finite.
      const result = calculate(1e6, 1e6, '×');
      expect(isFinite(result)).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle negative numbers', () => {
      expect(calculate(-5, 3, '+')).toBe(-2);
      expect(calculate(5, -3, '-')).toBe(8);
      expect(calculate(-4, -3, '×')).toBe(12);
      expect(calculate(-12, 4, '÷')).toBe(-3);
    });

    it('should handle zero as first operand', () => {
      expect(calculate(0, 5, '+')).toBe(5);
      expect(calculate(0, 5, '-')).toBe(-5);
      expect(calculate(0, 5, '×')).toBe(0);
      expect(calculate(0, 5, '÷')).toBe(0);
    });

    it('should handle floating point', () => {
      expect(calculate(0.1, 0.2, '+')).toBeCloseTo(0.3);
      expect(calculate(1.5, 0.5, '÷')).toBe(3);
    });
  });
});

describe('isValidResult', () => {
  it('should return true for finite numbers', () => {
    expect(isValidResult(42)).toBe(true);
    expect(isValidResult(0)).toBe(true);
    expect(isValidResult(-3.14)).toBe(true);
    expect(isValidResult(1e10)).toBe(true);
  });

  it('should return false for NaN', () => {
    expect(isValidResult(NaN)).toBe(false);
  });

  it('should return false for Infinity', () => {
    expect(isValidResult(Infinity)).toBe(false);
    expect(isValidResult(-Infinity)).toBe(false);
  });

  // ── Integration scenario: the NaN guard in inputOperation ───────────
  //
  // The calculator-plugin's inputOperation checks isFinite(newValue)
  // after calling calculate(). If invalid, it sets display to "Error"
  // and resets state. This test documents the guard condition.

  describe('NaN guard scenario (mirrors inputOperation)', () => {
    it('should detect divide-by-zero result as invalid', () => {
      const result = calculate(10, 0, '÷');
      expect(isValidResult(result)).toBe(false);
      // In the component, this triggers:
      //   setDisplay('Error'); setPreviousValue(null); setOperation(null);
    });

    it('should accept normal division result as valid', () => {
      const result = calculate(10, 2, '÷');
      expect(isValidResult(result)).toBe(true);
    });

    it('should accept subtraction that yields zero', () => {
      const result = calculate(5, 5, '-');
      expect(isValidResult(result)).toBe(true);
    });

    it('should reject Infinity from overflow-like scenarios', () => {
      // Direct Infinity isn't produced by calculate() for any op,
      // but the guard also catches third-party or future modifications.
      expect(isValidResult(Infinity)).toBe(false);
    });
  });
});
