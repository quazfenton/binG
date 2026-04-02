# OpenTelemetry Setup Guide

## Overview

binG uses OpenTelemetry for comprehensive observability including:
- Distributed tracing
- Metrics collection
- Performance monitoring
- Error tracking

## Installation

OpenTelemetry dependencies are already installed:

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/sdk-metrics
```

## Configuration

### Environment Variables

Add to your `.env.local`:

```env
# Enable/disable telemetry
TELEMETRY_ENABLED=true

# Service identification
SERVICE_NAME=binG
SERVICE_VERSION=0.1.0

# Sampling rate (0.0-1.0)
TELEMETRY_SAMPLING_RATE=1.0

# Export interval in milliseconds
TELEMETRY_EXPORT_INTERVAL=5000

# OTLP Exporter endpoint (optional - for external collectors)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Local Development Setup

### Option 1: Jaeger (Recommended)

1. **Start Jaeger with Docker:**
```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

2. **Configure environment:**
```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

3. **Access Jaeger UI:**
Open http://localhost:16686

### Option 2: Zipkin

1. **Start Zipkin:**
```bash
docker run -d --name zipkin \
  -p 9411:9411 \
  openzipkin/zipkin:latest
```

2. **Configure environment:**
```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:9411
```

3. **Access Zipkin UI:**
Open http://localhost:9411/zipkin

### Option 3: Honeycomb (Cloud)

1. **Get your API key** from Honeycomb dashboard

2. **Configure environment:**
```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
```

### Option 4: Console Only (No Exporter)

For local debugging without external collector:

```env
TELEMETRY_ENABLED=true
# Don't set OTEL_EXPORTER_OTLP_ENDPOINT
```

Metrics will be logged to console only.

## Usage

### Manual Tracing

```typescript
import { startSpan, recordEndpointUsage } from '@/lib/api/response-router-telemetry'

// Start a span
const span = startSpan('my-operation', { customAttribute: 'value' })

try {
  // Your operation
  const startTime = Date.now()
  await doSomething()
  const duration = Date.now() - startTime
  
  // Record metrics
  recordEndpointUsage('my-endpoint', duration, true)
} catch (error) {
  span.recordError(error)
  recordEndpointUsage('my-endpoint', duration, false)
  throw
} finally {
  span.end()
}
```

### Automatic Tracing

The response router automatically traces:
- Request routing
- V2 gateway communication
- Tool execution
- Circuit breaker events
- Quota usage

## Metrics

Available metrics:

### Request Metrics
- `router.requests.total` - Total requests
- `router.requests.duration` - Request duration histogram
- `router.errors.total` - Total errors

### V2 Gateway Metrics
- Job submissions
- Job completions/failures
- Job duration

### Circuit Breaker Metrics
- Circuit states (open/closed/half-open)
- Trip count

### Tool Metrics
- Tool executions
- Tool errors
- Tool duration

## Viewing Metrics

### Console Output

Metrics are logged to console every 5 seconds (configurable via `TELEMETRY_EXPORT_INTERVAL`):

```
[Telemetry:ResponseRouter] Metrics Summary {
  requests: {
    total: 150,
    errors: 3,
    avgDurationMs: 245
  },
  v2Gateway: {
    submissions: 45,
    completions: 42,
    failures: 3,
    avgDurationMs: 1250
  },
  circuitBreaker: {
    trips: 1,
    states: { 'api-tool': 'closed', 'slow-endpoint': 'open' }
  },
  tools: {
    executions: 89,
    errors: 2
  }
}
```

### OpenTelemetry Collectors

When configured with an OTLP endpoint, metrics are exported to your collector for visualization in:
- Jaeger UI
- Zipkin UI
- Honeycomb
- Grafana Tempo
- Other OTLP-compatible backends

## Troubleshooting

### Telemetry Not Initializing

Check logs for:
```
[Telemetry:ResponseRouter] Failed to initialize OpenTelemetry
```

**Solutions:**
1. Verify packages are installed: `pnpm list @opentelemetry/*`
2. Check environment variables are set correctly
3. Ensure OTLP endpoint is accessible

### No Traces Appearing in Collector

**Check:**
1. OTLP endpoint is correct (include protocol: `http://` or `https://`)
2. Network connectivity to collector
3. Collector is running and accepting OTLP traffic

**Debug:**
```bash
# Test OTLP endpoint
curl -v http://localhost:4318/v1/traces -H "Content-Type: application/json" -d '{}'
```

### High Memory Usage

**Reduce sampling rate:**
```env
TELEMETRY_SAMPLING_RATE=0.1  # Sample 10% of traces
```

**Reduce export interval:**
```env
TELEMETRY_EXPORT_INTERVAL=10000  # Export every 10 seconds
```

## Performance Impact

- **Overhead:** ~2-5% latency increase with default settings
- **Memory:** ~50-100MB for trace buffering
- **CPU:** Minimal (<1% for most workloads)

## Best Practices

1. **Production:** Use sampling rate < 1.0 for high-traffic services
2. **Development:** Enable full sampling for detailed debugging
3. **Sensitive Data:** Avoid including PII in span attributes
4. **Error Handling:** Always call `span.end()` in finally blocks
5. **Context Propagation:** Use `startSpan` for nested operations

## Integration with Existing Tools

### Vercel AI SDK

The Vercel AI SDK integration is already instrumented. Traces include:
- LLM calls
- Tool executions
- Stream events

### LangChain

LangChain traces are automatically captured when using the telemetry layer.

### Custom Instruments

Add custom instruments for specific operations:

```typescript
// lib/instruments/my-instrument.ts
import { startSpan } from '@/lib/api/response-router-telemetry'

export async function instrumentedOperation<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const span = startSpan(name)
  try {
    return await fn()
  } catch (error) {
    span.recordError(error)
    throw
  } finally {
    span.end()
  }
}
```

## Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Honeycomb OpenTelemetry](https://docs.honeycomb.io/send-data/opentelemetry/)
