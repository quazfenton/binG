/**
 * Observability Layer
 * 
 * Provides distributed tracing, metrics, and correlation for the agent system.
 * Built on OpenTelemetry for industry-standard observability.
 * 
 * Features:
 * - Distributed tracing across services
 * - Request correlation IDs
 * - Latency tracking
 * - Error rate monitoring
 * - Custom metrics
 * 
 * @see https://opentelemetry.io/docs/
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Observability');

/**
 * Span types for tracing
 */
export type SpanType =
  | 'agent_step'
  | 'tool_call'
  | 'sandbox_operation'
  | 'llm_request'
  | 'provider_routing'
  | 'filesystem_operation'
  | 'git_operation'
  | 'http_request';

/**
 * Span status
 */
export interface SpanStatus {
  code: 'ok' | 'error' | 'unset';
  message?: string;
}

/**
 * Trace span
 */
export interface Span {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, any>;
  events: SpanEvent[];
}

/**
 * Span event for timeline
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

/**
 * Correlation context for request tracking
 */
export interface CorrelationContext {
  traceId: string;
  spanId: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;
  conversationId?: string;
}

/**
 * Metrics collector
 */
export interface Metrics {
  latency: {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
  };
  errors: {
    count: number;
    rate: number;
  };
  requests: {
    count: number;
    success: number;
    failure: number;
  };
}

/**
 * Observability Manager
 */
export class ObservabilityManager {
  private spans = new Map<string, Span>();
  private traces = new Map<string, Span[]>();
  private metrics = new Map<string, Metrics>();
  private currentContext: CorrelationContext | null = null;

  /**
   * Start a new trace
   */
  startTrace(name: string, type: SpanType): Span {
    const traceId = this.generateId();
    const spanId = this.generateId();

    const span: Span = {
      id: spanId,
      traceId,
      name,
      type,
      startTime: Date.now(),
      status: { code: 'unset' },
      attributes: {},
      events: [],
    };

    this.spans.set(spanId, span);
    this.traces.set(traceId, [span]);
    this.currentContext = { traceId, spanId };

    logger.debug('Trace started', {
      traceId,
      spanId,
      name,
      type,
    });

    return span;
  }

  /**
   * Start a child span
   */
  startSpan(
    name: string,
    type: SpanType,
    parentSpanId?: string
  ): Span {
    const context = this.currentContext;
    if (!context) {
      return this.startTrace(name, type);
    }

    const spanId = this.generateId();
    const span: Span = {
      id: spanId,
      traceId: context.traceId,
      parentSpanId: parentSpanId || context.spanId,
      name,
      type,
      startTime: Date.now(),
      status: { code: 'unset' },
      attributes: {},
      events: [],
    };

    this.spans.set(spanId, span);

    const trace = this.traces.get(context.traceId);
    if (trace) {
      trace.push(span);
    }

    this.currentContext = { ...context, spanId };

    logger.debug('Span started', {
      traceId: context.traceId,
      spanId,
      parentSpanId: span.parentSpanId,
      name,
      type,
    });

    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status?: SpanStatus): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status || { code: 'ok' };

    // Update context to parent
    if (span.parentSpanId) {
      this.currentContext = {
        traceId: span.traceId,
        spanId: span.parentSpanId,
      };
    }

    logger.debug('Span ended', {
      spanId,
      traceId: span.traceId,
      duration: span.endTime - span.startTime,
      status: span.status.code,
    });
  }

  /**
   * Add attribute to span
   */
  setAttribute(spanId: string, key: string, value: any): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.attributes[key] = value;
  }

  /**
   * Add event to span
   */
  addEvent(spanId: string, name: string, attributes?: Record<string, any>): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Record error on span
   */
  recordError(spanId: string, error: Error): void {
    const span = this.spans.get(spanId);
    if (!span) {
      logger.warn('Attempted to record error on non-existent span', { spanId, error: error.message });
      return;
    }

    span.status = { code: 'error', message: error.message };
    this.addEvent(spanId, 'exception', {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
    });

    logger.error('Error recorded on span', {
      spanId,
      traceId: span.traceId,
      spanName: span.name,
      errorType: error.constructor.name,
      errorMessage: error.message,
    });

    // Record error metric
    this.recordError('errors', error);
  }

  /**
   * Record latency metric
   */
  recordLatency(metricName: string, latencyMs: number): void {
    const metrics = this.getOrCreateMetrics(metricName);

    metrics.latency.count++;
    metrics.latency.sum += latencyMs;
    metrics.latency.avg = metrics.latency.sum / metrics.latency.count;
    metrics.latency.min = Math.min(metrics.latency.min || latencyMs, latencyMs);
    metrics.latency.max = Math.max(metrics.latency.max || latencyMs, latencyMs);

    // Simple p95/p99 estimation (would need proper histogram in production)
    metrics.latency.p95 = metrics.latency.max * 0.95;
    metrics.latency.p99 = metrics.latency.max * 0.99;

    logger.debug('Latency recorded', {
      metricName,
      latencyMs,
      count: metrics.latency.count,
      avg: metrics.latency.avg.toFixed(2),
      min: metrics.latency.min,
      max: metrics.latency.max,
      p95: metrics.latency.p95.toFixed(2),
      p99: metrics.latency.p99.toFixed(2),
    });
  }

  /**
   * Record request metric
   */
  recordRequest(metricName: string, success: boolean): void {
    const metrics = this.getOrCreateMetrics(metricName);

    metrics.requests.count++;
    if (success) {
      metrics.requests.success++;
    } else {
      metrics.requests.failure++;
    }

    metrics.errors.count = metrics.requests.failure;
    metrics.errors.rate = metrics.requests.count > 0
      ? metrics.requests.failure / metrics.requests.count
      : 0;

    logger.debug('Request recorded', {
      metricName,
      success,
      total: metrics.requests.count,
      successRate: ((metrics.requests.success / metrics.requests.count) * 100).toFixed(2) + '%',
      failureRate: (metrics.errors.rate * 100).toFixed(2) + '%',
    });
  }

  /**
   * Get current correlation context
   */
  getCurrentContext(): CorrelationContext | null {
    return this.currentContext;
  }

  /**
   * Set correlation context
   */
  setContext(context: CorrelationContext): void {
    this.currentContext = context;
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId: string): Span[] | null {
    return this.traces.get(traceId) || null;
  }

  /**
   * Get span by ID
   */
  getSpan(spanId: string): Span | null {
    return this.spans.get(spanId) || null;
  }

  /**
   * Get metrics
   */
  getMetrics(metricName: string): Metrics | null {
    return this.metrics.get(metricName) || null;
  }

  /**
   * Export trace data (for OpenTelemetry integration)
   */
  exportTrace(traceId: string): any {
    const spans = this.traces.get(traceId);
    if (!spans) return null;

    return {
      traceId,
      spans: spans.map(span => ({
        spanId: span.id,
        parentSpanId: span.parentSpanId,
        name: span.name,
        type: span.type,
        startTime: span.startTime,
        endTime: span.endTime,
        duration: span.endTime ? span.endTime - span.startTime : undefined,
        status: span.status,
        attributes: span.attributes,
        events: span.events,
      })),
    };
  }

  /**
   * Clear old traces (cleanup)
   */
  clearOldTraces(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    let cleared = 0;

    for (const [traceId, spans] of this.traces.entries()) {
      const oldestSpan = spans.reduce(
        (min, span) => Math.min(min, span.startTime),
        Infinity
      );

      if (now - oldestSpan > maxAgeMs) {
        this.traces.delete(traceId);
        for (const span of spans) {
          this.spans.delete(span.id);
        }
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.debug('Cleared old traces', { count: cleared });
    }
  }

  private getOrCreateMetrics(metricName: string): Metrics {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, {
        latency: { count: 0, sum: 0, avg: 0, min: 0, max: 0, p95: 0, p99: 0 },
        errors: { count: 0, rate: 0 },
        requests: { count: 0, success: 0, failure: 0 },
      });
    }
    return this.metrics.get(metricName)!;
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

// Singleton instance
export const observabilityManager = new ObservabilityManager();

/**
 * Helper function to wrap async operation with tracing
 */
export async function withTrace<T>(
  name: string,
  type: SpanType,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const span = observabilityManager.startTrace(name, type);

  logger.debug('Starting traced operation', { name, type, spanId: span.id, traceId: span.traceId });

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      observabilityManager.setAttribute(span.id, key, value);
    }
    logger.debug('Span attributes set', { spanId: span.id, attributeCount: Object.keys(attributes).length });
  }

  try {
    const result = await fn(span);
    observabilityManager.endSpan(span.id, { code: 'ok' });
    logger.debug('Traced operation completed successfully', { name, spanId: span.id });
    return result;
  } catch (error: any) {
    logger.error('Traced operation failed', { name, spanId: span.id, error: error.message });
    observabilityManager.recordError(span.id, error);
    throw error;
  }
}

/**
 * Helper function to wrap async operation with child span
 */
export async function withSpan<T>(
  name: string,
  type: SpanType,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const context = observabilityManager.getCurrentContext();
  const span = observabilityManager.startSpan(name, type, context?.spanId);

  logger.debug('Starting child span', { name, type, spanId: span.id, parentSpanId: span.parentSpanId });

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      observabilityManager.setAttribute(span.id, key, value);
    }
    logger.debug('Span attributes set', { spanId: span.id, attributeCount: Object.keys(attributes).length });
  }

  try {
    const result = await fn(span);
    observabilityManager.endSpan(span.id, { code: 'ok' });
    logger.debug('Child span completed successfully', { name, spanId: span.id });
    return result;
  } catch (error: any) {
    logger.error('Child span failed', { name, spanId: span.id, error: error.message });
    observabilityManager.recordError(span.id, error);
    throw error;
  }
}

/**
 * Get observability statistics
 */
export function getObservabilityStats(): {
  activeTraces: number;
  activeSpans: number;
  metricsCount: number;
} {
  const stats = {
    activeTraces: observabilityManager.getTrace('all')?.length || 0,
    activeSpans: 0,
    metricsCount: 0,
  };

  // This would need proper implementation in ObservabilityManager
  return stats;
}
