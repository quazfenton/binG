/**
 * Stream Control WebSocket Handler (for server.ts integration)
 *
 * Handles /stream-control WebSocket upgrades within the existing Next.js HTTP server.
 * No separate port needed — runs alongside SSE on the same port.
 *
 * Usage in server.ts upgrade handler:
 *   if (pathname === '/stream-control') {
 *     await handleStreamControlUpgrade(wss, req, socket, head);
 *   }
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import * as jsonwebtoken from 'jsonwebtoken';
import { streamStateManager } from './stream-state-manager';
import { getJwtSecret } from './auth/jwt';
import { chatLogger } from './chat/chat-logger';

const logger = chatLogger.child({ component: 'stream-control-ws' });

// =========================================================================
// Types
// =========================================================================

type ControlMessageType =
  | 'pause' | 'resume' | 'continue' | 'abort'
  | 'ping' | 'request_state' | 'set_max_tokens';

interface ControlMessage {
  type: ControlMessageType;
  streamId?: string;
  payload?: Record<string, unknown>;
}

interface ControlResponse {
  type: 'ack' | 'stream_complete' | 'need_more_turns' | 'state' | 'pong' | 'error' | 'heartbeat';
  streamId?: string;
  payload?: Record<string, unknown>;
  error?: string;
}

interface StreamControlSession {
  sessionId: string;
  streamId: string;
  userId: string;
  ws: WebSocket;
  connectedAt: number;
  lastActivity: number;
  paused: boolean;
  pingInterval: NodeJS.Timeout;
}

// =========================================================================
// Session Registry
// =========================================================================

const sessions = new Map<string, StreamControlSession>();
const sessionsByStreamId = new Map<string, StreamControlSession>();

export function notifyNeedMoreTurns(
  streamId: string,
  contextHint?: string,
  options?: {
    toolSummary?: string;
    toolCount?: number;
    implicitFiles?: string[];
    fileRequestConfidence?: string;
  }
): void {
  const session = sessionsByStreamId.get(streamId);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  sendToSession(session, {
    type: 'need_more_turns',
    streamId,
    payload: {
      contextHint,
      toolSummary: options?.toolSummary,
      toolCount: options?.toolCount,
      implicitFiles: options?.implicitFiles,
      fileRequestConfidence: options?.fileRequestConfidence,
    },
  });
}

export function notifyStreamComplete(streamId: string): void {
  const session = sessionsByStreamId.get(streamId);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;
  const state = streamStateManager.get(streamId);
  sendToSession(session, {
    type: 'stream_complete',
    streamId,
    payload: {
      tokenCount: state?.tokenCount || 0,
      contentLength: state?.contentLength || 0,
      toolCalls: state?.toolCalls?.length || 0,
      finishReason: state?.finishReason,
    },
  });
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function hasActiveControl(streamId: string): boolean {
  const s = sessionsByStreamId.get(streamId);
  return !!s && s.ws.readyState === WebSocket.OPEN;
}

export function getStats() {
  return {
    sessions: sessions.size,
    streamStates: streamStateManager.getStats(),
  };
}

// =========================================================================
// Upgrade Handler
// =========================================================================

const wss = new WebSocketServer({ noServer: true });

export async function handleStreamControlUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  const streamId = url.searchParams.get('streamId');
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : url.searchParams.get('token'); // Legacy fallback

  if (!token) {
    logger.warn('Connection rejected: no token', { remoteAddress: req.socket?.remoteAddress, streamId });
    socket.destroy();
    return;
  }

  const userId = await verifyAuthToken(token);
  if (!userId) {
    logger.warn('Connection rejected: invalid token', { remoteAddress: req.socket?.remoteAddress, streamId });
    socket.destroy();
    return;
  }

  if (!streamId) {
    logger.warn('Connection rejected: missing streamId', { userId });
    socket.destroy();
    return;
  }

  // Clean up any existing session for this streamId (reconnect)
  const existing = sessionsByStreamId.get(streamId);
  if (existing) {
    logger.info('Closing existing session for reconnect', { streamId, oldSession: existing.sessionId });
    if (existing.ws.readyState === WebSocket.OPEN) {
      existing.ws.close(4009, 'Replaced by new connection');
    }
    clearInterval(existing.pingInterval);
    sessions.delete(existing.sessionId);
    sessionsByStreamId.delete(streamId);
  }

  // Perform the upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, Object.assign({}, req, { userId, streamId }));
  });
}

// =========================================================================
// Connection Handler
// =========================================================================

wss.on('connection', (ws: WebSocket, req: IncomingMessage & { userId: string; streamId: string }) => {
  const { userId, streamId } = req;
  const sessionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const session: StreamControlSession = {
    sessionId,
    streamId,
    userId,
    ws,
    connectedAt: Date.now(),
    lastActivity: Date.now(),
    paused: false,
    pingInterval: setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000),
  };

  sessions.set(sessionId, session);
  sessionsByStreamId.set(streamId, session);

  logger.debug('Client connected', { sessionId, streamId, userId });

  // Welcome message
  sendToSession(session, {
    type: 'ack',
    streamId,
    payload: { sessionId, message: 'Stream control connected' },
  });

  ws.on('message', (data: RawData) => {
    session.lastActivity = Date.now();
    try {
      const msg: ControlMessage = JSON.parse(data.toString());
      handleMessage(session, msg);
    } catch {
      sendToSession(session, { type: 'error', error: 'Invalid JSON' });
    }
  });

  ws.on('close', () => {
    clearInterval(session.pingInterval);
    sessions.delete(sessionId);
    sessionsByStreamId.delete(streamId);
    logger.debug('Client disconnected', { sessionId, streamId });
  });

  ws.on('error', (err) => {
    logger.error('Client error', { sessionId, streamId, error: err.message });
  });
});

// =========================================================================
// Message Handler
// =========================================================================

async function handleMessage(session: StreamControlSession, msg: ControlMessage): Promise<void> {
  switch (msg.type) {
    case 'pause': {
      if (session.paused) {
        sendAck(session, 'already_paused');
        return;
      }
      session.paused = true;
      streamStateManager.pause(session.streamId);
      sendAck(session, 'paused');
      logger.info('Stream paused', { streamId: session.streamId });
      break;
    }

    case 'resume': {
      if (!session.paused) {
        sendAck(session, 'not_paused');
        return;
      }
      session.paused = false;
      streamStateManager.resume(session.streamId);
      sendAck(session, 'resumed');
      logger.info('Stream resumed', { streamId: session.streamId });
      break;
    }

    case 'continue': {
      const state = streamStateManager.get(session.streamId);
      if (!state) {
        sendError(session, `Stream not found: ${session.streamId}`);
        return;
      }
      if (state.isComplete) {
        sendError(session, 'Stream is already complete. Cannot continue.');
        return;
      }
      if (state.continuationCount >= state.maxContinuations) {
        sendError(session, `Maximum continuations reached (${state.maxContinuations}).`);
        return;
      }
      try {
        await streamStateManager.triggerContinue(session.streamId, msg.payload);
        sendToSession(session, {
          type: 'ack',
          streamId: session.streamId,
          payload: { action: 'continuing', continuationCount: state.continuationCount + 1 },
        });
      } catch (e: any) {
        sendError(session, `Failed to trigger continue: ${e.message}`);
      }
      break;
    }

    case 'abort': {
      session.paused = false;
      streamStateManager.abort(session.streamId);
      sendAck(session, 'aborted');
      logger.info('Stream aborted', { streamId: session.streamId });
      break;
    }

    case 'ping':
      sendToSession(session, { type: 'pong' });
      break;

    case 'request_state': {
      const state = streamStateManager.get(session.streamId);
      sendToSession(session, {
        type: 'state',
        streamId: session.streamId,
        payload: {
          paused: session.paused,
          state: session.paused ? 'paused' : 'streaming',
          streamState: state ? {
            status: state.status,
            tokenCount: state.tokenCount,
            contentLength: state.contentLength,
            toolCalls: state.toolCalls?.length,
            isComplete: state.isComplete,
            continuationCount: state.continuationCount,
            maxContinuations: state.maxContinuations,
          } : null,
        },
      });
      break;
    }

    case 'set_max_tokens': {
      const maxTokens = msg.payload?.maxTokens as number | undefined;
      if (!maxTokens || maxTokens <= 0 || maxTokens > 1048576) {
        sendError(session, `Invalid maxTokens: ${maxTokens}. Must be 1-1048576.`);
        return;
      }
      streamStateManager.setMaxTokens(session.streamId, maxTokens);
      sendToSession(session, {
        type: 'ack',
        streamId: session.streamId,
        payload: { action: 'max_tokens_updated', maxTokens },
      });
      break;
    }

    default:
      sendError(session, `Unknown type: "${msg.type}"`);
  }
}

// =========================================================================
// Helpers
// =========================================================================

async function verifyAuthToken(token: string): Promise<string | null> {
  try {
    const decoded = jsonwebtoken.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      issuer: 'bing-app',
      audience: 'bing-users',
    }) as { userId: string };
    return decoded.userId || null;
  } catch {
    return null;
  }
}

function sendToSession(session: StreamControlSession, msg: ControlResponse): void {
  if (session.ws.readyState !== WebSocket.OPEN) return;
  try {
    session.ws.send(JSON.stringify(msg));
  } catch (e: any) {
    logger.error('Failed to send message', { sessionId: session.sessionId, error: e.message });
  }
}

function sendAck(session: StreamControlSession, action: string): void {
  sendToSession(session, { type: 'ack', streamId: session.streamId, payload: { action } });
}

function sendError(session: StreamControlSession, error: string): void {
  sendToSession(session, { type: 'error', error });
}
