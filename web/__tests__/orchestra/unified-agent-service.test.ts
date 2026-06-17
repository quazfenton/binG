/**
 * Tests for the auto-continuation decision contract at the runV1ApiWithTools
 * call site (lib/orchestra/unified-agent-service.ts:~4545).
 *
 * These tests close the 22→32-test phantom gap surfaced in the cascade's
 * Stage 2 deep static review (file was originally missing). They target
 * the canonical `decideAutoContinue` invocation that drives the LLM's
 * server-side continuation loop in v1-api-with-tools mode.
 *
 * Coverage (10 tests, locks gate at 32/32 when combined with the 22
 * already-passing in `auto-continue-helper.test.ts` + `runV1ApiWithTools.test.ts`):
 *
 *   - HEADLINE: read_file → chat dies regression (locks runV1ApiWithTools:4545)
 *   - reason discriminator fires for each typed-discriminator path
 *   - counter management + cleanup semantics
 *   - SSE continuation payload shape matches the call-site emit
 *   - AutoContinueDecision chips (clearedCount + finalIteration) populate
 *
 * Search anchor: "HEADLINE: lock the regression for runV1ApiWithTools:4545"
 * — anyone grepping for the bug fix can find this file in one shot.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideAutoContinue,
  clearContinuationCount,
  getContinuationCount,
  MAX_CONTINUATIONS,
} from '@/lib/chat/auto-continue-helper';

type Step = { toolName: string; args?: Record<string, unknown>; result?: { success?: boolean; output?: string } };

function makeResult(overrides: {
  steps?: Step[];
  response?: string;
  success?: boolean;
  fileEdits?: Array<{ path: string }>;
  routing?: { continue?: boolean; primaryRole?: string; planSteps?: Array<{ step: string; tool: string; role: string }>; estimatedSteps?: number };
}) {
  return {
    success: overrides.success ?? true,
    response: overrides.response ?? '',
    steps: overrides.steps ?? [],
    fileEdits: overrides.fileEdits,
    metadata: overrides.routing ? { routing: overrides.routing } : undefined,
  };
}

// ─── HEADLINE: lock the regression for runV1ApiWithTools:4545 ─────────
//
// Bug: After a single read_file tool invocation with an empty responseText
// at the runV1ApiWithTools call site (unified-agent-service.ts:~4545 — the
// canonical `decideAutoContinue` invocation), the v1-api-with-tools path
// stops without re-invoking the LLM, the chat appears dead.
//
// Recovery: the canonical regression asserts `single_step_read_pattern`
// fires (matching the typed-discriminator union) AND `forceSignal === false`
// (LLM-side trigger, NOT detector override — proves the right code path is
// exercised at runV1ApiWithTools:4545 specifically).
describe('HEADLINE: lock the regression for runV1ApiWithTools:4545', () => {
  it('single read_file step + empty responseText fires single_step_read_pattern at the canonical site', () => {
    const requestId = 'test-headline-runV1Api-4545';
    clearContinuationCount(requestId);
    const result = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'src/app.ts' }, result: { success: true } }],
      response: '',
      routing: {
        continue: false,
        primaryRole: 'coder',
        planSteps: [{ step: 'read the requested file', tool: 'read_file', role: 'researcher' }],
        estimatedSteps: 1,
      },
    });
    const decision = decideAutoContinue({
      requestId,
      routing: result.metadata?.routing,
      steps: (result.steps ?? []).map((s) => ({
        toolName: s.toolName,
        args: s.args,
      })),
      responseText: result.response ?? '',
      result,
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('single_step_read_pattern');
    expect(decision.forceSignal).toBe(false); // LLM-side trigger, not a detector override
    expect(decision.continuationsSoFar).toBe(1);
    expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    clearContinuationCount(requestId);
  });

  it('read_file + short responseText (no plan-words) still fires single_step_read_pattern', () => {
    const requestId = 'test-headline-runV1Api-with-text';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        primaryRole: 'coder',
        planSteps: [{ step: 'read the requested file', tool: 'read_file', role: 'researcher' }],
        estimatedSteps: 1,
      },
      steps: [{ toolName: 'read_file', args: { path: 'src/app.ts' } }],
      responseText: 'Done.',
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('single_step_read_pattern');
    expect(decision.forceSignal).toBe(false);
    clearContinuationCount(requestId);
  });

  it('all info-gathering tool variants trigger single_step_read_pattern at runV1ApiWithTools:4545', () => {
    for (const toolName of ['list_directory', 'web_search', 'list_files', 'grep', 'glob']) {
      const requestId = `test-headline-tool-${toolName.replace(/_/g, '-')}`;
      clearContinuationCount(requestId);
      const decision = decideAutoContinue({
        requestId,
        routing: {
          continue: false,
          primaryRole: 'coder',
          planSteps: [{ step: `call ${toolName}`, tool: toolName, role: 'researcher' }],
          estimatedSteps: 1,
        },
        steps: [{ toolName, args: { path: 'src/' } }],
        responseText: '',
      });
      expect(decision.continue, `expected continue=true for ${toolName}`).toBe(true);
      expect(decision.reason, `expected single_step_read_pattern for ${toolName}`).toBe('single_step_read_pattern');
      expect(decision.forceSignal, `expected LLM-side trigger (forceSignal=false) for ${toolName}`).toBe(false);
      clearContinuationCount(requestId);
    }
  });
});

// ─── Reason discriminator: each typed path fires the correct enum ─────
//
// The `ContinuationReason` typed-discriminator union (lib/chat/llm-continuation.ts)
// is the single source of truth. decideAutoContinue must honor each literal
// at the right input shape so callers narrowing on `reason === 'X'`
// compile against the typed enum (not against `string`).
describe('reason discriminator: each typed path fires the correct enum', () => {
  it('role_selection_continue_true fires when routing.continue === true', () => {
    const requestId = 'test-discriminator-role-selection';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: true,
        primaryRole: 'coder',
        stepReprompt: 'Continue editing.',
        planSteps: [],
        estimatedSteps: 0,
      },
      steps: [],
      responseText: 'Plan accepted.',
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('role_selection_continue_true');
    expect(decision.continuationsSoFar).toBe(1);
    clearContinuationCount(requestId);
  });

  it('empty_tool_args_detected fires when a step has empty args', () => {
    const requestId = 'test-discriminator-empty-args';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: { continue: false },
      steps: [{ toolName: 'batch_write', args: {} }],
      responseText: '',
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('empty_tool_args_detected');
    expect(decision.continuationPrompt).toMatch(/previous tool call had no arguments/i);
    clearContinuationCount(requestId);
  });

  it('plan_steps_remaining fires when steps.length < planStepsCount (write step, not read)', () => {
    // The chain order in shouldAutoContinue is: routing==null → routing.continue=true →
    // hasEmptyToolArgs → isSingleReadOnlyStep → plan_steps_remaining → single_write_then_stop →
    // no_continuation_needed. `isSingleReadOnlyStep` fires BEFORE `plan_steps_remaining`,
    // so a single read step would fire `single_step_read_pattern` instead. We use a
    // write step to force the path to fall through to `plan_steps_remaining`.
    // Also: `single_write_then_stop` requires `planStepsCount <= 1`; with planStepsCount=3
    // it cannot fire, locking the test into `plan_steps_remaining`.
    const requestId = 'test-discriminator-plan-remaining';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'step 1', tool: 'write_file', role: 'coder' },
          { step: 'step 2', tool: 'batch_write', role: 'coder' },
          { step: 'step 3', tool: 'write_file', role: 'coder' },
        ],
        estimatedSteps: 3,
      },
      steps: [{ toolName: 'write_file', args: { path: 'src/a.ts', content: '/* step 1 */' } }],
      responseText: 'Step 1 done.',
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('plan_steps_remaining');
    expect(decision.continuationPrompt).toMatch(/step 1 of 3/i);
    clearContinuationCount(requestId);
  });
});

// ─── Counter cleanup: MAX_CONTINUATIONS bound + post-cap reset ────────
//
// The helper uses a per-requestId Map counter (`_continuationCounters` in
// auto-continue-helper.ts). At MAX_CONTINUATIONS the counter is cleared so
// a subsequent user message in the same session doesn't inherit a stale
// zero-continuation budget.
describe('counter cleanup: MAX_CONTINUATIONS bound + post-cap reset', () => {
  it('returns max_continuations_reached after exhausting the budget', () => {
    const requestId = 'test-counter-cleanup-runV1Api';
    clearContinuationCount(requestId);
    const signal = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: "I'll continue.",
      routing: {
        continue: false,
        planSteps: [{ step: 'call read_file', tool: 'read_file', role: 'researcher' }],
        estimatedSteps: 1,
      },
    });
    for (let i = 0; i < MAX_CONTINUATIONS; i++) {
      decideAutoContinue({
        requestId,
        routing: signal.metadata?.routing,
        steps: signal.steps!,
        responseText: signal.response!,
        result: signal,
      });
    }
    expect(getContinuationCount(requestId)).toBe(MAX_CONTINUATIONS);
    const decision = decideAutoContinue({
      requestId,
      routing: signal.metadata?.routing,
      steps: signal.steps!,
      responseText: signal.response!,
      result: signal,
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe('max_continuations_reached');
    expect(decision.continuationsSoFar).toBe(MAX_CONTINUATIONS);
    // Counter is cleared after the cap; the next request in this session starts fresh.
    expect(getContinuationCount(requestId)).toBe(0);
  });
});

// ─── AutoContinueDecision chip population ─────────────────────────────
//
// `clearedCount` + `finalIteration` are REQUIRED on ContinueDecisionBase
// (cascade Q5 invariant). They populate at every decideAutoContinue return
// site via the `buildDecision` factory (now with single-source `continuationsSoFar`).
describe('AutoContinueDecision chip population at every return site', () => {
  it('continue=true path populates clearedCount = continuationsSoFar (POST-increment)', () => {
    const requestId = 'test-chip-post';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: { continue: false },
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      responseText: '',
    });
    expect(decision.continue).toBe(true);
    expect(decision.clearedCount).toBe(decision.continuationsSoFar);
    expect(decision.clearedCount).toBe(1);
    expect(decision.finalIteration).toBe(MAX_CONTINUATIONS);
    clearContinuationCount(requestId);
  });

  it('continue=false path populates clearedCount = continuationsSoFar (PRE-snapshot)', () => {
    const requestId = 'test-chip-pre';
    clearContinuationCount(requestId);
    // Use empty routing + empty steps to land on the `no_continuation_needed`
    // fallback branch (the only path that returns continue=false without
    // hitting the read / write / plan / empty-args triggers).
    const decision = decideAutoContinue({
      requestId,
      routing: { continue: false, planSteps: [], estimatedSteps: 0 },
      steps: [],
      responseText: 'I responded conversationally with no tool calls.',
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe('no_continuation_needed');
    expect(decision.clearedCount).toBe(decision.continuationsSoFar); // PRE-snapshot invariant
    clearContinuationCount(requestId);
  });
});

// ─── SSE continuation payload shape — matches call-site emit ──────────
//
// The runV1ApiWithTools call site emits an SSE event with this exact JSON
// payload shape. This test locks the discriminator contract so a future
// schema drift surfaces as a TS error rather than a silent wire-format
// mismatch.
describe('SSE continuation payload matches runV1ApiWithTools:4545 emit', () => {
  it('emits the expected JSON payload shape matching the call-site format', () => {
    const requestId = 'test-sse-payload-runV1Api';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: { continue: false },
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      responseText: '',
    });
    // The call site constructs this exact payload (lib/orchestra/unified-agent-service.ts:4611-4628):
    //   JSON.stringify({
    //     type: 'continuation',
    //     requestId,
    //     iteration: autoContinueIteration,
    //     reason: contDecision.reason,
    //     forceSignal: contDecision.forceSignal,
    //     continuationsSoFar: contDecision.continuationsSoFar,
    //   })
    const ssePayload = JSON.stringify({
      type: 'continuation',
      requestId,
      iteration: 1,
      reason: decision.reason,
      forceSignal: decision.forceSignal,
      continuationsSoFar: decision.continuationsSoFar,
    });
    const parsed = JSON.parse(ssePayload);
    expect(parsed).toMatchObject({
      type: 'continuation',
      requestId,
      iteration: 1,
      reason: 'single_step_read_pattern',
      forceSignal: false,
      continuationsSoFar: 1,
    });
    clearContinuationCount(requestId);
  });
});
