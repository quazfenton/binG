/**
 * Tambo Error Handler
 * 
 * Error handling utilities for Tambo integration
 */

export interface TamboError {
  code: string;
  message: string;
  details?: any;
}

export function tamboErrorHandler(error: Error): TamboError {
  return {
    code: 'TAMBO_ERROR',
    message: error.message,
    details: error,
  };
}

export function withTamboErrorHandling<T extends (...args: any[]) => any>(fn: T): T {
  return ((...args: any[]) => {
    try {
      return fn(...args);
    } catch (error) {
      return tamboErrorHandler(error as Error);
    }
  }) as T;
}
