import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';
import { sandboxEvents } from '@/lib/sandbox/sandbox-events';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

// Use globalThis to prevent HMR leaks in development
// Without this, each hot-reload would create a new Map and interval timer
declare global {
  var __terminalConnectionTokens: Map<string, { userId: string; sandboxId: string; sessionId: string; expiresAt: number }> | undefined;
  var __terminalTokenCleanupInterval: NodeJS.Timeout | undefined;
}

// Initialize connection tokens Map (singleton across HMR)
const connectionTokens = globalThis.__terminalConnectionTokens ??= new Map();

// Initialize cleanup interval (singleton across HMR)
if (!globalThis.__terminalTokenCleanupInterval) {
  globalThis.__terminalTokenCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, data] of connectionTokens.entries()) {
      if (data.expiresAt < now) {
        connectionTokens.delete(token);
      }
    }
  }, 60000);
}

/**
 * POST to initiate a terminal stream and get a short-lived connection token
 * This avoids passing JWT tokens in URLs
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, {
      allowAnonymous: true,
    });

    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { sessionId, sandboxId } = body;

    if (!sessionId || !sandboxId) {
      return NextResponse.json({ error: 'sessionId and sandboxId are required' }, { status: 400 });
    }

    // Verify user has access to this sandbox
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sandboxId !== sandboxId || userSession.sessionId !== sessionId) {
      return NextResponse.json({ error: 'Unauthorized: sandbox does not belong to this user' }, { status: 403 });
    }

    // Generate short-lived connection token (5 minute TTL)
    const connectionToken = randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    connectionTokens.set(connectionToken, {
      userId: authResult.userId,
      sandboxId,
      sessionId,
      expiresAt,
    });

    return NextResponse.json({ connectionToken, expiresAt });
  } catch (error) {
    console.error('[Terminal Token] Error:', error);
    return NextResponse.json({ error: 'Failed to generate connection token' }, { status: 500 });
  }
}

/**
 * GET to establish the SSE terminal stream using a short-lived connection token
 */
export async function GET(req: NextRequest) {
  try {
    const connectionToken = req.nextUrl.searchParams.get('token');
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const sandboxId = req.nextUrl.searchParams.get('sandboxId');
    const anonymousSessionId = req.nextUrl.searchParams.get('anonymousSessionId');

    if (!sessionId || !sandboxId) {
      return new Response(JSON.stringify({ error: 'sessionId and sandboxId are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate connection token
    let userId: string;
    if (connectionToken) {
      const tokenData = connectionTokens.get(connectionToken);
      if (!tokenData || tokenData.expiresAt < Date.now()) {
        connectionTokens.delete(connectionToken);
        return new Response(JSON.stringify({ error: 'Connection token expired or invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Verify token matches the requested session
      if (tokenData.sandboxId !== sandboxId || tokenData.sessionId !== sessionId) {
        return new Response(JSON.stringify({ error: 'Connection token does not match this session' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      userId = tokenData.userId;
      // Invalidate token after first use (single-use token)
      connectionTokens.delete(connectionToken);
    } else {
      // Fallback to anonymous auth (for backward compatibility)
      const authResult = await resolveRequestAuth(req, {
        allowAnonymous: true,
        anonymousSessionId,
      });

      if (!authResult.success || !authResult.userId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      userId = authResult.userId;

      // Verify user has access to this sandbox
      const userSession = sandboxBridge.getSessionByUserId(userId);
      if (!userSession || userSession.sandboxId !== sandboxId || userSession.sessionId !== sessionId) {
        return new Response(JSON.stringify({ error: 'Unauthorized: sandbox does not belong to this user' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let cleanup: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (payload: object) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // Stream closed
          }
        };

        const onData = (data: string) => {
          send({ type: 'pty', data });
        };

        const onPortDetected = (info: any) => {
          send({ type: 'port_detected', data: info });
        };

        const unsubscribeEvents = sandboxEvents.subscribe(sandboxId, (event) => {
          send({ type: event.type, data: event.data, timestamp: event.timestamp });
        });

        const pingInterval = setInterval(() => {
          send({ type: 'ping' });
        }, 15_000);

        cleanup = () => {
          clearInterval(pingInterval);
          unsubscribeEvents();
          terminalManager.disconnectTerminal(sessionId).catch(() => {});
        };

        const setupPty = async () => {
          try {
            // Always create (or replace) the PTY session; TerminalManager will clean up any existing connection
            await terminalManager.createTerminalSession(sessionId, sandboxId, onData, onPortDetected);
            send({ type: 'connected', data: { sessionId, sandboxId } });
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to connect to terminal';
            send({ type: 'error', data: msg });
          }
        };

        setupPty();
      },

      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('[Terminal Stream] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to establish terminal stream' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
