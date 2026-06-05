/**
 * Retry Utility
 *
 * General-purpose retry with exponential backoff for resilient service calls.
 * Use this wrapper around any async operation that may fail transiently
 * (network calls, sandbox creation, API requests, etc.).
 *
 * Features:
 * - Exponential backoff with configurable base delay
 * - Max retries with eventual failure
 * - Jitter to avoid thundering herd on retry storms
 * - onRetry callback for logging/monitoring
 * - Timeout per attempt (optional)
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => provider.createSandbox(config),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Retry');

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000) */
  baseDelayMs?: number;
  /** Max total delay cap in ms (default: 30000 = 30s) */
  maxDelayMs?: number;
  /** Called before each retry with the error and attempt number */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** Timeout per individual attempt in ms (optional) */
  timeoutMs?: number;
  /** Whether to add jitter to delay (default: true) */
  jitter?: boolean;
  /** Name for logging (default: 'retry') */
  name?: string;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'timeoutMs'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
  name: 'retry',
};

/**
 * Execute an async function with retry logic and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        // With per-attempt timeout via Promise.race
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Operation timed out after ${opts.timeoutMs}ms`)),
              opts.timeoutMs,
            ),
          ),
        ]);
        return result;
      }
      return await fn();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries) {
        log.error(
          `[${opts.name}] All ${opts.maxRetries + 1} attempts failed: ${lastError.message}`,
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff + optional jitter
      const exponentialDelay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs,
      );
      const jitterMs = opts.jitter ? Math.random() * opts.baseDelayMs * 0.3 : 0;
      const delayMs = Math.round(exponentialDelay + jitterMs);

      log.warn(
        `[${opts.name}] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed: ${lastError.message}. Retrying in ${delayMs}ms...`,
      );

      opts.onRetry?.(lastError, attempt + 1, delayMs);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Unreachable — but TypeScript needs it
  throw lastError ?? new Error(`[${opts.name}] All retries exhausted`);
}

/**
 * Convenience: Execute with retry and a fixed timeout per attempt.
 * Equivalent to `withRetry(fn, { ...options, timeoutMs })`.
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  options: Omit<RetryOptions, 'timeoutMs'> = {},
): Promise<T> {
  return withRetry(fn, { ...options, timeoutMs });
}
