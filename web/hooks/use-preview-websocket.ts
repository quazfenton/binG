/**
 * Preview WebSocket Client Hook
 *
 * Connects to /ws/previews and receives live preview registry events:
 *   preview:registered, preview:updated, preview:removed, workspace:cleared,
 *   preview:initial-state, preview:workspace-snapshot
 *
 * Sends pong responses to server keepalive pings automatically.
 * Supports subscribe/unsubscribe to filter events by workspaceId.
 *
 * Usage:
 *   const { connected, subscribe, unsubscribe } = usePreviewWebsocket({
 *     onPreviewRegistered: (preview) => console.log('New preview:', preview),
 *     onPreviewUpdated: (preview) => console.log('Preview updated:', preview),
 *   });
 *
 * @see lib/terminal/ws-preview-broadcaster.ts — Server-side broadcaster
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspacePreview } from '@/lib/terminal/workspace-preview-registry';

// ============================================================================
// Types
// ============================================================================

export interface PreviewWebSocketCallbacks {
  /** New preview registered in a workspace */
  onPreviewRegistered?: (preview: WorkspacePreview) => void;
  /** Existing preview updated (status change, confidence bump, etc.) */
  onPreviewUpdated?: (preview: WorkspacePreview) => void;
  /** Preview removed from a workspace */
  onPreviewRemoved?: (data: { preview: WorkspacePreview; workspaceId: string }) => void;
  /** All previews cleared for a workspace */
  onWorkspaceCleared?: (data: { workspaceId: string }) => void;
  /** Initial state snapshot on connect */
  onInitialState?: (data: { stats: Record<string, number>; timestamp: number }) => void;
  /** Full workspace snapshot after subscribe */
  onWorkspaceSnapshot?: (data: {
    workspaceId: string;
    previews: WorkspacePreview[];
    activeCount: number;
    totalCount: number;
    timestamp: number;
  }) => void;
  /** Connection state changed */
  onConnectionChange?: (connected: boolean) => void;
  /** WebSocket error */
  onError?: (error: string) => void;
}

export interface UsePreviewWebsocketReturn {
  connected: boolean;
  /** Subscribe to events for a specific workspace (gets full snapshot) */
  subscribe: (workspaceId: string) => void;
  /** Unsubscribe from a workspace's events */
  unsubscribe: (workspaceId: string) => void;
  /** Manually disconnect */
  disconnect: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function usePreviewWebsocket(
  callbacks: PreviewWebSocketCallbacks = {},
): UsePreviewWebsocketReturn {
  // Store callbacks in a ref to avoid disconnect/reconnect cycles when the
  // parent re-renders (new object literal = new reference). The message
  // handler always reads from the ref, so it always has the latest callbacks
  // without needing to recreate the WebSocket.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  // Set to true when the dev server is plain `next dev` (Turbopack) and
  // therefore does not install server.ts's /ws/previews upgrade handler.
  // We detect this on first failed connect and stop retrying forever to
  // avoid the per-second `Event stream error` spam in the browser console.
  const unsupportedRef = useRef(false);
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 3000; // Start at 3s, exponential backoff

  const [connected, setConnected] = useState(false);

  const send = useCallback((message: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (e: any) {
        console.warn('[PreviewWS] Failed to send message:', e.message);
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnected(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  const connect = useCallback(() => {
    if (unsupportedRef.current) return; // Server doesn't support /ws/previews

    // Clean up previous connection
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close(1000, 'Reconnecting');
      wsRef.current = null;
    }

    // Get auth token from localStorage (same pattern as stream-control)
    let token = '';
    try {
      token = localStorage.getItem('token') || '';
    } catch { /* localStorage unavailable */ }

    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss'
      : 'ws';
    const wsHost = typeof window !== 'undefined'
      ? window.location.host
      : 'localhost:3000';

    const url = new URL(`${protocol}://${wsHost}/ws/previews`);
    if (token) url.searchParams.set('token', token);

    try {
      const ws = new WebSocket(url.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        callbacksRef.current.onConnectionChange?.(true);
        reconnectAttemptsRef.current = 0;
        console.log('[PreviewWS] Connected to /ws/previews');
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const cb = callbacksRef.current;
          const data = JSON.parse(event.data as string);

          switch (data.type) {
            case 'preview:registered':
              cb.onPreviewRegistered?.(data.payload as WorkspacePreview);
              break;

            case 'preview:updated':
              cb.onPreviewUpdated?.(data.payload as WorkspacePreview);
              break;

            case 'preview:removed':
              cb.onPreviewRemoved?.(data.payload as { preview: WorkspacePreview; workspaceId: string });
              break;

            case 'workspace:cleared':
              cb.onWorkspaceCleared?.(data.payload as { workspaceId: string });
              break;

            case 'preview:initial-state':
              cb.onInitialState?.(data);
              break;

            case 'preview:workspace-snapshot':
              cb.onWorkspaceSnapshot?.(data);
              break;

            case 'ping':
              // Respond to server keepalive ping
              send({ type: 'pong' });
              break;

            case 'pong':
            case 'heartbeat':
              // Server responses, ignore
              break;

            default:
              if (process.env.NODE_ENV === 'development') {
                console.log('[PreviewWS] Unknown message type:', data.type);
              }
          }
        } catch (e) {
          console.warn('[PreviewWS] Failed to parse message:', (event.data as string).slice(0, 100));
        }
      };

      ws.onclose = (event: CloseEvent) => {
        setConnected(false);
        callbacksRef.current.onConnectionChange?.(false);

        if (process.env.NODE_ENV === 'development') {
          console.log('[PreviewWS] Disconnected', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
        }

        // Don't reconnect for intentional closes
        if (event.code === 1000 || event.code === 1001) return;

        // Plain `next dev` (Turbopack) refuses the upgrade immediately
        // with code 1006 / 1015. Stop retrying after the first instant
        // failure so the browser console isn't spammed every 3s.
        if (
          reconnectAttemptsRef.current === 0 &&
          (event.code === 1006 || event.code === 1015 || event.code === 1002)
        ) {
          unsupportedRef.current = true;
          if (process.env.NODE_ENV === 'development') {
            console.debug(
              '[PreviewToast] /ws/previews unavailable in this dev mode. ' +
              'Run `pnpm dev:ws` to enable preview WebSocket events. ' +
              'Previews still register, but the live dashboard toast is disabled.',
            );
          }
          return;
        }

        // Auto-reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = baseReconnectDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1);
          if (process.env.NODE_ENV === 'development') {
            console.log(`[PreviewWS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          }

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        } else {
          callbacksRef.current.onError?.(`WebSocket reconnection failed after ${maxReconnectAttempts} attempts`);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this. Suppress the per-attempt error log
        // when the server is known to not support the path; onclose flips
        // unsupportedRef in that case.
        if (!unsupportedRef.current) {
          callbacksRef.current.onError?.('WebSocket connection error');
        }
      };
    } catch (e: any) {
      console.error('[PreviewWS] Failed to create WebSocket:', e.message);
      callbacksRef.current.onError?.(e.message || 'Failed to connect to preview WebSocket');
    }
  }, [send]);

  const subscribe = useCallback((workspaceId: string) => {
    send({ type: 'subscribe', workspaceId });
  }, [send]);

  const unsubscribe = useCallback((workspaceId: string) => {
    send({ type: 'unsubscribe', workspaceId });
  }, [send]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { connected, subscribe, unsubscribe, disconnect };
}
