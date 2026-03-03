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
import { sandboxMetrics } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
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
