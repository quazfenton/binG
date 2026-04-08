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
import type { IPty } from 'node-pty';

export const runtime = 'nodejs';

// ============================================================
// Session Store (singleton across HMR via globalThis)
// ============================================================

interface LocalPtySession {
  sessionId: string;
  userId: string;
  pty: IPty;
  createdAt: number;
  exited: boolean; // node-pty doesn't expose exited state reliably
  exitCode: number | undefined;
  dockerContainerId?: string;
  unsharePid?: number;
}

// Security: Max sessions per user to prevent resource exhaustion
const MAX_SESSIONS_PER_USER = 5;

// Use globalThis to prevent HMR leaks
declare global {
  var __localPtySessions: Map<string, LocalPtySession> | undefined;
}

const sessions = globalThis.__localPtySessions ??= new Map<string, LocalPtySession>();

// ============================================================
// Configuration
// ============================================================

type IsolationMode = 'off' | 'localhost' | 'unshare' | 'docker' | 'on';

const ENABLE_LOCAL_PTY: IsolationMode =
  (process.env.ENABLE_LOCAL_PTY as IsolationMode) ||
  (process.env.NODE_ENV === 'production' ? 'off' : 'on');

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
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > MAX_SESSION_AGE || session.exited) {
      await cleanupSession(id, session);
    }
  }
}, CLEANUP_INTERVAL);

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    for (const [id, session] of sessions.entries()) {
      try {
        session.pty.kill();
      } catch {
        // Ignore errors during shutdown
      }
    }
  });

  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
    process.exit(0);
  });
}

async function cleanupSession(id: string, session: LocalPtySession): Promise<void> {
  try {
    if (session.dockerContainerId) {
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
  const { exec } = await import('child_process');
  return new Promise<void>((resolve) => {
    exec(`docker rm -f ${containerId} 2>/dev/null`, (err) => {
      if (err) {
        console.warn(`[Local PTY] Docker cleanup failed ${containerId}:`, err.message);
      }
      resolve();
    });
  });
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
  let count = 0;
  for (const session of sessions.values()) {
    if (session.userId === userId && !session.exited) count++;
  }
  return count;
}

// ============================================================
// Helper: Sanitize environment variables (remove secrets)
// ============================================================

function getCleanEnv(): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = {};
  const secretPatterns = [
    'SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'PASS', 'CREDENTIAL',
    'AUTH', 'API_KEY', 'PRIVATE', 'SIGNING',
  ];

  for (const [key, value] of Object.entries(process.env)) {
    const isSecret = secretPatterns.some(pattern =>
      key.toUpperCase().includes(pattern)
    );
    if (!isSecret && value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  return {
    ...cleanEnv,
    TERM: 'xterm-256color',
    HOME: process.env.HOME || '/home/node',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LANG: 'en_US.UTF-8',
  };
}

// ============================================================
// POST — Create a new local PTY session
// ============================================================

export async function POST(req: NextRequest) {
  try {
    // === Security gate ===
    if (ENABLE_LOCAL_PTY === 'off') {
      return NextResponse.json(
        {
          error: 'Local PTY is disabled. Use sandbox providers for terminal access.',
          mode: 'sandbox',
          hint: 'Set ENABLE_LOCAL_PTY=localhost to enable for local development',
        },
        { status: 503 }
      );
    }

    // Localhost-only mode
    if (ENABLE_LOCAL_PTY === 'localhost') {
      const origin = req.headers.get('origin') || req.headers.get('host') || '';
      if (!origin.includes('localhost') && !origin.includes('127.0.0.1') && !origin.includes('::1')) {
        return NextResponse.json(
          { error: 'Local PTY is only available from localhost', mode: 'sandbox' },
          { status: 503 }
        );
      }
    }

    // Resolve auth
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const { cols: rawCols = 80, rows: rawRows = 24, cwd, shell, checkOnly } = body;

    // Validate dimensions
    const dims = validateDimensions(rawCols, rawRows);
    if (!dims) {
      return NextResponse.json(
        { error: `Invalid dimensions: cols=${rawCols}, rows=${rawRows}. Must be cols:[${MIN_COLS}-${MAX_COLS}], rows:[${MIN_ROWS}-${MAX_ROWS}]` },
        { status: 400 }
      );
    }
    const { cols, rows } = dims;

    // Check-only mode: just verify node-pty is available
    if (checkOnly) {
      try {
        await import('node-pty');
        return NextResponse.json({ available: true, mode: ENABLE_LOCAL_PTY });
      } catch {
        return NextResponse.json({ available: false, mode: ENABLE_LOCAL_PTY }, { status: 503 });
      }
    }

    // Check session limit
    const userSessionCount = getUserSessionCount(authResult.userId);
    if (userSessionCount >= MAX_SESSIONS_PER_USER) {
      return NextResponse.json(
        {
          error: `Too many PTY sessions (${userSessionCount}/${MAX_SESSIONS_PER_USER}). Close existing sessions first.`,
          mode: 'sandbox',
        },
        { status: 429 }
      );
    }

    // Import node-pty
    let nodePty: typeof import('node-pty');
    try {
      nodePty = await import('node-pty');
    } catch {
      return NextResponse.json(
        {
          error: 'node-pty not installed',
          hint: 'Run: npm install node-pty',
          mode: 'sandbox',
        },
        { status: 503 }
      );
    }

    // Determine shell
    const defaultShell = process.platform === 'win32'
      ? 'powershell.exe'
      : process.env.SHELL || '/bin/bash';
    const ptyShell = shell || defaultShell;
    const sessionId = randomUUID();

    // === Isolation mode: unshare (Linux user namespaces) ===
    if (ENABLE_LOCAL_PTY === 'unshare') {
      return await createUnsharePtySession(
        nodePty,
        sessionId,
        authResult.userId,
        cols,
        rows,
        cwd,
        ptyShell
      );
    }

    // === Isolation mode: Docker ===
    if (ENABLE_LOCAL_PTY === 'docker') {
      return await createDockerPtySession(
        nodePty,
        sessionId,
        authResult.userId,
        cols,
        rows,
        cwd,
        ptyShell
      );
    }

    // === Direct spawn mode (dev only) ===
    return await createDirectPtySession(
      nodePty,
      sessionId,
      authResult.userId,
      cols,
      rows,
      cwd,
      ptyShell
    );
  } catch (error: any) {
    console.error('[Local PTY] Failed to create session:', error);
    return NextResponse.json(
      { error: 'Failed to create PTY session', details: error.message },
      { status: 500 }
    );
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
  const pty = nodePty.spawn(ptyShell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: cwd || process.env.HOME || process.cwd(),
    env: getCleanEnv(),
  });

  registerSession(sessionId, userId, pty);

  return NextResponse.json({ sessionId, mode: 'direct' });
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
        hint: 'Set ENABLE_LOCAL_PTY=direct or use Docker mode instead',
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
  const unshareArgs = [
    '--user',
    '--map-root-user',
    '--mount',
    '--pid',
    '--fork',
    '--mount-proc', // Mount a new proc filesystem in the new namespace
    ptyShell,
  ];

  try {
    const pty = nodePty.spawn('unshare', unshareArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || process.cwd(),
      env: getCleanEnv(),
    });

    // Get the PID of the unshare process for cleanup
    const unsharePid = (pty as any).pid || (pty as any)._pid;

    registerSession(sessionId, userId, pty, { unsharePid });

    console.log(`[Local PTY] Unshare session created: ${sessionId}`);

    return NextResponse.json({ sessionId, mode: 'unshare' });
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

  // Generate a unique container name
  const containerName = `pty-${sessionId.slice(0, 12)}`;
  const workspaceDir = cwd || '/workspace';

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
    '-w',
    workspaceDir,
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

      // Now use node-pty to exec into the container
      const pty = nodePty.spawn('docker', [
        'exec',
        '-i', // Only stdin (no -t, node-pty already provides TTY emulation)
        containerId,
        ptyShell,
        '-l', // Login shell
      ], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workspaceDir,
        env: {
          TERM: 'xterm-256color',
          HOME: workspaceDir,
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          LANG: 'en_US.UTF-8',
        },
      });

      registerSession(sessionId, userId, pty, { dockerContainerId: containerId });

      resolve(NextResponse.json({ sessionId, mode: 'docker' }));
    });
  });
}

// ============================================================
// Session Registration
// ============================================================

function registerSession(
  sessionId: string,
  userId: string,
  pty: IPty,
  extras: Partial<LocalPtySession> = {}
): void {
  const session: LocalPtySession = {
    sessionId,
    userId,
    pty,
    createdAt: Date.now(),
    exited: false,
    exitCode: undefined,
    ...extras,
  };

  sessions.set(sessionId, session);

  // Track output for SSE polling
  (session as any).lastOutput = null;
  (session as any).outputQueue: string[] = [];

  // Set up output handler — queue output for SSE
  pty.onData((data: string) => {
    const s = sessions.get(sessionId);
    if (s) {
      if (!(s as any).outputQueue) (s as any).outputQueue = [];
      (s as any).outputQueue.push(data);
    }
  });

  // Track exit state
  pty.onExit(({ exitCode }) => {
    const s = sessions.get(sessionId);
    if (s) {
      s.exited = true;
      s.exitCode = exitCode;
      console.log(`[Local PTY] Session ${sessionId} exited with code ${exitCode}`);
    }
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

  // Verify session ownership (auth check)
  const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
  if (authResult.success && authResult.userId && session.userId !== authResult.userId) {
    return new Response(JSON.stringify({ error: 'Unauthorized: session does not belong to this user' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (payload: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream closed — ignore
        }
      };

      // Send initial connected message
      send({ type: 'connected', data: { sessionId } });

      // Poll for PTY output with queue
      const pollInterval = setInterval(() => {
        const s = sessions.get(sessionId);
        if (!s) {
          // Session was cleaned up
          send({ type: 'disconnected', data: { exitCode: s?.exitCode ?? null } });
          clearInterval(pollInterval);
          controller.close();
          return;
        }

        // Drain output queue
        const queue = (s as any).outputQueue as string[] | undefined;
        if (queue && queue.length > 0) {
          const output = queue.join('');
          queue.length = 0; // Clear queue
          send({ type: 'pty', data: output });
        }

        // Check if PTY exited
        if (s.exited) {
          send({ type: 'disconnected', data: { exitCode: s.exitCode } });
          clearInterval(pollInterval);
          controller.close();
        }
      }, 30); // Poll every 30ms for lower latency

      // Cleanup on SSE close
      return () => {
        clearInterval(pollInterval);
      };
    },

    cancel() {
      // Client disconnected — clean up session
      const session = sessions.get(sessionId);
      if (session && !session.exited) {
        session.pty.kill();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
