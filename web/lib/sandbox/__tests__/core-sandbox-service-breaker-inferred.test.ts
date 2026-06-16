/**
 * Unit tests for the Pass-7 inferred-provider carve-out (Bug #87 follow-up).
 *
 * Locks in the placement decision for the `'sandbox'` circuit-breaker
 * pre-check in `resolveProviderForSandbox`:
 *
 *   - Cache hit: no breaker check (a cached provider is by definition working).
 *   - Inferred provider probe: PRESERVED as a fast path. A user with an
 *     existing sandbox on a non-primary provider (firecracker, modal,
 *     mistral-agent, sprites, codesandbox, etc., inferred from the id
 *     prefix) must still be able to resolve it even when the primary
 *     provider's breaker is open. Without this carve-out, a tripped
 *     breaker would block all sandbox lookups globally, including
 *     lookups against providers that aren't even being tried.
 *   - Primary probe: GUARDED. If the breaker is open, the primary probe
 *     is short-circuited and the function throws.
 *   - Fallback chain: GUARDED (transitively, via the primary throw).
 *
 * Without this test, a future refactor that moves the pre-check back to
 * the top of `resolveProviderForSandbox` would silently regress the
 * inferred-provider fast path (Pass-6 reviewer nit #1 originally caught
 * this).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  recordFailureBreaker,
  sweepStaleBreakerCooldowns,
  getBreakerCooldownUntil,
} from '@/lib/utils/circuit-breaker';

// Mock the providers module so we can inject fake providers for each test.
// The mock factory returns the SAME fake provider shape for every provider
// type — tests override behavior per-call via the `__setBehavior` hook.
const fakeProviderHandle: any = {
  id: 'fake-sandbox-id',
  workspaceDir: '/workspace',
  executeCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  writeFile: vi.fn(async () => ({ success: true })),
  readFile: vi.fn(async () => ({ content: '' })),
  listDirectory: vi.fn(async () => ({ entries: [] })),
  destroySandbox: vi.fn(async () => undefined),
};

const fakeProvider: any = {
  name: 'fake-provider',
  createSandbox: vi.fn(async () => fakeProviderHandle),
  getSandbox: vi.fn(async () => fakeProviderHandle),
  destroySandbox: vi.fn(async () => undefined),
  executeCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  writeFile: vi.fn(async () => ({ success: true })),
  readFile: vi.fn(async () => ({ content: '' })),
  listDirectory: vi.fn(async () => ({ entries: [] })),
};

vi.mock('@/lib/sandbox/providers', () => ({
  getSandboxProvider: vi.fn(async () => fakeProvider),
}));

vi.mock('@bing/platform/env', async () => {
  // Preserve all real exports (isTauriRuntime, etc.) and only override
  // the ones this test cares about. Using vi.importActual() means future
  // exports added to @bing/platform/env won't break this mock.
  const actual = await vi.importActual<Record<string, unknown>>('@bing/platform/env');
  return {
    ...actual,
    isDesktopMode: () => false,
  };
});

import { SandboxService } from '../core-sandbox-service';

const PRIMARY = 'daytona'; // any non-inferred provider; doesn't matter for the carve-out test
const BREAKER_KEY = `sandbox:${PRIMARY}`; // Pass-6 follow-up: per-provider key

describe('SandboxService breaker + inferred-provider carve-out (Pass-7)', () => {
  beforeEach(() => {
    // Use fake timers so the 60_000ms `setTimeout` in
    // `recordFailureBreaker` doesn't actually fire during the test run
    // (and so `Date.now()` is deterministic across tests). Without
    // fake timers, a breaker tripped by a prior test stays tripped for
    // the rest of the file (the cooldown is 60s of real wall-clock
    // time), which breaks the CONTROL test that expects the breaker
    // to be closed.
    vi.useFakeTimers();
    // Advance past any breaker deadline left over from a prior test
    // so each test starts with a clean slate. The `setTimeout` from
    // the prior `recordFailureBreaker` would otherwise keep the
    // entry in the `breakerCooldowns` map.
    vi.advanceTimersByTime(120_000);
    sweepStaleBreakerCooldowns(0);
    fakeProvider.getSandbox.mockClear();
    fakeProvider.getSandbox.mockImplementation(async () => fakeProviderHandle);
  });

  afterEach(() => {
    sweepStaleBreakerCooldowns(0);
    vi.useRealTimers();
  });

  it('CARVE-OUT: breaker open + inferred firecracker- prefix → inferred probe runs (no breaker throw)', async () => {
    // 1. Trip the breaker for 'sandbox'.
    recordFailureBreaker(BREAKER_KEY, 60_000);
    expect(getBreakerCooldownUntil(BREAKER_KEY)).not.toBeNull();

    // 2. Construct a service whose primary is daytona, then resolve a
    //    firecracker-prefixed sandbox. The inferred-provider probe should
    //    fire BEFORE the breaker pre-check, so the breaker does NOT block.
    const service = new SandboxService();
    // Override primary to ensure daytona is the primary, not whatever the
    // constructor picked. (The constructor reads SANDBOX_PROVIDER env.)
    (service as any).primaryProviderType = PRIMARY;

    // 3. Resolve — should succeed (or at least not throw the breaker error).
    //    `getSandbox` returns a `SandboxHandle` (the result of the
    //    provider's `getSandbox` call), not the provider itself.
    let err: unknown = null;
    let handle: unknown = null;
    try {
      handle = await service.getSandbox('firecracker-abc123');
    } catch (e) {
      err = e;
    }

    // The breaker error must NOT be thrown — the inferred-provider fast
    // path runs and returns the fake provider's handle.
    if (err) {
      expect((err as Error).message).not.toMatch(/circuit breaker is open/i);
    }
    expect(handle).toBe(fakeProviderHandle);

    // 4. The inferred provider's getSandbox should have been called once
    //    (proving the carve-out let the probe run, not the breaker block).
    expect(fakeProvider.getSandbox).toHaveBeenCalledWith('firecracker-abc123');
  });

  it('CARVE-OUT: breaker open + inferred modal- prefix → inferred probe runs', async () => {
    recordFailureBreaker(BREAKER_KEY, 60_000);
    const service = new SandboxService();
    (service as any).primaryProviderType = PRIMARY;

    let err: unknown = null;
    try {
      await service.getSandbox('modal-xyz789');
    } catch (e) {
      err = e;
    }

    if (err) {
      expect((err as Error).message).not.toMatch(/circuit breaker is open/i);
    }
    expect(fakeProvider.getSandbox).toHaveBeenCalledWith('modal-xyz789');
  });

  it('CARVE-OUT: breaker open + inferred mistral-agent- prefix → inferred probe runs', async () => {
    recordFailureBreaker(BREAKER_KEY, 60_000);
    const service = new SandboxService();
    (service as any).primaryProviderType = PRIMARY;

    let err: unknown = null;
    try {
      await service.getSandbox('mistral-agent-deadbeef');
    } catch (e) {
      err = e;
    }

    if (err) {
      expect((err as Error).message).not.toMatch(/circuit breaker is open/i);
    }
    expect(fakeProvider.getSandbox).toHaveBeenCalledWith('mistral-agent-deadbeef');
  });

  it('PRIMARY GUARDED: breaker open + non-inferred id → primary probe BLOCKED, breaker error thrown', async () => {
    // 1. Trip the breaker.
    recordFailureBreaker(BREAKER_KEY, 60_000);
    const service = new SandboxService();
    (service as any).primaryProviderType = PRIMARY;

    // 2. A sandbox id that does NOT match any inferred prefix or pattern.
    //    Must have hyphens (to not match the alphanumeric E2B /
    //    CodeSandbox / Blaxel patterns), must not be a UUID (which is
    //    inferred to 'daytona'), and must not start with any known
    //    provider prefix.
    const nonInferredId = 'primary-probe-test-sandbox-12345678';
    let err: Error | null = null;
    try {
      await service.getSandbox(nonInferredId);
    } catch (e) {
      err = e as Error;
    }

    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/circuit breaker is open/i);
    // The fake provider's getSandbox should NOT have been called — the
    // primary probe was short-circuited before any provider call.
    expect(fakeProvider.getSandbox).not.toHaveBeenCalled();
  });

  it('CACHE BYPASSES BREAKER: breaker open + cached provider → cache hit, no throw', async () => {
    // 1. Trip the breaker.
    recordFailureBreaker(BREAKER_KEY, 60_000);

    // 2. Pre-populate the cache for a non-inferred id with a fake provider.
    //    Use the same `primary-probe-test-sandbox-12345678` id as the
    //    PRIMARY GUARDED test for consistency, so a future change to
    //    `inferProviderFromSandboxId` can't accidentally make a UUID
    //    id match a pattern and bypass the test setup.
    //    The provider map stores providers (not handles) and
    //    `getSandbox` calls `provider.getSandbox(id)` on the cached
    //    provider, which returns the handle.
    const service = new SandboxService();
    (service as any).primaryProviderType = PRIMARY;
    const nonInferredId = 'primary-probe-test-sandbox-12345678';
    (service as any).sandboxProviderById.set(nonInferredId, fakeProvider);

    // 3. Resolve — cache hit should return immediately, no breaker check.
    //    Returns the handle from the cached provider's getSandbox call.
    let err: unknown = null;
    let handle: unknown = null;
    try {
      handle = await service.getSandbox(nonInferredId);
    } catch (e) {
      err = e;
    }

    // No throw, returns the handle.
    expect(err).toBeNull();
    expect(handle).toBe(fakeProviderHandle);
    // The fake provider's getSandbox SHOULD have been called (the cache
    // returns the provider, then getHandle calls provider.getSandbox on
    // it). This is one call — the cache bypasses the breaker check, not
    // the provider call itself.
    expect(fakeProvider.getSandbox).toHaveBeenCalledWith(nonInferredId);
  });

  it('CONTROL: breaker closed + non-inferred id → primary probe runs normally, no throw', async () => {
    // Breaker is NOT tripped. Non-inferred id falls through to the
    // primary probe, which succeeds (returns the handle via the mock's
    // getSandbox).
    //
    // ISOLATION NOTE: previous tests in this file trip the breaker
    // with `recordFailureBreaker('sandbox', 60_000)`. The deadline is
    // stored as a real-wall-clock timestamp (~1.78e12), but
    // `vi.useFakeTimers()` resets the fake clock to 0 on each call, so
    // `vi.advanceTimersByTime(120_000)` only advances the fake clock
    // to 120_000ms — far short of the real-timestamp deadline. The
    // `sweepStaleBreakerCooldowns(0)` in `beforeEach` therefore can't
    // evict the entry (deadline > fake-now). The cleanest fix is to
    // spy on `getBreakerCooldownUntil` for this test only and force
    // it to return null, simulating a closed breaker.
    const cbModule = await import('@/lib/utils/circuit-breaker');
    const spy = vi.spyOn(cbModule, 'getBreakerCooldownUntil').mockReturnValue(null);

    const service = new SandboxService();
    (service as any).primaryProviderType = PRIMARY;

    const nonInferredId = 'primary-probe-test-sandbox-12345678';
    let err: unknown = null;
    let handle: unknown = null;
    try {
      handle = await service.getSandbox(nonInferredId);
    } catch (e) {
      err = e;
    }

    spy.mockRestore();
    expect(err).toBeNull();
    expect(handle).toBe(fakeProviderHandle);
    // Primary probe ran.
    expect(fakeProvider.getSandbox).toHaveBeenCalledWith(nonInferredId);
  });
});
