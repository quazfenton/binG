/**
 * Bug #69 (Pass-5 #69) — FC-GATE: LLM called 0 tools despite 19 available.
 *
 * Symptom (BUGS_AUDIT.md L2885–2911): LLM returned `finishReason: "stop"` with
 * 0 tool calls despite 19 tools being available. Root cause: the prior detector
 * in `streamWithCLIBinary` (Pass-5 Round-2 fix) called wireFinishReasonSteer
 * with `availableTools: 0` HARDCODED, which short-circuited the inner guard
 * (`if (availableTools > 0 && toolCallsDone === 0) …`). Result: NO steer
 * prompt was ever produced, the run.log audit never saw a `[STEER]` line, the
 * `[FC-GATE-ZERO-CALLS]` failure mode was invisible, and the orchestrator
 * silently fell back to the provider fallback chain (wasting credits).
 *
 * This suite locks the regression fix:
 *
 *   1. The orchestrator emits a `[FC-GATE-ZERO-CALLS]` run.log structured
 *      event with provider/model/availableTools/toolCallsDone / steerLength
 *      fields (so run.log greppers can detect the failure mode specifically).
 *
 *   2. `wireFCGateZeroCallsSteer` returns an actual steer prompt (NOT null)
 *      that distinguishes FC-GATE-0-call from generic `missing_tool_call`
 *      — tells the LLM "FC-GATE passed earlier, do NOT fall back to plain
 *      text" rather than "plain text is not enough for this task".
 *
 *   3. Steer metrics track `fc_gate_no_call` in their own bucket — the audit
 *      can count FC-GATE failures separately from generic missing-tool-call.
 *
 *   4. The fallback chain is NOT invoked when this branch fires — verified
 *      by checking the steer is non-null AND that the orchestrator would
 *      inject the steer into the next turn (NOT drop into provider fallback).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the underlying logger so the chatLogger spy doesn't trip over a logger
// that wants to write to stderr in a CI environment.
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import { chatLogger } from '@/lib/chat/chat-logger';
import {
  buildSteerPrompt,
  steerMetrics,
  wireFCGateZeroCallsSteer,
  emitFCGateZeroCallsLog,
  type SteerTrigger,
} from '@/lib/orchestra/steer-service';

describe('Bug #69 — FC-GATE: LLM called 0 tools despite 19 available', () => {
  beforeEach(() => {
    steerMetrics.reset();
    vi.restoreAllMocks();
  });

  describe('wireFCGateZeroCallsSteer — the FC-GATE-specific detector', () => {
    it('detects the FC-GATE-0-calls failure mode (text, 0 calls, tools available, finish=stop)', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Here is some narrative content…',
        finishReason: 'stop',
        provider: 'mistral',
        model: 'mistral-small-latest',
      });
      expect(result.detected).toBe(true);
      expect(result.steer).not.toBeNull();
      expect(result.steer).toMatch(/^\[STEER\]/);
    });

    it('does NOT detect when text was empty (handled separately as empty_completion)', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: '',
        finishReason: 'stop',
      });
      expect(result.detected).toBe(false);
      expect(result.steer).toBeNull();
    });

    it('does NOT detect when text was whitespace-only (responseText.trim() === "")', () => {
      // Boundary case: production guard is responseText.trim().length > 0, so a
      // whitespace-only string should be treated the same as empty (NOT an
      // FC-GATE-0-calls case).
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: '   \n\t  \n',
        finishReason: 'stop',
      });
      expect(result.detected).toBe(false);
      expect(result.steer).toBeNull();
    });

    it('does NOT detect when tools were called', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 3,
        availableTools: 19,
        responseText: '…',
        finishReason: 'stop',
      });
      expect(result.detected).toBe(false);
      expect(result.steer).toBeNull();
    });

    it('does NOT detect when availableTools is 0 (not an FC-GATE case)', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 0,
        responseText: 'Some text',
        finishReason: 'stop',
      });
      expect(result.detected).toBe(false);
      expect(result.steer).toBeNull();
    });

    it('does NOT detect when finishReason was an error (not "stop" or undefined)', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Some text',
        finishReason: 'error',
      });
      expect(result.detected).toBe(false);
      expect(result.steer).toBeNull();
    });

    it('detects when finishReason is undefined (treats undefined as "stop-ish")', () => {
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Some text',
        // finishReason: undefined,
      });
      expect(result.detected).toBe(true);
      expect(result.steer).not.toBeNull();
    });

    it('increments the steerMetrics counter for fc_gate_no_call', () => {
      expect(steerMetrics.countOf('fc_gate_no_call')).toBe(0);
      wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Some text',
        finishReason: 'stop',
        provider: 'mistral',
        model: 'mistral-small-latest',
      });
      expect(steerMetrics.countOf('fc_gate_no_call')).toBe(1);
    });

    it('does NOT increment steerMetrics when the FC-GATE condition is not met', () => {
      // Pathological empty-response case — the steer service must NOT emit a
      // false-positive metric. async-emit side effects are guarded by the
      // detected=false early return.
      wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: '',
        finishReason: 'stop',
      });
      expect(steerMetrics.countOf('fc_gate_no_call')).toBe(0);
    });
  });

  describe('FC-GATE steer prompt — distinguishes from missing_tool_call', () => {
    it('mentions "FC-GATE" explicitly with Phase 1 / Phase 2 context for LLM precision', () => {
      const trigger: SteerTrigger = {
        kind: 'fc_gate_no_call',
        detail: {
          availableTools: 19,
          provider: 'mistral',
          model: 'mistral-small-latest',
          finishReason: 'stop',
          responseLength: 142,
        },
      };
      const prompt = buildSteerPrompt(trigger);
      expect(prompt).toMatch(/^\[STEER\]/);
      // Phase 1 / Phase 2 are the canonical FC-GATE terms from the audit.
      // Their presence in the prompt means the LLM will recognize the
      // failure mode from previous training/fine-tuning.
      expect(prompt).toMatch(/FC-GATE/i);
      expect(prompt).toMatch(/Phase 1 passed/i);
      expect(prompt).toMatch(/Phase 2 text-mode/i);
      expect(prompt).toMatch(/19/);
      expect(prompt).toMatch(/mistral-small-latest/);
      expect(prompt).toMatch(/responseLength=142/);
    });

    it('tells the LLM NOT to take the FC-GATE Phase 2 text-mode fallback', () => {
      const trigger: SteerTrigger = {
        kind: 'fc_gate_no_call',
        detail: { availableTools: 19, responseLength: 100 },
      };
      const prompt = buildSteerPrompt(trigger);
      // Phase 2 text-mode is the canonical term — informs the LLM both
      // WHY it failed (function calling capable) and what to AVOID (the
      // Phase 2 fallback path).
      expect(prompt).toMatch(/Phase 2 text-mode/i);
      expect(prompt).toMatch(/Do NOT/);
    });

    it('orders the prompt under the 1200-char steer budget', () => {
      // Bug #1/#21/#22/#31 budget: prompts under ~1200 chars so the next turn's
      // system prompt doesn't grow unbounded. fc_gate_no_call inherits the same
      // bound — verify the longest plausible input stays under it.
      const trigger: SteerTrigger = {
        kind: 'fc_gate_no_call',
        detail: {
          availableTools: 99,
          provider: 'mistral',
          model: 'mistral-small-latest-with-some-long-suffix',
          finishReason: 'stop',
          responseLength: 4096,
        },
      };
      const prompt = buildSteerPrompt(trigger);
      expect(prompt.length).toBeLessThan(1200);
    });
  });

  describe('run.log structured event — [FC-GATE-ZERO-CALLS] marker', () => {
    it('emits a warn carrying the [FC-GATE-ZERO-CALLS] marker AND structured fields', () => {
      const warnSpy = vi.spyOn(chatLogger, 'warn');

      // Simulate the orchestrator's detector firing (matches the production
      // call site in enhanced-llm-service.ts streamWithCLIBinary).
      const detection = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Here is some narrative content…',
        finishReason: 'stop',
        provider: 'mistral',
        model: 'mistral-small-latest',
      });
      if (detection.detected) {
        // Pass-8 seam-cleanup followup (b): production now routes through the
        // single-sourced emitFCGateZeroCallsLog helper exported from
        // steer-service.ts (was an inline chatLogger.warn call). The test
        // mirrors the production call exactly so the marker string and field
        // naming cannot drift between code and test.
        emitFCGateZeroCallsLog({
          provider: 'mistral',
          model: 'mistral-small-latest',
          availableTools: 19,
          toolCallsDone: 0,
          responseLength: 32,
          steerLength: detection.steer?.length || 0,
        });
      }

      expect(warnSpy).toHaveBeenCalled();
      const lastCall = warnSpy.mock.calls[warnSpy.mock.calls.length - 1];
      const [firstArg, secondArg] = lastCall;
      // First arg carries the [FC-GATE-ZERO-CALLS] grep-friendly marker.
      expect(String(firstArg)).toContain('[FC-GATE-ZERO-CALLS]');
      expect(String(firstArg)).toMatch(/0 tool calls/);
      // Second arg carries structured fields for the run.log audit pipeline.
      expect(secondArg).toMatchObject({
        provider: 'mistral',
        model: 'mistral-small-latest',
        availableTools: 19,
        toolCallsDone: 0,
      });
      // steerLength is recorded so the audit can correlate the warn with the
      // steer prompt length (sentinel: 0 means bug regression — the steer
      // service returned null again).
      expect((secondArg as any).steerLength).toBeGreaterThan(0);
    });

    it('does NOT emit a warn when the FC-GATE condition is not met', () => {
      const warnSpy = vi.spyOn(chatLogger, 'warn');
      const detection = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: '',
        finishReason: 'stop',
      });
      // Code-reviewer polish round (must-fix): mirror production's gate
      // `if (detection.detected) emitFCGateZeroCallsLog(...)`. Without the
      // gated sentinel call, this test would pass against ANY production
      // code that doesn't always warn (too weak). With the gate below,
      // a future refactor that accidentally removes the production gate
      // will fire this warnSpy and flip the assertion.
      if (detection.detected) {
        emitFCGateZeroCallsLog({
          provider: 'unknown',
          model: 'unknown',
          availableTools: 0,
          toolCallsDone: 0,
          responseLength: 0,
          steerLength: 0,
        });
      }
      // The detector returns detected=false. The orchestrator skips the warn.
      // Verify NO [FC-GATE-ZERO-CALLS] log line was emitted by the steer
      // call we just made (the steer service itself must not emit a false-positive).
      expect(
        warnSpy.mock.calls.some(
          ([arg]) => String(arg).includes('[FC-GATE-ZERO-CALLS]'),
        ),
      ).toBe(false);
      expect(steerMetrics.countOf('fc_gate_no_call')).toBe(0);
    });

    it('emits the marker distinct from the legacy [STEER] finishReason stop marker', () => {
      const warnSpy = vi.spyOn(chatLogger, 'warn');
      wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Some text',
        finishReason: 'stop',
        provider: 'mistral',
        model: 'mistral-small-latest',
      });
      // The chatLogger.warn call is the orchestrator's — not the steer service
      // itself. Verify the warn element would carry the new marker if fired.
      warnSpy.mock.calls.forEach(([arg]) => {
        // Either the new marker (FC-GATE-ZERO-CALLS) or the legacy
        // ([STEER] finishReason stop …) may appear — but the steer service
        // does NOT log either; we verify it does not accidentally log the
        // legacy marker.
        expect(String(arg)).not.toContain('[STEER] finishReason stop');
      });
    });
  });

  describe('Regression guard: steer path vs fallback chain', () => {
    it('returns a non-null steer so the orchestrator short-circuits the fallback chain', () => {
      // The OLD broken detector returned null because availableTools was
      // hardcoded to 0. With null, the orchestrator silently fell through to
      // the fallback chain (provider retry) — which BURNS CREDITS on a model
      // that already demonstrated it cannot handle FC-GATE. The fix MUST
      // return a non-null steer to surface the FC-GATE failure as a [STEER]-
      // driven retry rather than a provider retry.
      const result = wireFCGateZeroCallsSteer({
        toolCallsDone: 0,
        availableTools: 19,
        responseText: 'Some narrative text',
        finishReason: 'stop',
        provider: 'mistral',
        model: 'mistral-small-latest',
      });
      expect(result.steer).not.toBeNull();
      expect(result.steer!.length).toBeGreaterThan(50);
      // The steer explicitly tells the model to invoke a tool, NOT to retry
      // via a different provider.
      expect(result.steer!.toLowerCase()).toMatch(/invoke|pick.*tool|choose/);
    });
  });
});
