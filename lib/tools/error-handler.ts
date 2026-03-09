/**
 * Tool Error Handler
 *
 * Centralized error handling for tool execution.
 * Provides standardized error responses and self-healing support.
 *
 * Features:
 * - Standardized error formats
 * - Error categorization
 * - Retry recommendations
 * - Self-healing hints
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
  | 'unknown';

export interface ToolError {
  category: ErrorCategory;
  message: string;
  details?: any;
  parameters?: any;
  retryable: boolean;
  retryAfter?: number;
  hints?: string[];
}

export interface ToolExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  authRequired?: boolean;
  authUrl?: string;
  provider?: string;
  fallbackChain?: string[];
}

/**
 * Tool Error Handler Class
 */
export class ToolErrorHandler {
  private static instance: ToolErrorHandler;

  static getInstance(): ToolErrorHandler {
    if (!ToolErrorHandler.instance) {
      ToolErrorHandler.instance = new ToolErrorHandler();
    }
    return ToolErrorHandler.instance;
  }

  /**
   * Handle error from tool execution
   */
  handleError(error: Error | any, toolName: string, parameters?: any): ToolError {
    const errorMessage = error?.message || String(error);
    
    // Categorize error
    const category = this.categorizeError(errorMessage, error);
    
    // Determine if retryable
    const retryable = this.isRetryableError(category, errorMessage);
    
    // Get retry after time
    const retryAfter = this.getRetryAfterTime(category, error);
    
    // Generate hints
    const hints = this.generateHints(category, toolName, parameters);

    return {
      category,
      message: this.formatErrorMessage(category, errorMessage),
      details: this.extractErrorDetails(error),
      parameters,
      retryable,
      retryAfter,
      hints,
    };
  }

  /**
   * Categorize error
   */
  private categorizeError(message: string, error: any): ErrorCategory {
    const messageLower = message.toLowerCase();

    // Validation errors
    if (
      messageLower.includes('required') ||
      messageLower.includes('invalid') ||
      messageLower.includes('validation') ||
      messageLower.includes('schema') ||
      messageLower.includes('parse')
    ) {
      return 'validation';
    }

    // Authentication errors
    if (
      messageLower.includes('auth') ||
      messageLower.includes('unauthorized') ||
      messageLower.includes('401') ||
      messageLower.includes('token') ||
      messageLower.includes('credential')
    ) {
      return 'authentication';
    }

    // Authorization errors
    if (
      messageLower.includes('permission') ||
      messageLower.includes('forbidden') ||
      messageLower.includes('403') ||
      messageLower.includes('access')
    ) {
      return 'authorization';
    }

    // Rate limit errors
    if (
      messageLower.includes('rate') ||
      messageLower.includes('limit') ||
      messageLower.includes('429') ||
      messageLower.includes('too many')
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
      messageLower.includes('502')
    ) {
      return 'network';
    }

    // Not found errors
    if (
      messageLower.includes('not found') ||
      messageLower.includes('404') ||
      messageLower.includes('missing')
    ) {
      return 'not_found';
    }

    // Provider errors
    if (
      messageLower.includes('provider') ||
      messageLower.includes('sdk') ||
      messageLower.includes('api')
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
    ];

    return retryablePatterns.some(pattern => pattern.test(message));
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

    // Default retry times by category
    const defaultRetryTimes: Record<ErrorCategory, number> = {
      rate_limit: 60000, // 1 minute
      timeout: 5000, // 5 seconds
      network: 10000, // 10 seconds
      provider: 15000, // 15 seconds
      validation: 0,
      authentication: 0,
      authorization: 0,
      not_found: 0,
      execution: 5000,
      unknown: 10000,
    };

    return defaultRetryTimes[category];
  }

  /**
   * Format error message
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
      unknown: 'Error',
    };

    return `${prefixes[category]}: ${message}`;
  }

  /**
   * Extract error details
   */
  private extractErrorDetails(error: any): any {
    const details: any = {};

    if (error?.response?.status) {
      details.statusCode = error.response.status;
    }

    if (error?.response?.data) {
      details.responseData = error.response.data;
    }

    if (error?.code) {
      details.code = error.code;
    }

    if (error?.stack) {
      details.stack = error.stack;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }

  /**
   * Generate hints for fixing the error
   */
  private generateHints(category: ErrorCategory, toolName: string, parameters?: any): string[] {
    const hints: string[] = [];

    switch (category) {
      case 'validation':
        hints.push('Check that all required parameters are provided');
        hints.push('Verify parameter types match the schema');
        if (parameters) {
          hints.push(`Provided parameters: ${JSON.stringify(parameters, null, 2)}`);
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
        hints.push(`Tool ${toolName} may not be available`);
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
   * Convert error to standardized result
   */
  toExecutionResult(error: ToolError): ToolExecutionResult {
    if (error.category === 'authentication' || error.category === 'authorization') {
      return {
        success: false,
        error: error.message,
        authRequired: true,
        authUrl: '/api/auth', // Should be populated by caller
      };
    }

    return {
      success: false,
      error: error.message,
      retryable: error.retryable,
    };
  }

  /**
   * Create validation error
   */
  createValidationError(message: string, parameters?: any): ToolError {
    return {
      category: 'validation',
      message: `Invalid input: ${message}`,
      parameters,
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
  createAuthError(message: string, authUrl?: string): ToolError {
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
  createNotFoundError(toolName: string): ToolError {
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
}

/**
 * Get tool error handler instance
 */
export function getToolErrorHandler(): ToolErrorHandler {
  return ToolErrorHandler.getInstance();
}
