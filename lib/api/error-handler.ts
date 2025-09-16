/**
 * Centralized Error Handling and User-Friendly Messages
 * 
 * Provides consistent error handling across the application with
 * user-friendly messages and proper error categorization.
 */

export interface ErrorContext {
  component?: string;
  operation?: string;
  provider?: string;
  model?: string;
  userId?: string;
  requestId?: string;
  timestamp?: number;
}

export interface ProcessedError {
  code: string;
  message: string;
  userMessage: string;
  isRetryable: boolean;
  suggestedAction?: string;
  context?: ErrorContext;
  originalError?: Error;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorHandlerConfig {
  enableLogging: boolean;
  enableUserNotifications: boolean;
  enableRetryRecommendations: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

export class ErrorHandler {
  private config: ErrorHandlerConfig;
  private errorCounts = new Map<string, number>();
  private lastErrors = new Map<string, number>();

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      enableLogging: true,
      enableUserNotifications: true,
      enableRetryRecommendations: true,
      logLevel: 'error',
      ...config
    };
  }

  processError(error: Error, context?: ErrorContext): ProcessedError {
    const processedError = this.categorizeError(error, context);
    
    // Track error frequency
    this.trackError(processedError.code);
    
    // Log error if enabled
    if (this.config.enableLogging) {
      this.logError(processedError);
    }

    return processedError;
  }

  private categorizeError(error: Error, context?: ErrorContext): ProcessedError {
    const errorMessage = error.message.toLowerCase();
    const timestamp = Date.now();

    // API Authentication Errors
    if (this.isAuthError(errorMessage)) {
      return {
        code: 'AUTH_ERROR',
        message: error.message,
        userMessage: 'Authentication failed. Please check your API key configuration.',
        isRetryable: false,
        suggestedAction: 'Verify your API keys in the settings and ensure they have the correct permissions.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'high'
      };
    }

    // Rate Limiting Errors
    if (this.isRateLimitError(errorMessage)) {
      return {
        code: 'RATE_LIMIT_ERROR',
        message: error.message,
        userMessage: 'Too many requests. The system will automatically retry with a different provider.',
        isRetryable: true,
        suggestedAction: 'Please wait a moment. The system is automatically switching to alternative providers.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Quota/Billing Errors
    if (this.isQuotaError(errorMessage)) {
      return {
        code: 'QUOTA_ERROR',
        message: error.message,
        userMessage: 'API quota exceeded. Switching to alternative provider.',
        isRetryable: true,
        suggestedAction: 'The system will try alternative providers. Consider upgrading your API plan if this persists.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Network/Connection Errors
    if (this.isNetworkError(errorMessage)) {
      return {
        code: 'NETWORK_ERROR',
        message: error.message,
        userMessage: 'Connection issue detected. Checking alternative providers.',
        isRetryable: true,
        suggestedAction: 'Please check your internet connection. The system will automatically retry.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Timeout Errors
    if (this.isTimeoutError(errorMessage)) {
      return {
        code: 'TIMEOUT_ERROR',
        message: error.message,
        userMessage: 'Request timed out. The system will retry with optimized settings.',
        isRetryable: true,
        suggestedAction: 'The request is taking longer than usual. The system will automatically retry.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Model/Provider Specific Errors
    if (this.isModelError(errorMessage)) {
      return {
        code: 'MODEL_ERROR',
        message: error.message,
        userMessage: 'The selected model is currently unavailable. Trying alternative models.',
        isRetryable: true,
        suggestedAction: 'The system will automatically try compatible models from other providers.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Input Validation Errors
    if (this.isValidationError(errorMessage)) {
      return {
        code: 'VALIDATION_ERROR',
        message: error.message,
        userMessage: 'Invalid input detected. Please check your request and try again.',
        isRetryable: false,
        suggestedAction: 'Please review your input for any formatting issues or invalid characters.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'low'
      };
    }

    // Server Errors
    if (this.isServerError(errorMessage)) {
      return {
        code: 'SERVER_ERROR',
        message: error.message,
        userMessage: 'Service temporarily unavailable. The system will try alternative providers.',
        isRetryable: true,
        suggestedAction: 'This is a temporary issue. The system will automatically retry with other providers.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'high'
      };
    }

    // Circuit Breaker Errors
    if (this.isCircuitBreakerError(errorMessage)) {
      return {
        code: 'CIRCUIT_BREAKER_ERROR',
        message: error.message,
        userMessage: 'Service protection activated. Using alternative providers.',
        isRetryable: true,
        suggestedAction: 'The system has temporarily disabled a problematic service and is using alternatives.',
        context: { ...context, timestamp },
        originalError: error,
        severity: 'medium'
      };
    }

    // Generic/Unknown Errors
    return {
      code: 'UNKNOWN_ERROR',
      message: error.message,
      userMessage: 'An unexpected error occurred. The system will attempt to recover.',
      isRetryable: true,
      suggestedAction: 'Please try again. If the problem persists, contact support.',
      context: { ...context, timestamp },
      originalError: error,
      severity: 'medium'
    };
  }

  private isAuthError(message: string): boolean {
    const authPatterns = [
      'api key',
      'authentication',
      'unauthorized',
      'invalid key',
      'access denied',
      'forbidden',
      '401',
      '403'
    ];
    return authPatterns.some(pattern => message.includes(pattern));
  }

  private isRateLimitError(message: string): boolean {
    const rateLimitPatterns = [
      'rate limit',
      'too many requests',
      'throttled',
      'rate exceeded',
      '429'
    ];
    return rateLimitPatterns.some(pattern => message.includes(pattern));
  }

  private isQuotaError(message: string): boolean {
    const quotaPatterns = [
      'quota',
      'billing',
      'usage limit',
      'credit',
      'insufficient funds',
      'payment required',
      '402'
    ];
    return quotaPatterns.some(pattern => message.includes(pattern));
  }

  private isNetworkError(message: string): boolean {
    const networkPatterns = [
      'network',
      'connection',
      'fetch',
      'dns',
      'unreachable',
      'connection refused',
      'connection reset'
    ];
    return networkPatterns.some(pattern => message.includes(pattern));
  }

  private isTimeoutError(message: string): boolean {
    const timeoutPatterns = [
      'timeout',
      'timed out',
      'deadline exceeded',
      'request timeout',
      '408',
      '504'
    ];
    return timeoutPatterns.some(pattern => message.includes(pattern));
  }

  private isModelError(message: string): boolean {
    const modelPatterns = [
      'model not found',
      'model unavailable',
      'unsupported model',
      'model error',
      'invalid model'
    ];
    return modelPatterns.some(pattern => message.includes(pattern));
  }

  private isValidationError(message: string): boolean {
    const validationPatterns = [
      'validation',
      'invalid input',
      'bad request',
      'malformed',
      'invalid format',
      '400'
    ];
    return validationPatterns.some(pattern => message.includes(pattern));
  }

  private isServerError(message: string): boolean {
    const serverPatterns = [
      'internal server error',
      'service unavailable',
      'bad gateway',
      'server error',
      '500',
      '502',
      '503'
    ];
    return serverPatterns.some(pattern => message.includes(pattern));
  }

  private isCircuitBreakerError(message: string): boolean {
    const circuitBreakerPatterns = [
      'circuit breaker',
      'circuit open',
      'service protection',
      'endpoint disabled'
    ];
    return circuitBreakerPatterns.some(pattern => message.includes(pattern));
  }

  private trackError(errorCode: string): void {
    const count = this.errorCounts.get(errorCode) || 0;
    this.errorCounts.set(errorCode, count + 1);
    this.lastErrors.set(errorCode, Date.now());
  }

  private logError(error: ProcessedError): void {
    const logData = {
      code: error.code,
      message: error.message,
      userMessage: error.userMessage,
      severity: error.severity,
      isRetryable: error.isRetryable,
      context: error.context,
      timestamp: new Date().toISOString()
    };

    switch (error.severity) {
      case 'critical':
        console.error('CRITICAL ERROR:', logData);
        break;
      case 'high':
        console.error('HIGH SEVERITY ERROR:', logData);
        break;
      case 'medium':
        if (this.config.logLevel !== 'error') {
          console.warn('MEDIUM SEVERITY ERROR:', logData);
        }
        break;
      case 'low':
        if (['info', 'debug'].includes(this.config.logLevel)) {
          console.info('LOW SEVERITY ERROR:', logData);
        }
        break;
    }
  }

  // Utility methods for error analysis
  getErrorStats(): Record<string, { count: number; lastOccurrence: number }> {
    const stats: Record<string, { count: number; lastOccurrence: number }> = {};
    
    this.errorCounts.forEach((count, code) => {
      stats[code] = {
        count,
        lastOccurrence: this.lastErrors.get(code) || 0
      };
    });

    return stats;
  }

  getFrequentErrors(threshold: number = 5): string[] {
    return Array.from(this.errorCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([code, _]) => code);
  }

  clearErrorStats(): void {
    this.errorCounts.clear();
    this.lastErrors.clear();
  }

  // Factory method for creating user notifications
  createUserNotification(error: ProcessedError): {
    type: 'error' | 'warning' | 'info';
    title: string;
    message: string;
    action?: string;
    duration?: number;
  } {
    const notificationType = this.getNotificationType(error.severity);
    
    return {
      type: notificationType,
      title: this.getNotificationTitle(error.code),
      message: error.userMessage,
      action: error.suggestedAction,
      duration: this.getNotificationDuration(error.severity)
    };
  }

  private getNotificationType(severity: string): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
      default:
        return 'info';
    }
  }

  private getNotificationTitle(errorCode: string): string {
    const titles: Record<string, string> = {
      'AUTH_ERROR': 'Authentication Issue',
      'RATE_LIMIT_ERROR': 'Rate Limit Reached',
      'QUOTA_ERROR': 'Quota Exceeded',
      'NETWORK_ERROR': 'Connection Issue',
      'TIMEOUT_ERROR': 'Request Timeout',
      'MODEL_ERROR': 'Model Unavailable',
      'VALIDATION_ERROR': 'Input Error',
      'SERVER_ERROR': 'Service Issue',
      'CIRCUIT_BREAKER_ERROR': 'Service Protection',
      'UNKNOWN_ERROR': 'Unexpected Error'
    };

    return titles[errorCode] || 'System Notice';
  }

  private getNotificationDuration(severity: string): number {
    switch (severity) {
      case 'critical':
        return 0; // Persistent
      case 'high':
        return 10000; // 10 seconds
      case 'medium':
        return 7000; // 7 seconds
      case 'low':
      default:
        return 5000; // 5 seconds
    }
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

// Export factory function for custom configurations
export function createErrorHandler(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
  return new ErrorHandler(config);
}