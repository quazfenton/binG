/**
 * Code Mode Error Handler
 * 
 * Centralized error handling system for code mode operations,
 * providing consistent error reporting, recovery strategies, and user notifications.
 */

export interface CodeModeErrorData {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
  sessionId?: string;
  recoverable: boolean;
  userMessage: string;
  suggestedActions?: string[];
}

export class CodeModeError extends Error implements CodeModeErrorData {
  code: string;
  details?: any;
  timestamp: Date;
  sessionId?: string;
  recoverable: boolean;
  userMessage: string;
  suggestedActions?: string[];

  constructor(data: CodeModeErrorData) {
    super(data.message);
    this.name = 'CodeModeError';
    this.code = data.code;
    this.details = data.details;
    this.timestamp = data.timestamp;
    this.sessionId = data.sessionId;
    this.recoverable = data.recoverable;
    this.userMessage = data.userMessage;
    this.suggestedActions = data.suggestedActions;
  }
}

export type CodeModeErrorCode = 
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LIMIT_EXCEEDED'
  | 'ORCHESTRATOR_FAILED'
  | 'DIFF_APPLICATION_FAILED'
  | 'FILE_VALIDATION_FAILED'
  | 'SYNTAX_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'PERMISSION_DENIED'
  | 'INVALID_REQUEST'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN_ERROR';

export class CodeModeErrorHandler {
  private static errorMessages: Record<CodeModeErrorCode, {
    message: string;
    userMessage: string;
    recoverable: boolean;
    suggestedActions?: string[];
  }> = {
    SESSION_NOT_FOUND: {
      message: 'Code mode session not found',
      userMessage: 'Your code editing session has expired or was not found. Please start a new session.',
      recoverable: true,
      suggestedActions: ['Create a new session', 'Refresh the page'],
    },
    SESSION_LIMIT_EXCEEDED: {
      message: 'Maximum concurrent sessions exceeded',
      userMessage: 'Too many code editing sessions are active. Please close some sessions and try again.',
      recoverable: true,
      suggestedActions: ['Close unused sessions', 'Wait for sessions to complete'],
    },
    ORCHESTRATOR_FAILED: {
      message: 'Code orchestrator execution failed',
      userMessage: 'The code generation system encountered an error. Please try again with a simpler request.',
      recoverable: true,
      suggestedActions: ['Simplify your request', 'Try again in a few moments', 'Check your internet connection'],
    },
    DIFF_APPLICATION_FAILED: {
      message: 'Failed to apply code changes',
      userMessage: 'Could not apply the suggested code changes. The files may have been modified externally.',
      recoverable: true,
      suggestedActions: ['Refresh file contents', 'Review changes manually', 'Try a smaller change set'],
    },
    FILE_VALIDATION_FAILED: {
      message: 'File validation failed',
      userMessage: 'The proposed changes would create invalid code. Please review and modify your request.',
      recoverable: true,
      suggestedActions: ['Check syntax requirements', 'Simplify the changes', 'Review file structure'],
    },
    SYNTAX_ERROR: {
      message: 'Syntax validation failed',
      userMessage: 'The generated code contains syntax errors. Please try again or review manually.',
      recoverable: true,
      suggestedActions: ['Try a different approach', 'Check language syntax', 'Review generated code'],
    },
    NETWORK_ERROR: {
      message: 'Network connection failed',
      userMessage: 'Unable to connect to the code generation service. Please check your internet connection.',
      recoverable: true,
      suggestedActions: ['Check internet connection', 'Try again in a moment', 'Refresh the page'],
    },
    TIMEOUT_ERROR: {
      message: 'Request timed out',
      userMessage: 'The code generation request took too long to complete. Please try with a smaller scope.',
      recoverable: true,
      suggestedActions: ['Reduce request complexity', 'Try fewer files', 'Check connection speed'],
    },
    PERMISSION_DENIED: {
      message: 'Permission denied',
      userMessage: 'You do not have permission to perform this code operation.',
      recoverable: false,
      suggestedActions: ['Contact administrator', 'Check user permissions'],
    },
    INVALID_REQUEST: {
      message: 'Invalid request format',
      userMessage: 'The request format is invalid. Please check your input and try again.',
      recoverable: true,
      suggestedActions: ['Check request format', 'Review input parameters', 'Try a simpler request'],
    },
    SERVICE_UNAVAILABLE: {
      message: 'Code generation service unavailable',
      userMessage: 'The code generation service is temporarily unavailable. Please try again later.',
      recoverable: true,
      suggestedActions: ['Try again later', 'Check service status', 'Use manual editing'],
    },
    UNKNOWN_ERROR: {
      message: 'Unknown error occurred',
      userMessage: 'An unexpected error occurred. Please try again or contact support if the problem persists.',
      recoverable: true,
      suggestedActions: ['Try again', 'Refresh the page', 'Contact support'],
    },
  };

  /**
   * Create a standardized error from various error sources
   */
  static createError(
    code: CodeModeErrorCode,
    originalError?: Error | string,
    sessionId?: string,
    details?: any
  ): CodeModeError {
    const errorConfig = this.errorMessages[code];
    const originalMessage = typeof originalError === 'string' 
      ? originalError 
      : originalError?.message || '';

    return new CodeModeError({
      code,
      message: originalMessage || errorConfig.message,
      details,
      timestamp: new Date(),
      sessionId,
      recoverable: errorConfig.recoverable,
      userMessage: errorConfig.userMessage,
      suggestedActions: errorConfig.suggestedActions,
    });
  }

  /**
   * Handle and categorize errors from different sources
   */
  static handleError(error: any, sessionId?: string): CodeModeError {
    // Network errors
    if (error.name === 'NetworkError' || error.code === 'NETWORK_ERROR') {
      return this.createError('NETWORK_ERROR', error, sessionId);
    }

    // Timeout errors
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      return this.createError('TIMEOUT_ERROR', error, sessionId);
    }

    // Session errors
    if (error.message?.includes('session') && error.message?.includes('not found')) {
      return this.createError('SESSION_NOT_FOUND', error, sessionId);
    }

    if (error.message?.includes('Maximum concurrent sessions')) {
      return this.createError('SESSION_LIMIT_EXCEEDED', error, sessionId);
    }

    // Orchestrator errors
    if (error.message?.includes('orchestrator') || error.message?.includes('Code task')) {
      return this.createError('ORCHESTRATOR_FAILED', error, sessionId);
    }

    // Diff application errors
    if (error.message?.includes('diff') || error.message?.includes('apply')) {
      return this.createError('DIFF_APPLICATION_FAILED', error, sessionId);
    }

    // Validation errors
    if (error.message?.includes('validation') || error.message?.includes('invalid')) {
      return this.createError('FILE_VALIDATION_FAILED', error, sessionId);
    }

    // Syntax errors
    if (error.message?.includes('syntax') || error.name === 'SyntaxError') {
      return this.createError('SYNTAX_ERROR', error, sessionId);
    }

    // Permission errors
    if (error.message?.includes('permission') || error.code === 403) {
      return this.createError('PERMISSION_DENIED', error, sessionId);
    }

    // Service unavailable
    if (error.code === 503 || error.message?.includes('service unavailable')) {
      return this.createError('SERVICE_UNAVAILABLE', error, sessionId);
    }

    // Default to unknown error
    return this.createError('UNKNOWN_ERROR', error, sessionId);
  }

  /**
   * Get recovery suggestions for an error
   */
  static getRecoveryActions(error: CodeModeError): string[] {
    return error.suggestedActions || [];
  }

  /**
   * Check if an error is recoverable
   */
  static isRecoverable(error: CodeModeError): boolean {
    return error.recoverable;
  }

  /**
   * Format error for logging
   */
  static formatForLogging(error: CodeModeError): string {
    return JSON.stringify({
      code: error.code,
      message: error.message,
      sessionId: error.sessionId,
      timestamp: error.timestamp.toISOString(),
      details: error.details,
    }, null, 2);
  }

  /**
   * Format error for user display
   */
  static formatForUser(error: CodeModeError): {
    title: string;
    message: string;
    actions: string[];
    severity: 'error' | 'warning' | 'info';
  } {
    return {
      title: error.recoverable ? 'Code Operation Failed' : 'Critical Error',
      message: error.userMessage,
      actions: error.suggestedActions || [],
      severity: error.recoverable ? 'warning' : 'error',
    };
  }

  /**
   * Create error notification data
   */
  static createNotification(error: CodeModeError): {
    id: string;
    type: 'error' | 'warning';
    title: string;
    message: string;
    actions?: Array<{
      label: string;
      action: () => void;
    }>;
    duration?: number;
  } {
    const userFormat = this.formatForUser(error);
    
    return {
      id: `code-error-${Date.now()}`,
      type: error.recoverable ? 'warning' : 'error',
      title: userFormat.title,
      message: userFormat.message,
      duration: error.recoverable ? 8000 : undefined, // Auto-dismiss recoverable errors
    };
  }

  /**
   * Log error with appropriate level
   */
  static logError(error: CodeModeError): void {
    const logData = this.formatForLogging(error);
    
    if (error.recoverable) {
      console.warn(`[CodeMode Warning] ${error.code}:`, logData);
    } else {
      console.error(`[CodeMode Error] ${error.code}:`, logData);
    }
  }
}

export default CodeModeErrorHandler;