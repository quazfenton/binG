/**
 * Observability API
 *
 * Endpoints for metrics and tracing data.
 *
 * GET /api/observability/metrics - Prometheus metrics
 * GET /api/observability/status - Observability status (see ../status/route.ts)
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { getPrometheusMetrics } from '@/lib/observability';

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
      const metricsData = getPrometheusMetrics();
      return NextResponse.json({
        success: true,
        metrics: metricsData,
      });
    }
    
    return NextResponse.json({
      error: 'Invalid format. Use "prometheus" or "json"',
    }, { status: 400 });
  } catch (error: any) {
    // Log detailed error server-side, return generic message to client
    console.error('[Observability] Failed to get metrics:', error);
    return NextResponse.json({
      error: 'Failed to get metrics',
    }, { status: 500 });
  }
}
