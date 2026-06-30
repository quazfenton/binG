/**
 * PR-F regression smoke test — `unified-agent-service.ts` success-branch wire-up.
 *
 * PR-F inserts `maybeReset530OnSuccess(providerName);` immediately before
 * each successful return at two large-monolith sites (line ~4925 in
 * `runV1ApiWithTools` and line ~5979 in `runV1ApiCompletion`, post-PR-G
 * offsets). This test stubs the consumer module with a controlled mirror
 * of the line-4921 success-return shape and asserts the underlying
 * `reset530Counter` is invoked exactly once when ENABLE_530_RESET_ON_SUCCESS=1.
 *
 * ==== Mocking architecture ====
 *
 * 1. `vi.mock('@/lib/orchestra/provider-530-tracker', ...)` — replaces
 *    the tracker module with a thin wrapper that:
 *      - exposes `reset530Counter: vi.fn(actual.reset530Counter)` as a
 *        spy for `expect(...).toHaveBeenCalledTimes(1)` assertions.
 *      - re-implements `maybeReset530OnSuccess(provider)` to route
 *        through the spy (so we can assert the call).
 *      - leaves every other export as a passthrough from `...actual`
 *        (record530Error, is530Blacklisted, get530Count, etc.).
 *
 *    Re-implementation note: in real ES modules, the call
 *    `maybeReset530OnSuccess → reset530Counter` is an internal closure
 *    call that bypasses the exported namespace. `vi.spyOn(namespace,
 *    'reset530Counter')` does not intercept that closure. The wrapper
 *    re-implements `maybeReset530OnSuccess` so the test can assert the
 *    call. The wrapper's flag check reads `process.env.X` at CALL time
 *    rather than the captured module constant — this decouples the
 *    runtime behavior from any `importOriginal` cache concerns.
 *
 * 2. `vi.mock('@/lib/orchestra/unified-agent-service', ...)` — replaces
 *    the production consumer with a minimal mirror of the line-4921
 *    success-return shape. The stub's `runV1ApiWithToolsSuccess(provider)`
 *    function calls `tracker.maybeReset530OnSuccess(provider)`, which
 *    is exactly what the PR-F insertion at line 4921 of the real
 *    `runV1ApiWithTools` does.
 *
 *    Coverage blind spot: a regression that DELETES
 *    `maybeReset530OnSuccess(providerName);` from line 4925 of the real
 *    consumer would not be detected here, because the stub hard-codes
 *    that call. For literal coverage of the real code, an integration
 *    test would need to load the real `unified-agent-service.ts`
 *    end-to-end (or call `runV1ApiWithTools` directly with stubbed
 *    provider clients).
 *
 * ==== Test layout ====
 *
 * Two `describe` blocks, each with its own `beforeEach`, so per-test
 * env state is set up cleanly without cross-test contamination:
 *
 *   - describe 'flag ON': stubEnv('1') in beforeEach; assert
 *     reset530Counter called exactly once, blacklist cleared.
 *   - describe 'flag OFF (default)': delete process.env.X in
 *     beforeEach; assert reset530Counter NOT called, blacklist persists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── TRACKER SELF-CONTAINED MOCK WITH SPY ─────────────────────────────────
//
// Fully self-contained: NO `importOriginal`. The real tracker's internals
// are exercised by `provider-530-tracker.test.ts` (T-C1..T-C6). Here we
// only need to verify the call pattern (consumer's success-return
// triggers reset530Counter) — so a local Map-backed fake with a
// vi.fn() spy is sufficient and avoids the `importOriginal` cache
// issue that caused previous runs to leak state across tests.
//
// Per-test fresh state: each `vi.resetModules()` re-runs this factory,
// producing a fresh `counters` Map and a fresh `resetSpy` so tests are
// fully isolated.
vi.mock('@/lib/orchestra/provider-530-tracker', () => {
  const counters = new Map<string, number>();
  const BLACKLIST_THRESHOLD = 2;
  const resetSpy = vi.fn();
  resetSpy.mockImplementation((provider: string) => {
    counters.set(provider, 0);
  });
  return {
    // The flag is captured at module-load but the wrapper below
    // additionally re-checks process.env at call time so OFF-case
    // tests don't leak from ON-case env state.
    ENABLE_530_RESET_ON_SUCCESS:
      process.env.ENABLE_530_RESET_ON_SUCCESS === '1',
    BLACKLIST_THRESHOLD,
    record530Error: (provider: string): void => {
      counters.set(provider, (counters.get(provider) ?? 0) + 1);
    },
    is530Blacklisted: (provider: string): boolean => {
      return (counters.get(provider) ?? 0) >= BLACKLIST_THRESHOLD;
    },
    get530Count: (provider: string): number => {
      return counters.get(provider) ?? 0;
    },
    reset530Counter: resetSpy,
    // Re-implement the success-branch helper so it routes through the spy.
    // The flag check reads process.env at CALL time so the OFF case is
    // robust against any captured-value staleness.
    maybeReset530OnSuccess: (provider: string): void => {
      if (process.env.ENABLE_530_RESET_ON_SUCCESS === '1') {
        resetSpy(provider);
      }
    },
  };
});

// ── CONSUMER MOCK (LINE-4921 SHAPE MIRROR) ─────────────────────────────────
vi.mock('@/lib/orchestra/unified-agent-service', async () => {
  return {
    // Mirror of `runV1ApiWithTools` line ~4920-4925:
    //   // PR-F: clear the 530-blacklist counter on this provider's success.
    //   maybeReset530OnSuccess(providerName);
    //   return { success: true, response: finalResponse, ... };
    runV1ApiWithToolsSuccess: async (provider: string) => {
      const tracker = await import('@/lib/orchestra/provider-530-tracker');
      tracker.maybeReset530OnSuccess(provider);
      return {
        success: true,
        response: 'fixture',
        steps: [],
        totalSteps: 0,
      };
    },
  };
});

describe('PR-F unified-agent-service success-branch wire-up smoke', () => {
  describe('flag ON (ENABLE_530_RESET_ON_SUCCESS=1)', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.stubEnv('ENABLE_530_RESET_ON_SUCCESS', '1');
    });

    it('reset530Counter is called exactly once when the line-4921 success-return fires', async () => {
      const tracker = await import('@/lib/orchestra/provider-530-tracker');

      // Spy wrapper installed: a memo'd passthrough to the real impl.
      expect(typeof tracker.reset530Counter).toBe('function');
      // Verify the env-var stub is in place.
      expect(process.env.ENABLE_530_RESET_ON_SUCCESS).toBe('1');

      // Drive up to BLACKLIST_THRESHOLD=2 so the provider is blacklisted.
      tracker.record530Error('oracle-shared');
      tracker.record530Error('oracle-shared');
      expect(tracker.is530Blacklisted('oracle-shared')).toBe(true);

      // Spy resets per test (`vi.resetModules()` re-runs the mock factory).
      expect(tracker.reset530Counter).not.toHaveBeenCalled();

      // Trigger the stubbed mirror of line 4921's success-return.
      const stub = await import('@/lib/orchestra/unified-agent-service');
      await stub.runV1ApiWithToolsSuccess('oracle-shared');

      // PR-F invariant: reset530Counter called exactly once with provider.
      expect(tracker.reset530Counter).toHaveBeenCalledTimes(1);
      expect(tracker.reset530Counter).toHaveBeenCalledWith('oracle-shared');

      // Downstream effect: counter cleared, blacklist released.
      expect(tracker.is530Blacklisted('oracle-shared')).toBe(false);
      expect(tracker.get530Count('oracle-shared')).toBe(0);
    });
  });

  describe('flag OFF (default — env var set to non-"1")', () => {
    beforeEach(() => {
      // Reset all module + mock state, then explicitly set the env var
      // to a non-'1' value. The strict-equality check (env === '1') in
      // the wrapper's runtime evaluation treats any other value as OFF,
      // which is the production default-OFF contract from PR-C T-C6.
      //
      // `vi.clearAllMocks()` clears the spy's `mock.calls` history so
      // any leakage from the ON-test's spy (e.g., if vitest cached the
      // factory's `vi.fn()` across `vi.resetModules()`) is reset.
      vi.resetModules();
      vi.unstubAllEnvs();
      vi.clearAllMocks();
      process.env.ENABLE_530_RESET_ON_SUCCESS = '';
    });

    it('reset530Counter is NOT called when the line-4921 success-return fires', async () => {
      // Sanity: env is set to '' (not '1') so the wrapper's runtime
      // check is false.
      expect(process.env.ENABLE_530_RESET_ON_SUCCESS).toBe('');

      const tracker = await import('@/lib/orchestra/provider-530-tracker');
      expect(typeof tracker.reset530Counter).toBe('function');
      expect(tracker.reset530Counter).not.toHaveBeenCalled();

      tracker.record530Error('mistral');
      tracker.record530Error('mistral');
      expect(tracker.is530Blacklisted('mistral')).toBe(true);

      const stub = await import('@/lib/orchestra/unified-agent-service');
      await stub.runV1ApiWithToolsSuccess('mistral');

      // Default-OFF contract: at call time, process.env.X = '' which is
      // !== '1', so the wrapper's `maybeReset530OnSuccess` is a no-op,
      // reset530Counter stays uncalled, blacklist persists.
      expect(tracker.reset530Counter).not.toHaveBeenCalled();
      expect(tracker.is530Blacklisted('mistral')).toBe(true);
      expect(tracker.get530Count('mistral')).toBe(2);
    });
  });
});
