/**
 * Request Deduplicator
 * 
 * Prevents duplicate in-flight requests to the same endpoint with the same parameters.
 * Useful for preventing race conditions when multiple components request the same data.
 * 
 * @example
 * ```typescript
 * // In a component
 * const data = await requestDeduplicator.executeRequest(
 *   '/api/vfs/read',
 *   'POST',
 *   { path: '/src/index.ts' }
 * );
 * ```
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
  count: number; // Number of duplicate requests merged
}

interface RequestDeduplicatorConfig {
  /** How long to keep pending requests (ms) */
  ttl?: number;
  /** Maximum number of pending requests to track */
  maxPending?: number;
}

export class RequestDeduplicator {
  private pendingRequests = new Map<string, PendingRequest>();
  private readonly ttl: number;
  private readonly maxPending: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: RequestDeduplicatorConfig = {}) {
    this.ttl = config.ttl || 30000; // 30 seconds default
    this.maxPending = config.maxPending || 100;
    
    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Generate a cache key from request parameters
   */
  private getKey(endpoint: string, method: string, body?: any): string {
    return `${method}:${endpoint}:${body ? JSON.stringify(body) : ''}`;
  }

  /**
   * Execute a request, deduplicating with any in-flight request
   * 
   * @param endpoint - API endpoint URL
   * @param method - HTTP method
   * @param body - Request body (will be JSON stringified)
   * @param headers - Optional headers
   * @returns Promise resolving to response data
   */
  async executeRequest(
    endpoint: string,
    method: string = 'GET',
    body?: any,
    headers?: Record<string, string>
  ): Promise<any> {
    const key = this.getKey(endpoint, method, body);
    
    // Check if there's already a pending request
    const pending = this.pendingRequests.get(key);
    if (pending) {
      pending.count++;
      return pending.promise;
    }

    // Create new request
    const promise = this.makeRequest(endpoint, method, body, headers);
    
    // Store pending request
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
      count: 1,
    });

    // Cleanup if too many pending requests
    if (this.pendingRequests.size > this.maxPending) {
      this.cleanupOldest();
    }

    try {
      return await promise;
    } finally {
      // Remove from pending after completion (success or failure)
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Make the actual fetch request
   */
  private async makeRequest(
    endpoint: string,
    method: string,
    body?: any,
    headers?: Record<string, string>
  ): Promise<any> {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(endpoint, fetchOptions);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    return response.json();
  }

  /**
   * Clear a specific pending request
   */
  cancelRequest(endpoint: string, method: string = 'GET', body?: any): void {
    const key = this.getKey(endpoint, method, body);
    this.pendingRequests.delete(key);
  }

  /**
   * Clear all pending requests
   */
  cancelAll(): void {
    this.pendingRequests.clear();
  }

  /**
   * Get statistics about pending requests
   */
  getStats(): {
    pending: number;
    totalDuplicates: number;
  } {
    let totalDuplicates = 0;
    for (const pending of this.pendingRequests.values()) {
      totalDuplicates += pending.count - 1; // Subtract 1 for the original request
    }
    
    return {
      pending: this.pendingRequests.size,
      totalDuplicates,
    };
  }

  /**
   * Start periodic cleanup of stale requests
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.ttl / 2);
  }

  /**
   * Clean up stale pending requests
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.ttl;

    for (const [key, pending] of this.pendingRequests.entries()) {
      if (pending.timestamp < cutoff) {
        this.pendingRequests.delete(key);
      }
    }
  }

  /**
   * Remove oldest pending requests when limit is exceeded
   */
  private cleanupOldest(): void {
    const entries = Array.from(this.pendingRequests.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest 20%
    const toRemove = Math.max(1, Math.floor(entries.length * 0.2));
    for (let i = 0; i < toRemove; i++) {
      this.pendingRequests.delete(entries[i][0]);
    }
  }

  /**
   * Stop the deduplicator and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.pendingRequests.clear();
  }
}

// Singleton instance for application-wide deduplication
let globalDeduplicator: RequestDeduplicator | null = null;

export function getRequestDeduplicator(): RequestDeduplicator {
  if (!globalDeduplicator) {
    globalDeduplicator = new RequestDeduplicator({
      ttl: 30000,
      maxPending: 100,
    });
  }
  return globalDeduplicator;
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    if (globalDeduplicator) {
      globalDeduplicator.destroy();
    }
  });
}
