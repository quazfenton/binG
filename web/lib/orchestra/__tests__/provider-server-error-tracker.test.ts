/**
 * Regression tests for the PR-D Provider Server Error Tracker.
 *
 * PR-D adds a parallel-server-error tracker for HTTP 500/502/503/504
 * failures. The tracker mirrors `provider-530-tracker.ts`:
 *   - recordServerError / isServerErrorBlacklisted / resetServerErrorCounter / getServerErrorCount
 *   - Tunable threshold via `SERVER_ERROR_BLACKLIST_THRESHOLD` (default 2)
 *   - Opt-in success reset via `ENABLE_SERVER_ERROR_RESET_ON_SUCCESS=1` (default OFF)
 *
 * Tests use the same `vi.resetModules()` + dynamic `await import(...)`
 * cache-busting pattern as the 530 tracker tests, so each test reads
 * `process.env` at its own module-load and never leaks to subsequent tests.
 *
 * T-D1: default OFF — success-branch helper is a no-op (counter NOT cleared).
 * T-D2: regression — provider clears server-error blacklist on first success when flag ON.
 * T-D3: configurable threshold — `SERVER_ERROR_BLACKLIST_THRESHOLD=3` overrides default 2.
 * T-D4: detection coverage — {500, 502, 503, 504} status all increment; 404 does not.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('provider-server-error-tracker — PR-D 5xx resettable blacklist (default OFF)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS;
    delete process.env.SERVER_ERROR_BLACKLIST_THRESHOLD;
  });

  it('T-D1 default OFF: maybeResetServerErrorOnSuccess is a no-op when flag is disabled', async () => {
    const mod = await import('../provider-server-error-tracker?env-d-off');
    // Default-OFF contract — strict equality with '1'.
    expect(mod.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS).toBe(false);
    // Drive up the count with two recordServerError calls — at threshold 2
    // (default) the provider should be blacklisted.
    mod.recordServerError('openrouter');
    mod.recordServerError('openrouter');
    expect(mod.isServerErrorBlacklisted('openrouter')).toBe(true);
    // Flag OFF → counter stays put on success; the helper is a typed no-op.
    mod.maybeResetServerErrorOnSuccess('openrouter');
    expect(mod.getServerErrorCount('openrouter')).toBe(2);
    expect(mod.isServerErrorBlacklisted('openrouter')).toBe(true);
  });

  it('T-D2 bug-fix regression: provider clears 5xx blacklist on first success when flag ON', async () => {
    // Operator-visible scenario the PR fixes: provider hit 2 consecutive
    // 5xx and got blacklisted. Pre-PR-D it stays blacklisted until the
    // next non-5xx error. Post-PR-D with flag ON, a single successful
    // round-trip (via maybeResetServerErrorOnSuccess) clears the counter.
    process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-server-error-tracker?env-d-on');
    expect(mod.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS).toBe(true);
    expect(mod.isServerErrorBlacklisted('mistral')).toBe(false);
    mod.recordServerError('mistral');
    mod.recordServerError('mistral');
    expect(mod.isServerErrorBlacklisted('mistral')).toBe(true);
    // The new helper — simulate a successful round-trip happening at the
    // call site which now calls maybeResetServerErrorOnSuccess(provider).
    mod.maybeResetServerErrorOnSuccess('mistral');
    expect(mod.isServerErrorBlacklisted('mistral')).toBe(false);
    expect(mod.getServerErrorCount('mistral')).toBe(0);
  });

  it('T-D3 configurable threshold: SERVER_ERROR_BLACKLIST_THRESHOLD=3 overrides default 2', async () => {
    // First load defaults.
    const modDefault = await import('../provider-server-error-tracker?env-d-default');
    expect(modDefault.getServerErrorBlacklistThreshold()).toBe(2);

    // Two errors at default threshold 2 should already blacklist.
    modDefault.recordServerError('openrouter');
    modDefault.recordServerError('openrouter');
    expect(modDefault.isServerErrorBlacklisted('openrouter')).toBe(true);

    // Reset env, set custom threshold 3, reload module.
    process.env.SERVER_ERROR_BLACKLIST_THRESHOLD = '3';
    vi.resetModules();
    const modCustom = await import('../provider-server-error-tracker?env-d-thresh3');
    expect(modCustom.getServerErrorBlacklistThreshold()).toBe(3);

    // Two errors under threshold 3 must NOT blacklist.
    modCustom.recordServerError('anthropic');
    modCustom.recordServerError('anthropic');
    expect(modCustom.isServerErrorBlacklisted('anthropic')).toBe(false);
    expect(modCustom.getServerErrorCount('anthropic')).toBe(2);

    // Third error trips the blacklist.
    modCustom.recordServerError('anthropic');
    expect(modCustom.isServerErrorBlacklisted('anthropic')).toBe(true);

    // Invalid threshold values fall back to default 2 rather than
    // disabling the tracker entirely.
    process.env.SERVER_ERROR_BLACKLIST_THRESHOLD = '0';
    vi.resetModules();
    const modZero = await import('../provider-server-error-tracker?env-d-thresh0');
    expect(modZero.getServerErrorBlacklistThreshold()).toBe(2);
    process.env.SERVER_ERROR_BLACKLIST_THRESHOLD = 'not-a-number';
    vi.resetModules();
    const modBogus = await import('../provider-server-error-tracker?env-d-threshNaN');
    expect(modBogus.getServerErrorBlacklistThreshold()).toBe(2);
  });

  it('T-D4 detection coverage: 500/502/503/504 all increment; 404 (and 530) do not', async () => {
    process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS = '0';
    vi.resetModules();
    const mod = await import('../provider-server-error-tracker?env-d-detection');

    // Provider-agnostic: hit the per-call entry point
    // `recordServerErrorIfApplicable(provider, error)` so we test the
    // actual isServerError detection, not just the typed
    // `recordServerError` incrementer.
    for (const status of [500, 502, 503, 504]) {
      const provider = `p-${status}`;
      mod.recordServerErrorIfApplicable(provider, { status });
      expect(
        mod.getServerErrorCount(provider),
        `expected status ${status} to increment`,
      ).toBe(1);
      // Second hit at default threshold of 2 trips the blacklist.
      mod.recordServerErrorIfApplicable(provider, { status });
      expect(
        mod.isServerErrorBlacklisted(provider),
        `expected status ${status} (count 2) to be blacklisted`,
      ).toBe(true);
    }

    // 404 — client error, NOT a server error. Two consecutive 404s
    // must NOT trip the blacklist (they should RESET it as the
    // recordServerErrorIfApplicable helper expects non-server errors
    // to clear the counter).
    mod.recordServerErrorIfApplicable('client-err', { status: 404 });
    mod.recordServerErrorIfApplicable('client-err', { status: 404 });
    expect(mod.getServerErrorCount('client-err')).toBe(0);
    expect(mod.isServerErrorBlacklisted('client-err')).toBe(false);

    // 530 is the origin-unreachable code — must NOT count here, that's
    // the separate 530 tracker's responsibility. Two consecutive 530s
    // should leave this tracker at 0 (it's a non-server-error failure
    // from this tracker's POV, so the helper resets the counter).
    mod.recordServerErrorIfApplicable('530-provider', { status: 530 });
    mod.recordServerErrorIfApplicable('530-provider', { status: 530 });
    expect(mod.getServerErrorCount('530-provider')).toBe(0);
    expect(mod.isServerErrorBlacklisted('530-provider')).toBe(false);

    // Message-based detection: a plain-string message should also
    // trip the detector when statusCode fields are absent.
    mod.recordServerErrorIfApplicable('msg-503', {
      message: 'HTTP 503 Service Unavailable',
    });
    mod.recordServerErrorIfApplicable('msg-503', {
      message: 'HTTP 503 Service Unavailable',
    });
    expect(mod.isServerErrorBlacklisted('msg-503')).toBe(true);

    // Status field alias — some libs use `statusCode` instead of `status`.
    mod.recordServerErrorIfApplicable('statusCode-502', { statusCode: 502 });
    mod.recordServerErrorIfApplicable('statusCode-502', { statusCode: 502 });
    expect(mod.isServerErrorBlacklisted('statusCode-502')).toBe(true);
  });
});

/**
 * PR-G regression coverage — opt-in success-branch reset wire-up to
 * `unified-agent-service.ts` (mirrors PR-F for the 530 tracker).
 *
 * T-D1..T-D4 above test the server-error tracker module in isolation.
 * T-G1..T-G3 below test the cross-module contract that PR-G depends on:
 *
 *   - T-G1: opt-in flag strict-equality with '1' (matches PR-C T-C6 contract).
 *   - T-G2: orthogonality — `maybeResetServerErrorOnSuccess` does NOT
 *     touch the 530 counter, and `maybeReset530OnSuccess` does NOT
 *     touch the server-error counter. The two trackers must remain
 *     fully independent even when both flags are ON.
 *   - T-G3: safety — reset on success is a no-op for non-blacklisted
 *     providers (count=0 stays 0; partial count below threshold is
 *     cleared by a successful round-trip).
 */
describe('provider-server-error-tracker — PR-G enable-flag contract + cross-module orthogonality', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS;
    delete process.env.SERVER_ERROR_BLACKLIST_THRESHOLD;
    delete process.env.ENABLE_530_RESET_ON_SUCCESS;
  });

  it('T-G1 flag contract: ENABLE_SERVER_ERROR_RESET_ON_SUCCESS strictly equals env === "1"', async () => {
    // The opt-in contract is "literal string '1' ONLY" — mirrors PR-C
    // T-C6 fix: every other truthy-looking value leaves the flag false.
    const cases: Array<{ envVal: string | undefined; expected: boolean; slug: string }> = [
      { envVal: '1', expected: true, slug: 'on' },
      { envVal: '0', expected: false, slug: 'zero' },
      { envVal: 'true', expected: false, slug: 'true' },
      { envVal: 'on', expected: false, slug: 'on-word' },
      { envVal: 'TRUE', expected: false, slug: 'TRUE' },
      { envVal: ' 1 ', expected: false, slug: 'padded' },
      { envVal: '2', expected: false, slug: 'two' },
      { envVal: undefined, expected: false, slug: 'UNSET' },
      { envVal: '', expected: false, slug: 'empty' },
    ];
    for (let i = 0; i < cases.length; i++) {
      const { envVal, expected, slug } = cases[i]!;
      if (envVal === undefined) {
        delete process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS;
      } else {
        process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS = envVal;
      }
      vi.resetModules();
      const mod = await import(
        `../provider-server-error-tracker?T-G1-${i}-${slug}`
      );
      expect(
        mod.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS,
        `case envVal=${JSON.stringify(envVal)} expected=${expected}`,
      ).toBe(expected);
    }
  });

  it('T-G2 cross-module orthogonality: 530-reset and server-error-reset are independent', async () => {
    // Both flags ON so each helper's success-reset branch is active.
    process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS = '1';
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    const modSE = await import('../provider-server-error-tracker?T-G2-SE');
    const mod530 = await import('../provider-530-tracker?T-G2-530');

    const provider = 'oracle-shared';
    // Drive BOTH counters to their respective blacklist thresholds (default 2).
    modSE.recordServerError(provider);
    modSE.recordServerError(provider);
    mod530.record530Error(provider);
    mod530.record530Error(provider);

    expect(modSE.isServerErrorBlacklisted(provider)).toBe(true);
    expect(mod530.is530Blacklisted(provider)).toBe(true);

    // Success on the v1-api-with-tools path: server-error cleared,
    // 530 counter must remain untouched (orthogonality guarantee).
    modSE.maybeResetServerErrorOnSuccess(provider);
    expect(modSE.isServerErrorBlacklisted(provider)).toBe(false);
    expect(modSE.getServerErrorCount(provider)).toBe(0);
    expect(mod530.is530Blacklisted(provider)).toBe(true);
    expect(mod530.get530Count(provider)).toBe(2);

    // And the converse: success on the 530-tracked path clears 530
    // but must not retroactively affect the server-error counter
    // (which we already cleared above — still 0).
    mod530.maybeReset530OnSuccess(provider);
    expect(mod530.is530Blacklisted(provider)).toBe(false);
    expect(mod530.get530Count(provider)).toBe(0);
    expect(modSE.getServerErrorCount(provider)).toBe(0);

    // Repeat with the success-reset arriving in the OPPOSITE order
    // to make sure clearing A first doesn't pollute B's records.
    modSE.recordServerError(provider); // se=1
    modSE.recordServerError(provider); // se=2 → blacklisted
    mod530.record530Error(provider); // 530=1
    mod530.record530Error(provider); // 530=2 → blacklisted

    // 530-reset fires first (e.g. a 530-storm-recovery success path):
    expect(mod530.is530Blacklisted(provider)).toBe(true);
    mod530.maybeReset530OnSuccess(provider);
    expect(mod530.is530Blacklisted(provider)).toBe(false);
    // server-error counter untouched — still blacklisted.
    expect(modSE.isServerErrorBlacklisted(provider)).toBe(true);
    expect(modSE.getServerErrorCount(provider)).toBe(2);
  });

  it('T-G3 reset on success is a safe no-op when count is zero or below threshold', async () => {
    process.env.ENABLE_SERVER_ERROR_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-server-error-tracker?T-G3-noop');

    // Provider that has never failed — reset must be a safe no-op
    // (no throw, no phantom count entry, blacklist stays false).
    expect(mod.getServerErrorCount('never-failed')).toBe(0);
    mod.maybeResetServerErrorOnSuccess('never-failed');
    expect(mod.getServerErrorCount('never-failed')).toBe(0);
    expect(mod.isServerErrorBlacklisted('never-failed')).toBe(false);

    // Provider with a partial count of 1 (below threshold 2) — the
    // success-branch helper should clear the partial counter so a
    // future failure starts at 1 again, not 2.
    mod.recordServerError('partially-failing');
    expect(mod.getServerErrorCount('partially-failing')).toBe(1);
    mod.maybeResetServerErrorOnSuccess('partially-failing');
    expect(mod.getServerErrorCount('partially-failing')).toBe(0);
    expect(mod.isServerErrorBlacklisted('partially-failing')).toBe(false);

    // Provider with a full blacklist — the helper clears it (sanity
    // check; this is also covered in T-D2 but we re-assert with the
    // ORTHOGONAL counter on the 530 side untouched).
    mod.recordServerError('fully-failing');
    mod.recordServerError('fully-failing');
    expect(mod.isServerErrorBlacklisted('fully-failing')).toBe(true);
    mod.maybeResetServerErrorOnSuccess('fully-failing');
    expect(mod.getServerErrorCount('fully-failing')).toBe(0);
    expect(mod.isServerErrorBlacklisted('fully-failing')).toBe(false);
  });
});
