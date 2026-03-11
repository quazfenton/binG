/**
 * WebSocket Terminal Server
 * Provides xterm.js-compatible WebSocket terminal access
 *
 * SECURITY ENHANCED: JWT authentication required for all connections
 * Migrated from ephemeral/sandbox_api.py WebSocket endpoint
 */

import WebSocket, { WebSocketServer } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'node:events';
import { join } from 'path';
import { createLogger } from '@/lib/utils/logger';
import { verifyToken } from '@/lib/security/jwt-auth';

const logger = createLogger('WebSocketTerminal');

export interface TerminalSession {
  sessionId: string;
  sandboxId: string;
  workspace: string;
  process: ChildProcess;
  createdAt: Date;
  lastActive: Date;
  cols: number;
  rows: number;
}

export class WebSocketTerminalServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, TerminalSession> = new Map();
  private readonly idleTimeout: number;
  private readonly maxSessions: number;

  constructor(
    private port: number = 8080,
    config: { idleTimeout?: number; maxSessions?: number } = {}
  ) {
    super();
    this.idleTimeout = config.idleTimeout || 30 * 60 * 1000; // 30 minutes
    this.maxSessions = config.maxSessions || 100;
  }

  async start(port?: number): Promise<void> {
    if (port) {
      this.port = port;
    }
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          path: '/sandboxes/:sandboxId/terminal',
        });

        this.wss.on('connection', (ws, req) => {
          void this.handleConnection(ws, req);
        });

        this.wss.on('error', (error: any) => {
          // Handle specific error types
          if (error.code === 'EADDRINUSE') {
            const errorMsg = `Port ${this.port} is already in use. ` +
              `Try: 1) lsof -i :${this.port} && kill -9 <PID>, or ` +
              `2) Set WEBSOCKET_PORT to a different value`;
            logger.error(errorMsg);
            this.emit('error', { code: 'PORT_IN_USE', message: errorMsg, originalError: error });
            reject(new Error(errorMsg));
          } else if (error.code === 'EACCES') {
            const errorMsg = `Permission denied for port ${this.port}. Try using a port > 1024 or run with sudo`;
            logger.error(errorMsg);
            this.emit('error', { code: 'PERMISSION_DENIED', message: errorMsg, originalError: error });
            reject(new Error(errorMsg));
          } else {
            logger.error('WebSocket server error', error);
            this.emit('error', error);
            reject(error);
          }
        });

        this.wss.on('listening', () => {
          logger.info(`WebSocket terminal server listening on port ${this.port}`);
          this.emit('started', { port: this.port });
          resolve();
        });

        // Start idle session cleanup
        this.startIdleCleanup();
      } catch (error: any) {
        logger.error('Failed to create WebSocket server', error);
        reject(error);
      }
    });
  }

  private async handleConnection(ws: WebSocket, req: any): Promise<void> {
    // Extract sandboxId from URL path
    const url = new URL(req.url || '', `http://localhost:${this.port}`);
    const pathParts = url.pathname.split('/');
    const sandboxId = pathParts[pathParts.indexOf('sandboxes') + 1];

    logger.debug(`WebSocket connection request for sandbox: ${sandboxId || 'unknown'}`)

    if (!sandboxId) {
      logger.warn('WebSocket connection rejected: Sandbox ID required')
      ws.close(4000, 'Sandbox ID required');
      return
    }

    // SECURITY: Authenticate WebSocket connection
    // JWT token can be passed in:
    // 1. Authorization header (for WebSocket upgrade request)
    // 2. Query parameter: ?token=xxx
    // 3. Subprotocol: ws.open(['Bearer <token>'])
    let token: string | null = null;
    
    // Try query parameter first
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      token = queryToken;
      logger.debug('Token received via query param (less secure)')
    }

    // Try Authorization header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      logger.debug('Token received via Authorization header')
    }

    // Try subprotocol
    if (!token && req.protocol && req.protocol.startsWith('Bearer ')) {
      token = req.protocol.substring(7);
      logger.debug('Token received via WebSocket subprotocol')
    }

    if (!token) {
      logger.warn(`WebSocket connection rejected: No authentication token provided`);
      ws.close(4001, 'Authentication required. Provide JWT token via: 1) ?token=xxx query param, 2) Authorization: Bearer header, or 3) WebSocket subprotocol');
      return;
    }

    // Verify JWT token
    try {
      const payload = verifyToken(token);
      
      // SECURITY: Verify user has permission to access this sandbox
      // For now, any authenticated user can access their own sandboxes
      // In production, add sandbox ownership verification
      const userId = (payload as any).userId || (payload as any).sub;
      if (!userId) {
        logger.warn('WebSocket authentication failed: missing user ID')
        ws.close(4002, 'Invalid token: missing user ID');
        return;
      }

      // SECURITY: Verify sandbox ownership before allowing access
      try {
        const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
        const session = sandboxBridge.getSessionBySandboxId(sandboxId);
        if (!session || session.userId !== userId) {
          logger.warn(`WebSocket authorization failed: user=${userId}, sandbox=${sandboxId}`);
          ws.close(4005, 'Unauthorized: sandbox not owned by user');
          return;
        }
      } catch (error: any) {
        logger.warn(`WebSocket authorization check failed: ${error.message || 'unknown error'}`);
        ws.close(4005, 'Unauthorized: sandbox ownership check failed');
        return;
      }

      logger.info(`WebSocket connection authenticated: user=${userId}, sandbox=${sandboxId}`);

    } catch (error: any) {
      logger.warn(`WebSocket authentication failed: ${error.message}`);
      ws.close(4003, `Authentication failed: ${error.message}`);
      return;
    }

    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      logger.warn(`WebSocket connection rejected: Too many active sessions (${this.sessions.size}/${this.maxSessions})`)
      ws.close(4004, 'Too many active sessions');
      return;
    }

    logger.debug(`Creating terminal session for sandbox ${sandboxId}`)
    this.createTerminalSession(ws, sandboxId);
  }

  private async createTerminalSession(ws: WebSocket, sandboxId: string): Promise<void> {
    const sessionId = `term_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // SECURITY FIX: Do NOT spawn shell on host - route through sandbox provider PTY
    // This prevents authenticated RCE on the host server
    try {
      // Get sandbox handle to access provider PTY
      const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');
      const session = sandboxBridge.getSessionBySandboxId(sandboxId);
      
      if (!session || !session.sandboxHandle) {
        logger.warn(`Sandbox session not found for ${sandboxId}`);
        ws.close(4006, 'Sandbox not found');
        return;
      }
      
      const workspace = session.workspacePath || `/tmp/workspaces/${sandboxId}`;
      logger.debug(`Creating terminal session ${sessionId} for sandbox ${sandboxId}`);

      // Try to get PTY from sandbox handle (provider-specific)
      const pty = await session.sandboxHandle.getPty?.();
      
      if (!pty) {
        // Fallback: Provider doesn't support PTY - send error to client
        logger.warn(`Sandbox provider does not support PTY for ${sandboxId}`);
        ws.send('\r\n\x1b[31mTerminal not available: sandbox provider does not support PTY.\x1b[0m\r\n');
        ws.send('\x1b[90mUse the sandbox terminal UI or connect command instead.\x1b[0m\r\n');
        // Keep connection open but don't spawn shell
        ws.send(`\x1b[1;32m${sandboxId}@binG\x1b[0m:\x1b[1;34m${workspace}\x1b[0m$ `);
        
        // Handle only resize and basic commands
        ws.on('message', (data: Buffer) => {
          const message = data.toString();
          const resizeMatch = message.match(/\x1b\[8;(\d+);(\d+)t/);
          if (resizeMatch) {
            logger.debug(`Terminal resize requested: ${resizeMatch[1]}x${resizeMatch[2]}`);
          }
        });
        
        return;
      }

      const terminalSession: TerminalSession = {
        sessionId,
        sandboxId,
        workspace,
        process: pty as any, // PTY implements similar interface to ChildProcess
        createdAt: new Date(),
        lastActive: new Date(),
        cols: pty.cols || 80,
        rows: pty.rows || 24,
      };

      this.sessions.set(sessionId, terminalSession);
      this.emit('session_created', terminalSession);
      logger.info(`Terminal session ${sessionId} established via provider PTY`);

      // Handle PTY output
      pty.onData?.((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
        terminalSession.lastActive = new Date();
      });

      // Handle PTY exit
      pty.onExit?.(() => {
        logger.debug(`Terminal session ${sessionId} PTY exit`);
        this.emit('session_exit', { sessionId, code: 0, signal: undefined });
        this.closeSession(sessionId);
      });

      // Handle WebSocket messages - forward to PTY
      ws.on('message', (data: Buffer) => {
        logger.debug(`WebSocket message received for session ${sessionId}: ${data.length} bytes`);
        this.handleMessage(terminalSession, data);
      });

      // Handle WebSocket close
      ws.on('close', (code, reason) => {
        logger.info(`WebSocket connection closed for session ${sessionId}: code=${code}`);
        this.emit('session_closed', { sessionId, code, reason });
        this.closeSession(sessionId);
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        logger.error(`WebSocket error for session ${sessionId}: ${error.message}`);
        this.emit('session_error', { sessionId, error });
        this.closeSession(sessionId);
      });

      // Send initial prompt
      ws.send(`\x1b[1;32m${sandboxId}@binG\x1b[0m:\x1b[1;34m${workspace}\x1b[0m$ `);

    } catch (error: any) {
      logger.error(`Failed to create terminal session: ${error.message}`);
      ws.close(4002, `Failed to create terminal: ${error.message}`);
      this.emit('session_create_error', { sandboxId, error });
    }
  }

  private handleMessage(session: TerminalSession, data: Buffer): void {
    const message = data.toString();

    // Handle PTY resize (xterm.js sends resize commands)
    // Format: \x1b[8;ROWS;COLSt (ANSI escape sequence for resize)
    const resizeMatch = message.match(/\x1b\[8;(\d+);(\d+)t/);
    if (resizeMatch) {
      const [, rows, cols] = resizeMatch;
      session.rows = parseInt(rows, 10);
      session.cols = parseInt(cols, 10);

      // Resize PTY if method exists
      if ((session.process as any).resize) {
        try {
          (session.process as any).resize({ cols, rows });
        } catch (e) {
          logger.debug(`Failed to resize PTY: ${e}`);
        }
      }

      logger.debug(`Terminal resized to ${cols}x${rows}`);
      return;
    }

    // Handle JSON resize command from frontend
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'resize') {
        session.rows = parsed.rows || 24;
        session.cols = parsed.cols || 80;

        // Resize PTY if method exists
        if ((session.process as any).resize) {
          try {
            (session.process as any).resize({ cols: session.cols, rows: session.rows });
          } catch (e) {
            logger.debug(`Failed to resize PTY: ${e}`);
          }
        }

        logger.debug(`Terminal resized to ${session.cols}x${session.rows}`);
        return;
      }
      
      // Handle input via PTY
      if (parsed.type === 'input' && (session.process as any).write) {
        (session.process as any).write(parsed.data);
        return;
      }
    } catch (e) {
      // Not JSON, treat as raw input for PTY
    }

    // Handle special commands
    if (message.startsWith('\x03')) {
      // Ctrl+C - send interrupt signal
      if ((session.process as any).kill) {
        (session.process as any).kill('SIGINT');
      }
      return;
    }

    if (message.startsWith('\x04')) {
      // Ctrl+D - close session
      this.closeSession(session.sessionId);
      return;
    }

    // Forward input to PTY
    if ((session.process as any).write) {
      (session.process as any).write(message);
    }

    session.lastActive = new Date();
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.debug(`Session ${sessionId} not found for cleanup`);
      return;
    }

    logger.info(`Closing terminal session ${sessionId}`);

    // Terminate PTY process
    try {
      if ((session.process as any).kill) {
        (session.process as any).kill();
        logger.debug(`PTY terminated for session ${sessionId}`);
      }
    } catch (error: any) {
      logger.debug(`PTY already terminated for session ${sessionId}: ${error.message}`);
    }

    this.sessions.delete(sessionId);
    logger.info(`Terminal session ${sessionId} closed. Active sessions: ${this.sessions.size}`);
    this.emit('session_terminated', session);
  }

  private startIdleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let closedCount = 0;
      for (const [sessionId, session] of this.sessions.entries()) {
        const idleTime = now - session.lastActive.getTime();
        if (idleTime > this.idleTimeout) {
          logger.info(`Session ${sessionId} idle timeout (${Math.round(idleTime/1000)}s > ${this.idleTimeout/1000}s)`)
          this.emit('session_idle_timeout', session);
          this.closeSession(sessionId);
          closedCount++;
        }
      }
      if (closedCount > 0) {
        logger.info(`Idle cleanup: closed ${closedCount} session(s)`)
      }
    }, 60 * 1000); // Check every minute
  }

  async stop(): Promise<void> {
    logger.info(`Stopping WebSocket terminal server, closing ${this.sessions.size} active session(s)`)
    
    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }

    // Close WebSocket server
    return new Promise((resolve, reject) => {
      if (this.wss) {
        this.wss.close((error) => {
          if (error) {
            logger.error(`WebSocket server stop failed: ${error.message}`)
            reject(error);
          } else {
            logger.info('WebSocket server stopped')
            this.emit('stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  getActiveSessions(): number {
    return this.sessions.size;
  }

  getSession(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId) || null;
  }

  listSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }
}

// Singleton instance
export const webSocketTerminalServer = new WebSocketTerminalServer();
