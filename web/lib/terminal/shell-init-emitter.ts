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
 * And — because the shared filename was used by BOTH createSafeShellWrapper
 * AND the runtime env-emit region in the gateway, a user-selected fish
 * session running AFTER a bash session would inherit the bash wrapper
 * (including `builtin pushd`) and crash at parse time:
 *
 *   ~/.binG-temp/_safe_shell_init.sh (line 65): Unknown builtin "pushd"
 *
 * `getSafeShellWrapperPath` (this module) is the single source of truth
 * for the per-shell filename. Wrappers are now keyed by `shellBasename`
 * so each shell gets its own file (`_safe_shell_init.fish.sh`,
 * `_safe_shell_init.bash.sh`, etc.) — eliminating the cross-shell race.
 *
 * This module provides a single helper surface the gateway can call when
 * emitting shell-specific syntax. All helpers are deterministic string
 * builders — no I/O, no side effects, fully unit-testable.
 */

import * as path from 'path';

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
    '    # Path guard — use exact match OR anchored glob. Fish `string match -q`',
    '    # is fully anchored, so "$WORKSPACE_ROOT/*" correctly excludes',
    '    # "/workspace-fake" (the trailing "/" enforces path-boundary).',
    '    # We AVOID `string match -r` because fish evaluates the parens in',
    '    # `(/|$)` as command substitution AT PARSE TIME and crashes.',
    '    if test "$resolved" != "$WORKSPACE_ROOT"',
    '        and not string match -q "$WORKSPACE_ROOT/*" "$resolved"',
    '        echo "cd: Path traversal blocked - must stay within workspace" >&2',
    '        return 1',
    '    end',
    '    builtin cd "$resolved"',
    'end',
    '',
    '# NOTE: `function pushd ... builtin pushd ... end` was REMOVED.',
    '# Fish has no native `pushd` built-in (it is a bash/zsh concept); the',
    '# previous emit caused a parse-time crash: `fish: Unknown builtin',
    '# \'pushd\'`. We rely on fish\'s native "Unknown command" message so',
    '# the user gets clear feedback on missing-command intent.',
    '# Re-introduce the override in the SAME form as `function cd` if',
    '# fish ever adds a native pushd (use `string match -q` glob +',
    '# `test` exact-match path-guard — see cd override above for design).',
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
 * Optional logger interface for runtime warning emission.
 * Matches the shape of `@/lib/utils/logger`'s `createLogger` return type.
 * Kept as a structural type so the helper has zero import dependencies.
 */
export interface TranslateRuntimeLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Compute the per-shell safe-shell wrapper script path. Each shell gets its
 * own file so concurrent or sequential cross-shell sessions on the same
 * workspace CANNOT overwrite each other's wrapper.
 *
 * Naming convention (anti-cross-shell-contamination):
 *   Unix:    `<workspaceDir>/.binG-temp/_safe_shell_init.<shellBasename>.sh`
 *            Examples:
 *              _safe_shell_init.fish.sh       (fish)
 *              _safe_shell_init.bash.sh       (bash)
 *              _safe_shell_init.zsh.sh        (zsh)
 *              _safe_shell_init_posixsh.sh    (POSIX sh/dash/ash — UNIFORM canonical
 *                                              filename regardless of literal basename
 *                                              to avoid the `_safe_shell_init.sh.sh`
 *                                              awkwardness + to give operators one
 *                                              stable grep target)
 *   Windows: `<workspaceDir>/.binG-temp/_safe_profile.ps1`  (powershell — no
 *              cross-shell concern since powershell is the only allowlisted
 *              windows shell).
 *
 * Why per-shellBasename (closes the cross-shell-contamination bug):
 *   Before this helper existed, BOTH `createSafeShellWrapper` AND the
 *   runtime env-emit region in `gateway.ts` hardcoded the filename
 *   `_safe_shell_init.sh`. Result: a fish user starting AFTER a bash user
 *   would source the bash wrapper (with `builtin pushd`) at parse time and
 *   crash with `fish: Unknown builtin 'pushd'`. The per-shellBasename
 *   filename encoded in this helper makes that bug structurally impossible.
 *
 * Single source of truth: every site that reads or writes the safe-shell
 * wrapper MUST call this helper. Adding new call sites without calling this
 * helper will stand out in code review as a regression risk.
 *
 * @param workspaceDir  The real on-disk workspace directory (e.g. `/tmp/...`)
 * @param shellBasename  Lowercase basename of the target shell (fish/bash/zsh/...)
 * @param isWindows  Set to true on win32 to use the PowerShell profile path
 */
export function getSafeShellWrapperPath(
  workspaceDir: string,
  shellBasename: string,
  isWindows = false,
): string {
  if (isWindows) return path.join(workspaceDir, '.binG-temp', '_safe_profile.ps1');
  // POSIX sh canonicalization: sh/dash/ash all map to a single canonical
  // filename `_safe_shell_init_posixsh.sh` regardless of the literal basename.
  // Reasons: (a) avoids the awkward `_safe_shell_init.sh.sh` double-extension,
  // (b) gives operators one stable grep target (`grep _safe_shell_init_posixsh.sh`),
  // (c) preserves the cross-shell-contamination invariant — a POSIX sh session
  // cannot collide with a fish/bash/zsh session that uses its basenamed filename.
  if (isPosixShShell(shellBasename)) {
    return path.join(workspaceDir, '.binG-temp', '_safe_shell_init_posixsh.sh');
  }
  const safeShellBasename = shellBasename || 'unknown';
  return path.join(workspaceDir, '.binG-temp', `_safe_shell_init.${safeShellBasename}.sh`);
}

/**
 * Re-translate a runtime workspace env-script from bash-format
 * (`export VAR="value"`) into the target shell's native export syntax.
 *
 * Use case (closes OUTERCATCH-PROD-REACHABILITY follow-up): the runtime
 * service's `buildShellInitScript()` returns a fixed bash-syntax string
 * (`export WORKSPACE_ROOT="/path"\nexport FOO="bar"\n`...). When the target
 * shell is fish, nu, or any non-bash dialect, that content would crash
 * the shell parser when sourced from `.workspace_env` (fish would reject
 * `export` at line 2 with "Unsupported use of '='", nu would reject
 * similarly). This helper re-emits each line in shell-correct syntax
 * via the existing `getEnvExportSyntax` dispatch.
 *
 * Line classification (SHOULDCONSIDER a fail-loud semantics):
 *   - Canonical `export VAR="value"`     → re-translate to target shell
 *   - Begins with `export` but malformed  → DROP + record in `malformed`
 *     + warn (latent regression vector: silently passing them through to
 *     fish's `.workspace_env` would re-trigger OUTERCATCH-PROD-REACHABILITY
 *     if runtime ever emits non-canonical (single-quote / no-quote) forms)
 *   - Anything else (comments, blanks)   → pass through unchanged
 *
 * Returns: `{ content; count; malformed }`
 *   - content: translated script with malformed lines EXCLUDED
 *   - count: number of cleanly re-translated lines
 *   - malformed: lines that started with `export` but failed canonical
 *     regex — the caller can decide whether to surface as a runtime error
 */
export function translateRuntimeEnvScript(
  workspaceEnvScript: string,
  shellBasename: string,
  logger?: TranslateRuntimeLogger,
): { content: string; count: number; malformed: string[] } {
  const lines = workspaceEnvScript.split('\n');
  const out: string[] = [];
  let count = 0;
  const malformed: string[] = [];
  // Canonical regex: `export VAR="value"` with optional leading/trailing
  // whitespace. Var names: uppercase letters, digits, underscores,
  // MUST start with letter or underscore (env-var convention).
  // Value: double-quoted, may contain `\"` and `\\` escapes.
  const exportRegex = /^\s*export\s+([A-Z_][A-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/;
  // Detection regex: any line that begins with `export` keyword —
  // distinguishes export-prefixed malformed lines from benign non-export
  // lines (comments, blanks) that should pass through.
  const exportPrefixRegex = /^\s*export\b/;
  for (const line of lines) {
    const match = line.match(exportRegex);
    if (match) {
      const varName = match[1];
      // Unescape bash-string escapes (&quot; \&quot;) before re-translation.
      // The receiving helper will re-escape per the target shell's syntax.
      const escapedValue = match[2];
      const unescapedValue = escapedValue.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      out.push(getEnvExportSyntax(shellBasename, varName, unescapedValue));
      count++;
    } else if (exportPrefixRegex.test(line)) {
      // Latent regression vector: if we silently passthrough this line,
      // fish's .workspace_env will contain bash-syntax that fish rejects
      // at parse time. Drop + record + warn (fail-loud).
      malformed.push(line);
      logger?.warn(
        '[translateRuntimeEnvScript] dropped malformed `export` line — runtime may emit non-canonical syntax that could re-trigger OUTERCATCH-PROD-REACHABILITY',
        { line, shellBasename },
      );
    } else {
      // Non-export line (comment, blank, etc.): pass through unchanged.
      out.push(line);
    }
  }
  return { content: out.join('\n'), count, malformed };
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
