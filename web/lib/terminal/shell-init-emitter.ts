/**
 * Shell-agnostic init-script syntax helpers.
 *
 * Used by the local-pty gateway (`app/api/terminal/local-pty/gateway.ts`)
 * to emit env-var exports, source commands, and cd-override wrappers
 * that work correctly across fish, bash, zsh, and POSIX sh.
 *
 * Why this file exists:
 *
 * Fish rejects bash syntax at parse time. The previous gateway emitted a
 * single bash-formatted `_safe_shell_init.sh` shared by all shells. When
 * the user selected fish as their terminal shell, fish tried to source
 * that bash script via `--init-command source` and failed at line 2 with:
 *
 *   ~/.binG-temp/_safe_shell_init.sh (line 2): Unsupported use of '='.
 *   In fish, please use 'set WORKSPACE_ROOT "..."'
 *
 * This module provides a single helper surface the gateway can call when
 * emitting shell-specific syntax. All helpers are deterministic string
 * builders — no I/O, no side effects, fully unit-testable.
 */

/**
 * Return the lowercase basename of a shell executable path.
 * `/bin/bash` -> `bash`, `/usr/bin/zsh` -> `zsh`, `/bin/fish` -> `fish`.
 */
export function getShellBasename(shellPath: string): string {
  // path is reasonably available here since the gateway uses it; import locally
  // to keep this module dependency-light for unit tests.
  const idx = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
  const base = idx >= 0 ? shellPath.substring(idx + 1) : shellPath;
  return base.toLowerCase();
}

/** True iff the shell basename identifies fish. */
export function isFishShell(shellBasename: string): boolean {
  return shellBasename === 'fish';
}

/** True iff the shell basename identifies a POSIX sh dialect (sh/dash/ash). */
export function isPosixShShell(shellBasename: string): boolean {
  return shellBasename === 'sh' || shellBasename === 'dash' || shellBasename === 'ash';
}

/**
 * True iff the shell basename identifies nushell (`nu`) or its `nushell`
 * alias used by some Linux package managers.
 *
 * Nushell is structurally different from POSIX shells and fish: it uses
 * `$env.X = "value"` for env exports, `def [params] { ... }` for functions
 * (with mandatory `--env` flag when mutating parent shell state like `cd`),
 * and `error make {msg: "..."}` for halt-on-violation.
 *
 * No `--init-command` equivalent exists at the binary level — gateway
 * invocation is a separate concern (see TO-NU-INTERACTIVE-INJECT ticket).
 */
export function isNuShell(shellBasename: string): boolean {
  return shellBasename === 'nu' || shellBasename === 'nushell';
}

/**
 * Shell-correct env-var export. Returns a single line (no trailing newline).
 *
 * - fish:        `set -gx VAR "value"`   (global AND exported; inherited by children)
 * - nu:          `$env.VAR = "value"`    (nushell; --env is implicit per assignment)
 * - bash / zsh:  `export VAR="value"`    (POSIX-compatible)
 * - POSIX sh:    `VAR="value"; export VAR` (most portable for sh variants)
 */
export function getEnvExportSyntax(
  shellBasename: string,
  varName: string,
  value: string,
): string {
  // Escape: backslashes (shell-dependent; conservative) + double-quotes.
  // The bash/POSIX side handles backslashes natively; fish must also get valid quoting.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (isFishShell(shellBasename)) {
    return `set -gx ${varName} "${escaped}"`;
  }
  if (isNuShell(shellBasename)) {
    return `$env.${varName} = "${escaped}"`;
  }
  if (isPosixShShell(shellBasename)) {
    return `${varName}="${escaped}"; export ${varName}`;
  }
  return `export ${varName}="${escaped}"`;
}

/**
 * Shell-correct source command. Returns a single line (no trailing newline).
 *
 * - fish / bash / zsh / nu: `source "filepath"`  (all four share the keyword)
 * - POSIX sh:               `. "filepath"`       (more portable — some sh lack `source`)
 */
export function getSourceSyntax(shellBasename: string, filePath: string): string {
  const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (isPosixShShell(shellBasename)) {
    return `. "${escaped}"`;
  }
  return `source "${escaped}"`;
}

/**
 * Build a fish-format wrapper script that overrides the cd + pushd builtins
 * to prevent path traversal outside the workspace directory. Mirrors the
 * existing bash wrapper's intent but uses fish-native syntax.
 *
 * Fish syntax differences from bash:
 * - `set -gx VAR "val"` instead of `VAR="val"`
 * - `function name; ...; end` instead of `name() { ... }`
 * - `test -z "$x"` instead of `[ -z "$x" ]` or `[[ -z "$x" ]]`
 * - `switch $x; case 'a'; ...; end` instead of `case "$x" in a) ...;; esac`
 * - `(path resolve ...)` returns the resolved path; no `$(pwd -P)` substitute
 * - `string match -r "^prefix(/|$)" $x` for prefix-with-or-without-trailing-slash
 * - `2>/dev/null` is fish-compatible (uses fish's redirection)
 */
export function buildFishSafeShellWrapper(workspaceDir: string): string {
  const escaped = workspaceDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    '# Safe shell init - prevent cd from escaping workspace (fish syntax)',
    `set -gx WORKSPACE_ROOT "${escaped}"`,
    '',
    '# Override cd builtin — blocks path traversal including ~/ (home dir)',
    'function cd',
    '    set target $argv[1]',
    '    if test -z "$target"',
    '        builtin cd "$WORKSPACE_ROOT"',
    '        return $status',
    '    end',
    '    # Expand tilde to home directory BEFORE validation',
    '    switch $target',
    '        case "~"',
    '            set target "$HOME"',
    '        case "~/*"',
    '            set target "$HOME/$target[3..-1]"',
    '    end',
    '    # Resolve the full path; path resolve returns empty on missing dir',
    '    set -l resolved (path resolve --no-symlinks "$target" 2>/dev/null)',
    '    if test -z "$resolved"',
    '        # Target resolution failed - do a basic prefix check on the raw target',
    '        switch "$target"',
    '            case "$WORKSPACE_ROOT" "$WORKSPACE_ROOT/*"',
    '                builtin cd "$target"',
    '                return $status',
    '            case "*"',
    '                echo "cd: Path traversal blocked - must stay within workspace" >&2',
    '                return 1',
    '        end',
    '    end',
    '    if not string match -r "^$WORKSPACE_ROOT(/|$)" "$resolved"',
    '        echo "cd: Path traversal blocked - must stay within workspace" >&2',
    '        return 1',
    '    end',
    '    builtin cd "$resolved"',
    'end',
    '',
    '# Override pushd',
    'function pushd',
    '    set target $argv[1]',
    '    switch $target',
    '        case "~"',
    '            set target "$HOME"',
    '        case "~/*"',
    '            set target "$HOME/$target[3..-1]"',
    '    end',
    '    set -l resolved (path resolve --no-symlinks "$target" 2>/dev/null)',
    '    if test -z "$resolved"',
    '        echo "pushd: Path traversal blocked - must stay within workspace" >&2',
    '        return 1',
    '    end',
    '    if not string match -r "^$WORKSPACE_ROOT(/|$)" "$resolved"',
    '        echo "pushd: Path traversal blocked - must stay within workspace" >&2',
    '        return 1',
    '    end',
    '    builtin pushd "$target"',
    'end',
    '',
    '# Set initial directory',
    'cd "$WORKSPACE_ROOT" 2>/dev/null',
    '',
  ].join('\n');
}

/**
 * Build a WORKSPACE_ROOT export line in shell-correct syntax.
 * Convenience wrapper around `getEnvExportSyntax` for the most common case.
 */
export function buildWorkspaceRootExport(shellBasename: string, workspaceDir: string): string {
  return getEnvExportSyntax(shellBasename, 'WORKSPACE_ROOT', workspaceDir);
}

/**
 * Build a nushell (`nu`) safe-shell wrapper script that overrides the `cd`
 * builtin to prevent path traversal outside the workspace directory.
 *
 * Nushell syntax divergences from bash/fish (all MUST be preserved):
 *
 * - **`alias builtin_cd = cd` BEFORE `def`: CRITICAL.** Nushell does NOT
 *   have a `builtin` keyword (unlike bash/fish). Calling `cd $expanded`
 *   inside the override body resolves to the NEW `def cd`, causing
 *   infinite recursion. The safe pattern is to alias the original `cd`
 *   to a different name BEFORE defining the override, then call that
 *   alias from inside the body. Skipping the alias silently produces
 *   infinite recursion at the first `cd $env.WORKSPACE_ROOT` call.
 *
 * - **`def --env`** is mandatory: a plain `def cd` runs the body in a
 *   discarded child scope, so `builtin_cd $expanded` would NOT mutate the
 *   parent shell's working directory. The `--env` flag forces the body
 *   to mutate parent-shell state. Without this flag, the override is
 *   silently inert.
 *
 * - **Typed params**: `[target?: string = ""]` (optional string with empty
 *   default) cleanly handles `cd` with no arguments — which is the legal
 *   "go to workspace root" form in nu (unlike bash where `cd` alone defaults
 *   to `$HOME`).
 *
 * - **`path expand`** natively resolves `~/` AND `~user/` — no manual
 *   string-slicing needed (and we avoid the bash/fish epicyclic cases).
 *
 * - **`str starts-with` + trailing-slash guard**: blocks `/workspace-fake`
 *   from passing a naive `/workspace` prefix check. Append `/` to
 *   workspace_root before prefix-matching so only true descendants match.
 *
 * - **`error make {msg: "..."}`** is nu's idiomatic halt-with-message —
 *   throws an error record, exits the function, and prints to stderr.
 *   Analogous to bash's `echo "..." >&2; return 1` but with structured
 *   error introspection capability.
 *
 * - **`return`** (no value) is nu's early-exit keyword inside `def` blocks.
 *
 * Gateway invocation for nu is a separate concern — nu has no
 * `--init-command` equivalent. See /opt/bing/.tickets/TO-NU-INTERACTIVE-INJECT.md
 * for the post-spawn stdin-injection bridge.
 */
export function buildNuSafeShellWrapper(workspaceDir: string): string {
  const escaped = workspaceDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    '# Safe shell init - prevent cd from escaping workspace (nu syntax)',
    `$env.WORKSPACE_ROOT = "${escaped}"`,
    '',
    '# CRITICAL: alias the ORIGINAL cd BEFORE defining the override.',
    '# Nushell has no `builtin` keyword; without this alias the override',
    '# would infinitely recurse (nu resolves `cd` in the def body to the',
    '# new def, not the original). Verified via thinker-with-files-gemini 2026-07-16.',
    'alias builtin_cd = cd',
    '',
    '# Override cd builtin — blocks path traversal including ~/ (home dir).',
    '# `def --env` is MANDATORY: without --env the body runs in a discarded',
    '# scope and the directory change never reaches the parent shell.',
    'def --env cd [target?: string = ""] {',
    '    if ($target | is-empty) {',
    '        builtin_cd $env.WORKSPACE_ROOT',
    '        return',
    '    }',
    '    # Native tilde expansion — handles both ~/ and ~user/',
    '    let expanded = ($target | path expand)',
    '    # Trailing-slash guard: blocks /workspace-fake from matching /workspace.',
    '    let ws_root = $env.WORKSPACE_ROOT',
    '    if not ($expanded == $ws_root or ($expanded | str starts-with $"($ws_root)/")) {',
    '        error make {msg: "cd: Path traversal blocked - must stay within workspace"}',
    '    }',
    '    builtin_cd $expanded',
    '}',
    '',
    '# Set initial directory',
    'builtin_cd $env.WORKSPACE_ROOT',
    '',
  ].join('\n');
}
