/**
 * Regression tests for /opt/bing/web/lib/terminal/shell-init-emitter.ts.
 *
 * Locks the shell-agnostic syntax contracts that close the TerminalPanel
 * XTerm-session bug ("Unsupported use of '='" reported by fish when sourcing
 * the bash-formatted `_safe_shell_init.sh`).
 *
 * Bug context: prior to this fix, gateway.ts emitted a single bash-formatted
 * wrapper regardless of target shell. When the user selected fish as their
 * terminal shell, fish tried to source that bash script via
 * `--init-command source` and failed at line 2. The helpers below provide
 * shell-correct env-var exports, source commands, and cd-override wrapper
 * templates so the gateway can emit fish-native syntax when needed.
 *
 * Bug #2 (L1650-L1661 runtime env-emit producing bash-style exports inside
 * `.workspace_env` even when shell is fish) is documented separately in
 * `/opt/bing/.tickets/FISH-ENV-EMIT-FOLLOWUP.md` and is out of scope here.
 *
 * Nushell extension (2026-07-16): added `isNuShell`, nu branch in
 * `getEnvExportSyntax`, nu test for `getSourceSyntax` (nu shares the
 * `source` keyword with bash/zsh/fish), and `buildNuSafeShellWrapper`.
 *
 * CRITICAL recursion safety: `buildNuSafeShellWrapper` emits
 * `alias builtin_cd = cd` BEFORE `def --env cd [...]` because nushell has
 * no `builtin` keyword — without the alias, the override body's call to
 * (in the new emit) `builtin_cd` / inside the def body would resolve to
 * the new def, causing infinite recursion. Verified via
 * thinker-with-files-gemini 2026-07-16.
 *
 * Gateway invocation for nu is deferred to /opt/bing/.tickets/TO-NU-INTERACTIVE-INJECT.md
 * because nu has no `--init-command` equivalent AND `def --env` overrides
 * do not survive recursive `nu -c "source X; nu"` self-calls.
 */

import { describe, it, expect } from 'vitest';
import {
  getShellBasename,
  isFishShell,
  isPosixShShell,
  isNuShell,
  getEnvExportSyntax,
  getSourceSyntax,
  buildFishSafeShellWrapper,
  buildNuSafeShellWrapper,
  buildWorkspaceRootExport,
} from '@/lib/terminal/shell-init-emitter';

describe('shell-init-emitter', () => {
  describe('getShellBasename', () => {
    it('extracts basename from /bin/bash', () => {
      expect(getShellBasename('/bin/bash')).toBe('bash');
    });
    it('extracts basename from /usr/bin/zsh', () => {
      expect(getShellBasename('/usr/bin/zsh')).toBe('zsh');
    });
    it('extracts basename from /bin/fish', () => {
      expect(getShellBasename('/bin/fish')).toBe('fish');
    });
    it('extracts basename from /bin/sh', () => {
      expect(getShellBasename('/bin/sh')).toBe('sh');
    });
    it('extracts basename from /usr/bin/nu (nushell)', () => {
      expect(getShellBasename('/usr/bin/nu')).toBe('nu');
    });
    it('returns the input if no path separator present', () => {
      expect(getShellBasename('bash')).toBe('bash');
    });
    it('is case-insensitive', () => {
      expect(getShellBasename('/bin/FISH')).toBe('fish');
      expect(getShellBasename('/BIN/BASH')).toBe('bash');
      expect(getShellBasename('/usr/bin/NU')).toBe('nu');
    });
  });

  describe('isFishShell', () => {
    it('returns true for fish', () => {
      expect(isFishShell('fish')).toBe(true);
    });
    it('returns false for bash/zsh/sh/nu', () => {
      expect(isFishShell('bash')).toBe(false);
      expect(isFishShell('zsh')).toBe(false);
      expect(isFishShell('sh')).toBe(false);
      expect(isFishShell('nu')).toBe(false);
    });
  });

  describe('isPosixShShell', () => {
    it('returns true for sh/dash/ash', () => {
      expect(isPosixShShell('sh')).toBe(true);
      expect(isPosixShShell('dash')).toBe(true);
      expect(isPosixShShell('ash')).toBe(true);
    });
    it('returns false for bash/zsh/fish/nu', () => {
      expect(isPosixShShell('bash')).toBe(false);
      expect(isPosixShShell('zsh')).toBe(false);
      expect(isPosixShShell('fish')).toBe(false);
      expect(isPosixShShell('nu')).toBe(false);
    });
  });

  describe('isNuShell', () => {
    it('returns true for nu', () => {
      expect(isNuShell('nu')).toBe(true);
    });
    it('returns true for nushell alias used by some Linux package managers', () => {
      expect(isNuShell('nushell')).toBe(true);
    });
    it('returns false for bash/zsh/fish/sh/dash/ash', () => {
      expect(isNuShell('bash')).toBe(false);
      expect(isNuShell('zsh')).toBe(false);
      expect(isNuShell('fish')).toBe(false);
      expect(isNuShell('sh')).toBe(false);
      expect(isNuShell('dash')).toBe(false);
      expect(isNuShell('ash')).toBe(false);
    });
    it('is case-insensitive at the contract level (inputs are pre-lowercased via getShellBasename)', () => {
      // Caller is responsible for lowercasing; the predicate trusts its input.
      expect(isNuShell('NU')).toBe(false);
      expect(isNuShell('NuShell')).toBe(false);
    });
  });

  describe('getEnvExportSyntax', () => {
    it('emits fish `set -gx VAR "val"` for fish shell', () => {
      expect(getEnvExportSyntax('fish', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('set -gx WORKSPACE_ROOT "/tmp/ws"');
    });
    it('emits bash `export VAR="val"` for bash shell', () => {
      expect(getEnvExportSyntax('bash', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('export WORKSPACE_ROOT="/tmp/ws"');
    });
    it('emits zsh-compatible export syntax for zsh shell', () => {
      expect(getEnvExportSyntax('zsh', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('export WORKSPACE_ROOT="/tmp/ws"');
    });
    it('emits POSIX sh `VAR=""; export VAR` for sh shell', () => {
      expect(getEnvExportSyntax('sh', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('WORKSPACE_ROOT="/tmp/ws"; export WORKSPACE_ROOT');
    });
    it('emits nushell `$env.VAR = "val"` for nu shell', () => {
      expect(getEnvExportSyntax('nu', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('$env.WORKSPACE_ROOT = "/tmp/ws"');
    });
    it('emits nushell `$env.VAR = "val"` for nushell alias', () => {
      expect(getEnvExportSyntax('nushell', 'WORKSPACE_ROOT', '/tmp/ws'))
        .toBe('$env.WORKSPACE_ROOT = "/tmp/ws"');
    });
    it('nushell export works with non-WORKSPACE_ROOT var names', () => {
      expect(getEnvExportSyntax('nu', 'CUSTOM_VAR', '/some/path'))
        .toBe('$env.CUSTOM_VAR = "/some/path"');
    });
    it('preserves complex paths in fish with escaped quotes', () => {
      expect(getEnvExportSyntax('fish', 'X', '/p"a"th'))
        .toBe('set -gx X "/p\\"a\\"th"');
    });
    it('preserves complex paths in bash with escaped quotes', () => {
      expect(getEnvExportSyntax('bash', 'X', '/p"a"th'))
        .toBe('export X="/p\\"a\\"th"');
    });
    it('preserves complex paths in nu with escaped quotes', () => {
      expect(getEnvExportSyntax('nu', 'X', '/p"a"th'))
        .toBe('$env.X = "/p\\"a\\"th"');
    });
  });

  describe('getSourceSyntax', () => {
    it('emits `source "fp"` for fish/bash/zsh (all share keyword)', () => {
      expect(getSourceSyntax('fish', '/etc/profile.d/my.sh')).toBe('source "/etc/profile.d/my.sh"');
      expect(getSourceSyntax('bash', '/etc/profile.d/my.sh')).toBe('source "/etc/profile.d/my.sh"');
      expect(getSourceSyntax('zsh', '/etc/profile.d/my.sh')).toBe('source "/etc/profile.d/my.sh"');
    });
    it('emits POSIX `. "fp"` for sh (NOT all sh variants support source)', () => {
      expect(getSourceSyntax('sh', '/etc/profile.d/my.sh')).toBe('. "/etc/profile.d/my.sh"');
      expect(getSourceSyntax('dash', '/etc/profile.d/my.sh')).toBe('. "/etc/profile.d/my.sh"');
    });
    it('emits `source "fp"` for nushell (nu shares the source keyword with bash/zsh/fish)', () => {
      expect(getSourceSyntax('nu', '/etc/profile.d/init.nu'))
        .toBe('source "/etc/profile.d/init.nu"');
      expect(getSourceSyntax('nushell', '/etc/profile.d/init.nu'))
        .toBe('source "/etc/profile.d/init.nu"');
    });
    it('escapes double quotes in filepath consistently', () => {
      expect(getSourceSyntax('fish', '/p"a"th')).toBe('source "/p\\"a\\"th"');
      expect(getSourceSyntax('bash', '/p"a"th')).toBe('source "/p\\"a\\"th"');
      expect(getSourceSyntax('sh', '/p"a"th')).toBe('. "/p\\"a\\"th"');
      expect(getSourceSyntax('nu', '/p"a"th')).toBe('source "/p\\"a\\"th"');
    });
  });

  describe('buildFishSafeShellWrapper', () => {
    it('emits fish-native `set -gx WORKSPACE_ROOT` (NOT `WORKSPACE_ROOT=...`)', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('set -gx WORKSPACE_ROOT "/tmp/ws"');
      // Guard against bash-style `WORKSPACE_ROOT=...` assignment lines
      // creeping into the fish wrapper as the emit surface grows.
      // Note: the multiline-anchored regex is intentionally broad (any path
      // value, not just `/tmp/ws`) — `buildFishSafeShellWrapper` is the sole
      // emitter and should never produce a bare `WORKSPACE_ROOT=` line.
      expect(wrapper).not.toMatch(/^WORKSPACE_ROOT=/m);
    });
    it('emits fish-native `function cd; ...; end` (NOT bash `cd() { ... }`)', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('function cd');
      expect(wrapper).toContain('\nend\n');
      expect(wrapper).not.toMatch(/cd\s*\(\s*\)/); // bash form must be absent
    });
    it('emits fish-native `function pushd; ...; end`', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('function pushd');
    });
    it('contains the path-traversal message that the bash version emits', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('Path traversal blocked');
    });
    it('sets initial directory with fish-compatible cd invocation', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('cd "$WORKSPACE_ROOT" 2>/dev/null');
    });
    it('escapes workspace dir quotes in emit', () => {
      const wrapper = buildFishSafeShellWrapper('/p"a"th');
      expect(wrapper).toContain('set -gx WORKSPACE_ROOT "/p\\"a\\"th"');
    });
  });

  describe('buildNuSafeShellWrapper', () => {
    it('emits nu-native `$env.WORKSPACE_ROOT = "..."` (NOT `export ...` or `set -gx`)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('$env.WORKSPACE_ROOT = "/tmp/ws"');
      // Guard against bash/fish forms leaking into the nu wrapper.
      expect(wrapper).not.toMatch(/^export WORKSPACE_ROOT=/m);
      expect(wrapper).not.toMatch(/^set -gx WORKSPACE_ROOT=/m);
      expect(wrapper).not.toMatch(/^WORKSPACE_ROOT="/m);
    });

    // ---------------------------------------------------------------------
    // CRITICAL RECURSION-SAFETY TEST
    // ---------------------------------------------------------------------
    it('aliases the ORIGINAL cd BEFORE defining the override (prevents infinite recursion)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      // Nushell has no `builtin` keyword; the only safe way to keep access
      // to the original `cd` after defining the override is to alias it
      // BEFORE the def. Without this, the override body's `cd ...` call
      // would resolve to the new def and infinite-loop on first use.
      expect(wrapper).toContain('alias builtin_cd = cd');
      // Verify the alias line appears BEFORE the actual def SIGNATURE line
      // (not just before any docstring/comment that mentions 'def --env cd').
      // The bracket char `[` locks onto the real signature line.
      const aliasIdx = wrapper.indexOf('alias builtin_cd = cd');
      const defIdx = wrapper.indexOf('def --env cd [');
      expect(aliasIdx).toBeGreaterThan(-1);
      expect(defIdx).toBeGreaterThan(aliasIdx);
    });

    it('inside the override, EVERY cd call uses the aliased builtin_cd (NOT bare `cd`)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      // The emit contains EXACTLY 4 `builtin_cd` occurrences (the `\b`
      // word boundary counts the ALIAS line `alias builtin_cd = cd` as
      // one, plus the 3 invocation sites):
      //   1. alias line: `alias builtin_cd = cd`
      //   2. empty-target branch: `builtin_cd $env.WORKSPACE_ROOT`
      //   3. post-validation branch: `builtin_cd $expanded`
      //   4. final set-initial: `builtin_cd $env.WORKSPACE_ROOT`
      // The == 4 (not >= 2) assertion catches regressions where any of the
      // invocation sites are dropped, AND asserts the alias line is present
      // (without it, the body would recurse, silently producing HTTP 500).
      const builtinCdCount = (wrapper.match(/\bbuiltin_cd\b/g) || []).length;
      expect(builtinCdCount).toBe(4);
    });

    // ---------------------------------------------------------------------
    // NU SYNTAX DIVERGENCE TESTS
    // ---------------------------------------------------------------------
    it('emits NU-MANDATORY `def --env cd` (NOT plain `def cd` — would be silently inert)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('def --env cd');
      // Anti-regression: plain `def cd` would silently run the body in a
      // discarded scope and the cd would never propagate to the parent.
      expect(wrapper).not.toMatch(/^def\s+cd\b/m);
    });

    it('uses typed param `[target?: string = ""]` (NOT fish-style `argv[1]` like fish)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('[target?: string = ""]');
      // Anti-regression: fish-style argv[N] indexing must not leak in.
      expect(wrapper).not.toMatch(/argv\[\d+\]/);
    });

    it('uses nu-native `path expand` for tilde expansion (NOT fish `case "~"` epicycles)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('path expand');
      // Anti-regression: the fish wrapper uses `case "~"` epicycles.
      expect(wrapper).not.toMatch(/case\s+"~"/);
    });

    it('uses `str starts-with` + trailing-slash guard to block `/workspace-fake` prefix abuse', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('str starts-with');
      // The trailing-slash guard is the actual security boundary.
      // Naive `str starts-with $env.WORKSPACE_ROOT` would let `/workspace-fake`
      // pass; we MUST append `/` before prefix-matching. The substring
      // `($ws_root)/"` confirms the guard interpolation is present.
      expect(wrapper).toContain('($ws_root)/');
    });

    it('uses nu-native `error make {msg: ...}` for path-traversal halt (NOT `return 1` like bash)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('error make {msg:');
      expect(wrapper).toContain('Path traversal blocked');
      // Anti-regression: bash/fish return-style halt must not bleed in.
      expect(wrapper).not.toMatch(/\breturn\s+1\b/);
    });

    it('sets initial directory using builtin_cd + $env.WORKSPACE_ROOT', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      expect(wrapper).toContain('builtin_cd $env.WORKSPACE_ROOT');
    });

    it('escapes workspace dir quotes in emit', () => {
      const wrapper = buildNuSafeShellWrapper('/p"a"th');
      expect(wrapper).toContain('$env.WORKSPACE_ROOT = "/p\\"a\\"th"');
    });

    it('does NOT emit bash or fish syntax primitives (cross-shell anti-regression)', () => {
      const wrapper = buildNuSafeShellWrapper('/tmp/ws');
      // NONE of these belong in a nu wrapper — if any appear, a future refactor
      // accidentally regressed to a 4-way template rather than shell-specific emit.
      expect(wrapper).not.toMatch(/^export\s/m);
      expect(wrapper).not.toMatch(/^set\s+-gx/m);
      expect(wrapper).not.toMatch(/^function\s+\w+\s*$/m);
      expect(wrapper).not.toMatch(/\bend\s*$/m); // fish `end` keyword must not bleed into nu
      expect(wrapper).not.toMatch(/^\s*\w+\s*\(\s*\)\s*\{/m);
    });
  });

  describe('buildWorkspaceRootExport (convenience wrapper)', () => {
    it('produces correct fish syntax', () => {
      expect(buildWorkspaceRootExport('fish', '/tmp/ws'))
        .toBe('set -gx WORKSPACE_ROOT "/tmp/ws"');
    });
    it('produces correct bash syntax', () => {
      expect(buildWorkspaceRootExport('bash', '/tmp/ws'))
        .toBe('export WORKSPACE_ROOT="/tmp/ws"');
    });
    it('produces correct nushell syntax', () => {
      expect(buildWorkspaceRootExport('nu', '/tmp/ws'))
        .toBe('$env.WORKSPACE_ROOT = "/tmp/ws"');
    });
  });
});
