/**
 * OpenTelemetry Tracing
 *
 * Distributed tracing for agent execution, tool calls, and sandbox operations.
 *
 * @module observability/tracing
 */

/**
 * Fallback Span interface when OpenTelemetry is not available
 */
export interface Span {
  end: () => void;
  setAttribute: (key: string, value: any) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  addEvent: (name: string, attributes?: Record<string, any>) => void;
  spanContext?: () => any;
}

/**
 * Optional OpenTelemetry wrapper
 * Gracefully degrades to no-op stubs if OpenTelemetry is not installed.
 */
let otelApi: any = null;

try {
  otelApi = require('@opentelemetry/api');
} catch (e) {
  console.warn('[Observability] OpenTelemetry API not found, running with no-op stubs.');
}

const noOpSpan = {
  end: () => {},
  setAttribute: () => {},
  setStatus: () => {},
  addEvent: () => {},
};

export const trace = otelApi?.trace ?? {
  getTracer: () => ({
    startSpan: () => noOpSpan,
  }),
};

export const context = otelApi?.context ?? {
  active: () => ({}),
  with: (_ctx: any, fn: Function) => fn(),
};

export const SpanKind = otelApi?.SpanKind ?? { INTERNAL: 0, SERVER: 1, CLIENT: 2 };
export const SpanStatusCode = otelApi?.SpanStatusCode ?? { UNSET: 0, OK: 1, ERROR: 2 };
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Observability:Tracing');

const TRACER_NAME = 'binG';
const TRACER_VERSION = '1.0.0';

/**
 * Get tracer instance
 */
export const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

/**
 * Span attributes interface
 */
export interface SpanAttributes {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  provider?: string;
  model?: string;
  toolName?: string;
  sandboxId?: string;
  taskType?: string;
  error?: string;
  [key: string]: any;
}

/**
 * Start a span for agent execution
 */
export function startAgentExecutionSpan(
  agentId: string,
  task: string,
  attributes?: SpanAttributes
): Span {
  const span = tracer.startSpan('agent.execution', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'agent.id': agentId,
      'agent.task': task,
      ...attributes,
    },
  });

  logger.debug('Started agent execution span', {
    agentId,
    spanContext: span.spanContext(),
  });

  return span;
}

/**
 * Start a span for tool execution
 */
export function startToolExecutionSpan(
  toolName: string,
  args: any,
  attributes?: SpanAttributes
): Span {
  const span = tracer.startSpan('tool.execution', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'tool.name': toolName,
      'tool.args': JSON.stringify(args),
      ...attributes,
    },
  });

  logger.debug('Started tool execution span', {
    toolName,
    spanContext: span.spanContext(),
  });

  return span;
}

/**
 * Start a span for sandbox operations
 */
export function startSandboxOperationSpan(
  operation: string,
  sandboxId: string,
  attributes?: SpanAttributes
): Span {
  const span = tracer.startSpan('sandbox.operation', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'sandbox.operation': operation,
      'sandbox.id': sandboxId,
      ...attributes,
    },
  });

  logger.debug('Started sandbox operation span', {
    operation,
    sandboxId,
    spanContext: span.spanContext(),
  });

  return span;
}

/**
 * Start a span for LLM generation
 */
export function startLLMGenerationSpan(
  model: string,
  provider: string,
  prompt?: string,
  attributes?: SpanAttributes
): Span {
  const span = tracer.startSpan('llm.generation', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'llm.model': model,
      'llm.provider': provider,
      'llm.prompt.length': prompt?.length || 0,
      ...attributes,
    },
  });

  logger.debug('Started LLM generation span', {
    model,
    provider,
    spanContext: span.spanContext(),
  });

  return span;
}

/**
 * Record span error
 */
export function recordSpanError(span: Span, error: Error): void {
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error.message,
  });
  span.recordException(error);
  
  logger.debug('Recorded span error', {
    error: error.message,
    spanContext: span.spanContext(),
  });
}

/**
 * Record span success with result
 */
export function recordSpanSuccess(span: Span, result?: any): void {
  span.setStatus({ code: SpanStatusCode.OK });
  
  if (result !== undefined) {
    span.setAttribute('result.type', typeof result);
    if (typeof result === 'string') {
      span.setAttribute('result.length', result.length);
    } else if (typeof result === 'object') {
      span.setAttribute('result.keys', Object.keys(result).join(','));
    }
  }
  
  logger.debug('Recorded span success', {
    spanContext: span.spanContext(),
  });
}

/**
 * Execute function with tracing
 */
export async function withSpan<T>(
  span: Span,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await context.with(trace.setSpan(context.active(), span), fn);
    recordSpanSuccess(span, result);
    return result;
  } catch (error: any) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Create correlation ID for tracing across services
 */
export function createCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get correlation ID from context or create new one
 */
export function getOrCreateCorrelationId(): string {
  const activeContext = context.active();
  const existing = trace.getSpan(activeContext)?.spanContext().traceId;
  
  if (existing) {
    return existing;
  }
  
  return createCorrelationId();
}

/**
 * Inject correlation ID into headers for downstream services
 */
export function injectCorrelationId(headers: Record<string, string>): Record<string, string> {
  const correlationId = getOrCreateCorrelationId();
  return {
    ...headers,
    'x-correlation-id': correlationId,
  };
}

/**
 * Extract correlation ID from headers
 */
export function extractCorrelationId(headers: Record<string, string>): string | undefined {
  return headers['x-correlation-id'];
}
