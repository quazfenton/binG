"use client";

import { secureRandom } from '@/lib/utils';

/**
 * Streaming Error Handler
 * 
 * Provides centralized error handling for streaming operations with
 * graceful recovery and user-friendly error management.
 */

export interface StreamingError {
  type: 'parse_error' | 'connection_error' | 'invalid_event' | 'timeout_error' | 'unknown_error';
  message: string;
  originalError?: Error;
  recoverable: boolean;
  userMessage?: string;
  context?: {
    requestId?: string;
    sessionId?: string;
    eventType?: string;
    line?: string;
  };
}

export interface ErrorRecoveryOptions {
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  silentRecovery: boolean;
}

export class StreamingErrorHandler {
  private errorCounts: Map<string, number> = new Map();
  private recoveryOptions: ErrorRecoveryOptions;
  
  // Recovery tracking
  private recoveryAttempts: number = 0;
  private successfulRecoveries: number = 0;

  constructor(options: Partial<ErrorRecoveryOptions> = {}) {
    this.recoveryOptions = {
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true,
      silentRecovery: true,
      ...options
    };
  }

  /**
   * Process and categorize streaming errors
   */
  processError(error: Error, context?: StreamingError['context']): StreamingError {
    const errorMessage = error.message.toLowerCase();
    
    // Categorize the error
    let type: StreamingError['type'] = 'unknown_error';
    let recoverable = false;
    let userMessage: string | undefined;

    if (this.isParseError(errorMessage)) {
      type = 'parse_error';
      recoverable = true;
      userMessage = undefined; // Don't show parse errors to users
    } else if (this.isConnectionError(errorMessage)) {
      type = 'connection_error';
      recoverable = true;
      userMessage = 'Connection interrupted. Retrying...';
    } else if (this.isInvalidEventError(errorMessage)) {
      type = 'invalid_event';
      recoverable = true;
      userMessage = undefined; // Don't show invalid event errors to users
    } else if (this.isTimeoutError(errorMessage)) {
      type = 'timeout_error';
      recoverable = true;
      userMessage = 'Request is taking longer than usual...';
    }

    // Track error frequency
    const errorKey = `${type}-${context?.requestId || 'unknown'}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);

    // Determine if still recoverable based on retry count
    const maxRetries = this.recoveryOptions.maxRetries;
    if (currentCount >= maxRetries) {
      recoverable = false;
      userMessage = 'Connection issues persist. Please try again later.';
    }

    return {
      type,
      message: error.message,
      originalError: error,
      recoverable,
      userMessage,
      context
    };
  }

  /**
   * Attempt to recover from a streaming error
   */
  async attemptRecovery(
    streamingError: StreamingError,
    recoveryFn?: () => Promise<void>
  ): Promise<boolean> {
    if (!streamingError.recoverable) {
      return false;
    }

    const errorKey = `${streamingError.type}-${streamingError.context?.requestId || 'unknown'}`;
    const attemptCount = this.errorCounts.get(errorKey) || 0;

    if (attemptCount >= this.recoveryOptions.maxRetries) {
      return false;
    }

    try {
      // Track recovery attempt
      this.recoveryAttempts++;

      // Calculate delay with optional exponential backoff
      let delay = this.recoveryOptions.retryDelay;
      if (this.recoveryOptions.exponentialBackoff) {
        delay = delay * Math.pow(2, attemptCount);
      }

      // Add jitter to prevent thundering herd
      delay += secureRandom() * 1000;

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));

      // Attempt recovery
      if (recoveryFn) {
        await recoveryFn();
      }

      // Track successful recovery
      this.successfulRecoveries++;
      
      // Reset error count on successful recovery
      this.errorCounts.delete(errorKey);
      return true;

    } catch (recoveryError) {
      console.warn('Recovery attempt failed:', recoveryError);
      return false;
    }
  }

  /**
   * Check if error should be shown to user
   */
  shouldShowToUser(streamingError: StreamingError): boolean {
    // Don't show parsing or invalid event errors to users
    if (streamingError.type === 'parse_error' || streamingError.type === 'invalid_event') {
      return false;
    }

    // Don't show if silent recovery is enabled and error is recoverable
    if (this.recoveryOptions.silentRecovery && streamingError.recoverable) {
      return false;
    }

    // Show connection and timeout errors with user-friendly messages
    return streamingError.userMessage !== undefined;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(streamingError: StreamingError): string {
    return streamingError.userMessage || 'An unexpected error occurred. Please try again.';
  }

  /**
   * Clear error counts for a specific context
   */
  clearErrorCounts(requestId?: string): void {
    if (requestId) {
      // Clear errors for specific request
      for (const key of this.errorCounts.keys()) {
        if (key.includes(requestId)) {
          this.errorCounts.delete(key);
        }
      }
    } else {
      // Clear all error counts
      this.errorCounts.clear();
    }
  }

  /**
   * Get error statistics
   * 
   * ENHANCED: Now with detailed analytics
   */
  getErrorStats(): { 
    byType: { [errorType: string]: number };
    byRequest: { [requestId: string]: number };
    totalErrors: number;
    recoveryAttempts: number;
    successfulRecoveries: number;
  } {
    const byType: { [errorType: string]: number } = {};
    const byRequest: { [requestId: string]: number } = {};
    let totalErrors = 0;
    
    for (const [key, count] of this.errorCounts.entries()) {
      const parts = key.split('-');
      const errorType = parts[0];
      const requestId = parts[1] || 'unknown';
      
      byType[errorType] = (byType[errorType] || 0) + count;
      byRequest[requestId] = (byRequest[requestId] || 0) + count;
      totalErrors += count;
    }

    return {
      byType,
      byRequest,
      totalErrors,
      recoveryAttempts: this.recoveryAttempts,
      successfulRecoveries: this.successfulRecoveries,
    };
  }

  /**
   * Get error analytics dashboard data
   * 
   * ADDED: Comprehensive error analytics for monitoring
   */
  getErrorAnalytics(): {
    summary: {
      totalErrors: number;
      recoveryRate: number;
      mostCommonError: string;
      averageErrorsPerRequest: number;
    };
    byType: Array<{ type: string; count: number; percentage: number }>;
    recentErrors: Array<{ type: string; requestId?: string; count: number }>;
  } {
    const stats = this.getErrorStats();
    const totalErrors = stats.totalErrors;
    
    // Calculate recovery rate
    const recoveryRate = totalErrors > 0 
      ? Math.round((this.successfulRecoveries / Math.max(this.recoveryAttempts, 1)) * 100)
      : 100;
    
    // Find most common error
    let mostCommonError = 'none';
    let maxCount = 0;
    for (const [type, count] of Object.entries(stats.byType)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonError = type;
      }
    }
    
    // Calculate average errors per request
    const uniqueRequests = Object.keys(stats.byRequest).length;
    const averageErrorsPerRequest = uniqueRequests > 0
      ? Math.round((totalErrors / uniqueRequests) * 10) / 10
      : 0;
    
    // Build byType array with percentages
    const byType = Object.entries(stats.byType)
      .map(([type, count]) => ({
        type,
        count,
        percentage: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    
    // Get recent errors (top 5)
    const recentErrors = Object.entries(stats.byRequest)
      .map(([requestId, count]) => {
        const type = requestId.split('-')[0] || 'unknown';
        return { type, requestId, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    return {
      summary: {
        totalErrors,
        recoveryRate,
        mostCommonError,
        averageErrorsPerRequest,
      },
      byType,
      recentErrors,
    };
  }

  /**
   * Reset error statistics
   */
  resetStats(): void {
    this.errorCounts.clear();
    this.recoveryAttempts = 0;
    this.successfulRecoveries = 0;
  }

  // Private helper methods for error categorization

  private isParseError(errorMessage: string): boolean {
    const parseErrorPatterns = [
      'parse',
      'json',
      'syntax',
      'malformed',
      'invalid json',
      'unexpected token'
    ];
    return parseErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  private isConnectionError(errorMessage: string): boolean {
    const connectionErrorPatterns = [
      'network',
      'connection',
      'fetch',
      'abort',
      'disconnected',
      'offline'
    ];
    return connectionErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  private isInvalidEventError(errorMessage: string): boolean {
    const invalidEventPatterns = [
      'invalid event',
      'invalid code event',
      'unknown event',
      'malformed event',
      'event type',
      'failed to parse stream',
      'failed to parse json',
      'unexpected token',
      'malformed json'
    ];
    return invalidEventPatterns.some(pattern => errorMessage.includes(pattern));
  }

  private isTimeoutError(errorMessage: string): boolean {
    const timeoutErrorPatterns = [
      'timeout',
      'timed out',
      'deadline',
      'took too long'
    ];
    return timeoutErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }
}

// Export singleton instance
export const streamingErrorHandler = new StreamingErrorHandler({
  maxRetries: 3,
  retryDelay: 1000,
  exponentialBackoff: true,
  silentRecovery: true
});