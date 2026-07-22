/**
 * Bug #83 (Pass-6 audit) — classifyToolResult unit tests.
 *
 * The old heuristic in `streamWithVercelAI` synthesised an "Unknown error"
 * string whenever the `error` field was truthy/non-null, which mis-classified
 * successful tool results like `{ success: true, output, exitCode: 0, error: null,
 * _recoveryHint }` as failures. The new `classifyToolResult` helper inverts
 * the priority: an explicit `success` field is authoritative and recovery
 * hints enrich genuine failures instead of hiding them.
 *
 * These tests cover the 4 cases the audit specified:
 *   1. success=true with error=null  → success
 *   2. success=false with error set → failure
 *   3. success=true with _recoveryHint → success
 *   4. success=false with _recoveryHint → failure with actionable context
 * Plus a few extra regression cases (no success field, error object, etc.)
 * to lock in the legacy fallback path.
 */

import { describe, it, expect } from 'vitest';
import { classifyToolResult } from '../vercel-ai-streaming';

describe('classifyToolResult (Bug #83)', () => {
  // ── The 4 audit-specified cases ─────────────────────────────────────────

  it('case 1: success=true with error=null is SUCCESS', () => {
    // The headline bug: bash_execute and similar tools return
    // { success: true, output, exitCode, error: null, _recoveryHint } on
    // success. The old code treated the explicit `null` error as a
    // failure and synthesised an "Unknown error" string.
    const result = classifyToolResult({
      success: true,
      output: 'hello world',
      exitCode: 0,
      error: null,
      _recoveryHint: 'use write_file for next time',
    });
    expect(result.isFailure).toBe(false);
    if (!result.isFailure) {
      expect(result.reason).toBe('success_true');
    }
  });

  it('case 2: success=false with error set is FAILURE', () => {
    // The classic genuine failure: tool reported an error.
    const result = classifyToolResult({
      success: false,
      output: '',
      exitCode: 1,
      error: 'ENOENT: no such file or directory',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toBe('ENOENT: no such file or directory');
    }
  });

  it('case 3: success=true with _recoveryHint is SUCCESS', () => {
    // _recoveryHint present → positive signal, even if other fields are
    // suspicious. The injector attaches _recoveryHint to a successful
    // tool result that the executor wants the LLM to learn from.
    const result = classifyToolResult({
      success: true,
      output: 'partial',
      error: null,
      _recoveryHint: 'for future calls, prefer apply_diff for surgical edits',
    });
    expect(result.isFailure).toBe(false);
    if (!result.isFailure) {
      expect(result.reason).toBe('success_true');
    }
  });

  it('case 4: success=false with _recoveryHint remains a failure with recovery context', () => {
    const result = classifyToolResult({
      success: false,
      output: 'partial',
      error: 'something went wrong',
      _recoveryHint: 'try write_file with a different path on retry',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toContain('something went wrong');
      expect(result.errorMsg).toContain('[recovery: try write_file with a different path on retry]');
    }
  });

  // ── Regression coverage for the legacy fallback path ─────────────────────

  it('legacy fallback: error as a non-null string is a failure', () => {
    // No `success` field at all (legacy tool result shape). Truthy error
    // string → failure.
    const result = classifyToolResult({
      output: '',
      error: 'something broke',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('error_string');
      expect(result.errorMsg).toBe('something broke');
    }
  });

  it('legacy fallback: error as an object with .message is a failure', () => {
    // No `success` field, error is an object with a message string.
    const result = classifyToolResult({
      output: '',
      error: { code: 'EACCES', message: 'permission denied' },
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('error_object');
      expect(result.errorMsg).toBe('permission denied');
    }
  });

  it('legacy fallback: no error and no success field is a success (optimistic)', () => {
    // No `success` field, no error → optimistic success. The old code
    // would have synthesised an "Unknown error" string here, but with no
    // failure signal the safer default is success.
    const result = classifyToolResult({
      output: 'some output',
    });
    expect(result.isFailure).toBe(false);
    if (!result.isFailure) {
      expect(result.reason).toBe('no_error_field');
    }
  });

  it('legacy fallback: empty error string is a success (falsy)', () => {
    // Empty string is falsy — not a failure. The legacy fallback uses
    // `errorObj.length > 0` so empty strings don't trip the failure path.
    const result = classifyToolResult({
      output: 'ok',
      error: '',
    });
    expect(result.isFailure).toBe(false);
  });

  it('success=false with no error field uses available tool output', () => {
    const result = classifyToolResult({
      success: false,
      output: 'something',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toBe('something');
    }
  });

  // Empty error fields must not mask output or recovery instructions.
  it('success=false with _recoveryHint and no error field appends the recovery hint', () => {
    const result = classifyToolResult({
      success: false,
      output: 'something',
      _recoveryHint: 'use write_file with a different path on retry',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toContain('something');
      expect(result.errorMsg).toContain('[recovery: use write_file with a different path on retry]');
    }
  });

  it('success=false with an empty error uses exitCode before a generic fallback', () => {
    const result = classifyToolResult({ success: false, error: '', exitCode: 127 });
    expect(result).toEqual({
      isFailure: true,
      reason: 'success_false',
      errorMsg: 'Tool exited with code 127',
    });
  });

  it('null/undefined toolResult is treated optimistically (no failure signal)', () => {
    // Defensive: a null tool result shouldn't crash. The helper should
    // return a non-failure classification.
    const nullResult = classifyToolResult(null);
    expect(nullResult.isFailure).toBe(false);

    const undefinedResult = classifyToolResult(undefined);
    expect(undefinedResult.isFailure).toBe(false);
  });
});
