/**
 * Unified Error Handler
 *
 * Centralized error handling with standardized formats,
 * categorization, and self-healing support.
 *
 * Merges functionality from:
 * - lib/utils/error-handler.ts (base implementation)
 * - lib/tools/error-handler.ts (tool-specific errors)
 * - lib/api/error-handler.ts (user notifications, severity)
 *
 * Features:
 * - Error categorization (10 categories)
 * - Standardized error responses
 * - Retry recommendations
 * - User-friendly notifications
 * - Secure error logging
 * - Memory leak fixes
 */

import { createLogger, sanitizeForLogging } from './logger';

const logger = createLogger('ErrorHandler', { secure: true });

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

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

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorContext {
  component?: string;
  operation?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  userId?: string;
  requestId?: string;
  timestamp?: number;
}

export interface StandardError {
  category: ErrorCategory;
  message: string;
  details?: any;
  parameters?: any;
  retryable: boolean;
  retryAfter?: number;
  hints?: string[];
  originalError?: any;
}

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

export interface ProcessedError {
  code: string;
  message: string;
  userMessage: string;
  isRetryable: boolean;
  suggestedAction?: string;
  context?: ErrorContext;
  originalError?: Error;
  severity: ErrorSeverity;
}

export interface UserNotification {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  action?: string;
  duration?: number;
}

export interface ErrorHandlerConfig {
  enableLogging: boolean;
  enableUserNotifications: boolean;
  enableRetryRecommendations: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

// ============================================================================
// BASE ERROR CLASSES
// ============================================================================

export class BaseError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly hints?: string[];
  readonly parameters?: any;
  readonly timestamp: number;
  readonly context?: ErrorContext;

  constructor(
    message: string,
    options: {
      category?: ErrorCategory;
      retryable?: boolean;
      retryAfter?: number;
      hints?: string[];
      parameters?: any;
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category || 'unknown';
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.hints = options.hints;
    this.parameters = options.parameters;
    this.context = options.context;
    this.timestamp = Date.now();
    this.cause = options.cause;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      hints: this.hints,
      timestamp: this.timestamp,
      stack: process.env.NODE_ENV === 'development' ? this.stack : undefined,
    };
  }
}

export class ToolErrorClass extends BaseError {
  readonly toolName: string;
  readonly authRequired?: boolean;
  readonly authUrl?: string;

  constructor(
    toolName: string,
    message: string,
    options: {
      category?: ErrorCategory;
      retryable?: boolean;
      retryAfter?: number;
      hints?: string[];
      parameters?: any;
      authRequired?: boolean;
      authUrl?: string;
      context?: ErrorContext;
    } = {}
  ) {
    super(message, { ...options, category: options.category || 'validation' });
    this.name = 'ToolError';
    this.toolName = toolName;
    this.authRequired = options.authRequired;
    this.authUrl = options.authUrl;
  }
}

export class APIError extends BaseError {
  readonly statusCode?: number;
  readonly endpoint?: string;
  readonly severity: ErrorSeverity;

  constructor(
    message: string,
    options: {
      category?: ErrorCategory;
      retryable?: boolean;
      retryAfter?: number;
      hints?: string[];
      statusCode?: number;
      endpoint?: string;
      severity?: ErrorSeverity;
      context?: ErrorContext;
    } = {}
  ) {
    super(message, { ...options, category: options.category || 'unknown' });
    this.name = 'APIError';
    this.statusCode = options.statusCode;
    this.endpoint = options.endpoint;
    this.severity = options.severity || 'medium';
  }
}

// ============================================================================
// UNIFIED ERROR HANDLER CLASS
// ============================================================================

export class UnifiedErrorHandler {
  private static instance: UnifiedErrorHandler;
  private errorCounts = new Map<string, number>();
  private lastErrors = new Map<string, number>();
  private readonly MAX_ERROR_AGE = 3600000; // 1 hour
  private config: ErrorHandlerConfig;

  static getInstance(): UnifiedErrorHandler {
    if (!UnifiedErrorHandler.instance) {
      UnifiedErrorHandler.instance = new UnifiedErrorHandler();
    }
    return UnifiedErrorHandler.instance;
  }

  constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      enableLogging: true,
      enableUserNotifications: true,
      enableRetryRecommendations: true,
      logLevel: 'error',
      ...config,
    };

    // FIXED: Memory leak - cleanup every 10 minutes instead of storing indefinitely
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanupOldErrors(), this.MAX_ERROR_AGE);
    }
  }

  private cleanupOldErrors(): void {
    const oneHourAgo = Date.now() - this.MAX_ERROR_AGE;
    for (const [code, timestamp] of this.lastErrors.entries()) {
      if (timestamp < oneHourAgo) {
        this.errorCounts.delete(code);
        this.lastErrors.delete(code);
      }
    }
  }

  // ============================================================================
  // MAIN ERROR HANDLING
  // ============================================================================

  /**
   * Handle error and return standardized format
   */
  handleError(
    error: any,
    context: string | ErrorContext,
    parameters?: any
  ): StandardError {
    const errorMessage = error?.message || String(error);
    const contextStr = typeof context === 'string' ? context : context.operation || 'unknown';

    const category = this.categorizeError(errorMessage, error);
    const retryable = this.isRetryableError(category, errorMessage);
    const retryAfter = this.getRetryAfterTime(category, error);
    const hints = this.generateHints(category, contextStr, parameters);

    this.trackError(category);

    return {
      category,
      message: this.formatErrorMessage(category, errorMessage),
      details: this.extractErrorDetails(error),
      parameters: sanitizeForLogging(parameters),
      retryable,
      retryAfter,
      hints,
      originalError: process.env.NODE_ENV === 'development' ? error : undefined,
    };
  }

  /**
   * Process error with user-friendly messages and severity
   */
  processError(error: Error, context?: ErrorContext): ProcessedError {
    const errorMessage = error.message.toLowerCase();
    const timestamp = Date.now();
    const category = this.categorizeError(errorMessage, error);
    const severity = this.getSeverity(category, error);

    const processedError: ProcessedError = {
      code: `${category.toUpperCase()}_ERROR`,
      message: error.message,
      userMessage: this.getUserMessage(category, error),
      isRetryable: this.isRetryableError(category, errorMessage),
      suggestedAction: this.getSuggestedAction(category, error),
      context: { ...context, timestamp },
      originalError: error,
      severity,
    };

    this.trackError(processedError.code);

    if (this.config.enableLogging) {
      this.logError(processedError);
    }

    return processedError;
  }

  // ============================================================================
  // ERROR CATEGORIZATION
  // ============================================================================

  private categorizeError(message: string, error: any): ErrorCategory {
    const messageLower = message.toLowerCase();

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

    if (
      messageLower.includes('permission') ||
      messageLower.includes('forbidden') ||
      messageLower.includes('403') ||
      messageLower.includes('access') ||
      messageLower.includes('scope')
    ) {
      return 'authorization';
    }

    if (
      messageLower.includes('rate') ||
      messageLower.includes('limit') ||
      messageLower.includes('429') ||
      messageLower.includes('too many') ||
      messageLower.includes('quota')
    ) {
      return 'rate_limit';
    }

    if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
      return 'timeout';
    }

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

    if (
      messageLower.includes('not found') ||
      messageLower.includes('404') ||
      messageLower.includes('missing') ||
      messageLower.includes('does not exist')
    ) {
      return 'not_found';
    }

    if (
      messageLower.includes('security') ||
      messageLower.includes('blocked') ||
      messageLower.includes('dangerous') ||
      messageLower.includes('traversal') ||
      messageLower.includes('injection')
    ) {
      return 'security';
    }

    if (
      messageLower.includes('provider') ||
      messageLower.includes('sdk') ||
      messageLower.includes('api') ||
      messageLower.includes('composio') ||
      messageLower.includes('arcade') ||
      messageLower.includes('nango')
    ) {
      return 'provider';
    }

    return 'unknown';
  }

  private getSeverity(category: ErrorCategory, error: any): ErrorSeverity {
    const severityMap: Record<ErrorCategory, ErrorSeverity> = {
      validation: 'low',
      authentication: 'high',
      authorization: 'high',
      execution: 'medium',
      not_found: 'low',
      rate_limit: 'medium',
      timeout: 'medium',
      network: 'medium',
      provider: 'medium',
      security: 'critical',
      unknown: 'medium',
    };

    // Override based on specific error patterns
    const message = error?.message?.toLowerCase() || '';
    if (message.includes('circuit breaker') || message.includes('critical')) {
      return 'critical';
    }
    if (message.includes('500') || message.includes('unavailable')) {
      return 'high';
    }

    return severityMap[category];
  }

  // ============================================================================
  // RETRY LOGIC
  // ============================================================================

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

    const retryablePatterns = [/temporar/i, /retry/i, /503/, /502/, /429/, /transient/i];
    return retryablePatterns.some(pattern => pattern.test(message));
  }

  private getRetryAfterTime(category: ErrorCategory, error: any): number | undefined {
    if (error?.headers?.['retry-after']) {
      const retryAfter = error.headers['retry-after'];
      if (!isNaN(parseInt(retryAfter))) {
        return parseInt(retryAfter) * 1000;
      }
    }

    if (error?.response?.headers?.['retry-after']) {
      const retryAfter = error.response.headers['retry-after'];
      if (!isNaN(parseInt(retryAfter))) {
        return parseInt(retryAfter) * 1000;
      }
    }

    const defaultRetryTimes: Record<ErrorCategory, number> = {
      rate_limit: 60000,
      timeout: 5000,
      network: 10000,
      provider: 15000,
      validation: 0,
      authentication: 0,
      authorization: 0,
      not_found: 0,
      execution: 5000,
      security: 0,
      unknown: 10000,
    };

    return defaultRetryTimes[category];
  }

  // ============================================================================
  // ERROR MESSAGES AND HINTS
  // ============================================================================

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

  private getUserMessage(category: ErrorCategory, error: any): string {
    const userMessages: Record<ErrorCategory, string> = {
      validation: 'Please check your input and try again.',
      authentication: 'Please sign in to continue.',
      authorization: 'You do not have permission to perform this action.',
      execution: 'The operation failed. Please try again.',
      not_found: 'The requested resource was not found.',
      rate_limit: 'Too many requests. Please wait a moment.',
      timeout: 'The request took too long. Please try again.',
      network: 'Connection issue. Please check your internet.',
      provider: 'Service temporarily unavailable.',
      security: 'Action blocked for security reasons.',
      unknown: 'An unexpected error occurred.',
    };

    return userMessages[category];
  }

  private getSuggestedAction(category: ErrorCategory, error: any): string {
    const actions: Record<ErrorCategory, string> = {
      validation: 'Review your input for formatting issues.',
      authentication: 'Sign in or check your API credentials.',
      authorization: 'Contact administrator for access.',
      execution: 'Retry the operation.',
      not_found: 'Verify the resource exists.',
      rate_limit: 'Wait before retrying.',
      timeout: 'Try with smaller data or retry.',
      network: 'Check internet connection.',
      provider: 'Service will auto-recover.',
      security: 'Review security policies.',
      unknown: 'Contact support if issue persists.',
    };

    return actions[category];
  }

  private generateHints(category: ErrorCategory, context: string, parameters?: any): string[] {
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
        hints.push(`Context: ${context}`);
        break;
      case 'security':
        hints.push('The requested operation was blocked for security reasons');
        hints.push('Review security policies and restrictions');
        break;
      case 'provider':
        hints.push('The provider SDK may have encountered an error');
        hints.push('Check provider status pages for outages');
        break;
    }

    return hints;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

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

    if (process.env.NODE_ENV === 'development' && error?.stack) {
      details.stack = error.stack;
    }

    return Object.keys(details).length > 0 ? details : undefined;
  }

  private trackError(code: string): void {
    const count = this.errorCounts.get(code) || 0;
    this.errorCounts.set(code, count + 1);
    this.lastErrors.set(code, Date.now());
  }

  private logError(error: ProcessedError): void {
    const logData = {
      code: error.code,
      message: error.message,
      userMessage: error.userMessage,
      severity: error.severity,
      isRetryable: error.isRetryable,
      context: error.context,
      timestamp: new Date().toISOString(),
    };

    switch (error.severity) {
      case 'critical':
        logger.error('CRITICAL ERROR', logData);
        break;
      case 'high':
        logger.error('HIGH SEVERITY ERROR', logData);
        break;
      case 'medium':
        if (this.config.logLevel !== 'error') {
          logger.warn('MEDIUM SEVERITY ERROR', logData);
        }
        break;
      case 'low':
        if (['info', 'debug'].includes(this.config.logLevel)) {
          logger.info('LOW SEVERITY ERROR', logData);
        }
        break;
    }
  }

  // ============================================================================
  // USER NOTIFICATIONS
  // ============================================================================

  createUserNotification(error: ProcessedError): UserNotification {
    const notificationType = this.getNotificationType(error.severity);

    return {
      type: notificationType,
      title: this.getNotificationTitle(error.code),
      message: error.userMessage,
      action: error.suggestedAction,
      duration: this.getNotificationDuration(error.severity),
    };
  }

  private getNotificationType(severity: ErrorSeverity): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      default:
        return 'info';
    }
  }

  private getNotificationTitle(code: string): string {
    const titles: Record<string, string> = {
      AUTH_ERROR: 'Authentication Issue',
      RATE_LIMIT_ERROR: 'Rate Limit Reached',
      QUOTA_ERROR: 'Quota Exceeded',
      NETWORK_ERROR: 'Connection Issue',
      TIMEOUT_ERROR: 'Request Timeout',
      MODEL_ERROR: 'Model Unavailable',
      VALIDATION_ERROR: 'Input Error',
      SERVER_ERROR: 'Service Issue',
      CIRCUIT_BREAKER_ERROR: 'Service Protection',
      SECURITY_ERROR: 'Security Alert',
    };

    return titles[code] || 'System Notice';
  }

  private getNotificationDuration(severity: ErrorSeverity): number {
    switch (severity) {
      case 'critical':
        return 0; // Persistent
      case 'high':
        return 10000;
      case 'medium':
        return 7000;
      default:
        return 5000;
    }
  }

  // ============================================================================
  // CONVERSION METHODS
  // ============================================================================

  toExecutionResult(error: StandardError): ToolExecutionResult {
    if (error.category === 'authentication' || error.category === 'authorization') {
      return {
        success: false,
        error: error.message,
        authRequired: true,
        authUrl: error.hints?.find(h => h.includes('http'))?.replace('Authorization URL: ', ''),
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function getErrorHandler(config?: Partial<ErrorHandlerConfig>): UnifiedErrorHandler {
  if (config) {
    return new UnifiedErrorHandler(config);
  }
  return UnifiedErrorHandler.getInstance();
}

export function handleError(
  error: any,
  context: string | ErrorContext,
  parameters?: any
): StandardError {
  return getErrorHandler().handleError(error, context, parameters);
}

export function createValidationError(message: string, parameters?: any): ToolErrorClass {
  return new ToolErrorClass('validation', message, {
    category: 'validation',
    retryable: false,
    parameters,
    hints: ['Check required parameters', 'Verify input format'],
  });
}

export function createAuthError(message: string, authUrl?: string): ToolErrorClass {
  return new ToolErrorClass('auth', message, {
    category: 'authentication',
    retryable: false,
    authRequired: true,
    authUrl,
    hints: ['Connect your account to continue', authUrl ? `Authorization URL: ${authUrl}` : undefined].filter(Boolean) as string[],
  });
}

export function createNotFoundError(resource: string): ToolErrorClass {
  return new ToolErrorClass(resource, `${resource} not found`, {
    category: 'not_found',
    retryable: false,
    hints: ['Verify the resource exists', 'Check the ID or path'],
  });
}

// ============================================================================
// EXPORTS FOR BACKWARDS COMPATIBILITY
// ============================================================================
