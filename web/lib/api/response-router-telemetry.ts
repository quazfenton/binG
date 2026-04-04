/**
 * OpenTelemetry Telemetry for Response Router
 * 
 * Provides comprehensive observability for:
 * - Request routing through priority chain
 * - V2 gateway communication
 * - Tool execution
 * - Circuit breaker events
 * - Quota usage
 * - Performance metrics
 * 
 * @see https://opentelemetry.io/docs/
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('Telemetry:ResponseRouter')

// ============================================================================
// Telemetry Configuration
// ============================================================================

export interface TelemetryConfig {
  enabled: boolean
  serviceName: string
  serviceVersion: string
  environment: string
  samplingRate: number
  exportInterval: number
}

const defaultConfig: TelemetryConfig = {
  enabled: process.env.TELEMETRY_ENABLED !== 'false',
  serviceName: process.env.SERVICE_NAME || 'response-router',
  serviceVersion: process.env.SERVICE_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  samplingRate: parseFloat(process.env.TELEMETRY_SAMPLING_RATE || '1.0'),
  exportInterval: parseInt(process.env.TELEMETRY_EXPORT_INTERVAL || '5000', 10),
}

let config: TelemetryConfig = { ...defaultConfig }
let otelTracer: any = null
let otelMeter: any = null

// ============================================================================
// Metrics
// ============================================================================

interface RouterMetrics {
  // Request metrics
  requestCount: number
  requestDuration: number[]
  requestErrors: number
  
  // Endpoint metrics
  endpointUsage: Map<string, number>
  endpointDuration: Map<string, number[]>
  endpointErrors: Map<string, number>
  
  // Circuit breaker metrics
  circuitBreakerState: Map<string, string>
  circuitBreakerTrips: number
  
  // V2 gateway metrics
  v2JobSubmissions: number
  v2JobCompletions: number
  v2JobFailures: number
  v2JobDuration: number[]
  
  // Quota metrics
  quotaUsage: Map<string, number>
  quotaExceeded: number
  
  // Tool metrics
  toolExecutions: number
  toolErrors: number
  toolDuration: number[]
}

const metrics: RouterMetrics = {
  requestCount: 0,
  requestDuration: [],
  requestErrors: 0,
  endpointUsage: new Map(),
  endpointDuration: new Map(),
  endpointErrors: new Map(),
  circuitBreakerState: new Map(),
  circuitBreakerTrips: 0,
  v2JobSubmissions: 0,
  v2JobCompletions: 0,
  v2JobFailures: 0,
  v2JobDuration: [],
  quotaUsage: new Map(),
  quotaExceeded: 0,
  toolExecutions: 0,
  toolErrors: 0,
  toolDuration: [],
}

// Track previous values to detect changes
let previousMetrics = {
  requestCount: 0,
  requestErrors: 0,
  circuitBreakerTrips: 0,
  v2JobSubmissions: 0,
  v2JobCompletions: 0,
  v2JobFailures: 0,
  toolExecutions: 0,
  toolErrors: 0,
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize OpenTelemetry
 */
export async function initializeTelemetry(customConfig?: Partial<TelemetryConfig>): Promise<void> {
  config = { ...config, ...customConfig }

  if (!config.enabled) {
    logger.info('Telemetry disabled')
    return
  }

  try {
    // Try to initialize OpenTelemetry
    const sdkTraceNode = await import('@opentelemetry/sdk-trace-node')
    const sdkTraceBase = await import('@opentelemetry/sdk-trace-base')
    const exporterTraceOtlp = await import('@opentelemetry/exporter-trace-otlp-http')
    const resources = await import('@opentelemetry/resources')
    const semanticConventions = await import('@opentelemetry/semantic-conventions')
    const sdkMetrics = await import('@opentelemetry/sdk-metrics')

    const NodeTracerProvider = sdkTraceNode.NodeTracerProvider
    const BatchSpanProcessor = sdkTraceBase.BatchSpanProcessor
    const OTLPTraceExporter = exporterTraceOtlp.OTLPTraceExporter
    const Resource = (resources as any).default || (resources as any).Resource
    const SemanticResourceAttributes = semanticConventions.SemanticResourceAttributes
    const MeterProvider = sdkMetrics.MeterProvider

    if (!Resource) {
      throw new Error('Resource class not found in @opentelemetry/resources')
    }

    // Create tracer provider
    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
      }),
    })

    // Add exporter if OTLP endpoint configured
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      const exporter = new OTLPTraceExporter({
        url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      })
      // New SDK API - use addSpanProcessor from the provider
      const providerAny = provider as any
      if (providerAny.addSpanProcessor) {
        providerAny.addSpanProcessor(new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: config.exportInterval,
        }))
        logger.info('OTLP trace exporter configured')
      }
    }

    // New SDK API - register is optional
    const providerAny = provider as any
    if (providerAny.register) {
      providerAny.register()
    }
    otelTracer = provider.getTracer(config.serviceName, config.serviceVersion)

    // Create meter provider
    const meterProvider = new MeterProvider({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
      }),
    })
    // New SDK API - register is optional
    const meterProviderAny = meterProvider as any
    if (meterProviderAny.register) {
      meterProviderAny.register()
    }
    otelMeter = meterProvider.getMeter(config.serviceName)

    logger.info('OpenTelemetry initialized', {
      serviceName: config.serviceName,
      version: config.serviceVersion,
      environment: config.environment,
    })
  } catch (error: any) {
    logger.warn('Failed to initialize OpenTelemetry, using in-memory metrics only:', error.message)
  }

  // Start periodic metrics export
  startMetricsExport()
}

/**
 * Start periodic metrics export
 */
function startMetricsExport(): void {
  setInterval(() => {
    if (config.enabled && otelMeter) {
      exportMetrics()
    }
    logMetricsSummary()
  }, config.exportInterval)
}

/**
 * Export metrics to OpenTelemetry
 */
function exportMetrics(): void {
  if (!otelMeter) return

  try {
    // Create counters and histograms
    const requestCounter = otelMeter.createCounter('router.requests.total', {
      description: 'Total number of requests',
    })
    const requestDuration = otelMeter.createHistogram('router.requests.duration', {
      description: 'Request duration in milliseconds',
    })
    const errorCounter = otelMeter.createCounter('router.errors.total', {
      description: 'Total number of errors',
    })

    // Record metrics
    requestCounter.add(metrics.requestCount)
    if (metrics.requestDuration.length > 0) {
      const avgDuration = metrics.requestDuration.reduce((a, b) => a + b, 0) / metrics.requestDuration.length
      requestDuration.record(avgDuration)
    }
    errorCounter.add(metrics.requestErrors)

    logger.debug('Metrics exported to OpenTelemetry')
  } catch (error: any) {
    logger.warn('Failed to export metrics:', error.message)
  }
}

/**
 * Log metrics summary to console (only when values change)
 */
function logMetricsSummary(): void {
  // Check if any metrics have changed since last log
  const hasChanges = (
    metrics.requestCount !== previousMetrics.requestCount ||
    metrics.requestErrors !== previousMetrics.requestErrors ||
    metrics.circuitBreakerTrips !== previousMetrics.circuitBreakerTrips ||
    metrics.v2JobSubmissions !== previousMetrics.v2JobSubmissions ||
    metrics.v2JobCompletions !== previousMetrics.v2JobCompletions ||
    metrics.v2JobFailures !== previousMetrics.v2JobFailures ||
    metrics.toolExecutions !== previousMetrics.toolExecutions ||
    metrics.toolErrors !== previousMetrics.toolErrors
  );

  // Skip logging if nothing has changed
  if (!hasChanges) {
    return;
  }

  // Update previous values
  previousMetrics = {
    requestCount: metrics.requestCount,
    requestErrors: metrics.requestErrors,
    circuitBreakerTrips: metrics.circuitBreakerTrips,
    v2JobSubmissions: metrics.v2JobSubmissions,
    v2JobCompletions: metrics.v2JobCompletions,
    v2JobFailures: metrics.v2JobFailures,
    toolExecutions: metrics.toolExecutions,
    toolErrors: metrics.toolErrors,
  };

  const avgRequestDuration = metrics.requestDuration.length > 0
    ? metrics.requestDuration.reduce((a, b) => a + b, 0) / metrics.requestDuration.length
    : 0

  const avgV2Duration = metrics.v2JobDuration.length > 0
    ? metrics.v2JobDuration.reduce((a, b) => a + b, 0) / metrics.v2JobDuration.length
    : 0

  logger.info('Metrics Summary', {
    requests: {
      total: metrics.requestCount,
      errors: metrics.requestErrors,
      avgDurationMs: Math.round(avgRequestDuration),
    },
    v2Gateway: {
      submissions: metrics.v2JobSubmissions,
      completions: metrics.v2JobCompletions,
      failures: metrics.v2JobFailures,
      avgDurationMs: Math.round(avgV2Duration),
    },
    circuitBreaker: {
      trips: metrics.circuitBreakerTrips,
      states: Object.fromEntries(metrics.circuitBreakerState),
    },
    tools: {
      executions: metrics.toolExecutions,
      errors: metrics.toolErrors,
    },
  })
}

// ============================================================================
// Tracing
// ============================================================================

/**
 * Start a trace span
 */
export function startSpan(name: string, attributes?: Record<string, any>): Span {
  if (!otelTracer) {
    return new NoopSpan()
  }

  const span = otelTracer.startSpan(name, { attributes })
  return new OpenTelemetrySpan(span)
}

/**
 * Span interface
 */
export interface Span {
  setAttribute(key: string, value: any): void
  setAttributes(attributes: Record<string, any>): void
  addEvent(name: string, attributes?: Record<string, any>): void
  recordError(error: Error): void
  end(): void
}

class OpenTelemetrySpan implements Span {
  constructor(private span: any) {}

  setAttribute(key: string, value: any): void {
    this.span.setAttribute(key, value)
  }

  setAttributes(attributes: Record<string, any>): void {
    this.span.setAttributes(attributes)
  }

  addEvent(name: string, attributes?: Record<string, any>): void {
    this.span.addEvent(name, attributes)
  }

  recordError(error: Error): void {
    this.span.recordException(error)
  }

  end(): void {
    this.span.end()
  }
}

class NoopSpan implements Span {
  setAttribute(): void {}
  setAttributes(): void {}
  addEvent(): void {}
  recordError(): void {}
  end(): void {}
}

// ============================================================================
// Metric Recording Functions
// ============================================================================

/**
 * Record request
 */
export function recordRequest(durationMs: number, success: boolean): void {
  metrics.requestCount++
  metrics.requestDuration.push(durationMs)
  
  // Keep only last 1000 durations
  if (metrics.requestDuration.length > 1000) {
    metrics.requestDuration.shift()
  }

  if (!success) {
    metrics.requestErrors++
  }
}

/**
 * Record endpoint usage
 */
export function recordEndpointUsage(endpoint: string, durationMs: number, success: boolean): void {
  const current = metrics.endpointUsage.get(endpoint) || 0
  metrics.endpointUsage.set(endpoint, current + 1)

  const durations = metrics.endpointDuration.get(endpoint) || []
  durations.push(durationMs)
  if (durations.length > 100) {
    durations.shift()
  }
  metrics.endpointDuration.set(endpoint, durations)

  if (!success) {
    const errors = metrics.endpointErrors.get(endpoint) || 0
    metrics.endpointErrors.set(endpoint, errors + 1)
  }
}

/**
 * Record circuit breaker state change
 */
export function recordCircuitBreakerState(endpoint: string, state: string): void {
  const prevState = metrics.circuitBreakerState.get(endpoint)
  metrics.circuitBreakerState.set(endpoint, state)

  if (prevState === 'closed' && state === 'open') {
    metrics.circuitBreakerTrips++
    logger.warn('Circuit breaker tripped', { endpoint })
  }
}

/**
 * Record V2 job submission
 */
export function recordV2JobSubmission(): void {
  metrics.v2JobSubmissions++
}

/**
 * Record V2 job completion
 */
export function recordV2JobCompletion(durationMs: number, success: boolean): void {
  if (success) {
    metrics.v2JobCompletions++
  } else {
    metrics.v2JobFailures++
  }

  metrics.v2JobDuration.push(durationMs)
  if (metrics.v2JobDuration.length > 100) {
    metrics.v2JobDuration.shift()
  }
}

/**
 * Record quota usage
 */
export function recordQuotaUsage(provider: string, amount: number): void {
  const current = metrics.quotaUsage.get(provider) || 0
  metrics.quotaUsage.set(provider, current + amount)
}

/**
 * Record quota exceeded
 */
export function recordQuotaExceeded(): void {
  metrics.quotaExceeded++
}

/**
 * Record tool execution
 */
export function recordToolExecution(durationMs: number, success: boolean): void {
  metrics.toolExecutions++
  metrics.toolDuration.push(durationMs)
  
  if (metrics.toolDuration.length > 100) {
    metrics.toolDuration.shift()
  }

  if (!success) {
    metrics.toolErrors++
  }
}

// ============================================================================
// Get Metrics
// ============================================================================

/**
 * Get current metrics
 */
export function getMetrics(): RouterMetrics {
  return { ...metrics }
}

/**
 * Get metrics summary
 */
export function getMetricsSummary(): {
  requestsPerSecond: number
  errorRate: number
  avgResponseTime: number
  v2SuccessRate: number
  circuitBreakerHealth: string
} {
  const avgResponseTime = metrics.requestDuration.length > 0
    ? metrics.requestDuration.reduce((a, b) => a + b, 0) / metrics.requestDuration.length
    : 0

  const errorRate = metrics.requestCount > 0
    ? metrics.requestErrors / metrics.requestCount
    : 0

  const v2SuccessRate = metrics.v2JobSubmissions > 0
    ? metrics.v2JobCompletions / metrics.v2JobSubmissions
    : 0

  const openCircuits = Array.from(metrics.circuitBreakerState.values()).filter(s => s === 'open').length
  const circuitBreakerHealth = openCircuits === 0 ? 'healthy' : openCircuits < 3 ? 'degraded' : 'unhealthy'

  return {
    requestsPerSecond: metrics.requestCount / (config.exportInterval / 1000),
    errorRate,
    avgResponseTime: Math.round(avgResponseTime),
    v2SuccessRate,
    circuitBreakerHealth,
  }
}

/**
 * Reset metrics (for testing)
 */
export function resetMetrics(): void {
  metrics.requestCount = 0
  metrics.requestDuration = []
  metrics.requestErrors = 0
  metrics.endpointUsage.clear()
  metrics.endpointDuration.clear()
  metrics.endpointErrors.clear()
  metrics.circuitBreakerState.clear()
  metrics.circuitBreakerTrips = 0
  metrics.v2JobSubmissions = 0
  metrics.v2JobCompletions = 0
  metrics.v2JobFailures = 0
  metrics.v2JobDuration = []
  metrics.quotaUsage.clear()
  metrics.quotaExceeded = 0
  metrics.toolExecutions = 0
  metrics.toolErrors = 0
  metrics.toolDuration = []
}

// ============================================================================
// Auto-initialization
// ============================================================================

// Initialize telemetry on module load
initializeTelemetry().catch((error) => {
  logger.error('Failed to initialize telemetry:', error.message)
})
