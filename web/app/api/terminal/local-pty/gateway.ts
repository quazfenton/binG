/**
 * Local PTY API Route (Web Mode)
 *
 * Provides real PTY terminal access on the server via node-pty.
 * Supports multiple isolation modes for security.
 *
 * Isolation modes (ENABLE_LOCAL_PTY env var):
 *   "off"       — Disabled (production default)
 *   "localhost" — Try unshare namespace isolation, fall back to direct spawn
 *   "unshare"   — Linux user namespace isolation (unshare --user --map-root-user)
 *   "docker"    — Per-session Docker container isolation
 *   "on"        — Direct spawn (fallback when unshare unavailable, e.g. macOS)
 *
 * Default (when ENABLE_LOCAL_PTY is not set):
 *   - Linux: "unshare" (rootless container with user/mount/PID namespace isolation)
 *   - macOS/Windows: "on" (direct spawn, no isolation)
 *   - Production: "off" (disabled)
 *
 * Endpoints:
 *   POST /api/terminal/local-pty        — Create PTY session
 *   GET  /api/terminal/local-pty        — SSE output stream
 *   POST /api/terminal/local-pty/input  — Send keystrokes
 *   POST /api/terminal/local-pty/resize — Resize terminal
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { resolveFilesystemOwner } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import type { FilesystemOwnerResolution } from '@/lib/virtual-filesystem/resolve-filesystem-owner';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type { IPty } from 'node-pty';
import { createLogger } from '@/lib/utils/logger';
import { generateSecureId } from '@/lib/utils/utils';
import {
  materializeWorkspace,
  watchWorkspaceForChanges,
} from '@/lib/virtual-filesystem/vfs-workspace-materializer';

import {
  isR2FuseAvailable,
  buildR2ContainerInitScript,
  resolveR2WorkspaceDir,
  sanitizeUserId,
  unmountR2FromHost,
  mountR2OnHost,
  cleanupOrphanedR2Mounts,
} from '@/lib/terminal/r2-mount-helper';
import {
  buildBwrapSetupCommands,
  buildChrootSetupCommands,
  buildDockerOnVMCommands,
  buildRootlessPodmanCommands,
  buildSharedShellSetupCommands,
  getOracleUserWorkspace,
  sanitizeOracleUserId,
  shellSafe,
  CHROOT_ROOTFS_TARBALL,
} from '@/lib/terminal/oracle-vm-isolation';
import {
  classifyCommand,
  executeWithRouting,
  type ExecutionRouterConfig,
  type ClassifiedCommand,
} from '@/lib/terminal/execution-router';
import { virtualPidRegistry } from '@/lib/terminal/virtual-pid-registry';
import { sandboxOrchestrator } from '@/lib/sandbox/sandbox-orchestrator';
import { getWorkspaceRuntime } from '@/lib/terminal/workspace-runtime-service';
import {
  buildFishSafeShellWrapper,
  isFishShell,
  getShellBasename,
  getEnvExportSyntax,
  getSourceSyntax,
  translateRuntimeEnvScript,
  getSafeShellWrapperPath,
} from '@/lib/terminal/shell-init-emitter';

const logger = createLogger('LocalPTY');

// Bug #4 (audit): Workspace-switch grace window — when the OPFS adapter is
// mid-switch (ownerId changed), the PTY gateway's resolveFilesystemOwner may
// return the NEW ownerId while the session was created with the OLD ownerId.
// This produces a 400 Bad Request because the workspace validation fails.
// The grace window allows both old and new ownerIds for 30 seconds after the
// switch is detected, so in-flight PTY requests during a workspace transition
// succeed without requiring a client retry.
const WORKSPACE_SWITCH_GRACE_WINDOW_MS = 30_000;
const workspaceSwitchTimestamps = new Map<string, { newOwnerId: string; switchedAt: number }>();


// ============================================================
// Path Traversal Prevention
// ============================================================

/**
 * Create a shell initialization script that prevents `cd` from escaping
 * the workspace directory.
 *
 * On Windows: creates a PowerShell profile that overrides Set-Location.
 * On Unix: creates a bash init file that overrides the cd builtin.
 */
async function createSafeShellWrapper(
  workspaceDir: string,
  shellPath: string,
): Promise<{ cmd: string; args: string[]; env?: Record<string, string>; shellBasename: string } | null> {
  const isWindows = process.platform === 'win32';
  // Hoisted from the Unix branch so EVERY return path can thread `shellBasename`
  // back to the caller — single source of truth for the target shell across
  // the whole PTY lifecycle. The downstream env-emit region in
  // createDirectPtySession now reads from `safeShell.shellBasename` instead of
  // recomputing via `getShellBasename(ptyShell)` (SHOULDCONSIDER b DRY).
  const shellBasename = getShellBasename(shellPath);
  const wrapperDir = path.join(workspaceDir, '.binG-temp');
  // Per-shellBasename filename — closes the cross-shell-contamination bug
  // where a fish session inherited a bash wrapper written by a prior bash
  // session via the shared `_safe_shell_init.sh` filename. Centralized in
  // `getSafeShellWrapperPath` so the env-emit region (createDirectPtySession
  // around L1737) reads the SAME per-shellBasename file rather than a
  // hardcoded fallback filename.
  const wrapperPath = getSafeShellWrapperPath(workspaceDir, shellBasename, isWindows);

  try {
    await fs.promises.mkdir(wrapperDir, { recursive: true });

    // Proactive legacy-cleanup: remove the OLD shared `_safe_shell_init.sh`
    // filename artifact if it lingers in this workspace. Without this defense
    // in depth, any third-party tool (or older gateway code) that reads the
    // shared filename would still source the bash template, recreating the
    // fish-`builtin pushd` crash on cross-shell workspaces. Best-effort;
    // .catch(() => {}) matches the codebase's silent-cleanup idiom (e.g. the
    // appendFile block below).
    if (!isWindows) {
      await fs.promises.unlink(path.join(wrapperDir, '_safe_shell_init.sh')).catch(() => {});
    }

    if (isWindows) {
      // PowerShell: Create a profile script that overrides Set-Location
      const psProfile = [
        '# Safe PowerShell profile - prevent Set-Location from escaping workspace',
        `$script:WorkspaceRoot = '${workspaceDir.replace(/'/g, "''")}'`,
        '',
        // Define a global 'cd' function that shadows the built-in 'cd' alias.
        // A function takes precedence over an alias with AllScope, so no
        // Set-Alias is needed (which would fail with AllScope aliases).
        'function global:cd {',
        '    param([Parameter(ValueFromRemainingArguments=$true)][string]$Path)',
        '    if ($null -eq $Path -or $Path -eq \'\') {',
        '        Microsoft.PowerShell.Management\\Set-Location $script:WorkspaceRoot',
        '        return',
        '    }',
        '    # Expand tilde (~) to user home BEFORE validation',
        '    if ($Path.StartsWith(\'~\')) {',
        '        $homeDir = [Environment]::GetFolderPath(\'UserProfile\')',
        '        $tail = $Path.Substring(1)',
        '        $Path = Join-Path $homeDir $tail',
        '    }',
        '    # Resolve the target path',
        '    $resolved = $Path',
        '    if (![System.IO.Path]::IsPathRooted($Path)) {',
        '        $resolved = Join-Path (Get-Location).Path $Path',
        '    }',
        '    try {',
        '        $resolved = Resolve-Path $resolved -ErrorAction Stop',
        '    } catch {',
        '        # Path doesn\'t exist - do a string-based check',
        '        $resolvedStr = $Path',
        '        if (![System.IO.Path]::IsPathRooted($resolvedStr)) {',
        '            $resolvedStr = Join-Path (Get-Location).Path $resolvedStr',
        '        }',
        '        $checkPath = $resolvedStr.Replace(\'/\', \'\\\')',
        '        $rootPath = $script:WorkspaceRoot.Replace(\'/\', \'\\\')',
        '        if (!$checkPath.StartsWith($rootPath + \'\\\', \'CurrentCultureIgnoreCase\') -and $checkPath -ne $rootPath) {',
        '            Write-Warning "cd: Path traversal blocked - must stay within workspace"',
        '            return',
        '        }',
        '        Microsoft.PowerShell.Management\\Set-Location $Path',
        '        return',
        '    }',
        '    $realPath = $resolved.ProviderPath',
        '    $rootPath = $script:WorkspaceRoot',
        '    if (!$realPath.StartsWith($rootPath, \'CurrentCultureIgnoreCase\') -and $realPath -ne $rootPath) {',
        '        Write-Warning "cd: Path traversal blocked - must stay within workspace"',
        '        return',
        '    }',
        '    Microsoft.PowerShell.Management\\Set-Location $Path',
        '}',
        '',
        `Set-Location '${workspaceDir.replace(/'/g, "''")}'`,
      ].join('\n');
      await fs.promises.writeFile(wrapperPath, psProfile, 'utf-8');


      return {
        cmd: shellPath,
        args: ['-NoExit', '-NoLogo', '-NoProfile', '-Command', `& { . '${wrapperPath.replace(/'/g, "''")}' }`],
        shellBasename,
      };
    } else {
      // Unix: Create shell-aware cd override init script.
      //   Fish requires fish-native syntax (`set -gx`, `function ... end`); the
      //   `'='`-assignment form is rejected at parse time with:
      //     `~/.binG-temp/_safe_shell_init.sh (line 2): Unsupported use of '='`.
      //   Bash / zsh / sh stay on the original bash template below for
      //   byte-identical backward compat with existing sessions.
      const escapedWorkspaceDir = workspaceDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // `shellBasename` is hoisted at the top of createSafeShellWrapper so the
      // return shape can carry it through to the env-emit caller — do not
      // re-derive here.
      const shellScript = isFishShell(shellBasename)
        ? buildFishSafeShellWrapper(workspaceDir)
        : `# Safe shell init - prevent cd from escaping workspace
WORKSPACE_ROOT="${escapedWorkspaceDir}"

# Override cd builtin — blocks path traversal including ~/ (home dir)
cd() {
    local target="$1"
    if [ -z "$target" ]; then
        builtin cd "$WORKSPACE_ROOT"
        return $?
    fi
    # Expand tilde to home directory BEFORE validation
    case "$target" in
        ~) target="$HOME" ;;
        ~/*) target="$HOME/$(printf '%s' "$target" | cut -c3-)" ;;
    esac
    # Resolve the full path
    local resolved
    if [[ "$target" = /* ]]; then
        resolved="$target"
    else
        resolved="$(pwd)/$target"
    fi
    # Canonicalize (remove /./../ etc)
    resolved="$(cd "$resolved" 2>/dev/null && pwd -P)" || resolved=""
    if [ -z "$resolved" ]; then
        # Target doesn't exist - do a basic prefix check on the string
        local check="$target"
        if [[ "$check" != /* ]]; then
            check="$(pwd)/$check"
        fi
        case "$check" in
            "$WORKSPACE_ROOT"/*) builtin cd "$target"; return $? ;;
            "$WORKSPACE_ROOT") builtin cd "$target"; return $? ;;
            *) echo "cd: Path traversal blocked - must stay within workspace" >&2; return 1 ;;
        esac
    fi
    if [[ "$resolved" != "$WORKSPACE_ROOT" && "$resolved" != "$WORKSPACE_ROOT"/* ]]; then
        echo "cd: Path traversal blocked - must stay within workspace" >&2
        return 1
    fi
    builtin cd "$resolved"
}

# Override pushd — bash/zsh have built-in pushd; sh/dash/ash do NOT.
# Source-time runtime detection: emit the real override only on shells that
# have a native pushd, otherwise emit a warning stub. Without this guard,
# \`builtin pushd\` would crash at runtime on sh/dash with \`pushd: not found\`    # (analogous to the fish parse-time crash fixed in shell-init-emitter.ts - see
    # the comment block there for the design rationale).
# NOTE: BASH_VERSION / ZSH_VERSION env vars are escaped as TS template
# expressions (with the backslash-dollar prefix below) so the source-time
# runtime detect block sees the literal env-var reference at runtime.
# (For TS template-literal safety without the backslash-dollar escape,
# tsc fails with TS1005 because unescaped $VAR inside backticks is
# treated as a JS expression.)
if [ -n "\${BASH_VERSION:-}" ] || [ -n "\${ZSH_VERSION:-}" ]; then
    pushd() {
        local target="$1"
        # Expand tilde to home directory BEFORE validation
        case "$target" in
            ~) target="$HOME" ;;
            ~/*) target="$HOME/$(printf '%s' "$target" | cut -c3-)" ;;
        esac
        local resolved="$(cd "$target" 2>/dev/null && pwd -P)" || resolved=""
        if [[ -z "$resolved" || ( "$resolved" != "$WORKSPACE_ROOT" && "$resolved" != "$WORKSPACE_ROOT"/* ) ]]; then
            echo "pushd: Path traversal blocked - must stay within workspace" >&2
            return 1
        fi
        builtin pushd "$target"
    }
else
    # sh/dash/ash: no native pushd - warning stub mirrors the fish decision
    # (fish wrapper drops the pushd function entirely; sh/dash gets an
    # explicit warning so the user understands why their pushd did nothing).
    pushd() {
        echo "[chatshell] pushd not supported in this shell (only bash/zsh have it built-in)" >&2
        return 1
    }
fi

# Set initial directory
cd "$WORKSPACE_ROOT" 2>/dev/null || true
`;
      await fs.promises.writeFile(wrapperPath, shellScript, { mode: 0o755 });

      // Detect shell type and use the correct init mechanism.
      // shellBasename bound above via the getShellBasename helper; do not re-bind.
      if (shellBasename === 'bash' || shellBasename.endsWith('-bash')) {
        // bash: use --init-file
        return {
          cmd: shellPath,
          args: ['--init-file', wrapperPath, '-i'],
          shellBasename,
        };
      } else if (shellBasename === 'zsh') {
        // zsh: source the init script then exec interactive zsh
        return {
          cmd: shellPath,
          args: ['-c', `source '${wrapperPath}' && exec ${shellPath} -i`],
          shellBasename,
        };
      } else if (shellBasename === 'fish') {
        // fish: use fish's init file mechanism
        return {
          cmd: shellPath,
          args: ['--init-command', `source '${wrapperPath}'`],
          shellBasename,
        };
      } else {
        // sh/dash/ash/unknown: use ENV environment variable
        return {
          cmd: shellPath,
          args: ['-i'],
          env: { ENV: wrapperPath },
          shellBasename,
        };
      }
    }
  } catch (err: any) {
    logger.warn('[Local PTY] Failed to create safe shell wrapper, falling back to direct spawn', {
      error: err.message,
    });
    return null;
  }
}

// ============================================================
// Session Store (singleton across HMR via globalThis)
// ============================================================

interface LocalPtySession {
  sessionId: string;
  userId: string;
  pty: IPty;
  createdAt: number;
  exited: boolean;
  exitCode: number | undefined;
  dockerContainerId?: string;
  unsharePid?: number;
  // SSH client for Oracle VM sessions — closed on cleanup
  sshClient?: any;
  // Output queue for SSE streaming (typed, not `any`)
  outputQueue: string[];
  // VFS file watcher — syncs real filesystem changes back to VFS database
  vfsWatcher?: { stop: () => void };
  // Real workspace directory on disk (materialized from VFS)
  workspaceDir: string;
  // R2 Docker mode: indicates R2 mount strategy ('host' | 'container' | null)
  r2MountStrategy?: 'host' | 'container' | null;
  // Oracle VM isolation metadata
  oracleIsolation?: 'podman' | 'bwrap' | 'chroot' | 'docker' | 'shared-shell';
  // Oracle VM container name for Docker-based isolation (for cleanup)
  oracleContainerName?: string;
  /**
   * Authoritative VFS owner resolution captured from the API route
   * request. Threaded into the session at creation time and forwarded
   * to the execution router so the affinity binding (created on
   * first sandbox access) carries the authoritative ownerId instead
   * of falling back to the session lookup.
   */
  ownerResolution?: FilesystemOwnerResolution;
  // Execution routing: intercept non-trivial commands and route to sandbox providers
  executionRouterEnabled?: boolean;
}

// Security: Max sessions per user to prevent resource exhaustion
const MAX_SESSIONS_PER_USER = 5;

// Use globalThis to prevent HMR leaks
declare global {
  var __localPtySessions: Map<string, any> | undefined;
}

const sessions = globalThis.__localPtySessions ??= new Map<string, LocalPtySession>() as Map<string, any>;

// ============================================================
// Configuration
// ============================================================

type IsolationMode = 'off' | 'localhost' | 'unshare' | 'docker' | 'r2-docker' | 'oracle-vm' | 'on';

/**
 * Read the current isolation mode from the environment.
 * Evaluated per-request so that vi.stubEnv() works in tests.
 *
 * Default (when ENABLE_LOCAL_PTY is not set):
 *   - Linux: 'unshare' — rootless container with user/mount/PID namespace isolation
 *   - macOS/Windows: 'on' — direct spawn (unshare requires Linux)
 *   - Production: 'off' — disabled
 *   - ORACLE_VM_HOST set: 'oracle-vm' — remote SSH-based isolation
 */
function getIsolationMode(): IsolationMode {
  const envMode = process.env.ENABLE_LOCAL_PTY as IsolationMode;
  if (envMode) return envMode;
  if (process.env.ORACLE_VM_HOST) return 'oracle-vm';
  if (process.env.NODE_ENV === 'production') return 'off';
  // Phase 1: Default to rootless container isolation on Linux
  return process.platform === 'linux' ? 'unshare' : 'on';
}

// Docker isolation config
const DOCKER_IMAGE = process.env.LOCAL_PTY_DOCKER_IMAGE || 'node:20-slim';
const DOCKER_MEMORY = process.env.LOCAL_PTY_DOCKER_MEMORY || '512m';
const DOCKER_CPU = process.env.LOCAL_PTY_DOCKER_CPU || '1';
/**
 * Path to a seccomp profile JSON file for Docker container isolation.
 * Defaults to the project's hardened profile at seccomp/hardened-podman.json.
 * The profile blocks ~65 dangerous syscalls (unshare, setns, mount, etc.).
 * Set LOCAL_PTY_DOCKER_SECCOMP="" to disable seccomp filtering.
 */
const DOCKER_SECCOMP_PROFILE = (() => {
  const raw = process.env.LOCAL_PTY_DOCKER_SECCOMP;
  if (raw === '') return null; // explicitly disabled
  if (raw) return raw;         // custom path
  // Default: project-bundled hardened profile (seccomp/ is at repo root, web/ is one level down)
  const candidates = [
    path.resolve(process.cwd(), 'seccomp', 'hardened-podman.json'),
    path.resolve(process.cwd(), '..', 'seccomp', 'hardened-podman.json'),
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch { /* try next */ }
  }
  return null; // profile not found — skip seccomp
})();

// R2 Docker isolation config — s3fs-fuse container with R2 as /workspace
const R2_DOCKER_IMAGE = process.env.R2_TERMINAL_DOCKER_IMAGE || 'bing-terminal-r2:latest';
const R2_DOCKER_MEMORY = process.env.R2_TERMINAL_DOCKER_MEMORY || '512m';
const R2_DOCKER_CPU = process.env.R2_TERMINAL_DOCKER_CPU || '1';

// Execution routing config — enabled via EXECUTION_ROUTING_ENABLED env var
const EXECUTION_ROUTING_ENABLED = process.env.EXECUTION_ROUTING_ENABLED === 'true';

// Input limits
const MAX_COLS = 500;
const MAX_ROWS = 200;
const MIN_COLS = 10;
const MIN_ROWS = 5;

// ============================================================
// Per-Workspace User Namespace Isolation (Phase 1: step 3)
// ============================================================

/**
 * Enable per-workspace unique UID/GID mappings via /etc/subuid and
 * newuidmap/newgidmap. When enabled, each workspace session gets a unique
 * subuid offset derived from the session ID, using a fork+pipe wrapper
 * script to properly call newuidmap/newgidmap on the namespace process.
 *
 * Requires /etc/subuid and /etc/subgid to have a range configured
 * (e.g., "user:100000:65536"). Set PTY_UNSHARE_PER_WORKSPACE_UID=true.
 */
const UNSHARE_PER_WORKSPACE_UID = process.env.PTY_UNSHARE_PER_WORKSPACE_UID === 'true';

/**
 * Generate a bash wrapper script that creates a user namespace with
 * unique per-session UID/GID mappings via newuidmap/newgidmap.
 *
 * Flow:
 *  1. Parse /etc/subuid and /etc/subgid for the current user's range
 *  2. Derive per-session offset from session ID hash
 *  3. Create a named pipe for parent-child synchronization
 *  4. Child: unshare --user --pid (NO --fork!) — $$ reports parent-ns PID
 *  5. Child signals parent via pipe, parent calls newuidmap/newgidmap
 *  6. Parent signals child, child execs the real shell
 *
 * DESIGN NOTE — why no --fork:
 *  With unshare --fork, the child process enters a new PID namespace where
 *  $$ returns 1.  newuidmap MUST receive the PID as seen from the *parent*
 *  namespace.  Removing --fork keeps the initial process in the parent
 *  PID namespace (its children get new PIDs), so $$ is the correct PID.
 *
 *  Without --fork there is no PID-1 process in the new PID namespace,
 *  but mounting /proc still works on modern kernels (5.x+).  The exec'd
 *  shell inherits the parent-ns PID and its children get new-ns PIDs.
 *
 * Falls back to --map-root-user if /etc/subuid is not configured.
 */
function buildUnshareSubuidWrapperScript(
  sessionId: string,
  shellCmd: string,
  shellArgs: string[],
): string {
  const escapedShellCmd = shellCmd.replace(/'/g, "'\\''");
  const escapedShellArgs = shellArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

  return `#!/bin/bash
# Auto-generated unshare wrapper with newuidmap/newgidmap support
# Session: ${sessionId}
set -euo pipefail

USER_NAME=$(id -un)
SESSION_ID="${sessionId}"
SHELL_CMD='${escapedShellCmd}'
SHELL_ARGS=(${escapedShellArgs})

# --- Parse /etc/subuid for this user's available range ---
SUBUID_LINE=$(grep "^\${USER_NAME}:" /etc/subuid 2>/dev/null | head -1 || true)
SUBGID_LINE=$(grep "^\${USER_NAME}:" /etc/subgid 2>/dev/null | head -1 || true)

if [ -z "$SUBUID_LINE" ] || [ -z "$SUBGID_LINE" ]; then
    # Fallback: use --map-root-user (no per-workspace isolation)
    exec unshare --user --map-root-user --mount --pid --fork --mount-proc -- "$SHELL_CMD" "\${SHELL_ARGS[@]}"
fi

SUBUID_START=$(echo "$SUBUID_LINE" | cut -d: -f2)
SUBUID_COUNT=$(echo "$SUBUID_LINE" | cut -d: -f3)
SUBGID_START=$(echo "$SUBGID_LINE" | cut -d: -f2)
SUBGID_COUNT=$(echo "$SUBGID_LINE" | cut -d: -f3)

# --- Derive per-session offset from session ID hash ---
HASH=$(echo -n "$SESSION_ID" | cksum | awk '{print $1}')
MAX_OFFSET=$((SUBUID_COUNT < 65536 ? SUBUID_COUNT : 65536))
OFFSET=$((HASH % MAX_OFFSET))

MAPPED_UID=$((SUBUID_START + OFFSET))
MAPPED_GID=$((SUBGID_START + OFFSET))

# --- Create named pipe for synchronization ---
PIPE_DIR=$(mktemp -d /tmp/unshare-pipe-XXXXXX)
PIPE_IN="$PIPE_DIR/in"
PIPE_OUT="$PIPE_DIR/out"
mkfifo "$PIPE_IN" "$PIPE_OUT"
trap "rm -rf '$PIPE_DIR'" EXIT

# --- Start child: unshare WITHOUT --fork so $$ is from parent namespace ---
# Without --fork, the process spawned by unshare keeps its original PID
# (visible from the parent).  Only its *children* get new PIDs inside the
# new PID namespace.  This is exactly what we need: newuidmap can address
# the process by its parent-namespace PID.
#
# --mount-proc is omitted because without --fork there is no PID-1 init
# in the new namespace.  We mount /proc manually after maps are written.
unshare --user --mount --pid -- /bin/bash -c '
    # $$ is the PID in the PARENT namespace (no --fork) — correct for newuidmap
    echo $$ > '"$PIPE_OUT"'
    # Wait for parent to write uid_map / gid_map
    read _ < '"$PIPE_IN"'
    # Mount /proc in the new PID namespace (requires maps to be written first)
    # Make root rprivate first to prevent mount propagation back to the host
    mount --make-rprivate / 2>/dev/null || true
    mount -t proc proc /proc 2>/dev/null || true
    # Now exec the real shell
    exec "$0" "$@"
' "$SHELL_CMD" "\${SHELL_ARGS[@]}" &
NS_PID=$!

# --- Parent: read the child's parent-namespace PID from the pipe ---
# This is the same as $! but we read it from the pipe for validation.
REPORTED_PID=$(cat "$PIPE_OUT")

# Verify the reported PID matches what we expect (belt-and-suspenders)
if [ "$REPORTED_PID" != "$NS_PID" ]; then
    NS_PID="$REPORTED_PID"
fi

# Write setgroups first (must be "deny" before writing gid_map)
echo "deny" > "/proc/$NS_PID/setgroups" 2>/dev/null || true

# Use newuidmap/newgidmap if available, otherwise write maps directly
if command -v newuidmap >/dev/null 2>&1; then
    newuidmap "$NS_PID" "0 $MAPPED_UID 1" || {
        # Fallback: write uid_map directly
        echo "0 $MAPPED_UID 1" > "/proc/$NS_PID/uid_map" 2>/dev/null || true
    }
    newgidmap "$NS_PID" "0 $MAPPED_GID 1" || {
        echo "0 $MAPPED_GID 1" > "/proc/$NS_PID/gid_map" 2>/dev/null || true
    }
else
    echo "0 $MAPPED_UID 1" > "/proc/$NS_PID/uid_map" 2>/dev/null || true
    echo "0 $MAPPED_GID 1" > "/proc/$NS_PID/gid_map" 2>/dev/null || true
fi

# Signal child: mappings are ready, continue execution
echo 'go' > "$PIPE_IN"

# Wait for child to finish
wait $NS_PID
`;
}

// ============================================================
// Cgroups v2 Resource Limits (Phase 1: shared-VM hardening)
// ============================================================

/** Whether cgroups v2 resource limits are enabled for PTY sessions. */
const CGROUPS_ENABLED = process.env.PTY_CGROUPS_ENABLED !== 'false'; // on by default

/**
 * Maximum memory per PTY session in bytes.
 * Supports K/M/G suffixes (e.g. "512M", "1G").
 * Default: 512 MiB. Set PTY_CGROUPS_MEMORY_MAX=0 to disable memory limiting.
 */
const CGROUPS_MEMORY_MAX = (() => {
  const raw = (process.env.PTY_CGROUPS_MEMORY_MAX || '512M').toUpperCase();
  if (raw === '0') return 0;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(K|M|G)?$/);
  if (!match) return 536870912; // 512M default on parse failure
  const num = parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === 'K') return Math.round(num * 1024);
  if (suffix === 'M') return Math.round(num * 1024 * 1024);
  if (suffix === 'G') return Math.round(num * 1024 * 1024 * 1024);
  return Math.round(num); // raw bytes
})();

/**
 * CPU quota per PTY session as a percentage of one CPU (0-100+).
 * Default: 50 (50% of one CPU). Set PTY_CGROUPS_CPU_PERCENT=0 to disable.
 * Internally converted to microseconds-per-100ms for cgroups v2 cpu.max.
 */
const CGROUPS_CPU_PERCENT = (() => {
  const raw = process.env.PTY_CGROUPS_CPU_PERCENT || '50';
  const val = parseFloat(raw);
  return isNaN(val) ? 50 : Math.max(0, val);
})();

/**
 * Maximum number of processes (PIDs) per PTY session.
 * Default: 128. Set PTY_CGROUPS_PIDS_MAX=0 to disable PID limiting.
 */
const CGROUPS_PIDS_MAX = (() => {
  const raw = process.env.PTY_CGROUPS_PIDS_MAX || '128';
  const val = parseInt(raw, 10);
  return isNaN(val) ? 128 : val;
})();

/** Root cgroup path for bing terminal sessions. */
const CGROUPS_ROOT = '/sys/fs/cgroup/bing-terminals';

/**
 * Apply cgroups v2 resource limits to a process and its descendants.
 *
 * Creates a per-session cgroup directory under the bing-terminals root,
 * enables controllers in the parent cgroup's subtree_control, sets
 * memory.max, cpu.max, and pids.max controllers, then adds the
 * process PID to the cgroup.
 *
 * Best-effort: silently returns if cgroups v2 is unavailable, disabled,
 * or if the process doesn't have permission to write to the cgroup fs.
 */
function applyCgroupLimits(pid: number, sessionId: string): void {
  if (!CGROUPS_ENABLED) return;
  if (!pid || pid < 1) return;

  const cgroupPath = `${CGROUPS_ROOT}/${sessionId}`;

  try {
    // Ensure the parent cgroup exists and has controllers enabled.
    // In cgroups v2, child cgroups inherit controllers only if the parent
    // enables them via cgroup.subtree_control.
    fs.mkdirSync(CGROUPS_ROOT, { recursive: true });
    const controllers = ['+memory', '+cpu', '+pids'].filter(c => {
      if (c === '+memory' && CGROUPS_MEMORY_MAX === 0) return false;
      if (c === '+cpu' && CGROUPS_CPU_PERCENT === 0) return false;
      if (c === '+pids' && CGROUPS_PIDS_MAX === 0) return false;
      return true;
    });
    if (controllers.length > 0) {
      try {
        fs.writeFileSync(`${CGROUPS_ROOT}/cgroup.subtree_control`, controllers.join(' '), 'utf-8');
      } catch {
        // Parent cgroup may not be writable — controllers may still be pre-enabled
      }
    }

    // Create cgroup directory for this session
    fs.mkdirSync(cgroupPath, { recursive: true });

    // Set memory limit
    if (CGROUPS_MEMORY_MAX > 0) {
      try {
        fs.writeFileSync(`${cgroupPath}/memory.max`, String(CGROUPS_MEMORY_MAX), 'utf-8');
      } catch {
        // memory controller may not be available
      }
    }

    // Set CPU quota: CGROUPS_CPU_PERCENT % of one CPU → microseconds per 100ms
    if (CGROUPS_CPU_PERCENT > 0) {
      const cpuMax = Math.round(CGROUPS_CPU_PERCENT * 1000); // % → µs per 100ms
      try {
        fs.writeFileSync(`${cgroupPath}/cpu.max`, `${cpuMax} 100000`, 'utf-8');
      } catch {
        // cpu controller may not be available
      }
    }

    // Set PID limit
    if (CGROUPS_PIDS_MAX > 0) {
      try {
        fs.writeFileSync(`${cgroupPath}/pids.max`, String(CGROUPS_PIDS_MAX), 'utf-8');
      } catch {
        // pids controller may not be available
      }
    }

    // Add the process to the cgroup
    try {
      fs.writeFileSync(`${cgroupPath}/cgroup.procs`, String(pid), 'utf-8');
    } catch (err: any) {
      // Failed to add process — clean up the cgroup directory
      try { fs.rmdirSync(cgroupPath); } catch { /* best-effort */ }
      // Only log if it's not a permission issue (which is expected without root/cgroup delegation)
      if (err.code !== 'EACCES' && err.code !== 'EPERM') {
        logger.warn('[Local PTY] Failed to add PID to cgroup', {
          sessionId,
          pid,
          error: err.message,
        });
      }
      return;
    }

    logger.info('[Local PTY] Cgroup limits applied', {
      sessionId,
      pid,
      memory: CGROUPS_MEMORY_MAX > 0 ? `${(CGROUPS_MEMORY_MAX / 1048576).toFixed(0)}M` : 'unlimited',
      cpu: CGROUPS_CPU_PERCENT > 0 ? `${CGROUPS_CPU_PERCENT}%` : 'unlimited',
      pids: CGROUPS_PIDS_MAX > 0 ? CGROUPS_PIDS_MAX : 'unlimited',
    });
  } catch (err: any) {
    // Best-effort: cgroups v2 may not be mounted or accessible
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      logger.debug('[Local PTY] Cgroup setup skipped', {
        sessionId,
        error: err.message,
      });
    }
  }
}

/**
 * Remove the cgroup directory for a session during cleanup.
 * Kills any remaining processes in the cgroup first, then removes the directory.
 * Best-effort — silently ignores missing directories or permission errors.
 */
function removeCgroupLimits(sessionId: string): void {
  if (!CGROUPS_ENABLED) return;
  const cgroupPath = `${CGROUPS_ROOT}/${sessionId}`;
  try {
    // Kill any remaining processes in the cgroup before removing the directory
    try {
      const procs = fs.readFileSync(`${cgroupPath}/cgroup.procs`, 'utf-8').trim();
      if (procs) {
        for (const pidStr of procs.split('\n')) {
          const p = parseInt(pidStr, 10);
          if (p > 1) {
            try { process.kill(p, 'SIGKILL'); } catch { /* process may already be dead */ }
          }
        }
      }
    } catch {
      // cgroup.procs may not be readable
    }
    fs.rmdirSync(cgroupPath);
  } catch {
    // Directory may not exist or may not be empty
  }
}

// ============================================================
// Cleanup
// ============================================================

// Cleanup stale sessions every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes

const cleanupInterval = setInterval(async () => {
  const now = Date.now();
  // Use Array.from to avoid concurrent modification issues
  for (const [id, session] of Array.from(sessions.entries())) {
    if (now - session.createdAt > MAX_SESSION_AGE || session.exited) {
      await cleanupSession(id, session);
    }
  }
}, CLEANUP_INTERVAL);

// Cleanup orphaned R2 mounts on module load (recover from previous crashes)
cleanupOrphanedR2Mounts().catch((err) => {
  logger.warn('[Local PTY] Failed to clean up orphaned R2 mounts on startup', { error: err.message });
});

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    for (const [id, session] of Array.from(sessions.entries())) {
      try {
        if (session.r2MountStrategy === 'host') {
          unmountR2FromHost(session.userId).catch(() => {});
        }
        session.pty.kill();
      } catch { /* ignore */ }
      // Also close SSH clients for Oracle VM sessions
      if (session.sshClient) {
        try { session.sshClient.end(); } catch { /* ignore */ }
      }
    }
  });

  process.on('SIGTERM', async () => {
    clearInterval(cleanupInterval);
    // Graceful shutdown — kill all sessions and unmount R2
    const cleanupPromises: Promise<void>[] = [];
    for (const [id, session] of Array.from(sessions.entries())) {
      try {
        if (session.vfsWatcher) session.vfsWatcher.stop();
        if (session.r2MountStrategy === 'host') {
          cleanupPromises.push(unmountR2FromHost(session.userId));
        }
        if (session.sshClient) session.sshClient.end();
        session.pty.kill();
      } catch { /* ignore */ }
    }
    // Wait for all R2 unmounts to complete before exiting (with 5s timeout)
    try {
      await Promise.race([
        Promise.all(cleanupPromises),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } catch { /* best effort */ }
    process.exit(0);
  });
}

async function cleanupSession(id: string, session: LocalPtySession): Promise<void> {
  try {
    // Stop the VFS file watcher first
    if (session.vfsWatcher) {
      try {
        session.vfsWatcher.stop();
      } catch {
        // Ignore watcher cleanup errors
      }
    }

    // Clean up workspace services created by this session's daemon commands
    try {
      const { workspaceServiceManager } = await import('@/lib/terminal/workspace-service-manager');
      workspaceServiceManager.clearWorkspace(id);
    } catch { /* service manager may not be available */ }

    // Clean up cgroups v2 resource limits
    removeCgroupLimits(id);

    // Unmount R2 from host if this was a host-mounted R2 Docker session
    if (session.r2MountStrategy === 'host') {
      try {
        await unmountR2FromHost(session.userId);
      } catch (err: any) {
        logger.warn('[Local PTY] Failed to unmount R2 during cleanup', {
          sessionId: id,
          error: err.message,
        });
      }
    }

    // Close SSH client for Oracle VM sessions (also kills the pseudo-PTY)
    if (session.sshClient) {
      // If Oracle podman/docker isolation, clean up the remote container first
      if ((session.oracleIsolation === 'podman' || session.oracleIsolation === 'docker') && session.oracleContainerName) {
        try {
          const { execFile } = await import('child_process');
          // SSH exec to remove the remote Docker container
          // We use the same SSH client that's already connected
          await new Promise<void>((resolveC) => {
            // Use podman rm or docker rm depending on isolation mode
            const rmCmd = session.oracleIsolation === 'podman'
              ? `podman rm -f ${session.oracleContainerName} 2>/dev/null || true`
              : `docker rm -f ${session.oracleContainerName} 2>/dev/null || true`;
            session.sshClient.exec(rmCmd, () => resolveC());
          });
        } catch { /* best effort remote cleanup */ }
      }
      try {
        session.sshClient.end();
      } catch {
        // Ignore SSH cleanup errors
      }
    } else if (session.dockerContainerId) {
      await cleanupDockerContainer(session.dockerContainerId);
    } else if (session.unsharePid) {
      // Kill the unshare process tree
      try {
        const { exec } = await import('child_process');
        await new Promise<void>((resolve) => {
          exec(`kill -9 -${session.unsharePid} 2>/dev/null || kill -9 ${session.unsharePid} 2>/dev/null || true`, () => resolve());
        });
      } catch {
        // Ignore
      }
    } else {
      session.pty.kill();
    }
  } catch (err) {
    logger.warn(`[Local PTY] Session ${id} cleanup error:`, err instanceof Error ? err.message : err);
  }
  sessions.delete(id);
}

async function cleanupDockerContainer(containerId: string): Promise<void> {
  const { execFile } = await import('child_process');
  return new Promise<void>((resolve) => {
    // SECURITY: Use execFile (not exec) to prevent command injection
    execFile('docker', ['rm', '-f', containerId], { timeout: 10000 }, (err) => {
      if (err) {
        logger.warn(`[Local PTY] Docker cleanup failed ${containerId}:`, err.message);
      }
      resolve();
    });
  });
}

// ============================================================
// Helper: Resolve virtual workspace paths to real filesystem paths
// ============================================================

/**
 * Resolve the VFS workspace directory for a user.
 * If the workspace hasn't been materialized yet, materialize it now.
 * Otherwise, return the existing materialized directory.
 */
async function resolveWorkspaceDir(userId: string): Promise<string> {
  return materializeWorkspace(userId);
}

// ============================================================
// Helper: Validate terminal dimensions
// ============================================================

function validateDimensions(cols: number, rows: number): { cols: number; rows: number } | null {
  // Reject raw values outside allowed range BEFORE clamping.
  // Without this, cols=0 / rows=0 gets clamped to MIN and passes validation.
  if (isNaN(cols) || isNaN(rows) || cols < MIN_COLS || rows < MIN_ROWS ||
      cols > MAX_COLS || rows > MAX_ROWS) {
    return null;
  }
  const c = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(cols)));
  const r = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(rows)));
  return { cols: c, rows: r };
}

// ============================================================
// Helper: Count active sessions for user
// ============================================================

function getUserSessionCount(userId: string): number {
  // Copy values to array to avoid concurrent modification during cleanup
  let count = 0;
  for (const session of Array.from(sessions.values())) {
    if (session.userId === userId && !session.exited) count++;
  }
  return count;
}

// ============================================================
// Helper: Sanitize environment variables (remove secrets)
// ============================================================

/**
 * Build a sanitized environment for the PTY session.
 * - Removes secrets and sensitive variables
 * - Masks the real filesystem path (shows 'workspace/' instead)
 * - Sets custom shell prompt with masked path
 */
function getSafeEnv(workspaceDir: string): Record<string, string> {
  const cleanEnv: Record<string, string> = {};
  // Match full secret-like variable names, avoiding false positives
  // like PRIMARY_KEY, CACHE_KEY, etc.
  const secretPatterns = [
    /^.*_SECRET$/,
    /^.*_SECRET_.*$/,         // AWS_SECRET_ACCESS_KEY, STRIPE_SECRET_KEY, etc.
    /^.*_API_KEY$/,
    /^.*_TOKEN$/,
    /^.*_PASSWORD$/,
    /^.*_PASS$/,
    /^.*_CREDENTIAL$/,
    /^.*_AUTH_TOKEN$/,
    /^.*_AUTH_KEY$/,
    /^.*_PRIVATE_KEY$/,
    /^.*_SIGNING_KEY$/,
    /^.*_ACCESS_KEY.*$/,      // AWS_ACCESS_KEY_ID (fixed: was ^.*_ACCESS_KEY$ missing _ID)
    /^.*_SECRET_KEY$/,        // STRIPE_SECRET_KEY
    /^DATABASE_URL$/,
    /^REDIS_URL$/,
    /^.*_ENCRYPTION_KEY$/,    // Encryption keys
    /^.*_SESSION_SECRET$/,    // Session secrets
    // Code injection vectors — these let spawned processes load arbitrary code
    /^NODE_OPTIONS$/,         // --require arbitrary modules
    /^NODE_PATH$/,            // module resolution override
    /^LD_PRELOAD$/,           // shared library injection (Linux)
    /^LD_LIBRARY_PATH$/,      // library search path (Linux)
    /^DYLD_INSERT_LIBRARIES$/, // shared library injection (macOS)
    /^DYLD_LIBRARY_PATH$/,    // library search path (macOS)
    /^PYTHONPATH$/,           // Python module search path
    /^RUBYLIB$/,              // Ruby module search path
    /^PERL5LIB$/,             // Perl module search path
    /^PERL5OPT$/,             // Perl module auto-load
    // Agent access
    /^SSH_AUTH_SOCK$/,        // grants access to user's SSH agent
    /^GPG_AGENT_INFO$/,       // grants access to GPG agent
  ];

  for (const [key, value] of Object.entries(process.env)) {
    const isSecret = secretPatterns.some(pattern => pattern.test(key));
    if (!isSecret && value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  const isWindows = process.platform === 'win32';
  // Normalize workspace dir for display (forward slashes)
  const displayPath = workspaceDir.replace(/\\/g, '/').split('/').slice(-2).join('/');

  return {
    ...cleanEnv,
    TERM: 'xterm-256color',
    // HOME: Set to workspace so tilde expansion resolves inside workspace
    HOME: workspaceDir,
    // PATH: NEVER override on Windows — PowerShell needs the system PATH
    PATH: isWindows ? (process.env.PATH || 'C:\\Windows\\System32;C:\\Windows') : (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
    // LANG: Only set on Unix; Windows PowerShell doesn't use it
    ...(isWindows ? {} : { LANG: 'en_US.UTF-8' }),
    // PATH MASKING: Set custom prompt to show 'workspace/' instead of real path
    // For bash/zsh: PS1 with literal text instead of \w (which shows real cwd)
    ...(isWindows ? {} : {
      PS1: '\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ ',
    }),
  };
}

// Legacy alias for backward compatibility
function getCleanEnv(): Record<string, string> {
  // Fallback when workspaceDir is unknown — use minimal safe env
  const isWindows = process.platform === 'win32';
  return {
    TERM: 'xterm-256color',
    HOME: process.env.HOME || (isWindows ? (process.env.USERPROFILE || process.cwd()) : '/home/node'),
    PATH: isWindows ? (process.env.PATH || 'C:\\Windows\\System32;C:\\Windows') : (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
    ...(isWindows ? {} : { LANG: 'en_US.UTF-8' }),
  };
}

// ============================================================
// POST — Create a new local PTY session
// ============================================================

export async function POST(req: NextRequest) {
  // Determine if this is a new anonymous session that needs a cookie
  const existingAnonCookie = req.cookies.get('anon-session-id')?.value;
  let anonSessionIdToSet: string | undefined;

  // Resolve auth
  let authResult = await resolveRequestAuth(req, { allowAnonymous: true });

  // If auth failed and there's no existing anon cookie, create a new anonymous identity
  // This ensures first-time visitors get a unique session ID on their first request
  if (!authResult.success && !existingAnonCookie) {
    anonSessionIdToSet = generateSecureId('anon');
    const anonId = anonSessionIdToSet.startsWith('anon_') ? anonSessionIdToSet.slice(5) : anonSessionIdToSet;
    authResult = { success: true, userId: `anon:${anonId}`, source: 'anonymous' };
  }

  // If we resolved an anonymous session and there's no existing cookie, set it
  if (!existingAnonCookie && authResult.success && authResult.source === 'anonymous') {
    if (!anonSessionIdToSet) {
      // Auth succeeded but we didn't generate one above — extract from userId
      const anonPart = authResult.userId.replace('anon:', '');
      anonSessionIdToSet = `anon_${anonPart}`;
    }
  }

  /** Add the anon-session-id cookie to a response if this is a new anonymous session. */
  const addAnonSessionCookie = (response: NextResponse): NextResponse => {
    if (anonSessionIdToSet) {
      const isSecure = process.env.NODE_ENV === 'production';
      response.headers.set(
        'set-cookie',
        `anon-session-id=${anonSessionIdToSet}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isSecure ? '; Secure' : ''}`
      );
    }
    return response;
  };

  try {
    // === Security gate ===
    const ENABLE_LOCAL_PTY = getIsolationMode();
    if (ENABLE_LOCAL_PTY === 'off') {
      return addAnonSessionCookie(NextResponse.json(
        {
          error: 'Local PTY is disabled. Use sandbox providers for terminal access.',
          mode: 'sandbox',
          hint: 'Set ENABLE_LOCAL_PTY=localhost to enable for local development',
        },
        { status: 503 }
      ));
    }

    // Localhost-only mode
    if (ENABLE_LOCAL_PTY === 'localhost') {
      const origin = req.headers.get('origin') || req.headers.get('host') || '';
      if (!origin.includes('localhost') && !origin.includes('127.0.0.1') && !origin.includes('::1')) {
        return addAnonSessionCookie(NextResponse.json(
          { error: 'Local PTY is only available from localhost', mode: 'sandbox' },
          { status: 503 }
        ));
      }
    }

    // Resolve auth (already done above, just validate)
    if (!authResult.success || !authResult.userId) {
      return addAnonSessionCookie(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    // Parse body — SECURITY: limit body size to prevent memory exhaustion
    const MAX_BODY_SIZE = 64 * 1024; // 64KB
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return addAnonSessionCookie(NextResponse.json(
        { error: 'Request body too large', mode: 'sandbox' },
        { status: 413 }
      ));
    }
    const body = await req.json().catch(() => ({}));
    const { cols: rawCols = 80, rows: rawRows = 24, cwd, shell, checkOnly } = body;

    // Validate dimensions
    const dims = validateDimensions(rawCols, rawRows);
    if (!dims) {
      return addAnonSessionCookie(NextResponse.json(
        { error: `Invalid dimensions: cols=${rawCols}, rows=${rawRows}. Must be cols:[${MIN_COLS}-${MAX_COLS}], rows:[${MIN_ROWS}-${MAX_ROWS}]` },
        { status: 400 }
      ));
    }
    const { cols, rows } = dims;

    // Check-only mode: just verify node-pty is available
    if (checkOnly) {
      try {
        await import('node-pty');
        return addAnonSessionCookie(NextResponse.json({ available: true, mode: getIsolationMode() }));
      } catch {
        return addAnonSessionCookie(NextResponse.json({ available: false, mode: getIsolationMode() }, { status: 503 }));
      }
    }

    // Check session limit
    const userSessionCount = getUserSessionCount(authResult.userId);
    if (userSessionCount >= MAX_SESSIONS_PER_USER) {
      return addAnonSessionCookie(NextResponse.json(
        {
          error: `Too many PTY sessions (${userSessionCount}/${MAX_SESSIONS_PER_USER}). Close existing sessions first.`,
          mode: 'sandbox',
        },
        { status: 429 }
      ));
    }

    // Import node-pty
    let nodePty: typeof import('node-pty');
    try {
      nodePty = await import('node-pty');
    } catch {
      return addAnonSessionCookie(NextResponse.json(
        {
          error: 'node-pty not installed',
          hint: 'Run: npm install node-pty',
          mode: 'sandbox',
        },
        { status: 503 }
      ));
    }

    // Determine shell — SECURITY: validate against allowlist to prevent arbitrary binary execution
    const ALLOWED_SHELLS: string[] = process.platform === 'win32'
      ? ['powershell.exe', 'cmd.exe', 'pwsh.exe', 'pwsh']
      : ['/bin/bash', '/bin/sh', '/bin/zsh', '/bin/fish', '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish'];
    const defaultShell = process.platform === 'win32'
      ? 'powershell.exe'
      : (process.env.SHELL && process.env.SHELL.length > 0) ? process.env.SHELL : '/bin/bash';
    let ptyShell = defaultShell;
    if (shell && shell.length > 0) {
      const resolvedShell = path.isAbsolute(shell) ? shell : path.resolve('/usr/bin', shell);
      if (!ALLOWED_SHELLS.includes(resolvedShell) && !ALLOWED_SHELLS.includes(shell)) {
        return addAnonSessionCookie(NextResponse.json(
          { error: `Shell not allowed: '${shell}'. Allowed: ${ALLOWED_SHELLS.join(', ')}` },
          { status: 400 }
        ));
      }
      ptyShell = shell;
    }
    const sessionId = randomUUID();

    // Resolve authoritative VFS owner from the request — threaded into
    // the session + execution router so the affinity binding carries the
    // authoritative ownerId instead of falling back to the session lookup.
    // Safe to call for anonymous users (returns `anon:<sessionId>` ownerId).
    // When this throws (e.g. DB unavailable), the orchestrator's session
    // lookup will fall back to `authResult.userId` as before.
    // Bug #4 (audit): Attempt to resolve the filesystem owner. If it fails
    // (e.g., OPFS mid-switch), check the workspace-switch grace window: if a
    // switch for this session happened within the last 30s, use the new ownerId
    // from the grace window so the PTY creation doesn't get a 400 mismatch.
    let ownerResolution: FilesystemOwnerResolution;
    try {
      ownerResolution = await resolveFilesystemOwner(req);
      // Record the switch if ownerId changed from the last known value.
      // Use the session cookie / auth header as the key so we track per-session.
      const sessionKey = authResult.userId;
      if (sessionKey) {
        const prevSwitch = workspaceSwitchTimestamps.get(sessionKey);
        if (prevSwitch && prevSwitch.newOwnerId !== ownerResolution.ownerId) {
          // OwnerId changed — update the grace window.
          workspaceSwitchTimestamps.set(sessionKey, {
            newOwnerId: ownerResolution.ownerId,
            switchedAt: Date.now(),
          });
          logger.info('[Local PTY] Workspace switch detected for session', {
            sessionKey,
            previousOwnerId: prevSwitch.newOwnerId,
            newOwnerId: ownerResolution.ownerId,
          });
        } else if (!prevSwitch) {
          // First resolution for this session — seed the cache.
          workspaceSwitchTimestamps.set(sessionKey, {
            newOwnerId: ownerResolution.ownerId,
            switchedAt: Date.now(),
          });
        }
      }
    } catch (ownerResolutionError: any) {
      // resolveFilesystemOwner failed — check the grace window for a recent
      // workspace switch. If found, use the ownerId from the grace window
      // so the PTY creation doesn't fault with 400.
      const sessionKey = authResult.userId;
      const graceEntry = sessionKey ? workspaceSwitchTimestamps.get(sessionKey) : undefined;
      if (graceEntry && (Date.now() - graceEntry.switchedAt) < WORKSPACE_SWITCH_GRACE_WINDOW_MS) {
        logger.warn('[Local PTY] resolveFilesystemOwner failed, using grace-window ownerId', {
          sessionKey,
          graceOwnerId: graceEntry.newOwnerId,
          error: ownerResolutionError?.message,
        });
        ownerResolution = {
          ownerId: graceEntry.newOwnerId,
          source: 'anonymous',
          isAuthenticated: false,
          anonSessionId: undefined,
        } as unknown as FilesystemOwnerResolution;
      } else {
        throw ownerResolutionError;
      }
    }

    // Purge stale entries from the grace-window Map (entries older than 2× the grace window)
    const now = Date.now();
    for (const [key, entry] of workspaceSwitchTimestamps) {
      if (now - entry.switchedAt > WORKSPACE_SWITCH_GRACE_WINDOW_MS * 2) {
        workspaceSwitchTimestamps.delete(key);
      }
    }

    // === Isolation mode: unshare (Linux user namespaces) ===
    if (ENABLE_LOCAL_PTY === 'unshare') {
      return addAnonSessionCookie(await createUnsharePtySession(
        nodePty,
        sessionId,
        authResult.userId,
        cols,
        rows,
        cwd,
        ptyShell,
        ownerResolution
      ));
    }

    // === Isolation mode: Oracle VM (SSH-based PTY) ===
    if (ENABLE_LOCAL_PTY === 'oracle-vm') {
      return addAnonSessionCookie(await createOracleVMPtySession(
        sessionId,
        authResult.userId,
        cols,
        rows,
        ptyShell,
        ownerResolution
      ));
    }

    // === Isolation mode: R2 Docker (s3fs-fuse mount, no VFS sync) ===
    if (ENABLE_LOCAL_PTY === 'r2-docker') {
      return addAnonSessionCookie(await createR2DockerPtySession(
        sessionId,
        authResult.userId,
        cols,
        rows,
        ptyShell,
        ownerResolution
      ));
    }

    // === Isolation mode: Docker ===
    if (ENABLE_LOCAL_PTY === 'docker') {
      return addAnonSessionCookie(await createDockerPtySession(
        nodePty,
        sessionId,
        authResult.userId,
        cols,
        rows,
        cwd,
        ptyShell,
        ownerResolution
      ));
    }

    // === Hardened localhost mode: try unshare first, fall back to direct spawn ===
    // Bug #88: The old "localhost" mode spawned PTY directly on the host with zero
    // filesystem isolation — `cd ../` traversed the entire VM. Now we attempt
    // Linux user/mount/PID namespace isolation first (same as `unshare` mode).
    // If unshare is unavailable (macOS, missing binary, kernel restriction),
    // we fall back to direct spawn with a security warning.
    if (ENABLE_LOCAL_PTY === 'localhost') {
      if (process.platform === 'linux') {
        // Try unshare — returns NextResponse (200 on success, 503 on failure)
        const unshareResult = await createUnsharePtySession(
          nodePty,
          sessionId,
          authResult.userId,
          cols,
          rows,
          cwd,
          ptyShell,
          ownerResolution,
        );
        // If unshare succeeded (200), return it
        if (unshareResult.status === 200) {
          return addAnonSessionCookie(unshareResult);
        }
        // Unshare failed — log and fall through to direct spawn
        logger.warn('[Local PTY] Unshare unavailable in localhost mode, falling back to direct spawn', {
          unshareStatus: unshareResult.status,
          hint: 'Enable unprivileged user namespaces: sysctl kernel.unprivileged_userns_clone=1',
        });
      }
      // Fall through to direct spawn (non-Linux or unshare failed)
    }

    // === Direct spawn mode (dev only) ===
    return addAnonSessionCookie(await createDirectPtySession(
      nodePty,
      sessionId,
      authResult.userId,
      cols,
      rows,
      cwd,
      ptyShell,
      ownerResolution
    ));
  } catch (error: any) {
    logger.error('[Local PTY] Failed to create session:', error);
    return addAnonSessionCookie(NextResponse.json(
      { error: 'Failed to create PTY session', details: error.message },
      { status: 500 }
    ));
  }
}

// ============================================================
// R2 Docker Container Isolation (s3fs-fuse, zero VFS sync)
// ============================================================

/**
 * Create a PTY session in a Docker container with R2 mounted as /workspace.
 *
 * This is the recommended mode for production terminal use:
 * - Files are stored directly in Cloudflare R2 (no VFS sync layer)
 * - No materialization, no polling, no double-write
 * - The filesystem IS the storage — instant consistency
 * - Container has FUSE support for s3fs mount
 * - Falls back to VFS-based Docker mode if R2 is unavailable
 */
async function createR2DockerPtySession(
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  ptyShell: string,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  const { spawn } = await import('child_process');

  // Check if R2 is available — fall back to VFS Docker mode if not
  const r2Available = await isR2FuseAvailable();
  if (!r2Available) {
    logger.warn('[Local PTY] R2 FUSE mount unavailable, falling back to VFS Docker mode', {
      sessionId,
      userId: sanitizeUserId(userId),
    });
    // Fall through to VFS Docker: materialize workspace and use bind-mount
    const nodePty = await import('node-pty');
    const workspaceDir = await resolveWorkspaceDir(userId);
    const vfsWatcher = watchWorkspaceForChanges(userId);
    return createDockerPtySessionWithVfs(
      nodePty,
      sessionId,
      userId,
      cols,
      rows,
      workspaceDir,
      ptyShell,
      vfsWatcher,
      ownerResolution
    );
  }

  // Generate unique container name
  const containerName = `pty-r2-${sessionId.slice(0, 12)}`;

  // Determine the workspace path — /workspace inside container, or host path if host-mount strategy
  const workspacePath = resolveR2WorkspaceDir(userId);

  // Host-mount strategy: mount R2 on host first
  const useHostMount = process.env.R2_MOUNT_INSIDE_CONTAINER === 'false';
  let hostMountPoint: string | null = null;

  if (useHostMount) {
    try {
      hostMountPoint = await mountR2OnHost(userId);
      logger.info('[Local PTY] R2 mounted on host for Docker', {
        sessionId,
        userId: sanitizeUserId(userId),
        mountPoint: hostMountPoint,
      });
    } catch (err: any) {
      logger.error('[Local PTY] Failed to mount R2 on host, falling back to VFS Docker', {
        error: err.message,
      });
      const nodePty = await import('node-pty');
      const workspaceDir = await resolveWorkspaceDir(userId);
      const vfsWatcher = watchWorkspaceForChanges(userId);
      return createDockerPtySessionWithVfs(
        nodePty,
        sessionId,
        userId,
        cols,
        rows,
        workspaceDir,
        ptyShell,
        vfsWatcher
      );
    }
  }

  // Build Docker run arguments
  const dockerArgs = [
    'run',
    '-d',
    '--name', containerName,
    '--memory', R2_DOCKER_MEMORY,
    '--cpus', R2_DOCKER_CPU,
    '--network', 'none',          // No network access (security)
    '--rm',                        // Auto-remove on exit
    '--security-opt', 'no-new-privileges', // Prevent privilege escalation
    ...(DOCKER_SECCOMP_PROFILE ? ['--security-opt', `seccomp=${DOCKER_SECCOMP_PROFILE}`] : []),
    '-w', workspacePath,
    // No need for --cap-add SYS_ADMIN in host-mount mode
    ...(useHostMount ? [] : ['--cap-add', 'SYS_ADMIN', '--device', '/dev/fuse']),
    // R2 config as env vars (for container-side mount)
    '-e', `R2_ACCESS_KEY_ID=${process.env.R2_ACCESS_KEY_ID || ''}`,
    '-e', `R2_SECRET_ACCESS_KEY=${process.env.R2_SECRET_ACCESS_KEY || ''}`,
    '-e', `R2_ENDPOINT=${process.env.R2_ENDPOINT || ''}`,
    '-e', `R2_BUCKET=${process.env.R2_BUCKET || ''}`,
    '-e', `R2_WORKSPACE_PREFIX=users/${sanitizeUserId(userId)}/workspace/`,
    '-e', `WORKSPACE_MOUNT=${workspacePath}`,
    '-e', `SHELL=/bin/bash`,
  ];

  // Add host-side mount if using that strategy
  if (useHostMount && hostMountPoint) {
    dockerArgs.push('-v', `${hostMountPoint}:${workspacePath}:shared`);
  }

  dockerArgs.push(
    R2_DOCKER_IMAGE,
    // Keep container alive — we exec into it for the shell
    'sleep', 'infinity'
  );

  return new Promise<NextResponse>((resolve) => {
    const dockerProcess = spawn('docker', dockerArgs);
    let containerId = '';
    let dockerError = '';

    dockerProcess.stdout.on('data', (data) => {
      containerId = data.toString().trim();
    });

    dockerProcess.stderr.on('data', (data) => {
      dockerError += data.toString();
    });

    dockerProcess.on('error', (err) => {
      logger.error('[Local PTY] R2 Docker spawn error', { error: err.message });
      if (hostMountPoint) unmountR2FromHost(userId).catch(() => {});
      resolve(NextResponse.json(
        { error: 'Failed to start R2 Docker container', details: err.message, mode: 'sandbox' },
        { status: 500 }
      ));
    });

    dockerProcess.on('close', async (code) => {
      if (code !== 0 || !containerId) {
        logger.error('[Local PTY] R2 Docker container failed to start', {
          error: dockerError,
          exitCode: code,
        });
        if (hostMountPoint) await unmountR2FromHost(userId).catch(() => {});
        resolve(NextResponse.json(
          { error: 'Failed to start R2 Docker container', details: dockerError || `Exit code: ${code}`, mode: 'sandbox' },
          { status: 500 }
        ));
        return;
      }

      logger.info('[Local PTY] R2 Docker container started', { containerId, sessionId });

      // Wait for container to be ready
      if (!useHostMount) {
        // Container-side mount: run the init script to mount R2
        await runR2InitScript(containerId, sessionId);
      }

      // Verify workspace is ready
      const ready = await waitForContainerReady(containerId, workspacePath, 15);
      if (!ready) {
        logger.error('[Local PTY] R2 Docker container never became ready', { containerId });
        try { await cleanupDockerContainer(containerId); } catch { /* ignore */ }
        if (hostMountPoint) await unmountR2FromHost(userId).catch(() => {});
        resolve(NextResponse.json(
          { error: 'R2 Docker container failed to initialize workspace', mode: 'sandbox' },
          { status: 500 }
        ));
        return;
      }

      // Now use node-pty to exec bash into the container
      const nodePty = await import('node-pty');
      const safeCols = Math.max(1, Math.min(cols, 500));
      const safeRows = Math.max(1, Math.min(rows, 200));

      const pty = nodePty.spawn('docker', [
        'exec', '-i', containerId,
        '/bin/bash', '-i',
      ], {
        name: 'xterm-256color',
        cols: safeCols,
        rows: safeRows,
        cwd: workspacePath,
        env: {
          TERM: 'xterm-256color',
          HOME: workspacePath,
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          LANG: 'en_US.UTF-8',
          PS1: '\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ ',
        },
      });

      registerSession(sessionId, userId, pty, workspacePath, {
        dockerContainerId: containerId,
        r2MountStrategy: useHostMount ? 'host' : 'container',
        // No VFS watcher — R2 IS the storage, no sync needed
        ...(ownerResolution && { ownerResolution }),
      });

      // Note: R2 unmount on cleanup is handled by cleanupSession()
      // via the r2MountStrategy field — no monkey-patching needed.

      logger.info('[Local PTY] R2 Docker session created', {
        sessionId,
        userId: sanitizeUserId(userId),
        containerId,
        mountStrategy: useHostMount ? 'host' : 'container',
      });

      resolve(NextResponse.json({
        sessionId,
        mode: 'r2-docker',
        workspaceDir: workspacePath,
        storage: 'r2',
        mountStrategy: useHostMount ? 'host' : 'container',
      }));
    });
  });
}

/**
 * Run the R2 init script inside the container to mount R2 via s3fs.
 * Only used when MOUNT_INSIDE_CONTAINER=true (container mounts R2 itself).
 */
async function runR2InitScript(containerId: string, sessionId: string): Promise<void> {
  const { execFile } = await import('child_process');
  const initScript = buildR2ContainerInitScript();

  return new Promise<void>((resolve) => {
    // Write the init script to a temp file and pipe it into the container
    execFile('docker', [
      'exec', '-i', containerId,
      '/bin/bash', '-c', initScript,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        logger.warn('[Local PTY] R2 init script had errors', {
          containerId,
          sessionId,
          error: err.message,
          stderr: stderr?.slice(0, 500),
        });
      } else {
        logger.info('[Local PTY] R2 init script completed', { containerId, sessionId });
      }
      resolve();
    });
  });
}

/**
 * Wait for the container to become ready (filesystem mounted, shell available).
 */
async function waitForContainerReady(
  containerId: string,
  workspacePath: string,
  maxAttempts: number = 15
): Promise<boolean> {
  const { execFile } = await import('child_process');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('docker', [
          'exec', containerId,
          'test', '-d', workspacePath,
          '-a', '-w', workspacePath,
        ], { timeout: 5000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500 + attempt * 200));
    }
  }
  return false;
}

/**
 * Fallback: create a Docker PTY session using the VFS materialization approach.
 * Used when R2 is unavailable or the R2 Docker mode fails to initialize.
 */
async function createDockerPtySessionWithVfs(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  workspaceDir: string,
  ptyShell: string,
  vfsWatcher: { stop: () => void },
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  const { spawn } = await import('child_process');
  const containerName = `pty-${sessionId.slice(0, 12)}`;

  const dockerProcess = spawn('docker', [
    'run', '-d',
    '--name', containerName,
    '--memory', DOCKER_MEMORY,
    '--cpus', DOCKER_CPU,
    '--network', 'none',
    '--rm',
    '-v', `${workspaceDir}:/workspace`,
    '-w', '/workspace',
    DOCKER_IMAGE,
    'sleep', 'infinity',
  ]);

  return new Promise<NextResponse>((resolve) => {
    let containerId = '';
    let dockerError = '';

    dockerProcess.stdout.on('data', (data) => { containerId = data.toString().trim(); });
    dockerProcess.stderr.on('data', (data) => { dockerError += data.toString(); });

    dockerProcess.on('error', (err) => {
      vfsWatcher.stop();
      resolve(NextResponse.json(
        { error: 'Failed to start Docker container', details: err.message, mode: 'sandbox' },
        { status: 500 }
      ));
    });

    dockerProcess.on('close', async (code) => {
      if (code !== 0 || !containerId) {
        vfsWatcher.stop();
        resolve(NextResponse.json(
          { error: 'Failed to start Docker container', details: dockerError || `Exit code: ${code}`, mode: 'sandbox' },
          { status: 500 }
        ));
        return;
      }

      const ready = await waitForContainerReady(containerId, '/workspace', 10);
      if (!ready) {
        try { await cleanupDockerContainer(containerId); } catch { /* ignore */ }
        vfsWatcher.stop();
        resolve(NextResponse.json(
          { error: 'Docker container failed to initialize', mode: 'sandbox' },
          { status: 500 }
        ));
        return;
      }

      const safeCols = Math.max(1, Math.min(cols, 500));
      const safeRows = Math.max(1, Math.min(rows, 200));

      const pty = nodePty.spawn('docker', [
        'exec', '-i', containerId,
        'bash', '-i',
      ], {
        name: 'xterm-256color',
        cols: safeCols,
        rows: safeRows,
        cwd: '/workspace',
        env: {
          TERM: 'xterm-256color',
          HOME: '/workspace',
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          LANG: 'en_US.UTF-8',
          PS1: '\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ ',
        },
      });

      registerSession(sessionId, userId, pty, workspaceDir, {
        dockerContainerId: containerId,
        vfsWatcher,
        ...(ownerResolution && { ownerResolution }),
      });

      resolve(NextResponse.json({ sessionId, mode: 'docker', workspaceDir }));
    });
  });
}

// ============================================================
// Direct Spawn (dev mode, no isolation)
// ============================================================

async function createDirectPtySession(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  cwd: string | undefined,
  ptyShell: string,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  // Materialize VFS files to a real directory for this user
  const workspaceDir = await resolveWorkspaceDir(userId);

  // Verify the workspace directory exists before spawning
  const fs = await import('fs/promises');
  const path = await import('path');
  try {
    await fs.access(workspaceDir);
  } catch {
    // Directory doesn't exist — create it
    await fs.mkdir(workspaceDir, { recursive: true });
    logger.info('[Local PTY] Created workspace directory', { workspaceDir });
  }

  // Start VFS file watcher to sync changes from the shell back to the database
  const vfsWatcher = watchWorkspaceForChanges(userId);

  // node-pty requires minimum dimensions of 1x1 on Windows (conpty requirement)
  // and sensible max values to prevent memory issues
  const safeCols = Math.max(1, Math.min(cols, 500));
  const safeRows = Math.max(1, Math.min(rows, 200));

  // PATH TRAVERSAL PREVENTION: Safe PowerShell profile (Windows only, null on Unix)
  const safeShell = await createSafeShellWrapper(workspaceDir, ptyShell);

  // === Workspace Env Injection ===
  // Load workspace-scoped environment variables from the runtime service
  // and inject them into the shell init script so exports survive reconnects.
  // CRITICAL: `runtime.buildShellInitScript()` returns a FIXED BASH-syntax
  // string (`export VAR="value"`). We must re-translate for the target shell
  // via `translateRuntimeEnvScript` so fish/nu don't choke at parse time when
  // sourcing `.workspace_env`. See /opt/bing/.tickets/OUTERCATCH-PROD-REACHABILITY.md
  // for the closure rationale.
  let workspaceEnvScript = '';
  try {
    const runtime = getWorkspaceRuntime(sessionId, userId);
    workspaceEnvScript = runtime.buildShellInitScript();
  } catch (err: any) {
    logger.warn('[Local PTY] Failed to load workspace env', {
      sessionId,
      error: err.message,
    });
  }

  // Read `targetShellBasename` from `safeShell.shellBasename` (single source
  // of truth — createSafeShellWrapper hoisted getShellBasename into its
  // return shape, SHOULDCONSIDER b). If the wrapper failed (safeShell is
  // null), fall back to a direct derivation so the env-emit downstream
  // still has a value to dispatch against.
  const targetShellBasename = safeShell?.shellBasename ?? getShellBasename(ptyShell);

  // If we have workspace env vars, inject them by writing a .workspace_env file
  // and appending a shell-correct source command to the safe shell init script.
  if (workspaceEnvScript) {
    try {
      const envFilePath = path.join(workspaceDir, '.workspace_env');
      // Re-translate the bash-syntax runtime script for the target shell via
      // translateRuntimeEnvScript (uses getEnvExportSyntax under the hood).
      // Malformed `export` lines (non-canonical forms from a runtime change)
      // are FAIL-LOUD: dropped from output + recorded in `malformed[]` + logged
      // as a warning so the source of corruption is traceable. This prevents
      // a latent regression vector for OUTERCATCH-PROD-REACHABILITY.
      const {
        content: translatedEnv,
        count: envCount,
        malformed,
      } = translateRuntimeEnvScript(workspaceEnvScript, targetShellBasename, logger);
      await fs.writeFile(envFilePath, translatedEnv + '\n', { mode: 0o600 });

      // Append sourcing to the safe shell init script if it exists.
      // Use getSourceSyntax so fish gets `source "..."`, sh/dash/ash gets
      // `. "..."`, bash/zsh/nu get `source "..."` — all syntactically correct
      // for the target. (Previously this was hardcoded to POSIX-sh `.`,
      // which fish tolerates for the source command itself but the file
      // CONTENT was still bash-typed export lines that triggered the parse fail.)
      //
      // Per-shellBasename filename — closes the cross-shell-contamination bug
      // where a fish env-emit appended env-exports to a bash wrapper inherited
      // from a prior shell session. `targetShellBasename` flows from `safeShell`
      // (read via the return shape of `createSafeShellWrapper`); we fall back
      // to `getShellBasename(ptyShell)` so the env-emit region remains keyed
      // by the target shell's basename even when `safeShell` is null.
      const initScriptPath = getSafeShellWrapperPath(
        workspaceDir,
        targetShellBasename,
        false,
      );
      try {
        await fs.access(initScriptPath);
        await fs.appendFile(
          initScriptPath,
          `\n# Source workspace environment variables\n${getSourceSyntax(targetShellBasename, envFilePath)}\n`,
        );
      } catch {
        // Init script doesn't exist (Windows PowerShell) — env will be in PTY env vars instead
      }

      logger.debug('[Local PTY] Injected workspace env vars into shell init', {
        sessionId,
        count: envCount,
        malformed: malformed.length,
        // Surface the actual lines in debug mode so regression triage can
        // see which runtime-emitted lines were dropped at translation.
        ...(malformed.length > 0 ? { malformedSample: malformed.slice(0, 3) } : {}),
      });
    } catch (err: any) {
      logger.warn('[Local PTY] Failed to write workspace env file', {
        error: err.message,
      });
    }
  }

  logger.info('[Local PTY] Spawning PTY process', {
    shell: safeShell?.cmd ?? ptyShell,
    args: safeShell?.args ?? [],
    cols: safeCols,
    rows: safeRows,
    workspaceDir,
    platform: process.platform,
  });

  let pty: IPty;
  try {
    // Merge safe shell env overrides (e.g. ENV for sh/dash) with the sanitized env
    const mergedEnv: Record<string, string> = {
      ...getSafeEnv(workspaceDir),
      ...safeShell?.env,
    };

    pty = nodePty.spawn(
      safeShell?.cmd ?? ptyShell,
      safeShell?.args ?? [],
      {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: workspaceDir,
      env: mergedEnv,
    });
  } catch (spawnError: any) {
    // Spawn failed — stop the file watcher to avoid leaks
    vfsWatcher.stop();
    logger.error('[Local PTY] Failed to spawn shell process', {
      shell: safeShell.cmd,
      args: safeShell.args,
      error: spawnError.message,
      platform: process.platform,
    });
    return NextResponse.json(
      {
        error: `Failed to start shell: ${spawnError.message}`,
        hint: process.platform === 'win32'
          ? 'Ensure PowerShell is available.'
          : `Ensure ${ptyShell} is installed and accessible.`,
        mode: 'sandbox',
      },
      { status: 500 }
    );
  }

  // Apply cgroups v2 resource limits to direct-spawn sessions too (best-effort)
  const directPid = (pty as any).pid || (pty as any)._pid;
  if (directPid && typeof directPid === 'number') {
    applyCgroupLimits(directPid, sessionId);
  }

  registerSession(sessionId, userId, pty, workspaceDir, {
    vfsWatcher,
    ...(ownerResolution && { ownerResolution }),
  });

  return NextResponse.json({
    sessionId,
    mode: 'direct',
    workspaceDir,
    // SECURITY WARNING: Direct spawn has no isolation. The cd override is
    // a user-space bash function that provides zero kernel-level enforcement.
    // Commands like `cat /etc/passwd`, `find / -name "*.key"`, or spawning
    // a new interpreter can traverse the entire host filesystem.
    warning: process.env.NODE_ENV !== 'production'
      ? undefined
      : 'WARNING: Direct spawn mode has NO filesystem isolation. Enable unshare mode (sysctl kernel.unprivileged_userns_clone=1) or Docker mode for production.',
  });
}

// ============================================================
// Unshare (Linux user namespace isolation)
// ============================================================

/**
 * Create an unshare PTY session using the newuidmap/newgidmap wrapper
 * script. This provides proper per-workspace UID/GID isolation by
 * parsing /etc/subuid and /etc/subgid for the current user.
 *
 * Falls back to --map-root-user if subuid ranges are not configured.
 */
async function createUnsharePtySessionWithSubuid(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  workspaceDir: string,
  safeShell: NonNullable<Awaited<ReturnType<typeof createSafeShellWrapper>>>,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  // Generate the wrapper script
  const wrapperScript = buildUnshareSubuidWrapperScript(
    sessionId,
    safeShell.cmd,
    safeShell.args,
  );

  // Write to a temp file in the workspace
  const wrapperDir = path.join(workspaceDir, '.binG-temp');
  const wrapperPath = path.join(wrapperDir, '_unshare_subuid_wrapper.sh');
  try {
    await fs.promises.mkdir(wrapperDir, { recursive: true });
    await fs.promises.writeFile(wrapperPath, wrapperScript, { mode: 0o755 });
  } catch (err: any) {
    logger.error('[Local PTY] Failed to write unshare subuid wrapper', { error: err.message });
    return NextResponse.json(
      { error: 'Failed to create namespace wrapper', mode: 'sandbox' },
      { status: 500 },
    );
  }

  try {
    const safeCols = Math.max(1, Math.min(cols, 500));
    const safeRows = Math.max(1, Math.min(rows, 200));

    // Spawn the wrapper script via bash (it handles the namespace + newuidmap internally)
    const pty = nodePty.spawn('/bin/bash', [wrapperPath], {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: workspaceDir,
      env: getSafeEnv(workspaceDir),
    });

    // Get the PID of the bash wrapper for cleanup
    const unsharePid = (pty as any).pid || (pty as any)._pid;

    // Apply cgroups v2 resource limits (best-effort)
    if (unsharePid && typeof unsharePid === 'number') {
      applyCgroupLimits(unsharePid, sessionId);
    }      registerSession(sessionId, userId, pty, workspaceDir, { unsharePid, ...(ownerResolution && { ownerResolution }) });

    logger.info('[Local PTY] Unshare session created with subuid isolation', {
      sessionId,
      userId: userId.slice(0, 20),
    });

    return NextResponse.json({ sessionId, mode: 'unshare', workspaceDir });
  } catch (error: any) {
    // Clean up wrapper script on failure
    try { await fs.promises.unlink(wrapperPath); } catch { /* best-effort */ }

    if (error.message?.includes('ENOENT') || error.message?.includes('unshare')) {
      return NextResponse.json(
        {
          error: 'unshare command not found or not permitted',
          hint: 'Install util-linux package or enable unprivileged user namespaces: sysctl kernel.unprivileged_userns_clone=1',
          mode: 'sandbox',
        },
        { status: 503 },
      );
    }
    if (error.message?.includes('EPERM') || error.message?.includes('Operation not permitted')) {
      return NextResponse.json(
        {
          error: 'unshare user mapping failed — check /etc/subuid configuration',
          hint: 'Per-workspace UID isolation requires /etc/subuid and /etc/subgid entries (e.g., "user:100000:65536"). Set PTY_UNSHARE_PER_WORKSPACE_UID=false to disable.',
          mode: 'sandbox',
        },
        { status: 503 },
      );
    }
    throw error;
  }
}

async function createUnsharePtySession(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  cwd: string | undefined,
  ptyShell: string,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  if (process.platform !== 'linux') {
    return NextResponse.json(
      {
        error: 'User namespace isolation requires Linux',
        hint: 'Set ENABLE_LOCAL_PTY=on or use Docker mode instead',
        mode: 'sandbox',
      },
      { status: 503 }
    );
  }

  // Use unshare to create a new user namespace
  // --user: new user namespace
  // --map-root-user: map current user to root in new namespace
  // --mount: new mount namespace (isolated filesystem view)
  // --pid: new PID namespace (can't see other processes)
  // --fork: required for PID namespace with unshare
  const workspaceDir = await resolveWorkspaceDir(userId);

  // PATH TRAVERSAL PREVENTION: Create safe shell wrapper that overrides cd
  const safeShell = await createSafeShellWrapper(workspaceDir, ptyShell);

  // When per-workspace UID is enabled, use a wrapper script that properly
  // creates the namespace via newuidmap/newgidmap with /etc/subuid ranges.
  // Otherwise, use unshare --map-root-user directly (existing behavior).
  if (UNSHARE_PER_WORKSPACE_UID) {
    return createUnsharePtySessionWithSubuid(
      nodePty, sessionId, userId, cols, rows, workspaceDir, safeShell, ownerResolution
    );
  }

  const unshareArgs = [
    '--user',
    '--map-root-user',
    '--mount',
    '--pid',
    '--fork',
    '--mount-proc', // Mount a new proc filesystem in the new namespace
    safeShell.cmd,
    ...safeShell.args,
  ];

  try {
    const safeCols = Math.max(1, Math.min(cols, 500));
    const safeRows = Math.max(1, Math.min(rows, 200));
    const pty = nodePty.spawn('unshare', unshareArgs, {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: workspaceDir,
      env: getSafeEnv(workspaceDir),
    });

    // Get the PID of the unshare process for cleanup
    const unsharePid = (pty as any).pid || (pty as any)._pid;

    // Apply cgroups v2 resource limits (best-effort)
    if (unsharePid && typeof unsharePid === 'number') {
      applyCgroupLimits(unsharePid, sessionId);
    }      registerSession(sessionId, userId, pty, workspaceDir, { unsharePid, ...(ownerResolution && { ownerResolution }) });

    logger.info(`[Local PTY] Unshare session created: ${sessionId}`);

    return NextResponse.json({ sessionId, mode: 'unshare', workspaceDir });
  } catch (error: any) {
    // Check if unshare is available
    if (error.message?.includes('ENOENT') || error.message?.includes('unshare')) {
      return NextResponse.json(
        {
          error: 'unshare command not found or not permitted',
          hint: 'Install util-linux package or enable unprivileged user namespaces: sysctl kernel.unprivileged_userns_clone=1',
          mode: 'sandbox',
        },
        { status: 503 }
      );
    }
    // If user namespace creation failed with EPERM
    if (error.message?.includes('EPERM') || error.message?.includes('Operation not permitted')) {
      return NextResponse.json(
        {
          error: 'unshare user mapping failed',
          hint: 'User namespace creation requires unprivileged user namespaces (kernel.unprivileged_userns_clone=1)',
          mode: 'sandbox',
        },
        { status: 503 },
      );
    }
    throw error;
  }
}

// ============================================================
// Docker Container Isolation
// ============================================================

async function createDockerPtySession(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  cwd: string | undefined,
  ptyShell: string,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  const { spawn } = await import('child_process');

  // Materialize VFS files and set up file watching for Docker workspace too
  const workspaceDir = await resolveWorkspaceDir(userId);
  const vfsWatcher = watchWorkspaceForChanges(userId);

  // Generate a unique container name
  const containerName = `pty-${sessionId.slice(0, 12)}`;

  // Start container in detached mode
  const dockerProcess = spawn('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '--memory',
    DOCKER_MEMORY,
    '--cpus',
    DOCKER_CPU,
    '--network',
    'none', // No network access (security)
    '--rm', // Auto-remove on exit
    '--security-opt', 'no-new-privileges',
    ...(DOCKER_SECCOMP_PROFILE ? ['--security-opt', `seccomp=${DOCKER_SECCOMP_PROFILE}`] : []),
    // Mount the VFS workspace directory into the container so file changes
    // are visible to the local file watcher
    '-v', `${workspaceDir}:/workspace`,
    '-w',
    '/workspace',
    DOCKER_IMAGE,
    'sleep', 'infinity', // Keep container running, we'll exec into it
  ]);

  return new Promise<NextResponse>((resolve) => {
    let containerId = '';
    let dockerError = '';

    dockerProcess.stdout.on('data', (data) => {
      containerId = data.toString().trim();
    });

    dockerProcess.stderr.on('data', (data) => {
      dockerError += data.toString();
    });

    dockerProcess.on('error', (err) => {
      logger.error('[Local PTY] Docker spawn error:', err.message);
      resolve(
        NextResponse.json(
          {
            error: 'Failed to start Docker container',
            details: err.message,
            hint: 'Ensure Docker is running and user has permissions',
            mode: 'sandbox',
          },
          { status: 500 }
        )
      );
    });

    dockerProcess.on('close', async (code) => {
      if (code !== 0 || !containerId) {
        logger.error('[Local PTY] Docker container failed to start:', dockerError);
        resolve(
          NextResponse.json(
            {
              error: 'Failed to start Docker container',
              details: dockerError || `Exit code: ${code}`,
              hint: 'Ensure Docker is running and user has permissions',
              mode: 'sandbox',
            },
            { status: 500 }
          )
        );
        return;
      }

      logger.info(`[Local PTY] Docker container started: ${containerId}`);

      // Wait for container to be fully ready (shell may not be available immediately)
      const { execFile } = await import('child_process');
      let ready = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            // SECURITY: Use execFile (not exec/shell) to prevent command injection via containerId
            execFile('docker', ['exec', containerId, 'ls', '/workspace'], { timeout: 5000 }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          ready = true;
          break;
        } catch {
          // Container not ready yet, wait and retry
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }
      }

      if (!ready) {
        logger.error(`[Local PTY] Docker container ${containerId} never became ready`);
        // Cleanup
        try {
          await cleanupDockerContainer(containerId);
        } catch { /* ignore */ }
        vfsWatcher.stop();
        return NextResponse.json(
          {
            error: 'Docker container failed to initialize',
            hint: 'Check Docker daemon and image availability',
            mode: 'sandbox',
          },
          { status: 500 }
        );
      }

      // Now use node-pty to exec into the container
      const safeCols = Math.max(1, Math.min(cols, 500));
      const safeRows = Math.max(1, Math.min(rows, 200));

      // PATH TRAVERSAL + PATH MASKING for Docker mode:
      // Create a safe shell init script in the workspace (already bind-mounted into container)
      const dockerSafeShellPath = path.join(workspaceDir, '.binG-temp', '_safe_docker_init.sh');
      try {
        await fs.promises.mkdir(path.dirname(dockerSafeShellPath), { recursive: true });
        const dockerShellScript = `# Safe shell init inside Docker - prevent cd from escaping /workspace
WORKSPACE_ROOT="/workspace"

# Override cd builtin
cd() {
    local target="$1"
    if [ -z "$target" ]; then
        builtin cd "$WORKSPACE_ROOT"
        return $?
    fi
    local resolved
    if [[ "$target" = /* ]]; then
        resolved="$target"
    else
        resolved="$(pwd)/$target"
    fi
    resolved="$(cd "$resolved" 2>/dev/null && pwd -P)" || resolved=""
    if [ -z "$resolved" ]; then
        local check="$(pwd)/$target"
        case "$check" in
            "$WORKSPACE_ROOT"/*) builtin cd "$target"; return $? ;;
            "$WORKSPACE_ROOT") builtin cd "$target"; return $? ;;
            *) echo "cd: Path traversal blocked - must stay within workspace" >&2; return 1 ;;
        esac
    fi
    if [[ "$resolved" != "$WORKSPACE_ROOT" && "$resolved" != "$WORKSPACE_ROOT"/* ]]; then
        echo "cd: Path traversal blocked - must stay within workspace" >&2
        return 1
    fi
    builtin cd "$resolved"
}

pushd() {
    local target="$1"
    local resolved="$(cd "$target" 2>/dev/null && pwd -P)" || resolved=""
    if [[ "$resolved" != "$WORKSPACE_ROOT" && "$resolved" != "$WORKSPACE_ROOT"/* ]]; then
        echo "pushd: Path traversal blocked - must stay within workspace" >&2
        return 1
    fi
    builtin pushd "$target"
}

cd "$WORKSPACE_ROOT" 2>/dev/null || true
`;
        await fs.promises.writeFile(dockerSafeShellPath, dockerShellScript, { mode: 0o755 });
      } catch (err: any) {
        logger.warn('[Local PTY] Failed to create Docker safe shell init script', { error: err.message });
      }

      const pty = nodePty.spawn('docker', [
        'exec',
        '-i',
        containerId,
        'bash',
        '--init-file', '/workspace/.binG-temp/_safe_docker_init.sh',
        '-i',
      ], {
        name: 'xterm-256color',
        cols: safeCols,
        rows: safeRows,
        cwd: '/workspace',
        env: {
          TERM: 'xterm-256color',
          HOME: '/workspace',
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          LANG: 'en_US.UTF-8',
          // PATH MASKING: Custom PS1 to show 'workspace' instead of real path
          PS1: '\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ ',
        },
      });

      registerSession(sessionId, userId, pty, workspaceDir, {
        dockerContainerId: containerId,
        vfsWatcher,
        ...(ownerResolution && { ownerResolution }),
      });

      resolve(NextResponse.json({ sessionId, mode: 'docker', workspaceDir }));
    });
  });
}

// ============================================================
// Oracle VM (Per-User Isolated PTY via SSH)
// ============================================================

/**
 * Create a PTY session on a remote Oracle VM via SSH.
 * Uses the ssh2 library to open an interactive shell on the VM.
 */
async function createOracleVMPtySession(
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  ptyShell: string,
  ownerResolution?: FilesystemOwnerResolution,
): Promise<NextResponse> {
  const { Client } = await import('ssh2');

  const host = process.env.ORACLE_VM_HOST;
  const port = parseInt(process.env.ORACLE_VM_PORT || '22');
  const username = process.env.ORACLE_VM_USER || 'opc';
  const privateKey = process.env.ORACLE_VM_PRIVATE_KEY;
  const privateKeyPath = process.env.ORACLE_VM_KEY_PATH;

  if (!host) {
    return NextResponse.json({
      error: 'Oracle VM is not configured (ORACLE_VM_HOST not set)',
      hint: 'Set ORACLE_VM_HOST and ORACLE_VM_KEY_PATH in your environment.',
      mode: 'sandbox',
    }, { status: 503 });
  }

  const safeCols = Math.max(1, Math.min(cols, 500));
  const safeRows = Math.max(1, Math.min(rows, 200));

  // Build isolation commands for the per-user workspace
  const userWorkspace = getOracleUserWorkspace(userId);
  const podmanCmds = buildRootlessPodmanCommands(userId, sessionId);
  const bwrapCmds = buildBwrapSetupCommands(userId);
  const chrootCmds = buildChrootSetupCommands(userId);
  const dockerCmds = buildDockerOnVMCommands(userId, sessionId);
  const sharedCmds = buildSharedShellSetupCommands(userId, process.env.ORACLE_VM_WORKSPACE || '/home/opc/workspace');

  return new Promise<NextResponse>((resolve) => {
    const client = new Client();

    const connectionConfig: any = {
      host, port, username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    };

    if (privateKey) {
      connectionConfig.privateKey = privateKey;
    } else if (privateKeyPath) {
      try {
        connectionConfig.privateKey = fs.readFileSync(privateKeyPath);
      } catch (err: any) {
        logger.error('[Local PTY] Failed to read Oracle VM SSH key', { path: privateKeyPath });
        return resolve(NextResponse.json(
          { error: `Failed to read SSH key: ${err.message}`, mode: 'sandbox' },
          { status: 500 }
        ));
      }
    }

    client.on('ready', () => {
      // Run setup commands BEFORE opening the shell.
      // Heredoc to avoid shell-injection in command strings.
      const setupScript = [
        // Create per-user workspace
        `mkdir -p ${shellSafe(userWorkspace)}`,
        `chmod 700 ${shellSafe(userWorkspace)}`,
        // Try rootless podman first (offers namespace isolation + cgroup limits),
        // then bwrap, chroot, docker, shared-shell.
        `echo "=== ORACLE_VM_ISOLATION_CHECK ==="`,
        `if which podman >/dev/null 2>&1; then echo "ISOLATION=podman";`,
        `elif which bwrap >/dev/null 2>&1; then echo "ISOLATION=bwrap";`,
        `elif [ -f ${shellSafe(CHROOT_ROOTFS_TARBALL || '/opt/rootfs.tar.gz')} ]; then echo "ISOLATION=chroot";`,
        `elif which docker >/dev/null 2>&1; then echo "ISOLATION=docker";`,
        `else echo "ISOLATION=shared-shell"; fi`,
      ].join('\n');

      client.exec(setupScript, (err: any, checkStream: any) => {
        if (err) {
          client.end();
          return resolve(NextResponse.json(
            { error: `VM setup check failed: ${err.message}`, mode: 'sandbox' },
            { status: 500 }
          ));
        }

        let checkOutput = '';
        checkStream.on('data', (d: Buffer) => { checkOutput += d.toString(); });
        checkStream.stderr.on('data', () => {});
        checkStream.on('close', () => {
          // Determine isolation mode from output
          const isolMatch = checkOutput.match(/ISOLATION=(\S+)/);
          const isolation: 'podman' | 'bwrap' | 'chroot' | 'docker' | 'shared-shell' =
            (isolMatch?.[1] as any) || 'shared-shell';

          logger.info('[Local PTY] Oracle VM isolation mode', { sessionId, isolation, userId: sanitizeOracleUserId(userId) });

          // Build the final shell command based on available isolation
          let shellCmd: string;
          let workspacePath: string;
          let oracleContainerName: string | undefined;

          switch (isolation) {
            case 'podman': {
              // Run rootless Podman setup (create container with workspace bind-mount)
              const podmanSetup = podmanCmds.setupCommands.join('\n');
              client.exec(podmanSetup, () => {});
              shellCmd = podmanCmds.shellCommand;
              workspacePath = podmanCmds.workspacePath;
              oracleContainerName = `pty-podman-${sessionId.slice(0, 12)}`;
              break;
            }
            case 'bwrap':
              shellCmd = bwrapCmds.shellCommand;
              workspacePath = bwrapCmds.workspacePath;
              break;
            case 'chroot': {
              // Run chroot setup (extract rootfs, bind-mount workspace)
              const chrootSetup = chrootCmds.setupCommands.join('\n');
              client.exec(chrootSetup, () => {});
              shellCmd = chrootCmds.shellCommand;
              workspacePath = chrootCmds.workspacePath;
              break;
            }
            case 'docker': {
              // Run Docker setup (create container with workspace bind-mount)
              const dockerSetup = dockerCmds.setupCommands.join('\n');
              client.exec(dockerSetup, () => {});
              shellCmd = dockerCmds.shellCommand;
              workspacePath = dockerCmds.workspacePath;
              oracleContainerName = `pty-oracle-${sessionId.slice(0, 12)}`;
              break;
            }
            default:
              shellCmd = sharedCmds.shellCommand;
              workspacePath = sharedCmds.workspacePath;
              break;
          }

          // Open interactive PTY shell inside the isolated environment
          client.exec(shellCmd, { pty: { term: 'xterm-256color', cols: safeCols, rows: safeRows } },
            (err: any, stream: any) => {
              if (err) {
                client.end();
                logger.error('[Local PTY] Oracle VM isolated shell failed', { error: err.message });
                return resolve(NextResponse.json(
                  { error: `Failed to open isolated shell: ${err.message}`, mode: 'sandbox' },
                  { status: 500 }
                ));
              }

              const sshPty = {
                pid: 0,
                onData: (cb: (data: string) => void) => {
                  stream.on('data', (data: Buffer) => cb(data.toString()));
                },
                onExit: (cb: (info: { exitCode: number; signal?: string }) => void) => {
                  stream.on('close', (code: number) => cb({ exitCode: code }));
                },
                write: (data: string) => stream.write(data),
                resize: (c: number, r: number) => {
                  try { stream.setWindow(r, c); } catch { /* ignore */ }
                },
                kill: () => {
                  try { stream.end(); } catch { /* ignore */ }
                  try { client.end(); } catch { /* ignore */ }
                },
                waitForConnection: async () => {},
                disconnect: async () => {
                  try { stream.end(); } catch { /* ignore */ }
                  try { client.end(); } catch { /* ignore */ }
                },
                wait: async () => ({ exitCode: 0 }),
                sendInput: async (data: string) => stream.write(data),
              } as unknown as IPty;

              registerSession(sessionId, userId, sshPty, userWorkspace, {
                sshClient: client,
                oracleIsolation: isolation,
                oracleContainerName,
                ...(ownerResolution && { ownerResolution }),
                // Include isolation mode in the sandbox info so the UI can render the badge
              });

              logger.info('[Local PTY] Oracle VM isolated session created', {
                sessionId, host, username, isolation,
                userId: sanitizeOracleUserId(userId),
                cols: safeCols, rows: safeRows,
              });

              resolve(NextResponse.json({
                sessionId,
                mode: 'oracle-vm',
                workspaceDir: workspacePath,
                isolation,
              }));
            }
          );
        });
      });
    });

    client.on('error', (err: any) => {
      logger.error('[Local PTY] Oracle VM SSH connection error', { error: err.message });
      resolve(NextResponse.json(
        { error: `SSH connection failed: ${err.message}`, mode: 'sandbox' },
        { status: 500 }
      ));
    });

    client.on('close', () => {
      const session = sessions.get(sessionId);
      if (session && !session.exited) {
        session.exited = true;
        session.exitCode = 0;
      }
    });

    client.connect(connectionConfig);
  });
}

// ============================================================
// Session Registration
// ============================================================

function registerSession(
  sessionId: string,
  userId: string,
  pty: IPty,
  workspaceDir: string,
  extras: Partial<Omit<LocalPtySession, 'sessionId' | 'userId' | 'pty' | 'createdAt' | 'exited' | 'exitCode' | 'outputQueue' | 'workspaceDir'>> = {}
): void {
  // Container-level isolation modes don't need execution routing:
  //   - Podman: rootless container with full namespace + cgroup isolation
  //   - Docker/r2-docker: full container isolation via Docker daemon
  //   - Unshare: user/mount/pid namespace isolation
  // For oracle-vm with bwrap/chroot/shared-shell, execution routing is useful
  // because those modes lack resource limits or full namespace isolation.
  const containerIsolation = !!extras.dockerContainerId || extras.oracleIsolation === 'podman';
  const enableRouting = EXECUTION_ROUTING_ENABLED === true &&
    !containerIsolation && !extras.unsharePid;

  // === Execution Routing: intercept non-trivial commands ===
  // Wraps the PTY write method to buffer input until a newline, then classifies
  // the command. Trivial commands pass through to the real shell; non-trivial
  // commands (npm install, python scripts, daemons) are routed to pre-warmed
  // sandbox providers (E2B, Daytona, Sprites) via the SandboxOrchestrator.
  if (enableRouting) {
    const originalWrite = pty.write.bind(pty);
    let inputBuffer = '';
    let isRouting = false; // prevent re-entry during async routing

    const routerConfig: ExecutionRouterConfig = {
      userId,
      conversationId: sessionId,
      workingDir: workspaceDir,
      enabled: true,
      workspaceId: sessionId,
      // Authoritative VFS owner from the API route caller (POST handler resolves
      // via resolveFilesystemOwner(req)). When omitted, the orchestrator falls
      // back to the session lookup.
      ...(extras.ownerResolution ? { ownerResolution: extras.ownerResolution } : {}),
      onOutput: (text: string) => {
        // Feed sandbox output back through the session's output queue
        if (!session.exited) {
          session.outputQueue.push(text);
        }
      },
      onRoute: (message: string) => {
        // Show routing notification in the terminal
        if (!session.exited) {
          session.outputQueue.push(`\r\n${message}`);
        }
      },
    };

    pty.write = ((data: string): void => {
      if (isRouting) {
        // Buffer input while routing — don't silently drop keystrokes
        inputBuffer += data;
        return;
      }

      // Check if this write contains a newline (command submission)
      if (!data.includes('\r') && !data.includes('\n')) {
        // No newline — just buffer and pass through
        inputBuffer += data;
        originalWrite(data);
        return;
      }

      // Newline detected — split by lines to handle multi-line paste
      const lines = data.split(/\r?\n/);
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

      // Process each complete line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLastLine = i === lines.length - 1 && !data.endsWith('\n') && !data.endsWith('\r');

        if (isLastLine) {
          // Partial line — buffer it
          inputBuffer += line;
          originalWrite(line);
          continue;
        }

        inputBuffer += line;
        const command = inputBuffer.trim();
        inputBuffer = '';

        // Classify the command
        const classification = classifyCommand(command);

        // === PID Translation: intercept ps/kill/pgrep for cross-provider process management ===
        if (classification.category === 'pid-translation') {
          const baseCmd = classification.baseCommand;

          if (baseCmd === 'kill' || baseCmd === 'pkill') {
            // Resolve vPID → real PID + provider, then route kill to correct sandbox
            const parts = command.split(/\s+/);
            // Parse: kill [-SIGNAL|-9] <pid>, pkill [-SIGNAL] <pattern>
            let signal = 'SIGTERM';
            let target: string | undefined;

            for (let p = 1; p < parts.length; p++) {
              const arg = parts[p];
              if (arg.startsWith('-')) {
                const sig = arg.replace(/^-/, '');
                if (sig === '9') signal = 'SIGKILL';
                else if (sig === 'l') { /* skip -l flag */ }
                else if (/^[A-Z]/.test(sig)) signal = sig;
              } else if (/^\d+$/.test(arg)) {
                target = arg;
              } else if (baseCmd === 'pkill' && !target) {
                target = arg;
              }
            }

            if (!target) {
              // No PID/pattern — pass through to local PTY
              originalWrite(line + '\r');
              continue;
            }

            if (baseCmd === 'pkill') {
              // pkill by name: find matching vPIDs and kill them all
              const matches = virtualPidRegistry.findVpidsByCommand(sessionId, target);
              if (matches.length > 0) {
                isRouting = true;
                session.outputQueue.push(`\r\n🔍 pkill: ${matches.length} process(es) matching "${target}"\r\n`);

                Promise.all(matches.map(async (mapping) => {
                  try {
                    const killResult = await sandboxOrchestrator.executeInSandbox(
                      `${mapping.provider}:${mapping.sandboxId}`,
                      `kill -${signal} ${mapping.realPid}`,
                    );
                    if (killResult.exitCode === 0) {
                      virtualPidRegistry.unregisterProcess(sessionId, mapping.vPid);
                      session.outputQueue.push(`✓ Killed vPID ${mapping.vPid} (${mapping.command.slice(0, 40)}) [${mapping.provider}]\r\n`);
                    }
                  } catch (err: any) {
                    logger.warn('[Local PTY] pkill failed for vPID', { vPid: mapping.vPid, error: err.message });
                  }
                })).finally(() => {
                  isRouting = false;
                  originalWrite('\r');
                });
              } else {
                // No virtual PID match — pass through to local PTY
                originalWrite(line + '\r');
              }
              continue;
            }

            // kill by PID: check if it's a vPID
            const pidNum = parseInt(target, 10);
            if (isNaN(pidNum)) {
              originalWrite(line + '\r');
              continue;
            }

            const resolution = virtualPidRegistry.resolveVpid(sessionId, pidNum);

            if (resolution.resolved && resolution.realPid && resolution.provider) {
              // vPID resolved — route kill to the correct sandbox provider
              isRouting = true;
              session.outputQueue.push(
                `\r\n🔀 kill ${pidNum}: routing to ${resolution.provider} (real PID ${resolution.realPid})\r\n`
              );

              sandboxOrchestrator.executeInSandbox(
                `${resolution.provider}:${resolution.sandboxId}`,
                `kill -${signal} ${resolution.realPid}`,
              ).then((killResult) => {
                if (killResult.exitCode === 0) {
                  virtualPidRegistry.unregisterProcess(sessionId, pidNum);
                  session.outputQueue.push(
                    `✓ Killed vPID ${pidNum} (${resolution.command?.slice(0, 40) || 'unknown'}) [${resolution.provider}]\r\n`
                  );
                } else {
                  session.outputQueue.push(
                    `⚠️  kill failed (exit ${killResult.exitCode}): ${killResult.output.slice(0, 200)}\r\n`
                  );
                }
              }).catch((err: any) => {
                logger.warn('[Local PTY] Kill routing failed', { vPid: pidNum, error: err.message });
                session.outputQueue.push(`⚠️  kill routing failed: ${err.message}\r\n`);
              }).finally(() => {
                isRouting = false;
                originalWrite('\r');
              });
            } else {
              // Not a vPID — pass through to local PTY for local kill
              originalWrite(line + '\r');
            }
            continue;
          }

          // ps, pgrep, pidof: pass through to local PTY (runs locally)
          // The virtual PID registry auto-registers local processes when ps output is detected
          originalWrite(line + '\r');
          continue;
        }

        if (!classification.routeToSandbox) {
          // Trivial command — pass through to real PTY
          originalWrite(line + '\r');
          continue;
        }

        // Non-trivial command — route to sandbox provider
        isRouting = true;

        // Echo the command so the user sees what they typed
        session.outputQueue.push(`\r\n$ ${command}\r\n`);

        executeWithRouting(command, routerConfig)
          .then((result) => {
            if (result.routed) {
              const duration = result.duration > 1000
                ? `${(result.duration / 1000).toFixed(1)}s`
                : `${result.duration}ms`;
              const warmTag = result.wasPreWarmed ? ' [pre-warmed]' : '';
              session.outputQueue.push(
                `\r\n✓ ${result.provider}${warmTag} (${duration}, exit: ${result.exitCode})\r\n`
              );
            } else {
              // Sandbox unavailable — write command to real PTY as fallback
              originalWrite(line + '\r');
            }
          })
          .catch((err: any) => {
            logger.error('[Local PTY] Execution routing failed', {
              command: command.slice(0, 100),
              error: err.message,
            });
            originalWrite(line + '\r');
          })
          .finally(() => {
            isRouting = false;
            // Trigger PTY shell to re-display its prompt
            originalWrite('\r');
          });

        // Only route one command at a time; remaining lines in paste will be
        // buffered and processed after the current route completes
        if (i < lines.length - 1) {
          // Queue remaining lines for processing after routing completes
          const remaining = lines.slice(i + 1).join('\r');
          if (remaining) {
            inputBuffer += remaining;
            // We'll process them when isRouting becomes false
          }
          break;
        }
      }
    }) as IPty['write'];

    logger.info('[Local PTY] Execution routing enabled for session', {
      sessionId,
      userId: userId.slice(0, 20),
      mode: extras.oracleIsolation ? `oracle-vm/${extras.oracleIsolation}` : 'direct',
    });
  }

  const session: LocalPtySession = {
    sessionId,
    userId,
    pty,
    createdAt: Date.now(),
    exited: false,
    exitCode: undefined,
    outputQueue: [],
    workspaceDir,
    executionRouterEnabled: enableRouting,
    ...extras,
  };

  sessions.set(sessionId, session);

  // Set up output handler — queue output for SSE polling
  // No need to re-lookup session; we close over the session directly
  pty.onData((data: string) => {
    // Only queue if session still exists and hasn't exited
    if (!session.exited) {
      session.outputQueue.push(data);
    }
  });

  // Track exit state
  pty.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    logger.info(`[Local PTY] Session exited`, {
      sessionId,
      exitCode,
      signal,
      uptime: Date.now() - session.createdAt,
    });
  });
}

// ============================================================
// GET — SSE stream for PTY output
// ============================================================

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify session ownership using the anon-session-id cookie.
  // For anonymous users, the cookie IS the identity — not the resolved auth.
  const anonCookie = req.cookies.get('anon-session-id')?.value;
  const authResult = await resolveRequestAuth(req, { allowAnonymous: true });

  // Authenticated users: check userId match
  if (authResult.success && !authResult.userId.startsWith('anon:')) {
    if (session.userId !== authResult.userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: session does not belong to this user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (authResult.success && authResult.userId.startsWith('anon:')) {
    // Anonymous users: the anon-session-id cookie must match the session's userId
    const sessionAnonId = session.userId.replace(/^anon:/, '');
    const cookieAnonId = anonCookie?.replace(/^anon_?/, '') || '';
    if (sessionAnonId !== cookieAnonId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: session does not belong to this user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    // No auth resolved — if there's an anon cookie, use it
    if (anonCookie) {
      const sessionAnonId = session.userId.replace(/^anon:/, '');
      const cookieAnonId = anonCookie.replace(/^anon_?/, '');
      if (sessionAnonId !== cookieAnonId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let streamClosed = false;

      const closeStream = () => {
        if (streamClosed) return;
        streamClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      const send = (payload: object) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream closed — ignore
          streamClosed = true;
        }
      };

      // Send initial connected message with isolation mode for badge persistence
      const connectedData: Record<string, unknown> = { sessionId };
      if (session.oracleIsolation) {
        connectedData.oracleIsolation = session.oracleIsolation;
      }
      send({ type: 'connected', data: connectedData });

      // Poll for PTY output with queue
      const pollInterval = setInterval(() => {
        const s = sessions.get(sessionId);
        if (!s) {
          // Session was cleaned up — send disconnect with whatever exit code we can find
          send({ type: 'disconnected', data: { exitCode: session.exitCode ?? null } });
          clearInterval(pollInterval);
          closeStream();
          return;
        }

        // Drain output queue (type-safe, no `any` casts)
        if (s.outputQueue.length > 0) {
          const output = s.outputQueue.join('');
          s.outputQueue.splice(0, s.outputQueue.length); // Clear queue
          send({ type: 'pty', data: output });
        }

        // Check if PTY exited
        if (s.exited) {
          send({ type: 'disconnected', data: { exitCode: s.exitCode } });
          clearInterval(pollInterval);
          closeStream();
        }
      }, 30); // Poll every 30ms for lower latency

      // Cleanup on SSE close
      return () => {
        clearInterval(pollInterval);
      };
    },

    cancel() {
      // SSE stream disconnected — the poll interval is already cleared by the
      // `return()` cleanup function. DON'T kill the PTY or delete the session.
      // The PTY session persists independently of SSE streams and will be
      // cleaned up by:
      //   - The 30-minute TTL cleanup interval
      //   - The explicit close terminal action (via POST to a close endpoint)
      //   - The PTY process exiting naturally (triggers 'disconnected' message)
      //
      // This is critical for dev mode: Fast Refresh/HMR interrupts SSE connections
      // but the browser's EventSource auto-reconnects with the same sessionId.
      // The session must remain in the map for the reconnect to work.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'close',
      'X-Accel-Buffering': 'no',
    },
  });
}

