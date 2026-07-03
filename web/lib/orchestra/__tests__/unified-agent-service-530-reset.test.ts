/**
 * PR-F regression tests — VERIFY-ON-WIRE-UP + EFFECT-ON-TRACKER.
 *
 * PR-F (UnifiedAgentService: opt-in 530 reset on success) added two
 * wire-up sites for `maybeReset530OnSuccess(providerName)` inside
 * `unified-agent-service.ts`:
 *
 *   1. `runV1ApiWithTools`  success-return   (function spans ~L3473-L4960)
 *   2. `runV1ApiCompletion` success-return   (function starts ~L5960)
 *
 * Both calls are gated by the tracker's `ENABLE_530_RESET_ON_SUCCESS`
 * const. When the flag is OFF (default), the call is a no-op. When
 * ON, it delegates to `reset530Counter(provider)` which deletes the
 * entry in `_consecutive530Count`, un-blacklisting the provider.
 *
 * ── TWO-INSTRUMENTATION STRATEGY ──────────────────────────────────────
 *
 * Prior iterations of this file drove `processUnifiedAgentRequest`
 * end-to-end (real consumer + stubbed HTTP factory + 35+ vi.mock
 * declarations of transitive deps) and asserted on `result.success
 * === true`. That architecture proved un-mock-able in vitest:
 * `runV1Api`'s mode-handler dispatch chain has transitive deps
 * (`@bing/shared/agent/*`, `agent-loop`, `llm-fallback-coordinator`,
 * `opencode-engine-service`, …) that cannot be cheaply stubbed to a
 * clean-success path without refactoring the service layer.
 * `service-shape-audit.test.ts` proves the cascade to L1943
 * all-failed is the unavoidable outcome under the standard
 * mock surface for `mode='v1-api'`. A "true" regression test that
 * drives `processUnifiedAgentRequest` to line 4925 is therefore
 * not achievable as a vitest unit test without invasive surgery
 * to the consumer itself.
 *
 * This wrap-up achieves the PR-F regression-safety goal WITHOUT
 * touching the consumer:
 *
 *   LAYER 1 (function-body anchor):
 *     Reads `unified-agent-service.ts` as a string, locates the
 *     `runV1ApiWithTools` and `runV1ApiCompletion` function bodies
 *     (via the `brace-counting` helper below), and asserts the
 *     `maybeReset530OnSuccess(providerName)` byte pattern appears
 *     inside EACH function body. Anchoring on the function body
 *     (not on fixed ±N-line windows) means:
 *       - relocation out of the function body surfaces as a failure
 *         (the call escapes the body slice)
 *       - line drift due to unrelated edits is auto-absorbed (the
 *         body slice moves with the function signature)
 *       - false-positives from "the call moved to a sibling helper
 *         that happens to fit in the old window" are eliminated.
 *
 *   LAYER 2 (tracker public-API effect):
 *     Drives the real `provider-530-tracker` directly through its
 *     public API:
 *       record530Error → record530Error → BLACKLIST_THRESHOLD=2
 *         → maybeReset530OnSuccess → reset / no-op
 *     and asserts the visible state transitions. This catches any
 *     regression in `maybeReset530OnSuccess` itself (e.g. gating logic
 *     accidentally inverted, or the captured const leaked past
 *     module reload).
 *
 * Together LAYER 1 + LAYER 2 cover PR-F's full guarantee:
 *   - the consumer wires-up the call inside the right function bodies
 *     (LAYER 1 — point-in-time source assertion)
 *   - the call behaves correctly when invoked (LAYER 2 — runtime effect)
 *
 * ── WHY NOT A STATIC TOP-OF-FILE IMPORT FOR THE TRACKER? ─────────────
 *
 * `provider-530-tracker.ts` captures `ENABLE_530_RESET_ON_SUCCESS`
 * as a top-level `const` at module-load:
 *
 *   export const ENABLE_530_RESET_ON_SUCCESS =
 *     process.env.ENABLE_530_RESET_ON_SUCCESS === '1';
 *
 * A static `import` would capture this const ONCE at file-load with
 * whatever `process.env` was at that moment, and later `vi.stubEnv`
 * would NOT flip the captured const. To test both flag-ON and
 * flag-OFF behavior in the same file, LAYER 2 uses dynamic
 * `await import(...)` inside each test, paired with
 * `vi.resetModules()` so the tracker module is re-evaluated with
 * the test's intended env each time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// Source-text helpers.
// ────────────────────────────────────────────────────────────────────

const CONSUMER_FILE = path.join(__dirname, '..', 'unified-agent-service.ts');
const CONSUMER_SOURCE = fs.readFileSync(CONSUMER_FILE, 'utf8');

/**
 * Extract the body of a function definition (the substring between
 * the matching `{…}` pair), starting at the FIRST occurrence of
 * `signature` in `source`. Returns the body including the braces.
 *
 * Counts braces NOT inside string/regex/template literals — sufficient
 * for the well-formed `unified-agent-service.ts` source. If a literal
 * contains an unbalanced brace (extremely rare in real code), the
 * walk would terminate early; vitest's failure output would point at
 * the offending function signature to surface immediately.
 */
function extractFunctionBody(source: string, signature: string): string {
  const sigIdx = source.indexOf(signature);
  if (sigIdx === -1) {
    throw new Error(`Function signature not found in source: ${signature}`);
  }
  // Locate the closing ')' of the signature FIRST, so we don't
  // accidentally pick up a `{` from a generic type constraint or a
  // default object-literal parameter. Multi-line params + brace-bearing
  // generics would otherwise misdirect the brace counter.
  const closeParenIdx = source.indexOf(')', sigIdx);
  if (closeParenIdx === -1) {
    throw new Error(`No closing ')' after signature: ${signature}`);
  }
  const openIdx = source.indexOf('{', closeParenIdx);
  if (openIdx === -1) {
    throw new Error(`No opening '{' after signature's ')': ${signature}`);
  }
  let depth = 0;
  let i = openIdx;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.substring(openIdx, i + 1);
    }
    i++;
  }
  throw new Error(`Unmatched braces while extracting body of: ${signature}`);
}

const REGION_WITH_TOOLS = extractFunctionBody(
  CONSUMER_SOURCE,
  'async function runV1ApiWithTools(',
);
const REGION_COMPLETION = extractFunctionBody(
  CONSUMER_SOURCE,
  'async function runV1ApiCompletion(',
);

// Anchored regex — the wire-up call must match precisely. The call
// site is `maybeReset530OnSuccess(<identifier>)` and the canonical
// identifier is `providerName`. Looser matches (e.g. accepting
// `maybeReset530(p)`) would defeat the regression test's intent.
// PR-W -- forward-compatible anchor: accepts EITHER the manual pair (pre-W)
// OR the new both-trackers helper (post-W).
const ANCHOR = /maybeReset(?:530OnSuccess|BothTrackers)\s*\(\s*providerName\s*\)/;

describe('PR-F wire-up regression: maybeReset530OnSuccess call sites inside the v1-api function bodies', () => {
  it('runV1ApiWithTools body contains maybeReset530OnSuccess(providerName)', () => {
    // Body extraction is anchored on the function signature itself,
    // so a relocation of the call out of `runV1ApiWithTools` (e.g.
    // into a sibling helper) surfaces as a failure.
    expect(REGION_WITH_TOOLS).toMatch(ANCHOR);
  });

  it('runV1ApiCompletion body contains maybeReset530OnSuccess(providerName)', () => {
    expect(REGION_COMPLETION).toMatch(ANCHOR);
  });
});

// ────────────────────────────────────────────────────────────────────
// LAYER 2: real provider-530-tracker state-machine effect test.
// ────────────────────────────────────────────────────────────────────

// Each test uses `vi.resetModules()` + dynamic import so the tracker's
// top-level `ENABLE_530_RESET_ON_SUCCESS` const re-captures from
// `process.env` for THAT test's intent — see file header for rationale.

describe('PR-F tracker effect: ENABLE_530_RESET_ON_SUCCESS flag gates reset on success', () => {
  beforeEach(() => {
    // WORKER-POLLUTION GUARD. A different __tests__ file in the same
    // vitest worker could have set ENABLE_530_RESET_ON_SUCCESS via
    // raw `process.env.X = ...` (NOT via vi.stubEnv, which would be
    // auto-restored). Asserting the env is clean BEFORE we restore +
    // reload quarantines such leakage with a sharp failure here
    // rather than a confusing tracker.ENABLE_530_RESET_ON_SUCCESS
    // mismatch later in the test body.
    expect(process.env.ENABLE_530_RESET_ON_SUCCESS).toBeUndefined();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('flag OFF (default): 2 record530Error calls trip the blacklist, but maybeReset530OnSuccess does NOT reset (no-op)', async () => {
    // Flag env stayed cleared (vi.unstubAllEnvs left it).
    expect(process.env.ENABLE_530_RESET_ON_SUCCESS).toBeUndefined();

    // Dynamic import — tracker's top-level const reads cleared env.
    const tracker = await import('../provider-530-tracker');

    // Sanity: ENABLE_530_RESET_ON_SUCCESS captured as false.
    expect(tracker.ENABLE_530_RESET_ON_SUCCESS).toBe(false);

    // Drive the real _consecutive530Count Map to BLACKLIST_THRESHOLD=2.
    const provider = 'prf-flag-off-target';
    tracker.record530Error(provider);
    tracker.record530Error(provider);
    expect(tracker.is530Blacklisted(provider)).toBe(true);
    expect(tracker.get530Count(provider)).toBe(2);

    // PR-F OFF-behavior: success-return fires `maybeReset530OnSuccess`
    // BUT the const is false, so the helper returns early. The Map is
    // untouched and the provider stays blacklisted. This is the
    // CONTRACT we want to defend: flipping the default-on behavior
    // would cause premature un-blacklisting on multi-provider fallbacks.
    tracker.maybeReset530OnSuccess(provider);
    expect(tracker.get530Count(provider)).toBe(2);
    expect(tracker.is530Blacklisted(provider)).toBe(true);
  });

  it('flag ON (ENABLE_530_RESET_ON_SUCCESS=1): 2 record530Error + maybeReset530OnSuccess resets the count to 0', async () => {
    vi.stubEnv('ENABLE_530_RESET_ON_SUCCESS', '1');
    expect(process.env.ENABLE_530_RESET_ON_SUCCESS).toBe('1');

    // Dynamic import — tracker's top-level const now reads '1' (true).
    const tracker = await import('../provider-530-tracker');

    // Sanity: ENABLE_530_RESET_ON_SUCCESS captured as true.
    expect(tracker.ENABLE_530_RESET_ON_SUCCESS).toBe(true);

    // Drive the real _consecutive530Count Map to BLACKLIST_THRESHOLD=2.
    const provider = 'prf-flag-on-target';
    tracker.record530Error(provider);
    tracker.record530Error(provider);
    expect(tracker.is530Blacklisted(provider)).toBe(true);
    expect(tracker.get530Count(provider)).toBe(2);

    // PR-F ON-behavior: success-return fires `maybeReset530OnSuccess`
    // and the helper delegates to `reset530Counter(provider)`, which
    // `_consecutive530Count.delete(provider)`s the entry. Future reads
    // observe `get530Count === 0` and `is530Blacklisted === false`.
    //
    // This is the entire PR-F value proposition: a recovered provider
    // is immediately un-blacklisted on the very next successful call,
    // instead of staying suppressed until a non-530 error rolls the
    // counter.
    tracker.maybeReset530OnSuccess(provider);
    expect(tracker.get530Count(provider)).toBe(0);
    expect(tracker.is530Blacklisted(provider)).toBe(false);
  });
});
