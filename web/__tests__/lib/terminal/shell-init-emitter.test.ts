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
  translateRuntimeEnvScript,
  getSafeShellWrapperPath,
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
    // REGRESSION (fish parse-time crash): emit MUST NOT define `function pushd`.
    // Fish has no native pushd built-in — the prior emit caused a parse-time
    // crash: `fish: Unknown builtin 'pushd'`. We rely on fish's native
    // "Unknown command" error so the user gets clear feedback. If fish ever
    // adds built-in pushd, re-introduce the override in the SAME form as
    // `function cd` (path-guard via `string match -q` glob + `test` exact-match).
    // REGRESSION (fish parse-time crash): emit MUST NOT define a `function pushd`
    // directive. Fish has no native `pushd` built-in (it's a bash/zsh concept) and
    // emits `fish: Unknown builtin 'pushd'` at parse time, blocking the entire
    // PTY session from starting. The assertion uses line-start regex (`^...$`
    // per line, multiline mode) so documentation comments that REFER to
    // "function pushd" as a string don't false-positive — only ACTUAL fish
    // directives are forbidden.
    it('does NOT emit `function pushd` directive (fish has no built-in pushd)', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      // (a) Line-start regex: catches ACTUAL fish directives; ignores doc-comments.
      expect(wrapper).not.toMatch(/^function pushd$/m);
      expect(wrapper).not.toMatch(/^builtin pushd$/m);
      // (b) Substring guard: catches any inline `builtin pushd` directive
      // inside ANY function body (forward-protection against stream-merge edits).
      expect(wrapper).not.toContain('builtin pushd');
      // (c) End-count forward-protection: a stream-merge edit that adds an extra
      // unpaired `end` would split the cd function body in two. Assert the emit
      // has AT LEAST one `^end$` line (closes `function cd`). Use `>= 1` instead
      // of `=== 1` to future-proof against legitimate cd-function evolution
      // (e.g., adding a switch/case block — fish's `end` is shared between
      // function + switch closures). Future operators may add new `end` lines
      // intentionally; the assertion flags UNEXPECTED removal (count 0) but
      // does NOT flag legitimate growth (count > 1).
      const standaloneEnds = (wrapper.match(/^end$/gm) || []).length;
      expect(standaloneEnds).toBeGreaterThanOrEqual(1);
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

    // REGRESSION (real fish parse-time crash): emit MUST NOT use
    // `string match -r` with regex parens in the path guard — fish evaluates
    // the `(/|$)` parens as command substitution AT PARSE TIME (before any
    // runtime options are read) and crashes. We deliberately switched to
    // anchored-glob + exact-match so the emit works on real fish 3.7.0.
    it('cd path guard avoids fish parse-time regex-paren crash', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      // (1) Old broken form MUST be GONE — broadly: ANY use of `string match -r`
      //     triggers the same parse-time hazard regardless of the regex pattern.
      //     Scope the check to the path-guard region so unrelated `-r` patterns
      //     elsewhere don't false-positive.
      const guardRegion = wrapper.split('\n').filter((l) => l.includes('"$resolved"'));
      expect(guardRegion.length).toBeGreaterThan(0);
      expect(guardRegion.join('\n')).not.toMatch(/string match -r\b/);
      // (2) New safe glob form MUST be present (in the cd override)
      expect(wrapper).toContain('string match -q "$WORKSPACE_ROOT/*"');
      // (3) Exact-match fallback MUST be present (in the cd override)
      expect(wrapper).toContain('test "$resolved" != "$WORKSPACE_ROOT"');
      // (4) Guard cardinality: each guard appears at least once (cd ONLY —
      //     the fish pushd override was dropped because fish has no native
      //     pushd; the mirror fix to the bash template at gateway.ts is via
      //     runtime detection at source-time that bypasses `builtin pushd`
      //     for sh/dash/ash).
      const globCount = wrapper.match(/string match -q "\$WORKSPACE_ROOT\/\*"/g)?.length ?? 0;
      const exactCount = wrapper.match(/test "\$resolved" != "\$WORKSPACE_ROOT"/g)?.length ?? 0;
      expect(globCount).toBeGreaterThanOrEqual(1);
      expect(exactCount).toBeGreaterThanOrEqual(1);
    });

    it('cd path guard has zero parse-time regex/grouping chars (fish-safe)', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      // Parse-time hazards in the path-guard region:
      //   - `(` ... `)` would be evaluated as command substitution at PARSE TIME
      //     (the original crash vector for the regex `(/|$)`)
      //   - `|` (bare in double-quoted glob) is a pipe-of-patterns marker that
      //     fish treats as alternation at parse time
      // We assert NONE of the active guard lines contain these chars in the
      // pattern position (i.e., the substring between the opening `"` and the
      // closing `"` of the glob argument).
      const guardLines = wrapper.split('\n').filter((l) =>
        l.includes('string match -q "$WORKSPACE_ROOT') ||
        l.includes('test "$resolved" != "$WORKSPACE_ROOT"'),
      );
      expect(guardLines.length).toBeGreaterThanOrEqual(1); // cd only (fish pushd was dropped: fish has no `pushd` built-in; cf. test above)
      for (const line of guardLines) {
        // No `(` or `)` ANYWHERE in the guard line — parens anywhere inside the
        // double-quoted argument region will be mis-parsed as command sub.
        expect(line).not.toMatch(/[()]/);
        // No bare `|` inside the glob pattern — fish alternation marker.
        expect(line).not.toMatch(/\|/);
      }
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

  describe('getSafeShellWrapperPath', () => {
    // Closes the cross-shell-contamination bug surfaced by a real fish
    // TerminalPanel session on 2026-07-16: a fish user inherited a bash
    // wrapper (with `builtin pushd`) via the shared `_safe_shell_init.sh`
    // filename, crashing at parse time. The per-shellBasename filename
    // scheme makes that bug structurally impossible.
    it('returns per-shellBasename filename for fish (NOT shared _safe_shell_init.sh)', () => {
      const p = getSafeShellWrapperPath('/workspace', 'fish', false);
      // The filename MUST include `fish` in it so concurrent bash+fish
      // sessions don't share the same wrapper file.
      expect(p).toContain('_safe_shell_init.fish.sh');
      // And MUST NOT be the legacy shared filename (exact match OR regex).
      expect(p).not.toBe('/workspace/.binG-temp/_safe_shell_init.sh');
      // The basename tail is `_safe_shell_init.{shellBasename}.sh` — never
      // exactly `_safe_shell_init.sh` (the legacy shape).
      expect(p).not.toMatch(/\/[^/]*_safe_shell_init\.sh$/);
    });

    it('differentiates non-POSIX shell basenames — every fish/bash/zsh/nu variant is unique', () => {
      const nonPosixShells = ['fish', 'bash', 'zsh', 'nu', 'nushell'];
      const paths = new Set(nonPosixShells.map((s) => getSafeShellWrapperPath('/workspace', s, false)));
      // Each non-POSIX shell basenamed path MUST be unique. If any two collide,
      // the cross-shell-contamination bug is still possible.
      expect(paths.size).toBe(nonPosixShells.length);
    });

    it('POSIX sh canonicalizes sh/dash/ash to single uniform filename (no double `_safe_shell_init.sh.sh`)', () => {
      // SHOULDCONSIDER #2: POSIX sh variants (sh, dash, ash) all map to a single
      // canonical filename `_safe_shell_init_posixsh.sh`. This avoids the
      // awkward `_safe_shell_init.sh.sh` double-extension + gives operators one
      // stable grep target. The cross-shell-contamination invariant is still
      // preserved — the POSIX sh path MUST NOT equal any non-POSIX shell path.
      const sh = getSafeShellWrapperPath('/workspace', 'sh', false);
      const dash = getSafeShellWrapperPath('/workspace', 'dash', false);
      const ash = getSafeShellWrapperPath('/workspace', 'ash', false);
      expect(sh).toBe('/workspace/.binG-temp/_safe_shell_init_posixsh.sh');
      expect(dash).toBe(sh);
      expect(ash).toBe(sh);
      // Distinct from the legacy shared filename (the cross-shell-contamination
      // invariant — a fish session running AFTER a POSIX sh session must not
      // pick up the POSIX wrapper).
      expect(sh).not.toBe('/workspace/.binG-temp/_safe_shell_init.sh');
      // Distinct from the non-POSIX shell basenamed filenames.
      expect(sh).not.toMatch(/\/[^/]*_safe_shell_init\.(fish|bash|zsh|nu|nushell)\.sh$/);
    });

    it('POSIX sh filename is still distinguishable from each non-POSIX shell (no cross-shell collision)', () => {
      // Belt-and-suspenders: even though sh/dash/ash all collapse to one file,
      // that file MUST still differ from every non-POSIX shell path so a
      // concurrent fish/bash/zsh session never sources a POSIX sh wrapper.
      const posixPath = getSafeShellWrapperPath('/workspace', 'sh', false);
      for (const nonPosix of ['fish', 'bash', 'zsh', 'nu', 'nushell']) {
        expect(getSafeShellWrapperPath('/workspace', nonPosix, false)).not.toBe(posixPath);
      }
    });

    it('Windows path uses PowerShell profile, independent of shellBasename', () => {
      const win1 = getSafeShellWrapperPath('C:\\Users\\test', 'powershell.exe', true);
      expect(win1).toContain('_safe_profile.ps1');
      expect(win1).toContain('C:');
      const win2 = getSafeShellWrapperPath('C:\\Users\\test', 'fish', true);
      // Both PowerShell and any other shellBasename collapse to _safe_profile.ps1
      // on Windows — there's only one allowlisted windows shell.
      expect(win2.replace(/\\/g, '/')).toBe(win1.replace(/\\/g, '/'));
    });

    it('falls back to `unknown` shellBasename when input is empty (forward-protection)', () => {
      const p = getSafeShellWrapperPath('/workspace', '', false);
      // Must still be unique — not legacy shared filename.
      expect(p).toBe('/workspace/.binG-temp/_safe_shell_init.unknown.sh');
    });

    it('honors the codebase path-join convention for trailing slashes (no double-slash)', () => {
      // path.join already handles this; regression-locked here so a future
      // refactor away from path.join doesn't regress.
      const p = getSafeShellWrapperPath('/workspace/', 'fish', false);
      expect(p).not.toMatch(/\/{2,}/);
    });

    it('idempotent: same inputs always produce the same path (regression-locks path normalization)', () => {
      const a = getSafeShellWrapperPath('/workspace', 'fish', false);
      const b = getSafeShellWrapperPath('/workspace', 'fish', false);
      // Three calls with aligned shapes should all yield byte-identical
      // strings — protects against accidental non-determinism from
      // timestamp / random suffix drift in future refactors.
      expect(a).toBe(b);
      expect(a).toBe(getSafeShellWrapperPath('/workspace', 'fish', false));
    });
  });

  describe('translateRuntimeEnvScript (closes OUTERCATCH-PROD-REACHABILITY)', () => {
    it('rewrites bash `export VAR="val"` to fish `set -gx VAR "val"` for fish target', () => {
      const bashScript = 'export WORKSPACE_ROOT="/tmp/ws"\nexport FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'fish');
      expect(result.content).toBe('set -gx WORKSPACE_ROOT "/tmp/ws"\nset -gx FOO "bar"\n');
      expect(result.count).toBe(2);
    });
    it('preserves bash `export VAR="val"` byte-identical when target is bash', () => {
      const bashScript = 'export WORKSPACE_ROOT="/tmp/ws"\nexport FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'bash');
      expect(result.content).toBe('export WORKSPACE_ROOT="/tmp/ws"\nexport FOO="bar"\n');
      expect(result.count).toBe(2);
    });
    it('rewrites to nu `$env.VAR = "val"` for nushell target', () => {
      const bashScript = 'export FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'nu');
      expect(result.content).toBe('$env.FOO = "bar"\n');
      expect(result.count).toBe(1);
    });
    it('rewrites to POSIX sh `VAR=""; export VAR` for sh target', () => {
      const bashScript = 'export FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'sh');
      expect(result.content).toBe('FOO="bar"; export FOO\n');
      expect(result.count).toBe(1);
    });
    it('rewrites to zsh-compatible `export VAR="val"` for zsh target', () => {
      const bashScript = 'export FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'zsh');
      expect(result.content).toBe('export FOO="bar"\n');
      expect(result.count).toBe(1);
    });
    it('preserves non-export lines unchanged (comments + blanks)', () => {
      const mixed = '# This is a comment\nexport FOO="bar"\n\n# Another comment\nexport BAZ="qux"\n';
      const result = translateRuntimeEnvScript(mixed, 'fish');
      expect(result.content).toBe('# This is a comment\nset -gx FOO "bar"\n\n# Another comment\nset -gx BAZ "qux"\n');
      expect(result.count).toBe(2);
    });
    it('handles escape sequences in values (\\" and \\\\) round-trip correctly', () => {
      // Bash value `path with \"quoted\"` -> unescape -> `path with "quoted"`
      // -> re-translate via getEnvExportSyntax -> shell-correct escape form.
      const bashScript = 'export PATH="/usr/bin:\\"quoted\\""\n';
      const result = translateRuntimeEnvScript(bashScript, 'fish');
      // fish: set -gx PATH "/usr/bin:\"quoted\""
      expect(result.content).toBe('set -gx PATH "/usr/bin:\\"quoted\\""\n');
      expect(result.count).toBe(1);
    });
    it('returns empty content + zero count for empty input', () => {
      const result = translateRuntimeEnvScript('', 'fish');
      expect(result.content).toBe('');
      expect(result.count).toBe(0);
      expect(result.malformed).toEqual([]);
    });
    it('FAIL-LOUD: drops malformed `export` lines (no-quote) + records them in malformed[] + warns', () => {
      // Missing quotes — the runtime is emitting non-canonical bash form.
      // Per SHOULDCONSIDER (a): never pass malformed export-prefixed lines through
      // (that would re-trigger OUTERCATCH-PROD-REACHABILITY if target is fish).
      const loggedWarns: { msg: string; meta?: Record<string, unknown> }[] = [];
      const testLogger = {
        warn: (msg: string, meta?: Record<string, unknown>) => {
          loggedWarns.push({ msg, meta });
        },
      };
      const bashScript = 'export NO_QUOTES=plain\nexport FOO="bar"\n';
      const result = translateRuntimeEnvScript(bashScript, 'fish', testLogger);
      // NO_QUOTES line is malformed (no `="..."` wrapper) — DROPPED from content,
      // recorded in malformed array; FOO line is well-formed — re-translates cleanly.
      expect(result.content).toBe('set -gx FOO "bar"\n');
      expect(result.count).toBe(1);
      expect(result.malformed).toEqual(['export NO_QUOTES=plain']);
      // Logger was called exactly once with the dropped line as metadata.
      expect(loggedWarns).toHaveLength(1);
      expect(loggedWarns[0].meta).toMatchObject({
        line: 'export NO_QUOTES=plain',
        shellBasename: 'fish',
      });
      expect(loggedWarns[0].msg).toContain('dropped malformed');
    });
    it('FAIL-LOUD: handles single-quote export form (export FOO=\'val\') as malformed', () => {
      // Single-quote is a bash-legal `export` form but NOT our canonical
      // double-quoted regex. Must be dropped + recorded to prevent leaking
      // bash-syntax lines into fish/nu's `.workspace_env`.
      const bashScript = `export FOO='bar'\nexport BAZ="qux"\n`;
      const result = translateRuntimeEnvScript(bashScript, 'fish');
      expect(result.content).toBe('set -gx BAZ "qux"\n');
      expect(result.count).toBe(1);
      expect(result.malformed).toEqual([`export FOO='bar'`]);
    });
    it('returns empty malformed[] when all lines are well-formed', () => {
      const bashScript = 'export A="1"\nexport B="2"\n';
      const result = translateRuntimeEnvScript(bashScript, 'fish');
      expect(result.malformed).toEqual([]);
      expect(result.count).toBe(2);
    });
    it('does NOT warn when logger is not provided (silent mode for tests)', () => {
      // Empty logger / undefined logger must NOT throw. The malformed lines
      // are still detected + recorded in malformed[]; only the warn() call is skipped.
      const bashScript = 'export NO_QUOTES=plain\n';
      expect(() => translateRuntimeEnvScript(bashScript, 'fish')).not.toThrow();
      const result = translateRuntimeEnvScript(bashScript, 'fish');
      expect(result.malformed).toEqual(['export NO_QUOTES=plain']);
      expect(result.count).toBe(0);
    });
    it('CRITICAL ANTI-REGRESSION: fish target emits ONLY fish-syntax lines, no bash `export ` lines', () => {
      // The whole point of OUTERCATCH-PROD-REACHABILITY closure:
      // when target is fish, the resulting content must NEVER contain bare
      // bash `export VAR="..."` lines — fish would reject at parse time
      // (the exact bug the original report flagged).
      const workspaceEnvScript = [
        'export WORKSPACE_ROOT="/tmp/ws"',
        'export FOO="bar"',
        'export PATH="$HOME/bin:/usr/bin"',
        'export SECRET_API_KEY="abc123"',
      ].join('\n') + '\n';
      const result = translateRuntimeEnvScript(workspaceEnvScript, 'fish');
      // Every translated line should start with fish's `set -gx` or be a non-export line.
      const translatedLines = result.content.split('\n').filter((l) => l.trim().length > 0);
      for (const line of translatedLines) {
        expect(line).not.toMatch(/^\s*export\s+[A-Z_]/);
      }        expect(result.count).toBe(4);
      });
    });
  });

  // REGRESSION (explicit user ask from prior turn): spawn REAL `fish -n` against
  // the wrapper emit so a parse-time hazard re-introduction is caught even if
  // vitest unit assertions pass. The only class of bug this catches is
  // emission-level parse failures — unit assertions can pass while the real
  // fish parser still rejects the emit on `builtin <unknown>` etc.
  // Use `it.skip()` (NOT a bare `return`) so CI surfaces 'skipped' vs. 'passed'
  // distinctly — the prior `return`-as-skip pattern would mask a missing-fish-binary
  // environment as a passing test (false-green for CI badge purposes).
  describe('real-fish REPL parse integration (parse-time hazard regression)', () => {
    // PRECHECK: lint once — if fish binary present, run; otherwise skip via
    // vitest's `it.skip` so the test is reported as skipped (not silently
    // passed-as-green).
    let fishAvailable = false;
    try {
      const probe = require('child_process').execFileSync('command', ['-v', 'fish'], { encoding: 'utf-8' });
      fishAvailable = !!probe.trim();
    } catch { fishAvailable = false; }
    const itFish = fishAvailable ? it : it.skip;

    itFish('fish -n <wrapper.fish> exits 0', () => {
      const wrapper = buildFishSafeShellWrapper('/tmp/ws');
      const { writeFileSync, unlinkSync } = require('fs') as typeof import('fs');
      const { tmpdir } = require('os') as typeof import('os');
      const { spawnSync } = require('child_process') as typeof import('child_process');
      const tmpFile = `${tmpdir()}/bing-fish-wrapper-${process.pid}-${Date.now()}.fish`;
      writeFileSync(tmpFile, wrapper, 'utf-8');
      try {
        const result = spawnSync('fish', ['-n', tmpFile], { encoding: 'utf-8', timeout: 30000 });
        if (result.status !== 0) {
          throw new Error(
            `fish -n <wrapper> failed (exit ${result.status}). ` +
              `Stderr: ${result.stderr}. ` +
              `Wrapper first 500 chars: ${wrapper.substring(0, 500)}`,
          );
        }
        expect(result.status).toBe(0);
      } finally {
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
      }
    });
  });
