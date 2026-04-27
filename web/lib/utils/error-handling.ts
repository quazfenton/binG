/**
 * Error Handling Utilities
 *
 * Standardized error handling, logging, and user-friendly error messages
 * for the binG application.
 */

import { createLogger } from './logger';

const logger = createLogger('ErrorHandler');

/**
 * Standard error types for binG
 */
export class BinGError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'BinGError';
  }
}

/**
 * Validation error for user input
 */
export class ValidationError extends BinGError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends BinGError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error
 */
export class AuthorizationError extends BinGError {
  constructor(message: string = 'Access denied') {
    super(message, 'AUTHZ_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends BinGError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limiting error
 */
export class RateLimitError extends BinGError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

/**
 * External service error
 */
export class ServiceError extends BinGError {
  constructor(service: string, originalError: Error) {
    // Use sanitized user-facing message, keep original error in details for logging
    super(`${service} service is currently unavailable. Please try again later.`, 'SERVICE_ERROR', 502, { service, originalError });
    this.name = 'ServiceError';
  }
}

/**
 * Handle and log errors with appropriate user messaging
 */
export function handleError(error: unknown, context?: string): {
  userMessage: string;
  logMessage: string;
  statusCode: number;
} {
  const contextStr = context ? `[${context}] ` : '';

  if (error instanceof BinGError) {
    logger.error(`${contextStr}${error.message}`, {
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    });

    return {
      userMessage: error.message,
      logMessage: `${contextStr}${error.code}: ${error.message}`,
      statusCode: error.statusCode
    };
  }

  if (error instanceof Error) {
    logger.error(`${contextStr}Unexpected error`, error);

    // Provide user-friendly messages for common errors
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      return {
        userMessage: 'Service temporarily unavailable. Please try again later.',
        logMessage: `${contextStr}Connection error: ${error.message}`,
        statusCode: 503
      };
    }

    if (error.message.includes('timeout')) {
      return {
        userMessage: 'Request timed out. Please try again.',
        logMessage: `${contextStr}Timeout error: ${error.message}`,
        statusCode: 408
      };
    }

    return {
      userMessage: 'An unexpected error occurred. Please try again.',
      logMessage: `${contextStr}Unexpected error: ${error.message}`,
      statusCode: 500
    };
  }

  logger.error(`${contextStr}Unknown error type`, { error });

  return {
    userMessage: 'An unknown error occurred.',
    logMessage: `${contextStr}Unknown error: ${error}`,
    statusCode: 500
  };
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context?: string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const { userMessage, logMessage } = handleError(error, context);
      throw new Error(userMessage);
    }
  };
}

/**
 * Create retry wrapper for operations
 */
export function withRetry<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
    retryCondition?: (error: unknown) => boolean;
  } = {}
): (...args: T) => Promise<R> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    retryCondition = () => true
  } = options;

  return async (...args: T): Promise<R> => {
    let lastError: unknown;
    let currentDelay = delayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || !retryCondition(error)) {
          throw error;
        }

        logger.warn(`Attempt ${attempt} failed, retrying in ${currentDelay}ms`, error);
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay *= backoffMultiplier;
      }
    }

    throw lastError;
  };
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: unknown): string {
  if (error instanceof BinGError) {
    return error.message;
  }

  if (error instanceof Error) {
    // Provide user-friendly messages for common system errors
    if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
      return 'Permission denied. Please check file permissions.';
    }

    if (error.message.includes('ENOSPC')) {
      return 'Disk full. Please free up space.';
    }

    if (error.message.includes('EMFILE')) {
      return 'Too many open files. Please restart the application.';
    }

    return 'An error occurred. Please try again.';
  }

  return 'An unknown error occurred.';
}