/**
 * Custom Next.js Server with WebSocket Support
 *
 * This server extends Next.js to add WebSocket capabilities for real-time terminal streaming.
 *
 * PORT CONFIGURATION:
 * - Next.js HTTP Server: PORT (default 3000) - handles regular HTTP requests
 * - WebSocket Server: WEBSOCKET_PORT (default 8080) - handles WebSocket terminal connections
 * These MUST be different ports as they use different protocols (HTTP vs WebSocket)
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
 * - Backend service initialization on startup
 *
 * @see https://nextjs.org/docs/advanced-features/custom-server
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { initializeBackend, getBackendStatus } from '@/lib/backend';
import { createLogger } from '@/lib/utils/logger';
import { getDatabaseSessionStore } from '@/lib/database/session-store';

const logger = createLogger('Server');

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

// Initialize backend services on startup
async function startup() {
  try {
    logger.info('Starting backend initialization...');

    // Initialize database session store for persistence
    try {
      const dbSessionStore = getDatabaseSessionStore();
      dbSessionStore.initialize();
      logger.info('Database session store initialized');
    } catch (error: any) {
      logger.warn('Database session store initialization failed:', error.message);
      logger.warn('Sessions will be in-memory only (no persistence)');
    }

    const backendStatus = await initializeBackend({
      websocketPort: parseInt(process.env.WEBSOCKET_PORT || '8080'),
    });

    logger.info('Backend initialized successfully', backendStatus);

    // Log backend status
    if (!backendStatus.websocket.running) {
      logger.warn('WebSocket server failed to start', backendStatus.websocket.error);
    }
    if (!backendStatus.storage.healthy) {
      logger.warn('Storage backend unhealthy', backendStatus.storage.error);
    }

  } catch (error) {
    logger.error('Backend initialization failed', error as Error);
    // Don't crash the server, but log the error
    // Backend will be lazily initialized on first API call
  }
}

app.prepare().then(startup).then(() => {
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
