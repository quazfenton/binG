/**
 * Orchestrator structured-error unwrap helper contract test.
 *
 * The helper `unwrapStructuredToolError(raw: unknown): string | null` lives at
 * `/opt/bing/web/lib/mcp/orchestrator-error-unwrap.ts` and is the single
 * source of truth for the `[ORCHESTRATOR-UNWRAP]:` literal format. This
 * test pins the format so a future regression cannot silently change the
 * LLM-facing block (100+ `Unknown error — tool result has keys` log lines
 * vanished once the route began forwarding structured errors through this
 * helper; the test is the regression guard).
 *
 * Format spec
 * -----------
 *   [ORCHESTRATOR-UNWRAP]: <message>
 *   [error.code=<code>] [retryable=<bool>]
 *   → <correctedExample>      (omitted when undefined)
 *
 * The helper returns `null` for any input that does NOT pass the
 * `isStructuredMcpError` duck-type guard (non-object / non-string-message /
 * empty-message).
 */

import { describe, it, expect } from 'vitest';
import { unwrapStructuredToolError } from '@/lib/mcp/orchestrator-error-unwrap';

describe('orchestrator-error-unwrap helper', () => {
  describe('structured inputs → [ORCHESTRATOR-UNWRAP]: literal block', () => {
    it('full structured error: message + code + retryable + correctedExample', () => {
      const result = unwrapStructuredToolError({
        message: 'VFS write failed: ENOENT',
        code: 'ENOENT',
        retryable: false,
        correctedExample: 'Check the parent directory exists.',
      });
      expect(result).not.toBeNull();
      // The literal prefix is locked by the helper docblock — a regression
      // that drops the prefix must flip this assertion to a CI failure.
      expect(result!).toMatch(/^\[ORCHESTRATOR-UNWRAP\]: /);
      expect(result!).toContain('VFS write failed: ENOENT');
      expect(result!).toContain('[error.code=ENOENT]');
      expect(result!).toContain('[retryable=false]');
      expect(result!).toContain('\n→ Check the parent directory exists.');
    });

    it('structured error without correctedExample → no trailing example line', () => {
      const result = unwrapStructuredToolError({
        message: 'Tool error',
        code: 'STALL',
        retryable: true,
      });
      expect(result).not.toBeNull();
      expect(result!).toContain('[ORCHESTRATOR-UNWRAP]: Tool error');
      expect(result!).toContain('[error.code=STALL]');
      expect(result!).toContain('[retryable=true]');
      // No `→` arrow line when correctedExample absent.
      expect(result!).not.toContain('→');
    });

    it('code defaults to UNKNOWN when omitted', () => {
      const result = unwrapStructuredToolError({ message: 'm' });
      expect(result).not.toBeNull();
      expect(result!).toContain('[error.code=UNKNOWN]');
    });

    it('retryable defaults to false when not a boolean (e.g. truthy string)', () => {
      const result = unwrapStructuredToolError({
        message: 'm',
        retryable: 'yes' as unknown as boolean,
      });
      expect(result).not.toBeNull();
      expect(result!).toContain('[retryable=false]');
    });
  });

  describe('non-structured inputs → null', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['string', 'plain error string'],
      ['number', 42],
      ['boolean', true],
      ['array', [1, 2, 3]],
      ['empty object', {}],
      ['object with only non-message fields', { foo: 'bar' }],
      ['object with empty message string', { message: '' }],
      ['object with non-string message', { message: 123 }],
    ])('%s → null', (_label, value) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(unwrapStructuredToolError(value as any)).toBeNull();
    });
  });
});
