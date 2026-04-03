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

export type TamboErrorCategory = 'validation' | 'network' | 'server' | 'client' | 'unknown';

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
}

export function tamboErrorHandler(error: Error): TamboError {
  return {
    code: 'TAMBO_ERROR',
    message: error.message,
    details: error,
  };
}

export function categorizeError(error: Error): TamboErrorCategory {
  if (error.message.includes('validation') || error.message.includes('invalid')) {
    return 'validation';
  }
  if (error.message.includes('network') || error.message.includes('fetch')) {
    return 'network';
  }
  if (error.message.includes('server') || error.message.includes('50')) {
    return 'server';
  }
  return 'unknown';
}

export function createTamboError(code: string, message: string, details?: any): TamboError {
  return { code, message, details };
}

export async function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  config: RetryConfig = { maxRetries: 3, delayMs: 1000, backoffMultiplier: 2 }
): Promise<ReturnType<T>> {
  let lastError: Error | undefined;
  let delay = config.delayMs;
  
  for (let i = 0; i < config.maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < config.maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
      }
    }
  }
  
  throw lastError ?? new Error('withRetry requires maxRetries to be at least 1');
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
