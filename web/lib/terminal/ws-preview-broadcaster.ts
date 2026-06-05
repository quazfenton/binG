/**
 * WebSocket Preview Broadcaster
 *
 * Subscribes to workspacePreviewRegistry EventEmitter events and broadcasts
 * them to connected dashboard clients over WebSocket. Enables the dashboard UI
 * to show live preview URL popups without polling.
 *
 * Architecture:
 *   workspacePreviewRegistry.emit('preview:registered', preview)
 *     → WsPreviewBroadcaster.onRegistryEvent()
 *       → broadcast to all connected dashboard clients as JSON
 *
 * Connection path: /ws/previews (wired in server.ts upgrade handler)
 *
 * Client protocol:
 *   Send { type: 'subscribe', workspaceId: 'ws-1' } to filter events.
 *   Send { type: 'unsubscribe', workspaceId: 'ws-1' } to stop filtering.
 *   Clients with no subscriptions receive all events (backward compatible).
 *
 * @see lib/terminal/workspace-preview-registry.ts — Event source
 * @see lib/terminal/ws-upgrade-handler.ts — Auth pattern (JWT)
 * @see server.ts — Upgrade handler wiring
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { EventEmitter } from 'node:events';
import { createLogger } from '@/lib/utils/logger';
import { workspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import type { WorkspacePreview } from '@/lib/terminal/workspace-preview-registry';

const logger = createLogger('WsPreviewBroadcaster');

// ============================================================================
// Types
// ============================================================================

/** Message sent to dashboard clients */
export interface PreviewBroadcastMessage {
  type: 'preview:registered' | 'preview:updated' | 'preview:removed' | 'workspace:cleared';
  payload: unknown;
  timestamp: number;
}

/** Connected dashboard client */
interface DashboardClient {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  lastPong: number;
  /** Workspace IDs the client is subscribed to. Empty = receive all events. */
  subscribedWorkspaces: Set<string>;
}

// ============================================================================
// WsPreviewBroadcaster
// ============================================================================

export class WsPreviewBroadcaster extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Set<DashboardClient>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isSubscribed = false;
  private isStarted = false;

  // Config
  private readonly PING_INTERVAL_MS = 30_000;
  private readonly PONG_TIMEOUT_MS = 60_000;
  private readonly MAX_CLIENTS = parseInt(process.env.MAX_PREVIEW_WS_CLIENTS || '200', 10);

  /**
   * Attach the broadcaster's WebSocketServer to an existing HTTP server
   * via the noServer pattern. Call after server creation.
   */
  attachToServer(wss: WebSocketServer): void {
    if (this.isStarted) return;
    this.wss = wss;
    this.isStarted = true;

    wss.on('connection', (ws: WebSocket, req: IncomingMessage, context: any) => {
      this.handleConnection(ws, req, context).catch(err => {
        logger.error('Unhandled error in preview WS connection', { error: err.message });
        try { ws.close(4000, 'Internal error'); } catch { /* ignore */ }
      });
    });

    // Delegate internal WSS events to our own EventEmitter
    wss.on('close', () => {
      this.isStarted = false;
      logger.info('WebSocket server closed');
    });

    // Subscribe to registry events on first connection
    this.subscribeToRegistry();

    // Start keepalive pings
    this.startPingInterval();

    logger.info('WsPreviewBroadcaster attached to WebSocketServer');
  }

  /**
   * Stop the broadcaster and disconnect all clients.
   */
  shutdown(): void {
    this.unsubscribeFromRegistry();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const client of this.clients) {
      try {
        client.ws.close(4001, 'Server shutting down');
      } catch { /* ignore */ }
    }
    this.clients.clear();

    this.isStarted = false;
    logger.info('WsPreviewBroadcaster shutdown');
  }

  /**
   * Get the number of connected dashboard clients.
   */
  getConnectedClients(): number {
    return this.clients.size;
  }

  // ==========================================================================
  // Connection handling
  // ==========================================================================

  private async handleConnection(ws: WebSocket, req: IncomingMessage, context: any): Promise<void> {
    // Validate JWT token
    let userId: string | null = null;
    const token = context?.token as string | null;

    if (token) {
      try {
        const { verifyToken } = await import('@/lib/security/jwt-auth');
        const result = await verifyToken(token);
        if (result.valid && result.payload) {
          userId = result.payload.userId || (result.payload as any).sub || null;
        }
      } catch (err: any) {
        logger.warn('Preview WS token validation failed', { error: err.message });
      }
    }

    // In dev mode, allow anonymous; in production, require auth
    if (!userId) {
      if (process.env.NODE_ENV === 'production') {
        logger.warn('Preview WS: anonymous connections rejected in production');
        ws.close(4001, 'Authentication required for preview dashboard');
        return;
      }
      userId = 'anonymous';
      logger.warn('Preview WS: anonymous connection (dev only)');
    }

    // Enforce client limit
    if (this.clients.size >= this.MAX_CLIENTS) {
      logger.warn(`Preview WS client limit reached (${this.MAX_CLIENTS}), rejecting`);
      ws.close(4004, 'Too many preview dashboard connections');
      return;
    }

    const client: DashboardClient = {
      ws,
      userId,
      connectedAt: Date.now(),
      lastPong: Date.now(),
      subscribedWorkspaces: new Set(),
    };

    this.clients.add(client);

    logger.info('Dashboard client connected', {
      userId,
      totalClients: this.clients.size,
      clientIp: (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || 'unknown',
    });

    // Send initial state — all currently registered previews
    this.sendInitialState(ws);

    // Handle client messages
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'pong':
            client.lastPong = Date.now();
            break;

          case 'subscribe': {
            const wsId: string | undefined = msg.workspaceId;
            if (!wsId) break;
            client.subscribedWorkspaces.add(wsId);
            // Send full snapshot for this workspace
            this.sendWorkspaceSnapshot(ws, wsId);
            logger.debug('Client subscribed to workspace', {
              userId: client.userId,
              workspaceId: wsId,
            });
            break;
          }

          case 'unsubscribe': {
            const wsId: string | undefined = msg.workspaceId;
            if (!wsId) break;
            client.subscribedWorkspaces.delete(wsId);
            logger.debug('Client unsubscribed from workspace', {
              userId: client.userId,
              workspaceId: wsId,
            });
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle disconnect
    ws.on('close', (code: number, reason: Buffer) => {
      this.clients.delete(client);
      logger.info('Dashboard client disconnected', {
        userId,
        code,
        reason: reason?.toString() || 'none',
        remainingClients: this.clients.size,
      });

      // Unsubscribe from registry when no clients remain
      if (this.clients.size === 0) {
        this.unsubscribeFromRegistry();
      }
    });

    ws.on('error', (err: Error) => {
      logger.warn('Dashboard client WebSocket error', {
        userId,
        error: err.message,
      });
      this.clients.delete(client);
    });

    // Subscribe to registry events (idempotent)
    this.subscribeToRegistry();
  }

  // ==========================================================================
  // Registry event subscription
  // ==========================================================================

  private subscribeToRegistry(): void {
    if (this.isSubscribed) return;
    this.isSubscribed = true;

    workspacePreviewRegistry.on('preview:registered', this.onPreviewRegistered);
    workspacePreviewRegistry.on('preview:updated', this.onPreviewUpdated);
    workspacePreviewRegistry.on('preview:removed', this.onPreviewRemoved);
    workspacePreviewRegistry.on('workspace:cleared', this.onWorkspaceCleared);

    logger.debug('Subscribed to workspacePreviewRegistry events');
  }

  private unsubscribeFromRegistry(): void {
    if (!this.isSubscribed) return;
    this.isSubscribed = false;

    workspacePreviewRegistry.off('preview:registered', this.onPreviewRegistered);
    workspacePreviewRegistry.off('preview:updated', this.onPreviewUpdated);
    workspacePreviewRegistry.off('preview:removed', this.onPreviewRemoved);
    workspacePreviewRegistry.off('workspace:cleared', this.onWorkspaceCleared);

    logger.debug('Unsubscribed from workspacePreviewRegistry events');
  }

  // ==========================================================================
  // Event handlers (bound arrow functions for stable listener identity)
  // ==========================================================================

  private onPreviewRegistered = (preview: WorkspacePreview): void => {
    this.broadcast({
      type: 'preview:registered',
      payload: preview,
      timestamp: Date.now(),
    });
  };

  private onPreviewUpdated = (preview: WorkspacePreview): void => {
    this.broadcast({
      type: 'preview:updated',
      payload: preview,
      timestamp: Date.now(),
    });
  };

  private onPreviewRemoved = (data: { preview: WorkspacePreview; workspaceId: string }): void => {
    this.broadcast({
      type: 'preview:removed',
      payload: data,
      timestamp: Date.now(),
    });
  };

  private onWorkspaceCleared = (data: { workspaceId: string }): void => {
    this.broadcast({
      type: 'workspace:cleared',
      payload: data,
      timestamp: Date.now(),
    });
  };

  // ==========================================================================
  // Broadcasting
  // ==========================================================================

  private broadcast(message: PreviewBroadcastMessage): void {
    const data = JSON.stringify(message);
    let sent = 0;
    let failed = 0;

    for (const client of this.clients) {
      // Apply workspace filter: if client has subscriptions, only send matching events
      if (client.subscribedWorkspaces.size > 0) {
        const eventWsId = extractWorkspaceId(message);
        if (eventWsId && !client.subscribedWorkspaces.has(eventWsId)) continue;
      }

      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(data);
          sent++;
        } catch (err) {
          failed++;
          logger.warn('Failed to send to dashboard client', {
            userId: client.userId,
            error: (err as Error).message,
          });
        }
      }
    }

    if (sent > 0) {
      logger.debug(`Broadcast ${message.type} to ${sent} client(s)${failed > 0 ? ` (${failed} failed)` : ''}`);
    }
  }

  /**
   * Send the current state of all workspace previews to a newly connected client.
   */
  private sendInitialState(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const stats = workspacePreviewRegistry.getStats();
    const snapshot = {
      type: 'preview:initial-state',
      stats,
      timestamp: Date.now(),
    };

    try {
      ws.send(JSON.stringify(snapshot));
    } catch (err) {
      logger.warn('Failed to send initial state', { error: (err as Error).message });
    }
  }

  /**
   * Send a full workspace snapshot to a client after subscription.
   */
  private sendWorkspaceSnapshot(ws: WebSocket, workspaceId: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const fullPreviews = workspacePreviewRegistry.getWorkspacePreviews(workspaceId);
    const snapshot = {
      type: 'preview:workspace-snapshot',
      workspaceId,
      previews: fullPreviews,
      activeCount: fullPreviews.filter(p => p.status === 'active').length,
      totalCount: fullPreviews.length,
      timestamp: Date.now(),
    };

    try {
      ws.send(JSON.stringify(snapshot));
    } catch (err) {
      logger.warn('Failed to send workspace snapshot', {
        workspaceId,
        error: (err as Error).message,
      });
    }
  }

  // ==========================================================================
  // Keepalive
  // ==========================================================================

  private startPingInterval(): void {
    if (this.pingInterval) return;

    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const deadClients: DashboardClient[] = [];

      for (const client of this.clients) {
        // Check pong timeout
        if (now - client.lastPong > this.PONG_TIMEOUT_MS) {
          deadClients.push(client);
          continue;
        }

        // Send ping
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.send(JSON.stringify({ type: 'ping', timestamp: now }));
          } catch {
            deadClients.push(client);
          }
        } else if (
          client.ws.readyState === WebSocket.CLOSED ||
          client.ws.readyState === WebSocket.CLOSING
        ) {
          deadClients.push(client);
        }
      }

      // Clean up dead clients
      for (const dead of deadClients) {
        try { dead.ws.terminate(); } catch { /* ignore */ }
        this.clients.delete(dead);
      }

      if (deadClients.length > 0) {
        logger.debug(`Cleaned up ${deadClients.length} dead preview dashboard client(s)`);
      }
    }, this.PING_INTERVAL_MS);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract workspaceId from a broadcast message for filtering. */
function extractWorkspaceId(message: PreviewBroadcastMessage): string | null {
  switch (message.type) {
    case 'preview:registered':
    case 'preview:updated':
      return (message.payload as WorkspacePreview)?.workspaceId ?? null;
    case 'preview:removed':
      return (message.payload as { workspaceId: string })?.workspaceId ?? null;
    case 'workspace:cleared':
      return (message.payload as { workspaceId: string })?.workspaceId ?? null;
    default:
      return null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const wsPreviewBroadcaster = new WsPreviewBroadcaster();
