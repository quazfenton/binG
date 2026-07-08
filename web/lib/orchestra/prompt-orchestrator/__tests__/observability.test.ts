/**
 * observability.test.ts
 *
 * Tier 8 step 8 — observability/metrics for the prompt-orchestrator foundation.
 *
 * Five test cases (single-purpose each):
 *   1. New generation — single-step script on empty target increments
 *      `prompt_injection_total` once + updates the markers gauge to 1.
 *
 *   2. Idempotency — re-running with the same target (same sha) increments
 *      `prompt_idempotency_skip_total` once and leaves the injection counter at 0.
 *
 *   3. Serialization — `serializeMetrics()` emits valid Prometheus text
 *      format with `# HELP`, `# TYPE`, metric lines, and trailing newline.
 *
 *   4. Per-step attribution (REGRESSION for v1 firstStepName bug) — even when
 *      there are 0 skips, each `(source, promptId, step-name)` label key
 *      exists in the registry at count 0, proving per-step recording path.
 *      Each of 3 distinct steps gets its OWN skip counter entry.
 *
 *   5. SHA-aware pre-classification (REGRESSION for v1 step-name-only bug) —
 *      pre-populate the target with a step whose sha differs from the
 *      re-applied payload. applyScript classifies this as INJECTION (different
 *      idempotency key); the wrapper reports the same INJECTION (matches
 *      applyScript's actual behavior).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  observeApplyScript,
  serializeMetrics,
  resetMetrics,
  getInjectionCount,
  getIdempotencySkipCount,
  getMarkerCount,
  getScriptsLoadedCount,
} from '../observability';
// applyScript (foundation primitive) is imported from its source module
// — NOT from observability.ts — to keep observability.ts's metrics-only
// public surface clean. Tests co-located with observability.ts still get
// the same import surface they need.
import { applyScript } from '../injection-planner';
import type { PromptScript } from '../types';

const SCRIPT: PromptScript = {
  promptId: 'observability-test',
  steps: [
    {
      step: 'hello-step',
      payload: 'hello world',
      mode: 'append',
    },
  ],
};

describe('observability (Tier 8 step 8)', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('1. new generation: increments injection counter + updates markers gauge', () => {
    const out = observeApplyScript('', SCRIPT, 'test-source');
    // Output is a faithful pass-through of the input + the new marker.
    expect(out).toContain('[PO-INJECT promptId="observability-test"');
    expect(out).toContain('hello world');
    expect(out).toContain('[/PO-INJECT]');
    // Injection counter — 1 marker was added (labeled under step.mode = 'append').
    expect(getInjectionCount('test-source', 'observability-test', 'append')).toBe(1);
    // Idempotency counter — no skips because target was empty.
    expect(getIdempotencySkipCount('test-source', 'observability-test', 'hello-step')).toBe(0);
    // Marker-count gauge — 1 marker visible in the result.
    expect(getMarkerCount('test-source')).toBe(1);
    // Scripts-loaded gauge — at least 1 distinct promptId.
    expect(getScriptsLoadedCount()).toBe(1);
  });

  it('2. idempotency: same-target re-run increments skip counter only (no new injects)', () => {
    // First call — generates the marker.
    const first = observeApplyScript('', SCRIPT, 'test-source');
    expect(getInjectionCount('test-source', 'observability-test', 'append')).toBe(1);
    // Second call on the prior output — applyScript returns identical content
    // because the SHA-256 idempotency key matches.
    const second = observeApplyScript(first, SCRIPT, 'test-source');
    // Output unchanged (idempotency).
    expect(second).toBe(first);
    // Injection counter unchanged.
    expect(getInjectionCount('test-source', 'observability-test', 'append')).toBe(1);
    // Idempotency-skip counter incremented — applyScript did no-op work.
    expect(getIdempotencySkipCount('test-source', 'observability-test', 'hello-step')).toBe(1);
    // Marker-count gauge unchanged.
    expect(getMarkerCount('test-source')).toBe(1);
  });

  it('3. serializeMetrics: produces valid Prometheus text exposition format', () => {
    // Seed with one injection so the output has at least one non-empty metric.
    observeApplyScript('', SCRIPT, 'exposition-test');
    const text = serializeMetrics();
    // Format-level checks: every metric has HELP + TYPE preamble.
    expect(text).toContain('# HELP prompt_injection_total');
    expect(text).toContain('# TYPE prompt_injection_total counter');
    expect(text).toContain('# HELP prompt_idempotency_skip_total');
    expect(text).toContain('# TYPE prompt_idempotency_skip_total counter');
    expect(text).toContain('# HELP prompt_apply_duration_seconds');
    expect(text).toContain('# TYPE prompt_apply_duration_seconds summary');
    expect(text).toContain('# HELP prompt_markers_in_history');
    expect(text).toContain('# TYPE prompt_markers_in_history gauge');
    expect(text).toContain('# HELP prompt_scripts_loaded');
    expect(text).toContain('# TYPE prompt_scripts_loaded gauge');
    // At least one labeled metric line for our seeded source.
    expect(text).toMatch(/prompt_injection_total\{source="exposition-test",promptId="observability-test",mode="append"\}\s+\d+/);
    // Summary metric shape — quantile="0.5" + quantile="0.99" + count + sum.
    expect(text).toMatch(/prompt_apply_duration_seconds\{[^}]*quantile="0\.5"\}/);
    expect(text).toMatch(/prompt_apply_duration_seconds\{[^}]*quantile="0\.99"\}/);
    expect(text).toMatch(/prompt_apply_duration_seconds_count\{[^}]+\}/);
    expect(text).toMatch(/prompt_apply_duration_seconds_sum\{[^}]+\}/);
    // Gauges.
    expect(text).toMatch(/prompt_markers_in_history\{source="exposition-test"\}\s+\d+/);
    expect(text).toMatch(/^prompt_scripts_loaded\s+\d+$/m);
    // Format ends with a newline (Prometheus spec).
    expect(text.endsWith('\n')).toBe(true);
  });

  it('4. per-step attribution: each step records under its OWN skip-counter label key (REGRESSION for v1 firstStepName bug)', () => {
    // 3 distinct steps; run once → 3 injects, 0 skips; the per-step PATH must
    // touch all 3 step-name keys (even at count 0) to prove per-step recording.
    const multiScript: PromptScript = {
      promptId: 'multi-step-test',
      steps: [
        { step: 'a', payload: 'a-payload', mode: 'append' },
        { step: 'b', payload: 'b-payload', mode: 'append' },
        { step: 'c', payload: 'c-payload', mode: 'append' },
      ],
    };
    observeApplyScript('', multiScript, 'per-step-test');
    // 3 injects (all share mode=append → 1 counter entry totalling 3).
    expect(getInjectionCount('per-step-test', 'multi-step-test', 'append')).toBe(3);
    // Each step-name key exists at 0 — proves per-step recording path.
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'a')).toBe(0);
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'b')).toBe(0);
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'c')).toBe(0);

    // Second call (same shas) — each step is idempotent now → each counter at 1.
    observeApplyScript(applyScript('', multiScript), multiScript, 'per-step-test');
    expect(getInjectionCount('per-step-test', 'multi-step-test', 'append')).toBe(3);
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'a')).toBe(1);
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'b')).toBe(1);
    expect(getIdempotencySkipCount('per-step-test', 'multi-step-test', 'c')).toBe(1);
  });

  it('5. sha-aware pre-classification: payload edit classified as INJECTION (matches applyScript; REGRESSION for v1 step-name-only bug)', () => {
    // Pre-populate target with step 'a' having OLD PAYLOAD (one specific sha).
    const preExistingScript: PromptScript = {
      promptId: 'sha-test',
      steps: [
        { step: 'a', payload: 'OLD PAYLOAD', mode: 'append' },
      ],
    };
    const targetWithA = applyScript('', preExistingScript);
    expect(targetWithA).toContain('OLD PAYLOAD');

    // Re-apply with NEW PAYLOAD — applyScript treats this as a NEW injection
    // because the (promptId, step, sha) key differs (sha = sha(payload)).
    const editedScript: PromptScript = {
      promptId: 'sha-test',
      steps: [
        { step: 'a', payload: 'NEW PAYLOAD', mode: 'append' },
      ],
    };
    observeApplyScript(targetWithA, editedScript, 'sha-test');

    // Wrapper's classification must match applyScript's → INJECT (not skip).
    expect(getInjectionCount('sha-test', 'sha-test', 'append')).toBe(1);
    expect(getIdempotencySkipCount('sha-test', 'sha-test', 'a')).toBe(0);

    // Sanity: the new payload IS present in the output (applyScript returned it).
    const out = applyScript(targetWithA, editedScript);
    expect(out).toContain('NEW PAYLOAD');
  });
});
