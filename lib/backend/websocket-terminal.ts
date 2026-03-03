/**
 * WebSocket Terminal Server
 * Provides xterm.js-compatible WebSocket terminal access
 * Migrated from ephemeral/sandbox_api.py WebSocket endpoint
 */

import WebSocket, { WebSocketServer } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';

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

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          path: '/sandboxes/:sandboxId/terminal',
        });

        this.wss.on('connection', (ws, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on('error', (error) => {
          this.emit('error', error);
          reject(error);
        });

        this.wss.on('listening', () => {
          this.emit('started', { port: this.port });
          resolve();
        });

        // Start idle session cleanup
        this.startIdleCleanup();
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleConnection(ws: WebSocket, req: any): void {
    // Extract sandboxId from URL path
    const url = new URL(req.url || '', `http://localhost:${this.port}`);
    const pathParts = url.pathname.split('/');
    const sandboxId = pathParts[pathParts.indexOf('sandboxes') + 1];

    if (!sandboxId) {
      ws.close(4000, 'Sandbox ID required');
      return;
    }

    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      ws.close(4001, 'Too many active sessions');
      return;
    }

    this.createTerminalSession(ws, sandboxId);
  }

  private async createTerminalSession(ws: WebSocket, sandboxId: string): Promise<void> {
    const sessionId = `term_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const workspace = join('/tmp/workspaces', sandboxId);

    try {
      // Spawn bash process in sandbox workspace
      const proc = spawn('/bin/bash', {
        cwd: workspace,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const session: TerminalSession = {
        sessionId,
        sandboxId,
        workspace,
        process: proc,
        createdAt: new Date(),
        lastActive: new Date(),
        cols: 80,
        rows: 24,
      };

      this.sessions.set(sessionId, session);
      this.emit('session_created', session);

      // Handle process stdout
      proc.stdout?.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
        session.lastActive = new Date();
      });

      // Handle process stderr
      proc.stderr?.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
        session.lastActive = new Date();
      });

      // Handle process exit
      proc.on('exit', (code, signal) => {
        this.emit('session_exit', { sessionId, code, signal });
        this.closeSession(sessionId);
      });

      // Handle WebSocket messages
      ws.on('message', (data: Buffer) => {
        this.handleMessage(session, data);
      });

      // Handle WebSocket close
      ws.on('close', (code, reason) => {
        this.emit('session_closed', { sessionId, code, reason });
        this.closeSession(sessionId);
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        this.emit('session_error', { sessionId, error });
        this.closeSession(sessionId);
      });

      // Send initial prompt
      ws.send(`\x1b[1;32m${sandboxId}@binG\x1b[0m:\x1b[1;34m${workspace}\x1b[0m$ `);

    } catch (error: any) {
      ws.close(4002, `Failed to create terminal: ${error.message}`);
      this.emit('session_create_error', { sandboxId, error });
    }
  }

  private handleMessage(session: TerminalSession, data: Buffer): void {
    const message = data.toString();
    
    // Handle special commands
    if (message.startsWith('\x03')) {
      // Ctrl+C - send interrupt signal
      session.process.kill('SIGINT');
      return;
    }

    if (message.startsWith('\x04')) {
      // Ctrl+D - close session
      this.closeSession(session.sessionId);
      return;
    }

    // Handle resize commands (ANSI escape sequences)
    if (message.includes('\x1b[8;')) {
      const match = message.match(/\x1b\[8;(\d+);(\d+)t/);
      if (match) {
        session.rows = parseInt(match[1]);
        session.cols = parseInt(match[2]);
        this.emit('session_resize', session);
      }
    }

    // Forward input to process
    if (session.process.stdin?.writable) {
      session.process.stdin.write(message);
    }

    session.lastActive = new Date();
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Terminate process
    if (session.process.pid) {
      try {
        process.kill(-session.process.pid, 'SIGTERM');
      } catch (error) {
        // Process already dead
      }
    }

    this.sessions.delete(sessionId);
    this.emit('session_terminated', session);
  }

  private startIdleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions.entries()) {
        const idleTime = now - session.lastActive.getTime();
        if (idleTime > this.idleTimeout) {
          this.emit('session_idle_timeout', session);
          this.closeSession(sessionId);
        }
      }
    }, 60 * 1000); // Check every minute
  }

  async stop(): Promise<void> {
    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }

    // Close WebSocket server
    return new Promise((resolve, reject) => {
      if (this.wss) {
        this.wss.close((error) => {
          if (error) {
            reject(error);
          } else {
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
