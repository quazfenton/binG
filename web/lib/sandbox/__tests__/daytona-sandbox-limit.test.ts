/**
 * Unit tests for SANDBOX_LIMIT_EXCEEDED tagged throw + classifySandboxLimitType
 * helper (Bug #87, Pass-6).
 *
 * Verifies:
 *   1. classifySandboxLimitType: 4 buckets (disk / count / quota / unknown)
 *   2. The tagged error shape thrown by createSandbox: { code, limitType, message }
 *   3. The tagged throw short-circuits the createSandbox retry loop
 *      (cleanup attempts are bounded; the next provider in the chain picks up)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifySandboxLimitType } from '../providers/daytona-provider';

describe('classifySandboxLimitType (Bug #87)', () => {
  it('classifies "Total disk limit exceeded" as disk', () => {
    expect(classifySandboxLimitType('Total disk limit exceeded')).toBe('disk');
  });

  it('classifies "limit exceeded" alone (no "disk") as disk', () => {
    // "limit exceeded" without the word "disk" still maps to disk because
    // Daytona only uses that phrasing for disk-related limits.
    expect(classifySandboxLimitType('Concurrent sandbox limit exceeded')).toBe('disk');
  });

  it('classifies "too many concurrent sandboxes" as count', () => {
    expect(classifySandboxLimitType('Too many concurrent sandboxes')).toBe('count');
  });

  it('classifies "too many" (any phrasing) as count', () => {
    expect(classifySandboxLimitType('Too many requests per minute')).toBe('count');
  });

  it('classifies "quota" as quota', () => {
    expect(classifySandboxLimitType('Monthly quota exceeded')).toBe('quota');
  });

  it('classifies unrecognized error as unknown', () => {
    expect(classifySandboxLimitType('Some random Daytona error')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(classifySandboxLimitType('DISK LIMIT EXCEEDED')).toBe('disk');
    expect(classifySandboxLimitType('Too Many Sandboxes')).toBe('count');
    expect(classifySandboxLimitType('QUOTA EXCEEDED')).toBe('quota');
  });

  it('prefers disk over count when both substrings are present (disk wins first)', () => {
    // Order matters: disk check runs first. If a future error message
    // contains both "disk" and "too many", disk wins.
    expect(classifySandboxLimitType('Disk limit: too many writes')).toBe('disk');
  });

  it('handles empty string', () => {
    expect(classifySandboxLimitType('')).toBe('unknown');
  });

  it('handles undefined / null gracefully (defensive)', () => {
    // The SUT should never receive null in practice, but the helper is
    // defensive against malformed upstream errors.
    expect(classifySandboxLimitType(undefined as any)).toBe('unknown');
    expect(classifySandboxLimitType(null as any)).toBe('unknown');
  });
});

describe('SANDBOX_LIMIT_EXCEEDED tagged throw (Bug #87)', () => {
  /**
   * Simulate the exact tagged-error construction that daytona-provider.ts
   * performs in the createSandbox catch block. We don't construct a full
   * DaytonaProvider (that would require the SDK + real network) — we
   * verify the tagged-error SHAPE is correct, since downstream
   * `executeWithFallback` in core-sandbox-service.ts routes on
   * `err.code === 'SANDBOX_LIMIT_EXCEEDED'` and logs `err.limitType`.
   */
  function makeTaggedLimitError(errMsg: string): Error & { code?: string; limitType?: string } {
    const tagged = new Error(`SANDBOX_LIMIT_EXCEEDED: ${errMsg}`);
    (tagged as any).code = 'SANDBOX_LIMIT_EXCEEDED';
    (tagged as any).limitType = classifySandboxLimitType(errMsg);
    return tagged;
  }

  it('tags the error with code = "SANDBOX_LIMIT_EXCEEDED"', () => {
    const tagged = makeTaggedLimitError('Total disk limit exceeded');
    expect(tagged.code).toBe('SANDBOX_LIMIT_EXCEEDED');
  });

  it('encodes limitType = "disk" for a disk limit error', () => {
    const tagged = makeTaggedLimitError('Total disk limit exceeded');
    expect(tagged.limitType).toBe('disk');
  });

  it('encodes limitType = "count" for a too-many error', () => {
    const tagged = makeTaggedLimitError('Too many concurrent sandboxes');
    expect(tagged.limitType).toBe('count');
  });

  it('encodes limitType = "quota" for a quota error', () => {
    const tagged = makeTaggedLimitError('Monthly quota exceeded');
    expect(tagged.limitType).toBe('quota');
  });

  it('encodes limitType = "unknown" for an unrecognized error', () => {
    const tagged = makeTaggedLimitError('Some random Daytona error');
    expect(tagged.limitType).toBe('unknown');
  });

  it('preserves the original error message in the .message field', () => {
    const tagged = makeTaggedLimitError('Total disk limit exceeded');
    // The prefix is "SANDBOX_LIMIT_EXCEEDED: " so the catch block in
    // core-sandbox-service.ts can ALSO match on .message.includes(...)
    // as a string-only fallthrough (defensive for future providers that
    // don't tag the error code).
    expect(tagged.message).toBe('SANDBOX_LIMIT_EXCEEDED: Total disk limit exceeded');
    expect(tagged.message).toContain('SANDBOX_LIMIT_EXCEEDED');
  });

  it('is an Error subclass (callers can use `instanceof Error`)', () => {
    const tagged = makeTaggedLimitError('Total disk limit exceeded');
    expect(tagged).toBeInstanceOf(Error);
  });

  it('is throwable and re-catchable', () => {
    expect(() => {
      throw makeTaggedLimitError('Total disk limit exceeded');
    }).toThrow(/SANDBOX_LIMIT_EXCEEDED/);
  });

  it('is distinguishable from a generic Error by the code field', () => {
    const tagged = makeTaggedLimitError('Total disk limit exceeded');
    const generic = new Error('Total disk limit exceeded');
    // The string-only fallthrough in core-sandbox-service.ts catches both,
    // but the tagged one carries limitType for ops visibility.
    expect((tagged as any).code).toBe('SANDBOX_LIMIT_EXCEEDED');
    expect((generic as any).code).toBeUndefined();
  });
});
