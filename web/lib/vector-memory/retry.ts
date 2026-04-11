/**
 * Advanced Retry Mechanism
 * 
 * Modular retry utility with exponential backoff, jitter,
 * and configurable hooks. Designed for both the basic LLM call
 * layer (v1) and the CLI agent layer (v2).
 * 
 * @module vector-memory/retry
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Retry');

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
  context?: string;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'context' | 'shouldRetry' | 'onRetry'>> = {
  maxRetries: 3,
  baseDelay: 500,
  maxDelay: 30_000,
  backoffFactor: 2,
  jitter: true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const label = opts.context ?? 'operation';

  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries) break;

      if (opts.shouldRetry && !opts.shouldRetry(error, attempt)) break;

      let delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffFactor, attempt),
        opts.maxDelay
      );

      if (opts.jitter) {
        delay += Math.random() * delay * 0.3;
      }

      logger.warn(`[${label}] Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`, {
        error: error instanceof Error ? error.message : String(error),
      });

      opts.onRetry?.(error, attempt, delay);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error(`[${label}] All ${opts.maxRetries + 1} attempts failed`);
  throw lastError;
}

/**
 * Classify whether an error is retryable.
 * Useful as a shouldRetry predicate for LLM calls.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();

  // Rate limits, timeouts, and transient network errors
  if (msg.includes('rate limit') || msg.includes('429')) return true;
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('network') || msg.includes('fetch failed')) return true;
  if (msg.includes('503') || msg.includes('502') || msg.includes('500')) return true;

  return false;
}
