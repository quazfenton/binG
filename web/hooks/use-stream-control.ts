/**
 * Stream Control WebSocket Client Hook
 *
 * A lightweight WebSocket side-channel that runs alongside SSE streaming.
 * Handles control signals: pause, resume, continue, abort.
 * Replaces the [CONTINUE_REQUESTED] text hack with structured events.
 *
 * Usage:
 *   const ws = useStreamControl({
 *     streamId,           // From SSE init event
 *     wsPort,             // From SSE init event (or env default)
 *     authToken,          // User's auth token
 *     enabled,            // Whether to connect (default: true)
 *     onNeedMoreTurns,    // Server says "continue generating"
 *     onStreamComplete,   // Server says "done"
 *     onStateChange,      // Stream state changed
 *     onError,            // WebSocket error
 *   });
 *
 *   ws.pause();
 *   ws.resume();
 *   ws.continueGeneration({ content: 'Please continue...' });
 *   ws.abort();
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type StreamControlState = 'idle' | 'streaming' | 'paused' | 'complete' | 'error';

export interface StreamControlOptions {
  streamId: string | null;
  authToken: string | null;
  enabled?: boolean;
  onNeedMoreTurns?: (contextHint?: string, payload?: Record<string, any>) => void;
  onStreamComplete?: (stats: { tokenCount: number; contentLength: number; toolCalls: number; finishReason?: string }) => void;
  onStateChange?: (state: StreamControlState) => void;
  onError?: (error: string) => void;
}

export interface UseStreamControlReturn {
  connected: boolean;
  state: StreamControlState;
  pause: () => void;
  resume: () => void;
  continueGeneration: (payload?: { content?: string; contextHint?: string }) => void;
  abort: () => void;
  requestState: () => void;
  setMaxTokens: (maxTokens: number) => void;
  disconnect: () => void;
}

const DEFAULT_WS_PORT = 3000; // Same port as Next.js app — path-based routing

export function useStreamControl(options: StreamControlOptions): UseStreamControlReturn {
  const {
    streamId,
    authToken,
    enabled = true,
    onNeedMoreTurns,
    onStreamComplete,
    onStateChange,
    onError,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 2000;

  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<StreamControlState>('idle');

  const updateState = useCallback((newState: StreamControlState) => {
    setState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  const send = useCallback((message: Record<string, unknown>) => {
    if (!streamId) {
      console.warn('[StreamControl] Cannot send: streamId not set');
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (e: any) {
        console.error('[StreamControl] Failed to send message:', e.message);
      }
    } else {
      console.warn('[StreamControl] Cannot send: WebSocket not open', {
        readyState: wsRef.current?.readyState,
      });
    }
  }, [streamId]);

  const cleanupRef = useRef<(() => void) | null>(null);

  const connect = useCallback(() => {
    if (!streamId || !authToken || !enabled) return;

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

    // Connect on the SAME port as the Next.js app (no separate port needed)
    // Path-based routing: /stream-control is handled by server.ts upgrade handler
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsHost = typeof window !== 'undefined' ? window.location.host : `localhost:${DEFAULT_WS_PORT}`;
    // FIX: Browser WebSocket API does NOT support custom headers.
    // Pass auth token via query parameter instead (server already supports this).
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const wsUrl = `${protocol}://${wsHost}/stream-control?streamId=${encodeURIComponent(streamId)}${tokenParam}`;

    try {
      const ws = new WebSocket(wsUrl);

      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptsRef.current = 0;
        updateState('streaming');
        console.log('[StreamControl] Connected', { streamId, port });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'need_more_turns':
              onNeedMoreTurns?.(data.payload?.contextHint, data.payload);
              break;

            case 'stream_complete':
              updateState('complete');
              setConnected(false);
              onStreamComplete?.(data.payload || {});
              console.log('[StreamControl] Stream complete', data.payload);
              break;

            case 'ack':
              // Acknowledgment of a control command — optional logging
              if (process.env.NODE_ENV === 'development') {
                console.log('[StreamControl] ACK', data.payload);
              }
              break;

            case 'state':
              if (data.payload?.state) {
                updateState(data.payload.state);
              }
              break;

            case 'error':
              onError?.(data.error || 'Unknown server error');
              console.error('[StreamControl] Server error:', data.error);
              break;

            case 'pong':
            case 'heartbeat':
              // Heartbeat response — update activity timestamp (server-side tracks this)
              break;

            default:
              console.warn('[StreamControl] Unknown message type:', data.type);
          }
        } catch (e) {
          console.warn('[StreamControl] Failed to parse message:', event.data);
        }
      };

      ws.onclose = (event) => {
        setConnected(false);

        const wasClean = event.wasClean;
        console.log('[StreamControl] Disconnected', {
          streamId,
          code: event.code,
          reason: event.reason,
          wasClean,
          attempts: reconnectAttemptsRef.current,
        });

        // Don't reconnect for intentional closes
        if (event.code === 1000 || event.code === 1001) return;
        if (event.code === 4009) return; // Replaced by new connection

        // Auto-reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts && streamId) {
          reconnectAttemptsRef.current++;
          const delay = reconnectDelay * reconnectAttemptsRef.current;
          console.log('[StreamControl] Reconnecting in', delay, 'ms', {
            attempt: reconnectAttemptsRef.current,
            max: maxReconnectAttempts,
          });

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          onError?.(`WebSocket reconnection failed after ${maxReconnectAttempts} attempts`);
          console.error('[StreamControl] Max reconnection attempts reached');
        }
      };

      ws.onerror = (event) => {
        console.error('[StreamControl] WebSocket error', { streamId, event });
        onError?.('WebSocket connection error');
      };
    } catch (e: any) {
      console.error('[StreamControl] Failed to create WebSocket:', e.message);
      onError?.(e.message || 'Failed to connect');
    }
  }, [streamId, authToken, enabled, onNeedMoreTurns, onStreamComplete, onError, updateState]);

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
    setState('idle');
  }, []);

  const pause = useCallback(() => {
    if (!streamId) return;
    send({ type: 'pause', streamId });
    updateState('paused');
  }, [send, streamId, updateState]);

  const resume = useCallback(() => {
    if (!streamId) return;
    send({ type: 'resume', streamId });
    updateState('streaming');
  }, [send, streamId, updateState]);

  const continueGeneration = useCallback((payload?: { content?: string; contextHint?: string }) => {
    if (!streamId) return;
    send({ type: 'continue', streamId, payload });
  }, [send, streamId]);

  const abort = useCallback(() => {
    if (!streamId) return;
    send({ type: 'abort', streamId });
    updateState('complete');
    disconnect();
  }, [send, streamId, updateState, disconnect]);

  const requestState = useCallback(() => {
    if (!streamId) return;
    send({ type: 'request_state', streamId });
  }, [send, streamId]);

  const setMaxTokens = useCallback((maxTokens: number) => {
    if (!streamId) return;
    send({ type: 'set_max_tokens', streamId, payload: { maxTokens } });
  }, [send, streamId]);

  // Connect when streamId is available
  useEffect(() => {
    if (streamId && authToken && enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [streamId, authToken, enabled, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, []);

  return {
    connected,
    state,
    pause,
    resume,
    continueGeneration,
    abort,
    requestState,
    setMaxTokens,
    disconnect,
  };
}
