/**
 * OpenTelemetry Setup Verification
 * 
 * Run this script to verify OpenTelemetry is properly configured:
 * pnpm tsx scripts/verify-opentelemetry.ts
 */

import { createLogger } from '../lib/utils/logger'

const logger = createLogger('Verify:OpenTelemetry')

async function verifyOpenTelemetry() {
  console.log('🔍 Verifying OpenTelemetry Setup...\n')
  
  // Check 1: Verify packages are installed
  console.log('✓ Checking package installation...')
  try {
    const api = await import('@opentelemetry/api')
    const sdkTraceNode = await import('@opentelemetry/sdk-trace-node')
    const sdkTraceBase = await import('@opentelemetry/sdk-trace-base')
    const exporterOtlp = await import('@opentelemetry/exporter-trace-otlp-http')
    const resources = await import('@opentelemetry/resources')
    const semanticConventions = await import('@opentelemetry/semantic-conventions')
    const sdkMetrics = await import('@opentelemetry/sdk-metrics')
    
    console.log('  ✓ All OpenTelemetry packages loaded successfully')
    console.log(`    - @opentelemetry/api: ${typeof api.trace !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/sdk-trace-node: ${typeof sdkTraceNode.NodeTracerProvider !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/sdk-trace-base: ${typeof sdkTraceBase.BatchSpanProcessor !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/exporter-trace-otlp-http: ${typeof exporterOtlp.OTLPTraceExporter !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/resources: ${typeof resources.Resource !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/semantic-conventions: ${typeof semanticConventions.SemanticResourceAttributes !== 'undefined' ? '✓' : '✗'}`)
    console.log(`    - @opentelemetry/sdk-metrics: ${typeof sdkMetrics.MeterProvider !== 'undefined' ? '✓' : '✗'}`)
  } catch (error: any) {
    console.error('  ✗ Failed to load OpenTelemetry packages:', error.message)
    console.error('\n  Try: pnpm add @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/sdk-metrics')
    return false
  }
  
  // Check 2: Verify telemetry module loads
  console.log('\n✓ Checking telemetry module...')
  try {
    const telemetry = await import('../lib/api/response-router-telemetry')
    
    if (telemetry.initializeTelemetry) {
      console.log('  ✓ Telemetry module loaded')
    } else {
      console.error('  ✗ Telemetry module missing expected exports')
      return false
    }
    
    // Check 3: Verify initialization
    console.log('\n✓ Testing telemetry initialization...')
    await telemetry.initializeTelemetry({
      enabled: true,
      serviceName: 'test-service',
      serviceVersion: '1.0.0',
      environment: 'test',
      samplingRate: 1.0,
      exportInterval: 1000,
    })
    console.log('  ✓ Telemetry initialized successfully')
    
    // Check 4: Verify span creation
    console.log('\n✓ Testing span creation...')
    const span = telemetry.startSpan('test-span', { testAttribute: 'value' })
    span.setAttribute('testAttr2', 'value2')
    span.addEvent('test-event')
    span.end()
    console.log('  ✓ Span created and ended successfully')
    
    // Check 5: Verify metrics recording
    console.log('\n✓ Testing metrics recording...')
    telemetry.recordRequest(100, true)
    telemetry.recordEndpointUsage('test-endpoint', 50, true)
    telemetry.recordToolExecution(25, true)
    console.log('  ✓ Metrics recorded successfully')
    
    // Check 6: Verify environment variables
    console.log('\n✓ Checking environment configuration...')
    const telemetryEnabled = process.env.TELEMETRY_ENABLED !== 'false'
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    
    console.log(`  - TELEMETRY_ENABLED: ${telemetryEnabled ? '✓' : '✗'}`)
    console.log(`  - OTEL_EXPORTER_OTLP_ENDPOINT: ${otlpEndpoint || 'Not configured (optional)'}`)
    console.log(`  - SERVICE_NAME: ${process.env.SERVICE_NAME || 'default: response-router'}`)
    console.log(`  - SERVICE_VERSION: ${process.env.SERVICE_VERSION || 'default: 1.0.0'}`)
    
    // Get metrics summary
    const summary = telemetry.getMetricsSummary()
    console.log('\n✓ Metrics Summary:')
    console.log(`  - Requests: ${summary.requestsPerSecond.toFixed(2)}/s`)
    console.log(`  - Error Rate: ${(summary.errorRate * 100).toFixed(2)}%`)
    console.log(`  - Avg Response Time: ${summary.avgResponseTime}ms`)
    console.log(`  - V2 Success Rate: ${(summary.v2SuccessRate * 100).toFixed(2)}%`)
    console.log(`  - Circuit Breaker Health: ${summary.circuitBreakerHealth}`)
    
  } catch (error: any) {
    console.error('  ✗ Telemetry test failed:', error.message)
    logger.error('Stack trace:', error.stack)
    return false
  }
  
  console.log('\n✅ All OpenTelemetry checks passed!\n')
  console.log('📚 Next steps:')
  console.log('  1. Configure OTEL_EXPORTER_OTLP_ENDPOINT to send traces to your collector')
  console.log('  2. Set up Jaeger/Zipkin/Honeycomb for trace visualization')
  console.log('  3. See docs/OPENTELEMETRY_SETUP.md for detailed setup instructions\n')
  
  return true
}

// Run verification
verifyOpenTelemetry()
  .then(success => {
    if (!success) {
      console.error('\n❌ OpenTelemetry setup verification failed!')
      console.error('See errors above for details.\n')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('\n❌ Unexpected error during verification:', error.message)
    process.exit(1)
  })
