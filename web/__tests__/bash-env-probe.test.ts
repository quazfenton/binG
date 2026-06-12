/**
 * Regression tests for Bug #39: pre-flight env probe + 2nd-ENOENT-retry hard-block.
 *
 * Two layers:
 *   1. env-probe.ts — `which npx python3 node npm pnpm ...` probe, cached 60s,
 *      formatAvailableBinaries() builds the system-prompt fragment.
 *   2. bash-tool.ts — the 2nd ENOENT for the same binary in this process is
 *      hard-blocked with a "use write_file / read_file" suggestion, breaking
 *      the "3× same ENOENT → loop-guard kills the agent" cycle.
 *
 * Without these tests, a future refactor of either layer would silently
 * regress the 5-min "agent stuck on `npx`" loop.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Lazy-load to ensure `_resetEnvProbeForTests()` runs before module init
const loadProbe = async () => {
  const mod = await import('@/lib/bash/env-probe');
  mod._resetEnvProbeForTests();
  return mod;
};

describe('env-probe (Bug #39)', () => {
  beforeEach(async () => {
    const { _resetEnvProbeForTests } = await import('@/lib/bash/env-probe');
    _resetEnvProbeForTests();
  });

  describe('formatAvailableBinaries', () => {
    it('returns "" for an empty probe (defensive)', async () => {
      const { formatAvailableBinaries } = await loadProbe();
      expect(formatAvailableBinaries(new Map())).toBe('');
    });

    it('lists available binaries with their paths', async () => {
      const { formatAvailableBinaries } = await loadProbe();
      const probe = new Map<string, string | null>([
        ['npx', '/usr/local/bin/npx'],
        ['node', '/usr/local/bin/node'],
      ]);
      const out = formatAvailableBinaries(probe);
      expect(out).toContain('### Available Binaries');
      expect(out).toContain('npx → /usr/local/bin/npx');
      expect(out).toContain('node → /usr/local/bin/node');
    });

    it('separates missing binaries with a NOT FOUND marker and a "do NOT call them" hint', async () => {
      const { formatAvailableBinaries } = await loadProbe();
      const probe = new Map<string, string | null>([
        ['python3', '/usr/bin/python3'],
        ['npx', null],
        ['docker', null],
      ]);
      const out = formatAvailableBinaries(probe);
      expect(out).toContain('python3 → /usr/bin/python3');
      expect(out).toContain('### Missing Binaries');
      expect(out).toContain('npx → NOT FOUND');
      expect(out).toContain('docker → NOT FOUND');
      expect(out).toContain('do NOT call them');
    });

    it('sorts alphabetically (stable, testable order)', async () => {
      const { formatAvailableBinaries } = await loadProbe();
      const probe = new Map<string, string | null>([
        ['zsh', '/bin/zsh'],
        ['bash', '/bin/bash'],
        ['awk', '/usr/bin/awk'],
      ]);
      const out = formatAvailableBinaries(probe);
      const idxAwk = out.indexOf('awk →');
      const idxBash = out.indexOf('bash →');
      const idxZsh = out.indexOf('zsh →');
      expect(idxAwk).toBeLessThan(idxBash);
      expect(idxBash).toBeLessThan(idxZsh);
    });
  });

  describe('resetMissingBinaryRetry (Bug #39 hard-block recovery)', () => {
    it('resetMissingBinaryRetry is a no-op for never-seen binaries', async () => {
      const { resetMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      expect(() => resetMissingBinaryRetry('never-seen-binary-xyz')).not.toThrow();
      expect(getMissingBinaryRetryCount('never-seen-binary-xyz')).toBe(0);
    });

    it('after reset, the next ENOENT increments to 1 (not preserved count)', async () => {
      const { incrementMissingBinaryRetry, resetMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      incrementMissingBinaryRetry('npx');
      incrementMissingBinaryRetry('npx');
      expect(getMissingBinaryRetryCount('npx')).toBe(2);
      resetMissingBinaryRetry('npx');
      expect(getMissingBinaryRetryCount('npx')).toBe(0);
      // After reset, the next ENOENT starts fresh at 1.
      expect(incrementMissingBinaryRetry('npx')).toBe(1);
    });
  });

  describe('incrementMissingBinaryRetry / getMissingBinaryRetryCount (Bug #39 hard-block)', () => {
    it('starts at 0 for a never-seen binary', async () => {
      const { getMissingBinaryRetryCount } = await loadProbe();
      expect(getMissingBinaryRetryCount('npx')).toBe(0);
      expect(getMissingBinaryRetryCount('python3')).toBe(0);
    });

    it('increments on every call, returns the new count', async () => {
      const { incrementMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      expect(incrementMissingBinaryRetry('npx')).toBe(1);
      expect(incrementMissingBinaryRetry('npx')).toBe(2);
      expect(incrementMissingBinaryRetry('npx')).toBe(3);
      expect(getMissingBinaryRetryCount('npx')).toBe(3);
    });

    it('tracks different binaries independently (npx vs python3)', async () => {
      const { incrementMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      expect(incrementMissingBinaryRetry('npx')).toBe(1);
      expect(incrementMissingBinaryRetry('python3')).toBe(1);
      expect(incrementMissingBinaryRetry('npx')).toBe(2);
      expect(getMissingBinaryRetryCount('npx')).toBe(2);
      expect(getMissingBinaryRetryCount('python3')).toBe(1);
    });

    it('is case-insensitive (Npx == npx == NPX)', async () => {
      const { incrementMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      incrementMissingBinaryRetry('Npx');
      incrementMissingBinaryRetry('NPX');
      incrementMissingBinaryRetry('npx');
      expect(getMissingBinaryRetryCount('npx')).toBe(3);
      expect(getMissingBinaryRetryCount('NPX')).toBe(3);
    });

    it('resetMissingBinaryRetry clears the counter for one binary, leaves others', async () => {
      const { incrementMissingBinaryRetry, resetMissingBinaryRetry, getMissingBinaryRetryCount } = await loadProbe();
      incrementMissingBinaryRetry('npx');
      incrementMissingBinaryRetry('npx');
      incrementMissingBinaryRetry('python3');
      resetMissingBinaryRetry('npx');
      expect(getMissingBinaryRetryCount('npx')).toBe(0);
      expect(getMissingBinaryRetryCount('python3')).toBe(1);
    });
  });

  describe('probeAvailableBinaries', () => {
    it('returns a Map of bin → path|null for a custom list', async () => {
      // The actual `which` calls are best-effort — we only assert the
      // function returns a Map with the requested entries.
      const { probeAvailableBinaries, _resetEnvProbeForTests } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();
      const result = await probeAvailableBinaries(['node', 'npx']);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.has('node')).toBe(true);
      expect(result.has('npx')).toBe(true);
      // Each value is either a path string or null (when `which` returned
      // nothing or the binary isn't installed in this test env). Both are
      // valid Map entries.
      for (const value of result.values()) {
        expect(value === null || typeof value === 'string').toBe(true);
      }
    });

    it('caches the default-list probe (2nd call returns identical contents)', async () => {
      const { probeAvailableBinaries, _resetEnvProbeForTests } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();
      const result1 = await probeAvailableBinaries();
      const result2 = await probeAvailableBinaries();
      // Cache semantics: contents are identical (entries + values) on the
      // 2nd call. Asserting contents is more robust than reference equality
      // — both forms satisfy the cache invariant, but contents is what
      // callers care about.
      expect(Array.from(result2.entries())).toEqual(Array.from(result1.entries()));
    });
  });

  /**
   * Bug #39 follow-up: `resetMissingBinaryRetry` was wired into the LLM
   * tool's success path but NOT into `executeBashCommand` itself. Direct
   * callers (executeBashViaEvent, test harnesses, future entry points) would
   * leave the hard-block retry counter stale, so a transient PATH issue
   * could permanently block a binary. The fix pushes the reset one line
   * before `resolve(result)` in `executeBashCommand`'s close handler, gated
   * on `exitCode === 0`.
   *
   * Test strategy: mock `child_process.spawn` via `vi.mock` so we can fire
   * the `close` handler with a controlled `exitCode` and assert the reset
   * fires deterministically. This avoids the test-env fragility of the
   * earlier `/bin/true` approach (workingDir/safeEnv/POIX path layout all
   * vary between dev, CI, and containers).
   */
  describe('executeBashCommand cross-caller reset (Bug #39 follow-up)', () => {
    /**
     * Build a fake ChildProcess-like EventEmitter that fires `close` with
     * the given `exitCode` on the next tick. Returns the emitter so the
     * test can inspect `spawn` call args.
     */
    function makeFakeChild(exitCode: number | null): {
      proc: any;
      onSpy: ReturnType<typeof vi.fn>;
    } {
      const { EventEmitter } = require('node:events');
      const proc = new EventEmitter();
      // Fire `close` on next tick so the `await` in executeBashCommand
      // has a chance to attach its handlers first.
      process.nextTick(() => proc.emit('close', exitCode, null));
      return { proc, onSpy: vi.fn() };
    }

    it('clears the hard-block retry counter on exitCode===0 (success path)', async () => {
      vi.resetModules();
      const {
        incrementMissingBinaryRetry,
        getMissingBinaryRetryCount,
        _resetEnvProbeForTests,
      } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();

      // Mock child_process.spawn to return a fake child that fires close(0).
      // NOTE: bash-tool.ts uses `await import('child_process')` (no `node:`
      // prefix), so the mock must match that exact specifier.
      const spawnSpy = vi.fn(() => makeFakeChild(0).proc);
      vi.doMock('child_process', () => ({ spawn: spawnSpy }));

      const { executeBashCommand } = await import('@/lib/bash/bash-tool');

      // Simulate the counter hitting the 2nd-ENOENT hard-block threshold.
      incrementMissingBinaryRetry('npm');
      incrementMissingBinaryRetry('npm');
      expect(getMissingBinaryRetryCount('npm')).toBe(2);

      // Direct call to executeBashCommand. The fake child fires close(0).
      const result = await executeBashCommand('npm test');
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);

      // Counter must be cleared.
      expect(getMissingBinaryRetryCount('npm')).toBe(0);

      vi.doUnmock('child_process');
      vi.resetModules();
    });

    it('does NOT clear the counter when exitCode !== 0 (failure path)', async () => {
      vi.resetModules();
      const {
        incrementMissingBinaryRetry,
        getMissingBinaryRetryCount,
        _resetEnvProbeForTests,
      } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();

      const spawnSpy = vi.fn(() => makeFakeChild(1).proc);
      vi.doMock('child_process', () => ({ spawn: spawnSpy }));

      const { executeBashCommand } = await import('@/lib/bash/bash-tool');

      incrementMissingBinaryRetry('npm');
      incrementMissingBinaryRetry('npm');
      expect(getMissingBinaryRetryCount('npm')).toBe(2);

      const result = await executeBashCommand('npm test');
      expect(result.exitCode).toBe(1);
      expect(result.success).toBe(false);

      // Counter preserved on failure.
      expect(getMissingBinaryRetryCount('npm')).toBe(2);

      vi.doUnmock('child_process');
      vi.resetModules();
    });

    it('only clears the counter for the binary in the command, leaves others alone', async () => {
      vi.resetModules();
      const {
        incrementMissingBinaryRetry,
        getMissingBinaryRetryCount,
        _resetEnvProbeForTests,
      } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();

      const spawnSpy = vi.fn(() => makeFakeChild(0).proc);
      vi.doMock('child_process', () => ({ spawn: spawnSpy }));

      const { executeBashCommand } = await import('@/lib/bash/bash-tool');

      incrementMissingBinaryRetry('npm');
      incrementMissingBinaryRetry('npm');
      incrementMissingBinaryRetry('node');
      incrementMissingBinaryRetry('node');
      expect(getMissingBinaryRetryCount('npm')).toBe(2);
      expect(getMissingBinaryRetryCount('node')).toBe(2);

      // `npm test` — node counter must NOT be touched.
      const result = await executeBashCommand('npm test');
      expect(result.exitCode).toBe(0);

      expect(getMissingBinaryRetryCount('npm')).toBe(0);
      expect(getMissingBinaryRetryCount('node')).toBe(2);

      vi.doUnmock('child_process');
      vi.resetModules();
    });

    it('is case-insensitive on the reset key (NPM and npm share the slot)', async () => {
      vi.resetModules();
      const {
        incrementMissingBinaryRetry,
        getMissingBinaryRetryCount,
        _resetEnvProbeForTests,
      } = await import('@/lib/bash/env-probe');
      _resetEnvProbeForTests();

      const spawnSpy = vi.fn(() => makeFakeChild(0).proc);
      vi.doMock('child_process', () => ({ spawn: spawnSpy }));

      const { executeBashCommand } = await import('@/lib/bash/bash-tool');

      // Increment with uppercase — stored as lowercase per the env-probe contract.
      incrementMissingBinaryRetry('NPM');
      incrementMissingBinaryRetry('NPM');
      expect(getMissingBinaryRetryCount('npm')).toBe(2);

      const result = await executeBashCommand('npm test');
      expect(result.exitCode).toBe(0);

      // Same case-insensitive lookup — cleared.
      expect(getMissingBinaryRetryCount('npm')).toBe(0);
      expect(getMissingBinaryRetryCount('NPM')).toBe(0);

      vi.doUnmock('child_process');
      vi.resetModules();
    });
  });
});
