/**
 * Regression tests for the LLM Continuation Helper.
 *
 * CONTINUATION TRIGGERS:
 *   1. roleSelection.continue === true → continue with plan's next step
 *   2. Empty tool args detected (args === {} present) → inject feedback steer
 *   3. Single-step read pattern → auto-continue with action steer
 *   4. Plan steps remaining → continue with next plan step (steps.length < planStepsCount ≥ 2)
 *   5. Single-write then stop (Bug #11) → continue after write-only stop;
 *      also covers the empty-args shape on a write tool (undefined args are
 *      NOT an empty-args trigger and fall through to single_write_then_stop)
 *
 * NO-CONTINUATION CASES:
 *   6. routing.continue is false + no steps trigger fired + no steps ≤ 1 → no_continuation_needed
 *   7. maxContinuationsSoFar >= maxContinuations (hard cap)
 *   8. failure_plan_loop circuit-breaker (tool failed + plan-language response)
 *
 * Plus safety checks:
 *   - Pure function (no side effects, no LLM calls)
 *   - Returns a valid ContinuationDecision shape
 *   - continuationPrompt is empty when continue === false
 *
 * Producer-contract assertions for humanizeToolName live in BOTH the
 * trigger 3 (single_step_read_pattern) and trigger 5 (single_write_then_stop)
 * describe blocks — the test pins the producer mapping and reads the
 * continuation prompt via the producer output, so future humanizer edits
 * flow through without requiring regex updates (was: a brittle
 * `/called a file/i` regex pinned to literal wording).
 */

import { describe, it, expect, vi } from 'vitest';
import { shouldAutoContinue, humanizeToolName, type ContinuationDecision } from '../llm-continuation';

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
        routing: { continue: false },
        steps: [{ toolName: 'write_file', args: {} }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('empty_tool_args_detected');
      expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
      expect(decision.continuationPrompt).toMatch(/no arguments/);
    });
  });

  describe('trigger 3: single-step read pattern', () => {
    it('continues when exactly 1 read_file step was used', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'read_file', args: { path: 'src/app.ts' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
      // Producer-contract assertion (was: brittle `/called a file/i` regex
      // pinned literal wording). The continuation prompt embeds the
      // humanizer output verbatim, so we read the prompt via the producer
      // — if the humanizer changes a category in a way that breaks prompt
      // grammar, this test fails loudly without needing to update both the
      // regex AND the expected output.
      const humanized = humanizeToolName('read_file');
      expect(decision.continuationPrompt).toContain(`You called ${humanized} in the previous turn`);
      expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    });

    it('continues when exactly 1 list_directory step was used', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'list_directory', args: { path: 'src/' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for file.read canonical name', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'file.read', args: { path: 'src/app.ts' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('does NOT continue when there are multiple steps', () => {
      // routing={continue:false} with planSteps=2 + estimatedSteps=2
      // prevents BOTH the routing==null catch-all (env-default-on would
      // otherwise emit plan_steps_remaining) AND the single_write_then_stop
      // rule (which fires when planStepsCount <= 1).
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [{ action: 'a' }, { action: 'b' }],
          estimatedSteps: 2,
        },
        steps: [
          { toolName: 'read_file', args: { path: 'a.ts' } },
          { toolName: 'write_file', args: { path: 'b.ts', content: 'x' } },
        ],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(false);
    });

    // (single_write_then_stop test moved to the trigger 5 block below)

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
        routing: { continue: false },
        steps: [{ toolName: 'list_files', args: { path: 'src/' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for web_search (info-gathering across the network)', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'web_search', args: { query: 'how to parse parquet' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for web_fetch', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'web_fetch', args: { url: 'https://example.com' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_step_read_pattern');
    });

    it('continues for read_url', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
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
          routing: { continue: false },
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
          routing: { continue: false },
          steps: [{ toolName, args: { path: 'src/' } }],
          continuationsSoFar: 0,
        });
        expect(decision.continue, `expected continue=true for ${toolName}`).toBe(true);
        expect(decision.reason, `expected single_step_read_pattern for ${toolName}`).toBe('single_step_read_pattern');
      }
    });

    it('rejects write-family tool names (write_file stays excluded)', () => {
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'write_file', args: { path: 'x.ts', content: 'x' } }],
        continuationsSoFar: 0,
      });
      // write_file is a write step (covered in the existing
      // single-write test), so the read detector must NOT fire here.
      expect(decision.reason).not.toBe('single_step_read_pattern');
    });
  });

  // ─── TRIGGER 5: single_write_then_stop (Bug #11) ────────────────
  // The model "wrote N files and stopped" symptom: a single write step with
  // no plan info (or planStepsCount <= 1) is the most common signal that the
  // LLM finished a partial job and should receive a continuation prompt to
  // review/complete. Originally the empty-args check shadowed this trigger
  // for the undefined-args shape (a write tool called with no args) — the
  // empty-args detector correctly skips `args: undefined` (all-optional args
  // on read tools are valid), but for a WRITE tool with undefined args the
  // decision should still flow through to single_write_then_stop. The first
  // test in this block locks down that path; the second test covers the
  // canonical Bug #11 invariant from the orchestrator test fixture; the
  // third asserts on the humanizeToolName producer contract.

  describe('trigger 5: single_write_then_stop (Bug #11)', () => {
    it('continues via single_write_then_stop when a write tool is called with undefined args (empty-args check is bypassed)', () => {
      // Tools like list_directory, grep, web_search have all-optional args
      // and `args: undefined` should NOT trigger the empty-args check.
      // For a WRITE tool called with `args: undefined` the decision skips
      // the empty-args check (no `{}` present) but still satisfies the
      // single_write_then_stop invariant: writeSteps=1, steps.length=1<=2,
      // planStepsCount=0<=1. The empty-args check is verifiable via the
      // absent reason — if the empty-args detector ever widened its
      // undefined-args coverage, this assertion catches it via the
      // negative `not.toBe('empty_tool_args_detected')` check.
      //
      // Title inverted from the previously-contradictory
      // `'does NOT continue…[via single_write_then_stop]'` to reflect the
      // actual behavior: the decision DOES continue via single_write_then_stop.
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'write_file', args: undefined }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_write_then_stop');
      expect(decision.reason).not.toBe('empty_tool_args_detected');
    });

    it('continues for a single write step with no plan info (canonical Bug #11 invariant)', () => {
      // A single write step with NO plan info IS intended to trigger
      // single_write_then_stop (Bug #11 — the model "wrote 1 file and died,"
      // likely needs more). This test asserts that path so the invariant
      // is locked down. The previously-asserted continue=false was
      // outdated; moved here from the `trigger 3: single-step read pattern`
      // block where it was historically parked because trigger 5 didn't
      // exist as a separate describe block yet.
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'write_file', args: { path: 'a.ts', content: 'x' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('single_write_then_stop');
      expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    });

    it('humanizes the canonical read-family tool names so the AUTO-CONTINUE prompt reads as English', () => {
      // Producer-contract lock down. The continuation prompt template reads:
      //   `[AUTO-CONTINUE] You called ${toolName} in the previous turn ...`
      // where toolName = humanizeToolName(rawToolName). The mapping in
      // CATEGORY_MAP must produce a phrase that parses as English in that
      // template ("called a file read" not "called a file" which would
      // parse as "[you] called THE file"). This test pins the producer: if
      // the humanizer changes a category in a way that breaks prompt
      // grammar, the producer-contract assertion fails first.
      expect(humanizeToolName('read_file')).toBe('a file read');
      expect(humanizeToolName('file.read')).toBe('a file read');
      expect(humanizeToolName('read_url')).toBe('a web URL read');
      expect(humanizeToolName('web_search')).toBe('a web search');
      expect(humanizeToolName('web.fetch')).toBe('a web fetch');
      expect(humanizeToolName('list_directory')).toBe('a directory listing');
      // End-to-end: the prompt embeds the producer output verbatim so a
      // humanizer change flows through without requiring a regex update.
      const decision = shouldAutoContinue({
        routing: { continue: false },
        steps: [{ toolName: 'read_file', args: { path: 'src/app.ts' } }],
        continuationsSoFar: 0,
      });
      expect(decision.continuationPrompt).toContain(
        `You called ${humanizeToolName('read_file')} in the previous turn`,
      );
    });
  });

  // ─── TRIGGER 4: plan steps remaining ───────────────────────────────
  // Branch-level unit coverage. The end-to-end fixture coverage that
  // exercises plan_steps_remaining through decideAutoContinue lives in
  //   bing/web/__tests__/orchestra/unified-agent-service.test.ts
  // so this block locks down the four SHAPE branches the rule pivots on:
  //   1. routing == null catch-all → env-default-on/off split
  //   2. planStepsCount >= 2 entry guard
  //   3. steps.length < planStepsCount exit guard
  //   4. failure_plan_loop circuit-breaker integration
  // The broader regression coverage of the circuit-breaker rule itself
  // (length floors, success/failure mix, no-failure case, etc.) lives in
  // the bottom `circuit-breaker: failure + plan-only response` describe
  // block of this file — this block pins the BRANCH SHAPE, that block
  // pins the REGEX / DETECTOR behavior.
  describe('trigger 4: plan steps remaining (branch unit coverage)', () => {
    // Catch-all when the caller omits routing entirely.
    // resolveDefaultContinue() reads process.env.LLM_AUTO_CONTINUE_DEFAULT
    // at call time (not at module load), so vi.stubEnv flips the branch
    // deterministically and vi.unstubAllEnvs restores per-test isolation.
    describe('routing == null catch-all (env-default split)', () => {
      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('returns plan_steps_remaining when routing is undefined and env default is not "false"', () => {
        // Default env (unset OR 'true' OR any non-'false' value) →
        // resolveDefaultContinue() returns true → catch-all emits
        // plan_steps_remaining.
        //
        // Note: steps: [] is critical — a single read step would trigger
        // trigger 3 (single_step_read_pattern) BEFORE the catch-all (the
        // catch-all is last-resort per the producer-order fix). With empty
        // steps, every heuristic trigger falls through and only the
        // catch-all can emit.
        vi.stubEnv('LLM_AUTO_CONTINUE_DEFAULT', 'true');
        const decision = shouldAutoContinue({
          routing: undefined,
          steps: [],
          continuationsSoFar: 0,
        });
        expect(decision.continue).toBe(true);
        expect(decision.reason).toBe('plan_steps_remaining');
        expect(decision.continuationPrompt).toBeTruthy();
      });

      it('returns no_continuation_needed when routing is undefined and env default is "false"', () => {
        // Env explicitly 'false' → resolveDefaultContinue() returns false
        // → catch-all flips to no_continuation_needed (clean close without
        // routing metadata).
        //
        // Same caveat as the truthy-sibling test: steps: [] is required so
        // no heuristic trigger (1/2/3/4/5) fires before the catch-all.
        vi.stubEnv('LLM_AUTO_CONTINUE_DEFAULT', 'false');
        const decision = shouldAutoContinue({
          routing: undefined,
          steps: [],
          continuationsSoFar: 0,
        });
        expect(decision.continue).toBe(false);
        expect(decision.reason).toBe('no_continuation_needed');
      });
    });

    // Guards around the
    //   (planStepsCount >= 2 && steps.length >= 1 && steps.length < planStepsCount)
    // core expression. Both tests verify that violating the guard cleanly
    // falls through to the no-continuation bottom rule rather than
    // mis-firing on a partial plan or a fully-complete plan.
    describe('entry + exit guards', () => {
      it('does NOT fire when planStepsCount is below 2 (entry guard)', () => {
        // estimatedSteps: 1 → planStepsCount = 1 < 2 → entry guard fails.
        // The non-read / non-write toolName prevents triggers 3 + 5 from
        // intercepting, so the fall-through lands on no_continuation_needed.
        const decision = shouldAutoContinue({
          routing: { continue: false, estimatedSteps: 1 },
          steps: [{ toolName: 'some_generic_tool', args: { value: 'x' } }],
          continuationsSoFar: 0,
        });
        expect(decision.continue).toBe(false);
        expect(decision.reason).toBe('no_continuation_needed');
      });

      it('does NOT fire when steps.length >= planStepsCount (exit guard)', () => {
        // planSteps=[a,b] (length 2) + steps=[s1,s2] (length 2)
        // → steps.length < planStepsCount is FALSE → exit guard fails.
        const decision = shouldAutoContinue({
          routing: {
            continue: false,
            planSteps: [{ action: 'a' }, { action: 'b' }],
          },
          steps: [
            { toolName: 'some_tool_one', args: { value: 'x' } },
            { toolName: 'some_tool_two', args: { value: 'y' } },
          ],
          continuationsSoFar: 0,
        });
        expect(decision.continue).toBe(false);
        expect(decision.reason).toBe('no_continuation_needed');
      });
    });

    // Circuit-breaker integration: the plan_steps_remaining entry guard
    // passes but the failure-plan-loop check
    // (continuationsSoFar >= 1 + failed last tool + plan-language response
    // between 30-1000 chars) preempts the legitimate plan_steps_remaining
    // emit and returns failure_plan_loop instead. The broader regression
    // coverage of the detector's quirks lives in the bottom
    // `circuit-breaker: failure + plan-only response` describe block;
    // this test is the trigger-4 BRANCH-SHAPE pin (entry-guard passes +
    // breaker flips the reason).
    it('returns failure_plan_loop when plan_steps_remaining entry passes and breaker preempts', () => {
      // Precondition trace:
      //   planStepsCount = 3 (via planSteps.length=3)
      //   steps.length    = 1
      //   triggers 1/2/3 — skip (routing.continue=false, args non-empty, tool=write_file not in READ_ONLY_TOOL_NAMES)
      //   planStepsCount >= 2 ✓ AND 1 >= 1 ✓ AND 1 < 3 ✓ → entry guard passes
      //   Note: with planStepsCount = 3 > 1, trigger 5's planStepsCount<=1 guard
      //   rejects, so single_write_then_stop never fires regardless of cascade order.
      //   (Pinned by an explicit defensive assertion below.)
      //   Then inside the plan_steps_remaining branch:
      //     continuationsSoFar = 1 ✓
      //     steps[0].result.success = false ✓
      //     responseText contains "I'll now" + "First I'll" + "then I will" + "I'll verify" ✓ (length well within 30-1000 floor/ceiling)
      //     → _detectFailurePlanLoop fires → reason flips to failure_plan_loop,
      //     continuationPrompt empty.
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [
            { action: 'a' },
            { action: 'b' },
            { action: 'c' },
          ],
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: '/* A */' },
            result: { success: false, error: 'permission denied' },
          },
        ],
        responseText:
          "Step 1 failed. I'll now try a different approach. First I'll read the existing file, then I will write the correct version, and finally I'll verify.",
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(false);
      // Defensive: lock down the cascade-order assumption so a future
      // source reorder surfaces a regression failure rather than a quiet
      // semantic shift. planStepsCount=3 > 1 → trigger 5's guard rejected.
      expect(decision.reason).not.toBe('single_write_then_stop');
      expect(decision.reason).toBe('failure_plan_loop');
      expect(decision.continuationPrompt).toBe('');
      // Counter is a PRE-snapshot value (continuationsSoFar is captured
      // before the increment), so the count after a continue=false decision
      // is unchanged.
      expect(decision.continuationsSoFar).toBe(1);
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

    it('returns no_continuation_needed when routing is undefined and steps is empty (and no env-default continues)', () => {
      // With the routing==null catch-all moved to last-resort position,
      // a test of the "nothing-to-continue" shape forces routing={continue:false}
      // so the test is env-robust (resolveDefaultContinue() may flip
      // true in CI vitest runs where LLM_AUTO_CONTINUE_DEFAULT is unset).
      const decision = shouldAutoContinue({
        routing: { continue: false },
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
      // routing={continue:false} forced so the routing==null catch-all
      // (which now sits AFTER the heuristic triggers) doesn't shadow this.
      const decision = shouldAutoContinue({
        routing: { continue: false },
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
        routing: { continue: false },
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
      // routing absent: empty_args fires BEFORE the routing==null catch-all
      // after the producer-ordering fix, so this proves the new ordering.
      const decision = shouldAutoContinue({
        steps: [{ toolName: 'read_file', args: {} }],
        continuationsSoFar: 0,
      });
      expect(decision.reason).toBe('empty_tool_args_detected');
    });
  });

  // ─── CIRCUIT-BREAKER (chat-loop fix) ──────────────────────────────────────
  // The chat-loop bug: when a tool call fails internally (e.g. VFS write
  // TypeError), the LLM receives the error and emits pure plan-language in
  // the next response ("I'll now .. first .. then .. let me .."). The
  // plan_steps_remaining rule re-fires indefinitely because
  // steps.length < planStepsCount keeps being satisfied. The circuit-breaker
  // detects this exact pattern and returns no_continuation_needed so the LLM
  // has to either execute a tool successfully or surface the failure to the
  // user instead of looping.
  describe('circuit-breaker: failure + plan-only response stops the loop', () => {
    it('stops when continuationsSoFar >= 1 AND tool failed AND response is plan-language', () => {
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [
            { action: 'write file A', step: 'A', tool: 'write_file', role: 'coder' },
            { action: 'write file B', step: 'B', tool: 'write_file', role: 'coder' },
            { action: 'write file C', step: 'C', tool: 'write_file', role: 'coder' },
          ],
          estimatedSteps: 3,
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: '/* A */' },
            result: { success: false, error: 'TypeError: Cannot read properties of undefined' },
          },
        ],
        responseText:
          "Step 1 failed. I'll now try a different approach. First I'll read the existing file, then I'll write the correct version, and finally I'll verify.",
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(false);
      expect(decision.reason).toBe('failure_plan_loop');
      expect(decision.continuationPrompt).toBe('');
      expect(decision.continuationsSoFar).toBe(1); // PRE-snapshot counter
    });

    it('does NOT fire when continuationsSoFar === 0 (legitimate first-step completion)', () => {
      // Mirrors the existing unified-agent-service.test.ts fixture for
      // plan_steps_remaining — uses 'Step 1 done.' (no plan words) AND
      // continuationsSoFar: 0. The new rule must not break this path.
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [
            { action: 'step 1' },
            { action: 'step 2' },
            { action: 'step 3' },
          ],
          estimatedSteps: 3,
        },
        steps: [
          { toolName: 'write_file', args: { path: 'src/a.ts', content: '/* step 1 */' } },
        ],
        responseText: 'Step 1 done.',
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });

    it('does NOT fire when the LLM plan_text DOES NOT contain plan-language words', () => {
      // A short failure follow-up that's factual/specific (no plan words)
      // should NOT trip the circuit-breaker — the LLM may still make
      // forward progress on the next iteration.
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [{ action: 'a' }, { action: 'b' }, { action: 'c' }],
          estimatedSteps: 3,
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: 'x' },
            result: { success: false, error: 'quota exceeded' },
          },
        ],
        responseText:
          'Write failed because the workspace quota was exceeded. Concrete next action: delete the unused files in src/legacy/ and retry the write.',
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });

    it('does NOT fire when no tool failed (mixed success + failure is forward progress)', () => {
      // If at least one tool succeeded, the failure-then-plan signal is
      // weaker — the LLM is making real progress, even with one error.
      // The rule must NOT fire; legitimate plan_steps_remaining stays.
      // Fixture uses planSteps=4 with steps=2 (1 read success + 1 write
      // failure) so steps.length < planStepsCount AND hasSuccess=true:
      //   - enters plan_steps_remaining branch (2 < 4 ✓)
      //   - helper short-circuits on `if (!hasFailure || hasSuccess)` because
      //     hasSuccess=true → breaker returns false → keeps firing
      //     plan_steps_remaining
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [
            { action: 'a' },
            { action: 'b' },
            { action: 'c' },
            { action: 'd' },
          ],
          estimatedSteps: 4,
        },
        steps: [
          { toolName: 'read_file', args: { path: 'src/a.ts' }, result: { success: true } },
          {
            toolName: 'write_file',
            args: { path: 'src/b.ts', content: 'x' },
            result: { success: false, error: 'disk full' },
          },
        ],
        responseText:
          "I'll now write the second file. First read it, then I'll merge, finally I'll save.",
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });

    it('does NOT fire when responseText is shorter than the 30-char floor', () => {
      // Below the floor the detector can't tell plan-language apart from a
      // short acknowledgement — fall through to legitimate plan_steps_remaining.
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [{ action: 'a' }, { action: 'b' }],
          estimatedSteps: 2,
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: 'x' },
            result: { success: false, error: 'fail' },
          },
        ],
        responseText: "I'll now.", // 9 chars, below floor
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });

    it('does NOT fire when responseText is longer than the 1000-char ceiling', () => {
      // Long responses that include plan words likely ALSO include real
      // tool calls or concrete content — fall through to plan_steps_remaining.
      // The 'x' padding pushes the length well past the 1000-char ceiling
      // so the LENGTH-CEILING guard is actually tested (not just the regex).
      const longResponse =
        "Step 1 failed because of a TypeError. Here is a detailed diagnosis of the failure mode: the VFS detectBatchMode getter is undefined when the proxy class is re-evaluated under Next.js HMR. To fix this I'll now ... first inspect the proxy class ... then patch the getter ... finally verify the fix end-to-end. " +
        'I will now write the corrected code: ```typescript\nconst x = 1;\n```\nLet me now also check the ... ' +
        'x'.repeat(1000); // push well past 1000 chars (~1400+ total)
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [{ action: 'a' }, { action: 'b' }, { action: 'c' }],
          estimatedSteps: 3,
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: 'x' },
            result: { success: false, error: 'TypeError' },
          },
        ],
        responseText: longResponse,
        continuationsSoFar: 1,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });

    it('does NOT fire when continuationsSoFar === 0 even with all failure + plan-text conditions', () => {
      // The continuationsSoFar >= 1 guard ensures the legitimate first-step
      // path is never broken. If on iteration 0 the LLM fails and writes a
      // plan response, plan_steps_remaining STILL fires (one more chance).
      const decision = shouldAutoContinue({
        routing: {
          continue: false,
          planSteps: [{ action: 'a' }, { action: 'b' }, { action: 'c' }],
          estimatedSteps: 3,
        },
        steps: [
          {
            toolName: 'write_file',
            args: { path: 'src/a.ts', content: 'x' },
            result: { success: false, error: 'fail' },
          },
        ],
        responseText: "I'll now try again. First I'll fix the path, then I'll retry, finally I'll save.",
        continuationsSoFar: 0,
      });
      expect(decision.continue).toBe(true);
      expect(decision.reason).toBe('plan_steps_remaining');
    });
  });
});
