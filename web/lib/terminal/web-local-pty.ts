/**
 * Web Local PTY Provider
 *
 * Provides real PTY terminal connections in web mode using node-pty on the server.
 * Uses SSE for output streaming and POST for input (same pattern as sandbox terminals).
 *
 * Supports isolation modes:
 *   - "direct": Direct spawn on server (dev only)
 *   - "unshare": Linux user namespace isolation
 *   - "docker": Docker container isolation
 *
 * Usage:
 * ```typescript
 * const pty = await createWebLocalPty({ cols: 80, rows: 24 });
 * if (pty) {
 *   pty.onOutput((data) => terminal.write(data));
 *   pty.writeInput('ls -la\n');
 *   pty.resize(120, 30);
 * }
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('WebLocalPTY');

export interface WebLocalPtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

export interface WebLocalPtyInstance {
  sessionId: string;
  mode: string; // 'direct', 'unshare', 'docker', 'localhost'
  isConnected: boolean;
  writeInput: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  onOutput: (callback: (data: string) => void) => void;
  onClose: (callback: () => void) => void;
}

/**
 * Check if local PTY is available in web mode
 */
export async function isWebLocalPtyAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const response = await fetch('/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cols: 1, rows: 1, checkOnly: true }),
    });

    return response.status !== 503;
  } catch (err) {
    logger.debug('Local PTY availability check failed', err);
    return false;
  }
}

/**
 * Get the isolation mode of the local PTY
 */
export async function getWebLocalPtyMode(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    const response = await fetch('/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cols: 1, rows: 1, checkOnly: true }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.mode || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a new local PTY session in web mode
 */
export async function createWebLocalPty(
  options: WebLocalPtyOptions = {}
): Promise<WebLocalPtyInstance | null> {
  try {
    logger.info('Creating web local PTY session', {
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      shell: options.shell,
    });

    // Create PTY session via API
    const response = await fetch('/api/terminal/local-pty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        cols: options.cols || 80,
        rows: options.rows || 24,
        cwd: options.cwd,
        shell: options.shell,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      logger.error('Failed to create local PTY', {
        status: response.status,
        error: error.error,
        hint: error.hint,
      });
      return null;
    }

    const { sessionId, mode } = await response.json();
    logger.info('Local PTY session created', { sessionId, mode });

    let outputCallback: ((data: string) => void) | null = null;
    let closeCallback: (() => void) | null = null;
    let eventSource: EventSource | null = null;
    let isClosed = false;

    // Connect SSE for output streaming
    const streamUrl = `/api/terminal/local-pty?sessionId=${encodeURIComponent(sessionId)}`;
    eventSource = new EventSource(streamUrl);

    // SSE connection timeout
    const sseTimeout = setTimeout(() => {
      if (!isClosed && eventSource?.readyState !== EventSource.OPEN) {
        logger.warn('SSE connection timed out', { sessionId });
        eventSource?.close();
        eventSource = null;
        isClosed = true;
        if (closeCallback) closeCallback();
      }
    }, 10000);

    eventSource.onopen = () => {
      clearTimeout(sseTimeout);
      logger.debug('Local PTY SSE connection opened', { sessionId });
    };

    eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'connected':
            logger.info('Local PTY connected', { sessionId, mode });
            break;

          case 'pty':
            if (outputCallback && !isClosed) {
              outputCallback(msg.data);
            }
            break;

          case 'disconnected':
            logger.info('Local PTY session disconnected', { exitCode: msg.data?.exitCode });
            if (!isClosed) {
              isClosed = true;
              eventSource?.close();
              eventSource = null;
              if (closeCallback) {
                closeCallback();
              }
            }
            break;

          default:
            logger.debug('Unknown SSE message type', { type: msg.type });
        }
      } catch (err) {
        logger.error('Failed to parse SSE message', err);
      }
    };

    eventSource.onerror = (err) => {
      if (isClosed) return;

      const readyState = eventSource?.readyState;
      if (readyState === EventSource.CONNECTING) {
        logger.debug('SSE reconnecting...', { sessionId });
        return; // EventSource will auto-reconnect
      }

      // CLOSED or persistent error
      logger.error('Local PTY SSE connection error', { readyState, err });
      isClosed = true;
      clearTimeout(sseTimeout);
      eventSource?.close();
      eventSource = null;
      if (closeCallback) {
        closeCallback();
      }
    };

    return {
      sessionId,
      mode: mode || 'direct',
      isConnected: true,

      writeInput: async (data: string) => {
        if (isClosed) return;
        try {
          const res = await fetch('/api/terminal/local-pty/input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ sessionId, data }),
          });

          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            if (res.status === 410) {
              // PTY exited
              isClosed = true;
              if (closeCallback) closeCallback();
            }
            logger.warn('Failed to write to local PTY', {
              status: res.status,
              error: error.error,
            });
          }
        } catch (error) {
          logger.error('Failed to write to local PTY', error);
        }
      },

      resize: async (cols: number, rows: number) => {
        if (isClosed) return;
        try {
          const res = await fetch('/api/terminal/local-pty/resize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ sessionId, cols, rows }),
          });

          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            logger.warn('Failed to resize local PTY', {
              status: res.status,
              error: error.error,
            });
          }
        } catch (error) {
          logger.error('Failed to resize local PTY', error);
        }
      },

      close: async () => {
        if (isClosed) return;
        isClosed = true;
        clearTimeout(sseTimeout);
        eventSource?.close();
        eventSource = null;
        logger.info('Local PTY session closed', { sessionId });
      },

      onOutput: (callback: (data: string) => void) => {
        outputCallback = callback;
      },

      onClose: (callback: () => void) => {
        closeCallback = callback;
      },
    };
  } catch (error) {
    logger.error('Failed to create web local PTY', error);
    return null;
  }
}
