/**
 * Blaxel Async Execution Manager
 * 
 * Tracks pending async executions and routes callback results back to the original requester.
 * Implements correlation between async execution requests and their callback responses.
 */

import { EventEmitter } from 'node:events';

export interface PendingExecution {
  sessionId: string;
  sandboxId: string;
  agentId: string;
  executionId: string;
  callbackSecret: string;
  createdAt: number;
  timeout: NodeJS.Timeout;
  resolve: (result: BlaxelCallbackResult) => void;
  reject: (error: Error) => void;
}

export interface BlaxelCallbackResult {
  status_code: number;
  response_body: string;
  response_length: number;
  timestamp: number;
}

/**
 * Manages pending async executions and callback routing
 */
class BlaxelExecutionManager extends EventEmitter {
  private pendingExecutions: Map<string, PendingExecution> = new Map();
  private readonly EXECUTION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (Blaxel max)
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute
  private readonly MAX_PENDING_EXECUTIONS = 100;

  constructor() {
    super();
    this.startCleanupInterval();
  }

  /**
   * Register a new pending async execution
   */
  registerExecution(execution: Omit<PendingExecution, 'timeout' | 'createdAt'>): Promise<BlaxelCallbackResult> {
    if (this.pendingExecutions.size >= this.MAX_PENDING_EXECUTIONS) {
      throw new Error('Too many pending async executions. Maximum capacity reached.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.completeExecution(execution.executionId, {
          success: false,
          error: 'Async execution timed out',
        });
        reject(new Error('Async execution timed out'));
      }, this.EXECUTION_TIMEOUT_MS);

      const pendingExecution: PendingExecution = {
        ...execution,
        createdAt: Date.now(),
        timeout,
        resolve,
        reject,
      };

      this.pendingExecutions.set(execution.executionId, pendingExecution);
      this.emit('execution:registered', pendingExecution);

      console.log('[BlaxelExecutionManager] Registered async execution', {
        executionId: execution.executionId,
        sessionId: execution.sessionId,
        agentId: execution.agentId,
      });
    });
  }

  /**
   * Route callback result to the appropriate pending execution
   */
  routeCallback(payload: {
    executionId?: string;
    agent?: string;
    sandbox_id?: string;
    status_code: number;
    response_body: string;
    response_length: number;
    timestamp: number;
  }): { routed: boolean; error?: string } {
    // Try to find execution by executionId first
    let executionId = payload.executionId;
    
    // If no executionId, try to find by agent + sandbox_id combination
    if (!executionId && payload.agent && payload.sandbox_id) {
      const correlationKey = `${payload.agent}:${payload.sandbox_id}`;
      for (const [id, execution] of this.pendingExecutions.entries()) {
        if (execution.agentId === payload.agent && execution.sandboxId === payload.sandbox_id) {
          executionId = id;
          break;
        }
      }
    }

    if (!executionId) {
      return { routed: false, error: 'No pending execution found for callback' };
    }

    const execution = this.pendingExecutions.get(executionId);
    if (!execution) {
      return { routed: false, error: 'Execution not found or already completed' };
    }

    // Validate callback secret if provided
    if (payload.response_body) {
      try {
        const responseBody = JSON.parse(payload.response_body);
        if (responseBody.callback_secret && responseBody.callback_secret !== execution.callbackSecret) {
          console.warn('[BlaxelExecutionManager] Callback secret mismatch', {
            executionId,
          });
          return { routed: false, error: 'Callback secret mismatch' };
        }
      } catch {
        // Response body might not be JSON, continue
      }
    }

    // Complete the execution
    this.completeExecution(executionId, {
      success: payload.status_code >= 200 && payload.status_code < 300,
      status_code: payload.status_code,
      response_body: payload.response_body,
      response_length: payload.response_length,
      timestamp: payload.timestamp,
    });

    return { routed: true };
  }

  /**
   * Complete a pending execution (success or failure)
   */
  private completeExecution(
    executionId: string,
    result: { success: boolean; error?: string } | BlaxelCallbackResult
  ): void {
    const execution = this.pendingExecutions.get(executionId);
    if (!execution) return;

    // Clear timeout
    clearTimeout(execution.timeout);

    // Remove from pending
    this.pendingExecutions.delete(executionId);

    // Resolve or reject the promise
    if ('success' in result && !result.success) {
      execution.reject(new Error(result.error || 'Execution failed'));
      this.emit('execution:failed', { executionId, error: result.error });
    } else {
      const callbackResult = result as BlaxelCallbackResult;
      execution.resolve(callbackResult);
      this.emit('execution:completed', { executionId, result: callbackResult });
    }

    console.log('[BlaxelExecutionManager] Completed async execution', {
      executionId,
      success: 'success' in result && result.success,
    });
  }

  /**
   * Get pending execution by ID
   */
  getExecution(executionId: string): PendingExecution | undefined {
    return this.pendingExecutions.get(executionId);
  }

  /**
   * Get all pending executions for a session
   */
  getSessionExecutions(sessionId: string): PendingExecution[] {
    return Array.from(this.pendingExecutions.values()).filter(
      (exec) => exec.sessionId === sessionId
    );
  }

  /**
   * Cancel a pending execution
   */
  cancelExecution(executionId: string, reason: string = 'Cancelled by user'): void {
    const execution = this.pendingExecutions.get(executionId);
    if (!execution) return;

    clearTimeout(execution.timeout);
    this.pendingExecutions.delete(executionId);
    execution.reject(new Error(reason));
    this.emit('execution:cancelled', { executionId, reason });

    console.log('[BlaxelExecutionManager] Cancelled async execution', {
      executionId,
      reason,
    });
  }

  /**
   * Cancel all pending executions for a session
   */
  cancelSessionExecutions(sessionId: string, reason: string = 'Session ended'): void {
    const sessionExecutions = this.getSessionExecutions(sessionId);
    sessionExecutions.forEach((exec) => {
      this.cancelExecution(exec.executionId, reason);
    });
  }

  /**
   * Get statistics about pending executions
   */
  getStats(): {
    total: number;
    bySession: Map<string, number>;
    oldestAge: number;
  } {
    const bySession = new Map<string, number>();
    let oldestAge = 0;
    const now = Date.now();

    for (const execution of this.pendingExecutions.values()) {
      const count = bySession.get(execution.sessionId) || 0;
      bySession.set(execution.sessionId, count + 1);

      const age = now - execution.createdAt;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      total: this.pendingExecutions.size,
      bySession,
      oldestAge,
    };
  }

  /**
   * Periodic cleanup of stale executions
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = this.EXECUTION_TIMEOUT_MS;

      for (const [id, execution] of this.pendingExecutions.entries()) {
        const age = now - execution.createdAt;
        if (age > staleThreshold) {
          console.warn('[BlaxelExecutionManager] Cleaning up stale execution', {
            executionId: id,
            age,
          });
          this.completeExecution(id, {
            success: false,
            error: 'Execution timed out (cleanup)',
          });
        }
      }
    }, this.CLEANUP_INTERVAL_MS);
  }
}

// Singleton instance
export const blaxelExecutionManager = new BlaxelExecutionManager();

// Export for testing
export { BlaxelExecutionManager };
