"use client";

/**
 * Request Deduplicator
 * 
 * Prevents duplicate API requests by tracking in-flight requests
 * and providing request fingerprinting and deduplication logic.
 */

export interface RequestFingerprint {
  id: string;
  url: string;
  method: string;
  bodyHash: string;
  timestamp: number;
}

export interface InFlightRequest {
  id: string;
  fingerprint: RequestFingerprint;
  promise: Promise<any>;
  abortController: AbortController;
  timestamp: number;
  timeoutId?: NodeJS.Timeout;
}

export interface DeduplicationConfig {
  timeoutMs: number;
  maxConcurrentRequests: number;
  enableFingerprinting: boolean;
  cleanupIntervalMs: number;
}

export class RequestDeduplicator {
  private inFlightRequests: Map<string, InFlightRequest> = new Map();
  private config: DeduplicationConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<DeduplicationConfig> = {}) {
    this.config = {
      timeoutMs: 30000, // 30 seconds
      maxConcurrentRequests: 10,
      enableFingerprinting: true,
      cleanupIntervalMs: 60000, // 1 minute
      ...config
    };

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Generate a unique fingerprint for a request
   */
  generateFingerprint(url: string, method: string, body?: any): RequestFingerprint {
    const bodyString = body ? JSON.stringify(body) : '';
    const bodyHash = this.hashString(bodyString);
    
    return {
      id: `${method.toUpperCase()}_${this.hashString(url)}_${bodyHash}`,
      url,
      method: method.toUpperCase(),
      bodyHash,
      timestamp: Date.now()
    };
  }

  /**
   * Check if a request is already in flight
   */
  isRequestInFlight(fingerprint: RequestFingerprint): boolean {
    if (!this.config.enableFingerprinting) {
      return false;
    }

    const existing = this.inFlightRequests.get(fingerprint.id);
    if (!existing) {
      return false;
    }

    // Check if request is still valid (not timed out)
    const age = Date.now() - existing.timestamp;
    if (age > this.config.timeoutMs) {
      this.removeRequest(fingerprint.id);
      return false;
    }

    return true;
  }

  /**
   * Get existing request promise if available
   */
  getExistingRequest(fingerprint: RequestFingerprint): Promise<any> | null {
    const existing = this.inFlightRequests.get(fingerprint.id);
    return existing ? existing.promise : null;
  }

  /**
   * Register a new request
   */
  registerRequest<T>(
    fingerprint: RequestFingerprint,
    requestFn: (abortController: AbortController) => Promise<T>
  ): Promise<T> {
    // Check concurrent request limit
    if (this.inFlightRequests.size >= this.config.maxConcurrentRequests) {
      throw new Error('Too many concurrent requests');
    }

    // Create abort controller for this request
    const abortController = new AbortController();

    // Create the request promise
    const promise = requestFn(abortController)
      .finally(() => {
        // Clean up when request completes
        this.removeRequest(fingerprint.id);
      });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
      this.removeRequest(fingerprint.id);
    }, this.config.timeoutMs);

    // Store the in-flight request
    const inFlightRequest: InFlightRequest = {
      id: fingerprint.id,
      fingerprint,
      promise,
      abortController,
      timestamp: Date.now(),
      timeoutId
    };

    this.inFlightRequests.set(fingerprint.id, inFlightRequest);

    return promise;
  }

  /**
   * Execute a request with deduplication
   */
  async executeRequest<T>(
    url: string,
    method: string,
    body?: any,
    requestFn?: (abortController: AbortController) => Promise<T>
  ): Promise<T> {
    const fingerprint = this.generateFingerprint(url, method, body);

    // Check if request is already in flight
    if (this.isRequestInFlight(fingerprint)) {
      const existingPromise = this.getExistingRequest(fingerprint);
      if (existingPromise) {
        console.log('Deduplicating request:', fingerprint.id);
        return existingPromise;
      }
    }

    // Create default request function if not provided
    const defaultRequestFn = async (abortController: AbortController): Promise<T> => {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    };

    const actualRequestFn = requestFn || defaultRequestFn;

    return this.registerRequest(fingerprint, actualRequestFn);
  }

  /**
   * Cancel a specific request
   */
  cancelRequest(fingerprintId: string): boolean {
    const request = this.inFlightRequests.get(fingerprintId);
    if (request) {
      request.abortController.abort();
      this.removeRequest(fingerprintId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all requests
   */
  cancelAllRequests(): void {
    for (const request of this.inFlightRequests.values()) {
      request.abortController.abort();
    }
    this.inFlightRequests.clear();
  }

  /**
   * Get statistics about in-flight requests
   */
  getStats(): {
    inFlightCount: number;
    oldestRequestAge: number;
    requestsByMethod: { [method: string]: number };
  } {
    const now = Date.now();
    const requestsByMethod: { [method: string]: number } = {};
    let oldestRequestAge = 0;

    for (const request of this.inFlightRequests.values()) {
      const age = now - request.timestamp;
      oldestRequestAge = Math.max(oldestRequestAge, age);

      const method = request.fingerprint.method;
      requestsByMethod[method] = (requestsByMethod[method] || 0) + 1;
    }

    return {
      inFlightCount: this.inFlightRequests.size,
      oldestRequestAge,
      requestsByMethod
    };
  }

  /**
   * Remove a request from tracking
   */
  private removeRequest(fingerprintId: string): void {
    const request = this.inFlightRequests.get(fingerprintId);
    if (request) {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      this.inFlightRequests.delete(fingerprintId);
    }
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up expired requests
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, request] of this.inFlightRequests.entries()) {
      const age = now - request.timestamp;
      if (age > this.config.timeoutMs) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.cancelRequest(id);
    }

    if (expiredIds.length > 0) {
      console.log(`Cleaned up ${expiredIds.length} expired requests`);
    }
  }

  /**
   * Simple string hashing function
   */
  private hashString(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(36);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cancelAllRequests();
  }
}

// Export singleton instance for code API requests
export const codeRequestDeduplicator = new RequestDeduplicator({
  timeoutMs: 120000, // 2 minutes for code operations
  maxConcurrentRequests: 5, // Limit concurrent code operations
  enableFingerprinting: true,
  cleanupIntervalMs: 30000 // 30 seconds cleanup
});