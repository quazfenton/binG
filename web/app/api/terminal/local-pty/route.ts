/**
 * Local PTY API Route (Web Mode)
 *
 * Provides real PTY terminal access on the server via node-pty.
 * Supports multiple isolation modes for security.
 *
 * Isolation modes (ENABLE_LOCAL_PTY env var):
 *   "off"       — Disabled (production default)
 *   "localhost" — Only from localhost requests
 *   "unshare"   — Linux user namespace isolation (unshare --user --map-root-user)
 *   "docker"    — Per-session Docker container isolation
 *   "on"        — Direct spawn (dev only, no isolation)
 *
 * Endpoints:
 *   POST /api/terminal/local-pty        — Create PTY session
 *   GET  /api/terminal/local-pty        — SSE output stream
 *   POST /api/terminal/local-pty/input  — Send keystrokes
 *   POST /api/terminal/local-pty/resize — Resize terminal
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import type { IPty } from 'node-pty';
import { createLogger } from '@/lib/utils/logger';
import { generateSecureId } from '@/lib/utils';
import {
  materializeWorkspace,
  watchWorkspaceForChanges,
} from '@/lib/virtual-filesystem/vfs-workspace-materializer';
import { syncFileToVfs } from '@/lib/virtual-filesystem/vfs-workspace-materializer';
import { getDatabase } from '@/lib/database/connection';

const logger = createLogger('LocalPTY');

export const runtime = 'nodejs';

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
async function createSafeShellWrapper(workspaceDir: string, shellPath: string): Promise<{ cmd: string; args: string[]; env?: Record<string, string> } | null> {
  const isWindows = process.platform === 'win32';
  const wrapperDir = path.join(workspaceDir, '.binG-temp');
  const wrapperPath = isWindows
    ? path.join(wrapperDir, '_safe_profile.ps1')
    : path.join(wrapperDir, '_safe_shell_init.sh');

  try {
    await fs.promises.mkdir(wrapperDir, { recursive: true });

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
      };
    } else {
      // Unix: Create POSIX-compatible cd override init script
      // Uses ENV variable (sh/dash/ash), --init-file (bash), or -c sourcing (zsh/fish)
      const escapedWorkspaceDir = workspaceDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const shellScript = `# Safe shell init - prevent cd from escaping workspace
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

# Override pushd — also block ~/
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

# Set initial directory
cd "$WORKSPACE_ROOT" 2>/dev/null || true
`;
      await fs.promises.writeFile(wrapperPath, shellScript, { mode: 0o755 });

      // Detect shell type and use the correct init mechanism
      const shellBasename = path.basename(shellPath).toLowerCase();
      if (shellBasename === 'bash' || shellBasename.endsWith('-bash')) {
        // bash: use --init-file
        return {
          cmd: shellPath,
          args: ['--init-file', wrapperPath, '-i'],
        };
      } else if (shellBasename === 'zsh') {
        // zsh: source the init script then exec interactive zsh
        return {
          cmd: shellPath,
          args: ['-c', `source '${wrapperPath}' && exec ${shellPath} -i`],
        };
      } else if (shellBasename === 'fish') {
        // fish: use fish's init file mechanism
        return {
          cmd: shellPath,
          args: ['--init-command', `source '${wrapperPath}'`],
        };
      } else {
        // sh/dash/ash/unknown: use ENV environment variable
        return {
          cmd: shellPath,
          args: ['-i'],
          env: { ENV: wrapperPath },
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

type IsolationMode = 'off' | 'localhost' | 'unshare' | 'docker' | 'oracle-vm' | 'on';

const ENABLE_LOCAL_PTY: IsolationMode =
  (process.env.ENABLE_LOCAL_PTY as IsolationMode) ||
  (process.env.ORACLE_VM_HOST ? 'oracle-vm' : process.env.NODE_ENV === 'production' ? 'off' : 'on');

// Docker isolation config
const DOCKER_IMAGE = process.env.LOCAL_PTY_DOCKER_IMAGE || 'node:20-slim';
const DOCKER_MEMORY = process.env.LOCAL_PTY_DOCKER_MEMORY || '512m';
const DOCKER_CPU = process.env.LOCAL_PTY_DOCKER_CPU || '1';

// Input limits
const MAX_COLS = 500;
const MAX_ROWS = 200;
const MIN_COLS = 10;
const MIN_ROWS = 5;

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

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    for (const [id, session] of Array.from(sessions.entries())) {
      try {
        session.pty.kill();
      } catch { /* ignore */ }
      // Also close SSH clients for Oracle VM sessions
      if (session.sshClient) {
        try { session.sshClient.end(); } catch { /* ignore */ }
      }
    }
  });

  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
    // Graceful shutdown — kill all sessions
    for (const [id, session] of Array.from(sessions.entries())) {
      try {
        if (session.vfsWatcher) session.vfsWatcher.stop();
        if (session.sshClient) session.sshClient.end();
        session.pty.kill();
      } catch { /* ignore */ }
    }
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

    // Close SSH client for Oracle VM sessions (also kills the pseudo-PTY)
    if (session.sshClient) {
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
    console.warn(`[Local PTY] Session ${id} cleanup error:`, err instanceof Error ? err.message : err);
  }
  sessions.delete(id);
}

async function cleanupDockerContainer(containerId: string): Promise<void> {
  const { execFile } = await import('child_process');
  return new Promise<void>((resolve) => {
    // SECURITY: Use execFile (not exec) to prevent command injection
    execFile('docker', ['rm', '-f', containerId], { timeout: 10000 }, (err) => {
      if (err) {
        console.warn(`[Local PTY] Docker cleanup failed ${containerId}:`, err.message);
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
  const c = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(cols)));
  const r = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(rows)));
  if (isNaN(c) || isNaN(r) || c < MIN_COLS || r < MIN_ROWS) {
    return null;
  }
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
        return addAnonSessionCookie(NextResponse.json({ available: true, mode: ENABLE_LOCAL_PTY }));
      } catch {
        return addAnonSessionCookie(NextResponse.json({ available: false, mode: ENABLE_LOCAL_PTY }, { status: 503 }));
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

    // === Isolation mode: unshare (Linux user namespaces) ===
    if (ENABLE_LOCAL_PTY === 'unshare') {
      return addAnonSessionCookie(await createUnsharePtySession(
        nodePty,
        sessionId,
        authResult.userId,
        cols,
        rows,
        cwd,
        ptyShell
      ));
    }

    // === Isolation mode: Oracle VM (SSH-based PTY) ===
    if (ENABLE_LOCAL_PTY === 'oracle-vm') {
      return addAnonSessionCookie(await createOracleVMPtySession(
        sessionId,
        authResult.userId,
        cols,
        rows,
        ptyShell
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
        ptyShell
      ));
    }

    // === Direct spawn mode (dev only) ===
    return addAnonSessionCookie(await createDirectPtySession(
      nodePty,
      sessionId,
      authResult.userId,
      cols,
      rows,
      cwd,
      ptyShell
    ));
  } catch (error: any) {
    console.error('[Local PTY] Failed to create session:', error);
    return addAnonSessionCookie(NextResponse.json(
      { error: 'Failed to create PTY session', details: error.message },
      { status: 500 }
    ));
  }
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
  ptyShell: string
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

  registerSession(sessionId, userId, pty, workspaceDir, {
    vfsWatcher,
  });

  return NextResponse.json({
    sessionId,
    mode: 'direct',
    workspaceDir,
    // SECURITY WARNING: Direct spawn has no isolation
    warning: process.env.NODE_ENV !== 'production'
      ? undefined
      : 'Direct spawn mode provides no process or filesystem isolation. Use Docker or unshare mode for production.',
  });
}

// ============================================================
// Unshare (Linux user namespace isolation)
// ============================================================

async function createUnsharePtySession(
  nodePty: typeof import('node-pty'),
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
  cwd: string | undefined,
  ptyShell: string
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

    registerSession(sessionId, userId, pty, workspaceDir, { unsharePid });

    console.log(`[Local PTY] Unshare session created: ${sessionId}`);

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
  ptyShell: string
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
      console.error('[Local PTY] Docker spawn error:', err.message);
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
        console.error('[Local PTY] Docker container failed to start:', dockerError);
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

      console.log(`[Local PTY] Docker container started: ${containerId}`);

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
        console.error(`[Local PTY] Docker container ${containerId} never became ready`);
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
      });

      resolve(NextResponse.json({ sessionId, mode: 'docker', workspaceDir }));
    });
  });
}

// ============================================================
// Remote VFS Sync for Oracle VM
// ============================================================

/**
 * Safely escape a string for use in a remote SSH shell command.
 * Prevents command injection via malicious filenames or workspace paths.
 */
function shellEscape(s: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  // This is the safest cross-platform shell escape method
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Poll the remote Oracle VM workspace for file changes and sync them to the VFS database.
 * Uses SSH exec commands to list files and read content.
 * Returns a stop function to cancel the sync loop.
 */
function startRemoteVfsSync(
  sshClient: any,
  userId: string,
  remoteWorkspace: string,
  sessionId: string
): { stop: () => void } {
  let stopped = false;
  let execInProgress = false; // Prevent overlapping exec calls
  const POLL_INTERVAL_MS = 5000; // Check every 5 seconds
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB limit
  const fileState = new Map<string, { size: number; mtime: string }>();

  // Validate the remote workspace path to prevent command injection
  const SAFE_PATH_RE = /^[a-zA-Z0-9_./-]+$/;
  if (!SAFE_PATH_RE.test(remoteWorkspace)) {
    logger.error('[Local PTY] Unsafe Oracle VM workspace path — VFS sync disabled', {
      remoteWorkspace,
    });
    return { stop: () => {} }; // No-op stop function
  }

  // Execute a command on the remote VM via the existing SSH client
  async function execRemote(command: string): Promise<string> {
    if (stopped || execInProgress) {
      if (execInProgress) throw new Error('SSH exec already in progress');
      throw new Error('Remote VFS sync is stopped');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('SSH exec timeout'));
      }, 30000); // 30s timeout per exec

      execInProgress = true;
      sshClient.exec(command, (err: any, stream: any) => {
        if (err) {
          clearTimeout(timeout);
          execInProgress = false;
          return reject(err);
        }
        let output = '';
        stream.on('data', (data: Buffer) => { output += data.toString(); });
        stream.stderr.on('data', () => { /* ignore stderr */ });
        stream.on('close', (code: number) => {
          clearTimeout(timeout);
          execInProgress = false;
          if (code === 0) resolve(output);
          else reject(new Error(`Remote command failed with code ${code}`));
        });
        stream.on('error', (err: any) => {
          clearTimeout(timeout);
          execInProgress = false;
          reject(err);
        });
      });
    });
  }

  async function pollRemoteChanges(): Promise<void> {
    if (stopped) return;

    try {
      // SECURITY: remoteWorkspace is validated above with SAFE_PATH_RE
      const escapedWorkspace = shellEscape(remoteWorkspace);
      // Use find + stat for portable file listing (GNU and BSD compatible)
      // Limit to 1000 files to prevent resource exhaustion on large directories
      const fileListOutput = await execRemote(
        `find ${escapedWorkspace} -type f -exec stat -c '%n\\t%s\\t%Y' {} + 2>/dev/null | head -n 1000 || true`
      );

      const currentFiles = new Map<string, { size: number; mtime: string }>();
      const newFiles: string[] = [];
      const modifiedFiles: string[] = [];

      // Parse the output — stat output is: fullPath\tsize\tmtime
      for (const line of fileListOutput.trim().split('\n').filter(Boolean)) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const fullPath = parts[0];
        const sizeStr = parts[1];
        const mtime = parts[2];
        const size = parseInt(sizeStr, 10);
        if (isNaN(size)) continue;

        // Strip the workspace prefix to get relative path
        const relPath = fullPath.startsWith(remoteWorkspace + '/')
          ? fullPath.slice(remoteWorkspace.length + 1)
          : fullPath;

        // SECURITY: Validate relative path — reject traversal attempts
        if (relPath.startsWith('..') || relPath.startsWith('/') || relPath.includes('\0')) continue;

        // Skip large files
        if (size > MAX_FILE_SIZE) continue;

        currentFiles.set(relPath, { size, mtime });

        const prevState = fileState.get(relPath);
        if (!prevState) {
          newFiles.push(relPath);
        } else if (mtime !== prevState.mtime || size !== prevState.size) {
          modifiedFiles.push(relPath);
        }
      }

      // Sync new files to VFS
      for (const filePath of newFiles) {
        try {
          // SECURITY: Validate and escape the file path
          if (!SAFE_PATH_RE.test(filePath)) continue;
          const escapedPath = shellEscape(filePath);
          const content = await execRemote(`cat ${escapedWorkspace}/${escapedPath} 2>/dev/null || true`);
          if (content) {
            await syncRemoteFileToVfsDirect(userId, filePath, content);
            const stat = currentFiles.get(filePath)!;
            fileState.set(filePath, stat);
          }
        } catch (err: any) {
          logger.debug('Failed to sync new remote file', { path: filePath, error: err.message });
        }
      }

      // Sync modified files
      for (const filePath of modifiedFiles) {
        try {
          if (!SAFE_PATH_RE.test(filePath)) continue;
          const escapedPath = shellEscape(filePath);
          const content = await execRemote(`cat ${escapedWorkspace}/${escapedPath} 2>/dev/null || true`);
          if (content) {
            await syncRemoteFileToVfsDirect(userId, filePath, content);
            const stat = currentFiles.get(filePath)!;
            fileState.set(filePath, stat);
          }
        } catch (err: any) {
          logger.debug('Failed to sync modified remote file', { path: filePath, error: err.message });
        }
      }

      // Detect deleted files
      for (const [filePath] of fileState) {
        if (!currentFiles.has(filePath)) {
          try {
            await syncFileToVfs(userId, filePath, 'delete');
          } catch { /* ignore */ }
          fileState.delete(filePath);
        }
      }
    } catch (err: any) {
      // SSH exec can fail during cleanup or connection loss — don't spam logs
      if (!stopped && !err.message?.includes('closed') && !err.message?.includes('timeout')) {
        logger.debug('Remote VFS sync poll failed', { error: err.message });
      }
    }
  }

  // Initial snapshot
  pollRemoteChanges().catch(() => {});

  // Start polling
  const interval = setInterval(() => {
    if (!execInProgress) {
      pollRemoteChanges().catch(() => {});
    }
  }, POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      logger.info('Remote VFS sync stopped', { sessionId });
    },
  };
}

/**
 * Sync file content directly to VFS database (bypasses local filesystem read).
 * Used for remote files where we already have the content from SSH.
 */
async function syncRemoteFileToVfsDirect(
  userId: string,
  filePath: string,
  content: string
): Promise<void> {
  const normalizedId = userId.replace(/^anon:/, '').replace(/\.\./g, '').replace(/[\\/ \0]/g, '_').substring(0, 255) || '_default';

  try {
    const db = getDatabase();
    const ext = require('path').extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
      '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
      '.html': 'html', '.css': 'css', '.json': 'json', '.md': 'markdown',
      '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
      '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell',
      '.sql': 'sql', '.java': 'java', '.cpp': 'cpp', '.c': 'c',
    };
    const language = languageMap[ext] || 'plaintext';

    db.prepare(
      `INSERT OR REPLACE INTO vfs_workspace_files
       (owner_id, path, content, language, size, version, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(
         (SELECT version FROM vfs_workspace_files WHERE owner_id = ? AND path = ?) + 1,
         1
       ), datetime('now'))`
    ).run(normalizedId, filePath, content, language, Buffer.byteLength(content, 'utf-8'), normalizedId, filePath);

    db.prepare(
      `INSERT OR REPLACE INTO vfs_workspace_meta (owner_id, version, root, updated_at)
       VALUES (?, COALESCE((SELECT version FROM vfs_workspace_meta WHERE owner_id = ?) + 1, 1), ?, datetime('now'))`
    ).run(normalizedId, normalizedId, process.env.ORACLE_VM_WORKSPACE || '/home/opc/workspace');
  } catch (err: any) {
    if (!err.message?.includes('no such table')) {
      logger.error('Failed to sync remote file to VFS', { path: filePath, error: err.message });
    }
  }
}

// ============================================================
// Oracle VM (SSH-based PTY)
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
  ptyShell: string
): Promise<NextResponse> {
  const { Client } = await import('ssh2');

  const host = process.env.ORACLE_VM_HOST;
  const port = parseInt(process.env.ORACLE_VM_PORT || '22');
  const username = process.env.ORACLE_VM_USER || 'opc';
  const privateKey = process.env.ORACLE_VM_PRIVATE_KEY;
  const privateKeyPath = process.env.ORACLE_VM_KEY_PATH;
  const workspace = process.env.ORACLE_VM_WORKSPACE || '/home/opc/workspace';

  if (!host) {
    return NextResponse.json(
      {
        error: 'Oracle VM is not configured (ORACLE_VM_HOST not set)',
        hint: 'Set ORACLE_VM_HOST and ORACLE_VM_KEY_PATH in your environment.',
        mode: 'sandbox',
      },
      { status: 503 }
    );
  }

  const safeCols = Math.max(1, Math.min(cols, 500));
  const safeRows = Math.max(1, Math.min(rows, 200));

  return new Promise<NextResponse>((resolve) => {
    const client = new Client();

    const connectionConfig: any = {
      host,
      port,
      username,
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
      // STEP 1: Create cd-override script on the remote VM
      const remoteInitPath = `${workspace}/.binG-temp/_safe_oracle_init.sh`;
      const mkdirCmd = `mkdir -p '${workspace}/.binG-temp'`;
      const cdOverrideScript = `#!/bin/bash
# Safe shell init inside Oracle VM - prevent cd from escaping workspace
WORKSPACE_ROOT="${workspace}"

# Custom PS1 to show 'workspace' instead of real path
PS1='\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ '

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

      // Heredoc with single-quoted delimiter passes content literally (no expansion)
      client.exec(`${mkdirCmd} && cat > '${remoteInitPath}' << 'ENDOFSCRIPT'
${cdOverrideScript}
ENDOFSCRIPT
chmod +x '${remoteInitPath}'`, (err: any, setupStream: any) => {
        if (err) {
          logger.warn('[Local PTY] Failed to create cd-override script on Oracle VM', { error: err.message });
          // Continue anyway — cd protection won't be active but shell still works
        }
        // Consume setup stream output and wait for close
        setupStream.on('close', () => {
          // STEP 2: Open interactive shell via exec with cd protection
          // Use --rcfile to source our init script, -i for interactive
          client.exec(
            `bash --rcfile '${remoteInitPath}' -i`,
            { pty: { term: 'xterm-256color', cols: safeCols, rows: safeRows } },
            (err: any, stream: any) => {
              if (err) {
                client.end();
                logger.error('[Local PTY] Oracle VM shell failed', { error: err.message });
                return resolve(NextResponse.json(
                  { error: `Failed to open shell: ${err.message}`, mode: 'sandbox' },
                  { status: 500 }
                ));
              }

              // Create a pseudo-IPty adapter so our existing architecture works
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
                waitForConnection: async () => { /* already connected */ },
                disconnect: async () => {
                  try { stream.end(); } catch { /* ignore */ }
                  try { client.end(); } catch { /* ignore */ }
                },
                wait: async () => ({ exitCode: 0 }),
                sendInput: async (data: string) => stream.write(data),
              } as unknown as IPty;

              // Start remote VFS sync — polls the Oracle VM workspace for file changes
              // and syncs them back to the VFS database
              const remoteVfsSync = startRemoteVfsSync(
                client,
                userId,
                workspace,
                sessionId
              );

              registerSession(sessionId, userId, sshPty, workspace, {
                sshClient: client,
                vfsWatcher: remoteVfsSync,
              });

              logger.info('[Local PTY] Oracle VM SSH session created', {
                sessionId,
                host,
                username,
                cols: safeCols,
                rows: safeRows,
              });

              resolve(NextResponse.json({ sessionId, mode: 'oracle-vm', workspaceDir: workspace }));
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
      logger.debug('[Local PTY] Oracle VM SSH connection closed');
      // Find and mark the session as exited
      const session = sessions.get(sessionId);
      if (session && !session.exited) {
        session.exited = true;
        session.exitCode = 0;
        logger.info('[Local PTY] Oracle VM session marked as exited', { sessionId });
        // Trigger cleanup on next interval — don't call cleanupSession directly
        // since we're inside an event handler and cleanupSession is async
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
  const session: LocalPtySession = {
    sessionId,
    userId,
    pty,
    createdAt: Date.now(),
    exited: false,
    exitCode: undefined,
    outputQueue: [],
    workspaceDir,
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

      // Send initial connected message
      send({ type: 'connected', data: { sessionId } });

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
          s.outputQueue.length = 0; // Clear queue
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
