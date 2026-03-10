/**
 * WebSocket Terminal Hook
 * 
 * Provides real-time WebSocket terminal connection with:
 * - JWT authentication
 * - PTY resize support
 * - Auto-reconnection
 * - Session persistence
 * 
 * @example
 * ```typescript
 * const { connect, disconnect, send, terminalRef } = useWebSocketTerminal({
 *   sandboxId: 'sandbox-123',
 *   autoConnect: true,
 *   onOutput: (data) => console.log(data),
 * });
 * 
 * // Connect manually
 * connect();
 * 
 * // Send command
 * send('ls -la\n');
 * 
 * // Resize terminal
 * resize(80, 24);
 * 
 * // Disconnect
 * disconnect();
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface WebSocketTerminalConfig {
  sandboxId: string;
  autoConnect?: boolean;
  onOutput?: (data: string) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export interface WebSocketTerminalState {
  connected: boolean;
  connecting: boolean;
  error: Error | null;
  reconnectCount: number;
}

export interface WebSocketTerminalActions {
  connect: () => void;
  disconnect: () => void;
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  clear: () => void;
}

const DEFAULT_CONFIG: Partial<WebSocketTerminalConfig> = {
  autoConnect: true,
  reconnectAttempts: 5,
  reconnectDelay: 1000,
};

const WS_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL || `ws://localhost:${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || 8080}`;

export function useWebSocketTerminal(config: WebSocketTerminalConfig) {
  const {
    sandboxId,
    autoConnect = DEFAULT_CONFIG.autoConnect,
    onOutput,
    onError,
    onConnect,
    onDisconnect,
    reconnectAttempts = DEFAULT_CONFIG.reconnectAttempts,
    reconnectDelay = DEFAULT_CONFIG.reconnectDelay,
  } = config;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // ✅ FIX: Use ref for reconnect count to avoid race conditions with async state updates
  const reconnectCountRef = useRef(0);

  const [state, setState] = useState<WebSocketTerminalState>({
    connected: false,
    connecting: false,
    error: null,
    reconnectCount: 0,
  });

  // ✅ FIX: Connection timeout constant
  const CONNECTION_TIMEOUT_MS = 10000; // 10 seconds

  // Get auth token
  const getAuthToken = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem('token');
    } catch {
      return null;
    }
  }, []);

  // Build WebSocket URL with authentication
  const buildWebSocketUrl = useCallback(() => {
    const url = new URL(`${WS_URL}/sandboxes/${sandboxId}/terminal`);
    
    // Note: Token is now sent via WebSocket subprotocol, NOT in URL
    // This prevents token leakage in server logs and browser history
    
    return url.toString();
  }, [sandboxId]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocketTerminal] Already connected');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('[WebSocketTerminal] Connection in progress');
      return;
    }

    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      const url = buildWebSocketUrl();
      const authToken = getAuthToken();
      
      console.log('[WebSocketTerminal] Connecting to:', url);

      // SECURITY: Send token via WebSocket subprotocol (not URL query param)
      // This prevents token leakage in logs and browser history
      const wsOptions: string[] | undefined = authToken 
        ? [`Bearer ${authToken}`] 
        : undefined;

      wsRef.current = new WebSocket(url, wsOptions);

      // ✅ FIX: Add connection timeout to prevent hanging connections
      connectionTimeoutRef.current = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.CONNECTING) {
          console.warn('[WebSocketTerminal] Connection timeout, closing');
          wsRef.current.close(4008, 'Connection timeout');
        }
        connectionTimeoutRef.current = null;
      }, CONNECTION_TIMEOUT_MS);

      wsRef.current.onopen = () => {
        // ✅ FIX: Clear connection timeout on successful connection
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }

        console.log('[WebSocketTerminal] Connected');
        setState(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          error: null,
          reconnectCount: 0,
        }));
        onConnect?.();
      };

      wsRef.current.onmessage = (event) => {
        const data = typeof event.data === 'string' ? event.data : event.data.toString();
        // Handle server ping/pong keepalive messages
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'ping') {
            wsRef.current?.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          if (msg.type === 'pong') return;
        } catch {
          // Not JSON – raw terminal output
        }
        onOutput?.(data);
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocketTerminal] Error:', error);
        const err = new Error('WebSocket connection error');
        setState(prev => ({ ...prev, error: err }));
        // ✅ FIX: Wrap onError in try-catch to prevent handler errors from crashing component
        try {
          onError?.(err);
        } catch (handlerError) {
          console.error('[WebSocketTerminal] onError handler failed:', handlerError);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('[WebSocketTerminal] Disconnected:', event.code, event.reason);
        setState(prev => ({
          ...prev,
          connected: false,
          connecting: false,
        }));
        onDisconnect?.();

        // Auto-reconnect if not gracefully closed
        // ✅ FIX: Use ref instead of state to avoid race condition
        if (event.code !== 1000 && reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current += 1;
          const delay = reconnectDelay * Math.pow(2, reconnectCountRef.current); // Exponential backoff
          console.log(`[WebSocketTerminal] Reconnecting in ${delay}ms (attempt ${reconnectCountRef.current}/${reconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    } catch (error: any) {
      console.error('[WebSocketTerminal] Connection failed:', error);
      setState(prev => ({
        ...prev,
        connected: false,
        connecting: false,
        error: error,
      }));
      // ✅ FIX: Wrap onError in try-catch
      try {
        onError?.(error);
      } catch (handlerError) {
        console.error('[WebSocketTerminal] onError handler failed:', handlerError);
      }
    }
  }, [buildWebSocketUrl, onOutput, onError, onConnect, onDisconnect, reconnectAttempts, reconnectDelay]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // ✅ FIX: Clear connection timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (wsRef.current) {
      // Graceful close
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setState(prev => ({
      ...prev,
      connected: false,
      connecting: false,
    }));
  }, []);

  // Send data to WebSocket
  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    } else {
      console.warn('[WebSocketTerminal] Not connected, cannot send');
    }
  }, []);

  // Resize terminal (send PTY resize)
  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Send as JSON command
      wsRef.current.send(JSON.stringify({
        type: 'resize',
        cols,
        rows,
      }));
    }
  }, []);

  // Clear terminal output (client-side only)
  const clear = useCallback(() => {
    // Send ANSI clear command
    send('\x1b[2J\x1b[H');
  }, [send]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && sandboxId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, sandboxId, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // ✅ FIX: Clear connection timeout on unmount
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    send,
    resize,
    clear,
  };
}

export default useWebSocketTerminal;
