/**
 * Bug #83 (Pass-6 audit) — classifyToolResult unit tests.
 *
 * The old heuristic in `streamWithVercelAI` synthesised an "Unknown error"
 * string whenever the `error` field was truthy/non-null, which mis-classified
 * successful tool results like `{ success: true, output, exitCode: 0, error: null,
 * _recoveryHint }` as failures. The new `classifyToolResult` helper inverts
 * the priority: `success: true` and `_recoveryHint` are positive signals.
 *
 * These tests cover the 4 cases the audit specified:
 *   1. success=true with error=null  → success
 *   2. success=false with error set → failure
 *   3. success=true with _recoveryHint → success
 *   4. success=false with _recoveryHint → success
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
      // _recoveryHint takes priority over success:true per the helper's
      // priority order (Bug #83 explicitly required checking _recoveryHint
      // as a positive signal).
      expect(result.reason).toBe('recovery_hint');
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
      expect(result.reason).toBe('recovery_hint');
    }
  });

  it('case 4: success=false with _recoveryHint is SUCCESS (recovery hint overrides)', () => {
    // The audit explicitly required: "_recoveryHint as a positive signal"
    // — even if success===false, the presence of _recoveryHint means the
    // executor has a non-fatal recoverable path the LLM can use. The
    // helper inverts the priority: _recoveryHint > success===true >
    // success===false > legacy fallback.
    const result = classifyToolResult({
      success: false,
      output: 'partial',
      error: 'something went wrong',
      _recoveryHint: 'try write_file with a different path on retry',
    });
    expect(result.isFailure).toBe(false);
    if (!result.isFailure) {
      expect(result.reason).toBe('recovery_hint');
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

  it('success=false with no error field falls back to the synthesised "Unknown error" string', () => {
    // Edge case: tool explicitly said failure but didn't provide an error
    // object. The old code synthesised an "Unknown error" string; the new
    // helper preserves that behaviour for genuine success:false cases.
    const result = classifyToolResult({
      success: false,
      output: 'something',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toContain('Unknown error');
      expect(result.errorMsg).toContain('no error field');
    }
  });

  // BUG 4 fix — the synthesise branch (else) MUST also append _recoveryHint
  // when present, mirroring the errorObj=object branch above. Without this,
  // the 100+ `Unknown error — tool result has keys: [..., _recoveryHint], no
  // error field` log lines in /opt/bing/web/logs/run.log fire without the
  // actionable guidance the LLM injector attached (bash_execute, read_file,
  // apply_diff all hit this path because the tool returns `success: false`
  // without populating the `error` field).
  it('success=false with _recoveryHint and no error field appends the recovery hint', () => {
    const result = classifyToolResult({
      success: false,
      output: 'something',
      _recoveryHint: 'use write_file with a different path on retry',
    });
    expect(result.isFailure).toBe(true);
    if (result.isFailure) {
      expect(result.reason).toBe('success_false');
      expect(result.errorMsg).toContain('Unknown error');
      expect(result.errorMsg).toContain('no error field');
      // The recovery hint must be appended (with bracket + label prefix)
      // so the LLM-facing block surfaces the actionable guidance.
      expect(result.errorMsg).toContain('[recovery: use write_file with a different path on retry]');
      // Format lock (code-reviewer SHOULD-CONSIDER b): the synthesise content
      // (the keys list including `_recoveryHint`) must STILL appear alongside
      // the appended recovery block — a future refactor that joins the append
      // inside the keys-list shape would pass the substrings above but break
      // the format operators grep on for the "Unknown error" line. Pin the
      // full shape so operators can't accidentally lose grep-discoverability.
      // Intentional-strict — do NOT relax to `\[.*\]` if a future field
      // is added to the synthesise string: the exact shape is the lock.
      expect(result.errorMsg).toMatch(
        /tool result has keys: \[success, output, _recoveryHint\]/,
      );
    }
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
