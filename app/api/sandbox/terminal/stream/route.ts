import { NextRequest } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';
import { sandboxEvents } from '@/lib/sandbox/sandbox-events';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const sandboxId = req.nextUrl.searchParams.get('sandboxId');
    const anonymousSessionId = req.nextUrl.searchParams.get('anonymousSessionId');

    if (!sessionId || !sandboxId) {
      return new Response(JSON.stringify({ error: 'sessionId and sandboxId are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authResult = await resolveRequestAuth(req, {
      bearerToken: token,
      allowAnonymous: true,
      anonymousSessionId,
    });

    if (!authResult.success || !authResult.userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sandboxId !== sandboxId || userSession.sessionId !== sessionId) {
      return new Response(JSON.stringify({ error: 'Unauthorized: sandbox does not belong to this user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
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
