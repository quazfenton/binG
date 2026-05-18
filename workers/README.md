# binG Edge Gateway — Cloudflare Worker

An edge proxy that sits in front of both the Vercel frontend and the OCI backend,
handling rate limiting, authentication, routing, and CORS at the network edge.

## Architecture

```
                         ┌─────────────────┐
                         │   Cloudflare     │
                         │  Edge Gateway    │
                         │  (this worker)   │
                         └────────┬────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
             ┌──────────┐  ┌──────────┐  ┌──────────┐
             │  Vercel   │  │   OCI    │  │  Direct  │
             │  Frontend │  │  Backend │  │  (R2,KV) │
             │  (Next.js)│  │  (Hono)  │  │          │
             └──────────┘  └──────────┘  └──────────┘
```

## Routing Logic

| Path | Target | Notes |
|------|--------|-------|
| `/health`, `/api/health` | **Edge** | Handled locally — no proxying |
| `/api/chat` | **OCI Backend** | Main AI chat API |
| `/api/*` | **OCI Backend** | All other API routes |
| `/*` (static assets) | **Vercel Frontend** | Cached for 1 year |
| `/*` (everything else) | **Vercel Frontend** | No cache |

## Features

### 1. Rate Limiting (KV-backed)
- **Anonymous**: 100 req/min per IP
- **Authenticated**: 1000 req/min per user
- Sliding window using Cloudflare KV
- Fail-open: if KV is unreachable, requests pass through

### 2. JWT Authentication
- Extracts tokens from `Authorization: Bearer <token>` header
- Falls back to `sid_tkn` session cookie
- Verifies HS256 signatures when `JWT_SECRET` is configured
- Passes `X-User-Id` and `X-User-Authenticated` headers to backend

### 3. CORS
- Restrictive by default (only frontend origin allowed)
- Configurable via `ALLOWED_ORIGINS` comma-separated env var
- Wildcard (`*`) support for development

### 4. Request Proxying
- Strips hop-by-hop headers
- Forwards client IP via `X-Forwarded-For`
- 25-second timeout on proxied requests
- Returns 502 if backend is unavailable

## Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account (Workers Free plan)
- `FRONTEND_URL`: Your Vercel deployment URL

### One-Command Setup

```bash
chmod +x workers/setup.sh
./workers/setup.sh
```

This script will:
1. Login to Cloudflare via `wrangler login`
2. Create the KV namespace (rate limiting cache)
3. Create the R2 bucket (file storage)
4. Create the D1 database (SQL storage)
5. Prompt for env vars (FRONTEND_URL, BACKEND_URL, JWT_SECRET, etc.)
6. Deploy the worker

### Manual Setup

```bash
cd workers/edge-gateway

# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Create KV namespace (for rate limiting)
npx wrangler kv namespace create bing-kv
# → Copy the ID into wrangler.toml's kv_namespaces[0].id & preview_id

# Create R2 bucket (for file storage)
npx wrangler r2 bucket create bing-storage

# Create D1 database (for SQL)
npx wrangler d1 create bing-db
# → Copy the ID into wrangler.toml's d1_databases[0].database_id

# Set environment secrets
echo "https://web-eight-ashen-83.vercel.app" | npx wrangler secret put FRONTEND_URL
echo "https://api.bing.dev" | npx wrangler secret put BACKEND_URL
echo "<your-jwt-secret>" | npx wrangler secret put JWT_SECRET

# ❗ Important: wrangler.toml has routes commented out by default.
# For first-time deploy without a custom domain, leave routes commented.
# Only uncomment after setting up a custom domain in Cloudflare Dashboard.

# Generate TypeScript types
npx wrangler types

# Deploy (first deploy — no custom domain)
npx wrangler deploy
```

### First Deploy Note

The `wrangler.toml` routes section is **commented out by default** because you need a custom domain + zone_id before enabling it. The first `wrangler deploy` will deploy to a `*.workers.dev` subdomain. After that, you can add a custom domain (e.g., `api.bing.dev`) in Cloudflare Dashboard → Workers → Triggers.

### Development

```bash
cd workers/edge-gateway
npx wrangler dev
```

This starts a local dev server at `http://localhost:8787`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FRONTEND_URL` | ✅ | Vercel frontend URL |
| `BACKEND_URL` | ❌ | OCI backend URL (falls back to Vercel) |
| `JWT_SECRET` | ❌ | JWT signing secret (optional — tokens decoded without verification if unset) |
| `ALLOWED_ORIGINS` | ❌ | Comma-separated CORS origins (defaults to FRONTEND_URL) |

## Cloudflare Resources

| Resource | Binding | Purpose |
|----------|---------|---------|
| KV Namespace | `BING_KV` | Rate limiting counters, session cache |
| R2 Bucket | `BING_STORAGE` | File/artifact storage (replaces MinIO) |
| D1 Database | `BING_DB` | Lightweight SQL (supplements PostgreSQL) |

## Custom Domain

1. In Cloudflare Dashboard → Workers & Pages → `bing-edge-gateway` → Triggers
2. Add custom domain (e.g., `api.bing.dev`)
3. The `route` in `wrangler.toml` must match with the correct `zone_id`

## Troubleshooting

- **Build fails**: Run `npx wrangler types` to regenerate bindings, then `npm run typecheck`
- **KV operations slow**: KV p99 latency is ~200ms. For high-throughput rate limiting, consider Durable Objects.
- **CORS errors**: Check `ALLOWED_ORIGINS` matches your frontend domain exactly (including protocol)
- **502 errors**: Verify the backend (`BACKEND_URL`) is reachable from Cloudflare's network
