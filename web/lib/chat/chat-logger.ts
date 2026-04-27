/**
 * Chat API Structured Logger
 * 
 * Provides consistent, level-based logging for the chat API.
 * Supports debug, info, warn, and error levels with optional request context.
 * 
 * Usage:
 *   import { chatLogger } from '@/lib/api/chat-logger';
 *   chatLogger.debug('Message', { requestId }, { extraData });
 * 
 * Log levels (controlled by LOG_LEVEL env var):
 *   - debug: Detailed debugging information (default in development)
 *   - info: General operational information
 *   - warn: Warning conditions
 *   - error: Error conditions
 * 
 * Environment variables:
 *   - LOG_LEVEL: Set to 'debug', 'info', 'warn', or 'error' (default: 'info')
 *   - NODE_ENV: 'development' enables debug level by default
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogContext {
  requestId?: string;
  userId?: string;
  provider?: string;
  model?: string;
  conversationId?: string;
  [key: string]: any;
}

export interface LogData {
  [key: string]: any;
}

class ChatLogger {
  private readonly logLevel: LogLevel;
  private readonly component: string;

  private static readonly LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
  };

  constructor(component: string = 'Chat API', defaultLevel?: LogLevel) {
    this.component = component;
    this.logLevel = this.parseLogLevel(
      process.env.LOG_LEVEL || defaultLevel || (process.env.NODE_ENV === 'development' ? 'debug' : 'info')
    );
  }

  private parseLogLevel(level?: string): LogLevel {
    if (!level) return 'info';
    const normalized = level.toLowerCase() as LogLevel;
    if (ChatLogger.LEVELS[normalized] !== undefined) {
      return normalized;
    }
    return 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return ChatLogger.LEVELS[level] >= ChatLogger.LEVELS[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext, data?: LogData): string {
    const timestamp = new Date().toISOString();
    const contextParts: string[] = [];

    if (context) {
      if (context.requestId) contextParts.push(`req:${context.requestId}`);
      if (context.userId) contextParts.push(`user:${context.userId}`);
      if (context.provider) contextParts.push(`provider:${context.provider}`);
      if (context.model) contextParts.push(`model:${context.model}`);
      if (context.conversationId) contextParts.push(`conv:${context.conversationId}`);
    }

    const contextStr = (contextParts && contextParts.length > 0) ? ` [${contextParts.join(' ')}]` : '';
    return `${timestamp} [${level.toUpperCase()}] ${this.component}${contextStr}: ${message}`;
  }

  private log(level: LogLevel, message: string, context?: LogContext, data?: LogData): void {
    if (!this.shouldLog(level)) return;

    const logMessage = this.formatMessage(level, message, context, data);
    const logData = data || context;

    switch (level) {
      case 'debug':
        console.debug(logMessage, logData && Object.keys(logData).length > 0 ? logData : '');
        break;
      case 'info':
        console.info(logMessage, logData && Object.keys(logData).length > 0 ? logData : '');
        break;
      case 'warn':
        console.warn(logMessage, logData && Object.keys(logData).length > 0 ? logData : '');
        break;
      case 'error':
        console.error(logMessage, logData && Object.keys(logData).length > 0 ? logData : '');
        break;
    }
  }

  debug(message: string, context?: LogContext, data?: LogData): void {
    this.log('debug', message, context, data);
  }

  info(message: string, context?: LogContext, data?: LogData): void {
    this.log('info', message, context, data);
  }

  warn(message: string, context?: LogContext, data?: LogData): void {
    this.log('warn', message, context, data);
  }

  error(message: string, context?: LogContext, data?: LogData): void {
    this.log('error', message, context, data);
  }

  /**
   * Create a child logger with additional default context
   */
  child(additionalContext: LogContext): ChatLogger {
    const childLogger = new ChatLogger(this.component, this.logLevel);
    // Store context for child logger
    (childLogger as any).defaultContext = {
      ...((this as any).defaultContext || {}),
      ...additionalContext,
    };
    return childLogger;
  }

  /**
   * Log request start
   */
  logRequestStart(
    requestId: string,
    userId: string,
    provider: string,
    model: string,
    options?: {
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    }
  ): void {
    this.info('Incoming request', {
      requestId,
      userId,
      provider,
      model,
      stream: options?.stream,
    }, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });
  }

  /**
   * Log request completion
   */
  logRequestComplete(
    requestId: string,
    userId: string,
    provider: string,
    model: string,
    options: {
      success: boolean;
      latencyMs: number;
      tokensUsed?: number;
      error?: string;
      source?: string;
      stream?: boolean;
    }
  ): void {
    const level = options.success ? 'info' : 'error';
    const message = options.success ? 'Request completed' : 'Request failed';
    
    this.log(level, message, {
      requestId,
      userId,
      provider,
      model,
    }, {
      success: options.success,
      latencyMs: options.latencyMs,
      tokensUsed: options.tokensUsed,
      error: options.error,
      source: options.source,
      stream: options.stream,
    });
  }

  /**
   * Log provider attempt
   */
  logProviderAttempt(
    requestId: string,
    userId: string,
    provider: string,
    model: string,
    options: {
      attempt: number;
      isFallback?: boolean;
      latencyMs?: number;
      error?: string;
      success?: boolean;
    }
  ): void {
    const level = options.success === false ? 'warn' : 'info';
    const message = options.isFallback 
      ? `Trying fallback provider (attempt ${options.attempt})`
      : `Provider attempt ${options.attempt}`;

    this.log(level, message, {
      requestId,
      userId,
      provider,
      model,
    }, {
      attempt: options.attempt,
      isFallback: options.isFallback,
      latencyMs: options.latencyMs,
      error: options.error,
      success: options.success,
    });
  }

  /**
   * Log streaming events
   */
  logStreamEvent(
    requestId: string,
    userId: string,
    provider: string,
    model: string,
    event: {
      type: 'start' | 'chunk' | 'complete' | 'error' | 'cancel';
      chunkCount?: number;
      tokensUsed?: number;
      latencyMs?: number;
      error?: string;
    }
  ): void {
    let level: LogLevel = 'info';
    let message = `Stream ${event.type}`;

    if (event.type === 'error') {
      level = 'error';
      message = 'Stream error';
    } else if (event.type === 'cancel') {
      level = 'warn';
      message = 'Stream cancelled by client';
    } else if (event.type === 'complete') {
      message = 'Stream completed';
    }

    this.log(level, message, {
      requestId,
      userId,
      provider,
      model,
    }, {
      chunkCount: event.chunkCount,
      tokensUsed: event.tokensUsed,
      latencyMs: event.latencyMs,
      error: event.error,
    });
  }
}

// Singleton instance for chat API
export const chatLogger = new ChatLogger('Chat API');

// Export factory for creating child loggers
export function createChatLogger(component?: string): ChatLogger {
  return new ChatLogger(component);
}
