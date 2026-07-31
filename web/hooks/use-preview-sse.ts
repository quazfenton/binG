/**
 * Preview SSE Client Hook
 *
 * Connects to GET /api/terminal/previews/events via Server-Sent Events and
 * receives live preview registry events:
 *   preview:initial     — initial snapshot on connect
 *   preview:registered  — new preview detected
 *   preview:updated     — status change
 *   preview:removed     — preview deleted
 *   workspace:cleared   — all previews for a workspace cleared
 *
 * Supports subscribe/unsubscribe by reconnecting with/without ?workspaceId=,
 * making it a drop-in alternative to use-preview-websocket.ts for clients
 * that prefer HTTP streaming over WebSockets.
 *
 * Auth is handled automatically via same-origin cookies (EventSource sends
 * them with every request, and the endpoint uses resolveRequestAuth).
 *
 * Usage:
 *   const { connected, subscribe, unsubscribe } = usePreviewSSE({
 *     onPreviewRegistered: (preview) => console.log('New preview:', preview),
 *     onPreviewUpdated: (preview) => console.log('Preview updated:', preview),
 *   });
 *
 * @see app/api/terminal/previews/events/route.ts — SSE endpoint
 * @see hooks/use-preview-websocket.ts — WebSocket alternative
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspacePreview } from '@/lib/terminal/workspace-preview-registry';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('PreviewSSE');

// ============================================================================
// Types
// ============================================================================

export interface PreviewSSECallbacks {
  /** New preview registered in a workspace */
  onPreviewRegistered?: (preview: WorkspacePreview) => void;
  /** Existing preview updated (status change, confidence bump, etc.) */
  onPreviewUpdated?: (preview: WorkspacePreview) => void;
  /** Preview removed from a workspace */
  onPreviewRemoved?: (data: { preview: WorkspacePreview; workspaceId: string }) => void;
  /** All previews cleared for a workspace */
  onWorkspaceCleared?: (data: { workspaceId: string }) => void;
  /** Initial state snapshot on connect (global or workspace-scoped) */
  onInitialState?: (data: { stats: Record<string, number>; timestamp: number }) => void;
  /** Full workspace snapshot after subscribing to a specific workspace */
  onWorkspaceSnapshot?: (data: {
    workspaceId: string;
    previews: WorkspacePreview[];
    activeCount: number;
    totalCount: number;
    timestamp: number;
  }) => void;
  /** Connection state changed */
  onConnectionChange?: (connected: boolean) => void;
  /** Connection/stream error */
  onError?: (error: string) => void;
}

export interface UsePreviewSSEReturn {
  connected: boolean;
  /** Subscribe to events for a specific workspace (reconnects with ?workspaceId=) */
  subscribe: (workspaceId: string) => void;
  /** Unsubscribe from a workspace's events (reconnects without filter) */
  unsubscribe: (workspaceId: string) => void;
  /** Manually disconnect */
  disconnect: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 3_000; // 3s, exponential backoff with 1.5x

/** Named SSE event types emitted by the preview events endpoint */
const SSE_EVENT_TYPES = [
  'preview:registered',
  'preview:updated',
  'preview:removed',
  'workspace:cleared',
  'preview:initial',
] as const;

type SSEEventType = (typeof SSE_EVENT_TYPES)[number];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build the SSE endpoint URL, optionally scoped to a workspace.
 */
function buildUrl(workspaceId?: string): string {
  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/terminal/previews/events`
      : 'http://localhost:3000/api/terminal/previews/events';

  if (workspaceId) {
    return `${base}?workspaceId=${encodeURIComponent(workspaceId)}`;
  }
  return base;
}

// ============================================================================
// Hook
// ============================================================================

export function usePreviewSSE(
  callbacks: PreviewSSECallbacks = {},
): UsePreviewSSEReturn {
  // Store callbacks in a ref to avoid reconnect cycles when the parent
  // re-renders with a new object literal. The event handler always reads
  // from the ref, so it always has the latest callbacks.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const workspaceIdRef = useRef<string | undefined>(undefined);
  /** Tracks whether we are intentionally disconnecting (skip reconnect) */
  const disconnectingRef = useRef(false);

  const [connected, setConnected] = useState(false);

  // ── Event handler (shared across all addEventListener registrations) ──

  const handleSSEEvent = useCallback((event: MessageEvent) => {
    try {
      const cb = callbacksRef.current;
      const data = JSON.parse(event.data);

      switch (event.type) {
        case 'preview:registered':
          cb.onPreviewRegistered?.(data as WorkspacePreview);
          break;

        case 'preview:updated':
          cb.onPreviewUpdated?.(data as WorkspacePreview);
          break;

        case 'preview:removed':
          cb.onPreviewRemoved?.(data as { preview: WorkspacePreview; workspaceId: string });
          break;

        case 'workspace:cleared':
          cb.onWorkspaceCleared?.(data as { workspaceId: string });
          break;

        case 'preview:initial':
          // The endpoint sends different payloads depending on whether a
          // workspaceId was provided. Route to the appropriate callback.
          if (data.workspaceId && Array.isArray(data.previews)) {
            cb.onWorkspaceSnapshot?.(data);
          } else {
            cb.onInitialState?.(data);
          }
          break;

        default:
          if (process.env.NODE_ENV === 'development') {
            logger.debug('Unknown event type:', event.type);
          }
      }
    } catch (e) {
      logger.warn('Failed to parse event:', (event.data || '').slice(0, 100));
    }
  }, []);

  // ── Disconnect ──────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    disconnectingRef.current = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (esRef.current) {
      for (const type of SSE_EVENT_TYPES) {
        esRef.current.removeEventListener(type, handleSSEEvent);
      }
      esRef.current.onopen = null;
      esRef.current.onerror = null;
      esRef.current.close();
      esRef.current = null;
    }

    setConnected(false);
    reconnectAttemptsRef.current = 0;
  }, [handleSSEEvent]);

  // ── Connect ─────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    disconnectingRef.current = false;

    // Clear any pending reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    // Tear down any existing EventSource
    if (esRef.current) {
      for (const type of SSE_EVENT_TYPES) {
        esRef.current.removeEventListener(type, handleSSEEvent);
      }
      esRef.current.onopen = null;
      esRef.current.onerror = null;
      esRef.current.close();
      esRef.current = null;
    }

    const url = buildUrl(workspaceIdRef.current);

    try {
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        callbacksRef.current.onConnectionChange?.(true);
        reconnectAttemptsRef.current = 0;
      };

      // Register listeners for each named SSE event type
      for (const type of SSE_EVENT_TYPES) {
        es.addEventListener(type, handleSSEEvent);
      }

      es.onerror = () => {
        setConnected(false);
        callbacksRef.current.onConnectionChange?.(false);

        // EventSource auto-reconnects by default, but we want more
        // predictable behavior (max attempts, backoff). If the EventSource
        // has given up (CLOSED) or if we want to force our own retry,
        // we step in with manual reconnection.
        //
        // Note: when the browser is reconnecting (readyState === CONNECTING)
        // we only update the connected state and wait.
        if (es.readyState === EventSource.CLOSED || reconnectAttemptsRef.current > 0) {
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current++;
            const delay =
              BASE_RECONNECT_DELAY *
              Math.pow(1.5, reconnectAttemptsRef.current - 1);

            reconnectTimerRef.current = setTimeout(() => {
              if (disconnectingRef.current) return;
              reconnectTimerRef.current = null;
              connect();
            }, delay);
          } else {
            callbacksRef.current.onError?.(
              `SSE reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
            );
          }
        }
      };
    } catch (e: any) {
      logger.error('Failed to create EventSource:', e.message);
      callbacksRef.current.onError?.(e.message || 'Failed to connect to preview SSE');
    }
  }, [handleSSEEvent]);

  // ── Subscribe / Unsubscribe ─────────────────────────────────────────

  const subscribe = useCallback(
    (workspaceId: string) => {
      workspaceIdRef.current = workspaceId;
      connect();
    },
    [connect],
  );

  const unsubscribe = useCallback(
    (workspaceId: string) => {
      if (workspaceIdRef.current === workspaceId) {
        workspaceIdRef.current = undefined;
        connect();
      }
    },
    [connect],
  );

  // ── Connect on mount, disconnect on unmount ─────────────────────────

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { connected, subscribe, unsubscribe, disconnect };
}
