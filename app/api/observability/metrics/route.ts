/**
 * Observability API
 *
 * Endpoints for metrics and tracing data.
 *
 * GET /api/observability/metrics - Prometheus metrics
 * GET /api/observability/status - Observability status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPrometheusMetrics, getObservabilityStatus } from '@/lib/observability';

/**
 * GET /api/observability/metrics
 * 
 * Returns Prometheus-format metrics
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'prometheus';
    
    if (format === 'prometheus') {
      const metrics = getPrometheusMetrics();
      
      return new Response(metrics, {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4',
        },
      });
    }
    
    if (format === 'json') {
      return NextResponse.json({
        success: true,
        metrics,
      });
    }
    
    return NextResponse.json({
      error: 'Invalid format. Use "prometheus" or "json"',
    }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to get metrics',
    }, { status: 500 });
  }
}

/**
 * GET /api/observability/status
 * 
 * Returns observability system status
 */
export async function GET_STATUS() {
  try {
    const status = getObservabilityStatus();
    
    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Failed to get status',
    }, { status: 500 });
  }
}
