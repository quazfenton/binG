/**
 * Environment variables and bindings for the edge gateway worker.
 *
 * Generate/update this file by running: `npx wrangler types`
 */
export interface Env {
  // Backend URLs
  BACKEND_URL: string;   // OCI backend (e.g. https://api.bing.dev)
  FRONTEND_URL: string;  // Vercel frontend (e.g. https://web-eight-ashen-83.vercel.app)

  // Authentication
  JWT_SECRET?: string;   // optional — if unset, tokens are decoded without verification

  // CORS
  ALLOWED_ORIGINS?: string; // comma-separated

  // KV namespace (rate limiting + session cache)
  BING_KV: KVNamespace;

  // R2 bucket (file storage)
  BING_STORAGE: R2Bucket;

  // D1 database (lightweight SQL)
  BING_DB: D1Database;
}
