/**
 * Pure calculator arithmetic logic.
 *
 * Extracted from calculator-plugin.tsx so it can be unit-tested
 * independently of React state.
 */

/**
 * Perform a binary arithmetic operation.
 *
 * Returns `NaN` for division by zero instead of throwing,
 * so the caller can detect and surface an "Error" state.
 */
export function calculate(firstValue: number, secondValue: number, operation: string): number {
  switch (operation) {
    case '+':
      return firstValue + secondValue;
    case '-':
      return firstValue - secondValue;
    case '×':
      return firstValue * secondValue;
    case '÷':
      if (secondValue === 0) {
        return NaN; // caller should check isFinite()
      }
      return firstValue / secondValue;
    case '=':
      return secondValue;
    default:
      return secondValue;
  }
}

/**
 * Returns true when the value is a finite number suitable for display.
 * Rejects NaN, +Infinity, -Infinity.
 */
export function isValidResult(value: number): boolean {
  return isFinite(value);
}
