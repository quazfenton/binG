/**
 * Regression tests for the LLM Continuation Helper.
 *
 * Covers the 3 continuation triggers and the 3 no-continuation cases:
 *
 * CONTINUATION TRIGGERS:
 *   1. roleSelection.continue === true → continue with plan's next step
 *   2. Empty tool args detected → inject feedback steer
 *   3. Single-step read pattern → auto-continue with action steer
 *
 * NO-CONTINUATION CASES:
 *   4. routing.continue is false/undefined AND no empty args AND not a single read
 *   5. maxContinuationsSoFar >= maxContinuations (hard cap)
 *   6. steps.length === 0 with no routing.continue (plain text response)
 *
 * Plus safety checks:
 *   - Pure function (no side effects, no LLM calls)
 *   - Returns a valid ContinuationDecision shape
 *   - continuationPrompt is empty when continue === false
 */

import { describe, it, expect } from 'vitest';
import { shouldAutoContinue, type ContinuationDecision } from '../llm-continuation';

describe('shouldAutoContinue', () => {
  // ─── CONTINUATION TRIGGERS ──────────────────────────────────────────

  describe('trigger 1: roleSelection.continue === true', () => {
    it('continues when routing.continue is true', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true, primaryRole: 'coder' },
        steps: [],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('role_selection_continue_true');
      expect(decision.continuationPrompt).toBeTruthy();
      expect(decision.continuationsSoFar).toBe(1);
    });

    it('uses stepReprompt when provided', () => {
      const decision = shouldAutoContinue({
        routing: {
          continue: true,
          stepReprompt: 'Now write the unit tests for the parser.',
        },
        continuationsSoFar: 0,
      });
      expect(decision.continuationPrompt).toBe('Now write the unit tests for the parser.');
    });

    it('uses generic prompt when stepReprompt is missing', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true },
        continuationsSoFar: 0,
      });
      expect(decision.continuationPrompt).toMatch(/Continue with the next step/);
    });
  });

  describe('trigger 2: empty tool args detected', () => {
    it('continues when a tool was called with args: {}', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'write_file', args: {} }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('empty_tool_args_detected');
      expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
      expect(decision.continuationPrompt).toMatch(/no arguments/);
    });

    it('does NOT continue when a tool was called with undefined args AND it is NOT a read-only tool', () => {
      // Tools like list_directory, grep, web_search have all-optional args.
      // `args: undefined` should NOT trigger the empty-args check.
      // Note: a read-only tool with no args WILL still trigger the
      // single-step read pattern (trigger 3) — that's a separate check.
      // Here we use a write tool with no args to isolate the empty-args check.
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'write_file', args: undefined }],
        continuationsSoFar: 0,
      });
      // write_file with no args is neither empty (args: {}) nor a single
      // read step — should not continue.
      expect(decision.continue).toBe(false);
    });
  });

  describe('trigger 3: single-step read pattern', () => {
    it('continues when exactly 1 read_file step was used', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'read_file', args: { path: 'src/app.ts' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
      expect(decision.continuationPrompt).toMatch(/read a file/);
      expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    });

    it('continues when exactly 1 list_directory step was used', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'list_directory', args: { path: 'src/' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for file.read canonical name', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'file.read', args: { path: 'src/app.ts' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('does NOT continue when there are multiple steps', () => {
      const decision = shouldAutoContinue({
        steps: [
          { toolName: 'read_file', args: { path: 'a.ts' } },
          { toolName: 'write_file', args: { path: 'b.ts', content: 'x' } },
        ],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
    });

    it('does NOT continue for single write step (action, not read)', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'write_file', args: { path: 'a.ts', content: 'x' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
    });

    // ─── NEW: extends single_step_read_pattern to other info-gathering tools ───
    // An information-gathering tool that returned without follow-up action
    // is the same "stall after read" symptom regardless of the specific
    // tool name. Snake_case, camelCase, and capability.dot.case variants
    // all match via _canonicalToolName + the compressUnderscores alias.
    //
    // Note: every test passes `args: { ... }` (not `{}`) because
    // `hasEmptyToolArgs` would fire BEFORE `isSingleReadOnlyStep` and
    // shadow the test with reason `empty_tool_args_detected`.
    it('continues for list_files (snake_case variant of list_directory)', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'list_files', args: { path: 'src/' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for web_search (info-gathering across the network)', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'web_search', args: { query: 'how to parse parquet' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for web_fetch', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'web_fetch', args: { url: 'https://example.com' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for read_url', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'read_url', args: { url: 'https://example.com' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for snake_case canonical names written in camelCase', () => {
      // The provider sometimes emits `listFiles` / `webSearch` rather than
      // the snake_case canonical. The detector must treat these uniformly.
      for (const toolName of ['listFiles', 'webSearch', 'readFile']) {
        const decision = shouldAutoContinue({
          steps: [{ toolName, args: { path: 'src/' } }],
          continuationsSoFar: 0,
        });
        expect(decision.continue, `expected continue=true for ${toolName}`).toBe(true);
        expect(decision.reason, `expected single_step_read_pattern for ${toolName}`).toBe('single_step_read_pattern');
      }
    });

    it('continues for capability-style dotted names (file.read, repo.search, web.search)', () => {
      for (const toolName of ['file.read', 'repo.search', 'web.search', 'web.fetch', 'file.list']) {
        const decision = shouldAutoContinue({
          steps: [{ toolName, args: { path: 'src/' } }],
          continuationsSoFar: 0,
        });
        expect(decision.continue, `expected continue=true for ${toolName}`).toBe(true);
        expect(decision.reason, `expected single_step_read_pattern for ${toolName}`).toBe('single_step_read_pattern');
      }
    });

    it('rejects write-family tool names (write_file stays excluded)', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'write_file', args: { path: 'x.ts', content: 'x' } }],
        continuationsSoFar: 0,
      });
      // write_file is a write step (covered in the existing
      // single-write test), so the read detector must NOT fire here.
      expect(decision.reason).not.toBe('single_step_read_pattern');
    });
  });

  // ─── NO-CONTINUATION CASES ─────────────────────────────────────────

  describe('no-continuation: plain text response', () => {
    it('returns no_continuation_needed when no triggers fire', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [],
        responseText: 'Here is the answer to your question.',
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('no_continuation_needed');
      expect(decision.continuationPrompt).toBe('');
      expect(decision.continuationsSoFar).toBe(0);
    });

    it('returns no_continuation_needed when routing is undefined and steps is empty', () => {
      const decision = shouldAutoContinue({
        steps: [],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('no_continuation_needed');
    });
  });

  describe('no-continuation: hard cap reached', () => {
    it('returns max_continuations_reached when continuationsSoFar >= maxContinuations', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true }, // would otherwise trigger
        continuationsSoFar: 3,
        maxContinuations: 3,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('max_continuations_reached');
    });

    it('uses default maxContinuations of 3 when not specified', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true },
        continuationsSoFar: 3,
      });
      expect(decision.reason).toBe('max_continuations_reached');
    });

    it('respects custom maxContinuations', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true },
        continuationsSoFar: 1,
        maxContinuations: 1,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('max_continuations_reached');
    });
  });

  describe('no-continuation: steps is empty + no routing', () => {
    it('returns no_continuation_needed', () => {
      const decision = shouldAutoContinue({
        steps: [],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('no_continuation_needed');
    });
  });

  // ─── SAFETY CHECKS ─────────────────────────────────────────────────

  describe('safety: pure function, no side effects', () => {
    it('does not mutate the input', () => {
      const input = {
        routing: { continue: true, stepReprompt: 'X' },
        steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
        continuationsSoFar: 0,
      };
      const before = JSON.stringify(input);
      shouldAutoContinue(input);
      expect(JSON.stringify(input)).toBe(before);
    });

    it('returns a valid ContinuationDecision shape', () => {
      const decision: ContinuationDecision = shouldAutoContinue({
        routing: { continue: true },
        continuationsSoFar: 0,
      });
      expect(typeof decision.continue).toBe('boolean');
      expect(typeof decision.reason).toBe('string');
      expect(typeof decision.continuationPrompt).toBe('string');
      expect(typeof decision.continuationsSoFar).toBe('number');
    });

    it('returns empty continuationPrompt when continue is false', () => {
      const decision = shouldAutoContinue({
        steps: [],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
      expect(decision.continuationPrompt).toBe('');
    });
  });

  // ─── PRIORITY ORDER ────────────────────────────────────────────────

  describe('priority order: role_selection > empty_args > single_read', () => {
    it('roleSelection.continue takes priority over empty args', () => {
      const decision = shouldAutoContinue({
        routing: { continue: true },
        steps: [{ toolName: 'write_file', args: {} }],
        continuationsSoFar: 0,
      });
      expect(decision.reason).toBe('role_selection_continue_true');
    });

    it('empty args takes priority over single read', () => {
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'read_file', args: {} }],
        continuationsSoFar: 0,
      });
      expect(decision.reason).toBe('empty_tool_args_detected');
    });
  });
});
