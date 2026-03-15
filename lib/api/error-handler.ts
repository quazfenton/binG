/**
 * Centralized Error Handling and User-Friendly Messages
 * 
 * @deprecated Use UnifiedErrorHandler from lib/utils/error-handler.ts instead
 * 
 * This module is kept for backwards compatibility.
 * All new code should use:
 * ```typescript
 * import { getErrorHandler, ProcessedError, UserNotification } from '@/lib/utils/error-handler';
 * const handler = getErrorHandler();
 * const error = handler.processError(error, context);
 * const notification = handler.createUserNotification(error);
 * ```
 */

// Re-export from unified error handler for backwards compatibility
export type { ProcessedError, UserNotification, ErrorCategory, ErrorSeverity, ErrorHandlerConfig } from '../utils/error-handler';
export {
  getErrorHandler,
  handleError,
} from '../utils/error-handler';

// Create default instance for backwards compatibility
import { UnifiedErrorHandler, type ProcessedError, type ErrorContext } from '../utils/error-handler';

export class ErrorHandler {
  private static instance: ErrorHandler;
  private handler: UnifiedErrorHandler;

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  constructor(config?: any) {
    this.handler = UnifiedErrorHandler.getInstance();
  }

  processError(error: Error, context?: ErrorContext): ProcessedError {
    return this.handler.processError(error, context);
  }

  createUserNotification(error: ProcessedError) {
    return this.handler.createUserNotification(error);
  }

  getErrorStats() {
    return {};
  }

  getFrequentErrors(limit: number = 3) {
    return [];
  }

  clearErrorStats() {
  }
}

export function createErrorHandler(config?: any): ErrorHandler {
  return ErrorHandler.getInstance();
}

export const errorHandler = ErrorHandler.getInstance();

// Legacy error code constants
export const ERROR_CODES = {
  AUTH_ERROR: 'AUTH_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  QUOTA_ERROR: 'QUOTA_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  MODEL_ERROR: 'MODEL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  CIRCUIT_BREAKER_ERROR: 'CIRCUIT_BREAKER_ERROR',
};
