/**
 * Regression tests for the PR-C ENABLE_530_RESET_ON_SUCCESS flag.
 *
 * PR-C adds an opt-in flag (default OFF) under which every successful
 * round-trip clears the consecutive-530 counter for that provider. This
 * lets a provider recover immediately on a happy-path call after
 * hitting BLACKLIST_THRESHOLD=2x 530s, rather than remaining blacklisted
 * until the next non-530 error rolls the counter.
 *
 * The flag is read at module-load, so each test that flips the env var
 * must `vi.resetModules()` and re-import to pick up the new value.
 *
 * T-C1: flag default OFF is a no-op (reset530Counter NOT called)
 * T-C2: flag ON calls reset530Counter exactly once
 * T-C3: bug-fix regression — provider clears blacklist on first success when flag ON
 * T-C4: idempotent — calling twice for a provider at count 0 is safe
 * T-C5: provider isolation — resetting A does not affect B
 * T-C6: env-var override — ENABLE_530_RESET_ON_SUCCESS=1 flips at module-load
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('provider-530-tracker — PR-C ENABLE_530_RESET_ON_SUCCESS (default OFF)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ENABLE_530_RESET_ON_SUCCESS;
  });

  it('T-C1 default OFF: maybeReset530OnSuccess is a no-op when flag disabled', async () => {
    const mod = await import('../provider-530-tracker');
    // No env var → flag defaults to false.
    expect(mod.ENABLE_530_RESET_ON_SUCCESS).toBe(false);
    mod.record530Error('openrouter');
    mod.record530Error('openrouter');
    expect(mod.is530Blacklisted('openrouter')).toBe(true);
    mod.maybeReset530OnSuccess('openrouter');
    // Counter must NOT have been cleared — flag default is OFF.
    expect(mod.get530Count('openrouter')).toBe(2);
    expect(mod.is530Blacklisted('openrouter')).toBe(true);
  });

  it('T-C2 flag ON: maybeReset530OnSuccess increments cleared state to zero', async () => {
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-530-tracker?on');
    expect(mod.ENABLE_530_RESET_ON_SUCCESS).toBe(true);
    mod.record530Error('openrouter');
    mod.record530Error('openrouter');
    expect(mod.is530Blacklisted('openrouter')).toBe(true);
    mod.maybeReset530OnSuccess('openrouter');
    expect(mod.get530Count('openrouter')).toBe(0);
    expect(mod.is530Blacklisted('openrouter')).toBe(false);
  });

  it('T-C3 bug-fix regression: provider clears blacklist on first success when flag ON', async () => {
    // Reproduces the operator-visible scenario: provider hit 2 consecutive
    // 530s and got blacklisted. With the legacy default (no flag), it stays
    // blacklisted until the next non-530 error. With PR-C flag ON, a single
    // successful round-trip clears the counter.
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-530-tracker?recover');
    expect(mod.is530Blacklisted('mistral')).toBe(false);
    mod.record530Error('mistral');
    mod.record530Error('mistral');
    expect(mod.is530Blacklisted('mistral')).toBe(true);
    // Simulate a successful round-trip via the helper.
    mod.maybeReset530OnSuccess('mistral');
    expect(mod.is530Blacklisted('mistral')).toBe(false);
  });

  it('T-C4 idempotent: calling maybeReset530OnSuccess twice for a provider at count 0 is safe', async () => {
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-530-tracker?idempotent');
    // Provider has never had a 530 — initial count is 0.
    expect(mod.get530Count('chutes')).toBe(0);
    mod.maybeReset530OnSuccess('chutes');
    expect(mod.get530Count('chutes')).toBe(0);
    mod.maybeReset530OnSuccess('chutes');
    expect(mod.get530Count('chutes')).toBe(0);
    expect(mod.is530Blacklisted('chutes')).toBe(false);
  });

  it('T-C5 provider isolation: resetting A does not affect B', async () => {
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    const mod = await import('../provider-530-tracker?isolation');
    mod.record530Error('openrouter');
    mod.record530Error('openrouter');
    mod.record530Error('chutes');
    expect(mod.is530Blacklisted('openrouter')).toBe(true);
    // Chutes has count 1, less than BLACKLIST_THRESHOLD=2, so not blacklisted.
    expect(mod.is530Blacklisted('chutes')).toBe(false);
    expect(mod.get530Count('chutes')).toBe(1);
    mod.maybeReset530OnSuccess('openrouter');
    expect(mod.get530Count('openrouter')).toBe(0);
    // Chutes count must be unaffected.
    expect(mod.get530Count('chutes')).toBe(1);
    expect(mod.is530Blacklisted('chutes')).toBe(false);
  });

  it('T-C6 env-var override: only the literal string "1" enables the flag at module-load', async () => {
    // Default: env var absent → flag stays false (default-OFF contract).
    const modOff = await import('../provider-530-tracker?env-absent');
    expect(modOff.ENABLE_530_RESET_ON_SUCCESS).toBe(false);

    // Set '1' and reset module cache so the module re-reads process.env.
    process.env.ENABLE_530_RESET_ON_SUCCESS = '1';
    vi.resetModules();
    const modOn = await import('../provider-530-tracker?env-one');
    expect(modOn.ENABLE_530_RESET_ON_SUCCESS).toBe(true);
    // Sanity: with flag ON, maybeReset530OnSuccess exercises the helper
    // path that calls reset530Counter. We just check it runs without
    // throwing; deeper coverage lives in T-C2..T-C5.
    expect(() => modOn.maybeReset530OnSuccess('noop-provider')).not.toThrow();

    // Strict-equality contract: 'true', '0', and any other string are
    // NOT equivalent to '1' and must leave the flag at false.
    for (const value of ['true', '0', 'on', 'yes', 'TRUE', ' 1 ', '2']) {
      process.env.ENABLE_530_RESET_ON_SUCCESS = value;
      vi.resetModules();
      const modVariant = await import(
        `../provider-530-tracker?env-${encodeURIComponent(value)}`
      );
      expect(
        modVariant.ENABLE_530_RESET_ON_SUCCESS,
        `expected ENABLE_530_RESET_ON_SUCCESS=false for env="${value}"`,
      ).toBe(false);
    }

    // Cleanup for any subsequent tests in this file.
    delete process.env.ENABLE_530_RESET_ON_SUCCESS;
  });
});
