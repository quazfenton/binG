export enum ErrorType {
  TRANSIENT = 'transient',      // Network, timeout, rate limit - should retry
  LOGIC = 'logic',              // Wrong tool, bad parameters - should reprompt
  FATAL = 'fatal',              // Invalid state, permission denied - should abort
  VALIDATION = 'validation',    // Schema validation errors - should fix input
}

export interface HealingStrategy {
  errorType: ErrorType;
  maxRetries: number;
  backoffMs: number;
  shouldReprompt: boolean;
  shouldChangeApproach: boolean;
  shouldFixInput: boolean;
}

export const HEALING_STRATEGIES: Record<ErrorType, HealingStrategy> = {
  [ErrorType.TRANSIENT]: {
    errorType: ErrorType.TRANSIENT,
    maxRetries: 3,
    backoffMs: 1000,
    shouldReprompt: false,
    shouldChangeApproach: false,
    shouldFixInput: false,
  },
  [ErrorType.LOGIC]: {
    errorType: ErrorType.LOGIC,
    maxRetries: 2,
    backoffMs: 500,
    shouldReprompt: true,
    shouldChangeApproach: true,
    shouldFixInput: false,
  },
  [ErrorType.FATAL]: {
    errorType: ErrorType.FATAL,
    maxRetries: 0,
    backoffMs: 0,
    shouldReprompt: false,
    shouldChangeApproach: false,
    shouldFixInput: false,
  },
  [ErrorType.VALIDATION]: {
    errorType: ErrorType.VALIDATION,
    maxRetries: 1,
    backoffMs: 100,
    shouldReprompt: false,
    shouldChangeApproach: false,
    shouldFixInput: true,
  },
};

export interface ErrorContext {
  step: string;
  prompt?: string;
  toolName?: string;
  parameters?: Record<string, any>;
  previousErrors?: Array<{ message: string; timestamp: Date }>;
  attemptNumber?: number;
}

export interface HealingResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  errorType?: ErrorType;
  attempts: number;
  shouldRetry: boolean;
  reprompt?: string;
  modifiedInput?: Record<string, any>;
}

/**
 * Classify an error into an ErrorType for appropriate handling
 */
export function classifyError(error: Error | unknown): ErrorType {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  // Validation errors (Zod, schema)
  if (
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required') ||
    message.includes('zod') ||
    message.includes('schema') ||
    message.includes('parse')
  ) {
    // Check if it's a fatal invalid (like invalid file path) vs fixable
    if (message.includes('permission') || message.includes('access denied')) {
      return ErrorType.FATAL;
    }
    return ErrorType.VALIDATION;
  }

  // Transient errors - retry will help
  if (
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('socket hang up') ||
    message.includes('temporary') ||
    message.includes('unavailable') ||
    message.includes('service unavailable') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504')
  ) {
    return ErrorType.TRANSIENT;
  }

  // Fatal errors - retry won't help
  if (
    message.includes('permission denied') ||
    message.includes('access denied') ||
    message.includes('unauthorized') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('insufficient quota') ||
    message.includes('account disabled') ||
    message.includes('blocked')
  ) {
    return ErrorType.FATAL;
  }

  // Not found errors - could be logic (file doesn't exist) or fatal (resource missing)
  // Default to logic since it often means the agent needs to check existence first
  if (
    message.includes('not found') ||
    message.includes('404') ||
    message.includes('does not exist') ||
    message.includes('cannot find') ||
    message.includes('no such file') ||
    message.includes('search pattern not found')
  ) {
    return ErrorType.LOGIC;
  }

  // Logic errors - need different approach
  if (
    message.includes('not found in file') ||
    message.includes('search pattern not found') ||
    message.includes('cannot apply') ||
    message.includes('failed to execute') ||
    message.includes('unexpected token') ||
    message.includes('syntax error') ||
    message.includes('type error') ||
    message.includes('undefined is not a function') ||
    message.includes('cannot read property') ||
    message.includes('cannot read properties')
  ) {
    return ErrorType.LOGIC;
  }

  // Default to logic error for unknown errors
  return ErrorType.LOGIC;
}

/**
 * Execute an operation with self-healing retry logic
 */
export async function executeWithSelfHeal<T>(
  operation: () => Promise<T>,
  errorContext: ErrorContext,
  maxAttempts: number = 3
): Promise<HealingResult<T>> {
  let lastError: Error | null = null;
  let lastErrorType: ErrorType | null = null;
  const previousErrors: Array<{ message: string; timestamp: Date }> = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts: attempt,
        shouldRetry: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastErrorType = classifyError(error);
      const strategy = HEALING_STRATEGIES[lastErrorType];

      previousErrors.push({
        message: lastError.message,
        timestamp: new Date(),
      });

      console.log(`[SelfHeal] Attempt ${attempt} failed:`, {
        error: lastError.message,
        type: lastErrorType,
        strategy,
        step: errorContext.step,
      });

      // Check if we should stop retrying
      if (strategy.maxRetries === 0 || attempt >= maxAttempts) {
        console.error(`[SelfHeal] Giving up after ${attempt} attempts. Error type: ${lastErrorType}`);
        return {
          success: false,
          error: lastError,
          errorType: lastErrorType,
          attempts: attempt,
          shouldRetry: false,
        };
      }

      // Apply backoff
      if (strategy.backoffMs > 0) {
        const backoffTime = strategy.backoffMs * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`[SelfHeal] Backing off for ${backoffTime}ms before retry`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
      }

      // Modify context for next attempt if needed
      if (strategy.shouldChangeApproach && errorContext.prompt) {
        const errorSummary = previousErrors.map((e, i) => `  Attempt ${i + 1}: ${e.message}`).join('\n');
        errorContext.prompt = `${errorContext.prompt}\n\nPREVIOUS ERRORS:\n${errorSummary}\n\nTry a completely different approach. Analyze what went wrong and avoid repeating the same mistake.`;
      }

      if (strategy.shouldReprompt && errorContext.prompt) {
        errorContext.prompt = `${errorContext.prompt}\n\nNote: Previous attempt failed with: ${lastError?.message}`;
      }
    }
  }

  return {
    success: false,
    error: lastError ?? undefined,
    errorType: lastErrorType,
    attempts: maxAttempts,
    shouldRetry: false,
  };
}

/**
 * Generate a reprompt message based on error analysis
 */
export function generateReprompt(errorContext: ErrorContext, error: Error, errorType: ErrorType): string {
  const baseMessage = `Previous operation failed: ${error.message}`;

  switch (errorType) {
    case ErrorType.LOGIC:
      return `${baseMessage}\n\nThe error suggests a logical issue with the approach. Consider:\n1. Verifying file paths exist before editing\n2. Checking that search patterns exactly match the target content\n3. Using a different tool or method\n4. Breaking the task into smaller steps`;

    case ErrorType.VALIDATION:
      return `${baseMessage}\n\nThe input validation failed. Please:\n1. Check that all required parameters are provided\n2. Verify parameter types match expected schemas\n3. Ensure file paths are valid\n4. Review the error details above`;

    case ErrorType.TRANSIENT:
      return `${baseMessage}\n\nThis appears to be a temporary issue. Retrying automatically...`;

    case ErrorType.FATAL:
      return `${baseMessage}\n\nThis is a fatal error that cannot be recovered from automatically. Manual intervention may be required.`;

    default:
      return baseMessage;
  }
}

/**
 * Track error patterns to detect recurring issues
 */
export class ErrorPatternTracker {
  private errorHistory: Array<{
    errorType: ErrorType;
    message: string;
    step: string;
    toolName?: string;
    timestamp: Date;
  }> = [];

  private maxHistory: number = 50;

  record(error: Error, context: ErrorContext): void {
    const errorType = classifyError(error);
    this.errorHistory.push({
      errorType,
      message: error.message,
      step: context.step,
      toolName: context.toolName,
      timestamp: new Date(),
    });

    // Keep history bounded
    if (this.errorHistory.length > this.maxHistory) {
      this.errorHistory.shift();
    }
  }

  /**
   * Check if the same error is recurring
   */
  isRecurringError(error: Error, step: string): boolean {
    const errorType = classifyError(error);
    const recentErrors = this.errorHistory.slice(-10);

    const sameErrors = recentErrors.filter(
      (e) => e.errorType === errorType && e.step === step && e.message === error.message
    );

    return sameErrors.length >= 2;
  }

  /**
   * Get suggestions for avoiding recurring errors
   */
  getPatternAnalysis(): {
    mostCommonErrorType: ErrorType | null;
    mostFailingStep: string | null;
    mostFailingTool: string | null;
    recommendations: string[];
  } {
    if (this.errorHistory.length === 0) {
      return {
        mostCommonErrorType: null,
        mostFailingStep: null,
        mostFailingTool: null,
        recommendations: [],
      };
    }

    // Count error types
    const errorTypeCounts: Record<ErrorType, number> = {
      [ErrorType.TRANSIENT]: 0,
      [ErrorType.LOGIC]: 0,
      [ErrorType.FATAL]: 0,
      [ErrorType.VALIDATION]: 0,
    };

    const stepCounts: Record<string, number> = {};
    const toolCounts: Record<string, number> = {};

    for (const entry of this.errorHistory) {
      errorTypeCounts[entry.errorType]++;
      stepCounts[entry.step] = (stepCounts[entry.step] || 0) + 1;
      if (entry.toolName) {
        toolCounts[entry.toolName] = (toolCounts[entry.toolName] || 0) + 1;
      }
    }

    const mostCommonErrorType =
      Object.entries(errorTypeCounts).sort((a, b) => b[1] - a[1])[0][0] || null;
    const mostFailingStep = Object.entries(stepCounts).sort((a, b) => b[1] - a[1])[0][0] || null;
    const mostFailingTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0][0] || null;

    const recommendations: string[] = [];

    if (errorTypeCounts[ErrorType.LOGIC] > errorTypeCounts[ErrorType.TRANSIENT]) {
      recommendations.push('Most errors are logic-related. Consider improving prompt clarity and providing more context.');
    }

    if (mostFailingStep) {
      recommendations.push(`The "${mostFailingStep}" step has the most failures. Review this step carefully.`);
    }

    if (mostFailingTool) {
      recommendations.push(`The "${mostFailingTool}" tool fails frequently. Consider using alternative approaches.`);
    }

    return {
      mostCommonErrorType: mostCommonErrorType as ErrorType,
      mostFailingStep,
      mostFailingTool,
      recommendations,
    };
  }

  clear(): void {
    this.errorHistory = [];
  }

  getHistory(): typeof this.errorHistory {
    return [...this.errorHistory];
  }
}

export const globalErrorTracker = new ErrorPatternTracker();
