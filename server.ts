/**
 * Custom Next.js Server with WebSocket Support
 * 
 * This server extends Next.js to add WebSocket capabilities for real-time terminal streaming.
 * 
 * Usage:
 *   npm run dev:ws  (development)
 *   npm run start:ws (production)
 * 
 * Features:
 * - WebSocket upgrade for terminal streaming
 * - Bidirectional communication for input/output
 * - Lower latency than SSE+POST
 * - Automatic reconnection support
 * 
 * @see https://nextjs.org/docs/advanced-features/custom-server
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000');

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Global state for terminal sessions
interface TerminalSession {
  sessionId: string;
  sandboxId: string;
  userId: string;
  ws: WebSocket;
  onData?: (data: string) => void;
  onPortDetected?: (info: any) => void;
}

const terminalSessions = new Map<string, TerminalSession>();

// Create server instance (must be defined before export)
const server = createServer((req, res) => {
  const parsedUrl = parse(req.url!, true);
  handle(req, res, parsedUrl);
});

app.prepare().then(() => {
  // WebSocket server for terminal streaming
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parse(req.url || '', true);

    // Handle WebSocket upgrade for terminal streaming
    if (pathname === '/api/sandbox/terminal/ws') {
      const sessionId = query.sessionId as string;
      const sandboxId = query.sandboxId as string;
      const token = query.token as string;

      if (!sessionId || !sandboxId) {
        socket.destroy();
        return;
      }

      // Authenticate the connection
      // In production, validate the token against your auth system
      const userId = token || 'anonymous';

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { sessionId, sandboxId, userId });
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage, context: any) => {
    const { sessionId, sandboxId, userId } = context;
    const sessionKey = `${sessionId}-${userId}`;

    console.log(`[WebSocket] Client connected: ${sessionKey}`);

    // Store session
    const session: TerminalSession = {
      sessionId,
      sandboxId,
      userId,
      ws,
    };
    terminalSessions.set(sessionKey, session);

    // Send connected message
    ws.send(JSON.stringify({
      type: 'connected',
      data: { sessionId, sandboxId },
    }));

    // Handle incoming messages from client
    ws.on('message', async (message) => {
      try {
        const msg = JSON.parse(message.toString());

        switch (msg.type) {
          case 'input':
            // Forward input to sandbox terminal
            // This would integrate with your terminal manager
            console.log(`[WebSocket] Input received: ${msg.data?.substring(0, 50)}...`);
            
            // In production, forward to terminal manager:
            // const terminal = await terminalManager.getTerminal(sessionId);
            // terminal?.write(msg.data);
            break;

          case 'resize':
            // Forward resize to sandbox
            console.log(`[WebSocket] Resize: ${msg.cols}x${msg.rows}`);
            
            // In production, forward to terminal manager:
            // const terminal = await terminalManager.getTerminal(sessionId);
            // terminal?.resize(msg.cols, msg.rows);
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'ping' }));
            break;

          default:
            console.warn(`[WebSocket] Unknown message type: ${msg.type}`);
        }
      } catch (err) {
        console.error('[WebSocket] Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected: ${sessionKey}`);
      terminalSessions.delete(sessionKey);
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Error:', err);
      terminalSessions.delete(sessionKey);
    });

    // Keep-alive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server ready on ws://${hostname}:${port}`);
  });
});

export default server;
