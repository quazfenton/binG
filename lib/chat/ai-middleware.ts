/**
 * Vercel AI SDK Middleware Implementations
 *
 * Implements:
 * - extractReasoningMiddleware for reasoning UI
 * - RetryError handling
 * - Smooth streaming
 * - Token limit handling
 *
 * @see https://sdk.vercel.ai/docs/ai-sdk-core/middleware
 */

import {
  extractReasoningMiddleware,
  RetryError as AISDKRetryError,
} from 'ai';
import { chatLogger } from './chat-logger';

/**
 * Reasoning UI configuration
 */
export interface ReasoningUIConfig {
  /** Tag name for reasoning blocks (default: 'thinking') */
  tagName?: string;
  /** Separator between reasoning and response */
  separator?: string;
  /** Start with reasoning enabled */
  startWithReasoning?: boolean;
  /** Include reasoning in final response */
  includeInResponse?: boolean;
  /** Maximum reasoning length (characters) */
  maxLength?: number;
}

/**
 * Create reasoning middleware with binG-specific configuration
 *
 * Extracts reasoning/thinking content from model responses
 * and makes it available separately from the final response.
 *
 * @example
 * ```typescript
 * const reasoningMiddleware = createReasoningMiddleware({
 *   tagName: 'thinking',
 *   includeInResponse: false,
 * });
 *
 * const result = await streamText({
 *   model,
 *   messages,
 *   experimental_transform: reasoningMiddleware,
 * });
 * ```
 */
export function createReasoningMiddleware(config: ReasoningUIConfig = {}) {
  const {
    tagName = 'thinking',
    separator = '\n',
    startWithReasoning = true,
    includeInResponse = false,
    maxLength = 10000,
  } = config;

  return extractReasoningMiddleware({
    tagName,
    separator,
    startWithReasoning,
  });
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Initial delay in milliseconds */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds */
  maxDelayMs?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** Retry on specific error messages */
  retryOn?: string[];
  /** Don't retry on specific error messages */
  dontRetryOn?: string[];
  /** Custom retry decision function */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback before each retry */
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryOn: [
    'rate limit',
    'too many requests',
    'timeout',
    'network error',
    'service unavailable',
    'internal server error',
  ],
  dontRetryOn: [
    'authentication',
    'unauthorized',
    'forbidden',
    'invalid api key',
    'insufficient quota',
    'billing',
  ],
  shouldRetry: () => true,
  onRetry: () => {},
};

/**
 * Check if an error should be retried
 */
function shouldRetryError(error: Error, config: Required<RetryConfig>): boolean {
  const message = error.message.toLowerCase();

  // Check dontRetryOn first
  for (const dontRetry of config.dontRetryOn) {
    if (message.includes(dontRetry.toLowerCase())) {
      return false;
    }
  }

  // Check retryOn
  for (const retry of config.retryOn) {
    if (message.includes(retry.toLowerCase())) {
      return true;
    }
  }

  // Check custom shouldRetry
  return config.shouldRetry(error, 0);
}

/**
 * Create retry wrapper for AI SDK operations
 *
 * Wraps streamText, generateText, etc. with automatic retry logic
 *
 * @example
 * ```typescript
 * const retryConfig = {
 *   maxRetries: 3,
 *   initialDelayMs: 1000,
 *   retryOn: ['rate limit', 'timeout'],
 * };
 *
 * const result = await withRetry(
 *   () => streamText({ model, messages }),
 *   retryConfig
 * );
 * ```
 */
export function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  return retryOperation(operation, fullConfig, 0);
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  config: Required<RetryConfig>,
  attempt: number
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Check if we should retry
    if (attempt >= config.maxRetries) {
      chatLogger.error('Max retries exceeded', {
        attempt,
        maxRetries: config.maxRetries,
        error: error.message,
      });
      // Create custom error with cause attached
      const retryError = new Error(
        `Max retries (${config.maxRetries}) exceeded. Last error: ${error.message}`
      ) as Error & { cause?: any };
      retryError.cause = error;
      throw retryError;
    }

    if (!shouldRetryError(error, config)) {
      chatLogger.info('Error not retryable', {
        error: error.message,
        attempt,
      });
      throw error;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
      config.maxDelayMs
    );

    chatLogger.warn('Retrying operation', {
      attempt: attempt + 1,
      maxRetries: config.maxRetries,
      delay,
      error: error.message,
    });

    config.onRetry(error, attempt + 1);

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delay));

    // Retry
    return retryOperation(operation, config, attempt + 1);
  }
}

/**
 * Smooth streaming configuration
 */
export interface SmoothStreamConfig {
  /** Minimum chunk size in characters */
  minChunkSize?: number;
  /** Maximum chunk size in characters */
  maxChunkSize?: number;
  /** Delay between chunks in milliseconds */
  chunkDelayMs?: number;
  /** Enable typing effect */
  typingEffect?: boolean;
  /** Typing speed (characters per second) */
  typingSpeed?: number;
}

/**
 * Create smooth streaming middleware
 *
 * Buffers and smooths out token streaming for better UX
 *
 * @example
 * ```typescript
 * const smoothStream = createSmoothStream({
 *   minChunkSize: 3,
 *   maxChunkSize: 10,
 *   chunkDelayMs: 50,
 * });
 *
 * const result = await streamText({
 *   model,
 *   messages,
 *   experimental_transform: smoothStream,
 * });
 * ```
 */
export function createSmoothStream(config: SmoothStreamConfig = {}) {
  const {
    minChunkSize = 3,
    maxChunkSize = 10,
    chunkDelayMs = 50,
    typingEffect = false,
    typingSpeed = 100,
  } = config;

  return async function smoothStreamMiddleware(
    stream: ReadableStream<Uint8Array>
  ): Promise<ReadableStream<Uint8Array>> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = '';

    return new ReadableStream({
      async start(controller) {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Flush remaining buffer
              if (buffer.length > 0) {
                controller.enqueue(encoder.encode(buffer));
              }
              controller.close();
              break;
            }

            const text = decoder.decode(value, { stream: true });
            buffer += text;

            // Process buffer in chunks
            while (buffer.length >= minChunkSize) {
              const chunkSize = Math.min(buffer.length, maxChunkSize);
              const chunk = buffer.slice(0, chunkSize);
              buffer = buffer.slice(chunkSize);

              controller.enqueue(encoder.encode(chunk));

              if (chunkDelayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, chunkDelayMs));
              }
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
    });
  };
}

/**
 * Token limit error handler
 *
 * Handles "too many tokens" errors gracefully
 */
export interface TokenLimitError extends Error {
  name: 'TokenLimitError';
  estimatedTokens: number;
  limit: number;
  suggestion?: string;
}

/**
 * Create token limit error
 */
export function createTokenLimitError(
  estimatedTokens: number,
  limit: number,
  suggestion?: string
): TokenLimitError {
  const error = new Error(
    `Token limit exceeded: estimated ${estimatedTokens.toLocaleString()} tokens, limit is ${limit.toLocaleString()}`
  ) as TokenLimitError;
  error.name = 'TokenLimitError';
  error.estimatedTokens = estimatedTokens;
  error.limit = limit;
  error.suggestion = suggestion;
  return error;
}

/**
 * Check if an error is a token limit error
 */
export function isTokenLimitError(error: any): error is TokenLimitError {
  return (
    error?.name === 'TokenLimitError' ||
    error?.message?.includes('too many tokens') ||
    error?.message?.includes('maximum context length') ||
    error?.message?.includes('token limit')
  );
}

/**
 * Handle token limit errors with suggestions
 */
export function handleTokenLimitError(
  error: TokenLimitError | Error
): {
  canRecover: boolean;
  suggestion: string;
  actions: Array<{
    label: string;
    action: () => void;
  }>;
} {
  if (!isTokenLimitError(error)) {
    return {
      canRecover: false,
      suggestion: 'An unexpected error occurred.',
      actions: [],
    };
  }

  const tokenError = error as TokenLimitError;
  const actions: Array<{ label: string; action: () => void }> = [];

  // Build suggestion based on token count
  let suggestion = tokenError.suggestion || '';

  if (!suggestion) {
    if (tokenError.estimatedTokens > 100000) {
      suggestion = 'The request is very large. Consider splitting it into multiple smaller requests.';
      actions.push({
        label: 'Split Request',
        action: () => {
          // Would trigger UI to split the request
          console.log('Splitting request...');
        },
      });
    } else if (tokenError.estimatedTokens > 50000) {
      suggestion = 'The request is large. Try summarizing or removing unnecessary context.';
      actions.push({
        label: 'Summarize Context',
        action: () => {
          // Would trigger context summarization
          console.log('Summarizing context...');
        },
      });
    } else {
      suggestion = 'Try reducing the context or using a model with a higher token limit.';
      actions.push({
        label: 'Switch Model',
        action: () => {
          // Would trigger model switch
          console.log('Switching to higher context model...');
        },
      });
    }
  }

  return {
    canRecover: true,
    suggestion,
    actions,
  };
}

/**
 * Combined middleware pipeline
 *
 * Applies multiple middleware in sequence
 */
export function createMiddlewarePipeline(
  ...middlewares: Array<(stream: ReadableStream) => Promise<ReadableStream>>
) {
  return async function pipeline(
    stream: ReadableStream
  ): Promise<ReadableStream> {
    let result = stream;
    for (const middleware of middlewares) {
      result = await middleware(result);
    }
    return result;
  };
}

/**
 * Abort signal handler for streaming
 */
export function createAbortHandler() {
  const controllers = new Map<string, AbortController>();

  return {
    getSignal(id: string): AbortSignal {
      if (!controllers.has(id)) {
        controllers.set(id, new AbortController());
      }
      return controllers.get(id)!.signal;
    },

    abort(id: string): void {
      const controller = controllers.get(id);
      if (controller) {
        controller.abort();
        controllers.delete(id);
      }
    },

    clear(): void {
      const controllersToAbort = Array.from(controllers.values());
      for (const controller of controllersToAbort) {
        controller.abort();
      }
      controllers.clear();
    },
  };
}

// Export Vercel AI SDK exports for convenience
export { AISDKRetryError as RetryError };
export { extractReasoningMiddleware };
