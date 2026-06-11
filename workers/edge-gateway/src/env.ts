/**
 * Environment variables and bindings for the edge gateway worker.
 *
 * Generate/update this file by running: `npx wrangler types`
 */
export interface Env {
  // Backend URLs (plain vars — overridable at runtime via KV `runtime:BACKEND_URL`)
  BACKEND_URL: string;   // OCI backend (e.g. https://api.bing.dev). Deploy-time default.
  FRONTEND_URL: string;  // Vercel frontend (e.g. https://web-eight-ashen-83.vercel.app)

  // Authentication
  JWT_SECRET?: string;   // optional — if unset, tokens are decoded without verification

  // Secret used to sign short-lived JWTs (5 min) for the 302 redirect from
  // /api/chat and /v1/chat/completions to the backend. The backend verifies
  // these tokens with the same secret. Distinct from the internal JWT_SECRET
  // (used for app/route auth) for defense-in-depth isolation.
  WORKER_JWT_SECRET?: string;

  // Admin: required to use POST /admin/backend-url for runtime URL rotation.
  // If unset, that endpoint returns 503.
  ADMIN_TOKEN?: string;

  // CORS
  ALLOWED_ORIGINS?: string; // comma-separated

  // KV namespace (rate limiting + session cache + runtime config)
  BING_KV: KVNamespace;

  // R2 bucket (file storage) — optional, not bound until [[r2_buckets]] configured
  BING_STORAGE?: R2Bucket;

  // R2 bucket (structured trace logs) — writes [TRACE] lines to R2 for durable persistence
  // Uncomment [[r2_buckets]] binding in wrangler.toml to enable.
  // Layout: traces/YYYY-MM-DD/HH/MM-{random}.ndjson (NDJSON, one entry per line)
  TRACE_R2?: R2Bucket;

  // D1 database (lightweight SQL) — optional, not bound until [[d1_databases]] configured
  BING_DB?: D1Database;

  // Workers Analytics Engine dataset (IP flood monitor).
  // Free tier: 100k events/day written, 30-day retention, SQL queryable.
  // Replaces a Cloudflare WAF rate-limit rule (not available on Free plan).
  // One row per request is written via `writeDataPoint()`. A scheduled
  // handler (cron `*/1 * * * *`) queries the dataset every minute and
  // rebuilds a deny list in KV. The hot path reads the deny list from KV
  // (in-memory cache, 30s TTL) and returns 403 for listed IPs.
  // Uncomment [[analytics_engine_datasets]] binding in wrangler.toml to enable.
  IP_FLOOD_MONITOR?: AnalyticsEngineDataset;

  // ── IP Flood Monitor: query-side configuration ──────────────────
  // The scheduled handler queries the dataset via Cloudflare's HTTP SQL
  // API (Workers can't query their own Analytics Engine datasets from
  // inside the Worker; only writeDataPoint is on the binding). Both of
  // these must be set for the deny list to be rebuilt each minute. If
  // either is missing, the scheduled handler no-ops silently and the
  // existing deny list (if any) is preserved.
  //
  // Set with: npx wrangler secret put CLOUDFLARE_API_TOKEN
  // Required scope: Account Analytics: Read
  CLOUDFLARE_API_TOKEN?: string;
  // Set in wrangler.toml [vars]: CF_ACCOUNT_ID = "69131dbe7a982d6e0ded89318103b605"
  CF_ACCOUNT_ID?: string;
  // Optional: override the per-IP req/min flood threshold (default 500)
  IP_FLOOD_THRESHOLD?: string;
}
