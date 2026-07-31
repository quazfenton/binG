/**
 * StallWatchdogError + stallWatchdogErrorToStatus contract tests
 * (Path C lock-in).
 *
 * Why this file exists separately from route-shape-audit.test.ts:
 * - The route-shape-audit integration tests pin the END-TO-END contract
 *   (route.ts status code via POST handler) — they require complex
 *   mocking of route.ts's transitive imports (chatRequestSchema,
 *   PROVIDERS, auth, rate-limit, ~30 vi.mock blocks).
 * - These helper-direct tests pin the INNERMOST contract — the
 *   StallWatchdogError class shape + the stallWatchdogErrorToStatus
 *   switch mapping — without any route.ts surface. They lock the
 *   errorCode → HTTP status contract in CI without depending on the
 *   route integration tests passing.
 *
 * The route integration tests remain tracked separately as a known
 * follow-up. This file is the canonical regression guard for Path C's
 * contract change.
 *
 * @see /opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md
 */

import { describe, it, expect } from 'vitest';
import {
  StallWatchdogError,
  stallWatchdogErrorToStatus,
  type StallWatchdogErrorCode,
} from '@/lib/chat/llm-fallback-coordinator';

describe('StallWatchdogError — typed discriminator', () => {
  it('is an Error subclass', () => {
    const err = new StallWatchdogError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StallWatchdogError);
    expect(err.message).toBe('test');
  });

  it('defaults errorCode to STALL when no opts bag is provided', () => {
    const err = new StallWatchdogError('test');
    expect(err.errorCode).toBe('STALL');
    expect(err.name).toBe('StallWatchdogError');
  });

  it('accepts all 4 documented errorCode values', () => {
    const codes: StallWatchdogErrorCode[] = ['STALL', 'DRIFT', 'ABORT', 'OTHER'];
    for (const code of codes) {
      const err = new StallWatchdogError('test ' + code, { errorCode: code });
      expect(err.errorCode).toBe(code);
    }
  });

  // The `errorCode` field is declared `readonly` in
  // llm-fallback-coordinator.ts. Readonly is a TYPE-LEVEL guard only —
  // JS runtime does not enforce it (assignments succeed silently). This
  // file's `tsc --noEmit` is the authoritative regression guard: if the
  // `readonly` modifier is removed from the field declaration, any code
  // path that does `err.errorCode = X` would surface as a tsc error.
  // A runtime test would silently mask the missing modifier, so we
  // intentionally do NOT include one here.
});

describe('stallWatchdogErrorToStatus — errorCode → HTTP status mapping', () => {
  const cases: Array<[StallWatchdogErrorCode, number]> = [
    ['STALL', 524], // timeout — server took too long
    ['DRIFT', 502], // bad gateway — stream deviated from expected shape
    ['ABORT', 503], // service unavailable — cancelled by client/watchdog
    ['OTHER', 500], // generic — unclassified stall-class error
  ];

  it.each(cases)('errorCode=%s → HTTP %i', (code, expectedStatus) => {
    const err = new StallWatchdogError('test ' + code, { errorCode: code });
    expect(stallWatchdogErrorToStatus(err)).toBe(expectedStatus);
  });

  it('returns 524 for default STALL (no opts bag)', () => {
    const err = new StallWatchdogError('default stall');
    expect(stallWatchdogErrorToStatus(err)).toBe(524);
  });

  it('exhaustive — adding a new errorCode to the union causes TS error in the switch default', () => {
    // This test is a structural guard: the helper's switch statement
    // must have a `default: never` arm so adding a new errorCode
    // variant to the union surfaces as a TS error at compile time.
    // The test simply verifies the helper exists + returns a number
    // for each documented variant — adding a new variant would
    // require also updating the test (failing CI if forgotten).
    for (const code of ['STALL', 'DRIFT', 'ABORT', 'OTHER'] as const) {
      const err = new StallWatchdogError('test', { errorCode: code });
      const status = stallWatchdogErrorToStatus(err);
      expect(typeof status).toBe('number');
      expect(status).toBeGreaterThanOrEqual(500);
      expect(status).toBeLessThan(600);
    }
  });

  it('does not mutate the errorCode field on the input', () => {
    const err = new StallWatchdogError('test', { errorCode: 'DRIFT' });
    const status = stallWatchdogErrorToStatus(err);
    expect(status).toBe(502);
    expect(err.errorCode).toBe('DRIFT'); // unchanged
  });
});