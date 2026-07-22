# TO-NU-INTERACTIVE-INJECT — Nushell Interactive Init Injection

**Status**: OPEN (2026-07-16)
**Priority**: P2 (correctness/security boundary)
**Owner**: Terminal Panel team
**Origin**: Nushell extension build cycle (see `/opt/bing/web/lib/terminal/shell-init-emitter.ts`)

## Problem

`/opt/bing/web/lib/terminal/shell-init-emitter.ts` now ships `buildNuSafeShellWrapper()`
which emits a nushell-syntax wrapper script with:

- `$env.WORKSPACE_ROOT = "..."` env-export
- `alias builtin_cd = cd` (CRITICAL — prevents infinite recursion in the override)
- `def --env cd [target?: string = ""] { ... builtin_cd ... }` cd-override
- `builtin_cd $env.WORKSPACE_ROOT` initial cd

The helper is complete and unit-tested (29 assertions covering 5 helpers × 5 shells + 2 wrappers).

**The blocker**: the gateway `/opt/bing/web/app/api/terminal/local-pty/gateway.ts`
has NO invocation mechanism for nushell. Without this, a user selecting `nu`
in the TerminalPanel xterm session gets a one-shot init or no init at all.

## Why nushell is hard

Unlike bash (`--init-file`) / fish (`--init-command`) / zsh (`-c "source && exec"`),
nushell has NO inline equivalent at the binary level:

| Approach | Works? | Why / Why not |
|----------|--------|---------------|
| `nu -c "source 'init.nu'; nu"` (recursive self-call) | **NO** | `def --env cd` overrides are PER-PROCESS. The inner interactive nu does NOT inherit the outer def. ENV vars (`$env.WORKSPACE_ROOT`) DO inherit. The cd override silently disappears — **DEPLOY-BLOCKING security gap**. |
| `nu -c "source 'init.nu'"` | Yes (one-shot) | Init runs + nu exits. Not useful for interactive TerminalPanel. |
| `nu --config /workspace/.binG-temp/_safe_nu_init.nu` | Partial | Loads `init.nu` IF config has our source. Conflicts with user's `$nu.config-path`. Functions from our config DO persist (good for def). Requires emitting a config-compatible header. |
| **Post-spawn stdin injection** (`pty.write(initContent)`) | **Recommended** | Write the init script to the pty's stdin immediately after spawn. Nu processes stdin commands at the REPL. Functions defined via `def` ARE available for the rest of the session. |

## Recommended fix

Add `preInitLines?: string[]` to the return shape of `createSafeShellWrapper`
in gateway.ts. The nu branch returns the init script lines as
`preInitLines`. The caller (`createDirectPtySession` / equivalent) writes
them to `pty.write()` immediately after `pty.spawn()`, BEFORE the user
can type anything. This guarantees:

1. `$env.WORKSPACE_ROOT` is set
2. `alias builtin_cd = cd` is registered
3. `def --env cd [...]` is defined
4. `builtin_cd $env.WORKSPACE_ROOT` runs initial cd
5. THE HANDOFF: pty is now interactive with all overrides active

Nu is a REPL — it processes stdin lines as commands sequentially.

## Acceptance criteria

1. `ARTSHELL_SHELLS` constant in `gateway.ts` includes `/usr/bin/nu` + `/usr/local/bin/nu` + `nushell` (alias)
2. `createSafeShellWrapper` return shape extended with `preInitLines?: string[]`
3. The nu branch returns `preInitLines: buildNuSafeShellWrapper(workspaceDir).split('\n')`
4. `createDirectPtySession` writes `preInitLines` to pty within 50ms of `pty.spawn()`
5. New regression test: `__tests__/api/terminal/local-pty-nu-init.test.ts` mocks `pty.write` and asserts the init lines are written in order
6. Manual repro: open TerminalPanel xterm with `nu`, observe `$env.WORKSPACE_ROOT` is set + `cd /tmp` is BLOCKED with `cd: Path traversal blocked`
7. Existing bash/zsh/fish sessions byte-identical (no regression)

## Risks

- **Race**: pty prompt may flash before init completes. Mitigation: defer prompt display via `pty.write` triggering after a brief delay OR using `pty.onData` to wait for first prompt cue.
- **Echo noise**: if pty echoes typed bytes before nu processes them, init lines could be visually echoed. Acceptable for now (a single line of `[READOUT] init` is preferable to security bypass).
- **Order sensitivity**: `$env` assignment MUST precede `def --env cd` (env must be defined before the def tries to read it). Both come BEFORE `builtin_cd $env.WORKSPACE_ROOT`.

## Verification

- Vitest on new regression test (5+ assertions)
- tsc clean on modified files
- Manual xterm repro with `nu`

## Out of scope

- Nu config-file (`config.nu`) integration — too invasive (user config override)
- Nu plugin/custom-command registration — future work
- Nu PWD export (nu handles `$env.PWD` automatically via `cd`)

## Resolution path

Apply Phases A–D:

**A** (lowest risk): Add `preInitLines` support + nu branch (1 PR)
**B** (production hardening): Add race-mitigation + visual-noise suppression (1 PR)
**C** (cleanup): Migrate to nu `--config` integration if user research surfaces config-management friction (deferred)
