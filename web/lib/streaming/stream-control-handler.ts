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
