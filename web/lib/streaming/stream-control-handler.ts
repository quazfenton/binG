import { IncomingMessage } from 'node:http';
import { streamStateManager } from './stream-state-manager';
import { WebSocketServer } from 'ws';
import type { Duplex } from 'node:stream';

/**
 * Request Batching Handler
 * 
 * Buffers rapid-fire tool calls into a single dispatch batch.
 */

type Task<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
};

export const notifyStreamComplete = (streamId: string) => {
  console.log(`Stream complete notification: ${streamId}`);
};

/**
 * Notify that the stream needs more turns (auto-continue)
 */
export const notifyNeedMoreTurns = async (streamId: string, contextHint?: string) => {
  return streamStateManager.signalNeedMoreTurns(streamId, contextHint);
};

/**
 * Handle WebSocket upgrade for stream control
 */
export const handleStreamControlUpgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const wss = new WebSocketServer({ noServer: true });

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { type, streamId, data } = payload;

        if (!streamId) return;

        switch (type) {
          case 'pause':
            streamStateManager.pause(streamId);
            ws.send(JSON.stringify({ type: 'paused', streamId }));
            break;
          case 'resume':
            const chunks = streamStateManager.resume(streamId);
            ws.send(JSON.stringify({ type: 'resumed', streamId, chunks }));
            break;
          case 'abort':
            streamStateManager.abort(streamId);
            ws.send(JSON.stringify({ type: 'aborted', streamId }));
            break;
          case 'continue':
            await streamStateManager.triggerContinue(streamId, data);
            ws.send(JSON.stringify({ type: 'continued', streamId }));
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (err) {
        console.error('Stream control message error:', err);
      }
    });
  });
};

export class RequestBatcher {
  private queue: Task<any>[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private delay: number;

  constructor(delay: number = 50) {
    this.delay = delay;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      
      if (!this.timeout) {
        this.timeout = setTimeout(() => this.dispatch(), this.delay);
      }
    });
  }

  private async dispatch() {
    const tasks = [...this.queue];
    this.queue = [];
    this.timeout = null;

    try {
      const results = await Promise.all(tasks.map(t => t.fn()));
      tasks.forEach((t, i) => t.resolve(results[i]));
    } catch (err) {
      tasks.forEach(t => t.reject(err));
    }
  }
}
