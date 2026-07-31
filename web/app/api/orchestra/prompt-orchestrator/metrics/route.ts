/**
 * app/api/orchestra/prompt-orchestrator/metrics/route.ts
 *
 * Tier 8 step 8 — observability/metrics endpoint for the prompt-orchestrator
 * foundation. GET-only. Returns Prometheus exposition text format (version
 * 0.0.4) for consumption by Prometheus / VictoriaMetrics / Grafana Alloy /
 * any scraper that speaks the de-facto standard.
 *
 * Scrape configuration (drop-in for prometheus.yml):
 *
 *   scrape_configs:
 *     - job_name: 'bing-prompt-orchestrator'
 *       static_configs:
 *         - targets: ['localhost:3000']
 *       metrics_path: '/api/orchestra/prompt-orchestrator/metrics'
 *
 * Reuses the existing /api/observability/metrics endpoint's exposition
 * format convention (`text/plain; version=0.0.4`) so a single scraper rule
 * can pick up both. The /api/observability/metrics endpoint is general;
 * this one is prompt-orchestrator-specific.
 *
 * Auth-gating (applied 2026-07-08 polish follow-up): in production the
 * route is gated behind either (a) a custom METRICS_API_KEY env var that
 * the scraper must send as the `x-metrics-key` header, or (b) the standard
 * auth-0 session resolver (resolveRequestAuth with allowAnonymous=false).
 * In dev mode the gate is skipped. This mirrors /api/metrics/route.ts.
 */
import { NextRequest, NextResponse } from 'next/server';

import { serializeMetrics } from '@/lib/orchestra/prompt-orchestrator/observability';
import { resolveRequestAuth } from '@/lib/auth/request-auth';

// Mark the route dynamic so Next.js never tries to statically prerender it.
export const dynamic = 'force-dynamic';

/**
 * GET /api/orchestra/prompt-orchestrator/metrics
 *
 * Returns the in-memory observability counters/gauges/histogram as
 * Prometheus exposition text. The store resets on process restart; this is
 * acceptable for the operator-debug scope defined in
 * `docs/prompt-orchestrator-deferred-steps.md#L20` (ROI threshold is ~10
 * QPS sustained; persistent-store needs come later).
 *
 * Auth (production-only): either METRICS_API_KEY env (header check) OR
 * auth-0 session (request-auth). Mirrors /api/metrics/route.ts.
 */
export async function GET(request: NextRequest): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    const configuredMetricsKey = process.env.METRICS_API_KEY;
    // Empty string (or unset env var) is treated as 'key not configured'
    // (JS truthy check), so it falls through to the auth-0 check below.
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

  const body = serializeMetrics();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
