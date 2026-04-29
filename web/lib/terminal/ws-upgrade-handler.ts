/**
 * WebSocket Upgrade Handler
 *
 * Extracted from server.ts for testability and single-responsibility.
 * Handles authentication and authorization for terminal WebSocket connections.
 *
 * Fixes applied:
 * - Bug 1: await verifyToken (was missing, causing JWT auth to always fail)
 * - Bug 2: use storeGetSessionByUserId directly (sandboxBridge had no such method)
 * - Bug 9: per-user WS connection tracking to prevent single-user DoS
 */

import type { IncomingMessage } from 'http';
import type { WebSocket, WebSocketServer } from 'ws';
import type { Socket } from 'net';

// Per-user WS connection counter (Bug 9)
const userWsConnections = new Map<string, number>();
const MAX_WS_PER_USER = parseInt(process.env.MAX_WS_PER_USER || '10', 10);

export function getUserWsCount(userId: string): number {
  return userWsConnections.get(userId) ?? 0;
}

export function incrementUserWsCount(userId: string): void {
  userWsConnections.set(userId, (userWsConnections.get(userId) ?? 0) + 1);
}

export function decrementUserWsCount(userId: string): void {
  const current = userWsConnections.get(userId) ?? 0;
  const next = current - 1;
  if (next <= 0) {
    userWsConnections.delete(userId);
  } else {
    userWsConnections.set(userId, next);
  }
}

export interface WsAuthResult {
  userId: string;
  isAuthenticated: boolean;
}

/**
 * Authenticate a WebSocket connection.
 *
 * Priority order:
 *  1. JWT from Authorization header or Sec-WebSocket-Protocol
 *  2. Anonymous session cookie (dev only)
 *
 * BUG FIX (Bug 1): verifyToken is async — must be awaited.
 * The original code called verifyToken(token) synchronously, receiving a
 * Promise object. Since a Promise is always truthy, the userId check
 * `(payload as any).userId` on a Promise returned undefined, causing every
 * JWT-authenticated connection to be rejected.
 */
export async function authenticateWsConnection(
  token: string | null,
  anonymousSessionId: string,
): Promise<WsAuthResult | null> {
  // --- Priority 1: JWT ---
  if (token) {
    try {
      const { verifyToken } = await import('@/lib/security/jwt-auth');
      // BUG FIX: await the async verifyToken call
      const result = await verifyToken(token);

      if (!result.valid || !result.payload) {
        console.warn('[WsAuth] Token invalid:', result.error);
        return null;
      }

      const userId = result.payload.userId || (result.payload as any).sub;
      if (!userId) {
        console.warn('[WsAuth] Token missing userId claim');
        return null;
      }

      return { userId, isAuthenticated: true };
    } catch (err: any) {
      console.warn('[WsAuth] Token validation threw:', err.message);
      return null;
    }
  }

  // --- Priority 2: Anonymous session cookie ---
  if (anonymousSessionId) {
    const { getDatabaseSessionStore } = await import('@/lib/database/session-store');
    const store = getDatabaseSessionStore();
    const session = store.getSession(anonymousSessionId);
    if (session && (session as any).userId) {
      return { userId: (session as any).userId, isAuthenticated: false };
    }
  }

  return null;
}

/**
 * Authorize that userId owns the requested sandbox session.
 *
 * BUG FIX (Bug 2): The original code called sandboxBridge.getSessionByUserId(userId)
 * but SandboxServiceBridge does not expose that method — it would throw
 * "TypeError: sandboxBridge.getSessionByUserId is not a function".
 * The correct function is storeGetSessionByUserId from storage/session-store.
 */
export async function authorizeWsSandboxAccess(
  userId: string,
  sessionId: string,
  sandboxId: string,
): Promise<boolean> {
  const { getSessionByUserId } = await import('@/lib/storage/session-store');
  const userSession = getSessionByUserId(userId);

  if (!userSession) {
    console.warn(`[WsAuth] User ${userId} has no active sandbox session`);
    return false;
  }

  if (userSession.sessionId !== sessionId || userSession.sandboxId !== sandboxId) {
    console.warn(`[WsAuth] User ${userId} attempted to access unauthorized sandbox ${sandboxId}`);
    return false;
  }

  return true;
}

/**
 * Handle a terminal WebSocket upgrade request end-to-end.
 * Called from server.ts for /ws and /api/sandbox/terminal/ws paths.
 */
export async function handleTerminalWsUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  wss: WebSocketServer,
  query: Record<string, string | string[] | undefined>,
  activeWsConnections: { count: number },
  maxWsConnections: number,
): Promise<void> {
  const sessionId = query.sessionId as string;
  const sandboxId = query.sandboxId as string;

  if (!sessionId || !sandboxId) {
    console.warn('[WsUpgrade] Missing sessionId or sandboxId');
    socket.destroy();
    return;
  }

  // Extract token — header > subprotocol > query param (deprecated)
  let token: string | null = null;
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  if (!token) {
    const proto = req.headers['sec-websocket-protocol'];
    const p = Array.isArray(proto) ? proto[0] : proto;
    if (p?.startsWith('Bearer ')) token = p.substring(7);
  }
  if (!token && query.token) {
    console.warn('[WsUpgrade] Token via query param is insecure; use Authorization header.');
    token = query.token as string;
  }

  const anonymousSessionId =
    req.headers.cookie?.match(/anon-session-id=([^;]+)/)?.[1] ?? '';

  // Global connection cap
  if (activeWsConnections.count >= maxWsConnections) {
    console.warn(`[WsUpgrade] Global connection limit (${maxWsConnections}) reached`);
    socket.destroy();
    return;
  }

  // Authenticate
  const authResult = await authenticateWsConnection(token, anonymousSessionId);

  if (!authResult) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[WsUpgrade] Unauthenticated connection rejected (production)');
      socket.destroy();
      return;
    }
    // Dev-only anonymous fallback
    console.warn('[WsUpgrade] Anonymous connection (dev only)');
  }

  const userId = authResult?.userId ?? 'anonymous';

  // Per-user connection cap (Bug 9)
  if (getUserWsCount(userId) >= MAX_WS_PER_USER) {
    console.warn(`[WsUpgrade] Per-user WS limit (${MAX_WS_PER_USER}) reached for ${userId}`);
    socket.destroy();
    return;
  }

  // Authorize sandbox ownership
  const authorized = await authorizeWsSandboxAccess(userId, sessionId, sandboxId);
  if (!authorized) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, {
      sessionId,
      sandboxId,
      userId,
      isAuthenticated: authResult?.isAuthenticated ?? false,
    });
  });
}
