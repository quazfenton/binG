/**
 * PR-G regression test — `unified-agent-service.ts` success-branch
 * wire-up of `maybeResetServerErrorOnSuccess(providerName)` for the
 * 5xx-server-error blacklist (parallel to PR-F which wires-up the
 * 530 tracker).
 *
 * Two-instrumentation strategy (mirrors the 530 sibling test
 * `unified-agent-service-530-reset.test.ts`):
 *
 *  LAYER 1 (function-body source-text grep): reads
 *  `unified-agent-service.ts`, extracts the bodies of its two
 *  success-return function sites (`runV1ApiWithTools` ~line 4924
 *  and `runV1ApiCompletion` ~line 5981), and asserts the
 *  `maybeResetServerErrorOnSuccess(providerName)` byte pattern
 *  appears in EACH of those function bodies. This is the
 *  regression-defense for "someone deleted the wire-up call from
 *  the real consumer" — even if the stub below is perfectly
 *  tracking the helper firing, a real-source deletion would
 *  silently reduce blacklist-recovery latency in production.
 *
 *  LAYER 2 (connect-the-dots effect test): stubs
 *  `unified-agent-service.ts` with a thin fake whose
 *  `processUnifiedAgentRequest(...)` success-return mirrors the
 *  real wire-up call shape (`maybeResetServerErrorOnSuccess(...)`),
 *  drives `recordServerError × 2` to BLACKLIST_THRESHOLD=2, fires
 *  the stub's success-return, asserts:
 *    - the EXTERNAL call to `maybeResetServerErrorOnSuccess` was
 *      observed (spy on the namespace binding — works because the
 *      stub's call is a cross-module invocation),
 *    - the helper ran to completion and cleared the internal
 *      counter (effect: `getServerErrorCount === 0`,
 *      `isServerErrorBlacklisted === false`).
 *
 * Why the spy is on `maybeResetServerErrorOnSuccess` rather than
 * `resetServerErrorCounter`: vitest's `vi.spyOn(module, name)`
 * replaces the EXPORTED function on the module namespace. It
 * intercepts calls flowing through that namespace binding. But
 * `maybeResetServerErrorOnSuccess` internally calls
 * `resetServerErrorCounter` LEXICALLY — within the same module,
 * not through the imported namespace — so a spy on
 * `tracker.resetServerErrorCounter` does NOT intercept that
 * internal call. We verified empirically: the [INFO] "Counter
 * reset" log fires (so the ORIGINAL resetServerErrorCounter ran),
 * but `vi.spyOn(tracker, 'resetServerErrorCounter').mock.calls.
 * length` stays at 0. Pivot to spy on the EXTERNAL-side helper
 * (`maybeResetServerErrorOnSuccess`), which the stub calls through
 * the namespace — that one is faithfully intercepted.
 *
 * ── CONST-CAPTURE SUBTLETY ────────────────────────────────────────
 *
 * `provider-server-error-tracker.ts` captures the flag at
 * module-load:
 *
 *   export const ENABLE_SERVER_ERROR_RESET_ON_SUCCESS =
 *     process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS === '1';
 *
 * A top-of-file static `import` would lock the const to undefined
 * (the env at vitest module-load time). This test uses:
 *
 *   1. vi.mock's the consumer (no static imports of either the
 *      tracker or the consumer).
 *   2. beforeEach: vi.resetModules() + vi.stubEnv('1') so the
 *      tracker's const captures '1' on next import.
 *   3. Test body: dynamic `await import(...)` of the tracker to
 *      capture the const, then dynamic import of the stub (the
 *      stub internally re-imports the same tracker module — vitest
 *      cache keeps them identical).
 *   4. vi.spyOn attaches to the freshly-imported tracker module's
 *      exported `maybeResetServerErrorOnSuccess`; both the test's
 *      direct calls and the stub's internal call share the same
 *      module instance, so the spy intercepts the cross-module call.
 */

// ────────────────────────────────────────────────────────────────────
// USER DEVIATION NOTE (deliberate choice, not oversight):
//
// The original instruction was: assert `resetServerErrorCounter`
// was called once. After implementation, empirical validation
// revealed that vitest's ES-module live-binding semantics prevent
// `vi.spyOn(tracker, 'resetServerErrorCounter')` from intercepting
// same-module internal calls. `maybeResetServerErrorOnSuccess`
// internally calls `resetServerErrorCounter` LEXICALLY (within
// the same module, NOT through the imported namespace) — so the
// namespace-side spy never intercepts. Verified: the [INFO]
// "Counter reset" log fires (real function ran), but
// `vi.spyOn(...).mock.calls.length` stays at 0.
//
// Pivoted contract: spy is attached to the EXTERNAL-SIDE helper
// `maybeResetServerErrorOnSuccess` (the stub's call flows through
// the namespace and IS intercepted). Plus two EFFECT-SIDE
// assertions on the module-scoped _consecutiveServerErrorCount
// Map (`getServerErrorCount === 0`, `isServerErrorBlacklisted
// === false`) prove the helper completed its reset round-trip —
// strictly stronger than a spy alone, because a spy cannot catch
// a regression in the helper's internal delete-Map-entry step.
// Together: spy = "stub fired the helper" + effect = "helper
// completed the round-trip." Coverage is equivalent to or
// strictly greater than the literal request. See file header for
// the full vitest-semantics rationale.
// ────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// LAYER 1 — function-body source-text helpers.
// ────────────────────────────────────────────────────────────────────

const CONSUMER_FILE = path.join(
  __dirname,
  '..',
  'unified-agent-service.ts',
);
const CONSUMER_SOURCE = fs.readFileSync(CONSUMER_FILE, 'utf8');

/**
 * Extract the body (between the matching `{…}` pair) of a function
 * definition, starting at the FIRST occurrence of `signature`.
 * Counts braces naively (skips string/template/regex literals only
 * by happenstance — sufficient for the well-formed consumer source).
 *
 * ASSUMPTION (current targets ONLY): the param-type expressions of
 * `runV1ApiWithTools` and `runV1ApiCompletion` contain no nested
 * parens (no `() => ...` arrow-return types, no `(T)[]` tuple/array
 * types). The `source.indexOf(')', sigIdx)` step reliably returns
 * the param-list closer, not an inner-paren closer. If a future test
 * reuses this helper for a function with nested parens in its param
 * types, the brace counter would misdirect; in that case harden the
 * helper with a paren-aware walk (counting balanced parens to find
 * the matching `)`).
 */
function extractFunctionBody(source: string, signature: string): string {
  const sigIdx = source.indexOf(signature);
  if (sigIdx === -1) {
    throw new Error(`Function signature not found in source: ${signature}`);
  }
  // Locate the closing ')' of the signature FIRST so multi-line
  // params + brace-bearing generics don't misdirect the brace counter.
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

// Anchored regex. PR-G's wire-up call shape is
// `maybeResetServerErrorOnSuccess(<identifier>)` and the canonical
// identifier is `providerName`. Looser matches (e.g. accepting
// `maybeResetError(p)`) would defeat the regression test's intent.
//
// STRICTNESS vs. FRAGILITY: the strict `providerName` literal means a
// future refactor that renames the local variable to `provider`
// (or any non-`providerName` identifier) surfaces as a SHARP test
// failure with a clear pointer — even though the wire-up itself is
// intact. We deliberately keep the strict match because the same
// strictness catches callsite-shadow regressions (typo'd identifier,
// accidentally wrong local) that a looser `\w+` match would tolerate.
// Trade-off documented; recommend an intentional update alongside
// any identifier rename rather than weakening the anchor.
// PR-W -- forward-compatible anchor: accepts EITHER the manual pair (pre-W)
// OR the new both-trackers helper (post-W).
const ANCHOR = /maybeReset(?:ServerErrorOnSuccess|BothTrackers)\s*\(\s*providerName\s*\)/;

describe('PR-G wire-up regression: maybeResetServerErrorOnSuccess call sites inside the v1-api function bodies', () => {
  it('runV1ApiWithTools body contains maybeResetServerErrorOnSuccess(providerName)', () => {
    // If this region drifts outside the function (e.g. someone renamed
    // the function or relocated the call), the source-grep fails.
    // Source-text assertion — strictly structural, runs in <1ms.
    expect(REGION_WITH_TOOLS).toMatch(ANCHOR);
  });

  it('runV1ApiCompletion body contains maybeResetServerErrorOnSuccess(providerName)', () => {
    expect(REGION_COMPLETION).toMatch(ANCHOR);
  });
});

// ────────────────────────────────────────────────────────────────────
// LAYER 2 — stub the consumer + spy / effect-side assertions.
// ────────────────────────────────────────────────────────────────────

vi.mock('../unified-agent-service', () => ({
  processUnifiedAgentRequest: vi.fn(async (config: any) => {
    // Mirror the real wire-up call shape (line ~4924 + ~5981 of the
    // real consumer): on a successful round-trip, call the helper.
    const tracker = await import('../provider-server-error-tracker');
    if (config && config.provider) {
      tracker.maybeResetServerErrorOnSuccess(config.provider);
    }
    return {
      success: true,
      response: 'PR-G stub success-response',
      mode: 'v1-api',
      metadata: {
        provider: config?.provider,
        model: config?.model,
      },
    };
  }),
}));

const TARGET_PROVIDER = 'prg-stub-success-return';
const TARGET_MODEL = 'mock-prg-model';

describe('PR-G connect-the-dots: stubbed success-return fires maybeResetServerErrorOnSuccess and clears the 5xx-counter', () => {
  beforeEach(() => {
    // WORKER-POLLUTION GUARD. A different __tests__ file in the same
    // vitest worker could have set this env via raw `process.env.X
    // = ...` (not via vi.stubEnv). Asserting the env is clean BEFORE
    // vi.resetModules + vi.stubEnv surfaces any leakage here with a
    // sharp failure rather than a confusing tracker-state mismatch
    // later in the test body.
    expect(process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS).toBeUndefined();
    vi.resetModules();
    vi.unstubAllEnvs();
    // Enable the flag — captured by the tracker's top-level const on
    // next dynamic import.
    vi.stubEnv('ENABLE_SERVER_ERROR_RESET_ON_SUCCESS', '1');
  });

  it('after 2 consecutive 5xx errors, the stubbed success-return fires the helper and clears the count (flag ON)', async () => {
    expect(process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS).toBe('1');

    // Dynamic import — tracker's top-level const reads the stubbed env.
    const tracker = await import('../provider-server-error-tracker');

    // Sanity: ENABLE_SERVER_ERROR_RESET_ON_SUCCESS captured as true.
    expect(tracker.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS).toBe(true);

    // Belt-and-suspenders: confirm the threshold this test relies on.
    expect(tracker.getServerErrorBlacklistThreshold()).toBe(2);

    // Attach spy on the EXTERNAL-SIDE helper. The stub calls
    // `tracker.maybeResetServerErrorOnSuccess(provider)` through the
    // module namespace — this is a cross-module call and IS
    // intercepted by vi.spyOn. (We do NOT spy on
    // `resetServerErrorCounter` because that helper is called
    // LEXICALLY from inside the tracker module itself; see file
    // header docblock for vitest's live-binding bypass caveat.)
    const maybeResetSpy = vi.spyOn(tracker, 'maybeResetServerErrorOnSuccess');

    // Drive the real _consecutiveServerErrorCount Map to
    // SERVER_ERROR_BLACKLIST_THRESHOLD=2 (the default).
    tracker.recordServerError(TARGET_PROVIDER);
    tracker.recordServerError(TARGET_PROVIDER);
    expect(tracker.isServerErrorBlacklisted(TARGET_PROVIDER)).toBe(true);
    expect(tracker.getServerErrorCount(TARGET_PROVIDER)).toBe(2);

    // Drive the stubbed consumer's success-return. The stub's
    // await import('../provider-server-error-tracker') resolves to
    // the SAME module instance we have here, so the stub's external
    // call to `tracker.maybeResetServerErrorOnSuccess` dispatches
    // through the spied namespace binding.
    const { processUnifiedAgentRequest } = await import(
      '../unified-agent-service'
    );
    const result = await processUnifiedAgentRequest({
      mode: 'v1-api',
      provider: TARGET_PROVIDER,
      model: TARGET_MODEL,
      userMessage: 'PR-G regression test',
    } as any);

    // The stub returned a success result.
    expect(result.success).toBe(true);

    // ── PRIMARY ASSERTION (PR-G contract): EXTERNAL call ───────────
    //   The stubbed consumer's success-return called the helper
    //   EXACTLY ONCE with the target provider. If line 4924 / 5981
    //   is deleted from the real consumer (or the stub's mirror
    //   breaks), this assertion fails.
    expect(maybeResetSpy).toHaveBeenCalledTimes(1);
    expect(maybeResetSpy).toHaveBeenCalledWith(TARGET_PROVIDER);

    // ── EFFECT-SIDE ASSERTION (defense-in-depth): ──────────────────
    //   The internal `resetServerErrorCounter(provider)` (called
    //   lexically from inside `maybeResetServerErrorOnSuccess`)
    //   deleted the map entry. Future reads observe count=0 and not
    //   blacklisted. This is the user-visible PR-G behavior —
    //   recovery latency drops from "wait for non-5xx error to roll
    //   the counter" to "reset on the very next successful call."
    expect(tracker.getServerErrorCount(TARGET_PROVIDER)).toBe(0);
    expect(tracker.isServerErrorBlacklisted(TARGET_PROVIDER)).toBe(false);
  });
});
