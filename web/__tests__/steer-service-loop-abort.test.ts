/**
 * Bug #41 regression tests: [STEER] loop_abort on the 3-consecutive-tool-failures
 * kill with categorized abortReason (binary_missing | wrong_tool_name | timeout
 * | unknown), auto-recovery to write_file for binary_missing aborts, and the
 * structured abort payload that downstream SSE consumers emit as a `loop_abort`
 * final event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the logger so we don't spam test output.
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import {
  categorizeAbortReason,
  wireLoopAbortSteer,
  buildSteerPrompt,
  steerMetrics,
} from '@/lib/orchestra/steer-service';
import {
  recordStepAndCheckLoop,
  createLoopDetectorState,
  type LoopDetectorResult,
} from '@/lib/orchestra/shared-agent-context';

describe('Bug #41: categorizeAbortReason', () => {
  it('returns unknown for an empty failure list', () => {
    expect(categorizeAbortReason([])).toBe('unknown');
  });

  it('returns binary_missing when all failures are ENOENT (spawn)', () => {
    const result = categorizeAbortReason([
      { name: 'execute_bash', error: 'spawn /usr/local/bin/python3 ENOENT' },
      { name: 'execute_bash', error: 'spawn python3 ENOENT' },
      { name: 'execute_bash', error: 'spawn sh ENOENT' },
    ]);
    expect(result).toBe('binary_missing');
  });

  it('returns wrong_tool_name when all failures are capability_not_found', () => {
    const result = categorizeAbortReason([
      { name: 'list_directory', error: 'capability not found: list_directory' },
      { name: 'read_file', error: 'unknown capability: read_file' },
      { name: 'grep_code', error: 'no such tool: grep_code' },
    ]);
    expect(result).toBe('wrong_tool_name');
  });

  it('returns timeout when all failures are idle-timeout / TIMEOUT-TTFT', () => {
    const result = categorizeAbortReason([
      { name: 'stream_text', error: 'idle timeout: 75000ms' },
      { name: 'stream_text', error: 'stream timed out waiting for first token' },
      { name: 'stream_text', error: '[TIMEOUT-TTFT] No first token received' },
    ]);
    expect(result).toBe('timeout');
  });

  it('returns unknown when failure categories are mixed (no majority)', () => {
    const result = categorizeAbortReason([
      { name: 'execute_bash', error: 'spawn python3 ENOENT' },
      { name: 'read_file', error: 'permission denied' },
      { name: 'stream_text', error: 'rate limited' },
    ]);
    expect(result).toBe('unknown');
  });

  it('returns binary_missing when at least half the failures are ENOENT (mixed)', () => {
    // 2 of 3 are ENOENT → dominant.
    const result = categorizeAbortReason([
      { name: 'execute_bash', error: 'spawn python3 ENOENT' },
      { name: 'execute_bash', error: 'spawn node ENOENT' },
      { name: 'read_file', error: 'permission denied' },
    ]);
    expect(result).toBe('binary_missing');
  });
});

describe('Bug #41: wireLoopAbortSteer', () => {
  beforeEach(() => {
    steerMetrics.reset();
  });

  it('returns null when consecutive < 1', () => {
    expect(wireLoopAbortSteer({ consecutive: 0, recentFailures: [] })).toBeNull();
  });

  it('builds a [STEER] prompt and a structured abort payload for ENOENT failures', () => {
    const result = wireLoopAbortSteer({
      consecutive: 3,
      recentFailures: [
        { name: 'execute_bash', error: 'spawn python3 ENOENT' },
        { name: 'execute_bash', error: 'spawn node ENOENT' },
        { name: 'execute_bash', error: 'spawn sh ENOENT' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.steer).toMatch(/^\[STEER\]/);
    expect(result!.steer).toContain('Loop-guard');
    expect(result!.steer).toContain('binary_missing');
    expect(result!.abort.abortReason).toBe('binary_missing');
    expect(result!.abort.consecutive).toBe(3);
    expect(result!.abort.failedTools).toHaveLength(3);
    expect(result!.abort.suggestion).toContain('write_file');
    expect(result!.abort.promptLength).toBe(result!.steer.length);
  });

  it('records the fire in steerMetrics under loop_abort', () => {
    expect(steerMetrics.countOf('loop_abort')).toBe(0);
    wireLoopAbortSteer({
      consecutive: 3,
      recentFailures: [{ name: 'execute_bash', error: 'spawn python3 ENOENT' }],
    });
    expect(steerMetrics.countOf('loop_abort')).toBe(1);
  });

  it('tags the suggestion for the right abort reason', () => {
    const timeout = wireLoopAbortSteer({
      consecutive: 3,
      recentFailures: [
        { name: 'stream_text', error: 'idle timeout: 75000ms' },
        { name: 'stream_text', error: '[TIMEOUT-TTFT]' },
        { name: 'stream_text', error: 'stream timed out' },
      ],
    });
    expect(timeout!.abort.abortReason).toBe('timeout');
    expect(timeout!.abort.suggestion.toLowerCase()).toContain('smaller pieces');

    const wrong = wireLoopAbortSteer({
      consecutive: 3,
      recentFailures: [
        { name: 'list_directory', error: 'capability not found' },
        { name: 'read_file', error: 'unknown capability' },
        { name: 'grep_code', error: 'no such tool' },
      ],
    });
    expect(wrong!.abort.abortReason).toBe('wrong_tool_name');
    expect(wrong!.abort.suggestion).toContain('canonical');
  });
});

describe('Bug #41: recordStepAndCheckLoop → structured LoopDetectorResult', () => {
  it('returns null when no failures', () => {
    const state = createLoopDetectorState();
    const result = recordStepAndCheckLoop(state, 'write_file', { path: 'a.ts' }, true);
    expect(result).toBeNull();
  });

  it('returns a plain string for exact-repeat (2x same call) — backward compat', () => {
    const state = createLoopDetectorState();
    const args = { path: 'missing.ts' };
    recordStepAndCheckLoop(state, 'read_file', args, false);
    const result = recordStepAndCheckLoop(state, 'read_file', args, false);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/failed 2 times with the same arguments/);
  });

  it('returns a LoopDetectorResult with structured abort payload on 3 consecutive failures', () => {
    const state = createLoopDetectorState();
    // Three DIFFERENT failed tools with REAL ENOENT error messages so the
    // [STEER] loop_abort can categorize the abort as `binary_missing`.
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'python3 foo.py' }, false, 'spawn python3 ENOENT');
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'python3 bar.py' }, false, 'spawn python3 ENOENT');
    const result = recordStepAndCheckLoop(state, 'execute_bash', { command: 'python3 baz.py' }, false, 'spawn python3 ENOENT');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');

    const r = result as LoopDetectorResult;
    // Bug #41: `message` is now PLAIN TEXT (no `[STEER]` prefix leak), and
    // the `[STEER]` prompt lives in `abort.steer`.
    expect(r.message).not.toMatch(/^\[STEER\]/);
    expect(r.message).toMatch(/binary_missing|3 consecutive tool failures/);
    expect(r.abort).toBeDefined();
    expect(r.abort!.consecutive).toBe(3);
    expect(r.abort!.failedTools.length).toBeGreaterThan(0);
    // ENOENT-style message → binary_missing → autoRecoverTo = write_file.
    expect(r.abort!.abortReason).toBe('binary_missing');
    expect(r.abort!.autoRecoverTo).toBe('write_file');
    expect(r.abort!.steer).toMatch(/^\[STEER\]/);
    // The plain-text message is distinct from the steer prompt.
    expect(r.abort!.steer).not.toBe(r.message);
  });

  it('returns wrong_tool_name (no autoRecoverTo) for capability_not_found failures', () => {
    const state = createLoopDetectorState();
    recordStepAndCheckLoop(state, 'list_directory', { path: '/x' }, false, 'capability not found: list_directory');
    recordStepAndCheckLoop(state, 'read_file', { path: '/y' }, false, 'capability not found: read_file');
    const result = recordStepAndCheckLoop(state, 'grep_code', { query: 'x' }, false, 'no such tool: grep_code');
    expect(result).not.toBeNull();
    const r = result as LoopDetectorResult;
    expect(r.abort).toBeDefined();
    expect(r.abort!.consecutive).toBe(3);
    expect(r.abort!.abortReason).toBe('wrong_tool_name');
    // wrong_tool_name has no single recovery tool — autoRecoverTo is undefined.
    expect(r.abort!.autoRecoverTo).toBeUndefined();
  });

  it('stores the real error in failedToolErrors and surfaces it in failedTools[].error', () => {
    const state = createLoopDetectorState();
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'x' }, false, 'spawn /usr/local/bin/python3 ENOENT');
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'y' }, false, 'spawn /usr/local/bin/python3 ENOENT');
    const result = recordStepAndCheckLoop(state, 'execute_bash', { command: 'z' }, false, 'spawn /usr/local/bin/python3 ENOENT');
    const r = result as LoopDetectorResult;
    // Each failed tool entry should have a real error (not 'repeated failure').
    for (const ft of r.abort!.failedTools) {
      expect(ft.error).toMatch(/ENOENT/);
    }
  });

  it('message is plain text (no [STEER] prefix) for backward compatibility', () => {
    const state = createLoopDetectorState();
    recordStepAndCheckLoop(state, 'read_file', { path: 'a.ts' }, false, 'spawn cat ENOENT');
    recordStepAndCheckLoop(state, 'read_file', { path: 'b.ts' }, false, 'spawn cat ENOENT');
    const result = recordStepAndCheckLoop(state, 'read_file', { path: 'c.ts' }, false, 'spawn cat ENOENT');
    const r = result as LoopDetectorResult;
    expect(r.message).not.toMatch(/^\[STEER\]/);
    expect(r.message).toContain('Agent stopped after 3 consecutive tool failures');
  });

  it('resets consecutive counter on a success', () => {
    const state = createLoopDetectorState();
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'x' }, false);
    recordStepAndCheckLoop(state, 'execute_bash', { command: 'y' }, false);
    const ok = recordStepAndCheckLoop(state, 'write_file', { path: 'a.ts' }, true);
    expect(ok).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
  });
});

describe('Bug #41: buildSteerPrompt loop_abort branch is reachable', () => {
  it('renders the loop_abort case via buildSteerPrompt directly', () => {
    const prompt = buildSteerPrompt({
      kind: 'loop_abort',
      detail: {
        abortReason: 'timeout',
        consecutive: 3,
        failedTools: [{ name: 'stream_text', error: 'idle timeout: 75000ms' }],
        suggestion: 'Break the request into smaller pieces.',
      },
    });
    expect(prompt).toMatch(/^\[STEER\]/);
    expect(prompt).toContain('timeout');
    expect(prompt).toContain('stream_text');
    expect(prompt).toContain('Break the request into smaller pieces.');
  });
});
