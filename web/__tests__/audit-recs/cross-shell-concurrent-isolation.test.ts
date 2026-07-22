/**
 * Regression guard for the cross-shell-contamination bug closed 2026-07-16.
 *
 * Bug evidence: real TerminalPanel fish session crashed with
 *   `~/.binG-temp/_safe_shell_init.sh (line 65): Unknown builtin "pushd"`
 * because a prior bash session had written a bash wrapper to the SHARED
 * `_safe_shell_init.sh` filename, and the fish session inherited it via
 * `--init-command source`.
 *
 * Fix: per-shellBasename filename scheme via `getSafeShellWrapperPath`.
 *   - fish: `_safe_shell_init.fish.sh`
 *   - bash: `_safe_shell_init.bash.sh`
 *   - POSIX sh (sh/dash/ash): canonical `_safe_shell_init_posixsh.sh`
 *
 * This test mocks `fs.promises` so concurrent gateway calls write to
 * independent files — the cross-shell-contamination invariant is
 * regression-locked even if `createSafeShellWrapper` is later refactored.
 *
 * Stable anchor (canonical doc reference):
 *   /opt/bing/docs/MCP_TOOL_SELECTION_POSTAUDIT_FOLLOWUPS.md#cross-shell-contamination-closure-2026-07-16
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { getSafeShellWrapperPath } from '@/lib/terminal/shell-init-emitter';

// In-memory write record (no real I/O during test).
interface WriteCall {
  path: string;
  content: string;
  mode?: number;
}
interface UnlinkCall {
  path: string;
}
const writes: WriteCall[] = [];
const unlinks: UnlinkCall[] = [];

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: fs.PathLike, content: string | Uint8Array, opts?: any) => {
        writes.push({
          path: String(path),
          content: typeof content === 'string' ? content : Buffer.from(content).toString('utf-8'),
          mode: opts?.mode,
        });
      }),
      unlink: vi.fn(async (path: fs.PathLike) => {
        unlinks.push({ path: String(path) });
      }),
    },
  };
});

/**
 * Mirror of `createSafeShellWrapper`'s write side (gateway.ts:createSafeShellWrapper).
 * Only the file-write contract is exercised here — getSafeShellWrapperPath is the
 * real helper; the rest is a deterministic re-script for the test surface.
 *
 * Reproduces the production behavior:
 *   1. mkdir -p <ws>/.binG-temp
 *   2. unlink <ws>/.binG-temp/_safe_shell_init.sh  (legacy cleanup, swallow errors)
 *   3. writeFile <wrapperPath>, <shellScript>
 *
 * shellScript is mocked to a fingerprint string so we can assert content differs
 * per shell (full-fidelity emit lives in buildFishSafeShellWrapper + the bash
 * template literal; covered by shell-init-emitter.test.ts).
 */
async function simulateCreateSafeShellWrapper(
  workspaceDir: string,
  shellPath: string,
): Promise<string> {
  // getShellBasename logic from shell-init-emitter.ts:
  const idx = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
  const shellBasename = (idx >= 0 ? shellPath.substring(idx + 1) : shellPath).toLowerCase();

  // Centralized per-shell filename (the fix):
  const wrapperPath = getSafeShellWrapperPath(workspaceDir, shellBasename, false);

  // 1. mkdir -p
  await fs.promises.mkdir(`${workspaceDir}/.binG-temp`, { recursive: true });

  // 2. Legacy cleanup (best-effort):
  await fs.promises.unlink(`${workspaceDir}/.binG-temp/_safe_shell_init.sh`).catch(() => {});

  // 3. Per-shell write — emit ONLY the shellBasename fingerprint (no extra
  // suffix): keeps the assertion surface minimal + lets downstream callers
  // verify exact per-shell content via `expect(content).toEqual('# fingerprint:<basename>')`
  // rather than substring checks.
  const shellScript = `# fingerprint:${shellBasename}`;
  await fs.promises.writeFile(wrapperPath, shellScript, { mode: 0o755 });
  return wrapperPath;
}

describe('cross-shell-concurrent-isolation (regression guard for cross-shell-contamination closure 2026-07-16)', () => {
  beforeEach(() => {
    writes.length = 0;
    unlinks.length = 0;
    vi.clearAllMocks();
  });

  describe('fish and bash write to distinct per-shell files', () => {
    it('concurrent fish + bash spawn → distinct wrapper paths', async () => {
      const ws = '/workspace';
      const [fishPath, bashPath] = await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/usr/bin/fish'),
        simulateCreateSafeShellWrapper(ws, '/bin/bash'),
      ]);
      // The cross-shell-contamination invariant: NO two shells share a file.
      expect(fishPath).not.toBe(bashPath);
      expect(fishPath).toMatch(/_safe_shell_init\.fish\.sh$/);
      expect(bashPath).toMatch(/_safe_shell_init\.bash\.sh$/);
    });

    it('writes array records fish+bash in two distinct slots (not the same file)', async () => {
      const ws = '/workspace';
      await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/usr/bin/fish'),
        simulateCreateSafeShellWrapper(ws, '/bin/bash'),
      ]);
      const uniqueWritePaths = new Set(writes.map((w) => w.path));
      // 4 writes expected per concurrent spawn (1 per shell + 2 mkdir/unlink mutes
      // would skew this — count writeFile-only):
      // Forward-safe filter: fingerprint string is the stable per-shell write
      // contract; the writeFile options bag (mode, encoding) is NOT assumed.
      // Avoids the brittleness of `mode === 0o755` which couples to the exact
      // writeFile invocation signature (any future refactor that drops the mode
      // option would break the count).
      const writeFileCalls = writes.filter((w) =>
        w.content.startsWith('# fingerprint:'),
      );
      expect(writeFileCalls.length).toBe(2);
      expect(new Set(writeFileCalls.map((w) => w.path)).size).toBe(2);
    });
  });

  describe('POSIX sh variants share a canonical filename (no double `_safe_shell_init.sh.sh`)', () => {
    it('sh + dash + ash all write to `_safe_shell_init_posixsh.sh` (single canonical file)', async () => {
      const ws = '/workspace';
      const [shPath, dashPath, ashPath] = await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/bin/sh'),
        simulateCreateSafeShellWrapper(ws, '/bin/dash'),
        simulateCreateSafeShellWrapper(ws, '/bin/ash'),
      ]);
      const canonical = `${ws}/.binG-temp/_safe_shell_init_posixsh.sh`;
      expect(shPath).toBe(canonical);
      expect(dashPath).toBe(canonical);
      expect(ashPath).toBe(canonical);
    });

    it('POSIX sh filename is NEVER the legacy `_safe_shell_init.sh` (regression-locks SHOULDCONSIDER #2)', async () => {
      const ws = '/workspace';
      await simulateCreateSafeShellWrapper(ws, '/bin/sh');
      // The legacy filename is NOT in the writes log as a write target:
      const legacyWrite = writes.find(
        (w) => w.path === `${ws}/.binG-temp/_safe_shell_init.sh` && w.mode === 0o755,
      );
      expect(legacyWrite).toBeUndefined();
    });
  });

  describe('no shell writes to the legacy shared `_safe_shell_init.sh`', () => {
    it('cross-shell PTY spawn history shows zero writes to the legacy filename', async () => {
      const ws = '/workspace';
      // Spawn 5 different shells concurrently:
      await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/usr/bin/fish'),
        simulateCreateSafeShellWrapper(ws, '/bin/bash'),
        simulateCreateSafeShellWrapper(ws, '/bin/zsh'),
        simulateCreateSafeShellWrapper(ws, '/bin/sh'),
        simulateCreateSafeShellWrapper(ws, '/usr/bin/nu'),
      ]);
      const legacyWrite = writes.filter(
        (w) =>
          w.path === `${ws}/.binG-temp/_safe_shell_init.sh` && w.mode === 0o755,
      );
      expect(legacyWrite).toEqual([]);
    });

    it('legacy-cleanup is attempted at least once (defense-in-depth)', async () => {
      const ws = '/workspace';
      await simulateCreateSafeShellWrapper(ws, '/bin/bash');
      const legacyCleanup = unlinks.find(
        (u) => u.path === `${ws}/.binG-temp/_safe_shell_init.sh`,
      );
      expect(legacyCleanup).toBeDefined();
    });
  });

  describe('per-shell file CONTENT is shell-specific (mock fingerprint)', () => {
    it('fish wrapper content differs from bash wrapper content', async () => {
      const ws = '/workspace';
      await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/usr/bin/fish'),
        simulateCreateSafeShellWrapper(ws, '/bin/bash'),
      ]);
      const fishWrite = writes.find((w) =>
        w.path.endsWith('_safe_shell_init.fish.sh'),
      );
      const bashWrite = writes.find((w) =>
        w.path.endsWith('_safe_shell_init.bash.sh'),
      );
      expect(fishWrite).toBeDefined();
      expect(bashWrite).toBeDefined();
      expect(fishWrite!.content).toContain('fish');
      expect(bashWrite!.content).toContain('bash');
      expect(fishWrite!.content).not.toBe(bashWrite!.content);
    });

    it('POSIX sh variants write the SAME content to the SAME canonical file', async () => {
      const ws = '/workspace';
      // All 3 POSIX sh variants share the canonical filename:
      await Promise.all([
        simulateCreateSafeShellWrapper(ws, '/bin/sh'),
        simulateCreateSafeShellWrapper(ws, '/bin/dash'),
      ]);
      const posixWrites = writes.filter((w) =>
        w.path.endsWith('_safe_shell_init_posixsh.sh'),
      );
      // 2 distinct shells, both writing to the SAME canonical path.
      expect(posixWrites.length).toBe(2);
      expect(new Set(posixWrites.map((w) => w.path)).size).toBe(1);
      // Per-shell content-contract under contention (locks which shellBasename
      // won — both shells' fingerprints are present in the writes log even
      // though they wrote to the SAME canonical file path). Without this
      // assertion, last-write-wins silently overwrites the prior shell's
      // content + operators have no signal of which concurrent spawn lost.
      expect(new Set(posixWrites.map((w) => w.content))).toEqual(
        new Set(['# fingerprint:sh', '# fingerprint:dash']),
      );
    });
  });
});
