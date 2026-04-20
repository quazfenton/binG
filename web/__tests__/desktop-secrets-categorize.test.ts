/**
 * Unit tests for categorizeError() in packages/platform/src/secrets/desktop.ts
 *
 * Validates that error objects are correctly classified into:
 *   - TAURI_UNAVAILABLE: Tauri runtime not present (safe to fall back to web secrets)
 *   - NOT_FOUND: Requested key doesn't exist (expected, return null / no-op)
 *   - TAURI_ERROR: Tauri is loaded but the command failed (keychain locked, permission denied, etc.)
 */

import { describe, it, expect } from 'vitest';
import { categorizeError, type SecretErrorCategory } from '@bing/platform/secrets/desktop';

// ---------------------------------------------------------------------------
// TAURI_UNAVAILABLE — Tauri runtime is absent or unreachable
// ---------------------------------------------------------------------------

describe('categorizeError → TAURI_UNAVAILABLE', () => {
  it('detects synthetic "Tauri invoke is unavailable" Error', () => {
    const result = categorizeError(new Error('Tauri invoke is unavailable'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects "Failed to fetch dynamically imported module" from bundler', () => {
    const result = categorizeError(new Error('Failed to fetch dynamically imported module: @tauri-apps/api/core'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects "window is not defined" during SSR', () => {
    const result = categorizeError(new Error('window is not defined'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects TypeError with "import" in message', () => {
    const result = categorizeError(new TypeError('error while dynamically importing module'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects TypeError with "load" in message', () => {
    const result = categorizeError(new TypeError('failed to load module'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects TypeError with "module" in message', () => {
    // NOTE: The message must NOT contain "not found" (case-sensitive) or
    // "NotFound", because those are checked first and would return NOT_FOUND.
    const result = categorizeError(new TypeError('module resolution failed'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects TypeError with "fetch" in message (case-insensitive)', () => {
    const result = categorizeError(new TypeError('Fetch failed'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('does NOT categorize a plain TypeError without import/load/module/fetch as TAURI_UNAVAILABLE', () => {
    // e.g. passing wrong arguments to invoke() — should be TAURI_ERROR
    const result = categorizeError(new TypeError('Cannot read properties of undefined'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('detects string error "Tauri invoke is unavailable"', () => {
    const result = categorizeError('Tauri invoke is unavailable');
    expect(result).toBe('TAURI_UNAVAILABLE');
  });

  it('detects string error containing "window is not defined"', () => {
    const result = categorizeError('ReferenceError: window is not defined');
    expect(result).toBe('TAURI_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// NOT_FOUND — The requested secret key does not exist
// ---------------------------------------------------------------------------

describe('categorizeError → NOT_FOUND', () => {
  it('detects "not found" in lowercase', () => {
    const result = categorizeError(new Error('Key not found in keychain'));
    expect(result).toBe('NOT_FOUND');
  });

  it('detects "NotFound" in PascalCase', () => {
    const result = categorizeError(new Error('SecretNotFound'));
    expect(result).toBe('NOT_FOUND');
  });

  it('is case-sensitive: "Not Found" with space does NOT match', () => {
    // The function checks for 'not found' (lowercase) and 'NotFound' (PascalCase).
    // "Not Found" with a capital N and space would NOT match either substring.
    const result = categorizeError(new Error('Not Found'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('detects string error with "not found"', () => {
    const result = categorizeError('not found');
    expect(result).toBe('NOT_FOUND');
  });

  it('detects string error with "NotFound"', () => {
    const result = categorizeError('NotFound');
    expect(result).toBe('NOT_FOUND');
  });

  it('NOT_FOUND takes priority over TAURI_UNAVAILABLE patterns', () => {
    // An error containing both "not found" and "Tauri invoke is unavailable"
    // should be categorized as NOT_FOUND since that check comes first.
    const result = categorizeError(new Error('not found: Tauri invoke is unavailable'));
    expect(result).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// TAURI_ERROR — Tauri is loaded but the command failed
// ---------------------------------------------------------------------------

describe('categorizeError → TAURI_ERROR', () => {
  it('categorizes generic Error as TAURI_ERROR', () => {
    const result = categorizeError(new Error('Permission denied'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes keychain locked error', () => {
    const result = categorizeError(new Error('The keychain is locked'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes OS permission error', () => {
    const result = categorizeError(new Error('Access denied to credential store'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes TypeError without import/load/module/fetch as TAURI_ERROR', () => {
    // A TypeError from wrong argument types to invoke() should NOT be
    // mis-categorized as TAURI_UNAVAILABLE.
    const result = categorizeError(new TypeError('undefined is not a function'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes RangeError as TAURI_ERROR', () => {
    const result = categorizeError(new RangeError('Maximum call stack size exceeded'));
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes non-Error objects as TAURI_ERROR', () => {
    const result = categorizeError({ code: 'ERR_UNKNOWN', message: 'something broke' });
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes number thrown as error', () => {
    const result = categorizeError(42);
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes null as TAURI_ERROR', () => {
    const result = categorizeError(null);
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes undefined as TAURI_ERROR', () => {
    const result = categorizeError(undefined);
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes empty string as TAURI_ERROR', () => {
    const result = categorizeError('');
    expect(result).toBe('TAURI_ERROR');
  });

  it('categorizes Tauri command execution error', () => {
    const result = categorizeError(new Error('Command get_secret failed with code 1'));
    expect(result).toBe('TAURI_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Edge cases & priority ordering
// ---------------------------------------------------------------------------

describe('categorizeError → edge cases', () => {
  it('NOT_FOUND check runs before TAURI_UNAVAILABLE check', () => {
    // If a message contains both "not found" and "Tauri invoke is unavailable",
    // NOT_FOUND should win because it's checked first in the function body.
    const result = categorizeError(new Error('not found — Tauri invoke is unavailable'));
    expect(result).toBe('NOT_FOUND');
  });

  it('Error with empty message is TAURI_ERROR', () => {
    const result = categorizeError(new Error(''));
    expect(result).toBe('TAURI_ERROR');
  });

  it('String "not found" takes precedence over being a plain string', () => {
    // A bare string "not found" should be NOT_FOUND, not TAURI_ERROR
    const result = categorizeError('not found');
    expect(result).toBe('NOT_FOUND');
  });

  it('Error message with partial match "not foundry" still counts as NOT_FOUND', () => {
    // "not found" is a substring match — "not foundry" contains "not found"
    const result = categorizeError(new Error('not foundry'));
    expect(result).toBe('NOT_FOUND');
  });

  it('TypeError with mixed-case "IMPORT" in message is still TAURI_UNAVAILABLE', () => {
    // The regex uses /i flag for case-insensitive matching
    const result = categorizeError(new TypeError('IMPORT resolution failed'));
    expect(result).toBe('TAURI_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Return type constraint
// ---------------------------------------------------------------------------

describe('categorizeError → return type', () => {
  it('always returns a valid SecretErrorCategory', () => {
    const inputs: unknown[] = [
      new Error('anything'),
      'a string',
      null,
      undefined,
      42,
      { foo: 'bar' },
      new TypeError('import failed'),
      new Error('not found'),
      new Error('Tauri invoke is unavailable'),
    ];

    const validCategories: Set<SecretErrorCategory> = new Set(['TAURI_UNAVAILABLE', 'NOT_FOUND', 'TAURI_ERROR']);

    for (const input of inputs) {
      const result = categorizeError(input);
      expect(validCategories.has(result)).toBe(true);
    }
  });
});
