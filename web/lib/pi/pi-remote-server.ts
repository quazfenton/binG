/**
 * Pi Remote Server
 * 
 * HTTP server that provides Pi agent access over REST API.
 * Can be spawned as a subprocess or run in a container.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import type { PiSession, PiEvent, PiPromptOptions } from './pi-types';
import { findPiBinarySync } from '@/lib/agent-bins/find-pi-binary';

interface SessionState {
  session: PiSession;
  cwd: string;
  created: number;
}

interface RemoteConfig {
  port?: number;
  host?: string;
  piBinary?: string;
}

const sessions = new Map<string, SessionState>();
let requestId = 0;
let config: RemoteConfig = {};

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function createSession(cwd: string, noSession: boolean): PiSession {
  const piBin = config.piBinary || findPiBinarySync() || 'pi';
  const sessionId = `session-${++requestId}`;

  // Spawn a real pi subprocess for this session
  const args = ['--mode', 'rpc', '--no-session'];
  const command = process.platform === 'win32' && piBin === 'pi' ? 'npx' : piBin;
  const commandArgs = command === 'npx' ? ['pi', ...args] : args;

  let proc: ChildProcess | null = null;
  try {
    proc = spawn(command, commandArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (err) {
    console.error('[Pi Remote] Failed to spawn pi:', err);
  }

  return {
    sessionId,
    isStreaming: false,
    async prompt(message: string, options?: PiPromptOptions) {
      if (!proc?.stdin?.writable) return;
      proc.stdin.write(JSON.stringify({ type: 'prompt', message, id: sessionId }) + '\n');
    },
    async steer(message: string) {
      if (!proc?.stdin?.writable) return;
      proc.stdin.write(JSON.stringify({ type: 'steer', message, id: sessionId }) + '\n');
    },
    async followUp(message: string) {
      if (!proc?.stdin?.writable) return;
      proc.stdin.write(JSON.stringify({ type: 'follow_up', message, id: sessionId }) + '\n');
    },
    subscribe(listener: (event: PiEvent) => void): () => void {
      // TODO: Parse JSONL from proc.stdout and emit events
      return () => {};
    },
    async abort() {
      if (!proc?.stdin?.writable) return;
      proc.stdin.write(JSON.stringify({ type: 'abort', id: sessionId }) + '\n');
    },
    async getState() {
      return {
        model: null,
        thinkingLevel: 'medium',
        isStreaming: false,
        isCompacting: false,
        sessionFile: null,
        sessionId,
        messageCount: 0,
      };
    },
    async getMessages() {
      return [];
    },
    async cycleModel() {},
    async cycleThinkingLevel() {},
    async compact() {},
    dispose() {
      proc?.kill();
      proc = null;
    },
  };
}

export async function startRemoteServer(configParam: RemoteConfig = {}) {
  config = configParam; // Store for use in createSession()
  const { port = 3456, host = 'localhost' } = config;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }

    try {
      const path = url.pathname;
      const body = await parseBody(req) as Record<string, unknown>;
      const sessionId = body.sessionId as string;

      // Routes
      if (path === '/session/create' && req.method === 'POST') {
        const cwd = (body.cwd as string) || '/workspace';
        const noSession = body.noSession as boolean || false;
        
        const session = createSession(cwd, noSession);
        sessions.set(session.sessionId, {
          session,
          cwd,
          created: Date.now(),
        });

        json(res, 200, { sessionId: session.sessionId, success: true });
        return;
      }

      if (path === '/session/dispose' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (state) {
          state.session.dispose();
          sessions.delete(sessionId);
        }
        json(res, 200, { success: true });
        return;
      }

      if (path === '/prompt' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        const message = body.message as string;
        const streamingBehavior = body.streamingBehavior as string | undefined;

        await state.session.prompt(message, { streamingBehavior });
        json(res, 200, { success: true });
        return;
      }

      if (path === '/steer' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        await state.session.steer(body.message as string);
        json(res, 200, { success: true });
        return;
      }

      if (path === '/follow_up' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        await state.session.followUp(body.message as string);
        json(res, 200, { success: true });
        return;
      }

      if (path === '/abort' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (state) {
          await state.session.abort();
        }
        json(res, 200, { success: true });
        return;
      }

      if (path === '/get_state' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        const state_ = await state.session.getState();
        json(res, 200, state_);
        return;
      }

      if (path === '/get_messages' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        const messages = await state.session.getMessages();
        json(res, 200, { messages });
        return;
      }

      if (path === '/cycle_model' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (state) {
          await state.session.cycleModel();
        }
        json(res, 200, { success: true });
        return;
      }

      if (path === '/cycle_thinking_level' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (state) {
          await state.session.cycleThinkingLevel();
        }
        json(res, 200, { success: true });
        return;
      }

      if (path === '/compact' && req.method === 'POST') {
        const state = sessions.get(sessionId);
        if (state) {
          await state.session.compact();
        }
        json(res, 200, { success: true });
        return;
      }

      // Event stream endpoint
      if (path.startsWith('/events/')) {
        const sid = path.slice('/events/'.length);
        const state = sessions.get(sid);
        
        if (!state) {
          json(res, 404, { error: 'Session not found' });
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const unsubscribe = state.session.subscribe((event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        });

        req.on('close', () => {
          unsubscribe();
        });
        return;
      }

      // 404
      json(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[Pi Remote] Error:', err);
      json(res, 500, { error: (err as Error).message });
    }
  });

  return new Promise<{ url: string }>((resolve) => {
    server.listen(port, host, () => {
      console.log(`[Pi Remote] Server running at http://${host}:${port}`);
      resolve({ url: `http://${host}:${port}` });
    });
  });
}

// CLI entry point — guard for ESM where require.main is undefined
if (typeof require !== 'undefined' && require.main === module) {
  const port = parseInt(process.env.PORT || '3456', 10);
  startRemoteServer({ port }).catch(console.error);
}