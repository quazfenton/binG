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

  // Admin: required to use POST /admin/backend-url for runtime URL rotation.
  // If unset, that endpoint returns 503.
  ADMIN_TOKEN?: string;

  // CORS
  ALLOWED_ORIGINS?: string; // comma-separated

  // KV namespace (rate limiting + session cache + runtime config)
  BING_KV: KVNamespace;

  // R2 bucket (file storage)
  BING_STORAGE: R2Bucket;

  // D1 database (lightweight SQL)
  BING_DB: D1Database;
}
