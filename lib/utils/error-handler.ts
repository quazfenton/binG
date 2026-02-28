/**
 * Unified Error Handler
 *
 * Centralized error handling with standardized formats,
 * categorization, and self-healing support.
 *
 * Features:
 * - Error categorization
 * - Standardized error responses
 * - Retry recommendations
 * - Self-healing hints
 * - Secure error logging
 *
 * @see lib/utils/secure-logger.ts Secure logging
 */

import { logger, sanitizeForLogging } from './secure-logger';

/**
 * Error categories for standardized handling
 */
export type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'execution'
  | 'not_found'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider'
  | 'security'
  | 'unknown';

/**
 * Standardized error object
 */
export interface StandardError {
  /** Error category */
  category: ErrorCategory;
  /** Human-readable message */
  message: string;
  /** Additional error details */
  details?: any;
  /** Parameters that caused the error */
  parameters?: any;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Suggested retry delay in milliseconds */
  retryAfter?: number;
  /** Hints for fixing the error */
  hints?: string[];
  /** Original error (sanitized) */
  originalError?: any;
}

/**
 * Standardized execution result
 */
export interface ExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Execution output/data */
  output?: any;
  /** Error information if failed */
  error?: string;
  /** Whether authentication is required */
  authRequired?: boolean;
  /** Authentication URL if required */
  authUrl?: string;
  /** Provider that executed the request */
  provider?: string;
  /** Fallback chain that was attempted */
  fallbackChain?: string[];
}

/**
 * Unified Error Handler Class
 *
 * @example
 * ```typescript
 * const handler = getErrorHandler();
 *
 * try {
 *   await executeTool();
 * } catch (error) {
 *   const standardError = handler.handleError(error, 'tool_name', params);
 *   logger.error('Tool failed', standardError);
 *
 *   if (standardError.retryable) {
 *     setTimeout(() => retry(), standardError.retryAfter);
 *   }
 * }
 * ```
 */
export class UnifiedErrorHandler {
  private static instance: UnifiedErrorHandler;

  static getInstance(): UnifiedErrorHandler {
    if (!UnifiedErrorHandler.instance) {
      UnifiedErrorHandler.instance = new UnifiedErrorHandler();
    }
    return UnifiedErrorHandler.instance;
  }

  /**
   * Handle error and return standardized format
   *
   * @param error - Error to handle
   * @param context - Context (tool name, service, etc.)
   * @param parameters - Parameters that caused the error
   * @returns Standardized error object
   */
  handleError(
    error: any,
    context: string,
    parameters?: any
  ): StandardError {
    const errorMessage = error?.message || String(error);

    // Categorize error
    const category = this.categorizeError(errorMessage, error);

    // Determine if retryable
    const retryable = this.isRetryableError(category, errorMessage);

    // Get retry after time
    const retryAfter = this.getRetryAfterTime(category, error);

    // Generate hints
    const hints = this.generateHints(category, context, parameters);

    // Log error securely (sanitized)
    logger.error(`[${category}] ${context}: ${errorMessage}`, {
      category,
      context,
      retryable,
      retryAfter,
      // Never log full error object - sanitize it
      details: sanitizeForLogging(error),
    });

    return {
      category,
      message: this.formatErrorMessage(category, errorMessage),
      details: this.extractErrorDetails(error),
      parameters: sanitizeForLogging(parameters),
      retryable,
      retryAfter,
      hints,
      originalError: sanitizeForLogging(error),
    };
  }

  /**
   * Categorize error based on message and type
   */
  private categorizeError(message: string, error: any): ErrorCategory {
    const messageLower = message.toLowerCase();

    // Validation errors
    if (
      messageLower.includes('required') ||
      messageLower.includes('invalid') ||
      messageLower.includes('validation') ||
      messageLower.includes('schema') ||
      messageLower.includes('parse') ||
      messageLower.includes('zod')
    ) {
      return 'validation';
    }

    // Authentication errors
    if (
      messageLower.includes('auth') ||
      messageLower.includes('unauthorized') ||
      messageLower.includes('401') ||
      messageLower.includes('token') ||
      messageLower.includes('credential') ||
      messageLower.includes('api key') ||
      messageLower.includes('apikey')
    ) {
      return 'authentication';
    }

    // Authorization errors
    if (
      messageLower.includes('permission') ||
      messageLower.includes('forbidden') ||
      messageLower.includes('403') ||
      messageLower.includes('access') ||
      messageLower.includes('scope')
    ) {
      return 'authorization';
    }

    // Rate limit errors
    if (
      messageLower.includes('rate') ||
      messageLower.includes('limit') ||
      messageLower.includes('429') ||
      messageLower.includes('too many') ||
      messageLower.includes('quota')
    ) {
      return 'rate_limit';
    }

    // Timeout errors
    if (
      messageLower.includes('timeout') ||
      messageLower.includes('timed out')
    ) {
      return 'timeout';
    }

    // Network errors
    if (
      messageLower.includes('network') ||
      messageLower.includes('connection') ||
      messageLower.includes('fetch') ||
      messageLower.includes('503') ||
      messageLower.includes('502') ||
      messageLower.includes('500') ||
      messageLower.includes('ECONNREFUSED') ||
      messageLower.includes('ENOTFOUND')
    ) {
      return 'network';
    }

    // Not found errors
    if (
      messageLower.includes('not found') ||
      messageLower.includes('404') ||
      messageLower.includes('missing') ||
      messageLower.includes('does not exist')
    ) {
      return 'not_found';
    }

    // Security errors
    if (
      messageLower.includes('security') ||
      messageLower.includes('blocked') ||
      messageLower.includes('dangerous') ||
      messageLower.includes('traversal') ||
      messageLower.includes('injection')
    ) {
      return 'security';
    }

    // Provider errors
    if (
      messageLower.includes('provider') ||
      messageLower.includes('sdk') ||
      messageLower.includes('composio') ||
      messageLower.includes('arcade') ||
      messageLower.includes('nango')
    ) {
      return 'provider';
    }

    return 'unknown';
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(category: ErrorCategory, message: string): boolean {
    const retryableCategories: ErrorCategory[] = [
      'rate_limit',
      'timeout',
      'network',
      'provider',
    ];

    if (retryableCategories.includes(category)) {
      return true;
    }

    // Check message for retryable patterns
    const retryablePatterns = [
      /temporar/i,
      /retry/i,
      /503/,
      /502/,
      /429/,
      /transient/i,
    ];

    return retryablePatterns.some((pattern) => pattern.test(message));
  }

  /**
   * Get retry after time in milliseconds
   */
  private getRetryAfterTime(category: ErrorCategory, error: any): number | undefined {
    // Check for Retry-After header
    if (error?.headers?.['retry-after']) {
      const retryAfter = error.headers['retry-after'];
      if (!isNaN(parseInt(retryAfter))) {
        return parseInt(retryAfter) * 1000;
      }
    }

    // Check for Retry-After in response
    if (error?.response?.headers?.['retry-after']) {
      const retryAfter = error.response.headers['retry-after'];
      if (!isNaN(parseInt(retryAfter))) {
        return parseInt(retryAfter) * 1000;
      }
    }

    // Default retry times by category
    const defaultRetryTimes: Record<ErrorCategory, number> = {
      rate_limit: 60000, // 1 minute
      timeout: 5000, // 5 seconds
      network: 10000, // 10 seconds
      provider: 15000, // 15 seconds
      validation: 0, // Not retryable
      authentication: 0, // Not retryable
      authorization: 0, // Not retryable
      not_found: 0, // Not retryable
      execution: 5000, // 5 seconds
      security: 0, // Not retryable
      unknown: 10000, // 10 seconds
    };

    return defaultRetryTimes[category];
  }

  /**
   * Format error message with category prefix
   */
  private formatErrorMessage(category: ErrorCategory, message: string): string {
    const prefixes: Record<ErrorCategory, string> = {
      validation: 'Invalid input',
      authentication: 'Authentication required',
      authorization: 'Authorization failed',
      execution: 'Execution failed',
      not_found: 'Not found',
      rate_limit: 'Rate limit exceeded',
      timeout: 'Request timed out',
      network: 'Network error',
      provider: 'Provider error',
      security: 'Security violation',
      unknown: 'Error',
    };

    return `${prefixes[category]}: ${message}`;
  }

  /**
   * Extract error details (sanitized)
   */
  private extractErrorDetails(error: any): any {
    const details: any = {};

    if (error?.response?.status) {
      details.statusCode = error.response.status;
    }

    if (error?.response?.data) {
      details.responseData = sanitizeForLogging(error.response.data);
    }

    if (error?.code) {
      details.code = error.code;
    }

    // Never include full stack trace in production
    if (process.env.NODE_ENV === 'development' && error?.stack) {
      details.stack = error.stack;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }

  /**
   * Generate hints for fixing the error
   */
  private generateHints(
    category: ErrorCategory,
    context: string,
    parameters?: any
  ): string[] {
    const hints: string[] = [];

    switch (category) {
      case 'validation':
        hints.push('Check that all required parameters are provided');
        hints.push('Verify parameter types match the schema');
        if (parameters) {
          hints.push(`Provided parameters: ${JSON.stringify(sanitizeForLogging(parameters), null, 2)}`);
        }
        break;

      case 'authentication':
        hints.push('Ensure the user has connected their account');
        hints.push('Check if the OAuth token has expired');
        hints.push('Verify API keys are configured correctly');
        break;

      case 'authorization':
        hints.push('The user may not have permission for this action');
        hints.push('Check if the connected account has required scopes');
        break;

      case 'rate_limit':
        hints.push('Wait before retrying');
        hints.push('Consider implementing exponential backoff');
        hints.push('Check your quota usage');
        break;

      case 'timeout':
        hints.push('The operation took too long to complete');
        hints.push('Try again with a smaller dataset');
        hints.push('Check if the external service is experiencing issues');
        break;

      case 'network':
        hints.push('Check your internet connection');
        hints.push('The external service may be temporarily unavailable');
        hints.push('Retry after a short delay');
        break;

      case 'not_found':
        hints.push('Verify the resource exists');
        hints.push('Check if the ID or path is correct');
        hints.push(`Tool ${context} may not be available`);
        break;

      case 'security':
        hints.push('The requested operation was blocked for security reasons');
        hints.push('Review security policies and restrictions');
        break;

      case 'provider':
        hints.push('The provider SDK may have encountered an error');
        hints.push('Check provider status pages for outages');
        break;

      case 'execution':
        hints.push('Review the tool parameters');
        hints.push('Check if the sandbox environment is available');
        break;
    }

    return hints;
  }

  /**
   * Create validation error
   */
  createValidationError(message: string, parameters?: any): StandardError {
    return {
      category: 'validation',
      message: `Invalid input: ${message}`,
      parameters: sanitizeForLogging(parameters),
      retryable: false,
      hints: [
        'Check that all required parameters are provided',
        'Verify parameter types and formats',
      ],
    };
  }

  /**
   * Create authentication error
   */
  createAuthError(message: string, authUrl?: string): StandardError {
    return {
      category: 'authentication',
      message: `Authentication required: ${message}`,
      retryable: false,
      hints: [
        'Connect your account to use this tool',
        authUrl ? `Authorization URL: ${authUrl}` : undefined,
      ].filter(Boolean) as string[],
    };
  }

  /**
   * Create not found error
   */
  createNotFoundError(toolName: string): StandardError {
    return {
      category: 'not_found',
      message: `Tool ${toolName} not found`,
      retryable: false,
      hints: [
        'Check the tool name spelling',
        'Verify the tool is registered with the provider',
        'Use tool discovery to find available tools',
      ],
    };
  }

  /**
   * Convert standard error to execution result
   */
  toExecutionResult(error: StandardError): ExecutionResult {
    if (error.category === 'authentication' || error.category === 'authorization') {
      return {
        success: false,
        error: error.message,
        authRequired: true,
        authUrl: error.hints?.find((h) => h.includes('Authorization URL'))?.replace('Authorization URL: ', ''),
      };
    }

    return {
      success: false,
      error: error.message,
      retryable: error.retryable,
    };
  }
}

/**
 * Get unified error handler instance
 */
export function getErrorHandler(): UnifiedErrorHandler {
  return UnifiedErrorHandler.getInstance();
}

/**
 * Handle error with default handler
 */
export function handleError(error: any, context: string, parameters?: any): StandardError {
  return getErrorHandler().handleError(error, context, parameters);
}

/**
 * Create validation error
 */
export function createValidationError(message: string, parameters?: any): StandardError {
  return getErrorHandler().createValidationError(message, parameters);
}

/**
 * Create authentication error
 */
export function createAuthError(message: string, authUrl?: string): StandardError {
  return getErrorHandler().createAuthError(message, authUrl);
}
