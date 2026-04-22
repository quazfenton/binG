/**
 * Tool Error Handler
 * 
 * @deprecated Use UnifiedErrorHandler from lib/utils/error-handler.ts instead
 * 
 * This module is kept for backwards compatibility.
 * All new code should use:
 * ```typescript
 * import { getErrorHandler, ToolError } from '@/lib/utils/error-handler';
 * const handler = getErrorHandler();
 * const error = handler.handleError(error, context, params);
 * ```
 */

// Re-export from unified error handler for backwards compatibility
export {
  ToolErrorClass as ToolError,
  getErrorHandler,
  handleError,
  createValidationError,
  createAuthError,
  createNotFoundError,
} from '../utils/error-handler';

// Re-export types separately for isolatedModules compatibility
export type {
  ToolExecutionResult,
  ErrorCategory,
} from '../utils/error-handler';

// Create default instance for backwards compatibility
import { UnifiedErrorHandler, createNotFoundError as _createNotFoundError } from '../utils/error-handler';

export class ToolErrorHandler {
  private static instance: ToolErrorHandler;
  private handler: UnifiedErrorHandler;

  static getInstance(): ToolErrorHandler {
    if (!ToolErrorHandler.instance) {
      ToolErrorHandler.instance = new ToolErrorHandler();
    }
    return ToolErrorHandler.instance;
  }

  constructor() {
    this.handler = UnifiedErrorHandler.getInstance();
  }

  handleError(error: any, toolName: string, parameters?: any) {
    return this.handler.handleError(error, toolName, parameters);
  }

  createValidationError(message: string, parameters?: any) {
    return this.handler.createValidationError(message, parameters);
  }

  createAuthError(message: string, authUrl?: string) {
    return this.handler.createAuthError(message, authUrl);
  }

  createNotFoundError(resource: string) {
    return _createNotFoundError(resource);
  }

  toExecutionResult(error: any) {
    return this.handler.toExecutionResult(error);
  }
}

export function getToolErrorHandler(): ToolErrorHandler {
  return ToolErrorHandler.getInstance();
}
