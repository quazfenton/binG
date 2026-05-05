/**
 * Prometheus Metrics Endpoint
 * Exposes Prometheus-compatible metrics at /api/metrics
 * 
 * Scrape configuration for prometheus.yml:
 * 
 * scrape_configs:
 *   - job_name: 'bing-backend'
 *     static_configs:
 *       - targets: ['localhost:3000']
 *     metrics_path: '/api/metrics'
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { sandboxMetrics } from '@/lib/backend';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      const configuredMetricsKey = process.env.METRICS_API_KEY;
      if (configuredMetricsKey) {
        const providedMetricsKey = request.headers.get('x-metrics-key');
        if (providedMetricsKey !== configuredMetricsKey) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
      } else {
        const authResult = await resolveRequestAuth(request, { allowAnonymous: false });
        if (!authResult.success || !authResult.userId) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
      }
    }

    const metrics = sandboxMetrics.registry.toPrometheusFormat();

    return new NextResponse(metrics, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
