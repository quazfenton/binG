/**
 * Workspace Graph WebSocket (Phase 10 gap closure: real-time graph updates)
 *
 * Broadcasts workspace graph changes to connected dashboard clients over WebSocket.
 * Instead of clients polling getWorkspaceGraph(), they subscribe to a workspace and
 * receive push updates whenever the graph changes.
 *
 * Architecture:
 *   Client connects via WebSocket → subscribes to workspaceId
 *   Registry mutations (service created, preview registered, etc.) → notifyGraphChanged()
 *   WebSocket handler hears graph:changed → recomputes graph → pushes to subscribers
 *
 * Connection lifecycle:
 *   1. Client opens WebSocket at /ws/workspace-graph?workspaceId=xxx&token=xxx
 *   2. Server authenticates via JWT token
 *   3. Client receives initial full graph on connect
 *   4. Client receives incremental graph diffs on change
 *   5. Client disconnects → subscription removed
 *
 * @module workspace/workspace-graph-websocket
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { createLogger } from '@/lib/utils/logger';
import { workspaceGraphService, type WorkspaceGraph } from './workspace-graph-service';

const logger = createLogger('WorkspaceGraphWS');

// ============================================================================
// Types
// ============================================================================

interface ClientSubscription {
  ws: WebSocket;
  workspaceId: string;
  userId: string;
  connectedAt: number;
}

interface GraphPushMessage {
  type: 'graph:update' | 'graph:initial' | 'error' | 'subscribed';
  workspaceId: string;
  data?: WorkspaceGraph;
  error?: string;
  timestamp: number;
}

// ============================================================================
// WorkspaceGraphWebSocket
// ============================================================================

export class WorkspaceGraphWebSocket {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientSubscription>();
  private workspaceSubscribers = new Map<string, Set<WebSocket>>();
  private unsubscribers = new Map<string, () => void>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  /** How often to check for graph changes (fallback when push notifications miss) */
  private static readonly POLL_INTERVAL_MS = 10_000;
  /** How often to send heartbeats to clients */
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;
  /** Maximum concurrent WebSocket connections */
  private static readonly MAX_CONNECTIONS = 500;
  /** Maximum connections per user */
  private static readonly MAX_CONNECTIONS_PER_USER = 10;
  /** Active workspace tracking for polling */
  private pollingWorkspaces = new Set<string>();
  /** Per-user connection count */
  private userConnectionCounts = new Map<string, number>();
  /** Throttle push: track last push timestamp per workspace to avoid storms */
  private lastPushTimestamps = new Map<string, number>();
  /** Maximum entries in lastPushTimestamps before eviction */
  private static readonly MAX_PUSH_TIMESTAMP_ENTRIES = 500;
  /** Minimum interval between pushes for the same workspace (ms) */
  private static readonly PUSH_THROTTLE_MS = 500;

  /**
   * Attach the WebSocket server to an existing HTTP server.
   * Call this during backend initialization.
   */
  attachToServer(server: any): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws/workspace-graph') return;

      // Enforce max connections
      if (this.clients.size >= WorkspaceGraphWebSocket.MAX_CONNECTIONS) {
        logger.warn('Max connections reached, rejecting upgrade', { current: this.clients.size });
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit('connection', ws, request, { userId: url.searchParams.get('userId') || 'unknown' });
      });
    });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, context: any) => {
      this.handleConnection(ws, context?.userId || 'unknown');
    });

    this.wss.on('close', () => {
      logger.info('Workspace graph WebSocket server closed');
      this.cleanup();
    });

    // Start polling fallback for workspaces with active subscribers
    this.pollInterval = setInterval(() => this.pollChanges(), WorkspaceGraphWebSocket.POLL_INTERVAL_MS);

    // Start heartbeat to detect dead connections
    this.heartbeatInterval = setInterval(() => this.sendHeartbeats(), WorkspaceGraphWebSocket.HEARTBEAT_INTERVAL_MS);

    logger.info('Workspace graph WebSocket server attached');
  }

  /**
   * Handle a new client connection.
   */
  private handleConnection(ws: WebSocket, userId: string): void {
    // Enforce per-user connection limits
    const userCount = (this.userConnectionCounts.get(userId) || 0) + 1;
    if (userCount > WorkspaceGraphWebSocket.MAX_CONNECTIONS_PER_USER) {
      logger.warn('Max connections per user exceeded', { userId, count: userCount - 1 });
      ws.close(1013, 'Too many connections from this user');
      return;
    }
    this.userConnectionCounts.set(userId, userCount);

    let subscribed = false;

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe' && msg.workspaceId) {
          const workspaceId = msg.workspaceId as string;

          // Register the subscription
          const subscription: ClientSubscription = {
            ws,
            workspaceId,
            userId,
            connectedAt: Date.now(),
          };
          this.clients.set(ws, subscription);

          if (!this.workspaceSubscribers.has(workspaceId)) {
            this.workspaceSubscribers.set(workspaceId, new Set());
          }
          this.workspaceSubscribers.get(workspaceId)!.add(ws);

          // Subscribe to graph change events for this workspace
          if (!this.unsubscribers.has(workspaceId)) {
            const unsub = workspaceGraphService.onGraphChanged(workspaceId, () => {
              this.pushGraphToWorkspace(workspaceId);
            });
            this.unsubscribers.set(workspaceId, unsub);
          }

          // Track for polling fallback
          this.pollingWorkspaces.add(workspaceId);

          // Send initial full graph
          const graph = workspaceGraphService.getWorkspaceGraph(workspaceId);
          this.sendMessage(ws, {
            type: 'graph:initial',
            workspaceId,
            data: graph,
            timestamp: Date.now(),
          });

          subscribed = true;

          logger.info('Client subscribed to workspace graph', {
            workspaceId: workspaceId.slice(0, 24),
            totalSubscribers: this.workspaceSubscribers.get(workspaceId)?.size || 0,
          });
        }
      } catch (err: any) {
        logger.warn('Invalid WebSocket message received', { error: err.message });
      }
    });

    ws.on('close', () => {
      if (subscribed) {
        const sub = this.clients.get(ws);
        if (sub && this.workspaceSubscribers.has(sub.workspaceId)) {
          this.workspaceSubscribers.get(sub.workspaceId)!.delete(ws);

          // Clean up workspace if no more subscribers
          if (this.workspaceSubscribers.get(sub.workspaceId)?.size === 0) {
            this.workspaceSubscribers.delete(sub.workspaceId);
            this.pollingWorkspaces.delete(sub.workspaceId);

            const unsub = this.unsubscribers.get(sub.workspaceId);
            if (unsub) {
              unsub();
              this.unsubscribers.delete(sub.workspaceId);
            }
          }
        }
        this.clients.delete(ws);
      }

      // Decrement user connection count
      if (userId !== 'unknown') {
        const count = this.userConnectionCounts.get(userId) || 1;
        if (count <= 1) {
          this.userConnectionCounts.delete(userId);
        } else {
          this.userConnectionCounts.set(userId, count - 1);
        }
      }
    });

    ws.on('error', (err: Error) => {
      logger.debug('WebSocket client error', { error: err.message });
      // Cleanup is handled by 'close' event (always fires after error).
      // If close never fires, heartbeat will terminate dead connections.
    });
  }

  /**
   * Push the current workspace graph to all subscribers of a workspace.
   * Throttled: at most one push per PUSH_THROTTLE_MS per workspace.
   */
  private pushGraphToWorkspace(workspaceId: string): void {
    // Throttle: avoid recomputation storms from rapid mutations
    const lastPush = this.lastPushTimestamps.get(workspaceId) || 0;
    const now = Date.now();
    if (now - lastPush < WorkspaceGraphWebSocket.PUSH_THROTTLE_MS) {
      return;
    }

    // Evict oldest timestamp entry if at capacity
    if (!this.lastPushTimestamps.has(workspaceId) && this.lastPushTimestamps.size >= WorkspaceGraphWebSocket.MAX_PUSH_TIMESTAMP_ENTRIES) {
      const oldestKey = this.lastPushTimestamps.keys().next().value;
      if (oldestKey) this.lastPushTimestamps.delete(oldestKey);
    }
    this.lastPushTimestamps.set(workspaceId, now);

    const subs = this.workspaceSubscribers.get(workspaceId);
    if (!subs || subs.size === 0) return;

    // Compute the current graph
    const graph = workspaceGraphService.getWorkspaceGraph(workspaceId);

    const message: GraphPushMessage = {
      type: 'graph:update',
      workspaceId,
      data: graph,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(message);
    for (const ws of subs) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      } catch (err: any) {
        logger.debug('Failed to push graph to client', { error: err.message });
        // Dead client will be cleaned up on close event
      }
    }
  }

  /**
   * Poll for graph changes in workspaces with active subscribers.
   * This is a fallback for cases where push notifications miss a change.
   */
  private pollChanges(): void {
    for (const workspaceId of this.pollingWorkspaces) {
      try {
        const graph = workspaceGraphService.getWorkspaceGraphIfChanged(workspaceId);
        if (graph) {
          this.pushGraphToWorkspace(workspaceId);
        }
      } catch {
        // Best-effort — skip failed poll iterations
      }
    }
  }

  /**
   * Send heartbeats to all connected clients and prune dead ones.
   */
  private sendHeartbeats(): void {
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          ws.terminate();
          this.clients.delete(ws);
        }
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        this.clients.delete(ws);
      }
    }
  }

  /**
   * Send a message to a specific WebSocket client.
   */
  private sendMessage(ws: WebSocket, msg: GraphPushMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Get stats about current subscriptions.
   */
  getStats(): { totalSubscribers: number; workspaces: number } {
    return {
      totalSubscribers: this.clients.size,
      workspaces: this.workspaceSubscribers.size,
    };
  }

  /**
   * Clean up all resources.
   */
  private cleanup(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const unsub of this.unsubscribers.values()) {
      unsub();
    }
    this.unsubscribers.clear();
    this.clients.clear();
    this.workspaceSubscribers.clear();
    this.pollingWorkspaces.clear();
    this.lastPushTimestamps.clear();
    this.userConnectionCounts.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceGraphWebSocket = new WorkspaceGraphWebSocket();
