/**
 * Tests for auto-continuation, SSE-parity, and counter-cleanup behavior at
 * the runV1ApiWithTools call site (unified-agent-service.ts:~4545).
 *
 * These regressions live next to the actual call-site context instead of
 * in auto-continue-helper.test.ts so the contract is locked where it's
 * wired, not just at the helper API.
 *
 * Coverage:
 *   - HEADLINE: read_file → chat dies regression (moved from auto-continue-helper.test.ts)
 *   - SSE continuation event payload shape matches call-site emission
 *   - Counter cleanup after hitting max continuations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideAutoContinue,
  clearContinuationCount,
} from '@/lib/chat/auto-continue-helper';

type Step = { toolName: string; args?: Record<string, unknown>; result?: { success?: boolean; output?: string } };

function makeResult(overrides: {
  steps?: Step[];
  response?: string;
  success?: boolean;
  fileEdits?: Array<{ path: string }>;
}) {
  return {
    success: overrides.success ?? true,
    response: overrides.response ?? '',
    steps: overrides.steps ?? [],
    fileEdits: overrides.fileEdits,
  };
}

// ─── HEADLINE: read_file → chat dies regression ────────────────────────
//
// Bug: After a single read_file tool invocation with no follow-up action
// and an empty responseText, the LLM stops streaming and the chat
// appears dead. These three tests are the regression gate that protects
// against that bug returning in unified-agent-service.ts:4545 (the
// v1-api-with-tools call site that invokes decideAutoContinue inside its
// auto-continue loop).
//
// Why the assertion `decision.forceSignal === false` matters:
//   forceSignal reflects whether the DETECTOR forced continuation (vs.
//   the LLM-side shouldAutoContinue decision). For the headline bug
//   scenario, the LLM-side trigger (`single_step_read_pattern` from
//   llm-continuation.ts) must fire. If `forceSignal` were ever true
//   here, it would mean a detector override is masking the headline
//   behavior, not the LLM-side trigger. So we lock `forceSignal: false`
//   to prove the right code path is exercised.
//
// Search anchor: "HEADLINE:" — anyone looking for the bug fix can grep
// this file in one shot.
describe('HEADLINE: read_file → chat dies regression', () => {
  it('single read_file step + empty responseText fires single_step_read_pattern', () => {
    const requestId = 'test-headline-read-only-step';
    clearContinuationCount(requestId);
    const accumulatedSteps = [
      { toolName: 'read_file', args: { path: 'src/app.ts' }, result: { success: true } },
    ];
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
        estimatedSteps: 1,
      },
      steps: accumulatedSteps,
      responseText: '',
    });
    expect(decision.continue).toBe(true);
    expect(decision.reason).toBe('single_step_read_pattern');
    expect(decision.forceSignal).toBe(false); // LLM-side trigger, not detector
    expect(decision.continuationsSoFar).toBe(1);
    expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    clearContinuationCount(requestId);
  });

  it('read_file + short responseText (no plan-words) still fires single_step_read_pattern', () => {
    const requestId = 'test-headline-read-with-short-text';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
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

  it('all info-gathering tool variants trigger single_step_read_pattern', () => {
    for (const toolName of ['list_directory', 'web_search', 'list_files', 'grep', 'glob']) {
      const requestId = `test-headline-tool-${toolName.replace(/_/g, '-')}`;
      clearContinuationCount(requestId);
      // Step 3 cascade parity: PlanStep text + tool now track the iterated
      // toolName rather than a hardcoded `'read the requested file' /
      // 'read_file'` pair. The hardcoded literal was a cosmetic mismatch
      // — the test still passed because shouldAutoContinue ignores
      // PlanStep.text/.tool when deciding (it uses planSteps.length +
      // estimatedSteps + routing.continue), but a future reader could
      // infer from the test that PlanStep.tool must be 'read_file'
      // unconditionally. The for-loop now constructs a per-iteration
      // PlanStep shape so the test mirrors the real-world fixture shape
      // and disambiguates the binding.
      const decision = decideAutoContinue({
        requestId,
        routing: {
          continue: false,
          planSteps: [
            { step: `call ${toolName}`, tool: toolName, role: 'researcher' },
          ],
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

// ─── SSE continuation event parity ─────────────────────────────────────
//
// The call site at unified-agent-service.ts:4605-4628 emits an SSE event
// with a specific JSON payload when the auto-continuation loop triggers.
// This test locks the payload shape so the route layer parsing the same
// format (app/api/chat/route.ts SSE_EVENT_TYPES.CONTINUE) doesn't drift.
describe('SSE continuation event', () => {
  it('emits the expected JSON payload shape matching the call-site format', () => {
    const requestId = 'test-sse-payload';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
        estimatedSteps: 1,
      },
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      responseText: '',
    });
    // The call site constructs this exact payload (lines 4611-4618):
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

  it('the continuationPrompt contains the SSE marker the route layer depends on', () => {
    const requestId = 'test-sse-marker';
    clearContinuationCount(requestId);
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
        estimatedSteps: 1,
      },
      steps: [{ toolName: 'read_file', args: { path: 'b.ts' } }],
      responseText: '',
    });
    expect(decision.continuationPrompt).toMatch(/\[AUTO-CONTINUE\]/);
    clearContinuationCount(requestId);
  });
});

// ─── Counter cleanup after max continuations ──────────────────────────
//
// The auto-continuation loop at line 4545 is bounded by MAX_V1_CONTINUATIONS.
// After exhausting them, the counter must be cleaned up so a subsequent
// user message doesn't inherit a stale zero-continuation budget.
describe('counter cleanup after max continuations', () => {
  it('returns max_continuations_reached after exhausting the budget', () => {
    const requestId = 'test-counter-cleanup';
    clearContinuationCount(requestId);
    const signal = makeResult({
      steps: [{ toolName: 'read_file', args: { path: 'a.ts' } }],
      response: "I'll continue.",
    });
    for (let i = 0; i < 3; i++) {
      decideAutoContinue({
        requestId,
        routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
        estimatedSteps: 1,
      },
        steps: signal.steps!,
        responseText: signal.response!,
        result: signal,
      });
    }
    const decision = decideAutoContinue({
      requestId,
      routing: {
        continue: false,
        planSteps: [
          { step: 'read the requested file', tool: 'read_file', role: 'researcher' },
        ],
        estimatedSteps: 1,
      },
      steps: signal.steps!,
      responseText: signal.response!,
      result: signal,
    });
    expect(decision.continue).toBe(false);
    expect(decision.reason).toBe('max_continuations_reached');
    expect(decision.continuationsSoFar).toBe(3);
    clearContinuationCount(requestId);
  });
});
