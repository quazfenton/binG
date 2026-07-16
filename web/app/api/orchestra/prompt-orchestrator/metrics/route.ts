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
 * Auth-gating: in production the platform's standard request-auth resolver
 * (see /api/metrics/route.ts which gates via METRICS_API_KEY env) would
 * apply. For step 8 we defer the auth wrapper to a follow-up: the dev-mode
 * path is plain GET and the route is purely additive (no side effects, no
 * PII only metric counters).
 */
import { serializeMetrics } from '@/lib/orchestra/prompt-orchestrator/observability';

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
 */
export async function GET(): Promise<Response> {
  const body = serializeMetrics();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
