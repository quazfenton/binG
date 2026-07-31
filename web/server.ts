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

// Load environment variables before anything else
import 'dotenv/config';

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { initializeBackend, getBackendStatus } from '@/lib/backend';
import { terminalManager } from '@/lib/terminal/terminal-manager';
import { createLogger } from '@/lib/utils/logger';
import { getDatabaseSessionStore } from '@/lib/database/session-store';
import { logMCPStartupHealth } from '@/lib/mcp';
import {
  handleTerminalWsUpgrade,
  incrementUserWsCount,
  decrementUserWsCount,
} from '@/lib/terminal/ws-upgrade-handler';
import { wsPreviewBroadcaster } from '@/lib/terminal/ws-preview-broadcaster';

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
  createdAt: number; // FIX: Track creation time for TTL-based cleanup
  onData?: (data: string) => void;
  onPortDetected?: (info: any) => void;
}

const terminalSessions = new Map<string, TerminalSession>();

// FIX (Bug 6): Maximum concurrent WebSocket connections to prevent OOM
const MAX_WS_CONNECTIONS = parseInt(process.env.MAX_WS_CONNECTIONS || '500', 10);
let activeWsConnections = 0;

// Create server instance (must be defined before export)
const server = createServer((req, res) => {
  const parsedUrl = parse(req.url!, true);
  handle(req, res, parsedUrl);
});

// Initialize backend services on startup
async function startup() {
  try {
    logger.info('Starting backend initialization...');

    // Session store is initialized by initializeBackend() - don't duplicate
    const backendStatus = await initializeBackend({
      websocketPort: parseInt(process.env.WEBSOCKET_PORT || '8080'),
    });

    logger.info('Backend initialized successfully', backendStatus);

    // Pre-warm the better-sqlite3 native binding so it is paid for during
    // custom-server boot rather than on the first /api/auth/login request.
    // Mirrors the warmup in instrumentation.ts for the default `next dev`/
    // `next start` path; runs BEFORE server.listen(port) so the very first
    // inbound HTTP request sees a warm binding handle.
    //
    // Note: this only fires for `tsx server.ts` (`dev:ws` / `start:ws`).
    // The default `next dev`/`next start` path does NOT load server.ts —
    // it loads instrumentation.ts via Next's instrumentation hook, which
    // has the same dedup'd getDatabase() warmup. Both paths share the same
    // globalThis flag so a process that somehow evaluates both files (e.g.
    // a manual tsx instrumentation.ts experiment) does not double-warm.
    const __warmupState__ = (globalThis as unknown as {
      __betterSqlite3Warmed__?: boolean;
    });
    if (!__warmupState__.__betterSqlite3Warmed__) {
      __warmupState__.__betterSqlite3Warmed__ = true;
      const __t0__ = process.hrtime.bigint();
      try {
        const { getDatabase, isDatabaseConnectionCallable } = await import(
          '@/lib/database/connection-shim'
        );
        // Side-effecting call: triggers `new Database(...)` inside
        // connection.ts, which loads + JITs the better-sqlite3 native
        // binding ONCE for this process. Subsequent calls return the
        // already-warm handle.
        getDatabase();
        const __elapsedMs__ = Number(process.hrtime.bigint() - __t0__) / 1e6;
        if (!isDatabaseConnectionCallable()) {
          logger.warn(
            `better-sqlite3 warmup completed in ${__elapsedMs__.toFixed(1)}ms BUT shim fell through to nullDb fallback — native binding NOT pre-cached. ` +
              `First DB query will pay a degraded-init cost.`,
          );
        } else {
          logger.info(
            `better-sqlite3 native binding pre-loaded (${__elapsedMs__.toFixed(1)}ms) — /api/auth/login cold-path b0→b1 will skip this cost on first hit`,
          );
        }
      } catch (err) {
        logger.warn(
          `better-sqlite3 warmup threw after ${(Number(process.hrtime.bigint() - __t0__) / 1e6).toFixed(1)}ms — boot continues; first DB query will retry inline`,
          err as Error,
        );
      }
    }

    // Start provider health checking
    const { startProviderHealthCheck } = await import('@/lib/management/health-checker');
    await startProviderHealthCheck();
    logger.info('Provider health checker started');

    // Start Agent Kernel (OS-like scheduler)
    const { startAgentKernel } = await import('@bing/shared/agent/agent-kernel');
    await startAgentKernel();
    logger.info('Agent Kernel started');

    // Log backend status
    if (!backendStatus.websocket.running) {
      logger.warn('WebSocket server failed to start', backendStatus.websocket.error);
    }
    if (!backendStatus.storage.healthy) {
      logger.warn('Storage backend unhealthy', backendStatus.storage.error);
    }

    // Log MCP tool sources health (fire-and-forget, don't block startup)
    logMCPStartupHealth().catch(e => logger.warn('MCP health check failed', e));

    // Start Composio MCP server (fire-and-forget, don't block startup)
    if (process.env.COMPOSIO_API_KEY) {
      import('@/lib/integrations/composio-mcp-service').then(({ createComposioMCPServer }) => {
        const mcpPort = parseInt(process.env.COMPOSIO_MCP_PORT || '3001', 10);
        return createComposioMCPServer({
          apiKey: process.env.COMPOSIO_API_KEY!,
          serverName: 'composio-tools',
          serverVersion: '1.0.0',
          port: mcpPort,
        });
      }).then((mcpServer) => {
        // Store reference for graceful shutdown and API route access
        (globalThis as any).__composioMcpServer = mcpServer;
        logger.info(`Composio MCP server started on port ${mcpServer.getServerInfo().port}`);

        // Graceful shutdown on process exit
        const shutdown = async (signal: string) => {
          logger.info(`Composio MCP server shutting down (${signal})...`);
          try { await mcpServer.stop(); } catch {}
        };
        process.once('SIGTERM', () => shutdown('SIGTERM'));
        process.once('SIGINT', () => shutdown('SIGINT'));
      }).catch(e => logger.warn('Composio MCP server failed to start', e));
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

  // WebSocket server for preview dashboard broadcasts
  const previewWss = new WebSocketServer({ noServer: true });

  // Attach preview broadcaster to the preview WSS
  wsPreviewBroadcaster.attachToServer(previewWss);

  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parse(req.url || '', true);

    // FIX (Bug 7): Preserve Next.js HMR and other legitimate WebSocket connections.
    // Only intercept our terminal streaming paths; pass everything else through
    // to the default Next.js HMR handler (which uses its own WebSocket server).
    const isTerminalWS = pathname === '/ws' || pathname === '/api/sandbox/terminal/ws';
    const isStreamControl = pathname === '/stream-control';
    const isVncProxy = pathname === '/vnc-proxy';
    const isPreviewWS = pathname === '/ws/previews';

    if (!isTerminalWS && !isStreamControl && !isVncProxy && !isPreviewWS) {
      // Not our WebSocket — let Next.js HMR or other WS servers handle it.
      socket.destroy();
      return;
    }

    // Handle VNC proxy WebSocket (bridge WebSocket <-> TCP VNC server)
    if (isVncProxy) {
      // FIX: Reject if at connection limit
      if (activeWsConnections >= MAX_WS_CONNECTIONS) {
        console.warn(`[VNCProxy] Connection limit reached (${MAX_WS_CONNECTIONS}), rejecting`);
        // Use socket.write() + end() instead of writeHead(), since upgrade
        // sockets are net.Socket instances and writeHead() is not a valid method on them.
        socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nService Unavailable: Too many WebSocket connections');
        socket.end();
        return;
      }

      const host = query.host as string;
      const port = parseInt(query.port as string, 10);

      if (!host || !port) {
        logger.warn('[VNCProxy] Missing host or port');
        socket.destroy();
        return;
      }

      if (port < 1 || port > 65535) {
        logger.warn('[VNCProxy] Invalid port:', port);
        socket.destroy();
        return;
      }

      // VNC proxy bypasses the normal WebSocket authentication flow.
      // Require authentication token for VNC proxy connections.
      const authHeader = req.headers['authorization'] || '';
      const protocolHeader = req.headers['sec-websocket-protocol'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7)
        : (Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader).startsWith('Bearer ')
          ? (Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader).substring(7)
          : null;
      
      if (!token) {
        logger.warn('[VNCProxy] Authentication required but no token provided');
        socket.destroy();
        return;
      }
      
      try {
        const { verifyToken } = await import('@/lib/security/jwt-auth');
        const verification = await verifyToken(token);
        if (!verification.valid || !verification.payload) {
          logger.warn('[VNCProxy] Invalid token');
          socket.destroy();
          return;
        }
        const payload = verification.payload;
        logger.info('[VNCProxy] Authenticated VNC proxy connection', { user: payload.userId || payload.sub });
      } catch (authErr: any) {
        logger.warn('[VNCProxy] Token validation failed', authErr);
        socket.destroy();
        return;
      }

      // SECURITY: Block connections to private/internal IP ranges to prevent SSRF.
      // Validate hostname string first, then resolve to IP and check the resolved
      // IP against private ranges — hostname-only checks are bypassable via DNS
      // rebinding or internal hostnames that resolve to private IPs.
      const hostnamePattern = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|localhost$|::1$|fe80:)/i;
      if (hostnamePattern.test(host)) {
        logger.warn(`[VNCProxy] Blocked internal host: ${host}`);
        socket.destroy();
        return;
      }
      
      // Also resolve the hostname and check IP ranges for defense-in-depth
      // against hostname-based bypasses.
      try {
        const { lookup } = await import('dns/promises');
        const addresses = await lookup(host, { all: true });
        for (const addr of addresses) {
          const ip = addr.address;
          const isPrivate = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|0\.|::1$|fe80:|fc00:|fd00:)/i.test(ip);
          if (isPrivate) {
            logger.warn(`[VNCProxy] Blocked host ${host} resolves to private IP ${ip}`);
            socket.destroy();
            return;
          }
        }
      } catch (lookupErr) {
        // DNS lookup failed — still allow the connection but log a warning.
        // The hostname-level check above already caught literal IPs.
        logger.warn(`[VNCProxy] DNS lookup failed for ${host}, proceeding with hostname validation only`, lookupErr);
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { proxyType: 'vnc', vncHost: host, vncPort: port });
      });
      return;
    }

    // Handle stream control WebSocket upgrade (LLM streaming control signals)
    if (isStreamControl) {
      // Guard: socket may have been destroyed by a concurrent handler or timeout
      if (socket.destroyed) return;
      try {
         const { handleStreamControlUpgrade } = await import('@/lib/streaming/stream-control-handler');
         // Re-check socket after dynamic import
         if (!socket.destroyed) {
           await handleStreamControlUpgrade(req, socket, head);
         }
      } catch (err: any) {
        logger.error('Stream control WebSocket upgrade failed', err);
        if (!socket.destroyed) socket.destroy();
      }
      return;
    }

    // FIX (Bug 6): Enforce maximum concurrent connections
    if (activeWsConnections >= MAX_WS_CONNECTIONS) {
      console.warn(`[WebSocket] Connection limit reached (${MAX_WS_CONNECTIONS}), rejecting`);
      socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nService Unavailable: Too many WebSocket connections');
      socket.end();
      return;
    }

    // Handle WebSocket upgrade for terminal streaming
    if (isTerminalWS) {
      const sessionId = query.sessionId as string;
      const sandboxId = query.sandboxId as string;
      
      // SECURITY: Extract token from headers (NOT query params)
      // Priority 1: Authorization header (Bearer token)
      let token: string | null = null;
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }

      // Priority 2: WebSocket subprotocol (for wscat/browser WS clients)
      if (!token) {
        const protocolHeader = req.headers['sec-websocket-protocol'];
        const protocol = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
        if (protocol && protocol.startsWith('Bearer ')) {
          token = protocol.substring(7);
        }
      }
      
      // Fallback: Query param (deprecated, log warning)
      if (!token && query.token) {
        console.warn('[WebSocket] Token received via query param (insecure). Use Authorization header instead.');
        token = query.token as string;
      }
      
      // Get anonymous session ID from HttpOnly cookie only (if no auth token)
      // SECURITY: Never trust client-controlled headers for identity (IDOR vulnerability)
      const anonymousSessionId = req.headers.cookie?.match(/anon-session-id=([^;]+)/)?.[1] || '';

      if (!sessionId || !sandboxId) {
        console.warn('[WebSocket] Missing sessionId or sandboxId');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { 
          sessionId, 
          sandboxId, 
          token,
          anonymousSessionId 
        });
      });
    } else if (isPreviewWS) {
      // Preview dashboard WebSocket — auth handled by the broadcaster
      let token: string | null = null;
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer ')) token = authHeader.substring(7);
      if (!token) {
        const proto = req.headers['sec-websocket-protocol'];
        const p = Array.isArray(proto) ? proto[0] : proto;
        if (p?.startsWith('Bearer ')) token = p.substring(7);
      }

      // Resolve userId in the connection handler (async auth)
      previewWss.handleUpgrade(req, socket, head, (ws) => {
        previewWss.emit('connection', ws, req, { token, path: 'previews' });
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage, context: any) => {
    const { sessionId, sandboxId, token, anonymousSessionId, proxyType, vncHost, vncPort } = context;
    let userId: string | null = null;
    let isAuthenticated = false;

    // ===========================================
    // VNC Proxy Connection
    // ===========================================
    if (proxyType === 'vnc') {
      const { connect } = await import('net');

      activeWsConnections++;
      logger.info(`[VNCProxy] Bridging WebSocket to ${vncHost}:${vncPort}`);

      let cleanupCalled = false;
      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        activeWsConnections--;
        if (disconnectTimeout) clearTimeout(disconnectTimeout);
      };

      const tcpSocket = connect(vncPort, vncHost, () => {
        logger.info(`[VNCProxy] TCP connected to ${vncHost}:${vncPort}`);
      });

      // Inactivity timeout: close if idle for 30min
      let disconnectTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        logger.warn(`[VNCProxy] Inactivity timeout for ${vncHost}:${vncPort}`);
        try { ws.close(4004, 'Inactivity timeout'); } catch {}
        if (!tcpSocket.destroyed) tcpSocket.end();
      }, 30 * 60 * 1000);

      const resetTimeout = () => {
        if (disconnectTimeout) {
          clearTimeout(disconnectTimeout);
          disconnectTimeout = setTimeout(() => {
            logger.warn(`[VNCProxy] Inactivity timeout for ${vncHost}:${vncPort}`);
            try { ws.close(4004, 'Inactivity timeout'); } catch {}
            if (!tcpSocket.destroyed) tcpSocket.end();
          }, 30 * 60 * 1000);
        }
      };

      tcpSocket.on('data', (data: Buffer) => {
        resetTimeout();
        if (ws.readyState === WebSocket.OPEN) {
          // Apply backpressure: buffer if ws not ready
          const buffered = ws.bufferedAmount;
          if (buffered > 1024 * 1024) {
            tcpSocket.pause();
            // Use a simple poll-based resume instead of ws.once('drain'),
            // because 'drain' is not a valid backpressure signal for ws WebSocket
            // instances and the TCP read may never resume otherwise.
            const resumeCheck = setInterval(() => {
              if (ws.bufferedAmount <= 512 * 1024) {
                clearInterval(resumeCheck);
                if (!tcpSocket.destroyed) tcpSocket.resume();
              }
            }, 50);
            // Safety: clear interval after 10s to prevent leaks
            setTimeout(() => clearInterval(resumeCheck), 10000);
          }
          ws.send(data);
        }
      });

      tcpSocket.on('error', (err: Error) => {
        cleanup();
        logger.error(`[VNCProxy] TCP error: ${err.message}`);
        try { ws.close(4002, `VNC proxy TCP error: ${err.message}`); } catch {}
      });

      tcpSocket.on('close', () => {
        cleanup();
        try { ws.close(4003, 'VNC server disconnected'); } catch {}
      });

      ws.on('message', (data: Buffer) => {
        resetTimeout();
        if (!tcpSocket.destroyed) {
          tcpSocket.write(typeof data === 'string' ? Buffer.from(data) : data);
        }
      });

      ws.on('close', () => {
        cleanup();
        if (!tcpSocket.destroyed) tcpSocket.end();
      });

      ws.on('error', () => {
        cleanup();
        if (!tcpSocket.destroyed) tcpSocket.end();
      });

      ws.send(JSON.stringify({ type: 'vnc-proxy-connected', host: vncHost, port: vncPort }));
      return;
    }

    // ===========================================
    // SECURITY: Authenticate WebSocket Connection
    // ===========================================
    
    // Priority 1: Validate JWT token from Authorization header or subprotocol
    if (token) {
      try {
        const { verifyToken } = await import('@/lib/security/jwt-auth');
        const verification = await verifyToken(token);
        if (!verification.valid || !verification.payload) {
          console.warn('[WebSocket] Invalid token');
          ws.close(4001, 'Invalid token');
          return;
        }
        const payload = verification.payload;
        userId = payload.userId || payload.sub;
        
        if (!userId) {
          console.warn('[WebSocket] Invalid token: missing user ID');
          ws.close(4001, 'Invalid token');
          return;
        }
        
        isAuthenticated = true;
        console.log(`[WebSocket] Authenticated user ${userId} via JWT`);
      } catch (error: any) {
        console.warn(`[WebSocket] Token validation failed: ${error.message}`);
        ws.close(4001, `Authentication failed: ${error.message}`);
        return;
      }
    }
    
    // Priority 2: Validate anonymous session ID (if anonymous access allowed)
    if (!userId && anonymousSessionId) {
      // Verify anonymous session exists and is valid
      const { getDatabaseSessionStore } = await import('@/lib/database/session-store');
      const sessionStore = getDatabaseSessionStore();
      const session = await sessionStore.getSession(anonymousSessionId);

      if (session && (session as any).userId) {
        userId = (session as any).userId;
        console.log(`[WebSocket] Authenticated anonymous user ${userId}`);
      }
    }
    
    // Reject if no valid authentication
    if (!userId) {
      // SECURITY: In production, reject all anonymous connections
      if (process.env.NODE_ENV === 'production') {
        console.warn('[WebSocket] Production: Anonymous connections rejected');
        ws.close(4001, 'Authentication required in production. Provide JWT token via Authorization header.');
        return;
      }
      
      // Development: allow anonymous with warning
      console.warn('[WebSocket] Anonymous connection allowed in development only. Use authentication in production.');
      userId = 'anonymous';
    }

    // ===========================================
    // SECURITY: Authorize Access to Sandbox
    // ===========================================
    
    // Verify user owns this sandbox session
    const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
    const userSession = sandboxBridge.getSessionByUserId(userId);
    
    if (!userSession) {
      console.warn(`[WebSocket] User ${userId} has no active sandbox session`);
      ws.close(4003, 'No active sandbox session');
      return;
    }
    
    // CRITICAL: Verify user is accessing THEIR OWN sandbox
    if (userSession.sessionId !== sessionId || userSession.sandboxId !== sandboxId) {
      console.warn(`[WebSocket] User ${userId} attempted to access unauthorized sandbox ${sandboxId}`);
      ws.close(4003, 'Unauthorized: You do not own this sandbox session');
      return;
    }
    
    console.log(`[WebSocket] User ${userId} authorized for sandbox ${sandboxId}`);

    const sessionKey = `${sessionId}-${userId}`;
    console.log(`[WebSocket] Client connected: ${sessionKey}`);

    // FIX (Bug 6): Track active connections count
    activeWsConnections++;

    // Check if there's an actual PTY connection available for this session
    const hasPty = terminalManager.hasPtyConnection(sessionId);
    if (!hasPty) {
      console.log(`[WebSocket] No PTY available for ${sessionId}, closing so client can fallback`);
      activeWsConnections--; // Decrement before early return
      decrementUserWsCount(userId); // Bug 9: per-user tracking
      ws.send(JSON.stringify({
        type: 'error',
        error: 'PTY not available - using command-mode',
      }));
      setTimeout(() => {
        ws.close(4000, 'PTY not available');
      }, 100);
      return;
    }

    // Register with terminalManager for input API integration
    terminalManager.registerWebSocketConnection(ws, sessionId, sandboxId);

    // Store session
    const session: TerminalSession = {
      sessionId,
      sandboxId,
      userId,
      ws,
      createdAt: Date.now(), // FIX: Track creation time for TTL
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

        // ✅ FIX: Validate message size (max 10KB per message)
        const messageSize = message.toString().length
        const MAX_MESSAGE_SIZE = 10240 // 10KB
        if (messageSize > MAX_MESSAGE_SIZE) {
          console.warn(`[WebSocket] Message too large: ${messageSize} bytes (max: ${MAX_MESSAGE_SIZE})`)
          ws.send(JSON.stringify({
            type: 'error',
            error: `Message too large (max ${MAX_MESSAGE_SIZE / 1024}KB)`
          }))
          return
        }

        switch (msg.type) {
          case 'input':
            // Forward input to sandbox terminal via terminalManager
            console.log(`[WebSocket] Input received: ${msg.data?.substring(0, 50)}...`);
            try {
              await terminalManager.sendInput(sessionId, msg.data);
            } catch (err: any) {
              console.error('[WebSocket] Failed to send input:', err.message);
              ws.send(JSON.stringify({ type: 'error', error: err.message }));
            }
            break;

          case 'resize':
            // Forward resize to sandbox via terminalManager
            console.log(`[WebSocket] Resize: ${msg.cols}x${msg.rows}`);
            try {
              await terminalManager.resizeTerminal(sessionId, msg.cols, msg.rows);
            } catch (err: any) {
              console.error('[WebSocket] Failed to resize:', err.message);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          case 'pong':
            // ✅ FIX: Reset pong timeout when client responds
            if (pongTimeout) {
              clearTimeout(pongTimeout);
              pongTimeout = null;
            }
            break;

          default:
            console.warn(`[WebSocket] Unknown message type: ${msg.type}`);
        }
      } catch (err) {
        console.error('[WebSocket] Error parsing message:', err);
      }
    });

    // ✅ FIX: Keep-alive ping with pong timeout (detect dead connections)
    let pongTimeout: NodeJS.Timeout | null = null;

    // FIX (Bug 6): Shared cleanup function to avoid code duplication and
    // ensure the connection counter is always decremented exactly once.
    let cleanupCalled = false;
    const cleanup = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;

      console.log(`[WebSocket] Client disconnected: ${sessionKey}`);
      terminalSessions.delete(sessionKey);
      terminalManager.unregisterWebSocketConnection(sessionId);
      clearInterval(pingInterval);
      activeWsConnections--; // FIX: Decrement connection counter
      decrementUserWsCount(userId); // Bug 9: per-user tracking
      if (pongTimeout) {
        clearTimeout(pongTimeout);
        pongTimeout = null;
      }
    };

    // Ping interval - sends ping every 30s, expects pong within 60s
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        // Set timeout for pong response - close if no pong within 60s
        if (pongTimeout) {
          clearTimeout(pongTimeout);
        }
        pongTimeout = setTimeout(() => {
          console.warn(`[WebSocket] Pong timeout for ${sessionKey}, closing dead connection`);
          ws.close(4008, 'Pong timeout');
        }, 60000);
      }
    }, 30000);

    ws.on('close', cleanup);
    ws.on('error', (err) => {
      console.error('[WebSocket] Error:', err);
      cleanup();
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket paths: /ws (terminal PTY), /stream-control (LLM control), /vnc-proxy (VNC bridge)`);
  });
});

export default server;
